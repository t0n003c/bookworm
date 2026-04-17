# Plan: Uploads Homespace — Catalog Feature
Date: 2026-04-17
Estimated complexity: High

---

## Summary

Add a **Catalog** system to the Uploads Homespace sidebar. Catalogs live in the lower
half of the existing **Folders tab** (`sb-panel-folders`), separated from the virtual
folder tree by a labeled divider. Unlike virtual folders (one FK on `page_uploads`),
catalogs are **many-to-many**: any number of files can belong to any number of catalogs
simultaneously via a junction table — no duplication. Catalogs support **parent/child
nesting** (same self-referential FK pattern as `upload_folders`) and **drag-and-drop
reordering + reparenting** (same 3-zone drop logic as the folder module). Clicking a
catalog filters the file grid to its members. Files are assigned to / removed from
catalogs via a "Catalogs" badge section added to the existing detail panel. Folder and
catalog filters are **mutually exclusive** — activating one clears the other.

---

## Files to Change

Touch in this order to avoid dependency failures:

| # | File | What changes |
|---|---|---|
| 1 | `database.py` | Add `upload_catalogs` table + `upload_catalog_files` junction table + indexes |
| 2 | `routers/uploads_db.py` | Add `catalog_id: Optional[int] = None` param to `get_uploads_page()`; inject JOIN branch; force `use_union = False` when set |
| 3 | `routers/home_uploads.py` | Add `catalog_id: int = Query(None)` to `list_files()`, pass through to `get_uploads_page()` |
| 4 | `main.py` | Import + `include_router` for `home_uploads_catalogs_router` after folders router line |
| 5 | `templates/index.html` | Restructure `sb-panel-folders` div: add Folders section label, catalog divider + label, `#upl-catalog-tree` container |
| 6 | `templates/base.html` | Add `<script>` tag for `home-page-uploads-catalogs.js?v={{ static_v }}` after folders tag |
| 7 | `static/js/home-page-uploads-folders.js` | Add `_uplFolderClearActive()`; call catalog enter/exit hooks from Enter/Exit fns; call `_uplCatalogClearActive()` on folder selection |
| 8 | `static/js/home-page-uploads.js` | Append `_catQs` from `_uplCatalogGetFilter()` to `_uplFetch` URL; add `#upl-detail-catalogs` placeholder div in page-src detail HTML; call `_uplRenderDetailCatalogs(f)` hook after detail render |

---

## New Files to Create

| File | Purpose |
|---|---|
| `routers/uploads_catalogs_db.py` | All DB helpers for catalog CRUD + junction table CRUD |
| `routers/home_uploads_catalogs.py` | FastAPI router — 7 endpoints, prefix `/home/uploads` |
| `static/js/home-page-uploads-catalogs.js` | Catalog tree module: render, CRUD, DnD, filter hook, detail badge panel |

---

## DB Migrations Needed

All migrations go inside the existing `async with aiosqlite.connect(DB_PATH) as db:`
block in `init_db()` in `database.py`, **after the `page_uploads.folder_id` additive
migration block and before `await db.commit()`**. Both are additive (CREATE IF NOT
EXISTS) — safe to run on a live database 10×.

### 1 — `upload_catalogs` table

```sql
CREATE TABLE IF NOT EXISTS upload_catalogs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id     INTEGER NOT NULL REFERENCES home_pages(id)     ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    parent_id   INTEGER REFERENCES upload_catalogs(id)         ON DELETE SET NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
)

CREATE INDEX IF NOT EXISTS idx_upload_catalogs_page
ON upload_catalogs(page_id, user_id, parent_id, sort_order)
```

### 2 — `upload_catalog_files` junction table

```sql
CREATE TABLE IF NOT EXISTS upload_catalog_files (
    catalog_id  INTEGER NOT NULL REFERENCES upload_catalogs(id) ON DELETE CASCADE,
    upload_id   INTEGER NOT NULL REFERENCES page_uploads(id)    ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
    added_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (catalog_id, upload_id)
)

CREATE INDEX IF NOT EXISTS idx_ucf_upload
ON upload_catalog_files(upload_id, user_id)
```

> **No table-swap dance needed.** Both tables are brand new. All FKs use `ON DELETE CASCADE`
> so deleting a catalog cleans up its junction rows automatically; deleting a file cleans
> up its memberships automatically.

---

