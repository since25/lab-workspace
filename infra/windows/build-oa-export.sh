#!/bin/bash
# 独立生成 OA 自动导出安装包，不包含账号配置、业务导出文件或现有网页应用。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OA_APP="$ROOT/apps/oa-export"
OA_STAGE="$(mktemp -d)"
trap 'rm -rf "$OA_STAGE"' EXIT
cd "$OA_APP"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
cp -R src node_modules package.json package-lock.json "$OA_STAGE/"
"$ROOT/apps/web/node_modules/.bin/esbuild" "$ROOT/apps/web/scripts/sync-materials.ts" --bundle --platform=node --target=node22 --format=esm --external:pg-native \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
  --outfile="$OA_STAGE/import-materials.mjs" --log-level=warning
cp "$ROOT/infra/windows/run-oa-export.ps1" "$OA_STAGE/run.ps1"
mkdir -p "$ROOT/dist"
rm -f "$ROOT/dist/oa-export.zip"
(cd "$OA_STAGE" && zip -qr "$ROOT/dist/oa-export.zip" .)
test -s "$ROOT/dist/oa-export.zip"
echo "已生成：$ROOT/dist/oa-export.zip"
