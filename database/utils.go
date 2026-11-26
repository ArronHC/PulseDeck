package database

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/internal/config"
	"github.com/komari-monitor/komari/internal/metricstore"
)

func GetPublicInfo() (map[string]interface{}, error) {
	cstPtr, err := config.GetManyAs[config.Settings]()
	if err != nil {
		return nil, err
	}
	cst := *cstPtr

	all, allErr := config.GetAll()
	hasKey := func(k string) bool {
		if allErr != nil {
			return false
		}
		_, ok := all[k]
		return ok
	}

	// Apply defaults only when a key is missing.
	if !hasKey("sitename") {
		cst.Sitename = config.DefaultSitename
	}
	if !hasKey("description") {
		cst.Description = config.DefaultDescription
	}
	if !hasKey("o_auth_provider") {
		cst.OAuthProvider = "github"
	}

	// Fallback defaults if we couldn't enumerate keys.
	if allErr != nil {
		if cst.Sitename == "" {
			cst.Sitename = config.DefaultSitename
		}
		if cst.Description == "" {
			cst.Description = config.DefaultDescription
		}
	}
	retention, err := metricstore.GetRetentionSummary(context.Background())
	if err != nil {
		return nil, err
	}
	return gin.H{
		"sitename":                  cst.Sitename,
		"description":               cst.Description,
		"custom_head":               cst.CustomHead,
		"custom_body":               cst.CustomBody,
		"oauth_enable":              cst.OAuthEnabled,
		"oauth_provider":            cst.OAuthProvider,
		"disable_password_login":    cst.DisablePasswordLogin,
		"cors_origin_check_enabled": cst.CorsOriginCheckEnabled,
		"record_enabled":            retention.AllPositive, // 兼容旧版本主题
		"record_preserve_time":      retention.MaxDays * 24,
		"ping_record_preserve_time": retention.MaxDays * 24,
		"private_site":              cst.PrivateSite,
		"theme":                     "default",
		"theme_settings":            gin.H{},
	}, nil
}
