"""Grid Homespace page routes.

Mounted with prefix=/home (same as home.py + home_crm.py).
Routes live under /home/grid/{page_id}/...
All endpoints return JSONResponse; the page shell is rendered by home_page_view() in home.py.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.api.home_db import get_home_page
from app.api.home_grid_db import (
    add_grid_cell,
    delete_grid_cell,
    get_grid_cell,
    get_grid_cells,
    reorder_grid_cells,
    swap_grid_cells,
    update_grid_cell,
    update_grid_cell_caption,
)
from database import get_db

log = logging.getLogger(__name__)
router = APIRouter(prefix="/home", tags=["home_grid"])

_VALID_ASPECTS    = frozenset({"1:1", "4:5", "16:9"})
_VALID_CELL_TYPES = frozenset({"empty", "image", "video", "text"})


from core.deps import session_user_id as _uid


async def _get_grid_page(page_id: int, uid: int) -> dict | None:
    """Return page dict or None. Caller returns 404 on None."""
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "grid":
        return None
    return page


# ── List cells ───────────────────────────────────────────────────────────────

@router.get("/grid/{page_id}/cells")
async def list_cells(request: Request, page_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    cells = await get_grid_cells(page_id)
    return JSONResponse(cells)


# ── Create cell ───────────────────────────────────────────────────────────────

@router.post("/grid/{page_id}/cells")
async def create_cell(request: Request, page_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    body = await request.json()
    aspect = body.get("aspect", "1:1")
    if aspect not in _VALID_ASPECTS:
        aspect = "1:1"
    cell_type = body.get("cell_type", "empty")
    if cell_type not in _VALID_CELL_TYPES:
        cell_type = "empty"
    new_id = await add_grid_cell(
        page_id=page_id,
        cell_type=cell_type,
        upload_id=body.get("upload_id"),
        aspect=aspect,
        caption=str(body.get("caption", "")),
    )
    return JSONResponse({"id": new_id}, status_code=201)


# ── Update cell ───────────────────────────────────────────────────────────────

@router.patch("/grid/{page_id}/cells/{cell_id}")
async def patch_cell(request: Request, page_id: int, cell_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    body = await request.json()
    aspect = body.get("aspect")
    if aspect is not None and aspect not in _VALID_ASPECTS:
        aspect = None
    cell_type = body.get("cell_type")
    if cell_type is not None and cell_type not in _VALID_CELL_TYPES:
        cell_type = None
    try:
        await update_grid_cell(
            cell_id=cell_id,
            page_id=page_id,
            uid=uid,
            position=body.get("position"),
            cell_type=cell_type,
            upload_id=body.get("upload_id"),
            clear_upload=bool(body.get("clear_upload", False)),
            aspect=aspect,
            caption=body.get("caption"),
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    return JSONResponse({"ok": True})


# ── Delete cell ───────────────────────────────────────────────────────────────

@router.delete("/grid/{page_id}/cells/{cell_id}")
async def remove_cell(request: Request, page_id: int, cell_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    await delete_grid_cell(cell_id, page_id, uid)
    return JSONResponse(None, status_code=204)


# ── Reorder cells ─────────────────────────────────────────────────────────────

@router.post("/grid/{page_id}/reorder")
async def reorder_cells(request: Request, page_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    body = await request.json()
    order = [int(x) for x in body.get("order", [])]
    if order:
        await reorder_grid_cells(page_id, order)
    return JSONResponse({"ok": True})


# ── Swap two cells ────────────────────────────────────────────────────────────

@router.post("/grid/{page_id}/swap")
async def swap_cells(request: Request, page_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    body = await request.json()
    a = int(body.get("a", 0))
    b = int(body.get("b", 0))
    if a and b and a != b:
        await swap_grid_cells(page_id, a, b)
    return JSONResponse({"ok": True})


# ── Disconnect an upload from a grid page (upload detail panel action) ──────────

@router.delete("/grid/{page_id}/disconnect/{upload_id}")
async def disconnect_upload(request: Request, page_id: int, upload_id: int):
    """Sever this upload's grid connection: delete the cell row AND the tag.

    Both must be removed so the backfill (INSERT OR IGNORE from home_grid_cells)
    cannot restore the tag on the next page load.  Neither the upload file nor
    the grid page itself is deleted.
    """
    uid = _uid(request)
    async with get_db() as db:
        # Remove the cell — this is what prevents backfill from re-adding the tag.
        await db.execute(
            "DELETE FROM home_grid_cells WHERE page_id=? AND upload_id=?",
            (page_id, upload_id),
        )
        # Strip the tag too (may already be gone; harmless if it isn't).
        await db.execute(
            "DELETE FROM page_upload_tags "
            "WHERE upload_src='page' AND upload_id=? AND user_id=? AND tag=?",
            (upload_id, uid, f"grid:{page_id}"),
        )
        await db.commit()
    return JSONResponse({"ok": True})


# ── Backfill grid: tags on Uploads page ────────────────────────────────────────

@router.post("/grid/{page_id}/backfill-tags")
async def backfill_tags(request: Request, page_id: int):
    """Idempotent: tag every file in THIS grid page with grid:{page_id}.

    Called silently from the grid page JS on load.
    """
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    tag = f"grid:{page_id}"
    async with get_db() as db:
        await db.execute(
            """
            INSERT OR IGNORE INTO page_upload_tags (upload_src, upload_id, user_id, tag)
            SELECT 'page', c.upload_id, pu.user_id, ?
            FROM   home_grid_cells c
            JOIN   page_uploads pu ON pu.id = c.upload_id
            WHERE  c.page_id = ?
              AND  c.upload_id IS NOT NULL
            """,
            (tag, page_id),
        )
        await db.commit()
    return JSONResponse({"ok": True})


@router.post("/grid/backfill-all-tags")
async def backfill_all_tags(request: Request):
    """Idempotent: tag files for ALL grid pages owned by this user.

    Called silently from the Uploads page JS on init, so the grid badge
    appears even if the user has never opened the Grid page in this session.
    """
    uid = _uid(request)
    async with get_db() as db:
        await db.execute(
            """
            INSERT OR IGNORE INTO page_upload_tags (upload_src, upload_id, user_id, tag)
            SELECT 'page',
                   c.upload_id,
                   pu.user_id,
                   'grid:' || c.page_id
            FROM   home_grid_cells c
            JOIN   page_uploads pu ON pu.id = c.upload_id
            JOIN   home_pages   hp ON hp.id = c.page_id
            WHERE  hp.user_id = ?
              AND  hp.page_type = 'grid'
              AND  c.upload_id IS NOT NULL
            """,
            (uid,),
        )
        await db.commit()
    return JSONResponse({"ok": True})


# ── Update cell caption ─────────────────────────────────────────────────────

@router.patch("/grid/{page_id}/cell/{cell_id}/caption")
async def set_cell_caption(request: Request, page_id: int, cell_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    body   = await request.json()
    caption = str(body.get("caption", ""))
    ok = await update_grid_cell_caption(cell_id, page_id, caption)
    if not ok:
        return JSONResponse({"error": "cell not found"}, 404)
    return JSONResponse({"ok": True, "caption": caption.strip()[:120]})
    return JSONResponse({"ok": True})
