package statushub

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/komari-monitor/komari/database/models"
	messageevent "github.com/komari-monitor/komari/database/models/messageEvent"
	"github.com/komari-monitor/komari/internal/config"
	"github.com/komari-monitor/komari/internal/metricstore"
	"github.com/komari-monitor/komari/pkg/metric"
	v2 "github.com/komari-monitor/komari/protocol/v2"
	agent "github.com/komari-monitor/komari/web/agent"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func testHub(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "hub.db")), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, conn.Close()) })
	require.NoError(t, db.AutoMigrate(
		&models.UptimeMonitor{}, &models.UptimeHeartbeat{}, &models.UptimeIncident{}, &models.UptimeKumaSource{},
		&models.SubSource{}, &models.SubNode{}, &models.SubSpeedSample{}, &models.IPPureSelfCache{}, &models.Client{}, &models.Log{},
	))
	return New(db)
}

func ptr[T any](value T) *T { return &value }

func encoded(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }

func TestSubscriptionParsers(t *testing.T) {
	ss := "ss://" + encoded("aes-128-gcm:password") + "@ss.example:8388#UK"
	oldSS := "ss://" + encoded("aes-128-gcm:password@old.example:8388") + "#US"
	ssr := "ssr://" + encoded("ssr.example:443:origin:aes-256-cfb:plain:"+encoded("password")+"/?remarks="+encoded("德国"))
	vmess := "vmess://" + encoded(`{"ps":"东京01","add":"jp.example","port":"443","id":"uuid"}`)
	list := strings.Join([]string{
		vmess, "vless://uuid@[2001:db8::1]:443#US", "trojan://private@tr.example:443#CH", ss, oldSS, ssr,
		"hy2://private@hy.example:443#JP", "hysteria2://private@hy2.example:8443#FR",
		"tuic://uuid:password@tu.example:443#CA", "socks5://user:password@so.example#SG",
		"http://user:password@http.example#DE", "https://user:password@https.example#SG",
		"direct://ignored", vmess,
	}, "\n")
	tests := []struct {
		name, body string
		protocols  []string
	}{
		{"plain", list, []string{"vmess", "vless", "trojan", "ss", "ss", "ssr", "hysteria2", "hysteria2", "tuic", "socks5", "http", "http"}},
		{"base64", "\ufeff" + encoded(list), []string{"vmess", "vless", "trojan", "ss", "ss", "ssr", "hysteria2", "hysteria2", "tuic", "socks5", "http", "http"}},
		{"Clash", "proxies:\n  - {name: Frankfurt, type: ss, server: de.example, port: 123, cipher: aes-128-gcm, password: secret}\n  - {name: Socks, type: socks5, server: 127.0.0.1, port: 1080}\n", []string{"ss", "socks5"}},
		{"Sing-box", `{"outbounds":[{"tag":"London","type":"shadowsocks","server":"uk.example","server_port":1080,"password":"secret"},{"tag":"direct","type":"direct"}]}`, []string{"ss"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			nodes, err := parseSubscription(tc.body)
			require.NoError(t, err)
			require.Len(t, nodes, len(tc.protocols))
			for i, n := range nodes {
				require.Equal(t, tc.protocols[i], n.Protocol)
				require.True(t, n.Enabled)
				require.NotEmpty(t, n.Fingerprint)
			}
			if tc.name == "plain" {
				require.Equal(t, "2001:db8::1", nodes[1].Host)
				require.Equal(t, 1080, nodes[9].Port)
				require.Equal(t, 80, nodes[10].Port)
				require.Equal(t, 443, nodes[11].Port)
			}
		})
	}
	_, err := parseSubscription("this is not a subscription")
	require.ErrorIs(t, err, InputError("subscription has no supported proxy nodes"))
	require.Equal(t, usage{12, 23, 450000000000, 1798761600}, parseUserinfo(
		"upload=12; download=23; total = 450000000000; expire=1798761600; unknown=1; download=-4",
	))
}

