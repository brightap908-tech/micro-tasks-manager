"""
Playwright browser session manager.
Each login session runs a headless Chromium instance. The user drives it
via the screenshot+interaction API; when login is detected the cookies are
captured and handed off to auth_store.  Sessions time out after 10 minutes.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict

logger = logging.getLogger(__name__)

_sessions: Dict[str, "BrowserSession"] = {}
_SESSION_TIMEOUT_S = 600  # 10 minutes

_LOGIN_KEYWORDS = frozenset({"login", "signin", "sign-in", "log-in", "authenticate", "auth"})

# Mobile Chrome UA and viewport – makes sites render their mobile layout
_UA = (
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.6367.82 Mobile Safari/537.36"
)
_VIEWPORT = {"width": 390, "height": 844}


class BrowserSession:
    def __init__(self, session_id: str, website_id: int, login_url: str):
        self.session_id = session_id
        self.website_id = website_id
        self.login_url = login_url
        # status: starting | ready | logged_in | error | closed
        self.status = "starting"
        self.error_message: Optional[str] = None
        self._pw = None
        self._browser = None
        self._context = None
        self._page = None
        self._last_used: float = datetime.now(timezone.utc).timestamp()

    async def start(self) -> None:
        try:
            from playwright.async_api import async_playwright
            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-software-rasterizer",
                    "--single-process",
                ],
            )
            self._context = await self._browser.new_context(
                viewport=_VIEWPORT,
                user_agent=_UA,
                locale="en-US",
                timezone_id="America/New_York",
            )
            self._page = await self._context.new_page()
            await self._page.goto(self.login_url, wait_until="domcontentloaded", timeout=30_000)
            self.status = "ready"
            logger.info("Session %s ready at %s", self.session_id, self.login_url)
        except Exception as exc:
            self.status = "error"
            self.error_message = str(exc)
            logger.exception("Session %s failed to start", self.session_id)

    async def screenshot(self) -> Optional[bytes]:
        if not self._page or self.status in ("starting", "closed"):
            return None
        try:
            return await self._page.screenshot(type="jpeg", quality=80, full_page=False)
        except Exception as exc:
            logger.debug("Screenshot error: %s", exc)
            return None

    def _touch(self) -> None:
        self._last_used = datetime.now(timezone.utc).timestamp()

    async def click(self, x: float, y: float) -> None:
        if not self._page:
            return
        self._touch()
        try:
            await self._page.mouse.click(x, y)
            await asyncio.sleep(0.6)
            await self._detect_login()
        except Exception as exc:
            logger.debug("Click error: %s", exc)

    async def type_text(self, text: str) -> None:
        if not self._page:
            return
        self._touch()
        try:
            await self._page.keyboard.type(text, delay=40)
        except Exception as exc:
            logger.debug("Type error: %s", exc)

    async def press_key(self, key: str) -> None:
        if not self._page:
            return
        self._touch()
        try:
            await self._page.keyboard.press(key)
            await asyncio.sleep(1.0)
            await self._detect_login()
        except Exception as exc:
            logger.debug("Key error: %s", exc)

    async def scroll(self, delta_y: float) -> None:
        if not self._page:
            return
        self._touch()
        try:
            await self._page.mouse.wheel(0, delta_y)
        except Exception as exc:
            logger.debug("Scroll error: %s", exc)

    async def navigate(self, url: str) -> None:
        if not self._page:
            return
        self._touch()
        try:
            await self._page.goto(url, wait_until="domcontentloaded", timeout=15_000)
            await self._detect_login()
        except Exception as exc:
            logger.debug("Navigate error: %s", exc)

    async def current_url(self) -> str:
        if not self._page:
            return ""
        try:
            return self._page.url
        except Exception:
            return ""

    async def get_cookies(self) -> list:
        if not self._context:
            return []
        try:
            return await self._context.cookies()
        except Exception:
            return []

    async def _detect_login(self) -> None:
        """Flip status to logged_in when the page is no longer a login form."""
        if self.status == "logged_in" or not self._page:
            return
        try:
            url = self._page.url.lower()
            # Still on a login-looking URL
            if any(kw in url for kw in _LOGIN_KEYWORDS):
                return
            html = await self._page.content()
            hl = html.lower()
            has_password = 'type="password"' in hl or "type='password'" in hl
            if has_password:
                return  # still a login form
            # Heuristic: page has dashboard-like content
            dashboard_signals = sum([
                "dashboard" in hl,
                "balance" in hl,
                "earnings" in hl,
                "wallet" in hl,
                "logout" in hl or "log out" in hl or "sign out" in hl,
                "profile" in hl,
                "account" in hl,
            ])
            if dashboard_signals >= 2:
                self.status = "logged_in"
                logger.info("Session %s: login detected", self.session_id)
        except Exception:
            pass

    async def close(self) -> None:
        self.status = "closed"
        _sessions.pop(self.session_id, None)
        try:
            if self._context:
                await self._context.close()
            if self._browser:
                await self._browser.close()
            if self._pw:
                await self._pw.stop()
        except Exception as exc:
            logger.debug("Session %s close error: %s", self.session_id, exc)


# ── Session lifecycle ─────────────────────────────────────────────────────────

async def create_session(website_id: int, login_url: str) -> BrowserSession:
    # Close any existing session for this website
    for sess in list(_sessions.values()):
        if sess.website_id == website_id:
            await sess.close()

    sid = str(uuid.uuid4())
    sess = BrowserSession(sid, website_id, login_url)
    _sessions[sid] = sess
    return sess


def get_session(session_id: str) -> Optional[BrowserSession]:
    return _sessions.get(session_id)


async def cleanup_stale() -> None:
    now = datetime.now(timezone.utc).timestamp()
    for sess in list(_sessions.values()):
        if now - sess._last_used > _SESSION_TIMEOUT_S:
            logger.info("Expiring stale session %s", sess.session_id)
            await sess.close()
