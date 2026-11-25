package statushub

import (
	"context"
	"sort"
	"time"

	"github.com/komari-monitor/komari/database/models"
)

type Monitor struct {
	ID            uint                     `json:"id"`
	Name          string                   `json:"name"`
	Group         string                   `json:"group"`
	Type          string                   `json:"type"`
	Source        string                   `json:"source"`
	Target        string                   `json:"target"`
	Keyword       string                   `json:"keyword"`
	IntervalSec   int                      `json:"interval_sec"`
	TimeoutSec    int                      `json:"timeout_sec"`
	Enabled       bool                     `json:"enabled"`
	Status        int                      `json:"status"`
	Uptime24h     float64                  `json:"uptime_24h"`
	Uptime30d     float64                  `json:"uptime_30d"`
	AvgLatencyMS  int64                    `json:"avg_latency_ms"`
	LastLatencyMS int64                    `json:"last_latency_ms"`
	LastCheckedAt *time.Time               `json:"last_checked_at"`
	LastMessage   string                   `json:"last_message"`
	Heartbeats    []models.UptimeHeartbeat `json:"heartbeats"`
}

func MonitorView(m models.UptimeMonitor, admin bool) Monitor {
	v := Monitor{
		ID: m.ID, Name: m.Name, Group: m.Group, Type: m.Type, Source: "local",
		Target: m.Target, Keyword: m.Keyword, IntervalSec: m.IntervalSec, TimeoutSec: m.TimeoutSec,
		Enabled: m.Enabled, Status: m.Status, LastCheckedAt: m.LastCheckAt,
		LastLatencyMS: m.LastLatency, LastMessage: m.LastMessage, Heartbeats: []models.UptimeHeartbeat{},
	}
	if m.KumaSourceID != nil {
		v.Source = "kuma"
	}
	if !admin && (m.Type == "http" || m.Type == "keyword" || m.Type == "kuma") {
		v.Target = maskURL(m.Target, false)
	}
	if !v.Enabled {
		v.Status = Pending
	}
	return v
}

type UptimeSeriesPoint struct {
	T      time.Time `json:"t"`
	AvgMS  int64     `json:"avg_ms"`
	UpRate float64   `json:"up_rate"`
}

type UptimeSummary struct {
	HealthStatus    string              `json:"health_status"`
	OverallUptime24 float64             `json:"-"`
	OverallUptime   float64             `json:"overall_uptime"`
	AvgLatencyMS    int64               `json:"avg_latency_ms"`
	Total           int                 `json:"total"`
	Up              int                 `json:"up"`
	Down            int                 `json:"down"`
	Paused          int                 `json:"paused"`
	Pending         int                 `json:"-"`
	LatencySeries   []UptimeSeriesPoint `json:"latency_series"`
	Monitors        []Monitor           `json:"monitors"`
}

type beatStats struct {
	total, up, latency, latencyCount int64
}

func (a *beatStats) add(b models.UptimeHeartbeat) {
	if b.Status == Pending {
		return
	}
	a.total++
	if b.Status == Up {
		a.up++
		a.latency += b.LatencyMS
		a.latencyCount++
	}
}

func percentage(up, total int64) float64 {
	if total == 0 {
		return 0
	}
	return 100 * float64(up) / float64(total)
}

func (a beatStats) avg() int64 {
	if a.latencyCount == 0 {
		return 0
	}
	return (a.latency + a.latencyCount/2) / a.latencyCount
}

func health(active, failed, pending int) string {
	switch {
	case failed > 0 && failed == active:
		return "outage"
	case failed > 0 || pending > 0:
		return "degraded"
	default:
		return "operational"
	}
}

