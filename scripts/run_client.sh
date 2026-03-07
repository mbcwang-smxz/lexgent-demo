#!/bin/bash

mkdir -p .runs

# --- Engine must be running first ---
if ! lsof -i :3001 >/dev/null 2>&1; then
    echo ""
    echo "❌ Error: Agent Engine (port 3001) is not running!"
    echo "   Please start it first:"
    echo ""
    echo "     cd ../lexgent-engine && npm start"
    echo ""
    exit 1
fi
echo "[✓] Agent Engine (port 3001) connected."

# --- Check and start demo servers ---
PIDS_TO_KILL=()

if lsof -i :3000 >/dev/null 2>&1; then
    echo "[✓] Data Server (port 3000) already running."
else
    echo "[→] Starting Data Server (port 3000)..."
    ./scripts/run_data_server.sh > .runs/data_server.log 2>&1 &
    PIDS_TO_KILL+=($!)
fi

if lsof -i :3003 >/dev/null 2>&1; then
    echo "[✓] YAML Server (port 3003) already running."
else
    echo "[→] Starting YAML Server (port 3003)..."
    ./scripts/run_yaml_server.sh > .runs/yaml_server.log 2>&1 &
    PIDS_TO_KILL+=($!)
fi

if [ ${#PIDS_TO_KILL[@]} -gt 0 ]; then
    echo "Waiting for servers to initialize (3s)..."
    sleep 3
fi

# Cleanup: kill only servers we started
cleanup() {
    if [ ${#PIDS_TO_KILL[@]} -gt 0 ]; then
        echo -e "\nShutting down demo servers we started..."
        kill "${PIDS_TO_KILL[@]}" 2>/dev/null
        wait "${PIDS_TO_KILL[@]}" 2>/dev/null
    fi
}
trap cleanup EXIT

# Run the client (foreground, blocks until exit)
npx ts-node src/client/index.ts "$@"
