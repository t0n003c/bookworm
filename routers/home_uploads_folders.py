"""Virtual folder CRUD for Uploads Homespace pages.

Mounted with prefix=/home/uploads (shared with home_uploads.py).
All endpoints are JSON — consumed by home-page-uploads-folders.js.
"""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, field_validator

from routers.home_db import get_home_page
from routers.uploads_folders_db import (
    assign_file_folder,
    create_folder,
    delete_folder,
    get_folders_for_page,
    update_folder,
)

router = APIRouter(prefix="/home/uploads", tags=["uploads-folders"])

_DEMO_NOOP = Response(status_code=204, headers={"HX-Reswap": "none"})


# ── local guards (intentionally not imported cross-router) ─────────────────

def _demo_guard(request: Request):
    if request.session.get("is_demo"):
        return _DEMO_NOOP
    return None


async def _require_uploads_page(page_id: int, uid: int) -> dict:
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "uploads":
        raise HTTPException(status_code=404, detail="Uploads page not found")
    return page


# ── Pydantic models ────────────────────────────────────────────────────────

class FolderCreateBody(BaseModel):
    name: str
    parent_id: Optional[int] = None

    @field_validator("name")
    @classmethod
    def clean(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 80:
            raise ValueError("name too long (max 80 chars)")
        return v


class FolderPatchBody(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None   # present + None = move to root
    move_to_root: bool = False         # explicit flag to unambiguously move to root
    sort_order: Optional[int] = None   # reorder without reparenting

    @field_validator("name")
    @classmethod
    def clean(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 80:
            raise ValueError("name too long (max 80 chars)")
        return v


class FileFolderBody(BaseModel):
    folder_id: Optional[int] = None   # None = unfile


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/{page_id}/folders")
async def list_folders(request: Request, page_id: int):
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)
    folders = await get_folders_for_page(page_id, uid)
    return JSONResponse({"folders": folders})


@router.post("/{page_id}/folders")
async def add_folder(request: Request, page_id: int, body: FolderCreateBody):
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)
    folder = await create_folder(page_id, uid, body.name, body.parent_id)
    return JSONResponse(folder, status_code=201)


@router.patch("/{page_id}/folders/{folder_id}")
async def edit_folder(
    request: Request,
    page_id: int,
    folder_id: int,
    body: FolderPatchBody,
):
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)

    # Resolve parent: move_to_root flag → None; field present → use value
    is_parent_set = "parent_id" in body.model_fields_set or body.move_to_root
    resolved_parent = None if body.move_to_root else body.parent_id

    all_folders = await get_folders_for_page(page_id, uid)
    try:
        folder = await update_folder(
            folder_id, uid, body.name, resolved_parent, is_parent_set, all_folders,
            sort_order=body.sort_order,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Folder not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return JSONResponse(folder)


@router.delete("/{page_id}/folders/{folder_id}")
async def remove_folder(request: Request, page_id: int, folder_id: int):
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)
    deleted = await delete_folder(folder_id, uid)
    if not deleted:
        raise HTTPException(status_code=404, detail="Folder not found")
    return Response(status_code=204)


@router.patch("/{page_id}/files/page/{upload_id}/folder")
async def set_file_folder(
    request: Request,
    page_id: int,
    upload_id: int,
    body: FileFolderBody,
):
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)
    updated = await assign_file_folder(upload_id, uid, body.folder_id)
    if not updated:
        raise HTTPException(status_code=404, detail="File not found")
    return JSONResponse({"ok": True})
