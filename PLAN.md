# Plan: CRM Homespace Page (page_type = "crm")
Date: 2026-04-11
Estimated complexity: High (phased — Phase 1 = Medium, Phase 2–3 = High each)

---

## Summary

Replace the `home_page_coming_soon.html` stub for CRM pages with a fully working
Contact Relationship Management page. The page type `"crm"` is already in `PAGE_TYPES`
(in `routers/home_db.py`) and already routes to the coming-soon fallback in
`home_page_view()`. This plan adds the router, DB schema, template, and JS module
to bring it to life — mirroring the exact same structural pattern as the RSS Reader
(`rss` page type) but without any feed-sync complexity.

**Three discrete phases, each independently shippable:**

- **Phase 1** — Contact list with table/gallery view toggle, full CRUD, and per-page
  custom field definitions. Core CRM loop.
- **Phase 2** — Kanban pipeline: drag-and-drop stages, deal cards linked to contacts.
- **Phase 3** — Activity log (call/email/meeting/task/note), linked BookWorm notes,
  next follow-up reminder date per contact.

---

## What Already Exists — Do NOT Rebuild

| Thing | Where | Status |
|---|---|---|
| `"crm"` in `PAGE_TYPES` frozenset | `routers/home_db.py` line 43 | ✅ done |
| `home_page_view()` routing stub — falls to `coming_soon` | `routers/home.py` lines 591–607 | ✅ done (needs `elif crm:` added) |
| `_initSwappedPage()` dispatcher — detects `#rss-page-root`, falls back to `initHomeWidgets()` | `static/js/home-widgets.js` lines 861–872 | ✅ done (needs `#crm-page-root` guard added) |
| `coming_soon` template stub with CRM feature list | `templates/partials/home_page_coming_soon.html` | ✅ exists (do not delete — other types still use it) |
| All JS loaded from `base.html` via `?v={{ static_v }}` | `templates/base.html` lines 544–558 | ✅ pattern established |
| `get_db()` context manager | `database.py` | ✅ use everywhere |

---

## Files to Change

Touch **in this order** to avoid import-order or template-not-found errors at startup.

| # | File | What changes |
|---|---|---|
| 1 | `database.py` | Add CRM tables to `init_db()` — Phase 1 tables first, then Phase 2, then Phase 3 (all additive) |
| 2 | `routers/home.py` | Add `elif p_type == "crm":` branch in `home_page_view()` |
| 3 | `static/js/home-widgets.js` | Add `#crm-page-root` guard in `_initSwappedPage()` before the dashboard fallback |
| 4 | `templates/base.html` | Add `<script src="/static/js/home-page-crm.js?v={{ static_v }}" defer></script>` after the RSS line (line 555) |
| 5 | `main.py` | Import `home_crm` router and `app.include_router(home_crm_router.router)` after the `home_rss` line |

---

## New Files to Create

| File | Purpose |
|---|---|
| `routers/home_crm_db.py` | All DB query helpers for CRM (contacts, fields, stages, deals, activities) |
| `routers/home_crm.py` | FastAPI router — all `/home/crm/{page_id}/...` JSON endpoints |
| `templates/partials/home_page_crm.html` | CRM page shell — top bar + view container + seed JSON; JS does all rendering |
| `static/js/home-page-crm.js` | CRM JS module — `initCrmPage(pageId)`, all views, CRUD, drag-drop (Phase 2) |

---

## DB Migrations Needed

All migrations go inside `init_db()` in `database.py`. They are additive and
idempotent (safe to run on a live DB). **No table-swap dance needed** — all CRM
tables are brand-new; nothing needs a constraint change.

### Phase 1 Tables

