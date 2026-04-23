"""Subscriptions homespace page — API endpoints.

All endpoints return JSONResponse and are consumed by home-page-subscriptions.js.
The page shell is rendered by home_page_view() in home.py when page_type == 'subscriptions'.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Form, Request
from fastapi.responses import JSONResponse

from database import get_db
from routers.home_db import get_home_page
from routers.home_subscriptions_db import (
    add_subscription,
    delete_subscription,
    get_subscriptions,
    get_summary_data,
    update_subscription,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/home")


def _uid(request: Request) -> int:
    uid = request.session.get("user_id")
    if not uid:
        raise PermissionError("not logged in")
    return int(uid)


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
    notes:             str   = Form(""),
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
        notes=notes.strip(),
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
    notes:             str   = Form(""),
    active:            int   = Form(1),
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
        notes=notes.strip(),
        active=1 if active else 0,
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
