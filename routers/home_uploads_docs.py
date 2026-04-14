"""Document Studio — read, edit, combine, sign, and convert uploaded files.

Companion router for home_uploads.py.  All routes live under /home/uploads/{page_id}.
Kept separate from home_uploads.py (already 8.9 KB) for cohesion and line-limit hygiene.

Phase 4 endpoints (all implemented here):
  GET  /{pid}/files/{src}/{id}/content    read text or Word doc as text/HTML
  PUT  /{pid}/files/page/{id}/content     save edited text back to disk
  POST /{pid}/files/page/combine          merge PDFs or join text files
  POST /{pid}/files/page/{id}/convert     docx↔pdf, txt→pdf, pdf→txt
  POST /{pid}/files/page/{id}/sign        stamp a drawn signature onto a PDF page
"""
from __future__ import annotations

import base64
import io
import uuid
from html import escape

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from routers.attachments_db import UPLOAD_DIR
from routers.home_uploads import _demo_guard, _require_uploads_page, _valid_src
from routers.uploads_db import (
    create_page_upload,
    get_note_attachment_owned,
    get_page_upload_owned,
)
from routers.uploads_docs_db import get_page_upload_owned_bulk, update_page_upload_size

router = APIRouter(prefix="/home/uploads", tags=["uploads-docs"])

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MAX_EDIT_BYTES = 1_000_000  # 1 MB guard on textarea saves


# ── Pydantic models ───────────────────────────────────────────────────────────

class ContentBody(BaseModel):
    content: str


class CombineBody(BaseModel):
    ids: list[int]
    output_name: str = ""
    combine_type: str  # "pdf" | "text"


class ConvertBody(BaseModel):
    to_format: str  # "pdf" | "txt"


class SignBody(BaseModel):
    signature_data: str   # data:image/png;base64,…
    page_num: int = 0


# ── GET /{pid}/files/{src}/{id}/content ───────────────────────────────────────

@router.get("/{page_id}/files/{src}/{file_id}/content")
async def read_content(request: Request, page_id: int, src: str, file_id: int):
    """Return full file content as plain text or docx-derived HTML."""
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    src = _valid_src(src)

    row = await (
        get_note_attachment_owned(file_id, uid)
        if src == "note"
        else get_page_upload_owned(file_id, uid)
    )
    if not row:
        raise HTTPException(status_code=404)

    mime = row["mime_type"]
    disk_path = UPLOAD_DIR / row["filename"]

    if mime.startswith("text/") or mime == "application/json":
        try:
            text = disk_path.read_text(encoding="utf-8", errors="replace")
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Could not read file") from exc
        return JSONResponse({"content": text, "content_type": "text"})

    if mime == _DOCX_MIME:
        try:
            from docx import Document  # python-docx — imported lazily to skip startup cost
            doc = Document(disk_path)
            paras = [escape(p.text) for p in doc.paragraphs if p.text.strip()]
            html = "<br>".join(f"<p>{p}</p>" for p in paras) or "<p><em>Empty document</em></p>"
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Could not parse Word document") from exc
        return JSONResponse({"content": html, "content_type": "docx_html"})

    raise HTTPException(status_code=400, detail="Content read not supported for this file type")


# ── PUT /{pid}/files/page/{id}/content ────────────────────────────────────────

