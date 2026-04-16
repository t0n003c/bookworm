# Plan: PDF Annotations — Document Studio Phase 8 (Feature B2)
Date: 2026-04-16
Estimated complexity: Medium

## Summary

Add a non-destructive PDF annotation layer to the Document Studio. Highlights,
sticky notes, and text boxes are stored in a new `pdf_annotations` table as
percentage-based coordinates and rendered as absolutely-positioned `<div>`s over
a PDF.js canvas inside a dedicated fullscreen modal (`#upl-annot-modal`). No
PyMuPDF / server-side PDF mutation required — the PDF on disk is never touched.
The "📝 Annotate PDF" button is injected into the existing Document Studio panel
by `_uplDocStudioInit` for any `page`-source PDF file.

---

## Files to Change
Touch in this exact order to avoid missing-import errors.

| # | File | What changes |
|---|---|---|
| 1 | `database.py` | Add `pdf_annotations` table + index in `init_db()` |
| 2 | `routers/uploads_docs_db.py` | Add 4 annotation DB helpers |
| 3 | `routers/home_uploads_docs.py` | Add `AnnotationBody` Pydantic model + 4 REST endpoints |
| 4 | `templates/partials/home_page_uploads.html` | Add `#upl-annot-modal` block after `#upl-spreadsheet-modal` |
| 5 | `static/js/home-page-uploads-annot.js` | New file — full annotation module |
| 6 | `templates/base.html` | Add `<script defer>` for annot.js after spreadsheet.js |
| 7 | `static/js/home-page-uploads-docs.js` | Add `canAnnotate` + `📝 Annotate PDF` button |

## New Files to Create

| File | Purpose |
|---|---|
| `static/js/home-page-uploads-annot.js` | PDF.js loader, canvas renderer, overlay CRUD, all annotation JS |

---

## DB Migration

Add to `init_db()` in `database.py` — additive, idempotent, no table-swap needed.

```sql
CREATE TABLE IF NOT EXISTS pdf_annotations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id     INTEGER NOT NULL REFERENCES page_uploads(id) ON DELETE CASCADE,
  page_num    INTEGER NOT NULL DEFAULT 0,
  type        TEXT    NOT NULL,
  x_pct       REAL    NOT NULL,
  y_pct       REAL    NOT NULL,
  width_pct   REAL    NOT NULL DEFAULT 0.2,
  height_pct  REAL    NOT NULL DEFAULT 0.05,
  color       TEXT    NOT NULL DEFAULT '#ffc220',
  content     TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pdf_annot_file
  ON pdf_annotations(file_id, user_id);
```

`type` accepted values: `'highlight'` | `'sticky'` | `'textbox'`
`page_num` is 0-indexed (matches PDF.js `pageNumber - 1`).

---

## Backend Endpoints

### Pydantic model — add to `home_uploads_docs.py`

```python
class AnnotationBody(BaseModel):
    page_num:   int   = 0
    type:       str   = "highlight"   # 'highlight'|'sticky'|'textbox'
    x_pct:      float = 0.0
    y_pct:      float = 0.0
    width_pct:  float = 0.2
    height_pct: float = 0.05
    color:      str   = "#ffc220"
    content:    str   = ""
```

Add a minimal validator: `type` must be in `{'highlight', 'sticky', 'textbox'}`.

### Route logic (all 4 routes follow the same guard sequence)

**GET** `/{page_id}/files/page/{file_id}/annotations`
```
uid = request.session.get("user_id") or raise 401
await _require_uploads_page(page_id, uid)         # raises 404 if page not owned
row = await get_page_upload_owned(file_id, uid)   # raises 404 if file not owned
rows = await get_annotations(file_id, uid)
return JSONResponse({"annotations": rows})
```
*(No `_demo_guard` — reads are safe in demo mode.)*

**POST** `/{page_id}/files/page/{file_id}/annotations`
```
if guard := _demo_guard(request): return guard
uid = request.session.get("user_id") or raise 401
await _require_uploads_page(page_id, uid)
await get_page_upload_owned(file_id, uid)         # ownership check
annot_id = await create_annotation(file_id, uid, body)
return JSONResponse({"id": annot_id}, status_code=201)
```

**PUT** `/{page_id}/files/page/{file_id}/annotations/{annot_id}`
```
if guard := _demo_guard(request): return guard
uid = request.session.get("user_id") or raise 401
await _require_uploads_page(page_id, uid)
await get_page_upload_owned(file_id, uid)
n = await update_annotation(annot_id, uid, body)
if n == 0: raise HTTPException(404)
return JSONResponse({"ok": True})
```

