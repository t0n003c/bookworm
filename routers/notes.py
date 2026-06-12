"""FastAPI router for notes (returns HTMX HTML partials)."""
import asyncio
import html as _html
import ipaddress
import re
import socket
import urllib.request
from datetime import date as date_type
from typing import Optional
from urllib.parse import urlparse
from fastapi import APIRouter, Form, Query, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from templates_env import templates

from bw_ssrf import is_safe_url
from routers.notes_db import (
    get_note_by_id,
    patch_note_content,
    search_notes,
    create_note,
    create_inline_page,
    get_child_page_titles,
    get_note_workspace_id,
    derive_title_from_content,
    update_note,
    delete_note,
    move_note_to_workspace,
    next_auto_title,
)
from routers.categories_db import get_categories_for_workspace, get_all_attr_defs
from routers.workspaces_db import get_descendant_ids
from routers.sharing_db import (
    get_public_link,
    get_shared_object_ids,
    note_belongs_to_user,
    workspace_belongs_to_user,
    db_card_belongs_to_user,
)

router = APIRouter(prefix="/notes", tags=["notes"])


async def _attach_share_flags(notes: list[dict]) -> None:
    """Add has_share_link bool to each note dict in-place (one batch query)."""
    if not notes:
        return
    shared = await get_shared_object_ids("note", [n["id"] for n in notes])
    for note in notes:
        note["has_share_link"] = note["id"] in shared


# ── Ownership guards ────────────────────────────────────────────────────────

async def _require_note_owner(note_id: int, uid: Optional[int]) -> None:
    """Raise 403 when uid does not own note_id."""
    if not uid or not await note_belongs_to_user(note_id, uid):
        raise HTTPException(status_code=403, detail="Not authorised")


async def _require_ws_owner(ws_id: Optional[int], uid: Optional[int]) -> None:
    """Raise 403 when uid does not own ws_id (no-op when ws_id is None)."""
    if ws_id is not None and (not uid or not await workspace_belongs_to_user(ws_id, uid)):
        raise HTTPException(status_code=403, detail="Not authorised")


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
    uid = request.session.get("user_id")

    # Guard: never return unscoped notes (would expose all users' data).
    # Without a workspace the note list is empty and shows the welcome state.
    if workspace_id is None:
        return templates.TemplateResponse(
            request,
            "partials/note_list.html",
            {"notes": [], "active_ws_id": None},
        )

    await _require_ws_owner(workspace_id, uid)
    ws_ids = list(await get_descendant_ids(workspace_id))
    notes = await search_notes(
        q=q or None,
        date_from=date_from or None,
        date_to=date_to or None,
        category_ids=cat_ids or None,
        workspace_ids=ws_ids,
        sort_by=sort_by or None,
        exclude_inline=True,
    )
    await _attach_share_flags(notes)
    return templates.TemplateResponse(
        request,
        "partials/note_list.html",
        {"notes": notes, "active_ws_id": workspace_id},
    )


@router.get("/form/new", response_class=HTMLResponse)
async def new_note_form(request: Request, workspace_id: Optional[int] = None):
    uid = request.session.get("user_id")
    await _require_ws_owner(workspace_id, uid)
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
    uid = request.session.get("user_id")
    await _require_note_owner(note_id, uid)
    ws_id = note.get("workspace_id")
    categories = await get_categories_for_workspace(ws_id)
    attr_defs  = await get_all_attr_defs()
    link = await get_public_link("note", note_id, uid) if uid else None
    # Inline sub-pages: resolve the parent for the breadcrumb, and decide what
    # the title box should show — empty when the title is auto-derived from the
    # first line (so editing the first line keeps updating the title), or the
    # explicit title the user typed.
    inline_parent = None
    inline_title_value = None
    if note.get("is_inline_page"):
        if note.get("parent_note_id"):
            inline_parent = await get_note_by_id(note["parent_note_id"])
        _auto = (note.get("title") or "") == derive_title_from_content(note.get("content"))
        inline_title_value = "" if _auto else (note.get("title") or "")
    return templates.TemplateResponse(
        request,
        "partials/note_form.html",
        {
            "note":               note,
            "is_edit":            True,
            "categories":         categories,
            "attr_defs":          attr_defs,
            "today":              note["meeting_date"],
            "workspace_id":       ws_id,
            "public_link_active": link is not None,
            "inline_parent":      inline_parent,
            "inline_title_value": inline_title_value,
        },
    )


@router.get("/suggest-title")
async def suggest_title_endpoint(
    request: Request,
    workspace_id: Optional[int] = Query(default=None),
):
    """Return the next available auto-title for a workspace as JSON.

    Used by the client auto-save path so it always sends a real non-empty
    title and never hits form-validation errors on the POST /notes route.
    """
    uid = request.session.get("user_id")
    await _require_ws_owner(workspace_id, uid)
    title = await next_auto_title(workspace_id)
    return JSONResponse({"title": title})


