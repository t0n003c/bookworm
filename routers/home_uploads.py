"""Uploads Homespace page routes.

Mounted with prefix=/home/uploads.
All endpoints are JSON — consumed by home-page-uploads.js.
The page shell is rendered by home_page_view() in home.py.
"""
import io
import json
import mimetypes
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Body, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, field_validator

from routers.attachments_db import UPLOAD_DIR, delete_attachment_record
from routers.auth_db import get_unlimited_uploads
from database import get_db
from routers.home_db import get_home_page
from routers.uploads_db import (
    add_tag_to_file,
    create_page_upload,
    delete_page_upload,
    get_all_user_tags,
    get_note_attachment_owned,
    get_page_upload_owned,
    get_page_uploads_by_ids,
    remove_upload_from_card_attr,
    get_tags_for_file,
    get_uploads_page,
    remove_tag_from_file,
)

router = APIRouter(prefix="/home/uploads", tags=["uploads"])

# Configurable via BW_MAX_UPLOAD_MB env var (default 200 MB).
# Bump to 500+ for large video libraries; keep at 20 for image-only teams.
_MAX_MB = int(os.getenv("BW_MAX_UPLOAD_MB", "200"))
MAX_UPLOAD_BYTES = _MAX_MB * 1024 * 1024
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


class BulkFileRef(BaseModel):
    src: str
    id: int


class BulkTagBody(BaseModel):
    ids: list[BulkFileRef]
    tag: str

    @field_validator("tag")
    @classmethod
    def clean_bulk_tag(cls, v: str) -> str:
        v = v.strip().lower()
        if not v or len(v) > 50:
            raise ValueError("tag must be 1\u201350 chars")
        return v


class BulkDeleteBody(BaseModel):
    ids: list[BulkFileRef]


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


import base64
import html as _html
from pathlib import Path

# File-type sets used by the preview endpoint
_IMAGE_EXTS = {"jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"}
_VIDEO_EXTS = {"mp4", "webm", "ogg", "ogv", "mov", "avi", "mkv", "m4v"}
_TEXT_EXTS  = {"txt", "md", "csv", "log", "json", "xml",
               "yaml", "yml", "ini", "cfg", "toml", "rst"}
_PREVIEW_MAX_CHARS = 50_000  # truncate large text files in the popup


def _file_ext(name: str) -> str:
    """Lower-cased extension without the dot, or '' if none."""
    return name.lower().rsplit(".", 1)[-1] if "." in name else ""


def _docx_to_html(filepath: Path) -> str:
    """Convert .docx → HTML, preserving headings, bold/italic/underline, inline images."""
    import docx as _docx
    from docx.oxml.ns import qn

    doc = _docx.Document(str(filepath))

    # Pre-build {rId: data-URI} for every image relationship in the document part.
    _EMBED = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"
    img_map: dict[str, str] = {}
    for rId, rel in doc.part.rels.items():
        if "image" in rel.reltype.lower():
            try:
                blob = rel.target_part.blob
                ct   = rel.target_part.content_type or "image/png"
                img_map[rId] = f"data:{ct};base64,{base64.b64encode(blob).decode()}"
            except Exception:
                pass  # skip unreadable parts

    parts: list[str] = []
    for para in doc.paragraphs:
        style = (para.style.name or "") if para.style else ""
        if "Heading 1" in style:
            tag, cls = "h2", "text-xl font-bold mt-4 mb-2 text-gray-900 dark:text-zinc-100"
        elif "Heading 2" in style:
            tag, cls = "h3", "text-lg font-semibold mt-3 mb-1 text-gray-800 dark:text-zinc-200"
        elif "Heading" in style:
            tag, cls = "h4", "text-base font-semibold mt-2 mb-1 text-gray-700 dark:text-zinc-300"
        else:
            tag, cls = "p", "mb-1.5 leading-relaxed text-gray-700 dark:text-zinc-300"

        inner = ""
        has_image = False
        for run in para.runs:
            # Inline image? Check for <w:drawing> inside the run element.
            drawing = run._r.find(qn("w:drawing"))
            if drawing is not None:
                # Full namespace — same as qn("a:blip") but no extra import needed
                blip = drawing.find(
                    ".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip"
                )
                if blip is not None:
                    rId = blip.get(_EMBED)
                    if rId and rId in img_map:
                        inner += (
                            f'<img src="{img_map[rId]}" alt="embedded image"'
                            f' class="max-w-full my-2 rounded block" loading="lazy">'
                        )
                        has_image = True
                        continue
            # Plain text run
            t = _html.escape(run.text)
            if run.bold:      t = f"<strong>{t}</strong>"
            if run.italic:    t = f"<em>{t}</em>"
            if run.underline: t = f"<u>{t}</u>"
            inner += t

        if not inner and not has_image:
            raw = para.text
            if raw.strip():
                inner = _html.escape(raw)   # fallback: plain text
            else:
                parts.append("<br>")
                continue

        parts.append(f'<{tag} class="{cls}">{inner}</{tag}>')

    return "\n".join(parts)


