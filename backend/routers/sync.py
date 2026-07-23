"""
Sync proxy — fetches a microtask website URL and returns extracted data.
Session cookies are loaded from the server-side auth store (keyed by website_id)
so they are never transmitted to or stored by the client.

Security measures:
- Only https:// and http:// schemes are accepted
- Private/loopback/link-local IP ranges are blocked (SSRF protection)
- Redirects are followed but the final destination is also validated
- Max redirects: 5
- Rate limiting: 10 requests per minute per IP via slowapi
"""

import httpx
import re
import ipaddress
import socket
import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel

from backend.services.auth_store import get_cookie_header, has_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sync", tags=["sync"])
limiter = Limiter(key_func=get_remote_address)

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

_LOGIN_KEYWORDS = {"login", "signin", "sign-in", "log-in", "authenticate", "auth"}

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
        return f"Scheme '{parsed.scheme}' not allowed"
    hostname = parsed.hostname
    if not hostname:
        return "URL has no hostname"
    lower_host = hostname.lower()
    if lower_host in ("localhost", "localhost.localdomain") or lower_host.endswith(".local") or lower_host.endswith(".internal"):
        return f"Hostname '{hostname}' is not allowed"
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        return f"DNS resolution failed for '{hostname}': {e}"
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        for net in _BLOCKED_NETWORKS:
            if ip in net:
                return f"'{hostname}' resolves to a private address ({ip})"
    return None


class SyncRequest(BaseModel):
    url: str
    name: str
    website_id: Optional[int] = None   # when provided, server-side cookies are used


