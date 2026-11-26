package install

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/database/models"
	appconfig "github.com/komari-monitor/komari/internal/config"
	"github.com/komari-monitor/komari/internal/metricstore"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupInstallRouter(t *testing.T) (*gin.Engine, *gorm.DB, *Controller) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+filepath.ToSlash(filepath.Join(t.TempDir(), "install.db"))+"?mode=rwc"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open install database: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Session{}, &appconfig.ConfigItem{}); err != nil {
		t.Fatalf("migrate install database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get install sql database: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	appconfig.SetDb(db)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	controller := NewController(db)
	controller.Activate()
	controller.Register(r)
	return r, db, controller
}

func performJSON(r http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	encoded, _ := json.Marshal(body)
	request := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	r.ServeHTTP(response, request)
	return response
}

func TestInstallEndpointsAreUnavailableAfterDeactivate(t *testing.T) {
	r, _, controller := setupInstallRouter(t)
	if response := performJSON(r, http.MethodGet, APIPath+"/status", nil); response.Code != http.StatusOK {
		t.Fatalf("active status endpoint returned %d", response.Code)
	}
	controller.Deactivate()
	for _, endpoint := range []struct{ method, path string }{
		{http.MethodGet, "/status"},
		{http.MethodPost, "/test-db"},
		{http.MethodPost, "/complete"},
	} {
		response := performJSON(r, endpoint.method, APIPath+endpoint.path, nil)
		if response.Code != http.StatusNotFound {
			t.Errorf("%s %s returned %d, want 404", endpoint.method, endpoint.path, response.Code)
		}
	}
}

func TestInstallRejectsInvalidInputWithoutCreatingAccount(t *testing.T) {
	r, db, _ := setupInstallRouter(t)
	response := performJSON(r, http.MethodPost, APIPath+"/complete", completeRequest{
		Username: "admin", Password: "short", Sitename: "Komari",
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid install status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	var count int64
	if err := db.Model(&models.User{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("invalid install created users: count=%d err=%v", count, err)
	}
}

func TestInstallRejectsWeakPasswordWithoutCreatingAccount(t *testing.T) {
	r, db, _ := setupInstallRouter(t)
	response := performJSON(r, http.MethodPost, APIPath+"/complete", completeRequest{
		Username: "admin", Password: "lowercaseonly1", Sitename: "Komari", MetricDSN: "./data/metrics.db",
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("weak password status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	var count int64
	if err := db.Model(&models.User{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("weak password created users: count=%d err=%v", count, err)
	}
}

func TestInstallCompletesAndPersistsSettings(t *testing.T) {
	r, db, _ := setupInstallRouter(t)
	metricDSN := "file:" + filepath.ToSlash(filepath.Join(t.TempDir(), "metrics.db")) + "?mode=rwc"
	response := performJSON(r, http.MethodPost, "https://pulsedeck.test"+APIPath+"/complete", completeRequest{
		Username:    "owner",
		Password:    "Correct-horse-battery-staple1",
		Sitename:    "My Komari",
		Description: "Private monitoring",
		MetricDSN:   metricDSN,
		PrivateSite: true,
		Language:    "zh-CN",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("complete install status = %d: %s", response.Code, response.Body.String())
	}
	var user models.User
	if err := db.First(&user, "username = ?", "owner").Error; err != nil {
		t.Fatalf("find installed admin: %v", err)
	}
	want := map[string]any{
		appconfig.SitenameKey:         "My Komari",
		appconfig.DescriptionKey:      "Private monitoring",
		appconfig.EulaAcceptedKey:     true,
		appconfig.PrivateSiteKey:      true,
		metricstore.MetricDBDriverKey: "sqlite",
		metricstore.MetricDBDSNKey:    metricDSN,
	}
	got, err := appconfig.GetAll()
	if err != nil {
		t.Fatalf("read all install settings: %v", err)
	}
	for key, value := range want {
		if got[key] != value {
			t.Errorf("setting %s = %#v, want %#v", key, got[key], value)
		}
	}

	cookies := map[string]*http.Cookie{}
	for _, cookie := range response.Result().Cookies() {
		cookies[cookie.Name] = cookie
	}
	sessionCookie := cookies["session_token"]
	if sessionCookie == nil || sessionCookie.Value == "" || !sessionCookie.HttpOnly || !sessionCookie.Secure ||
		sessionCookie.SameSite != http.SameSiteLaxMode || sessionCookie.Path != "/" || sessionCookie.MaxAge != 2592000 {
		t.Fatalf("interactive completion sent an invalid session cookie: %#v", sessionCookie)
	}
	languageCookie := cookies["language"]
	if languageCookie == nil || languageCookie.Value != "zh-CN" || languageCookie.Path != "/" {
		t.Fatalf("interactive completion sent an invalid language cookie: %#v", languageCookie)
	}
	var session models.Session
	if err := db.First(&session, "session = ?", sessionCookie.Value).Error; err != nil {
		t.Fatalf("find installed admin session: %v", err)
	}
	if session.UUID != user.UUID || !session.Expires.After(time.Now()) {
		t.Fatalf("session is not active for the installed admin")
	}

	repeat := performJSON(r, http.MethodPost, APIPath+"/complete", completeRequest{
		Username: "other", Password: "Another-password1", Sitename: "Other", MetricDSN: "./data/metrics.db",
	})
	if repeat.Code != http.StatusConflict {
		t.Fatalf("repeat install status = %d, want %d", repeat.Code, http.StatusConflict)
	}
}

func TestInstallRollsBackWhenSessionCannotBeSaved(t *testing.T) {
	r, db, _ := setupInstallRouter(t)
	if err := db.Migrator().DropTable(&models.Session{}); err != nil {
		t.Fatalf("drop sessions table: %v", err)
	}
	body := map[string]string{
		"username": "owner", "password": "Strong-password1", "sitename": "PulseDeck",
		"metric_dsn": filepath.Join(t.TempDir(), "metrics.db"),
	}
	response := performJSON(r, http.MethodPost, APIPath+"/complete", body)
	if response.Code != http.StatusInternalServerError || len(response.Result().Cookies()) != 0 {
		t.Fatalf("complete with failed session = %d, want 500 with no cookies", response.Code)
	}
	var count int64
	if err := db.Model(&models.User{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("failed install left users: count=%d err=%v", count, err)
	}
	settings, err := appconfig.GetAll()
	if err != nil || len(settings) != 0 {
		t.Fatalf("failed install left settings: %v", err)
	}
	if err := db.AutoMigrate(&models.Session{}); err != nil {
		t.Fatalf("recreate sessions table: %v", err)
	}
	response = performJSON(r, http.MethodPost, APIPath+"/complete", body)
	if response.Code != http.StatusOK {
		t.Fatalf("retried completion = %d, want 200: %s", response.Code, response.Body.String())
	}
	private, err := appconfig.GetAs[bool](appconfig.PrivateSiteKey)
	if err != nil || private {
		t.Fatalf("private_site with omitted option = %t, %v", private, err)
	}
}

func TestInstallStatusDefaultsAndTestDB(t *testing.T) {
	r, db, controller := setupInstallRouter(t)
	response := performJSON(r, http.MethodGet, APIPath+"/status", nil)
	var status struct {
		Status string `json:"status"`
		Data   Status `json:"data"`
	}
	want := Status{
		State: "ready", Required: true, DefaultSitename: "PulseDeck",
		DefaultDescription: "All-in-one self-hosted server probe, uptime, and node observability deck.",
		DefaultMetricDSN:   "./data/metrics.db",
	}
	if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil || status.Status != "success" || status.Data != want || response.Code != http.StatusOK {
		t.Fatalf("install status = %d %s", response.Code, response.Body.String())
	}

	metricDSN := filepath.Join(t.TempDir(), "metrics.db")
	response = performJSON(r, http.MethodPost, APIPath+"/test-db", map[string]string{"metric_dsn": metricDSN})
	var result struct {
		Status string `json:"status"`
		Data   struct {
			OK      bool   `json:"ok"`
			Driver  string `json:"driver"`
			Message string `json:"message"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Status != "success" ||
		!result.Data.OK || result.Data.Driver != "sqlite" || result.Data.Message != "Connection succeeded" || response.Code != http.StatusOK {
		t.Fatalf("valid test-db = %d %s", response.Code, response.Body.String())
	}
	for _, invalidDSN := range []string{"", "invalid-dsn", "file:" + filepath.Join(t.TempDir(), "missing.db") + "?mode=ro"} {
		response = performJSON(r, http.MethodPost, APIPath+"/test-db", map[string]string{"metric_dsn": invalidDSN})
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"status":"error"`) {
			t.Fatalf("test-db with DSN %q = %d %s, want 400", invalidDSN, response.Code, response.Body.String())
		}
	}
	var users int64
	if err := db.Model(&models.User{}).Count(&users).Error; err != nil || users != 0 {
		t.Fatalf("connection test created users: count=%d err=%v", users, err)
	}
	if settings, err := appconfig.GetAll(); err != nil || len(settings) != 0 {
		t.Fatalf("connection test persisted settings: %v", err)
	}

	controller.Deactivate()
	response = performJSON(r, http.MethodPost, APIPath+"/test-db", map[string]string{"metric_dsn": metricDSN})
	if response.Code != http.StatusNotFound {
		t.Fatalf("inactive test-db = %d, want 404", response.Code)
	}
}

func TestInstallRejectsUnknownDSN(t *testing.T) {
	r, db, _ := setupInstallRouter(t)
	response := performJSON(r, http.MethodPost, APIPath+"/complete", completeRequest{
		Username: "admin", Password: "Strong-password1", Sitename: "Komari",
		MetricDSN: "not-a-recognized-dsn",
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unknown DSN status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	var count int64
	if err := db.Model(&models.User{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("failed DSN created users: count=%d err=%v", count, err)
	}
}

func TestCompleteFromEnvSkipsWhenUnset(t *testing.T) {
	_, db, _ := setupInstallRouter(t)
	t.Setenv(EnvAdminUser, "")
	t.Setenv(EnvAdminPass, "")
	done, err := CompleteFromEnv(context.Background(), db)
	if err != nil || done {
		t.Fatalf("CompleteFromEnv(unset) = (%v, %v), want (false, nil)", done, err)
	}
}

func TestCompleteFromEnvRejectsPartialAndWeakCredentials(t *testing.T) {
	_, db, _ := setupInstallRouter(t)
	t.Setenv(EnvAdminUser, "admin")
	t.Setenv(EnvAdminPass, "")
	if done, err := CompleteFromEnv(context.Background(), db); err == nil || done {
		t.Fatalf("CompleteFromEnv(partial) = (%v, %v), want error", done, err)
	}

	t.Setenv(EnvAdminPass, "weakpass")
	if done, err := CompleteFromEnv(context.Background(), db); err == nil || done {
		t.Fatalf("CompleteFromEnv(weak) = (%v, %v), want error", done, err)
	}
}

func TestCompleteFromEnvSucceedsWithDefaults(t *testing.T) {
	_, db, _ := setupInstallRouter(t)
	metricDSN := filepath.ToSlash(filepath.Join(t.TempDir(), "metrics.db"))
	t.Setenv(EnvAdminUser, "opsadmin")
	t.Setenv(EnvAdminPass, "StrongPass123!")
	t.Setenv(EnvSiteName, "")
	t.Setenv(EnvDescription, "")
	t.Setenv(EnvMetricDSN, metricDSN)
	t.Setenv(EnvPrivateSite, "")

	done, err := CompleteFromEnv(context.Background(), db)
	if err != nil || !done {
		t.Fatalf("CompleteFromEnv(valid) = (%v, %v), want (true, nil)", done, err)
	}

	var user models.User
	if err := db.First(&user, "username = ?", "opsadmin").Error; err != nil {
		t.Fatalf("find headless admin: %v", err)
	}
	got, err := appconfig.GetAll()
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	if got[appconfig.SitenameKey] != "PulseDeck" {
		t.Errorf("sitename = %#v, want PulseDeck", got[appconfig.SitenameKey])
	}
	if got[metricstore.MetricDBDSNKey] != metricDSN {
		t.Errorf("metric_dsn = %#v, want %q", got[metricstore.MetricDBDSNKey], metricDSN)
	}
	if got[appconfig.EulaAcceptedKey] != true || got[appconfig.PrivateSiteKey] != false {
		t.Fatalf("headless install acceptance or visibility settings have incorrect defaults")
	}
}

func TestCompleteFromEnvCanEnablePrivateSite(t *testing.T) {
	_, db, _ := setupInstallRouter(t)
	t.Setenv(EnvAdminUser, "opsadmin")
	t.Setenv(EnvAdminPass, "StrongPass123!")
	t.Setenv(EnvMetricDSN, filepath.Join(t.TempDir(), "metrics.db"))
	t.Setenv(EnvPrivateSite, "true")
	if done, err := CompleteFromEnv(context.Background(), db); err != nil || !done {
		t.Fatalf("CompleteFromEnv(private) = (%v, %v), want (true, nil)", done, err)
	}
	private, err := appconfig.GetAs[bool](appconfig.PrivateSiteKey)
	if err != nil || !private {
		t.Fatalf("private_site from environment = %t, %v", private, err)
	}
}
