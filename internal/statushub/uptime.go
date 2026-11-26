package statushub

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/komari-monitor/komari/database/models"
	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"
	"gorm.io/gorm"
)

const (
	Down = iota
	Up
	Pending
)

type MonitorInput struct {
	Name        *string `json:"name"`
	Group       *string `json:"group"`
	Type        *string `json:"type"`
	Target      *string `json:"target"`
	Keyword     *string `json:"keyword"`
	IntervalSec *int    `json:"interval_sec"`
	TimeoutSec  *int    `json:"timeout_sec"`
	Enabled     *bool   `json:"enabled"`
}

func assign[T any](dst *T, src *T) {
	if src != nil {
		*dst = *src
	}
}

func (s *Service) SaveMonitor(ctx context.Context, id uint, input MonitorInput) (models.UptimeMonitor, error) {
	db := s.dbFor(ctx)
	m := models.UptimeMonitor{IntervalSec: 60, TimeoutSec: 10, Enabled: true, Status: Pending}
	if id != 0 {
		unlock, err := s.lock("monitor", id)
		if err != nil {
			return m, err
		}
		defer unlock()
		if err := db.Where("kuma_source_id IS NULL").First(&m, id).Error; err != nil {
			return m, err
		}
	}
	assign(&m.Name, input.Name)
	assign(&m.Group, input.Group)
	assign(&m.Type, input.Type)
	assign(&m.Target, input.Target)
	assign(&m.Keyword, input.Keyword)
	assign(&m.IntervalSec, input.IntervalSec)
	assign(&m.TimeoutSec, input.TimeoutSec)
	assign(&m.Enabled, input.Enabled)
	m.Name, m.Target, m.Type = strings.TrimSpace(m.Name), strings.TrimSpace(m.Target), strings.ToLower(strings.TrimSpace(m.Type))
	if m.Name == "" || m.Target == "" {
		return m, InputError("name and target are required")
	}
	if m.IntervalSec < 1 || m.IntervalSec > 86400 || m.TimeoutSec < 1 || m.TimeoutSec > 120 {
		return m, InputError("interval_sec must be 1–86400 and timeout_sec must be 1–120")
	}
	switch m.Type {
	case "http", "keyword":
		if _, err := httpURL(m.Target); err != nil {
			return m, err
		}
		if m.Type == "keyword" && m.Keyword == "" {
			return m, InputError("keyword is required")
		}
	case "tcp", "ping":
		if _, _, err := networkTarget(m.Target, m.Type == "ping"); err != nil {
			return m, err
		}
	default:
		return m, InputError("type must be http, keyword, tcp, or ping")
	}
	err := db.Save(&m).Error
	return m, err
}

func (s *Service) DeleteMonitor(ctx context.Context, id uint) error {
	unlock, err := s.lock("monitor", id)
	if err != nil {
		return err
	}
	defer unlock()
	return s.dbFor(ctx).Transaction(func(tx *gorm.DB) error {
		var m models.UptimeMonitor
		if err := tx.Where("kuma_source_id IS NULL").First(&m, id).Error; err != nil {
			return err
		}
		return deleteMonitor(tx, id)
	})
}

func deleteMonitor(tx *gorm.DB, id uint) error {
	if err := tx.Where("monitor_id = ?", id).Delete(&models.UptimeHeartbeat{}).Error; err != nil {
		return err
	}
	if err := tx.Where("monitor_id = ?", id).Delete(&models.UptimeIncident{}).Error; err != nil {
		return err
	}
	return tx.Delete(&models.UptimeMonitor{}, id).Error
}

func (s *Service) CheckMonitor(ctx context.Context, id uint, force bool) (models.UptimeHeartbeat, error) {
	var beat models.UptimeHeartbeat
	unlock, err := s.lock("monitor", id)
	if err != nil {
		return beat, err
	}
	defer unlock()
	var m models.UptimeMonitor
	db := s.dbFor(ctx)
	if err := db.Where("kuma_source_id IS NULL").First(&m, id).Error; err != nil {
		return beat, err
	}
	if !force && (!m.Enabled || !monitorDue(m, s.now())) {
		return beat, nil
	}
	if isDemoMonitor(m) {
		now := s.now()
		beat = models.UptimeHeartbeat{
			MonitorID: id, Status: Up, Message: "200 OK",
			LatencyMS: demoMonitorLatency(m, now), CheckedAt: now,
		}
		err = db.Transaction(func(tx *gorm.DB) error {
			return recordBeat(tx, &m, &beat)
		})
		return beat, err
	}
	start := time.Now()
	outcome, message := s.check(ctx, m)
	if err := ctx.Err(); err != nil {
		return beat, err
	}
	beat = models.UptimeHeartbeat{
		MonitorID: id, Status: outcome, Message: message,
		LatencyMS: time.Since(start).Milliseconds(), CheckedAt: s.now(),
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		return recordBeat(tx, &m, &beat)
	})
	return beat, err
}

func monitorDue(m models.UptimeMonitor, now time.Time) bool {
	return m.LastCheckAt == nil || !m.LastCheckAt.Add(time.Duration(m.IntervalSec)*time.Second).After(now)
}

