#!/bin/bash
# Kill all LexGent server processes (Data Server, Engine, Web Server, YAML Server)

for port in 3000 3001 3002 3003; do
  pids=$(lsof -t -i :$port 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "Port $port: killing PID $pids"
    kill $pids 2>/dev/null
  fi
done

echo "Done."
