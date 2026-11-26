package statushub

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/komari-monitor/komari/database/models"
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
		&models.SubSource{}, &models.SubNode{}, &models.SubSpeedSample{}, &models.IPPureSelfCache{}, &models.Client{},
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
	nodes, err := s.Nodes(ctx, NodeFilter{})
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	nodeID := nodes[0].ID
	updated, err := s.PatchNode(ctx, nodeID, NodePatch{Enabled: ptr(false), CountryCode: ptr("DE"), City: ptr("Berlin"), Lat: ptr(52.1), Lng: ptr(0.0)})
	require.NoError(t, err)
	require.Equal(t, "Airport", updated.SubscriptionName)
	content.Store(second)
	_, err = s.RefreshSubscription(ctx, source.ID, true)
	require.NoError(t, err)
	nodes, err = s.Nodes(ctx, NodeFilter{SubscriptionID: source.ID, Country: "de", Search: "AIRPORT"})
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	require.Equal(t, nodeID, nodes[0].ID)
	require.False(t, nodes[0].Enabled)
	require.Equal(t, "Berlin", nodes[0].City)
	require.Equal(t, 52.1, nodes[0].Lat)
	require.Zero(t, nodes[0].Lng)
	nodes, err = s.Nodes(ctx, NodeFilter{OnlyEnabled: true})
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
	self, err := s.IPPureSelf(ctx)
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
	cached, err := s.IPPureSelf(ctx)
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
	for _, mode := range []string{"tcp", "http", "download"} {
		results, err := s.CheckSpeed(ctx, SpeedInput{TestFilter: TestFilter{SubscriptionID: source.ID}, Mode: mode, Concurrency: 2})
		require.NoError(t, err)
		require.Len(t, results, 1)
		require.Equal(t, "ok", results[0].TestStatus)
		require.Positive(t, results[0].LatencyMS)
		if mode == "download" {
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
	nodes, err = s.CheckNodePurity(t.Context(), selected)
	require.NoError(t, err)
	require.Contains(t, nodes[0].IPPureError, "install mihomo or sing-box")
	require.NotContains(t, nodes[0].IPPureError, "plain-secret")
}

func TestCheckSpeedStreamProgress(t *testing.T) {
	s := testHub(t)
	s.testURL = "http://speed.invalid/check"
	releaseSlow := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-releaseSlow:
			w.WriteHeader(http.StatusNoContent)
		case <-r.Context().Done():
		}
	}))
	defer slow.Close()
	fast := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer fast.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	source, err := s.SaveSubscription(ctx, 0, SubscriptionInput{
		Name: ptr("Proxies"), RawContent: ptr(slow.URL + "#Slow\n" + fast.URL + "#Fast"),
	})
	require.NoError(t, err)
	type event struct {
		completed, total int
		node             Node
	}
	events := make(chan event, 3)
	type outcome struct {
		nodes []Node
		err   error
	}
	finished := make(chan outcome, 1)
	go func() {
		nodes, err := s.CheckSpeedStream(ctx, SpeedInput{
			TestFilter: TestFilter{SubscriptionID: source.ID}, Mode: "http", Concurrency: 2,
		}, func(total int) {
			events <- event{total: total}
		}, func(completed, total int, node Node) {
			events <- event{completed, total, node}
		})
		finished <- outcome{nodes, err}
	}()
	next := func() event {
		t.Helper()
		select {
		case value := <-events:
			return value
		case <-ctx.Done():
			t.Fatal("timed out waiting for a speed event")
			return event{}
		}
	}
	require.Equal(t, event{total: 2}, next())
	first := next()
	require.Equal(t, 1, first.completed)
	require.Equal(t, 2, first.total)
	require.Equal(t, "Fast", first.node.Name)
	require.Equal(t, "Proxies", first.node.SubscriptionName)
	require.Equal(t, "ok", first.node.TestStatus)
	require.Positive(t, first.node.LatencyMS)
	var samples []models.SubSpeedSample
	require.NoError(t, s.db.Find(&samples).Error)
	require.Len(t, samples, 1)
	require.Equal(t, first.node.ID, samples[0].NodeID)
	close(releaseSlow)
	second := next()
	require.Equal(t, 2, second.completed)
	require.Equal(t, 2, second.total)
	require.Equal(t, "Slow", second.node.Name)
	require.Equal(t, "ok", second.node.TestStatus)
	select {
	case got := <-finished:
		require.NoError(t, got.err)
		require.Equal(t, []Node{second.node, first.node}, got.nodes)
	case <-ctx.Done():
		t.Fatal("speed stream did not finish")
	}
}