## New Files — Detailed Specification

### `routers/uploads_catalogs_db.py`

Mirror the structure of `uploads_folders_db.py`. Import `get_db` from `database` —
never raw `aiosqlite.connect()`.

| Function | Signature | Notes |
|---|---|---|
| `_catalog_owned(catalog_id, user_id, db)` | `async -> dict` | Raise `KeyError` if not found/not owned |
| `_is_descendant(catalog_id, candidate_parent_id, all_catalogs)` | `-> bool` | Exact copy of folder helper — cycle prevention |
| `get_catalogs_for_page(page_id, user_id)` | `async -> list[dict]` | `ORDER BY parent_id NULLS FIRST, sort_order, name` |
| `create_catalog(page_id, user_id, name, parent_id)` | `async -> dict` | INSERT + re-SELECT |
| `update_catalog(catalog_id, user_id, name, parent_id, is_parent_set, all_catalogs, sort_order)` | `async -> dict` | Same sentinel logic as `update_folder`; raise `ValueError("circular")` on cycle |
| `delete_catalog(catalog_id, user_id)` | `async -> bool` | DELETE; CASCADE handles junction rows; returns True if row existed |
| `get_file_catalogs(upload_id, user_id)` | `async -> list[dict]` | JOIN `upload_catalogs` via `upload_catalog_files`; return `[{id, name, parent_id}]` |
| `add_file_to_catalog(catalog_id, upload_id, user_id)` | `async -> bool` | `INSERT OR IGNORE INTO upload_catalog_files`; return True if new row |
| `remove_file_from_catalog(catalog_id, upload_id, user_id)` | `async -> bool` | DELETE from junction; return True if row existed |

---

### `routers/home_uploads_catalogs.py`

```python
router = APIRouter(prefix="/home/uploads", tags=["uploads-catalogs"])
```

All endpoints return JSON. Copy the local `_demo_guard` and `_require_uploads_page`
guard pattern from `home_uploads_folders.py` — do **NOT** import them cross-router.

#### Pydantic models

```python
class CatalogCreateBody(BaseModel):
    name: str            # strip; 1–80 chars; field_validator enforces
    parent_id: Optional[int] = None

class CatalogPatchBody(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None   # present+None = move to root
    move_to_root: bool = False         # unambiguous root-move flag
    sort_order: Optional[int] = None

class CatalogFileBody(BaseModel):
    upload_id: int
```

#### Endpoints

| Method | Path | Guard | Body | Success response |
|---|---|---|---|---|
| `GET` | `/{page_id}/catalogs` | session uid | — | `{"catalogs": [...]}` 200 |
| `POST` | `/{page_id}/catalogs` | demo_guard | `CatalogCreateBody` | new catalog dict 201 |
| `PATCH` | `/{page_id}/catalogs/{catalog_id}` | demo_guard | `CatalogPatchBody` | updated dict 200 |
| `DELETE` | `/{page_id}/catalogs/{catalog_id}` | demo_guard | — | 204 |
| `GET` | `/{page_id}/files/page/{upload_id}/catalogs` | session uid | — | `{"catalogs": [...]}` 200 |
| `POST` | `/{page_id}/catalogs/{catalog_id}/files` | demo_guard | `CatalogFileBody` | `{"ok": true}` 200 |
| `DELETE` | `/{page_id}/catalogs/{catalog_id}/files/{upload_id}` | demo_guard | — | 204 |

Error behaviour: `404` not found, `400` circular reparent, `401` no session.

---

### `static/js/home-page-uploads-catalogs.js`

**Every variable and function declaration must use `var` / `function` — no `let`/`const`.**
This file is loaded globally; the uploads page is entered/exited via HTMX re-injection.
`let`/`const` throw `SyntaxError: Identifier already declared` on the second page visit.

#### Module-level state (all `var`)

```
_uplCatPid         — active page_id (0 = not on an uploads page)
_uplCatData        — flat list [{id, name, parent_id, sort_order}]
_uplCatActive      — selected catalog id (null = "All files")
_uplCatBusy        — request-in-flight guard (bool)
_uplCatModalMode   — 'create' | 'rename'
_uplCatModalParent — parent_id for 'create' mode
_uplCatModalTarget — catalog id for 'rename' mode
_uplCatDragId      — catalog id being dragged (null = not dragging)
_uplCatDropIntent  — 'before' | 'inside' | 'after'
_uplCatCollapsed   — {[catalogId]: true} collapse state map
_uplCatDelPending  — catalog id pending delete confirmation
```

