#!/usr/bin/env bash
# Production start script — frontend is built during the Render build step.
set -e

echo "▶ Starting Microtask Manager..."
PORT="${PORT:-5000}"
exec uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
