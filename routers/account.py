"""Account management — change credentials + superadmin user management."""
from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse

from routers.auth_db import (
    authenticate,
    create_user,
    delete_user,
    get_all_users,
    get_user_by_username,
    update_username,
    update_password,
)
from templates_env import templates

router = APIRouter(prefix="/account")

_OK  = "<span class='text-green-600 text-xs font-medium'>{}</span>"
_ERR = "<span class='text-red-600  text-xs font-medium'>{}</span>"


def _is_superadmin(request: Request) -> bool:
    return request.session.get("role") == "superadmin"


# ── change username ───────────────────────────────────────────

@router.post("/change-username", response_class=HTMLResponse)
async def change_username(
    request: Request,
    current_password: str = Form(...),
    new_username:     str = Form(...),
):
    uid      = request.session.get("user_id")
    cur_user = request.session.get("username", "")
    new_username = new_username.strip()

    user = await authenticate(cur_user, current_password)
    if not user:
        return HTMLResponse(_ERR.format("Current password is incorrect."))
    if not new_username:
        return HTMLResponse(_ERR.format("Username cannot be empty."))
    existing = await get_user_by_username(new_username)
    if existing and existing["id"] != uid:
        return HTMLResponse(_ERR.format("That username is already taken."))

    await update_username(uid, new_username)
    request.session["username"] = new_username
    return HTMLResponse(_OK.format(f'Username updated to "{new_username}".'))


# ── change password ───────────────────────────────────────────

@router.post("/change-password", response_class=HTMLResponse)
async def change_password(
    request: Request,
    current_password: str = Form(...),
    new_password:     str = Form(...),
    confirm_password: str = Form(...),
):
    cur_user = request.session.get("username", "")

    user = await authenticate(cur_user, current_password)
    if not user:
        return HTMLResponse(_ERR.format("Current password is incorrect."))
    if len(new_password) < 6:
        return HTMLResponse(_ERR.format("New password must be at least 6 characters."))
    if new_password != confirm_password:
        return HTMLResponse(_ERR.format("New passwords do not match."))

    await update_password(user["id"], new_password)
    return HTMLResponse(_OK.format("Password updated successfully."))


# ── admin: list users (HTMX partial) ─────────────────────────

@router.get("/users", response_class=HTMLResponse)
async def list_users(request: Request):
    """Return the admin user-list partial (superadmin only)."""
    if not _is_superadmin(request):
        return HTMLResponse("", status_code=403)
    users = await get_all_users()
    me    = request.session.get("user_id")
    return templates.TemplateResponse(
        request, "partials/admin_users.html", {"users": users, "me": me}
    )


# ── admin: create user ────────────────────────────────────────

@router.post("/users/create", response_class=HTMLResponse)
async def create_user_handler(
    request: Request,
    new_username: str = Form(...),
    new_password: str = Form(...),
    confirm:      str = Form(...),
):
    if not _is_superadmin(request):
        return HTMLResponse(_ERR.format("Forbidden."), status_code=403)

    new_username = new_username.strip()
    if not new_username:
        return HTMLResponse(_ERR.format("Username cannot be empty."))
    if len(new_password) < 6:
        return HTMLResponse(_ERR.format("Password must be at least 6 characters."))
    if new_password != confirm:
        return HTMLResponse(_ERR.format("Passwords do not match."))
    existing = await get_user_by_username(new_username)
    if existing:
        return HTMLResponse(_ERR.format("Username already taken."))

    await create_user(new_username, new_password, role="user")
    # Re-render the full user list so HTMX swaps it in
    users = await get_all_users()
    me    = request.session.get("user_id")
    return templates.TemplateResponse(
        request,
        "partials/admin_users.html",
        {"users": users, "me": me, "success": f'User "{new_username}" created.'},
    )


# ── admin: delete user ────────────────────────────────────

@router.post("/users/{target_id}/delete", response_class=HTMLResponse)
async def delete_user_handler(request: Request, target_id: int):
    if not _is_superadmin(request):
        return HTMLResponse(_ERR.format("Forbidden."), status_code=403)
    me = request.session.get("user_id")
    if target_id == me:
        return HTMLResponse(_ERR.format("You cannot delete your own account."))

    target = await get_all_users()
    target_user = next((u for u in target if u["id"] == target_id), None)
    if not target_user:
        return HTMLResponse(_ERR.format("User not found."))
    if target_user["role"] == "superadmin":
        return HTMLResponse(_ERR.format("Cannot delete another superadmin."))

    await delete_user(target_id)
    users = await get_all_users()
    return templates.TemplateResponse(
        request,
        "partials/admin_users.html",
        {"users": users, "me": me, "success": "User deleted."},
    )


# ── admin: reset another user’s password ────────────────────────

@router.post("/users/{target_id}/reset-password", response_class=HTMLResponse)
async def reset_user_password(
    request: Request,
    target_id: int,
    new_password: str = Form(...),
    confirm_password: str = Form(...),
):
    if not _is_superadmin(request):
        return HTMLResponse(_ERR.format("Forbidden."), status_code=403)

    all_users = await get_all_users()
    target_user = next((u for u in all_users if u["id"] == target_id), None)
    if not target_user:
        return HTMLResponse(_ERR.format("User not found."))
    if target_user["role"] == "superadmin" and target_user["id"] != request.session.get("user_id"):
        return HTMLResponse(_ERR.format("Cannot reset another superadmin\'s password."))
    if len(new_password) < 6:
        return HTMLResponse(_ERR.format("Password must be at least 6 characters."))
    if new_password != confirm_password:
        return HTMLResponse(_ERR.format("Passwords do not match."))

    await update_password(target_id, new_password)
    me = request.session.get("user_id")
    users = await get_all_users()
    tname = target_user["username"]
    return templates.TemplateResponse(
        request,
        "partials/admin_users.html",
        {"users": users, "me": me,
         "success": f'Password reset for "{tname}".'},
    )