#### Public API (called from other modules)

| Function | Called by | Purpose |
|---|---|---|
| `_uplCatalogEnterUploadsPage(pid)` | `home-page-uploads-folders.js` → Enter fn | Set pid, fetch + render tree |
| `_uplCatalogExitUploadsPage()` | `home-page-uploads-folders.js` → Exit fn | Zero state, clear `#upl-catalog-tree` |
| `_uplCatalogGetFilter()` | `home-page-uploads.js` → `_uplFetch` | Returns `'&catalog_id=N'` or `''` |
| `_uplCatalogClearActive()` | `home-page-uploads-folders.js` on folder click | Set `_uplCatActive = null`, re-render tree |
| `_uplRenderDetailCatalogs(f)` | `home-page-uploads.js` → `_uplRenderDetail` | Fetch file catalogs, render badge list + add/remove UI into `#upl-detail-catalogs` |

#### Internal functions

| Function | Notes |
|---|---|
| `_uplCatalogFetch()` | `GET /{pid}/catalogs`; populate `_uplCatData`; call render |
| `_uplCatalogRender()` | Build parent→children map; recursive render into `#upl-catalog-tree`; call `_uplCatalogEnsureModal()` |
| `_uplCatalogRenderNode(cat, depth, byParent)` | Return HTML string for one tree row: indent, collapse toggle, drag handle, name, +child / rename / delete icon buttons |
| `_uplCatalogSelect(id)` | Set `_uplCatActive`; if already active → set `null` (toggle); call `_uplFolderClearActive()` if available; call `_uplFetch(1)`; re-render tree |
| `_uplCatalogCreate(name, parent_id)` | POST; on success push new dict to `_uplCatData`, re-render |
| `_uplCatalogRename(id, name)` | PATCH; update local entry in `_uplCatData`, re-render |
| `_uplCatalogDelete(id)` | Show confirm modal → on confirm DELETE; splice from `_uplCatData`; if deleted was active → `_uplCatActive = null` + `_uplFetch(1)`; re-render |
| `_uplCatalogDragStart(event, id)` | Set `_uplCatDragId = id`; `event.dataTransfer.effectAllowed = 'move'` |
| `_uplCatalogDragOver(event, id)` | `event.preventDefault()`; compute zone from `offsetY / el.offsetHeight`: top 25% → 'before', middle 50% → 'inside', bottom 25% → 'after'; set `_uplCatDropIntent`; apply CSS highlight class |
| `_uplCatalogDragEnd()` | Clear drag state; remove all highlight classes |
| `_uplCatalogDrop(event, targetId)` | PATCH with resolved `parent_id` + `sort_order`; on `400 circular` show toast error; on success re-fetch |
| `_uplCatalogEnsureModal()` | Inject rename/create modal HTML once if `#upl-cat-modal` not in DOM |
| `_uplCatalogOpenModal(mode, catalogId, parentId)` | Show `#upl-cat-modal`; pre-fill name for rename |
| `_uplCatalogSaveModal()` | Read input value; call create or rename; close modal |
| `_uplCatalogConfirmDelete(id)` | Set `_uplCatDelPending`; show `#upl-cat-del-modal` |
| `_uplCatalogDoDelete()` | Call `_uplCatalogDelete(_uplCatDelPending)`; hide modal |
| `_uplCatalogAddFile(catalogId, uploadId)` | `POST …/catalogs/{cid}/files`; on success refresh detail badge panel |
| `_uplCatalogRemoveFile(catalogId, uploadId)` | `DELETE …/catalogs/{cid}/files/{uid}`; on success refresh detail badge panel |

#### Confirm-delete modal

Follow the standard BookWorm confirmation modal pattern exactly (see CODEPUPPY_NOTES.md
§ "Confirmation / Info Modals"). Use destructive (red) styling. ID: `#upl-cat-del-modal`.
Do NOT use `window.confirm()`. JS wiring uses `var _uplCatDelPending = null` pattern.

---

## Changes to Existing Files — Detailed

### 1 — `database.py`

Add after the `page_uploads.folder_id` additive column migration and before `await db.commit()`:

