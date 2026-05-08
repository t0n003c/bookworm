# Plan: Sharing System for BookWorm
Date: 2026-05-08
Estimated complexity: High

---

## Summary

Add two complementary sharing modes to BookWorm. **User-to-user sharing** lets a logged-in
user send a full, independent copy of a workspace, note, database workspace, or database card
to another registered account — the recipient gets their own copy, changes to the original do
not propagate. **Public link sharing** lets a logged-in owner generate a secret, revocable URL
for a single note or database card; anyone with the link can read a static snapshot without
logging in. Active public links display a persistent visual badge on the note editor toolbar
and the DB card detail panel.

No new Python package dependencies are needed — token generation uses `secrets.token_urlsafe`
(stdlib), and all existing ORM/copy patterns follow the project's `get_db()` convention.

---

## Files to Change — Touch in This Exact Order

| # | File | What changes |
|---|---|---|
| 1 | `database.py` | Add `public_share_links` table + 2 indexes in `init_db()` |
| 2 | `auth_middleware.py` | Add `/share/view/` prefix bypass (like `/wopi/`) in `dispatch()` |
| 3 | `main.py` | Import and mount `routers/sharing.py` |
| 4 | `routers/notes_db.py` | Add `get_note_with_workspace_owner()` helper used by share copy |
| 5 | `routers/workspaces_db.py` | Add `get_full_workspace_tree()` — returns workspace + all descendants; add `get_or_create_shared_inbox()` helper |
| 6 | `routers/workspace_db_cards.py` | Add `get_db_card_full()` — card + all attrs in one query, no user_id filter (for public snapshot); add `copy_db_card_to_database()` |
| 7 | `templates/share_note_view.html` | New standalone (non-SPA) template — public read-only note view |
| 8 | `templates/share_card_view.html` | New standalone template — public read-only DB card view |
| 9 | `templates/partials/share_modal.html` | HTMX partial — share-to-user + public-link management modal |
| 10 | `templates/partials/note_form.html` | Add share button + public-link badge to note toolbar (chunk read: lines 1–150 to find toolbar, then targeted replace) |
| 11 | `static/js/sharing.js` | New JS module — all share UI logic (all `var`) |
| 12 | `static/js/workspace-database.js` | Inject share button + badge into `_dbRenderDetailPanel` |
| 13 | `templates/base.html` | Add `<script src="/static/js/sharing.js?v={{ static_v }}" defer></script>` |

---

## New Files to Create

| File | Purpose |
|---|---|
| `routers/sharing.py` | All sharing endpoints (user-to-user copy + public link CRUD + public view data) |
| `routers/sharing_db.py` | DB helpers: public link CRUD, workspace deep-copy, note copy, DB workspace copy |
| `templates/share_note_view.html` | Standalone public note view (no SPA shell, no auth) |
| `templates/share_card_view.html` | Standalone public DB card view (no SPA shell, no auth) |
| `templates/partials/share_modal.html` | Share modal partial (returned by HTMX `GET /share/modal/{type}/{id}`) |
| `static/js/sharing.js` | Client-side share UI (all `var`, no `let`/`const` at top level) |

---

## DB Migrations Needed

### Table: `public_share_links`

**Migration type:** Additive — `CREATE TABLE IF NOT EXISTS` (fully safe, runs every boot).

```sql
CREATE TABLE IF NOT EXISTS public_share_links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT    NOT NULL UNIQUE,          -- secrets.token_urlsafe(32)
    object_type TEXT    NOT NULL                  -- 'note' | 'db_card'
                CHECK(object_type IN ('note', 'db_card')),
    object_id   INTEGER NOT NULL,                 -- notes.id OR db_cards.id
    owner_id    INTEGER NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME DEFAULT NULL             -- NULL = never expires
);
```

**Indexes** — add after table creation (both `CREATE INDEX IF NOT EXISTS`):

```sql
CREATE INDEX IF NOT EXISTS idx_pub_share_token
    ON public_share_links(token);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pub_share_object
    ON public_share_links(object_type, object_id, owner_id);
    -- Enforces one-active-link-per-object per owner.
    -- Revoke = DELETE the row; Create = INSERT OR REPLACE.
```