```sql
-- Core contact record (scoped per CRM page + user)
CREATE TABLE IF NOT EXISTS crm_contacts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id      INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    name         TEXT    NOT NULL DEFAULT '',
    email        TEXT    NOT NULL DEFAULT '',
    phone        TEXT    NOT NULL DEFAULT '',
    company      TEXT    NOT NULL DEFAULT '',
    tags         TEXT    NOT NULL DEFAULT '',       -- comma-separated free-text tags
    avatar_emoji TEXT    NOT NULL DEFAULT '👤',
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS crm_contacts_updated_at
AFTER UPDATE ON crm_contacts
BEGIN
    UPDATE crm_contacts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Custom field definitions (per CRM page)
CREATE TABLE IF NOT EXISTS crm_custom_fields (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    label      TEXT    NOT NULL,
    field_type TEXT    NOT NULL DEFAULT 'text',   -- text | select | url | date | number
    options    TEXT    NOT NULL DEFAULT '',        -- pipe-separated choices for 'select'
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Per-contact values for each custom field
CREATE TABLE IF NOT EXISTS crm_contact_field_values (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL REFERENCES crm_contacts(id)      ON DELETE CASCADE,
    field_id   INTEGER NOT NULL REFERENCES crm_custom_fields(id) ON DELETE CASCADE,
    value      TEXT    NOT NULL DEFAULT '',
    UNIQUE(contact_id, field_id)          -- upsert-safe
);
```

### Phase 2 Tables

```sql
-- Pipeline stages (per CRM page, ordered)
CREATE TABLE IF NOT EXISTS crm_stages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    name       TEXT    NOT NULL DEFAULT 'New Stage',
    color      TEXT    NOT NULL DEFAULT '#0053e2',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Deal / pipeline card (links a contact to a stage)
CREATE TABLE IF NOT EXISTS crm_deals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
    stage_id   INTEGER REFERENCES crm_stages(id)   ON DELETE SET NULL,
    title      TEXT    NOT NULL DEFAULT '',
    value      REAL    NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS crm_deals_updated_at
AFTER UPDATE ON crm_deals
BEGIN
    UPDATE crm_deals SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
```

### Phase 3 Tables

```sql
-- Activity records (call, email, meeting, task, note) per contact
CREATE TABLE IF NOT EXISTS crm_activities (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id       INTEGER NOT NULL REFERENCES home_pages(id)   ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    contact_id    INTEGER REFERENCES crm_contacts(id)           ON DELETE CASCADE,
    activity_type TEXT    NOT NULL DEFAULT 'note',  -- note|call|email|meeting|task
    body          TEXT    NOT NULL DEFAULT '',
    due_date      DATE    DEFAULT NULL,
    completed     INTEGER NOT NULL DEFAULT 0,
    note_id       INTEGER REFERENCES notes(id) ON DELETE SET NULL,  -- linked BookWorm note
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Migration placement inside `init_db()`: add a new `# ── CRM tables ──` section at the
end of the function, directly after the existing `# ── RSS Reader tables ──` block.
Use the same `CREATE TABLE IF NOT EXISTS` / `CREATE TRIGGER IF NOT EXISTS` pattern —
no `try/except` needed because these are all fresh tables.

---

## API Endpoints

All endpoints live in `routers/home_crm.py`, prefix `/home`. All return `JSONResponse`.
None are public — no `_PUBLIC` changes needed.

### Phase 1 — Contacts + Custom Fields

```
GET  /home/crm/{page_id}/contacts                          → list all contacts + their field values
POST /home/crm/{page_id}/contacts/add                      → create contact
POST /home/crm/{page_id}/contacts/{contact_id}/update      → update contact core fields
POST /home/crm/{page_id}/contacts/{contact_id}/delete      → delete contact (cascades field values + activities)
POST /home/crm/{page_id}/contacts/{contact_id}/field-value → upsert a custom field value (INSERT OR REPLACE)

GET  /home/crm/{page_id}/fields                            → list custom field definitions
POST /home/crm/{page_id}/fields/add                        → add custom field definition
POST /home/crm/{page_id}/fields/{field_id}/update          → rename / change type / options
POST /home/crm/{page_id}/fields/{field_id}/delete          → delete field + all its values (CASCADE)
```

### Phase 2 — Kanban Pipeline

```
GET  /home/crm/{page_id}/stages                            → list stages ordered by sort_order
POST /home/crm/{page_id}/stages/add                        → add stage
POST /home/crm/{page_id}/stages/{stage_id}/update          → rename / recolor
POST /home/crm/{page_id}/stages/{stage_id}/delete          → delete stage (deals → stage_id SET NULL)
POST /home/crm/{page_id}/stages/reorder                    → body: JSON array of ordered stage IDs

GET  /home/crm/{page_id}/deals                             → list all deals (joined with contact name + stage name)
POST /home/crm/{page_id}/deals/add                         → create deal
POST /home/crm/{page_id}/deals/{deal_id}/update            → update title / value / contact_id
POST /home/crm/{page_id}/deals/{deal_id}/move              → body: stage_id + sort_order (drag result)
POST /home/crm/{page_id}/deals/{deal_id}/delete            → delete deal
```

