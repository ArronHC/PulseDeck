package public

import (
	_ "embed"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/internal/config"
)

//go:embed defaultTheme/dist.tar.zst
var embeddedDistArchive []byte

const (
	IndexFile          = "index.html"
	faviconFile        = "favicon.ico"
	LanguageCookieName = "language"
)

func normalizeHTMLLanguage(language string) string {
	language = strings.TrimSpace(strings.ReplaceAll(language, "_", "-"))
	if len(language) < 2 || len(language) > 32 {
		return ""
	}

	for _, r := range language {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' {
			continue
		}
		return ""
	}

	return language
}

func replaceHTMLLanguage(htmlStr, language string) string {
	language = normalizeHTMLLanguage(language)
	if language == "" {
		return htmlStr
	}

	replacements := []struct {
		old string
		new string
	}{
		{`<html lang="en">`, `<html lang="` + language + `">`},
		{`<html lang='en'>`, `<html lang='` + language + `'>`},
		{`<html>`, `<html lang="` + language + `">`},
	}

	for _, replacement := range replacements {
		if strings.Contains(htmlStr, replacement.old) {
			return strings.Replace(htmlStr, replacement.old, replacement.new, 1)
		}
	}

	return htmlStr
}

func stripServiceWorkerRegistration(html string) string {
	return strings.ReplaceAll(html, `<script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>`, "")
}

// Static registers the embedded frontend assets and SPA fallback.
func Static(r *gin.RouterGroup, noRoute func(handlers ...gin.HandlerFunc)) {
	static(r, noRoute, false)
}

// StaticRestricted serves the frontend on startup listeners without site
// customizations or service worker registration.
func StaticRestricted(r *gin.RouterGroup, noRoute func(handlers ...gin.HandlerFunc)) {
	static(r, noRoute, true)
}

func readDistFile(name string) ([]byte, string, error) {
	localPath, err := filepath.Localize(name)
	if err != nil {
		return nil, "", err
	}
	content, err := os.ReadFile(filepath.Join(defaultDistCacheDir, localPath))
	return content, mime.TypeByExtension(filepath.Ext(name)), err
}

func static(r *gin.RouterGroup, noRoute func(handlers ...gin.HandlerFunc), restricted bool) {
	serveIndex := func(c *gin.Context) {
		content, _, err := readDistFile(IndexFile)
		if err != nil {
			c.String(http.StatusNotFound, "Embedded frontend index file missing.")
			return
		}

		htmlStr := string(content)
		if restricted {
			htmlStr = stripServiceWorkerRegistration(htmlStr)
		}
		if language, err := c.Cookie(LanguageCookieName); err == nil {
			htmlStr = replaceHTMLLanguage(htmlStr, language)
		}
		if !restricted && !strings.HasPrefix(c.Request.URL.Path, "/admin") {
			cfg := map[string]any{
				config.SitenameKey:    config.DefaultSitename,
				config.DescriptionKey: config.DefaultDescription,
				config.CustomHeadKey:  "",
				config.CustomBodyKey:  "",
			}
			if stored, err := config.GetMany(cfg); err == nil {
				for key, value := range stored {
					if _, ok := value.(string); ok {
						cfg[key] = value
					}
				}
			}
			replacer := strings.NewReplacer(
				"<title>PulseDeck</title>", "<title>"+cfg[config.SitenameKey].(string)+"</title>",
				"<title>Komari Monitor</title>", "<title>"+cfg[config.SitenameKey].(string)+"</title>",
				config.DefaultDescription, cfg[config.DescriptionKey].(string),
				"A simple server monitor tool.", cfg[config.DescriptionKey].(string),
				"</head>", cfg[config.CustomHeadKey].(string)+"</head>",
				"</body>", cfg[config.CustomBodyKey].(string)+"</body>",
			)
			htmlStr = replacer.Replace(htmlStr)
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(htmlStr))
	}

	r.GET("/favicon.ico", func(c *gin.Context) {
		if !restricted {
			localFavicon := filepath.Join("data", faviconFile)
			if info, err := os.Stat(localFavicon); err == nil && !info.IsDir() {
				c.File(localFavicon)
				return
			}
		}

		content, mimeType, err := readDistFile(faviconFile)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		c.Data(http.StatusOK, mimeType, content)
	})

	noRoute(func(c *gin.Context) {
		requestPath := c.Request.URL.Path
		if c.Request.Method != http.MethodGet || requestPath == "/api" || strings.HasPrefix(requestPath, "/api/") {
			c.Status(http.StatusNotFound)
			return
		}
		func() {
			tempKey := c.Query("temp_key")
			if tempKey == "" {
				return
			}

			tempKeyExpireTime, err := config.GetAs[int64]("tempory_share_token_expire_at", 0)
			if err != nil {
				return
			}
			allowTempKey, err := config.GetAs[string]("tempory_share_token", "")
			if err != nil {
				return
			}

			if allowTempKey == "" || tempKey != allowTempKey {
				return
			}
			now := time.Now().Unix()
			if tempKeyExpireTime < now {
				return
			}
			expireSeconds := int(tempKeyExpireTime - now)
			if expireSeconds > 0 {
				c.SetCookie(
					"temp_key",    // key
					tempKey,       // value
					expireSeconds, // maxAge（秒）
					"/",           // path
					"",            // domain
					false,         // secure
					false,         // httpOnly
				)
			}
		}()

		name := strings.TrimPrefix(requestPath, "/")
		if name != IndexFile {
			if content, mimeType, err := readDistFile(name); err == nil {
				c.Data(http.StatusOK, mimeType, content)
				return
			}
		}
		serveIndex(c)
	})
}
