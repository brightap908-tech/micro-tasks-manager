"""
Application settings and data backup/restore endpoints.

Backup format is JSON (not a SQLite .db file) so it works with any database
backend including PostgreSQL.  Backups are written to the local BACKUP_DIR;
on ephemeral filesystems (Render free tier) they survive the current process
but are wiped on redeploy — always download a backup immediately after creating
it, or use the restore endpoint to re-import a previously downloaded file.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import inspect, text
from typing import List
import json
import io
import os
from datetime import datetime, timezone

from backend.database import get_db, engine
from backend import models, schemas
from backend.plugins.registry import list_plugins

router = APIRouter(prefix="/api/settings", tags=["settings"])

BACKUP_DIR = os.getenv("BACKUP_DIR", "backups")


# ── App settings (key/value store) ────────────────────────────────────────────

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


# ── Backup helpers ─────────────────────────────────────────────────────────────

def _serialize(value):
    """Convert a value to a JSON-serialisable form."""
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _export_all_data(db: Session) -> dict:
    """
    Dump every application table to a plain-Python dict that can be
    round-tripped through json.dumps / json.loads.
    """
    folders = db.query(models.WebsiteFolder).all()
    websites = db.query(models.Website).all()
    credentials = db.query(models.Credential).all()
    tasks = db.query(models.Task).all()
    notifications = db.query(models.Notification).all()
    settings = db.query(models.AppSettings).all()
    logs = db.query(models.ActivityLog).all()

    def row(obj, cols):
        return {c: _serialize(getattr(obj, c)) for c in cols}

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "version": 1,
        "tables": {
            "website_folders": [
                row(f, ["id", "name", "color", "created_at"]) for f in folders
            ],
            "websites": [
                row(w, ["id", "name", "login_url", "dashboard_url", "description",
                         "plugin_id", "is_enabled", "folder_id", "favicon_url",
                         "created_at", "updated_at"])
                for w in websites
            ],
            "credentials": [
                row(c, ["id", "website_id", "username", "encrypted_password",
                         "notes", "last_used", "created_at"])
                for c in credentials
            ],
            "tasks": [
                row(t, ["id", "title", "description", "url", "category", "status",
                         "reward", "currency", "website_id", "started_at",
                         "completed_at", "time_spent_seconds", "notes",
                         "created_at", "updated_at"])
                for t in tasks
            ],
            "notifications": [
                row(n, ["id", "title", "message", "type", "is_read",
                         "website_id", "created_at"])
                for n in notifications
            ],
            "app_settings": [
                row(s, ["id", "key", "value", "updated_at"]) for s in settings
            ],
            "activity_logs": [
                row(l, ["id", "action", "details", "entity_type",
                         "entity_id", "created_at"])
                for l in logs
            ],
        },
    }


def _restore_all_data(db: Session, data: dict) -> dict:
    """
    Import a JSON backup produced by _export_all_data().
    Existing rows are replaced; the restore is performed inside a single
    transaction so a failure leaves the database untouched.
    """
    tables = data.get("tables", {})

    # Delete in reverse FK order
    db.query(models.ActivityLog).delete()
    db.query(models.Notification).delete()
    db.query(models.Task).delete()
    db.query(models.Credential).delete()
    db.query(models.Website).delete()
    db.query(models.WebsiteFolder).delete()
    db.query(models.AppSettings).delete()
    db.flush()

    def _dt(v):
        if v is None:
            return None
        try:
            return datetime.fromisoformat(v)
        except (TypeError, ValueError):
            return None

    counts = {}

    # Insert in FK order
    for raw in tables.get("website_folders", []):
        db.add(models.WebsiteFolder(
            id=raw["id"], name=raw["name"],
            color=raw.get("color", "#6366f1"),
            created_at=_dt(raw.get("created_at")),
        ))
    counts["website_folders"] = len(tables.get("website_folders", []))

    for raw in tables.get("websites", []):
        db.add(models.Website(
            id=raw["id"], name=raw["name"],
            login_url=raw["login_url"],
            dashboard_url=raw.get("dashboard_url"),
            description=raw.get("description"),
            plugin_id=raw.get("plugin_id", "generic"),
            is_enabled=raw.get("is_enabled", True),
            folder_id=raw.get("folder_id"),
            favicon_url=raw.get("favicon_url"),
            created_at=_dt(raw.get("created_at")),
            updated_at=_dt(raw.get("updated_at")),
        ))
    counts["websites"] = len(tables.get("websites", []))

    for raw in tables.get("credentials", []):
        db.add(models.Credential(
            id=raw["id"], website_id=raw["website_id"],
            username=raw["username"],
            encrypted_password=raw["encrypted_password"],
            notes=raw.get("notes"),
            last_used=_dt(raw.get("last_used")),
            created_at=_dt(raw.get("created_at")),
        ))
    counts["credentials"] = len(tables.get("credentials", []))

    for raw in tables.get("tasks", []):
        db.add(models.Task(
            id=raw["id"], title=raw["title"],
            description=raw.get("description"),
            url=raw.get("url"),
            category=raw.get("category"),
            status=raw.get("status", "pending"),
            reward=raw.get("reward", 0.0),
            currency=raw.get("currency", "USD"),
            website_id=raw.get("website_id"),
            started_at=_dt(raw.get("started_at")),
            completed_at=_dt(raw.get("completed_at")),
            time_spent_seconds=raw.get("time_spent_seconds", 0),
            notes=raw.get("notes"),
            created_at=_dt(raw.get("created_at")),
            updated_at=_dt(raw.get("updated_at")),
        ))
    counts["tasks"] = len(tables.get("tasks", []))

    for raw in tables.get("notifications", []):
        db.add(models.Notification(
            id=raw["id"], title=raw["title"],
            message=raw["message"],
            type=raw.get("type", "info"),
            is_read=raw.get("is_read", False),
            website_id=raw.get("website_id"),
            created_at=_dt(raw.get("created_at")),
        ))
    counts["notifications"] = len(tables.get("notifications", []))

    for raw in tables.get("app_settings", []):
        db.add(models.AppSettings(
            id=raw["id"], key=raw["key"],
            value=raw.get("value"),
            updated_at=_dt(raw.get("updated_at")),
        ))
    counts["app_settings"] = len(tables.get("app_settings", []))

    for raw in tables.get("activity_logs", []):
        db.add(models.ActivityLog(
            id=raw["id"], action=raw["action"],
            details=raw.get("details"),
            entity_type=raw.get("entity_type"),
            entity_id=raw.get("entity_id"),
            created_at=_dt(raw.get("created_at")),
        ))
    counts["activity_logs"] = len(tables.get("activity_logs", []))

    # After restoring explicit IDs, reset PostgreSQL sequences so the next
    # auto-generated ID doesn't collide with the restored ones.
    dialect = db.bind.dialect.name if db.bind else engine.dialect.name
    if dialect == "postgresql":
        for table, model in [
            ("website_folders", models.WebsiteFolder),
            ("websites", models.Website),
            ("credentials", models.Credential),
            ("tasks", models.Task),
            ("notifications", models.Notification),
            ("app_settings", models.AppSettings),
            ("activity_logs", models.ActivityLog),
        ]:
            db.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)"
            ))

    db.commit()
    return counts


# ── Backup endpoints ───────────────────────────────────────────────────────────

@router.post("/backup")
def create_backup(db: Session = Depends(get_db)):
    """
    Export all application data to a JSON backup file.
    On Render the filesystem is ephemeral — download the file immediately
    using the /backup/download/{filename} endpoint.
    """
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"backup_{ts}.json"
    path = os.path.join(BACKUP_DIR, filename)

    data = _export_all_data(db)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)

    return {
        "message": "Backup created. Download it immediately if running on an ephemeral filesystem.",
        "filename": filename,
        "path": path,
        "exported_at": data["exported_at"],
    }


@router.get("/backup/list")
def list_backups():
    """List JSON backup files available on disk."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backups = []
    for fname in sorted(os.listdir(BACKUP_DIR), reverse=True):
        if fname.endswith(".json"):
            path = os.path.join(BACKUP_DIR, fname)
            stat = os.stat(path)
            backups.append({
                "filename": fname,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    return backups


@router.get("/backup/download/{filename}")
def download_backup(filename: str):
    """Download a specific JSON backup file."""
    # Prevent path traversal
    if ".." in filename or "/" in filename or not filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Backup not found")
    with open(path, "rb") as f:
        content = f.read()
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/restore")
async def restore_backup(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Restore application data from a JSON backup file.
    ALL existing data will be replaced.  This operation cannot be undone.
    """
    if not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json backup files are accepted")

    raw = await file.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")

    if data.get("version") != 1:
        raise HTTPException(status_code=400, detail="Unsupported backup version")

    try:
        counts = _restore_all_data(db, data)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Restore failed: {exc}")

    return {
        "message": "Database restored successfully",
        "rows_restored": counts,
        "exported_at": data.get("exported_at"),
    }


# ── Plugins ────────────────────────────────────────────────────────────────────

@router.get("/plugins/list")
def get_plugins():
    """List all registered website adapter plugins."""
    return list_plugins()


# ── Export settings as JSON ────────────────────────────────────────────────────

@router.get("/export/json")
def export_settings_json(db: Session = Depends(get_db)):
    """Export all application settings as a JSON file."""
    settings = db.query(models.AppSettings).all()
    data = {s.key: s.value for s in settings}
    output = json.dumps(data, indent=2)
    return StreamingResponse(
        io.BytesIO(output.encode()),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=settings_export.json"},
    )
