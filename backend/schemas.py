"""
Pydantic schemas for request/response validation.
"""

from pydantic import BaseModel, Field, HttpUrl
from typing import Optional, List
from datetime import datetime
from backend.models import TaskStatus, TaskCategory


# ─── Website Folder ───────────────────────────────────────────────────────────

class WebsiteFolderBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str = Field(default="#6366f1")

class WebsiteFolderCreate(WebsiteFolderBase):
    pass

class WebsiteFolderUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None

class WebsiteFolder(WebsiteFolderBase):
    id: int
    created_at: datetime
    class Config:
        from_attributes = True


# ─── Website ──────────────────────────────────────────────────────────────────

class WebsiteBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    login_url: str
    dashboard_url: Optional[str] = None
    description: Optional[str] = None
    plugin_id: str = "generic"
    is_enabled: bool = True
    folder_id: Optional[int] = None
    favicon_url: Optional[str] = None

class WebsiteCreate(WebsiteBase):
    pass

class WebsiteUpdate(BaseModel):
    name: Optional[str] = None
    login_url: Optional[str] = None
    dashboard_url: Optional[str] = None
    description: Optional[str] = None
    plugin_id: Optional[str] = None
    is_enabled: Optional[bool] = None
    folder_id: Optional[int] = None
    favicon_url: Optional[str] = None

class Website(WebsiteBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    folder: Optional[WebsiteFolder] = None
    class Config:
        from_attributes = True

class WebsiteWithStats(Website):
    task_count: int = 0
    completed_tasks: int = 0
    total_earnings: float = 0.0


# ─── Credential ───────────────────────────────────────────────────────────────

class CredentialBase(BaseModel):
    username: str = Field(..., min_length=1)
    notes: Optional[str] = None

class CredentialCreate(CredentialBase):
    password: str = Field(..., min_length=1)
    website_id: int

class CredentialUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    notes: Optional[str] = None

class Credential(CredentialBase):
    id: int
    website_id: int
    last_used: Optional[datetime] = None
    created_at: datetime
    class Config:
        from_attributes = True


# ─── Task ─────────────────────────────────────────────────────────────────────

class TaskBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    url: Optional[str] = None
    category: TaskCategory = TaskCategory.OTHER
    status: TaskStatus = TaskStatus.PENDING
    reward: float = Field(default=0.0, ge=0)
    currency: str = "USD"
    website_id: Optional[int] = None
    notes: Optional[str] = None

class TaskCreate(TaskBase):
    pass

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    category: Optional[TaskCategory] = None
    status: Optional[TaskStatus] = None
    reward: Optional[float] = None
    currency: Optional[str] = None
    website_id: Optional[int] = None
    notes: Optional[str] = None
    time_spent_seconds: Optional[int] = None

class TaskStatusUpdate(BaseModel):
    status: TaskStatus
    time_spent_seconds: Optional[int] = None

class Task(TaskBase):
    id: int
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    time_spent_seconds: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None
    website: Optional[Website] = None
    class Config:
        from_attributes = True


# ─── Notification ─────────────────────────────────────────────────────────────

class NotificationCreate(BaseModel):
    title: str
    message: str
    type: str = "info"
    website_id: Optional[int] = None

class Notification(BaseModel):
    id: int
    title: str
    message: str
    type: str
    is_read: bool
    website_id: Optional[int] = None
    created_at: datetime
    class Config:
        from_attributes = True


# ─── Settings ─────────────────────────────────────────────────────────────────

class SettingUpdate(BaseModel):
    value: str

class Setting(BaseModel):
    key: str
    value: Optional[str] = None
    class Config:
        from_attributes = True


# ─── Dashboard / Reports ──────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_earnings: float
    tasks_completed: int
    tasks_pending: int
    tasks_in_progress: int
    tasks_skipped: int
    connected_websites: int
    active_websites: int
    time_spent_today_seconds: int
    time_spent_week_seconds: int
    # Sync-enriched fields
    available_balance: float = 0.0
    last_sync_at: Optional[datetime] = None
    sync_status: str = "never"  # never | ok | partial | error

class EarningsByWebsite(BaseModel):
    website_id: int
    website_name: str
    total_earnings: float
    task_count: int
    completed_count: int

class EarningsByCategory(BaseModel):
    category: str
    total_earnings: float
    task_count: int
    completed_count: int

class DailyStats(BaseModel):
    date: str
    earnings: float
    tasks_completed: int
    time_spent_seconds: int

class ActivityLog(BaseModel):
    id: int
    action: str
    details: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    created_at: datetime
    class Config:
        from_attributes = True


# ─── Sync ─────────────────────────────────────────────────────────────────────

class WebsiteSyncResult(BaseModel):
    website_id: int
    website_name: str
    status: str            # ok | auth_required | error
    available_balance: Optional[float] = None
    available_tasks: Optional[int] = None
    page_title: Optional[str] = None
    error_message: Optional[str] = None
    synced_at: datetime
    class Config:
        from_attributes = True

class SyncAllResult(BaseModel):
    total: int
    succeeded: int
    results: List[WebsiteSyncResult]


# ─── Browser / Navigation ─────────────────────────────────────────────────────

class OpenUrlRequest(BaseModel):
    url: str
    credential_id: Optional[int] = None