func TestRegionDetection(t *testing.T) {
	tests := []struct{ input, code, city string }{
		{"🇯🇵 日本 东京", "JP", "Tokyo"}, {"🇯🇵 日本 大阪 IEPL", "JP", "Osaka"},
		{"🇺🇸 美国 洛杉矶", "US", "Los Angeles"}, {"美国 圣何塞", "US", "San Jose"},
		{"硅谷", "US", "San Jose"}, {"西雅图 US1", "US", "Seattle"}, {"New York 5", "US", "New York"},
		{"🇭🇰", "HK", "Hong Kong"}, {"狮城 03", "SG", "Singapore"}, {"台湾 台北", "TW", "Taipei"},
		{"DE01", "DE", "Frankfurt"}, {"德国 法兰克福", "DE", "Frankfurt"}, {"🇬🇧", "GB", "London"},
		{"韩国 首尔", "KR", "Seoul"}, {"阿姆斯特丹", "NL", "Amsterdam"}, {"巴黎", "FR", "Paris"},
		{"加拿大 多伦多", "CA", "Toronto"}, {"澳大利亚 悉尼", "AU", "Sydney"},
		{"🇹🇷 土耳其", "TR", "Istanbul"}, {"印度", "IN", "Mumbai"}, {"印度尼西亚", "ID", "Jakarta"},
		{"俄罗斯", "RU", "Moscow"}, {"越南", "VN", "Ho Chi Minh City"}, {"泰国", "TH", "Bangkok"},
		{"马来西亚", "MY", "Kuala Lumpur"}, {"菲律宾", "PH", "Manila"},
		{"阿根廷", "AR", "Buenos Aires"}, {"巴西", "BR", "São Paulo"},
		{"瑞士", "CH", "Zurich"}, {"瑞典", "SE", "Stockholm"}, {"意大利", "IT", "Milan"},
		{"西班牙", "ES", "Madrid"}, {"Special offer", "", ""},
	}
	for _, tc := range tests {
		got := resolveGeo(tc.input)
		require.Equal(t, tc.code, got.code, tc.input)
		require.Equal(t, tc.city, got.city, tc.input)
		if tc.code != "" {
			require.True(t, got.located, tc.input)
			require.True(t, validCoordinate(got.lat, 90) && validCoordinate(got.lng, 180), tc.input)
			require.NotEmpty(t, got.country, tc.input)
		}
	}
}

func TestSubscriptionRefreshPreservesOverrides(t *testing.T) {
	s := testHub(t)
	ctx := t.Context()
	first := "vless://first-secret@host.example:443#Tokyo"
	second := "vless://changed-secret@host.example:443#Tokyo\nss://" + encoded("aes-128-gcm:pwd") + "@new.example:443#London"
	var content atomic.Value
	content.Store(first)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "private-token", r.URL.Query().Get("token"))
		w.Header().Set("Subscription-Userinfo", "upload=100; download=200; total=3000; expire=1798761600")
		_, _ = io.WriteString(w, content.Load().(string))
	}))
	defer provider.Close()
	source, err := s.SaveSubscription(ctx, 0, SubscriptionInput{Name: ptr("Airport"), URL: ptr(provider.URL + "/api/v1/client/subscribe?token=private-token")})
	require.NoError(t, err)
	require.Equal(t, int64(1798761600), source.Expire)
	nodes, err := s.Nodes(ctx, NodeFilter{}, false)
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	nodeID := nodes[0].ID
	updated, err := s.PatchNode(ctx, nodeID, NodePatch{Enabled: ptr(false), CountryCode: ptr("DE"), City: ptr("Berlin"), Lat: ptr(52.1), Lng: ptr(0.0)})
	require.NoError(t, err)
	require.Equal(t, "Airport", updated.SubscriptionName)
	content.Store(second)
	_, err = s.RefreshSubscription(ctx, source.ID, true)
	require.NoError(t, err)
	nodes, err = s.Nodes(ctx, NodeFilter{SubscriptionID: source.ID, Country: "de", Search: "AIRPORT"}, false)
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	require.Equal(t, nodeID, nodes[0].ID)
	require.False(t, nodes[0].Enabled)
	require.Equal(t, "Berlin", nodes[0].City)
	require.Equal(t, 52.1, nodes[0].Lat)
	require.Zero(t, nodes[0].Lng)
	nodes, err = s.Nodes(ctx, NodeFilter{OnlyEnabled: true}, false)
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	require.Equal(t, "London", nodes[0].Name)
	public, err := s.Subscriptions(ctx, false)
	require.NoError(t, err)
	require.Equal(t, provider.URL+"/api/v1/client/subscribe?token=***", public[0].MaskedURL)
	require.Empty(t, public[0].URL)

	content.Store("invalid response")
	_, err = s.RefreshSubscription(ctx, source.ID, true)
	require.Error(t, err)
	public, err = s.Subscriptions(ctx, false)
	require.NoError(t, err)
	require.NotEmpty(t, public[0].LastError)
	require.Equal(t, 2, public[0].NodeCount, "failed refresh keeps the last good snapshot")
}