```python
# ── upload_catalogs (many-to-many catalog tree for uploads pages) ──────────
await db.execute("""
    CREATE TABLE IF NOT EXISTS upload_catalogs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id    INTEGER NOT NULL REFERENCES home_pages(id)    ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        parent_id  INTEGER REFERENCES upload_catalogs(id)        ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
""")
await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_upload_catalogs_page "
    "ON upload_catalogs(page_id, user_id, parent_id, sort_order)"
)

# ── upload_catalog_files (M2M junction: catalogs ↔ page_uploads) ───────────
await db.execute("""
    CREATE TABLE IF NOT EXISTS upload_catalog_files (
        catalog_id INTEGER NOT NULL REFERENCES upload_catalogs(id) ON DELETE CASCADE,
        upload_id  INTEGER NOT NULL REFERENCES page_uploads(id)    ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
        added_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (catalog_id, upload_id)
    )
""")
await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_ucf_upload "
    "ON upload_catalog_files(upload_id, user_id)"
)
```

### 2 — `routers/uploads_db.py` → `get_uploads_page()`

Current signature:
```python
async def get_uploads_page(user_id, page=1, folder_id=None, ...):
```

New signature:
```python
async def get_uploads_page(user_id, page=1, folder_id=None, catalog_id=None, ...):
```

Logic change — add this block immediately after the existing `folder_id` branching:

```python
if catalog_id is not None:
    use_union = False   # note-src files are not in catalogs — skip the UNION
    # Override folder_where: JOIN the junction table instead
    folder_where = (
        " INNER JOIN upload_catalog_files ucf "
        "ON pu.id = ucf.upload_id AND ucf.catalog_id = ?"
    )
    folder_params = (catalog_id,)
```

> The JOIN clause must be inserted into the query string at the correct position —
> after `FROM page_uploads pu` and before any `WHERE` clauses. Review the current
> query construction carefully before editing.

### 3 — `routers/home_uploads.py` → `list_files()`

```python
@router.get("/{page_id}/files")
async def list_files(
    request: Request,
    page_id: int,
    page: int = 1,
    folder_id: int = Query(None),
    catalog_id: int = Query(None),   # ← new
):
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    await _require_uploads_page(page_id, uid)
    result = await get_uploads_page(uid, page=page, folder_id=folder_id,
                                    catalog_id=catalog_id)   # ← pass through
    return JSONResponse(result)
```

Also add `catalog_id` to the `get_uploads_page` import call if it is used as a
keyword argument (update the import from `uploads_db` if the signature changed there).

### 4 — `main.py`

After line 70 (`from routers import home_uploads_folders as home_uploads_folders_router`):
```python
from routers import home_uploads_catalogs as home_uploads_catalogs_router
```

After line 143 (`app.include_router(home_uploads_folders_router.router)`):
```python
app.include_router(home_uploads_catalogs_router.router)
```

### 5 — `templates/index.html` (around line 451)

Replace the current contents of `<div id="sb-panel-folders" ...>` from:
```html
<div id="upl-folder-tree" class="space-y-0.5"></div>
```
To:
```html
<!-- Folders section label -->
<div class="flex items-center justify-between px-1 mb-1">
  <span class="text-[10px] font-bold uppercase tracking-wider
               text-gray-400 dark:text-zinc-500 select-none">Folders</span>
</div>
<div id="upl-folder-tree" class="space-y-0.5"></div>

<!-- ── Catalog section divider ── -->
<div class="mt-4 mb-2 border-t border-gray-200 dark:border-zinc-700"></div>
<div class="flex items-center justify-between px-1 mb-1">
  <span class="text-[10px] font-bold uppercase tracking-wider
               text-gray-400 dark:text-zinc-500 select-none">Catalogs</span>
</div>
<div id="upl-catalog-tree" class="space-y-0.5"></div>
```

Both sections scroll together inside the existing `flex-1 overflow-y-auto py-3 px-3`
panel — no layout changes needed to the outer panel div.

### 6 — `templates/base.html` (after line 590)

After:
```html
<script src="/static/js/home-page-uploads-folders.js?v={{ static_v }}" defer></script>
```
Add:
```html
<script src="/static/js/home-page-uploads-catalogs.js?v={{ static_v }}" defer></script>
```

Load order matters: catalog module references `_uplFolderClearActive` (defined in
folders module) — catalog must load **after** folders.

### 7 — `static/js/home-page-uploads-folders.js`

