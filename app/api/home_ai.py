"""AI Dashboard homespace page API.

Mounted with prefix=/home (same as home.py).
The page shell is rendered by home_page_view() in home.py when page_type == 'ai_dashboard'.

Endpoints:
  GET  /home/ai-dashboard/{page_id}/overview?days=30   -> summary + chart data JSON
  GET  /home/ai-dashboard/{page_id}/history?page=1&q=  -> paginated chat history JSON
  DELETE /home/ai-dashboard/{page_id}/history?keep_days=N -> trim / delete history
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from database import get_db
from app.api.home_ai_db import get_ai_overview, get_ai_history, delete_ai_history

router = APIRouter(prefix="/home", tags=["ai-dashboard"])


def _uid(request: Request) -> int:
    uid = request.session.get("user_id")
    if not uid:
        raise PermissionError("not authenticated")
    return int(uid)


async def _get_ai_page(page_id: int, uid: int) -> dict | None:
    """Return page dict or None; validates ownership + page_type == 'ai_dashboard'."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM home_pages WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (page_id, uid),
        )
        row = await cur.fetchone()
    if not row:
        return None
    page = dict(row)
    if page.get("page_type") != "ai_dashboard":
        return None
    return page


@router.get("/ai-dashboard/{page_id}/overview")
async def ai_overview(
    request: Request,
    page_id: int,
    days: int = 30,
    start_date: str = "",
    end_date: str = "",
):
    """Summary cards + per-day chart data for the AI Dashboard overview tab.

    Accepts either ?days=N  (rolling window) or
    ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD  (explicit range).
    When both dates are provided and valid, the explicit range wins.
    """
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not authenticated"}, status_code=401)

    page = await _get_ai_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)

    data = await get_ai_overview(
        uid,
        days=days,
        start_date=start_date.strip(),
        end_date=end_date.strip(),
    )
    return JSONResponse(data)


@router.delete("/ai-dashboard/{page_id}/history")
async def ai_delete_history(
    request: Request,
    page_id: int,
    keep_days: int = 0,
):
    """Delete chat history for the current user.

    ?keep_days=0  → delete everything
    ?keep_days=90 → delete rows older than 90 days (keep recent 90 days)
    """
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not authenticated"}, status_code=401)

    page = await _get_ai_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)

    deleted = await delete_ai_history(uid, keep_days=keep_days)
    return JSONResponse({"deleted": deleted})


@router.get("/ai-dashboard/{page_id}/history")
async def ai_history(
    request: Request,
    page_id: int,
    page: int = 1,
    q: str = "",
):
    """Paginated Q&A chat history for the History tab."""
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not authenticated"}, status_code=401)

    pg = await _get_ai_page(page_id, uid)
    if not pg:
        return JSONResponse({"error": "page not found"}, status_code=404)

    data = await get_ai_history(uid, page=page, q=q.strip())
    return JSONResponse(data)