const purityPayload = `{"ip":"189.24.110.250","asn":979,"asOrganization":"NetLab Global","country":"Germany","countryCode":"de","region":"Hesse","regionCode":"HE","city":"Frankfurt am Main","timezone":"Europe/Berlin","longitude":"8.6299","latitude":50.1025,"postalCode":"60311","fraudScore":22,"isResidential":true,"isBroadcast":true}`

func TestIPPureParsingAndRedirects(t *testing.T) {
	value, err := parseIPPure(strings.NewReader(purityPayload))
	require.NoError(t, err)
	require.Equal(t, "DE", value.CountryCode)
	require.Equal(t, "NetLab Global", value.ASOrganization)
	require.Equal(t, "HE", value.RegionCode)
	require.Equal(t, "Europe/Berlin", value.Timezone)
	require.Equal(t, "60311", value.PostalCode)
	require.EqualValues(t, 979, value.ASN)
	require.Equal(t, 8.6299, *value.Longitude)
	require.Equal(t, 50.1025, *value.Latitude)
	require.True(t, value.IsResidential && value.IsBroadcast)
	invalid, err := parseIPPure(strings.NewReader(`{"ip":"127.0.0.1","latitude":"NaN","longitude":"99f","fraudScore":-1}`))
	require.NoError(t, err)
	require.Nil(t, invalid.Latitude)
	require.Nil(t, invalid.Longitude)
	require.Nil(t, invalid.FraudScore)

	s := testHub(t)
	ctx := t.Context()
	self, err := s.IPPureSelf(ctx, true)
	require.NoError(t, err)
	require.Nil(t, self)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/info" {
			http.Redirect(w, r, "/result", http.StatusFound)
			return
		}
		_, _ = io.WriteString(w, purityPayload)
	}))
	defer backend.Close()
	s.purityURL = backend.URL + "/v1/info"
	direct, err := s.CheckIPPure(ctx, "")
	require.NoError(t, err)
	require.Equal(t, value.IP, direct.IP)
	cached, err := s.IPPureSelf(ctx, true)
	require.NoError(t, err)
	require.Equal(t, direct.IP, cached.IP)
	require.True(t, direct.CheckedAt.Equal(*cached.CheckedAt))

	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Proxy-Authorization") != "Basic dXNlcjpwYXNz" {
			w.WriteHeader(http.StatusProxyAuthRequired)
			return
		}
		if r.URL.Path == "/speed" {
			_, _ = io.WriteString(w, strings.Repeat("x", 4000))
			return
		}
		_, _ = io.WriteString(w, purityPayload)
	}))
	defer proxy.Close()
	authProxy := strings.Replace(proxy.URL, "://", "://user:pass@", 1)
	s.purityURL = "http://ippure.invalid/v1/info"
	_, err = s.CheckIPPure(ctx, authProxy)
	require.NoError(t, err)
	source, err := s.SaveSubscription(ctx, 0, SubscriptionInput{Name: ptr("Proxy"), RawContent: ptr(authProxy + "#Tokyo")})
	require.NoError(t, err)
	nodes, err := s.CheckNodePurity(ctx, TestFilter{SubscriptionID: source.ID})
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	require.Equal(t, "Frankfurt am Main", nodes[0].City)
	require.Equal(t, "DE", nodes[0].CountryCode)
	require.Equal(t, 8.6299, nodes[0].Lng)
	require.Equal(t, 50.1025, nodes[0].Lat)
	require.Equal(t, 22, *nodes[0].IPPure.FraudScore)
	s.testURL, s.downloadURL = "http://test.invalid/speed", "http://test.invalid/speed"
	for _, test := range []struct{ mode, method string }{{"tcp", "tcp"}, {"http", "proxy_http"}, {"download", "proxy_download"}} {
		results, err := s.CheckSpeed(ctx, SpeedInput{TestFilter: TestFilter{SubscriptionID: source.ID}, Mode: test.mode, Concurrency: 2})
		require.NoError(t, err)
		require.Len(t, results, 1)
		require.Equal(t, "ok", results[0].TestStatus)
		require.Positive(t, results[0].LatencyMS)
		require.Equal(t, test.method, results[0].TestMethod)
		if test.mode == "download" {
			require.Positive(t, results[0].DownloadMbps)
		}
	}
}

