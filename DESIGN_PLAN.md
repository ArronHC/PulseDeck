# Unified Status Hub — Architecture & UI Design Plan

## 1. Product Vision
An all-in-one self-hosted observability and network status dashboard forked from **Komari**, unifying three domains under a single clean top-tabbed interface:

1. **Overview (总览)** — Cloudflare-inspired Bento overview summarizing server probes, uptime health, and subscription node quality at a glance.
2. **Servers / 探针 (Komari)** — Full Komari server probe monitoring (real-time WebSocket metrics, resource history charts, groups, card/table views, admin management, terminal).
3. **Uptime / 服务状态 (Uptime Kuma)** — Built-in lightweight uptime checker (HTTP/HTTPS, Keyword, TCP, Ping) with 60-tick heartbeat bars & incident timeline, PLUS optional external Uptime Kuma Status Page sync.
4. **Subscriptions / 订阅与节点 (Tower + IPPure)** — Proxy subscription & custom node management, interactive vector World Map with hover tooltips & region breakdown, concurrent latency/speed testing, and **IPPure IP purity testing** (`GET https://my.ippure.com/v1/info`, equivalent to `curl -L https://my.ippure.com/v1/info`).

---

## 2. Mobbin MCP–Guided UI Design Specification

### Layout Shell (Laravel Cloud Top-Tab Pattern)
- Reference screenshots (located in artifact dir `/home/arronhc/.t3/userdata/providers/antigravity/67861c22c9c5f7c673695773f2289e01e3ef39e365114f3b999ade3fbaa41de1/antigravity-acp/brain/bb793796-9f7c-48dc-a2b9-d38997cadfab/mobbin_mcp_refs/`):
  - `ref_01_laravel_cloud_tabs.webp` — Top two-tier header, zero left sidebar, crisp underline tab bar, subtle gray/white cards, time-range pill switchers.
  - `ref_02_cloudflare_bento_overview.webp` & `ref_03_cloudflare_sparklines.webp` — 3-column Bento KPI cards with dual metrics and soft-filled sparklines, 3-column module summary cards below.
  - `ref_04_openai_service_health.webp` & `ref_05_better_stack_monitor.webp` — Global operational status banner, live badge, uptime % + latency chart, expandable service rows with heartbeat bars, right-hand incident history timeline.
  - `ref_06_cloudflare_world_map.webp`, `ref_07_visitors_map_tooltip.webp`, `ref_08_vercel_country_scores.webp` — Interactive world map paired with country/region breakdown table, floating dark tooltip on hover, and color-coded quality tiers.

### Visual Tokens
- **Theme**: Clean neutral light mode by default, full dark mode toggle (`next-themes` / CSS variables).
  - Light canvas: `#FAFAFA`, surface: `#FFFFFF`, border: `#E4E4E7`, primary text: `#09090B`, muted text: `#71717A`.
  - Dark canvas: `#09090B`, surface: `#111113`, border: `#27272A`, primary text: `#FAFAFA`, muted text: `#A1A1AA`.
  - Accent: `#2563EB` (sparklines, focus rings, active primary actions).
  - Semantic status: Emerald `#10B981` (Up / Pure 0–25), Blue `#3B82F6` (Low risk 26–50), Amber `#F59E0B` (Degraded / Medium risk 51–75), Rose `#EF4444` (Down / High risk 76–100).
- **Typography**: Inter / system-ui sans; JetBrains Mono / tabular-nums for all metrics, latency, IP, ASN, bandwidth, and scores.
- **Navigation (No Left Sidebar on Main Views)**:
  - Tier 1 (`h-14 border-b`): Brand mark + Site Title + Global Health Pill (`All systems operational` / `N issues`) on the left; `⌘K` Quick Search modal trigger + Theme toggle + Login/Admin button on the right.
  - Tier 2 (`h-11 border-b`): Horizontal underline tabs (`Overview / 总览`, `Servers / 服务器探针`, `Uptime / 服务状态`, `Subscriptions / 订阅与节点`, and when authenticated `Settings / 管理设置`).
  - Content wrapper: centered `max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6`.

---

## 3. Repository & Ownership Split

- **Backend Owner (`sol6.2high`)**: Go files in repo root (`database/`, `internal/`, `web/api/`, `web/router/`, `cmd/`, `pkg/`). Do NOT modify files under `web-ui/`.
- **Frontend Owner (`hydrogen4 high`)**: React + TypeScript + Tailwind v4 app under `web-ui/`. Do NOT modify Go backend files.
- **Integration (Coordinator)**: Build `web-ui` into `web/public/defaultTheme/dist.tar.zst`, compile full Komari binary, and run end-to-end verification.

---

## 4. Shared Backend API Contract

