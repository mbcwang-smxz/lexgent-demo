#!/bin/bash
pid=$(lsof -ti TCP:3003 -sTCP:LISTEN 2>/dev/null)
if [ -n "$pid" ]; then
    kill $pid 2>/dev/null
    echo "[✓] YAML Server (port 3003, PID $pid) stopped."
else
    echo "[−] YAML Server (port 3003) is not running."
fi
