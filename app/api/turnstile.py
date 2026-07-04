"""Cloudflare Turnstile — bot challenge for public auth-adjacent forms.

BookWorm stores the live Turnstile settings in site_settings so a superadmin can
adjust protection without editing deployment files. The older
BW_TURNSTILE_SITE_KEY / BW_TURNSTILE_SECRET_KEY env vars remain as a fallback
for existing installs.

Token field: Cloudflare injects a hidden <input name="cf-turnstile-response">
into the form, which auth.py reads via Form(alias="cf-turnstile-response").
"""
from __future__ import annotations

import logging

import httpx

from app.api.auth_db import get_site_setting
from core.config import settings
from security import decrypt_secret

log = logging.getLogger(__name__)

_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
_LOCATIONS = ("login", "register", "demo")


def _truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _stored_secret_plain(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if value.startswith("gAAAAA"):
        return decrypt_secret(value)
    return value


async def get_turnstile_config() -> dict[str, object]:
    """Return the live Turnstile settings with env-key fallback."""
    site_key = (await get_site_setting("turnstile_site_key", "")).strip()
    secret_key = _stored_secret_plain(await get_site_setting("turnstile_secret_key", ""))
    if not site_key:
        site_key = settings.turnstile_site_key
    if not secret_key:
        secret_key = settings.turnstile_secret_key

    legacy_enabled = "true" if settings.turnstile_site_key and settings.turnstile_secret_key else "false"
    enabled = _truthy(await get_site_setting("turnstile_enabled", legacy_enabled))
    locations = {
        name: _truthy(await get_site_setting(f"turnstile_{name}_enabled", "true" if name in {"login", "register"} else "false"))
        for name in _LOCATIONS
    }
    return {
        "enabled": enabled,
        "site_key": site_key,
        "secret_key": secret_key,
        "locations": locations,
        "configured": bool(site_key and secret_key),
    }


async def turnstile_enabled(location: str = "login") -> bool:
    """True only when Turnstile is enabled, configured, and active here."""
    cfg = await get_turnstile_config()
    locations = cfg["locations"]
    return bool(
        cfg["enabled"]
        and cfg["configured"]
        and isinstance(locations, dict)
        and locations.get(location, False)
    )


async def turnstile_site_key_for(location: str) -> str:
    """Public site key to render for a location, or empty string."""
    if not await turnstile_enabled(location):
        return ""
    cfg = await get_turnstile_config()
    return str(cfg["site_key"] or "")


async def verify_turnstile(
    token: str,
    remoteip: str | None = None,
    location: str = "login",
) -> bool:
    """Validate a Turnstile token with Cloudflare.

    Fail policy:
      • Feature disabled here       → True  (never blocks)
      • Enabled but missing keys    → False (misconfiguration; fail closed)
      • Missing / empty token       → False (bot, or the widget didn't load)
      • Cloudflare says not success → False
      • Network error to Cloudflare → True  (fail OPEN: a Turnstile outage must
        not lock the team out — password, rate-limiting and 2FA still gate the
        login). The event is logged.
    """
    cfg = await get_turnstile_config()
    locations = cfg["locations"]
    active = bool(
        cfg["enabled"]
        and isinstance(locations, dict)
        and locations.get(location, False)
    )
    if not active:
        return True
    if not cfg["site_key"] or not cfg["secret_key"]:
        log.warning("Turnstile enabled for %s but keys are missing", location)
        return False
    if not token:
        return False
    data = {"secret": str(cfg["secret_key"]), "response": token}
    if remoteip:
        data["remoteip"] = remoteip
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(_VERIFY_URL, data=data)
            result = resp.json()
        if not result.get("success"):
            log.info("Turnstile challenge failed: %s", result.get("error-codes"))
            return False
        return True
    except Exception:
        log.warning("Turnstile siteverify unreachable — failing open", exc_info=True)
        return True
