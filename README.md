# PulseDeck

**All-in-one self-hosted infrastructure, service uptime, and proxy node observability deck.**

[English](./README.md) | [简体中文](./README_zh-cn.md) | [Docker Guide](./DOCKER.md)

PulseDeck is an independent self-hosted observability and network status platform built on top of [Komari](https://github.com/komari-monitor/komari)'s probe & plugin engine. It unifies **real-time server probes**, **Uptime Kuma–style service monitoring**, and **Tower-inspired proxy subscription management (world map, speedtest, and IPPure IP purity checks)** behind a strictly read-only public status interface and a dedicated PulseDeck Admin Console — with full **Plugin System & Plugin Market** support.

> [!WARNING]
> PulseDeck is a self-hosted monitoring and management application. Deploy it only on infrastructure you own or are authorized to manage.

---

## Highlights

- **Unified Bento Overview (`/`)** — Cloudflare-inspired KPI cards with sparklines, live node summaries, compact uptime heartbeat strips, subscription traffic & expiry trackers, incident feed, and a global node distribution preview.
- **Read-Only Public Observability + Dedicated Admin Console** — Public pages (`/`, `/servers`, `/uptime`, `/subscriptions`) are strictly read-only. All server probe nodes, uptime monitors, Uptime Kuma sync sources, proxy subscriptions, speedtests, IPPure checks, alerts, and plugins are managed centrally in the rebuilt PulseDeck Admin Console (`/admin/overview`, `/admin/servers`, `/admin/uptime`, `/admin/subscriptions`, `/admin/plugins`).
- **Interactive First-Run Setup Wizard & Onboarding** — A 5-step interactive `/install` wizard with live password strength checks, site visibility options, and real-time database connection testing (`POST /api/install/test-db`), followed by automatic admin login and an interactive post-install walkthrough & live setup checklist (`/api/admin/onboarding`).
- **Server Probes (`/servers` & `/admin/servers`)** — Real-time WebSocket probe monitoring (CPU, RAM, disk, network, load, ping history, traffic quotas, billing/expiry tracking) powered by Komari's Agent v2 engine, without legacy web terminal/workbench bloat.
- **Service Uptime Monitoring (`/uptime` & `/admin/uptime`)** — Built-in lightweight checker (`HTTP/HTTPS`, `Keyword`, `TCP`, `Ping`) with 60-tick heartbeat bars, 30-day retention, latency charts, and automatic incident history — plus optional sync with external **Uptime Kuma** status pages.
- **Subscriptions, World Map, Speedtest & IPPure Purity (`/subscriptions` & `/admin/subscriptions`)** — Parse `Base64` / URI lines (`VMess`, `VLESS`, `Trojan`, `Shadowsocks`, `Hysteria2`, `TUIC`, `SOCKS5`, `HTTP`), `Clash / Mihomo YAML`, and `Sing-box JSON` subscriptions with traffic quota & expiry parsing (`Subscription-Userinfo`). Visualize nodes on an offline vector world map, run concurrent latency/speed tests, and check IP exit purity via `https://my.ippure.com/v1/info` (`fraudScore`, residential/datacenter, native/broadcast, ASN, city & coordinates).
- **Plugin Ecosystem (`/admin/plugins` & `/admin/plugins/market`)** — Full plugin runtime, archive upload, plugin market sources, configuration forms, and custom plugin pages — without third-party theme market hijacking.
- **Clean Top-Tab UX & Global `⌘K` Search** — Zero sidebar clutter on public views, light/dark themes, and instant cross-module search across servers, uptime monitors, and subscription nodes.
- **Single Binary & Docker Ready** — Embedded React/Vite frontend packed into a single Go binary, or 1-command `docker compose up -d`.

---

## Screenshots

| Overview (`/`) | Server Probes (`/servers`) |
| :---: | :---: |
| ![PulseDeck Overview](./docs/screenshots/overview.png) | ![PulseDeck Server Probes](./docs/screenshots/servers.png) |

| Service Uptime (`/uptime`) | Subscriptions · Map · IPPure (`/subscriptions`) |
| :---: | :---: |
| ![PulseDeck Uptime](./docs/screenshots/uptime.png) | ![PulseDeck Subscriptions](./docs/screenshots/subscriptions.png) |

---

## Quick Start

### Docker Compose (Recommended — Prebuilt Image, Zero Local Build)

```bash
git clone https://github.com/ArronHC/PulseDeck.git
cd PulseDeck
docker compose up -d
```

- Pulls the multi-arch GHCR image (`ghcr.io/arronhc/pulsedeck:latest`), ready in seconds even on 512 MB RAM VPSes.
- Open `http://127.0.0.1:25774` to finish setup, or pass `PULSEDECK_ADMIN_USER` & `PULSEDECK_ADMIN_PASS` in `docker-compose.yml` for zero-click headless initialization.
- Need a local source build or embedded `sing-box` / `mihomo` proxy core? Use `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` — see [DOCKER.md](./DOCKER.md).

### Build From Source

Requirements: **Go 1.25+**, **Node.js 22+**, and a C compiler (`gcc`) for SQLite CGO.

```bash
./build.sh
./pulsedeck server
```

Default listen address is `0.0.0.0:25774` (override with `KOMARI_LISTEN=127.0.0.1:25774`).

---

## Acknowledgments

PulseDeck builds upon and takes inspiration from these great projects:

- [komari-monitor/komari](https://github.com/komari-monitor/komari) — Underlying probe backend, Agent v2 protocol, metric store, and plugin runtime engine.
- [louislam/uptime-kuma](https://github.com/louislam/uptime-kuma) — Uptime heartbeat bar UX and status page sync compatibility.
- [pengchujin/tower](https://github.com/pengchujin/tower) — Subscription traffic/expiry tracking, offline region mapping, and node map inspiration.
- [IPPure](https://my.ippure.com/v1/info) — IP fraud score, residential/datacenter, and native/broadcast purity telemetry.

## License

See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
