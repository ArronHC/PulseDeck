#!/usr/bin/env bash
set -euo pipefail

echo "[1/3] Building web-ui frontend..."
(cd web-ui && npm install && npm run build)

echo "[2/3] Packing embedded defaultTheme archive..."
mkdir -p web/public/defaultTheme
cp web-ui/komari-theme.json web/public/defaultTheme/komari-theme.json
go run ./scripts/packdist -src web-ui/dist -out web/public/defaultTheme/dist.tar.zst

echo "[3/3] Building komari-hub binary..."
go build -o ./komari-hub .
echo "Done: ./komari-hub"
