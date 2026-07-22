"""
Activity logging service.
"""

from sqlalchemy.orm import Session
from typing import Optional
from backend import models


def log_activity(
    db: Session,
    action: str,
    details: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
) -> None:
    """Create an activity log entry."""
    entry = models.ActivityLog(
        action=action,
        details=details,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    db.add(entry)
    db.commit()
