# Plan: Uploads Homespace Page — Phase 2
Date: 2026-04-14
Estimated complexity: Medium-High

---

## Summary

Phase 1 shipped a paginated, filterable Uploads Homespace page with standalone upload and auth-gated
download. Phase 2 adds the remaining deferred features in priority order:
**P0** standalone file delete (DB row + disk file, note-attached files get a "go to note" link instead);
**P1** accurate full-dataset filter counts served from the DB instead of counting the current page only;
**P2** a slide-in detail panel triggered by clicking any card;
**P3** user-defined custom tags/groups stored in a new `page_upload_tags` junction table;
**P4** optional WebP conversion on upload (Pillow, graceful fallback);
**P5** StaticFiles auth hardening — **not implemented this phase** (see decision below).

All new write endpoints get `_demo_guard()`. No new Jinja2 filters. No new `_PUBLIC` entries.
All migrations are additive and idempotent.

---

## P5 — StaticFiles Auth Hardening: Decision to Defer

The `/uploads/<uuid>` StaticFiles mount is intentionally left unguarded.
Implementing auth on file serving would silently break every `<img src="/uploads/...">` tag embedded
in note content (rendered by the note editor without a download-redirect). The UUID-as-secret model
is acceptable by design for this threat level. This is documented as Quirk #18 in CODEPUPPY_NOTES.md.
**Close P5 without implementation. No further action this phase.**

---

## Files to Change

Touch in this order to avoid dependency issues:

| # | File | What changes |
|---|---|---|
| 1 | `database.py` | Add `page_upload_tags` table + index (P3) |
| 2 | `routers/uploads_db.py` | Add `delete_page_upload()`, `get_file_counts()`, 4 tag CRUD fns (P0, P1, P3) |
| 3 | `routers/home_uploads.py` | Add DELETE endpoint (P0); extend `list_files` response with `counts` (P1); add 4 tag endpoints (P3); add WebP conversion logic to `upload_file()` (P4) |
| 4 | `requirements.txt` | Add `Pillow>=10.0.0` (P4) |
| 5 | `templates/partials/home_page_uploads.html` | Add `#uploads-detail-panel` slide-in container div (P2) |
| 6 | `static/js/home-page-uploads.js` | Wire delete (P0); switch tab counts to server-provided (P1); card click → detail panel (P2); detail panel render/open/close (P2); tag render + add/remove in panel (P3) |

## New Files to Create

None. All changes fit within existing files. JS line budget check below.

---

## DB Migrations Needed

### P3 — `page_upload_tags` table (additive, safe)

Add to `CREATE_TABLES_SQL` list in `database.py` (alongside existing table definitions):

```sql
CREATE TABLE IF NOT EXISTS page_upload_tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_src  TEXT    NOT NULL CHECK(upload_src IN ('note', 'page')),
    upload_id   INTEGER NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag         TEXT    NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(upload_src, upload_id, user_id, tag)
)
```

Also add to `init_db()` immediately after the table (before the `db.commit()`):

```sql
CREATE INDEX IF NOT EXISTS idx_page_upload_tags_user
    ON page_upload_tags(user_id, tag)
```

**Rationale for no FK to `page_uploads` / `note_attachments`:**
Tags span both sources. A cross-table FK is not possible in SQLite without a polymorphic key hack.
Ownership is scoped by `user_id` instead; orphaned rows (if a file is deleted) are harmless and
cleaned by the `ON DELETE CASCADE` from `users`.

> This migration is **additive** — new table + index only. Safe to run on a live DB. No table-swap
> dance required.

---

## Endpoint Specifications

### P0 — File Delete

```
DELETE /home/uploads/{page_id}/files/page/{upload_id}
```

- Auth: session `user_id` required, 401 if missing
- Ownership: `get_page_upload_owned(upload_id, uid)` — 404 if not found or not owned
- Demo guard: `if guard := _demo_guard(request): return guard` — **first line of handler**
- Action: call `delete_page_upload(upload_id, uid)` (returns `filename`), then
  `(UPLOAD_DIR / filename).unlink(missing_ok=True)`