Add both the table and the two indexes inside `init_db()` in `database.py`, inside the
existing `async with aiosqlite.connect(DB_PATH) as db:` block, after all existing
`CREATE TABLE IF NOT EXISTS` calls.

**No FK from `public_share_links` to `notes` or `db_cards`** — those tables don't have
a shared parent; polymorphic FKs are avoided here exactly as done for `page_upload_tags`.
Orphaned rows (note or card deleted) are harmless; `owner_id` CASCADE cleans on user deletion.

---

## Endpoint Specification

All new endpoints live in `routers/sharing.py` under `APIRouter(prefix="/share", tags=["sharing"])`.

### User-to-User Copy (auth-required, demo-guarded)

| Method | Path | Action |
|---|---|---|
| `GET` | `/share/users/search?q={username}` | Return `[{id, username}]` — user search for the recipient picker. Excludes self. Returns max 10 rows. JSON. |
| `POST` | `/share/note/{note_id}/to-user` | Copy `notes` row + `note_categories` + `note_attributes` into recipient's "📥 Shared with Me" workspace. Body: `{recipient_id: int}`. JSON `{ok: true, message: "Sent!"}`. |
| `POST` | `/share/workspace/{ws_id}/to-user` | Deep-copy entire workspace tree (workspace + all descendants + all notes inside). Recipient gets new root-level workspace tree. Body: `{recipient_id: int}`. JSON. Ownership verified before copy. |
| `POST` | `/share/db-workspace/{ws_id}/to-user` | Copy database workspace + all db_cards + db_card_attrs. Recipient gets new database workspace at root level. Body: `{recipient_id: int}`. JSON. |
| `POST` | `/share/db-card/{card_id}/to-user` | Copy single db_card + db_card_attrs into recipient's "📥 Shared Cards" database workspace (auto-created if absent). Body: `{recipient_id: int}`. JSON. |

### Public Link Management (auth-required, owner-only)

| Method | Path | Action |
|---|---|---|
| `GET` | `/share/note/{note_id}/public-link` | Return `{active: bool, token: str\|null, url: str\|null}`. JSON. |
| `POST` | `/share/note/{note_id}/public-link` | Create public link (INSERT OR REPLACE). Returns `{token, url}`. JSON. Triggers OOB badge update — return `HX-Trigger: sharePublicLinkCreated`. |
| `DELETE` | `/share/note/{note_id}/public-link` | Revoke (DELETE row). Returns `{ok: true}`. Triggers OOB badge clear — return `HX-Trigger: sharePublicLinkRevoked`. |
| `GET` | `/share/db-card/{card_id}/public-link` | Same as note variant but for `db_card` object_type. |
| `POST` | `/share/db-card/{card_id}/public-link` | Create public link for a DB card. |
| `DELETE` | `/share/db-card/{card_id}/public-link` | Revoke DB card public link. |

### Share Modal (auth-required)

| Method | Path | Action |
|---|---|---|
| `GET` | `/share/modal/note/{note_id}` | Return `partials/share_modal.html` with `{object_type, object_id, active_link, token, share_url}`. HTMX partial. |
| `GET` | `/share/modal/db-card/{card_id}` | Same for DB card. |

### Public View (NO auth — must be prefix-bypassed in middleware)

| Method | Path | Action |
|---|---|---|
| `GET` | `/share/view/note/{token}` | Verify token exists + not expired. Fetch note snapshot. Render `share_note_view.html`. 404 if invalid/expired. |
| `GET` | `/share/view/db-card/{token}` | Verify token. Fetch card + attrs snapshot. Render `share_card_view.html`. |

---

## auth_middleware.py Changes

In `dispatch()`, change the prefix check line from:

```python
if path.startswith("/static/") or path.startswith("/wopi/") or path in _PUBLIC:
```

to:

```python
if (path.startswith("/static/")
        or path.startswith("/wopi/")
        or path.startswith("/share/view/")   # ← add this
        or path in _PUBLIC):
```