func TestCoreFallbackAndURIConversion(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	s := testHub(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	raw := "vless://plain-secret@" + listener.Addr().String() + "?security=tls&type=ws&path=%2Fws#Tokyo"
	node := parseURI(raw)
	require.Equal(t, map[string]any{"path": "/ws"}, coreOutbound(*node, "mihomo")["ws-opts"])
	require.Equal(t, map[string]any{"type": "ws", "path": "/ws"}, coreOutbound(*node, "sing-box")["transport"])
	require.NotContains(t, coreOutbound(*parseURI("trojan://password@example.org:443#Test"), "sing-box"), "uuid")
	source, err := s.SaveSubscription(t.Context(), 0, SubscriptionInput{Name: ptr("Airport"), RawContent: &raw})
	require.NoError(t, err)
	selected := TestFilter{SubscriptionID: source.ID}
	nodes, err := s.CheckSpeed(t.Context(), SpeedInput{TestFilter: selected, Mode: "http"})
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	require.Equal(t, "ok", nodes[0].TestStatus)
	require.Contains(t, nodes[0].TestMessage, "TCP fallback")
	require.Equal(t, "tcp_fallback", nodes[0].TestMethod)
	nodes, err = s.CheckNodePurity(t.Context(), selected)
	require.NoError(t, err)
	require.Contains(t, nodes[0].IPPureError, "install mihomo or sing-box")
	require.NotContains(t, nodes[0].IPPureError, "plain-secret")
}

func TestScheduledSubscriptionChecks(t *testing.T) {
	s := testHub(t)
	ctx := t.Context()
	now := time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/purity" {
			_, _ = io.WriteString(w, purityPayload)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(target.Close)
	s.testURL, s.purityURL = "http://test.invalid/speed", "http://test.invalid/purity"
	source, err := s.SaveSubscription(ctx, 0, SubscriptionInput{
		Name: ptr("Scheduled"), RawContent: ptr(target.URL + "#Tokyo"), AutoSpeedHours: ptr(1), AutoPurityHours: ptr(2),
	})
	require.NoError(t, err)
	for _, input := range []SubscriptionInput{{AutoSpeedHours: ptr(-1)}, {AutoSpeedHours: ptr(169)}, {AutoPurityHours: ptr(721)}, {ExpireAlertDays: ptr(366)}} {
		_, err := s.SaveSubscription(ctx, source.ID, input)
		require.ErrorAs(t, err, new(InputError))
	}
	disabled := models.SubSource{Name: "Disabled", AutoSpeedHours: 1, AutoPurityHours: 1}
	require.NoError(t, s.db.Create(&disabled).Error)

	for _, selectJobs := range []func(context.Context) ([]scheduledJob, error){s.autoSpeedJobs, s.autoPurityJobs} {
		jobs, err := selectJobs(ctx)
		require.NoError(t, err)
		require.Len(t, jobs, 1)
		require.Equal(t, source.ID, jobs[0].id)
		require.NoError(t, jobs[0].run(ctx))
		require.NoError(t, jobs[0].run(ctx), "a stale job cannot claim the same interval twice")
		jobs, err = selectJobs(ctx)
		require.NoError(t, err)
		require.Empty(t, jobs)
	}
	nodes, err := s.Nodes(ctx, NodeFilter{SubscriptionID: source.ID}, true)
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	require.Equal(t, "proxy_http", nodes[0].TestMethod)
	require.Equal(t, 22, *nodes[0].IPPure.FraudScore)
	var samples int64
	require.NoError(t, s.db.Model(&models.SubSpeedSample{}).Count(&samples).Error)
	require.EqualValues(t, 1, samples)
	require.NoError(t, s.db.First(&source, source.ID).Error)
	for _, stamp := range []*time.Time{source.LastSpeedAttemptAt, source.LastSpeedTestAt, source.LastPurityAttemptAt, source.LastPurityCheckAt} {
		require.NotNil(t, stamp)
		require.True(t, now.Equal(*stamp))
	}
	now = now.Add(time.Hour)
	speed, err := s.autoSpeedJobs(ctx)
	require.NoError(t, err)
	require.Len(t, speed, 1)
	purity, err := s.autoPurityJobs(ctx)
	require.NoError(t, err)
	require.Empty(t, purity)
}

func TestSubscriptionExpiryAndPurityAlertCooldowns(t *testing.T) {
	s := testHub(t)
	ctx := t.Context()
	now := time.Date(2026, 1, 5, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	events := make(chan models.EventMessage, 10)
	s.notify = func(event models.EventMessage) { events <- event }
	var score atomic.Int64
	score.Store(43)
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, `{"ip":"192.0.2.5","fraudScore":%d,"isResidential":true}`, score.Load())
	}))
	t.Cleanup(target.Close)
	s.purityURL = "http://test.invalid/purity"
	source, err := s.SaveSubscription(ctx, 0, SubscriptionInput{
		Name: ptr("Relay"), RawContent: ptr(target.URL + "#Tokyo"), ExpireAlertDays: ptr(2),
	})
	require.NoError(t, err)
	require.NoError(t, s.db.Model(&source).Update("expire", now.Add(48*time.Hour).Unix()).Error)
	job, err := s.subscriptionAlertJobs(ctx)
	require.NoError(t, err)
	require.Len(t, job, 1)
	require.NoError(t, job[0].run(ctx))
	require.NoError(t, job[0].run(ctx))
	require.Len(t, events, 1)
	require.Equal(t, messageevent.Expire, (<-events).Event)

	checkPurity := func(newScore int64) uint {
		t.Helper()
		score.Store(newScore)
		nodes, err := s.CheckNodePurity(ctx, TestFilter{SubscriptionID: source.ID})
		require.NoError(t, err)
		require.Len(t, nodes, 1)
		require.EqualValues(t, newScore, *nodes[0].IPPure.FraudScore)
		return nodes[0].ID
	}
	nodeID := checkPurity(43)
	require.Empty(t, events)
	checkPurity(75)
	require.Len(t, events, 1)
	require.Equal(t, messageevent.Alert, (<-events).Event)
	var node models.SubNode
	require.NoError(t, s.db.First(&node, nodeID).Error)
	require.NotNil(t, node.PurityAlertedAt)
	require.True(t, now.Equal(*node.PurityAlertedAt))
	now = now.Add(5 * time.Hour)
	checkPurity(43)
	checkPurity(75)
	require.Empty(t, events)
	now = now.Add(time.Hour)
	checkPurity(43)
	checkPurity(75)
	require.Len(t, events, 1)
	require.Equal(t, messageevent.Alert, (<-events).Event)
	job, err = s.subscriptionAlertJobs(ctx)
	require.NoError(t, err)
	require.Empty(t, job)
	now = now.Add(18 * time.Hour)
	job, err = s.subscriptionAlertJobs(ctx)
	require.NoError(t, err)
	require.Len(t, job, 1)
	require.NoError(t, job[0].run(ctx))
	require.Len(t, events, 1)
	require.Equal(t, messageevent.Expire, (<-events).Event)
	var warnings int64
	require.NoError(t, s.db.Model(&models.Log{}).Where("msg_type = ?", "warn").Count(&warnings).Error)
	require.EqualValues(t, 4, warnings)
}

