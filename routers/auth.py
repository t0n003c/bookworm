"""Login / logout / first-run setup routes."""
from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from routers.auth_db import authenticate, create_user, user_count
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
    await create_user(username, password)
    return RedirectResponse("/login?created=1", status_code=302)


# ── Login ─────────────────────────────────────────────────────

@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, created: int = 0):
    """Show login form; redirect to /setup if no account exists yet."""
    if await user_count() == 0:
        return RedirectResponse("/setup", status_code=302)
    ctx = {"created": bool(created)}
    return templates.TemplateResponse(request, "login.html", ctx)


@router.post("/login", response_class=HTMLResponse)
async def login_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
):
    user = await authenticate(username.strip(), password)
    if not user:
        return templates.TemplateResponse(
            request,
            "login.html",
            {"error": "Invalid username or password.", "username": username},
            status_code=401,
        )
    request.session["user_id"]  = user["id"]
    request.session["username"] = user["username"]
    return RedirectResponse("/", status_code=302)


# ── Logout ────────────────────────────────────────────────────

@router.post("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=302)