"""
Security utilities for credential encryption.
Uses Fernet symmetric encryption.

Key resolution order (first match wins):
  1. ENCRYPTION_KEY environment variable  ← required in production (Render)
  2. .encryption.key file on disk         ← local development
  3. Auto-generate + log the key          ← first local run only

IMPORTANT FOR RENDER DEPLOYMENT:
  Generate a key once:
      python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  Then set it as an environment variable named ENCRYPTION_KEY in Render's dashboard.
  Never change this key after credentials are stored — doing so will make all
  saved passwords unreadable.
"""

import os
import logging
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

# Path used only for local-dev file fallback
_KEY_FILE = os.getenv("ENCRYPTION_KEY_FILE", ".encryption.key")

_fernet: Fernet | None = None


def _load_or_create_key() -> bytes:
    """Return the Fernet key bytes from the best available source."""

    # 1. Environment variable (production / Render)
    env_key = os.environ.get("ENCRYPTION_KEY", "").strip()
    if env_key:
        return env_key.encode()

    # 2. Local key file
    if os.path.exists(_KEY_FILE):
        with open(_KEY_FILE, "rb") as f:
            return f.read().strip()

    # 3. Generate a new key (first-ever local run)
    key = Fernet.generate_key()
    try:
        with open(_KEY_FILE, "wb") as f:
            f.write(key)
        os.chmod(_KEY_FILE, 0o600)
        logger.info("Generated new encryption key and saved to %s", _KEY_FILE)
    except OSError:
        # Read-only filesystem (some deploy environments) — key lives in memory.
        logger.warning(
            "Could not write encryption key to disk (read-only fs?). "
            "Set the ENCRYPTION_KEY environment variable to persist credentials "
            "across restarts. Generated key: %s",
            key.decode(),
        )

    return key


def get_fernet() -> Fernet:
    """Return the cached Fernet instance, initialising it on first call."""
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_load_or_create_key())
    return _fernet


def encrypt_password(plaintext: str) -> str:
    """Encrypt a plaintext password and return a base64-encoded ciphertext string."""
    return get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_password(ciphertext: str) -> str:
    """Decrypt a ciphertext string back to the original plaintext password."""
    return get_fernet().decrypt(ciphertext.encode()).decode()
