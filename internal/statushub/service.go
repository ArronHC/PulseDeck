package statushub

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/komari-monitor/komari/database/auditlog"
	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/utils/messageSender"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	retention      = 30 * 24 * time.Hour
	checkLimit     = 16
	maxHTTPBody    = 8 << 20
	purityURL      = "https://my.ippure.com/v1/info"
	downloadURL    = "https://speed.cloudflare.com/__down?bytes=5000000"
	defaultTestURL = "https://www.gstatic.com/generate_204"
)

var (
	ErrChanged = errors.New("configuration changed while the check was running")
	ErrBusy    = errors.New("this operation is already running")
)

type InputError string

func (e InputError) Error() string { return string(e) }

type Service struct {
	db          *gorm.DB
	http        *http.Client
	now         func() time.Time
	purityURL   string
	testURL     string
	downloadURL string
	notify      func(models.EventMessage)
	locks       sync.Map
}

// New allows requests to share the same work locks as the background scheduler.
func New(db *gorm.DB) *Service {
	return &Service{
		db: db, http: &http.Client{Timeout: 25 * time.Second},
		now:       func() time.Time { return time.Now().UTC() },
		purityURL: purityURL, testURL: defaultTestURL, downloadURL: downloadURL,
		notify: func(ev models.EventMessage) { _ = messageSender.SendNotification(ev) },
	}
}

func (s *Service) emitAlert(ctx context.Context, event models.EventMessage, message string) {
	event.Message = message
	auditlog.EventLogWithDB(s.dbFor(context.WithoutCancel(ctx)), "warn", message)
	s.notify(event)
}

func (s *Service) dbFor(ctx context.Context) *gorm.DB {
	db := s.db
	if db == nil {
		db = dbcore.GetDBInstance()
	}
	// The main GORM logger may interpolate values into SQL errors. Hub tables
	// contain private URLs and credentials, so only log caller-safe errors.
	return db.WithContext(ctx).Session(&gorm.Session{Logger: db.Logger.LogMode(logger.Silent)})
}

type workKey struct {
	kind string
	id   uint
}

func (s *Service) lock(kind string, id uint) (func(), error) {
	key := workKey{kind, id}
	if _, busy := s.locks.LoadOrStore(key, struct{}{}); busy {
		return nil, ErrBusy
	}
	return func() { s.locks.Delete(key) }, nil
}

func httpURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, InputError("a valid HTTP or HTTPS URL is required")
	}
	return u, nil
}

func safeNetworkError(err error) string {
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.As(err, &netErr) && netErr.Timeout() {
		return "connection timed out"
	}
	if errors.Is(err, context.Canceled) {
		return "request canceled"
	}
	return "connection failed"
}

func maskHost(host string) string {
	if host == "" {
		return ""
	}
	if addr, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
		return maskIP(addr.String())
	}
	labels := strings.Split(strings.TrimSuffix(host, "."), ".")
	switch len(labels) {
	case 1:
		return "***"
	case 2:
		return "***." + labels[1]
	default:
		return "***." + strings.Join(labels[len(labels)-2:], ".")
	}
}

func maskIP(ip string) string {
	if ip == "" {
		return ""
	}
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return "***"
	}
	addr = addr.Unmap()
	if addr.Is4() {
		b := addr.As4()
		return fmt.Sprintf("%d.%d.*.*", b[0], b[1])
	}
	b := addr.As16()
	return fmt.Sprintf("%x:%x:*:*:*:*:*:*", uint16(b[0])<<8|uint16(b[1]), uint16(b[2])<<8|uint16(b[3]))
}

func maskURL(raw string, subscription bool) string {
	u, err := httpURL(raw)
	if err != nil {
		return ""
	}
	u.User, u.Fragment, u.RawFragment = nil, "", ""
	if !subscription {
		if u.RawQuery != "" {
			u.RawQuery = "***"
		}
		return u.String()
	}
	path := u.EscapedPath()
	switch path {
	case "/api/v1/client/subscribe", "/subscribe", "/subscription", "/api/subscribe":
	default:
		path = "/***"
	}
	if u.RawQuery == "" {
		if path != "/***" {
			path += "?***"
		}
		return u.Scheme + "://" + u.Host + path
	}
	var masked []string
	for _, key := range []string{"token", "auth", "key", "access_token"} {
		if u.Query().Has(key) {
			masked = append(masked, key+"=***")
		}
	}
	if len(masked) == 0 {
		masked = append(masked, "***")
	}
	return u.Scheme + "://" + u.Host + path + "?" + strings.Join(masked, "&")
}

func bucketWidth(span time.Duration) time.Duration {
	switch {
	case span <= 6*time.Hour:
		return 5 * time.Minute
	case span <= 24*time.Hour:
		return 30 * time.Minute
	case span <= 7*24*time.Hour:
		return 3 * time.Hour
	default:
		return 12 * time.Hour
	}
}

type Point struct {
	T time.Time `json:"t"`
	V float64   `json:"v"`
}