func recordBeat(tx *gorm.DB, m *models.UptimeMonitor, beat *models.UptimeHeartbeat) error {
	if err := tx.Create(beat).Error; err != nil {
		return err
	}
	if beat.Status != Pending {
		var incident models.UptimeIncident
		err := tx.Where("monitor_id = ? AND status = ?", m.ID, "down").Take(&incident).Error
		switch {
		case err != nil && !errors.Is(err, gorm.ErrRecordNotFound):
			return err
		case beat.Status == Down && errors.Is(err, gorm.ErrRecordNotFound):
			if err := tx.Create(&models.UptimeIncident{
				MonitorID: m.ID, MonitorName: m.Name, Status: "down", Message: beat.Message, StartedAt: beat.CheckedAt,
			}).Error; err != nil {
				return err
			}
		case beat.Status == Up && err == nil:
			if err := tx.Model(&incident).Updates(map[string]any{
				"status": "resolved", "resolved_at": beat.CheckedAt, "recovery": beat.Message,
				"duration_sec": int64(beat.CheckedAt.Sub(incident.StartedAt) / time.Second),
			}).Error; err != nil {
				return err
			}
		}
	}
	m.Status, m.LastLatency, m.LastMessage, m.LastCheckAt = beat.Status, beat.LatencyMS, beat.Message, &beat.CheckedAt
	return tx.Model(m).Updates(map[string]any{
		"status": m.Status, "last_latency": m.LastLatency, "last_message": m.LastMessage, "last_check_at": m.LastCheckAt,
	}).Error
}

func (s *Service) check(ctx context.Context, m models.UptimeMonitor) (int, string) {
	ctx, cancel := context.WithTimeout(ctx, time.Duration(m.TimeoutSec)*time.Second)
	defer cancel()
	switch m.Type {
	case "http", "keyword":
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.Target, nil)
		if err != nil {
			return Down, "invalid HTTP target"
		}
		client := *s.http
		client.Timeout = 0
		if m.Type == "http" {
			client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
		}
		resp, err := client.Do(req)
		if err != nil {
			return Down, safeNetworkError(err)
		}
		defer resp.Body.Close()
		message := fmt.Sprintf("%d %s", resp.StatusCode, http.StatusText(resp.StatusCode))
		if resp.StatusCode < 200 || resp.StatusCode >= 400 {
			return Down, strings.TrimSpace(message)
		}
		if m.Type == "keyword" {
			body, err := io.ReadAll(io.LimitReader(resp.Body, maxHTTPBody+1))
			switch {
			case err != nil:
				return Down, safeNetworkError(err)
			case bytes.Contains(body, []byte(m.Keyword)):
				return Up, "keyword found"
			case len(body) > maxHTTPBody:
				return Down, "keyword not found within the response size limit"
			default:
				return Down, "keyword not found"
			}
		}
		return Up, strings.TrimSpace(message)
	case "tcp", "ping":
		host, port, err := networkTarget(m.Target, m.Type == "ping")
		if err != nil {
			return Down, err.Error()
		}
		if m.Type == "ping" {
			remaining := time.Duration(m.TimeoutSec) * time.Second / 2
			pingCtx, stop := context.WithTimeout(ctx, remaining)
			err := icmpPing(pingCtx, host)
			stop()
			if err == nil {
				return Up, "ICMP reply received"
			}
		}
		conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(host, port))
		switch {
		case err == nil:
			conn.Close()
			return Up, "TCP connection established"
		case m.Type == "ping" && errors.Is(err, syscall.ECONNREFUSED):
			return Up, "host reachable (TCP connection refused)"
		default:
			return Down, safeNetworkError(err)
		}
	default:
		return Down, "unsupported monitor type"
	}
}

func networkTarget(target string, allowHostOnly bool) (string, string, error) {
	host, port, err := net.SplitHostPort(target)
	if err != nil && allowHostOnly {
		host, port = strings.Trim(target, "[]"), "443"
	}
	if !validHost(host) {
		return "", "", InputError("target must be a valid host or IP address")
	}
	if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
		return "", "", InputError("target must include a valid port")
	}
	return host, port, nil
}

func validHost(host string) bool {
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.Zone() == ""
	}
	if host == "" || len(host) > 253 {
		return false
	}
	for _, ch := range host {
		if (ch < 'a' || ch > 'z') && (ch < 'A' || ch > 'Z') && (ch < '0' || ch > '9') && ch != '.' && ch != '-' && ch != '_' {
			return false
		}
	}
	return true
}

func icmpPing(ctx context.Context, host string) error {
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return err
	}
	if len(ips) == 0 {
		return errors.New("no IP addresses")
	}
	ip := ips[0].IP
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	network, bind, protocol := "udp4", "0.0.0.0", 1
	var echo, reply icmp.Type = ipv4.ICMPTypeEcho, ipv4.ICMPTypeEchoReply
	if len(ip) == net.IPv6len {
		network, bind, protocol, echo, reply = "udp6", "::", 58, ipv6.ICMPTypeEchoRequest, ipv6.ICMPTypeEchoReply
	}
	conn, err := icmp.ListenPacket(network, bind)
	if err != nil {
		return err
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	deadline, _ := ctx.Deadline()
	_ = conn.SetDeadline(deadline)
	payload := binary.BigEndian.AppendUint64(nil, uint64(time.Now().UnixNano()))
	request := icmp.Message{Type: echo, Body: &icmp.Echo{Seq: 1, Data: payload}}
	wire, err := request.Marshal(nil)
	if err != nil {
		return err
	}
	if _, err := conn.WriteTo(wire, &net.UDPAddr{IP: ip, Zone: ips[0].Zone}); err != nil {
		return err
	}
	buf := make([]byte, 1500)
	for {
		n, addr, err := conn.ReadFrom(buf)
		if err != nil {
			return err
		}
		sender, ok := addr.(*net.UDPAddr)
		if !ok || !sender.IP.Equal(ip) {
			continue
		}
		received, err := icmp.ParseMessage(protocol, buf[:n])
		if err != nil || received.Type != reply {
			continue
		}
		if body, ok := received.Body.(*icmp.Echo); ok && bytes.Equal(body.Data, payload) {
			return nil
		}
	}
}