### Phase 3 — Activity Log

```
GET  /home/crm/{page_id}/contacts/{contact_id}/activities  → list activities for one contact
POST /home/crm/{page_id}/contacts/{contact_id}/activities/add  → add activity
POST /home/crm/{page_id}/activities/{activity_id}/update   → update body/due_date/completed/note_id
POST /home/crm/{page_id}/activities/{activity_id}/delete   → delete activity
```

---

## Exact Code Changes for Wired-In Files

### Change A — `routers/home.py` — add the CRM branch

In `home_page_view()`, locate the block starting at line 591:

```python
# EXISTING:
        if p_type == "dashboard":
            tmpl = "partials/home_page.html"
        elif p_type == "rss":
            tmpl = "partials/home_page_rss.html"
            # ... rss-specific db prep ...
        else:
            tmpl = "partials/home_page_coming_soon.html"
```

Add **one `elif` block** between `rss` and `else`:

```python
        elif p_type == "crm":
            tmpl = "partials/home_page_crm.html"
            # No server-side DB prep — JS calls /home/crm/{page_id}/contacts
            # and /home/crm/{page_id}/fields after the page loads.
```

No new imports needed in `home.py` for Phase 1 — the CRM router is standalone.

### Change B — `static/js/home-widgets.js` — add CRM guard in `_initSwappedPage()`

Locate lines 861–872 (the `_initSwappedPage` function body):

```js
// EXISTING:
function _initSwappedPage() {
  // RSS Reader page
  const rssRoot = document.getElementById('rss-page-root');
  if (rssRoot) {
    const pid = parseInt(rssRoot.dataset.pageId, 10);
    if (pid && typeof initRssPage === 'function') {
      try { initRssPage(pid); } catch(e) { console.error('[home] initRssPage:', e); }
    }
    return; // RSS page has no widget canvas — stop here
  }
  // Dashboard (widget canvas)
  try { initHomeWidgets(); } catch(e) { console.error('[home] initHomeWidgets:', e); }
}
```

Insert a CRM guard **between the RSS block and the Dashboard fallback**:

```js
  // CRM page
  const crmRoot = document.getElementById('crm-page-root');
  if (crmRoot) {
    const pid = parseInt(crmRoot.dataset.pageId, 10);
    if (pid && typeof initCrmPage === 'function') {
      try { initCrmPage(pid); } catch(e) { console.error('[home] initCrmPage:', e); }
    }
    return; // CRM page has no widget canvas — stop here
  }
```

### Change C — `templates/base.html` — load CRM JS

After line 555 (`home-page-rss.js` script tag):

```html
<script src="/static/js/home-page-crm.js?v={{ static_v }}" defer></script>
```

### Change D — `main.py` — mount the CRM router

Add import after the existing `home_rss` import line:

```python
from routers import home_crm as home_crm_router
```

Add include after the existing `home_rss_router` include line:

```python
app.include_router(home_crm_router.router)
```

---

## New File Specifications

### `routers/home_crm.py`

```python
"""CRM page-level routes.

Mounted with prefix=/home (same as routers/home.py + home_rss.py).
Routes live under /home/crm/{page_id}/...

All endpoints return JSONResponse and are consumed by home-page-crm.js.
The page shell is rendered by home_page_view() in home.py.
"""
from fastapi import APIRouter, Form, Request
from fastapi.responses import JSONResponse
from routers.home_db import get_home_page
from routers.home_crm_db import (
    get_contacts, add_contact, update_contact, delete_contact,
    get_fields, add_field, update_field, delete_field,
    upsert_field_value,
    # Phase 2:
    # get_stages, add_stage, update_stage, delete_stage, reorder_stages,
    # get_deals, add_deal, update_deal, move_deal, delete_deal,
    # Phase 3:
    # get_activities, add_activity, update_activity, delete_activity,
)

router = APIRouter(prefix="/home")

def _uid(request: Request) -> int:
    uid = request.session.get("user_id")
    if not uid:
        raise PermissionError("not logged in")
    return int(uid)

async def _get_crm_page(page_id: int, uid: int):
    """Return the page dict or None; validate page_type == 'crm'."""
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "crm":
        return None
    return page
```

