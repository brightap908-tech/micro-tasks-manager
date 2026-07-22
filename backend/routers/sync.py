"""
Sync proxy — fetches a microtask website URL and returns extracted data.
This is the ONLY backend endpoint. All app data is stored in IndexedDB on
the client. This endpoint exists solely to bypass browser CORS restrictions
when reading external microtask websites.

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

_LOGIN_KEYWORDS = {"login", "signin", "sign-in", "log-in", "authenticate", "auth", "password"}

# Private, loopback, link-local, and reserved IP networks (SSRF blocklist)
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),      # loopback
    ipaddress.ip_network("::1/128"),           # IPv6 loopback
    ipaddress.ip_network("10.0.0.0/8"),        # private
    ipaddress.ip_network("172.16.0.0/12"),     # private
    ipaddress.ip_network("192.168.0.0/16"),    # private
    ipaddress.ip_network("169.254.0.0/16"),    # link-local
    ipaddress.ip_network("fe80::/10"),         # IPv6 link-local
    ipaddress.ip_network("fc00::/7"),          # IPv6 unique local
    ipaddress.ip_network("0.0.0.0/8"),         # "this" network
    ipaddress.ip_network("100.64.0.0/10"),     # shared address space
    ipaddress.ip_network("192.0.0.0/24"),      # IETF protocol
    ipaddress.ip_network("198.18.0.0/15"),     # benchmark
    ipaddress.ip_network("198.51.100.0/24"),   # documentation
    ipaddress.ip_network("203.0.113.0/24"),    # documentation
    ipaddress.ip_network("240.0.0.0/4"),       # reserved
    ipaddress.ip_network("255.255.255.255/32"), # broadcast
    ipaddress.ip_network("::ffff:0:0/96"),     # IPv4-mapped
    ipaddress.ip_network("2001:db8::/32"),     # documentation
]

_ALLOWED_SCHEMES = {"http", "https"}


def _validate_url(url: str) -> Optional[str]:
    """
    Validate that the URL is safe to fetch.
    Returns an error string if invalid/blocked, or None if OK.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return "Malformed URL"

    if parsed.scheme not in _ALLOWED_SCHEMES:
        return f"Scheme '{parsed.scheme}' is not allowed — only http and https are permitted"

    hostname = parsed.hostname
    if not hostname:
        return "URL has no hostname"

    # Reject obviously internal hostnames before DNS
    lower_host = hostname.lower()
    if lower_host in ("localhost", "localhost.localdomain") or lower_host.endswith(".local") or lower_host.endswith(".internal"):
        return f"Hostname '{hostname}' is not allowed (internal/private)"

    # Resolve hostname and check all returned IPs
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

    return None  # all clear


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
@limiter.limit("10/minute")
async def fetch_website(req: SyncRequest, request: Request) -> SyncResult:
    """
    Fetch the given URL and attempt to extract balance/task data from the HTML.
    Returns a structured result with full error detail on failure.

    Security: URL is validated against a private-IP blocklist before fetching.
    Rate limit: 10 requests per minute per client IP.
    """
    ts = datetime.now(timezone.utc).isoformat()
    url = req.url.strip()

    # ── URL validation (SSRF protection) ──────────────────────────────────────
    url_error = _validate_url(url)
    if url_error:
        logger.warning("Sync blocked unsafe URL %r: %s", url, url_error)
        return SyncResult(
            status="error",
            error_message=f"URL not allowed: {url_error}",
            error_detail=f"Provided URL: {url!r}\nReason: {url_error}",
            synced_at=ts,
        )

    try:
        async with httpx.AsyncClient(
            headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"},
            follow_redirects=True,
            max_redirects=5,
            timeout=20.0,
        ) as client:
            logger.info("Sync fetch: GET %s", url)
            response = await client.get(url)
            http_status = response.status_code
            logger.info("Sync fetch: HTTP %d for %s", http_status, url)

            # Validate the final (post-redirect) URL as well
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

            # Check if we were redirected to a login page
            if _is_login_page(html, final_url, url):
                return SyncResult(
                    status="auth_required",
                    page_title=_extract_title(html),
                    error_message="Redirected to login page — open the site and log in first",
                    error_detail=(
                        f"Requested URL: {url}\n"
                        f"Final URL after redirects: {final_url}\n"
                        f"Page title: {_extract_title(html)}\n\n"
                        f"The sync proxy fetches pages as an anonymous visitor and cannot "
                        f"share your browser login session. To get balance data, use the "
                        f"'Update balance manually' option on the website card."
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