func TestSeedDemoIfEmpty(t *testing.T) {
	for _, existing := range []any{
		&models.Client{UUID: "existing", Token: "registered"},
		&models.UptimeMonitor{Name: "Existing"},
		&models.SubSource{Name: "Existing"},
	} {
		t.Run(fmt.Sprintf("%T", existing), func(t *testing.T) {
			s := testHub(t)
			require.NoError(t, s.db.Create(existing).Error)
			require.NoError(t, SeedDemoIfEmpty(t.Context(), s.db))
			var count int64
			require.NoError(t, s.db.Model(&models.SubNode{}).Count(&count).Error)
			require.Zero(t, count)
		})
	}
	s := testHub(t)
	ctx := t.Context()
	require.NoError(t, SeedDemoIfEmpty(ctx, s.db))
	require.NoError(t, SeedDemoIfEmpty(ctx, s.db))
	sources, err := s.Subscriptions(ctx, true)
	require.NoError(t, err)
	require.Len(t, sources, 1)
	require.Equal(t, "https://demo.example.com/subscribe", sources[0].URL)
	require.Equal(t, 12, sources[0].AvailableCount)
	data, err := s.SubscriptionMap(ctx)
	require.NoError(t, err)
	require.Len(t, data.Countries, 6)
	require.Len(t, data.Markers, 12)
	uptime, err := s.Uptime(ctx, 24*time.Hour, false)
	require.NoError(t, err)
	require.Equal(t, 3, uptime.Total)
	require.Equal(t, 3, uptime.Paused)
	require.Len(t, uptime.Monitors[0].Heartbeats, 36)
	var clients []models.Client
	require.NoError(t, s.db.Find(&clients).Error)
	require.Len(t, clients, 4)
	for _, client := range clients {
		require.True(t, strings.HasPrefix(client.IPv4, "198.51.100."))
		require.NotEmpty(t, client.Token)
	}

	stopDemo := StartDemoProbes(s.db)
	defer func() {
		require.NoError(t, stopDemo(ctx))
	}()
	overview, err := s.Overview(ctx, 24*time.Hour, false)
	require.NoError(t, err)
	require.Equal(t, 4, overview.Probes.Total)
	require.Equal(t, 4, overview.Probes.Online)
	require.Zero(t, overview.Probes.Offline)
	require.Equal(t, "operational", overview.HealthStatus)
}

