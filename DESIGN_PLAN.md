# PulseDeck v2 — Architecture & Refactor Specification

## 1. Core Architectural Principles
PulseDeck uses Komari strictly as an **underlying infrastructure wheel/engine** (Go server runtime, SQLite/MetricStore, Agent v2 WebSocket/RPC probe protocol, auth/sessions/2FA/OAuth, ping tasks, notifications, audit logs, and **Plugin Engine**), rather than copying Komari's product UI, admin panel, or branding.

### Key v2 Changes
1. **De-Komarify Product Identity & UX**:
   - Remove Komari's copy-pasted admin shell (`AdminPanelBar`), Komari EULA gate, Komari upstream GitHub release checker, Komari docs links, Komari 15-widget draggable dashboard (`DashboardBoard`), and Komari fallback site names.
   - PulseDeck owns its product branding, Admin Console IA, and visual design system end-to-end (acknowledging Komari in About / Open Source licenses as an underlying dependency).
2. **First-Run Interactive Guidance (首次运行交互式指引)**:
   - **Pre-Init Setup Wizard (`/install`)**: PulseDeck-native 5-step interactive wizard with live password strength checks, site visibility & language choices, interactive DB DSN connection testing (`POST /api/install/test-db`), backup restore option, and seamless auto-login upon completion.
   - **Post-Init Interactive Onboarding (`/api/admin/onboarding`)**: Backend-persisted onboarding state combined with live DB completion checks (`servers`, `uptime_monitors`, `subscriptions`, `alerts`), powering an interactive walkthrough modal and persistent quick-start checklist inside `/admin/overview` (re-openable anytime).
3. **Remove Admin Workbench (`/terminal` + Remote File Manager)**:
   - Delete the WebSSH terminal & remote file manager workbench completely from both backend routes/RPCs and frontend UI/routes/server action buttons.
4. **Remove Theme Market & Third-Party Theme Switching — Keep Plugins 100% Intact**:
   - Delete all `/api/admin/theme/*`, `/probe-theme*`, `/themes/*` third-party theme serving and Theme Market UI/API.
   - Preserve the entire **Plugin System** (`/api/admin/plugin/*`, `/api/plugin/:short/*`, Plugin Market, Plugin Config, Plugin custom admin/public pages, HTML injection & hooks, zip upload `purpose: "plugin"`).
5. **Backend-Only Resource Management (前台只读展示，节点与服务统一在后台添加/管理)**:
   - Public frontend pages (`/`, `/servers`, `/uptime`, `/subscriptions`, `/instance/:uuid`) are **strictly read-only** observability pages.
   - All creation, editing, deletion, sync, speedtest, and IPPure check actions live inside the redesigned **PulseDeck Admin Console**:
     - `/admin/overview` — PulseDeck Control Center + Interactive First-Run Checklist
     - `/admin/servers` — Server Probe Management (Add node, agent install command, auto-discovery, edit/billing/traffic/delete; no terminal/workbench)
     - `/admin/uptime` — Service Uptime Monitors & Uptime Kuma Sync Management
     - `/admin/subscriptions` — Proxy Subscriptions, Manual Nodes, Speedtest & IPPure Purity Management
     - `/admin/ping`, `/admin/notifications` (channels/offline/general), `/admin/logs`, `/admin/exec`
     - `/admin/plugins`, `/admin/plugins/market` (alias `/admin/market/plugins`), `/admin/plugins/config`, `/admin/plugin-page`
     - `/admin/settings` (site/general/custom/sign-on/metrics), `/admin/account`, `/admin/sessions`, `/admin/about`

---

## 2. Shared API Contract (Additions & Changes)

### 2.1 First-Run Install API (`/api/install/*`, active only during first-run setup)
- `GET /api/install/status`
  ```json
  {
    "status": "success",
    "data": {
      "state": "ready",
      "required": true,
      "default_sitename": "PulseDeck",
      "default_description": "All-in-one self-hosted server probe, uptime, and node observability deck.",
      "default_metric_dsn": "./data/metrics.db"
    }
  }
  ```
- `POST /api/install/test-db`
  - Request: `{ "metric_dsn": "./data/metrics.db" }`
  - Response (200): `{ "status": "success", "data": { "ok": true, "driver": "sqlite", "message": "Connection succeeded" } }`
  - Response (400): `{ "status": "error", "message": "..." }`
- `POST /api/install/complete`
  - Request:
    ```json
    {
      "username": "admin",
      "password": "Password123",
      "sitename": "PulseDeck",
      "description": "...",
      "metric_dsn": "./data/metrics.db",
      "private_site": false,
      "language": "zh-CN"
    }
    ```
    (`private_site` and `language` are optional.)
  - Behavior: creates admin user, persists settings (including `eula_accepted: true` so no Komari EULA dialog appears, plus `private_site`), creates an authenticated admin session cookie (`session_token`) so redirect to `/admin/overview` is immediately logged in.

### 2.2 Admin Interactive Onboarding API (`/api/admin/onboarding`)
- Auth: `api.RequireRole(api.RoleAdmin)`
- Storage: `config` key `pulsedeck_onboarding_v1`
- `GET /api/admin/onboarding`
  ```json
  {
    "status": "success",
    "data": {
      "completed": false,
      "dismissed": false,
      "current_step": 0,
      "counts": {
        "servers": 0,
        "uptime_monitors": 0,
        "subscriptions": 0,
        "subscription_nodes": 0,
        "plugins": 0
      },
      "steps": {
        "add_server": false,
        "add_uptime": false,
        "add_subscription": false,
        "configure_alerts": false
      }
    }
  }
  ```
- `POST /api/admin/onboarding`
  - Request (all fields optional):
    ```json
    {
      "completed": true,
      "dismissed": false,
      "current_step": 1,
      "reset": false
    }
    ```
  - Returns the updated onboarding state object in the same shape as `GET`.

### 2.3 Removed Endpoints
- All `/api/admin/theme/*` routes, `/probe-theme*`, `/themes/*`, and `upload.PurposeTheme`.
- All workbench terminal & file manager routes (`/api/clients/terminal`, `/api/clients/transfer/:id`, `/api/preview/client/:uuid/file/download`, `/api/admin/client/:uuid/terminal`, `/api/admin/client/:uuid/file/*`) and terminal/file JSON-RPC methods (`admin:terminal*`, `admin:file*`).

### 2.4 Preserved Endpoints
- All PulseDeck StatusHub APIs: `/api/overview`, `/api/uptime/*`, `/api/admin/uptime/*`, `/api/subscriptions/*`, `/api/admin/subscriptions/*`.
- All Core Probe & Agent APIs: `/api/clients`, `/api/clients/register`, `/api/clients/v2/rpc`, `/api/nodes`, `/api/recent/:uuid`, `/api/records/*`, `/api/task/ping`, `/api/rpc2`, `/api/public`, `/api/me`, `/api/login`, `/api/logout`, `/api/oauth*`, `/api/admin/client/*` (excluding terminal/file), `/api/admin/ping/*`, `/api/admin/notification/*`, `/api/admin/settings/*`, `/api/admin/database/*`, `/api/admin/sessions/*`, `/api/admin/logs`, `/api/admin/2fa/*`, `/api/admin/oauth2/*`, `/api/admin/download/backup`, `/api/admin/upload/*` (`backup` & `plugin`).
- All Plugin APIs: `/api/admin/plugin/*`, `/api/plugin/:short/*filepath`, `admin:*Plugin*` RPC2 methods.