Pattern all endpoints like RSS router — validate page ownership via `_get_crm_page()`,
return `{"error": "page not found"}` with 404 if missing, return `{"error": "..."}` with
400/500 on failure.

### `routers/home_crm_db.py`

```python
"""DB helpers for the CRM page type.

Tables:
  crm_contacts           — contact records per CRM page
  crm_custom_fields      — custom field definitions per CRM page
  crm_contact_field_values — per-contact custom field values
  crm_stages             — pipeline stages (Phase 2)
  crm_deals              — deal cards (Phase 2)
  crm_activities         — activity log (Phase 3)

ALL access via get_db() — never raw aiosqlite.connect().
"""
from database import get_db
```

Key function signatures for Phase 1:

```python
async def get_contacts(page_id: int, user_id: int) -> list[dict]:
    """Return all contacts for page, with custom field values joined in."""
    # Strategy: SELECT * FROM crm_contacts WHERE page_id=? AND user_id=? ORDER BY sort_order, id
    # Then for each contact, SELECT field_id, value FROM crm_contact_field_values WHERE contact_id=?
    # Attach as contact["field_values"] = {field_id: value, ...}
    # Acceptable N+1 at Phase 1 contact counts; optimize with JOIN if profiling flags it.

async def add_contact(page_id: int, user_id: int, name: str, email: str,
                      phone: str, company: str, tags: str, avatar_emoji: str) -> list[dict]:
    """Insert contact, return updated contact list."""

async def update_contact(contact_id: int, page_id: int, user_id: int, **kwargs) -> list[dict]:
    """Update allowed core fields, return updated contact list."""

async def delete_contact(contact_id: int, page_id: int, user_id: int) -> list[dict]:
    """Delete contact (cascades field values + activities), return updated list."""

async def upsert_field_value(contact_id: int, field_id: int, value: str) -> bool:
    """INSERT OR REPLACE into crm_contact_field_values."""

async def get_fields(page_id: int, user_id: int) -> list[dict]:
    """Return custom field definitions ordered by sort_order."""

async def add_field(page_id: int, user_id: int, label: str,
                    field_type: str, options: str) -> list[dict]:
    """Insert field definition, return updated field list."""

async def update_field(field_id: int, page_id: int, user_id: int,
                       label: str, field_type: str, options: str) -> list[dict]:

async def delete_field(field_id: int, page_id: int, user_id: int) -> list[dict]:
    """Delete field + CASCADE removes all its field values; return updated list."""
```

### `templates/partials/home_page_crm.html`

Minimum viable shell (JS does all rendering):

```html
{# ── CRM page — partials/home_page_crm.html ─────────────────────────────────
   Rendered by home_page_view() when page.page_type == 'crm'.
   Context: page (dict), page_type (str)
   JS:      static/js/home-page-crm.js (loaded via base.html static_v tag)
#}
<div id="crm-page-root" data-page-id="{{ page.id }}"
     class="flex flex-col"
     style="height:calc(100vh - 3.5rem)">

  {# ── Top bar ── #}
  <div class="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200
              dark:border-zinc-800 bg-white dark:bg-zinc-900 flex-shrink-0">
    <span class="text-lg leading-none">{{ page.emoji }}</span>
    <h1 class="text-sm font-semibold text-gray-800 dark:text-zinc-100 truncate">
      {{ page.name }}
    </h1>
    <span class="ml-1 px-1.5 py-0.5 text-[9px] font-bold rounded uppercase tracking-wide
                 bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300">
      CRM
    </span>

    {# View toggle — JS wires onclick #}
    <div id="crm-view-toggle" class="ml-auto flex items-center gap-1"></div>

    {# Add contact button — JS wires onclick #}
    <button id="crm-add-contact-btn"
            class="ml-2 text-xs font-semibold px-3 py-1.5 rounded-lg
                   bg-[#0053e2] text-white hover:bg-blue-700 transition">
      + Contact
    </button>

    {# Manage fields button #}
    <button id="crm-manage-fields-btn"
            class="text-xs font-medium px-2 py-1.5 rounded-lg
                   border border-gray-300 dark:border-zinc-600
                   text-gray-600 dark:text-zinc-300 hover:border-[#0053e2] transition">
      ⚙ Fields
    </button>
  </div>

  {# ── Main content area — populated entirely by home-page-crm.js ── #}
  <div id="crm-main" class="flex-1 overflow-auto p-4">
    <p class="text-gray-400 dark:text-zinc-500 text-sm">Loading contacts…</p>
  </div>

  {# ── Modal backdrop — JS shows/hides ── #}
  <div id="crm-modal-backdrop"
       class="hidden fixed inset-0 bg-black/40 z-40"
       onclick="crmCloseModal()"></div>

  {# ── Contact add/edit modal — JS populates ── #}
  <div id="crm-modal"
       class="hidden fixed inset-0 z-50 flex items-center justify-center p-4">
    <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg
                border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <div id="crm-modal-body" class="p-6"></div>
    </div>
  </div>

</div>
```

