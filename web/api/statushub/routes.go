package statushub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	hub "github.com/komari-monitor/komari/internal/statushub"
	"github.com/komari-monitor/komari/web/api"
	"gorm.io/gorm"
)

func Register(public, admin *gin.RouterGroup, service *hub.Service) {
	public.GET("/overview", func(c *gin.Context) {
		span, ok := hours(c)
		if !ok {
			return
		}
		data, err := service.Overview(c.Request.Context(), span, api.GetRole(c) == api.RoleAdmin)
		result(c, data, err)
	})

	uptime := public.Group("/uptime")
	uptime.GET("/summary", func(c *gin.Context) {
		span, ok := hours(c)
		if !ok {
			return
		}
		data, err := service.Uptime(c.Request.Context(), span, api.GetRole(c) == api.RoleAdmin)
		result(c, data, err)
	})
	uptime.GET("/monitors/:id/history", byID(func(c *gin.Context, id uint) {
		span, ok := hours(c)
		if !ok {
			return
		}
		data, err := service.MonitorHistory(c.Request.Context(), id, span)
		result(c, data, err)
	}))
	uptime.GET("/incidents", func(c *gin.Context) {
		limit, ok := queryInt(c, "limit", 30, 200)
		if !ok {
			return
		}
		data, err := service.Incidents(c.Request.Context(), limit)
		result(c, data, err)
	})

	subscriptions := public.Group("/subscriptions")
	subscriptions.GET("", func(c *gin.Context) {
		data, err := service.Subscriptions(c.Request.Context(), false)
		result(c, data, err)
	})
	subscriptions.GET("/nodes", listNodes(service, false))
	subscriptions.GET("/map", func(c *gin.Context) {
		data, err := service.SubscriptionMap(c.Request.Context())
		result(c, data, err)
	})
	subscriptions.GET("/ippure-self", readIPPureSelf(service, false))

	registerUptimeAdmin(admin.Group("/uptime"), service)
	registerSubscriptionsAdmin(admin.Group("/subscriptions"), service)
}

func listNodes(service *hub.Service, admin bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		filter := hub.NodeFilter{
			Country: strings.TrimSpace(c.Query("country")), Search: strings.TrimSpace(c.Query("search")),
			SortBy: c.Query("sort_by"), SortDir: c.Query("sort_dir"),
		}
		if raw := c.Query("subscription_id"); raw != "" {
			id, err := parseID(raw)
			if err != nil {
				result(c, nil, err)
				return
			}
			filter.SubscriptionID = id
		}
		if raw := c.Query("only_enabled"); raw != "" {
			value, err := strconv.ParseBool(raw)
			if err != nil {
				api.RespondError(c, http.StatusBadRequest, "only_enabled must be a boolean")
				return
			}
			filter.OnlyEnabled = value
		}
		data, err := service.Nodes(c.Request.Context(), filter, admin)
		result(c, data, err)
	}
}

func readIPPureSelf(service *hub.Service, admin bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		data, err := service.IPPureSelf(c.Request.Context(), admin)
		result(c, data, err)
	}
}

func registerUptimeAdmin(group *gin.RouterGroup, service *hub.Service) {
	saveMonitor := func(c *gin.Context, id uint) {
		var input hub.MonitorInput
		if !bind(c, &input, false) {
			return
		}
		m, err := service.SaveMonitor(c.Request.Context(), id, input)
		result(c, hub.MonitorView(m, true), err)
	}
	group.POST("/monitors", func(c *gin.Context) { saveMonitor(c, 0) })
	group.PUT("/monitors/:id", byID(saveMonitor))
	group.DELETE("/monitors/:id", byID(func(c *gin.Context, id uint) {
		result(c, nil, service.DeleteMonitor(c.Request.Context(), id))
	}))
	group.POST("/monitors/:id/check", byID(func(c *gin.Context, id uint) {
		data, err := service.CheckMonitor(c.Request.Context(), id, true)
		result(c, data, err)
	}))

	group.GET("/kuma-sources", func(c *gin.Context) {
		data, err := service.KumaSources(c.Request.Context())
		result(c, data, err)
	})
	group.POST("/kuma-sources", func(c *gin.Context) {
		var input hub.KumaInput
		if !bind(c, &input, false) {
			return
		}
		source, err := service.CreateKumaSource(c.Request.Context(), input)
		result(c, source, err)
	})
	group.DELETE("/kuma-sources/:id", byID(func(c *gin.Context, id uint) {
		result(c, nil, service.DeleteKumaSource(c.Request.Context(), id))
	}))
	group.POST("/kuma-sources/:id/sync", byID(func(c *gin.Context, id uint) {
		source, err := service.SyncKuma(c.Request.Context(), id, true)
		result(c, source, err)
	}))
}

