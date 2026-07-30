"""Trip Plan Panel Cards — API endpoints.

Panels are trip-scoped utility cards (documents, packing list, budget,
emergency info, notes) that render alongside day lanes in the Plan view.

Panel types: documents | packing | budget | emergency | notes
Content is stored as a JSON blob; the client manages item-level IDs.
"""
from __future__ import annotations

import json
import logging
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response

from database import get_db
from app.api.attachments_db import UPLOAD_DIR
from app.api.home_db import get_home_page

log = logging.getLogger(__name__)
router = APIRouter(prefix="/home")

_PANEL_TYPES  = frozenset({"documents", "packing", "budget", "emergency", "notes", "settle", "people", "reminder"})
_DEMO_NOOP    = Response(status_code=204, headers={"HX-Reswap": "none"})
_MAX_DOC_MB   = 20


def _demo_guard(request: Request):
    """Return a no-op 204 for demo sessions; else None."""
    if request.session.get("is_demo"):
        return _DEMO_NOOP
    return None


# ── helpers ───────────────────────────────────────────────────────────────────

from core.deps import current_user_id


def _uid(request: Request) -> int:
    return current_user_id(request, detail=None)


async def _get_trip_page(page_id: int, uid: int):
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "trip":
        return None
    return page


def _err(msg: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=status)


def _parse_content(raw: str) -> dict:
    try:
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _list_panels(page_id: int, user_id: int, plan_id: int) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id, panel_type, title, content, sort_order, created_at
              FROM trip_plan_panels
             WHERE page_id=? AND user_id=? AND plan_id=?
             ORDER BY sort_order, id
            """,
            (page_id, user_id, plan_id),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def _get_panel(panel_id: int, user_id: int, page_id: int) -> dict | None:
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id, panel_type, title, content, sort_order
              FROM trip_plan_panels
             WHERE id=? AND user_id=? AND page_id=?
            """,
            (panel_id, user_id, page_id),
        )
        row = await cur.fetchone()
    if not row:
        return None
    r = dict(row)
    r["content"] = _parse_content(r["content"])
    return r


