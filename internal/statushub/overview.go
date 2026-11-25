package statushub

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/internal/metricstore"
	"github.com/komari-monitor/komari/pkg/metric"
	agent "github.com/komari-monitor/komari/web/agent"
)

type Overview struct {
	UpdatedAt     time.Time       `json:"updated_at"`
	HealthStatus  string          `json:"health_status"`
	ActiveAlerts  int             `json:"active_alerts"`
	Probes        ProbeOverview   `json:"probes"`
	Uptime        UptimeOverview  `json:"uptime"`
	Subscriptions SubOverview     `json:"subscriptions"`
	RecentEvents  []OverviewEvent `json:"recent_events"`
}

type ProbeOverview struct {
	Total          int         `json:"total"`
	Online         int         `json:"online"`
	Offline        int         `json:"offline"`
	AvgCPU         float64     `json:"avg_cpu"`
	AvgMemPercent  float64     `json:"avg_mem_percent"`
	TotalNetInBPS  int64       `json:"total_net_in_bps"`
	TotalNetOutBPS int64       `json:"total_net_out_bps"`
	Sparkline      []Point     `json:"sparkline"`
	TopNodes       []ProbeNode `json:"top_nodes"`
}

type ProbeNode struct {
	UUID       string  `json:"uuid"`
	Name       string  `json:"name"`
	Region     string  `json:"region"`
	Online     bool    `json:"online"`
	CPU        float64 `json:"cpu"`
	MemPercent float64 `json:"mem_percent"`
	NetIn      int64   `json:"net_in"`
	NetOut     int64   `json:"net_out"`
}

type UptimeOverview struct {
	TotalMonitors    int               `json:"total_monitors"`
	Up               int               `json:"up"`
	Down             int               `json:"down"`
	Degraded         int               `json:"degraded"`
	OverallUptime24h float64           `json:"overall_uptime_24h"`
	AvgLatencyMS     int64             `json:"avg_latency_ms"`
	Sparkline        []Point           `json:"sparkline"`
	TopMonitors      []OverviewMonitor `json:"top_monitors"`
}

type OverviewMonitor struct {
	ID          uint    `json:"id"`
	Name        string  `json:"name"`
	Type        string  `json:"type"`
	Source      string  `json:"source"`
	Status      int     `json:"status"`
	Uptime24h   float64 `json:"uptime_24h"`
	LatencyMS   int64   `json:"latency_ms"`
	RecentBeats []int   `json:"recent_beats"`
}

type SubOverview struct {
	TotalSubscriptions int               `json:"total_subscriptions"`
	TotalNodes         int               `json:"total_nodes"`
	AvailableNodes     int               `json:"available_nodes"`
	AvgLatencyMS       int64             `json:"avg_latency_ms"`
	PureNodes          int               `json:"pure_nodes"`
	ResidentialNodes   int               `json:"residential_nodes"`
	Sparkline          []Point           `json:"sparkline"`
	Items              []OverviewSubItem `json:"items"`
	CountryCounts      []OverviewCountry `json:"country_counts"`
}

type OverviewSubItem struct {
	ID             uint   `json:"id"`
	Name           string `json:"name"`
	NodeCount      int    `json:"node_count"`
	Upload         int64  `json:"upload"`
	Download       int64  `json:"download"`
	Total          int64  `json:"total"`
	Expire         int64  `json:"expire"`
	MinLatencyMS   int64  `json:"min_latency_ms"`
	BestFraudScore int    `json:"best_fraud_score"`
}

type OverviewCountry struct {
	CountryCode   string  `json:"country_code"`
	CountryName   string  `json:"country_name"`
	Lat           float64 `json:"lat"`
	Lng           float64 `json:"lng"`
	Count         int     `json:"count"`
	MinLatencyMS  int64   `json:"min_latency_ms"`
	AvgFraudScore float64 `json:"avg_fraud_score"`
}

