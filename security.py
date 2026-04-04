"""Security helpers — persisted secret key + session expiry utilities."""
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

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