**DELETE** `/{page_id}/files/page/{file_id}/annotations/{annot_id}`
```
if guard := _demo_guard(request): return guard
uid = request.session.get("user_id") or raise 401
await _require_uploads_page(page_id, uid)
await get_page_upload_owned(file_id, uid)
n = await delete_annotation(annot_id, uid)
if n == 0: raise HTTPException(404)
return Response(status_code=204)
```

Import additions needed at top of `home_uploads_docs.py`:
```python
from routers.uploads_docs_db import (
    get_page_upload_owned_bulk,
    update_page_upload_size,
    get_annotations,        # new
    create_annotation,      # new
    update_annotation,      # new
    delete_annotation,      # new
)
```

---

## DB Helpers — `routers/uploads_docs_db.py`

Add all four functions. All use `get_db()`. Row dicts via `db.row_factory = aiosqlite.Row` (already set by `get_db()`).

```python
async def get_annotations(file_id: int, user_id: int) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, page_num, type, x_pct, y_pct, width_pct, height_pct, "
            "color, content, created_at "
            "FROM pdf_annotations WHERE file_id=? AND user_id=? ORDER BY created_at",
            (file_id, user_id),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def create_annotation(file_id: int, user_id: int, data) -> int:
    async with get_db() as db:
        cur = await db.execute(
            "INSERT INTO pdf_annotations "
            "(user_id, file_id, page_num, type, x_pct, y_pct, "
            " width_pct, height_pct, color, content) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (user_id, file_id, data.page_num, data.type,
             data.x_pct, data.y_pct, data.width_pct, data.height_pct,
             data.color, data.content),
        )
        await db.commit()
    return cur.lastrowid


async def update_annotation(annot_id: int, user_id: int, data) -> int:
    """Update position + content. Returns affected rowcount (0 = not found/not owned)."""
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE pdf_annotations SET "
            "x_pct=?, y_pct=?, width_pct=?, height_pct=?, color=?, content=? "
            "WHERE id=? AND user_id=?",
            (data.x_pct, data.y_pct, data.width_pct, data.height_pct,
             data.color, data.content, annot_id, user_id),
        )
        await db.commit()
    return cur.rowcount


async def delete_annotation(annot_id: int, user_id: int) -> int:
    """Returns affected rowcount (0 = not found/not owned)."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM pdf_annotations WHERE id=? AND user_id=?",
            (annot_id, user_id),
        )
        await db.commit()
    return cur.rowcount
```

---

## `#upl-annot-modal` HTML Block

Insert in `templates/partials/home_page_uploads.html` immediately after the
closing `</div>` of `#upl-spreadsheet-modal` (currently line ~465) and before
`</div>{# /uploads-page-root #}`.

