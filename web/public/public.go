package public

import (
	"embed"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/internal/config"
)

//go:embed defaultTheme/komari-theme.json
var PublicFS embed.FS

//go:embed defaultTheme/dist.tar.zst
var embeddedDistArchive []byte

// 常量定义
const (
	DataDir            = "./data"
	ThemesDir          = "theme"
	FaviconFile        = "favicon.ico"
	DefaultTheme       = "default"
	LanguageCookieName = "language"

	// 主题内部结构定义
	DistDir   = "dist"       // 静态资源存放目录
	IndexFile = "index.html" // 相对于 DistDir
)

func init() {
	_ = os.MkdirAll("./data/theme", 0755)
}

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

var (
	probeRootAttrPattern = regexp.MustCompile(`(?i)\b(src|href)=(["'])(/[^"'<>]*)["']`)
	probeHeadOpenPattern = regexp.MustCompile(`(?i)<head\b[^>]*>`)
)

func isValidThemeID(themeID string) bool {
	if themeID == "" || themeID == "." || themeID == ".." {
		return false
	}
	return !strings.Contains(themeID, "..") && !strings.Contains(themeID, "/") && !strings.Contains(themeID, "\\")
}

// rewriteProbeThemeAssetURLs rewrites root-relative asset references in a third-party
// Komari theme's index.html so they resolve under /probe-theme-assets/<themeID>/...
// without colliding with the outer Hub shell's /assets/* bundle.
func rewriteProbeThemeAssetURLs(htmlStr, themeID string) string {
	assetPrefix := "/probe-theme-assets/" + url.PathEscape(themeID)
	return probeRootAttrPattern.ReplaceAllStringFunc(htmlStr, func(match string) string {
		parts := probeRootAttrPattern.FindStringSubmatch(match)
		if len(parts) != 4 {
			return match
		}
		attr, quote, rawPath := parts[1], parts[2], parts[3]
		if strings.HasPrefix(rawPath, "//") ||
			strings.HasPrefix(rawPath, "/api/") ||
			strings.HasPrefix(rawPath, "/themes/") ||
			strings.HasPrefix(rawPath, "/probe-theme/") ||
			strings.HasPrefix(rawPath, "/probe-theme-assets/") ||
			rawPath == "/" {
			return match
		}
		if strings.EqualFold(attr, "href") {
			// Skip SPA navigation links without a file extension when not under /assets/
			clean := rawPath
			if idx := strings.IndexAny(clean, "?#"); idx >= 0 {
				clean = clean[:idx]
			}
			if !strings.HasPrefix(clean, "/assets/") && filepath.Ext(clean) == "" {
				return match
			}
		}
		return fmt.Sprintf("%s=%s%s%s%s", attr, quote, assetPrefix, rawPath, quote)
	})
}

// injectProbeThemeBootstrap inserts a tiny same-origin bootstrap script before the
// third-party theme initializes so BrowserRouter/HashRouter themes see "/" instead
// of "/probe-theme/", cannot register a conflicting root Service Worker, and open
// /admin or /terminal links cleanly in the outer Hub window.
func injectProbeThemeBootstrap(htmlStr string) string {
	const script = `<script data-komari-hub-bridge="1">(function(){try{var p=location.pathname;if(p==="/probe-theme"||p==="/probe-theme/"){history.replaceState(history.state,"","/"+location.search+location.hash);}else if(p.indexOf("/probe-theme/")===0){history.replaceState(history.state,"",p.slice("/probe-theme".length)+location.search+location.hash);}if(navigator&&navigator.serviceWorker){try{Object.defineProperty(navigator.serviceWorker,"register",{configurable:true,value:function(){return Promise.resolve({unregister:function(){return Promise.resolve(true);}});}});}catch(_){}}window.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href")||"";if(h.indexOf("/admin")===0||h.indexOf("/terminal")===0||h.indexOf("/uptime")===0||h.indexOf("/subscriptions")===0||h.indexOf("/servers")===0){e.preventDefault();if(window.top&&window.top!==window){window.top.location.href=h;}else{location.href=h;}}},true);}catch(_){}})();</script>`
	if loc := probeHeadOpenPattern.FindStringIndex(htmlStr); loc != nil {
		return htmlStr[:loc[1]] + script + htmlStr[loc[1]:]
	}
	return script + htmlStr
}

