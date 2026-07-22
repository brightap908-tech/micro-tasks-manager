"""
Secure credential management endpoints.
Passwords are stored encrypted using Fernet symmetric encryption.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from typing import List
from datetime import datetime, timezone
from backend.database import get_db
from backend import models, schemas
from backend.security import encrypt_password, decrypt_password
from backend.services.activity import log_activity

router = APIRouter(prefix="/api/credentials", tags=["credentials"])


@router.get("", response_model=List[schemas.Credential])
def list_credentials(website_id: int = None, db: Session = Depends(get_db)):
    q = db.query(models.Credential)
    if website_id:
        q = q.filter_by(website_id=website_id)
    return q.order_by(models.Credential.created_at.desc()).all()


@router.post("", response_model=schemas.Credential, status_code=201)
def create_credential(payload: schemas.CredentialCreate, db: Session = Depends(get_db)):
    encrypted = encrypt_password(payload.password)
    cred = models.Credential(
        website_id=payload.website_id,
        username=payload.username,
        encrypted_password=encrypted,
        notes=payload.notes,
    )
    db.add(cred)
    db.commit()
    db.refresh(cred)
    log_activity(db, "Saved credential", f"for {payload.username}", "credential", cred.id)
    return cred


@router.get("/{cred_id}", response_model=schemas.Credential)
def get_credential(cred_id: int, db: Session = Depends(get_db)):
    cred = db.query(models.Credential).filter_by(id=cred_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    return cred


@router.get("/{cred_id}/reveal")
def reveal_credential(cred_id: int, db: Session = Depends(get_db)):
    """Decrypt and return the password for display. Updates last_used timestamp."""
    cred = db.query(models.Credential).filter_by(id=cred_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    try:
        password = decrypt_password(cred.encrypted_password)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt credential")
    cred.last_used = datetime.now(timezone.utc)
    db.commit()
    return {"username": cred.username, "password": password}


@router.put("/{cred_id}", response_model=schemas.Credential)
def update_credential(cred_id: int, payload: schemas.CredentialUpdate, db: Session = Depends(get_db)):
    cred = db.query(models.Credential).filter_by(id=cred_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    if payload.username is not None:
        cred.username = payload.username
    if payload.password is not None:
        cred.encrypted_password = encrypt_password(payload.password)
    if payload.notes is not None:
        cred.notes = payload.notes
    db.commit()
    db.refresh(cred)
    return cred


@router.delete("/{cred_id}", status_code=204)
def delete_credential(cred_id: int, db: Session = Depends(get_db)):
    cred = db.query(models.Credential).filter_by(id=cred_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    db.delete(cred)
    db.commit()
