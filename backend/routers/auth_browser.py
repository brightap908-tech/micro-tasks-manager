"""
Browser-based authentication API.
The frontend starts a session, polls screenshots, forwards user interactions,
and saves cookies once login is detected — all without the user ever seeing
or touching a raw cookie value.
"""
import asyncio
import base64
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.services import browser_session as bs
from backend.services import auth_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


# ── Request models ────────────────────────────────────────────────────────────

class StartRequest(BaseModel):
    website_id: int
    login_url: str
    name: str


class InteractRequest(BaseModel):
    action: str              # click | type | key | scroll | navigate
    x: Optional[float] = None
    y: Optional[float] = None
    text: Optional[str] = None
    key: Optional[str] = None
    delta_y: Optional[float] = None
    url: Optional[str] = None


# ── Session endpoints ─────────────────────────────────────────────────────────

@router.post("/session/start")
@limiter.limit("6/minute")
async def start_session(req: StartRequest, request: Request, bg: BackgroundTasks):
    """
    Start a new headless browser session.
    Returns immediately with a session_id; the browser starts in the background.
    Poll /screenshot to get frames and check status.
    """
    session = await bs.create_session(req.website_id, req.login_url)
    bg.add_task(session.start)
    return {
        "session_id": session.session_id,
        "status": "starting",
        "viewport": bs._VIEWPORT,
    }


@router.get("/session/{session_id}/screenshot")
async def get_screenshot(session_id: str):
    """
    Poll for the current page screenshot and session state.
    Returns base64-encoded JPEG + status string.
    """
    session = bs.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found or expired")

    shot = await session.screenshot()
    url = await session.current_url()

    return {
        "status": session.status,          # starting | ready | logged_in | error | closed
        "current_url": url,
        "error_message": session.error_message,
        "image": base64.b64encode(shot).decode() if shot else None,
        "viewport": bs._VIEWPORT,
    }


@router.post("/session/{session_id}/interact")
async def interact(session_id: str, req: InteractRequest):
    """
    Send a user interaction to the headless browser.
    Actions: click (x,y) | type (text) | key (key name) | scroll (delta_y) | navigate (url)
    """
    session = bs.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found or expired")
    if session.status not in ("ready", "logged_in"):
        raise HTTPException(400, f"Session not ready (status: {session.status})")

    if req.action == "click":
        if req.x is None or req.y is None:
            raise HTTPException(400, "click requires x and y")
        await session.click(req.x, req.y)
    elif req.action == "type":
        if not req.text:
            raise HTTPException(400, "type requires text")
        await session.type_text(req.text)
    elif req.action == "key":
        if not req.key:
            raise HTTPException(400, "key requires key name")
        await session.press_key(req.key)
    elif req.action == "scroll":
        await session.scroll(req.delta_y or 100)
    elif req.action == "navigate":
        if not req.url:
            raise HTTPException(400, "navigate requires url")
        await session.navigate(req.url)
    else:
        raise HTTPException(400, f"Unknown action: {req.action!r}")

    return {
        "status": session.status,
        "current_url": await session.current_url(),
    }


@router.post("/session/{session_id}/save")
async def save_session(session_id: str):
    """
    Capture cookies from the active session and persist them server-side.
    Called automatically by the frontend when login is detected, or manually.
    """
    session = bs.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found or expired")

    cookies = await session.get_cookies()
    if not cookies:
        raise HTTPException(400, "No cookies found — please complete login first")

    auth_store.save_cookies(session.website_id, cookies)
    website_id = session.website_id
    await session.close()

    return {"success": True, "website_id": website_id, "cookie_count": len(cookies)}


@router.delete("/session/{session_id}")
async def close_session(session_id: str):
    """Close a session without saving (e.g. user cancelled)."""
    session = bs.get_session(session_id)
    if session:
        await session.close()
    return {"success": True}


# ── Auth status endpoints ─────────────────────────────────────────────────────

@router.get("/status/{website_id}")
def get_auth_status(website_id: int):
    """Check whether a stored session exists for a website."""
    return {
        "website_id": website_id,
        "authenticated": auth_store.has_session(website_id),
        "saved_at": auth_store.get_saved_at(website_id),
    }


@router.delete("/logout/{website_id}")
def logout(website_id: int):
    """Remove stored session for a website."""
    auth_store.delete_session(website_id)
    return {"success": True}


@router.get("/sessions")
def list_all_sessions():
    return {"sessions": auth_store.list_sessions()}
