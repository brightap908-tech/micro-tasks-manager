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
# PLAYWRIGHT_BROWSERS_PATH pins the install location to a fixed, absolute path
# so the runtime process always finds Chromium regardless of $HOME or which
# user the container runs as.
#
# Running as root here means apt-get works, so --with-deps installs every
# OS library Chromium needs in one shot:
#   libnss3, libglib2.0-0, libatk-bridge2.0-0, libdrm2, libxkbcommon0, …
#
# We run --with-deps exactly once (installs OS libs + browser binary), then
# verify the binary is actually executable before the image is finalised.
# A missing binary at this point = build failure, not a silent runtime error.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN python -m playwright install --with-deps chromium \
    && echo "✓ Playwright Chromium installed" \
    && python - <<'EOF'
import glob, sys
patterns = [
    "/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell",
    "/ms-playwright/chromium-headless-shell-*/chrome-linux/headless_shell",
    "/ms-playwright/chromium_headless_shell-*/chrome-linux/chrome",
    "/ms-playwright/chromium-*/chrome-linux/chrome",
]
found = []
for p in patterns:
    found.extend(glob.glob(p))
if not found:
    print("ERROR: Playwright Chromium binary not found under /ms-playwright", file=sys.stderr)
    print("Contents:", file=sys.stderr)
    import os
    for root, dirs, files in os.walk("/ms-playwright"):
        for f in files:
            print(" ", os.path.join(root, f), file=sys.stderr)
    sys.exit(1)
print(f"✓ Chromium binary verified: {found[0]}")
EOF

# ── Application code ──────────────────────────────────────────────────────────
COPY backend/ ./backend/
COPY main.py  ./

# Pull the pre-built frontend from stage 1
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 10000

# Render injects $PORT; fall back to 10000 for local docker run.
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