func registerSubscriptionsAdmin(group *gin.RouterGroup, service *hub.Service) {
	group.GET("", func(c *gin.Context) {
		data, err := service.Subscriptions(c.Request.Context(), true)
		result(c, data, err)
	})
	group.GET("/nodes", listNodes(service, true))
	group.GET("/ippure-self", readIPPureSelf(service, true))
	group.GET("/capabilities", func(c *gin.Context) {
		result(c, service.ProxyCapabilities(), nil)
	})
	save := func(c *gin.Context, id uint) {
		var input hub.SubscriptionInput
		if !bind(c, &input, false) {
			return
		}
		ctx := c.Request.Context()
		source, err := service.SaveSubscription(ctx, id, input)
		if err != nil {
			result(c, nil, err)
			return
		}
		data, err := service.Subscription(ctx, source)
		result(c, data, err)
	}
	group.POST("", func(c *gin.Context) { save(c, 0) })
	group.PUT("/:id", byID(save))
	group.DELETE("/:id", byID(func(c *gin.Context, id uint) {
		result(c, nil, service.DeleteSubscription(c.Request.Context(), id))
	}))
	group.POST("/:id/refresh", byID(func(c *gin.Context, id uint) {
		ctx := c.Request.Context()
		source, err := service.RefreshSubscription(ctx, id, true)
		if err != nil {
			result(c, nil, err)
			return
		}
		data, err := service.Subscription(ctx, source)
		result(c, data, err)
	}))
	group.PATCH("/nodes/:id", byID(func(c *gin.Context, id uint) {
		var patch hub.NodePatch
		if !bind(c, &patch, false) {
			return
		}
		data, err := service.PatchNode(c.Request.Context(), id, patch)
		result(c, data, err)
	}))
	group.POST("/test-speed", func(c *gin.Context) {
		var input hub.SpeedInput
		if !bind(c, &input, true) {
			return
		}
		data, err := service.CheckSpeed(c.Request.Context(), input)
		result(c, data, err)
	})
	group.POST("/test-speed/stream", func(c *gin.Context) {
		streamSpeed(c, service)
	})
	group.POST("/speed-results", func(c *gin.Context) {
		var input struct {
			Results []hub.SpeedReportItem `json:"results"`
		}
		if !bind(c, &input, false) {
			return
		}
		data, err := service.SaveSpeedResults(c.Request.Context(), input.Results)
		result(c, data, err)
	})
	group.POST("/test-purity", func(c *gin.Context) {
		var input struct {
			hub.TestFilter
			Direct bool   `json:"direct"`
			Proxy  string `json:"proxy_url"`
		}
		if !bind(c, &input, true) {
			return
		}
		ctx := c.Request.Context()
		if input.Proxy != "" || input.Direct {
			if input.Direct && input.Proxy != "" {
				result(c, nil, hub.InputError("provide direct or proxy_url"))
				return
			}
			data, err := service.CheckIPPure(ctx, strings.TrimSpace(input.Proxy))
			result(c, data, err)
			return
		}
		data, err := service.CheckNodePurity(ctx, input.TestFilter)
		result(c, data, err)
	})
	group.POST("/ippure-check", func(c *gin.Context) {
		var input struct {
			Proxy string `json:"proxy_url"`
		}
		if !bind(c, &input, true) {
			return
		}
		data, err := service.CheckIPPure(c.Request.Context(), strings.TrimSpace(input.Proxy))
		result(c, data, err)
	})
}