```html
{# ── PDF Annotations modal ─────────────────────────────────────────────────── #}
<div id="upl-annot-modal"
     class="hidden fixed inset-0 z-[60] flex flex-col"
     role="dialog" aria-modal="true" aria-labelledby="upl-annot-title" tabindex="-1"
     onkeydown="if(event.key==='Escape')_uplAnnotClose()">

  {# ── Top bar ── #}
  <div class="flex items-center gap-2 px-4 py-2 flex-shrink-0
              bg-zinc-900 border-b border-zinc-700 flex-wrap">
    <span class="text-base leading-none">📝</span>
    <span id="upl-annot-filename"
          class="text-sm font-semibold text-zinc-100 truncate flex-1 min-w-0"></span>
    <span id="upl-annot-title" class="text-xs text-zinc-400 select-none mr-2">PDF Annotations</span>

    {# Tool buttons #}
    <button type="button" id="upl-annot-tool-highlight"
            onclick="_uplAnnotAddMode('highlight')"
            class="px-2.5 py-1 text-xs rounded-lg border border-zinc-600
                   text-zinc-300 hover:text-white hover:border-[#ffc220]
                   transition focus:outline-none focus:ring-1 focus:ring-[#ffc220]"
            aria-label="Highlight tool">🖊 Highlight</button>
    <button type="button" id="upl-annot-tool-sticky"
            onclick="_uplAnnotAddMode('sticky')"
            class="px-2.5 py-1 text-xs rounded-lg border border-zinc-600
                   text-zinc-300 hover:text-white hover:border-[#ffc220]
                   transition focus:outline-none focus:ring-1 focus:ring-[#ffc220]"
            aria-label="Sticky note tool">📌 Sticky</button>
    <button type="button" id="upl-annot-tool-textbox"
            onclick="_uplAnnotAddMode('textbox')"
            class="px-2.5 py-1 text-xs rounded-lg border border-zinc-600
                   text-zinc-300 hover:text-white hover:border-[#ffc220]
                   transition focus:outline-none focus:ring-1 focus:ring-[#ffc220]"
            aria-label="Text box tool">🔤 Text Box</button>

    {# Page navigation #}
    <button type="button" onclick="_uplAnnotSetPage(_uplAnnotState.page - 1)"
            class="px-2 py-1 text-xs rounded border border-zinc-600 text-zinc-300
                   hover:text-white transition focus:outline-none"
            aria-label="Previous page">‹</button>
    <span id="upl-annot-page-label"
          class="text-xs text-zinc-400 select-none whitespace-nowrap">Page 1 / 1</span>
    <button type="button" onclick="_uplAnnotSetPage(_uplAnnotState.page + 1)"
            class="px-2 py-1 text-xs rounded border border-zinc-600 text-zinc-300
                   hover:text-white transition focus:outline-none"
            aria-label="Next page">›</button>

    <button type="button" onclick="_uplAnnotClose()"
            class="text-zinc-300 hover:text-white bg-zinc-700 hover:bg-zinc-600
                   rounded-lg px-3 py-1.5 text-xs font-medium transition
                   focus:outline-none focus:ring-1 focus:ring-white ml-1"
            aria-label="Close annotation editor">✕ Close</button>
  </div>

  {# ── Loading state ── #}
  <div id="upl-annot-loading"
       class="flex-1 flex items-center justify-center bg-zinc-950 text-zinc-400 text-sm">
    <svg class="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path class="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
    Loading PDF…
  </div>

  {# ── Error state ── #}
  <div id="upl-annot-error"
       class="hidden flex-1 flex flex-col items-center justify-center bg-zinc-950
              text-red-400 text-sm gap-3">
    <p id="upl-annot-error-msg"></p>
    <button type="button" onclick="_uplAnnotClose()"
            class="text-xs px-3 py-1.5 rounded-lg border border-zinc-600
                   text-zinc-300 hover:text-white transition">Close</button>
  </div>

  {# ── Canvas + overlay ── #}
  <div id="upl-annot-body"
       class="hidden flex-1 overflow-auto bg-zinc-950 flex items-start justify-center p-4">
    <div id="upl-annot-canvas-wrap" style="position:relative;display:inline-block;">
      <canvas id="upl-annot-canvas"></canvas>
      <div id="upl-annot-overlay"
           style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></div>
    </div>
  </div>
</div>
```

---

## JS Module Spec — `static/js/home-page-uploads-annot.js`

All `var`. No `let`/`const`. `'use strict';` at top.
Depends on shared globals: `_uplPid`, `_uplEsc`, `_uplShowToast`, `_uplFetch`.

### Module-level state variables
```javascript
var _uplAnnotFile         = null;   // current file object
var _uplAnnotPdfDoc       = null;   // pdf.js PDFDocumentProxy
var _uplAnnotLibsPromise  = null;   // cached CDN load promise
var _uplAnnotState = {
  page:    0,          // 0-indexed current page
  total:   1,
  tool:    null,       // 'highlight'|'sticky'|'textbox'|null
  annots:  [],         // array of annotation objects from server
  busy:    false,
};
```

### CDN URLs (pinned)
```javascript
var _PDFJS_URL   = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var _PDFJS_WRKR  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
```

### Public functions

**`_uplAnnotLoadLibs()`** → `Promise`
- If `_uplAnnotLibsPromise` already set, return it immediately (cache hit).
- Otherwise: inject `<script src="_PDFJS_URL">`, wait for `load` event, set
  `pdfjsLib.GlobalWorkerOptions.workerSrc = _PDFJS_WRKR`, store and return promise.

**`_uplAnnotOpen(f)`** → `async`
1. Store `_uplAnnotFile = f`.
2. Set `#upl-annot-filename` text to `f.original_name`.
3. Remove `hidden` from `#upl-annot-modal`; show `#upl-annot-loading`; hide `#upl-annot-body` + `#upl-annot-error`.
4. Reset `_uplAnnotState`: `page=0, tool=null, annots=[]`.
5. Clear `#upl-annot-overlay` innerHTML; deactivate all tool buttons (remove active styling).
6. `await _uplAnnotLoadLibs()`.
7. Fetch PDF bytes: `GET /home/uploads/{_uplPid}/files/{f.src}/{f.id}/download` with credentials.
   - Check `Content-Type: text/html` → session expired → show error "Session expired — please reload".
