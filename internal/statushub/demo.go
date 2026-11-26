package statushub

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/internal/metricstore"
	"github.com/komari-monitor/komari/pkg/metric"
	v2 "github.com/komari-monitor/komari/protocol/v2"
	agent "github.com/komari-monitor/komari/web/agent"
	"gorm.io/gorm"
)

const (
	demoPresenceConnID int64 = -1
	demoPresenceTTL          = 30 * time.Second
	demoReportInterval       = 5 * time.Second
	demoBackfillPoints       = 12
	demoBackfillStep         = 5 * time.Minute
)

// SeedDemoIfEmpty adds a fictional dashboard snapshot to an empty installation.
func SeedDemoIfEmpty(ctx context.Context, db *gorm.DB) error {
	db = New(db).dbFor(ctx)
	return db.Transaction(func(tx *gorm.DB) error {
		for _, model := range []any{&models.Client{}, &models.UptimeMonitor{}, &models.SubSource{}} {
			var count int64
			if err := tx.Model(model).Count(&count).Error; err != nil {
				return err
			}
			if count != 0 {
				return nil
			}
		}
		now := time.Now().UTC()
		if err := seedDemoClients(tx); err != nil {
			return err
		}
		if err := seedDemoMonitors(tx, now); err != nil {
			return err
		}
		return seedDemoSubscription(tx, now)
	})
}

func seedDemoClients(tx *gorm.DB) error {
	const gib = 1 << 30
	var clients []models.Client
	for i, server := range []struct {
		name, region, os, arch string
		cores                  int
		memory, disk           int64
	}{
		{"Demo Tokyo Edge", "JP", "Debian 12", "x86_64", 4, 8, 80},
		{"Demo Seattle API", "US", "Ubuntu 24.04", "x86_64", 8, 16, 160},
		{"Demo Singapore Cache", "SG", "Ubuntu 24.04", "aarch64", 4, 8, 60},
		{"Demo Frankfurt Worker", "DE", "Rocky Linux 9", "x86_64", 2, 4, 40},
	} {
		id, err := uuid.NewRandom()
		if err != nil {
			return err
		}
		token, err := uuid.NewRandom()
		if err != nil {
			return err
		}
		clients = append(clients, models.Client{
			UUID: id.String(), Token: token.String(), Name: server.name, Region: server.region, Group: "Demo",
			CpuName: "AMD EPYC 7763 64-Core Processor", OS: server.os, Arch: server.arch,
			Virtualization: "kvm", CpuCores: server.cores,
			IPv4: fmt.Sprintf("198.51.100.%d", 20+i), MemTotal: server.memory * gib,
			SwapTotal: 2 * gib, DiskTotal: server.disk * gib,
			Version: "2.0.0-demo", PublicRemark: "Fictional demo server",
		})
	}
	return tx.Create(&clients).Error
}

// StartDemoProbes keeps synthetic demo servers marked online and periodically
// emits simulated telemetry so public demo views remain populated across restarts.
func StartDemoProbes(db *gorm.DB) func(context.Context) error {
	hub := New(db)
	ctx, cancel := context.WithCancel(context.Background())
	now := time.Now().UTC()
	ensureDemoMonitorsActive(ctx, hub, now)
	ensureDemoIncidents(ctx, hub, now)
	clients := loadDemoClients(ctx, hub)
	if len(clients) > 0 {
		backfillDemoMetrics(ctx, clients, now)
		publishDemoReports(ctx, clients, now, 0)
	}

	done := make(chan struct{})
	var wg sync.WaitGroup
	wg.Go(func() {
		defer close(done)
		ticker := time.NewTicker(demoReportInterval)
		defer ticker.Stop()
		var step int64 = 1
		for {
			select {
			case <-ctx.Done():
				return
			case tick := <-ticker.C:
				if len(clients) == 0 {
					clients = loadDemoClients(ctx, hub)
				}
				if len(clients) > 0 {
					publishDemoReports(ctx, clients, tick.UTC(), step)
					step++
				}
			}
		}
	})

	return func(shutdownCtx context.Context) error {
		cancel()
		select {
		case <-done:
			for _, client := range clients {
				agent.SetPresence(client.UUID, demoPresenceConnID, false)
				agent.DeleteLatestReport(client.UUID)
			}
			return nil
		case <-shutdownCtx.Done():
			return shutdownCtx.Err()
		}
	}
}

