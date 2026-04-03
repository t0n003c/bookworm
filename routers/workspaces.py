"""FastAPI router for workspace management (HTMX partials)."""
from typing import Optional

from fastapi import APIRouter, Form, Query, Request
from fastapi.responses import HTMLResponse
from templates_env import templates


def _parse_ws_id(raw: Optional[str]) -> Optional[int]:
    """Safely coerce a form string to int.

    HTMX 1.x can serialise JS ``undefined`` as the literal string
    ``"undefined"``, and empty hidden inputs arrive as ``""``.  Both
    should be treated as *no workspace selected* (i.e. ``None``).
    """
    if not raw or raw in ("undefined", "null", "None"):
        return None
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None

from routers.workspaces_db import (
    get_all_workspaces,
    get_open_workspaces,
    get_workspace_tree,
    get_workspace_breadcrumb,
    get_descendant_ids,
    create_workspace,
    update_workspace,
    open_workspace,
    close_workspace,
    get_first_workspace_id,
    toggle_workspace_favorite,
    delete_workspace,
    restore_workspace,
    reparent_workspace,
    reorder_workspace,
    permanent_delete_workspace,
    get_trashed_workspaces,
)
from routers.notes_db import search_notes
from routers.categories_db import (
    get_categories_for_workspace,
    copy_categories_to_workspace,
    seed_default_categories_for_workspace,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


async def _ws_context(active_ws_id: Optional[int], sort_by: Optional[list[str]] = None) -> dict:
    """Build the shared context needed by workspace_switch.html."""
    open_wss        = await get_open_workspaces()
    all_wss         = await get_all_workspaces()
    ws_tree         = await get_workspace_tree()
    trashed_wss     = await get_trashed_workspaces()
    categories      = await get_categories_for_workspace(active_ws_id)
    # Expand active workspace to include all descendants so search spans the subtree
    ws_id_set = await get_descendant_ids(active_ws_id) if active_ws_id is not None else None
    notes     = await search_notes(workspace_ids=list(ws_id_set), sort_by=sort_by) if ws_id_set is not None else []
    open_ids  = {ws["id"] for ws in open_wss}
    # Build breadcrumb list for every open tab
    breadcrumbs: dict[int, list[dict]] = {}
    for ws in open_wss:
        breadcrumbs[ws["id"]] = await get_workspace_breadcrumb(ws["id"])
    # also include the active workspace even if it isn't pinned to the top bar
    if active_ws_id is not None and active_ws_id not in breadcrumbs:
        breadcrumbs[active_ws_id] = await get_workspace_breadcrumb(active_ws_id)
    return {
        "notes":              notes,
        "categories":         categories,
        "open_workspaces":    open_wss,
        "all_workspaces":     all_wss,
        "ws_tree":            ws_tree,
        "trashed_workspaces": trashed_wss,
        "breadcrumbs":        breadcrumbs,
        "active_ws_id":       active_ws_id,
        "open_count":         len(open_wss),
        "open_ws_ids":        open_ids,
    }


@router.get("/switch/{workspace_id}", response_class=HTMLResponse)
async def switch_workspace(
    request: Request,
    workspace_id: int,
    sort_by: list[str] = Query(default=[]),
):
    ctx = await _ws_context(workspace_id, sort_by=sort_by or None)
    resp = templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)
    # Tell HTMX to update the browser URL so a page reload lands on this workspace.
    # This is authoritative — overrides any client-side pushUrl / replaceState.
    resp.headers["HX-Replace-URL"] = f"/?ws={workspace_id}"
    return resp


@router.post("", response_class=HTMLResponse)
async def create_workspace_handler(
    request: Request,
    name: str = Form(...),
    emoji: str = Form(default="\U0001f4c1"),
    parent_id: Optional[str] = Form(default=None),
):
    """Create a workspace (optionally as a child), open it, switch to it.

    Category inheritance rules:
    - Child workspace  → copies parent's category set (then independently editable)
    - Root workspace   → gets all existing categories as a starting set
    """
    pid = int(parent_id) if parent_id and parent_id.strip().isdigit() else None
    ws_id = await create_workspace(name=name, emoji=emoji, parent_id=pid)
    if pid:
        await copy_categories_to_workspace(from_ws_id=pid, to_ws_id=ws_id)
    else:
        await seed_default_categories_for_workspace(ws_id)
    ctx = await _ws_context(ws_id)
    return templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)


@router.patch("/{workspace_id}", response_class=HTMLResponse)
async def update_workspace_handler(
    request: Request,
    workspace_id: int,
    name: str = Form(...),
    emoji: str = Form(default="\U0001f4c1"),
    parent_id: Optional[str] = Form(default=None),
):
    """Rename / re-icon / re-parent a workspace."""
    pid = int(parent_id) if parent_id and parent_id.strip().isdigit() else None
    await update_workspace(
        workspace_id=workspace_id,
        name=name,
        emoji=emoji,
        parent_id=pid,
    )
    ctx = await _ws_context(workspace_id)
    return templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)


@router.post("/{workspace_id}/open", response_class=HTMLResponse)
async def open_workspace_handler(
    request: Request,
    workspace_id: int,
    sort_by: list[str] = Query(default=[]),
):
    await open_workspace(workspace_id)
    ctx = await _ws_context(workspace_id, sort_by=sort_by or None)
    resp = templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)
    resp.headers["HX-Replace-URL"] = f"/?ws={workspace_id}"
    return resp


