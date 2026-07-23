"""
Sync proxy — loads an authenticated dashboard in Playwright and extracts data.
Session cookies are loaded from the server-side auth store (keyed by website_id)
so they are never transmitted to or stored by the client.

The sync path intentionally uses a real browser rather than an HTTP request:
dashboard values are commonly rendered by JavaScript after login.  Each sync
also records the final URL, captures the dashboard HTML for diagnostics, and
reports selector-level extraction results.

Security measures:
- Only https:// and http:// schemes are accepted
- Private/loopback/link-local IP ranges are blocked (SSRF protection)
- The final browser destination is also validated
- Rate limiting: 10 requests per minute per IP via slowapi
"""

import json
import re
import ipaddress
import socket
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel

from backend.services import auth_store
from backend.services import browser_session

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
    final_url: Optional[str] = None
    dashboard_html_path: Optional[str] = None
    selector_diagnostics: Optional[dict] = None
    extracted_value_count: int = 0


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

    try:
        return await _fetch_authenticated_dashboard(
            url=url,
            website_id=req.website_id,
            timestamp=ts,
        )
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


_DEBUG_HTML_DIR = Path("sync_debug")
_MAX_SAMPLE_LENGTH = 300

# These are deliberately explicit, inspectable selectors.  The final body
# selector is a fallback for dashboards that render values without stable
# IDs/classes; its parser still requires the metric label to be nearby.
_METRIC_SELECTORS: dict[str, tuple[str, ...]] = {
    "available_balance": (
        '[data-testid="available-balance"]',
        '[data-testid*="balance" i]',
        '[id*="balance" i]',
        '[class*="balance" i]',
        '[aria-label*="available balance" i]',
        "body",
    ),
    "pending_tasks": (
        '[data-testid="pending-tasks"]',
        '[data-testid*="pending" i]',
        '[id*="pending" i]',
        '[class*="pending" i]',
        '[aria-label*="pending task" i]',
        "body",
    ),
    "available_tasks": (
        '[data-testid="available-tasks"]',
        '[data-testid*="available-task" i]',
        '[id*="available-task" i]',
        '[class*="available-task" i]',
        '[aria-label*="available task" i]',
        "body",
    ),
    "total_earnings": (
        '[data-testid="total-earnings"]',
        '[data-testid*="earnings" i]',
        '[id*="earnings" i]',
        '[class*="earnings" i]',
        '[aria-label*="total earning" i]',
        "body",
    ),
    "completed_tasks": (
        '[data-testid="completed-tasks"]',
        '[data-testid*="completed" i]',
        '[id*="completed" i]',
        '[class*="completed" i]',
        '[aria-label*="completed task" i]',
        "body",
    ),
}

_METRIC_LABELS: dict[str, tuple[str, ...]] = {
    "available_balance": (r"available\s+balance", r"wallet\s+balance", r"\bbalance\b"),
    "pending_tasks": (r"pending\s+tasks?", r"\bpending\b"),
    "available_tasks": (r"available\s+tasks?", r"tasks?\s+available", r"available\s+gigs?"),
    "total_earnings": (
        r"total\s+earnings?",
        r"lifetime\s+earnings?",
        r"total\s+earned",
        r"total\s+paid",
    ),
    "completed_tasks": (
        r"completed\s+tasks?",
        r"tasks?\s+completed",
        r"\bcompleted\b",
    ),
}


