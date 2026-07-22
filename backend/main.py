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
from fastapi.responses import FileResponse

from backend.database import engine, Base
from backend.routers import websites, credentials, tasks, reports, notifications, settings, browser


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

# Register all routers
app.include_router(websites.router)
app.include_router(credentials.router)
app.include_router(tasks.router)
app.include_router(reports.router)
app.include_router(notifications.router)
app.include_router(settings.router)
app.include_router(browser.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Microtask Manager"}


# ─── Serve React frontend in production ───────────────────────────────────────
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.exists(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        index = os.path.join(FRONTEND_DIST, "index.html")
        return FileResponse(index)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
