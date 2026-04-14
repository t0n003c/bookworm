"""Uploads Homespace page routes.

Mounted with prefix=/home/uploads.
All endpoints are JSON — consumed by home-page-uploads.js.
The page shell is rendered by home_page_view() in home.py.
"""
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from routers.attachments_db import UPLOAD_DIR, delete_attachment_record
from routers.home_db import get_home_page
from routers.uploads_db import (
    create_page_upload,
    get_note_attachment_owned,
    get_page_upload_owned,
    get_uploads_page,
)

router = APIRouter(prefix="/home/uploads", tags=["uploads"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB

_DEMO_NOOP = Response(status_code=204, headers={"HX-Reswap": "none"})


def _demo_guard(request: Request):
    """Return a no-op 204 if the caller is a demo session, else None."""
    if request.session.get("is_demo"):
        return _DEMO_NOOP
    return None


async def _require_uploads_page(page_id: int, uid: int) -> dict:
    """Load page + assert ownership and page_type == 'uploads'."""
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "uploads":
        raise HTTPException(status_code=404, detail="Uploads page not found")
    return page


# ── List files (paginated) ────────────────────────────────────────────────────

@router.get("/{page_id}/files")
async def list_files(request: Request, page_id: int, page: int = 1):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    result = await get_uploads_page(uid, page=page)
    return JSONResponse(result)


# ── Standalone upload ─────────────────────────────────────────────────────────

@router.post("/{page_id}/upload")
async def upload_file(request: Request, page_id: int, file: UploadFile = File(...)):
    if guard := _demo_guard(request):
        return guard

    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 20 MB)")

    original_name = file.filename or "unnamed"
    suffix = Path(original_name).suffix.lower()
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    mime = (
        file.content_type
        or mimetypes.guess_type(original_name)[0]
        or "application/octet-stream"
    )

    (UPLOAD_DIR / stored_name).write_bytes(data)
    await create_page_upload(
        page_id=page_id,
        user_id=uid,
        filename=stored_name,
        original_name=original_name,
        mime_type=mime,
        size=len(data),
    )
    return JSONResponse({"ok": True})


# ── Auth-gated download ───────────────────────────────────────────────────────

@router.get("/{page_id}/files/note/{att_id}/download")
async def download_note_attachment(request: Request, page_id: int, att_id: int):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)

    att = await get_note_attachment_owned(att_id, uid)
    if not att:
        raise HTTPException(status_code=404, detail="File not found")

    disk_path = UPLOAD_DIR / att["filename"]
    if not disk_path.exists():
        raise HTTPException(status_code=404, detail="File missing from storage")

    return FileResponse(
        path=disk_path,
        filename=att["original_name"],
        media_type=att["mime_type"],
    )


@router.get("/{page_id}/files/page/{upload_id}/download")
async def download_page_upload(request: Request, page_id: int, upload_id: int):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)

    upl = await get_page_upload_owned(upload_id, uid)
    if not upl:
        raise HTTPException(status_code=404, detail="File not found")

    disk_path = UPLOAD_DIR / upl["filename"]
    if not disk_path.exists():
        raise HTTPException(status_code=404, detail="File missing from storage")

    return FileResponse(
        path=disk_path,
        filename=upl["original_name"],
        media_type=upl["mime_type"],
    )
