package admin

import (
	"testing"

	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/internal/config"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newOnboardingTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	config.SetDb(db)
	return db
}

func TestOnboardingUpdatesPreserveOmittedFieldsAndReset(t *testing.T) {
	newOnboardingTestDB(t)
	empty := onboardingState{}
	if initial, err := loadOnboarding(); err != nil || initial != empty {
		t.Fatalf("initial onboarding = %+v, %v", initial, err)
	}
	yes, no, step := true, false, 2
	update := onboardingUpdate{Completed: &yes, Dismissed: &yes, CurrentStep: &step}
	want := onboardingState{Completed: true, Dismissed: true, CurrentStep: 2}
	if saved, err := saveOnboardingUpdate(update); err != nil || saved != want {
		t.Fatalf("full update = %+v, %v, want %+v", saved, err, want)
	}
	want.Dismissed = false
	if saved, err := saveOnboardingUpdate(onboardingUpdate{Dismissed: &no}); err != nil || saved != want {
		t.Fatalf("partial update = %+v, %v, want %+v", saved, err, want)
	}
	if stored, err := loadOnboarding(); err != nil || stored != want {
		t.Fatalf("stored onboarding = %+v, %v, want %+v", stored, err, want)
	}
	update.Reset = true
	if reset, err := saveOnboardingUpdate(update); err != nil || reset != empty {
		t.Fatalf("reset onboarding = %+v, %v, want %+v", reset, err, empty)
	}
	if stored, err := loadOnboarding(); err != nil || stored != empty {
		t.Fatalf("stored onboarding after reset = %+v, %v", stored, err)
	}
}

func TestOnboardingChecklistUsesLiveCountsAndNotificationSettings(t *testing.T) {
	db := newOnboardingTestDB(t)
	if err := db.AutoMigrate(&models.Client{}, &models.UptimeMonitor{}, &models.SubSource{}, &models.SubNode{}); err != nil {
		t.Fatal(err)
	}
	assertChecklist := func(wantCounts onboardingCounts, wantSteps onboardingSteps) {
		t.Helper()
		counts, steps, err := onboardingChecklist(db)
		if err != nil || counts != wantCounts || steps != wantSteps {
			t.Fatalf("checklist = %+v, %+v, %v, want %+v, %+v", counts, steps, err, wantCounts, wantSteps)
		}
	}
	assertChecklist(onboardingCounts{}, onboardingSteps{})

	for _, row := range []any{
		&models.Client{UUID: "onboarding-node"},
		&models.UptimeMonitor{Name: "Onboarding monitor"},
		&models.SubNode{Name: "Manual subscription node"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := config.SetMany(map[string]any{
		config.NotificationEnabledKey: false,
		config.NotificationMethodKey:  "webhook",
	}); err != nil {
		t.Fatal(err)
	}
	counts := onboardingCounts{Servers: 1, UptimeMonitors: 1, SubscriptionNodes: 1}
	steps := onboardingSteps{AddServer: true, AddUptime: true, AddSubscription: true}
	assertChecklist(counts, steps)

	if err := config.Set(config.NotificationEnabledKey, true); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.SubSource{Name: "Imported subscription"}).Error; err != nil {
		t.Fatal(err)
	}
	counts.Subscriptions = 1
	steps.ConfigureAlerts = true
	assertChecklist(counts, steps)
}