@router.put("/{page_id}/files/page/{file_id}/content")
async def save_content(request: Request, page_id: int, file_id: int, body: ContentBody):
    """Overwrite a text file's content. page-src only."""
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)

    row = await get_page_upload_owned(file_id, uid)
    if not row:
        raise HTTPException(status_code=404)

    mime = row["mime_type"]
    if not (mime.startswith("text/") or mime == "application/json"):
        raise HTTPException(status_code=400, detail="Only text files are editable")

    data = body.content.encode("utf-8")
    if len(data) > MAX_EDIT_BYTES:
        raise HTTPException(status_code=413, detail="Content exceeds the 1 MB edit limit")

    try:
        (UPLOAD_DIR / row["filename"]).write_bytes(data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not write file") from exc

    await update_page_upload_size(file_id, uid, len(data))
    return JSONResponse({"ok": True, "size": len(data)})


# ── POST /{pid}/files/page/combine ────────────────────────────────────────────

@router.post("/{page_id}/files/page/combine")
async def combine_files(request: Request, page_id: int, body: CombineBody):
    """Merge 2–20 PDFs into one, or concatenate 2–20 text files."""
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)

    if not 2 <= len(body.ids) <= 20:
        raise HTTPException(status_code=400, detail="Select 2–20 files to combine")

    rows = await get_page_upload_owned_bulk(body.ids, uid)
    if len(rows) != len(body.ids):
        raise HTTPException(status_code=404, detail="One or more files not found")

    out_stem = (body.output_name.strip() or "combined")[:80]

    if body.combine_type == "pdf":
        if any(r["mime_type"] != "application/pdf" for r in rows):
            raise HTTPException(status_code=400, detail="All selected files must be PDFs for PDF merge")
        import pypdf
        writer = pypdf.PdfWriter()
        for r in rows:
            reader = pypdf.PdfReader(str(UPLOAD_DIR / r["filename"]))
            for pg in reader.pages:
                writer.add_page(pg)
        buf = io.BytesIO()
        writer.write(buf)
        data = buf.getvalue()
        stored = f"{uuid.uuid4().hex}.pdf"
        (UPLOAD_DIR / stored).write_bytes(data)
        new_id = await create_page_upload(
            page_id, uid, stored, f"{out_stem}.pdf", "application/pdf", len(data),
        )
        return JSONResponse({"ok": True, "file": {
            "id": new_id, "original_name": f"{out_stem}.pdf", "size": len(data),
        }})

    if body.combine_type == "text":
        if any(not r["mime_type"].startswith("text/") for r in rows):
            raise HTTPException(status_code=400, detail="All selected files must be text files for text join")
        parts: list[str] = []
        for r in rows:
            parts.append(f"── {r['original_name']} ──\n")
            parts.append((UPLOAD_DIR / r["filename"]).read_text(encoding="utf-8", errors="replace"))
            parts.append("\n\n")
        data = "".join(parts).encode("utf-8")
        stored = f"{uuid.uuid4().hex}.txt"
        (UPLOAD_DIR / stored).write_bytes(data)
        new_id = await create_page_upload(
            page_id, uid, stored, f"{out_stem}.txt", "text/plain", len(data),
        )
        return JSONResponse({"ok": True, "file": {
            "id": new_id, "original_name": f"{out_stem}.txt", "size": len(data),
        }})

    raise HTTPException(status_code=400, detail="combine_type must be 'pdf' or 'text'")


# ── POST /{pid}/files/page/{id}/convert ───────────────────────────────────────

@router.post("/{page_id}/files/page/{file_id}/convert")
async def convert_file(request: Request, page_id: int, file_id: int, body: ConvertBody):
    """Convert docx/txt → pdf, or docx/pdf → txt.  Always creates a new file."""
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)

    row = await get_page_upload_owned(file_id, uid)
    if not row:
        raise HTTPException(status_code=404)

    mime = row["mime_type"]
    disk_path = UPLOAD_DIR / row["filename"]
    src_stem = row["original_name"].rsplit(".", 1)[0]
    to_fmt = body.to_format.lower()

    if to_fmt not in ("pdf", "txt"):
        raise HTTPException(status_code=400, detail="to_format must be 'pdf' or 'txt'")

    if to_fmt == "txt":
        if mime == _DOCX_MIME:
            from docx import Document
            doc = Document(disk_path)
            text = "\n".join(p.text for p in doc.paragraphs)
        elif mime == "application/pdf":
            import pypdf
            reader = pypdf.PdfReader(str(disk_path))
            text = "\n\n".join(pg.extract_text() or "" for pg in reader.pages)
        else:
            raise HTTPException(status_code=400, detail="Only PDF or DOCX can be converted to TXT")
        data = text.encode("utf-8")
        stored = f"{uuid.uuid4().hex}.txt"
        (UPLOAD_DIR / stored).write_bytes(data)
        new_id = await create_page_upload(
            page_id, uid, stored, f"{src_stem}.txt", "text/plain", len(data),
        )
        return JSONResponse({"ok": True, "file": {
            "id": new_id, "original_name": f"{src_stem}.txt", "size": len(data),
        }})

    # to_fmt == "pdf"
    if mime.startswith("text/"):
        text = disk_path.read_text(encoding="utf-8", errors="replace")
    elif mime == _DOCX_MIME:
        from docx import Document
        doc = Document(disk_path)
        text = "\n".join(p.text for p in doc.paragraphs)
    else:
        raise HTTPException(status_code=400, detail="Only TXT or DOCX can be converted to PDF")

    data = _text_to_pdf_bytes(text)
    stored = f"{uuid.uuid4().hex}.pdf"
    (UPLOAD_DIR / stored).write_bytes(data)
    new_id = await create_page_upload(
        page_id, uid, stored, f"{src_stem}.pdf", "application/pdf", len(data),
    )
    return JSONResponse({"ok": True, "file": {
        "id": new_id, "original_name": f"{src_stem}.pdf", "size": len(data),
    }})


