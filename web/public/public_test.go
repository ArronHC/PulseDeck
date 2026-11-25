package public

import (
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/internal/config"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestNormalizeHTMLLanguage(t *testing.T) {
	tests := map[string]struct {
		input string
		want  string
	}{
		"hyphen language": {
			input: "zh-CN",
			want:  "zh-CN",
		},
		"underscore language": {
			input: "zh_CN",
			want:  "zh-CN",
		},
		"reject script injection": {
			input: `zh-CN" autofocus`,
		},
		"reject too short": {
			input: "z",
		},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			if got := normalizeHTMLLanguage(tt.input); got != tt.want {
				t.Fatalf("normalizeHTMLLanguage(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestReplaceHTMLLanguage(t *testing.T) {
	tests := map[string]struct {
		html     string
		language string
		want     string
	}{
		"replace existing lang": {
			html:     `<html lang="en"><head></head></html>`,
			language: "zh-CN",
			want:     `<html lang="zh-CN"><head></head></html>`,
		},
		"insert missing lang": {
			html:     `<html><head></head></html>`,
			language: "ja_JP",
			want:     `<html lang="ja-JP"><head></head></html>`,
		},
		"ignore invalid lang": {
			html:     `<html lang="en"><head></head></html>`,
			language: `zh-CN" autofocus`,
			want:     `<html lang="en"><head></head></html>`,
		},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			if got := replaceHTMLLanguage(tt.html, tt.language); got != tt.want {
				t.Fatalf("replaceHTMLLanguage() = %q, want %q", got, tt.want)
			}
		})
	}
}

// sharedDistDir extracts the embedded dist archive once per test binary.
// Extraction dominates these tests' runtime, so both dist-related tests reuse
// a single copy instead of unpacking the archive twice.
var (
	sharedDistOnce sync.Once
	sharedDistPath string
	sharedDistErr  error
)

func extractSharedDist(t *testing.T) string {
	t.Helper()
	sharedDistOnce.Do(func() {
		dir, err := os.MkdirTemp("", "komari-public-dist-*")
		if err != nil {
			sharedDistErr = err
			return
		}
		if err := extractDistArchive(embeddedDistArchive, dir); err != nil {
			sharedDistErr = err
			_ = os.RemoveAll(dir)
			return
		}
		sharedDistPath = dir
	})
	if sharedDistErr != nil {
		t.Fatalf("extract embedded dist: %v", sharedDistErr)
	}
	return sharedDistPath
}

func TestEmbeddedDistDoesNotEmbedRawFiles(t *testing.T) {
	if _, err := PublicFS.ReadFile("defaultTheme/dist/index.html"); err == nil {
		t.Fatal("PublicFS still embeds the raw frontend files")
	}
	content, err := os.ReadFile(filepath.Join(extractSharedDist(t), IndexFile))
	if err != nil || len(content) == 0 {
		t.Fatalf("embedded dist does not contain a non-empty %q", IndexFile)
	}
}

func TestStaticRestrictedDoesNotServeCustomAssetOverride(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldDefaultDistCacheDir := defaultDistCacheDir
	defaultDistCacheDir = extractSharedDist(t)
	t.Cleanup(func() {
		defaultDistCacheDir = oldDefaultDistCacheDir
	})
	t.Chdir(t.TempDir())
	assetPath := filepath.Join("data", "theme", "custom", "dist", "assets")
	if err := os.MkdirAll(assetPath, 0o755); err != nil {
		t.Fatalf("create custom theme asset directory: %v", err)
	}
	const assetName = "about-D4JKo971.css"
	if err := os.WriteFile(filepath.Join(assetPath, assetName), []byte("custom override"), 0o644); err != nil {
		t.Fatalf("write custom theme asset: %v", err)
	}

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open config db: %v", err)
	}
	config.SetDb(db)
	if err := config.Set(config.ThemeKey, "custom"); err != nil {
		t.Fatalf("set custom theme: %v", err)
	}

	router := gin.New()
	StaticRestricted(router.Group("/"), func(handlers ...gin.HandlerFunc) {
		router.NoRoute(handlers...)
	})
	for _, requestPath := range []string{"/assets/" + assetName} {
		request := httptest.NewRequest("GET", requestPath, nil)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != 200 {
			t.Fatalf("restricted asset %s status = %d, want 200", requestPath, recorder.Code)
		}
		body, err := io.ReadAll(recorder.Result().Body)
		if err != nil {
			t.Fatalf("read restricted asset %s: %v", requestPath, err)
		}
		if string(body) == "custom override" {
			t.Fatalf("restricted listener served a custom theme asset override for %s", requestPath)
		}
	}

	indexRequest := httptest.NewRequest("GET", "/database-recovery", nil)
	indexRecorder := httptest.NewRecorder()
	router.ServeHTTP(indexRecorder, indexRequest)
	indexBody, err := io.ReadAll(indexRecorder.Result().Body)
	if err != nil {
		t.Fatalf("read restricted index: %v", err)
	}
	if strings.Contains(string(indexBody), `vite-plugin-pwa:register-sw`) {
		t.Fatal("restricted index still registers a service worker")
	}

	probeReq := httptest.NewRequest("GET", "/probe-theme/", nil)
	probeRec := httptest.NewRecorder()
	router.ServeHTTP(probeRec, probeReq)
	if probeRec.Code != 404 {
		t.Fatalf("restricted /probe-theme/ status = %d, want 404", probeRec.Code)
	}
}

