# PulseDeck Docker 部署指南

PulseDeck 默认推荐直接拉取 **预构建双架构镜像（`linux/amd64`、`linux/arm64`）**，在 512MB 小内存 VPS 或 NAS 上也能 10 秒拉起，**无需在目标机现场编译前端或 Go**。同时提供多阶段源码构建方式按需选用。

---

## 1. Docker Compose 预构建镜像一键部署（推荐）

> 若当前 GitHub 仓库设为私有，拉取 GHCR 镜像前需先登录一次：
> ```bash
> echo "$GITHUB_PAT" | docker login ghcr.io -u <你的GitHub用户名> --password-stdin
> ```

```bash
docker compose up -d
```

- 默认拉取镜像：`ghcr.io/arronhc/pulsedeck:latest`（可通过 `PULSEDECK_IMAGE=ghcr.io/arronhc/pulsedeck:snapshot` 切换快照版）
- 默认监听端口：`25774`（可通过 `KOMARI_PORT=8080 docker compose up -d` 自定义）
- 将 `./data` 挂载到容器 `/app/data`，持久化 SQLite 主库与指标库、Uptime 记录、订阅节点和自定义 favicon。

### 零交互自动初始化（可选）

首次启动空库时默认进入 5 步交互式 Web 安装向导（支持在线测试数据库连接，完成后自动登录进入控制台新手引导）；如需自动化部署（跳过安装向导），在 `docker-compose.yml` 的 `environment` 中同时设置管理员账号与强密码（至少 8 位且包含大小写字母与数字）即可：

```yaml
environment:
  PULSEDECK_ADMIN_USER: admin
  PULSEDECK_ADMIN_PASS: ChangeMe123!
  PULSEDECK_SITENAME: PulseDeck
  # 可选，设为 true 启用私有站点（需登录后浏览）
  # PULSEDECK_PRIVATE_SITE: "false"
  # 可选，默认使用本地 SQLite：./data/metrics.db
  # PULSEDECK_METRIC_DSN: ./data/metrics.db
```

---

## 2. 直接使用 `docker run`

```bash
docker run -d \
  --name pulsedeck \
  --restart unless-stopped \
  -p 25774:25774 \
  -e TZ=Asia/Shanghai \
  -e PULSEDECK_ADMIN_USER=admin \
  -e PULSEDECK_ADMIN_PASS='ChangeMe123!' \
  -v "$(pwd)/data:/app/data" \
  ghcr.io/arronhc/pulsedeck:latest
```

---

## 3. 从本地源码自行构建镜像（适合二次开发 / 定制代理核心）

源码构建会在本机执行 Node 22 + Go 1.25 + GCC（SQLite CGO）编译，建议在内存 >= 2GB 的机器或 CI 环境运行：

```bash
# 使用 Compose 源码构建覆盖文件
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

# 或直接 docker build
docker build -t pulsedeck:local .
```

### 可选：启用容器内加密节点 IPPure 出口纯净度检测

对 `VMess / VLESS / Trojan / Shadowsocks / Hysteria2` 等加密代理节点执行 `https://my.ippure.com/v1/info` 出口检测，可选以下任一方式：

1. **构建时内嵌 `sing-box`（Alpine `edge/community`）或 `mihomo`（固定版本 Release）**：
   ```bash
   # 内嵌 sing-box
   INSTALL_PROXY_CORE=sing-box docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

   # 或内嵌 mihomo
   INSTALL_PROXY_CORE=mihomo docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
   ```
2. **使用预构建精简镜像 + 运行时挂载宿主机 `mihomo` / `sing-box` 二进制**（推荐，零重编译）：
   在 `docker-compose.yml` 的 `volumes` 下取消挂载注释：
   ```yaml
   volumes:
     - ./data:/app/data
     - /usr/local/bin/mihomo:/usr/local/bin/mihomo:ro
   ```

---

## 4. 常用维护命令

```bash
# 查看日志
docker compose logs -f

# 更新到最新预构建镜像
docker compose pull && docker compose up -d

# 停止服务
docker compose down
```
