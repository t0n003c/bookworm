"""CRM Homespace page routes.

Mounted with prefix=/home (same as home.py + home_rss.py).
Routes live under /home/crm/{page_id}/...

All endpoints return JSONResponse and are consumed by home-page-crm.js.
The page shell is rendered by home_page_view() in home.py.
"""
from __future__ import annotations

import datetime
import json
import logging
from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi.responses import JSONResponse

from routers.attachments_db import UPLOAD_DIR
from routers.home_db import get_home_page
from routers.home_crm_db import (
    get_contacts, add_contact, update_contact, update_contact_pic,
    delete_contact, reorder_contacts, upsert_field_value,
    get_fields, add_field, update_field, delete_field,
    get_stages, add_stage, update_stage, delete_stage, reorder_stages,
    get_deals, add_deal, update_deal, move_deal, delete_deal,
    get_projects, add_project, update_project, delete_project, set_stage_project,
    get_contact_reminders, add_contact_reminder, update_contact_reminder,
    delete_contact_reminder, advance_crm_reminder,
    get_due_crm_reminders, get_upcoming_crm_reminders,
    get_all_crm_reminders, get_upcoming_birthdays,
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
    name:           str = Form(""),
    email:          str = Form(""),
    phone:          str = Form(""),
    company:        str = Form(""),
    tags:           str = Form(""),
    avatar_emoji:   str = Form("🧑"),
    profile_pic:    str = Form(""),
    birthday:       str = Form(""),
    first_met_date: str = Form(""),
    relationship:   str = Form(""),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        contacts = await add_contact(page_id, uid, name.strip(), email.strip(),
                                     phone.strip(), company.strip(),
                                     tags.strip(), avatar_emoji.strip() or "🧑",
                                     profile_pic.strip(),
                                     birthday.strip(), first_met_date.strip(),
                                     relationship.strip())
        return JSONResponse(contacts)
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("create_contact page_id=%s", page_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/contacts/{contact_id}/update")
async def edit_contact(
    request: Request, page_id: int, contact_id: int,
    name:           str = Form(""),
    email:          str = Form(""),
    phone:          str = Form(""),
    company:        str = Form(""),
    tags:           str = Form(""),
    avatar_emoji:   str = Form("🧑"),
    profile_pic:    str = Form(""),
    birthday:       str = Form(""),
    first_met_date: str = Form(""),
    relationship:   str = Form(""),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        contacts = await update_contact(contact_id, page_id, uid, name.strip(),
                                        email.strip(), phone.strip(), company.strip(),
                                        tags.strip(), avatar_emoji.strip() or "🧑",
                                        profile_pic.strip(),
                                        birthday.strip(), first_met_date.strip(),
                                        relationship.strip())
        return JSONResponse(contacts)
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("edit_contact contact_id=%s", contact_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/contacts/{contact_id}/upload-pic")
async def upload_contact_pic(
    request: Request, page_id: int, contact_id: int,
    file: UploadFile = File(...),
):
    """Upload a profile picture for a contact. Returns {url: str}."""
    _ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
    _ALLOWED_EXT   = {"jpg", "jpeg", "png", "gif", "webp"}
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        if file.content_type not in _ALLOWED_TYPES:
            return _err("Only JPG, PNG, GIF, WEBP images are allowed")
        raw_ext = (file.filename or "").rsplit(".", 1)[-1].lower()
        ext = raw_ext if raw_ext in _ALLOWED_EXT else "jpg"
        data = await file.read()
        if len(data) > 3 * 1024 * 1024:
            return _err("File too large — max 3 MB")
        pic_dir = UPLOAD_DIR / "crm-pics"
        pic_dir.mkdir(parents=True, exist_ok=True)
        fpath = pic_dir / f"c{page_id}_{contact_id}.{ext}"
        fpath.write_bytes(data)
        pic_url = f"/uploads/crm-pics/{fpath.name}"
        await update_contact_pic(contact_id, page_id, uid, pic_url)
        return JSONResponse({"url": pic_url})
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("upload_contact_pic contact_id=%s", contact_id)
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


@router.post("/crm/{page_id}/contacts/reorder")
async def reorder_contacts_handler(request: Request, page_id: int):
    """Body: JSON array of contact IDs in the desired display order."""
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        body = await request.body()
        ordered_ids = json.loads(body)
        if not isinstance(ordered_ids, list):
            return _err("body must be a JSON array of contact IDs")
        return JSONResponse(await reorder_contacts(page_id, uid, [int(i) for i in ordered_ids]))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("reorder_contacts page_id=%s", page_id)
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
        VALID_TYPES = {"text", "select", "url", "date", "number", "email", "checkbox", "multi_select", "file_links"}
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
        VALID_TYPES = {"text", "select", "url", "date", "number", "email", "checkbox", "multi_select", "file_links"}
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


# ── Stages (Phase 2) ─────────────────────────────────────────────────────────

@router.get("/crm/{page_id}/stages")
async def list_stages(request: Request, page_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return JSONResponse([])
        return JSONResponse(await get_stages(page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("list_stages page_id=%s", page_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/stages/add")
async def create_stage(
    request: Request, page_id: int,
    name:       str = Form("New Stage"),
    color:      str = Form("#0053e2"),
    project_id: str = Form(""),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        pid = int(project_id) if project_id.strip() else None
        return JSONResponse(await add_stage(page_id, uid, name.strip() or "New Stage", color.strip(), pid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("create_stage page_id=%s", page_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/stages/{stage_id}/update")
async def edit_stage(
    request: Request, page_id: int, stage_id: int,
    name:       str = Form(...),
    color:      str = Form("#0053e2"),
    project_id: str = Form(""),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        pid = int(project_id) if project_id.strip() else None
        return JSONResponse(await update_stage(stage_id, page_id, uid, name.strip(), color.strip(), pid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("edit_stage stage_id=%s", stage_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/stages/{stage_id}/delete")
async def remove_stage(request: Request, page_id: int, stage_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await delete_stage(stage_id, page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("remove_stage stage_id=%s", stage_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/stages/reorder")
async def reages_handler(request: Request, page_id: int):
    """Body: JSON array of stage IDs in desired order."""
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        body = await request.body()
        ordered_ids = json.loads(body)
        if not isinstance(ordered_ids, list):
            return _err("body must be a JSON array of stage IDs")
        return JSONResponse(await reorder_stages(page_id, uid, [int(i) for i in ordered_ids]))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("reorder_stages page_id=%s", page_id)
        return _err(str(e), 500)


# ── Projects ────────────────────────────────────────────────────────

@router.get("/crm/{page_id}/projects")
async def list_projects(request: Request, page_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return JSONResponse([])
        return JSONResponse(await get_projects(page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("list_projects page_id=%s", page_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/projects/add")
async def create_project(
    request: Request, page_id: int,
    name:  str = Form("Project"),
    color: str = Form("#0053e2"),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await add_project(page_id, uid, name.strip() or "Project", color.strip()))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("create_project page_id=%s", page_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/projects/{project_id}/update")
async def edit_project(
    request: Request, page_id: int, project_id: int,
    name:  str = Form(""),
    color: str = Form("#0053e2"),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await update_project(project_id, page_id, uid, name.strip(), color.strip()))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("edit_project project_id=%s", project_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/projects/{project_id}/delete")
async def remove_project(request: Request, page_id: int, project_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await delete_project(project_id, page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("delete_project project_id=%s", project_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/stages/{stage_id}/set-project")
async def assign_stage_project(
    request: Request, page_id: int, stage_id: int,
    project_id: str = Form(""),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        pid = int(project_id) if project_id.strip() else None
        return JSONResponse(await set_stage_project(stage_id, page_id, uid, pid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("assign_stage_project stage_id=%s", stage_id)
        return _err(str(e), 500)


# ── Deals (Phase 2) ────────────────────────────────────────────────────────

@router.get("/crm/{page_id}/deals")
async def list_deals(request: Request, page_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return JSONResponse([])
        return JSONResponse(await get_deals(page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("list_deals page_id=%s", page_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/deals/add")
async def create_deal(
    request: Request, page_id: int,
    title:      str  = Form(...),
    stage_id:   str  = Form(""),       # empty string = unsorted
    contact_id: str  = Form(""),
    value:      float = Form(0),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        sid = int(stage_id) if stage_id.strip() else None
        cid = int(contact_id) if contact_id.strip() else None
        return JSONResponse(await add_deal(page_id, uid, sid, cid, title.strip(), value))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("create_deal page_id=%s", page_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/deals/{deal_id}/update")
async def edit_deal(
    request: Request, page_id: int, deal_id: int,
    title:      str   = Form(...),
    contact_id: str   = Form(""),
    value:      float = Form(0),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        cid = int(contact_id) if contact_id.strip() else None
        return JSONResponse(await update_deal(deal_id, page_id, uid, title.strip(), value, cid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("edit_deal deal_id=%s", deal_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/deals/{deal_id}/move")
async def move_deal_handler(
    request: Request, page_id: int, deal_id: int,
    stage_id:   str = Form(""),
    sort_order: int = Form(0),
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        sid = int(stage_id) if stage_id.strip() else None
        return JSONResponse(await move_deal(deal_id, page_id, uid, sid, sort_order))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("move_deal deal_id=%s", deal_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/deals/{deal_id}/delete")
async def remove_deal(request: Request, page_id: int, deal_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await delete_deal(deal_id, page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("remove_deal deal_id=%s", deal_id)
        return _err(str(e), 500)


# ── Contact Reminders ─────────────────────────────────────────────────────────────────────

@router.get("/crm/{page_id}/contacts/{contact_id}/reminders")
async def list_contact_reminders(request: Request, page_id: int, contact_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await get_contact_reminders(contact_id))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("list_contact_reminders contact_id=%s", contact_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/contacts/{contact_id}/reminders/add")
async def add_reminder(
    request: Request,
    page_id: int,
    contact_id: int,
    field_id: int = Form(...),
    label: str = Form(""),
    message: str = Form(""),
    reminder_date: str = Form(...),
    reminder_time: str = Form("09:00"),
    recurrence: str = Form("none"),
):
    _VALID_REC = {"none", "daily", "weekly", "biweekly", "monthly", "yearly"}
    _VALID_UNITS = {"days", "weeks", "months", "years"}
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        date_str = reminder_date.strip()
        try:
            datetime.date.fromisoformat(date_str)
        except ValueError:
            return _err("invalid date — expected YYYY-MM-DD", 400)
        rec_raw = recurrence.strip()
        if rec_raw in _VALID_REC:
            rec = rec_raw
        elif rec_raw.startswith("custom:"):
            parts = rec_raw.split(":")
            valid = (
                len(parts) == 3
                and parts[2] in _VALID_UNITS
                and parts[1].isdigit()
                and int(parts[1]) >= 1
            )
            rec = rec_raw if valid else "none"
        else:
            rec = "none"
        return JSONResponse(await add_contact_reminder(
            contact_id, field_id, uid,
            label.strip() or "Reminder",
            date_str, reminder_time.strip() or "09:00",
            message.strip(), rec,
        ))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("add_reminder contact_id=%s", contact_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/contacts/{contact_id}/reminders/{reminder_id}/update")
async def edit_reminder(
    request: Request, page_id: int, contact_id: int, reminder_id: int,
    label: str = Form(""), message: str = Form(""),
    reminder_date: str = Form(...), reminder_time: str = Form("09:00"),
    recurrence: str = Form("none"),
):
    _VALID_REC = {"none", "daily", "weekly", "biweekly", "monthly", "yearly"}
    _VALID_UNITS = {"days", "weeks", "months", "years"}
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        date_str = reminder_date.strip()
        try:
            datetime.date.fromisoformat(date_str)
        except ValueError:
            return _err("invalid date", 400)
        rec_raw = recurrence.strip()
        if rec_raw in _VALID_REC:
            rec = rec_raw
        elif rec_raw.startswith("custom:"):
            parts = rec_raw.split(":")
            rec = rec_raw if (
                len(parts) == 3 and parts[2] in _VALID_UNITS
                and parts[1].isdigit() and int(parts[1]) >= 1
            ) else "none"
        else:
            rec = "none"
        return JSONResponse(await update_contact_reminder(
            reminder_id, contact_id, uid,
            label.strip() or "Reminder",
            date_str, reminder_time.strip() or "09:00",
            message.strip(), rec,
        ))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("edit_reminder reminder_id=%s", reminder_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/contacts/{contact_id}/reminders/{reminder_id}/delete")
async def remove_reminder(
    request: Request, page_id: int, contact_id: int, reminder_id: int,
):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await delete_contact_reminder(reminder_id, contact_id))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("remove_reminder reminder_id=%s", reminder_id)
        return _err(str(e), 500)


@router.post("/crm/{page_id}/contacts/{contact_id}/reminders/{reminder_id}/advance")
async def advance_reminder(
    request: Request,
    page_id: int,
    contact_id: int,
    reminder_id: int,
):
    """Advance a recurring reminder to its next occurrence (called after a toast fires)."""
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        advanced = await advance_crm_reminder(reminder_id, uid)
        return JSONResponse({"advanced": advanced})
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("advance_reminder reminder_id=%s", reminder_id)
        return _err(str(e), 500)


@router.get("/crm-reminders/due")
async def crm_reminders_due(
    request: Request,
    date: str = Query(default=""),
):
    try:
        uid = _uid(request)
        date_str = date.strip()
        if len(date_str) != 10:
            date_str = datetime.date.today().isoformat()
        return JSONResponse(await get_due_crm_reminders(uid, date_str))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("crm_reminders_due")
        return _err(str(e), 500)


@router.get("/crm/{page_id}/reminders/upcoming")
async def crm_upcoming_reminders(request: Request, page_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        today = datetime.date.today().isoformat()
        return JSONResponse(await get_upcoming_crm_reminders(page_id, uid, today))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("crm_upcoming_reminders page_id=%s", page_id)
        return _err(str(e), 500)


@router.get("/crm/{page_id}/reminders/all")
async def crm_all_reminders(request: Request, page_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await get_all_crm_reminders(page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("crm_all_reminders page_id=%s", page_id)
        return _err(str(e), 500)


@router.get("/crm/{page_id}/birthdays/upcoming")
async def crm_upcoming_birthdays(request: Request, page_id: int):
    try:
        uid = _uid(request)
        if not await _crm_page(page_id, uid):
            return _err("page not found", 404)
        return JSONResponse(await get_upcoming_birthdays(page_id, uid))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("crm_upcoming_birthdays page_id=%s", page_id)
        return _err(str(e), 500)
