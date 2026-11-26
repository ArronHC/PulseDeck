# PulseDeck

**全站运维与节点观测台 —— 融合服务器探针、服务状态监控与代理订阅地图/测速/IP 纯净度检测的自托管聚合面板。**

[English](./README.md) | [简体中文](./README_zh-cn.md) | [Docker 部署指南](./DOCKER.md)

PulseDeck 是一款独立设计的全栈自托管观测与节点管理平台，仅复用 [Komari](https://github.com/komari-monitor/komari) 的底层探针与插件引擎，不照搬其产品界面与后台结构。系统采用**前台严格只读展示 + 独立重构管理后台**的前后台分离架构，将**服务器探针**、**服务可用性监控（Uptime Kuma 风格）**与**订阅节点地图/测速/IPPure 纯净度检测（Tower 风格）**统一整合，并完整保留插件扩展能力。

> [!WARNING]
> PulseDeck 是一款自托管监控与管理工具，请仅部署在你拥有或已获得授权管理的服务器与网络环境中。

---

## 核心特性

- **总览 Bento 仪表盘（`/`）**：参考 Cloudflare 模块化总览风格，一屏展示探针在线与资源负载、Uptime 24h 可用率与延迟、订阅节点可用率与纯净度占比、最近事件时间线及全球节点分布预览。
- **前后台职责清晰分离**：公开前台（`/`、`/servers`、`/uptime`、`/subscriptions`）均为纯只读状态页；一切服务器探针节点、Uptime 监控、Uptime Kuma 同步源、代理订阅、测速与 IPPure 检测均收口至全新设计的 **PulseDeck 管理控制台**（`/admin/overview`、`/admin/servers`、`/admin/uptime`、`/admin/subscriptions`）统一管理。
- **首次运行交互式安装向导与新手引导**：内置 5 步交互式首次初始化向导（`/install`，支持密码强度实时校验、公开/私有站点选择、实时指标库连接测试 `POST /api/install/test-db` 与自动登录），进入后台后提供交互式快速上手弹窗与实时同步数据库的 4 步初始化清单（`/api/admin/onboarding`）。
- **服务器探针（`/servers` & `/admin/servers`）**：基于 Komari Agent v2 底层上报引擎，提供实时 WebSocket 负载监控、历史曲线、分组管理、Ping 任务与流量/到期统计；移除了冗余的远程工作台（WebSSH/文件管理器）与第三方主题市场。
- **服务状态监控（`/uptime` & `/admin/uptime`）**：内置轻量级探测引擎（支持 `HTTP/HTTPS`、`关键词`、`TCP`、`Ping`），提供 **60 格心跳色块条**、响应耗时曲线、30 天历史保留与故障事件时间线；支持同步外部 **Uptime Kuma** 状态页。
- **订阅管理 · 世界地图 · 测速 · IPPure 纯净度（`/subscriptions` & `/admin/subscriptions`）**：
  - 支持 `Base64` / URI 节点行（`VMess / VLESS / Trojan / Shadowsocks / Hysteria2 / TUIC / SOCKS5 / HTTP`）、`Clash / Mihomo YAML`、`Sing-box JSON` 订阅解析，自动读取 `Subscription-Userinfo` 展示流量进度与到期倒计时。
  - 内置离线地区识别与矢量**世界地图**（支持「延迟分布 / IP 纯净度」双视图切换与悬停浮窗，点击国家联动筛选节点）。
  - 在后台支持并发延迟测速与 **IPPure 纯净度测试**（调用 `https://my.ippure.com/v1/info`，展示欺诈风险分 `fraudScore`、住宅/机房 IP、原生/广播 IP、ASN 与精准城市坐标）。
- **插件系统保留（`/admin/plugins` & `/admin/plugins/market`）**：完整保留插件安装、插件市场、插件配置与插件自定义页面能力。
- **全局 `⌘K` 快捷搜索与浅/深色切换**：跨模块即时搜索探针主机、Uptime 监控项与订阅节点。
- **单文件二进制 & Docker 一键部署**：前端构建后内嵌进 Go 单文件可执行程序，同时提供预构建多架构镜像与多阶段 `Dockerfile`。

---

## 界面预览

| 系统总览（`/`） | 服务器探针（`/servers`） |
| :---: | :---: |
| ![PulseDeck 系统总览](./docs/screenshots/overview.png) | ![PulseDeck 服务器探针](./docs/screenshots/servers.png) |

| 服务状态（`/uptime`） | 订阅地图 · 测速 · IPPure 纯净度（`/subscriptions`） |
| :---: | :---: |
| ![PulseDeck 服务状态](./docs/screenshots/uptime.png) | ![PulseDeck 订阅与节点](./docs/screenshots/subscriptions.png) |

---

## 快速开始

### Docker Compose 一键部署（推荐：拉取预构建镜像，零本地编译）

```bash
git clone https://github.com/ArronHC/PulseDeck.git
cd PulseDeck
docker compose up -d
```

- 默认拉取双架构预构建镜像 `ghcr.io/arronhc/pulsedeck:latest`，512MB 小内存 VPS 也能 10 秒拉起，无需本地编译。
- 启动后访问 `http://127.0.0.1:25774` 完成初始化，或在 `docker-compose.yml` 中配置 `PULSEDECK_ADMIN_USER` / `PULSEDECK_ADMIN_PASS` 实现零交互自动初始化。
- 如需本地源码构建或内嵌 `sing-box` / `mihomo` 代理核心，使用 `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`，详见 [DOCKER.md](./DOCKER.md)。

### 源码构建运行

需要环境：**Go 1.25+**、**Node.js 22+** 与 C 编译器（`gcc`，用于 SQLite CGO）。

```bash
./build.sh
./pulsedeck server
```

默认监听 `0.0.0.0:25774`（可通过环境变量 `KOMARI_LISTEN=127.0.0.1:25774` 修改）。

---

## 致谢

- [komari-monitor/komari](https://github.com/komari-monitor/komari) — 底层服务器探针引擎、Agent v2 协议、指标存储与插件运行时基础。
- [louislam/uptime-kuma](https://github.com/louislam/uptime-kuma) — 心跳状态条交互与状态页同步兼容。
- [pengchujin/tower](https://github.com/pengchujin/tower) — 订阅流量/到期管理、离线地区识别与世界地图灵感。
- [IPPure](https://my.ippure.com/v1/info) — IP 欺诈风险评分与住宅/原生属性检测接口。

## 开源协议

详见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。
