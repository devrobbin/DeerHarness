#!/usr/bin/env bash
# DeerHarness 开发模式启动脚本（不用 Docker）
set -e

cd "$(dirname "$0")"

# 加载 .env（必填环境变量，缺失即启动失败）
if [ -f .env ]; then
  set -a
  source .env
  set +a
else
  echo "⚠️  未找到 .env，请先 cp .env.example .env 并填写必填项"
  exit 1
fi

# 1. 启动 Gateway（端口 8080）
echo "🚀 启动 DeerHarness Gateway (http://localhost:${GATEWAY_PORT:-8080}) ..."
(cd gateway && pip install -q -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port "${GATEWAY_PORT:-8080}" --reload) &
GATEWAY_PID=$!

# 2. 启动 Web（端口 3000）
echo "🌐 启动 DeerHarness Web (http://localhost:${WEB_PORT:-3000}) ..."
(cd web && npm install -q && npm run dev) &
WEB_PID=$!

trap 'echo "🛑 停止服务..."; kill $GATEWAY_PID $WEB_PID 2>/dev/null' EXIT

echo "✅ 全部启动完成。按 Ctrl+C 停止。"
wait