// isSafePath 验证路径是否在指定的基础目录内，防止路径穿透攻击
func isSafePath(basePath, targetPath string) bool {
	// 获取基础目录的绝对路径
	absBase, err := filepath.Abs(basePath)
	if err != nil {
		return false
	}

	// 清理目标路径，移除 ../ 等
	cleanTarget := filepath.Clean(targetPath)

	// 拼接完整路径
	fullPath := filepath.Join(absBase, cleanTarget)

	// 获取绝对路径
	absTarget, err := filepath.Abs(fullPath)
	if err != nil {
		return false
	}

	// 检查目标路径是否以基础路径开头
	// 使用 filepath.Rel 更可靠地检查路径关系
	rel, err := filepath.Rel(absBase, absTarget)
	if err != nil {
		return false
	}

	// 如果相对路径以 .. 开头，说明目标在基础目录之外
	return !strings.HasPrefix(rel, "..") && rel != ".."
}

// Static 注册静态资源和 SPA 路由处理
func Static(r *gin.RouterGroup, noRoute func(handlers ...gin.HandlerFunc)) {
	static(r, noRoute, false)
}

// StaticRestricted serves only the embedded default frontend. Restricted
// startup listeners must not let an installed theme override same-named JS,
// CSS, manifest, or favicon assets used by login and recovery pages.
func StaticRestricted(r *gin.RouterGroup, noRoute func(handlers ...gin.HandlerFunc)) {
	static(r, noRoute, true)
}

