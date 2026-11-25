package statushub

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

type KumaInput struct {
	Name    string `json:"name"`
	BaseURL string `json:"base_url"`
	Slug    string `json:"slug"`
	Enabled *bool  `json:"enabled"`
}

func (s *Service) KumaSources(ctx context.Context) ([]models.UptimeKumaSource, error) {
	sources := []models.UptimeKumaSource{}
	err := s.dbFor(ctx).Order("id").Find(&sources).Error
	return sources, err
}

func (s *Service) CreateKumaSource(ctx context.Context, input KumaInput) (models.UptimeKumaSource, error) {
	source := models.UptimeKumaSource{
		Name: strings.TrimSpace(input.Name), BaseURL: strings.TrimSpace(input.BaseURL),
		Slug: strings.TrimSpace(input.Slug), Enabled: true,
	}
	assign(&source.Enabled, input.Enabled)
	base, err := httpURL(source.BaseURL)
	if err != nil {
		return source, err
	}
	if source.Name == "" || source.Slug == "" || strings.ContainsAny(source.Slug, "/?#%") || source.Slug == "." || source.Slug == ".." {
		return source, InputError("name and a valid status page slug are required")
	}
	if base.RawQuery != "" || base.Fragment != "" {
		return source, InputError("base_url must not contain a query or fragment")
	}
	source.BaseURL = strings.TrimRight(base.String(), "/")
	err = s.dbFor(ctx).Create(&source).Error
	return source, err
}

func (s *Service) DeleteKumaSource(ctx context.Context, id uint) error {
	unlock, err := s.lock("kuma", id)
	if err != nil {
		return err
	}
	defer unlock()
	return s.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var source models.UptimeKumaSource
		if err := tx.First(&source, id).Error; err != nil {
			return err
		}
		var ids []uint
		if err := tx.Model(&models.UptimeMonitor{}).Where("kuma_source_id = ?", id).Pluck("id", &ids).Error; err != nil {
			return err
		}
		for _, mid := range ids {
			if err := deleteMonitor(tx, mid); err != nil {
				return err
			}
		}
		return tx.Delete(&source).Error
	})
}

