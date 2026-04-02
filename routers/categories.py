"""FastAPI router for categories and attribute definitions."""
from fastapi import APIRouter, Form, Request, HTTPException
from fastapi.responses import HTMLResponse
from templates_env import templates
from typing import Optional

from routers.categories_db import (
    get_categories_for_workspace,
    get_categories_used_in_workspaces,
    create_category,
    delete_category,
    get_all_attr_defs,
    create_attr_def,
    delete_attr_def,
)
from routers.workspaces_db import get_descendant_ids

router = APIRouter(tags=["meta"])



# ---------------------------------------------------------------------------
# Categories  (all endpoints are workspace-scoped via ?workspace_id=)
# ---------------------------------------------------------------------------

@router.get("/categories", response_class=HTMLResponse)
async def list_categories(request: Request, workspace_id: Optional[int] = None):
    categories = await get_categories_for_workspace(workspace_id)
    return templates.TemplateResponse(
        request,
        "partials/category_list.html",
        {"categories": categories, "workspace_id": workspace_id},
    )


@router.get("/categories/filter", response_class=HTMLResponse)
async def filter_categories(request: Request, workspace_id: Optional[int] = None):
    """Return filter checkboxes for categories ACTUALLY USED by notes in
    this workspace (and all its descendant workspaces).

    Called directly via htmx.ajax() in refreshCatFilter(wsId) whenever the
    active workspace changes.
    """
    if workspace_id is not None:
        ws_ids = list(await get_descendant_ids(workspace_id))
    else:
        ws_ids = []
    categories = await get_categories_used_in_workspaces(ws_ids)
    return templates.TemplateResponse(
        request,
        "partials/cat_filter.html",
        {"categories": categories, "workspace_id": workspace_id},
    )


@router.post("/categories", response_class=HTMLResponse)
async def add_category(
    request: Request,
    name: str = Form(...),
    color: str = Form(default="#0053e2"),
    description: Optional[str] = Form(default=None),
    workspace_id: Optional[int] = Form(default=None),
):
    try:
        await create_category(
            name=name,
            color=color,
            description=description,
            workspace_id=workspace_id,
        )
    except Exception:
        pass  # unique constraint; silently skip duplicates
    categories = await get_categories_for_workspace(workspace_id)
    # Return both the manage list AND an OOB swap for the filter checkboxes
    return templates.TemplateResponse(
        request,
        "partials/category_manage_oob.html",
        {"categories": categories, "workspace_id": workspace_id},
    )


@router.delete("/categories/{cat_id}", response_class=HTMLResponse)
async def remove_category(
    request: Request,
    cat_id: int,
    workspace_id: Optional[int] = None,
):
    await delete_category(cat_id, workspace_id=workspace_id)
    categories = await get_categories_for_workspace(workspace_id)
    # Return both the manage list AND an OOB swap for the filter checkboxes
    return templates.TemplateResponse(
        request,
        "partials/category_manage_oob.html",
        {"categories": categories, "workspace_id": workspace_id},
    )


# ---------------------------------------------------------------------------
# Attribute Definitions
# ---------------------------------------------------------------------------

@router.get("/attr-defs", response_class=HTMLResponse)
async def list_attr_defs(request: Request):
    attr_defs = await get_all_attr_defs()
    return templates.TemplateResponse(
        request,
        "partials/attr_def_list.html",
        {"attr_defs": attr_defs},
    )


@router.post("/attr-defs", response_class=HTMLResponse)
async def add_attr_def(
    request: Request,
    name: str = Form(...),
    field_type: str = Form(default="text"),
    options: Optional[str] = Form(default=None),
):
    try:
        await create_attr_def(name=name, field_type=field_type, options=options)
    except Exception:
        pass
    attr_defs = await get_all_attr_defs()
    return templates.TemplateResponse(
        request,
        "partials/attr_def_list.html",
        {"attr_defs": attr_defs},
    )


@router.delete("/attr-defs/{def_id}", response_class=HTMLResponse)
async def remove_attr_def(request: Request, def_id: int):
    await delete_attr_def(def_id)
    attr_defs = await get_all_attr_defs()
    return templates.TemplateResponse(
        request,
        "partials/attr_def_list.html",
        {"attr_defs": attr_defs},
    )
