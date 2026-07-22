"""
Website sync service.
Fetches the website's dashboard URL via HTTP and extracts visible data
(balance, available task count) using lightweight HTML parsing.

This service reads data only — it never submits forms, completes tasks,
or performs any automated actions on the user's behalf.
"""

import httpx
import re
import json
from typing import Optional
from sqlalchemy.orm import Session

from backend import models
from backend.services.activity import log_activity

# Browser-like UA so sites don't reject the request immediately
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Keywords that suggest we landed on a login page instead of the dashboard
_LOGIN_KEYWORDS = {"login", "signin", "sign-in", "log-in", "authenticate", "auth"}


async def sync_website(db: Session, website: models.Website) -> models.WebsiteSnapshot:
    """
    Attempt to fetch and parse the website's dashboard URL.
    Always writes a WebsiteSnapshot and an ActivityLog entry regardless of outcome.
    """
    url = website.dashboard_url or website.login_url
    snapshot = models.WebsiteSnapshot(website_id=website.id, status="error")

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=True,
            headers={"User-Agent": _UA},
        ) as client:
            resp = await client.get(url)

        final_url = str(resp.url).lower()

        # Detect redirect to a login wall
        if any(kw in final_url for kw in _LOGIN_KEYWORDS) and _normalize(final_url) != _normalize(url):
            snapshot.status = "auth_required"
            snapshot.error_message = "Redirected to login page — open the site and log in first"
        elif resp.status_code in (401, 403):
            snapshot.status = "auth_required"
            snapshot.error_message = f"HTTP {resp.status_code} — authentication required"
        elif resp.status_code >= 400:
            snapshot.status = "error"
            snapshot.error_message = f"HTTP {resp.status_code} from server"
        else:
            html = resp.text
            snapshot.status = "ok"
            snapshot.page_title = _extract_title(html)
            snapshot.available_balance = _extract_balance(html)
            snapshot.available_tasks = _extract_task_count(html)

            # Persist a JSON extract for debugging
            all_amounts = re.findall(r"\$\s*([\d,]+\.?\d*)", html)
            amounts = []
            for m in all_amounts[:20]:
                try:
                    amounts.append(float(m.replace(",", "")))
                except ValueError:
                    pass
            snapshot.raw_extract = json.dumps({
                "url": str(resp.url),
                "title": snapshot.page_title,
                "dollar_amounts": amounts,
                "balance": snapshot.available_balance,
                "available_tasks": snapshot.available_tasks,
            })

    except httpx.TimeoutException:
        snapshot.status = "error"
        snapshot.error_message = "Connection timed out after 15 seconds"
    except httpx.ConnectError as exc:
        snapshot.status = "error"
        snapshot.error_message = f"Cannot connect to host: {str(exc)[:120]}"
    except Exception as exc:  # noqa: BLE001
        snapshot.status = "error"
        snapshot.error_message = str(exc)[:200]

    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)

    _status_label = {
        "ok": "synced successfully",
        "auth_required": "login required — open the site to authenticate",
        "error": snapshot.error_message or "unknown error",
    }.get(snapshot.status, snapshot.status)

    log_activity(
        db,
        f"Synced {website.name}",
        _status_label,
        "website",
        website.id,
    )

    return snapshot


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize(url: str) -> str:
    """Strip scheme/trailing slash for comparison."""
    return re.sub(r"^https?://", "", url).rstrip("/")


def _extract_title(html: str) -> Optional[str]:
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    return m.group(1).strip()[:500] if m else None


def _extract_balance(html: str) -> Optional[float]:
    """
    Scan visible text for a dollar amount near earnings / balance keywords.
    Returns the first plausible value found.
    """
    patterns = [
        # "Balance: $12.34"  or  "Your earnings $12.34"
        r"(?:balance|earnings?|available|wallet|payout|credit)[^<$\n]{0,80}\$\s*([\d,]+\.?\d*)",
        # "$12.34  balance"
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
    """
    Look for a number immediately beside common task-availability keywords.
    """
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
