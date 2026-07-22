#!/usr/bin/env bash
# Production start script — the frontend is pre-built and committed to git,
# so no npm step is needed here. Render only needs Python.
set -e

echo "▶ Starting Microtask Manager..."
PORT="${PORT:-5000}"
exec uvicorn main:app --host 0.0.0.0 --port "$PORT"
