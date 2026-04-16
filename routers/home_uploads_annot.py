"""PDF Annotation endpoints — Document Studio Phase 8 (Feature B2).

Annotations are stored as percentage-based coordinates in `pdf_annotations`.
The PDF on disk is never modified — overlays are rendered client-side by
home-page-uploads-annot.js using PDF.js + absolutely-positioned divs.

All routes live under /home/uploads/{page_id} (same prefix as home_uploads_docs).

Endpoints:
  GET    /{pid}/files/page/{fid}/annotations           list annotations
  POST   /{pid}/files/page/{fid}/annotations           create annotation
  PUT    /{pid}/files/page/{fid}/annotations/{aid}     update position + content
  DELETE /{pid}/files/page/{fid}/annotations/{aid}     delete annotation
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, field_validator

from routers.home_uploads import _demo_guard, _require_uploads_page
from routers.uploads_db import get_page_upload_owned
from routers.uploads_docs_db import (
    create_annotation,
    delete_annotation,
    get_annotations,
    update_annotation,
)

router = APIRouter(prefix="/home/uploads", tags=["uploads-annot"])

_VALID_ANNOT_TYPES = {"highlight", "sticky", "textbox"}


# ── Pydantic model ────────────────────────────────────────────────────────────

class AnnotationBody(BaseModel):
    page_num:   int   = 0
    type:       str   = "highlight"
    x_pct:      float = 0.0
    y_pct:      float = 0.0
    width_pct:  float = 0.2
    height_pct: float = 0.05
    color:      str   = "#ffc220"
    content:    str   = ""

    @field_validator("type")
    @classmethod
    def _check_type(cls, v: str) -> str:
        if v not in _VALID_ANNOT_TYPES:
            raise ValueError(f"type must be one of {sorted(_VALID_ANNOT_TYPES)}")
        return v


# ── Shared auth guard ─────────────────────────────────────────────────────────

async def _annot_auth(request: Request, page_id: int, file_id: int) -> tuple[int, dict]:
    """Validate session + page + file ownership. Returns (uid, file_row)."""
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    row = await get_page_upload_owned(file_id, uid)
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    return uid, row


# ── GET — list annotations ────────────────────────────────────────────────────

@router.get("/{page_id}/files/page/{file_id}/annotations")
async def list_annotations(request: Request, page_id: int, file_id: int):
    uid, _ = await _annot_auth(request, page_id, file_id)
    rows = await get_annotations(file_id, uid)
    return JSONResponse({"annotations": rows})


# ── POST — create annotation ──────────────────────────────────────────────────

@router.post("/{page_id}/files/page/{file_id}/annotations")
async def add_annotation(request: Request, page_id: int, file_id: int, body: AnnotationBody):
    if guard := _demo_guard(request):
        return guard
    uid, _ = await _annot_auth(request, page_id, file_id)
    annot_id = await create_annotation(file_id, uid, body)
    return JSONResponse({"id": annot_id}, status_code=201)


# ── PUT — update annotation ───────────────────────────────────────────────────

@router.put("/{page_id}/files/page/{file_id}/annotations/{annot_id}")
async def edit_annotation(
    request: Request, page_id: int, file_id: int, annot_id: int, body: AnnotationBody,
):
    if guard := _demo_guard(request):
        return guard
    uid, _ = await _annot_auth(request, page_id, file_id)
    n = await update_annotation(annot_id, uid, body)
    if n == 0:
        raise HTTPException(status_code=404, detail="Annotation not found")
    return JSONResponse({"ok": True})


# ── DELETE — remove annotation ────────────────────────────────────────────────

@router.delete("/{page_id}/files/page/{file_id}/annotations/{annot_id}")
async def remove_annotation(request: Request, page_id: int, file_id: int, annot_id: int):
    if guard := _demo_guard(request):
        return guard
    uid, _ = await _annot_auth(request, page_id, file_id)
    n = await delete_annotation(annot_id, uid)
    if n == 0:
        raise HTTPException(status_code=404, detail="Annotation not found")
    return Response(status_code=204)