func TestProbeThemeIsolationKeepsHubShellAndServesMarketTheme(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldDefaultDistCacheDir := defaultDistCacheDir
	defaultDistCacheDir = extractSharedDist(t)
	t.Cleanup(func() {
		defaultDistCacheDir = oldDefaultDistCacheDir
	})
	t.Chdir(t.TempDir())

	themeDist := filepath.Join("data", "theme", "purcarte", "dist")
	if err := os.MkdirAll(filepath.Join(themeDist, "assets"), 0o755); err != nil {
		t.Fatalf("create theme dir: %v", err)
	}
	themeHTML := `<!doctype html><html lang="en"><head><title>Komari Monitor</title><script type="module" src="/assets/purcarte-app.js"></script><link rel="stylesheet" href="/assets/purcarte.css"><script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script></head><body><div id="purcarte-root"></div></body></html>`
	if err := os.WriteFile(filepath.Join(themeDist, "index.html"), []byte(themeHTML), 0o644); err != nil {
		t.Fatalf("write theme index.html: %v", err)
	}
	if err := os.WriteFile(filepath.Join(themeDist, "assets", "purcarte-app.js"), []byte(`console.log("purcarte");`), 0o644); err != nil {
		t.Fatalf("write theme asset: %v", err)
	}

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open config db: %v", err)
	}
	config.SetDb(db)
	if err := config.Set(config.ThemeKey, "purcarte"); err != nil {
		t.Fatalf("set theme: %v", err)
	}
	if err := config.Set(config.SitenameKey, "My Unified Hub"); err != nil {
		t.Fatalf("set sitename: %v", err)
	}

	router := gin.New()
	Static(router.Group("/"), func(handlers ...gin.HandlerFunc) {
		router.NoRoute(handlers...)
	})

	// 1. Hub shell routes must STILL serve embedded defaultTheme, never hijacked by purcarte
	for _, hubRoute := range []string{"/", "/servers", "/uptime", "/subscriptions"} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("GET", hubRoute, nil))
		if rec.Code != 200 {
			t.Fatalf("hub route %s status = %d, want 200", hubRoute, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "purcarte-root") {
			t.Fatalf("hub route %s was hijacked by third-party theme", hubRoute)
		}
	}

	// 2. /probe-theme/ serves the installed third-party theme with rewritten assets, no SW, and bridge script
	probeRec := httptest.NewRecorder()
	router.ServeHTTP(probeRec, httptest.NewRequest("GET", "/probe-theme/", nil))
	if probeRec.Code != 200 {
		t.Fatalf("/probe-theme/ status = %d, want 200", probeRec.Code)
	}
	body := probeRec.Body.String()
	if !strings.Contains(body, `id="purcarte-root"`) {
		t.Fatalf("/probe-theme/ did not serve purcarte HTML: %s", body)
	}
	if !strings.Contains(body, `src="/probe-theme-assets/purcarte/assets/purcarte-app.js"`) {
		t.Fatalf("/probe-theme/ did not rewrite script src: %s", body)
	}
	if !strings.Contains(body, `href="/probe-theme-assets/purcarte/assets/purcarte.css"`) {
		t.Fatalf("/probe-theme/ did not rewrite stylesheet href: %s", body)
	}
	if strings.Contains(body, `vite-plugin-pwa:register-sw`) {
		t.Fatalf("/probe-theme/ did not strip PWA service worker registration")
	}
	if !strings.Contains(body, `data-komari-hub-bridge="1"`) {
		t.Fatalf("/probe-theme/ missing hub bridge script")
	}
	if !strings.Contains(body, `<title>My Unified Hub</title>`) {
		t.Fatalf("/probe-theme/ did not apply sitename replacement")
	}

	// 3. Isolated theme asset endpoint serves the third-party JS file
	assetRec := httptest.NewRecorder()
	router.ServeHTTP(assetRec, httptest.NewRequest("GET", "/probe-theme-assets/purcarte/assets/purcarte-app.js", nil))
	if assetRec.Code != 200 || !strings.Contains(assetRec.Body.String(), `console.log("purcarte")`) {
		t.Fatalf("probe-theme-assets status=%d body=%q", assetRec.Code, assetRec.Body.String())
	}

	// 4. Reject path traversal on ?theme=
	badRec := httptest.NewRecorder()
	router.ServeHTTP(badRec, httptest.NewRequest("GET", "/probe-theme/?theme=../secret", nil))
	if badRec.Code != 404 {
		t.Fatalf("traversal ?theme=../secret status = %d, want 404", badRec.Code)
	}
}