All existing Komari endpoints (`/api/nodes`, `/api/clients` WS, `/api/recent/:uuid`, `/api/records/load`, `/api/records/ping`, `/api/task/ping`, `/api/public`, `/api/me`, `/api/login`, `/api/logout`, `/api/rpc2`, `/api/admin/*`) MUST remain 100% intact and backward-compatible.

### 4.1 Response Envelope
Follow standard JSON envelope:
```json
{ "status": "success", "data": { ... } }
```
Errors:
```json
{ "status": "error", "message": "..." }
```

### 4.2 Aggregated Overview
`GET /api/overview?hours=24`
```json
{
  "status": "success",
  "data": {
    "updated_at": "2026-11-26T00:00:00Z",
    "health_status": "operational", // "operational" | "degraded" | "outage"
    "active_alerts": 0,
    "probes": {
      "total": 8,
      "online": 8,
      "offline": 0,
      "avg_cpu": 24.5,
      "avg_mem_percent": 48.2,
      "total_net_in_bps": 1240000,
      "total_net_out_bps": 980000,
      "sparkline": [{ "t": "...", "v": 22.1 }],
      "top_nodes": [
        { "uuid": "...", "name": "Tokyo-01", "region": "JP", "online": true, "cpu": 18.2, "mem_percent": 42.1, "net_in": 12000, "net_out": 8500 }
      ]
    },
    "uptime": {
      "total_monitors": 12,
      "up": 12,
      "down": 0,
      "degraded": 0,
      "overall_uptime_24h": 99.96,
      "avg_latency_ms": 48,
      "sparkline": [{ "t": "...", "v": 45 }],
      "top_monitors": [
        { "id": 1, "name": "Blog", "type": "http", "source": "local", "status": 1, "uptime_24h": 100.0, "latency_ms": 42, "recent_beats": [1,1,1,1,1] }
      ]
    },
    "subscriptions": {
      "total_subscriptions": 2,
      "total_nodes": 48,
      "available_nodes": 44,
      "avg_latency_ms": 62,
      "pure_nodes": 31, // fraud_score <= 40
      "residential_nodes": 12,
      "sparkline": [{ "t": "...", "v": 60 }],
      "items": [
        { "id": 1, "name": "Airport A", "node_count": 32, "upload": 10737418240, "download": 53687091200, "total": 214748364800, "expire": 1798761600, "min_latency_ms": 28, "best_fraud_score": 12 }
      ],
      "country_counts": [
        { "country_code": "JP", "country_name": "Japan", "lat": 35.6762, "lng": 139.6503, "count": 12, "min_latency_ms": 38, "avg_fraud_score": 18 }
      ]
    },
    "recent_events": [
      { "id": "evt-1", "source": "uptime", "severity": "info", "title": "API Gateway recovered", "detail": "200 OK (41ms)", "created_at": "..." }
    ]
  }
}
```

### 4.3 Uptime Service (`/api/uptime/*` & `/api/admin/uptime/*`)
- `GET /api/uptime/summary?hours=24`
  Returns:
  - `health_status`: `"operational" | "degraded" | "outage"`
  - `overall_uptime`: float (0–100)
  - `avg_latency_ms`: int
  - `total`, `up`, `down`, `paused`
  - `latency_series`: `[{ "t": "ISO8601", "avg_ms": 45, "up_rate": 100 }]`
  - `monitors`: array of:
    ```json
    {
      "id": 1,
      "name": "Personal Blog",
      "group": "Web",
      "type": "http", // "http" | "tcp" | "ping" | "keyword" | "kuma"
      "source": "local", // "local" | "kuma"
      "target": "https://example.com",
      "keyword": "",
      "interval_sec": 60,
      "timeout_sec": 10,
      "enabled": true,
      "status": 1, // 0=down, 1=up, 2=pending/degraded
      "uptime_24h": 99.95,
      "uptime_30d": 99.91,
      "avg_latency_ms": 54,
      "last_latency_ms": 48,
      "last_checked_at": "ISO8601",
      "last_message": "200 OK",
      "heartbeats": [
        { "status": 1, "latency_ms": 48, "message": "200 OK", "checked_at": "ISO8601" }
      ]
    }
    ```
- `GET /api/uptime/monitors/:id/history?hours=24` — Detailed heartbeat points for chart expansion.
- `GET /api/uptime/incidents?limit=30` — Incident events (`id`, `monitor_id`, `monitor_name`, `status`: `"down"|"resolved"`, `message`, `started_at`, `resolved_at`, `duration_sec`).
- Admin endpoints (`api.RequireRole(api.RoleAdmin)`):
  - `POST /api/admin/uptime/monitors`
  - `PUT /api/admin/uptime/monitors/:id`
  - `DELETE /api/admin/uptime/monitors/:id`
  - `POST /api/admin/uptime/monitors/:id/check`
  - `GET /api/admin/uptime/kuma-sources`
  - `POST /api/admin/uptime/kuma-sources` (`name`, `base_url`, `slug`, `enabled`)
  - `DELETE /api/admin/uptime/kuma-sources/:id`
  - `POST /api/admin/uptime/kuma-sources/:id/sync`