@router.get("/url-title")
async def url_title_endpoint(url: str = Query(..., description="URL whose page title to fetch")):
    """Fetch og:title / <title> of a URL for mention pill annotations.

    SSRF mitigations
    ----------------
    1. Only http / https schemes are allowed.
    2. The hostname is resolved and every returned IP is checked against
       ipaddress.ip_address().is_private / is_loopback / is_link_local /
       is_reserved.  Any private IP causes a silent empty-string return.

    Always returns JSON {"title": str} — empty string on any failure so
    callers treat it as a graceful no-op.
    """

    # Block redirects entirely: a public page that 302-redirects to an internal
    # address would otherwise defeat the SSRF check (the title preview is a
    # nice-to-have, so giving up on redirect is an acceptable trade).
    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    def _fetch() -> str:
        if not is_safe_url(url):
            return ""
        try:
            import ssl
            ctx = ssl.create_default_context()  # full certificate verification
            opener = urllib.request.build_opener(
                _NoRedirect, urllib.request.HTTPSHandler(context=ctx)
            )
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (BookWorm/1.0 mention-preview)"},
            )
            with opener.open(req, timeout=4) as resp:
                raw = resp.read(32_768).decode("utf-8", errors="replace")

            # og:title comes in two attribute orderings; try both.
            og = re.search(
                r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)',
                raw, re.I,
            ) or re.search(
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']',
                raw, re.I,
            )
            if og:
                return _html.unescape(og.group(1).strip())

            t = re.search(r"<title[^>]*>([^<]{1,200})</title>", raw, re.I)
            if t:
                return _html.unescape(t.group(1).strip())
        except Exception:
            pass
        return ""

    title = await asyncio.to_thread(_fetch)
    return JSONResponse({"title": title})


# ── Inline pages (Notion-style sub-pages) ───────────────────────────────────
# NOTE: both routes are declared BEFORE GET /{note_id} so the path-param route
# does not swallow "subpage" / "page-titles" as note ids.

@router.post("/subpage")
async def create_subpage(
    request: Request,
    parent_note_id: Optional[int] = Form(default=None),
    parent_card_id: Optional[int] = Form(default=None),
):
    """Create an empty inline sub-page under a note or a database card.

    Returns JSON {id, title} so the client can insert a page-link and open it.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=403, detail="Not authorised")
    if (parent_note_id is None) == (parent_card_id is None):
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one of parent_note_id / parent_card_id",
        )

    if parent_note_id is not None:
        await _require_note_owner(parent_note_id, uid)
        workspace_id = await get_note_workspace_id(parent_note_id)
    else:
        if not await db_card_belongs_to_user(parent_card_id, uid):
            raise HTTPException(status_code=403, detail="Not authorised")
        # The card lives in a database, which is itself a workspace (db_cards.db_id).
        from database import get_db
        async with get_db() as db:
            cur = await db.execute(
                "SELECT db_id FROM db_cards WHERE id = ?", (parent_card_id,)
            )
            row = await cur.fetchone()
        workspace_id = row["db_id"] if row else None

    note_id = await create_inline_page(
        workspace_id=workspace_id,
        meeting_date=date_type.today().isoformat(),
        parent_note_id=parent_note_id,
        parent_card_id=parent_card_id,
    )
    return JSONResponse({"id": note_id, "title": "Untitled"})


@router.get("/page-titles")
async def page_titles(
    request: Request,
    ids: str = Query(default=""),
):
    """Return {id: title} for the given inline-page ids, owner-filtered.

    Used to hydrate page-link labels after the parent's markdown is rendered.
    """
    uid = request.session.get("user_id")
    if not uid:
        return JSONResponse({})
    id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()]
    if not id_list:
        return JSONResponse({})
    titles = await get_child_page_titles(id_list)
    # Drop any id the user does not own — never leak another user's titles.
    out = {}
    for nid, title in titles.items():
        if await note_belongs_to_user(nid, uid):
            out[str(nid)] = title
    return JSONResponse(out)


@router.get("/{note_id}", response_class=HTMLResponse)
async def view_note(request: Request, note_id: int):
    uid = request.session.get("user_id")
    note = await get_note_by_id(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    await _require_note_owner(note_id, uid)
    # Resolve the parent for the inline-page back-link.
    parent = None
    if note.get("is_inline_page") and note.get("parent_note_id"):
        parent = await get_note_by_id(note["parent_note_id"])
    return templates.TemplateResponse(
        request,
        "partials/note_detail.html",
        {"note": note, "inline_parent": parent},
    )


@router.post("/{note_id}/toggle-todo", response_class=HTMLResponse)
async def toggle_todo_handler(
    request: Request,
    note_id: int,
    index: int = Form(...),
):
    """Toggle the Nth checkbox (0-based) in a note's markdown content."""
    uid = request.session.get("user_id")
    note = await get_note_by_id(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    await _require_note_owner(note_id, uid)

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
    title: str = Form(default=""),
    icon: Optional[str] = Form(default=None),
    content: str = Form(default=""),
    meeting_date: str = Form(default=""),
    category_ids: list[str] = Form(default=[]),
    attr_keys: list[str] = Form(default=[]),
    attr_values: list[str] = Form(default=[]),
    workspace_id: Optional[int] = Form(default=None),
):
    uid = request.session.get("user_id")
    await _require_ws_owner(workspace_id, uid)
    # Auto-generate title when the user dismissed the form without typing one.
    if not title.strip():
        title = await next_auto_title(workspace_id)
    # Default date to today when the form was submitted without a date.
    if not meeting_date.strip():
        meeting_date = date_type.today().isoformat()
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
    notes = await search_notes(workspace_ids=ws_ids, exclude_inline=True)
    await _attach_share_flags(notes)
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
    uid = request.session.get("user_id")
    await _require_note_owner(note_id, uid)
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
    notes = await search_notes(workspace_ids=ws_ids, exclude_inline=True)
    await _attach_share_flags(notes)
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
    uid = request.session.get("user_id")
    await _require_note_owner(note_id, uid)
    await delete_note(note_id)
    ws_ids = list(await get_descendant_ids(workspace_id)) if workspace_id is not None else None
    notes = await search_notes(workspace_ids=ws_ids, exclude_inline=True)
    await _attach_share_flags(notes)
    return templates.TemplateResponse(
        request,
        "partials/note_list.html",
        {"notes": notes},
    )


# Dead duplicate of url_title_endpoint removed — the registered version
# lives above /{note_id} where Starlette's router finds it first.

