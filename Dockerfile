# syntax=docker/dockerfile:1

# Stage 1: Build the Mobbin-guided React/Vite frontend (web-ui)
FROM node:22-alpine AS frontend-builder
WORKDIR /src/web-ui

COPY web-ui/package.json web-ui/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY web-ui/ ./
RUN npm run build

# Stage 2: Pack embedded frontend and build Go backend with CGO SQLite
FROM golang:1.25-alpine AS backend-builder
WORKDIR /src

RUN apk add --no-cache build-base

COPY go.mod go.sum ./
RUN go mod download

COPY . ./
COPY --from=frontend-builder /src/web-ui/dist ./web-ui/dist
COPY --from=frontend-builder /src/web-ui/komari-theme.json ./web/public/defaultTheme/komari-theme.json

RUN mkdir -p ./web/public/defaultTheme \
 && go run ./scripts/packdist -src ./web-ui/dist -out ./web/public/defaultTheme/dist.tar.zst

ARG VERSION=docker
ARG VERSION_HASH=local
ARG TARGETOS=linux
ARG TARGETARCH

RUN CGO_ENABLED=1 GOOS=${TARGETOS} GOARCH=${TARGETARCH} GIN_MODE=release \
    go build -trimpath \
      -tags "nomsgpack sqlite_omit_load_extension" \
      -ldflags="-s -w -buildid= -X github.com/komari-monitor/komari/utils.CurrentVersion=${VERSION} -X github.com/komari-monitor/komari/utils.VersionHash=${VERSION_HASH}" \
      -o /out/komari .

# Stage 3: Minimal Alpine runtime
FROM alpine:3.21
WORKDIR /app

# Optional: set --build-arg INSTALL_PROXY_CORE=sing-box (or mihomo) to enable
# through-node IPPure exit checks for VMess/VLESS/Trojan/SS/Hysteria2 nodes.
ARG INSTALL_PROXY_CORE=none
ARG TARGETARCH

RUN apk add --no-cache ca-certificates curl tzdata \
 && if [ "$INSTALL_PROXY_CORE" = "sing-box" ]; then \
      apk add --no-cache sing-box --repository=https://dl-cdn.alpinelinux.org/alpine/edge/testing || true; \
    fi \
 && mkdir -p /app/data

COPY --from=backend-builder --chmod=755 /out/komari /app/komari

ENV GIN_MODE=release
ENV KOMARI_LISTEN=0.0.0.0:25774
ENV GODEBUG=disablethp=1
ENV TZ=Asia/Shanghai

VOLUME ["/app/data"]
EXPOSE 25774

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:25774/ping >/dev/null 2>&1 || curl -fsS http://127.0.0.1:25774/api/install/status >/dev/null 2>&1 || exit 1

CMD ["/app/komari", "server"]