### `static/js/home-page-crm.js`

Module structure (use `var` for all module-level state — not `let`/`const` — because
while this file itself is not HTMX-reinjected, `_initSwappedPage()` calls `initCrmPage()`
on every page swap. Calling `initCrmPage()` must be idempotent and safe to call multiple
times. Using `var` at module scope prevents re-declaration errors if the script somehow
executes twice in a session.):

```js
// ── CRM page module ──────────────────────────────────────────────────────────
// Loaded once via base.html. Activated by _initSwappedPage() when
// #crm-page-root is detected in the DOM.

var _crmPageId   = null;
var _crmContacts = [];
var _crmFields   = [];
var _crmView     = localStorage.getItem('bw_crm_view') || 'table'; // 'table' | 'gallery'

function initCrmPage(pageId) {
  _crmPageId = pageId;
  _crmView   = localStorage.getItem('bw_crm_view') || 'table';
  _crmRenderViewToggle();
  _crmLoadAll();
}

async function _crmLoadAll() {
  // Parallel fetch contacts + fields
  // Render table or gallery depending on _crmView
}

function _crmRenderTable() { /* ... */ }
function _crmRenderGallery() { /* ... */ }
function _crmRenderViewToggle() { /* ... */ }

// ── Contact CRUD ──────────────────────────────────────────────────────────────
function crmOpenAdd() { /* show modal with blank form */ }
function crmOpenEdit(contactId) { /* show modal prefilled */ }
async function crmSaveContact(contactId) { /* POST add or update */ }
async function crmDeleteContact(contactId) { /* POST delete, confirm first */ }
function crmCloseModal() { /* hide modal + backdrop */ }

// ── Field management ──────────────────────────────────────────────────────────
function crmOpenFields() { /* show fields modal */ }
async function crmSaveField(fieldId) { /* add or update field */ }
async function crmDeleteField(fieldId) { /* delete field */ }
async function crmSaveFieldValue(contactId, fieldId, value) { /* upsert */ }

// ── Utilities ─────────────────────────────────────────────────────────────────
function _crmEsc(s) { /* HTML escape */ }
async function _crmFetch(url, opts) {
  // Wrapper: check Content-Type before .json() to catch session-expiry 302→HTML
  // (same pattern as home-page-rss.js)
}
```

