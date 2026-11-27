package statushub

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
)

type TestFilter struct {
	NodeIDs        []uint `json:"node_ids"`
	SubscriptionID uint   `json:"subscription_id"`
}

type SpeedInput struct {
	TestFilter
	Mode        string `json:"mode"`
	Concurrency int    `json:"concurrency"`
}

type SpeedReportItem struct {
	NodeID       uint    `json:"node_id"`
	LatencyMS    int64   `json:"latency_ms"`
	DownloadMbps float64 `json:"download_mbps"`
	TestStatus   string  `json:"test_status"`
	TestMethod   string  `json:"test_method"`
	TestMessage  string  `json:"test_message"`
}

func (s *Service) SaveSpeedResults(ctx context.Context, items []SpeedReportItem) ([]Node, error) {
	if len(items) == 0 || len(items) > 1000 {
		return nil, InputError("provide 1–1000 speed results")
	}
	seen := make(map[uint]bool, len(items))
	for _, item := range items {
		switch item.TestMethod {
		case "", "browser_http", "browser_tcp", "browser_probe", "tcp", "proxy_http", "proxy_download", "tcp_fallback":
		default:
			return nil, InputError("invalid test_method")
		}
		switch item.TestStatus {
		case "ok":
			if item.LatencyMS < 0 || item.DownloadMbps < 0 || math.IsNaN(item.DownloadMbps) || math.IsInf(item.DownloadMbps, 0) {
				return nil, InputError("invalid speed test measurements")
			}
		case "error", "timeout", "untested", "unknown":
		default:
			return nil, InputError("test_status must be ok, error, timeout, untested, or unknown")
		}
		if item.NodeID == 0 || seen[item.NodeID] {
			return nil, InputError("speed results must specify unique node IDs")
		}
		seen[item.NodeID] = true
		unlock, err := s.lock("node-test", item.NodeID)
		if err != nil {
			return nil, err
		}
		defer unlock()
	}
	now := s.now()
	out := make([]Node, 0, len(items))
	err := s.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var sources []models.SubSource
		if err := tx.Select("id", "name").Find(&sources).Error; err != nil {
			return err
		}
		names := (subscriptionData{sources: sources}).names()
		for _, item := range items {
			var node models.SubNode
			if err := tx.First(&node, item.NodeID).Error; err != nil {
				return err
			}
			result := speedResult{
				latency: item.LatencyMS, download: item.DownloadMbps, status: item.TestStatus,
				method: item.TestMethod, message: strings.TrimSpace(item.TestMessage),
			}
			if result.status == "ok" && result.method == "" {
				result.method = "browser_http"
			}
			switch result.status {
			case "error", "timeout":
				result.latency, result.download = -1, 0
			case "untested", "unknown":
				result.latency, result.download = 0, 0
			}
			if err := saveSpeedResult(tx, &node, result, now); err != nil {
				return err
			}
			out = append(out, NodeView(node, names[node.SubscriptionID]))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) testNodes(
	ctx context.Context, filter TestFilter, concurrency int,
	test func(context.Context, *models.SubNode) error,
	onStart func(int), onResult func(int, int, Node),
) ([]Node, error) {
	if len(filter.NodeIDs) > 1000 {
		return nil, InputError("node_ids may contain at most 1000 IDs")
	}
	db := s.dbFor(ctx)
	var nodes []models.SubNode
	query := db.Order("id")
	if filter.SubscriptionID != 0 {
		query = query.Where("subscription_id = ?", filter.SubscriptionID)
	}
	if filter.NodeIDs != nil {
		query = query.Where("id IN ?", filter.NodeIDs)
	} else {
		query = query.Where("enabled = ?", true).Where("subscription_id IN (?)",
			db.Model(&models.SubSource{}).Select("id").Where("enabled = ?", true))
	}
	if err := query.Find(&nodes).Error; err != nil {
		return nil, err
	}
	var sources []models.SubSource
	if err := db.Select("id", "name").Find(&sources).Error; err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	names := (subscriptionData{sources: sources}).names()
	total := len(nodes)
	if onStart != nil {
		onStart(total)
	}
	out := make([]Node, total)
	errs := make([]error, total)
	work := make(chan int, total)
	finished := make(chan int, total)
	for i := range nodes {
		work <- i
	}
	close(work)
	var wg sync.WaitGroup
	for range min(concurrency, total) {
		wg.Go(func() {
			for i := range work {
				if ctx.Err() != nil {
					return
				}
				if unlock, err := s.lock("node-test", nodes[i].ID); err == nil {
					errs[i] = test(ctx, &nodes[i])
					unlock()
				}
				out[i] = NodeView(nodes[i], names[nodes[i].SubscriptionID])
				if onResult != nil && errs[i] == nil {
					finished <- i
				}
			}
		})
	}
	go func() {
		wg.Wait()
		close(finished)
	}()
	// Publish on the caller's goroutine so callbacks can safely write to an HTTP stream.
	completed := 0
	for i := range finished {
		if ctx.Err() == nil {
			completed++
			onResult(completed, total, out[i])
		}
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Service) CheckSpeed(ctx context.Context, input SpeedInput) ([]Node, error) {
	return s.CheckSpeedStream(ctx, input, nil, nil)
}

// CheckSpeedStream reports results in completion order and returns them in node ID order.
func (s *Service) CheckSpeedStream(
	ctx context.Context, input SpeedInput,
	onStart func(total int), onResult func(completed, total int, node Node),
) ([]Node, error) {
	if input.Mode == "" {
		input.Mode = "tcp"
	}
	if input.Mode != "tcp" && input.Mode != "http" && input.Mode != "download" {
		return nil, InputError("mode must be tcp, http, or download")
	}
	if input.Concurrency == 0 {
		input.Concurrency = 8
	}
	if input.Concurrency < 1 || input.Concurrency > 32 {
		return nil, InputError("concurrency must be 1–32")
	}
	return s.testNodes(ctx, input.TestFilter, input.Concurrency, func(ctx context.Context, node *models.SubNode) error {
		return s.nodeSpeed(ctx, node, input.Mode)
	}, onStart, onResult)
}

type speedResult struct {
	latency  int64
	download float64
	status   string
	method   string
	message  string
}

func (s *Service) nodeSpeed(ctx context.Context, node *models.SubNode, mode string) error {
	perCheck, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	var result speedResult
	if mode == "tcp" {
		result = tcpSpeed(perCheck, *node)
	} else {
		client, closeClient, err := s.clientForNode(perCheck, *node)
		switch {
		case err == nil:
			defer closeClient()
			result = s.httpSpeed(perCheck, client, mode)
		case errors.Is(err, errProxyCore):
			result = tcpSpeed(perCheck, *node)
			result.method = "tcp_fallback"
			result.message = "TCP fallback: " + errProxyCore.Error() + ". " + result.message
		default:
			var input InputError
			message := safeNetworkError(err)
			if errors.As(err, &input) {
				message = input.Error()
			}
			result = speedFailure(proxySpeedMethod(mode), message, err)
		}
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	now := s.now()
	return s.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		if err := currentNode(tx, node); err != nil {
			return err
		}
		return saveSpeedResult(tx, node, result, now)
	})
}

func saveSpeedResult(tx *gorm.DB, node *models.SubNode, result speedResult, now time.Time) error {
	node.LatencyMS, node.DownloadMbps = result.latency, result.download
	node.TestStatus, node.TestMethod, node.TestMessage = result.status, result.method, result.message
	node.TestedAt = &now
	if err := tx.Model(node).Select("LatencyMS", "DownloadMbps", "TestStatus", "TestMethod", "TestMessage", "TestedAt").Updates(node).Error; err != nil {
		return err
	}
	if result.status == "ok" {
		return tx.Create(&models.SubSpeedSample{NodeID: node.ID, LatencyMS: result.latency, TestedAt: now}).Error
	}
	return nil
}

func currentNode(tx *gorm.DB, snapshot *models.SubNode) error {
	var current models.SubNode
	if err := tx.First(&current, snapshot.ID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrChanged
		}
		return err
	}
	if snapshot.RawConfig != current.RawConfig || snapshot.ConfigKind != current.ConfigKind || snapshot.Fingerprint != current.Fingerprint {
		return ErrChanged
	}
	*snapshot = current
	return nil
}