func TestUptimeCheckAndIncidentLifecycle(t *testing.T) {
	s := testHub(t)
	now := time.Now().UTC().Truncate(time.Second)
	s.now = func() time.Time { return now }
	ctx := t.Context()
	var status atomic.Int32
	status.Store(http.StatusFound)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "/would-fail")
		w.WriteHeader(int(status.Load()))
		_, _ = io.WriteString(w, "service ready")
	}))
	defer server.Close()
	m, err := s.SaveMonitor(ctx, 0, MonitorInput{
		Name: ptr("App"), Target: ptr(server.URL), Type: ptr("http"), TimeoutSec: ptr(2),
	})
	require.NoError(t, err)
	require.NotZero(t, m.ID)
	check := func(want int) {
		b, err := s.CheckMonitor(ctx, m.ID, true)
		require.NoError(t, err)
		require.Equal(t, want, b.Status)
	}
	check(Up)
	status.Store(http.StatusServiceUnavailable)
	now = now.Add(time.Minute)
	check(Down)
	now = now.Add(time.Minute)
	check(Down)
	incidents, err := s.Incidents(ctx, 30)
	require.NoError(t, err)
	require.Len(t, incidents, 1)
	require.Equal(t, "down", incidents[0].Status)
	require.EqualValues(t, 60, incidents[0].DurationSec)

	now = now.Add(time.Minute)
	status.Store(http.StatusOK)
	_, err = s.SaveMonitor(ctx, m.ID, MonitorInput{Type: ptr("keyword"), Keyword: ptr("service ready")})
	require.NoError(t, err)
	check(Up)
	incidents, err = s.Incidents(ctx, 30)
	require.NoError(t, err)
	require.Len(t, incidents, 1)
	require.Equal(t, "resolved", incidents[0].Status)
	require.EqualValues(t, 120, incidents[0].DurationSec)
	require.Equal(t, "keyword found", incidents[0].Recovery)
	summary, err := s.Uptime(ctx, 24*time.Hour, false)
	require.NoError(t, err)
	require.Equal(t, 1, summary.Up)
	require.Equal(t, 50.0, summary.OverallUptime)
	require.Equal(t, 50.0, summary.Monitors[0].Uptime30d)
	history, err := s.MonitorHistory(ctx, m.ID, time.Hour)
	require.NoError(t, err)
	require.Len(t, history, 4)
	require.True(t, history[0].CheckedAt.Before(history[3].CheckedAt))

	host := strings.TrimPrefix(server.URL, "http://")
	for _, protocol := range []string{"tcp", "ping", "keyword"} {
		test := models.UptimeMonitor{Target: host, Type: protocol, TimeoutSec: 2}
		want := Up
		if protocol == "keyword" {
			test.Target, test.Keyword, want = server.URL, "missing", Down
		}
		status, _ := s.check(ctx, test)
		require.Equal(t, want, status, protocol)
	}
	require.NoError(t, s.DeleteMonitor(ctx, m.ID))
	incidents, err = s.Incidents(ctx, 30)
	require.NoError(t, err)
	require.Empty(t, incidents)
}

