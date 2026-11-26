# syntax=docker/dockerfile:1

# Stage 1: Build the PulseDeck React/Vite frontend (web-ui)
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
      -o /out/pulsedeck .

# Stage 3: Minimal Alpine runtime
FROM alpine:3.21
WORKDIR /app

# Proxy core for out-of-the-box encrypted-node speedtests and IPPure checks:
#   mihomo   (default, full) — install pinned MetaCubeX/mihomo release binary
#   sing-box                 — install sing-box from Alpine edge/community
#   none     (lite)          — lightweight image without external proxy core
ARG INSTALL_PROXY_CORE=mihomo
ARG MIHOMO_VERSION=v1.19.12
ARG TARGETARCH

RUN apk add --no-cache ca-certificates curl tzdata \
 && case "${INSTALL_PROXY_CORE}" in \
      none) ;; \
      sing-box) \
        apk add --no-cache sing-box --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
        && sing-box version ;; \
      mihomo) \
        case "${TARGETARCH}" in \
          amd64) MIHOMO_ARCH="amd64-compatible" ;; \
          arm64) MIHOMO_ARCH="arm64" ;; \
          *) echo "Unsupported TARGETARCH for mihomo: ${TARGETARCH}" >&2; exit 1 ;; \
        esac \
        && curl -fsSL "https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_VERSION}/mihomo-linux-${MIHOMO_ARCH}-${MIHOMO_VERSION}.gz" -o /tmp/mihomo.gz \
        && gunzip -c /tmp/mihomo.gz > /usr/local/bin/mihomo \
        && chmod 755 /usr/local/bin/mihomo \
        && rm -f /tmp/mihomo.gz \
        && mkdir -p /usr/local/share/licenses/mihomo \
        && curl -fsSL "https://raw.githubusercontent.com/MetaCubeX/mihomo/${MIHOMO_VERSION}/LICENSE" -o /usr/local/share/licenses/mihomo/LICENSE \
        && printf '%s\n' \
          "Component: MetaCubeX/mihomo (${MIHOMO_VERSION}, linux-${MIHOMO_ARCH})" \
          "Installed Binary: /usr/local/bin/mihomo (unmodified upstream release binary)" \
          "License: GNU General Public License v3.0 (GPL-3.0)" \
          "Full License Text: /usr/local/share/licenses/mihomo/LICENSE" \
          "" \
          "Separation Notice:" \
          "  PulseDeck invokes mihomo solely as an optional standalone subprocess over local SOCKS5." \
          "  PulseDeck itself remains licensed under the MIT License." \
          "" \
          "Corresponding Source Code (GPL-3.0 Section 6):" \
          "  Upstream Repository: https://github.com/MetaCubeX/mihomo" \
          "  Exact Tag Tree:      https://github.com/MetaCubeX/mihomo/tree/${MIHOMO_VERSION}" \
          "  Source Archive:      https://github.com/MetaCubeX/mihomo/archive/refs/tags/${MIHOMO_VERSION}.tar.gz" \
          "  Upstream Release:    https://github.com/MetaCubeX/mihomo/releases/tag/${MIHOMO_VERSION}" \
          "" \
          "Written Offer (GPL-3.0 Section 6(b) / 6(d)):" \
          "  If the upstream source links above become unavailable, any recipient of this image may" \
          "  obtain the exact corresponding source archive for mihomo ${MIHOMO_VERSION} free of charge" \
          "  by opening an issue at https://github.com/ArronHC/PulseDeck/issues (valid for at least 3 years)." \
          > /usr/local/share/licenses/mihomo/SOURCE.txt \
        && chmod 644 /usr/local/share/licenses/mihomo/LICENSE /usr/local/share/licenses/mihomo/SOURCE.txt \
        && /usr/local/bin/mihomo -v ;; \
      *) echo "Invalid INSTALL_PROXY_CORE=${INSTALL_PROXY_CORE} (expected none, sing-box, or mihomo)" >&2; exit 1 ;; \
    esac \
 && mkdir -p /app/data /app/cache

COPY --from=backend-builder --chmod=755 /out/pulsedeck /app/pulsedeck

ENV GIN_MODE=release
ENV KOMARI_LISTEN=0.0.0.0:25774
ENV GODEBUG=disablethp=1
ENV TZ=Asia/Shanghai

VOLUME ["/app/data"]
EXPOSE 25774

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:25774/ping >/dev/null 2>&1 || curl -fsS http://127.0.0.1:25774/api/install/status >/dev/null 2>&1 || exit 1

CMD ["/app/pulsedeck", "server"]