**a)** Add `_uplFolderClearActive()` as a new public function (near the existing public
API functions block):
```javascript
function _uplFolderClearActive() {
  _uplFldActive = null;
  _uplFolderRender();   // removes active-highlight from all rows
}
```

**b)** At the end of `_uplFolderEnterUploadsPage(pid)`, append:
```javascript
if (typeof _uplCatalogEnterUploadsPage === 'function') _uplCatalogEnterUploadsPage(pid);
```

**c)** At the end of `_uplFolderExitUploadsPage()`, append:
```javascript
if (typeof _uplCatalogExitUploadsPage === 'function') _uplCatalogExitUploadsPage();
```

**d)** At the point in the code where `_uplFldActive` is set and `_uplFetch(1)` is
called in response to a folder row click, add:
```javascript
if (typeof _uplCatalogClearActive === 'function') _uplCatalogClearActive();
```

### 8 — `static/js/home-page-uploads.js`

**a)** In `_uplFetch(page)`, after the existing `_fldQs` line:
```javascript
var _fldQs = (typeof _uplFolderGetFilter === 'function') ? _uplFolderGetFilter() : '';
```
Add:
```javascript
var _catQs = (typeof _uplCatalogGetFilter === 'function') ? _uplCatalogGetFilter() : '';
```
Then change the fetch URL to:
```javascript
const r = await fetch('/home/uploads/' + _uplPid + '/files?page=' + page + _fldQs + _catQs);
```

**b)** In the page-src detail panel HTML string built inside `_uplRenderDetail(f)`,
add an empty placeholder div after the tags section:
```html
<div id="upl-detail-catalogs" class="mt-3"></div>
```
This is only needed for `src === 'page'` files. Guard it with a conditional in the
template string builder if detail HTML differs by src type.

**c)** At the end of `_uplRenderDetail(f)`, alongside the existing
`_uplDocStudioInit(f)` call, add:
```javascript
if (typeof _uplRenderDetailCatalogs === 'function' && f.src === 'page') {
  _uplRenderDetailCatalogs(f);
}
```

---

## Detail Panel — Catalog Badge UI

`_uplRenderDetailCatalogs(f)` populates `#upl-detail-catalogs`:

1. Fetch `GET /{pid}/files/page/{f.id}/catalogs` → `{catalogs: [...]}`
2. If `_uplCatData` is empty: render muted "No catalogs exist yet" note; return
3. Build HTML:
   - Section heading: `🏷 Catalogs` (small, bold, gray)
   - For each catalog the file belongs to: pill badge (catalog name) + `×` remove
     button → calls `_uplCatalogRemoveFile(cat.id, f.id)` → re-runs function to refresh
   - `<select>` dropdown listing all `_uplCatData` entries NOT already applied
     (indented `—` prefix by depth for hierarchy hint) + a small `＋ Add` button →
     calls `_uplCatalogAddFile(selectedCatalogId, f.id)` → re-runs to refresh
   - If no catalogs are assigned yet: show muted "None" placeholder before the add
     dropdown

---

## File Grid Filter Integration — Call Trace

```
User clicks a catalog row in #upl-catalog-tree
  → _uplCatalogSelect(id)            [home-page-uploads-catalogs.js]
      _uplCatActive = id
      _uplFolderClearActive()         [home-page-uploads-folders.js]  — clears folder qs
      _uplFetch(1)                    [home-page-uploads.js]
          _fldQs = ''                 — folder returned ''
          _catQs = '&catalog_id=N'   — catalog returned active id
          GET /home/uploads/{pid}/files?page=1&catalog_id=N
              list_files()            [routers/home_uploads.py]
                  get_uploads_page(uid, catalog_id=N)
                      use_union = False
                      INNER JOIN upload_catalog_files ucf ON pu.id=ucf.upload_id
                      WHERE ucf.catalog_id = N
                      → page-src files only, members of catalog N
```

---

## Skills to Invoke

- **`bookworm-db-migration`** — after Step 1; verify both tables survive 10× idempotent
  restarts on a live DB (no `already exists` errors, no data loss)
- **`bookworm-template-audit`** — after Steps 5–6 (index.html + base.html); check for
  missing `?v={{ static_v }}`, broken element IDs, stray `let`/`const` in any new JS
- **`bookworm-template-audit`** — after Step 9 (new JS file); specifically audit
  `home-page-uploads-catalogs.js` for `let`/`const` usage
