#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PYTHON="$ROOT_DIR/venv/bin/python"
API_HOST="${API_HOST:-0.0.0.0}"
API_PORT="${API_PORT:-8000}"
DASHBOARD_HOST="${DASHBOARD_HOST:-0.0.0.0}"
DASHBOARD_PORT="${DASHBOARD_PORT:-5173}"

BOT_PID=""
API_PID=""
DASHBOARD_PID=""

require_file() {
  local path="$1"
  local label="$2"
  if [[ ! -f "$path" ]]; then
    echo "Missing $label at $path"
    exit 1
  fi
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Required command not found: $name"
    exit 1
  fi
}

check_port_free() {
  local port="$1"
  local label="$2"
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "$label port $port is already in use. Stop the existing process or set a different port."
    exit 1
  fi
}

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

require_file "$ROOT_DIR/.env" ".env"
require_file "$VENV_PYTHON" "virtualenv python"
require_command npm
require_command lsof

check_port_free "$API_PORT" "Dashboard API"
check_port_free "$DASHBOARD_PORT" "Dashboard"

cd "$ROOT_DIR"

echo "Starting NIFTY bot..."
"$VENV_PYTHON" main.py --mode live &
BOT_PID=$!

echo "Starting dashboard API on http://$API_HOST:$API_PORT ..."
"$VENV_PYTHON" -m uvicorn dashboard_api:app --host "$API_HOST" --port "$API_PORT" &
API_PID=$!

echo "Starting React dashboard on http://$DASHBOARD_HOST:$DASHBOARD_PORT ..."
(
  cd "$ROOT_DIR/dashboard"
  npm run dev -- --host "$DASHBOARD_HOST" --port "$DASHBOARD_PORT"
) &
DASHBOARD_PID=$!

echo
echo "Services running:"
echo "  Bot PID:        $BOT_PID"
echo "  API PID:        $API_PID"
echo "  Dashboard PID:  $DASHBOARD_PID"
echo "  Dashboard URL:  http://localhost:$DASHBOARD_PORT"
echo "  LAN URL:        http://<your-machine-ip>:$DASHBOARD_PORT"
echo
echo "Press Ctrl+C to stop everything."

wait
