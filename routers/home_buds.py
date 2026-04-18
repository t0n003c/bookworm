"""Buds friendship-health-tracker widget endpoints.

Prefix: /home/buds   (mounted via main.py)
All routes require a valid session.
Widget ownership validated via _require_bud_widget().
No _demo_guard() needed — buds are per-widget / per-user, no global tables.
"""
from __future__ import annotations

import logging
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import JSONResponse
from typing import Optional

from database import get_db
from routers.home_buds_db import (
    list_buds, add_bud, update_bud, delete_bud,
    water_bud, create_fertilize_plan, complete_fertilize_plan,
    crm_lookup, get_user_buds_widgets,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/home/buds")


# ── Auth helpers ──────────────────────────────────────────────────────────────

def _uid(request: Request) -> int:
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="not logged in")
    return int(uid)


async def _require_bud_widget(widget_id: int, user_id: int) -> None:
    """Raise 404 if widget doesn't belong to user or isn't type 'buds'."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT hw.id FROM home_widgets hw "
            "JOIN home_pages hp ON hp.id = hw.page_id "
            "WHERE hw.id=? AND hp.user_id=? AND hw.widget_type='buds'",
            (widget_id, user_id),
        )
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="widget not found")


# ── Routes (static paths MUST come before /{widget_id} parametric paths) ─────

@router.get("/user-widgets")
async def user_widgets(request: Request):
    """Return all Buds widgets owned by the current user."""
    uid = _uid(request)
    widgets = await get_user_buds_widgets(uid)
    return JSONResponse({"widgets": widgets})


@router.get("/crm-lookup/{crm_page_id}")
async def crm_lookup_route(crm_page_id: int, request: Request):
    """Return {contact_id: {health, species, tier, widget_id, bud_id}} map."""
    uid = _uid(request)
    result = await crm_lookup(crm_page_id, uid)
    return JSONResponse(result)


# ── Widget-scoped routes ──────────────────────────────────────────────────────

@router.get("/{widget_id}/list")
async def buds_list(widget_id: int, request: Request):
    uid = _uid(request)
    await _require_bud_widget(widget_id, uid)
    buds = await list_buds(widget_id, uid)
    return JSONResponse({"buds": buds})


@router.post("/{widget_id}/add")
async def buds_add(
    widget_id: int, request: Request,
    name:            str           = Form(...),
    flower_species:  str           = Form("daisy"),
    see_every_days:  int           = Form(7),
    notes:           str           = Form(""),
    crm_contact_id:  Optional[int] = Form(None),
):
    uid = _uid(request)
    await _require_bud_widget(widget_id, uid)
    await add_bud(widget_id, uid, name, flower_species,
                  see_every_days, notes, crm_contact_id)
    buds = await list_buds(widget_id, uid)
    return JSONResponse({"buds": buds})


@router.post("/{widget_id}/{bud_id}/update")
async def buds_update(
    widget_id: int, bud_id: int, request: Request,
    name:           str = Form(None),
    flower_species: str = Form(None),
    see_every_days: int = Form(None),
    notes:          str = Form(None),
):
    uid = _uid(request)
    await _require_bud_widget(widget_id, uid)
    fields = {}
    if name           is not None: fields["name"]           = name
    if flower_species is not None: fields["flower_species"] = flower_species
    if see_every_days is not None: fields["see_every_days"] = see_every_days
    if notes          is not None: fields["notes"]          = notes
    await update_bud(bud_id, uid, **fields)
    buds = await list_buds(widget_id, uid)
    return JSONResponse({"buds": buds})


@router.delete("/{widget_id}/{bud_id}")
async def buds_delete(widget_id: int, bud_id: int, request: Request):
    uid = _uid(request)
    await _require_bud_widget(widget_id, uid)
    deleted = await delete_bud(bud_id, uid)
    if not deleted:
        raise HTTPException(status_code=404, detail="bud not found")
    return JSONResponse({"ok": True})


@router.post("/{widget_id}/{bud_id}/water")
async def buds_water(widget_id: int, bud_id: int, request: Request):
    uid = _uid(request)
    await _require_bud_widget(widget_id, uid)
    try:
        bud = await water_bud(bud_id, uid)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except LookupError:
        raise HTTPException(status_code=404, detail="bud not found")
    return JSONResponse({"bud": bud})


@router.post("/{widget_id}/{bud_id}/fertilize-plan")
async def buds_fertilize_plan(
    widget_id: int, bud_id: int, request: Request,
    planned_date: str = Form(""),
    note:         str = Form(""),
):
    uid = _uid(request)
    await _require_bud_widget(widget_id, uid)
    plan = await create_fertilize_plan(bud_id, uid, planned_date, note)
    return JSONResponse({"plan": plan})


@router.post("/{widget_id}/{bud_id}/fertilize-complete/{plan_id}")
async def buds_fertilize_complete(
    widget_id: int, bud_id: int, plan_id: int, request: Request
):
    uid = _uid(request)
    await _require_bud_widget(widget_id, uid)
    try:
        bud = await complete_fertilize_plan(plan_id, bud_id, uid)
    except LookupError:
        raise HTTPException(status_code=404, detail="plan not found")
    return JSONResponse({"bud": bud})