> ⚠️ The JS file is **not** HTMX-reinjected (it's loaded once from `base.html`), so
> `let`/`const` inside function bodies are fine. However, **module-level state variables**
> (`_crmPageId`, `_crmContacts`, etc.) should use `var` so that if `initCrmPage()` is
> called a second time (navigating away and back), the re-assignment to `var` is silent
> and idempotent rather than throwing on `const` re-declaration in a future edge case.
> See Quirk #13 for the underlying rule.

---

## Phase Boundary Summary

| Phase | Tables | Routes | Template additions | JS additions |
|---|---|---|---|---|
| 1 — Contacts + Fields | `crm_contacts`, `crm_custom_fields`, `crm_contact_field_values`, 1 trigger | 9 endpoints | Initial shell (top bar, `#crm-main`, modal) | `initCrmPage`, table/gallery render, contact CRUD, field management |
| 2 — Kanban | `crm_stages`, `crm_deals`, 1 trigger | 10 endpoints | "Pipeline" tab / view in top bar | Stage columns, deal cards, drag-drop via HTML5 drag or SortableJS |
| 3 — Activity Log | `crm_activities` | 4 endpoints | Sidebar or modal panel for contact detail | Activity feed render, note-link picker (reuse `_user_notes` search pattern), due-date highlight |

Ship Phase 1 to production before designing Phase 2 UI — real usage shapes the Kanban schema better than up-front guessing.

---

## Skills to Invoke

Run in this order during and after implementation:

| # | Skill / Agent | When | Why |
|---|---|---|---|
| 1 | `bookworm-db-migration` | After writing `database.py` changes | Dry-run the 5 new `CREATE TABLE IF NOT EXISTS` + 2 triggers, confirm idempotent on live DB |
| 2 | `bookworm-template-audit` | After writing `home_page_crm.html` and `home-page-crm.js` | Check for `var` in module-level state, `| tojson | safe` on any JSON injection, `?v={{ static_v }}` on script tag, broken `hx-target` IDs |
| 3 | `bookworm-qa` | After each phase ships | Hit all new endpoints, check page renders, confirm `_initSwappedPage` fires `initCrmPage`, verify no widget canvas init error on CRM pages |
| 4 | `bookworm-pre-commit` | Before every commit | Standard 10-phase BookWorm safety checklist |
| 5 | `bookworm-docs-keeper` | After Phase 1 ships | Update CODEPUPPY_NOTES schema section (5 new tables + triggers), update "Features Completed" list |

---

## BookWorm Gotchas That Apply to This Feature

**Quirk #10 — `_hpCache` 5-min client-side TTL.**
`home-widgets.js` caches each `/home/pages/{id}` response in `_hpCache` for 5 minutes.
If a user navigates to a CRM page, goes elsewhere, and comes back within 5 minutes, HTMX
serves the cached HTML. `_initSwappedPage()` still fires after the swap, so `initCrmPage()`
will still be called — but if there was a bug fix in the template between the two visits,
the old HTML is served. **Rule: always hard-refresh (`Ctrl+Shift+R`) when testing template
changes to a CRM page.**

**Quirk #13 — `var` not `let`/`const` in HTMX-reinjected `<script>` blocks.**
`home_page_crm.html` must not have any `<script>` blocks with top-level `let`/`const`.
The template is swapped into the DOM by HTMX on every page navigation. Any top-level
`let`/`const` declaration in a `<script>` inside the template will throw
`SyntaxError: Identifier already declared` on the second navigation. Use `var` or move
state into the `home-page-crm.js` static module (preferred — keep the template's `<script>`
minimal or absent entirely).

**Quirk #16 — `| tojson | safe` for any JSON in `<script>` tags.**
If the template injects any server-side data into the page as JSON (e.g. initial contact
list to avoid a loading flash), it **must** be `{{ data | tojson | safe }}`. Without `|
safe`, Jinja2 autoescape HTML-encodes every `"` to `&quot;`, which `JSON.parse()` silently
fails on. For Phase 1, we're using the pure-API-call approach (JS fetches contacts after
page load), so this quirk only matters if we add a data-injection shortcut later.

**Quirk #3 — Static JS mtime must change for `static_v` to increment.**
After editing `home-page-crm.js`, the server must be restarted (or the file touched) for
browsers to get the updated script. In the `reload=True` dev mode, Python files auto-reload
but static JS does **not** trigger a `static_v` recompute. **Workaround: restart the server
or hard-refresh.** This is especially easy to forget when iterating on the JS module.

**Quirk #17 — Avoid N+1 for custom field values.**
`get_contacts()` in `home_crm_db.py` will be tempted to do one DB call per contact to
fetch its field values. At Phase 1 contact counts (≤100) this is acceptable, but document
it as tech debt and add a `# FIXME: N+1 — replace with JOIN or IN() query` comment. Do
not copy the pattern to the activity log (Phase 3) without a JOIN.

**Quirk re: `_uid()` function naming collision.**
Both `routers/home.py` and `routers/home_rss.py` define a local `_uid(request)` helper.
`routers/home_crm.py` should do the same (copy the exact pattern from `home_rss.py` lines
28–31). Do NOT import `_uid` from another router — it's intentionally private.

**Quirk re: page ownership validation.**
Every CRM endpoint must validate that `page.user_id == uid` AND `page.page_type == "crm"`.
Use the `_get_crm_page(page_id, uid)` helper (defined in `home_crm.py`) which calls
`get_home_page(page_id, uid)` — that function already filters by `user_id` at the SQL
level (`WHERE id=? AND user_id=?`), making it impossible to read another user's page.

