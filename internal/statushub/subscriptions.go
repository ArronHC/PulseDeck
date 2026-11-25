package statushub

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

type SubscriptionInput struct {
	Name            *string `json:"name"`
	URL             *string `json:"url"`
	RawContent      *string `json:"raw_content"`
	AutoUpdateHours *int    `json:"auto_update_hours"`
	Enabled         *bool   `json:"enabled"`
}

type NodePatch struct {
	Enabled     *bool    `json:"enabled"`
	CountryCode *string  `json:"country_code"`
	City        *string  `json:"city"`
	Lat         *float64 `json:"lat"`
	Lng         *float64 `json:"lng"`
}

func (s *Service) SaveSubscription(ctx context.Context, id uint, input SubscriptionInput) (models.SubSource, error) {
	db := s.dbFor(ctx)
	source := models.SubSource{Enabled: true, AutoUpdateHours: 12}
	var unlock func()
	var err error
	if id != 0 {
		unlock, err = s.lock("subscription", id)
		if err != nil {
			return source, err
		}
		defer unlock()
		if err := db.First(&source, id).Error; err != nil {
			return source, err
		}
	}

	previous := source
	assign(&source.Name, input.Name)
	assign(&source.URL, input.URL)
	assign(&source.RawContent, input.RawContent)
	assign(&source.AutoUpdateHours, input.AutoUpdateHours)
	assign(&source.Enabled, input.Enabled)
	source.Name, source.URL = strings.TrimSpace(source.Name), strings.TrimSpace(source.URL)
	if source.Name == "" {
		return source, InputError("name is required")
	}
	if source.AutoUpdateHours < 0 || source.AutoUpdateHours > 8760 {
		return source, InputError("auto_update_hours must be 0–8760")
	}
	if input.URL != nil && source.URL != "" && input.RawContent != nil && strings.TrimSpace(source.RawContent) != "" {
		return source, InputError("provide url or raw_content")
	}
	if source.URL == "" || input.RawContent != nil && strings.TrimSpace(*input.RawContent) != "" {
		source.SourceType, source.URL = "manual", ""
		if strings.TrimSpace(source.RawContent) == "" {
			return source, InputError("url or raw_content is required")
		}
	} else {
		source.SourceType, source.RawContent = "url", ""
		if _, err := httpURL(source.URL); err != nil {
			return source, err
		}
	}
	changed := id == 0 || previous.URL != source.URL || previous.RawContent != source.RawContent
	var nodes []models.SubNode
	var info usage
	if changed {
		nodes, info, err = s.loadSubscription(ctx, source)
		if err != nil {
			return source, err
		}
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&source).Error; err != nil {
			return err
		}
		if changed {
			return s.finishRefresh(tx, &source, nodes, info)
		}
		return nil
	})
	return source, err
}

func (s *Service) DeleteSubscription(ctx context.Context, id uint) error {
	unlock, err := s.lock("subscription", id)
	if err != nil {
		return err
	}
	defer unlock()
	return s.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var source models.SubSource
		if err := tx.Select("id").First(&source, id).Error; err != nil {
			return err
		}
		ids := tx.Model(&models.SubNode{}).Select("id").Where("subscription_id = ?", id)
		if err := tx.Where("node_id IN (?)", ids).Delete(&models.SubSpeedSample{}).Error; err != nil {
			return err
		}
		if err := tx.Where("subscription_id = ?", id).Delete(&models.SubNode{}).Error; err != nil {
			return err
		}
		return tx.Delete(&source).Error
	})
}

func subscriptionDue(source models.SubSource, now time.Time) bool {
	return source.AutoUpdateHours > 0 &&
		(source.LastAttemptAt == nil || !source.LastAttemptAt.Add(time.Duration(source.AutoUpdateHours)*time.Hour).After(now))
}

