package statushub

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
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
			OS: server.os, Arch: server.arch, Virtualization: "kvm", CpuCores: server.cores,
			IPv4: fmt.Sprintf("198.51.100.%d", 20+i), MemTotal: server.memory * gib, DiskTotal: server.disk * gib,
			PublicRemark: "Fictional demo server",
		})
	}
	return tx.Create(&clients).Error
}

func seedDemoMonitors(tx *gorm.DB, now time.Time) error {
	// Paused monitors retain their sample history and never probe demo targets.
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
			Status: Up, LastLatency: monitor.latency, LastCheckAt: &now, LastMessage: "Demo snapshot",
		}
		if err := tx.Create(&m).Error; err != nil {
			return err
		}
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
	return nil
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