**Quirk re: `crm_stages` ON DELETE cascade choice.**
When a stage is deleted, deals in that stage should NOT be deleted (the contact data is
valuable). Use `stage_id REFERENCES crm_stages(id) ON DELETE SET NULL` on `crm_deals` —
same pattern as `source_widget_id` on `rss_page_feeds`. JS should handle `stage_id = null`
deals gracefully (show in an "Unsorted" column).

---

## Implementation Checklist

### Phase 1 — Contacts + Custom Fields

- [ ] **Step 1 — DB: write Phase 1 migrations**
  In `database.py` `init_db()`, after the RSS block, add:
  - `CREATE TABLE IF NOT EXISTS crm_contacts (...)`
  - `CREATE TRIGGER IF NOT EXISTS crm_contacts_updated_at ...`
  - `CREATE TABLE IF NOT EXISTS crm_custom_fields (...)`
  - `CREATE TABLE IF NOT EXISTS crm_contact_field_values (...)`
  Run `bookworm-db-migration` skill to dry-run on live DB.

- [ ] **Step 2 — DB helpers: write `routers/home_crm_db.py`**
  Implement Phase 1 functions: `get_contacts`, `add_contact`, `update_contact`,
  `delete_contact`, `upsert_field_value`, `get_fields`, `add_field`, `update_field`,
  `delete_field`. Use `get_db()` everywhere. Add `# FIXME: N+1` comment on field-value
  fetching loop.

- [ ] **Step 3 — Router: write `routers/home_crm.py`**
  Implement 9 Phase 1 endpoints. Validate page ownership on every route via
  `_get_crm_page()`. Return `JSONResponse` throughout.

- [ ] **Step 4 — Routing: add `elif p_type == "crm":` in `routers/home.py`**
  One-liner change in `home_page_view()`. Confirm `widget_sources` NameError does
  NOT occur — the existing `"widget_sources": widget_sources if p_type == "rss" else {}`
  short-circuits safely (Python evaluates the `else {}` branch without accessing
  `widget_sources` when `p_type != "rss"`).

- [ ] **Step 5 — Template: create `templates/partials/home_page_crm.html`**
  Shell with `#crm-page-root`, top bar, `#crm-main`, modal backdrop, modal container.
  Zero inline `<script>` if possible — keep all logic in the static JS file.
  No `let`/`const` at top level of any `<script>` block.

- [ ] **Step 6 — JS: create `static/js/home-page-crm.js`**
  Implement `initCrmPage(pageId)`, `_crmLoadAll()`, `_crmRenderTable()`,
  `_crmRenderGallery()`, `_crmRenderViewToggle()`, `crmOpenAdd()`, `crmOpenEdit()`,
  `crmSaveContact()`, `crmDeleteContact()`, `crmCloseModal()`, `crmOpenFields()`,
  `crmSaveField()`, `crmDeleteField()`, `crmSaveFieldValue()`, `_crmEsc()`,
  `_crmFetch()`. Use `var` for all module-level state.

- [ ] **Step 7 — Wire JS into `_initSwappedPage()` in `static/js/home-widgets.js`**
  Add the `#crm-page-root` guard block between the RSS block and the Dashboard fallback.

- [ ] **Step 8 — Wire JS into `templates/base.html`**
  Add `<script src="/static/js/home-page-crm.js?v={{ static_v }}" defer></script>`
  after the `home-page-rss.js` line.

- [ ] **Step 9 — Mount router in `main.py`**
  Import `home_crm` and `app.include_router(home_crm_router.router)`.

- [ ] **Step 10 — Restart server, hard-refresh, smoke test**
  Navigate to a CRM page. Confirm: (a) page no longer shows "Coming Soon", (b) top
  bar renders, (c) `initCrmPage` fires in browser console, (d) API calls succeed.
  Add a contact, edit it, delete it. Add a custom field, set a value on a contact,
  delete the field.

- [ ] **Step 11 — Run `bookworm-template-audit`**
  Pass files: `templates/partials/home_page_crm.html`, `static/js/home-page-crm.js`,
  `static/js/home-widgets.js`.

- [ ] **Step 12 — Run `bookworm-qa`**
  Pass: new endpoints (contacts CRUD, fields CRUD), page render, `_initSwappedPage` guard.

- [ ] **Step 13 — Run `bookworm-pre-commit`**

- [ ] **Step 14 — Run `bookworm-docs-keeper`**
  Update CODEPUPPY_NOTES schema section (5 new tables + 2 triggers), "Features Completed".