- Response: `JSONResponse({"ok": True})`

**Note-attached files (`src = "note"`) have no delete endpoint.** The card for note-src files shows
a "📝 Open in Note" link in place of the delete button. Deleting note attachments must be done
from the note editor (`routers/attachments.py` `DELETE /attachments/{id}`) to avoid silently
breaking embedded `<img>` tags in note content.

### P1 — Global Filter Counts

Extend `GET /home/uploads/{page_id}/files` response with a `counts` dict:

```json
{
  "files": [...],
  "total": 42,
  "page": 1,
  "pages": 1,
  "counts": {
    "all": 42,
    "image": 15,
    "video": 3,
    "audio": 0,
    "document": 20,
    "other": 4
  }
}
```

The `counts` values reflect the **entire user dataset** (both tables), not just the current page.

### P3 — Tag Endpoints (4 new routes, all under existing `/home/uploads` router)

```
GET  /home/uploads/{page_id}/tags
     → {"tags": ["work", "invoice", "team"]}   (all distinct tags for this user, sorted)

GET  /home/uploads/{page_id}/files/{src}/{upload_id}/tags
     → {"tags": ["work"]}                       (src = "note" | "page")

POST /home/uploads/{page_id}/files/{src}/{upload_id}/tags
     body: {"tag": "work"}
     → {"tags": ["work"]}                       (full current tag list for this file)
     Demo guard required.

DELETE /home/uploads/{page_id}/files/{src}/{upload_id}/tags/{tag}
     → {"tags": []}                             (full current tag list after removal)
     Demo guard required.
```

All 4 tag endpoints validate `_require_uploads_page(page_id, uid)` for page ownership.
POST and DELETE tag endpoints call `_demo_guard(request)` as the first line.

For `GET` tag endpoints on note-src files: no ownership of the underlying note is re-checked
beyond `user_id` match on the `page_upload_tags` row — that is sufficient since tags are stored
with `user_id` and cannot be read/written by other users.

---

## DB Helper Specifications (`routers/uploads_db.py`)

### `delete_page_upload(upload_id: int, user_id: int) -> Optional[str]`
```python
async def delete_page_upload(upload_id: int, user_id: int) -> Optional[str]:
    """Delete the page_uploads row owned by user_id. Return filename for disk cleanup, or None."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT filename FROM page_uploads WHERE id = ? AND user_id = ?",
            (upload_id, user_id),
        )
        row = await cur.fetchone()
        if not row:
            return None
        await db.execute("DELETE FROM page_uploads WHERE id = ? AND user_id = ?", (upload_id, user_id))
        await db.commit()
        return row["filename"]
```

### `get_file_counts(user_id: int) -> dict`
Single aggregation query across both tables. Uses SQLite `CASE` expression for MIME grouping
(mirrors `_uplMimeGroup()` in JS — must stay in sync):

```sql
SELECT
  CASE
    WHEN mime_type LIKE 'image/%'                                    THEN 'image'
    WHEN mime_type LIKE 'video/%'                                    THEN 'video'
    WHEN mime_type LIKE 'audio/%'                                    THEN 'audio'
    WHEN mime_type LIKE 'text/%' OR mime_type LIKE 'application/%'  THEN 'document'
    ELSE 'other'
  END AS grp,
  COUNT(*) AS cnt
FROM (
  SELECT na.mime_type
  FROM note_attachments na
  JOIN notes n ON n.id = na.note_id
  JOIN workspaces w ON w.id = n.workspace_id
  WHERE w.user_id = ? AND w.deleted_at IS NULL
  UNION ALL
  SELECT mime_type FROM page_uploads WHERE user_id = ?
)
GROUP BY grp
```

Return value: `{"all": N, "image": N, "video": N, "audio": N, "document": N, "other": N}`.
Always return all 6 keys (default 0) so JS can destructure without null-checks.