func TestCheckSpeedStreamValidationAndEmptySelection(t *testing.T) {
	s := testHub(t)
	unexpectedStart := func(int) { t.Error("unexpected start callback") }
	unexpectedResult := func(int, int, Node) { t.Error("unexpected result callback") }
	for _, input := range []SpeedInput{
		{Mode: "ping"}, {Concurrency: -1}, {Concurrency: 33}, {TestFilter: TestFilter{NodeIDs: make([]uint, 1001)}},
	} {
		_, err := s.CheckSpeedStream(t.Context(), input, unexpectedStart, unexpectedResult)
		require.ErrorAs(t, err, new(InputError))
	}
	starts := 0
	nodes, err := s.CheckSpeedStream(t.Context(), SpeedInput{
		TestFilter: TestFilter{NodeIDs: []uint{}},
	}, func(total int) {
		starts++
		require.Zero(t, total)
	}, unexpectedResult)
	require.NoError(t, err)
	require.Equal(t, 1, starts)
	require.Equal(t, []Node{}, nodes)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	_, err = s.CheckSpeedStream(ctx, SpeedInput{}, func(int) { cancel() }, unexpectedResult)
	require.ErrorIs(t, err, context.Canceled)
}

func TestSaveSpeedResults(t *testing.T) {
	s := testHub(t)
	now := time.Now().UTC().Truncate(time.Second)
	s.now = func() time.Time { return now }
	ctx := t.Context()
	source := models.SubSource{Name: "Client tests"}
	require.NoError(t, s.db.Create(&source).Error)
	nodes := []models.SubNode{
		{SubscriptionID: source.ID, Fingerprint: "first", Name: "First", CountryCode: "JP", RawConfig: "kept"},
		{SubscriptionID: source.ID, Fingerprint: "second", Name: "Second", DownloadMbps: 17},
		{SubscriptionID: source.ID, Fingerprint: "third", Name: "Third", DownloadMbps: 21},
		{SubscriptionID: source.ID, Fingerprint: "fourth", Name: "Fourth", DownloadMbps: 13},
	}
	require.NoError(t, s.db.Create(&nodes).Error)
	input := SpeedReportInput{Results: []SpeedReportItem{
		{NodeID: nodes[0].ID, LatencyMS: 1, DownloadMbps: 42.5, TestStatus: "ok", TestMessage: "  " + strings.Repeat("速", 501) + "  "},
		{NodeID: 9999, LatencyMS: 1, TestStatus: "ok"},
		{NodeID: nodes[1].ID, LatencyMS: 1234, DownloadMbps: 8, TestStatus: "timeout", TestMessage: "  timed out "},
		{NodeID: nodes[2].ID, LatencyMS: -123, DownloadMbps: 5, TestStatus: "error"},
		{NodeID: nodes[3].ID, LatencyMS: 600000, TestStatus: "ok"},
	}}
	got, err := s.SaveSpeedResults(ctx, input)
	require.NoError(t, err)
	require.Len(t, got, 4)
	require.Equal(t, "JP", got[0].CountryCode)
	require.Equal(t, "Client tests", got[0].SubscriptionName)
	require.Equal(t, strings.Repeat("速", 500), got[0].TestMessage)
	require.Equal(t, "timed out", got[1].TestMessage)
	require.Equal(t, []int64{1, -1, -1, 600000}, []int64{got[0].LatencyMS, got[1].LatencyMS, got[2].LatencyMS, got[3].LatencyMS})
	for i, expected := range []float64{42.5, 0, 0, 0} {
		require.Equal(t, nodes[i].ID, got[i].ID)
		require.Equal(t, expected, got[i].DownloadMbps)
		require.NotNil(t, got[i].TestedAt)
		require.True(t, now.Equal(*got[i].TestedAt))
	}
	require.EqualValues(t, 1234, input.Results[2].LatencyMS)
	var persisted []models.SubNode
	require.NoError(t, s.db.Order("id").Find(&persisted).Error)
	for i, node := range persisted {
		require.Equal(t, got[i], NodeView(node, source.Name))
	}
	require.Equal(t, "kept", persisted[0].RawConfig)
	var samples []models.SubSpeedSample
	require.NoError(t, s.db.Order("id").Find(&samples).Error)
	require.Len(t, samples, 2)
	for i, want := range []Node{got[0], got[3]} {
		require.Equal(t, want.ID, samples[i].NodeID)
		require.Equal(t, want.LatencyMS, samples[i].LatencyMS)
		require.True(t, now.Equal(samples[i].TestedAt))
	}
	missing, err := s.SaveSpeedResults(ctx, SpeedReportInput{Results: []SpeedReportItem{{NodeID: ^uint(0), TestStatus: "error"}}})
	require.NoError(t, err)
	require.Equal(t, []Node{}, missing)
}

