"""
Server-side encrypted storage for website authentication cookies.
Cookies are persisted to an encrypted JSON file using Fernet symmetric
encryption. The key is derived from SESSION_SECRET so data is tied to
this deployment.  No cookies are ever sent to or stored by the client.
"""
import os
import json
import base64
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger(__name__)

_STORE_FILE = Path(".auth_cookies.enc")
_SECRET = os.environ.get("SESSION_SECRET", "microtask-manager-default-key-please-set-env")
_SALT = b"microtask-auth-store-v1-static"


def _fernet() -> Fernet:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=_SALT, iterations=100_000)
    key = base64.urlsafe_b64encode(kdf.derive(_SECRET.encode()))
    return Fernet(key)


def _load_all() -> Dict:
    if not _STORE_FILE.exists():
        return {}
    try:
        raw = _STORE_FILE.read_bytes()
        return json.loads(_fernet().decrypt(raw))
    except Exception as e:
        logger.warning("Failed to load auth store: %s", e)
        return {}


def _save_all(data: Dict) -> None:
    _STORE_FILE.write_bytes(_fernet().encrypt(json.dumps(data).encode()))


def save_cookies(website_id: int, cookies: List[dict]) -> None:
    data = _load_all()
    data[str(website_id)] = {
        "cookies": cookies,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_all(data)
    logger.info("Saved %d auth cookies for website %d", len(cookies), website_id)


def load_cookies(website_id: int) -> Optional[List[dict]]:
    return (_load_all().get(str(website_id)) or {}).get("cookies")


def get_cookie_header(website_id: int) -> Optional[str]:
    """Return a Cookie header string for the website, or None if no session stored."""
    cookies = load_cookies(website_id)
    if not cookies:
        return None
    return "; ".join(f"{c['name']}={c['value']}" for c in cookies if c.get("name"))


def has_session(website_id: int) -> bool:
    return str(website_id) in _load_all()


def get_saved_at(website_id: int) -> Optional[str]:
    entry = _load_all().get(str(website_id))
    return entry.get("saved_at") if entry else None


def delete_session(website_id: int) -> None:
    data = _load_all()
    data.pop(str(website_id), None)
    _save_all(data)
    logger.info("Deleted auth session for website %d", website_id)


def list_sessions() -> List[dict]:
    return [
        {"website_id": int(k), "saved_at": v.get("saved_at")}
        for k, v in _load_all().items()
    ]
