package models

import "time"

type UptimeMonitor struct {
	ID           uint
	Name         string
	Group        string
	Type         string
	Target       string `gorm:"type:text"`
	Keyword      string `gorm:"type:text"`
	IntervalSec  int
	TimeoutSec   int
	Enabled      bool
	Status       int
	LastCheckAt  *time.Time
	LastLatency  int64
	LastMessage  string
	KumaSourceID *uint `gorm:"index:idx_uptime_kuma_monitor"`
	KumaID       uint  `gorm:"index:idx_uptime_kuma_monitor"`
	KumaUptime24 *float64
	KumaUptime30 *float64
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type UptimeHeartbeat struct {
	ID        uint      `json:"-"`
	MonitorID uint      `json:"-" gorm:"index:idx_uptime_monitor_beat,priority:1"`
	Status    int       `json:"status"`
	LatencyMS int64     `json:"latency_ms"`
	Message   string    `json:"message"`
	CheckedAt time.Time `json:"checked_at" gorm:"index;index:idx_uptime_monitor_beat,priority:2"`
}

type UptimeIncident struct {
	ID          uint       `json:"id"`
	MonitorID   uint       `json:"monitor_id" gorm:"index:idx_uptime_monitor_incident,priority:1"`
	MonitorName string     `json:"monitor_name"`
	Status      string     `json:"status" gorm:"size:16;index:idx_uptime_monitor_incident,priority:2"`
	Message     string     `json:"message"`
	Recovery    string     `json:"-"`
	StartedAt   time.Time  `json:"started_at" gorm:"index"`
	ResolvedAt  *time.Time `json:"resolved_at" gorm:"index"`
	DurationSec int64      `json:"duration_sec"`
}

type UptimeKumaSource struct {
	ID            uint       `json:"id"`
	Name          string     `json:"name"`
	BaseURL       string     `json:"base_url" gorm:"type:text"`
	Slug          string     `json:"slug"`
	Enabled       bool       `json:"enabled"`
	LastSyncedAt  *time.Time `json:"last_synced_at"`
	LastAttemptAt *time.Time `json:"-"`
	LastError     string     `json:"last_error"`
	CreatedAt     time.Time  `json:"-"`
	UpdatedAt     time.Time  `json:"-"`
}

type SubSource struct {
	ID                  uint
	Name                string
	SourceType          string
	URL                 string `json:"-" gorm:"type:text"`
	RawContent          string `json:"-" gorm:"type:text"`
	Upload              int64
	Download            int64
	Total               int64
	Expire              int64
	AutoUpdateHours     int
	AutoSpeedHours      int        `json:"auto_speed_hours"`
	AutoPurityHours     int        `json:"auto_purity_hours"`
	ExpireAlertDays     int        `json:"expire_alert_days"`
	LastSpeedTestAt     *time.Time `json:"last_speed_test_at"`
	LastSpeedAttemptAt  *time.Time `json:"-"`
	LastPurityCheckAt   *time.Time `json:"last_purity_check_at"`
	LastPurityAttemptAt *time.Time `json:"-"`
	ExpireAlertedAt     *time.Time `json:"-"`
	Enabled             bool
	LastSyncedAt        *time.Time
	LastAttemptAt       *time.Time
	LastError           string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type SubNode struct {
	ID              uint
	SubscriptionID  uint   `gorm:"index;uniqueIndex:idx_sub_fingerprint,priority:1"`
	Fingerprint     string `json:"-" gorm:"size:64;uniqueIndex:idx_sub_fingerprint,priority:2"`
	Name            string
	Protocol        string
	Host            string
	Port            int
	ConfigKind      string `json:"-"`
	RawConfig       string `json:"-" gorm:"type:text"`
	CountryCode     string `gorm:"size:2;index"`
	CountryName     string
	City            string
	Lat             float64
	Lng             float64
	GeoManual       bool
	HasCoordinates  bool
	Enabled         bool
	LatencyMS       int64
	DownloadMbps    float64
	TestStatus      string
	TestMethod      string `json:"test_method"`
	TestMessage     string
	TestedAt        *time.Time
	IPPure          *IPPureResult `json:"-" gorm:"serializer:json;type:text"`
	PurityAlertedAt *time.Time    `json:"-"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type SubSpeedSample struct {
	ID        uint
	NodeID    uint `gorm:"index"`
	LatencyMS int64
	TestedAt  time.Time `gorm:"index"`
}

type IPPureSelfCache struct {
	ID     uint         `gorm:"primaryKey;autoIncrement:false"`
	Result IPPureResult `gorm:"serializer:json;type:text"`
}

type IPPureResult struct {
	IP             string     `json:"ip"`
	ASN            int64      `json:"asn"`
	ASOrganization string     `json:"as_organization"`
	Country        string     `json:"country"`
	CountryCode    string     `json:"country_code"`
	Region         string     `json:"region"`
	RegionCode     string     `json:"region_code"`
	City           string     `json:"city"`
	Timezone       string     `json:"timezone"`
	Longitude      *float64   `json:"longitude"`
	Latitude       *float64   `json:"latitude"`
	PostalCode     string     `json:"postal_code"`
	FraudScore     *int       `json:"fraud_score"`
	IsResidential  bool       `json:"is_residential"`
	IsBroadcast    bool       `json:"is_broadcast"`
	CheckedAt      *time.Time `json:"checked_at"`
	Error          string     `json:"error"`
}