@router.post("/{workspace_id}/close", response_class=HTMLResponse)
async def close_workspace_handler(
    request: Request,
    workspace_id: int,
    active_ws_id: Optional[int] = Form(default=None),
):
    await close_workspace(workspace_id)
    open_wss = await get_open_workspaces()
    if active_ws_id and active_ws_id != workspace_id:
        still_active = active_ws_id
    else:
        still_active = open_wss[0]["id"] if open_wss else None
    ctx = await _ws_context(still_active)
    resp = templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)
    if still_active is not None:
        resp.headers["HX-Replace-URL"] = f"/?ws={still_active}"
    return resp


@router.post("/{workspace_id}/favorite", response_class=HTMLResponse)
async def toggle_favorite_handler(
    request: Request,
    workspace_id: int,
    active_ws_id: Optional[str] = Form(default=None),
):
    """Toggle favorite status and re-render the full workspace sidebar list."""
    await toggle_workspace_favorite(workspace_id)
    ctx = await _ws_context(_parse_ws_id(active_ws_id))
    return templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)


@router.post("/{workspace_id}/delete", response_class=HTMLResponse)
async def delete_workspace_handler(
    request: Request,
    workspace_id: int,
    active_ws_id: Optional[str] = Form(default=None),
):
    """Soft-delete a workspace AND its entire subtree, then navigate away."""
    parsed = _parse_ws_id(active_ws_id)
    deleted_ids = await delete_workspace(workspace_id)
    open_wss = await get_open_workspaces()
    # Stay on the active workspace only if it wasn't part of the deleted subtree
    if parsed and parsed not in deleted_ids:
        still_active = parsed
    elif open_wss:
        still_active = open_wss[0]["id"]
    else:
        still_active = await get_first_workspace_id()
    ctx = await _ws_context(still_active)
    return templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)


@router.post("/{workspace_id}/restore", response_class=HTMLResponse)
async def restore_workspace_handler(
    request: Request,
    workspace_id: int,
    active_ws_id: Optional[str] = Form(default=None),
    new_parent_id: Optional[str] = Form(default=None),
):
    """Restore a workspace from the trash.

    When called from drag-and-drop, new_parent_id can re-home the workspace
    under a different parent (or to root when new_parent_id is empty string).
    """
    await restore_workspace(workspace_id)
    # If drag-and-drop supplied a new parent, honour it.
    # empty-string  → promote to root (parent_id = NULL)
    # None          → keep original parent (don't touch parent_id)
    if new_parent_id is not None:
        pid = _parse_ws_id(new_parent_id)  # None means root
        await reparent_workspace(workspace_id, pid)
    ctx = await _ws_context(_parse_ws_id(active_ws_id) or workspace_id)
    return templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)


@router.post("/{workspace_id}/reparent", response_class=HTMLResponse)
async def reparent_workspace_handler(
    request: Request,
    workspace_id: int,
    new_parent_id: Optional[str] = Form(default=None),
    active_ws_id: Optional[str] = Form(default=None),
):
    """Move a workspace under a new parent (drag-and-drop reorder/nest).

    new_parent_id == '' or missing  → promote to root.
    Silently rejects cycles: dropping a workspace onto one of its own
    descendants is a no-op.
    """
    parsed_parent = _parse_ws_id(new_parent_id)
    # Cycle guard: new parent must not be inside the dragged workspace's subtree
    if parsed_parent is not None:
        subtree = await get_descendant_ids(workspace_id)
        if parsed_parent in subtree:
            # Invalid drop — just re-render without changes
            ctx = await _ws_context(_parse_ws_id(active_ws_id))
            return templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)
    await reparent_workspace(workspace_id, parsed_parent)
    ctx = await _ws_context(_parse_ws_id(active_ws_id))
    return templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)


@router.post("/{workspace_id}/reorder", response_class=HTMLResponse)
async def reorder_workspace_handler(
    request: Request,
    workspace_id: int,
    relative_to_id: int = Form(...),
    position: str = Form(...),          # 'before' | 'after'
    active_ws_id: Optional[str] = Form(default=None),
):
    """Insert workspace_id before or after relative_to_id in the sidebar tree.

    Silently rejects cycles (dropping inside own subtree).
    """
    if position not in ('before', 'after'):
        position = 'after'
    # Cycle guard: the reference must not be inside the dragged workspace's subtree
    subtree = await get_descendant_ids(workspace_id)
    if relative_to_id in subtree:
        ctx = await _ws_context(_parse_ws_id(active_ws_id))
        return templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)
    await reorder_workspace(workspace_id, relative_to_id, position)
    ctx = await _ws_context(_parse_ws_id(active_ws_id))
    return templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)


@router.post("/{workspace_id}/permanent-delete", response_class=HTMLResponse)
async def permanent_delete_handler(
    request: Request,
    workspace_id: int,
    active_ws_id: Optional[int] = Form(default=None),
):
    """Permanently destroy a trashed workspace and all its notes."""
    await permanent_delete_workspace(workspace_id)
    open_wss = await get_open_workspaces()
    if active_ws_id and active_ws_id != workspace_id:
        still_active = active_ws_id
    elif open_wss:
        still_active = open_wss[0]["id"]
    else:
        still_active = await get_first_workspace_id()
    ctx = await _ws_context(still_active)
    return templates.TemplateResponse(request, "partials/workspace_switch.html", ctx)
