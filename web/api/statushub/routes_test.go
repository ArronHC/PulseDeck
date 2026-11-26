package statushub

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/database/models"
	hub "github.com/komari-monitor/komari/internal/statushub"
	"github.com/komari-monitor/komari/web/api"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func hubRouter(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "hub.db")), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, conn.Close()) })
	require.NoError(t, db.AutoMigrate(
		&models.Client{}, &models.UptimeMonitor{}, &models.UptimeHeartbeat{}, &models.UptimeIncident{},
		&models.UptimeKumaSource{}, &models.SubSource{}, &models.SubNode{}, &models.SubSpeedSample{}, &models.IPPureSelfCache{},
	))
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if c.GetHeader("Authorization") == "Bearer test-admin" {
			c.Set("role", api.RoleAdmin)
		}
		c.Next()
	})
	Register(r.Group("/api"), r.Group("/api/admin", api.RequireRole(api.RoleAdmin)), hub.New(db))
	return r, db
}

func request(r *gin.Engine, method, path, body string, admin bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if admin {
		req.Header.Set("Authorization", "Bearer test-admin")
	}
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	return res
}

func dataFrom[T any](t *testing.T, res *httptest.ResponseRecorder) T {
	t.Helper()
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	var envelope struct {
		Status string `json:"status"`
		Data   T      `json:"data"`
	}
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &envelope))
	require.Equal(t, "success", envelope.Status)
	return envelope.Data
}

func TestPublicSubscriptionEndpointsMaskCredentials(t *testing.T) {
	r, db := hubRouter(t)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Query().Get("token") != "provider-secret" || req.URL.Path != "/path-secret" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Header().Set("Subscription-Userinfo", "upload=12; download=34; total=56; expire=123456")
		_, _ = io.WriteString(w, "vless://node-uuid@relay.example.org:443#Tokyo\nhttp://proxy-user:proxy-password@gate.example:8888#London\ntrojan://example-secret@198.51.100.84:443")
	}))
	defer provider.Close()

	secretURL := strings.Replace(provider.URL, "://", "://provider-user:provider-password@", 1) + "/path-secret?token=provider-secret#fragment-secret"
	body := fmt.Sprintf(`{"name":"Airport","url":%q,"auto_speed_hours":168,"auto_purity_hours":720,"expire_alert_days":365}`, secretURL)
	require.Equal(t, http.StatusUnauthorized, request(r, "POST", "/api/admin/subscriptions", body, false).Code)
	created := dataFrom[hub.Subscription](t, request(r, "POST", "/api/admin/subscriptions", body, true))
	require.Positive(t, created.ID)
	require.Equal(t, secretURL, created.URL)
	require.Equal(t, provider.URL+"/***?token=***", created.MaskedURL)
	require.Equal(t, 3, created.NodeCount)
	require.Equal(t, 168, created.AutoSpeedHours)
	require.Equal(t, 720, created.AutoPurityHours)
	require.Equal(t, 365, created.ExpireAlertDays)
	require.EqualValues(t, 12, created.Upload)
	admin := dataFrom[[]hub.Subscription](t, request(r, "GET", "/api/admin/subscriptions", "", true))
	require.Equal(t, secretURL, admin[0].URL)
	res := request(r, "GET", "/api/subscriptions/ippure-self", "", false)
	require.JSONEq(t, `{"status":"success","data":null}`, res.Body.String())
	var tokyo models.SubNode
	require.NoError(t, db.First(&tokyo, "name = ?", "Tokyo").Error)
	tokyo.IPPure = &models.IPPureResult{IP: "192.0.2.42"}
	require.NoError(t, db.Model(&tokyo).Select("IPPure").Updates(&tokyo).Error)
	self := models.IPPureSelfCache{ID: 1, Result: models.IPPureResult{IP: "2001:db8::42"}}
	require.NoError(t, db.Create(&self).Error)

	for _, path := range []string{"/api/subscriptions", "/api/subscriptions/nodes", "/api/subscriptions/map", "/api/overview"} {
		// Public routes always use sanitized views, including when called by an admin.
		for _, auth := range []bool{false, true} {
			res := request(r, "GET", path, "", auth)
			require.Equal(t, http.StatusOK, res.Code, path)
			for _, secret := range []string{"provider-secret", "provider-user", "provider-password", "path-secret", "fragment-secret", "node-uuid", "proxy-user", "proxy-password", "relay.example.org", "198.51.100.84", "192.0.2.42", `"raw_config":`, `"raw_content":`, `"url":`} {
				require.NotContains(t, res.Body.String(), secret, path)
			}
		}
	}
	query := fmt.Sprintf("?subscription_id=%d&country=jp&search=tok&only_enabled=true", created.ID)
	for _, auth := range []bool{false, true} {
		nodes := dataFrom[[]hub.Node](t, request(r, "GET", "/api/subscriptions/nodes"+query, "", auth))
		require.Len(t, nodes, 1)
		require.Equal(t, "***.example.org", nodes[0].Host)
		require.Equal(t, 443, nodes[0].Port)
		require.Equal(t, "vless", nodes[0].Protocol)
		require.Equal(t, "192.0.*.*", nodes[0].IPPure.IP)
		require.Empty(t, dataFrom[[]hub.Node](t, request(r, "GET", "/api/subscriptions/nodes?search=relay.example.org", "", auth)))
		purity := dataFrom[models.IPPureResult](t, request(r, "GET", "/api/subscriptions/ippure-self", "", auth))
		require.Equal(t, "2001:db8:*:*:*:*:*:*", purity.IP)
	}
	adminNodes := "/api/admin/subscriptions/nodes"
	adminSelf := "/api/admin/subscriptions/ippure-self"
	for _, path := range []string{adminNodes, adminSelf} {
		require.Equal(t, http.StatusUnauthorized, request(r, "GET", path, "", false).Code)
	}
	nodes := dataFrom[[]hub.Node](t, request(r, "GET", adminNodes+query, "", true))
	require.Len(t, nodes, 1)
	require.Equal(t, "relay.example.org", nodes[0].Host)
	require.Equal(t, "192.0.2.42", nodes[0].IPPure.IP)
	purity := dataFrom[models.IPPureResult](t, request(r, "GET", adminSelf, "", true))
	require.Equal(t, "2001:db8::42", purity.IP)
	patchPath := fmt.Sprintf("%s/%d", adminNodes, nodes[0].ID)
	patched := dataFrom[hub.Node](t, request(r, "PATCH", patchPath, `{"enabled":false,"country_code":"HK"}`, true))
	require.False(t, patched.Enabled)
	require.Equal(t, "HK", patched.CountryCode)
	require.Equal(t, "Airport", patched.SubscriptionName)
}

