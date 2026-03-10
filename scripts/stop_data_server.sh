#!/bin/bash
pid=$(lsof -ti TCP:3000 -sTCP:LISTEN 2>/dev/null)
if [ -n "$pid" ]; then
    kill $pid 2>/dev/null
    echo "[✓] Data Server (port 3000, PID $pid) stopped."
else
    echo "[−] Data Server (port 3000) is not running."
fi
