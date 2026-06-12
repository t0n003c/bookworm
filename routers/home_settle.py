"""Settle Up widget — API router.

Endpoints:
  GET  /home/settle-up/trip-pages        cascade picker: trip pages
  GET  /home/settle-up/trip-plans        cascade picker: plans for a trip page
  GET  /home/settle-up/settle-panels     cascade picker: settle panels for a plan
  PUT  /home/pages/{page_id}/widgets/{widget_id}/settle   standalone data write
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from database import get_db
from routers.home_db import get_home_page, get_home_pages, get_widget_by_id, update_widget_config
from routers.home_trip_db import get_trip_plans

log = logging.getLogger(__name__)
router = APIRouter(prefix="/home")

_DEMO_NOOP = Response(status_code=204, headers={"HX-Reswap": "none"})


# ── helpers ───────────────────────────────────────────────────────────────────

def _uid(request: Request) -> int:
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    return int(uid)


def _demo_guard(request: Request):
    if request.session.get("is_demo"):
        return _DEMO_NOOP
    return None


def _err(msg: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=status)


# ── Cascade picker endpoints (read-only, no demo guard needed) ────────────────

@router.get("/settle-up/trip-pages")
async def settle_trip_pages(request: Request):
    """Return all trip-type pages for the current user."""
    try:
        uid = _uid(request)
    except PermissionError:
        return _err("not logged in", 401)
    pages = await get_home_pages(uid)
    trip_pages = [
        {"id": p["id"], "name": p["name"], "emoji": p.get("emoji", "✈️")}
        for p in pages
        if p.get("page_type") == "trip"
    ]
    return JSONResponse({"pages": trip_pages})


@router.get("/settle-up/trip-plans")
async def settle_trip_plans(request: Request, page_id: int = 0):
    """Return plans for a trip page."""
    try:
        uid = _uid(request)
    except PermissionError:
        return _err("not logged in", 401)
    if not page_id:
        return JSONResponse({"plans": []})
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "trip":
        return _err("not found", 404)
    plans = await get_trip_plans(page_id, uid)
    return JSONResponse({"plans": [{"id": p["id"], "plan_name": p["plan_name"]} for p in plans]})


@router.get("/settle-up/settle-panels")
async def settle_settle_panels(request: Request, page_id: int = 0, plan_id: int = 0):
    """Return settle-type panels for a trip plan."""
    try:
        uid = _uid(request)
    except PermissionError:
        return _err("not logged in", 401)
    if not page_id or not plan_id:
        return JSONResponse({"panels": []})
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "trip":
        return _err("not found", 404)
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id, title
              FROM trip_plan_panels
             WHERE page_id=? AND user_id=? AND plan_id=? AND panel_type='settle'
             ORDER BY sort_order, id
            """,
            (page_id, uid, plan_id),
        )
        rows = await cur.fetchall()
    panels = [{"id": r["id"], "title": r["title"] or "Settle Up"} for r in rows]
    return JSONResponse({"panels": panels})


# ── Standalone data write ─────────────────────────────────────────────────────

@router.put("/pages/{page_id}/widgets/{widget_id}/settle")
async def save_settle_widget(page_id: int, widget_id: int, request: Request):
    """Persist standalone Settle Up widget data (people, expenses, currency)."""
    if (guard := _demo_guard(request)):
        return guard
    try:
        uid = _uid(request)
    except PermissionError:
        return _err("not logged in", 401)

    # Validate page ownership
    page = await get_home_page(page_id, uid)
    if not page:
        return _err("page not found", 404)

    # Validate widget belongs to this page
    widget = await get_widget_by_id(widget_id)
    if not widget or widget["page_id"] != page_id:
        return _err("widget not found", 404)

    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON")

    currency = str(body.get("currency") or "USD")[:10]
    people   = [str(n)[:80] for n in (body.get("people") or []) if str(n).strip()]
    expenses = body.get("expenses") or []

    # Sanitise expense list
    clean_expenses = []
    for exp in expenses:
        try:
            clean_expenses.append({
                "desc":     str(exp.get("desc") or "")[:120],
                "paid_by":  int(exp.get("paid_by") or 0),
                "amount":   float(exp.get("amount") or 0),
                "split":    [int(i) for i in (exp.get("split") or [])],
            })
        except (TypeError, ValueError):
            continue  # skip malformed entries

    # Merge into existing config (preserve sync keys)
    config = widget.get("config") or {}
    if isinstance(config, str):
        try:
            config = json.loads(config)
        except Exception:
            config = {}

    config["currency"] = currency
    config["people"]   = people
    config["expenses"] = clean_expenses

    await update_widget_config(widget_id, config)
    return JSONResponse({"ok": True})