func loadDemoClients(ctx context.Context, hub *Service) []models.Client {
	var clients []models.Client
	if err := hub.dbFor(ctx).
		Where(&models.Client{Group: "Demo"}).
		Where("ipv4 LIKE ?", "198.51.100.%").
		Order("weight DESC, name, uuid").
		Find(&clients).Error; err != nil {
		return nil
	}
	return clients
}

func backfillDemoMetrics(ctx context.Context, clients []models.Client, now time.Time) {
	if metricstore.GetStore() == nil || len(clients) == 0 {
		return
	}
	existing, err := metricstore.QueryMetrics(ctx, metricstore.MetricsQuery{
		Specs:        []metricstore.MetricSpec{{Name: metricstore.MetricCPU}},
		Entities:     metricstore.EntityScope{IDs: []string{clients[0].UUID}},
		Start:        now.Add(-time.Hour),
		End:          now,
		Now:          now,
		AllowMissing: true,
	})
	if err == nil && len(existing.Values[metricstore.MetricCPU][metric.AggAvg]) > 0 {
		return
	}
	for i := demoBackfillPoints; i >= 1; i-- {
		ts := now.Add(-time.Duration(i) * demoBackfillStep)
		step := int64(demoBackfillPoints - i)
		for idx, client := range clients {
			report := buildDemoReport(client, idx, ts, step)
			_, _ = metricstore.WriteReport(ctx, report)
		}
	}
}

func publishDemoReports(ctx context.Context, clients []models.Client, now time.Time, step int64) {
	hasStore := metricstore.GetStore() != nil
	for idx, client := range clients {
		report := buildDemoReport(client, idx, now, step+demoBackfillPoints)
		agent.KeepAlivePresence(client.UUID, demoPresenceConnID, demoPresenceTTL)
		agent.RecordReport(report)
		if hasStore {
			_, _ = metricstore.WriteReport(ctx, report)
		}
	}
}

func buildDemoReport(client models.Client, index int, now time.Time, step int64) v2.Report {
	const gib = int64(1 << 30)
	wave := math.Sin(float64(step)/4.0 + float64(index)*1.3)
	wave2 := math.Cos(float64(step)/6.0 + float64(index)*0.9)

	cpuBase := 18.0 + float64(index%4)*11.0
	cpuUsage := math.Round((cpuBase+wave*8.5)*100) / 100
	if cpuUsage < 2.0 {
		cpuUsage = 2.0
	}

	memTotal := client.MemTotal
	if memTotal <= 0 {
		memTotal = 4 * gib
	}
	memRatio := 0.34 + float64(index%4)*0.08 + wave2*0.03
	memUsed := int64(float64(memTotal) * memRatio)

	swapTotal := client.SwapTotal
	if swapTotal <= 0 {
		swapTotal = 2 * gib
	}
	swapUsed := swapTotal / 12

	diskTotal := client.DiskTotal
	if diskTotal <= 0 {
		diskTotal = 40 * gib
	}
	diskRatio := 0.28 + float64(index%4)*0.07
	diskUsed := int64(float64(diskTotal) * diskRatio)

	cores := max(client.CpuCores, 2)
	load1 := math.Round((float64(cores)*(cpuUsage/100.0)*0.85)*100) / 100
	load5 := math.Round((load1*0.92)*100) / 100
	load15 := math.Round((load1*0.85)*100) / 100

	netDown := int64(1_800_000 + index*950_000 + int(math.Abs(wave)*1_400_000))
	netUp := int64(1_200_000 + index*680_000 + int(math.Abs(wave2)*1_100_000))
	totalDown := int64(42+index*19)*gib + step*netDown*5
	totalUp := int64(28+index*13)*gib + step*netUp*5

	return v2.Report{
		UUID: client.UUID,
		CPU: v2.CPUReport{
			Name:  client.CpuName,
			Cores: cores,
			Arch:  client.Arch,
			Usage: cpuUsage,
		},
		Ram:  v2.RamReport{Total: memTotal, Used: memUsed},
		Swap: v2.RamReport{Total: swapTotal, Used: swapUsed},
		Load: v2.LoadReport{Load1: load1, Load5: load5, Load15: load15},
		Disk: v2.DiskReport{Total: diskTotal, Used: diskUsed},
		Network: v2.NetworkReport{
			Up:        netUp,
			Down:      netDown,
			TotalUp:   totalUp,
			TotalDown: totalDown,
		},
		Connections: v2.ConnectionsReport{
			TCP: 48 + index*27 + int(math.Abs(wave)*18),
			UDP: 9 + index*5 + int(math.Abs(wave2)*6),
		},
		Uptime:    int64((14+index*9)*86400) + step*5,
		Process:   92 + index*16 + int(step%5),
		Method:    "demo",
		UpdatedAt: now.UTC(),
	}
}

