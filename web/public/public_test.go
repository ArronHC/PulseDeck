package public

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

func TestPrepareDefaultDist(t *testing.T) {
	previous := defaultDistCacheDir
	defaultDistCacheDir = filepath.Join(t.TempDir(), "dist")
	t.Cleanup(func() { defaultDistCacheDir = previous })

	if err := PrepareDefaultDist(); err != nil {
		t.Fatalf("extract embedded frontend: %v", err)
	}
	content, _, err := readDistFile(IndexFile)
	if err != nil || len(content) == 0 {
		t.Fatalf("embedded dist does not contain a non-empty %q: %v", IndexFile, err)
	}
}

func TestStaticServesFrontend(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previous := defaultDistCacheDir
	defaultDistCacheDir = t.TempDir()
	t.Cleanup(func() { defaultDistCacheDir = previous })
	t.Chdir(t.TempDir())
	for name, content := range map[string]string{
		filepath.Join(defaultDistCacheDir, IndexFile): `<html lang="en"><head><title>PulseDeck</title><meta name="description" content="` +
			config.DefaultDescription + `"><script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script></head><body>App</body></html>`,
		filepath.Join(defaultDistCacheDir, faviconFile):        "embedded favicon",
		filepath.Join(defaultDistCacheDir, "assets", "app.js"): "embedded asset",
		filepath.Join("data", faviconFile):                     "custom favicon",
	} {
		if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open config database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	config.SetDb(db)
	if err := config.SetMany(map[string]any{
		config.ThemeKey:                 "legacy-theme",
		config.SitenameKey:              "My PulseDeck",
		config.DescriptionKey:           "My description",
		config.CustomHeadKey:            "<meta name='custom-head'>",
		config.CustomBodyKey:            "<div id='custom-body'></div>",
		"tempory_share_token":           "test-key",
		"tempory_share_token_expire_at": time.Now().Add(time.Hour).Unix(),
	}); err != nil {
		t.Fatalf("seed config: %v", err)
	}

	for _, restricted := range []bool{false, true} {
		name := "public"
		register := Static
		if restricted {
			name = "restricted"
			register = StaticRestricted
		}
		t.Run(name, func(t *testing.T) {
			router := gin.New()
			register(router.Group("/"), router.NoRoute)
			fetch := func(path string) *httptest.ResponseRecorder {
				t.Helper()
				req := httptest.NewRequest(http.MethodGet, path, nil)
				req.AddCookie(&http.Cookie{Name: LanguageCookieName, Value: "zh-CN"})
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				if rec.Code != http.StatusOK {
					t.Fatalf("GET %s = %d, want 200", path, rec.Code)
				}
				return rec
			}

			if asset := fetch("/assets/app.js").Body.String(); asset != "embedded asset" {
				t.Fatalf("unexpected frontend asset: %q", asset)
			}
			wantFavicon := "custom favicon"
			if restricted {
				wantFavicon = "embedded favicon"
			}
			if favicon := fetch("/favicon.ico").Body.String(); favicon != wantFavicon {
				t.Fatalf("favicon = %q, want %q", favicon, wantFavicon)
			}

			fallback := fetch("/servers?temp_key=test-key")
			body := fallback.Body.String()
			if !strings.Contains(body, `<html lang="zh-CN">`) {
				t.Fatal("SPA fallback ignored the language cookie")
			}
			for _, fragment := range []string{"My PulseDeck", "My description", "custom-head", "custom-body", "vite-plugin-pwa:register-sw"} {
				if strings.Contains(body, fragment) == restricted {
					t.Errorf("unexpected presence of %q in frontend HTML", fragment)
				}
			}
			cookies := fallback.Result().Cookies()
			if len(cookies) != 1 || cookies[0].Name != "temp_key" || cookies[0].Value != "test-key" || cookies[0].MaxAge <= 0 {
				t.Fatal("SPA fallback did not set a valid temp_key cookie")
			}

			admin := fetch("/admin/overview").Body.String()
			if strings.Contains(admin, "custom-head") || strings.Contains(admin, "custom-body") {
				t.Fatal("admin shell applied public HTML customizations")
			}
		})
	}
}
