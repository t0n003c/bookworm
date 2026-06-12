"""FastAPI router for note attachments (upload / delete / serve list)."""
import mimetypes
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse

from templates_env import templates
from app.api.attachments_db import (
    UPLOAD_DIR,
    create_attachment,
    delete_attachment_record,
    get_attachment_by_id,
    get_attachments_for_note,
)
from app.api.sharing_db import note_belongs_to_user
from core.config import settings

router = APIRouter(prefix="/notes", tags=["attachments"])

# Centralised config (single source of truth) — was os.getenv("BW_MAX_UPLOAD_MB").
_MAX_MB = settings.max_upload_mb
MAX_UPLOAD_BYTES = _MAX_MB * 1024 * 1024


@router.post("/{note_id}/attachments", response_class=HTMLResponse)
async def upload_attachment(request: Request, note_id: int, file: UploadFile = File(...)):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    if not await note_belongs_to_user(note_id, uid):
        raise HTTPException(status_code=403, detail="Not authorised")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {_MAX_MB} MB)")

    original_name = file.filename or "unnamed"
    suffix = Path(original_name).suffix.lower()
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    mime = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"

    (UPLOAD_DIR / stored_name).write_bytes(data)
    await create_attachment(
        note_id=note_id,
        filename=stored_name,
        original_name=original_name,
        mime_type=mime,
        size=len(data),
    )

    attachments = await get_attachments_for_note(note_id)
    return templates.TemplateResponse(
        request,
        "partials/note_attachments.html",
        {"attachments": attachments, "note_id": note_id, "editable": True},
    )


@router.delete("/attachments/{attachment_id}", response_class=HTMLResponse)
async def delete_attachment(request: Request, attachment_id: int):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)

    att = await get_attachment_by_id(attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    if not await note_belongs_to_user(att["note_id"], uid):
        raise HTTPException(status_code=403, detail="Not authorised")

    note_id = att["note_id"]
    filename = await delete_attachment_record(attachment_id)
    if filename:
        disk_path = UPLOAD_DIR / filename
        if disk_path.exists():
            disk_path.unlink()

    attachments = await get_attachments_for_note(note_id)
    return templates.TemplateResponse(
        request,
        "partials/note_attachments.html",
        {"attachments": attachments, "note_id": note_id, "editable": True},
    )