func (s *Service) RefreshSubscription(ctx context.Context, id uint, force bool) (models.SubSource, error) {
	var source models.SubSource
	unlock, err := s.lock("subscription", id)
	if err != nil {
		return source, err
	}
	defer unlock()
	db := s.dbFor(ctx)
	if err = db.First(&source, id).Error; err != nil {
		return source, err
	}
	if !force && (!source.Enabled || source.SourceType != "url" || !subscriptionDue(source, s.now())) {
		return source, nil
	}
	nodes, info, err := s.loadSubscription(ctx, source)
	if err != nil {
		if ctx.Err() != nil {
			return source, ctx.Err()
		}
		now := s.now()
		source.LastError, source.LastAttemptAt = err.Error(), &now
		if saveErr := db.Model(&source).Updates(map[string]any{
			"last_attempt_at": now, "last_error": source.LastError,
		}).Error; saveErr != nil {
			return source, saveErr
		}
		return source, err
	}
	err = db.Transaction(func(tx *gorm.DB) error { return s.finishRefresh(tx, &source, nodes, info) })
	return source, err
}

func (s *Service) loadSubscription(ctx context.Context, source models.SubSource) ([]models.SubNode, usage, error) {
	var info usage
	content := source.RawContent
	if source.SourceType == "url" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, source.URL, nil)
		if err != nil {
			return nil, info, InputError("invalid subscription URL")
		}
		req.Header.Set("User-Agent", "Komari-Status-Hub/1.0")
		resp, err := s.http.Do(req)
		if err != nil {
			return nil, info, InputError(safeNetworkError(err))
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, info, InputError(fmt.Sprintf("subscription returned HTTP %d", resp.StatusCode))
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, maxHTTPBody+1))
		if err != nil {
			return nil, info, InputError(safeNetworkError(err))
		}
		content = string(data)
		info = parseUserinfo(resp.Header.Get("Subscription-Userinfo"))
	}
	nodes, err := parseSubscription(content)
	return nodes, info, err
}

type nodeEndpoint struct {
	name, host string
	port       int
}

