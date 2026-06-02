"""Note drag-and-drop (workspace move) endpoint.

Lives on its own /nwdnd prefix so it can never be shadow-matched by
POST /notes/{note_id} regardless of Starlette version or route ordering.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from routers.notes_db import get_note_workspace_id, move_note_to_workspace
from routers.sharing_db import note_belongs_to_user, workspace_belongs_to_user

router = APIRouter(prefix="/nwdnd", tags=["note-dnd"])


@router.get("/ping", include_in_schema=False)
async def dnd_ping():
    """Canary — visit /nwdnd/ping in the browser to confirm this router loaded."""
    return {"ok": True, "router": "note_dnd"}


async def _require_note_owner(note_id: int, uid: Optional[int]) -> None:
    if not uid or not await note_belongs_to_user(note_id, uid):
        raise HTTPException(status_code=403, detail="Not authorised")


async def _require_ws_owner(ws_id: int, uid: Optional[int]) -> None:
    if not uid or not await workspace_belongs_to_user(ws_id, uid):
        raise HTTPException(status_code=403, detail="Not authorised")


@router.post("/move", response_class=JSONResponse)
async def move_note_handler(request: Request):
    """Move a note to a different workspace.

    Body: { "note_id": int, "target_ws_id": int }

    - source == target  → silent no-op
    - any other target  → UPDATE notes SET workspace_id = target
    """
    uid = request.session.get("user_id")

    body = await request.json()
    note_id:      Optional[int] = body.get("note_id")
    target_ws_id: Optional[int] = body.get("target_ws_id")

    if not note_id:
        raise HTTPException(status_code=422, detail="note_id required")
    if not target_ws_id:
        raise HTTPException(status_code=422, detail="target_ws_id required")

    await _require_note_owner(note_id, uid)
    await _require_ws_owner(target_ws_id, uid)

    source_ws_id = await get_note_workspace_id(note_id)
    if source_ws_id == target_ws_id:
        return JSONResponse({"ok": True, "moved": False, "reason": "same"})

    await move_note_to_workspace(note_id, target_ws_id)
    return JSONResponse({"ok": True, "moved": True, "note_id": note_id, "new_ws_id": target_ws_id})
