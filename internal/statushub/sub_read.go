package statushub

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/komari-monitor/komari/database/models"
)

type Subscription struct {
	ID              uint       `json:"id"`
	Name            string     `json:"name"`
	SourceType      string     `json:"source_type"`
	MaskedURL       string     `json:"masked_url"`
	Upload          int64      `json:"upload"`
	Download        int64      `json:"download"`
	Total           int64      `json:"total"`
	Expire          int64      `json:"expire"`
	NodeCount       int        `json:"node_count"`
	AvailableCount  int        `json:"available_count"`
	AutoUpdateHours int        `json:"auto_update_hours"`
	Enabled         bool       `json:"enabled"`
	LastSyncedAt    *time.Time `json:"last_synced_at"`
	LastError       string     `json:"last_error"`
	URL             string     `json:"url,omitempty"`
	RawContent      string     `json:"raw_content,omitempty"`
}

type Node struct {
	ID               uint                 `json:"id"`
	SubscriptionID   uint                 `json:"subscription_id"`
	SubscriptionName string               `json:"subscription_name"`
	Name             string               `json:"name"`
	Protocol         string               `json:"protocol"`
	Host             string               `json:"host"`
	Port             int                  `json:"port"`
	CountryCode      string               `json:"country_code"`
	CountryName      string               `json:"country_name"`
	City             string               `json:"city"`
	Lat              float64              `json:"lat"`
	Lng              float64              `json:"lng"`
	Enabled          bool                 `json:"enabled"`
	LatencyMS        int64                `json:"latency_ms"`
	DownloadMbps     float64              `json:"download_mbps"`
	TestStatus       string               `json:"test_status"`
	TestMessage      string               `json:"test_message"`
	TestedAt         *time.Time           `json:"tested_at"`
	IPPure           *models.IPPureResult `json:"ippure"`
	IPPureError      string               `json:"ippure_error,omitempty"`
}

func NodeView(node models.SubNode, subscriptionName string) Node {
	var purityError string
	purity := node.IPPure
	if purity != nil {
		purityError = purity.Error
		if purity.FraudScore == nil {
			copy := *purity
			score := -1
			copy.FraudScore = &score
			purity = &copy
		}
	}
	return Node{
		ID: node.ID, SubscriptionID: node.SubscriptionID, SubscriptionName: subscriptionName,
		Name: node.Name, Protocol: node.Protocol, Host: node.Host, Port: node.Port,
		CountryCode: node.CountryCode, CountryName: node.CountryName, City: node.City, Lat: node.Lat, Lng: node.Lng,
		Enabled: node.Enabled, LatencyMS: node.LatencyMS, DownloadMbps: node.DownloadMbps,
		TestStatus: node.TestStatus, TestMessage: node.TestMessage, TestedAt: node.TestedAt, IPPure: purity, IPPureError: purityError,
	}
}

type NodeFilter struct {
	SubscriptionID uint
	Country        string
	Search         string
	OnlyEnabled    bool
}

type subscriptionData struct {
	sources []models.SubSource
	nodes   []models.SubNode
}

func (s *Service) readSubscriptions(ctx context.Context, secrets bool, filter NodeFilter) (subscriptionData, error) {
	var data subscriptionData
	db := s.dbFor(ctx)
	sourceQuery := db.Order("name, id")
	if !secrets {
		sourceQuery = sourceQuery.Omit("raw_content")
	}
	if err := sourceQuery.Find(&data.sources).Error; err != nil {
		return data, err
	}
	query := db.Omit("raw_config").Order("name, id")
	if filter.SubscriptionID != 0 {
		query = query.Where("subscription_id = ?", filter.SubscriptionID)
	}
	if filter.Country != "" {
		query = query.Where("country_code = ?", strings.ToUpper(filter.Country))
	}
	if filter.OnlyEnabled {
		query = query.Where("enabled = ?", true).Where("subscription_id IN (?)",
			db.Model(&models.SubSource{}).Select("id").Where("enabled = ?", true))
	}
	if err := query.Find(&data.nodes).Error; err != nil {
		return data, err
	}
	if filter.Search != "" {
		search := strings.ToLower(filter.Search)
		names := data.names()
		out := data.nodes[:0]
		for _, n := range data.nodes {
			text := strings.ToLower(strings.Join([]string{n.Name, names[n.SubscriptionID], n.Host, n.City, n.CountryName, n.Protocol}, "\x00"))
			if strings.Contains(text, search) {
				out = append(out, n)
			}
		}
		data.nodes = out
	}
	return data, nil
}

func (data subscriptionData) names() map[uint]string {
	names := make(map[uint]string, len(data.sources))
	for _, source := range data.sources {
		names[source.ID] = source.Name
	}
	return names
}

func (data subscriptionData) bySource() map[uint][]models.SubNode {
	out := make(map[uint][]models.SubNode, len(data.sources))
	for _, node := range data.nodes {
		out[node.SubscriptionID] = append(out[node.SubscriptionID], node)
	}
	return out
}

func (s *Service) Subscriptions(ctx context.Context, admin bool) ([]Subscription, error) {
	data, err := s.readSubscriptions(ctx, admin, NodeFilter{})
	out := make([]Subscription, 0, len(data.sources))
	if err != nil {
		return out, err
	}
	bySource := data.bySource()
	for _, source := range data.sources {
		out = append(out, subscriptionView(source, bySource[source.ID], admin))
	}
	return out, nil
}

func (s *Service) Subscription(ctx context.Context, source models.SubSource) (Subscription, error) {
	var nodes []models.SubNode
	err := s.dbFor(ctx).Select("id", "enabled", "test_status").Where("subscription_id = ?", source.ID).Find(&nodes).Error
	return subscriptionView(source, nodes, true), err
}