- [ ] **Step 15 — Commit Phase 1**
  Message: `feat(crm): Phase 1 — contact list, gallery view, custom fields`

### Phase 2 — Kanban Pipeline

- [ ] **Step 16 — DB: write Phase 2 migrations** (`crm_stages`, `crm_deals`, trigger)
- [ ] **Step 17 — DB helpers: extend `home_crm_db.py`** with stage + deal functions
- [ ] **Step 18 — Router: add 10 Phase 2 endpoints to `home_crm.py`**
- [ ] **Step 19 — Template: add "Pipeline" tab/view switcher to `home_page_crm.html`**
- [ ] **Step 20 — JS: implement Kanban render, drag-drop (HTML5 drag API, no extra deps)**
  Decide on drag library (HTML5 native preferred — no new CDN tags per guidelines).
- [ ] **Step 21 — Audit → QA → Pre-commit → Docs → Commit Phase 2**
  Message: `feat(crm): Phase 2 — Kanban pipeline with drag-and-drop stages`

### Phase 3 — Activity Log + Note Links + Reminders

- [ ] **Step 22 — DB: write Phase 3 migration** (`crm_activities`)
- [ ] **Step 23 — DB helpers: extend `home_crm_db.py`** with activity functions
- [ ] **Step 24 — Router: add 4 Phase 3 endpoints**
- [ ] **Step 25 — Template: add activity panel anchor** (slide-out or tab in contact detail modal)
- [ ] **Step 26 — JS: implement activity feed, note-link picker (call `/home/crm/{page_id}/contacts/{id}/activities`)**
  Note-link picker should call an existing notes search endpoint (pattern from `_user_notes()` in `home.py`).
  Next follow-up date: derived from `min(due_date) WHERE completed=0` per contact; show in table/gallery row.
- [ ] **Step 27 — Audit → QA → Pre-commit → Docs → Commit Phase 3**
  Message: `feat(crm): Phase 3 — activity log, note links, follow-up reminders`

---

## Open Questions

**1. Contacts-per-page vs contacts-per-user scope (Phase 1)**
Current plan: contacts are scoped to a specific CRM page (`page_id` on `crm_contacts`).
This means each CRM page is an independent contact database. Alternative: contacts are
global per user and any CRM page can see all the user's contacts (shared address book).
**Recommendation: per-page scope (simpler, more flexible — team members can run
separate pipelines).** But confirm with Tinh before writing the schema — switching
from per-page to per-user later requires a table rebuild.

**2. Drag library for Phase 2 Kanban**
The app currently has zero npm / no-CDN policy for Tailwind (tech debt), and `AGENTS.md`
says "no new CDN script tags". HTML5 drag-and-drop API is sufficient for basic column
drag but terrible on mobile. Options: (a) HTML5 native (no dep, desktop-only), (b)
SortableJS baked into `static/js/` as a committed file (no CDN, adds ~18 KB). **Decision
needed before Phase 2 JS work starts.** Baking SortableJS into `static/js/` is the
cleanest path — download from the GitHub releases URL pattern used for Walmart installs.

**3. Activity note-link picker UX (Phase 3)**
The RSS module uses a server-side fetch to list user's notes. For CRM, we need a
typeahead/searchable dropdown in the activity modal to pick an existing BookWorm note.
Should this reuse the existing note-search endpoint (`GET /notes?q=...`) or get its own
dedicated CRM endpoint? **Recommendation: call `GET /home/crm/{page_id}/notes-search?q=`
which proxies to `search_notes(workspace_ids=...)`** — this avoids adding cross-router
imports and keeps CRM self-contained.

**4. Follow-up reminder integration with the Reminder widget (Phase 3)**
CRM "next follow-up" dates are stored in `crm_activities.due_date`. Should overdue CRM
follow-ups appear in the existing Reminder widget on the dashboard? That would require
the Reminder widget JS to call a CRM endpoint, coupling the two systems. **Recommendation:
keep them separate for now (YAGNI) — CRM shows its own overdue indicators in the contact
table. Revisit if Tinh asks for cross-page reminders.**

**5. Gallery view card design**
The "gallery view" for contacts needs a card design decision. Options: (a) avatar emoji +
name + email + company + tags (compact), (b) full detail card (name, all custom fields).
**Recommendation: compact card (emoji + name + company + email + tag pills) — consistent
with the existing note_link widget card style.** Confirm with Tinh before implementing.
