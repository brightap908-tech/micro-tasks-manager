"""
Sync proxy — fetches a microtask website URL and returns extracted data.
The backend proxy can forward session cookies supplied by the client so it
authenticates as the logged-in user, allowing it to read dashboard pages that
would otherwise redirect to the login screen.

Security measures:
- Only https:// and http:// schemes are accepted
- Private/loopback/link-local IP ranges are blocked (SSRF protection)
- Redirects are followed but the final destination is also validated
- Max redirects: 5
- Rate limiting: 10 requests per minute per IP via slowapi
- Forwarded cookies are stripped of any internal/private targets
"""

import httpx
import re
import ipaddress
import socket
import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Request, HTTPException
from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sync", tags=["sync"])
limiter = Limiter(key_func=get_remote_address)

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

_LOGIN_KEYWORDS = {"login", "signin", "sign-in", "log-in", "authenticate", "auth"}

# Private, loopback, link-local, and reserved IP networks (SSRF blocklist)
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
    ipaddress.ip_network("240.0.0.0/4"),
    ipaddress.ip_network("255.255.255.255/32"),
    ipaddress.ip_network("::ffff:0:0/96"),
    ipaddress.ip_network("2001:db8::/32"),
]

_ALLOWED_SCHEMES = {"http", "https"}


def _validate_url(url: str) -> Optional[str]:
    try:
        parsed = urlparse(url)
    except Exception:
        return "Malformed URL"

    if parsed.scheme not in _ALLOWED_SCHEMES:
        return f"Scheme '{parsed.scheme}' is not allowed — only http and https are permitted"

    hostname = parsed.hostname
    if not hostname:
        return "URL has no hostname"

    lower_host = hostname.lower()
    if lower_host in ("localhost", "localhost.localdomain") or lower_host.endswith(".local") or lower_host.endswith(".internal"):
        return f"Hostname '{hostname}' is not allowed (internal/private)"

    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        return f"DNS resolution failed for '{hostname}': {e}"

    for info in infos:
        addr_str = info[4][0]
        try:
            ip = ipaddress.ip_address(addr_str)
        except ValueError:
            continue
        for network in _BLOCKED_NETWORKS:
            if ip in network:
                return f"The hostname '{hostname}' resolves to a private/reserved address ({ip}) and cannot be fetched"

    return None


class SyncRequest(BaseModel):
    url: str
    name: str
    cookies: Optional[str] = None   # raw Cookie header value forwarded from the browser session


class SyncResult(BaseModel):
    status: str                              # ok | auth_required | error
    available_balance: Optional[float] = None
    available_tasks: Optional[int] = None
    pending_tasks: Optional[int] = None
    completed_tasks: Optional[int] = None
    total_earnings: Optional[float] = None
    page_title: Optional[str] = None
    error_message: Optional[str] = None
    error_detail: Optional[str] = None
    synced_at: str
    http_status: Optional[int] = None