async def _fetch_authenticated_dashboard(
    *, url: str, website_id: Optional[int], timestamp: str
) -> SyncResult:
    """Open the dashboard in Playwright using the saved authenticated context."""
    cookies = auth_store.load_cookies(website_id) if website_id is not None else None
    had_session = bool(cookies)
    if website_id is not None:
        logger.info(
            "Sync: Playwright auth check website_id=%s stored_session=%s cookie_count=%d",
            website_id,
            had_session,
            len(cookies or []),
        )

    from playwright.async_api import async_playwright

    chromium_path = await browser_session._ensure_chromium()
    launch_kwargs: dict = {
        "headless": True,
        "args": [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-software-rasterizer",
        ],
    }
    if chromium_path:
        launch_kwargs["executable_path"] = chromium_path

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(**launch_kwargs)
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=_UA,
            locale="en-US",
            timezone_id="America/New_York",
        )
        try:
            if cookies:
                await context.add_cookies(cookies)

            page = await context.new_page()
            response = await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            try:
                await page.wait_for_load_state("networkidle", timeout=8_000)
            except Exception:
                logger.info("Sync: networkidle wait timed out; parsing current DOM")

            final_url = page.url
            http_status = response.status if response else None
            logger.info(
                "Sync: current page URL after login website_id=%s url=%s http_status=%s",
                website_id,
                final_url,
                http_status,
            )

            redir_err = _validate_url(final_url)
            if redir_err:
                return SyncResult(
                    status="error",
                    error_message="Dashboard redirect target not allowed",
                    error_detail=f"Original: {url}\nFinal: {final_url}\nReason: {redir_err}",
                    synced_at=timestamp,
                    final_url=final_url,
                    http_status=http_status,
                )

            html = await page.content()
            html_path = _capture_dashboard_html(website_id, html)
            logger.info(
                "Sync: authenticated dashboard HTML captured website_id=%s path=%s bytes=%d",
                website_id,
                html_path or "not-written",
                len(html.encode("utf-8")),
            )

            if _is_login_page(html, final_url, url):
                logger.warning(
                    "Sync: Playwright reached a login page instead of authenticated dashboard "
                    "website_id=%s url=%s",
                    website_id,
                    final_url,
                )
                return SyncResult(
                    status="auth_required",
                    page_title=await page.title(),
                    error_message=(
                        "Session expired — please log in again"
                        if had_session
                        else "Not logged in — use the Log In button on the website card"
                    ),
                    error_detail=(
                        f"URL: {url}\nFinal: {final_url}\n"
                        f"Had stored session: {had_session}\n"
                        f"Dashboard HTML: {html_path or 'not captured'}"
                    ),
                    synced_at=timestamp,
                    final_url=final_url,
                    dashboard_html_path=html_path,
                    http_status=http_status,
                )

            logger.info(
                "Sync: Playwright reached authenticated dashboard website_id=%s url=%s",
                website_id,
                final_url,
            )
            metrics, diagnostics = await _extract_dashboard_metrics(page)
            extracted_count = sum(value is not None for value in metrics.values())
            logger.info(
                "Sync: extracted values before save website_id=%s values=%s extracted_count=%d",
                website_id,
                metrics,
                extracted_count,
            )

            detail = json.dumps(
                {
                    "url": url,
                    "final_url": final_url,
                    "html_path": html_path,
                    "metrics": metrics,
                    "selectors": diagnostics,
                },
                indent=2,
            )
            if extracted_count == 0:
                logger.error(
                    "Sync: no dashboard selectors produced a value website_id=%s diagnostics=%s",
                    website_id,
                    detail,
                )
                return SyncResult(
                    status="error",
                    available_balance=metrics["available_balance"],
                    available_tasks=metrics["available_tasks"],
                    pending_tasks=metrics["pending_tasks"],
                    completed_tasks=metrics["completed_tasks"],
                    total_earnings=metrics["total_earnings"],
                    page_title=await page.title(),
                    error_message="Dashboard reached, but no dashboard values were extracted",
                    error_detail=detail,
                    synced_at=timestamp,
                    final_url=final_url,
                    dashboard_html_path=html_path,
                    selector_diagnostics=diagnostics,
                    extracted_value_count=0,
                    http_status=http_status,
                )

            return SyncResult(
                status="ok",
                available_balance=metrics["available_balance"],
                available_tasks=metrics["available_tasks"],
                pending_tasks=metrics["pending_tasks"],
                completed_tasks=metrics["completed_tasks"],
                total_earnings=metrics["total_earnings"],
                page_title=await page.title(),
                synced_at=timestamp,
                final_url=final_url,
                dashboard_html_path=html_path,
                selector_diagnostics=diagnostics,
                extracted_value_count=extracted_count,
                http_status=http_status,
            )
        finally:
            await context.close()
            await browser.close()


def _capture_dashboard_html(website_id: Optional[int], html: str) -> Optional[str]:
    """Persist the exact parsed dashboard HTML for selector debugging."""
    try:
        _DEBUG_HTML_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = _DEBUG_HTML_DIR / f"website_{website_id or 'unknown'}_{stamp}.html"
        path.write_text(html, encoding="utf-8")
        return str(path)
    except OSError as exc:
        logger.error("Sync: failed to capture dashboard HTML: %s", exc)
        return None


