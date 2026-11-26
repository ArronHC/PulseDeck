# Upstream Relationship, Licensing & Security Tracking

PulseDeck is developed on top of [komari-monitor/komari](https://github.com/komari-monitor/komari) (MIT License), reusing its probe backend, Agent v2 WebSocket/RPC protocol, metric store, notification channels, and database migration utilities while independently redesigning the product architecture, read-only public status views, Uptime monitoring, and proxy subscription observability modules.

---

## 1. Architecture & Component Attribution

| Subsystem | Origin & Changes |
| :--- | :--- |
| **Probe Agent v2, Metric Store, Auth/2FA/OAuth, Notifications, Migrations** | Derived from `komari-monitor/komari` (MIT). Preserved with security hardening (`RequireSensitive2FA` on `admin:exec`, strict install-route deactivation, and legacy DB compatibility). |
| **StatusHub (`internal/statushub`, `web/api/statushub`)** | Independently built in PulseDeck for Uptime Kuma-compatible monitoring, subscription parsing, world map aggregation, streaming speedtests, automated checks/alerts, and IPPure purity telemetry. |
| **Removed Upstream Subsystems** | Legacy WebSSH/file-manager workbench, third-party Theme Market, and runtime JS Plugin System/Market have been completely removed for a cohesive, minimal-attack-surface deployment. |

---

## 2. License Audit Summary

- **Project License**: MIT License ([LICENSE](./LICENSE)), matching upstream Komari's MIT license.
- **Notice File**: Third-party Apache-2.0 / BSD notices are preserved in [NOTICE](./NOTICE).
- **Backend Go Dependencies (`go.mod`)**: Standard permissive licenses (`MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `MPL-2.0`). Embedded `mihomo` binary in the `full` Docker image is distributed unmodified from MetaCubeX/mihomo (GPL-3.0) as an optional standalone executable invoked over local SOCKS5 (`exec.CommandContext`), with its full GPL-3.0 license text (`/usr/local/share/licenses/mihomo/LICENSE`) and corresponding source acquisition notice/written offer (`/usr/local/share/licenses/mihomo/SOURCE.txt`) packaged inside the image. `:lite` omits `mihomo` completely.
- **Frontend Dependencies (`web-ui/package.json`)**: Standard permissive licenses (`MIT`, `Apache-2.0`, `BSD`, `ISC`), including `React`, `Radix Themes`, `Tailwind CSS`, `Lucide`, `Recharts`, `d3-geo`, `world-atlas`, and `topojson-client`, all inspectable in `/admin/about` -> **Open Source Licenses**.

---

## 3. Komari -> PulseDeck Migration Guide

Existing Komari deployments can migrate without losing server probes, historical metrics, ping tasks, or notification settings:

1. **Via Backup Archive (`.zip`)**: Export `backup.zip` from Komari Admin -> upload it during PulseDeck's `/install` wizard (Step 4: Backup Restore). PulseDeck validates `komari-backup-markup`, extracts data files, runs `internal/migrations` automatically, and ignores removed plugin/theme directories.
2. **Via Existing `./data` Volume**: Stop Komari, mount the existing `./data` directory (`komari.db` + `metrics.db`) to PulseDeck's `/app/data`, and start PulseDeck. Startup migrations run idempotently before serving traffic.

---

## 4. Upstream Security Update Workflow

To track security fixes and Agent v2 protocol updates from `komari-monitor/komari`:

1. Add upstream remote once:
   ```bash
   git remote add upstream https://github.com/komari-monitor/komari.git
   git fetch upstream --tags
   ```
2. Regularly inspect upstream security advisories and commits affecting shared packages (`web/api/`, `web/security/`, `web/connection/`, `database/`, `pkg/metric/`, `internal/metricstore/`, `internal/migrations/`):
   ```bash
   git log --oneline main..upstream/main -- web/ database/ pkg/metric/ internal/metricstore/
   ```
3. Cherry-pick security fixes onto a short-lived branch, run the full Go test & race suite (`go test ./...` + `go test -race ...`), and verify frontend build (`npm run build && npm run lint`) before merging to `main`.
