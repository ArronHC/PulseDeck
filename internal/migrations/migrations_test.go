package migrations

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/komari-monitor/komari/database/models"
	appconfig "github.com/komari-monitor/komari/internal/config"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf("file:%s-%d?mode=memory&cache=shared", strings.ReplaceAll(name, " ", "_"), time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite test db: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sqlite test db handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	return db
}

func TestKomariSQLiteUpgradeWithStatusHubSchema(t *testing.T) {
	db := openTestDB(t, "komari_to_pulsedeck")
	t.Setenv("TZ", "UTC")
	require.NoError(t, db.Exec(`
		CREATE TABLE configs (id integer PRIMARY KEY, sitename varchar(100) NOT NULL, description text);
		INSERT INTO configs VALUES (1, 'Upstream Komari', 'Existing status site');
		CREATE TABLE clients (uuid varchar(36) PRIMARY KEY, token varchar(255) UNIQUE NOT NULL, name varchar(100));
		INSERT INTO clients VALUES ('old-client', 'old-token', 'Existing monitor');
		CREATE TABLE records (client varchar(36), time datetime, cpu decimal(5,2), ram bigint);
		INSERT INTO records VALUES ('old-client', '2025-03-12 14:20:00', 39.25, 268435456);
		CREATE TABLE ping_tasks (id integer PRIMARY KEY, name varchar(255), type varchar(12), target varchar(255), interval integer, all_clients boolean);
		INSERT INTO ping_tasks VALUES (7, 'Existing ping', 'icmp', 'example.org', 60, true);
	`).Error)

	require.NoError(t, Run(Context{DB: db}))
	require.NoError(t, db.AutoMigrate(&models.Client{}, &models.PingTask{},
		&models.UptimeMonitor{}, &models.UptimeHeartbeat{}, &models.UptimeIncident{}, &models.UptimeKumaSource{},
		&models.SubSource{}, &models.SubNode{}, &models.SubSpeedSample{}, &models.IPPureSelfCache{}))
	require.NoError(t, Run(Context{DB: db}))

	var settings appconfig.ConfigItem
	require.NoError(t, db.First(&settings, "key = ?", appconfig.SitenameKey).Error)
	require.Equal(t, `"Upstream Komari"`, settings.Value)
	var client models.Client
	require.NoError(t, db.First(&client, "uuid = ?", "old-client").Error)
	require.Equal(t, "Existing monitor", client.Name)
	require.Equal(t, "old-token", client.Token)
	var record models.Record
	require.NoError(t, db.First(&record, "client = ?", client.UUID).Error)
	require.Equal(t, float32(39.25), record.Cpu)
	require.Equal(t, int64(268435456), record.Ram)
	require.True(t, record.Time.Equal(time.Date(2025, 3, 12, 14, 20, 0, 0, time.UTC)))
	var ping models.PingTask
	require.NoError(t, db.First(&ping, 7).Error)
	require.Equal(t, "Existing ping", ping.Name)
	require.Equal(t, "example.org", ping.Target)
	require.Equal(t, models.StringArray{client.UUID}, ping.Clients)

	source := models.SubSource{Name: "New subscription", AutoSpeedHours: 12, AutoPurityHours: 24, ExpireAlertDays: 7}
	require.NoError(t, db.Create(&source).Error)
	node := models.SubNode{SubscriptionID: source.ID, Host: "198.51.100.1", TestMethod: "tcp"}
	require.NoError(t, db.Create(&node).Error)
	var saved models.SubNode
	require.NoError(t, db.First(&saved, node.ID).Error)
	require.Equal(t, "tcp", saved.TestMethod)
}

func TestHasLegacyConfigTable(t *testing.T) {
	t.Run("config item table", func(t *testing.T) {
		db := openTestDB(t, "migrations_config_item")
		if err := db.AutoMigrate(&appconfig.ConfigItem{}); err != nil {
			t.Fatalf("migrate config item table: %v", err)
		}
		if hasLegacyConfigTable(db) {
			t.Fatal("config item table was detected as legacy config table")
		}
	})

	t.Run("legacy config table", func(t *testing.T) {
		db := openTestDB(t, "migrations_legacy_config")
		if err := db.AutoMigrate(&legacyModelConfig{}); err != nil {
			t.Fatalf("migrate legacy config table: %v", err)
		}
		if !hasLegacyConfigTable(db) {
			t.Fatal("legacy config table was not detected")
		}
	})
}

