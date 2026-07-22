"""
SQLAlchemy database models for the Microtask Manager.

Enum columns use native_enum=False so SQLAlchemy stores values as VARCHAR
instead of creating native PostgreSQL ENUM types.  This avoids "type already
exists" errors when create_all() is called against an existing schema, and
makes the models portable between PostgreSQL and SQLite.
"""

from sqlalchemy import (
    Column, Integer, String, Boolean, Float, DateTime, Text,
    ForeignKey, Enum as SAEnum
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from backend.database import Base


class TaskStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class TaskCategory(str, enum.Enum):
    INSTAGRAM = "instagram"
    FACEBOOK = "facebook"
    TIKTOK = "tiktok"
    YOUTUBE = "youtube"
    TELEGRAM = "telegram"
    X = "x"
    LINKEDIN = "linkedin"
    DISCORD = "discord"
    WEBSITE_VISIT = "website_visit"
    SURVEY = "survey"
    APP_INSTALL = "app_install"
    OTHER = "other"


class WebsiteFolder(Base):
    __tablename__ = "website_folders"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    color = Column(String(7), default="#6366f1")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    websites = relationship("Website", back_populates="folder")


class Website(Base):
    __tablename__ = "websites"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    login_url = Column(String(500), nullable=False)
    dashboard_url = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)
    plugin_id = Column(String(100), default="generic")
    is_enabled = Column(Boolean, default=True)
    folder_id = Column(Integer, ForeignKey("website_folders.id"), nullable=True)
    favicon_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    folder = relationship("WebsiteFolder", back_populates="websites")
    credentials = relationship("Credential", back_populates="website", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="website")
    snapshots = relationship("WebsiteSnapshot", back_populates="website",
                             cascade="all, delete-orphan",
                             order_by="WebsiteSnapshot.synced_at.desc()")


class Credential(Base):
    __tablename__ = "credentials"

    id = Column(Integer, primary_key=True, index=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False)
    username = Column(String(300), nullable=False)
    encrypted_password = Column(Text, nullable=False)  # Fernet-encrypted
    notes = Column(Text, nullable=True)
    last_used = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    website = relationship("Website", back_populates="credentials")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    url = Column(String(1000), nullable=True)
    # native_enum=False → stored as VARCHAR; portable and avoids PG ENUM conflicts
    category = Column(
        SAEnum(TaskCategory, native_enum=False),
        default=TaskCategory.OTHER,
    )
    status = Column(
        SAEnum(TaskStatus, native_enum=False),
        default=TaskStatus.PENDING,
    )
    reward = Column(Float, default=0.0)
    currency = Column(String(10), default="USD")
    website_id = Column(Integer, ForeignKey("websites.id"), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    time_spent_seconds = Column(Integer, default=0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    website = relationship("Website", back_populates="tasks")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(300), nullable=False)
    message = Column(Text, nullable=False)
    type = Column(String(50), default="info")  # info, warning, success, error
    is_read = Column(Boolean, default=False)
    website_id = Column(Integer, ForeignKey("websites.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AppSettings(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String(200), nullable=False)
    details = Column(Text, nullable=True)
    entity_type = Column(String(50), nullable=True)  # task, website, credential
    entity_id = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WebsiteSnapshot(Base):
    """Stores the result of each sync attempt for a website."""
    __tablename__ = "website_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    website_id = Column(Integer, ForeignKey("websites.id", ondelete="CASCADE"), nullable=False)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())
    # ok | auth_required | error
    status = Column(String(50), default="ok", nullable=False)
    error_message = Column(Text, nullable=True)
    # Extracted data (best-effort from the page)
    available_balance = Column(Float, nullable=True)
    available_tasks = Column(Integer, nullable=True)
    page_title = Column(String(500), nullable=True)
    raw_extract = Column(Text, nullable=True)  # JSON blob of extracted numbers

    website = relationship("Website", back_populates="snapshots")
