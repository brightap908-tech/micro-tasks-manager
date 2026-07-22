"""
Task management endpoints.
All status changes require explicit user action — no automation.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from datetime import datetime, timezone
from backend.database import get_db
from backend import models, schemas
from backend.services.activity import log_activity

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=List[schemas.Task])
def list_tasks(
    status: Optional[str] = None,
    category: Optional[str] = None,
    website_id: Optional[int] = None,
    search: Optional[str] = None,
    sort_by: str = Query("created_at", enum=["created_at", "reward", "title", "status"]),
    sort_order: str = Query("desc", enum=["asc", "desc"]),
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(models.Task)

    if status:
        q = q.filter(models.Task.status == status)
    if category:
        q = q.filter(models.Task.category == category)
    if website_id:
        q = q.filter_by(website_id=website_id)
    if search:
        term = f"%{search}%"
        q = q.filter(or_(
            models.Task.title.ilike(term),
            models.Task.description.ilike(term),
            models.Task.notes.ilike(term),
        ))

    col = getattr(models.Task, sort_by, models.Task.created_at)
    q = q.order_by(col.desc() if sort_order == "desc" else col.asc())

    return q.offset(offset).limit(limit).all()


@router.post("", response_model=schemas.Task, status_code=201)
def create_task(payload: schemas.TaskCreate, db: Session = Depends(get_db)):
    task = models.Task(**payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    log_activity(db, "Created task", task.title, "task", task.id)
    return task


@router.get("/{task_id}", response_model=schemas.Task)
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(models.Task).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.put("/{task_id}", response_model=schemas.Task)
def update_task(task_id: int, payload: schemas.TaskUpdate, db: Session = Depends(get_db)):
    task = db.query(models.Task).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(task, k, v)
    db.commit()
    db.refresh(task)
    log_activity(db, "Updated task", task.title, "task", task.id)
    return task


@router.patch("/{task_id}/status", response_model=schemas.Task)
def update_task_status(task_id: int, payload: schemas.TaskStatusUpdate, db: Session = Depends(get_db)):
    """
    Update task status. This is a manual user action — the API does NOT
    automatically mark tasks as completed or submit any work.
    """
    task = db.query(models.Task).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    now = datetime.now(timezone.utc)
    old_status = task.status
    task.status = payload.status

    if payload.status == models.TaskStatus.IN_PROGRESS and task.started_at is None:
        task.started_at = now
    elif payload.status == models.TaskStatus.COMPLETED:
        task.completed_at = now
        if payload.time_spent_seconds is not None:
            task.time_spent_seconds = payload.time_spent_seconds

    db.commit()
    db.refresh(task)
    log_activity(
        db,
        f"Task status changed: {old_status} → {payload.status}",
        task.title,
        "task",
        task.id,
    )
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(models.Task).filter_by(id=task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()


@router.post("/bulk-delete", status_code=204)
def bulk_delete_tasks(task_ids: List[int], db: Session = Depends(get_db)):
    db.query(models.Task).filter(models.Task.id.in_(task_ids)).delete(synchronize_session=False)
    db.commit()


@router.get("/next/pending", response_model=Optional[schemas.Task])
def get_next_pending_task(website_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Get the next pending task to work on."""
    q = db.query(models.Task).filter(models.Task.status == models.TaskStatus.PENDING)
    if website_id:
        q = q.filter_by(website_id=website_id)
    return q.order_by(models.Task.reward.desc(), models.Task.created_at.asc()).first()