8. `pdfjsLib.getDocument({data: arrayBuffer})` → store in `_uplAnnotPdfDoc`.
9. `_uplAnnotState.total = pdfDoc.numPages`.
10. Fetch annotations: `GET /home/uploads/{_uplPid}/files/page/{f.id}/annotations`.
    - Store in `_uplAnnotState.annots`.
11. `await _uplAnnotRenderPage(0)`.
12. Hide `#upl-annot-loading`; show `#upl-annot-body`.
13. Catch all errors → hide loading, show `#upl-annot-error` with message.

**`_uplAnnotClose()`**
- Add `hidden` to `#upl-annot-modal`. Null out `_uplAnnotPdfDoc`, `_uplAnnotFile`.
- Reset state. Do NOT destroy PDF.js worker — reuse across opens.

**`_uplAnnotRenderPage(n)`** → `async`
- Guard: `n < 0` or `n >= total` → return.
- `_uplAnnotState.page = n`.
- `page = await _uplAnnotPdfDoc.getPage(n + 1)`.  *(PDF.js pages are 1-indexed.)*
- Compute viewport: `page.getViewport({ scale: 1.5 })`.
- Size `#upl-annot-canvas` to `viewport.width × viewport.height`.
- `page.render({ canvasContext, viewport })` → await completion.
- Update `#upl-annot-page-label` → `"Page N / Total"` (1-indexed for display).
- Call `_uplAnnotDrawOverlay()`.

**`_uplAnnotSetPage(n)`**
- Clamps to `[0, total-1]`. Calls `_uplAnnotRenderPage(n)`.

**`_uplAnnotDrawOverlay()`**
- Clear `#upl-annot-overlay` innerHTML.
- Get canvas `width` + `height` in px (for CSS `%` → `px` back-conversion if needed — we use `%` directly).
- For each annotation in `_uplAnnotState.annots` where `a.page_num === _uplAnnotState.page`:
  call `_uplAnnotMakeDiv(a)` → append to overlay.

**`_uplAnnotMakeDiv(a)`** → DOM element
- Create `<div>` with `style`:
  ```
  position:absolute;
  left:  (a.x_pct * 100)%;
  top:   (a.y_pct * 100)%;
  width: (a.width_pct * 100)%;
  height:(a.height_pct * 100)%;
  pointer-events:auto;
  ```
- `data-aid` = `a.id`.
- Visual by type:
  - **highlight**: `background:rgba(255,194,32,0.35); border:none; cursor:default;`
    - Delete button (tiny `✕` top-right, visible on hover via CSS class).
  - **sticky**: `background:#ffc220; border-radius:6px; padding:4px; overflow:hidden;`
    - Contains `<textarea>` (full width/height minus padding, no border, transparent bg, `font-size:11px`).
    - `textarea.value = a.content`. `onblur` → `_uplAnnotSave(a.id, textarea.value)`.
    - Delete button top-right.
  - **textbox**: `background:white; border:1.5px solid #0053e2; border-radius:4px; padding:4px;`
    - Contains `<textarea>` same as sticky but white bg.
    - `textarea.value = a.content`. `onblur` → `_uplAnnotSave(a.id, textarea.value)`.
    - Delete button top-right.
- Delete button: `position:absolute; top:2px; right:2px; font-size:9px; background:rgba(0,0,0,0.5); color:white; border:none; border-radius:3px; cursor:pointer; padding:1px 4px; line-height:1;`  `onclick` → `_uplAnnotDelete(a.id)`.
- Return the div.

**`_uplAnnotAddMode(type)`**
- Toggle: if `_uplAnnotState.tool === type` → set to `null` (cancel mode), else set to `type`.
- Update visual state of all 3 tool buttons: active tool gets `border-[#ffc220] text-[#ffc220]` classes, others reset.
- Set `#upl-annot-overlay` `cursor`: `crosshair` when tool active, `default` when null.
- Attach or remove click listener on `#upl-annot-overlay` via `_uplAnnotHandleOverlayClick`.

**`_uplAnnotHandleOverlayClick(e)`**
- If no tool active or busy → return.
- Compute click position as `%` of overlay dimensions:
  ```javascript
  var rect = e.currentTarget.getBoundingClientRect();
  var xPct = (e.clientX - rect.left) / rect.width;
  var yPct = (e.clientY - rect.top)  / rect.height;
  ```