### Tag CRUD helpers

```python
async def get_tags_for_file(upload_src: str, upload_id: int, user_id: int) -> list[str]
    # SELECT tag FROM page_upload_tags WHERE upload_src=? AND upload_id=? AND user_id=? ORDER BY tag

async def add_tag_to_file(upload_src: str, upload_id: int, user_id: int, tag: str) -> list[str]
    # INSERT OR IGNORE INTO page_upload_tags(upload_src, upload_id, user_id, tag) VALUES(?,?,?,?)
    # then return get_tags_for_file(...)

async def remove_tag_from_file(upload_src: str, upload_id: int, user_id: int, tag: str) -> list[str]
    # DELETE FROM page_upload_tags WHERE upload_src=? AND upload_id=? AND user_id=? AND tag=?
    # then return get_tags_for_file(...)

async def get_all_user_tags(user_id: int) -> list[str]
    # SELECT DISTINCT tag FROM page_upload_tags WHERE user_id=? ORDER BY tag
```

---

## WebP Conversion (P4) — Implementation Notes (`routers/home_uploads.py`)

In `upload_file()`, after reading `data` and determining `mime`, insert:

```python
_WEBP_SOURCE_TYPES = {"image/jpeg", "image/png", "image/gif"}

try:
    from PIL import Image
    import io
    if mime in _WEBP_SOURCE_TYPES:
        img = Image.open(io.BytesIO(data))
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=85)
        data = buf.getvalue()
        mime = "image/webp"
        suffix = ".webp"
        stored_name = f"{uuid.uuid4().hex}.webp"
except ImportError:
    pass   # Pillow not installed — store original format
except Exception:
    pass   # Corrupted image or unsupported mode — store original format
```

`stored_name` and `suffix` are already declared before this block — the `try` block may
override them. `size` must be recalculated as `len(data)` **after** the conversion block
(it already uses `len(data)` below, so it picks up the WebP size automatically).

**`requirements.txt`:** add `Pillow>=10.0.0` on its own line.
Pillow is already a transitive dep of several common packages; pinning the floor version is safe.

---

## Frontend Changes (`static/js/home-page-uploads.js`)

### Line budget check
| Feature | Est. lines added |
|---|---|
| P0 — `_uplDeleteFile()` + confirmation + card delete button | +35 |
| P1 — replace client-count logic with `data.counts` | −5 (net simpler) |
| P2 — `_uplOpenDetail()`, `_uplCloseDetail()`, `_uplRenderDetail()` | +80 |
| P3 — `_uplRenderTags()`, `_uplAddTag()`, `_uplRemoveTag()` (called from detail panel) | +65 |
| **Total estimated** | **~515 lines** |

Well under the 600-line hard cap. No file split needed.
If it creeps over 580 during implementation, extract `_uplOpenDetail` / `_uplRenderDetail` /
`_uplRenderTags` into a new `home-page-uploads-detail.js` (loaded in `base.html` alongside the
main file with `?v={{ static_v }}` cache-busting).

### P0 — Delete

```javascript
async function _uplDeleteFile(uploadId) {
  if (!confirm('Delete this file? This cannot be undone.')) return;
  const r = await fetch(
    `/home/uploads/${_uplPid}/files/page/${uploadId}`,
    { method: 'DELETE' }
  );
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    _uplShowToast('Session expired — please refresh.', true); return;
  }
  if (!r.ok) { _uplShowToast('Delete failed.', true); return; }
  _uplShowToast('File deleted.');
  _uplCloseDetail();          // close panel if open
  await _uplFetch(_uplMeta.page || 1);  // refresh grid
}
```

In `_uplCard(f)`: note-src files get a `<a href="/notes?ws=...">📝 Open in Note</a>` badge
(link to `/` with workspace pre-selected is sufficient — exact deep-link TBD). Page-src files
get a `<button onclick="_uplDeleteFile(${f.id})">🗑️</button>`.