- **`bookworm-qa`** — full pass after all steps; see checklist §14 for exact scenarios
- **`bookworm-pre-commit`** — before committing; confirm no raw `aiosqlite.connect()`,
  no `let`/`const` in catalog JS, no hardcoded IDs or secrets
- **`bookworm-docs-keeper`** — after ship; add both new tables to CODEPUPPY_NOTES.md
  DB schema section; add new JS module to the key file map

---

## BookWorm Gotchas That Apply to This Feature

**Gotcha — `var` only in the new JS file (critical for correctness):**
`home-page-uploads-catalogs.js` is loaded globally into a page that uses HTMX
re-injection to swap the uploads page in and out. Every visit re-calls
`_uplCatalogEnterUploadsPage`. Using `let`/`const` at module level will throw
`SyntaxError: Identifier 'X' has already been declared` on the second visit.
All declarations must be `var` and all function declarations must use `function` keyword.

**Gotcha — `get_db()`, not raw `aiosqlite.connect()` (schema violation):**
`uploads_catalogs_db.py` is a new `*_db.py` file. It must `from database import get_db`
and use `async with get_db() as db:` for every query. Direct `aiosqlite.connect(DB_PATH)`
skips WAL mode, busy_timeout, and foreign_key enforcement — bookworm-pre-commit will
catch this but do it right from the start.

**Gotcha — `use_union = False` when `catalog_id` is set:**
`get_uploads_page()` currently builds a UNION of note-src and page-src rows when
`folder_id is None`. Note attachment rows have no entry in `upload_catalog_files` —
the UNION branch must be suppressed when filtering by catalog or the query will be
broken (the INNER JOIN on `page_uploads` cannot join with note attachment rows from
the other UNION leg). Explicitly set `use_union = False` when `catalog_id is not None`.

**Gotcha — mutual exclusion of `_fldQs` and `_catQs` in `_uplFetch`:**
Both query string fragments are appended to the same URL. If both are non-empty, the
server receives `?folder_id=X&catalog_id=Y` — the server silently lets `catalog_id`
win (per the new logic order), but the URL is misleading and may confuse future
debugging. The JS modules must enforce mutual exclusion: `_uplCatalogSelect()` calls
`_uplFolderClearActive()` (zeroing `_fldQs`), and the folder click handler calls
`_uplCatalogClearActive()` (zeroing `_catQs`). Both directions must be wired.

**Gotcha — `?v={{ static_v }}` cache-busting:**
The new `<script>` tag for `home-page-uploads-catalogs.js` in `base.html` **must**
have `?v={{ static_v }}`. Without it, browsers cache the (initially empty) file and
users never receive updates.

**Gotcha — demo guard on all write endpoints:**
`POST /catalogs`, `PATCH /catalogs/{id}`, `DELETE /catalogs/{id}`,
`POST /catalogs/{id}/files`, `DELETE /catalogs/{id}/files/{uid}` all mutate state.
Each must call `if guard := _demo_guard(request): return guard` on entry. Read-only
GETs do not need the guard.

**Gotcha — detail panel catalog section gated by `src === 'page'`:**
Note attachments (`src === 'note'`) have IDs in `note_attachments`, not `page_uploads`.
The `upload_catalog_files` FK points only to `page_uploads.id`. Never call
`_uplRenderDetailCatalogs(f)` or render `#upl-detail-catalogs` for a note-src file.
Guard in both the JS call site (`f.src === 'page'`) and the detail HTML builder.

**Gotcha — circular reparenting via DnD must be rejected server-side:**
`_is_descendant()` must run in `update_catalog()` before executing the UPDATE.
Raise `ValueError("circular")` → caught in the router → returned as HTTP 400. The
JS `_uplCatalogDrop()` handler must check for a 400 response and show an inline toast
error. Never rely on client-side cycle detection alone.

---

## Implementation Checklist