def _text_to_pdf_bytes(text: str) -> bytes:
    """Render plain text to PDF bytes using reportlab.  Lazy import."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import pt
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=72, rightMargin=72, topMargin=72, bottomMargin=72,
    )
    styles = getSampleStyleSheet()
    story = []
    for line in text.splitlines():
        story.append(Paragraph(escape(line) if line.strip() else "&nbsp;", styles["Normal"]))
        story.append(Spacer(1, 4 * pt))
    if not story:
        story.append(Paragraph("(empty)", styles["Normal"]))
    doc.build(story)
    return buf.getvalue()


# ── POST /{pid}/files/page/{id}/sign ─────────────────────────────────────────

@router.post("/{page_id}/files/page/{file_id}/sign")
async def sign_pdf(request: Request, page_id: int, file_id: int, body: SignBody):
    """Stamp a drawn signature onto the specified page of a PDF (in-place)."""
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)

    row = await get_page_upload_owned(file_id, uid)
    if not row or row["mime_type"] != "application/pdf":
        raise HTTPException(status_code=400, detail="File must be a PDF")

    try:
        _, b64 = body.signature_data.split(",", 1)
        sig_bytes = base64.b64decode(b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid signature data") from exc

    try:
        import PIL.Image
        import pypdf
        from reportlab.lib.utils import ImageReader
        from reportlab.pdfgen import canvas as rl_canvas

        sig_img = PIL.Image.open(io.BytesIO(sig_bytes)).convert("RGBA")
        reader = pypdf.PdfReader(str(UPLOAD_DIR / row["filename"]))
        writer = pypdf.PdfWriter()
        writer.append(reader)

        pg_idx = min(body.page_num, len(writer.pages) - 1)
        target_page = writer.pages[pg_idx]
        pg_w = float(target_page.mediabox.width)
        pg_h = float(target_page.mediabox.height)

        # Fixed placement: lower-right, 30% of page width, 0.5 in margins
        sig_w_pt = pg_w * 0.30
        sig_h_pt = sig_w_pt * sig_img.height / sig_img.width
        x_pt = pg_w - sig_w_pt - 36
        y_pt = 36

        overlay_buf = io.BytesIO()
        c = rl_canvas.Canvas(overlay_buf, pagesize=(pg_w, pg_h))
        c.drawImage(ImageReader(sig_img), x_pt, y_pt,
                    width=sig_w_pt, height=sig_h_pt, mask="auto")
        c.save()

        overlay_reader = pypdf.PdfReader(overlay_buf)
        target_page.merge_page(overlay_reader.pages[0])

        out_buf = io.BytesIO()
        writer.write(out_buf)
        data = out_buf.getvalue()
    except (HTTPException, ValueError):
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Signature stamping failed: {exc}") from exc

    (UPLOAD_DIR / row["filename"]).write_bytes(data)
    await update_page_upload_size(file_id, uid, len(data))
    return JSONResponse({"ok": True, "size": len(data)})
