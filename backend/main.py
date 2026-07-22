"""
Microtask Manager — FastAPI Backend
Serves the React frontend as static files and exposes a REST API.

IMPORTANT: This application is a productivity tool only.
It does NOT automate task completion, social media actions,
or task submission on behalf of the user.
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from backend.database import engine, Base
from backend.routers import websites, credentials, tasks, reports, notifications, settings, browser, sync

# Absolute path to the pre-built React frontend — resolved at import time so
# it never changes regardless of the working directory uvicorn is started from.
FRONTEND_DIST = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
)
_INDEX_HTML = os.path.join(FRONTEND_DIST, "index.html")
_ASSETS_DIR = os.path.join(FRONTEND_DIST, "assets")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all database tables on startup
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Microtask Manager API",
    description="Productivity tool for managing microtask workflows. Does NOT automate tasks.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the Vite dev server and same-origin prod requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routers ────────────────────────────────────────────────────────────────
app.include_router(websites.router)
app.include_router(credentials.router)
app.include_router(tasks.router)
app.include_router(reports.router)
app.include_router(notifications.router)
app.include_router(settings.router)
app.include_router(browser.router)
app.include_router(sync.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Microtask Manager"}


# ── Static assets (JS/CSS bundles) ────────────────────────────────────────────
# Mount /assets only when the directory is present (build succeeded).
# Checked once at startup; Render always runs the build step before starting.
if os.path.isdir(_ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=_ASSETS_DIR), name="assets")


# ── Favicon ───────────────────────────────────────────────────────────────────
@app.get("/favicon.svg", include_in_schema=False)
def favicon():
    path = os.path.join(FRONTEND_DIST, "favicon.svg")
    if os.path.isfile(path):
        return FileResponse(path, media_type="image/svg+xml")
    return JSONResponse(status_code=404, content={"detail": "Not found"})


# ── SPA catch-all — ALWAYS registered, existence checked per-request ──────────
# This must come last so it doesn't shadow any API route.
# Matches "/" (full_path="") and every client-side route like "/tasks", "/reports".
@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str):
    if os.path.isfile(_INDEX_HTML):
        return FileResponse(_INDEX_HTML, media_type="text/html")
    # Frontend was not built — return a helpful JSON response instead of 404
    return JSONResponse(
        status_code=200,
        content={
            "service": "Microtask Manager API",
            "status": "running",
            "note": "Frontend not built. Run: cd frontend && npm run build",
            "docs": "/docs",
            "health": "/api/health",
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
