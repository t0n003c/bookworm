# PLAN — Inline Page (Notion-style sub-page) slash command

**Feature:** A `/page` slash command in the workspace **note editor** and **workspace database card** editor that creates a nested sub-page. The sub-page is a full editor with the whole slash palette, **no attributes/categories chrome**, and its **title is derived from the first line of text**. Running the command inserts a clickable page-link into the current page and **opens the new sub-page immediately**.

**Decisions locked in:**
- Storage model = **child note** (reuse `notes` table + existing editor/render/search/trash). Not a new table.
- Create behavior = **open the new page immediately** (Notion-style).
- Scope = both the note editor and the database card note editor.

---

## Architecture summary

An inline page is just a `notes` row with a parent pointer and an `is_inline_page=1` flag. The slash command:
1. POSTs to a new endpoint that creates the child note and returns its `id`.
2. Inserts a `<a class="bw-page-link" data-note-id="{id}">📄 Untitled</a>` block into the current editor (same inline-HTML-block pattern as callouts/links — survives the markdown save round-trip).
3. Navigates to the child page (`GET /notes/{id}`), which renders the standard editor with attribute/category/date chrome hidden and a back-link to the parent.

Link labels are **hydrated from `data-note-id` after `marked.parse()`**, so renaming a child (changing its first line) updates every link pointing at it — no stale labels stored in content.

---

## Files to touch

### 1. `database.py` — schema migration (idempotent, in `init_db()`)
Add two columns to `notes` (additive, safe to run repeatedly — guard with the existing `PRAGMA table_info` / try-except column-add pattern already used in this file):
- `parent_note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE` — parent note when the page is created inside another note.
- `parent_card_id INTEGER REFERENCES db_cards(id) ON DELETE CASCADE` — parent card when created inside a database card note (one of the two parents is set; both null = a normal note).
- `is_inline_page INTEGER NOT NULL DEFAULT 0` — flag to hide attribute/category chrome and drive title-from-first-line.
- Index: `CREATE INDEX IF NOT EXISTS idx_notes_parent_note ON notes(parent_note_id)`.

> Route schema change through `bookworm-db-migration` rules: additive only, idempotent, no table-swap needed since these are pure column adds. **Do NOT** add `NOT NULL` without default.

### 2. `routers/notes_db.py` — DB helpers
- Extend `create_note(...)` (line 281) to accept optional `parent_note_id`, `parent_card_id`, `is_inline_page`. Default all to null/0 so existing callers are unaffected.
- Add `derive_title_from_content(content) -> str` helper: first non-empty line, strip leading markdown (`#`, `-`, `>`, `[ ]`), trim, cap length (~120 chars), fallback `"Untitled"`.
- In `update_note(...)` (line 321) and `patch_note_content(...)` (line 365): when the target note has `is_inline_page=1`, recompute `title` from content on every save. (Read the flag first; only override title for inline pages so normal notes keep their explicit titles.)
- Add `list_child_pages(parent_note_id|parent_card_id) -> list[dict]` (id + title) — used for label hydration batching and optional child-list UI.

### 3. `routers/notes.py` — endpoints
- `POST /notes/subpage` — body: `parent_note_id` **or** `parent_card_id`. Creates an empty inline-page note (title `"Untitled"`, `is_inline_page=1`), enforces owner via existing `_require_note_owner` / `_require_ws_owner`, returns JSON `{id, title}`. Add `_demo_guard(request)` if it writes a global table (check demo.py rules).
- `GET /notes/{id}` (line 236, `view_note`) — pass `is_inline_page` + parent link info into the template context so the page renders in "inline mode".
- New: `GET /notes/page-titles?ids=1,2,3` — returns `{id: title}` map for client-side link hydration (single batched call; cheap; owner-filtered).
- **Auth:** these are authed note routes — no `_PUBLIC` entry needed. Confirm no new public surface.