func TestKumaSyncCachesHistoryAndStableIDs(t *testing.T) {
	s := testHub(t)
	now := time.Now().UTC().Truncate(time.Second)
	s.now = func() time.Time { return now }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/kuma/api/status-page/public":
			_, _ = io.WriteString(w, `{"publicGroupList":[{"name":"Services","monitorList":[{"id":7,"name":"Blog"}]}]}`)
		case "/kuma/api/status-page/heartbeat/public":
			_, _ = fmt.Fprintf(w, `{"heartbeatList":{"7":[{"status":0,"time":%q,"ping":null},{"status":1,"time":%q,"ping":42}]},"uptimeList":{"7_24":0.999,"7_720":0.96}}`,
				now.Add(-time.Minute).Format("2006-01-02 15:04:05.000"), now.Format(time.RFC3339))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	ctx := t.Context()
	source, err := s.CreateKumaSource(ctx, KumaInput{Name: "Kuma", BaseURL: server.URL + "/kuma/", Slug: "public"})
	require.NoError(t, err)
	for range 2 {
		_, err = s.SyncKuma(ctx, source.ID, true)
		require.NoError(t, err)
	}
	summary, err := s.Uptime(ctx, 24*time.Hour, false)
	require.NoError(t, err)
	require.Equal(t, 1, summary.Total)
	m := summary.Monitors[0]
	require.Equal(t, "kuma", m.Source)
	require.Equal(t, "Services", m.Group)
	require.Equal(t, 99.9, m.Uptime24h)
	require.Equal(t, 96.0, m.Uptime30d)
	require.EqualValues(t, 42, m.LastLatencyMS)
	history, err := s.MonitorHistory(ctx, m.ID, time.Hour)
	require.NoError(t, err)
	require.Len(t, history, 2)
	incidents, err := s.Incidents(ctx, 30)
	require.NoError(t, err)
	require.Len(t, incidents, 1)
	require.Equal(t, "resolved", incidents[0].Status)
	require.NoError(t, s.DeleteKumaSource(ctx, source.ID))
	summary, err = s.Uptime(ctx, time.Hour, false)
	require.NoError(t, err)
	require.Empty(t, summary.Monitors)
}

func TestSchedulerShutdownCancelsInFlightCheck(t *testing.T) {
	s := testHub(t)
	started, canceled := make(chan struct{}), make(chan struct{})
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(canceled)
	}))
	defer target.Close()
	m, err := s.SaveMonitor(t.Context(), 0, MonitorInput{Name: ptr("Slow"), Type: ptr("http"), Target: ptr(target.URL), TimeoutSec: ptr(30)})
	require.NoError(t, err)
	expired := models.UptimeHeartbeat{MonitorID: m.ID, CheckedAt: time.Now().UTC().Add(-31 * 24 * time.Hour)}
	require.NoError(t, s.db.Create(&expired).Error)
	stop := s.Start()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		require.NoError(t, stop(ctx))
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("scheduler did not start the check")
	}
	require.Eventually(t, func() bool {
		var count int64
		return s.db.Model(&models.UptimeHeartbeat{}).Where("id = ?", expired.ID).Count(&count).Error == nil && count == 0
	}, time.Second, 10*time.Millisecond)
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	require.NoError(t, stop(ctx))
	select {
	case <-canceled:
	case <-ctx.Done():
		t.Fatal("check was not canceled during shutdown")
	}
	beats, err := s.MonitorHistory(t.Context(), m.ID, time.Hour)
	require.NoError(t, err)
	require.Empty(t, beats)
}

