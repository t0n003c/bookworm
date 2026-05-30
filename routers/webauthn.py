"""WebAuthn biometric sign-in — registration and authentication endpoints.

Design:
  - Registration endpoints (/account/webauthn/*) require a full session.
  - Authentication endpoints (/2fa/webauthn/*) work with a pending_2fa session
    (the user has passed the password step but not the 2FA step yet).
  - Both endpoint families are intentionally small: all crypto is delegated
    to the py-webauthn library (webauthn==2.7.1).

RP ID / Origin:
  - Set BW_WEBAUTHN_RP_ID and BW_WEBAUTHN_ORIGIN env vars in production.
  - In dev they are auto-derived from the incoming request (works for localhost).
"""
import base64
import json
import logging
import os

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse

import webauthn
from webauthn import base64url_to_bytes, options_to_json
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    RegistrationCredential,
    AuthenticationCredential,
    AuthenticatorAttestationResponse,
    AuthenticatorAssertionResponse,
    UserVerificationRequirement,
)

from routers.webauthn_db import (
    delete_credential,
    get_all_credential_ids,
    get_credential_by_id,
    get_credentials,
    has_credentials,
    save_credential,
    update_sign_count,
)
from templates_env import templates

log = logging.getLogger(__name__)
router = APIRouter()

# Log the effective WebAuthn config at import time so it's visible in server
# logs on startup — makes proxy/origin mismatches trivial to diagnose.
_startup_bw_https  = os.getenv("BW_HTTPS", "false")
_startup_wa_origin = os.getenv("BW_WEBAUTHN_ORIGIN", "(auto-detect)")
_startup_wa_rp_id  = os.getenv("BW_WEBAUTHN_RP_ID",  "(auto-detect)")
log.warning(
    "WebAuthn config — BW_HTTPS=%s  RP_ID=%s  ORIGIN=%s",
    _startup_bw_https, _startup_wa_rp_id, _startup_wa_origin,
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _rp_config(request: Request) -> tuple[str, str]:
    """Return (rp_id, origin) — explicit env vars win; otherwise auto-detect.

    Scheme priority (highest → lowest):
      1. BW_WEBAUTHN_ORIGIN env var  (full explicit override)
      2. BW_HTTPS=true env var       (set this when behind a TLS proxy)
      3. X-Forwarded-Proto header    (forwarded by the proxy)
      4. request.url.scheme          (works for plain localhost dev)
    """
    rp_id = os.getenv("BW_WEBAUTHN_RP_ID", "").strip()
    origin = os.getenv("BW_WEBAUTHN_ORIGIN", "").strip()
    if not rp_id:
        rp_id = request.url.hostname or "localhost"
    if not origin:
        if os.getenv("BW_HTTPS", "false").lower() == "true":
            scheme = "https"
        else:
            scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
        port = request.url.port
        if port and not (scheme == "http" and port == 80) and not (scheme == "https" and port == 443):
            origin = f"{scheme}://{rp_id}:{port}"
        else:
            origin = f"{scheme}://{rp_id}"
    log.debug("WebAuthn rp_id=%s origin=%s", rp_id, origin)
    return rp_id, origin


def _parse_reg_credential(data: dict) -> RegistrationCredential:
    resp = data["response"]
    return RegistrationCredential(
        id=data["id"],
        raw_id=base64url_to_bytes(data["rawId"]),
        response=AuthenticatorAttestationResponse(
            client_data_json=base64url_to_bytes(resp["clientDataJSON"]),
            attestation_object=base64url_to_bytes(resp["attestationObject"]),
        ),
        type=data.get("type", "public-key"),
    )


def _parse_auth_credential(data: dict) -> AuthenticationCredential:
    resp = data["response"]
    return AuthenticationCredential(
        id=data["id"],
        raw_id=base64url_to_bytes(data["rawId"]),
        response=AuthenticatorAssertionResponse(
            client_data_json=base64url_to_bytes(resp["clientDataJSON"]),
            authenticator_data=base64url_to_bytes(resp["authenticatorData"]),
            signature=base64url_to_bytes(resp["signature"]),
            user_handle=base64url_to_bytes(resp["userHandle"]) if resp.get("userHandle") else None,
        ),
        type=data.get("type", "public-key"),
    )


async def _render_panel(request: Request, *, msg: str = "", error: str = "") -> HTMLResponse:
    """Render the biometric settings partial."""
    user_id = request.session["user_id"]
    creds = await get_credentials(user_id)
    return templates.TemplateResponse(
        request,
        "partials/webauthn_panel.html",
        {"credentials": creds, "msg": msg, "error": error},
    )


# ── account settings — registration ──────────────────────────────────────────

@router.get("/account/webauthn/panel", response_class=HTMLResponse)
async def webauthn_panel(request: Request):
    """HTMX: render the biometric settings section."""
    if request.session.get("is_demo"):
        return HTMLResponse(
            '<div id="webauthn-panel" class="flex items-start gap-3 p-3 rounded-xl'
            ' bg-amber-50 dark:bg-amber-900/20 border border-amber-200'
            ' dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">'
            '<span class="text-base flex-shrink-0">🎮</span>'
            '<span>Biometric sign-in is disabled in demo mode.</span></div>'
        )
    return await _render_panel(request)


@router.post("/account/webauthn/register/begin")
async def register_begin(request: Request):
    """Step 1: generate and return PublicKeyCredentialCreationOptions."""
    if request.session.get("is_demo"):
        return JSONResponse({"error": "Not available in demo mode."}, status_code=403)

    user_id  = request.session["user_id"]
    username = request.session["username"]
    rp_id, _ = _rp_config(request)

    # Exclude credentials already registered on this account
    existing_ids = await get_all_credential_ids(user_id)
    exclude = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(cid))
        for cid in existing_ids
    ]

    options = webauthn.generate_registration_options(
        rp_id=rp_id,
        rp_name="BookWorm",
        user_id=str(user_id).encode(),
        user_name=username,
        user_display_name=username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=exclude,
    )

    # Store challenge (bytes → base64url) in session for step 2
    request.session["webauthn_reg_challenge"] = _b64url_encode(options.challenge)
    return JSONResponse(json.loads(options_to_json(options)))


