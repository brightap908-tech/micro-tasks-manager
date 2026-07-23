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
        # Auto-reinstall was already attempted before launch; if it still
        # fails, a fresh deploy is the only reliable fix.
        return (
            "Browser unavailable — please try again in a moment. "
            "If the problem persists, trigger a fresh deploy."
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

    1. PLAYWRIGHT_BROWSERS_PATH env var  (Render Docker — /ms-playwright)
    2. Workspace-local .cache/ms-playwright  (Replit dev environment)
    3. ~/.cache/ms-playwright               (default Playwright install)
    4. /nix/store playwright-driver         (NixOS / replit.nix)

    Returns None if nothing is found; BrowserSession.start() will then
    attempt an auto-reinstall via _ensure_chromium().
    """
    import glob
    import os

    candidates: list[str] = []

    # 1. Explicit env override — on Render this is /ms-playwright
    pw_home = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if pw_home:
        candidates.append(pw_home)

    # 2. Workspace-local cache (Replit)
    workspace = os.environ.get("REPL_HOME", os.path.expanduser("~"))
    candidates.append(os.path.join(workspace, ".cache", "ms-playwright"))

    # 3. Default user cache
    candidates.append(os.path.join(os.path.expanduser("~"), ".cache", "ms-playwright"))

    # Binary name patterns, most-likely-first:
    #   - Playwright ≥1.45 installs chromium-headless-shell (binary: headless_shell)
    #   - Older versions install full chromium (binary: chrome)
    _BINARY_PATTERNS = [
        "chromium_headless_shell-*/chrome-linux/headless_shell",
        "chromium-headless-shell-*/chrome-linux/headless_shell",
        "chromium_headless_shell-*/chrome-linux/chrome",
        "chromium-*/chrome-linux/chrome",
        "chromium-*/chrome-linux/headless_shell",
    ]

    for base in candidates:
        for pattern in _BINARY_PATTERNS:
            matches = glob.glob(os.path.join(base, pattern))
            if matches:
                matches.sort()
                path = matches[-1]
                if os.path.isfile(path) and os.access(path, os.X_OK):
                    logger.debug("_find_nix_chromium: found %s", path)
                    return path

    # 4. Nix store — playwright-driver ships a chromium wrapper
    nix_patterns = [
        "/nix/store/*/playwright-driver/chromium-headless-shell/*/chrome-linux/headless_shell",
        "/nix/store/*/playwright-driver/chromium/*/chrome-linux/chrome",
    ]
    for pattern in nix_patterns:
        matches = glob.glob(pattern)
        if matches:
            matches.sort()
            path = matches[-1]
            if os.path.isfile(path) and os.access(path, os.X_OK):
                logger.debug("_find_nix_chromium: found (nix) %s", path)
                return path

    logger.debug("_find_nix_chromium: no executable found in any candidate location")
    return None


async def _ensure_chromium() -> str | None:
    """
    Return the Chromium executable path, auto-reinstalling if necessary.

    On Render (Docker) PLAYWRIGHT_BROWSERS_PATH=/ms-playwright is baked into
    the image at build time so the binary is almost always present.  This
    function acts as a safety net for edge cases (first deploy, layer cache
    miss, corrupted image layer, etc.).

    We intentionally skip --with-deps here: OS libraries were already
    installed by the Dockerfile's 'playwright install --with-deps chromium'
    step, and apt-get may not be available at runtime.
    """
    path = _find_nix_chromium()
    if path:
        return path

    logger.warning(
        "Chromium binary not found at expected location — "
        "attempting automatic reinstall (OS deps already present from build)."
    )
    try:
        proc = await asyncio.create_subprocess_exec(
            "python", "-m", "playwright", "install", "chromium",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            logger.error("Playwright auto-reinstall timed out after 120 s")
            return None

        if proc.returncode == 0:
            logger.info(
                "Playwright Chromium reinstalled successfully: %s",
                stdout.decode().strip()[-200:],
            )
            return _find_nix_chromium()
        else:
            logger.error(
                "Playwright reinstall failed (exit %d):\n%s",
                proc.returncode,
                stderr.decode().strip()[-400:],
            )
    except Exception as exc:
        logger.error("Playwright reinstall error: %s", exc)

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

            # Locate Chromium; auto-reinstall if the binary is missing.
            chromium_path = await _ensure_chromium()

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
            if chromium_path:
                launch_kwargs["executable_path"] = chromium_path
                logger.info("Session %s: launching Chromium at %s", self.session_id, chromium_path)
            else:
                # PLAYWRIGHT_BROWSERS_PATH env var lets Playwright find it
                # even without an explicit path (last-resort fallback).
                logger.info("Session %s: launching Chromium via Playwright default resolution", self.session_id)

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