func (s *Service) Uptime(ctx context.Context, span time.Duration, admin bool) (UptimeSummary, error) {
	now := s.now()
	start, yesterday := now.Add(-span), now.Add(-24*time.Hour)
	db := s.dbFor(ctx)
	var monitors []models.UptimeMonitor
	out := UptimeSummary{Monitors: []Monitor{}, LatencySeries: []UptimeSeriesPoint{}}
	if err := db.Order("name, id").Find(&monitors).Error; err != nil {
		return out, err
	}
	if len(monitors) == 0 {
		out.HealthStatus = "operational"
		return out, nil
	}

	// Use SQL for the long-window uptime counts and read only the requested
	// series window and the display tail into Go.
	type rates struct {
		MonitorID           uint
		UpDay, Day          int64
		UpMonth, Month      int64
		Latency, LatencyNum int64
	}
	var aggregates []rates
	if err := db.Model(&models.UptimeHeartbeat{}).Select(`
		monitor_id,
		SUM(CASE WHEN checked_at >= ? AND status = 1 THEN 1 ELSE 0 END) AS up_day,
		SUM(CASE WHEN checked_at >= ? AND status IN (0,1) THEN 1 ELSE 0 END) AS day,
		SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS up_month,
		SUM(CASE WHEN status IN (0,1) THEN 1 ELSE 0 END) AS month,
		SUM(CASE WHEN checked_at >= ? AND status = 1 THEN latency_ms ELSE 0 END) AS latency,
		SUM(CASE WHEN checked_at >= ? AND status = 1 THEN 1 ELSE 0 END) AS latency_num`,
		yesterday, yesterday, start, start).
		Where("checked_at >= ? AND checked_at <= ?", now.Add(-retention), now).
		Group("monitor_id").Scan(&aggregates).Error; err != nil {
		return out, err
	}
	byID := make(map[uint]rates, len(aggregates))
	for _, rate := range aggregates {
		byID[rate.MonitorID] = rate
	}
	enabled := make(map[uint]bool, len(monitors))
	var uptime24Total float64
	var withUptime24 int
	for _, m := range monitors {
		v := MonitorView(m, admin)
		r := byID[m.ID]
		v.Uptime24h = percentage(r.UpDay, r.Day)
		v.Uptime30d = percentage(r.UpMonth, r.Month)
		v.AvgLatencyMS = (beatStats{latency: r.Latency, latencyCount: r.LatencyNum}).avg()
		assign(&v.Uptime24h, m.KumaUptime24)
		assign(&v.Uptime30d, m.KumaUptime30)
		if m.Enabled && (r.Day != 0 || m.KumaUptime24 != nil) {
			uptime24Total += v.Uptime24h
			withUptime24++
		}
		if err := db.Where("monitor_id = ?", m.ID).Order("checked_at DESC, id DESC").Limit(60).Find(&v.Heartbeats).Error; err != nil {
			return out, err
		}
		reverseBeats(v.Heartbeats)
		enabled[m.ID] = m.Enabled
		switch {
		case !m.Enabled:
			out.Paused++
		case m.Status == Up:
			out.Up++
		case m.Status == Down:
			out.Down++
		default:
			out.Pending++
		}
		out.Monitors = append(out.Monitors, v)
	}
	if withUptime24 > 0 {
		out.OverallUptime24 = uptime24Total / float64(withUptime24)
	}
	out.Total = len(monitors)
	out.HealthStatus = health(out.Total-out.Paused, out.Down, out.Pending)

	width := bucketWidth(span)
	buckets := make(map[time.Time]beatStats)
	perMonitor := make(map[uint]beatStats)
	rows, err := db.Model(&models.UptimeHeartbeat{}).
		Select("monitor_id", "checked_at", "status", "latency_ms").
		Where("checked_at >= ? AND checked_at <= ?", start, now).Rows()
	if err != nil {
		return out, err
	}
	defer rows.Close()
	var overall beatStats
	for rows.Next() {
		var b models.UptimeHeartbeat
		if err := rows.Scan(&b.MonitorID, &b.CheckedAt, &b.Status, &b.LatencyMS); err != nil {
			return out, err
		}
		if !enabled[b.MonitorID] || b.Status == Pending {
			continue
		}
		t := b.CheckedAt.UTC().Truncate(width)
		bucket := buckets[t]
		bucket.add(b)
		buckets[t] = bucket
		stats := perMonitor[b.MonitorID]
		stats.add(b)
		perMonitor[b.MonitorID] = stats
		overall.add(b)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	var uptimeTotal float64
	var withUptime int
	for _, m := range monitors {
		if !m.Enabled {
			continue
		}
		stats := perMonitor[m.ID]
		rate := percentage(stats.up, stats.total)
		known := stats.total != 0
		switch {
		case span == 24*time.Hour && m.KumaUptime24 != nil:
			rate, known = *m.KumaUptime24, true
		case span == retention && m.KumaUptime30 != nil:
			rate, known = *m.KumaUptime30, true
		}
		if known {
			uptimeTotal += rate
			withUptime++
		}
	}
	if withUptime != 0 {
		out.OverallUptime = uptimeTotal / float64(withUptime)
	}
	out.AvgLatencyMS = overall.avg()
	for t, bucket := range buckets {
		out.LatencySeries = append(out.LatencySeries, UptimeSeriesPoint{t, bucket.avg(), percentage(bucket.up, bucket.total)})
	}
	sort.Slice(out.LatencySeries, func(i, j int) bool { return out.LatencySeries[i].T.Before(out.LatencySeries[j].T) })
	return out, nil
}

func reverseBeats(beats []models.UptimeHeartbeat) {
	for i, j := 0, len(beats)-1; i < j; i, j = i+1, j-1 {
		beats[i], beats[j] = beats[j], beats[i]
	}
}

func (s *Service) MonitorHistory(ctx context.Context, id uint, span time.Duration) ([]models.UptimeHeartbeat, error) {
	db := s.dbFor(ctx)
	var m models.UptimeMonitor
	out := []models.UptimeHeartbeat{}
	if err := db.Select("id").First(&m, id).Error; err != nil {
		return out, err
	}
	now := s.now()
	err := db.Where("monitor_id = ? AND checked_at >= ? AND checked_at <= ?", id, now.Add(-span), now).
		Order("checked_at, id").Find(&out).Error
	return out, err
}

func (s *Service) Incidents(ctx context.Context, limit int) ([]models.UptimeIncident, error) {
	out := []models.UptimeIncident{}
	now := s.now()
	err := s.dbFor(ctx).Order("started_at DESC, id DESC").Limit(limit).Find(&out).Error
	for i := range out {
		if out[i].ResolvedAt == nil {
			out[i].DurationSec = max(0, int64(now.Sub(out[i].StartedAt)/time.Second))
		}
	}
	return out, err
}
