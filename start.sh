#!/usr/bin/env bash
# Start backend and frontend concurrently
set -e

echo "▶ Building frontend..."
cd frontend && npm run build && cd ..

echo "▶ Starting Microtask Manager..."
python -m uvicorn backend.main:app --host 0.0.0.0 --port 5000 --reload