async def _add_panel(
    page_id: int, user_id: int, plan_id: int,
    panel_type: str, title: str, content: str,
) -> int:
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO trip_plan_panels
                (page_id, user_id, plan_id, panel_type, title, content, sort_order)
            VALUES (?, ?, ?, ?, ?, ?,
                COALESCE((SELECT MAX(sort_order)+10 FROM trip_plan_panels
                           WHERE plan_id=?), 0))
            """,
            (page_id, user_id, plan_id, panel_type, title, content, plan_id),
        )
        await db.commit()
        return cur.lastrowid


async def _update_panel(
    panel_id: int, user_id: int, page_id: int,
    title: str, content: str,
) -> bool:
    async with get_db() as db:
        cur = await db.execute(
            """
            UPDATE trip_plan_panels
               SET title=?, content=?
             WHERE id=? AND user_id=? AND page_id=?
            """,
            (title, content, panel_id, user_id, page_id),
        )
        await db.commit()
        return cur.rowcount > 0


async def _delete_panel(panel_id: int, user_id: int, page_id: int) -> bool:
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM trip_plan_panels WHERE id=? AND user_id=? AND page_id=?",
            (panel_id, user_id, page_id),
        )
        await db.commit()
        return cur.rowcount > 0


async def _reorder_panels(
    plan_id: int, user_id: int, page_id: int, ordered_ids: list[int],
) -> None:
    async with get_db() as db:
        for idx, pid in enumerate(ordered_ids):
            await db.execute(
                """
                UPDATE trip_plan_panels SET sort_order=?
                 WHERE id=? AND plan_id=? AND user_id=? AND page_id=?
                """,
                (idx * 10, pid, plan_id, user_id, page_id),
            )
        await db.commit()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/trip/{page_id}/plans/{plan_id}/panels/{panel_id}")
async def get_panel(page_id: int, plan_id: int, panel_id: int, request: Request):
    """Return a single panel — used by the Settle Up dashboard widget sync mode."""
    try:
        uid = _uid(request)
    except PermissionError:
        return _err("not logged in", 401)
    if not await _get_trip_page(page_id, uid):
        return _err("not found", 404)
    panel = await _get_panel(panel_id, uid, page_id)
    if not panel:
        return _err("panel not found", 404)
    return JSONResponse(panel)


@router.get("/trip/{page_id}/plans/{plan_id}/panels")
async def list_panels(page_id: int, plan_id: int, request: Request):
    try:
        uid = _uid(request)
    except PermissionError:
        return _err("not logged in", 401)
    if not await _get_trip_page(page_id, uid):
        return _err("not found", 404)
    panels = await _list_panels(page_id, uid, plan_id)
    return JSONResponse(panels)


@router.post("/trip/{page_id}/plans/{plan_id}/panels")
async def add_panel(page_id: int, plan_id: int, request: Request):
    if (guard := _demo_guard(request)): return guard
    try:
        uid = _uid(request)
    except PermissionError:
        return _err("not logged in", 401)
    if not await _get_trip_page(page_id, uid):
        return _err("not found", 404)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON")
    panel_type = (body.get("panel_type") or "").strip()
    if panel_type not in _PANEL_TYPES:
        return _err(f"unknown panel_type; valid: {sorted(_PANEL_TYPES)}")
    title   = (body.get("title") or "").strip()[:120]
    content = json.dumps(body.get("content") or _default_content(panel_type))
    pid = await _add_panel(page_id, uid, plan_id, panel_type, title, content)
    return JSONResponse({"id": pid}, status_code=201)


@router.put("/trip/{page_id}/plans/{plan_id}/panels/{panel_id}")
async def update_panel(page_id: int, plan_id: int, panel_id: int, request: Request):
    if (guard := _demo_guard(request)): return guard
    try:
        uid = _uid(request)
    except PermissionError:
        return _err("not logged in", 401)
    if not await _get_trip_page(page_id, uid):
        return _err("not found", 404)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON")
    title   = (body.get("title") or "").strip()[:120]
    content = json.dumps(body.get("content") or {})
    ok = await _update_panel(panel_id, uid, page_id, title, content)
    if not ok:
        return _err("not found", 404)
    return JSONResponse({"ok": True})


@router.delete("/trip/{page_id}/plans/{plan_id}/panels/{panel_id}")
async def delete_panel(page_id: int, plan_id: int, panel_id: int, request: Request):
    if (guard := _demo_guard(request)): return guard
    try:
        uid = _uid(request)
    except PermissionError:
        return _err("not logged in", 401)
    if not await _get_trip_page(page_id, uid):
        return _err("not found", 404)
    ok = await _delete_panel(panel_id, uid, page_id)
    if not ok:
        return _err("not found", 404)
    return JSONResponse({"ok": True})


@router.post("/trip/{page_id}/plans/{plan_id}/panels/reorder")
async def reorder_panels(page_id: int, plan_id: int, request: Request):
    if (guard := _demo_guard(request)): return guard
    try:
        uid = _uid(request)
    except PermissionError:
        return _err("not logged in", 401)
    if not await _get_trip_page(page_id, uid):
        return _err("not found", 404)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON")
    ids = [int(i) for i in (body.get("ordered_ids") or []) if str(i).isdigit()]
    await _reorder_panels(plan_id, uid, page_id, ids)
    return JSONResponse({"ok": True})


@router.post("/trip/{page_id}/plans/{plan_id}/panels/{panel_id}/upload-doc")
async def upload_panel_doc(
    request: Request, page_id: int, plan_id: int, panel_id: int,
    file: UploadFile = File(...),
):
    """Upload a file to a Documents panel. Returns {url, name}."""
    try:
        uid = _uid(request)
    except PermissionError:
        return _err("not logged in", 401)
    if guard := _demo_guard(request):
        return guard
    if not await _get_trip_page(page_id, uid):
        return _err("not found", 404)
    data = await file.read()
    if len(data) > _MAX_DOC_MB * 1024 * 1024:
        return _err(f"File too large — max {_MAX_DOC_MB} MB")
    original_name = (file.filename or "file").strip()
    raw_ext = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else "bin"
    stored_name = f"pdoc{panel_id}_{uuid4().hex[:10]}.{raw_ext}"
    doc_dir = UPLOAD_DIR / "trip-panel-docs"
    doc_dir.mkdir(parents=True, exist_ok=True)
    (doc_dir / stored_name).write_bytes(data)
    url = f"/home/trip-docs/{stored_name}"
    return JSONResponse({"url": url, "name": original_name})


# ── Default content per panel type ────────────────────────────────────────────────

def _default_content(panel_type: str) -> dict:
    defaults = {
        "documents": {"items": []},
        "packing":   {"groups": [{"name": "General", "items": []}]},
        "budget":    {"total": 0, "currency": "USD", "items": []},
        "emergency": {"items": []},
        "notes":     {"text": ""},
        "settle":    {"currency": "USD", "people": [], "expenses": []},
        "people":    {"members": [], "linked_settle_id": None},
        "reminder":  {"items": []},
    }
    return defaults.get(panel_type, {})
