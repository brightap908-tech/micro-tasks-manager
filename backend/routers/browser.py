"""
Browser navigation endpoints using Playwright.
Opens URLs in a system browser for the user — does NOT automate
task completion, form submission, or any social-media actions.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from backend.database import get_db
from backend import models, schemas
from backend.security import decrypt_password

router = APIRouter(prefix="/api/browser", tags=["browser"])


@router.post("/open")
def open_url(payload: schemas.OpenUrlRequest, db: Session = Depends(get_db)):
    """
    Return the URL (and optionally decrypted credentials) so the frontend
    can open the link in a new browser tab. The server never navigates on
    behalf of the user; only navigation data is returned.
    """
    result: dict = {"url": payload.url, "username": None}

    if payload.credential_id:
        cred = db.query(models.Credential).filter_by(id=payload.credential_id).first()
        if not cred:
            raise HTTPException(status_code=404, detail="Credential not found")
        try:
            result["username"] = cred.username
            result["password_hint"] = "Use your saved credentials to log in."
        except Exception:
            pass
        cred.last_used = datetime.now(timezone.utc)
        db.commit()

    return result


@router.get("/credentials-for-website/{website_id}")
def credentials_for_website(website_id: int, db: Session = Depends(get_db)):
    """Return credentials info (without decrypted password) for a website."""
    creds = db.query(models.Credential).filter_by(website_id=website_id).all()
    return [{"id": c.id, "username": c.username, "last_used": c.last_used} for c in creds]