### P1 — Server-provided counts

`_uplFetch()` stores `data.counts` in a new module variable `_uplCounts = {}`.
`_uplRenderFilterTabs()` reads `_uplCounts` instead of tallying `_uplFiles`.
The existing `_uplFiles.forEach(...)` count block is removed.

### P2 — Detail panel

`_uplCard(f)` wraps the card in a `<div onclick="_uplOpenDetail(${JSON.stringify(f)})">` (use
`_uplEsc` on all string fields before JSON embed, or pass `f.id + f.src` and look up from
`_uplFiles`). **Better:** pass `f.src` and `f.id` as primitive args and look up from `_uplFiles`:

```javascript
function _uplOpenDetail(src, id) {
  const f = _uplFiles.find(x => x.src === src && x.id === id);
  if (!f) return;
  _uplCurrentDetail = f;
  _uplRenderDetail(f);
  const panel = document.getElementById('uploads-detail-panel');
  if (panel) panel.classList.remove('translate-x-full');
}
```

`_uplRenderDetail(f)` populates `#uploads-detail-content` with:
- `original_name`, `mime_type`, `size` (formatted), `created_at` (formatted)
- For `src === 'note'`: workspace name, note title, "📝 Open in Note" link
- For `src === 'page'`: delete button wired to `_uplDeleteFile(f.id)`
- Full-size image preview if `group === 'image'` (same `/uploads/{filename}` URL as thumbnail)
- Download button: `<a href="..." download>↓ Download</a>`
- Tags section (P3) rendered by `_uplRenderTags(f.src, f.id, tagsArray)`

### P3 — Tags in detail panel

On panel open, fetch `GET /home/uploads/{pid}/files/{src}/{id}/tags` to get current tags.
Render tags as removable pills + an inline text input for adding new tags.
"Add" submits `POST ...tags` body `{tag}`. Pill ✕ calls `DELETE ...tags/{tag}`.
"All tags" autocomplete list loaded once per panel open from `GET /home/uploads/{pid}/tags`.

The filter tab bar gets a **"Groups" section** below the MIME type tabs.
After fetching tags from `GET /{pid}/tags`, render group pills in `#uploads-filter-tabs` below
the type tabs (separated by a thin divider). Clicking a group pill sets `_uplTagFilter = tag`
and `_uplRender()` filters `_uplFiles` client-side by checking `f._tags` (tags must be embedded
in each file object from the list endpoint or fetched per-file on demand).

