"""Catalog CRUD for Uploads Homespace pages.

Mounted with prefix=/home/uploads (shared with home_uploads.py).
All endpoints are JSON — consumed by home-page-uploads-catalogs.js.
Catalogs are many-to-many: files belong to any number of catalogs
simultaneously via upload_catalog_files junction table.
"""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, field_validator

from routers.home_uploads import _demo_guard, _require_uploads_page
from routers.uploads_catalogs_db import (
    add_file_to_catalog,
    create_catalog,
    get_catalogs_for_page,
    get_file_catalogs,
    remove_file_from_catalog,
    soft_delete_catalog,
    update_catalog,
)

router = APIRouter(prefix="/home/uploads", tags=["uploads-catalogs"])

_DEMO_NOOP = Response(status_code=204, headers={"HX-Reswap": "none"})


# ── Pydantic models ────────────────────────────────────────────────────────

class CatalogCreateBody(BaseModel):
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


class CatalogPatchBody(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None   # present + None = move to root
    move_to_root: bool = False         # unambiguous root-move flag
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


class CatalogFileBody(BaseModel):
    upload_id: int


# ── Catalog CRUD ───────────────────────────────────────────────────────────

@router.get("/{page_id}/catalogs")
async def list_catalogs(request: Request, page_id: int):
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)
    catalogs = await get_catalogs_for_page(page_id, uid)
    return JSONResponse({"catalogs": catalogs})


@router.post("/{page_id}/catalogs")
async def add_catalog(request: Request, page_id: int, body: CatalogCreateBody):
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)
    catalog = await create_catalog(page_id, uid, body.name, body.parent_id)
    return JSONResponse(catalog, status_code=201)


@router.patch("/{page_id}/catalogs/{catalog_id}")
async def edit_catalog(
    request: Request,
    page_id: int,
    catalog_id: int,
    body: CatalogPatchBody,
):
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)

    is_parent_set = "parent_id" in body.model_fields_set or body.move_to_root
    resolved_parent = None if body.move_to_root else body.parent_id

    all_catalogs = await get_catalogs_for_page(page_id, uid)
    try:
        catalog = await update_catalog(
            catalog_id, uid, body.name, resolved_parent, is_parent_set,
            all_catalogs, sort_order=body.sort_order,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Catalog not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return JSONResponse(catalog)


@router.delete("/{page_id}/catalogs/{catalog_id}")
async def remove_catalog(request: Request, page_id: int, catalog_id: int):
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)
    deleted = await soft_delete_catalog(catalog_id, uid)
    if not deleted:
        raise HTTPException(status_code=404, detail="Catalog not found")
    return Response(status_code=204)


# ── File ↔ catalog membership ─────────────────────────────────────────────

@router.get("/{page_id}/files/page/{upload_id}/catalogs")
async def list_file_catalogs(request: Request, page_id: int, upload_id: int):
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)
    catalogs = await get_file_catalogs(upload_id, uid)
    return JSONResponse({"catalogs": catalogs})


@router.post("/{page_id}/catalogs/{catalog_id}/files")
async def assign_file(
    request: Request,
    page_id: int,
    catalog_id: int,
    body: CatalogFileBody,
):
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)
    await add_file_to_catalog(catalog_id, body.upload_id, uid)
    return JSONResponse({"ok": True})


@router.delete("/{page_id}/catalogs/{catalog_id}/files/{upload_id}")
async def unassign_file(
    request: Request,
    page_id: int,
    catalog_id: int,
    upload_id: int,
):
    if guard := _demo_guard(request):
        return guard
    uid = request.session.get("user_id")
    await _require_uploads_page(page_id, uid)
    removed = await remove_file_from_catalog(catalog_id, upload_id, uid)
    if not removed:
        raise HTTPException(status_code=404, detail="Membership not found")
    return Response(status_code=204)
