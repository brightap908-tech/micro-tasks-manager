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


def _friendly_launch_error(raw: str) -> str:
    """Translate raw Playwright / OS errors into readable messages."""
    r = raw.lower()
    if "executable doesn't exist" in r or "executable does not exist" in r or "browsertype.launch" in r:
        return (
            "Chromium is not installed on this server. "
            "Run: python -m playwright install chromium"
        )
    if "failed to launch" in r or "spawn" in r:
        return (
            "Failed to launch the browser — a required system library may be missing. "
            "Trigger a fresh deploy to reinstall Playwright system dependencies."
        )
    if "timeout" in r:
        return "Browser took too long to start — please try again."
    if "net::err" in r or "name not resolved" in r:
        return f"Could not reach the login page ({raw[:120]})"
    return raw[:300]


# ── Chromium executable discovery (no launch, no subprocess) ──────────────────

def _find_nix_chromium() -> str | None:
    """
    Return the path to the Playwright-managed Chromium (or headless-shell)
    executable without launching it.  Checks, in order:

    1. PLAYWRIGHT_BROWSERS_PATH env var (custom install location)
    2. Workspace-local .cache/ms-playwright  (Replit — installed by this session)
    3. ~/.cache/ms-playwright                (default Playwright install)
    4. /nix/store paths for playwright-driver (NixOS / replit.nix)

    Returns None if nothing is found; the caller can still attempt a launch
    and let Playwright resolve the path itself.
    """
    import glob
    import os

    candidates: list[str] = []

    # 1. Explicit env override
    pw_home = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if pw_home:
        candidates.append(pw_home)

    # 2. Workspace-local cache (Replit)
    workspace = os.environ.get("REPL_HOME", os.path.expanduser("~"))
    candidates.append(os.path.join(workspace, ".cache", "ms-playwright"))

    # 3. Default user cache
    candidates.append(os.path.join(os.path.expanduser("~"), ".cache", "ms-playwright"))

    for base in candidates:
        # headless-shell (newer Playwright) and full chromium layouts
        for pattern in [
            "chromium_headless_shell-*/chrome-linux/chrome",
            "chromium-*/chrome-linux/chrome",
            "chromium_headless_shell-*/chrome-linux/headless_shell",
        ]:
            matches = glob.glob(os.path.join(base, pattern))
            if matches:
                # pick the highest-numbered build
                matches.sort()
                path = matches[-1]
                if os.path.isfile(path) and os.access(path, os.X_OK):
                    return path

    # 4. Nix store — playwright-driver ships a chromium wrapper
    nix_patterns = [
        "/nix/store/*/playwright-driver/chromium/*/chrome-linux/chrome",
        "/nix/store/*/playwright-driver/chromium-headless-shell/*/chrome-linux/headless_shell",
    ]
    for pattern in nix_patterns:
        matches = glob.glob(pattern)
        if matches:
            matches.sort()
            path = matches[-1]
            if os.path.isfile(path) and os.access(path, os.X_OK):
                return path

    return None


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

            launch_kwargs: dict = {
                "headless": True,
                "args": [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-software-rasterizer",
                    "--single-process",
                ],
            }
            chromium_path = _find_nix_chromium()
            if chromium_path:
                launch_kwargs["executable_path"] = chromium_path
                logger.info("Session %s: using Chromium at %s", self.session_id, chromium_path)
            else:
                logger.info("Session %s: using Playwright default Chromium", self.session_id)

            self._browser = await self._pw.chromium.launch(**launch_kwargs)
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
            raw = str(exc)
            self.error_message = _friendly_launch_error(raw)
            logger.exception("Session %s failed to start: %s", self.session_id, raw)

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
            if any(kw in url for kw in _LOGIN_KEYWORDS):
                return
            html = await self._page.content()
            hl = html.lower()
            has_password = 'type="password"' in hl or "type='password'" in hl
            if has_password:
                return
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