# ── File preview (upload_preview widget) ────────────────────────────────────
# Fixed route — above /{page_id}/… to avoid Starlette routing conflicts.


@router.get("/preview")
async def preview_file(request: Request, id: int = Query(...)):
    """Return a type-tagged preview payload for image / video / pdf / text / docx files.

    Auth-gated + ownership-verified.  Response shape:
      {type, title, filename, ...type-specific fields}
    where type ∈ {image, video, pdf, text, docx, unsupported}.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    rows = await get_page_uploads_by_ids([id], uid)
    if not rows:
        raise HTTPException(status_code=404)
    row      = rows[0]
    filename = row["filename"]
    original = row.get("original_name") or filename
    mime     = row.get("mime_type") or ""
    filepath = UPLOAD_DIR / filename
    ext      = _file_ext(original)
    base     = {"title": original, "filename": filename}

    # ── Image: let the browser render it ──────────────────────────────────────
    if mime.startswith("image/") or ext in _IMAGE_EXTS:
        return JSONResponse({**base, "type": "image", "url": f"/uploads/{filename}"})

    # ── Video: native <video> player ─────────────────────────────────────────
    if mime.startswith("video/") or ext in _VIDEO_EXTS:
        return JSONResponse({**base, "type": "video", "url": f"/uploads/{filename}"})

    # ── PDF: iframe ───────────────────────────────────────────────────────────
    if mime == "application/pdf" or ext == "pdf":
        return JSONResponse({**base, "type": "pdf", "url": f"/uploads/{filename}"})

    # ── Plain text / code / markdown / CSV / etc. ───────────────────────────
    if mime.startswith("text/") or ext in _TEXT_EXTS:
        if not filepath.exists():
            raise HTTPException(status_code=404, detail="File not found on disk")
        try:
            try:
                text = filepath.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                text = filepath.read_text(encoding="latin-1")
            truncated = len(text) > _PREVIEW_MAX_CHARS
            return JSONResponse({**base, "type": "text",
                                  "text": text[:_PREVIEW_MAX_CHARS], "truncated": truncated})
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Could not read file: {exc}")

    # ── Docx ─────────────────────────────────────────────────────────────────
    is_docx = (
        mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or ext == "docx"
    )
    if is_docx:
        if not filepath.exists():
            raise HTTPException(status_code=404, detail="File not found on disk")
        try:
            body_html = _docx_to_html(filepath)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Could not read document: {exc}")
        return JSONResponse({**base, "type": "docx", "html": body_html})

    return JSONResponse({**base, "type": "unsupported", "mime": mime})



# Fixed route — declared before /{page_id}/… so Starlette never mistakes
# the string "pinned-files" for a page_id int.


@router.get("/pinned-files")
async def pinned_files(request: Request, ids: str = Query("")):
    """Return file metadata for a comma-separated list of page_upload IDs.

    Auth-gated. Only rows owned by the requesting user are returned.
    IDs that don't exist or belong to another user are silently omitted.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()]
    rows = await get_page_uploads_by_ids(id_list, uid)
    return JSONResponse(rows)


