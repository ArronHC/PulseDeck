package statushub

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/komari-monitor/komari/database/dbcore"
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
	locks       sync.Map
}

// New allows requests to share the same work locks as the background scheduler.
func New(db *gorm.DB) *Service {
	return &Service{
		db: db, http: &http.Client{Timeout: 25 * time.Second},
		now:       func() time.Time { return time.Now().UTC() },
		purityURL: purityURL, testURL: defaultTestURL, downloadURL: downloadURL,
	}
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
