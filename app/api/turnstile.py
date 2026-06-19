"""Cloudflare Turnstile — bot challenge on login / registration.

Active only when BOTH BW_TURNSTILE_SITE_KEY and BW_TURNSTILE_SECRET_KEY are set.
The site key is embedded in the login/register pages (public); the secret key
verifies the returned token server-side. With either key unset the whole
feature is inert and login/register behave exactly as before.

Token field: Cloudflare injects a hidden <input name="cf-turnstile-response">
into the form, which auth.py reads via Form(alias="cf-turnstile-response").
"""
from __future__ import annotations

import logging

import httpx

from core.config import settings

log = logging.getLogger(__name__)

_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def turnstile_enabled() -> bool:
    """True only when both the site key and secret key are configured."""
    return bool(settings.turnstile_site_key and settings.turnstile_secret_key)


async def verify_turnstile(token: str, remoteip: str | None = None) -> bool:
    """Validate a Turnstile token with Cloudflare.

    Fail policy:
      • Feature disabled            → True  (never blocks)
      • Missing / empty token       → False (bot, or the widget didn't load)
      • Cloudflare says not success → False
      • Network error to Cloudflare → True  (fail OPEN: a Turnstile outage must
        not lock the team out — password, rate-limiting and 2FA still gate the
        login). The event is logged.
    """
    if not turnstile_enabled():
        return True
    if not token:
        return False
    data = {"secret": settings.turnstile_secret_key, "response": token}
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
