"""
Microtask Manager — FastAPI Backend (Sync Proxy Only)

All application data is stored in IndexedDB on the client browser.
This server's only role is to act as an HTTP proxy for the sync feature,
bypassing CORS restrictions when reading external microtask websites.

IMPORTANT: This application is a productivity tool only.
It does NOT automate task completion, social media actions,
or task submission on behalf of the user.
"""

import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from backend.routers import sync

logging.basicConfig(level=logging.INFO)

FRONTEND_DIST = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
)
_INDEX_HTML = os.path.join(FRONTEND_DIST, "index.html")
_ASSETS_DIR = os.path.join(FRONTEND_DIST, "assets")

app = FastAPI(
    title="Microtask Manager — Sync Proxy",
    description=(
        "Lightweight proxy that fetches microtask website pages and "
        "returns extracted data. All app data is stored in browser IndexedDB."
    ),
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API ────────────────────────────────────────────────────────────────────────
app.include_router(sync.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Microtask Manager", "storage": "IndexedDB (client-side)"}


# ── Static assets ──────────────────────────────────────────────────────────────
if os.path.isdir(_ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=_ASSETS_DIR), name="assets")


@app.get("/favicon.svg", include_in_schema=False)
def favicon():
    path = os.path.join(FRONTEND_DIST, "favicon.svg")
    if os.path.isfile(path):
        return FileResponse(path, media_type="image/svg+xml")
    return JSONResponse(status_code=404, content={"detail": "Not found"})


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str):
    if os.path.isfile(_INDEX_HTML):
        return FileResponse(_INDEX_HTML, media_type="text/html")
    return JSONResponse(
        status_code=200,
        content={
            "service": "Microtask Manager Sync Proxy",
            "status": "running",
            "storage": "IndexedDB (client-side)",
            "note": "Frontend not built. Run: cd frontend && npm run build",
            "docs": "/docs",
            "health": "/api/health",
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
