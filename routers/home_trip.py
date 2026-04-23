"""Trip Planning homespace page — API endpoints.

All endpoints return JSONResponse; consumed by home-page-trip*.js modules.
The page shell is rendered by home_page_view() in home.py when page_type == 'trip'.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Form, Request
from fastapi.responses import JSONResponse

from routers.home_db import get_home_page
from routers.home_trip_db import (
    add_trip_day,
    add_trip_spot,
    assign_spot_to_day,
    delete_trip_day,
    delete_trip_spot,
    get_trip_days,
    get_trip_spots,
    get_trip_stats,
    remove_spot_from_day,
    reorder_day_spots,
    reorder_trip_days,
    reorder_trip_spots,
    update_day_spot_time,
    update_trip_day,
    update_trip_spot,
    update_trip_spot_priority,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/home")

_SPOT_TYPES = frozenset({
    "Restaurant", "Hotel", "Camping", "Hiking",
    "City Attraction", "Beach", "Museum", "Other",
})


def _uid(request: Request) -> int:
    uid = request.session.get("user_id")
    if not uid:
        raise PermissionError("not logged in")
    return int(uid)


async def _get_trip_page(page_id: int, uid: int):
    """Return page dict or None; validates ownership + page_type == 'trip'."""
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "trip":
        return None
    return page


def _clean_spot_type(raw: str, custom: str) -> str:
    """If raw is 'custom', use custom text; otherwise validate against known list."""
    if raw == "custom":
        return custom.strip() or "Other"
    return raw if raw in _SPOT_TYPES else "Other"


# ── Spots (Research tab) ──────────────────────────────────────────────────────

@router.get("/trip/{page_id}/spots")
async def list_spots(request: Request, page_id: int, type: str = ""):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    items = await get_trip_spots(page_id, uid, spot_type=type.strip() or None)
    return JSONResponse(items)


@router.post("/trip/{page_id}/spots/add")
async def add_spot(
    request:        Request,
    page_id:        int,
    name:           str   = Form(...),
    spot_type:      str   = Form("Other"),
    spot_type_custom: str = Form(""),
    cover_url:      str   = Form(""),
    map_url:        str   = Form(""),
    notes:          str   = Form(""),
    priority:       int   = Form(3),
    estimated_cost: float = Form(0.0),
    currency:       str   = Form("USD"),
):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    name = name.strip()
    if not name:
        return JSONResponse({"error": "name required"}, status_code=400)
    new_id = await add_trip_spot(
        page_id=page_id,
        user_id=uid,
        name=name,
        spot_type=_clean_spot_type(spot_type, spot_type_custom),
        cover_url=cover_url.strip(),
        map_url=map_url.strip(),
        notes=notes.strip(),
        priority=max(1, min(5, priority)),
        estimated_cost=max(0.0, estimated_cost),
        currency=currency.strip().upper() or "USD",
    )
    return JSONResponse({"id": new_id}, status_code=201)


@router.put("/trip/{page_id}/spots/{spot_id}")
async def update_spot(
    request:        Request,
    page_id:        int,
    spot_id:        int,
    name:           str   = Form(...),
    spot_type:      str   = Form("Other"),
    spot_type_custom: str = Form(""),
    cover_url:      str   = Form(""),
    map_url:        str   = Form(""),
    notes:          str   = Form(""),
    priority:       int   = Form(3),
    estimated_cost: float = Form(0.0),
    currency:       str   = Form("USD"),
):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    name = name.strip()
    if not name:
        return JSONResponse({"error": "name required"}, status_code=400)
    ok = await update_trip_spot(
        spot_id=spot_id,
        page_id=page_id,
        user_id=uid,
        name=name,
        spot_type=_clean_spot_type(spot_type, spot_type_custom),
        cover_url=cover_url.strip(),
        map_url=map_url.strip(),
        notes=notes.strip(),
        priority=max(1, min(5, priority)),
        estimated_cost=max(0.0, estimated_cost),
        currency=currency.strip().upper() or "USD",
    )
    if not ok:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse({"ok": True})


@router.patch("/trip/{page_id}/spots/{spot_id}/priority")
async def patch_spot_priority(
    request:  Request,
    page_id:  int,
    spot_id:  int,
    priority: int = Form(3),
):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    ok = await update_trip_spot_priority(spot_id, page_id, uid, max(1, min(5, priority)))
    return JSONResponse({"ok": ok})


@router.delete("/trip/{page_id}/spots/{spot_id}")
async def delete_spot(request: Request, page_id: int, spot_id: int):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    ok = await delete_trip_spot(spot_id, page_id, uid)
    return JSONResponse({"ok": ok})


@router.post("/trip/{page_id}/spots/reorder")
async def reorder_spots(request: Request, page_id: int):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    body = await request.json()
    ids = [int(i) for i in body.get("ordered_ids", [])]
    await reorder_trip_spots(page_id, uid, ids)
    return JSONResponse({"ok": True})


# ── Days (Plan tab) ───────────────────────────────────────────────────────────

@router.get("/trip/{page_id}/days")
async def list_days(request: Request, page_id: int):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    days = await get_trip_days(page_id, uid)
    return JSONResponse(days)


@router.post("/trip/{page_id}/days/add")
async def add_day(
    request:   Request,
    page_id:   int,
    day_label: str          = Form(""),
    day_date:  str          = Form(""),
):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    new_id = await add_trip_day(page_id, uid, day_label.strip(), day_date.strip() or None)
    return JSONResponse({"id": new_id}, status_code=201)


@router.put("/trip/{page_id}/days/{day_id}")
async def update_day(
    request:   Request,
    page_id:   int,
    day_id:    int,
    day_label: str = Form(""),
    day_date:  str = Form(""),
):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    ok = await update_trip_day(day_id, page_id, uid, day_label.strip(), day_date.strip() or None)
    return JSONResponse({"ok": ok})


@router.delete("/trip/{page_id}/days/{day_id}")
async def delete_day(request: Request, page_id: int, day_id: int):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    ok = await delete_trip_day(day_id, page_id, uid)
    return JSONResponse({"ok": ok})


@router.post("/trip/{page_id}/days/reorder")
async def reorder_days(request: Request, page_id: int):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    body = await request.json()
    ids = [int(i) for i in body.get("ordered_ids", [])]
    await reorder_trip_days(page_id, uid, ids)
    return JSONResponse({"ok": True})


# ── Day-spot assignment ───────────────────────────────────────────────────────

@router.post("/trip/{page_id}/days/{day_id}/spots/{spot_id}")
async def assign_spot(
    request:    Request,
    page_id:    int,
    day_id:     int,
    spot_id:    int,
    time_label: str = Form(""),
):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    await assign_spot_to_day(day_id, spot_id, time_label.strip())
    return JSONResponse({"ok": True})


@router.put("/trip/{page_id}/days/{day_id}/spots/{spot_id}")
async def update_assigned_spot_time(
    request:    Request,
    page_id:    int,
    day_id:     int,
    spot_id:    int,
    time_label: str = Form(""),
):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    ok = await update_day_spot_time(day_id, spot_id, time_label.strip())
    return JSONResponse({"ok": ok})


@router.delete("/trip/{page_id}/days/{day_id}/spots/{spot_id}")
async def unassign_spot(request: Request, page_id: int, day_id: int, spot_id: int):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    ok = await remove_spot_from_day(day_id, spot_id)
    return JSONResponse({"ok": ok})


@router.post("/trip/{page_id}/days/{day_id}/spots/reorder")
async def reorder_day_spot_order(request: Request, page_id: int, day_id: int):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    body = await request.json()
    ids = [int(i) for i in body.get("ordered_ids", [])]
    await reorder_day_spots(day_id, ids)
    return JSONResponse({"ok": True})


# ── Stats (Chart tab) ─────────────────────────────────────────────────────────

@router.get("/trip/{page_id}/stats")
async def trip_stats(request: Request, page_id: int):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    if not await _get_trip_page(page_id, uid):
        return JSONResponse({"error": "not found"}, status_code=404)
    stats = await get_trip_stats(page_id, uid)
    return JSONResponse(stats)