type kumaMonitor struct {
	ID   uint   `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

type kumaPage struct {
	Groups []struct {
		Name     string        `json:"name"`
		Monitors []kumaMonitor `json:"monitorList"`
	} `json:"publicGroupList"`
}

type kumaBeats struct {
	Beats map[string][]struct {
		Status int      `json:"status"`
		Ping   *float64 `json:"ping"`
		Time   string   `json:"time"`
		Msg    string   `json:"msg"`
	} `json:"heartbeatList"`
	Uptime map[string]float64 `json:"uptimeList"`
}

func (s *Service) fetchJSON(ctx context.Context, target string, dest any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return InputError("invalid status page URL")
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return InputError(safeNetworkError(err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return InputError(fmt.Sprintf("status page returned HTTP %d", resp.StatusCode))
	}
	limited := &io.LimitedReader{R: resp.Body, N: maxHTTPBody + 1}
	if err := json.NewDecoder(limited).Decode(dest); err != nil || limited.N == 0 {
		return InputError("invalid status page JSON")
	}
	return nil
}

const kumaSyncInterval = 2 * time.Minute

func (s *Service) SyncKuma(ctx context.Context, id uint, force bool) (models.UptimeKumaSource, error) {
	var source models.UptimeKumaSource
	unlock, err := s.lock("kuma", id)
	if err != nil {
		return source, err
	}
	defer unlock()
	db := s.dbFor(ctx)
	if err = db.First(&source, id).Error; err != nil {
		return source, err
	}
	if !force && (!source.Enabled || !kumaDue(source, s.now())) {
		return source, nil
	}
	var page kumaPage
	var beats kumaBeats
	base, err := httpURL(source.BaseURL)
	if err == nil {
		err = s.fetchJSON(ctx, base.JoinPath("api/status-page", source.Slug).String(), &page)
	}
	if err == nil && page.Groups == nil {
		err = InputError("status page monitor list is missing")
	}
	if err == nil {
		err = s.fetchJSON(ctx, base.JoinPath("api/status-page/heartbeat", source.Slug).String(), &beats)
	}
	if err == nil && beats.Beats == nil {
		err = InputError("status page heartbeat list is missing")
	}
	now := s.now()
	if err != nil {
		if ctx.Err() != nil {
			return source, ctx.Err()
		}
		source.LastError = err.Error()
		if saveErr := db.Model(&source).Updates(map[string]any{
			"last_error": source.LastError, "last_attempt_at": now,
		}).Error; saveErr != nil {
			return source, saveErr
		}
		return source, err
	}

	err = db.Transaction(func(tx *gorm.DB) error {
		var existing []models.UptimeMonitor
		if err := tx.Where("kuma_source_id = ?", source.ID).Find(&existing).Error; err != nil {
			return err
		}
		byKumaID := make(map[uint]models.UptimeMonitor, len(existing))
		for _, monitor := range existing {
			byKumaID[monitor.KumaID] = monitor
		}
		seen := make(map[uint]bool)
		for _, group := range page.Groups {
			for _, remote := range group.Monitors {
				if remote.ID == 0 || seen[remote.ID] {
					continue
				}
				seen[remote.ID] = true
				m := byKumaID[remote.ID]
				if m.ID == 0 {
					m = models.UptimeMonitor{KumaSourceID: &source.ID, KumaID: remote.ID, Type: "kuma", Status: Pending}
				}
				key := strconv.FormatUint(uint64(remote.ID), 10)
				m.Name, m.Group, m.Target, m.Enabled = remote.Name, group.Name, remote.URL, source.Enabled
				m.KumaUptime24, m.KumaUptime30 = kumaRate(beats.Uptime, key+"_24"), kumaRate(beats.Uptime, key+"_720")
				if err := tx.Save(&m).Error; err != nil {
					return err
				}
				points := make([]models.UptimeHeartbeat, 0, len(beats.Beats[key]))
				for _, point := range beats.Beats[key] {
					at := kumaTime(point.Time)
					if at.IsZero() || at.Before(now.Add(-retention)) || at.After(now.Add(5*time.Minute)) {
						continue
					}
					b := models.UptimeHeartbeat{MonitorID: m.ID, Status: Pending, CheckedAt: at, Message: point.Msg}
					if point.Status == Up || point.Status == Down {
						b.Status = point.Status
					}
					if point.Ping != nil {
						b.LatencyMS = int64(math.Round(max(0, *point.Ping)))
					}
					points = append(points, b)
				}
				sort.SliceStable(points, func(i, j int) bool { return points[i].CheckedAt.Before(points[j].CheckedAt) })
				for i := range points {
					if m.LastCheckAt == nil || points[i].CheckedAt.After(*m.LastCheckAt) {
						if err := recordBeat(tx, &m, &points[i]); err != nil {
							return err
						}
					}
				}
			}
		}
		for _, m := range existing {
			if !seen[m.KumaID] {
				if err := deleteMonitor(tx, m.ID); err != nil {
					return err
				}
			}
		}
		return tx.Model(&source).Updates(map[string]any{
			"last_synced_at": now, "last_error": "", "last_attempt_at": now,
		}).Error
	})
	if err == nil {
		source.LastSyncedAt, source.LastAttemptAt, source.LastError = &now, &now, ""
	}
	return source, err
}

func kumaDue(source models.UptimeKumaSource, now time.Time) bool {
	return source.LastAttemptAt == nil || !source.LastAttemptAt.Add(kumaSyncInterval).After(now)
}

func kumaTime(value string) time.Time {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.999999999", "2006-01-02T15:04:05.999999999"} {
		if t, err := time.Parse(layout, value); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

func kumaRate(rates map[string]float64, key string) *float64 {
	if rate, exists := rates[key]; exists && rate >= 0 && rate <= 1 {
		rate *= 100
		return &rate
	}
	return nil
}