async def _extract_dashboard_metrics(page) -> tuple[dict[str, Optional[float | int]], dict]:
    """Extract all five dashboard metrics and return selector diagnostics."""
    definitions = {
        "available_balance": ("amount", _METRIC_LABELS["available_balance"]),
        "pending_tasks": ("count", _METRIC_LABELS["pending_tasks"]),
        "available_tasks": ("count", _METRIC_LABELS["available_tasks"]),
        "total_earnings": ("amount", _METRIC_LABELS["total_earnings"]),
        "completed_tasks": ("count", _METRIC_LABELS["completed_tasks"]),
    }
    metrics: dict[str, Optional[float | int]] = {}
    diagnostics: dict = {}
    for metric, (kind, labels) in definitions.items():
        value, diagnostic = await _extract_metric(
            page,
            metric,
            _METRIC_SELECTORS[metric],
            kind,
            labels,
        )
        metrics[metric] = value
        diagnostics[metric] = diagnostic
    return metrics, diagnostics


async def _extract_metric(
    page, metric: str, selectors: tuple[str, ...], kind: str, labels: tuple[str, ...]
) -> tuple[Optional[float | int], dict]:
    diagnostic = {"value": None, "attempts": []}
    for selector in selectors:
        try:
            locator = page.locator(selector)
            count = await locator.count()
            if count == 0:
                attempt = {"selector": selector, "matched": 0, "reason": "no matching elements"}
                diagnostic["attempts"].append(attempt)
                logger.warning("Sync selector failed metric=%s selector=%s reason=no matching elements",
                               metric, selector)
                continue

            for index in range(min(count, 3)):
                text = (await locator.nth(index).inner_text()).strip()
                value = _parse_metric_text(text, kind, labels, selector == "body")
                attempt = {
                    "selector": selector,
                    "matched": count,
                    "sample": text[:_MAX_SAMPLE_LENGTH],
                    "value": value,
                }
                diagnostic["attempts"].append(attempt)
                if value is not None:
                    diagnostic["value"] = value
                    logger.info(
                        "Sync selector verified metric=%s selector=%s value=%s",
                        metric,
                        selector,
                        value,
                    )
                    return value, diagnostic

            logger.warning(
                "Sync selector failed metric=%s selector=%s reason=matched elements "
                "contained no parseable %s",
                metric,
                selector,
                kind,
            )
        except Exception as exc:
            attempt = {"selector": selector, "reason": f"{type(exc).__name__}: {exc}"}
            diagnostic["attempts"].append(attempt)
            logger.warning(
                "Sync selector failed metric=%s selector=%s reason=%s",
                metric,
                selector,
                attempt["reason"],
            )
    return None, diagnostic


def _parse_metric_text(
    text: str, kind: str, labels: tuple[str, ...], body_selector: bool
) -> Optional[float | int]:
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return None

    if kind == "amount":
        amount = r"\$?\s*([\d,]+(?:\.\d{1,2})?)"
        if body_selector:
            for label in labels:
                match = re.search(rf"{label}[^\n$]{{0,100}}?{amount}", clean, re.IGNORECASE)
                if not match:
                    match = re.search(rf"{amount}[^\n$]{{0,100}}?{label}", clean, re.IGNORECASE)
                if match:
                    return _safe_float(match.group(1), 10_000_000)
            return None
        match = re.search(r"\$?\s*([\d,]+(?:\.\d{1,2})?)", clean)
        return _safe_float(match.group(1), 10_000_000) if match else None

    integer = r"([\d,]+)"
    if body_selector:
        for label in labels:
            match = re.search(rf"{label}[^\d]{{0,100}}?{integer}", clean, re.IGNORECASE)
            if not match:
                match = re.search(rf"{integer}[^\d]{{0,100}}?{label}", clean, re.IGNORECASE)
            if match:
                return _safe_int(match.group(1), 10_000_000)
        return None
    match = re.search(integer, clean)
    return _safe_int(match.group(1), 10_000_000) if match else None


def _safe_float(raw: str, upper_bound: float) -> Optional[float]:
    try:
        value = float(raw.replace(",", ""))
        return value if 0 <= value < upper_bound else None
    except ValueError:
        return None


def _safe_int(raw: str, upper_bound: int) -> Optional[int]:
    try:
        value = int(raw.replace(",", ""))
        return value if 0 <= value < upper_bound else None
    except ValueError:
        return None


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
