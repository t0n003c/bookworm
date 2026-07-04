"""Subscriptions homespace page — API endpoints.

All endpoints return JSONResponse and are consumed by home-page-subscriptions.js.
The page shell is rendered by home_page_view() in home.py when page_type == 'subscriptions'.
"""
from __future__ import annotations

import logging
import json

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import JSONResponse

from database import get_db
from app.api.home_db import get_home_page
from app.api.home_subscriptions_db import (
    add_subscription,
    clear_subscription,
    delete_subscription,
    get_subscriptions,
    get_summary_data,
    update_subscription,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/home")


from core.deps import current_user_id


def _uid(request: Request) -> int:
    return current_user_id(request, detail=None)


def _parse_reminder_offsets(raw: str, legacy_days: int = 0) -> list[int]:
    """Normalize subscription reminder offsets from the form."""
    vals: list[int] = []
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError:
        data = []
    if isinstance(data, list):
        for item in data:
            try:
                n = int(item)
            except (TypeError, ValueError):
                continue
            if 0 <= n <= 366:
                vals.append(n)
    if not vals and legacy_days:
        vals.append(max(0, min(366, int(legacy_days))))
    return sorted(set(vals), reverse=True)


async def _get_subs_page(page_id: int, uid: int):
    """Return page dict or 404-style None; validates ownership and page_type."""
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "subscriptions":
        return None
    return page


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/subscriptions/{page_id}/list")
async def list_subscriptions(request: Request, page_id: int):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    page = await _get_subs_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)
    items = await get_subscriptions(page_id, uid)
    return JSONResponse(items)


# ── Summary / analytics ───────────────────────────────────────────────────────

@router.get("/subscriptions/{page_id}/summary")
async def get_summary_endpoint(request: Request, page_id: int):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    page = await _get_subs_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)
    summary = await get_summary_data(page_id, uid)
    return JSONResponse(summary)


# ── Add ───────────────────────────────────────────────────────────────────────

@router.post("/subscriptions/{page_id}/add")
async def add_subscription_endpoint(
    request:           Request,
    page_id:           int,
    name:              str   = Form(...),
    amount:            float = Form(0.0),
    currency:          str   = Form("USD"),
    cycle:             int   = Form(3),
    frequency:         int   = Form(1),
    category:          str   = Form(""),
    color:             str   = Form("#0053e2"),
    next_payment_date: str   = Form(""),
    start_date:        str   = Form(""),
    notes:             str   = Form(""),
    website_url:       str   = Form(""),
    reminder_days:     int   = Form(0),
    reminder_offsets_json: str = Form(""),
):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    page = await _get_subs_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)

    name = name.strip()
    if not name:
        return JSONResponse({"error": "name is required"}, status_code=400)

    reminder_offsets = _parse_reminder_offsets(reminder_offsets_json, reminder_days)
    new_id = await add_subscription(
        page_id=page_id,
        name=name,
        amount=max(0.0, amount),
        currency=currency.strip().upper() or "USD",
        cycle=cycle if cycle in (1, 2, 3, 4) else 3,
        frequency=max(1, frequency),
        category=category.strip(),
        color=color.strip() or "#0053e2",
        next_payment_date=next_payment_date.strip() or None,
        start_date=start_date.strip() or None,
        notes=notes.strip(),
        website_url=website_url.strip(),
        reminder_days=reminder_offsets[0] if reminder_offsets else 0,
        reminder_offsets=reminder_offsets,
    )
    return JSONResponse({"id": new_id}, status_code=201)


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/subscriptions/{page_id}/items/{sub_id}")
async def update_subscription_endpoint(
    request:           Request,
    page_id:           int,
    sub_id:            int,
    name:              str   = Form(...),
    amount:            float = Form(0.0),
    currency:          str   = Form("USD"),
    cycle:             int   = Form(3),
    frequency:         int   = Form(1),
    category:          str   = Form(""),
    color:             str   = Form("#0053e2"),
    next_payment_date: str   = Form(""),
    start_date:        str   = Form(""),
    notes:             str   = Form(""),
    active:            int   = Form(1),
    website_url:       str   = Form(""),
    reminder_days:     int   = Form(0),
    reminder_offsets_json: str = Form(""),
):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    page = await _get_subs_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)

    name = name.strip()
    if not name:
        return JSONResponse({"error": "name is required"}, status_code=400)

    reminder_offsets = _parse_reminder_offsets(reminder_offsets_json, reminder_days)
    ok = await update_subscription(
        sub_id=sub_id,
        page_id=page_id,
        user_id=uid,
        name=name,
        amount=max(0.0, amount),
        currency=currency.strip().upper() or "USD",
        cycle=cycle if cycle in (1, 2, 3, 4) else 3,
        frequency=max(1, frequency),
        category=category.strip(),
        color=color.strip() or "#0053e2",
        next_payment_date=next_payment_date.strip() or None,
        start_date=start_date.strip() or None,
        notes=notes.strip(),
        active=1 if active else 0,
        website_url=website_url.strip(),
        reminder_days=reminder_offsets[0] if reminder_offsets else 0,
        reminder_offsets=reminder_offsets,
    )
    if not ok:
        return JSONResponse({"error": "not found or no permission"}, status_code=404)
    return JSONResponse({"ok": True})


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/subscriptions/{page_id}/items/{sub_id}")
async def delete_subscription_endpoint(
    request: Request,
    page_id: int,
    sub_id:  int,
):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    page = await _get_subs_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)
    ok = await delete_subscription(sub_id, page_id, uid)
    if not ok:
        return JSONResponse({"error": "not found or no permission"}, status_code=404)
    return JSONResponse({"ok": True})


# ── Clear (mark renewal as paid) ───────────────────────────────────────────────

@router.patch("/subscriptions/{page_id}/items/{sub_id}/clear")
async def clear_subscription_endpoint(
    request: Request,
    page_id: int,
    sub_id:  int,
):
    """Set cleared_date = next_payment_date so this renewal is hidden from
    Upcoming Renewals until the subscription advances to its next billing cycle.
    """
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    page = await _get_subs_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)
    ok = await clear_subscription(sub_id, page_id, uid)
    if not ok:
        return JSONResponse({"error": "not found or no permission"}, status_code=404)
    return JSONResponse({"ok": True})