- [ ] **Step 1** — `database.py`: add `upload_catalogs` CREATE + index; add `upload_catalog_files` CREATE + index; place before `await db.commit()`
- [ ] **Step 2** — `routers/uploads_catalogs_db.py`: create new file; implement all 9 helper functions; use `get_db()`; mirror folder helper structure
- [ ] **Step 3** — `routers/home_uploads_catalogs.py`: create new file; `APIRouter(prefix="/home/uploads")`; 7 endpoints; 3 Pydantic models; local `_demo_guard` + `_require_uploads_page` copies; import from `uploads_catalogs_db`
- [ ] **Step 4** — `routers/uploads_db.py`: add `catalog_id=None` param to `get_uploads_page()`; add INNER JOIN branch; set `use_union = False` when `catalog_id is not None`
- [ ] **Step 5** — `routers/home_uploads.py`: add `catalog_id: int = Query(None)` to `list_files()`; pass to `get_uploads_page()`
- [ ] **Step 6** — `main.py`: import `home_uploads_catalogs`; add `app.include_router(home_uploads_catalogs_router.router)` after folders router
- [ ] **Step 7** — `templates/index.html`: add Folders label above `#upl-folder-tree`; add divider + Catalogs label + `#upl-catalog-tree` div below it
- [ ] **Step 8** — `templates/base.html`: add `<script src=".../home-page-uploads-catalogs.js?v={{ static_v }}" defer>` after folders tag
- [ ] **Step 9** — `static/js/home-page-uploads-catalogs.js`: create file; all `var`; full module state; all public API functions; all internal functions; DnD 3-zone logic; confirm-delete modal (standard BookWorm pattern, red/destructive, no `window.confirm()`); detail badge panel
- [ ] **Step 10** — `static/js/home-page-uploads-folders.js`: add `_uplFolderClearActive()`; append catalog enter/exit hooks to Enter/Exit fns; call `_uplCatalogClearActive()` on folder selection
- [ ] **Step 11** — `static/js/home-page-uploads.js`: add `_catQs` in `_uplFetch`; append to fetch URL; add `#upl-detail-catalogs` placeholder div in page-src detail HTML; call `_uplRenderDetailCatalogs(f)` hook for page-src files
- [ ] **Step 12** — Run `bookworm-db-migration` — verify idempotent on live DB
- [ ] **Step 13** — Run `bookworm-template-audit` — new JS + template changes
- [ ] **Step 14** — Run `bookworm-qa` — verify: catalog tree renders on uploads page entry; CRUD (create root, create child, rename, delete leaf, delete parent→children become root); DnD flat reorder; DnD nest (before/inside/after zones); DnD un-nest; circular nest rejected with toast; catalog click filters grid; folder click deselects catalog (and vice versa); "All files" shows on deselect; detail panel shows catalog badges for page-src; add file to catalog; remove file from catalog; file appears in multiple catalogs simultaneously; demo guard blocks all writes
- [ ] **Step 15** — Run `bookworm-pre-commit`
- [ ] **Step 16** — Run `bookworm-docs-keeper` — add both tables to CODEPUPPY_NOTES.md; add `home-page-uploads-catalogs.js` to key file map

---

## Open Questions

1. **Should note attachments (`src === 'note'`) ever be assignable to catalogs?**
   Current plan scopes catalogs to `page_uploads` only. If note attachments should be
   catalogable, the junction table needs a polymorphic key (like `page_upload_tags` uses
   `upload_src + upload_id` with no FK). This is a **schema-level fork** — decide before
   Step 1 begins.

2. **What happens to a file's catalog memberships when the file is deleted?**
   With `ON DELETE CASCADE` on `upload_catalog_files.upload_id → page_uploads(id)`,
   deleting the file removes its junction rows automatically. Confirm this is the
   desired behaviour (vs. keeping membership history).

3. **"Add to catalog" dropdown in the detail panel — flat `<select>` or tree picker?**
   A flat `<select>` with depth-indented names (`— Child`, `—— Grandchild`) is simplest
   for V1. A full tree-picker popup is nicer but significantly more JS. Recommend flat
   select for V1.

4. **Should clicking an already-active catalog deselect it (toggle to "All files")?**
   The plan includes this (toggle off = `_uplCatActive = null`). Confirm this is
   desired UX or if a separate "All" item should always appear at the top of the tree.

5. **Catalog name uniqueness — scoped or free?**
   The folder system has no UNIQUE constraint. Recommend the same policy for catalogs
   (no uniqueness constraint on `name`). If uniqueness per `(page_id, user_id, name)` is
   desired, add a `UNIQUE(page_id, user_id, name)` constraint to the CREATE TABLE and
   handle `UNIQUE constraint failed` in `create_catalog()` by raising a `ValueError`.
