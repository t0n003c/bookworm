"""CRM Homespace page routes.

Mounted with prefix=/home (same as home.py + home_rss.py).
Routes live under /home/crm/{page_id}/...

All endpoints return JSONResponse and are consumed by home-page-crm.js.
The page shell is rendered by home_page_view() in home.py.
"""
from __future__ import annotations

import logging
from fastapi import APIRouter, Form, Request
from fastapi.responses import JSONResponse

from routers.home_db import get_home_page
from routers.home_crm_db import (
    get_contacts, add_contact, update_contact, delete_contact, upsert_field_value,
    get_fields, add_field, update_field, delete_field,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/home")


def _uid(request: Request) -> int:
    uid = request.session.get("user_id")
    if not uid:
        raise PermissionError("not logged in")
    return int(uid)


async def _crm_page(page_id: int, uid: int):
    """Return page dict or None; validates ownership and page_type == 'crm'."""
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "crm":
        return None
    return page


def _err(msg: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=status)


# ── Contacts ──────────────────────────────────────────────────────────────────

@router.get("/crm/{page_id}/contacts")
async def list_contacts(request: Request, page_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await get_contacts(page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("list_contacts page_id=%s", page_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/contacts/add")
async def create_contact(
    request: Request, page_id: int,
    name:         str = Form(""),
    email:        str = Form(""),
    phone:        str = Form(""),
    company:      str = Form(""),
    tags:         str = Form(""),
    avatar_emoji: str = Form("👤"),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        contacts = await add_contact(page_id, uid, name.strip(), email.strip(),
                                     phone.strip(), company.strip(),
                                     tags.strip(), avatar_emoji.strip() or "👤")
        return JSONResponse(contacts)
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("create_contact page_id=%s", page_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/contacts/{contact_id}/update")
async def edit_contact(
    request: Request, page_id: int, contact_id: int,
    name:         str = Form(""),
    email:        str = Form(""),
    phone:        str = Form(""),
    company:      str = Form(""),
    tags:         str = Form(""),
    avatar_emoji: str = Form("👤"),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        contacts = await update_contact(contact_id, page_id, uid, name.strip(),
                                        email.strip(), phone.strip(), company.strip(),
                                        tags.strip(), avatar_emoji.strip() or "👤")
        return JSONResponse(contacts)
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("edit_contact contact_id=%s", contact_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/contacts/{contact_id}/delete")
async def remove_contact(request: Request, page_id: int, contact_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await delete_contact(contact_id, page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("remove_contact contact_id=%s", contact_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/contacts/{contact_id}/field-value")
async def save_field_value(
    request: Request, page_id: int, contact_id: int,
    field_id: int = Form(...),
    value:    str = Form(""),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        # Verify the contact belongs to this page (authz — prevents cross-user writes)
        contacts = await get_contacts(page_id, uid)
        if not any(c["id"] == contact_id for c in contacts):
            return _err("contact not found", 404)
        await upsert_field_value(contact_id, field_id, value.strip())
        return JSONResponse({"ok": True})
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("save_field_value contact_id=%s field_id=%s", contact_id, field_id)
        return _err(str(e), 500)


# ── Custom field definitions ───────────────────────────────────────────────────

@router.get("/crm/{page_id}/fields")
async def list_fields(request: Request, page_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await get_fields(page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("list_fields page_id=%s", page_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/fields/add")
async def create_field(
    request: Request, page_id: int,
    label:      str = Form(...),
    field_type: str = Form("text"),
    options:    str = Form(""),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        VALID_TYPES = {"text", "select", "url", "date", "number"}
        if field_type not in VALID_TYPES:
            return _err(f"invalid field_type '{field_type}'")
        fields = await add_field(page_id, uid, label.strip(), field_type, options.strip())
        return JSONResponse(fields)
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("create_field page_id=%s", page_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/fields/{field_id}/update")
async def edit_field(
    request: Request, page_id: int, field_id: int,
    label:      str = Form(...),
    field_type: str = Form("text"),
    options:    str = Form(""),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        VALID_TYPES = {"text", "select", "url", "date", "number"}
        if field_type not in VALID_TYPES:
            return _err(f"invalid field_type '{field_type}'")
        fields = await update_field(field_id, page_id, uid, label.strip(),
                                    field_type, options.strip())
        return JSONResponse(fields)
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("edit_field field_id=%s", field_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/fields/{field_id}/delete")
async def remove_field(request: Request, page_id: int, field_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await delete_field(field_id, page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("remove_field field_id=%s", field_id)
        return _err(str(e), 500)
