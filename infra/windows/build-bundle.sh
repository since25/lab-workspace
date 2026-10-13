#!/bin/bash
# 在开发机（macOS）上生成 windows-wg 安装包，输出到 dist/（已被 .gitignore 忽略）
#   dist/bundle/app.zip      应用（网页独立构建、分析服务、数据库迁移、脚本）——每次升级都要
#   dist/bundle/deploy/      安装与守护脚本
#   dist/bundle/runtime/     Node / PostgreSQL / R 安装文件与 R 包仓库——首次安装才需要
# 用法：bash infra/windows/build-bundle.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="$ROOT/dist"
B="$DIST/bundle"
NODE_VER=v22.23.3
PG_VER=16.14-1
R_VER=4.5.3

mkdir -p "$B/runtime" "$B/deploy"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "== 构建网页"
cd "$ROOT/apps/web"
npx next build >/dev/null
mkdir -p "$STAGE/web"
cp -R .next/standalone/. "$STAGE/web/"
mkdir -p "$STAGE/web/.next" && cp -R .next/static "$STAGE/web/.next/static"
[ -d public ] && cp -R public "$STAGE/web/public"
rm -rf "$STAGE/web/node_modules/@img"   # macOS 的 sharp 原生库，本项目不用图片优化

echo "== 打包迁移与建管理员脚本（单文件，不依赖 node_modules）"
mkdir -p "$STAGE/scripts"
for s in migrate create-admin; do
  npx --yes esbuild@0.25 "scripts/$s.mjs" --bundle --platform=node --format=esm --external:pg-native \
    --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
    --outfile="$STAGE/scripts/$s.mjs" --log-level=warning
done

echo "== 分析服务与数据库迁移"
mkdir -p "$STAGE/r-engine" "$STAGE/db"
cp -R "$ROOT/apps/r-engine/api.R" "$ROOT/apps/r-engine/start.R" "$ROOT/apps/r-engine/R" "$ROOT/apps/r-engine/LICENSE-EditR" "$STAGE/r-engine/"
cp -R "$ROOT/db/migrations" "$STAGE/db/migrations"
git -C "$ROOT" rev-parse --short HEAD > "$STAGE/VERSION" 2>/dev/null || echo unknown > "$STAGE/VERSION"
rm -f "$B/app.zip"
(cd "$STAGE" && zip -qr "$B/app.zip" .)

echo "== 部署脚本"
cp "$ROOT"/infra/windows/*.ps1 "$B/deploy/"

echo "== 运行环境（已下载的跳过）"
get() { [ -s "$B/runtime/$2" ] || curl -fL --retry 3 -o "$B/runtime/$2" "$1"; }
get "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-win-x64.zip" "node-$NODE_VER-win-x64.zip"
get "https://get.enterprisedb.com/postgresql/postgresql-$PG_VER-windows-x64-binaries.zip" "postgresql-$PG_VER-windows-x64-binaries.zip"
get "https://cloud.r-project.org/bin/windows/base/old/$R_VER/R-$R_VER-win.exe" "R-$R_VER-win.exe"
Rscript "$ROOT/infra/windows/build-rpkgs.R" "$B/runtime/rpkgs"

du -sh "$B/app.zip" "$B/runtime"
echo "完成：$B"
