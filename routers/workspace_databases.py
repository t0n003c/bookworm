"""FastAPI router for workspace database cards.

Prefix: /workspaces
All routes auth-gated via _uid(request).
None of these routes are public — all require a logged-in session.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from routers.workspace_db_cards import (
    create_db_card,
    delete_card_attr,
    delete_db_card,
    get_db_card,
    get_db_cards,
    update_card_note_height,
    update_db_card,
    upsert_card_attr,
)
from routers.workspaces_db import get_workspace_by_id

router = APIRouter(prefix="/workspaces", tags=["workspace-databases"])


# ── auth helper ────────────────────────────────────────────────────────────────

def _uid(request: Request) -> int:
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return int(uid)


# ── ownership guard ────────────────────────────────────────────────────────────

async def _get_database_ws(ws_id: int, user_id: int) -> dict:
    """Fetch the workspace, verify ownership and ws_type='database'."""
    ws = await get_workspace_by_id(ws_id)
    if not ws or ws.get("user_id") != user_id or (ws.get("ws_type") or "workspace") != "database":
        raise HTTPException(status_code=404, detail="Database not found")
    return ws


# ── request models ─────────────────────────────────────────────────────────────

class CardCreateBody(BaseModel):
    title: str = "Untitled"


class CardUpdateBody(BaseModel):
    title:        Optional[str] = None
    cover_url:    Optional[str] = None
    note_content: Optional[str] = None


class NoteHeightBody(BaseModel):
    height: int


class AttrBody(BaseModel):
    attr_key: str
    attr_value: str = ""


# ── endpoints ──────────────────────────────────────────────────────────────────

@router.get("/{ws_id}/db-cards")
async def list_db_cards(ws_id: int, request: Request) -> JSONResponse:
    """List all cards (with attrs) for a database workspace."""
    user_id = _uid(request)
    await _get_database_ws(ws_id, user_id)
    cards = await get_db_cards(db_id=ws_id, user_id=user_id)
    return JSONResponse({"cards": cards})


@router.post("/{ws_id}/db/cards")
async def create_card(ws_id: int, request: Request, body: CardCreateBody) -> JSONResponse:
    """Create a new card in a database workspace."""
    user_id = _uid(request)
    await _get_database_ws(ws_id, user_id)
    card = await create_db_card(db_id=ws_id, user_id=user_id, title=body.title or "Untitled")
    return JSONResponse(card, status_code=201)


@router.get("/{ws_id}/db/cards/{card_id}")
async def get_card(ws_id: int, card_id: int, request: Request) -> JSONResponse:
    """Return a single card with full attrs."""
    user_id = _uid(request)
    await _get_database_ws(ws_id, user_id)
    card = await get_db_card(card_id=card_id, db_id=ws_id, user_id=user_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return JSONResponse(card)


@router.patch("/{ws_id}/db/cards/{card_id}")
async def update_card(
    ws_id: int, card_id: int, request: Request, body: CardUpdateBody
) -> JSONResponse:
    """Update title, cover_url, and/or note_content of a card."""
    user_id = _uid(request)
    # Fetch existing card to fill in missing fields (partial update)
    existing = await get_db_card(card_id=card_id, db_id=ws_id, user_id=user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Card not found")
    await _get_database_ws(ws_id, user_id)
    title        = body.title        if body.title        is not None else existing["title"]
    cover_url    = body.cover_url    if body.cover_url    is not None else existing["cover_url"]
    note_content = body.note_content if body.note_content is not None else existing["note_content"]
    updated_at = await update_db_card(
        card_id=card_id,
        db_id=ws_id,
        user_id=user_id,
        title=title,
        cover_url=cover_url,
        note_content=note_content,
    )
    if updated_at is None:
        raise HTTPException(status_code=404, detail="Card not found")
    return JSONResponse({"ok": True, "updated_at": updated_at})


@router.delete("/{ws_id}/db/cards/{card_id}")
async def delete_card(ws_id: int, card_id: int, request: Request) -> JSONResponse:
    """Delete a card."""
    user_id = _uid(request)
    await _get_database_ws(ws_id, user_id)
    deleted = await delete_db_card(card_id=card_id, db_id=ws_id, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Card not found")
    return JSONResponse({"ok": True})


@router.patch("/{ws_id}/db/cards/{card_id}/note-height")
async def update_note_height(
    ws_id: int, card_id: int, request: Request, body: NoteHeightBody
) -> JSONResponse:
    """Persist the resized note box height for a card."""
    user_id = _uid(request)
    await _get_database_ws(ws_id, user_id)
    ok = await update_card_note_height(
        card_id=card_id, db_id=ws_id, user_id=user_id, height=body.height
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Card not found")
    return JSONResponse({"ok": True})


@router.post("/{ws_id}/db/cards/{card_id}/attrs")
async def add_or_update_attr(
    ws_id: int, card_id: int, request: Request, body: AttrBody
) -> JSONResponse:
    """Add or update a custom attribute on a card."""
    user_id = _uid(request)
    await _get_database_ws(ws_id, user_id)
    if not body.attr_key.strip():
        raise HTTPException(status_code=422, detail="attr_key cannot be empty")
    attr = await upsert_card_attr(
        card_id=card_id,
        user_id=user_id,
        attr_key=body.attr_key.strip(),
        attr_value=body.attr_value,
    )
    if not attr:
        raise HTTPException(status_code=404, detail="Card not found")
    return JSONResponse(attr, status_code=201)


@router.delete("/{ws_id}/db/cards/{card_id}/attrs/{attr_id}")
async def remove_attr(
    ws_id: int, card_id: int, attr_id: int, request: Request
) -> JSONResponse:
    """Remove a custom attribute from a card."""
    user_id = _uid(request)
    await _get_database_ws(ws_id, user_id)
    deleted = await delete_card_attr(attr_id=attr_id, card_id=card_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Attribute not found")
    return JSONResponse({"ok": True})
