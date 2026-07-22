"""
Sync proxy — fetches a microtask website URL and returns extracted data.
This is the ONLY backend endpoint. All app data is stored in IndexedDB on
the client. This endpoint exists solely to bypass browser CORS restrictions
when reading external microtask websites.
"""

import httpx
import re
import logging
from datetime import datetime, timezone
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sync", tags=["sync"])

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

_LOGIN_KEYWORDS = {"login", "signin", "sign-in", "log-in", "authenticate", "auth", "password"}


class SyncRequest(BaseModel):
    url: str
    name: str


class SyncResult(BaseModel):
    status: str            # ok | auth_required | error
    available_balance: Optional[float] = None
    available_tasks: Optional[int] = None
    page_title: Optional[str] = None
    error_message: Optional[str] = None
    error_detail: Optional[str] = None   # full technical detail for debugging
    synced_at: str
    http_status: Optional[int] = None


@router.post("/fetch", response_model=SyncResult)
async def fetch_website(req: SyncRequest) -> SyncResult:
    """
    Fetch the given URL and attempt to extract balance/task data from the HTML.
    Returns a structured result with full error detail on failure.
    """
    ts = datetime.now(timezone.utc).isoformat()
    url = req.url.strip()

    if not url.startswith(("http://", "https://")):
        return SyncResult(
            status="error",
            error_message="Invalid URL — must start with http:// or https://",
            error_detail=f"Provided URL: {url!r}",
            synced_at=ts,
        )

    try:
        async with httpx.AsyncClient(
            headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"},
            follow_redirects=True,
            timeout=20.0,
        ) as client:
            logger.info("Sync fetch: GET %s", url)
            response = await client.get(url)
            http_status = response.status_code
            logger.info("Sync fetch: HTTP %d for %s", http_status, url)

            if http_status >= 400:
                return SyncResult(
                    status="error",
                    error_message=f"HTTP {http_status} — server returned an error",
                    error_detail=(
                        f"URL: {url}\n"
                        f"HTTP status: {http_status}\n"
                        f"Response (first 500 chars): {response.text[:500]}"
                    ),
                    http_status=http_status,
                    synced_at=ts,
                )

            html = response.text
            final_url = str(response.url)

            # Check if we were redirected to a login page
            if _is_login_page(html, final_url, url):
                return SyncResult(
                    status="auth_required",
                    page_title=_extract_title(html),
                    error_message="Redirected to login page — open the site and log in first",
                    error_detail=(
                        f"Requested URL: {url}\n"
                        f"Final URL after redirects: {final_url}\n"
                        f"Page title: {_extract_title(html)}\n"
                        f"Login keywords found in HTML — session cookies are not available "
                        f"to this sync proxy. You need to be logged in via a browser session "
                        f"that shares cookies with the fetch request, which is not supported "
                        f"in the current architecture.\n\n"
                        f"To fix: the sync proxy cannot log in on your behalf. "
                        f"Balance and task counts must be entered manually, or the site "
                        f"must offer a public API endpoint."
                    ),
                    http_status=http_status,
                    synced_at=ts,
                )

            balance = _extract_balance(html)
            task_count = _extract_task_count(html)
            title = _extract_title(html)

            return SyncResult(
                status="ok",
                available_balance=balance,
                available_tasks=task_count,
                page_title=title,
                synced_at=ts,
                http_status=http_status,
            )

    except httpx.TimeoutException as e:
        logger.warning("Sync timeout for %s: %s", url, e)
        return SyncResult(
            status="error",
            error_message="Request timed out after 20 seconds",
            error_detail=(
                f"URL: {url}\n"
                f"Error type: {type(e).__name__}\n"
                f"Detail: {e}\n\n"
                f"Possible causes:\n"
                f"- The site is slow or temporarily down\n"
                f"- The domain does not resolve\n"
                f"- A firewall is blocking outbound requests from this server"
            ),
            synced_at=ts,
        )
    except httpx.ConnectError as e:
        logger.warning("Sync connect error for %s: %s", url, e)
        return SyncResult(
            status="error",
            error_message="Cannot connect to the website",
            error_detail=(
                f"URL: {url}\n"
                f"Error type: {type(e).__name__}\n"
                f"Detail: {e}\n\n"
                f"Possible causes:\n"
                f"- The domain does not exist or DNS failed\n"
                f"- The server refused the connection\n"
                f"- SSL/TLS certificate error"
            ),
            synced_at=ts,
        )
    except Exception as e:
        logger.exception("Sync unexpected error for %s", url)
        return SyncResult(
            status="error",
            error_message=f"Unexpected error: {type(e).__name__}",
            error_detail=(
                f"URL: {url}\n"
                f"Error type: {type(e).__name__}\n"
                f"Detail: {str(e)}"
            ),
            synced_at=ts,
        )


@router.get("/health")
def health():
    return {"status": "ok", "service": "sync-proxy"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_login_page(html: str, final_url: str, original_url: str) -> bool:
    final_lower = final_url.lower()
    if any(kw in final_lower for kw in _LOGIN_KEYWORDS):
        return True
    html_lower = html.lower()
    # Strong signals: login form fields
    has_password_field = 'type="password"' in html_lower or "type='password'" in html_lower
    has_login_form = bool(re.search(
        r'<form[^>]*>(.*?(?:login|sign.?in|log.?in|authenticate).*?)</form>',
        html_lower, re.DOTALL
    ))
    return has_password_field and has_login_form


def _extract_title(html: str) -> Optional[str]:
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    return m.group(1).strip()[:200] if m else None


def _extract_balance(html: str) -> Optional[float]:
    patterns = [
        r"(?:balance|earnings?|available|wallet|payout|credit)[^<$\n]{0,80}\$\s*([\d,]+\.?\d*)",
        r"\$\s*([\d,]+\.?\d*)(?:[^<\n]{0,60}(?:balance|earnings?|available|payout))",
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                val = float(m.group(1).replace(",", ""))
                if 0 <= val < 1_000_000:
                    return val
            except ValueError:
                pass
    return None


def _extract_task_count(html: str) -> Optional[int]:
    patterns = [
        r"(?:available|pending|open|new)[^<\d\n]{0,60}(\d{1,6})\s*(?:tasks?|jobs?|hits?|gigs?)",
        r"(\d{1,6})\s*(?:tasks?|jobs?|hits?|gigs?)\s*(?:available|pending|open|new)",
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                return int(m.group(1))
            except ValueError:
                pass
    return None
