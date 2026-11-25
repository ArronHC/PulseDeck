package statushub

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
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

func (s *Service) testNodes(ctx context.Context, filter TestFilter, concurrency int, test func(context.Context, *models.SubNode) error) ([]Node, error) {
	db := s.dbFor(ctx)
	var nodes []models.SubNode
	query := db.Order("id")
	if filter.SubscriptionID != 0 {
		query = query.Where("subscription_id = ?", filter.SubscriptionID)
	}
	if filter.NodeIDs != nil {
		if len(filter.NodeIDs) > 1000 {
			return nil, InputError("node_ids may contain at most 1000 IDs")
		}
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
	names := (subscriptionData{sources: sources}).names()
	out := make([]Node, len(nodes))
	errs := make([]error, len(nodes))
	work := make(chan int, len(nodes))
	for i := range nodes {
		work <- i
	}
	close(work)
	var wg sync.WaitGroup
	for range min(concurrency, len(nodes)) {
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
			}
		})
	}
	wg.Wait()
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
	})
}

type speedResult struct {
	latency  int64
	download float64
	status   string
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
			result.message = "TCP fallback: " + errProxyCore.Error() + ". " + result.message
		default:
			var input InputError
			message := safeNetworkError(err)
			if errors.As(err, &input) {
				message = input.Error()
			}
			result = speedFailure(message, err)
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
		node.LatencyMS, node.DownloadMbps, node.TestStatus, node.TestMessage = result.latency, result.download, result.status, result.message
		node.TestedAt = &now
		if err := tx.Model(node).Select("LatencyMS", "DownloadMbps", "TestStatus", "TestMessage", "TestedAt").Updates(node).Error; err != nil {
			return err
		}
		if result.status == "ok" {
			return tx.Create(&models.SubSpeedSample{NodeID: node.ID, LatencyMS: result.latency, TestedAt: now}).Error
		}
		return nil
	})
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

func speedFailure(message string, err error) speedResult {
	status := "error"
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.As(err, &netErr) && netErr.Timeout() {
		status = "timeout"
	}
	return speedResult{latency: -1, status: status, message: message}
}

func tcpSpeed(ctx context.Context, n models.SubNode) speedResult {
	start := time.Now()
	dialer := net.Dialer{Timeout: 5 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(n.Host, strconv.Itoa(n.Port)))
	if err != nil {
		return speedFailure(safeNetworkError(err), err)
	}
	_ = conn.Close()
	return speedResult{latency: max(1, time.Since(start).Milliseconds()), status: "ok", message: "TCP connection established"}
}

func (s *Service) httpSpeed(ctx context.Context, client *http.Client, mode string) speedResult {
	target := s.testURL
	if mode == "download" {
		target = s.downloadURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return speedFailure("invalid speed test endpoint", err)
	}
	req.Header.Set("Accept-Encoding", "identity")
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return speedFailure(safeNetworkError(err), err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return speedFailure(fmt.Sprintf("speed test endpoint returned HTTP %d", resp.StatusCode), nil)
	}
	result := speedResult{latency: max(1, time.Since(start).Milliseconds()), status: "ok", message: "HTTP request succeeded"}
	if mode == "download" {
		bodyStart := time.Now()
		const downloadSize = 5_000_000
		n, err := io.Copy(io.Discard, io.LimitReader(resp.Body, downloadSize))
		if err != nil {
			return speedFailure(safeNetworkError(err), err)
		}
		if n == 0 {
			return speedFailure("speed test endpoint returned an empty body", nil)
		}
		result.download = float64(n) * 8 / max(time.Since(bodyStart).Seconds(), 0.001) / 1_000_000
		result.message = "download completed"
	}
	return result
}
