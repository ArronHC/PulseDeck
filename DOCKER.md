# PulseDeck Docker 部署指南

本项目提供开箱即用的多阶段 [Dockerfile](./Dockerfile) 与 [docker-compose.yml](./docker-compose.yml)，支持一键构建前端（`web-ui`）、内嵌静态资源并编译 Go 服务端，无需手动预构建二进制。

## 1. Docker Compose 一键部署（推荐）

```bash
docker compose up -d --build
```

- 默认监听端口：`25774`（可通过环境变量 `KOMARI_PORT=8080 docker compose up -d --build` 自定义）
- 数据持久化目录：`./data` 挂载到容器 `/app/data`（保存 SQLite 数据库、Uptime 监控记录、订阅节点、已安装的 Komari 主题商城主题与自定义 favicon）
- 首次访问 `http://<服务器IP>:25774` 会自动进入初始化安装引导，设置管理员账号与站点信息后即可使用全部 4 个标签页：
  - **总览**（Cloudflare Bento 聚合面板）
  - **服务器探针**（Komari 探针 + 支持主题商城任意第三方主题）
  - **服务状态**（内置 Uptime 监控引擎 + 外部 Uptime Kuma 同步）
  - **订阅与节点**（塔台离线矢量世界地图 + 并发测速 + `my.ippure.com/v1/info` 纯净度检测）

## 2. 直接使用 `docker build` / `docker run`

```bash
# 构建镜像
docker build -t pulsedeck:latest .

# 启动容器
docker run -d \
  --name pulsedeck \
  --restart unless-stopped \
  -p 25774:25774 \
  -e TZ=Asia/Shanghai \
  -v "$(pwd)/data:/app/data" \
  pulsedeck:latest
```

## 3. 可选：容器内启用加密节点 IPPure 出口纯净度检测

对 `VMess / VLESS / Trojan / Shadowsocks / Hysteria2` 等加密代理节点执行 `https://my.ippure.com/v1/info` 出口纯净度检测时，可选以下任一方式：

1. **构建时内嵌 `sing-box`**：
   ```bash
   docker build --build-arg INSTALL_PROXY_CORE=sing-box -t pulsedeck:latest .
   ```
2. **运行时挂载宿主机 `mihomo` / `sing-box` 二进制**：
   取消 `docker-compose.yml` 中 `volumes` 的挂载注释即可：
   ```yaml
   volumes:
     - ./data:/app/data
     - /usr/local/bin/mihomo:/usr/local/bin/mihomo:ro
   ```

## 4. 常用维护命令

```bash
# 查看日志
docker compose logs -f

# 更新代码后重新构建并热替换
git pull && docker compose up -d --build

# 停止服务
docker compose down
```