@router.post("/account/webauthn/register/complete")
async def register_complete(request: Request):
    """Step 2: verify attestation and store the credential."""
    if request.session.get("is_demo"):
        return JSONResponse({"error": "Not available in demo mode."}, status_code=403)

    challenge_b64 = request.session.pop("webauthn_reg_challenge", None)
    if not challenge_b64:
        return JSONResponse({"error": "No registration in progress."}, status_code=400)

    user_id = request.session["user_id"]
    rp_id, origin = _rp_config(request)

    body = await request.json()
    device_name = body.pop("deviceName", "My Device") or "My Device"

    try:
        cred = _parse_reg_credential(body)
        verification = webauthn.verify_registration_response(
            credential=cred,
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=False,
        )
    except Exception as exc:
        log.warning("WebAuthn registration failed: %s", exc)
        return JSONResponse({"error": f"Verification failed: {exc}"}, status_code=400)

    await save_credential(
        user_id=user_id,
        credential_id=_b64url_encode(verification.credential_id),
        public_key=_b64url_encode(verification.credential_public_key),
        sign_count=verification.sign_count,
        device_name=device_name[:80],
    )
    return JSONResponse({"ok": True})


@router.delete("/account/webauthn/credentials/{cred_id}", response_class=HTMLResponse)
async def delete_cred(request: Request, cred_id: int):
    """Remove a registered device from this account."""
    if request.session.get("is_demo"):
        return await _render_panel(request, error="Not available in demo mode.")
    user_id = request.session["user_id"]
    removed = await delete_credential(cred_id, user_id)
    if not removed:
        return await _render_panel(request, error="Device not found.")
    return await _render_panel(request, msg="✅ Device removed.")


# ── login step-2 — authentication ─────────────────────────────────────────────

@router.post("/2fa/webauthn/begin")
async def auth_begin(request: Request):
    """Generate authentication options for a pending-2FA session."""
    user_id = request.session.get("pending_2fa_user_id")
    if not user_id:
        return JSONResponse({"error": "No pending session."}, status_code=400)

    rp_id, _ = _rp_config(request)
    cred_ids = await get_all_credential_ids(user_id)
    if not cred_ids:
        return JSONResponse({"error": "No credentials registered."}, status_code=404)

    allow = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(cid))
        for cid in cred_ids
    ]

    options = webauthn.generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=allow,
        user_verification=UserVerificationRequirement.PREFERRED,
    )

    request.session["webauthn_auth_challenge"] = _b64url_encode(options.challenge)
    return JSONResponse(json.loads(options_to_json(options)))


@router.post("/2fa/webauthn/complete")
async def auth_complete(request: Request):
    """Verify the assertion, promote pending session to full session."""
    from security import make_expires_at

    user_id = request.session.get("pending_2fa_user_id")
    if not user_id:
        return JSONResponse({"error": "No pending session."}, status_code=400)

    challenge_b64 = request.session.pop("webauthn_auth_challenge", None)
    if not challenge_b64:
        return JSONResponse({"error": "No auth challenge in session."}, status_code=400)

    rp_id, origin = _rp_config(request)
    body = await request.json()

    # Look up the stored credential by the ID the browser used
    cred_id_str = body.get("id", "")
    stored = await get_credential_by_id(cred_id_str)
    if not stored or stored["user_id"] != user_id:
        return JSONResponse({"error": "Credential not found or mismatch."}, status_code=400)

    try:
        cred = _parse_auth_credential(body)
        verification = webauthn.verify_authentication_response(
            credential=cred,
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=base64url_to_bytes(stored["public_key"]),
            credential_current_sign_count=stored["sign_count"],
            require_user_verification=False,
        )
    except Exception as exc:
        log.warning("WebAuthn auth failed for user %s: %s", user_id, exc)
        return JSONResponse({"error": f"Verification failed: {exc}"}, status_code=400)

    # Update sign_count (anti-replay)
    await update_sign_count(cred_id_str, verification.new_sign_count)

    # Promote pending → full session (mirrors totp.py verify_submit logic)
    permanent = request.session.pop("pending_2fa_permanent", False)
    request.session["user_id"]  = user_id
    request.session["username"] = request.session.pop("pending_2fa_username")
    request.session["role"]     = request.session.pop("pending_2fa_role")
    request.session.pop("pending_2fa_user_id", None)
    request.session.pop("pending_2fa_has_webauthn", None)
    request.session.pop("pending_2fa_totp", None)

    expires_at = make_expires_at(permanent)
    if expires_at:
        request.session["expires_at"] = expires_at
    else:
        request.session.pop("expires_at", None)

    return JSONResponse({"ok": True, "redirect": "/"})
