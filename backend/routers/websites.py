"""
Website and folder management endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from backend.database import get_db
from backend import models, schemas
from backend.services.activity import log_activity

router = APIRouter(prefix="/api/websites", tags=["websites"])


# ─── Folders ──────────────────────────────────────────────────────────────────

@router.get("/folders", response_model=List[schemas.WebsiteFolder])
def list_folders(db: Session = Depends(get_db)):
    return db.query(models.WebsiteFolder).order_by(models.WebsiteFolder.name).all()


@router.post("/folders", response_model=schemas.WebsiteFolder, status_code=201)
def create_folder(payload: schemas.WebsiteFolderCreate, db: Session = Depends(get_db)):
    folder = models.WebsiteFolder(**payload.model_dump())
    db.add(folder)
    db.commit()
    db.refresh(folder)
    log_activity(db, "Created folder", folder.name, "folder", folder.id)
    return folder


@router.put("/folders/{folder_id}", response_model=schemas.WebsiteFolder)
def update_folder(folder_id: int, payload: schemas.WebsiteFolderUpdate, db: Session = Depends(get_db)):
    folder = db.query(models.WebsiteFolder).filter_by(id=folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(folder, k, v)
    db.commit()
    db.refresh(folder)
    return folder


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder(folder_id: int, db: Session = Depends(get_db)):
    folder = db.query(models.WebsiteFolder).filter_by(id=folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    # Unassign websites from this folder
    db.query(models.Website).filter_by(folder_id=folder_id).update({"folder_id": None})
    db.delete(folder)
    db.commit()


# ─── Websites ─────────────────────────────────────────────────────────────────

@router.get("", response_model=List[schemas.WebsiteWithStats])
def list_websites(
    enabled_only: bool = False,
    folder_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    q = db.query(models.Website)
    if enabled_only:
        q = q.filter_by(is_enabled=True)
    if folder_id is not None:
        q = q.filter_by(folder_id=folder_id)
    websites = q.order_by(models.Website.name).all()

    result = []
    for w in websites:
        tasks = db.query(models.Task).filter_by(website_id=w.id).all()
        completed = [t for t in tasks if t.status == models.TaskStatus.COMPLETED]
        earnings = sum(t.reward for t in completed)
        ws = schemas.WebsiteWithStats.model_validate(w)
        ws.task_count = len(tasks)
        ws.completed_tasks = len(completed)
        ws.total_earnings = earnings
        result.append(ws)

    return result


@router.post("", response_model=schemas.Website, status_code=201)
def create_website(payload: schemas.WebsiteCreate, db: Session = Depends(get_db)):
    website = models.Website(**payload.model_dump())
    db.add(website)
    db.commit()
    db.refresh(website)
    log_activity(db, "Added website", website.name, "website", website.id)
    return website


@router.get("/{website_id}", response_model=schemas.WebsiteWithStats)
def get_website(website_id: int, db: Session = Depends(get_db)):
    w = db.query(models.Website).filter_by(id=website_id).first()
    if not w:
        raise HTTPException(status_code=404, detail="Website not found")
    tasks = db.query(models.Task).filter_by(website_id=w.id).all()
    completed = [t for t in tasks if t.status == models.TaskStatus.COMPLETED]
    ws = schemas.WebsiteWithStats.model_validate(w)
    ws.task_count = len(tasks)
    ws.completed_tasks = len(completed)
    ws.total_earnings = sum(t.reward for t in completed)
    return ws


@router.put("/{website_id}", response_model=schemas.Website)
def update_website(website_id: int, payload: schemas.WebsiteUpdate, db: Session = Depends(get_db)):
    website = db.query(models.Website).filter_by(id=website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(website, k, v)
    db.commit()
    db.refresh(website)
    log_activity(db, "Updated website", website.name, "website", website.id)
    return website


@router.delete("/{website_id}", status_code=204)
def delete_website(website_id: int, db: Session = Depends(get_db)):
    website = db.query(models.Website).filter_by(id=website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    db.delete(website)
    db.commit()
    log_activity(db, "Deleted website", website.name, "website", website_id)


@router.post("/{website_id}/toggle", response_model=schemas.Website)
def toggle_website(website_id: int, db: Session = Depends(get_db)):
    website = db.query(models.Website).filter_by(id=website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    website.is_enabled = not website.is_enabled
    db.commit()
    db.refresh(website)
    return website
