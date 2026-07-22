"""
Sync endpoints — trigger HTTP fetches for connected websites and return
the extracted snapshot data.  Read-only: no task automation.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from backend.database import get_db
from backend import models, schemas
from backend.services.sync import sync_website

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.post("/website/{website_id}", response_model=schemas.WebsiteSyncResult)
async def sync_one_website(website_id: int, db: Session = Depends(get_db)):
    """Sync a single website and return the snapshot result."""
    website = db.query(models.Website).filter_by(id=website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    snapshot = await sync_website(db, website)
    return _to_result(website, snapshot)


@router.post("/all", response_model=schemas.SyncAllResult)
async def sync_all_websites(db: Session = Depends(get_db)):
    """Sync all enabled websites and return aggregated results."""
    websites = db.query(models.Website).filter_by(is_enabled=True).all()
    results: List[schemas.WebsiteSyncResult] = []
    for website in websites:
        snapshot = await sync_website(db, website)
        results.append(_to_result(website, snapshot))

    succeeded = sum(1 for r in results if r.status == "ok")
    return schemas.SyncAllResult(total=len(results), succeeded=succeeded, results=results)


@router.get("/status", response_model=List[schemas.WebsiteSyncResult])
def get_sync_status(db: Session = Depends(get_db)):
    """Return the latest snapshot for every website (or empty list if never synced)."""
    websites = db.query(models.Website).all()
    out: List[schemas.WebsiteSyncResult] = []
    for website in websites:
        snap = (
            db.query(models.WebsiteSnapshot)
            .filter_by(website_id=website.id)
            .order_by(models.WebsiteSnapshot.synced_at.desc())
            .first()
        )
        if snap:
            out.append(_to_result(website, snap))
    return out


# ── Helper ────────────────────────────────────────────────────────────────────

def _to_result(
    website: models.Website, snapshot: models.WebsiteSnapshot
) -> schemas.WebsiteSyncResult:
    return schemas.WebsiteSyncResult(
        website_id=website.id,
        website_name=website.name,
        status=snapshot.status,
        available_balance=snapshot.available_balance,
        available_tasks=snapshot.available_tasks,
        page_title=snapshot.page_title,
        error_message=snapshot.error_message,
        synced_at=snapshot.synced_at,
    )