func TestRunSkipsLegacyConfigMigrationForCurrentConfigItemTable(t *testing.T) {
	db := openTestDB(t, "migrations_config_item_run")
	if err := db.AutoMigrate(&appconfig.ConfigItem{}); err != nil {
		t.Fatalf("migrate config item table: %v", err)
	}
	if err := db.Create(&appconfig.ConfigItem{Key: "o_auth_provider", Value: `"github"`}).Error; err != nil {
		t.Fatalf("seed config item: %v", err)
	}

	if err := Run(Context{DB: db}); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	if db.Migrator().HasColumn(&legacyModelConfig{}, "id") {
		t.Fatal("config item table was changed into the legacy config shape")
	}
	if db.Migrator().HasTable(&models.OidcProvider{}) {
		t.Fatal("legacy OIDC migration ran against the config item table")
	}

	var item appconfig.ConfigItem
	if err := db.First(&item, "key = ?", "o_auth_provider").Error; err != nil {
		t.Fatalf("config item was not preserved: %v", err)
	}
	if item.Value != `"github"` {
		t.Fatalf("unexpected config value: %s", item.Value)
	}
}

func TestRunRemovesDeprecatedMetricRetentionConfig(t *testing.T) {
	db := openTestDB(t, "migrations_remove_metric_retention")
	if err := db.AutoMigrate(&appconfig.ConfigItem{}); err != nil {
		t.Fatalf("migrate config item table: %v", err)
	}
	if err := db.Create(&appconfig.ConfigItem{Key: "metric_retention_days", Value: "90"}).Error; err != nil {
		t.Fatalf("seed deprecated config: %v", err)
	}
	if err := Run(Context{DB: db}); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	var count int64
	if err := db.Model(&appconfig.ConfigItem{}).Where("key = ?", "metric_retention_days").Count(&count).Error; err != nil {
		t.Fatalf("count deprecated config: %v", err)
	}
	if count != 0 {
		t.Fatalf("deprecated metric retention config was not removed: %d", count)
	}
}

func TestRunRemovesCompatibilityConfig(t *testing.T) {
	db := openTestDB(t, "migrations_remove_compatibility_config")
	if err := db.AutoMigrate(&appconfig.ConfigItem{}); err != nil {
		t.Fatalf("migrate config item table: %v", err)
	}
	for _, key := range []string{"nezha_compat_enabled", "nezha_compat_listen", "low_resource_mode"} {
		if err := db.Create(&appconfig.ConfigItem{Key: key, Value: "true"}).Error; err != nil {
			t.Fatalf("seed removed config %q: %v", key, err)
		}
	}
	if err := db.Create(&appconfig.ConfigItem{Key: "sitename", Value: `"Komari"`}).Error; err != nil {
		t.Fatalf("seed retained config: %v", err)
	}

	if err := Run(Context{DB: db}); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	var count int64
	if err := db.Model(&appconfig.ConfigItem{}).Where("key IN ?", []string{
		"nezha_compat_enabled",
		"nezha_compat_listen",
		"low_resource_mode",
	}).Count(&count).Error; err != nil {
		t.Fatalf("count removed config: %v", err)
	}
	if count != 0 {
		t.Fatalf("removed compatibility config remains: %d", count)
	}
	if err := db.First(&appconfig.ConfigItem{}, "key = ?", "sitename").Error; err != nil {
		t.Fatalf("unrelated config was removed: %v", err)
	}
}