### 4. `static/js/slash_commands.js` — the `/page` command
Add one entry to `SLASH_COMMANDS` (after the `/file` entry, ~line 362), following the **`/file` template** (it already branches on db-card context via `ce.dataset.dbNote`):
```js
{
  id: 'page', label: 'Page', desc: 'Create a nested sub-page',
  icon: `<svg …📄…>`,
  action: (ce, postDeleteRange) => { _insertInlinePage(ce, postDeleteRange); },
}
```
New `_insertInlinePage(ce, postDeleteRange)` helper (mirror `_ceLinkDialog`, lines 986+):
- Determine parent: if `ce.dataset.dbNote === '1'` → read card id from the db-note context (via a `window._dbNoteCardId()` bridge, same shape as `window._dbNoteAttachFile`); else read parent note id from the note form's hidden `note_id` field.
- `POST /notes/subpage` → get `{id}`.
- Restore `postDeleteRange`, `insertHTML` the `<a class="bw-page-link" data-note-id="{id}" href="/notes/{id}">📄 Untitled</a>` block, fire `input` to trigger autosave.
- Navigate to `/notes/{id}` (use the app's existing note-open path — HTMX `hx-get` swap or `window.location`, match how note links currently open).

### 5. `static/js/workspace-database.js` — db-card bridge
- Add `window._dbNoteCardId = () => <current card id>` exposed in the card detail panel (mirror the existing `window._dbNoteAttachFile` / `_dbSaveNote` wiring so `/page` knows its parent card).
- Ensure the db-card note contenteditable already sets `data-db-note="1"` (it does — the `/file` `show:` guard relies on it).

### 6. Templates — render + chrome
- `templates/partials/note_detail.html` (md render block ~lines 56–100): after `marked.parse()` + DOMPurify, run a **hydration pass** — collect all `a.bw-page-link[data-note-id]`, batch-fetch `/notes/page-titles?ids=…`, set each link's text to `📄 {title}`. Make links open the sub-page via the standard note-open mechanism.
- `note_detail.html` + `templates/partials/note_form.html`: when `is_inline_page` is truthy, **hide** the attributes / categories / meeting-date strip and show a **back-link** to the parent (note or card).
- CSS for `.bw-page-link` (styled chip with hover). Add to the same stylesheet the other `bw-*` blocks live in; **cache-bust with `?v={{ static_v }}`** if a new/changed asset.

### 7. `templates_env.py`
- Only if a new Jinja2 filter is needed (e.g. a title-truncate filter). Register it **here and nowhere else**. Likely **not needed** — title derivation happens server-side in Python.

### 8. `CODEPUPPY_NOTES.md` (via `bookworm-docs-keeper`)
- New `notes` columns (`parent_note_id`, `parent_card_id`, `is_inline_page`) + index.
- New `/page` slash command + `_insertInlinePage`, `window._dbNoteCardId` bridge.
- New endpoints (`POST /notes/subpage`, `GET /notes/page-titles`).
- `.bw-page-link` block type + hydration pass.

---

## Gotchas / critical-rule checklist
- **`var` not `let`/`const`** in any `<script>` inside an HTMX-reinjected partial (note_form is reinjected). The new JS lives in `slash_commands.js` (a static file, not a partial) so `const` is fine there — but any inline template script must use `var`.
- **`tojson | safe`** if dumping the child-pages list into a `<script>` tag.
- **`?v={{ static_v }}`** on any new/changed `<script src>` / `<link href>`.
- **DOMPurify allowlist:** `a` with `class`/`href`/`data-note-id` must survive sanitize. Current config (`ADD_ATTR: ['style','target','rel']`) does **not** include `data-note-id` — **add `data-note-id`** (and ensure `class` is kept) or hydration breaks. Verify in both `note_detail.html` and `note_form.html` sanitize configs.
- **All DB access via `get_db()`** — no raw `aiosqlite.connect()`.
- **Demo mode:** if `POST /notes/subpage` touches a guarded table, add `_demo_guard(request)`.
- **Cascade vs orphan:** `ON DELETE CASCADE` means deleting a parent note trashes its sub-pages. Confirm this is desired vs. promoting orphans (recommend cascade for tidy trash; revisit if BookWorm's trash is soft-delete — then use `deleted_at` propagation instead of hard cascade). **Check how `delete_note` (notes_db.py line 376) handles soft vs hard delete before finalizing.**
- **Recursion:** inline pages can contain inline pages (free with this model). No depth guard needed, but the page-titles hydration should not infinite-loop (it only fetches direct links on the rendered page — fine).
- **Search indexing:** inline pages become searchable notes automatically (`search_index.py`). Decide whether sub-pages should appear in the main note list (`GET /notes`, line 60) — likely **filter out `is_inline_page=1`** from the top-level list so they only appear nested. Add `AND (is_inline_page=0 OR is_inline_page IS NULL)` to the list query.

---

## Workflow order (per AGENTS.md)
1. ✅ Plan (this file)
2. Eddie codes from this plan
3. `bookworm-db-migration` — validate the column-add migration is idempotent
4. `bookworm-template-audit` — note_detail.html, note_form.html, slash_commands.js, workspace-database.js
5. `bookworm-qa` — verify: `/page` in note + db-card, sub-page opens, first-line→title, label hydration, parent-delete behavior, sub-page excluded from main list
6. `bookworm-pre-commit`
7. `bookworm-docs-keeper` — sync CODEPUPPY_NOTES.md
8. Commit (focused: schema → backend → JS → templates)

## Open verification before coding
- Confirm `delete_note` is soft (`deleted_at`) or hard delete — drives CASCADE vs `deleted_at` propagation for sub-pages.
- Confirm how existing note links open a note (HTMX swap target vs full nav) so `/page` navigation + `.bw-page-link` clicks match it.