func TestOverviewAggregation(t *testing.T) {
	s := testHub(t)
	ctx := t.Context()
	config.SetDb(s.db)
	require.NoError(t, config.Set(metricstore.MetricDBDSNKey, filepath.Join(t.TempDir(), "metrics.db")))
	require.NoError(t, metricstore.InitializeStore())
	t.Cleanup(func() { require.NoError(t, metricstore.CloseStoreContext(context.Background())) })
	for _, c := range []models.Client{
		{UUID: "statushub-online", Token: "a", Name: "Tokyo", Region: "🇯🇵"},
		{UUID: "statushub-offline", Token: "b", Name: "Los Angeles"},
		{UUID: "statushub-hidden", Token: "c", Name: "Hidden", Hidden: true},
	} {
		require.NoError(t, s.db.Create(&c).Error)
	}
	agent.SetPresence("statushub-online", 100, true)
	defer agent.SetPresence("statushub-online", 100, false)
	agent.RecordReport(v2.Report{UUID: "statushub-online", CPU: v2.CPUReport{Usage: 20}, Ram: v2.RamReport{Used: 24, Total: 48}, Network: v2.NetworkReport{Down: 10, Up: 5}})
	m, err := s.SaveMonitor(ctx, 0, MonitorInput{Name: ptr("Failing"), Type: ptr("tcp"), Target: ptr("localhost:9000")})
	require.NoError(t, err)
	when := time.Now().UTC().Add(-time.Minute)
	require.NoError(t, metricstore.GetStore().WriteBatch(ctx, []metric.Point{
		{MetricName: metricstore.MetricCPU, EntityID: "statushub-online", Timestamp: when, Value: 25},
		{MetricName: metricstore.MetricCPU, EntityID: "statushub-hidden", Timestamp: when, Value: 75},
	}))
	require.NoError(t, s.db.Transaction(func(tx *gorm.DB) error {
		return recordBeat(tx, &m, &models.UptimeHeartbeat{MonitorID: m.ID, Status: Down, Message: "failed", CheckedAt: when})
	}))
	source, err := s.SaveSubscription(ctx, 0, SubscriptionInput{Name: ptr("Sub"), RawContent: ptr("socks5://user:pass@proxy.example:443#Tokyo")})
	require.NoError(t, err)
	var node models.SubNode
	require.NoError(t, s.db.Where("subscription_id = ?", source.ID).First(&node).Error)
	node.TestStatus, node.LatencyMS = "ok", 40
	node.IPPure = &models.IPPureResult{IP: "192.0.2.1", FraudScore: ptr(40), IsResidential: true}
	require.NoError(t, s.db.Save(&node).Error)
	require.NoError(t, s.db.Create(&models.SubSpeedSample{NodeID: node.ID, LatencyMS: 40, TestedAt: when}).Error)
	o, err := s.Overview(ctx, time.Hour, false)
	require.NoError(t, err)
	require.Equal(t, "degraded", o.HealthStatus)
	require.Equal(t, 2, o.ActiveAlerts)
	require.Equal(t, 2, o.Probes.Total)
	require.Equal(t, 1, o.Probes.Online)
	require.Equal(t, 1, o.Probes.Offline)
	require.Equal(t, 20.0, o.Probes.AvgCPU)
	require.Equal(t, "JP", o.Probes.TopNodes[1].Region)
	require.Len(t, o.Probes.Sparkline, 1)
	require.Equal(t, 25.0, o.Probes.Sparkline[0].V)
	require.Equal(t, 50.0, o.Probes.AvgMemPercent)
	require.EqualValues(t, 80, o.Probes.TotalNetInBPS)
	require.Equal(t, 1, o.Uptime.Down)
	require.Equal(t, []int{Down}, o.Uptime.TopMonitors[0].RecentBeats)
	require.Equal(t, 1, o.Subscriptions.PureNodes)
	require.Equal(t, 1, o.Subscriptions.ResidentialNodes)
	require.Equal(t, 1, o.Subscriptions.AvailableNodes)
	require.Equal(t, 40.0, o.Subscriptions.Sparkline[0].V)
	require.Equal(t, "JP", o.Subscriptions.CountryCounts[0].CountryCode)
	require.Len(t, o.RecentEvents, 1)
	require.Equal(t, "Failing is down", o.RecentEvents[0].Title)
	admin, err := s.Overview(ctx, time.Hour, true)
	require.NoError(t, err)
	require.Equal(t, 3, admin.Probes.Total)
	require.Len(t, admin.Probes.Sparkline, 1)
	require.Equal(t, 50.0, admin.Probes.Sparkline[0].V)
}
