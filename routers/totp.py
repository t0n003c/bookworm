"""2FA management routes — setup panel (inside account modal) + login verify."""
# reload-trigger: updated
import io
import pyotp
import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from routers.totp_db import (
    disable_totp,
    enable_totp,
    get_totp_status,
    make_totp_uri,
    save_pending_secret,
    verify_totp_code,
)
from security import make_expires_at
from templates_env import templates

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
    """Show the 6-digit code prompt after a successful password login."""
    if not request.session.get("pending_2fa_user_id"):
        return RedirectResponse("/login", status_code=302)
    return templates.TemplateResponse(request, "2fa_verify.html", {})


@router.post("/2fa/verify", response_class=HTMLResponse)
async def verify_submit(request: Request, code: str = Form(...)):
    """Check the TOTP code and promote the pending session to a full session."""
    user_id = request.session.get("pending_2fa_user_id")
    if not user_id:
        return RedirectResponse("/login", status_code=302)

    status = await get_totp_status(user_id)
    if not status["totp_secret"] or not verify_totp_code(status["totp_secret"], code):
        return templates.TemplateResponse(
            request,
            "2fa_verify.html",
            {"error": "Incorrect code — check your authenticator app and try again."},
            status_code=401,
        )

    # Promote pending → full session
    permanent = request.session.pop("pending_2fa_permanent", False)
    request.session["user_id"]  = user_id
    request.session["username"] = request.session.pop("pending_2fa_username")
    request.session["role"]     = request.session.pop("pending_2fa_role")
    request.session.pop("pending_2fa_user_id", None)

    expires_at = make_expires_at(permanent)
    if expires_at:
        request.session["expires_at"] = expires_at
    else:
        request.session.pop("expires_at", None)

    return RedirectResponse("/", status_code=302)