- Default dimensions: highlight `width=0.25, height=0.04`; sticky/textbox `width=0.2, height=0.12`.
- POST to `/home/uploads/{pid}/files/page/{fid}/annotations` with JSON body matching `AnnotationBody`.
- On success: push returned annotation object (with server `id`) into `_uplAnnotState.annots`. Call `_uplAnnotDrawOverlay()`.
- On error: `_uplShowToast('Could not add annotation', true)`.

**`_uplAnnotSave(aid, content)`** → `async`
- `PUT /home/uploads/{pid}/files/page/{fid}/annotations/{aid}` with body containing updated `content` plus current `x_pct/y_pct/width_pct/height_pct/color` (read from the stored annot object in `_uplAnnotState.annots`).
- On error: `_uplShowToast('Save failed', true)`.
- On success: update the matching entry in `_uplAnnotState.annots`.

**`_uplAnnotDelete(aid)`** → `async`
- `DELETE /home/uploads/{pid}/files/page/{fid}/annotations/{aid}`.
- On success: remove from `_uplAnnotState.annots`. Remove the div with `data-aid=aid` from `#upl-annot-overlay`.
- On error: `_uplShowToast('Delete failed', true)`.

*(Helper: `_uplAnnotAid()` and `_uplAnnotFid()` — private getters that return `_uplAnnotFile.id` and current `_uplPid`.)*

---

## `home-page-uploads-docs.js` Change

In `_uplDocStudioInit(f)`, add after the existing `canSign` declaration and before the `if (!canView && ...)` guard:

```javascript
var canAnnotate = f.src === 'page'
  && f.mime_type === 'application/pdf'
  && typeof _uplAnnotOpen === 'function';
```

In the `btns.push(...)` block, insert after the `✍️ Sign PDF` push and before `→ PDF`:

```javascript
if (canAnnotate) btns.push(
  '<button onclick="_uplAnnotOpen(_uplDocCurrentFile)" class="' + _STUDIO_BTN + '">📝 Annotate PDF</button>'
);
```

---

## `base.html` Change

Insert immediately after line 587 (spreadsheet.js `<script>` tag):

```html
<script src="/static/js/home-page-uploads-annot.js?v={{ static_v }}" defer></script>
```

---

## Skills to Invoke

After implementation, run in this order:
1. **bookworm-db-migration** — validate the `pdf_annotations` table + index migration is idempotent on the live DB.
2. **bookworm-template-audit** — confirm no `let`/`const` crept into the new JS; verify `?v={{ static_v }}` on the new script tag; check `#upl-annot-modal` HTML IDs are unique.
3. **bookworm-qa** — hit all 4 annotation endpoints; open Annotate PDF modal; test all three tool types; verify page nav; confirm no regressions on Sign PDF / Spreadsheet.
4. **bookworm-pre-commit** — before committing.
5. **bookworm-docs-keeper** — update CODEPUPPY_NOTES.md: new table in schema section, new JS file in key file map, new endpoints in `home_uploads_docs.py` description.

---

## BookWorm Gotchas That Apply to This Feature

| # | Gotcha |
|---|---|
| G1 | **`var` only** in `home-page-uploads-annot.js` — no `let`/`const`. Even though this file is not a Jinja2 partial, house style for all uploads companion files uses `var`. |
| G2 | **PDF.js CDN load order** — inject script tag, wait for `load` event *before* calling `pdfjsLib.getDocument()`. Do NOT assume `pdfjsLib` is defined at module parse time. |
| G3 | **PDF.js worker** — must set `pdfjsLib.GlobalWorkerOptions.workerSrc` after the main script loads and before any `getDocument()` call. Same CDN version (`3.11.174`) for both files — version mismatch = silent hang. |
| G4 | **Session expiry** — the PDF download fetch returns `302 → HTML` when expired. Check `response.headers.get('content-type')` starts with `text/html` *before* calling `.arrayBuffer()`. Show inline error instead of a `JSON.parse` crash. |
| G5 | **`_demo_guard` first** — POST/PUT/DELETE annotation endpoints must call `_demo_guard(request)` as line 1, before even reading `session["user_id"]`. GET (read) does not need it. |
| G6 | **`get_db()` only** — new DB helpers in `uploads_docs_db.py` must import and use `get_db` from `database`. Never `aiosqlite.connect()` directly. |
| G7 | **`?v={{ static_v }}`** — the new `<script defer>` tag in `base.html` must include this cache-buster. |
| G8 | **`_PUBLIC` unchanged** — all 4 annotation endpoints are auth-gated. Do not add them to `_PUBLIC` in `auth_middleware.py`. |
| G9 | **PDF.js page numbers** — PDF.js `getPage()` is 1-indexed; our DB stores 0-indexed `page_num`. Always `getPage(page_num + 1)` and display `page_num + 1` to the user. |
| G10 | **Overlay click target** — `#upl-annot-overlay` has `pointer-events:none` by default. Switch to `pointer-events:auto` when a tool is active; restore to `none` when tool is cancelled, so annotation `<div>`s inside the overlay remain clickable. |

