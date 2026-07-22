"""
Notification management endpoints.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List
from backend.database import get_db
from backend import models, schemas

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=List[schemas.Notification])
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db)
):
    q = db.query(models.Notification)
    if unread_only:
        q = q.filter_by(is_read=False)
    return q.order_by(models.Notification.created_at.desc()).limit(limit).all()


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db)):
    count = db.query(models.Notification).filter_by(is_read=False).count()
    return {"count": count}


@router.post("", response_model=schemas.Notification, status_code=201)
def create_notification(payload: schemas.NotificationCreate, db: Session = Depends(get_db)):
    notif = models.Notification(**payload.model_dump())
    db.add(notif)
    db.commit()
    db.refresh(notif)
    return notif


@router.patch("/{notif_id}/read", response_model=schemas.Notification)
def mark_read(notif_id: int, db: Session = Depends(get_db)):
    notif = db.query(models.Notification).filter_by(id=notif_id).first()
    if notif:
        notif.is_read = True
        db.commit()
        db.refresh(notif)
    return notif


@router.post("/mark-all-read", status_code=204)
def mark_all_read(db: Session = Depends(get_db)):
    db.query(models.Notification).filter_by(is_read=False).update({"is_read": True})
    db.commit()


@router.delete("/{notif_id}", status_code=204)
def delete_notification(notif_id: int, db: Session = Depends(get_db)):
    notif = db.query(models.Notification).filter_by(id=notif_id).first()
    if notif:
        db.delete(notif)
        db.commit()


@router.delete("", status_code=204)
def clear_all_notifications(db: Session = Depends(get_db)):
    db.query(models.Notification).delete()
    db.commit()
