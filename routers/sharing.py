"""Sharing router — user-to-user copy + public link management + public views."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from templates_env import templates
from routers.sharing_db import (
    get_public_link,
    create_public_link,
    revoke_public_link,
    get_public_link_by_token,
    search_users_for_share,
    get_or_create_shared_inbox_workspace,
    get_or_create_shared_cards_database,
    copy_note_to_workspace,
    copy_workspace_tree_to_user,
    copy_db_workspace_to_user,
    copy_db_card_to_database,
    get_note_for_public_view,
    get_db_card_for_public_view,
    note_belongs_to_user,
    workspace_belongs_to_user,
    db_card_belongs_to_user,
    get_workspace_type,
)

router = APIRouter(prefix="/share", tags=["sharing"])


# ── Demo guard helper ────────────────────────────────────────────────────────

def _is_demo(request: Request) -> bool:
    return bool(request.session.get("is_demo"))


def _uid(request: Request) -> int:
    return request.session["user_id"]


def _base_url(request: Request) -> str:
    """Build the base URL (scheme + host) for constructing share link URLs."""
    return str(request.base_url).rstrip("/")


# ── User search ──────────────────────────────────────────────────────────────

@router.get("/users/search")
async def users_search(request: Request, q: str = ""):
    """Return up to 10 matching usernames (excluding self, demo accounts)."""
    if len(q) < 2:
        return JSONResponse([])
    results = await search_users_for_share(q.strip(), _uid(request))
    return JSONResponse(results)


# ── Share modal (HTMX partial) ───────────────────────────────────────────────

@router.get("/modal/note/{note_id}", response_class=HTMLResponse)
async def share_modal_note(request: Request, note_id: int):
    if not await note_belongs_to_user(note_id, _uid(request)):
        raise HTTPException(403, "Not your note")
    link = await get_public_link("note", note_id, _uid(request))
    share_url = f"{_base_url(request)}/share/view/note/{link['token']}" if link else None
    return templates.TemplateResponse(
        request,
        "partials/share_modal.html",
        {
            "object_type":  "note",
            "object_id":    note_id,
            "active_link":  link is not None,
            "token":        link["token"] if link else None,
            "share_url":    share_url,
        },
    )


@router.get("/modal/db-card/{card_id}", response_class=HTMLResponse)
async def share_modal_card(request: Request, card_id: int):
    if not await db_card_belongs_to_user(card_id, _uid(request)):
        raise HTTPException(403, "Not your card")
    link = await get_public_link("db_card", card_id, _uid(request))
    share_url = f"{_base_url(request)}/share/view/db-card/{link['token']}" if link else None
    return templates.TemplateResponse(
        request,
        "partials/share_modal.html",
        {
            "object_type":  "db_card",
            "object_id":    card_id,
            "active_link":  link is not None,
            "token":        link["token"] if link else None,
            "share_url":    share_url,
        },
    )


# ── Public link management ───────────────────────────────────────────────────

@router.get("/note/{note_id}/public-link")
async def get_note_public_link(request: Request, note_id: int):
    if not await note_belongs_to_user(note_id, _uid(request)):
        raise HTTPException(403, "Not your note")
    link = await get_public_link("note", note_id, _uid(request))
    url = f"{_base_url(request)}/share/view/note/{link['token']}" if link else None
    return JSONResponse({"active": link is not None, "token": link["token"] if link else None, "url": url})


@router.post("/note/{note_id}/public-link")
async def create_note_public_link(request: Request, note_id: int):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await note_belongs_to_user(note_id, _uid(request)):
        raise HTTPException(403, "Not your note")
    result = await create_public_link("note", note_id, _uid(request))
    url = f"{_base_url(request)}/share/view/note/{result['token']}"
    return JSONResponse({"token": result["token"], "url": url})


@router.delete("/note/{note_id}/public-link")
async def revoke_note_public_link(request: Request, note_id: int):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await note_belongs_to_user(note_id, _uid(request)):
        raise HTTPException(403, "Not your note")
    await revoke_public_link("note", note_id, _uid(request))
    return JSONResponse({"ok": True})


@router.get("/db-card/{card_id}/public-link")
async def get_card_public_link(request: Request, card_id: int):
    if not await db_card_belongs_to_user(card_id, _uid(request)):
        raise HTTPException(403, "Not your card")
    link = await get_public_link("db_card", card_id, _uid(request))
    url = f"{_base_url(request)}/share/view/db-card/{link['token']}" if link else None
    return JSONResponse({"active": link is not None, "token": link["token"] if link else None, "url": url})


@router.post("/db-card/{card_id}/public-link")
async def create_card_public_link(request: Request, card_id: int):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await db_card_belongs_to_user(card_id, _uid(request)):
        raise HTTPException(403, "Not your card")
    result = await create_public_link("db_card", card_id, _uid(request))
    url = f"{_base_url(request)}/share/view/db-card/{result['token']}"
    return JSONResponse({"token": result["token"], "url": url})


@router.delete("/db-card/{card_id}/public-link")
async def revoke_card_public_link(request: Request, card_id: int):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await db_card_belongs_to_user(card_id, _uid(request)):
        raise HTTPException(403, "Not your card")
    await revoke_public_link("db_card", card_id, _uid(request))
    return JSONResponse({"ok": True})


# ── User-to-user copy endpoints ──────────────────────────────────────────────

class _ToUserBody(BaseModel):
    recipient_id: int


@router.post("/note/{note_id}/to-user")
async def share_note_to_user(request: Request, note_id: int, body: _ToUserBody):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await note_belongs_to_user(note_id, _uid(request)):
        raise HTTPException(403, "Not your note")
    if body.recipient_id == _uid(request):
        raise HTTPException(400, "Cannot share with yourself")
    inbox_ws_id = await get_or_create_shared_inbox_workspace(body.recipient_id)
    await copy_note_to_workspace(note_id, inbox_ws_id)
    return JSONResponse({"ok": True, "message": "Note sent!"})


@router.post("/workspace/{ws_id}/to-user")
async def share_workspace_to_user(request: Request, ws_id: int, body: _ToUserBody):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await workspace_belongs_to_user(ws_id, _uid(request)):
        raise HTTPException(403, "Not your workspace")
    ws_type = await get_workspace_type(ws_id)
    if ws_type != "workspace":
        raise HTTPException(400, "Use the database share endpoint for database workspaces")
    if body.recipient_id == _uid(request):
        raise HTTPException(400, "Cannot share with yourself")
    await copy_workspace_tree_to_user(ws_id, body.recipient_id)
    return JSONResponse({"ok": True, "message": "Workspace copy sent!"})


@router.post("/db-workspace/{ws_id}/to-user")
async def share_db_workspace_to_user(request: Request, ws_id: int, body: _ToUserBody):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await workspace_belongs_to_user(ws_id, _uid(request)):
        raise HTTPException(403, "Not your workspace")
    ws_type = await get_workspace_type(ws_id)
    if ws_type != "database":
        raise HTTPException(400, "Not a database workspace")
    if body.recipient_id == _uid(request):
        raise HTTPException(400, "Cannot share with yourself")
    await copy_db_workspace_to_user(ws_id, body.recipient_id)
    return JSONResponse({"ok": True, "message": "Database copy sent!"})


@router.post("/db-card/{card_id}/to-user")
async def share_db_card_to_user(request: Request, card_id: int, body: _ToUserBody):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await db_card_belongs_to_user(card_id, _uid(request)):
        raise HTTPException(403, "Not your card")
    if body.recipient_id == _uid(request):
        raise HTTPException(400, "Cannot share with yourself")
    target_db_id = await get_or_create_shared_cards_database(body.recipient_id)
    await copy_db_card_to_database(card_id, target_db_id, body.recipient_id)
    return JSONResponse({"ok": True, "message": "Card sent!"})


# ── Public view routes (no auth — middleware prefix-bypasses /share/view/) ────

@router.get("/view/note/{token}", response_class=HTMLResponse)
async def public_view_note(request: Request, token: str):
    link = await get_public_link_by_token(token)
    if not link or link["object_type"] != "note":
        return templates.TemplateResponse(
            request, "share_404.html", {}, status_code=404
        )
    note = await get_note_for_public_view(link["object_id"])
    if not note:
        return templates.TemplateResponse(
            request, "share_404.html", {}, status_code=404
        )
    return templates.TemplateResponse(
        request, "share_note_view.html", {"note": note}
    )


@router.get("/view/db-card/{token}", response_class=HTMLResponse)
async def public_view_card(request: Request, token: str):
    link = await get_public_link_by_token(token)
    if not link or link["object_type"] != "db_card":
        return templates.TemplateResponse(
            request, "share_404.html", {}, status_code=404
        )
    card = await get_db_card_for_public_view(link["object_id"])
    if not card:
        return templates.TemplateResponse(
            request, "share_404.html", {}, status_code=404
        )
    return templates.TemplateResponse(
        request, "share_card_view.html", {"card": card}
    )
