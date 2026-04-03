"""Account management — change username / change password."""
from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse

from routers.auth_db import (
    authenticate, get_user_by_username,
    update_username, update_password,
)

router = APIRouter(prefix="/account")

_OK  = "<span class='text-green-600 text-xs font-medium'>{}</span>"
_ERR = "<span class='text-red-600  text-xs font-medium'>{}</span>"


@router.post("/change-username", response_class=HTMLResponse)
async def change_username(
    request: Request,
    current_password: str = Form(...),
    new_username:     str = Form(...),
):
    uid      = request.session.get("user_id")
    cur_user = request.session.get("username", "")
    new_username = new_username.strip()

    # Verify current password
    user = await authenticate(cur_user, current_password)
    if not user:
        return HTMLResponse(_ERR.format("Current password is incorrect."))
    if not new_username:
        return HTMLResponse(_ERR.format("Username cannot be empty."))
    # Check for collision
    existing = await get_user_by_username(new_username)
    if existing and existing["id"] != uid:
        return HTMLResponse(_ERR.format("That username is already taken."))

    await update_username(uid, new_username)
    request.session["username"] = new_username
    return HTMLResponse(_OK.format(f'Username updated to "{new_username}".'  ))


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