### 4.4 Subscriptions, Map, Speedtest & IPPure (`/api/subscriptions/*` & `/api/admin/subscriptions/*`)
- **Security rule**: Public endpoints MUST NEVER expose raw subscription URLs (which contain auth tokens) or raw node secrets/passwords/UUIDs. Admin endpoints return full management metadata (URL masked or editable).
- `GET /api/subscriptions`
  Returns array of subscriptions:
  ```json
  {
    "id": 1,
    "name": "My Subscription",
    "source_type": "url", // "url" | "manual"
    "masked_url": "https://sub.example.com/api/v1/client/subscribe?token=***",
    "upload": 1073741824,
    "download": 10737418240,
    "total": 107374182400,
    "expire": 1798761600,
    "node_count": 32,
    "available_count": 29,
    "auto_update_hours": 12,
    "enabled": true,
    "last_synced_at": "ISO8601",
    "last_error": ""
  }
  ```
- `GET /api/subscriptions/nodes?subscription_id=&country=&search=&only_enabled=`
  Returns array of nodes:
  ```json
  {
    "id": 101,
    "subscription_id": 1,
    "subscription_name": "My Subscription",
    "name": "🇯🇵 Japan Tokyo 01",
    "protocol": "vless", // vmess | vless | trojan | ss | hysteria2 | tuic | socks5 | http
    "host": "jp1.example.com", // hostname only (no credentials)
    "port": 443,
    "country_code": "JP",
    "country_name": "Japan",
    "city": "Tokyo",
    "lat": 35.6762,
    "lng": 139.6503,
    "enabled": true,
    "latency_ms": 42, // -1 if failed, 0 if untested
    "download_mbps": 185.4,
    "test_status": "ok", // "untested" | "ok" | "timeout" | "error"
    "tested_at": "ISO8601",
    "ippure": {
      "ip": "189.24.110.250",
      "asn": 979,
      "as_organization": "NetLab Global",
      "country": "Germany",
      "country_code": "DE",
      "region": "Hesse",
      "city": "Frankfurt am Main",
      "longitude": 8.6299,
      "latitude": 50.1025,
      "fraud_score": 43,
      "is_residential": false,
      "is_broadcast": true,
      "checked_at": "ISO8601",
      "error": ""
    }
  }
  ```
- `GET /api/subscriptions/map`
  Returns:
  ```json
  {
    "countries": [
      {
        "country_code": "JP",
        "country_name": "Japan",
        "lat": 35.6762,
        "lng": 139.6503,
        "node_count": 10,
        "available_count": 9,
        "min_latency_ms": 38,
        "avg_latency_ms": 54,
        "avg_fraud_score": 21,
        "residential_count": 3
      }
    ],
    "markers": [
      { "node_id": 101, "name": "...", "country_code": "JP", "city": "Tokyo", "lat": 35.6762, "lng": 139.6503, "latency_ms": 42, "fraud_score": 18, "is_residential": true }
    ]
  }
  ```
- `GET /api/subscriptions/ippure-self` — Returns cached latest direct/server IPPure check result.
- Admin endpoints (`api.RequireRole(api.RoleAdmin)`):
  - `POST /api/admin/subscriptions` (`name`, `url`, `raw_content`, `auto_update_hours`)
  - `PUT /api/admin/subscriptions/:id`
  - `DELETE /api/admin/subscriptions/:id`
  - `POST /api/admin/subscriptions/:id/refresh`
  - `PATCH /api/admin/subscriptions/nodes/:id` (`enabled`, `country_code`, `city`, `lat`, `lng`)
  - `POST /api/admin/subscriptions/test-speed` (`node_ids?: number[]`, `subscription_id?: number`, `mode?: "tcp"|"http"|"download"`, `concurrency?: number`)
  - `POST /api/admin/subscriptions/test-purity` (`node_ids?: number[]`, `subscription_id?: number`, `proxy_url?: string`, `direct?: boolean`)
    - Calls `https://my.ippure.com/v1/info` following redirects (`curl -L` equivalent).
    - Supports direct check (`direct: true`), explicit HTTP/SOCKS5 `proxy_url`, native HTTP/SOCKS5 nodes, and optional `mihomo`/`sing-box` local proxy binary if available on PATH for VMess/VLESS/Trojan/SS/Hysteria2 nodes (returning a clear, actionable message if a protocol requires `mihomo`/`sing-box` and neither is installed, while never crashing).
    - Automatically updates node `lat`, `lng`, `country_code`, `city` when IPPure returns valid coordinates!
  - `POST /api/admin/subscriptions/ippure-check` (`proxy_url?: string`) — Immediate one-shot IPPure test returning the live JSON + caching self-check if `proxy_url` is empty.
