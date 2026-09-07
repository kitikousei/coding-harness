#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_DIR="$ROOT_DIR/.pids"
LOG_DIR="$ROOT_DIR/.logs"

# ── stop mode ────────────────────────────────────────────────────────────
if [ "${1:-}" = "--stop" ]; then
  echo "Stopping all services..."
  if [ -d "$PID_DIR" ]; then
    for pf in "$PID_DIR"/*.pid; do
      [ -f "$pf" ] || continue
      pid=$(cat "$pf" 2>/dev/null) || continue
      kill "$pid" 2>/dev/null && echo "  Stopped $(basename "$pf" .pid) (pid=$pid)" || true
      rm -f "$pf"
    done
    rmdir "$PID_DIR" 2>/dev/null || true
  fi
  echo "All services stopped."
  exit 0
fi

# ── status mode ──────────────────────────────────────────────────────────
if [ "${1:-}" = "--status" ]; then
  echo "Service status:"
  if [ -d "$PID_DIR" ]; then
    for pf in "$PID_DIR"/*.pid; do
      [ -f "$pf" ] || continue
      pid=$(cat "$pf" 2>/dev/null) || continue
      name=$(basename "$pf" .pid)
      if kill -0 "$pid" 2>/dev/null; then
        echo "  $name: running (pid=$pid)"
      else
        echo "  $name: dead (pid=$pid)"
      fi
    done
  else
    echo "  No services running."
  fi
  exit 0
fi

# ── helpers ──────────────────────────────────────────────────────────────
red()   { echo -e "\033[31m$1\033[0m"; }
green() { echo -e "\033[32m$1\033[0m"; }
cyan()  { echo -e "\033[36m$1\033[0m"; }
yellow(){ echo -e "\033[33m$1\033[0m"; }

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    red "Missing: $1 — install it first"
    exit 1
  fi
}

wait_for_port() {
  local host="$1" port="$2" label="$3" max="${4:-30}"
  local waited=0
  while ! timeout 1 bash -c "echo >/dev/tcp/$host/$port" 2>/dev/null; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$max" ]; then
      red "Timeout waiting for $label on $host:$port"
      return 1
    fi
  done
  green "$label ready on $host:$port"
}

# ── prereqs ──────────────────────────────────────────────────────────────
echo ""
cyan "=== Step 1: Checking prerequisites ==="
check_cmd node
check_cmd pnpm
check_cmd temporal

echo "  node:     $(node --version)"
echo "  pnpm:     $(pnpm --version)"
echo "  temporal: $(temporal --version 2>&1 | head -1)"

# ── install deps ─────────────────────────────────────────────────────────
echo ""
cyan "=== Step 2: Installing dependencies ==="
cd "$ROOT_DIR"
pnpm install --frozen-lockfile

# ── prepare dirs ─────────────────────────────────────────────────────────
mkdir -p "$PID_DIR" "$LOG_DIR"

# ── start Temporal dev server ────────────────────────────────────────────
echo ""
cyan "=== Step 3: Starting Temporal dev server (with Web UI) ==="
nohup temporal server start-dev \
  --ip 0.0.0.0 \
  --db-filename /tmp/pi-agent-temporal-dev.db \
  >"$LOG_DIR/temporal.log" 2>&1 &
echo $! > "$PID_DIR/temporal.pid"
disown

wait_for_port 127.0.0.1 7233 "Temporal gRPC"
wait_for_port 127.0.0.1 8233 "Temporal Web UI"

# ── start Worker ─────────────────────────────────────────────────────────
echo ""
cyan "=== Step 4: Starting Temporal Worker ==="
cd "$ROOT_DIR"
nohup pnpm exec tsx src/cli/worker.ts \
  >"$LOG_DIR/worker.log" 2>&1 &
echo $! > "$PID_DIR/worker.pid"
disown

sleep 2
if kill -0 "$(cat "$PID_DIR/worker.pid")" 2>/dev/null; then
  green "Worker started (taskQueue: pi-agent-tasks)"
else
  red "Worker failed to start — check $LOG_DIR/worker.log"
fi

# ── start Dashboard ──────────────────────────────────────────────────────
echo ""
cyan "=== Step 5: Starting Dashboard ==="
cd "$ROOT_DIR"
nohup pnpm exec tsx src/cli/index.ts dashboard \
  --host 127.0.0.1 \
  --port 8787 \
  >"$LOG_DIR/dashboard.log" 2>&1 &
echo $! > "$PID_DIR/dashboard.pid"
disown

sleep 1
if kill -0 "$(cat "$PID_DIR/dashboard.pid")" 2>/dev/null; then
  green "Dashboard started"
else
  red "Dashboard failed to start — check $LOG_DIR/dashboard.log"
fi

# ── summary ──────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
green "All services started! (detached — safe to close terminal)"
echo ""
echo "  Temporal Server  : localhost:7233 (gRPC)"
echo "  Temporal Web UI  : http://localhost:8233"
echo "  Pi Agent Worker  : taskQueue=pi-agent-tasks"
echo "  Pi Agent Dashboard: http://localhost:8787"
echo ""
echo "  Logs:  $LOG_DIR/"
echo "  PIDs:  $PID_DIR/"
echo ""
echo "  Status:  $ROOT_DIR/init-env.sh --status"
echo "  Stop:    $ROOT_DIR/init-env.sh --stop"
echo "══════════════════════════════════════════════════════════════"
echo ""
