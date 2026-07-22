"""
Generic website adapter — works for any URL.
Used when no specific plugin is configured for a website.
"""

from backend.plugins.base import BaseAdapter


class GenericAdapter(BaseAdapter):
    """
    Generic adapter that simply navigates to the configured URLs.
    Works for any microtask website without custom logic.
    """

    plugin_id = "generic"
    plugin_name = "Generic Adapter"
    plugin_description = "Works with any website — navigates to the configured login/dashboard URLs."

    async def navigate_to_login(self, page) -> bool:
        try:
            await page.goto(self.website_url, wait_until="domcontentloaded", timeout=30000)
            return True
        except Exception:
            return False

    async def navigate_to_dashboard(self, page) -> bool:
        try:
            await page.goto(self.website_url, wait_until="domcontentloaded", timeout=30000)
            return True
        except Exception:
            return False
