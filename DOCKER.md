# PulseDeck Docker 部署指南

PulseDeck 提供 **Full（默认）** 与 **Lite** 两种预构建双架构镜像（`linux/amd64`、`linux/arm64`），10 秒即可拉起，无需目标机现场编译：

| 镜像标签 | 说明 | 适用场景 |
| :--- | :--- | :--- |
| `ghcr.io/arronhc/pulsedeck:latest`（同 `:full`） | **完整版（推荐，开箱即用）**：内置 `mihomo` 代理核心（含 `/usr/local/share/licenses/mihomo/` 下 GPL-3.0 许可证全文与源码获取说明） | 直接支持加密节点真实代理延迟、下载测速与节点 IPPure 纯净度检测 |
| `ghcr.io/arronhc/pulsedeck:lite` | **精简版**：不含内置代理核心 | 仅用探针/Uptime/浏览器本机测速，或自行挂载宿主机 `mihomo`/`sing-box` |
| `ghcr.io/arronhc/pulsedeck:snapshot` / `:snapshot-lite` | 主干最新快照版（Full / Lite） | 抢先体验最新特性 |

---

## 1. Docker Compose 一键部署（推荐）

```bash
docker compose up -d
```

- 默认拉取 `ghcr.io/arronhc/pulsedeck:latest`（Full 版）。如需精简版，使用 `PULSEDECK_IMAGE=ghcr.io/arronhc/pulsedeck:lite docker compose up -d`。
- 默认监听端口：`25774`（可通过 `KOMARI_PORT=8080 docker compose up -d` 修改）。
- 数据持久化目录：`./data` 挂载到容器 `/app/data`（保存 SQLite 主库与指标库、Uptime 记录、订阅节点与自定义 `favicon.ico`）。

### 零交互自动初始化（可选）

首次启动空库时默认进入 5 步交互式 Web 安装向导；如需自动化部署，在 `docker-compose.yml` 的 `environment` 中同时配置管理员账号与强密码（至少 8 位且包含大小写字母与数字）即可：

```yaml
environment:
  PULSEDECK_ADMIN_USER: admin
  PULSEDECK_ADMIN_PASS: ChangeMe123!
  PULSEDECK_SITENAME: PulseDeck
  # PULSEDECK_PRIVATE_SITE: "false"
  # PULSEDECK_METRIC_DSN: ./data/metrics.db
```

---

## 2. 一键启动虚拟数据公开演示站（Demo）

PulseDeck 内置 `PULSEDECK_DEMO=true` 虚拟数据种子模式（使用 RFC 5737 保留网段与 `demo.example.com` 虚拟节点，零真实隐私数据）：

```bash
docker compose -f docker-compose.demo.yml up -d
```

---

## 3. 从 Komari 迁移至 PulseDeck

PulseDeck 兼容上游 Komari 主库与指标库迁移，支持以下两种无损迁移方式：

1. **方式一：Web 备份包恢复（推荐）**
   - 在原 Komari 后台下载备份压缩包（`backup.zip`，内含 `komari-backup-markup` 与数据库文件）。
   - 部署全新 PulseDeck 后，在首次安装向导（`/install`）的「备份恢复」步骤直接上传该 `.zip` 即可自动重启并完成表结构迁移（PulseDeck 会自动兼容并忽略不再使用的旧插件/主题目录）。
2. **方式二：直接挂载原 Komari `./data` 目录**
   - 停止原 Komari 容器，保留 `./data`（含 `komari.db`、`metrics.db` 等），将其挂载到 PulseDeck 容器 `/app/data`。
   - PulseDeck 启动时会自动执行增量表结构与指标存储迁移，原有探针节点、历史指标、Ping 任务与通知配置均可保留使用。

---

## 4. 从本地源码自行构建镜像

源码构建会在本机执行 Node 22 + Go 1.25 + GCC（SQLite CGO）编译，建议在内存 >= 2GB 的机器或 CI 环境运行：

```bash
# 默认构建 Full 版（内嵌 mihomo）
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

# 构建 Lite 精简版（不安装代理核心）
INSTALL_PROXY_CORE=none docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

# 或构建内嵌 sing-box 版
INSTALL_PROXY_CORE=sing-box docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

若运行 `:lite` 镜像时临时需要节点代理测速/纯净度检测，也可在 `docker-compose.yml` 的 `volumes` 中只读挂载宿主机二进制：

```yaml
volumes:
  - ./data:/app/data
  - /usr/local/bin/mihomo:/usr/local/bin/mihomo:ro
```

---

## 5. 常用维护命令

```bash
docker compose logs -f
docker compose pull && docker compose up -d
docker compose down
```