func TestSaveSpeedResultsValidationAndRollback(t *testing.T) {
	s := testHub(t)
	ctx := t.Context()
	nodes := []models.SubNode{{Fingerprint: "first", TestStatus: "untested"}, {Fingerprint: "second", TestStatus: "untested"}}
	require.NoError(t, s.db.Create(&nodes).Error)
	valid := SpeedReportItem{NodeID: nodes[0].ID, LatencyMS: 10, TestStatus: "ok"}
	for _, items := range [][]SpeedReportItem{nil, make([]SpeedReportItem, 1001)} {
		_, err := s.SaveSpeedResults(ctx, SpeedReportInput{Results: items})
		require.ErrorContains(t, err, "1–1000")
	}
	for _, tc := range []struct {
		name string
		item SpeedReportItem
	}{
		{"node ID", SpeedReportItem{TestStatus: "error"}},
		{"status", SpeedReportItem{NodeID: nodes[1].ID, TestStatus: "untested"}},
		{"zero latency", SpeedReportItem{NodeID: nodes[1].ID, TestStatus: "ok"}},
		{"excessive latency", SpeedReportItem{NodeID: nodes[1].ID, LatencyMS: 600001, TestStatus: "ok"}},
		{"negative speed", SpeedReportItem{NodeID: nodes[1].ID, DownloadMbps: -1, TestStatus: "error"}},
		{"NaN", SpeedReportItem{NodeID: nodes[1].ID, DownloadMbps: math.NaN(), TestStatus: "timeout"}},
		{"infinity", SpeedReportItem{NodeID: nodes[1].ID, DownloadMbps: math.Inf(1), TestStatus: "error"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := s.SaveSpeedResults(ctx, SpeedReportInput{Results: []SpeedReportItem{valid, tc.item}})
			require.ErrorAs(t, err, new(InputError))
		})
	}
	require.NoError(t, s.db.Exec(fmt.Sprintf(`CREATE TRIGGER reject_sample BEFORE INSERT ON sub_speed_samples
		WHEN NEW.node_id = %d BEGIN SELECT RAISE(ABORT, 'sample rejected'); END`, nodes[1].ID)).Error)
	got, err := s.SaveSpeedResults(ctx, SpeedReportInput{Results: []SpeedReportItem{
		valid, {NodeID: nodes[1].ID, LatencyMS: 20, TestStatus: "ok"},
	}})
	require.ErrorContains(t, err, "sample rejected")
	require.Nil(t, got)
	var persisted []models.SubNode
	require.NoError(t, s.db.Order("id").Find(&persisted).Error)
	for _, node := range persisted {
		require.Equal(t, "untested", node.TestStatus)
		require.Nil(t, node.TestedAt)
	}
	var samples int64
	require.NoError(t, s.db.Model(&models.SubSpeedSample{}).Count(&samples).Error)
	require.Zero(t, samples)
}