class SyncResult(BaseModel):
    status: str
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
    Fetch the given URL and extract balance/task data.
    If website_id is supplied and a server-side session exists for it,
    cookies are loaded from the encrypted auth store and forwarded automatically.
    """
    ts = datetime.now(timezone.utc).isoformat()
    url = req.url.strip()

    err = _validate_url(url)
    if err:
        logger.warning("Sync blocked %r: %s", url, err)
        return SyncResult(status="error", error_message=f"URL not allowed: {err}",
                          error_detail=f"URL: {url!r}\nReason: {err}", synced_at=ts)

    # Load server-side session cookies — never from the client payload
    cookie_header: Optional[str] = None
    if req.website_id is not None:
        cookie_header = get_cookie_header(req.website_id)

    headers: dict = {
        "User-Agent": _UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
    }
    if cookie_header:
        headers["Cookie"] = cookie_header
        logger.info("Sync: using stored session cookies for website_id=%s", req.website_id)

    try:
        async with httpx.AsyncClient(
            headers=headers, follow_redirects=True, max_redirects=5, timeout=25.0,
        ) as client:
            response = await client.get(url)
            http_status = response.status_code
            final_url = str(response.url)

            if final_url != url:
                redir_err = _validate_url(final_url)
                if redir_err:
                    return SyncResult(status="error",
                                      error_message="Redirect target not allowed",
                                      error_detail=f"Original: {url}\nTarget: {final_url}\nReason: {redir_err}",
                                      synced_at=ts, http_status=http_status)

            if http_status >= 400:
                return SyncResult(status="error",
                                  error_message=f"HTTP {http_status}",
                                  error_detail=f"URL: {url}\nHTTP: {http_status}\nBody: {response.text[:500]}",
                                  http_status=http_status, synced_at=ts)

            html = response.text

            if _is_login_page(html, final_url, url):
                had_session = req.website_id is not None and has_session(req.website_id)
                return SyncResult(
                    status="auth_required",
                    page_title=_extract_title(html),
                    error_message=(
                        "Session expired — please log in again"
                        if had_session
                        else "Not logged in — use the Log In button on the website card"
                    ),
                    error_detail=(
                        f"URL: {url}\nFinal: {final_url}\n"
                        f"Had stored session: {had_session}"
                    ),
                    http_status=http_status,
                    synced_at=ts,
                )

            balance = _extract_balance(html)
            pending = _extract_pending_tasks(html)
            completed = _extract_completed_tasks(html)
            earnings = _extract_total_earnings(html)

            return SyncResult(
                status="ok",
                available_balance=balance,
                available_tasks=pending,
                pending_tasks=pending,
                completed_tasks=completed,
                total_earnings=earnings,
                page_title=_extract_title(html),
                synced_at=ts,
                http_status=http_status,
            )

    except httpx.TooManyRedirects as e:
        return SyncResult(status="error", error_message="Too many redirects",
                          error_detail=str(e), synced_at=ts)
    except httpx.TimeoutException as e:
        return SyncResult(status="error", error_message="Request timed out after 25 s",
                          error_detail=str(e), synced_at=ts)
    except httpx.ConnectError as e:
        return SyncResult(status="error", error_message="Cannot connect to website",
                          error_detail=str(e), synced_at=ts)
    except Exception as e:
        logger.exception("Sync unexpected error for %s", url)
        return SyncResult(status="error", error_message=f"Unexpected error: {type(e).__name__}",
                          error_detail=str(e), synced_at=ts)


@router.get("/health")
def health():
    return {"status": "ok", "service": "sync-proxy"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_login_page(html: str, final_url: str, original_url: str) -> bool:
    final_lower = final_url.lower()
    path_lower = urlparse(final_lower).path
    if any(kw in path_lower for kw in _LOGIN_KEYWORDS):
        return True
    query = urlparse(final_lower).query
    if any(kw in query for kw in _LOGIN_KEYWORDS):
        orig_host = urlparse(original_url.lower()).netloc
        final_host = urlparse(final_lower).netloc
        if orig_host == final_host:
            return True
    hl = html.lower()
    has_pw = 'type="password"' in hl or "type='password'" in hl
    if not has_pw:
        return False
    has_login_kw = bool(re.search(r'(?:login|sign.?in|log.?in|authenticate|forgot.?password)', hl))
    has_dash_kw = bool(re.search(r'(?:dashboard|wallet|balance|earnings?|withdraw|task|gig)', hl))
    if has_login_kw and not has_dash_kw:
        return True
    if has_login_kw and has_dash_kw:
        lc = len(re.findall(r'(?:login|sign.?in|log.?in|authenticate|password)', hl))
        dc = len(re.findall(r'(?:dashboard|wallet|balance|earnings?|withdraw|task|gig)', hl))
        return lc > dc * 2
    return False


def _extract_title(html: str) -> Optional[str]:
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    return m.group(1).strip()[:200] if m else None


def _extract_balance(html: str) -> Optional[float]:
    for pat in [
        r"(?:available\s+balance|withdrawable|wallet\s+balance|account\s+balance)[^<$\n]{0,120}\$\s*([\d,]+\.?\d*)",
        r"(?:balance|earnings?|available|wallet|payout|credit)[^<$\n]{0,80}\$\s*([\d,]+\.?\d*)",
        r"\$\s*([\d,]+\.?\d*)(?:[^<\n]{0,60}(?:balance|earnings?|available|payout))",
        r"(?:balance|earnings?|available|wallet)[^<\n]{0,80}(?:USD)?\s*([\d,]+\.\d{2})",
    ]:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                v = float(m.group(1).replace(",", ""))
                if 0 <= v < 1_000_000:
                    return v
            except ValueError:
                pass
    return None


def _extract_pending_tasks(html: str) -> Optional[int]:
    for pat in [
        r"(?:available|pending|open|new|active)[^<\d\n]{0,80}(\d{1,6})\s*(?:tasks?|jobs?|hits?|gigs?|orders?)",
        r"(\d{1,6})\s*(?:tasks?|jobs?|hits?|gigs?)\s*(?:available|pending|open|new|active)",
        r"(?:tasks?\s+available|available\s+tasks?)[^<\d\n]{0,40}(\d{1,6})",
        r"(?:pending)[^<\d\n]{0,60}(\d{1,6})",
    ]:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                v = int(m.group(1))
                if 0 <= v < 1_000_000:
                    return v
            except ValueError:
                pass
    return None


def _extract_completed_tasks(html: str) -> Optional[int]:
    for pat in [
        r"(?:completed|finished|done|approved|submitted)[^<\d\n]{0,80}(\d{1,6})\s*(?:tasks?|jobs?|hits?|gigs?|orders?)",
        r"(\d{1,6})\s*(?:tasks?|jobs?|hits?|gigs?)\s*(?:completed|finished|done|approved)",
        r"(?:tasks?\s+completed|completed\s+tasks?)[^<\d\n]{0,40}(\d{1,6})",
    ]:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                v = int(m.group(1))
                if 0 <= v < 10_000_000:
                    return v
            except ValueError:
                pass
    return None


def _extract_total_earnings(html: str) -> Optional[float]:
    for pat in [
        r"(?:total\s+earnings?|lifetime\s+earnings?|total\s+earned|all.?time\s+earnings?)[^<$\n]{0,120}\$\s*([\d,]+\.?\d*)",
        r"\$\s*([\d,]+\.?\d*)(?:[^<\n]{0,60}(?:total\s+earn|lifetime\s+earn|total\s+paid))",
        r"(?:earned|total\s+paid\s+out)[^<$\n]{0,100}\$\s*([\d,]+\.?\d*)",
    ]:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            try:
                v = float(m.group(1).replace(",", ""))
                if 0 <= v < 10_000_000:
                    return v
            except ValueError:
                pass
    return None
