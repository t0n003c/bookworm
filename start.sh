#!/bin/sh
# BookWorm — macOS start script
# Usage: ./start.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# Free port 8000 if something is already listening
lsof -ti tcp:8000 | xargs kill -9 2>/dev/null || true

echo "[BookWorm] Starting on http://localhost:8000  (Ctrl+C to stop)"
exec ./.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