@router.post("/fetch", response_model=SyncResult)
@limiter.limit("10/minute")
async def fetch_website(req: SyncRequest, request: Request) -> SyncResult:
    """
    Fetch the given URL and attempt to extract balance/task data from the HTML.
    If `cookies` is provided in the request body the value is forwarded as the
    Cookie header so the remote site sees an authenticated session.

    Security: URL is validated against a private-IP blocklist before fetching.
    Rate limit: 10 requests per minute per client IP.
    """
    ts = datetime.now(timezone.utc).isoformat()
    url = req.url.strip()

    url_error = _validate_url(url)
    if url_error:
        logger.warning("Sync blocked unsafe URL %r: %s", url, url_error)
        return SyncResult(
            status="error",
            error_message=f"URL not allowed: {url_error}",
            error_detail=f"Provided URL: {url!r}\nReason: {url_error}",
            synced_at=ts,
        )

    # Build request headers — forward session cookie if provided
    headers: dict = {
        "User-Agent": _UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
    }
    has_cookies = bool(req.cookies and req.cookies.strip())
    if has_cookies:
        headers["Cookie"] = req.cookies.strip()
        logger.info("Sync fetch: forwarding session cookies for %s", url)

    try:
        async with httpx.AsyncClient(
            headers=headers,
            follow_redirects=True,
            max_redirects=5,
            timeout=25.0,
        ) as client:
            logger.info("Sync fetch: GET %s (cookies=%s)", url, has_cookies)
            response = await client.get(url)
            http_status = response.status_code
            logger.info("Sync fetch: HTTP %d for %s", http_status, url)

            final_url = str(response.url)
            if final_url != url:
                redirect_error = _validate_url(final_url)
                if redirect_error:
                    logger.warning("Sync redirect to unsafe URL %r: %s", final_url, redirect_error)
                    return SyncResult(
                        status="error",
                        error_message="Redirect target is not allowed",
                        error_detail=f"Original URL: {url}\nRedirect target: {final_url}\nReason: {redirect_error}",
                        synced_at=ts,
                        http_status=http_status,
                    )

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

            # Detect login redirect — if we had cookies and still landed on login,
            # the session is expired/invalid rather than missing
            if _is_login_page(html, final_url, url):
                if has_cookies:
                    detail_msg = (
                        "Your saved session cookie has expired or is no longer valid.\n"
                        "Please log in to the site in your browser, copy your new session\n"
                        "cookie, and update it in the app."
                    )
                else:
                    detail_msg = (
                        "The sync proxy fetches pages as an anonymous visitor and cannot\n"
                        "share your browser login session. To fix this:\n"
                        "1. Open the site in your browser and log in.\n"
                        "2. Copy your session cookie (see the app's cookie help).\n"
                        "3. Paste it into the 'Session Cookie' field for this website.\n"
                        "The proxy will use it to authenticate your requests."
                    )
                return SyncResult(
                    status="auth_required",
                    page_title=_extract_title(html),
                    error_message=(
                        "Session cookie expired — update it in the app"
                        if has_cookies
                        else "No session cookie — paste your cookie to enable sync"
                    ),
                    error_detail=(
                        f"Requested URL: {url}\n"
                        f"Final URL after redirects: {final_url}\n"
                        f"Page title: {_extract_title(html)}\n\n"
                        f"{detail_msg}"
                    ),
                    http_status=http_status,
                    synced_at=ts,
                )

            # ── Data extraction ───────────────────────────────────────────────
            balance = _extract_balance(html)
            pending = _extract_pending_tasks(html)
            completed = _extract_completed_tasks(html)
            earnings = _extract_total_earnings(html)
            title = _extract_title(html)

            # available_tasks is an alias for pending (backwards compat)
            return SyncResult(
                status="ok",
                available_balance=balance,
                available_tasks=pending,
                pending_tasks=pending,
                completed_tasks=completed,
                total_earnings=earnings,
                page_title=title,
                synced_at=ts,
                http_status=http_status,
            )

    except httpx.TooManyRedirects as e:
        logger.warning("Sync too many redirects for %s: %s", url, e)
        return SyncResult(
            status="error",
            error_message="Too many redirects (max 5)",
            error_detail=f"URL: {url}\nError: {e}",
            synced_at=ts,
        )
    except httpx.TimeoutException as e:
        logger.warning("Sync timeout for %s: %s", url, e)
        return SyncResult(
            status="error",
            error_message="Request timed out after 25 seconds",
            error_detail=(
                f"URL: {url}\n"
                f"Error type: {type(e).__name__}\n"
                f"Detail: {e}\n\n"
                "Possible causes:\n"
                "- The site is slow or temporarily down\n"
                "- The domain does not resolve\n"
                "- A firewall is blocking outbound requests from this server"
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
                "Possible causes:\n"
                "- The domain does not exist or DNS failed\n"
                "- The server refused the connection\n"
                "- SSL/TLS certificate error"
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
    """
    Returns True only when the response is clearly a login/auth page.
    Uses URL path keywords first, then requires both a password field AND
    a login-specific form action or keyword (not just any form).
    """
    final_lower = final_url.lower()
    parsed = urlparse(final_lower)
    path_lower = parsed.path

    # URL path strongly suggests a login page
    if any(kw in path_lower for kw in _LOGIN_KEYWORDS):
        return True

    # Query string suggests a redirect-to-login
    query = parsed.query.lower()
    if "redirect" in query or "return" in query or "next=" in query or "login" in query:
        # Only treat as login if the original URL differs significantly from final
        orig_host = urlparse(original_url.lower()).netloc
        final_host = parsed.netloc
        if orig_host == final_host:
            # Same host redirect with login in query — likely auth redirect
            if any(kw in query for kw in _LOGIN_KEYWORDS):
                return True

    html_lower = html.lower()
    has_password_field = 'type="password"' in html_lower or "type='password'" in html_lower
    if not has_password_field:
        return False

    # Password field present — also check for login form markers
    has_login_keyword = bool(re.search(
        r'(?:login|sign.?in|log.?in|authenticate|forgot.?password|remember.?me)',
        html_lower,
    ))
    # Exclude dashboard pages that happen to have a password field (e.g. change password form)
    has_dashboard_indicator = bool(re.search(
        r'(?:dashboard|wallet|balance|earnings?|withdraw|task|gig|job)',
        html_lower,
    ))

    if has_login_keyword and not has_dashboard_indicator:
        return True

    # If both login AND dashboard keywords exist, check ratio — login page
    # has far more login content than dashboard content
    if has_login_keyword and has_dashboard_indicator:
        login_count = len(re.findall(
            r'(?:login|sign.?in|log.?in|authenticate|password)', html_lower
        ))
        dashboard_count = len(re.findall(
            r'(?:dashboard|wallet|balance|earnings?|withdraw|task|gig|job)', html_lower
        ))
        return login_count > dashboard_count * 2

    return False


def _extract_title(html: str) -> Optional[str]:
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    return m.group(1).strip()[:200] if m else None


def _extract_balance(html: str) -> Optional[float]:
    """Extract available/withdrawable balance."""
    patterns = [
        # Label then amount
        r"(?:available\s+balance|withdrawable|wallet\s+balance|account\s+balance)[^<$\n]{0,120}\$\s*([\d,]+\.?\d*)",
        r"(?:balance|earnings?|available|wallet|payout|credit)[^<$\n]{0,80}\$\s*([\d,]+\.?\d*)",
        # Amount then label
        r"\$\s*([\d,]+\.?\d*)(?:[^<\n]{0,60}(?:balance|earnings?|available|payout))",
        # Currency symbol variants
        r"(?:balance|earnings?|available|wallet)[^<\n]{0,80}(?:USD|GBP|EUR)?\s*([\d,]+\.\d{2})",
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


def _extract_pending_tasks(html: str) -> Optional[int]:
    """Extract available/pending task count."""
    patterns = [
        r"(?:available|pending|open|new|active)[^<\d\n]{0,80}(\d{1,6})\s*(?:tasks?|jobs?|hits?|gigs?|orders?)",
        r"(\d{1,6})\s*(?:tasks?|jobs?|hits?|gigs?|orders?)\s*(?:available|pending|open|new|active)",
        r"(?:tasks?\s+available|available\s+tasks?)[^<\d\n]{0,40}(\d{1,6})",
        r"(?:pending)[^<\d\n]{0,60}(\d{1,6})",
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                val = int(m.group(1))
                if 0 <= val < 1_000_000:
                    return val
            except ValueError:
                pass
    return None


def _extract_completed_tasks(html: str) -> Optional[int]:
    """Extract completed task count."""
    patterns = [
        r"(?:completed|finished|done|approved|submitted)[^<\d\n]{0,80}(\d{1,6})\s*(?:tasks?|jobs?|hits?|gigs?|orders?)",
        r"(\d{1,6})\s*(?:tasks?|jobs?|hits?|gigs?|orders?)\s*(?:completed|finished|done|approved)",
        r"(?:tasks?\s+completed|completed\s+tasks?)[^<\d\n]{0,40}(\d{1,6})",
        r"(?:total\s+completed|total\s+tasks\s+done)[^<\d\n]{0,60}(\d{1,6})",
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                val = int(m.group(1))
                if 0 <= val < 10_000_000:
                    return val
            except ValueError:
                pass
    return None


def _extract_total_earnings(html: str) -> Optional[float]:
    """Extract total/lifetime earnings (distinct from current balance)."""
    patterns = [
        r"(?:total\s+earnings?|lifetime\s+earnings?|total\s+earned|all.?time\s+earnings?)[^<$\n]{0,120}\$\s*([\d,]+\.?\d*)",
        r"\$\s*([\d,]+\.?\d*)(?:[^<\n]{0,60}(?:total\s+earn|lifetime\s+earn|total\s+paid))",
        r"(?:total\s+earnings?|total\s+earned)[^<\n]{0,80}([\d,]+\.\d{2})",
        r"(?:earned|total\s+paid\s+out)[^<$\n]{0,100}\$\s*([\d,]+\.?\d*)",
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                val = float(m.group(1).replace(",", ""))
                if 0 <= val < 10_000_000:
                    return val
            except ValueError:
                pass
    return None
