#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(cd "$PROJECT_DIR/.." && pwd)"
VENV_PYTHON="$PARENT_DIR/venv/bin/python"
API_HOST="${API_HOST:-0.0.0.0}"
API_PORT="${API_PORT:-8100}"
DASHBOARD_HOST="${DASHBOARD_HOST:-0.0.0.0}"
DASHBOARD_PORT="${DASHBOARD_PORT:-5174}"

BOT_PID=""
API_PID=""
DASHBOARD_PID=""

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  for pid in "$BOT_PID" "$API_PID" "$DASHBOARD_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done

  wait >/dev/null 2>&1 || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo "Missing .env. Create it from .env.example inside option_1m_project."
  exit 1
fi

if [[ ! -f "$VENV_PYTHON" ]]; then
  echo "Missing virtualenv python at $VENV_PYTHON"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Required command not found: npm"
  exit 1
fi

cd "$PROJECT_DIR"

echo "Starting 1m option bot..."
"$VENV_PYTHON" main.py --mode live &
BOT_PID=$!

echo "Starting 1m option dashboard API on http://$API_HOST:$API_PORT ..."
"$VENV_PYTHON" -m uvicorn dashboard_api:app --host "$API_HOST" --port "$API_PORT" &
API_PID=$!

echo "Starting 1m option React dashboard on http://$DASHBOARD_HOST:$DASHBOARD_PORT ..."
(
  cd "$PROJECT_DIR/dashboard"
  VITE_PROXY_TARGET="http://127.0.0.1:$API_PORT" npm run dev -- --host "$DASHBOARD_HOST" --port "$DASHBOARD_PORT"
) &
DASHBOARD_PID=$!

echo
echo "1m option project services running:"
echo "  Bot PID:        $BOT_PID"
echo "  API PID:        $API_PID"
echo "  Dashboard PID:  $DASHBOARD_PID"
echo "  Dashboard URL:  http://localhost:$DASHBOARD_PORT"
echo "  API URL:        http://localhost:$API_PORT"
echo
echo "Press Ctrl+C to stop everything."

wait
