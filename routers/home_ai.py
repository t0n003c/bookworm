"""AI Dashboard homespace page API.

Mounted with prefix=/home (same as home.py).
The page shell is rendered by home_page_view() in home.py when page_type == 'ai_dashboard'.

Endpoints:
  GET /home/ai-dashboard/{page_id}/overview?days=30   -> summary + chart data JSON
  GET /home/ai-dashboard/{page_id}/history?page=1&q=  -> paginated chat history JSON
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from database import get_db
from routers.auth_db import get_llm_settings
from routers.home_ai_db import get_ai_overview, get_ai_history, delete_ai_history

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


@router.get("/ai-dashboard/{page_id}/balance")
async def ai_check_balance(request: Request, page_id: int):
    """Try to fetch prepaid credit balance from the user's LLM provider.

    Only works with OpenAI endpoints; other providers return a not-supported
    message rather than an error.
    """
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not authenticated"}, status_code=401)

    page = await _get_ai_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)

    cfg = await get_llm_settings(uid)
    endpoint: str = cfg.get("endpoint", "").strip().rstrip("/")
    api_key: str  = cfg.get("api_key",  "").strip()

    if not api_key:
        return JSONResponse({"error": "no_key", "msg": "No API key configured — add one in Account → AI Search."})

    is_openai = "openai.com" in endpoint or not endpoint  # blank endpoint ⇒ assume OpenAI
    if not is_openai:
        return JSONResponse({"error": "not_openai", "msg": "Balance lookup is only supported for OpenAI endpoints."})

    # OpenAI billing endpoint — works for many account types; 401/403 means
    # the key doesn’t have billing scope (common with project keys).
    balance_url = "https://api.openai.com/dashboard/billing/credit_grants"
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(balance_url, headers=headers)
        if r.status_code == 200:
            data = r.json()
            return JSONResponse({
                "ok": True,
                "total_granted":   data.get("total_granted",   0),
                "total_used":      data.get("total_used",      0),
                "total_available": data.get("total_available", 0),
            })
        if r.status_code in (401, 403):
            return JSONResponse({"error": "no_scope", "msg": "Your API key doesn’t have billing access. Check your balance at platform.openai.com/account/billing."})
        return JSONResponse({"error": "upstream", "msg": f"OpenAI returned {r.status_code}. Check platform.openai.com/account/billing."})
    except Exception as exc:
        return JSONResponse({"error": "network", "msg": f"Request failed: {exc}"})


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
