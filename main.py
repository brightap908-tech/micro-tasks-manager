"""
Entry point for Render and other ASGI hosts.
The FastAPI application lives in backend/main.py; this file re-exports it
so uvicorn can be invoked as:  uvicorn main:app --host 0.0.0.0 --port $PORT
"""

from backend.main import app  # noqa: F401  re-exported as `app`

__all__ = ["app"]