**Do NOT add `/share/view/note/` or `/share/view/db-card/` to `_PUBLIC`** — those have
dynamic token segments. The prefix approach is the correct pattern (as per the `/wopi/`
precedent in the project). Validate all inputs inside these routes — treat them as
internet-facing endpoints.

---

## main.py Changes

Add one import and one router mount, following the existing pattern:

```python
# In imports block:
from routers import sharing as sharing_router

# In the app.include_router block:
app.include_router(sharing_router.router)
```

Mount order does not matter for this router (no prefix conflicts with existing routers).

---

## routers/sharing_db.py — Key Functions to Implement

```python
# Public link helpers
async def get_public_link(object_type: str, object_id: int, owner_id: int) -> dict | None
async def create_public_link(object_type: str, object_id: int, owner_id: int) -> dict
    # Uses: INSERT OR REPLACE INTO public_share_links(token, object_type, object_id, owner_id)
    # Token: secrets.token_urlsafe(32)
async def revoke_public_link(object_type: str, object_id: int, owner_id: int) -> None
async def get_public_link_by_token(token: str) -> dict | None
    # Returns row or None; check expires_at > NOW() if not null

# User search
async def search_users_for_share(query: str, exclude_user_id: int) -> list[dict]
    # SELECT id, username FROM users
    # WHERE username LIKE ? AND id != ? LIMIT 10

# Shared inbox helpers (auto-create destination workspaces in recipient's account)
async def get_or_create_shared_inbox_workspace(user_id: int) -> int
    # SELECT id FROM workspaces WHERE user_id=? AND name='📥 Shared with Me'
    #   AND deleted_at IS NULL LIMIT 1
    # If not found: INSERT INTO workspaces (user_id, name, emoji, ws_type)
    #   VALUES (?, '📥 Shared with Me', '📥', 'workspace') → return id
async def get_or_create_shared_cards_database(user_id: int) -> int
    # Same pattern but name='📥 Shared Cards', ws_type='database'

# Note copy
async def copy_note_to_workspace(note_id: int, target_workspace_id: int) -> int
    # Deep copy: notes row + note_categories + note_attributes
    # Returns new note id

# Workspace deep copy (tree-aware)
async def copy_workspace_tree_to_user(ws_id: int, recipient_user_id: int) -> int
    # BFS/recursive: copy workspace + all descendants + all notes in each
    # Returns new root workspace id in recipient's account

# DB workspace copy
async def copy_db_workspace_to_user(ws_id: int, recipient_user_id: int) -> int
    # Copy database workspace row + all db_cards + db_card_attrs

# DB card copy
async def copy_db_card_to_database(card_id: int, target_db_ws_id: int,
                                    recipient_user_id: int) -> int
    # Copy db_cards row + db_card_attrs

# Public view fetchers (no user_id filter — token already validated)
async def get_note_for_public_view(note_id: int) -> dict | None
async def get_db_card_for_public_view(card_id: int) -> dict | None
```

---

## Template Changes Detail

### `templates/partials/note_form.html`

**Read the toolbar area first** (start_line=1, num_lines=150 to find it, then search for
save/delete button bar). The share button and badge go **in the existing note toolbar**.

Add two elements adjacent to the existing save/delete/attach button cluster:

1. **Share button** — opens the share modal via HTMX:
   ```html
   <button type="button"
           hx-get="/share/modal/note/{{ note.id }}"
           hx-target="#share-modal-container"
           hx-swap="innerHTML"
           class="..."
           aria-label="Share this note"
           title="Share">
     <!-- share SVG icon -->
   </button>
   ```

2. **Public link active badge** — shown only when `public_link_active` is truthy
   (template variable passed from the notes GET route):
   ```html
   {% if public_link_active %}
   <span id="share-badge-note-{{ note.id }}"
         class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                text-xs font-medium bg-[#ffc220] text-[#995213]"
         title="Public link active">
     🔗 Public
   </span>
   {% else %}
   <span id="share-badge-note-{{ note.id }}" class="hidden"></span>
   {% endif %}
   ```

3. Add `<div id="share-modal-container"></div>` once at the bottom of the form
   (outside any scrolling region, before `</form>`).

