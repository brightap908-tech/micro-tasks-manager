#!/usr/bin/env bash
# Production start script — starts the FastAPI backend.
# The frontend is pre-built during the Render build phase (npm run build).
set -e

echo "▶ Starting Microtask Manager..."
PORT="${PORT:-5000}"
exec uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
