#!/usr/bin/env bash
# Production start script — builds the frontend then starts the backend.
set -e

echo "▶ Building frontend..."
cd frontend && npm install && npm run build && cd ..

echo "▶ Starting Microtask Manager..."
PORT="${PORT:-5000}"
exec uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