> **Decision needed (Open Question #1):** Should the `GET /{pid}/files` response embed tags per
> file in the `files` array (adds one extra query per request but enables client-side group
> filtering without per-card fetches), or should tags only be loaded on detail panel open?
> See Open Questions below.

---

## Template Changes (`templates/partials/home_page_uploads.html`)

Add the detail panel as a sibling of `#uploads-main` inside `#uploads-page-root`:

```html
{# ── Detail panel (slide-in from right) — P2 ──────────────────────────── #}
<div id="uploads-detail-panel"
     class="fixed inset-y-0 right-0 w-80 z-40
            bg-white dark:bg-zinc-900
            border-l border-gray-200 dark:border-zinc-800
            shadow-2xl transform transition-transform duration-200
            translate-x-full"
     aria-label="File detail">
  <div class="flex items-center justify-between px-4 py-3
              border-b border-gray-100 dark:border-zinc-800">
    <span class="text-sm font-semibold text-gray-800 dark:text-zinc-100">
      File Details
    </span>
    <button onclick="_uplCloseDetail()"
            class="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200
                   transition text-lg leading-none"
            aria-label="Close">&times;</button>
  </div>
  <div id="uploads-detail-content"
       class="overflow-y-auto p-4"
       style="height: calc(100% - 3rem)">
  </div>
</div>
```

No `<script>` blocks in this template — all logic stays in `home-page-uploads.js`.
No new Jinja2 filters needed.

---

## Skills to Invoke

| Skill / Agent | When | Why |
|---|---|---|
| `bookworm-db-migration` | After editing `database.py` | Validate the `page_upload_tags` migration is idempotent + runs clean on live DB |
| `bookworm-template-audit` | After editing `home_page_uploads.html` + `home-page-uploads.js` | Catch any `let`/`const` in global scope if code is added, missing `?v=` cache-bust, broken `hx-target` refs |
| `bookworm-qa` | After all changes | Hit `GET /home/uploads/{pid}/files`, test delete, test tag add/remove, test detail panel open/close |
| `bookworm-pre-commit` | Before committing | Full 10-phase checklist — especially `_demo_guard`, `get_db()` usage, `requirements.txt` updated |
| `bookworm-docs-keeper` | After QA passes | Update CODEPUPPY_NOTES.md schema section (new `page_upload_tags` table), mark Phase 2 ✅ in features list, update Quirk #18 |

---

## BookWorm Gotchas That Apply to This Feature

**Quirk #13 — `let`/`const` in HTMX-reinjected partials:**
`home_page_uploads.html` has no `<script>` block and the plan adds none. All new JS state
variables (`_uplCounts`, `_uplCurrentDetail`, `_uplTagFilter`) go at the top of
`home-page-uploads.js` as module-level `let` — that file is loaded once via `<script src>` in
`base.html`, not re-injected by HTMX, so `let` is safe there.

**Quirk #16 — `| tojson | safe`:**
If any file metadata is ever serialised into a `<script>` block in the template, use
`{{ data | tojson | safe }}`. Currently not applicable (all data flows through `fetch()` JSON).

**Quirk #18 — StaticFiles unguarded mount:**
Image thumbnails in `_uplCard()` and the detail panel full-size preview continue to use
`/uploads/{filename}` directly (no auth). This is accepted for Phase 2. Do not add an auth
redirect on the StaticFiles mount — it will break all note editor images.

**Quirk #11 — `UPLOAD_DIR` location:**
`UPLOAD_DIR` is defined in `routers/attachments_db.py`. Import it in `home_uploads.py` as
already done: `from routers.attachments_db import UPLOAD_DIR`. Do not redefine it.

**JS line budget (not a quirk but a hard constraint):**
Keep `home-page-uploads.js` ≤ 600 lines. Estimated post-P2+P3 total: ~515 lines. If it
exceeds 580 during implementation, extract the detail-panel functions into
`home-page-uploads-detail.js` and load it in `base.html` with `?v={{ static_v }}`.

---

## Implementation Checklist

### Step 1 — DB migration (P3)
- [ ] Open `database.py`
- [ ] Add `CREATE TABLE IF NOT EXISTS page_upload_tags (...)` to `CREATE_TABLES_SQL` list
      (exact SQL in "DB Migrations Needed" section above)
- [ ] Add `CREATE INDEX IF NOT EXISTS idx_page_upload_tags_user ON page_upload_tags(user_id, tag)`
      in `init_db()` after table creation, before `await db.commit()`
- [ ] Invoke `bookworm-db-migration` to dry-run the migration against live `bookworm.db`

### Step 2 — DB helpers (`routers/uploads_db.py`) — P0, P1, P3
- [ ] Add `delete_page_upload(upload_id, user_id) -> Optional[str]`
      (SELECT filename → DELETE → commit → return filename, or None if not found)
- [ ] Add `get_file_counts(user_id) -> dict`
      (single UNION ALL + CASE aggregation; always returns all 6 keys with default 0)
- [ ] Add `get_tags_for_file(upload_src, upload_id, user_id) -> list[str]`
- [ ] Add `add_tag_to_file(upload_src, upload_id, user_id, tag) -> list[str]`
      (`INSERT OR IGNORE` then return `get_tags_for_file(...)`)
- [ ] Add `remove_tag_from_file(upload_src, upload_id, user_id, tag) -> list[str]`
      (DELETE then return `get_tags_for_file(...)`)
- [ ] Add `get_all_user_tags(user_id) -> list[str]`
      (`SELECT DISTINCT tag ... ORDER BY tag`)
- [ ] Confirm all functions use `get_db()` — never raw `aiosqlite.connect()`

### Step 3 — Router (`routers/home_uploads.py`) — P0, P1, P3, P4
- [ ] **P0:** Add `DELETE /{page_id}/files/page/{upload_id}` handler
      — `_demo_guard` first, ownership via `get_page_upload_owned`, call `delete_page_upload`,
      `(UPLOAD_DIR / filename).unlink(missing_ok=True)`, return `JSONResponse({"ok": True})`
- [ ] **P1:** In `list_files()`, call `get_file_counts(uid)` and add `counts` key to response dict
- [ ] **P3 — 4 tag endpoints** (GET user tags, GET file tags, POST tag, DELETE tag):
      - All 4 validate `_require_uploads_page(page_id, uid)` and check `user_id` from session
      - POST and DELETE call `_demo_guard(request)` as first line
      - `src` path param validated: if `src not in ("note", "page")` raise `HTTPException(400)`
      - POST body: `from pydantic import BaseModel; class TagBody(BaseModel): tag: str`
        — validate `tag` is non-empty, strip whitespace, max 50 chars, lowercase
      - DELETE `tag` path param: URL-decode (FastAPI does this automatically via path param)
- [ ] **P4:** Add WebP conversion try/except block in `upload_file()` after reading `data`
      (exact code in WebP section above). `stored_name` and `suffix` may be overridden by the block.
      Ensure `size = len(data)` is computed **after** the conversion block (it already is).

### Step 4 — Dependencies (`requirements.txt`) — P4
- [ ] Add `Pillow>=10.0.0` on its own line

### Step 5 — Template (`templates/partials/home_page_uploads.html`) — P2
- [ ] Add `#uploads-detail-panel` div inside `#uploads-page-root`, after `#uploads-main`
      (exact HTML in Template Changes section above)
- [ ] Confirm no `<script>` blocks added — all logic stays in `.js`

### Step 6 — JavaScript (`static/js/home-page-uploads.js`) — P0, P1, P2, P3
- [ ] Add module-level state: `let _uplCounts = {};`, `let _uplCurrentDetail = null;`,
      `let _uplTagFilter = '';`
- [ ] **P1:** Store `_uplCounts = data.counts || {}` in `_uplFetch()` after JSON parse
- [ ] **P1:** Rewrite `_uplRenderFilterTabs()` to read counts from `_uplCounts` instead of
      tallying `_uplFiles`; remove the `_uplFiles.forEach(...)` count block
- [ ] **P2:** Add `_uplOpenDetail(src, id)`, `_uplCloseDetail()`, `_uplRenderDetail(f)`
      — panel opens by removing `translate-x-full` class; close adds it back; sets
      `_uplCurrentDetail = null` on close
- [ ] **P2:** In `_uplFetch()` / `_uplRender()`: if `_uplCurrentDetail` is set when grid
      refreshes, find the updated file object and re-render the panel (handles post-delete refresh)
- [ ] **P2:** Detail panel renders: filename, size, date, MIME, src badge, download link,
      delete button (page-src only) or "📝 Open in Note" link (note-src)
- [ ] **P2:** Full-size image preview in panel: `<img src="/uploads/${f.filename}">` with
      `onerror` fallback hiding the img tag (same pattern as `_uplCard`)
- [ ] **P0:** Add `_uplDeleteFile(uploadId)` — confirm dialog → `fetch DELETE` → toast →
      `_uplCloseDetail()` → `_uplFetch(currentPage)`
- [ ] **P3:** On detail panel open, `fetch GET /{pid}/files/{src}/{id}/tags` and render tags
- [ ] **P3:** Add `_uplRenderTags(src, id, tags)` — renders removable pills + add-tag input
- [ ] **P3:** Add `_uplAddTag(src, id, tagStr)` — `fetch POST`, re-render tags on success
- [ ] **P3:** Add `_uplRemoveTag(src, id, tag)` — `fetch DELETE`, re-render tags on success
- [ ] **P3:** In `_uplRenderFilterTabs()`, after MIME type tabs render, fetch
      `GET /{pid}/tags` once per page load (cache in `_uplAllTags`) and render group pills
      below a `<hr>` divider; clicking a group pill sets `_uplTagFilter` and re-renders grid
- [ ] **P3:** In `_uplRender()`, if `_uplTagFilter` is set, filter `visible` array by checking
      `f._tags && f._tags.includes(_uplTagFilter)` — this requires tags to be pre-fetched
      (see Open Question #1)
- [ ] Count total lines; if > 580, create `home-page-uploads-detail.js` and move detail panel
      functions there; add `<script src="...?v={{ static_v }}">` to `base.html`
- [ ] Invoke `bookworm-template-audit` passing the changed `.js` file

### Step 7 — QA & Ship
- [ ] Invoke `bookworm-qa` — verify: list files returns `counts`, DELETE 404s on wrong user,
      DELETE removes disk file, tags add/remove/persist, detail panel opens/closes, image preview
      shows in panel, WebP conversion produces smaller file on JPEG upload
- [ ] Confirm `home-page-uploads.js` line count ≤ 600
- [ ] Invoke `bookworm-pre-commit`
- [ ] Invoke `bookworm-docs-keeper` — update schema, mark Phase 2 ✅, update Quirk #18 note

---

## Open Questions

**OQ-1 (must decide before Step 6 P3):** Should tags be embedded in the `files` array returned
by `GET /{pid}/files`, or fetched lazily on detail panel open?

- **Option A — Embed in list response:** Add a subquery in `get_uploads_page()` to fetch tags per
  file (e.g. `GROUP_CONCAT(t.tag)` LEFT JOIN from `page_upload_tags`). Enables client-side group
  filtering in the grid without per-card fetches. Adds ~1 extra LEFT JOIN per UNION branch.
  **Pro:** group filter tab works instantly. **Con:** slightly heavier list query.

- **Option B — Lazy fetch on panel open:** Tags only fetched when user clicks a card. Group filter
  tab is not implementable in the grid (would need per-file tag fetches = N+1). Could show group
  filter only in the detail panel.
  **Pro:** list query stays simple. **Con:** group filtering in the grid is not possible.

**Recommendation:** Option A — the LEFT JOIN + GROUP_CONCAT on SQLite at 50-row pages is trivially
cheap. Embed `tags: list[str]` in each file dict. Enables the grid-level group filter described
in P3 without N+1 calls. Store as `f._tags = (data.tags || [])` in JS.

If Option A is chosen, the `get_uploads_page()` query needs two extra LEFT JOINs
(one per UNION branch) + `GROUP_CONCAT(t.tag) AS tags` column. The Python dict-building step
splits the comma-string: `f["tags"] = (f.pop("tags") or "").split(",") if f.get("tags") else []`.

**OQ-2 (nice-to-have, can defer):** Tag validation rules — maximum tag length, allowed characters,
case normalisation. Recommendation: strip whitespace, lowercase, max 50 chars, reject empty.
This is specified in Step 3 above and can be enforced server-side in the POST handler.

**OQ-3 (UX):** The "Open in Note" link for note-src files needs a URL. `f` has `note_id` and
`workspace_id` is not currently in the list response. Options:
- Add `workspace_id` to the `note_attachments` branch of the merged query (it's available via
  the `workspaces` JOIN already in place) — then link to `/?ws={workspace_id}` and let the user
  navigate to the note.
- Or link to a future `/notes/{note_id}` direct route (does not exist yet).
**Recommendation:** add `workspace_id` to the merged query SELECT and link to
`/?ws={workspace_id}` for now. Deep note linking is a separate feature.