func TestRunPreservesVersion120RuntimeShape(t *testing.T) {
	db := openTestDB(t, "migrations_v120_runtime_shape")
	if err := db.AutoMigrate(
		&appconfig.ConfigItem{},
		&models.OidcProvider{},
		&models.MessageSenderProvider{},
		&models.Client{},
		&models.PingTask{},
	); err != nil {
		t.Fatalf("migrate 1.2.0 runtime shape: %v", err)
	}
	now := time.Now().UTC()
	if err := db.Create(&models.Client{UUID: "client-a", Token: "token-a", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatalf("seed client: %v", err)
	}
	if err := db.Create(&models.PingTask{
		Name:      "already explicit",
		Clients:   models.StringArray{"client-a"},
		DefaultOn: true,
		Type:      "icmp",
		Target:    "example.com",
		Interval:  60,
	}).Error; err != nil {
		t.Fatalf("seed ping task: %v", err)
	}
	if err := db.Create(&appconfig.ConfigItem{Key: appconfig.OAuthProviderKey, Value: `"github"`}).Error; err != nil {
		t.Fatalf("seed config item: %v", err)
	}
	if err := db.Create(&models.OidcProvider{Name: "github", Addition: `{"client_id":"old","client_secret":"secret"}`}).Error; err != nil {
		t.Fatalf("seed oidc provider: %v", err)
	}
	if err := db.Create(&models.MessageSenderProvider{Name: "telegram", Addition: `{"bot_token":"old-token"}`}).Error; err != nil {
		t.Fatalf("seed message sender provider: %v", err)
	}

	if err := Run(Context{DB: db}); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	if db.Migrator().HasColumn(&legacyModelConfig{}, "sitename") {
		t.Fatal("current config item table was treated as legacy wide config")
	}

	var configItem appconfig.ConfigItem
	if err := db.First(&configItem, "key = ?", appconfig.OAuthProviderKey).Error; err != nil {
		t.Fatalf("find config item: %v", err)
	}
	if configItem.Value != `"github"` {
		t.Fatalf("unexpected config item value: %s", configItem.Value)
	}

	var oidc models.OidcProvider
	if err := db.First(&oidc, "name = ?", "github").Error; err != nil {
		t.Fatalf("find oidc provider: %v", err)
	}
	if oidc.Addition != `{"client_id":"old","client_secret":"secret"}` {
		t.Fatalf("oidc provider was unexpectedly changed: %s", oidc.Addition)
	}

	var sender models.MessageSenderProvider
	if err := db.First(&sender, "name = ?", "telegram").Error; err != nil {
		t.Fatalf("find message sender provider: %v", err)
	}
	if sender.Addition != `{"bot_token":"old-token"}` {
		t.Fatalf("message sender provider was unexpectedly changed: %s", sender.Addition)
	}

	var task models.PingTask
	if err := db.First(&task, "name = ?", "already explicit").Error; err != nil {
		t.Fatalf("find ping task: %v", err)
	}
	if len(task.Clients) != 1 || task.Clients[0] != "client-a" {
		t.Fatalf("explicit ping task clients were changed: %v", task.Clients)
	}
}

func TestRunMigratesLegacyConfigTableToConfigItems(t *testing.T) {
	db := openTestDB(t, "migrations_legacy_config_to_items")
	if err := db.AutoMigrate(&legacyModelConfig{}); err != nil {
		t.Fatalf("migrate legacy config table: %v", err)
	}
	legacy := legacyModelConfig{
		Sitename:                   "Old Komari",
		Description:                "legacy description",
		Theme:                      "classic",
		GeoIpEnabled:               true,
		GeoIpProvider:              "ip-api",
		OAuthProvider:              "github",
		NotificationMethod:         "none",
		TrafficLimitPercentage:     66.5,
		ExpireNotificationLeadDays: 3,
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatalf("seed legacy config: %v", err)
	}

	if err := Run(Context{DB: db}); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	if db.Migrator().HasColumn(&legacyModelConfig{}, "sitename") {
		t.Fatal("legacy config columns were not removed")
	}

	var sitename appconfig.ConfigItem
	if err := db.First(&sitename, "key = ?", appconfig.SitenameKey).Error; err != nil {
		t.Fatalf("find migrated sitename: %v", err)
	}
	if sitename.Value != `"Old Komari"` {
		t.Fatalf("unexpected sitename value: %s", sitename.Value)
	}

	var corsOriginCheck appconfig.ConfigItem
	if err := db.First(&corsOriginCheck, "key = ?", appconfig.CorsOriginCheckEnabledKey).Error; err == nil {
		t.Fatalf("unexpected migrated cors_origin_check_enabled value: %s", corsOriginCheck.Value)
	}
}

func TestRunExpandsLegacyPingAllClientsTasks(t *testing.T) {
	db := openTestDB(t, "migrations_ping_all_clients")
	if err := db.AutoMigrate(&models.Client{}); err != nil {
		t.Fatalf("migrate clients: %v", err)
	}
	if err := db.Exec(`
		CREATE TABLE ping_tasks (
			id integer primary key autoincrement,
			weight integer not null default 0,
			name varchar(255) not null,
			all_clients boolean not null default false,
			type varchar(12) not null default 'icmp',
			target varchar(255) not null,
			interval integer not null default 60
		)
	`).Error; err != nil {
		t.Fatalf("create legacy ping_tasks: %v", err)
	}
	now := time.Now().UTC()
	clients := []models.Client{
		{UUID: "client-a", Token: "token-a", CreatedAt: now, UpdatedAt: now},
		{UUID: "client-b", Token: "token-b", CreatedAt: now, UpdatedAt: now},
	}
	if err := db.Create(&clients).Error; err != nil {
		t.Fatalf("seed clients: %v", err)
	}
	if err := db.Exec("INSERT INTO ping_tasks (name, all_clients, type, target, interval) VALUES (?, ?, ?, ?, ?)", "legacy task", true, "icmp", "example.com", 60).Error; err != nil {
		t.Fatalf("seed legacy ping task: %v", err)
	}

	if err := Run(Context{DB: db}); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	var task models.PingTask
	if err := db.First(&task).Error; err != nil {
		t.Fatalf("find migrated ping task: %v", err)
	}
	if len(task.Clients) != 2 {
		t.Fatalf("expected two migrated clients, got %v", task.Clients)
	}
	got := map[string]bool{}
	for _, uuid := range task.Clients {
		got[uuid] = true
	}
	if !got["client-a"] || !got["client-b"] {
		t.Fatalf("unexpected migrated clients: %v", task.Clients)
	}

	raw, err := json.Marshal(task.Clients)
	if err != nil {
		t.Fatalf("marshal migrated clients: %v", err)
	}
	if string(raw) != `["client-a","client-b"]` {
		t.Fatalf("unexpected clients json: %s", raw)
	}
}
