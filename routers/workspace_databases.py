"""FastAPI router for workspace database cards.

Prefix: /workspaces
All routes auth-gated via _uid(request).
None of these routes are public — all require a logged-in session.
"""
from __future__ import annotations

import mimetypes
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from database import get_db
from routers.attachments_db import UPLOAD_DIR
from routers.uploads_db import create_page_upload, delete_page_upload
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

_MAX_COVER_BYTES = 20 * 1024 * 1024  # 20 MB


async def _first_uploads_page_id(user_id: int) -> Optional[int]:
    """Return the id of the user's first uploads home page, or None."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id FROM home_pages "
            "WHERE user_id=? AND page_type='uploads' AND deleted_at IS NULL "
            "ORDER BY id LIMIT 1",
            (user_id,),
        )
        row = await cur.fetchone()
        return row[0] if row else None

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
    """Update title, cover_url, and/or note_content of a card.

    When cover_url is explicitly cleared (empty string) or changed to an
    external URL while the card had an uploaded cover, the old page_uploads
    record and its disk file are cleaned up automatically.
    """
    user_id = _uid(request)
    # Fetch existing card to fill in missing fields (partial update)
    existing = await get_db_card(card_id=card_id, db_id=ws_id, user_id=user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Card not found")
    await _get_database_ws(ws_id, user_id)
    title        = body.title        if body.title        is not None else existing["title"]
    cover_url    = body.cover_url    if body.cover_url    is not None else existing["cover_url"]
    note_content = body.note_content if body.note_content is not None else existing["note_content"]

    # Detect cover change away from an uploaded file — clean up the old upload
    old_upload_id = existing.get("cover_upload_id")
    cover_changed = body.cover_url is not None and body.cover_url != existing["cover_url"]
    clear_upload  = False
    if cover_changed and old_upload_id:
        fname = await delete_page_upload(old_upload_id, user_id)
        if fname:
            (UPLOAD_DIR / fname).unlink(missing_ok=True)
        clear_upload = True

    updated_at = await update_db_card(
        card_id=card_id,
        db_id=ws_id,
        user_id=user_id,
        title=title,
        cover_url=cover_url,
        note_content=note_content,
        clear_cover_upload=clear_upload,
    )
    if updated_at is None:
        raise HTTPException(status_code=404, detail="Card not found")
    return JSONResponse({"ok": True, "updated_at": updated_at})


@router.delete("/{ws_id}/db/cards/{card_id}")
async def delete_card(ws_id: int, card_id: int, request: Request) -> JSONResponse:
    """Delete a card, cleaning up any linked cover upload."""
    user_id = _uid(request)
    await _get_database_ws(ws_id, user_id)

    # Clean up cover upload BEFORE deleting the card (trigger handles DB side,
    # but we also need to remove the file from disk)
    existing = await get_db_card(card_id=card_id, db_id=ws_id, user_id=user_id)
    if existing and existing.get("cover_upload_id"):
        fname = await delete_page_upload(existing["cover_upload_id"], user_id)
        if fname:
            (UPLOAD_DIR / fname).unlink(missing_ok=True)

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


# ── Cover image: inline serve ─────────────────────────────────────────────────

@router.get("/covers/{filename}")
async def serve_cover(filename: str, request: Request) -> FileResponse:
    """Auth-gated inline serve for card cover images stored in UPLOAD_DIR."""
    _uid(request)  # 401 if no session
    # Sanitise: no path traversal
    safe_name = Path(filename).name
    disk_path = UPLOAD_DIR / safe_name
    if not disk_path.exists():
        raise HTTPException(status_code=404, detail="Cover not found")
    mime = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
    # No 'filename' arg → no Content-Disposition header → browser renders inline
    return FileResponse(path=str(disk_path), media_type=mime)


# ── Cover image: upload ───────────────────────────────────────────────────────

@router.post("/{ws_id}/db/cards/{card_id}/cover-upload")
async def upload_card_cover(
    ws_id: int,
    card_id: int,
    request: Request,
    file: UploadFile = File(...),
) -> JSONResponse:
    """Upload a cover image for a card.

    - Saves file to UPLOAD_DIR.
    - Creates a page_uploads record on the user's first uploads home page (if
      one exists) so the image appears in the Homespace Uploads gallery.
    - PATCHes the card's cover_url.
    - Returns {ok, cover_url}.
    """
    user_id = _uid(request)
    await _get_database_ws(ws_id, user_id)
    existing = await get_db_card(card_id=card_id, db_id=ws_id, user_id=user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Card not found")

    data = await file.read()
    if len(data) > _MAX_COVER_BYTES:
        raise HTTPException(status_code=413, detail="Cover image too large (max 20 MB)")

    original_name = file.filename or "cover"
    suffix = Path(original_name).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg"}:
        raise HTTPException(status_code=415, detail="Unsupported image format")

    stored_name = f"{uuid.uuid4().hex}{suffix}"
    mime = file.content_type or mimetypes.guess_type(original_name)[0] or "image/jpeg"
    (UPLOAD_DIR / stored_name).write_bytes(data)

    # Register in the uploads gallery (best-effort — don't fail if page missing)
    new_upload_id: Optional[int] = None
    uploads_page_id = await _first_uploads_page_id(user_id)
    if uploads_page_id:
        new_upload_id = await create_page_upload(
            page_id=uploads_page_id,
            user_id=user_id,
            filename=stored_name,
            original_name=original_name,
            mime_type=mime,
            size=len(data),
        )

    # Clean up any previous uploaded cover (delete the old page_uploads row +
    # its disk file) so we don't leave orphaned files in the uploads gallery.
    old_upload_id = existing.get("cover_upload_id")
    if old_upload_id:
        old_fname = await delete_page_upload(old_upload_id, user_id)
        if old_fname:
            (UPLOAD_DIR / old_fname).unlink(missing_ok=True)

    cover_url = f"/workspaces/covers/{stored_name}"
    await update_db_card(
        card_id=card_id,
        db_id=ws_id,
        user_id=user_id,
        title=existing["title"],
        cover_url=cover_url,
        note_content=existing.get("note_content") or "",
        cover_upload_id=new_upload_id,
        clear_cover_upload=new_upload_id is None,  # no uploads page → clear stale link
    )
    return JSONResponse({"ok": True, "cover_url": cover_url})
