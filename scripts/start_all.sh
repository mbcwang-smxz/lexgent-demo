#!/bin/bash
# Start LexGent Demo servers (Data Server + YAML Server)
# Note: Agent Server (lexgent-engine) should be started separately

echo "Starting LexGent Demo Servers..."

mkdir -p .runs

# Start Data Server
echo "Starting Data Server on port 3000..."
npx ts-node src/data_server/index.ts &
DATA_PID=$!

# Start YAML Config Server
echo "Starting YAML Server on port 3003..."
npx ts-node src/yaml_server/index.ts &
YAML_PID=$!

echo ""
echo "Demo servers started:"
echo "   - Data Server: http://localhost:3000 (PID: $DATA_PID)"
echo "   - YAML Server: http://localhost:3003 (PID: $YAML_PID)"
echo ""
echo "Note: Start lexgent-engine separately for Agent Server on port 3001"
echo "Press Ctrl+C to stop all servers."

# Wait for any to exit
wait $DATA_PID $YAML_PID
