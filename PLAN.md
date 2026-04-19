# Plan: Grid Homespace Page
Date: 2026-04-18
Estimated complexity: High

---

## Summary

Add a new `page_type = "grid"` Homespace page — a visual moodboard / content grid where the user
drags, drops, and reorders media cells pulled from their Uploads pages. Each cell carries an
aspect ratio (`1:1`, `4:5`, `16:9`), an optional caption, and a media reference to a
`page_uploads` file (image or video). The page-level column count (3 / 4 / 5) is persisted in
`home_pages.config_json` via the existing `POST /home/pages/{id}/update-config` endpoint.
All CRUD and reorder operations are handled by a new `routers/home_grid.py` router backed by a
new `home_grid_cells` DB table. The JS module `home-page-grid.js` uses the HTML5 Drag API
(no external libs) for swap-on-drop interactions.

---

## ⚠️ Schema Bug in Pre-Gathered Evidence — Fix Before Coding

The pre-gathered evidence proposes:
```sql
upload_id  INTEGER REFERENCES note_attachments(id) ON DELETE SET NULL
```
**This is wrong.** Media browsed from Uploads pages lives in `page_uploads`, not
`note_attachments`. The correct FK is:
```sql
upload_id  INTEGER REFERENCES page_uploads(id) ON DELETE SET NULL
```
The `page_uploads` table has `id, page_id, user_id, filename, original_name, mime_type, size`.
Files are served from the static mount as `/uploads/<filename>`.

---

## Files to Change

Touch in this exact order to avoid import errors at startup.

| # | File | What changes |
|---|---|---|
| 1 | `database.py` | Add `home_grid_cells` table + index in `init_db()` |
| 2 | `routers/home_db.py` | Add `"grid"` to `PAGE_TYPES` frozenset |
| 3 | `routers/home.py` | Add `elif p_type == "grid"` dispatch branch; build `uploads_pages`; expand context dict |
| 4 | `main.py` | Import `home_grid as home_grid_router`; `app.include_router` after `home_buds_router` |
| 5 | `static/js/home-widgets.js` | Add `#grid-page-root` branch in `_initSwappedPage()` before `#coming-soon-page-root` |
| 6 | `templates/base.html` | Add `<script src="/static/js/home-page-grid.js?v={{ static_v }}" defer>` |

---

## New Files to Create

| File | Purpose |
|---|---|
| `routers/home_grid_db.py` | All DB helpers for `home_grid_cells` |
| `routers/home_grid.py` | FastAPI router — 6 endpoints under `/home/grid/{page_id}/…` |
| `templates/partials/home_page_grid.html` | Grid page shell: toolbar, CSS-grid canvas, media-picker modal, cell edit modal, delete confirm modal |
| `static/js/home-page-grid.js` | Full grid JS module: `initGridPage(pid)`, drag-swap, media picker, column saver |

---

## DB Migration

### New table — additive, safe on live DB

Add to `init_db()` in `database.py` **after the CRM tables block**, before `await db.commit()`:

```python
# ── Grid Homespace page cells ─────────────────────────────────────────────────
await db.execute("""
    CREATE TABLE IF NOT EXISTS home_grid_cells (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id     INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL DEFAULT 0,
        cell_type   TEXT    NOT NULL DEFAULT 'empty',
        upload_id   INTEGER REFERENCES page_uploads(id) ON DELETE SET NULL,
        aspect      TEXT    NOT NULL DEFAULT '1:1',
        caption     TEXT    NOT NULL DEFAULT '',
        config_json TEXT    NOT NULL DEFAULT '{}',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
""")
await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_grid_cells_page "
    "ON home_grid_cells(page_id, position)"
)
```

**Classification:** Additive — `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.
Safe to run 10× on a live database. No table-swap dance needed.

---

## API Contract

All routes live under the existing `/home` prefix (same pattern as `home_crm.py`).
All routes return `JSONResponse`. The page HTML shell is rendered by `home_page_view()` in
`home.py` — no separate HTML rendering endpoint is needed.

### Ownership guard (define once in `home_grid.py`, call in every endpoint)

```python
async def _get_grid_page(page_id: int, uid: int) -> dict | None:
    """Returns page dict or None. Caller returns 404 on None."""
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "grid":
        return None
    return page
```

### Endpoints

| Method | Path | Request body | Success response |
|---|---|---|---|
| `GET` | `/home/grid/{page_id}/cells` | — | `200 [{cell…}, …]` |
| `POST` | `/home/grid/{page_id}/cells` | JSON `{position, cell_type, upload_id?, aspect, caption}` | `201 {id: int}` |
| `PATCH` | `/home/grid/{page_id}/cells/{cell_id}` | JSON (any subset of cell fields, plus `clear_upload: bool`) | `200 {ok: true}` |
| `DELETE` | `/home/grid/{page_id}/cells/{cell_id}` | — | `204` |
| `POST` | `/home/grid/{page_id}/reorder` | JSON `{order: [cell_id, …]}` | `200 {ok: true}` |
| `POST` | `/home/grid/{page_id}/swap` | JSON `{a: cell_id, b: cell_id}` | `200 {ok: true}` |

### Cell object shape (returned by `GET /cells`)

Each cell is enriched server-side via a `LEFT JOIN page_uploads pu ON pu.id = c.upload_id`:

```json
{
  "id": 12,
  "page_id": 5,
  "position": 2,
  "cell_type": "image",
  "upload_id": 99,
  "aspect": "1:1",
  "caption": "Fresh produce display",
  "config_json": "{}",
  "file_url": "/uploads/abc123.webp",
  "mime_type": "image/webp",
  "original_name": "photo.jpg"
}
```

`file_url` is built server-side as `"/uploads/" + pu.filename`. When `upload_id` is `NULL`,
`file_url`, `mime_type`, and `original_name` are all `null`.

---

## `routers/home_grid_db.py` — Function Signatures

```python
"""DB helpers for the Grid Homespace page (home_grid_cells table)."""
from __future__ import annotations
import json
from database import get_db