**Route change needed:** `GET /notes/form/{note_id}` in `routers/notes.py` must also
query `get_public_link(object_type='note', object_id=note.id, owner_id=uid)` and pass
`public_link_active` to the template context.

### `templates/partials/share_modal.html`

Full-screen overlay modal following the BookWorm standard modal pattern (see
Architecture Patterns → Confirmation/Info Modals in CODEPUPPY_NOTES.md).

Sections:
1. **Share with a user** — username search input (`hx-get` with debounce), results list
   with "Send copy" button per result. On success: toast "Copy sent to {username}!".
2. **Public link** (notes and DB cards only) — toggle or button to create/revoke.
   Shows the full URL in a copyable `<input readonly>`. Shows "No active link" when
   none exists.
3. **Close** button.

All JS for this modal lives in `sharing.js` — no inline `<script>` in the partial.

### `templates/share_note_view.html`

Standalone template (extends nothing — full `<!DOCTYPE html>`). Uses Tailwind CSS
(`/static/css/tailwind.css`). No HTMX, no SPA shell.

Contents:
- BookWorm branding header (logo + "Shared Note" label)
- Note title, meeting date
- Rendered note content (HTML — apply `| safe`)
- "Sign up for BookWorm" CTA banner at bottom (links to `/register`)
- No edit controls, no delete, no attachments listed (v1 — attachments are a follow-on)

### `templates/share_card_view.html`

Standalone template. Shows:
- Card title
- All card attributes in a clean definition-list layout
- Card note content (rendered HTML, `| safe`)
- BookWorm CTA footer

---

## JS Changes — `static/js/sharing.js`

