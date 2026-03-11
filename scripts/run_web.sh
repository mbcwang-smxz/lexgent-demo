#!/bin/bash

mkdir -p .runs

# Load .env to get configured URLs
if [ -f .env ]; then
    export $(grep -v '^\s*#' .env | grep -v '^\s*$' | xargs)
fi
AGENT_URL="${AGENT_SERVER_URL:-http://localhost:3001}"
DATA_URL="${DATA_SERVER_URL:-http://localhost:3000}"
YAML_URL="${YAML_SERVER_URL:-http://localhost:3003}"

# Helper: check if a URL is reachable (bypass proxy to avoid false positives)
check_url() {
    curl --noproxy '*' -so /dev/null --connect-timeout 2 "$1" 2>/dev/null
}

# Helper: check if a URL points to this machine
is_local() {
    local host
    host=$(echo "$1" | sed -E 's|https?://([^:/]+).*|\1|')
    # Check common local names
    echo "$host" | grep -qE '^(localhost|127\.0\.0\.1)$' && return 0
    # Check if host matches any local IP
    ip -4 addr show 2>/dev/null | grep -qF "$host" && return 0
    return 1
}

# --- Engine must be running first ---
if ! check_url "$AGENT_URL"; then
    echo ""
    echo "❌ Error: Agent Engine ($AGENT_URL) is not reachable!"
    echo "   Please start it first:"
    echo ""
    echo "     cd ../lexgent-engine && npm start"
    echo ""
    exit 1
fi
echo "[✓] Agent Engine ($AGENT_URL) connected."

# --- Check and start demo servers (only if local) ---
PIDS_TO_KILL=()

if check_url "$DATA_URL"; then
    echo "[✓] Data Server ($DATA_URL) already running."
elif is_local "$DATA_URL"; then
    echo "[→] Starting Data Server ($DATA_URL)..."
    ./scripts/run_data_server.sh > .runs/data_server.log 2>&1 &
    PIDS_TO_KILL+=($!)
else
    echo "⚠️  Data Server ($DATA_URL) is not reachable (remote, not auto-starting)."
fi

if check_url "$YAML_URL"; then
    echo "[✓] YAML Server ($YAML_URL) already running."
elif is_local "$YAML_URL"; then
    echo "[→] Starting YAML Server ($YAML_URL)..."
    ./scripts/run_yaml_server.sh > .runs/yaml_server.log 2>&1 &
    PIDS_TO_KILL+=($!)
else
    echo "⚠️  YAML Server ($YAML_URL) is not reachable (remote, not auto-starting)."
fi

if [ ${#PIDS_TO_KILL[@]} -gt 0 ]; then
    echo "Waiting for servers to initialize (3s)..."
    sleep 3
fi

# Cleanup: kill only servers we started (by PID)
cleanup() {
    if [ ${#PIDS_TO_KILL[@]} -gt 0 ]; then
        echo -e "\nShutting down demo servers we started..."
        for pid in "${PIDS_TO_KILL[@]}"; do
            kill $pid 2>/dev/null
        done
    fi
}
trap cleanup EXIT SIGINT SIGTERM

# Run the web server (foreground, blocks until exit)
echo "[→] Starting web server (first load may take a moment)..."
exec npx ts-node src/web_server/index.ts
