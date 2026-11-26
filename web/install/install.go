package install

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/komari-monitor/komari/database/accounts"
	"github.com/komari-monitor/komari/database/models"
	appconfig "github.com/komari-monitor/komari/internal/config"
	"github.com/komari-monitor/komari/internal/metricstore"
	"github.com/komari-monitor/komari/utils"
	logger "github.com/komari-monitor/komari/utils/log"
	"github.com/komari-monitor/komari/web/api"
	publicapi "github.com/komari-monitor/komari/web/api/public"
	"github.com/komari-monitor/komari/web/backup"
	"github.com/komari-monitor/komari/web/public"
	"github.com/komari-monitor/komari/web/upload"
	"gorm.io/gorm"
)

const (
	PagePath = "/install"
	APIPath  = "/api/install"

	EnvAdminUser   = "PULSEDECK_ADMIN_USER"
	EnvAdminPass   = "PULSEDECK_ADMIN_PASS"
	EnvSiteName    = "PULSEDECK_SITENAME"
	EnvDescription = "PULSEDECK_DESCRIPTION"
	EnvMetricDSN   = "PULSEDECK_METRIC_DSN"
	EnvPrivateSite = "PULSEDECK_PRIVATE_SITE"

	defaultMetricDSN = "./data/metrics.db"
)

// CompleteFromEnv performs headless first-run initialization when both
// PULSEDECK_ADMIN_USER and PULSEDECK_ADMIN_PASS are provided in the environment.
// Returns (false, nil) when neither variable is set so the interactive install
// guide runs normally.
func CompleteFromEnv(ctx context.Context, db *gorm.DB) (bool, error) {
	username := strings.TrimSpace(os.Getenv(EnvAdminUser))
	password := os.Getenv(EnvAdminPass)
	if username == "" && password == "" {
		return false, nil
	}
	if username == "" || password == "" {
		return false, fmt.Errorf("both %s and %s must be set for headless installation", EnvAdminUser, EnvAdminPass)
	}

	sitename := strings.TrimSpace(os.Getenv(EnvSiteName))
	if sitename == "" {
		sitename = appconfig.DefaultSitename
	}
	description := strings.TrimSpace(os.Getenv(EnvDescription))
	if description == "" {
		description = appconfig.DefaultDescription
	}
	metricDSN := strings.TrimSpace(os.Getenv(EnvMetricDSN))
	if metricDSN == "" {
		metricDSN = defaultMetricDSN
	}
	privateSite := false
	if raw := strings.TrimSpace(os.Getenv(EnvPrivateSite)); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return false, fmt.Errorf("%s must be a boolean", EnvPrivateSite)
		}
		privateSite = value
	}

	req := completeRequest{
		Username:    username,
		Password:    password,
		Sitename:    sitename,
		Description: description,
		MetricDSN:   metricDSN,
		PrivateSite: privateSite,
	}
	if err := validateRequest(&req); err != nil {
		return false, fmt.Errorf("headless install validation failed: %w", err)
	}
	cfg, err := metricConfig(req.MetricDSN)
	if err != nil {
		return false, fmt.Errorf("headless install metric DSN invalid: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	err = metricstore.TestConnection(pingCtx, cfg)
	cancel()
	if err != nil {
		return false, fmt.Errorf("headless install monitoring database connection failed: %w", err)
	}
	ctrl := NewController(db)
	if err := ctrl.createAccountAndSettings(ctx, &req, cfg, nil); err != nil {
		return false, fmt.Errorf("headless install failed to persist settings: %w", err)
	}
	logger.Infof("install", "Headless first-run installation completed for admin user %q", req.Username)
	return true, nil
}

type Status struct {
	State              string `json:"state"`
	Required           bool   `json:"required"`
	DefaultSitename    string `json:"default_sitename"`
	DefaultDescription string `json:"default_description"`
	DefaultMetricDSN   string `json:"default_metric_dsn"`
}

type completeRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	Sitename    string `json:"sitename"`
	Description string `json:"description"`
	MetricDSN   string `json:"metric_dsn"`
	PrivateSite bool   `json:"private_site"`
	Language    string `json:"language"`
}

type Controller struct {
	db     *gorm.DB
	active atomic.Bool
	mu     sync.Mutex
	state  string
	done   chan struct{}
}