func subscriptionView(source models.SubSource, nodes []models.SubNode, admin bool) Subscription {
	v := Subscription{
		ID: source.ID, Name: source.Name, SourceType: source.SourceType, MaskedURL: maskURL(source.URL, true),
		Upload: source.Upload, Download: source.Download, Total: source.Total, Expire: source.Expire,
		NodeCount: len(nodes), AutoUpdateHours: source.AutoUpdateHours, Enabled: source.Enabled,
		LastSyncedAt: source.LastSyncedAt, LastError: source.LastError,
	}
	for _, n := range nodes {
		if source.Enabled && available(n) {
			v.AvailableCount++
		}
	}
	if admin {
		v.URL, v.RawContent = source.URL, source.RawContent
	}
	return v
}

func available(n models.SubNode) bool {
	return n.Enabled && n.TestStatus == "ok"
}

func (s *Service) Nodes(ctx context.Context, filter NodeFilter) ([]Node, error) {
	data, err := s.readSubscriptions(ctx, false, filter)
	names := data.names()
	out := make([]Node, 0, len(data.nodes))
	for _, n := range data.nodes {
		out = append(out, NodeView(n, names[n.SubscriptionID]))
	}
	return out, err
}

type CountrySummary struct {
	CountryCode      string  `json:"country_code"`
	CountryName      string  `json:"country_name"`
	Lat              float64 `json:"lat"`
	Lng              float64 `json:"lng"`
	NodeCount        int     `json:"node_count"`
	AvailableCount   int     `json:"available_count"`
	MinLatencyMS     int64   `json:"min_latency_ms"`
	AvgLatencyMS     int64   `json:"avg_latency_ms"`
	AvgFraudScore    float64 `json:"avg_fraud_score"`
	ResidentialCount int     `json:"residential_count"`
}

type MapMarker struct {
	NodeID        uint    `json:"node_id"`
	Name          string  `json:"name"`
	CountryCode   string  `json:"country_code"`
	City          string  `json:"city"`
	Lat           float64 `json:"lat"`
	Lng           float64 `json:"lng"`
	LatencyMS     int64   `json:"latency_ms"`
	FraudScore    int     `json:"fraud_score"`
	IsResidential bool    `json:"is_residential"`
}

type SubscriptionMap struct {
	Countries []CountrySummary `json:"countries"`
	Markers   []MapMarker      `json:"markers"`
}

type countryStats struct {
	summary                         CountrySummary
	latency, samples, score, scored int64
	coordinates                     bool
}

func validPurity(n models.SubNode) bool {
	return n.IPPure != nil && n.IPPure.Error == "" && n.IPPure.IP != ""
}

func (data subscriptionData) mapData() SubscriptionMap {
	out := SubscriptionMap{Countries: []CountrySummary{}, Markers: []MapMarker{}}
	byCountry := make(map[string]*countryStats)
	sources := make(map[uint]bool, len(data.sources))
	for _, source := range data.sources {
		sources[source.ID] = source.Enabled
	}
	for _, n := range data.nodes {
		if n.CountryCode == "" && !n.HasCoordinates {
			continue
		}
		marker := MapMarker{
			NodeID: n.ID, Name: n.Name, CountryCode: n.CountryCode, City: n.City,
			Lat: n.Lat, Lng: n.Lng, LatencyMS: n.LatencyMS, FraudScore: -1,
		}
		if validPurity(n) {
			if n.IPPure.FraudScore != nil {
				marker.FraudScore = *n.IPPure.FraudScore
			}
			marker.IsResidential = n.IPPure.IsResidential
		}
		if n.HasCoordinates {
			out.Markers = append(out.Markers, marker)
		}
		if n.CountryCode == "" {
			continue
		}
		group := byCountry[n.CountryCode]
		if group == nil {
			value := countryGeo(n.CountryCode)
			group = &countryStats{
				summary:     CountrySummary{CountryCode: n.CountryCode, CountryName: n.CountryName, Lat: value.lat, Lng: value.lng, AvgFraudScore: -1},
				coordinates: value.located,
			}
			byCountry[n.CountryCode] = group
		}
		if !group.coordinates && n.HasCoordinates {
			group.summary.Lat, group.summary.Lng, group.coordinates = n.Lat, n.Lng, true
		}
		group.summary.NodeCount++
		if sources[n.SubscriptionID] && available(n) {
			if group.samples == 0 || group.summary.MinLatencyMS > n.LatencyMS {
				group.summary.MinLatencyMS = n.LatencyMS
			}
			group.summary.AvailableCount++
			group.latency += n.LatencyMS
			group.samples++
		}
		if marker.FraudScore >= 0 {
			group.score += int64(marker.FraudScore)
			group.scored++
		}
		if marker.IsResidential {
			group.summary.ResidentialCount++
		}
	}
	for _, group := range byCountry {
		if group.samples > 0 {
			group.summary.AvgLatencyMS = group.latency / group.samples
		}
		if group.scored > 0 {
			group.summary.AvgFraudScore = float64(group.score) / float64(group.scored)
		}
		out.Countries = append(out.Countries, group.summary)
	}
	sort.Slice(out.Countries, func(i, j int) bool {
		a, b := out.Countries[i], out.Countries[j]
		if a.NodeCount != b.NodeCount {
			return a.NodeCount > b.NodeCount
		}
		return a.CountryCode < b.CountryCode
	})
	return out
}

func (s *Service) SubscriptionMap(ctx context.Context) (SubscriptionMap, error) {
	data, err := s.readSubscriptions(ctx, false, NodeFilter{})
	return data.mapData(), err
}