@router.get("/file-widget-usage")
async def file_widget_usage(request: Request, ids: str = Query("")):
    """Return which upload_preview widgets each file is pinned to.

    Auth-gated. Response shape:
      {"<file_id>": [{widget_id, widget_name, page_id, page_name, page_emoji}, ...]}
    Only widgets owned by the requesting user are included.
    File IDs that are not pinned to any widget are omitted from the response.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)

    id_set = {int(x) for x in ids.split(",") if x.strip().isdigit()}
    if not id_set:
        return JSONResponse({})

    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT hw.id AS widget_id, hw.config_json,
                   hp.id AS page_id, hp.name AS page_name, hp.emoji AS page_emoji
            FROM home_widgets hw
            JOIN home_pages hp ON hw.page_id = hp.id
            WHERE hp.user_id = ? AND hw.widget_type = 'upload_preview'
            """,
            (uid,),
        )
        rows = [dict(r) for r in await cur.fetchall()]

    result: dict[int, list[dict]] = {}
    for row in rows:
        try:
            cfg = json.loads(row["config_json"] or "{}")
        except Exception:
            cfg = {}
        pinned = cfg.get("upload_ids", [])
        if not isinstance(pinned, list):
            continue
        # Widget display name: prefer custom_name when show_name is set
        raw_name = (cfg.get("custom_name") or "").strip() if cfg.get("show_name") else ""
        widget_name = raw_name or "File Review"
        for fid in pinned:
            if isinstance(fid, int) and fid in id_set:
                result.setdefault(fid, []).append({
                    "widget_id":   row["widget_id"],
                    "widget_name": widget_name,
                    "page_id":     row["page_id"],
                    "page_name":   row["page_name"],
                    "page_emoji":  row["page_emoji"] or "",
                })

    # JSON object keys must be strings
    return JSONResponse({str(k): v for k, v in result.items()})


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
    if len(data) > MAX_UPLOAD_BYTES and not await get_unlimited_uploads(uid):
        raise HTTPException(
            status_code=413,
            detail=f"File too large — max {_MAX_MB} MB per file. "
                   f"Ask your admin to raise BW_MAX_UPLOAD_MB or enable Unlimited Uploads.",
        )

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

    await remove_upload_from_card_attr(upload_id, uid)
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


# ── Bulk operations ───────────────────────────────────────────────────────────────

@router.post("/{page_id}/files/bulk/tag-add")
async def bulk_add_tag(request: Request, page_id: int, body: BulkTagBody):
    """Add a tag to every selected file in one shot."""
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    for ref in body.ids:
        await add_tag_to_file(_valid_src(ref.src), ref.id, uid, body.tag)
    return JSONResponse({"ok": True, "count": len(body.ids)})


@router.post("/{page_id}/files/bulk/tag-remove")
async def bulk_remove_tag(request: Request, page_id: int, body: BulkTagBody):
    """Remove a tag from every selected file."""
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    for ref in body.ids:
        await remove_tag_from_file(_valid_src(ref.src), ref.id, uid, body.tag)
    return JSONResponse({"ok": True, "count": len(body.ids)})


@router.post("/{page_id}/files/bulk/delete")
async def bulk_delete_files(request: Request, page_id: int, body: BulkDeleteBody):
    """Delete every selected file; each ownership-checked individually."""
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    deleted, errors = 0, 0
    for ref in body.ids:
        try:
            if ref.src == "page":
                fname = await delete_page_upload(ref.id, uid)
                if fname:
                    (UPLOAD_DIR / fname).unlink(missing_ok=True)
                    deleted += 1
                else:
                    errors += 1
            elif ref.src == "note":
                att = await get_note_attachment_owned(ref.id, uid)
                if att:
                    fname = await delete_attachment_record(ref.id)
                    if fname:
                        (UPLOAD_DIR / fname).unlink(missing_ok=True)
                    deleted += 1
                else:
                    errors += 1
            else:
                errors += 1  # unknown src — count it, don't silently swallow
        except Exception:
            errors += 1
    return JSONResponse({"ok": True, "deleted": deleted, "errors": errors})