type speedProgress struct {
	Completed int `json:"completed"`
	Total     int `json:"total"`
}

func streamSpeed(c *gin.Context, service *hub.Service) {
	var input hub.SpeedInput
	if !bind(c, &input, true) {
		return
	}
	mode := input.Mode
	if mode == "" {
		mode = "tcp"
	}
	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()
	emit := func(event string, data any) error {
		payload, err := json.Marshal(data)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, payload); err != nil {
			cancel()
			return err
		}
		c.Writer.Flush()
		return nil
	}
	started := false
	progress := speedProgress{}
	var publishErr error
	_, err := service.CheckSpeedStream(ctx, input, func(total int) {
		c.Header("Content-Type", "text/event-stream; charset=utf-8")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")
		started = true
		progress.Total = total
		publishErr = emit("start", gin.H{"total": total, "mode": mode})
	}, func(completed, total int, node hub.Node) {
		if publishErr != nil {
			return
		}
		next := speedProgress{Completed: completed, Total: total}
		publishErr = emit("node", struct {
			speedProgress
			Node hub.Node `json:"node"`
		}{speedProgress: next, Node: node})
		if publishErr == nil {
			progress = next
		}
	})
	if ctx.Err() != nil {
		return
	}
	if !started {
		result(c, nil, err)
		return
	}
	if publishErr != nil {
		err = publishErr
	}
	if err != nil {
		_, message := responseError(err)
		if emit("error", gin.H{"message": message}) != nil {
			return
		}
	}
	_ = emit("done", progress)
}

func parseID(raw string) (uint, error) {
	id, err := strconv.ParseUint(raw, 10, strconv.IntSize-1)
	if err != nil || id == 0 {
		return 0, hub.InputError("invalid ID")
	}
	return uint(id), nil
}

func byID(h func(*gin.Context, uint)) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := parseID(c.Param("id"))
		if err != nil {
			result(c, nil, err)
			return
		}
		h(c, id)
	}
}

func queryInt(c *gin.Context, key string, fallback, ceiling int) (int, bool) {
	value := c.Query(key)
	if value == "" {
		return fallback, true
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > ceiling {
		api.RespondError(c, http.StatusBadRequest, key+" must be between 1 and "+strconv.Itoa(ceiling))
		return 0, false
	}
	return n, true
}

func hours(c *gin.Context) (time.Duration, bool) {
	n, ok := queryInt(c, "hours", 24, 30*24)
	return time.Duration(n) * time.Hour, ok
}

func bind(c *gin.Context, body any, optional bool) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20))
	var raw json.RawMessage
	err := decoder.Decode(&raw)
	if err == nil && len(raw) > 0 && raw[0] == '{' {
		var extra json.RawMessage
		if decoder.Decode(&extra) == io.EOF && json.Unmarshal(raw, body) == nil {
			return true
		}
	} else if errors.Is(err, io.EOF) && optional {
		return true
	}
	api.RespondError(c, http.StatusBadRequest, "invalid JSON request body")
	return false
}

func result(c *gin.Context, data any, err error) {
	if err == nil {
		c.JSON(http.StatusOK, gin.H{"status": "success", "data": data})
		return
	}
	status, message := responseError(err)
	api.RespondError(c, status, message)
}

func responseError(err error) (int, string) {
	var input hub.InputError
	switch {
	case errors.As(err, &input):
		return http.StatusBadRequest, input.Error()
	case errors.Is(err, gorm.ErrRecordNotFound):
		return http.StatusNotFound, "Not found"
	case errors.Is(err, hub.ErrBusy), errors.Is(err, hub.ErrChanged):
		return http.StatusConflict, err.Error()
	default:
		return http.StatusInternalServerError, "Status hub request failed"
	}
}