async def get_grid_cells(page_id: int) -> list[dict]:
    """Return all cells for a page ordered by position.
    LEFT JOIN page_uploads to add file_url, mime_type, original_name."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT c.*,
                   CASE WHEN pu.filename IS NOT NULL
                        THEN '/uploads/' || pu.filename
                        ELSE NULL END AS file_url,
                   pu.mime_type,
                   pu.original_name
            FROM home_grid_cells c
            LEFT JOIN page_uploads pu ON pu.id = c.upload_id
            WHERE c.page_id = ?
            ORDER BY c.position, c.id
            """,
            (page_id,),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def add_grid_cell(
    page_id: int,
    position: int,
    cell_type: str = "empty",
    upload_id: int | None = None,
    aspect: str = "1:1",
    caption: str = "",
) -> int:
    """INSERT a new cell; return new id."""
    async with get_db() as db:
        cur = await db.execute(
            "INSERT INTO home_grid_cells"
            "(page_id, position, cell_type, upload_id, aspect, caption)"
            " VALUES (?,?,?,?,?,?)",
            (page_id, position, cell_type, upload_id, aspect, caption),
        )
        await db.commit()
        return cur.lastrowid


async def update_grid_cell(
    cell_id: int,
    page_id: int,          # used in WHERE to prevent cross-page tampering
    uid: int,              # used to verify upload_id ownership
    position: int | None = None,
    cell_type: str | None = None,
    upload_id: int | None = None,
    clear_upload: bool = False,   # True → set upload_id = NULL explicitly
    aspect: str | None = None,
    caption: str | None = None,
) -> None:
    """Partial UPDATE — only touches supplied fields.
    When clear_upload=True, sets upload_id to NULL regardless of upload_id arg.
    When upload_id is provided, verifies the page_uploads row belongs to uid."""
    async with get_db() as db:
        # Ownership check on the new upload_id
        if upload_id is not None and not clear_upload:
            chk = await db.execute(
                "SELECT id FROM page_uploads WHERE id=? AND user_id=?",
                (upload_id, uid),
            )
            if not await chk.fetchone():
                raise ValueError("upload not owned by user")

        sets, params = [], []
        if position is not None:   sets.append("position=?");  params.append(position)
        if cell_type is not None:  sets.append("cell_type=?"); params.append(cell_type)
        if clear_upload:
            sets.append("upload_id=NULL")
            sets.append("cell_type='empty'")
        elif upload_id is not None:
            sets.append("upload_id=?"); params.append(upload_id)
        if aspect is not None:     sets.append("aspect=?");    params.append(aspect)
        if caption is not None:    sets.append("caption=?");   params.append(caption)
        if not sets:
            return
        params += [cell_id, page_id]
        await db.execute(
            f"UPDATE home_grid_cells SET {', '.join(sets)} WHERE id=? AND page_id=?",
            params,
        )
        await db.commit()


async def delete_grid_cell(cell_id: int, page_id: int) -> None:
    """DELETE WHERE id=? AND page_id=? — page_id guard prevents cross-page ops."""
    async with get_db() as db:
        await db.execute(
            "DELETE FROM home_grid_cells WHERE id=? AND page_id=?",
            (cell_id, page_id),
        )
        await db.commit()


async def reorder_grid_cells(page_id: int, ordered_ids: list[int]) -> None:
    """Bulk-update position field according to ordered_ids list."""
    async with get_db() as db:
        for idx, cell_id in enumerate(ordered_ids):
            await db.execute(
                "UPDATE home_grid_cells SET position=? WHERE id=? AND page_id=?",
                (idx, cell_id, page_id),
            )
        await db.commit()


async def swap_grid_cells(page_id: int, a: int, b: int) -> None:
    """Swap positions of cells a and b atomically."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, position FROM home_grid_cells WHERE id IN (?,?) AND page_id=?",
            (a, b, page_id),
        )
        rows = {r[0]: r[1] for r in await cur.fetchall()}
        if len(rows) != 2:
            return  # one or both ids not found / wrong page — silent no-op
        await db.execute(
            "UPDATE home_grid_cells SET position=? WHERE id=? AND page_id=?",
            (rows[b], a, page_id),
        )
        await db.execute(
            "UPDATE home_grid_cells SET position=? WHERE id=? AND page_id=?",
            (rows[a], b, page_id),
        )
        await db.commit()
```

**Critical:** every function uses `async with get_db() as db:` — never `aiosqlite.connect()`.

---

## `routers/home_grid.py` — Router Skeleton

```python
"""Grid Homespace page routes.

