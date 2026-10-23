#!/bin/bash
# 在开发机（macOS）上生成 windows-wg 安装包，输出到 dist/（已被 .gitignore 忽略）
#   dist/bundle/app.zip      应用（网页独立构建、分析服务、标签打印服务、数据库迁移、脚本，共用一个 VERSION）——每次升级都要
#   dist/bundle/deploy/      安装与守护脚本
#   dist/bundle/runtime/     Node / PostgreSQL / R / Python 运行环境与 R 包、Python 依赖——首次安装或依赖变化时才需要
# 用法：bash infra/windows/build-bundle.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="$ROOT/dist"
B="$DIST/bundle"
NODE_VER=v22.23.3
PG_VER=16.14-1
R_VER=4.5.3
PY_VER=3.13.15   # 与标签服务已实物校准的线上系统 Python 同版本

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

echo "== 标签打印服务（Python，装到 app\\labelprint）"
rsync -a --exclude '__pycache__' --exclude '.pytest_cache' --exclude '.venv' --exclude 'data' --exclude 'preview' --exclude 'docs' \
  "$ROOT/apps/labelprint/" "$STAGE/labelprint/"
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
get "https://www.python.org/ftp/python/$PY_VER/python-$PY_VER-embed-amd64.zip" "python-$PY_VER-embed-amd64.zip"
# 标签服务依赖：按 Windows/CPython 3.13 平台下载二进制包，文件名带锁定清单的摘要，清单一变安装脚本就会重装
REQ="$ROOT/apps/labelprint/requirements-win.txt"
PKG="python-packages-$(shasum -a 256 "$REQ" | cut -c1-8).zip"
if [ ! -s "$B/runtime/$PKG" ]; then
  rm -f "$B"/runtime/python-packages-*.zip
  python3 -m pip install -q --target "$STAGE/pypkgs" --platform win_amd64 --python-version 3.13 \
    --implementation cp --abi cp313 --only-binary=:all: --no-deps -r "$REQ"
  rm -rf "$STAGE/pypkgs/bin"; find "$STAGE/pypkgs" -name '__pycache__' -type d -prune -exec rm -rf {} +
  (cd "$STAGE/pypkgs" && zip -qr "$B/runtime/$PKG" .)
fi

du -sh "$B/app.zip" "$B/runtime"
echo "完成：$B"
