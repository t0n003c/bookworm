"""Uploads Homespace page routes.

Mounted with prefix=/home/uploads.
All endpoints are JSON — consumed by home-page-uploads.js.
The page shell is rendered by home_page_view() in home.py.
"""
import io
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Body, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, field_validator

from routers.attachments_db import UPLOAD_DIR
from routers.home_db import get_home_page
from routers.uploads_db import (
    add_tag_to_file,
    create_page_upload,
    delete_page_upload,
    get_all_user_tags,
    get_note_attachment_owned,
    get_page_upload_owned,
    get_tags_for_file,
    get_uploads_page,
    remove_tag_from_file,
)

router = APIRouter(prefix="/home/uploads", tags=["uploads"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB
_WEBP_SOURCE_TYPES = {"image/jpeg", "image/png", "image/gif"}

_DEMO_NOOP = Response(status_code=204, headers={"HX-Reswap": "none"})


class TagBody(BaseModel):
    tag: str

    @field_validator("tag")
    @classmethod
    def clean_tag(cls, v: str) -> str:
        v = v.strip().lower()
        if not v:
            raise ValueError("tag cannot be empty")
        if len(v) > 50:
            raise ValueError("tag too long (max 50 chars)")
        return v


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


def _valid_src(src: str) -> str:
    if src not in ("note", "page"):
        raise HTTPException(status_code=400, detail="src must be 'note' or 'page'")
    return src


# ── List files (paginated + counts) ──────────────────────────────────────────

@router.get("/{page_id}/files")
async def list_files(
    request: Request,
    page_id: int,
    page: int = 1,
    folder_id: int = Query(None),   # None=all, 0=unfiled, >0=specific folder
    catalog_id: int = Query(None),  # filter by catalog (many-to-many)
    scoped: bool = Query(False),    # Grid picker: scope results to this page only
):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    result = await get_uploads_page(
        uid, page=page, folder_id=folder_id, catalog_id=catalog_id,
        src_page_id=page_id if scoped else None,
    )
    return JSONResponse(result)


# ── Standalone upload (with optional WebP conversion) ────────────────────────

@router.post("/{page_id}/upload")
async def upload_file(
    request: Request,
    page_id: int,
    file: UploadFile = File(...),
    webp: bool = True,
):
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
    # Browsers often send application/octet-stream for text files — prefer extension
    if mime == "application/octet-stream":
        guessed = mimetypes.guess_type(original_name)[0]
        if guessed:
            mime = guessed

    # ── WebP conversion (opt-in via ?webp=true, Pillow optional) ────────────
    if webp and mime in _WEBP_SOURCE_TYPES:
        try:
            from PIL import Image  # noqa: PLC0415
            img = Image.open(io.BytesIO(data))
            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=85)
            data = buf.getvalue()
            mime = "image/webp"
            stored_name = f"{uuid.uuid4().hex}.webp"
        except ImportError:
            pass  # Pillow not installed — keep original format
        except Exception:
            pass  # Corrupted / unsupported mode — keep original

    (UPLOAD_DIR / stored_name).write_bytes(data)
    upload_id = await create_page_upload(
        page_id=page_id,
        user_id=uid,
        filename=stored_name,
        original_name=original_name,
        mime_type=mime,
        size=len(data),  # reflects WebP size if converted
    )
    return JSONResponse({"ok": True, "upload_id": upload_id})


# ── Delete standalone file ────────────────────────────────────────────────────

@router.delete("/{page_id}/files/page/{upload_id}")
async def delete_file(request: Request, page_id: int, upload_id: int):
    if guard := _demo_guard(request):
        return guard

    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)

    filename = await delete_page_upload(upload_id, uid)
    if not filename:
        raise HTTPException(status_code=404, detail="File not found")

    (UPLOAD_DIR / filename).unlink(missing_ok=True)
    return JSONResponse({"ok": True})


# ── Auth-gated downloads ──────────────────────────────────────────────────────

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

    return FileResponse(path=disk_path, filename=att["original_name"],
                        media_type=att["mime_type"])


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

    return FileResponse(path=disk_path, filename=upl["original_name"],
                        media_type=upl["mime_type"])


# ── Tag endpoints ─────────────────────────────────────────────────────────────

@router.get("/{page_id}/tags")
async def list_all_tags(request: Request, page_id: int):
    """All distinct tags this user has applied (for autocomplete)."""
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    tags = await get_all_user_tags(uid)
    return JSONResponse({"tags": tags})


@router.get("/{page_id}/files/{src}/{upload_id}/tags")
async def get_file_tags(request: Request, page_id: int, src: str, upload_id: int):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    _valid_src(src)
    tags = await get_tags_for_file(src, upload_id, uid)
    return JSONResponse({"tags": tags})


@router.post("/{page_id}/files/{src}/{upload_id}/tags")
async def add_file_tag(
    request: Request, page_id: int, src: str, upload_id: int, body: TagBody
):
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    _valid_src(src)
    tags = await add_tag_to_file(src, upload_id, uid, body.tag)
    return JSONResponse({"tags": tags})


@router.delete("/{page_id}/files/{src}/{upload_id}/tags/{tag}")
async def remove_file_tag(
    request: Request, page_id: int, src: str, upload_id: int, tag: str
):
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    _valid_src(src)
    tags = await remove_tag_from_file(src, upload_id, uid, tag.strip().lower())
    return JSONResponse({"tags": tags})