Mounted with prefix=/home (same as home.py + home_crm.py).
Routes live under /home/grid/{page_id}/...
All endpoints return JSONResponse; the page shell is rendered by home_page_view() in home.py.
"""
from __future__ import annotations
import logging
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from routers.home_db import get_home_page
from routers.home_grid_db import (
    get_grid_cells, add_grid_cell, update_grid_cell,
    delete_grid_cell, reorder_grid_cells, swap_grid_cells,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/home", tags=["home_grid"])

_VALID_ASPECTS = frozenset({"1:1", "4:5", "16:9"})
_VALID_CELL_TYPES = frozenset({"empty", "image", "video", "text"})


def _uid(request: Request) -> int:
    return request.session["user_id"]


async def _get_grid_page(page_id: int, uid: int) -> dict | None:
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "grid":
        return None
    return page


@router.get("/grid/{page_id}/cells")
async def list_cells(request: Request, page_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    cells = await get_grid_cells(page_id)
    return JSONResponse(cells)


@router.post("/grid/{page_id}/cells")
async def create_cell(request: Request, page_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    body = await request.json()
    aspect = body.get("aspect", "1:1")
    if aspect not in _VALID_ASPECTS:
        aspect = "1:1"
    cell_type = body.get("cell_type", "empty")
    if cell_type not in _VALID_CELL_TYPES:
        cell_type = "empty"
    new_id = await add_grid_cell(
        page_id=page_id,
        position=int(body.get("position", 0)),
        cell_type=cell_type,
        upload_id=body.get("upload_id"),
        aspect=aspect,
        caption=str(body.get("caption", "")),
    )
    return JSONResponse({"id": new_id}, 201)


@router.patch("/grid/{page_id}/cells/{cell_id}")
async def patch_cell(request: Request, page_id: int, cell_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    body = await request.json()
    aspect = body.get("aspect")
    if aspect is not None and aspect not in _VALID_ASPECTS:
        aspect = None
    cell_type = body.get("cell_type")
    if cell_type is not None and cell_type not in _VALID_CELL_TYPES:
        cell_type = None
    try:
        await update_grid_cell(
            cell_id=cell_id,
            page_id=page_id,
            uid=uid,
            position=body.get("position"),
            cell_type=cell_type,
            upload_id=body.get("upload_id"),
            clear_upload=bool(body.get("clear_upload", False)),
            aspect=aspect,
            caption=body.get("caption"),
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, 403)
    return JSONResponse({"ok": True})


@router.delete("/grid/{page_id}/cells/{cell_id}")
async def remove_cell(request: Request, page_id: int, cell_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    await delete_grid_cell(cell_id, page_id)
    return JSONResponse(None, 204)


@router.post("/grid/{page_id}/reorder")
async def reorder_cells(request: Request, page_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    body = await request.json()
    order = [int(x) for x in body.get("order", [])]
    if order:
        await reorder_grid_cells(page_id, order)
    return JSONResponse({"ok": True})


@router.post("/grid/{page_id}/swap")
async def swap_cells(request: Request, page_id: int):
    uid = _uid(request)
    if not await _get_grid_page(page_id, uid):
        return JSONResponse({"error": "not found"}, 404)
    body = await request.json()
    a, b = int(body.get("a", 0)), int(body.get("b", 0))
    if a and b and a != b:
        await swap_grid_cells(page_id, a, b)
    return JSONResponse({"ok": True})
```

---

## `routers/home.py` — `home_page_view` Changes

### 1. Add the grid dispatch branch

Insert **before** the final `else` (coming-soon) clause:

```python
elif p_type == "grid":
    tmpl = "partials/home_page_grid.html"
    # Pass all uploads pages so the in-template media-picker modal can list them.
    all_pages = await get_home_pages(uid)
    uploads_pages = [p for p in all_pages if p.get("page_type") == "uploads"]
```

`get_home_pages` is already imported at the top of `home.py`. No new import needed.

### 2. Expand the `TemplateResponse` context dict

```python
return templates.TemplateResponse(
    request, tmpl,
    {
        "page": page, "page_type": p_type,
        "widgets": widgets, "all_notes": all_notes,
        "widget_sources": widget_sources if p_type == "rss" else {},
        "collabora_enabled": collabora_enabled,
        "collabora_url":     collabora_url,
        # Grid-only — empty list for all other page types (Jinja2 will never see it used)
        "uploads_pages": uploads_pages if p_type == "grid" else [],
    },
)
```

---

## `routers/home_db.py` — `PAGE_TYPES` Change

```python
# Before
PAGE_TYPES = frozenset({"dashboard", "crm", "media", "grid_builder", "uploads", "rss"})

# After
PAGE_TYPES = frozenset({"dashboard", "crm", "media", "grid_builder", "uploads", "rss", "grid"})
```

---

## `main.py` — Router Registration

```python
# After the existing home_buds import line (~line 67):
from routers import home_grid as home_grid_router

# After app.include_router(home_buds_router.router) (~line 142):
app.include_router(home_grid_router.router)
```

---

## `static/js/home-widgets.js` — `_initSwappedPage()` Change

Add the following block **before** the `#coming-soon-page-root` guard (which is currently the
last special-case branch before the dashboard fallback):

```javascript
// Grid page
var gridRoot = document.getElementById('grid-page-root');
if (gridRoot) {
  var pid = parseInt(gridRoot.dataset.pageId, 10);
  if (pid && typeof initGridPage === 'function') {
    try { initGridPage(pid); } catch(e) { console.error('[home] initGridPage:', e); }
  }
  var _ta = document.getElementById('top-action-area');
  if (_ta) _ta.innerHTML = '';
  return;
}
```

---

## `templates/partials/home_page_grid.html` — Annotated Structure

```jinja2
{# Grid Homespace page shell.
   Context vars: page, page_type, uploads_pages (list of uploads page dicts)
#}
<div id="grid-page-root"
     data-page-id="{{ page.id }}"
     data-cols="{{ page.config.get('grid_cols', 4) }}">

  {# ── Toolbar ────────────────────────────────────────────────────────── #}
  <div id="grid-toolbar" class="flex items-center gap-3 px-4 py-3 border-b …">

    {# Helper text #}
    <p class="text-sm text-gray-500 dark:text-zinc-400 flex-1">
      Visually plan your content grid — drag, drop, reorder
    </p>

    {# Column picker — 3 / 4 / 5 #}
    <div class="flex gap-1" role="group" aria-label="Columns">
      <button id="grid-col-btn-3" onclick="gridSetCols(3)" aria-pressed="false"
              class="px-3 py-1 text-sm rounded-lg …">3</button>
      <button id="grid-col-btn-4" onclick="gridSetCols(4)" aria-pressed="true"
              class="px-3 py-1 text-sm rounded-lg …">4</button>
      <button id="grid-col-btn-5" onclick="gridSetCols(5)" aria-pressed="false"
              class="px-3 py-1 text-sm rounded-lg …">5</button>
    </div>

    {# Add cell #}
    <button onclick="gridAddEmptyCell()"
            class="px-3 py-1 text-sm rounded-lg bg-[#0053e2] text-white …">
      + Add Cell
    </button>
  </div>

  {# ── Empty state (shown by JS when no cells) #}
  <div id="grid-empty-state" class="hidden flex flex-col items-center py-16 text-gray-400 …">
    <span class="text-5xl mb-3">🖼️</span>
    <p class="text-sm">No cells yet. Click <strong>+ Add Cell</strong> or drag media here.</p>
  </div>

  {# ── CSS grid canvas — rendered entirely by JS #}
  <div id="grid-canvas" class="p-4"></div>

  {# ── Media picker modal ────────────────────────────────────────────── #}
  <div id="grid-media-modal"
       class="hidden fixed inset-0 z-50 flex items-center justify-center"
       role="dialog" aria-modal="true" aria-labelledby="grid-media-modal-title"
       onkeydown="if(event.key==='Escape')gridCloseMediaPicker()">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"
         onclick="gridCloseMediaPicker()" aria-hidden="true"></div>
    <div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl
                w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]">

      <div class="flex items-center gap-3 p-4 border-b dark:border-zinc-700">
        <h2 id="grid-media-modal-title" class="font-bold text-gray-900 dark:text-zinc-100 flex-1">
          Pick media
        </h2>

        {# Uploads page selector #}
        {% if uploads_pages %}
        <select id="grid-media-page-sel"
                onchange="gridMediaLoadPage(this.value)"
                class="text-sm rounded-lg border …">
          {% for up in uploads_pages %}
          <option value="{{ up.id }}">{{ up.emoji }} {{ up.name }}</option>
          {% endfor %}
        </select>
        {% else %}
        <p class="text-sm text-gray-400">
          No Uploads pages found. Create an Uploads page to add photos or videos.
        </p>
        {% endif %}

        <button onclick="gridCloseMediaPicker()" aria-label="Close"
                class="p-1 rounded-lg text-gray-500 hover:bg-gray-100 …">✕</button>
      </div>

      {# File grid — rendered by JS #}
      <div id="grid-media-files" class="overflow-y-auto flex-1 min-h-[200px]"></div>

      {# Pagination #}
      <div class="flex items-center justify-center gap-4 p-3 border-t dark:border-zinc-700">
        <button onclick="gridMediaPrevPage()" aria-label="Previous page"
                class="px-3 py-1 rounded-lg border …">‹</button>
        <span id="grid-media-page-label" class="text-sm text-gray-500"></span>
        <button onclick="gridMediaNextPage()" aria-label="Next page"
                class="px-3 py-1 rounded-lg border …">›</button>
      </div>
    </div>
  </div>

  {# ── Cell edit modal (caption + aspect ratio) ─────────────────────── #}
  <div id="grid-cell-edit-modal"
       class="hidden fixed inset-0 z-50 flex items-center justify-center"
       role="dialog" aria-modal="true" aria-labelledby="grid-cell-edit-title"
       onkeydown="if(event.key==='Escape')gridCloseCellEdit()">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"
         onclick="gridCloseCellEdit()" aria-hidden="true"></div>
    <div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
      <h2 id="grid-cell-edit-title" class="font-bold mb-4 text-gray-900 dark:text-zinc-100">
        Edit cell
      </h2>
      <label class="block text-sm font-medium mb-1">Caption</label>
      <input id="grid-cell-edit-caption" type="text" maxlength="200"
             class="w-full rounded-lg border px-3 py-2 text-sm mb-4 …">
      <label class="block text-sm font-medium mb-2">Aspect ratio</label>
      <div class="flex gap-3 mb-6" role="radiogroup" aria-label="Aspect ratio">
        <label class="flex items-center gap-1 text-sm cursor-pointer">
          <input type="radio" name="grid-aspect" value="1:1" class="accent-[#0053e2]"> 1∶1
        </label>
        <label class="flex items-center gap-1 text-sm cursor-pointer">
          <input type="radio" name="grid-aspect" value="4:5" class="accent-[#0053e2]"> 4∶5
        </label>
        <label class="flex items-center gap-1 text-sm cursor-pointer">
          <input type="radio" name="grid-aspect" value="16:9" class="accent-[#0053e2]"> 16∶9
        </label>
      </div>
      <div class="flex gap-3 justify-end">
        <button onclick="gridCloseCellEdit()"
                class="px-4 py-2 text-sm rounded-lg border … text-gray-700 …">Cancel</button>
        <button onclick="gridSaveCellEdit()"
                class="px-4 py-2 text-sm rounded-lg bg-[#0053e2] text-white …">Save</button>
      </div>
    </div>
  </div>

  {# ── Cell delete confirm modal — standard destructive pattern ────── #}
  <div id="grid-cell-del-modal"
       class="hidden fixed inset-0 z-50 flex items-center justify-center"
       role="dialog" aria-modal="true" aria-labelledby="grid-cell-del-title"
       onkeydown="if(event.key==='Escape')_gridCancelDelete()">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"
         onclick="_gridCancelDelete()" aria-hidden="true"></div>
    <div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
      <div class="flex items-center gap-3 mb-4">
        <span class="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30
                     flex items-center justify-center text-[#ea1100]" aria-hidden="true">🗑️</span>
        <h2 id="grid-cell-del-title" class="text-base font-bold text-gray-900 dark:text-zinc-100">
          Remove cell?
        </h2>
      </div>
      <p class="text-sm text-gray-600 dark:text-zinc-400 mb-5">
        The cell will be removed from the grid. The original file is not deleted.
      </p>
      <div class="flex gap-3 justify-end">
        <button onclick="_gridCancelDelete()"
                class="px-4 py-2 text-sm rounded-lg border … text-gray-700 …">Cancel</button>
        <button id="grid-cell-del-confirm-btn" onclick="_gridConfirmDelete()"
                class="px-4 py-2 text-sm rounded-lg bg-[#ea1100] text-white font-semibold …">
          Remove
        </button>
      </div>
    </div>
  </div>

</div>
{# Script loaded from base.html — do NOT add a second <script> tag here #}
```

---

## `static/js/home-page-grid.js` — Full JS Architecture

### Module state

```javascript
// ── Module state (var — safe for repeated initGridPage calls) ────────────────
var _gridPid         = null;   // int   — current page id
var _gridCells       = [];     // array — cell objects from API
var _gridCols        = 4;      // int   — 3|4|5 column setting
var _gridDragSrcId   = null;   // int|null — id of cell being dragged
var _gridBusy        = false;  // bool  — guards concurrent fetch calls

// Media picker state
var _gridPickerCell    = null;  // int|null — cell id awaiting media assignment
var _gridPickerPageId  = null;  // int|null — currently browsed uploads page id
var _gridPickerPage    = 1;     // int      — pagination cursor (1-based)
var _gridPickerTotal   = 0;     // int      — total files from last fetch

// Cell edit state
var _gridEditCellId    = null;  // int|null — cell id open in the edit modal

// Cell delete state
var _gridPendingDelId  = null;  // int|null — cell id awaiting delete confirm
```

### Init sequence

```javascript
function initGridPage(pid) {
  _gridPid   = pid;
  _gridBusy  = false;
  _gridCells = [];
  _gridDragSrcId = null;

  // Read saved col count from data attribute (server renders page.config.grid_cols)
  var root = document.getElementById('grid-page-root');
  _gridCols = parseInt((root && root.dataset.cols) || '4', 10);
  if ([3,4,5].indexOf(_gridCols) === -1) _gridCols = 4;
  _gridHighlightColBtn(_gridCols);

  _gridLoadCells();
}
```

### Data fetch

```javascript
async function _gridLoadCells() {
  var r = await fetch('/home/grid/' + _gridPid + '/cells');
  if (!r.ok) { console.error('[grid] fetch cells failed', r.status); return; }
  _gridCells = await r.json();
  _gridRender();
}
```

### Render

```javascript
var _ASPECT_CLASS = {'1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '16:9': 'aspect-video'};

function _gridRender() {
  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;

  var empty = document.getElementById('grid-empty-state');
  if (empty) empty.classList.toggle('hidden', _gridCells.length > 0);

  canvas.className = 'grid grid-cols-' + _gridCols + ' gap-3 p-4';
  canvas.innerHTML = _gridCells.map(_gridCellHTML).join('');
  _gridBindDrag();
}

function _gridCellHTML(cell) {
  var aClass = _ASPECT_CLASS[cell.aspect] || 'aspect-square';
  var inner  = '';

  if (cell.cell_type === 'image' && cell.file_url) {
    inner = '<img src="' + _gridEsc(cell.file_url) + '"'
          + ' class="w-full h-full object-cover pointer-events-none"'
          + ' loading="lazy" alt="' + _gridEsc(cell.original_name || '') + '">';
  } else if (cell.cell_type === 'video' && cell.file_url) {
    inner = '<video src="' + _gridEsc(cell.file_url) + '"'
          + ' class="w-full h-full object-cover pointer-events-none"'
          + ' muted playsinline loop></video>';
  } else {
    inner = '<button onclick="gridOpenMediaPicker(' + cell.id + ')"'
          + ' class="w-full h-full flex flex-col items-center justify-center'
          + ' text-gray-300 dark:text-zinc-600 gap-2 focus:outline-none focus:ring-2'
          + ' focus:ring-[#0053e2]" aria-label="Pick media for this cell">'
          + '<span class="text-4xl select-none" aria-hidden="true">＋</span>'
          + '<span class="text-xs">Pick media</span></button>';
  }

  // Caption overlay
  var caption = cell.caption
    ? '<div class="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-2 py-1 truncate">'
      + _gridEsc(cell.caption) + '</div>'
    : '';

  // ⋮ menu (three-dot)
  var menu = '<div class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition">'
           + '<button onclick="_gridOpenCellMenu(event,' + cell.id + ')"'
           + ' class="w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center'
           + ' hover:bg-black/70 focus:outline-none focus:ring-2 focus:ring-white"'
           + ' aria-label="Cell options" aria-haspopup="true">⋮</button>'
           + '</div>';

  return '<div class="relative group overflow-hidden rounded-xl bg-gray-100'
       + ' dark:bg-zinc-800 cursor-grab select-none ' + aClass + '"'
       + ' data-cell-id="' + cell.id + '" draggable="true">'
       + inner + caption + menu
       + '</div>';
}
```

### Drag-swap algorithm

```javascript
function _gridBindDrag() {
  document.querySelectorAll('#grid-canvas [data-cell-id]').forEach(function(el) {

    el.addEventListener('dragstart', function(e) {
      _gridDragSrcId = parseInt(el.dataset.cellId, 10);
      setTimeout(function() { el.style.opacity = '0.4'; }, 0);
      e.dataTransfer.effectAllowed = 'move';
    });

    el.addEventListener('dragend', function() {
      el.style.opacity = '';
      _gridDragSrcId = null;
      document.querySelectorAll('#grid-canvas [data-cell-id]').forEach(function(t) {
        t.classList.remove('ring-2', 'ring-[#0053e2]');
      });
    });

    el.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (parseInt(el.dataset.cellId, 10) !== _gridDragSrcId) {
        el.classList.add('ring-2', 'ring-[#0053e2]');
      }
    });

    el.addEventListener('dragleave', function() {
      el.classList.remove('ring-2', 'ring-[#0053e2]');
    });

    el.addEventListener('drop', function(e) {
      e.preventDefault();
      el.classList.remove('ring-2', 'ring-[#0053e2]');
      var targetId = parseInt(el.dataset.cellId, 10);
      if (!_gridDragSrcId || targetId === _gridDragSrcId) return;
      _gridSwap(_gridDragSrcId, targetId);
    });
  });
}

async function _gridSwap(a, b) {
  if (_gridBusy) return;
  _gridBusy = true;

  // Optimistic local swap (instant visual feedback)
  var ai = _gridCells.findIndex(function(c) { return c.id === a; });
  var bi = _gridCells.findIndex(function(c) { return c.id === b; });
  if (ai >= 0 && bi >= 0) {
    var tmp = _gridCells[ai].position;
    _gridCells[ai].position = _gridCells[bi].position;
    _gridCells[bi].position = tmp;
    _gridCells.sort(function(x, y) { return x.position - y.position; });
    _gridRender();
  }

  try {
    var r = await fetch('/home/grid/' + _gridPid + '/swap', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({a: a, b: b})
    });
    if (!r.ok) throw new Error('swap ' + r.status);
  } catch (err) {
    console.error('[grid] swap failed — rolling back:', err);
    await _gridLoadCells();   // server state wins
  } finally {
    _gridBusy = false;
  }
}
```

### Column picker

```javascript
async function gridSetCols(n) {
  _gridCols = n;
  _gridHighlightColBtn(n);
  _gridRender();
  // Persist to home_pages.config_json (existing form-POST endpoint)
  var fd = new FormData();
  fd.append('config_json', JSON.stringify({grid_cols: n}));
  try {
    await fetch('/home/pages/' + _gridPid + '/update-config', {method: 'POST', body: fd});
  } catch (e) { console.error('[grid] save cols failed:', e); }
}

function _gridHighlightColBtn(n) {
  [3,4,5].forEach(function(c) {
    var btn = document.getElementById('grid-col-btn-' + c);
    if (!btn) return;
    var active = c === n;
    btn.setAttribute('aria-pressed', String(active));
    btn.classList.toggle('bg-[#0053e2]', active);
    btn.classList.toggle('text-white',   active);
    btn.classList.toggle('border-[#0053e2]', active);
  });
}
```

### Add empty cell

```javascript
async function gridAddEmptyCell() {
  if (_gridBusy) return;
  _gridBusy = true;
  try {
    var nextPos = _gridCells.length;
    var r = await fetch('/home/grid/' + _gridPid + '/cells', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({position: nextPos, cell_type: 'empty', aspect: '1:1', caption: ''})
    });
    if (!r.ok) throw new Error('add cell ' + r.status);
    await _gridLoadCells();
  } catch (e) { console.error('[grid] add cell:', e); }
  finally { _gridBusy = false; }
}
```

### Cell menu

```javascript
function _gridOpenCellMenu(event, cellId) {
  event.stopPropagation();
  // Close any existing menu
  var existing = document.getElementById('grid-cell-ctx-menu');
  if (existing) existing.remove();

  var cell = _gridCells.find(function(c) { return c.id === cellId; });
  if (!cell) return;

  var menu = document.createElement('div');
  menu.id = 'grid-cell-ctx-menu';
  menu.className = 'absolute z-40 bg-white dark:bg-zinc-800 rounded-xl shadow-lg border '
                 + 'dark:border-zinc-700 py-1 text-sm min-w-[160px]';
  menu.innerHTML =
    '<button class="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-zinc-700"'
    + ' onclick="_gridCtxPickMedia(' + cellId + ')">📷 Pick media</button>'
    + '<button class="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-zinc-700"'
    + ' onclick="gridOpenCellEdit(' + cellId + ')">✏️ Edit caption / aspect</button>'
    + (cell.upload_id
       ? '<button class="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-zinc-700"'
         + ' onclick="_gridCtxClearMedia(' + cellId + ')">🗑️ Clear media</button>'
       : '')
    + '<hr class="my-1 border-gray-200 dark:border-zinc-700">'
    + '<button class="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-zinc-700'
    + ' text-[#ea1100]" onclick="gridDeleteCell(' + cellId + ')">Remove cell</button>';

  // Position near the button that triggered it
  var rect = event.target.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top  = (rect.bottom + 4) + 'px';
  menu.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
  document.body.appendChild(menu);

  // Click-outside to close
  setTimeout(function() {
    document.addEventListener('click', function _close() {
      var m = document.getElementById('grid-cell-ctx-menu');
      if (m) m.remove();
      document.removeEventListener('click', _close);
    });
  }, 0);
}

function _gridCtxPickMedia(cellId)  { var m = document.getElementById('grid-cell-ctx-menu'); if(m) m.remove(); gridOpenMediaPicker(cellId); }
async function _gridCtxClearMedia(cellId) {
  var m = document.getElementById('grid-cell-ctx-menu'); if(m) m.remove();
  await fetch('/home/grid/' + _gridPid + '/cells/' + cellId, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({clear_upload: true})
  });
  await _gridLoadCells();
}
```

### Cell edit modal

```javascript
function gridOpenCellEdit(cellId) {
  var m = document.getElementById('grid-cell-ctx-menu'); if(m) m.remove();
  var cell = _gridCells.find(function(c) { return c.id === cellId; });
  if (!cell) return;
  _gridEditCellId = cellId;
  document.getElementById('grid-cell-edit-caption').value = cell.caption || '';
  var radios = document.querySelectorAll('input[name="grid-aspect"]');
  radios.forEach(function(r) { r.checked = r.value === (cell.aspect || '1:1'); });
  document.getElementById('grid-cell-edit-modal').classList.remove('hidden');
  document.getElementById('grid-cell-edit-caption').focus();
}

function gridCloseCellEdit() {
  _gridEditCellId = null;
  document.getElementById('grid-cell-edit-modal').classList.add('hidden');
}

async function gridSaveCellEdit() {
  if (!_gridEditCellId) return;
  var caption = document.getElementById('grid-cell-edit-caption').value.trim();
  var aspect  = '1:1';
  document.querySelectorAll('input[name="grid-aspect"]').forEach(function(r) {
    if (r.checked) aspect = r.value;
  });
  var r = await fetch('/home/grid/' + _gridPid + '/cells/' + _gridEditCellId, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({caption: caption, aspect: aspect})
  });
  gridCloseCellEdit();
  if (r.ok) await _gridLoadCells();
}
```

### Cell delete modal

```javascript
function gridDeleteCell(cellId) {
  var m = document.getElementById('grid-cell-ctx-menu'); if(m) m.remove();
  _gridPendingDelId = cellId;
  document.getElementById('grid-cell-del-modal').classList.remove('hidden');
}

function _gridCancelDelete() {
  _gridPendingDelId = null;
  document.getElementById('grid-cell-del-modal').classList.add('hidden');
}

async function _gridConfirmDelete() {
  if (!_gridPendingDelId) return;
  var btn = document.getElementById('grid-cell-del-confirm-btn');
  if (btn) btn.disabled = true;
  try {
    await fetch('/home/grid/' + _gridPid + '/cells/' + _gridPendingDelId,
                {method: 'DELETE'});
    _gridCancelDelete();
    await _gridLoadCells();
  } catch(e) { console.error('[grid] delete failed:', e); }
  finally { if (btn) btn.disabled = false; }
}
```

### Media picker

```javascript
function gridOpenMediaPicker(cellId) {
  _gridPickerCell = cellId;
  _gridPickerPage = 1;
  document.getElementById('grid-media-modal').classList.remove('hidden');
  var sel = document.getElementById('grid-media-page-sel');
  if (sel && sel.value) {
    _gridPickerPageId = parseInt(sel.value, 10);
    _gridMediaFetch();
  } else {
    document.getElementById('grid-media-files').innerHTML =
      '<p class="text-sm text-gray-400 p-4">No Uploads pages available.</p>';
  }
}

function gridCloseMediaPicker() {
  _gridPickerCell = null;
  document.getElementById('grid-media-modal').classList.add('hidden');
  document.getElementById('grid-media-files').innerHTML = '';
}

function gridMediaLoadPage(uploadsPageId) {
  _gridPickerPageId = parseInt(uploadsPageId, 10);
  _gridPickerPage   = 1;
  _gridMediaFetch();
}

function gridMediaPrevPage() {
  if (_gridPickerPage <= 1) return;
  _gridPickerPage--;
  _gridMediaFetch();
}

function gridMediaNextPage() {
  var maxPage = Math.ceil(_gridPickerTotal / 50) || 1;
  if (_gridPickerPage >= maxPage) return;
  _gridPickerPage++;
  _gridMediaFetch();
}

async function _gridMediaFetch() {
  // ⚠️ VERIFY: confirm the exact response shape of GET /home/uploads/{id}/files
  //    before finalising. Expected: {files: [...], total: int}
  //    Each file: {id, filename, original_name, mime_type, size}
  var url = '/home/uploads/' + _gridPickerPageId + '/files?page=' + _gridPickerPage;
  var el  = document.getElementById('grid-media-files');
  el.innerHTML = '<p class="text-sm text-gray-400 p-4">Loading…</p>';
  try {
    var r = await fetch(url);
    if (!r.ok) throw new Error('files ' + r.status);
    var data = await r.json();
    _gridPickerTotal = data.total || 0;
    _gridRenderMediaFiles(data.files || []);
    var maxPage = Math.max(1, Math.ceil(_gridPickerTotal / 50));
    var lbl = document.getElementById('grid-media-page-label');
    if (lbl) lbl.textContent = 'Page ' + _gridPickerPage + ' of ' + maxPage;
  } catch(e) {
    el.innerHTML = '<p class="text-sm text-red-400 p-4">Failed to load files.</p>';
  }
}

function _gridRenderMediaFiles(files) {
  var el = document.getElementById('grid-media-files');
  var media = files.filter(function(f) {
    return f.mime_type &&
           (f.mime_type.startsWith('image/') || f.mime_type.startsWith('video/'));
  });
  if (!media.length) {
    el.innerHTML = '<p class="text-sm text-gray-400 p-4">No photos or videos on this page.</p>';
    return;
  }
  el.innerHTML = '<div class="grid grid-cols-4 gap-2 p-3">'
    + media.map(function(f) {
        var furl = '/uploads/' + _gridEsc(f.filename);
        var isImg = f.mime_type.startsWith('image/');
        return '<button'
             + ' class="aspect-square rounded-lg overflow-hidden bg-gray-100'
             + ' dark:bg-zinc-800 hover:ring-2 hover:ring-[#0053e2] focus:outline-none'
             + ' focus:ring-2 focus:ring-[#0053e2]"'
             + ' onclick="gridPickMedia(' + f.id + ',\'' + _gridEsc(f.mime_type) + '\')"'
             + ' aria-label="Select ' + _gridEsc(f.original_name || f.filename) + '">'
             + (isImg
                ? '<img src="' + furl + '" class="w-full h-full object-cover" loading="lazy" alt="">'
                : '<div class="w-full h-full flex items-center justify-center text-3xl"'
                  + ' aria-hidden="true">🎬</div>')
             + '</button>';
      }).join('')
    + '</div>';
}

async function gridPickMedia(uploadId, mimeType) {
  if (!_gridPickerCell) return;
  var cellType = mimeType.startsWith('video/') ? 'video' : 'image';
  try {
    var r = await fetch('/home/grid/' + _gridPid + '/cells/' + _gridPickerCell, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({upload_id: uploadId, cell_type: cellType})
    });
    if (!r.ok) throw new Error('patch ' + r.status);
    gridCloseMediaPicker();
    await _gridLoadCells();
  } catch(e) { console.error('[grid] pick media failed:', e); }
}
```

### HTML escape helper

```javascript
function _gridEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,  '&amp;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;');
}
```

---

## `templates/base.html` — Script Tag

Determine where the existing page-companion scripts are loaded (search for
`home-page-crm.js` in `base.html` to find the right block). Add the grid script
**before** the uploads companion scripts, e.g.:

```html
<script src="/static/js/home-page-grid.js?v={{ static_v }}" defer></script>
```

> **Verify:** confirm whether other page companion scripts in `base.html` use `defer` or not.
> Follow the same convention. The rule is: `home-page-grid.js` must be parsed before
> `_initSwappedPage()` calls `initGridPage` — ensure the load order satisfies this.

---

## Skills to Invoke

| Skill / Agent | When |
|---|---|
| `bookworm-db-migration` | After editing `database.py` — dry-run to verify `CREATE TABLE IF NOT EXISTS` is idempotent on live DB |
| `bookworm-template-audit` | After writing `home_page_grid.html` and editing `base.html` — catches broken Jinja2 filters, missing `\| safe`, missing `?v=` cache-bust |
| `bookworm-qa` | After full implementation — navigate to a grid page, hit all 6 API endpoints, verify drag-swap, column picker, media picker |
| `bookworm-pre-commit` | Before committing — raw `aiosqlite.connect()` scan, secrets check, `_PUBLIC` audit |
| `bookworm-docs-keeper` | After committing — update CODEPUPPY_NOTES schema section, file map, features-completed list |

---

## BookWorm Gotchas That Apply to This Feature

**Quirk #10 — `_hpCache` 5-minute client-side cache.**
After adding `"grid"` to `PAGE_TYPES` and routing the template, navigating to any page that
the browser previously cached as `page_type = "coming_soon"` will still show stale HTML for up
to 5 minutes. Rule: always hard-refresh (`Ctrl+Shift+R`) after changing `page_type` in the DB
or touching the template routing. Call this out explicitly in QA.

**Quirk #13 — `var` not `let`/`const` at module level.**
`home-page-grid.js` is a standalone file (not HTMX-reinjected), so the strict HTMX
re-execution rule doesn't technically apply. However all other companion JS modules in this
codebase use `var` at module level for consistency — follow that convention throughout.
`let`/`const` inside function bodies are fine.

**Quirk #16 — `tojson | safe` in any `<script>` block.**
The current design has JS fetch cells after page load (no SSR JSON), so this may not arise.
If a future optimisation inlines initial cell data into the template, the rule is mandatory:
`{{ cells | tojson | safe }}` — never `{{ cells | tojson }}` alone.

**Confirmation modal pattern (CODEPUPPY_NOTES Architecture section).**
All three modals (media picker, cell edit, cell delete) must use the exact documented pattern:
`role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `onkeydown` Escape handler, backdrop
`onclick` = close. Never `window.confirm()` or `window.alert()`.

**Schema bug in pre-gathered evidence (see top of this file).**
`upload_id` FK must be `REFERENCES page_uploads(id)` — not `note_attachments(id)`.

**`POST /home/pages/{page_id}/update-config` is a form POST, not JSON.**
`gridSetCols()` must post using `FormData` with field `config_json` (a JSON string).
The endpoint calls `json.loads(config_json)` on the form field, then merges the patch into
the existing config dict. Do NOT `fetch` with `Content-Type: application/json`.

**Verify `GET /home/uploads/{page_id}/files` response shape before coding `_gridMediaFetch()`.**
Read `routers/home_uploads.py` to confirm: exact field names (`file_url` pre-built vs just
`filename`), `total` field name, and the page-query-param name (`page`). Adjust the JS
accordingly — do not guess. Mark the `⚠️ VERIFY` comment in `_gridMediaFetch()` as resolved
before committing.

**Upload ownership in `update_grid_cell`.**
When a user assigns an `upload_id` from a different Uploads page (same user, different page),
the DB helper must verify `page_uploads.user_id = uid` before storing the reference. This
guard is already stubbed in the `update_grid_cell` signature above — do not remove it.

---

## Implementation Checklist

- [ ] **Step 1 — `database.py`**: Add `CREATE TABLE IF NOT EXISTS home_grid_cells` + `CREATE INDEX IF NOT EXISTS idx_grid_cells_page` in `init_db()` after the CRM block. Run `bookworm-db-migration` to verify idempotency.
- [ ] **Step 2 — `routers/home_db.py`**: Add `"grid"` to `PAGE_TYPES` frozenset.
- [ ] **Step 3 — `routers/home_grid_db.py` (new)**: Implement all 6 helpers (`get_grid_cells` with LEFT JOIN, `add_grid_cell`, `update_grid_cell` with uid ownership check + `clear_upload` flag, `delete_grid_cell`, `reorder_grid_cells`, `swap_grid_cells`). All use `get_db()`.
- [ ] **Step 4 — `routers/home_grid.py` (new)**: Implement 6 endpoints with `_get_grid_page` ownership guard. Input validation for `aspect` and `cell_type`. Parse bodies via `await request.json()`. Correct HTTP status codes (201 for create, 204 for delete).
- [ ] **Step 5 — `main.py`**: Import `home_grid as home_grid_router`; `app.include_router(home_grid_router.router)` after `home_buds_router`.
- [ ] **Step 6 — `routers/home.py`**: Add `elif p_type == "grid":` branch; build `uploads_pages`; add `"uploads_pages"` key to the shared `TemplateResponse` context dict (defaults to `[]` for non-grid types).
- [ ] **Step 7 — Verify `GET /home/uploads/{page_id}/files` response shape**: Read `routers/home_uploads.py` — confirm field names, pagination param, `total` key. Update `_gridMediaFetch()` accordingly before writing the JS.
- [ ] **Step 8 — `templates/partials/home_page_grid.html` (new)**: Toolbar (col picker with `id="grid-col-btn-N"`, helper text, Add Cell button), `#grid-empty-state`, `#grid-canvas`, media-picker modal with Jinja2 `uploads_pages` loop, cell-edit modal, cell-delete confirm modal. `data-cols="{{ page.config.get('grid_cols', 4) }}"` on `#grid-page-root`. NO inline `<script>` block. Run `bookworm-template-audit`.
- [ ] **Step 9 — `static/js/home-page-grid.js` (new)**: Implement all functions listed in the JS architecture section. Use `var` at module level. Include `_gridEsc()` helper. Resolve the `⚠️ VERIFY` comment in `_gridMediaFetch()`. Confirm `defer` convention matches other scripts in `base.html`.
- [ ] **Step 10 — `static/js/home-widgets.js`**: Add `#grid-page-root` branch in `_initSwappedPage()` before `#coming-soon-page-root`. Pattern is identical to `#crm-page-root` block.
- [ ] **Step 11 — `templates/base.html`**: Add `<script src="/static/js/home-page-grid.js?v={{ static_v }}" defer>` in correct position. Verify load order doesn't break `initGridPage` availability.
- [ ] **Step 12 — Smoke test**: Create a new page with `page_type = "grid"`. Navigate to it. Add cells, pick media from an Uploads page, drag-swap two cells, change columns, reload — verify persistence. Test with no Uploads pages (empty state in picker).
- [ ] **Step 13 — `bookworm-qa`**: Hit all 6 endpoints, navigate to grid page, verify error logs clean.
- [ ] **Step 14 — `bookworm-pre-commit`**: Run full 10-phase checklist.
- [ ] **Step 15 — `bookworm-docs-keeper`**: Update CODEPUPPY_NOTES schema table (add `home_grid_cells`), file map (new routers + JS + template), features-completed list.

---

## Open Questions

1. **`GET /home/uploads/{page_id}/files` exact response shape** — Must be verified by reading
   `routers/home_uploads.py` before writing `_gridMediaFetch()`. Specifically: is `file_url`
   returned pre-built, or only `filename` (requiring `/uploads/` prefix in JS)? What is the
   exact name of the pagination query param and the `total` response key?

2. **Empty-state initial cells** — When a grid page is first created, should `initGridPage`
   auto-create N empty cells (e.g. 12 for a 4-col × 3-row starter), or start completely
   empty? A pre-populated starter grid makes drop targets visible immediately and improves
   first-run UX. Recommend: detect `_gridCells.length === 0` and offer a "Bootstrap grid"
   button rather than auto-creating silently (avoids polluting DB with placeholder rows the
   user may never fill). Needs a product decision before Step 9.

3. **`defer` vs synchronous load for `home-page-grid.js`** — Check whether existing companion
   scripts in `base.html` use `defer`. If they do not, adding `defer` here could cause a race
   where `_initSwappedPage()` fires before `initGridPage` is defined. Read `base.html` load
   order before deciding.

4. **Tailwind arbitrary-value class availability** — `aspect-[4/5]` uses Tailwind's
   JIT arbitrary-value syntax. Since BookWorm uses the Tailwind CDN (JIT mode), this should
   work. Confirm `aspect-[4/5]` renders correctly in the browser before shipping — if not,
   fall back to inline style `style="aspect-ratio: 4/5"`.

5. **Cross-page uploads page access** — The media picker fetches files from *any* of the
   user's Uploads pages. If the user has 0 Uploads pages, the picker shows an empty state.
   Should the grid page's `home_page_view` branch also handle the case where `uploads_pages`
   is empty by passing a `no_media_source` flag to the template for a more prominent
   empty-state CTA? Or is the in-picker message sufficient?