type OverviewEvent struct {
	ID        string    `json:"id"`
	Source    string    `json:"source"`
	Severity  string    `json:"severity"`
	Title     string    `json:"title"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Service) Overview(ctx context.Context, span time.Duration, admin bool) (Overview, error) {
	now := s.now()
	out := Overview{UpdatedAt: now}
	probes, err := s.probeOverview(ctx, now, span, admin)
	if err != nil {
		return out, err
	}
	uread, err := s.Uptime(ctx, span, false)
	if err != nil {
		return out, err
	}
	data, err := s.readSubscriptions(ctx, false, NodeFilter{})
	if err != nil {
		return out, err
	}
	subs, err := s.subscriptionOverview(ctx, data, now, span)
	if err != nil {
		return out, err
	}
	events, err := s.overviewEvents(ctx, data, now.Add(-span))
	if err != nil {
		return out, err
	}
	active, failed := probes.Total+uread.Total-uread.Paused, probes.Offline+uread.Down
	out.HealthStatus, out.ActiveAlerts = health(active, failed, uread.Pending), failed+uread.Pending
	out.Probes, out.Uptime, out.Subscriptions, out.RecentEvents = probes, uptimeOverview(uread), subs, events
	return out, nil
}

const overviewTop = 8

func (s *Service) probeOverview(ctx context.Context, now time.Time, span time.Duration, admin bool) (ProbeOverview, error) {
	out := ProbeOverview{TopNodes: []ProbeNode{}, Sparkline: []Point{}}
	db := s.dbFor(ctx).Select("uuid", "name", "region", "mem_total").Order("weight DESC, name, uuid")
	if !admin {
		db = db.Where("hidden = ? OR hidden IS NULL", false)
	}
	var clients []models.Client
	if err := db.Find(&clients).Error; err != nil {
		return out, err
	}
	online := make(map[string]bool)
	for _, id := range agent.GetAllOnlineUUIDs() {
		online[id] = true
	}
	latest := agent.GetLatestReport()
	ids := make([]string, 0, len(clients))
	var cpuCount, memCount int
	for _, client := range clients {
		region := client.Region
		if code := flagCode(region); code != "" {
			region = code
		}
		p := ProbeNode{UUID: client.UUID, Name: client.Name, Region: region, Online: online[client.UUID]}
		ids = append(ids, client.UUID)
		if !p.Online {
			out.Offline++
		} else {
			out.Online++
			if rep := latest[client.UUID]; rep != nil {
				p.CPU = rep.CPU.Usage
				total := rep.Ram.Total
				if total <= 0 {
					total = client.MemTotal
				}
				if total > 0 {
					p.MemPercent = 100 * float64(rep.Ram.Used) / float64(total)
					out.AvgMemPercent += p.MemPercent
					memCount++
				}
				p.NetIn, p.NetOut = rep.Network.Down, rep.Network.Up
				out.AvgCPU += p.CPU
				cpuCount++
				out.TotalNetInBPS += p.NetIn * 8
				out.TotalNetOutBPS += p.NetOut * 8
			}
		}
		out.TopNodes = append(out.TopNodes, p)
	}
	out.Total = len(clients)
	if cpuCount > 0 {
		out.AvgCPU /= float64(cpuCount)
	}
	if memCount > 0 {
		out.AvgMemPercent /= float64(memCount)
	}
	sort.SliceStable(out.TopNodes, func(i, j int) bool {
		a, b := out.TopNodes[i], out.TopNodes[j]
		if a.Online != b.Online {
			return !a.Online
		}
		return a.CPU > b.CPU
	})
	out.TopNodes = out.TopNodes[:min(overviewTop, len(out.TopNodes))]
	if len(ids) == 0 || metricstore.GetStore() == nil {
		return out, nil
	}
	history, err := metricstore.QueryMetrics(ctx, metricstore.MetricsQuery{
		Specs:    []metricstore.MetricSpec{{Name: metricstore.MetricCPU, Aggregations: []metric.Aggregation{metric.AggAvg}, MaxPoints: 48}},
		Entities: metricstore.EntityScope{IDs: ids}, Start: now.Add(-span), End: now, Now: now,
		Rounding: metricstore.RoundCeil, AllowMissing: true,
	})
	if err != nil {
		return out, err
	}
	for _, p := range history.Values[metricstore.MetricCPU][metric.AggAvg] {
		out.Sparkline = append(out.Sparkline, Point{p.Bucket.UTC(), p.Value})
	}
	return out, nil
}

func uptimeOverview(data UptimeSummary) UptimeOverview {
	out := UptimeOverview{
		TotalMonitors: data.Total, Up: data.Up, Down: data.Down, Degraded: data.Pending,
		OverallUptime24h: data.OverallUptime24, AvgLatencyMS: data.AvgLatencyMS,
		Sparkline: []Point{}, TopMonitors: []OverviewMonitor{},
	}
	for _, p := range data.LatencySeries {
		out.Sparkline = append(out.Sparkline, Point{p.T, float64(p.AvgMS)})
	}
	priority := func(m Monitor) int {
		if !m.Enabled {
			return 3
		}
		switch m.Status {
		case Down:
			return 0
		case Pending:
			return 1
		default:
			return 2
		}
	}
	sort.SliceStable(data.Monitors, func(i, j int) bool {
		return priority(data.Monitors[i]) < priority(data.Monitors[j])
	})
	for _, m := range data.Monitors[:min(overviewTop, len(data.Monitors))] {
		item := OverviewMonitor{
			ID: m.ID, Name: m.Name, Type: m.Type, Source: m.Source, Status: m.Status,
			Uptime24h: m.Uptime24h, LatencyMS: m.LastLatencyMS, RecentBeats: []int{},
		}
		for _, b := range m.Heartbeats {
			item.RecentBeats = append(item.RecentBeats, b.Status)
		}
		out.TopMonitors = append(out.TopMonitors, item)
	}
	return out
}

func (s *Service) subscriptionOverview(ctx context.Context, data subscriptionData, now time.Time, span time.Duration) (SubOverview, error) {
	out := SubOverview{
		TotalSubscriptions: len(data.sources), TotalNodes: len(data.nodes), Items: []OverviewSubItem{},
		CountryCounts: []OverviewCountry{}, Sparkline: []Point{},
	}
	var latency int64
	bySource := data.bySource()
	for _, source := range data.sources {
		nodes := bySource[source.ID]
		item := OverviewSubItem{
			ID: source.ID, Name: source.Name, NodeCount: len(nodes), Upload: source.Upload,
			Download: source.Download, Total: source.Total, Expire: source.Expire, BestFraudScore: -1,
		}
		for _, node := range nodes {
			if source.Enabled && available(node) {
				out.AvailableNodes++
				latency += node.LatencyMS
				if item.MinLatencyMS == 0 || node.LatencyMS < item.MinLatencyMS {
					item.MinLatencyMS = node.LatencyMS
				}
			}
			if !validPurity(node) {
				continue
			}
			if score := node.IPPure.FraudScore; score != nil {
				if *score <= 40 {
					out.PureNodes++
				}
				if item.BestFraudScore < 0 || *score < item.BestFraudScore {
					item.BestFraudScore = *score
				}
			}
			if node.IPPure.IsResidential {
				out.ResidentialNodes++
			}
		}
		out.Items = append(out.Items, item)
	}
	if out.AvailableNodes > 0 {
		out.AvgLatencyMS = latency / int64(out.AvailableNodes)
	}
	for _, country := range data.mapData().Countries {
		out.CountryCounts = append(out.CountryCounts, OverviewCountry{
			CountryCode: country.CountryCode, CountryName: country.CountryName, Lat: country.Lat, Lng: country.Lng,
			Count: country.NodeCount, MinLatencyMS: country.MinLatencyMS, AvgFraudScore: country.AvgFraudScore,
		})
	}
	rows, err := s.dbFor(ctx).Model(&models.SubSpeedSample{}).Select("tested_at", "latency_ms").
		Where("tested_at >= ? AND tested_at <= ?", now.Add(-span), now).Rows()
	if err != nil {
		return out, err
	}
	defer rows.Close()
	type average struct{ sum, count int64 }
	buckets := make(map[time.Time]average)
	width := bucketWidth(span)
	for rows.Next() {
		var at time.Time
		var latency int64
		if err := rows.Scan(&at, &latency); err != nil {
			return out, err
		}
		at = at.UTC().Truncate(width)
		b := buckets[at]
		b.sum += latency
		b.count++
		buckets[at] = b
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	for at, bucket := range buckets {
		out.Sparkline = append(out.Sparkline, Point{at, float64(bucket.sum) / float64(bucket.count)})
	}
	sort.Slice(out.Sparkline, func(i, j int) bool { return out.Sparkline[i].T.Before(out.Sparkline[j].T) })
	return out, nil
}

func (s *Service) overviewEvents(ctx context.Context, data subscriptionData, start time.Time) ([]OverviewEvent, error) {
	out := []OverviewEvent{}
	var incidents []models.UptimeIncident
	db := s.dbFor(ctx)
	incidentQuery := db.Model(&models.UptimeIncident{}).Where("started_at >= ? OR resolved_at >= ?", start, start)
	if err := incidentQuery.Order("COALESCE(resolved_at, started_at) DESC, id DESC").Limit(20).Find(&incidents).Error; err != nil {
		return out, err
	}
	for _, i := range incidents {
		if !i.StartedAt.Before(start) {
			out = append(out, OverviewEvent{
				fmt.Sprintf("uptime-%d-down", i.ID), "uptime", "warning",
				i.MonitorName + " is down", i.Message, i.StartedAt,
			})
		}
		if i.ResolvedAt != nil && !i.ResolvedAt.Before(start) {
			out = append(out, OverviewEvent{
				fmt.Sprintf("uptime-%d-resolved", i.ID), "uptime", "info",
				i.MonitorName + " recovered", i.Recovery, *i.ResolvedAt,
			})
		}
	}
	for _, source := range data.sources {
		if source.LastError != "" && source.LastAttemptAt != nil && !source.LastAttemptAt.Before(start) {
			out = append(out, OverviewEvent{
				fmt.Sprintf("subscription-%d-refresh", source.ID), "subscriptions", "warning",
				source.Name + " refresh failed", source.LastError, *source.LastAttemptAt,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out[:min(20, len(out))], nil
}