func TestAdminSubscriptionSpeedReportsAndCapabilities(t *testing.T) {
	r, db := hubRouter(t)
	path := t.TempDir()
	t.Setenv("PATH", path)
	const caps = "/api/admin/subscriptions/capabilities"
	require.Equal(t, http.StatusUnauthorized, request(r, "GET", caps, "", false).Code)
	capabilities := dataFrom[hub.ProxyCapabilities](t, request(r, "GET", caps, "", true))
	require.False(t, capabilities.HasProxyCore)
	require.NotNil(t, capabilities.ProxyCores)
	require.NoError(t, os.WriteFile(filepath.Join(path, "mihomo"), []byte("#!/bin/sh\n"), 0755))
	capabilities = dataFrom[hub.ProxyCapabilities](t, request(r, "GET", caps, "", true))
	require.True(t, capabilities.HasProxyCore)
	require.Equal(t, []string{"mihomo"}, capabilities.ProxyCores)

	source := models.SubSource{Name: "Relay"}
	require.NoError(t, db.Create(&source).Error)
	node := models.SubNode{SubscriptionID: source.ID, Name: "Tokyo"}
	require.NoError(t, db.Create(&node).Error)
	const report = "/api/admin/subscriptions/speed-results"
	body := fmt.Sprintf(`{"results":[{"node_id":%d,"test_status":"ok","latency_ms":20}]}`, node.ID)
	require.Equal(t, http.StatusUnauthorized, request(r, "POST", report, body, false).Code)
	nodes := dataFrom[[]hub.Node](t, request(r, "POST", report, body, true))
	require.Len(t, nodes, 1)
	require.Equal(t, "browser_http", nodes[0].TestMethod)
	require.Equal(t, "Relay", nodes[0].SubscriptionName)
	badBody := fmt.Sprintf(`{"results":[{"node_id":%d,"test_status":"ok","latency_ms":5,"test_method":"unknown"}]}`, node.ID)
	require.Equal(t, http.StatusBadRequest, request(r, "POST", report, badBody, true).Code)
	require.NoError(t, db.First(&node, node.ID).Error)
	require.Equal(t, int64(20), node.LatencyMS)
	require.Equal(t, "browser_http", node.TestMethod)
}

func TestUptimeAndOverviewHTTPContract(t *testing.T) {
	r, _ := hubRouter(t)
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	body := fmt.Sprintf(`{"name":"Website","type":"http","target":%q,"interval_sec":60,"timeout_sec":2}`, target.URL)
	create := "/api/admin/uptime/monitors"
	require.Equal(t, http.StatusUnauthorized, request(r, "POST", create, body, false).Code)
	m := dataFrom[hub.Monitor](t, request(r, "POST", create, body, true))
	require.True(t, m.Enabled)
	require.Equal(t, hub.Pending, m.Status)
	check := fmt.Sprintf("/api/admin/uptime/monitors/%d/check", m.ID)
	beat := dataFrom[models.UptimeHeartbeat](t, request(r, "POST", check, "{}", true))
	require.Equal(t, hub.Up, beat.Status)
	require.Equal(t, "200 OK", beat.Message)
	history := fmt.Sprintf("/api/uptime/monitors/%d/history?hours=24", m.ID)
	beats := dataFrom[[]models.UptimeHeartbeat](t, request(r, "GET", history, "", false))
	require.Len(t, beats, 1)
	u := dataFrom[hub.UptimeSummary](t, request(r, "GET", "/api/uptime/summary?hours=24", "", false))
	require.Equal(t, "operational", u.HealthStatus)
	require.Equal(t, 100.0, u.OverallUptime)
	require.Len(t, u.Monitors, 1)
	require.Equal(t, "local", u.Monitors[0].Source)
	o := dataFrom[hub.Overview](t, request(r, "GET", "/api/overview?hours=6", "", false))
	require.Equal(t, "operational", o.HealthStatus)
	require.Zero(t, o.ActiveAlerts)
	require.Equal(t, 100.0, o.Uptime.OverallUptime24h)
	require.Equal(t, []int{hub.Up}, o.Uptime.TopMonitors[0].RecentBeats)
	require.NotNil(t, o.RecentEvents)

	for _, path := range []string{"/api/overview?hours=99999", "/api/uptime/incidents?limit=-2", "/api/subscriptions/nodes?only_enabled=maybe", "/api/uptime/monitors/-1/history"} {
		res := request(r, "GET", path, "", false)
		require.Equal(t, http.StatusBadRequest, res.Code, path)
		require.Contains(t, res.Body.String(), `"status":"error"`)
	}
	require.Equal(t, http.StatusNotFound, request(r, "GET", "/api/uptime/monitors/9876/history", "", false).Code)
}
