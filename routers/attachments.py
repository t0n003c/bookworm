"""FastAPI router for note attachments (upload / delete / serve list)."""
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse

from templates_env import templates
from routers.attachments_db import (
    UPLOAD_DIR,
    create_attachment,
    delete_attachment_record,
    get_attachment_by_id,
    get_attachments_for_note,
)

router = APIRouter(prefix="/notes", tags=["attachments"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB


@router.post("/{note_id}/attachments", response_class=HTMLResponse)
async def upload_attachment(request: Request, note_id: int, file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 20 MB)")

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
    att = await get_attachment_by_id(attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

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