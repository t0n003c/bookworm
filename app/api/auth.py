"""Login / logout / first-run setup / self-service registration routes."""
import os

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app.api.auth_db import authenticate, create_user, user_count, get_user_by_username, get_registration_open
from app.api.totp_db import get_totp_status
from app.api.webauthn_db import has_credentials
from app.api.seed_uploads import seed_flower_uploads
from app.api.rate_limit import check_rate_limit, record_failure, record_success, client_ip
from app.api.turnstile import turnstile_site_key_for, verify_turnstile
from database import get_db
from security import make_expires_at
from templates_env import templates

router = APIRouter()


# ── Setup (first-run account creation) ───────────────────────

@router.get("/setup", response_class=HTMLResponse)
async def setup_page(request: Request):
    """Show the account-creation form only when no user exists yet."""
    if await user_count() > 0:
        return RedirectResponse("/login", status_code=302)
    return templates.TemplateResponse(request, "setup.html", {})


@router.post("/setup", response_class=HTMLResponse)
async def setup_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    confirm:  str = Form(...),
):
    if await user_count() > 0:
        return RedirectResponse("/login", status_code=302)
    error = None
    username = username.strip()
    if not username:
        error = "Username cannot be empty."
    elif len(password) < 6:
        error = "Password must be at least 6 characters."
    elif password != confirm:
        error = "Passwords do not match."
    if error:
        return templates.TemplateResponse(
            request, "setup.html", {"error": error, "username": username},
            status_code=400,
        )
    user_id = await create_user(username, password, role="superadmin")
    await seed_flower_uploads(user_id)
    # Backfill any workspaces that existed before the first user was created
    async with get_db() as db:
        await db.execute(
            "UPDATE workspaces SET user_id = ? WHERE user_id IS NULL", (user_id,)
        )
        await db.commit()
    return RedirectResponse("/login?created=1", status_code=302)


# ── Login ─────────────────────────────────────────────────────

@router.get("/login", response_class=HTMLResponse)
async def login_page(
    request: Request,
    created: int = 0,
    registered: int = 0,
    turnstile: int = 0,
):
    """Show login form; redirect to /setup if no account exists yet."""
    if await user_count() == 0:
        return RedirectResponse("/setup", status_code=302)
    ctx = {
        "created":           bool(created),
        "registered":        bool(registered),
        "demo_enabled":      os.getenv("BW_DEMO_ENABLED", "true").lower() == "true",
        "registration_open": await get_registration_open(),
        "turnstile_login_site_key": await turnstile_site_key_for("login"),
        "turnstile_demo_site_key": await turnstile_site_key_for("demo"),
        "error": "Please complete the verification challenge and try again." if turnstile else "",
    }
    return templates.TemplateResponse(request, "login.html", ctx)


@router.post("/login", response_class=HTMLResponse)
async def login_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    stay_signed_in: str = Form(default=""),
    turnstile_token: str = Form(default="", alias="cf-turnstile-response"),
):
    rl_key = f"{client_ip(request)}:login"
    check_rate_limit(rl_key)

    # Cloudflare Turnstile bot challenge (no-op unless configured). Checked
    # before credentials so bots are stopped without touching the auth path.
    if not await verify_turnstile(turnstile_token, client_ip(request), "login"):
        return templates.TemplateResponse(
            request,
            "login.html",
            {"error": "Please complete the verification challenge and try again.",
             "username": username,
             "registration_open": await get_registration_open(),
             "demo_enabled": os.getenv("BW_DEMO_ENABLED", "true").lower() == "true",
             "turnstile_login_site_key": await turnstile_site_key_for("login"),
             "turnstile_demo_site_key": await turnstile_site_key_for("demo")},
            status_code=400,
        )

    user = await authenticate(username.strip(), password)
    if not user:
        record_failure(rl_key)
        return templates.TemplateResponse(
            request,
            "login.html",
            {"error": "Invalid username or password.",
             "username": username,
             "registration_open": await get_registration_open(),
             "demo_enabled": os.getenv("BW_DEMO_ENABLED", "true").lower() == "true",
             "turnstile_login_site_key": await turnstile_site_key_for("login"),
             "turnstile_demo_site_key": await turnstile_site_key_for("demo")},
            status_code=401,
        )
    record_success(rl_key)
    permanent = stay_signed_in == "on"

    # Second factor after a PASSWORD login:
    #   • biometric (passkey) enrolled → biometric is the 2nd factor (shown first)
    #   • TOTP enrolled                → TOTP (the fallback when both are on; the
    #                                    sole 2nd factor when biometric is off)
    #   • neither                      → straight in
    # A device WITHOUT the passkey is never locked out: the /2fa/verify page always
    # offers a one-time recovery code (and the TOTP code, when TOTP is also on).
    totp = await get_totp_status(user["id"])
    has_webauthn = await has_credentials(user["id"])
    totp_enabled = bool(totp["totp_enabled"])
    if has_webauthn or totp_enabled:
        request.session["pending_2fa_user_id"]      = user["id"]
        request.session["pending_2fa_username"]      = user["username"]
        request.session["pending_2fa_role"]          = user["role"]
        request.session["pending_2fa_permanent"]     = permanent
        request.session["pending_2fa_has_webauthn"]  = has_webauthn
        request.session["pending_2fa_totp"]          = totp_enabled
        return RedirectResponse("/2fa/verify", status_code=302)

    request.session["user_id"]  = user["id"]
    request.session["username"] = user["username"]
    request.session["role"]     = user["role"]
    expires_at = make_expires_at(permanent)
    if expires_at:
        request.session["expires_at"] = expires_at
    else:
        request.session.pop("expires_at", None)
    return RedirectResponse("/", status_code=302)


# ── Logout ────────────────────────────────────────────

@router.post("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=302)


# ── Self-service registration ────────────────────────────
# Toggle via superadmin account panel; seeds from BW_ALLOW_REGISTRATION on first boot.


@router.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    """Show the self-service sign-up form."""
    if not await get_registration_open():
        return RedirectResponse("/login", status_code=302)
    return templates.TemplateResponse(
        request,
        "register.html",
        {"turnstile_register_site_key": await turnstile_site_key_for("register")},
    )


@router.post("/register", response_class=HTMLResponse)
async def register_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    confirm:  str = Form(...),
    turnstile_token: str = Form(default="", alias="cf-turnstile-response"),
):
    if not await get_registration_open():
        return RedirectResponse("/login", status_code=302)
    # Cloudflare Turnstile bot challenge (no-op unless configured).
    if not await verify_turnstile(turnstile_token, client_ip(request), "register"):
        return templates.TemplateResponse(
            request, "register.html",
            {"error": "Please complete the verification challenge and try again.",
             "username": username,
             "turnstile_register_site_key": await turnstile_site_key_for("register")},
            status_code=400,
        )
    error = None
    username = username.strip()
    if not username:
        error = "Username cannot be empty."
    elif len(password) < 6:
        error = "Password must be at least 6 characters."
    elif password != confirm:
        error = "Passwords do not match."
    else:
        existing = await get_user_by_username(username)
        if existing:
            error = "That username is already taken. Please choose another."
    if error:
        return templates.TemplateResponse(
            request, "register.html",
            {"error": error, "username": username,
             "turnstile_register_site_key": await turnstile_site_key_for("register")},
            status_code=400,
        )
    user_id = await create_user(username, password, role="user")
    await seed_flower_uploads(user_id)
    return RedirectResponse("/login?registered=1", status_code=302)