---

## Implementation Checklist

- [x] 1. `database.py` — paste `CREATE TABLE IF NOT EXISTS pdf_annotations` + `CREATE INDEX IF NOT EXISTS idx_pdf_annot_file` inside `init_db()`, after existing `page_upload_tags` block.
- [x] 2. `routers/uploads_docs_db.py` — add `get_annotations`, `create_annotation`, `update_annotation`, `delete_annotation` functions (exact SQL from plan above).
- [x] 3. `routers/home_uploads_annot.py` — NEW FILE: `AnnotationBody` Pydantic model (with `type` validator). 4 route handlers following exact guard sequence. Registered in `main.py`.
- [x] 4. `templates/partials/home_page_uploads.html` — inserted `#upl-annot-modal` block after `</div>{# end #upl-spreadsheet-modal #}`, before `</div>{# /uploads-page-root #}`.
- [x] 5. `static/js/home-page-uploads-annot.js` — created new file (286 lines). All `var`. All 9 public/private functions per spec.
- [x] 6. `templates/base.html` — added `<script defer src="/static/js/home-page-uploads-annot.js?v={{ static_v }}"></script>` after spreadsheet.js.
- [x] 7. `static/js/home-page-uploads-docs.js` — added `canAnnotate` var + `📝 Annotate PDF` button push after `✍️ Sign PDF`.
- [x] 8. Restarted server (`restart.bat`). `_health_check.py` → exit 0. All 11 templates OK.
- [ ] 9. Manual smoke test: open an Uploads page, select a PDF, click `📝 Annotate PDF`. Confirm PDF renders. Test Highlight (click → yellow overlay). Test Sticky (click → editable yellow card, blur saves). Test Text Box (click → editable white box). Test page nav on a multi-page PDF. Test delete (✕ on annotation). Reload modal — confirm annotations persisted.
- [x] 10. **bookworm-db-migration** — validated via `_health_check.py` + QA sweep. `pdf_annotations` + index created on startup.
- [x] 11. **bookworm-template-audit** — 5/5 checks green. No `let`/`const`, correct cache-bust, all IDs present, no `<script>` in partial.
- [x] 12. **bookworm-qa** — 100% green. All 4 annotation endpoints auth-redirect correctly, static assets serve 200, no errors in logs, DB migration confirmed.
- [x] 13. **bookworm-pre-commit** — 0 blockers. Patched `!r.ok` check in `_uplAnnotDelete`; added docstring to `update_annotation`.
- [ ] 14. Run **bookworm-docs-keeper** — update `pdf_annotations` in schema section, new JS file in key file map, Phase 8 note in `home_uploads_docs.py` description.
- [ ] 15. Commit: `feat(uploads): PDF annotations overlay — Phase 8 B2`.

---

## Open Questions

1. **Download endpoint path** — the JS fetches PDF bytes via the existing download route. Confirm the exact path is `/home/uploads/{pid}/files/{src}/{fid}/download` (check `home_uploads.py` `@router.get("/{page_id}/files/{src}/{file_id}/download")`). If the route returns a `FileResponse` (not JSON), `response.arrayBuffer()` is correct — verify it isn't content-negotiated differently.
2. **Scale factor** — `scale: 1.5` is a reasonable default for 1080p screens. Consider exposing a zoom control (`+` / `-` buttons) in a follow-on. Not needed for Phase 8.
3. **Multi-user visibility** — current plan scopes annotations to `user_id`. If the team later wants shared annotations, the `user_id` ownership model needs a separate `visibility` column and a query change. Out of scope for Phase 8.
4. **Highlight resize** — annotation divs are fixed-size on create. Drag-to-resize is a Phase 9 enhancement. Out of scope here.
