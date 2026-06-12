"""2FA management routes — setup panel (inside account modal) + login verify."""
# reload-trigger: updated
import io
import pyotp
import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.api.rate_limit import check_rate_limit, record_failure, record_success
from app.api.recovery_db import (
    count_unused_recovery_codes,
    generate_recovery_codes,
    verify_and_consume_recovery_code,
)
from app.api.totp_db import (
    disable_totp,
    enable_totp,
    get_totp_status,
    make_totp_uri,
    save_pending_secret,
    verify_totp_code,
)
from security import make_expires_at
from templates_env import templates


def _promote_pending_session(request: Request, user_id: int) -> None:
    """Promote a verified pending-2FA session to a full logged-in session."""
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

router = APIRouter()

# ── helpers ───────────────────────────────────────────────────────────────────

def _make_qr_svg(uri: str) -> str:
    """Render a TOTP URI as an inline SVG string (no Pillow required)."""
    factory = qrcode.image.svg.SvgPathImage
    img = qrcode.make(uri, image_factory=factory, box_size=6, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode()


async def _render_panel(request: Request, *, msg: str = "", error: str = "") -> HTMLResponse:
    """Build the 2FA settings partial, generating a QR when needed."""
    user_id  = request.session["user_id"]
    username = request.session["username"]
    status   = await get_totp_status(user_id)

    qr_svg = ""
    secret = None

    if not status["totp_enabled"]:
        # Reuse the pending secret stored in DB; generate one if none exists yet.
        secret = status["totp_secret"] or pyotp.random_base32()
        if not status["totp_secret"]:
            await save_pending_secret(user_id, secret)
        uri    = make_totp_uri(secret, username)
        qr_svg = _make_qr_svg(uri)

    return templates.TemplateResponse(
        request,
        "partials/2fa_panel.html",
        {
            "totp_enabled": status["totp_enabled"],
            "qr_svg":       qr_svg,
            "secret":       secret,
            "msg":          msg,
            "error":        error,
        },
    )


# ── account modal panel ────────────────────────────────────────────────────────

@router.get("/account/2fa", response_class=HTMLResponse)
async def totp_panel(request: Request):
    """HTMX: render the 2FA section inside the account modal."""
    if request.session.get("is_demo"):
        return HTMLResponse(
            '<div id="2fa-panel" class="flex items-start gap-3 p-3 rounded-xl'
            ' bg-amber-50 dark:bg-amber-900/20 border border-amber-200'
            ' dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">'
            '<span class="text-base flex-shrink-0">\U0001f3ae</span>'
            '<span>2FA is disabled in demo mode.'
            ' <a href="/register" class="underline font-medium">Create a free account</a>'
            ' to enable it.</span></div>'
        )
    return await _render_panel(request)


@router.post("/account/2fa/enable", response_class=HTMLResponse)
async def totp_enable(request: Request, code: str = Form(...)):
    """Verify the first TOTP code and activate 2FA for the user."""
    if request.session.get("is_demo"):
        return HTMLResponse("Not available in demo mode.", status_code=403)
    user_id = request.session["user_id"]
    status  = await get_totp_status(user_id)

    if status["totp_enabled"]:
        return await _render_panel(request, msg="2FA is already active.")

    secret = status["totp_secret"]
    if not secret:
        return await _render_panel(request, error="No setup in progress. Refresh and try again.")

    if not verify_totp_code(secret, code):
        return await _render_panel(request, error="Code incorrect or expired — try again.")

    await enable_totp(user_id)
    return await _render_panel(request, msg="✅ Two-factor authentication is now active!")


@router.post("/account/2fa/disable", response_class=HTMLResponse)
async def totp_disable(request: Request, code: str = Form(...)):
    """Require a valid TOTP code before disabling 2FA."""
    if request.session.get("is_demo"):
        return HTMLResponse("Not available in demo mode.", status_code=403)
    user_id = request.session["user_id"]
    status  = await get_totp_status(user_id)

    if not status["totp_enabled"]:
        return await _render_panel(request, msg="2FA is already off.")

    if not verify_totp_code(status["totp_secret"], code):
        return await _render_panel(request, error="Code incorrect — 2FA is still active.")

    await disable_totp(user_id)
    return await _render_panel(request, msg="2FA has been disabled.")


# ── login step-2 verify ────────────────────────────────────────────────────────

@router.get("/2fa/verify", response_class=HTMLResponse)
async def verify_page(request: Request):
    """Show the identity-verify prompt after a successful password login."""
    if not request.session.get("pending_2fa_user_id"):
        return RedirectResponse("/login", status_code=302)
    return templates.TemplateResponse(request, "2fa_verify.html", {
        "has_webauthn": request.session.get("pending_2fa_has_webauthn", False),
        "totp_enabled": request.session.get("pending_2fa_totp", True),
    })


@router.post("/2fa/verify", response_class=HTMLResponse)
async def verify_submit(request: Request, code: str = Form(...)):
    """Check the TOTP code and promote the pending session to a full session."""
    user_id = request.session.get("pending_2fa_user_id")
    if not user_id:
        return RedirectResponse("/login", status_code=302)

    rl_key = f"{request.client.host}:2fa"
    check_rate_limit(rl_key)

    status = await get_totp_status(user_id)
    if not status["totp_secret"] or not verify_totp_code(status["totp_secret"], code):
        record_failure(rl_key)
        return templates.TemplateResponse(
            request,
            "2fa_verify.html",
            {
                "error": "Incorrect code — check your authenticator app and try again.",
                "has_webauthn": request.session.get("pending_2fa_has_webauthn", False),
                "totp_enabled": request.session.get("pending_2fa_totp", True),
            },
            status_code=401,
        )
    record_success(rl_key)
    _promote_pending_session(request, user_id)
    return RedirectResponse("/", status_code=302)


@router.post("/2fa/recovery", response_class=HTMLResponse)
async def recovery_submit(request: Request, code: str = Form(...)):
    """Consume a one-time recovery code to finish a pending-2FA login.

    Always available on the verify page, so a device without the passkey /
    authenticator can still get in using a saved backup code.
    """
    user_id = request.session.get("pending_2fa_user_id")
    if not user_id:
        return RedirectResponse("/login", status_code=302)

    rl_key = f"{request.client.host}:2fa"
    check_rate_limit(rl_key)

    if not await verify_and_consume_recovery_code(user_id, code):
        record_failure(rl_key)
        return templates.TemplateResponse(
            request,
            "2fa_verify.html",
            {
                "recovery_error": "Invalid or already-used backup code.",
                "has_webauthn": request.session.get("pending_2fa_has_webauthn", False),
                "totp_enabled": request.session.get("pending_2fa_totp", False),
            },
            status_code=401,
        )
    record_success(rl_key)
    _promote_pending_session(request, user_id)
    return RedirectResponse("/", status_code=302)


@router.post("/account/2fa/recovery-codes", response_class=JSONResponse)
async def regenerate_recovery_codes(request: Request):
    """Generate a fresh set of one-time recovery codes (shown once). Requires a
    fully authenticated session; replaces any previous codes."""
    user_id = request.session.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated."}, status_code=401)
    codes = await generate_recovery_codes(user_id)
    return JSONResponse({"codes": codes, "count": len(codes)})


@router.get("/account/2fa/recovery-codes/count", response_class=JSONResponse)
async def recovery_codes_count(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated."}, status_code=401)
    return JSONResponse({"count": await count_unused_recovery_codes(user_id)})