func static(r *gin.RouterGroup, noRoute func(handlers ...gin.HandlerFunc), forceDefaultTheme bool) {
	// 初始化嵌入式文件系统，指向 defaultTheme 根目录。
	defaultThemeFS, err := fs.Sub(PublicFS, "defaultTheme")
	if err != nil {
		panic("embedded default theme metadata is unavailable: " + err.Error())
	}

	getConfig := func() map[string]any {
		cfg, _ := config.GetMany(map[string]any{
			config.DescriptionKey: "A simple server monitor tool.",
			config.CustomHeadKey:  "",
			config.CustomBodyKey:  "",
			config.SitenameKey:    "Komari Monitor",
			config.ThemeKey:       DefaultTheme,
		})
		return cfg
	}

	// 读取指定第三方主题本地文件（不回退到 defaultTheme）
	getThemeLocalFile := func(themeID string, relativePath string) ([]byte, string, bool) {
		if themeID == DefaultTheme || !isValidThemeID(themeID) {
			return nil, "", false
		}
		cleanPath := filepath.Clean(strings.TrimPrefix(relativePath, "/"))
		themeBasePath := filepath.Join(DataDir, ThemesDir, themeID)
		if !isSafePath(themeBasePath, cleanPath) {
			return nil, "", false
		}
		localPath := filepath.Join(themeBasePath, cleanPath)
		info, err := os.Stat(localPath)
		if err != nil || info.IsDir() {
			return nil, "", false
		}
		content, err := os.ReadFile(localPath)
		if err != nil {
			return nil, "", false
		}
		return content, mime.TypeByExtension(filepath.Ext(localPath)), true
	}

	// 读取嵌入式 defaultTheme 文件
	getDefaultFile := func(relativePath string) ([]byte, string, bool) {
		cleanPath := filepath.Clean(strings.TrimPrefix(relativePath, "/"))
		embedPath := filepath.ToSlash(cleanPath)
		if strings.Contains(embedPath, "..") {
			return nil, "", false
		}
		if strings.HasPrefix(embedPath, DistDir+"/") {
			content, err := os.ReadFile(filepath.Join(defaultDistCacheDir, filepath.FromSlash(strings.TrimPrefix(embedPath, DistDir+"/"))))
			if err == nil {
				return content, mime.TypeByExtension(filepath.Ext(embedPath)), true
			}
		} else if content, err := fs.ReadFile(defaultThemeFS, embedPath); err == nil {
			return content, mime.TypeByExtension(filepath.Ext(embedPath)), true
		}
		return nil, "", false
	}

	// 核心逻辑：获取文件内容
	// filePath: 相对于主题根目录的路径 (例如 "komari-theme.json" 或 "dist/assets/a.js")
	// 返回: content, contentType, exists
	getFileContent := func(themeID string, relativePath string) ([]byte, string, bool) {
		if themeID != DefaultTheme {
			if content, mimeType, ok := getThemeLocalFile(themeID, relativePath); ok {
				return content, mimeType, true
			}
		}
		return getDefaultFile(relativePath)
	}

	// 核心逻辑：渲染主外壳 Index.html（始终使用内置 Hub defaultTheme，防止第三方主题劫持顶栏与其他标签页）
	serveIndex := func(c *gin.Context) {
		reqPath := c.Request.URL.Path
		cfg := getConfig()

		shouldReplace := true
		if forceDefaultTheme || strings.HasPrefix(reqPath, "/admin") || strings.HasPrefix(reqPath, "/terminal") {
			shouldReplace = false
		}

		targetFile := path.Join(DistDir, IndexFile)
		content, _, exists := getDefaultFile(targetFile)

		if !exists {
			c.String(http.StatusNotFound, "Index file missing (checked default/dist/index.html).")
			return
		}

		htmlStr := string(content)
		if forceDefaultTheme {
			htmlStr = stripServiceWorkerRegistration(htmlStr)
		}
		if language, err := c.Cookie(LanguageCookieName); err == nil {
			htmlStr = replaceHTMLLanguage(htmlStr, language)
		}

		if !shouldReplace {
			c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(htmlStr))
			return
		}

		replacer := strings.NewReplacer(
			"<title>Komari Monitor</title>", "<title>"+cfg[config.SitenameKey].(string)+"</title>",
			"A simple server monitor tool.", cfg[config.DescriptionKey].(string),
			"</head>", cfg[config.CustomHeadKey].(string)+"</head>",
			"</body>", cfg[config.CustomBodyKey].(string)+"</body>",
		)

		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(replacer.Replace(htmlStr)))
	}

	// 渲染 Tab 2 探针专用第三方主题入口（支持 Komari 主题商城安装的任意第三方主题）
	serveProbeTheme := func(c *gin.Context, subPath string) {
		if forceDefaultTheme {
			c.Status(http.StatusNotFound)
			return
		}
		cfg := getConfig()
		themeID := strings.TrimSpace(c.Query("theme"))
		if themeID == "" {
			themeID, _ = cfg[config.ThemeKey].(string)
		}
		if themeID == "" || themeID == DefaultTheme || !isValidThemeID(themeID) {
			c.String(http.StatusNotFound, "No custom probe theme is active.")
			return
		}

		// 若子路径直接命中该主题 dist 下的静态资源，直接返回
		trimmedSub := strings.TrimPrefix(subPath, "/")
		if trimmedSub != "" && trimmedSub != IndexFile {
			if content, mimeType, ok := getThemeLocalFile(themeID, path.Join(DistDir, trimmedSub)); ok {
				c.Data(http.StatusOK, mimeType, content)
				return
			}
		}

		content, _, exists := getThemeLocalFile(themeID, path.Join(DistDir, IndexFile))
		if !exists {
			c.String(http.StatusNotFound, "Theme index file missing for %q.", themeID)
			return
		}

		htmlStr := stripServiceWorkerRegistration(string(content))
		if language, err := c.Cookie(LanguageCookieName); err == nil {
			htmlStr = replaceHTMLLanguage(htmlStr, language)
		}
		replacer := strings.NewReplacer(
			"<title>Komari Monitor</title>", "<title>"+cfg[config.SitenameKey].(string)+"</title>",
			"A simple server monitor tool.", cfg[config.DescriptionKey].(string),
			"</head>", cfg[config.CustomHeadKey].(string)+"</head>",
			"</body>", cfg[config.CustomBodyKey].(string)+"</body>",
		)
		htmlStr = replacer.Replace(htmlStr)
		htmlStr = rewriteProbeThemeAssetURLs(htmlStr, themeID)
		htmlStr = injectProbeThemeBootstrap(htmlStr)

		c.Header("Cache-Control", "no-store")
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(htmlStr))
	}

	// ================= 路由定义 =================
	// 1. Favicon 优先策略
	r.GET("/favicon.ico", func(c *gin.Context) {
		// 优先：./data/favicon.ico
		localFavicon := filepath.Join(DataDir, FaviconFile)
		if !forceDefaultTheme {
			if _, err := os.Stat(localFavicon); err == nil {
				c.File(localFavicon)
				return
			}
		}

		// 其次：当前主题的 dist/favicon.ico 或 theme_root/favicon.ico ?
		// 通常构建后的资源在 dist 中，这里假设优先找 dist 内的，如果你的 favicon 在根目录，去掉 DistDir 拼接即可
		cfg := getConfig()
		themeFaviconPath := path.Join(DistDir, FaviconFile)
		currentTheme := cfg[config.ThemeKey].(string)
		if forceDefaultTheme {
			currentTheme = DefaultTheme
		}
		content, mimeType, exists := getFileContent(currentTheme, themeFaviconPath)
		if exists {
			c.Data(http.StatusOK, mimeType, content)
			return
		}

		c.Status(http.StatusNotFound)
	})

	// 2. 静态资源路由 /themes/:id/*path
	// 允许访问 /themes/MyTheme/komari-theme.json 和 /themes/MyTheme/dist/assets/a.js
	r.GET("/themes/:id/*path", func(c *gin.Context) {
		themeID := c.Param("id")
		if forceDefaultTheme && themeID != DefaultTheme {
			c.Status(http.StatusNotFound)
			return
		}
		if forceDefaultTheme {
			themeID = DefaultTheme
		}
		// c.Param("path") 包含了开头的 /，getFileContent 会处理
		filePath := c.Param("path")

		content, mimeType, exists := getFileContent(themeID, filePath)
		if exists {
			c.Data(http.StatusOK, mimeType, content)
			return
		}
		c.Status(http.StatusNotFound)
	})

	// 2.5 Tab 2 探针第三方主题沙箱入口与隔离静态资源路由
	r.GET("/probe-theme-assets/:id/*path", func(c *gin.Context) {
		if forceDefaultTheme {
			c.Status(http.StatusNotFound)
			return
		}
		themeID := c.Param("id")
		relPath := strings.TrimPrefix(c.Param("path"), "/")
		if content, mimeType, ok := getThemeLocalFile(themeID, path.Join(DistDir, relPath)); ok {
			c.Data(http.StatusOK, mimeType, content)
			return
		}
		if content, mimeType, ok := getThemeLocalFile(themeID, relPath); ok {
			c.Data(http.StatusOK, mimeType, content)
			return
		}
		c.Status(http.StatusNotFound)
	})

	r.GET("/probe-theme", func(c *gin.Context) {
		serveProbeTheme(c, "")
	})
	r.GET("/probe-theme/*path", func(c *gin.Context) {
		serveProbeTheme(c, c.Param("path"))
	})

	// 3. SPA 路由 (noRoute)
	noRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			c.Status(http.StatusNotFound)
			return
		}
		//
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
		reqPath := c.Request.URL.Path
		cfg := getConfig()
		currentTheme, _ := cfg[config.ThemeKey].(string)

		// SPA 静态资源回退：优先命中内置 Hub defaultTheme，确保外层主框架永不被第三方主题覆盖；
		// 若未命中且启用了第三方探针主题，则回退到该第三方主题的 dist 静态文件（兼容动态根路径加载的资源）。
		distPath := path.Join(DistDir, reqPath)

		if content, mimeType, exists := getDefaultFile(distPath); exists {
			c.Data(http.StatusOK, mimeType, content)
			return
		}
		if !forceDefaultTheme && currentTheme != "" && currentTheme != DefaultTheme {
			if content, mimeType, exists := getThemeLocalFile(currentTheme, distPath); exists {
				c.Data(http.StatusOK, mimeType, content)
				return
			}
		}

		// 路由 (如 /, /servers, /uptime, /subscriptions, /admin) -> 返回 Hub 主外壳 index.html
		serveIndex(c)
	})
}
