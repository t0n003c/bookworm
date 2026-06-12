"""core.config — single source of truth for all BW_* configuration.

Before this module, configuration was read with `os.getenv("BW_…", default)`
inline in 18+ files, with the defaults and parsing duplicated and occasionally
inconsistent (e.g. BW_DATA_DIR built three times, BW_MAX_UPLOAD_MB three times,
bool parsing written several ways). That is a maintainability and correctness
hazard: a default change has to be found and edited in every copy.

`Settings` centralises every BW_* value, parsed once, with the types the rest of
the app expects. Each field reproduces the EXACT default + parsing of the call
site(s) it replaces, so swapping a call site to `settings.<field>` is a no-op at
runtime (verified during the refactor). New code should read config ONLY from
here; legacy call sites are migrated incrementally (see ARCHITECTURE.md).

Note on secrets: the app-secret resolution (`BW_SECRET_KEY or load_secret_key()`)
deliberately lives in `security.py`, not here — it involves file I/O + Fernet and
two call sites parse the empty-string case differently. `secret_key_env` exposes
the raw override for callers that want it, without changing that logic.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _bool(name: str, default: str = "false") -> bool:
    """Parse a BW_* boolean the way the codebase always has: '<value>' == 'true'
    (case-insensitive). Matches `os.getenv(name, default).lower() == "true"`."""
    return os.getenv(name, default).lower() == "true"


@dataclass(frozen=True)
class Settings:
    """Immutable, parsed view of the BW_* environment. Build via `get_settings()`
    (cached) or use the module-level `settings` singleton."""

    # ── Storage ────────────────────────────────────────────────────────────
    # Where bookworm.db, uploads and bookworm.secret live.
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("BW_DATA_DIR", ".")))

    # ── Secret / session ───────────────────────────────────────────────────
    # Raw override only — full resolution (with load_secret_key fallback) stays
    # in security.py because two call sites differ on the empty-string case.
    secret_key_env: str | None = field(default_factory=lambda: os.getenv("BW_SECRET_KEY"))
    https: bool = field(default_factory=lambda: _bool("BW_HTTPS"))
    trust_proxy: bool = field(default_factory=lambda: _bool("BW_TRUST_PROXY"))

    # ── Accounts ───────────────────────────────────────────────────────────
    allow_registration: bool = field(default_factory=lambda: _bool("BW_ALLOW_REGISTRATION", "true"))
    demo_enabled: bool = field(default_factory=lambda: _bool("BW_DEMO_ENABLED", "true"))

    # ── Uploads ────────────────────────────────────────────────────────────
    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("BW_MAX_UPLOAD_MB", "200")))

    # ── Outbound networking ────────────────────────────────────────────────
    http_proxy: str | None = field(default_factory=lambda: os.getenv("BW_HTTP_PROXY") or None)

    # ── Web Push (VAPID) ───────────────────────────────────────────────────
    vapid_private_key: str = field(default_factory=lambda: os.getenv("BW_VAPID_PRIVATE_KEY", ""))
    vapid_public_key: str = field(default_factory=lambda: os.getenv("BW_VAPID_PUBLIC_KEY", ""))
    vapid_subject: str = field(default_factory=lambda: os.getenv("BW_VAPID_SUBJECT", "mailto:admin@localhost"))

    # ── Collabora / WOPI ───────────────────────────────────────────────────
    # main.py strips whitespace before trimming the slash; the two router call
    # sites only trim the slash. Expose both so a migration is byte-identical.
    collabora_url: str = field(default_factory=lambda: os.getenv("BW_COLLABORA_URL", "").strip().rstrip("/"))
    collabora_url_raw_trimmed: str = field(default_factory=lambda: os.getenv("BW_COLLABORA_URL", "").rstrip("/"))
    wopi_base_url: str = field(default_factory=lambda: os.getenv("BW_WOPI_BASE_URL", "").rstrip("/"))
    wopi_token_expiry: int = field(default_factory=lambda: int(os.getenv("BW_WOPI_TOKEN_EXPIRY", "3600")))

    # ── WebAuthn ───────────────────────────────────────────────────────────
    webauthn_rp_id: str = field(default_factory=lambda: os.getenv("BW_WEBAUTHN_RP_ID", "").strip())
    webauthn_origin: str = field(default_factory=lambda: os.getenv("BW_WEBAUTHN_ORIGIN", "").strip())

    # ── Login rate limiting ────────────────────────────────────────────────
    rl_window_secs: float = field(default_factory=lambda: float(os.getenv("BW_RL_WINDOW_SECS", "600")))
    rl_max_failures: int = field(default_factory=lambda: int(os.getenv("BW_RL_MAX_FAILURES", "5")))
    rl_lockout_secs: float = field(default_factory=lambda: float(os.getenv("BW_RL_LOCKOUT_SECS", "900")))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide Settings (parsed once)."""
    return Settings()


# Convenience singleton — config is read at import time today, so eager is fine.
settings = get_settings()