func speedFailure(method, message string, err error) speedResult {
	status := "error"
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.As(err, &netErr) && netErr.Timeout() {
		status = "timeout"
	}
	return speedResult{latency: -1, status: status, method: method, message: message}
}

func tcpSpeed(ctx context.Context, n models.SubNode) speedResult {
	start := time.Now()
	dialer := net.Dialer{Timeout: 5 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(n.Host, strconv.Itoa(n.Port)))
	if err != nil {
		return speedFailure("tcp", safeNetworkError(err), err)
	}
	_ = conn.Close()
	return speedResult{latency: max(1, time.Since(start).Milliseconds()), status: "ok", method: "tcp", message: "TCP connection established"}
}

func proxySpeedMethod(mode string) string {
	if mode == "download" {
		return "proxy_download"
	}
	return "proxy_http"
}

func (s *Service) httpSpeed(ctx context.Context, client *http.Client, mode string) speedResult {
	method := proxySpeedMethod(mode)
	target := s.testURL
	if mode == "download" {
		target = s.downloadURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return speedFailure(method, "invalid speed test endpoint", err)
	}
	req.Header.Set("Accept-Encoding", "identity")
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return speedFailure(method, safeNetworkError(err), err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return speedFailure(method, fmt.Sprintf("speed test endpoint returned HTTP %d", resp.StatusCode), nil)
	}
	result := speedResult{latency: max(1, time.Since(start).Milliseconds()), status: "ok", method: method, message: "HTTP request succeeded"}
	if mode == "download" {
		bodyStart := time.Now()
		const downloadSize = 5_000_000
		n, err := io.Copy(io.Discard, io.LimitReader(resp.Body, downloadSize))
		if err != nil {
			return speedFailure(method, safeNetworkError(err), err)
		}
		if n == 0 {
			return speedFailure(method, "speed test endpoint returned an empty body", nil)
		}
		result.download = float64(n) * 8 / max(time.Since(bodyStart).Seconds(), 0.001) / 1_000_000
		result.message = "download completed"
	}
	return result
}
