"""
Base plugin/adapter interface for microtask websites.
Every website adapter must extend BaseAdapter.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class LoginResult:
    success: bool
    message: str
    session_cookie: Optional[str] = None


@dataclass
class TaskInfo:
    title: str
    url: str
    reward: float
    currency: str = "USD"
    category: str = "other"
    description: Optional[str] = None


class BaseAdapter(ABC):
    """
    Abstract base class for website-specific adapters.

    Each adapter handles navigation logic for a specific microtask website.
    Adapters MUST NOT automate task completion, form submission, or social
    media interactions. They are navigation and monitoring tools only.
    """

    plugin_id: str = "base"
    plugin_name: str = "Base Adapter"
    plugin_description: str = "Base adapter — do not use directly"

    def __init__(self, website_url: str):
        self.website_url = website_url

    @abstractmethod
    async def navigate_to_login(self, page) -> bool:
        """Navigate the browser to the login page. Returns True on success."""
        pass

    @abstractmethod
    async def navigate_to_dashboard(self, page) -> bool:
        """Navigate the browser to the dashboard. Returns True on success."""
        pass

    async def get_page_title(self, page) -> str:
        """Get the current page title."""
        return await page.title()

    def get_metadata(self) -> dict:
        return {
            "plugin_id": self.plugin_id,
            "plugin_name": self.plugin_name,
            "description": self.plugin_description,
        }