func (s *Service) finishRefresh(tx *gorm.DB, source *models.SubSource, nodes []models.SubNode, info usage) error {
	var existing []models.SubNode
	if err := tx.Where("subscription_id = ?", source.ID).Find(&existing).Error; err != nil {
		return err
	}
	oldByFingerprint := make(map[string]models.SubNode, len(existing))
	oldByEndpoint := make(map[nodeEndpoint][]models.SubNode)
	for _, old := range existing {
		oldByFingerprint[old.Fingerprint] = old
		key := nodeEndpoint{old.Name, old.Host, old.Port}
		oldByEndpoint[key] = append(oldByEndpoint[key], old)
	}
	incomingFingerprints := make(map[string]bool, len(nodes))
	for _, n := range nodes {
		incomingFingerprints[n.Fingerprint] = true
	}
	seen := make(map[uint]bool, len(existing))
	var added []models.SubNode
	for _, n := range nodes {
		n.SubscriptionID = source.ID
		old, matched := oldByFingerprint[n.Fingerprint]
		if !matched {
			candidates := oldByEndpoint[nodeEndpoint{n.Name, n.Host, n.Port}]
			if len(candidates) == 1 && !seen[candidates[0].ID] {
				old = candidates[0]
				// Prefer the exact match if both old and new protocols exist.
				matched = !incomingFingerprints[old.Fingerprint]
			}
		}
		if !matched {
			added = append(added, n)
			continue
		}
		seen[old.ID] = true
		updates := map[string]any{
			"name": n.Name, "host": n.Host, "port": n.Port, "protocol": n.Protocol,
			"fingerprint": n.Fingerprint, "config_kind": n.ConfigKind, "raw_config": n.RawConfig,
		}
		if !old.GeoManual && (old.IPPure == nil || !old.HasCoordinates) {
			updates["country_code"], updates["country_name"], updates["city"] = n.CountryCode, n.CountryName, n.City
			updates["lat"], updates["lng"], updates["has_coordinates"] = n.Lat, n.Lng, n.HasCoordinates
		}
		if err := tx.Model(&old).Updates(updates).Error; err != nil {
			return err
		}
	}
	if len(added) > 0 {
		if err := tx.CreateInBatches(&added, 30).Error; err != nil {
			return err
		}
	}
	for _, old := range existing {
		if seen[old.ID] {
			continue
		}
		if err := tx.Where("node_id = ?", old.ID).Delete(&models.SubSpeedSample{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&old).Error; err != nil {
			return err
		}
	}
	now := s.now()
	source.Upload, source.Download, source.Total, source.Expire = info.Upload, info.Download, info.Total, info.Expire
	source.LastSyncedAt, source.LastAttemptAt, source.LastError = &now, &now, ""
	return tx.Model(source).Updates(map[string]any{
		"upload": info.Upload, "download": info.Download, "total": info.Total, "expire": info.Expire,
		"last_attempt_at": now, "last_synced_at": now, "last_error": "",
	}).Error
}

func (s *Service) PatchNode(ctx context.Context, id uint, patch NodePatch) (Node, error) {
	var n models.SubNode
	db := s.dbFor(ctx)
	// Geo updates and refresh share the subscription lock. The test write
	// applies geo conditionally against the current GeoManual flag.
	if err := db.Select("subscription_id").First(&n, id).Error; err != nil {
		return Node{}, err
	}
	unlock, err := s.lock("subscription", n.SubscriptionID)
	if err != nil {
		return Node{}, err
	}
	defer unlock()
	if patch.Lat != nil && !validCoordinate(*patch.Lat, 90) || patch.Lng != nil && !validCoordinate(*patch.Lng, 180) {
		return Node{}, InputError("latitude or longitude is out of range")
	}
	var source models.SubSource
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&n, id).Error; err != nil {
			return err
		}
		if err := tx.Select("name").First(&source, n.SubscriptionID).Error; err != nil {
			return err
		}
		updates := make(map[string]any)
		if patch.Enabled != nil {
			n.Enabled = *patch.Enabled
			updates["enabled"] = n.Enabled
		}
		if patch.CountryCode == nil && patch.City == nil && patch.Lat == nil && patch.Lng == nil {
			return tx.Model(&n).Updates(updates).Error
		}
		if patch.CountryCode != nil {
			code := strings.ToUpper(strings.TrimSpace(*patch.CountryCode))
			value := countryGeo(code)
			if code != "" && value.code == "" {
				return InputError("country_code must be an ISO alpha-2 country code")
			}
			if n.CountryCode != code {
				n.CountryCode, n.CountryName, n.City = value.code, value.country, value.city
				n.Lat, n.Lng, n.HasCoordinates = value.lat, value.lng, value.located
			}
		}
		if patch.City != nil {
			n.City = strings.TrimSpace(*patch.City)
			if city := resolveGeo(n.City); n.CountryCode == city.code && city.located && n.City != "" {
				n.Lat, n.Lng, n.HasCoordinates = city.lat, city.lng, true
			}
		}
		assign(&n.Lat, patch.Lat)
		assign(&n.Lng, patch.Lng)
		if patch.Lat != nil && patch.Lng != nil {
			n.HasCoordinates = true
		}
		n.GeoManual = true
		updates["country_code"], updates["country_name"], updates["city"] = n.CountryCode, n.CountryName, n.City
		updates["lat"], updates["lng"], updates["has_coordinates"], updates["geo_manual"] = n.Lat, n.Lng, n.HasCoordinates, true
		return tx.Model(&n).Updates(updates).Error
	})
	return NodeView(n, source.Name), err
}

func validCoordinate(value, limit float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= -limit && value <= limit
}

func requireRows(result *gorm.DB) error {
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrChanged
	}
	return nil
}

func jobError(err error) bool {
	return err != nil && !errors.Is(err, ErrBusy) && !errors.Is(err, context.Canceled) && !errors.Is(err, gorm.ErrRecordNotFound)
}