func seedDemoMonitors(tx *gorm.DB, now time.Time) error {
	var seeded []models.UptimeMonitor
	for i, monitor := range []struct {
		name, target string
		latency      int64
	}{
		{"Demo Website", "https://www.example.com", 38},
		{"Demo API", "https://api.example.com/health", 69},
		{"Demo Asset CDN", "https://cdn.example.com/health", 24},
	} {
		m := models.UptimeMonitor{
			Name: monitor.name, Group: "Demo", Type: "http", Target: monitor.target, IntervalSec: 60, TimeoutSec: 5,
			Enabled: true, Status: Up, LastLatency: monitor.latency, LastCheckAt: &now, LastMessage: "200 OK",
		}
		if err := tx.Create(&m).Error; err != nil {
			return err
		}
		seeded = append(seeded, m)
		beats := make([]models.UptimeHeartbeat, 0, 36)
		for j := 35; j >= 0; j-- {
			beat := models.UptimeHeartbeat{
				MonitorID: m.ID, Status: Up, LatencyMS: monitor.latency + int64(j%7),
				Message: "200 OK", CheckedAt: now.Add(-time.Duration(j) * 5 * time.Minute),
			}
			if i == 1 && j == 12 {
				beat.Status, beat.LatencyMS, beat.Message = Down, 0, "503 Service Unavailable"
			}
			beats = append(beats, beat)
		}
		if err := tx.Create(&beats).Error; err != nil {
			return err
		}
	}
	return seedDemoIncidents(tx, seeded, now)
}

func seedDemoIncidents(tx *gorm.DB, monitors []models.UptimeMonitor, now time.Time) error {
	var incidents []models.UptimeIncident
	for _, m := range monitors {
		switch m.Name {
		case "Demo API":
			started := now.Add(-60 * time.Minute)
			resolved := now.Add(-55 * time.Minute)
			incidents = append(incidents, models.UptimeIncident{
				MonitorID:   m.ID,
				MonitorName: m.Name,
				Status:      "resolved",
				Message:     "503 Service Unavailable",
				Recovery:    "200 OK",
				StartedAt:   started,
				ResolvedAt:  &resolved,
				DurationSec: 300,
			})
		case "Demo Asset CDN":
			started := now.Add(-4 * time.Hour)
			resolved := started.Add(2 * time.Minute)
			incidents = append(incidents, models.UptimeIncident{
				MonitorID:   m.ID,
				MonitorName: m.Name,
				Status:      "resolved",
				Message:     "Upstream TLS handshake timeout",
				Recovery:    "200 OK",
				StartedAt:   started,
				ResolvedAt:  &resolved,
				DurationSec: 120,
			})
		}
	}
	if len(incidents) == 0 {
		return nil
	}
	return tx.Create(&incidents).Error
}

func isDemoMonitor(m models.UptimeMonitor) bool {
	if m.Group != "Demo" || m.KumaSourceID != nil {
		return false
	}
	u, err := url.Parse(m.Target)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "example.com" || strings.HasSuffix(host, ".example.com")
}

func demoMonitorLatency(m models.UptimeMonitor, now time.Time) int64 {
	var base int64 = 35
	switch {
	case strings.Contains(m.Target, "api.example.com"):
		base = 68
	case strings.Contains(m.Target, "cdn.example.com"):
		base = 24
	}
	return base + int64((now.Minute()+int(m.ID)*3)%7)
}

func ensureDemoMonitorsActive(ctx context.Context, hub *Service, now time.Time) {
	db := hub.dbFor(ctx)
	var monitors []models.UptimeMonitor
	if err := db.Where(&models.UptimeMonitor{Group: "Demo"}).Find(&monitors).Error; err != nil {
		return
	}
	for _, m := range monitors {
		if !isDemoMonitor(m) || (m.Enabled && m.Status == Up) {
			continue
		}
		_ = db.Model(&m).Updates(map[string]any{
			"enabled":       true,
			"status":        Up,
			"last_check_at": now,
			"last_message":  "200 OK",
		}).Error
	}
}

