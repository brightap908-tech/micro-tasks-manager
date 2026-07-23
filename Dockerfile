# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Build React frontend
# Node is only needed at build time; it won't be in the final image.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --prefer-offline

COPY frontend/ ./
RUN npm run build


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Python runtime + Playwright Chromium
#
# We run as root here so that `playwright install --with-deps` can call
# apt-get to install the OS-level libraries Chromium needs (libnss3, libglib,
# libatk, libdrm, libxkbcommon, …).  This is the fundamental reason Docker is
# required: Render's native Python runtime runs as a non-root user and cannot
# install system packages, causing Chromium to silently download but then fail
# to launch.
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Minimal OS packages needed before playwright --with-deps takes over
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ───────────────────────────────────────────────────────
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# ── Playwright Chromium + ALL system dependencies ─────────────────────────────
# Running as root means apt-get works, so every OS library Chromium needs
# (libnss3, libglib2.0-0, libatk-bridge2.0-0, libdrm2, libxkbcommon0, etc.)
# is installed automatically by --with-deps.
RUN python -m playwright install --with-deps chromium

# ── Application code ──────────────────────────────────────────────────────────
COPY backend/ ./backend/
COPY main.py  ./

# Pull the pre-built frontend from stage 1
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 10000

# Render injects $PORT; fall back to 10000 for local docker run.
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
