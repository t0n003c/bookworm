"""FastAPI router for notes (returns HTMX HTML partials)."""
import re
from datetime import date as date_type
from typing import Optional
from fastapi import APIRouter, Form, Query, Request, HTTPException
from fastapi.responses import HTMLResponse
from templates_env import templates

from routers.notes_db import (
    get_note_by_id,
    patch_note_content,
    search_notes,
    create_note,
    update_note,
    delete_note,
)
from routers.categories_db import get_categories_for_workspace, get_all_attr_defs
from routers.workspaces_db import get_descendant_ids

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("", response_class=HTMLResponse)
async def list_notes(
    request: Request,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    category_ids: Optional[str] = None,  # comma-separated
    workspace_id: Optional[int] = None,
    sort_by: list[str] = Query(default=[]),
):
    cat_ids = [int(x) for x in category_ids.split(",") if x.strip()] if category_ids else []
    import datetime
    with open("debug_requests.log", "a") as _f:
        _f.write(f"{datetime.datetime.now().isoformat()} GET /notes  workspace_id={workspace_id!r}  q={q!r}\n")

    # Guard: never return unscoped notes (would expose all users' data).
    # Without a workspace the note list is empty and shows the welcome state.
    if workspace_id is None:
        return templates.TemplateResponse(
            request,
            "partials/note_list.html",
            {"notes": [], "active_ws_id": None},
        )

    ws_ids = list(await get_descendant_ids(workspace_id))
    notes = await search_notes(
        q=q or None,
        date_from=date_from or None,
        date_to=date_to or None,
        category_ids=cat_ids or None,
        workspace_ids=ws_ids,
        sort_by=sort_by or None,
    )
    return templates.TemplateResponse(
        request,
        "partials/note_list.html",
        {"notes": notes, "active_ws_id": workspace_id},
    )


@router.get("/form/new", response_class=HTMLResponse)
async def new_note_form(request: Request, workspace_id: Optional[int] = None):
    categories = await get_categories_for_workspace(workspace_id)
    attr_defs = await get_all_attr_defs()
    today = date_type.today().isoformat()
    return templates.TemplateResponse(
        request,
        "partials/note_form.html",
        {
            "note": None,
            "categories": categories,
            "attr_defs": attr_defs,
            "today": today,
            "workspace_id": workspace_id,
        },
    )


@router.get("/{note_id}/form", response_class=HTMLResponse)
async def edit_note_form(request: Request, note_id: int):
    note = await get_note_by_id(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    ws_id = note.get("workspace_id")
    categories = await get_categories_for_workspace(ws_id)
    attr_defs = await get_all_attr_defs()
    return templates.TemplateResponse(
        request,
        "partials/note_form.html",
        {
            "note": note,
            "is_edit": True,
            "categories": categories,
            "attr_defs": attr_defs,
            "today": note["meeting_date"],
            "workspace_id": ws_id,
        },
    )


@router.get("/{note_id}", response_class=HTMLResponse)
async def view_note(request: Request, note_id: int):
    note = await get_note_by_id(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return templates.TemplateResponse(
        request,
        "partials/note_detail.html",
        {"note": note},
    )


@router.post("/{note_id}/toggle-todo", response_class=HTMLResponse)
async def toggle_todo_handler(
    request: Request,
    note_id: int,
    index: int = Form(...),
):
    """Toggle the Nth checkbox (0-based) in a note's markdown content."""
    note = await get_note_by_id(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    content = note.get("content") or ""
    todo_pattern = re.compile(r"(- \[)( |x)(\] )")
    matches = list(todo_pattern.finditer(content))

    if 0 <= index < len(matches):
        m = matches[index]
        new_state = "x" if m.group(2) == " " else " "
        content = content[:m.start(2)] + new_state + content[m.end(2):]
        await patch_note_content(note_id, content)
        note = await get_note_by_id(note_id)

    return templates.TemplateResponse(
        request,
        "partials/note_detail.html",
        {"note": note},
    )


@router.post("", response_class=HTMLResponse)
async def create_note_handler(
    request: Request,
    title: str = Form(...),
    icon: Optional[str] = Form(default=None),
    content: str = Form(default=""),
    meeting_date: str = Form(...),
    category_ids: list[str] = Form(default=[]),
    attr_keys: list[str] = Form(default=[]),
    attr_values: list[str] = Form(default=[]),
    workspace_id: Optional[int] = Form(default=None),
):
    cat_ids = [int(c) for c in category_ids if c]
    attributes = [
        {"key": k.strip(), "value": v.strip()}
        for k, v in zip(attr_keys, attr_values)
        if k.strip()
    ]
    note_id = await create_note(
        title=title,
        icon=icon or None,
        content=content,
        meeting_date=meeting_date,
        category_ids=cat_ids,
        attributes=attributes,
        workspace_id=workspace_id,
    )
    note = await get_note_by_id(note_id)
    categories = await get_categories_for_workspace(workspace_id)
    attr_defs = await get_all_attr_defs()
    ws_ids = list(await get_descendant_ids(workspace_id)) if workspace_id is not None else None
    notes = await search_notes(workspace_ids=ws_ids)
    return templates.TemplateResponse(
        request,
        "partials/after_save.html",
        {
            "note": note,
            "notes": notes,
            "categories": categories,
            "attr_defs": attr_defs,
        },
    )


@router.post("/{note_id}", response_class=HTMLResponse)
async def update_note_handler(
    request: Request,
    note_id: int,
    title: str = Form(...),
    icon: Optional[str] = Form(default=None),
    content: str = Form(default=""),
    meeting_date: str = Form(...),
    category_ids: list[str] = Form(default=[]),
    attr_keys: list[str] = Form(default=[]),
    attr_values: list[str] = Form(default=[]),
    workspace_id: Optional[int] = Form(default=None),
):
    cat_ids = [int(c) for c in category_ids if c]
    attributes = [
        {"key": k.strip(), "value": v.strip()}
        for k, v in zip(attr_keys, attr_values)
        if k.strip()
    ]
    success = await update_note(
        note_id=note_id,
        title=title,
        icon=icon or None,
        content=content,
        meeting_date=meeting_date,
        category_ids=cat_ids,
        attributes=attributes,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Note not found")
    note = await get_note_by_id(note_id)
    ws_id = int(workspace_id or note.get("workspace_id") or 0) or None
    ws_ids = list(await get_descendant_ids(ws_id)) if ws_id is not None else None
    notes = await search_notes(workspace_ids=ws_ids)
    categories = await get_categories_for_workspace(ws_id)
    attr_defs = await get_all_attr_defs()
    return templates.TemplateResponse(
        request,
        "partials/after_save.html",
        {
            "note": note,
            "notes": notes,
            "categories": categories,
            "attr_defs": attr_defs,
        },
    )


@router.delete("/{note_id}", response_class=HTMLResponse)
async def delete_note_handler(
    request: Request,
    note_id: int,
    workspace_id: Optional[int] = None,
):
    await delete_note(note_id)
    ws_ids = list(await get_descendant_ids(workspace_id)) if workspace_id is not None else None
    notes = await search_notes(workspace_ids=ws_ids)
    return templates.TemplateResponse(
        request,
        "partials/note_list.html",
        {"notes": notes},
    )