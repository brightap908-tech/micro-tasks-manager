"""
Application settings and database backup/restore endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from typing import List
import json
import io
import os
import shutil
from datetime import datetime, timezone

from backend.database import get_db
from backend import models, schemas
from backend.plugins.registry import list_plugins

router = APIRouter(prefix="/api/settings", tags=["settings"])

BACKUP_DIR = "backups"
DB_PATH = "microtask_manager.db"


@router.get("", response_model=List[schemas.Setting])
def get_all_settings(db: Session = Depends(get_db)):
    return db.query(models.AppSettings).all()


@router.get("/{key}", response_model=schemas.Setting)
def get_setting(key: str, db: Session = Depends(get_db)):
    s = db.query(models.AppSettings).filter_by(key=key).first()
    if not s:
        return schemas.Setting(key=key, value=None)
    return s


@router.put("/{key}", response_model=schemas.Setting)
def upsert_setting(key: str, payload: schemas.SettingUpdate, db: Session = Depends(get_db)):
    s = db.query(models.AppSettings).filter_by(key=key).first()
    if s:
        s.value = payload.value
    else:
        s = models.AppSettings(key=key, value=payload.value)
        db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.post("/backup")
def create_backup():
    """Create a timestamped backup of the SQLite database."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if not os.path.exists(DB_PATH):
        raise HTTPException(status_code=404, detail="Database file not found")
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(BACKUP_DIR, f"backup_{ts}.db")
    shutil.copy2(DB_PATH, backup_path)
    return {"message": "Backup created", "filename": f"backup_{ts}.db", "path": backup_path}


@router.get("/backup/list")
def list_backups():
    """List all available database backups."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backups = []
    for f in sorted(os.listdir(BACKUP_DIR), reverse=True):
        if f.endswith(".db"):
            path = os.path.join(BACKUP_DIR, f)
            stat = os.stat(path)
            backups.append({
                "filename": f,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    return backups


@router.get("/backup/download/{filename}")
def download_backup(filename: str):
    """Download a specific backup file."""
    path = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(path) or not filename.endswith(".db"):
        raise HTTPException(status_code=404, detail="Backup not found")
    return FileResponse(path, filename=filename, media_type="application/octet-stream")


@router.post("/restore")
async def restore_backup(file: UploadFile = File(...)):
    """Restore the database from an uploaded backup file."""
    if not file.filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="Only .db files are accepted")
    content = await file.read()
    # Save current db as safety backup
    if os.path.exists(DB_PATH):
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        os.makedirs(BACKUP_DIR, exist_ok=True)
        shutil.copy2(DB_PATH, os.path.join(BACKUP_DIR, f"pre_restore_{ts}.db"))
    with open(DB_PATH, "wb") as f:
        f.write(content)
    return {"message": "Database restored. Please restart the application."}


@router.get("/plugins/list")
def get_plugins():
    """List all registered website adapter plugins."""
    return list_plugins()


@router.get("/export/json")
def export_settings_json(db: Session = Depends(get_db)):
    """Export all application settings as JSON."""
    settings = db.query(models.AppSettings).all()
    data = {s.key: s.value for s in settings}
    output = json.dumps(data, indent=2)
    return StreamingResponse(
        io.BytesIO(output.encode()),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=settings_export.json"},
    )