func NewController(db *gorm.DB) *Controller {
	return &Controller{db: db, state: "ready", done: make(chan struct{})}
}

func (c *Controller) Activate() { c.active.Store(true) }

func (c *Controller) Deactivate() { c.active.Store(false) }

func (c *Controller) Done() <-chan struct{} { return c.done }

func (c *Controller) Register(r *gin.Engine) {
	g := r.Group(APIPath, c.requireActive)
	g.GET("/status", c.status)
	g.POST("/test-db", c.testDB)
	g.POST("/complete", c.complete)
	uploadHandler := upload.NewHandler(upload.DefaultStore, map[upload.Purpose]upload.Finalizer{
		upload.PurposeBackup: c.finalizeBackupUpload,
	})
	uploadGroup := g.Group("/upload")
	{
		uploadGroup.POST("/init", uploadHandler.Init)
		uploadGroup.POST("/chunk", uploadHandler.Chunk)
		uploadGroup.POST("/merge", uploadHandler.Merge)
		uploadGroup.POST("/cancel", uploadHandler.Cancel)
	}
}

func (c *Controller) requireActive(ctx *gin.Context) {
	if !c.active.Load() {
		ctx.AbortWithStatus(http.StatusNotFound)
		return
	}
	ctx.Next()
}

func (c *Controller) status(ctx *gin.Context) {
	c.mu.Lock()
	state := c.state
	c.mu.Unlock()
	api.RespondSuccess(ctx, Status{
		State:              state,
		Required:           state != "completed",
		DefaultSitename:    appconfig.DefaultSitename,
		DefaultDescription: appconfig.DefaultDescription,
		DefaultMetricDSN:   defaultMetricDSN,
	})
}

func (c *Controller) testDB(ctx *gin.Context) {
	var request struct {
		MetricDSN string `json:"metric_dsn"`
	}
	if err := decodeJSON(ctx, &request); err != nil {
		api.RespondError(ctx, http.StatusBadRequest, err.Error())
		return
	}
	cfg, err := metricConfig(request.MetricDSN)
	if err == nil {
		pingCtx, cancel := context.WithTimeout(ctx.Request.Context(), 10*time.Second)
		defer cancel()
		err = metricstore.TestConnection(pingCtx, cfg)
	}
	if err != nil {
		api.RespondError(ctx, http.StatusBadRequest, fmt.Sprintf("monitoring database connection failed: %v", err))
		return
	}
	api.RespondSuccess(ctx, gin.H{"ok": true, "driver": cfg.Driver, "message": "Connection succeeded"})
}

func (c *Controller) finalizeBackupUpload(session upload.Session) (upload.Result, error) {
	archive, err := os.Open(session.ArchivePath)
	if err != nil {
		return upload.Result{}, fmt.Errorf("open merged backup: %w", err)
	}
	defer archive.Close()
	if err := backup.SaveUploadedBackup(archive, session.Metadata.Filename); err != nil {
		return upload.Result{}, err
	}
	go func() {
		logger.InfoArgs("install", "Backup uploaded, restarting service to restore it on startup...")
		time.Sleep(2 * time.Second)
		os.Exit(0)
	}()
	return upload.Result{Message: "backup uploaded; restarting to restore", Data: gin.H{}}, nil
}

