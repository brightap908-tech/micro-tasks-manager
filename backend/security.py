"""
Security utilities for credential encryption.
Uses Fernet symmetric encryption backed by a key stored in the database
(or generated on first run and persisted).
"""

import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# Key file path — stored outside of version control
KEY_FILE = os.getenv("ENCRYPTION_KEY_FILE", ".encryption.key")


def _load_or_create_key() -> bytes:
    """Load existing encryption key or create a new one."""
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            return f.read().strip()
    else:
        key = Fernet.generate_key()
        with open(KEY_FILE, "wb") as f:
            f.write(key)
        # Restrict permissions on key file
        os.chmod(KEY_FILE, 0o600)
        return key


_fernet: Fernet | None = None


def get_fernet() -> Fernet:
    """Get or initialize the Fernet instance."""
    global _fernet
    if _fernet is None:
        key = _load_or_create_key()
        _fernet = Fernet(key)
    return _fernet


def encrypt_password(plaintext: str) -> str:
    """Encrypt a plaintext password and return base64-encoded ciphertext."""
    f = get_fernet()
    return f.encrypt(plaintext.encode()).decode()


def decrypt_password(ciphertext: str) -> str:
    """Decrypt a ciphertext password back to plaintext."""
    f = get_fernet()
    return f.decrypt(ciphertext.encode()).decode()