func ensureDemoIncidents(ctx context.Context, hub *Service, now time.Time) {
	db := hub.dbFor(ctx)
	var monitors []models.UptimeMonitor
	if err := db.Where(&models.UptimeMonitor{Group: "Demo"}).Find(&monitors).Error; err != nil || len(monitors) == 0 {
		return
	}
	cutoff := now.Add(-24 * time.Hour)
	var recentCount int64
	if err := db.Model(&models.UptimeIncident{}).
		Where("started_at >= ? OR resolved_at >= ?", cutoff, cutoff).
		Count(&recentCount).Error; err != nil || recentCount > 0 {
		return
	}
	_ = db.Transaction(func(tx *gorm.DB) error {
		return seedDemoIncidents(tx, monitors, now)
	})
}

func seedDemoSubscription(tx *gorm.DB, now time.Time) error {
	const gib = 1 << 30
	source := models.SubSource{
		Name: "Demo Global Relay", SourceType: "url", URL: "https://demo.example.com/subscribe",
		Enabled: true, Upload: 12 * gib, Download: 81 * gib, Total: 250 * gib, Expire: now.AddDate(0, 1, 0).Unix(),
		LastSyncedAt: &now, LastSpeedTestAt: &now, LastPurityCheckAt: &now,
	}
	if err := tx.Create(&source).Error; err != nil {
		return err
	}
	locations := []struct {
		city, country string
		latency       int64
		scores        [2]int
	}{
		{"Tokyo", "JP", 35, [2]int{9, 24}},
		{"Seattle", "US", 168, [2]int{17, 62}},
		{"Singapore", "SG", 67, [2]int{21, 48}},
		{"Frankfurt", "DE", 193, [2]int{5, 33}},
		{"London", "GB", 211, [2]int{19, 76}},
		{"Hong Kong", "HK", 28, [2]int{13, 29}},
	}
	methods := []string{"proxy_http", "proxy_download", "browser_http", "tcp", "browser_tcp", "tcp_fallback"}
	nodes := make([]models.SubNode, 0, 12)
	for i, location := range locations {
		for j, score := range location.scores {
			name := fmt.Sprintf("%s Demo %02d", location.city, j+1)
			host := fmt.Sprintf("203.0.113.%d", 40+len(nodes))
			raw := fmt.Sprintf("trojan://demo-only@%s:443#%s", host, name)
			node := newNode(name, "trojan", host, 443, "uri", raw)
			if node == nil {
				return fmt.Errorf("invalid demo node %q", name)
			}
			if node.CountryCode != location.country {
				geo := countryGeo(location.country)
				node.CountryCode, node.CountryName, node.City = geo.code, geo.country, location.city
				node.Lat, node.Lng, node.HasCoordinates = geo.lat, geo.lng, geo.located
			}
			node.SubscriptionID = source.ID
			node.TestStatus, node.TestMethod, node.TestedAt = "ok", methods[(i+2*j)%len(methods)], &now
			node.LatencyMS = location.latency + int64(j*19)
			if node.TestMethod == "proxy_download" {
				node.DownloadMbps = 180 - float64(i*13+j*7)
			}
			node.IPPure = &models.IPPureResult{
				IP: fmt.Sprintf("192.0.2.%d", 70+len(nodes)), ASN: 64512 + int64(i), ASOrganization: "Demo Transit",
				Country: node.CountryName, CountryCode: node.CountryCode, City: node.City,
				FraudScore: &score, IsResidential: score < 25, IsBroadcast: score >= 62, CheckedAt: &now,
			}
			nodes = append(nodes, *node)
		}
	}
	if err := tx.Create(&nodes).Error; err != nil {
		return err
	}
	samples := make([]models.SubSpeedSample, 0, len(nodes)*6)
	for _, node := range nodes {
		for i := 5; i >= 0; i-- {
			samples = append(samples, models.SubSpeedSample{
				NodeID: node.ID, LatencyMS: node.LatencyMS + int64(i%3)*4, TestedAt: now.Add(-time.Duration(i) * time.Hour),
			})
		}
	}
	return tx.Create(&samples).Error
}