func (c *Controller) complete(ctx *gin.Context) {
	var request completeRequest
	if err := decodeJSON(ctx, &request); err != nil {
		api.RespondError(ctx, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateRequest(&request); err != nil {
		api.RespondError(ctx, http.StatusBadRequest, err.Error())
		return
	}

	c.mu.Lock()
	if c.state != "ready" {
		c.mu.Unlock()
		api.RespondError(ctx, http.StatusConflict, "installation is already completed or running")
		return
	}
	c.state = "completing"
	c.mu.Unlock()

	cfg, err := metricConfig(request.MetricDSN)
	if err == nil {
		pingCtx, cancel := context.WithTimeout(ctx.Request.Context(), 15*time.Second)
		err = metricstore.TestConnection(pingCtx, cfg)
		cancel()
	}
	if err != nil {
		c.fail()
		api.RespondError(ctx, http.StatusBadRequest, fmt.Sprintf("monitoring database connection failed: %v", err))
		return
	}

	var session string
	err = c.createAccountAndSettings(ctx.Request.Context(), &request, cfg, func(tx *gorm.DB, uuid string) error {
		var err error
		session, err = accounts.CreateSessionWithDB(tx, uuid, publicapi.SessionCookieMaxAge, ctx.Request.UserAgent(), ctx.ClientIP(), "password")
		return err
	})
	if err != nil {
		c.fail()
		api.RespondError(ctx, http.StatusInternalServerError, "failed to save installation settings")
		return
	}

	c.mu.Lock()
	c.state = "completed"
	c.mu.Unlock()
	publicapi.SetSessionCookie(ctx, session, publicapi.SessionCookieMaxAge)
	if request.Language != "" {
		http.SetCookie(ctx.Writer, &http.Cookie{
			Name:     public.LanguageCookieName,
			Value:    request.Language,
			Path:     "/",
			MaxAge:   publicapi.SessionCookieMaxAge,
			Secure:   utils.GetScheme(ctx) == "https",
			SameSite: http.SameSiteLaxMode,
		})
	}
	go func() {
		time.Sleep(500 * time.Millisecond)
		c.Deactivate()
		close(c.done)
	}()
	api.RespondSuccessMessage(ctx, "installation completed", gin.H{})
}

func (c *Controller) fail() {
	c.mu.Lock()
	c.state = "ready"
	c.mu.Unlock()
}

func (c *Controller) createAccountAndSettings(ctx context.Context, request *completeRequest, cfg *metricstore.MetricStoreConfig, createSession func(*gorm.DB, string) error) error {
	return c.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&models.User{}).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return fmt.Errorf("installation is already completed")
		}
		user, err := accounts.CreateAccountWithDB(tx, request.Username, request.Password)
		if err != nil {
			return err
		}
		settings := map[string]any{
			appconfig.SitenameKey:         request.Sitename,
			appconfig.DescriptionKey:      request.Description,
			appconfig.EulaAcceptedKey:     true,
			appconfig.PrivateSiteKey:      request.PrivateSite,
			metricstore.MetricDBDriverKey: cfg.Driver,
			metricstore.MetricDBDSNKey:    cfg.DSN,
		}
		if err := appconfig.SetManyWithDB(tx, settings); err != nil {
			return err
		}
		if createSession != nil {
			return createSession(tx, user.UUID)
		}
		return nil
	})
}

func validateRequest(request *completeRequest) error {
	request.Username = strings.TrimSpace(request.Username)
	request.Sitename = strings.TrimSpace(request.Sitename)
	request.Description = strings.TrimSpace(request.Description)
	request.MetricDSN = strings.TrimSpace(request.MetricDSN)
	request.Language = strings.TrimSpace(request.Language)
	if request.Username == "" || utf8.RuneCountInString(request.Username) > 64 {
		return fmt.Errorf("username must be between 1 and 64 characters")
	}
	passwordLength := utf8.RuneCountInString(request.Password)
	if passwordLength < 8 || passwordLength > 256 {
		return fmt.Errorf("password must be between 8 and 256 characters")
	}
	if !hasStrongPassword(request.Password) {
		return fmt.Errorf("password must contain uppercase, lowercase letters, and numbers")
	}
	if request.Sitename == "" || utf8.RuneCountInString(request.Sitename) > 100 {
		return fmt.Errorf("site name must be between 1 and 100 characters")
	}
	if utf8.RuneCountInString(request.Description) > 1000 {
		return fmt.Errorf("site description must be at most 1000 characters")
	}
	return nil
}

func hasStrongPassword(password string) bool {
	var upper, lower, digit bool
	for _, char := range password {
		upper = upper || unicode.IsUpper(char)
		lower = lower || unicode.IsLower(char)
		digit = digit || unicode.IsDigit(char)
	}
	return upper && lower && digit
}

func metricConfig(dsn string) (*metricstore.MetricStoreConfig, error) {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		return nil, fmt.Errorf("monitoring database DSN is required")
	}
	driver, ok := metricstore.InferDriverFromDSN(dsn)
	if !ok {
		return nil, fmt.Errorf("cannot infer monitoring database type from DSN")
	}
	return &metricstore.MetricStoreConfig{Driver: string(driver), DSN: dsn}, nil
}

func decodeJSON(ctx *gin.Context, target any) error {
	ctx.Request.Body = http.MaxBytesReader(ctx.Writer, ctx.Request.Body, 1<<20)
	decoder := json.NewDecoder(ctx.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}
	return nil
}
