"""Security helpers — persisted secret key, session expiry, and Fernet encryption."""
import base64
import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger(__name__)

_DATA_DIR = Path(os.getenv("BW_DATA_DIR", "."))
_KEY_FILE  = _DATA_DIR / "bookworm.secret"

# Session lifetime choices
_SESSION_SHORT_HOURS = 8    # when "stay signed in" is NOT checked
_SESSION_LONG_DAYS   = 30   # when "stay signed in" IS checked (matches cookie max_age)


def load_secret_key() -> str:
    """Return the app secret key, persisting it to disk on first run.

    Using a stable key means server restarts no longer invalidate sessions.
    """
    if _KEY_FILE.exists():
        key = _KEY_FILE.read_text().strip()
        if key:
            return key
    # First run — generate and persist
    key = secrets.token_hex(32)
    _KEY_FILE.write_text(key)
    return key


# ── Fernet encryption (LLM API keys at rest) ──────────────────────────────────
# Fernet requires a 32-byte URL-safe base64 key.
# We derive one deterministically from the app secret so no extra env var
# is needed.  If BW_SECRET_KEY changes, stored keys become unreadable and
# users must re-enter them — the same disruptive consequence as rotating the
# session secret, which is already documented.

_fernet_cache: "_Fernet | None" = None  # noqa: F821 — quoted to avoid import at module top


def get_fernet():
    """Return a cached Fernet instance derived from the app secret key.

    Import is lazy so the cryptography package is only loaded when first needed.
    """
    global _fernet_cache
    if _fernet_cache is not None:
        return _fernet_cache
    from cryptography.fernet import Fernet
    raw = (os.getenv("BW_SECRET_KEY") or load_secret_key()).encode()
    # SHA-256 → 32 bytes → URL-safe base64 = valid Fernet key
    fernet_key    = base64.urlsafe_b64encode(hashlib.sha256(raw).digest())
    _fernet_cache = Fernet(fernet_key)
    return _fernet_cache


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a secret string and return a Fernet token (str).

    Empty input returns empty string unchanged.
    """
    if not plaintext:
        return ""
    return get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str:
    """Decrypt a Fernet token back to plaintext.

    Returns empty string and logs a warning on failure (e.g. key mismatch).
    Empty input returns empty string unchanged.
    """
    if not token:
        return ""
    try:
        return get_fernet().decrypt(token.encode()).decode()
    except Exception:
        log.warning(
            "security: failed to decrypt stored LLM API key — "
            "BW_SECRET_KEY may have changed. User must re-enter their key."
        )
        return ""


def make_expires_at(permanent: bool) -> str | None:
    """Return an ISO-8601 UTC expiry string for the session, or None if permanent.

    Permanent sessions expire in 30 days (matches the cookie max_age).
    Non-permanent sessions expire in 8 hours.
    """
    if permanent:
        return None  # no in-session expiry; cookie TTL governs
    expiry = datetime.now(timezone.utc) + timedelta(hours=_SESSION_SHORT_HOURS)
    return expiry.isoformat()


def session_is_expired(session: dict) -> bool:
    """Return True when a non-permanent session has passed its expiry time."""
    expires_at = session.get("expires_at")
    if not expires_at:
        return False  # permanent — never expires early
    try:
        expiry = datetime.fromisoformat(expires_at)
        return datetime.now(timezone.utc) > expiry
    except (ValueError, TypeError):
        return True  # malformed timestamp — treat as expired
