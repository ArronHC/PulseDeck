package statushub

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/komari-monitor/komari/database/models"
	messageevent "github.com/komari-monitor/komari/database/models/messageEvent"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type flexibleNumber struct {
	value float64
	valid bool
}

func (n *flexibleNumber) UnmarshalJSON(raw []byte) error {
	if bytes.Equal(raw, []byte("null")) {
		return nil
	}
	value := string(raw)
	if len(raw) > 0 && raw[0] == '"' {
		if err := json.Unmarshal(raw, &value); err != nil {
			return err
		}
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err == nil {
		n.value, n.valid = v, true
	}
	return nil
}

func (n flexibleNumber) coord(limit float64) *float64 {
	if n.valid && validCoordinate(n.value, limit) {
		return &n.value
	}
	return nil
}

func parseIPPure(r io.Reader) (models.IPPureResult, error) {
	var payload struct {
		IP             string         `json:"ip"`
		ASN            flexibleNumber `json:"asn"`
		ASOrganization string         `json:"asOrganization"`
		Country        string         `json:"country"`
		CountryCode    string         `json:"countryCode"`
		Region         string         `json:"region"`
		RegionCode     string         `json:"regionCode"`
		City           string         `json:"city"`
		Timezone       string         `json:"timezone"`
		Longitude      flexibleNumber `json:"longitude"`
		Latitude       flexibleNumber `json:"latitude"`
		PostalCode     string         `json:"postalCode"`
		FraudScore     *int           `json:"fraudScore"`
		IsResidential  bool           `json:"isResidential"`
		IsBroadcast    bool           `json:"isBroadcast"`
	}
	if err := json.NewDecoder(r).Decode(&payload); err != nil || net.ParseIP(payload.IP) == nil {
		return models.IPPureResult{}, InputError("IPPure returned an invalid response")
	}
	code := strings.ToUpper(strings.TrimSpace(payload.CountryCode))
	if mark := countryGeo(code); mark.code == "" {
		code = ""
	}
	var asn int64
	if payload.ASN.valid && payload.ASN.value >= 0 && payload.ASN.value <= 4294967295 {
		asn = int64(payload.ASN.value)
	}
	if payload.FraudScore != nil && (*payload.FraudScore < 0 || *payload.FraudScore > 100) {
		payload.FraudScore = nil
	}
	return models.IPPureResult{
		IP: payload.IP, ASN: asn, ASOrganization: payload.ASOrganization, Country: payload.Country, CountryCode: code,
		Region: payload.Region, RegionCode: payload.RegionCode, City: payload.City, Timezone: payload.Timezone,
		Longitude: payload.Longitude.coord(180), Latitude: payload.Latitude.coord(90), PostalCode: payload.PostalCode,
		FraudScore: payload.FraudScore, IsResidential: payload.IsResidential, IsBroadcast: payload.IsBroadcast,
	}, nil
}

func (s *Service) fetchIPPure(ctx context.Context, client *http.Client) (models.IPPureResult, error) {
	var result models.IPPureResult
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.purityURL, nil)
	if err != nil {
		return result, InputError("invalid IPPure endpoint")
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return result, InputError(safeNetworkError(err))
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return result, InputError(fmt.Sprintf("IPPure returned HTTP %d", resp.StatusCode))
	}
	return parseIPPure(io.LimitReader(resp.Body, 1<<20))
}

func (s *Service) CheckIPPure(ctx context.Context, explicitProxy string) (models.IPPureResult, error) {
	var proxy *url.URL
	if explicitProxy != "" {
		var err error
		proxy, err = proxyURL(explicitProxy)
		if err != nil {
			return models.IPPureResult{}, err
		}
	}
	client, closeClient := s.clientForProxy(proxy)
	defer closeClient()
	result, err := s.fetchIPPure(ctx, client)
	if err != nil {
		return result, err
	}
	now := s.now()
	result.CheckedAt = &now
	if proxy == nil {
		cache := models.IPPureSelfCache{ID: 1, Result: result}
		err = s.dbFor(ctx).Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.AssignmentColumns([]string{"result"}),
		}).Create(&cache).Error
	}
	return result, err
}

func (s *Service) IPPureSelf(ctx context.Context, admin bool) (*models.IPPureResult, error) {
	var cache models.IPPureSelfCache
	if err := s.dbFor(ctx).First(&cache, 1).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if !admin {
		cache.Result.IP = maskIP(cache.Result.IP)
	}
	return &cache.Result, nil
}

func (s *Service) CheckNodePurity(ctx context.Context, filter TestFilter) ([]Node, error) {
	return s.testNodes(ctx, filter, 8, s.nodePurity, nil, nil)
}

func (s *Service) nodePurity(ctx context.Context, node *models.SubNode) error {
	perCheck, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var result models.IPPureResult
	client, closeClient, err := s.clientForNode(perCheck, *node)
	if err == nil {
		defer closeClient()
		result, err = s.fetchIPPure(perCheck, client)
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		switch {
		case errors.Is(err, errProxyCore):
			result.Error = errProxyCore.Error()
		default:
			var input InputError
			if errors.As(err, &input) {
				result.Error = input.Error()
			} else {
				result.Error = safeNetworkError(err)
			}
		}
	}
	now := s.now()
	result.CheckedAt = &now
	var message string
	saveErr := s.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		if err := currentNode(tx, node); err != nil {
			return err
		}
		prev := node.IPPure
		if err == nil && purityDegraded(prev, result) && (node.PurityAlertedAt == nil || now.Sub(*node.PurityAlertedAt) >= 6*time.Hour) {
			node.PurityAlertedAt = &now
			message = fmt.Sprintf("IP quality degraded for subscription node %d (%s). Fraud score %d → %d, residential %t → %t, broadcast %t → %t.",
				node.ID, maskedNodeName(*node), *prev.FraudScore, *result.FraudScore,
				prev.IsResidential, result.IsResidential, prev.IsBroadcast, result.IsBroadcast)
		}
		node.IPPure = &result
		if !node.GeoManual && result.Latitude != nil && result.Longitude != nil && result.CountryCode != "" {
			country := result.Country
			if country == "" {
				country = countryGeo(result.CountryCode).country
			}
			node.CountryCode, node.CountryName, node.City = result.CountryCode, country, result.City
			node.Lat, node.Lng, node.HasCoordinates = *result.Latitude, *result.Longitude, true
		}
		return tx.Model(node).Select("IPPure", "PurityAlertedAt", "CountryCode", "CountryName", "City", "Lat", "Lng", "HasCoordinates").Updates(node).Error
	})
	if saveErr == nil && message != "" {
		s.emitAlert(ctx, models.EventMessage{Event: messageevent.Alert, Time: now, Emoji: "⚠️"}, message)
	}
	return saveErr
}

func purityDegraded(prev *models.IPPureResult, result models.IPPureResult) bool {
	if prev == nil || prev.Error != "" || prev.FraudScore == nil || result.Error != "" || result.FraudScore == nil {
		return false
	}
	oldScore, newScore := *prev.FraudScore, *result.FraudScore
	return newScore >= 75 && oldScore < 75 || newScore-oldScore >= 20 && newScore >= 50 ||
		prev.IsResidential && !result.IsResidential || !prev.IsBroadcast && result.IsBroadcast
}