func TestNodeSorting(t *testing.T) {
	s := testHub(t)
	early := time.Now().UTC().Truncate(time.Second)
	late := early.Add(time.Hour)
	nodes := []models.SubNode{
		{Fingerprint: "1", Name: "Zulu", TestStatus: "ok", LatencyMS: 70, DownloadMbps: 15, CountryCode: "US", CountryName: "United States", TestedAt: &late, IPPure: &models.IPPureResult{IP: "192.0.2.1", FraudScore: ptr(4)}},
		{Fingerprint: "2", Name: "alpha", TestStatus: "ok", LatencyMS: 10, DownloadMbps: 65, CountryCode: "JP", CountryName: "Japan", City: "Tokyo", TestedAt: &early, IPPure: &models.IPPureResult{IP: "192.0.2.2", FraudScore: ptr(0)}},
		{Fingerprint: "3", Name: "ALPHA", TestStatus: "ok", LatencyMS: 10, DownloadMbps: 65, CountryCode: "JP", CountryName: "Japan", City: "Osaka", TestedAt: &early, IPPure: &models.IPPureResult{IP: "192.0.2.3", FraudScore: ptr(0)}},
		{Fingerprint: "4", Name: "Bravo", TestStatus: "untested", CountryCode: "JP", CountryName: "Alternate", City: "Yokohama", IPPure: &models.IPPureResult{IP: "192.0.2.4"}},
		{Fingerprint: "5", Name: "Able", TestStatus: "error", LatencyMS: -1, DownloadMbps: -2, TestedAt: &late, IPPure: &models.IPPureResult{IP: "192.0.2.5", Error: "failed", FraudScore: ptr(1)}},
		{Fingerprint: "6", Name: "Charlie", IPPure: &models.IPPureResult{IP: "192.0.2.6", FraudScore: ptr(-1)}},
		{Fingerprint: "7", Name: "Beta", TestStatus: "timeout", LatencyMS: -1, CountryCode: "JP", CountryName: "Japan", City: "Osaka", IPPure: &models.IPPureResult{FraudScore: ptr(1)}},
	}
	require.NoError(t, s.db.Create(&nodes).Error)
	for _, tc := range []struct {
		by, dir string
		order   []int
	}{
		{"", "", []int{3, 5, 7, 4, 6, 1, 2}},
		{"default", "desc", []int{2, 1, 6, 4, 7, 5, 3}},
		{"latency", "", []int{3, 2, 1, 4, 6, 5, 7}},
		{"latency", "desc", []int{1, 3, 2, 4, 6, 5, 7}},
		{"download", "", []int{1, 3, 2, 5, 7, 4, 6}},
		{"download", "desc", []int{3, 2, 1, 5, 7, 4, 6}},
		{"fraud_score", "asc", []int{3, 2, 1, 5, 7, 4, 6}},
		{"fraud_score", "desc", []int{1, 3, 2, 5, 7, 4, 6}},
		{"country", "asc", []int{4, 3, 7, 2, 1, 5, 6}},
		{"country", "desc", []int{1, 2, 3, 7, 4, 5, 6}},
		{"tested_at", "", []int{3, 2, 5, 1, 7, 4, 6}},
		{"tested_at", "desc", []int{5, 1, 3, 2, 7, 4, 6}},
		{"name", "asc", []int{5, 2, 3, 7, 4, 6, 1}},
		{"name", "desc", []int{1, 6, 4, 7, 2, 3, 5}},
	} {
		t.Run(tc.by+"/"+tc.dir, func(t *testing.T) {
			got, err := s.Nodes(t.Context(), NodeFilter{SortBy: tc.by, SortDir: tc.dir})
			require.NoError(t, err)
			require.Len(t, got, len(tc.order))
			for i, want := range tc.order {
				require.Equal(t, nodes[want-1].ID, got[i].ID, "position %d", i)
			}
		})
	}
	for _, filter := range []NodeFilter{{SortBy: "unknown"}, {SortDir: "descending"}} {
		_, err := s.Nodes(t.Context(), filter)
		require.ErrorAs(t, err, new(InputError))
	}
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