New file. All top-level state variables must use `var` (Quirk #13 — loaded via `base.html`
so it's not an HTMX-re-injected partial, but follow project convention uniformly).

```javascript
// State
var _shareModalCurrentType = null;   // 'note' | 'db_card'
var _shareModalCurrentId   = null;

// Functions to implement:
function shareOpenModal(type, id)          // called by share button onclick
function shareCloseModal()
function shareSearchUsers(query)           // debounced, populates #share-user-results
function shareSendCopy(recipientId)        // POST /share/{type}/{id}/to-user
function shareCreatePublicLink()           // POST /share/{type}/{id}/public-link
function shareRevokePublicLink()           // DELETE /share/{type}/{id}/public-link
function shareCopyUrlToClipboard(url)      // navigator.clipboard.writeText
function shareUpdateBadge(type, id, active) // show/hide badge span
function shareShowToast(msg, isError)      // reuse existing toast pattern

// HTMX event listener for OOB badge updates:
// document.addEventListener('sharePublicLinkCreated', ...)
// document.addEventListener('sharePublicLinkRevoked', ...)
```

Wire `shareOpenModal` to window so Jinja2 onclick attrs can call it:
```javascript
window.shareOpenModal = shareOpenModal;
```

### `static/js/workspace-database.js`

Locate `_dbRenderDetailPanel` (the function that builds the card detail panel HTML string).
Add two pieces of JS-generated HTML to the panel header area:

1. **Share button** — calls `shareOpenModal('db_card', cardId)`.
2. **Public link badge** — a `<span id="share-badge-db-card-{id}">` that is populated by
   a separate fetch (`GET /share/db-card/{id}/public-link`) called immediately after the
   panel renders. The badge is hidden by default and shown by `shareUpdateBadge()`.

Since `_dbRenderDetailPanel` builds HTML via string concatenation, the share button is
appended as a string literal. The badge is populated async via `shareUpdateBadge()` called
from the end of `_dbRenderDetailPanel` (or its post-render hook if one exists).

**Use `var` for any new module-level state added here.** No `let`/`const` at the top of
any new code added to this file.

---

## base.html Script Tag

Add after the last existing `<script defer>` tag (currently `home-page-uploads-spreadsheet.js`):

```html
<script src="/static/js/sharing.js?v={{ static_v }}" defer></script>
```

---

## Ownership Validation Rules

| Endpoint type | Validation |
|---|---|
| Share note to user | `notes.workspace_id → workspaces.user_id == session user_id` |
| Share workspace | `workspaces.user_id == session user_id`; verify not a descendant of another user's WS |
| Share DB workspace | Same as workspace; additionally `ws_type == 'database'` |
| Share DB card | `db_cards.user_id == session user_id` |
| Create/revoke public link | `owner_id == session user_id` verified on SELECT before INSERT/DELETE |
| Public view route | No session needed; only token validity checked |

---

## Deep-Copy Implementation Notes

### `copy_workspace_tree_to_user(ws_id, recipient_user_id)`

Use BFS traversal on the `workspaces` table (`parent_id` column). Keep a mapping
`{old_id: new_id}` to rewire `parent_id` references on each newly inserted workspace.
For each workspace node: copy row (new `user_id`, preserve `name`, `emoji`, `ws_type`,
`sort_order`; reset `is_open=0`, `is_favorite=0`, `deleted_at=NULL`).
After copying each workspace, copy all its notes (`copy_note_to_workspace`).

### `copy_note_to_workspace(note_id, target_workspace_id)`

```sql
-- 1. Insert note
INSERT INTO notes (workspace_id, title, content, meeting_date, icon)
SELECT ?, title, content, meeting_date, icon FROM notes WHERE id = ?;
-- capture new_note_id = lastrowid

-- 2. Copy categories (global table — category_id values are valid for all users)
INSERT INTO note_categories (note_id, category_id)
SELECT ?, category_id FROM note_categories WHERE note_id = ?;

-- 3. Copy attributes
INSERT INTO note_attributes (note_id, attr_def_id, key, value)
SELECT ?, attr_def_id, key, value FROM note_attributes WHERE note_id = ?;
```

**Do NOT copy `note_attachments`** in v1. The actual files are on disk; duplicating them
requires file I/O that is out of scope. A note in `## Open Questions` covers this.

### `copy_db_card_to_database(card_id, target_db_ws_id, recipient_user_id)`

```sql
-- 1. Copy card row
INSERT INTO db_cards (db_id, user_id, title, cover_url, note_content, sort_order)
SELECT ?, ?, title, cover_url, note_content,
    (SELECT COALESCE(MAX(sort_order), -10) + 10 FROM db_cards WHERE db_id = ?)
FROM db_cards WHERE id = ?;
-- capture new_card_id

-- 2. Copy attrs
INSERT INTO db_card_attrs (card_id, attr_key, attr_value, attr_type,
                            attr_options, sort_order, visibility)
SELECT ?, attr_key, attr_value, attr_type, attr_options, sort_order, visibility
FROM db_card_attrs WHERE card_id = ?;
```

`cover_upload_id` is intentionally NOT copied (references the original user's `page_uploads`
row — different user_id). The `cover_url` string is copied as-is, which means the cover
image URL still works as a static read (see Quirk #18 — `/uploads/<uuid>` is unguarded,
so the URL remains accessible). Mark this as a known limitation.

---

## Demo Guard

Every POST endpoint in `routers/sharing.py` that writes to the DB must include:

```python
from routers.home import _demo_guard   # import the existing helper
if request.session.get("is_demo"):
    return _demo_guard(request)
```

This prevents demo users from spamming copies of content into real accounts.

---

## `.env.example` Additions

None required. Sharing is always on; there is no feature flag needed for v1.
If a kill-switch is desired, it can be added as `BW_SHARING_ENABLED=true` in a follow-on.

---

## Skills to Invoke

- **`bookworm-db-migration`** — after writing the `public_share_links` migration in
  `database.py`. Run to verify idempotency.
- **`bookworm-template-audit`** — after modifying `note_form.html`, creating
  `share_note_view.html`, `share_card_view.html`, `share_modal.html`.
- **`bookworm-pre-commit`** — before any git commit. Verifies all 10 checklist items.
- **`rebuild_css.bat`** — after adding any new Tailwind classes in new templates or
  `sharing.js`. Run it and commit the updated `static/css/tailwind.css`.

---

## BookWorm Gotchas That Apply to This Feature

| # | Quirk | How it applies here |
|---|---|---|
| **#13** | HTMX re-injection `let`/`const` trap | `sharing.js` is loaded via `base.html` `<script defer>` — NOT a partial. Still use `var` for all module-level state to match project convention and guard against future inlining. |
| **#16** | `\| tojson` inside `<script>` needs `\| safe` | If note content or card attrs are passed into `<script type="application/json">` blocks in `share_note_view.html` or `share_card_view.html`, always write `{{ data \| tojson \| safe }}`. |
| **#7** | HTMX OOB swaps | The share badge on `note_form.html` can be updated after create/revoke by returning an OOB `<span id="share-badge-note-{id}" hx-swap-oob="true">` fragment from the POST/DELETE endpoints. Wire this correctly on the badge span's `id`. |
| **#13** | `share_modal.html` partial has no `<script>` block | Keep it that way. All JS wiring goes in `sharing.js` using `document.getElementById` calls after the modal HTML is injected. |
| **#18** | `/uploads/<uuid>` is unguarded | `cover_url` values copied to recipient's db_card still point to the original file path — files are accessible without auth. Document as v1 known limitation. |
| **#25** | `GET /home/pages` must stay before `/{page_id}` wildcard | No conflict here — `/share/` is a completely separate prefix. But note that within `sharing.py`, declare the modal endpoint `GET /share/modal/note/{note_id}` BEFORE any more-general `GET /share/{type}/{id}/public-link` path if you use a common type param — avoid wildcard ambiguity. |
| **Quirk (new)** | `/share/view/` public prefix bypass | Add `path.startswith("/share/view/")` to `auth_middleware.py` dispatch, NOT to `_PUBLIC`. `_PUBLIC` is for exact paths only. Tokens are 43-char url-safe strings — never predictable, but still validate they exist in DB. |
| **Docker rule** | New routes that write files or reference `BW_DATA_DIR` | This feature has no file I/O. No `BW_DATA_DIR` usage needed. |
| **Demo guard** | All POST endpoints in `sharing.py` | Check `request.session.get("is_demo")` at the top of every write endpoint. |

---

## Implementation Checklist

### Phase 1 — Database & Backend Core
- [ ] 1. Add `public_share_links` table + 2 indexes to `init_db()` in `database.py`
- [ ] 2. Create `routers/sharing_db.py` with all DB helpers listed above
- [ ] 3. Verify migration is idempotent: run `bookworm-db-migration` skill
- [ ] 4. Add `get_note_with_workspace_owner()` to `routers/notes_db.py`
- [ ] 5. Add `get_or_create_shared_inbox()` and `get_full_workspace_tree()` to `routers/workspaces_db.py`
- [ ] 6. Add `get_db_card_full()` and `copy_db_card_to_database()` to `routers/workspace_db_cards.py`

### Phase 2 — Sharing Router
- [ ] 7. Create `routers/sharing.py` with all endpoints specified above
- [ ] 8. Add demo guard to every POST/DELETE endpoint in `sharing.py`
- [ ] 9. Add ownership validation to every write endpoint
- [ ] 10. Add prefix bypass `path.startswith("/share/view/")` to `auth_middleware.py`
- [ ] 11. Import and mount `sharing_router` in `main.py`
- [ ] 12. Smoke-test all endpoints with curl (user search, copy flows, public link CRUD, public view)

### Phase 3 — Public View Templates
- [ ] 13. Create `templates/share_note_view.html` (standalone, no SPA shell)
- [ ] 14. Create `templates/share_card_view.html` (standalone, no SPA shell)
- [ ] 15. Run `bookworm-template-audit` on both new templates

### Phase 4 — Share Modal
- [ ] 16. Create `templates/partials/share_modal.html` (user picker + public link section)
- [ ] 17. Add `<div id="share-modal-container"></div>` to `note_form.html` (chunk-read first)
- [ ] 18. Verify modal template renders without 500 (run `_health_check.py`)

### Phase 5 — Share Button + Badge in Note Form
- [ ] 19. Chunk-read `note_form.html` (start_line=1, num_lines=150) to locate toolbar
- [ ] 20. Add share button (hx-get to modal) to the note toolbar via targeted replace
- [ ] 21. Add `<span id="share-badge-note-{{ note.id }}">` badge to the toolbar
- [ ] 22. Update `GET /notes/form/{note_id}` in `notes.py` to pass `public_link_active` to template

### Phase 6 — DB Card Detail Panel Share UI
- [ ] 23. Locate `_dbRenderDetailPanel` in `workspace-database.js`
- [ ] 24. Add share button HTML string (calls `shareOpenModal('db_card', id)`) to panel header
- [ ] 25. Add `<span id="share-badge-db-card-{id}">` badge HTML string to panel header
- [ ] 26. After panel render, call async `shareLoadCardBadge(cardId)` to fetch + display badge

### Phase 7 — JS Module
- [ ] 27. Create `static/js/sharing.js` (all `var`, functions listed in spec above)
- [ ] 28. Implement `shareOpenModal`, `shareCloseModal`, `shareSearchUsers` (debounced)
- [ ] 29. Implement `shareSendCopy` with success toast
- [ ] 30. Implement `shareCreatePublicLink`, `shareRevokePublicLink`, `shareCopyUrlToClipboard`
- [ ] 31. Implement `shareUpdateBadge` and `shareLoadCardBadge`
- [ ] 32. Add `<script src="/static/js/sharing.js?v={{ static_v }}" defer></script>` to `base.html`

### Phase 8 — CSS + Final QA
- [ ] 33. Run `rebuild_css.bat` if any new Tailwind classes were introduced
- [ ] 34. Commit updated `static/css/tailwind.css`
- [ ] 35. Run `bookworm-template-audit` on all changed templates
- [ ] 36. Run `bookworm-pre-commit` — verify all 10 checklist items pass
- [ ] 37. Run `_health_check.py` against live server
- [ ] 38. Manual end-to-end: share a note to another user, verify copy appears; create public link, visit URL without auth, verify read-only view; revoke link, verify 404

---

## Open Questions

These must be decided before implementation starts or during Phase 2:

1. **Recursive workspace copy depth** — Should copying a workspace that has nested
   sub-workspaces also copy ALL descendants? The plan assumes yes (full BFS). If the
   answer is "one level only", simplify `copy_workspace_tree_to_user` to a flat copy.

2. **Note attachments on copy** — v1 plan deliberately skips copying attachment files
   (avoids disk I/O complexity). Should `note_attachments` metadata rows be copied
   (pointing to the original files) even if the files themselves aren't duplicated?
   Risk: if the original owner deletes the file, the copy's attachment link breaks.

3. **DB card cover images on copy** — `cover_upload_id` is skipped in v1 (references
   original user's `page_uploads` row). Only `cover_url` (a string path) is copied.
   The file is still accessible via the unguarded `/uploads/<uuid>` path. Acceptable?

4. **Recipient notification** — Should a "You received a shared copy" banner appear
   in the recipient's sidebar or as a notification badge? v1 plan does not include this.
   Simplest v1: recipient discovers the copy by browsing to "📥 Shared with Me".

5. **Public link expiry** — The `expires_at` column is included in the schema (nullable).
   v1 plan creates links with `expires_at = NULL` (never expires). Should the share
   modal offer a 7-day / 30-day / never expiry picker? If yes, wire it in Phase 4.

6. **User search privacy** — `GET /share/users/search?q=` exposes all registered
   usernames to any logged-in user. Acceptable for a small team app? If not, restrict
   results to users who share at least one workspace with the searcher.

7. **DB card share destination** — When sharing a DB card to a user, the plan
   auto-creates a "📥 Shared Cards" database workspace in the recipient's account.
   Should the sender be able to specify an existing database in the recipient's account
   instead? (Requires loading recipient's databases — more UI complexity.)

8. **Workspace share — which user's categories apply?** — `categories` and
   `attr_definitions` are global tables shared by all users. When a workspace is copied,
   the notes' `note_categories` rows reference category IDs that already exist globally —
   no copying needed. Confirm this assumption holds for the production DB before shipping.
