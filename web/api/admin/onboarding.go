package admin

import (
	"errors"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/internal/config"
	"github.com/komari-monitor/komari/internal/plugin"
	"github.com/komari-monitor/komari/web/api"
	"gorm.io/gorm"
)

const onboardingKey = "pulsedeck_onboarding_v1"

var onboardingMu sync.Mutex

type onboardingState struct {
	Completed   bool `json:"completed"`
	Dismissed   bool `json:"dismissed"`
	CurrentStep int  `json:"current_step"`
}

type onboardingUpdate struct {
	Completed   *bool `json:"completed"`
	Dismissed   *bool `json:"dismissed"`
	CurrentStep *int  `json:"current_step"`
	Reset       bool  `json:"reset"`
}

type onboardingCounts struct {
	Servers           int64 `json:"servers"`
	UptimeMonitors    int64 `json:"uptime_monitors"`
	Subscriptions     int64 `json:"subscriptions"`
	SubscriptionNodes int64 `json:"subscription_nodes"`
	Plugins           int   `json:"plugins"`
}

type onboardingSteps struct {
	AddServer       bool `json:"add_server"`
	AddUptime       bool `json:"add_uptime"`
	AddSubscription bool `json:"add_subscription"`
	ConfigureAlerts bool `json:"configure_alerts"`
}

func GetOnboarding(c *gin.Context) {
	state, err := loadOnboarding()
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "Failed to load onboarding state")
		return
	}
	respondOnboarding(c, state)
}

func UpdateOnboarding(c *gin.Context) {
	var update onboardingUpdate
	if err := c.ShouldBindJSON(&update); err != nil {
		api.RespondError(c, http.StatusBadRequest, "Invalid onboarding update")
		return
	}
	state, err := saveOnboardingUpdate(update)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "Failed to save onboarding state")
		return
	}
	respondOnboarding(c, state)
}

func loadOnboarding() (onboardingState, error) {
	state, err := config.GetAs[onboardingState](onboardingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return onboardingState{}, nil
	}
	return state, err
}

func saveOnboardingUpdate(update onboardingUpdate) (onboardingState, error) {
	onboardingMu.Lock()
	defer onboardingMu.Unlock()

	if update.Reset {
		state := onboardingState{}
		return state, config.Set(onboardingKey, state)
	}

	state, err := loadOnboarding()
	if err != nil {
		return state, err
	}
	if update.Completed != nil {
		state.Completed = *update.Completed
	}
	if update.Dismissed != nil {
		state.Dismissed = *update.Dismissed
	}
	if update.CurrentStep != nil {
		state.CurrentStep = *update.CurrentStep
	}
	return state, config.Set(onboardingKey, state)
}

func respondOnboarding(c *gin.Context, state onboardingState) {
	db := dbcore.GetDBInstance().WithContext(c.Request.Context())
	counts, steps, err := onboardingChecklist(db)
	if err != nil {
		api.RespondError(c, http.StatusInternalServerError, "Failed to load onboarding checklist")
		return
	}
	api.RespondSuccess(c, struct {
		onboardingState
		Counts onboardingCounts `json:"counts"`
		Steps  onboardingSteps  `json:"steps"`
	}{state, counts, steps})
}

func onboardingChecklist(db *gorm.DB) (onboardingCounts, onboardingSteps, error) {
	counts := onboardingCounts{Plugins: len(plugin.List())}
	steps := onboardingSteps{}
	for _, query := range []struct {
		model any
		count *int64
	}{
		{&models.Client{}, &counts.Servers},
		{&models.UptimeMonitor{}, &counts.UptimeMonitors},
		{&models.SubSource{}, &counts.Subscriptions},
		{&models.SubNode{}, &counts.SubscriptionNodes},
	} {
		if err := db.Model(query.model).Count(query.count).Error; err != nil {
			return counts, steps, err
		}
	}
	settings, err := config.GetManyAs[config.Settings]()
	if err != nil {
		return counts, steps, err
	}
	method := strings.TrimSpace(settings.NotificationMethod)
	steps = onboardingSteps{
		AddServer:       counts.Servers > 0,
		AddUptime:       counts.UptimeMonitors > 0,
		AddSubscription: counts.Subscriptions > 0 || counts.SubscriptionNodes > 0,
		ConfigureAlerts: settings.NotificationEnabled && method != "" && !strings.EqualFold(method, "none"),
	}
	return counts, steps, nil
}
