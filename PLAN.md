# Plan: CRM Date Field Reminders
Date: 2026-04-12
Estimated complexity: Medium

## Summary
Add a "Set Reminder" sub-section beneath every `date`-type custom field in the CRM contact **edit** modal. A user can add one or more reminders linked to a specific date field on a specific contact (pre-filled label, date, and 09:00 default time). Reminders are stored in a new `crm_contact_reminders` table. A new cross-page polling endpoint (`GET /home/crm-reminders/due`) is hit every 30 s by a new JS module; any reminder whose `reminder_date == today` and `reminder_time == current HH:MM` (browser local time) fires a `_showReminderToast()`. All CRUD is immediate (no waiting for the contact Save button). Reminder UI is hidden in Add-Contact mode (no contact ID yet).

---

## Files to Change
Ordered — touch in this sequence to avoid dependency issues.

| # | File | What changes |
|---|---|---|
| 1 | `database.py` | Add `crm_contact_reminders` table inside `init_db()` (new `CREATE TABLE IF NOT EXISTS` block, additive migration) |
| 2 | `routers/home_crm_db.py` | Add 4 new DB helpers: `get_contact_reminders`, `add_contact_reminder`, `delete_contact_reminder`, `get_due_crm_reminders` |
| 3 | `routers/home_crm.py` | Add 4 new routes (list, add, delete per-contact reminders; cross-page due-poll) |
| 4 | `static/js/home-page-crm.js` | Inject reminder placeholder `<div id="crm-rem-{f.id}">` in the date-field branch of `_crmContactModal`; call `crmLoadReminders()` for each date field after `_crmShowModal(body)` |
| 5 | `static/js/home-page-crm-reminders.js` | **New file** — all reminder UI, CRUD fetch calls, and the 30 s poll loop (see New Files section) |
| 6 | `templates/base.html` | Add `<script src="/static/js/home-page-crm-reminders.js?v={{ static_v }}" defer></script>` after the existing CRM script tags (line 576) |

---

## New Files to Create

| File | Purpose |
|---|---|
| `static/js/home-page-crm-reminders.js` | Reminder list render, add/delete CRUD, `_checkCrmReminders()` poll, `initCrmRemindersPolling()` entry point |

---

## DB Migrations Needed

### New table — additive, safe to run on live DB

```sql
CREATE TABLE IF NOT EXISTS crm_contact_reminders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id    INTEGER NOT NULL REFERENCES crm_contacts(id)      ON DELETE CASCADE,
    field_id      INTEGER NOT NULL REFERENCES crm_custom_fields(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id)              ON DELETE CASCADE,
    label         TEXT    NOT NULL DEFAULT '',
    reminder_date TEXT    NOT NULL,          -- 'YYYY-MM-DD' (stored as text)
    reminder_time TEXT    NOT NULL DEFAULT '09:00',  -- 'HH:MM' 24-h, browser local time
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

**Placement in `database.py`:** Add this block inside `init_db()`, immediately after the `crm_deals_updated_at` trigger block (around line 482), before the additive `crm_contacts: profile_pic column` migration block. Follow the exact `await db.execute(""" CREATE TABLE IF NOT EXISTS ... """)` pattern used by all CRM tables.

**Index** — add immediately after the table creation:
```sql
CREATE INDEX IF NOT EXISTS idx_crm_reminders_user_date
    ON crm_contact_reminders(user_id, reminder_date);
```

This is **additive only** — no table-swap needed. Safe to run 10× on a live DB.

---

## API Contract

### Per-contact routes (prefix: `/home/crm/{page_id}/contacts/{contact_id}/`)

| Method | Path suffix | Body (Form) | Returns |
|---|---|---|---|
| `GET` | `reminders` | — | `[{id, contact_id, field_id, label, reminder_date, reminder_time, created_at}]` |
| `POST` | `reminders/add` | `field_id, label, reminder_date, reminder_time` | same list |
| `POST` | `reminders/{reminder_id}/delete` | — | same list |

### Cross-page poll route

| Method | Full path | Query param | Returns |
|---|---|---|---|
| `GET` | `/home/crm-reminders/due` | `date=YYYY-MM-DD` (browser sends today's local date) | `[{id, contact_id, contact_name, field_id, label, reminder_date, reminder_time}]` |

**Auth:** All 4 routes are auth-guarded via `_uid(request)`. No `_PUBLIC` entry needed.

**Ownership validation:** The 3 per-contact routes call `_crm_page(page_id, uid)` (existing helper) + verify `contact_id` belongs to that page via `get_contacts(page_id, uid)` membership check — same pattern as the existing `save_field_value` route. The poll route filters directly by `user_id` in the DB query (no page_id needed).

---

## JS Function Signatures

All functions live in `static/js/home-page-crm-reminders.js`. Use `var` for module-level state to match the existing CRM module pattern.

```js
// ── Module state ──────────────────────────────────────────────────────────────
var _crmRemFired    = {};   // {`${reminderId}-${todayDate}`: true} dedup key
var _crmRemInterval = null; // setInterval handle — cleared on re-init

// ── Called from initCrmPage() in home-page-crm.js ─────────────────────────────
function initCrmRemindersPolling()
// Clear existing interval (guard against HTMX double-init).
// setInterval(_checkCrmReminders, 30_000) + immediate first call.

// ── 30-second poll ─────────────────────────────────────────────────────────────
async function _checkCrmReminders()
// Build date string from browser local time (new Date()).
// GET /home/crm-reminders/due?date=YYYY-MM-DD
// For each item whose reminder_time == current HH:MM and !_crmRemFired[key]:
//   _crmRemFired[key] = true
//   if (typeof _showReminderToast === 'function')
//     _showReminderToast(`${item.contact_name} — ${item.label}`)

// ── Called from home-page-crm.js after _crmShowModal(body) ───────────────────
async function crmLoadReminders(contactId, contactName, fieldId, fieldLabel, dateVal)
// GET /home/crm/{_crmPid}/contacts/{contactId}/reminders
// Filter returned list to reminders where r.field_id === fieldId
// Target el: document.getElementById(`crm-rem-${fieldId}`)
// Call _crmRenderReminderSection(el, filtered, contactId, contactName, fieldId, fieldLabel, dateVal)

// ── Render the reminder sub-section under a date field ─────────────────────────
function _crmRenderReminderSection(el, reminders, contactId, contactName, fieldId, fieldLabel, dateVal)
// Renders into el.innerHTML:
//   - Existing reminders list: each row = label + date + time + 🗑 delete button
//   - "+ Set Reminder" toggle button that expands an inline mini-form
//   - Mini-form pre-fills: label="{contactName} — {fieldLabel}", date=dateVal, time="09:00"
// Use _crmEsc() for all user-supplied text (already available globally from home-page-crm.js)

// ── Add a reminder ─────────────────────────────────────────────────────────────
async function crmAddReminder(btn, contactId, fieldId, fieldLabel, contactName, dateVal)
// Read label/date/time from sibling inputs in the mini-form (identified by data-* attrs)
// POST /home/crm/{_crmPid}/contacts/{contactId}/reminders/add
// On success: crmLoadReminders(contactId, contactName, fieldId, fieldLabel, dateVal)

// ── Delete a reminder ──────────────────────────────────────────────────────────
async function crmDeleteReminder(reminderIdStr, contactId, fieldId, fieldLabel, contactName, dateVal)
// POST /home/crm/{_crmPid}/contacts/{contactId}/reminders/{reminderIdStr}/delete
// On success: crmLoadReminders(contactId, contactName, fieldId, fieldLabel, dateVal)
```

---

## Changes to Existing JS (`home-page-crm.js`)

### 1 — In `_crmContactModal(c)`: split `date` out of the combined `iType` branch

**Find** (around line 263 — the else-branch before the `return` for each field):
```js
} else {
  const iType = {date:'date', number:'number', url:'url', email:'email'}[f.field_type] || 'text';
  control = inp(`cf_${f.id}`, val, iType);
}
return `<div><label ...>${_crmEsc(f.label)}</label>${control}</div>`;
```

**Replace with:**
```js
} else if (f.field_type === 'date') {
  control = inp(`cf_${f.id}`, val, 'date');
  var remDiv = isEdit
    ? `<div id="crm-rem-${f.id}" class="mt-1 text-xs text-gray-400 italic">Loading…</div>`
    : '';
  return `<div>
    <label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">${_crmEsc(f.label)}</label>
    ${control}${remDiv}
  </div>`;
} else {
  var iType = {number:'number', url:'url', email:'email'}[f.field_type] || 'text';
  control = inp(`cf_${f.id}`, val, iType);
}
```
> ⚠️ Note: `iType` changed from `const` to `var` to keep the existing `var`-only pattern in this function.

### 2 — After `_crmShowModal(body)` call in `_crmContactModal`

Add immediately after `_crmShowModal(body)`:
```js
if (isEdit && typeof crmLoadReminders === 'function') {
  _crmFields.filter(function(f) { return f.field_type === 'date'; })
    .forEach(function(f) {
      crmLoadReminders(c.id, c.name, f.id, f.label, fv[f.id] || '');
    });
}
```

### 3 — In `initCrmPage(pid)`: start the poll

Add at the end of `initCrmPage(pid)` (before the closing `}`):
```js
if (typeof initCrmRemindersPolling === 'function') initCrmRemindersPolling();
```

---

## DB Helper Signatures (`routers/home_crm_db.py`)

```python
async def get_contact_reminders(contact_id: int) -> list[dict]:
    """Return all reminders for a contact, ordered by reminder_date, reminder_time."""
    # SELECT * FROM crm_contact_reminders WHERE contact_id=?
    # ORDER BY reminder_date, reminder_time

async def add_contact_reminder(
    contact_id: int, field_id: int, user_id: int,
    label: str, reminder_date: str, reminder_time: str,
) -> list[dict]:
    """Insert a reminder and return the updated list for this contact."""
    # INSERT INTO crm_contact_reminders
    #   (contact_id, field_id, user_id, label, reminder_date, reminder_time)
    #   VALUES (?,?,?,?,?,?)
    # then return get_contact_reminders(contact_id)

async def delete_contact_reminder(reminder_id: int, contact_id: int) -> list[dict]:
    """Delete one reminder, validate contact_id to prevent cross-contact deletes.
    Return updated list for this contact."""
    # DELETE FROM crm_contact_reminders WHERE id=? AND contact_id=?
    # then return get_contact_reminders(contact_id)

async def get_due_crm_reminders(user_id: int, date_str: str) -> list[dict]:
    """Return all reminders for user where reminder_date == date_str.
    JOIN crm_contacts to include contact name."""
    # SELECT r.id, r.contact_id, c.name AS contact_name,
    #        r.field_id, r.label, r.reminder_date, r.reminder_time
    # FROM crm_contact_reminders r
    # JOIN crm_contacts c ON c.id = r.contact_id
    # WHERE r.user_id=? AND r.reminder_date=?
    # ORDER BY r.reminder_time
```

---

## Route Implementations (`routers/home_crm.py`)

**Import block addition** at top of file (add to existing import from `home_crm_db`):
```python
from routers.home_crm_db import (
    ...,  # all existing imports unchanged
    get_contact_reminders, add_contact_reminder,
    delete_contact_reminder, get_due_crm_reminders,
)
```

Also add to the stdlib imports at top:
```python
import datetime
from fastapi import Query
```

### Route 1: `GET /home/crm/{page_id}/contacts/{contact_id}/reminders`
- `_uid(request)` → `_crm_page(page_id, uid)` → membership check → `get_contact_reminders(contact_id)`
- Returns `JSONResponse(reminders)`

### Route 2: `POST /home/crm/{page_id}/contacts/{contact_id}/reminders/add`
Form params: `field_id: int = Form(...)`, `label: str = Form("")`, `reminder_date: str = Form(...)`, `reminder_time: str = Form("09:00")`.
- Validate `reminder_date` is non-empty and 10 chars (basic guard).
- Standard ownership chain, then `add_contact_reminder(contact_id, field_id, uid, label.strip(), reminder_date, reminder_time)`.

### Route 3: `POST /home/crm/{page_id}/contacts/{contact_id}/reminders/{reminder_id}/delete`
- Standard ownership chain, then `delete_contact_reminder(reminder_id, contact_id)`.

### Route 4: `GET /home/crm-reminders/due`
```python
@router.get("/crm-reminders/due")
async def crm_reminders_due(
    request: Request,
    date: str = Query(default=""),
):
    try:
        uid = _uid(request)
        date_str = date.strip() if len(date.strip()) == 10 else datetime.date.today().isoformat()
        return JSONResponse(await get_due_crm_reminders(uid, date_str))
    except PermissionError:
        return _err("not logged in", 401)
    except Exception as e:
        log.exception("crm_reminders_due")
        return _err(str(e), 500)
```
> FastAPI resolves `/home/crm-reminders/due` as a literal path before trying the parameterized `/home/crm/{page_id}/...` family — no routing conflict.

---

## Skills to Invoke

- **`bookworm-db-migration`** — validate the `crm_contact_reminders` migration is idempotent before applying to live DB
- **`bookworm-template-audit`** — after touching `home-page-crm.js` and creating `home-page-crm-reminders.js`; specifically verify no `let`/`const` in injected-HTML contexts, and `?v={{ static_v }}` present on the new `<script>` tag in `base.html`
- **`bookworm-qa`** — hit all 4 new endpoints; verify toast fires; verify edit modal shows reminder section and add modal does not; verify delete works
- **`bookworm-pre-commit`** — before committing
- **`bookworm-docs-keeper`** — update `CODEPUPPY_NOTES.md` schema section with `crm_contact_reminders`, new routes, and new JS module in the file map

---

## BookWorm Gotchas That Apply to This Feature

**`var` not `let`/`const` in `_crmContactModal`:**
The existing `_crmContactModal` function already uses `var` for its module-level bindings. The new `var remDiv = ...` and `var iType = ...` replacements maintain this pattern. If `let` or `const` were used in this scope, repeated HTMX navigations that reinitialize the page would throw redeclaration errors in strict mode. (Quirk from CODEPUPPY_NOTES.md § Known Quirks section, general CRM module pattern.)

**`?v={{ static_v }}` cache-busting on the new `<script>` tag:**
Without it, browsers will serve the old (missing) JS file from cache after deployment. The new line in `base.html` must be:
`<script src="/static/js/home-page-crm-reminders.js?v={{ static_v }}" defer></script>`

**`get_db()` — never raw `aiosqlite.connect()`:**
All 4 new DB helpers must use `async with get_db() as db:`. This is enforced by the pre-commit check.

**Interval guard on HTMX re-navigation:**
`initCrmRemindersPolling()` must clear `_crmRemInterval` before calling `setInterval`. Without this, each CRM page navigation spawns a new poll loop. After 10 navigations the poll fires 10× per tick.

**`_showReminderToast` availability guard:**
`home-widgets-render.js` is loaded before CRM scripts. `_showReminderToast` is always available on the home page. However, use `if (typeof _showReminderToast === 'function')` defensive guard before calling it (matches the pattern in `home-widget-events.js:632`).

**No `_PUBLIC` entry:** `/home/crm-reminders/due` requires a logged-in session. Do NOT add to `_PUBLIC`.

**No `_demo_guard`:** `crm_contact_reminders` is per-user, not a global table. No demo guard needed.

---

## Implementation Checklist

- [ ] **Step 1 — DB schema** — Add `crm_contact_reminders` table + index to `init_db()` in `database.py` after the `crm_deals_updated_at` trigger block. Run `bookworm-db-migration` to confirm idempotency.
- [ ] **Step 2 — DB helpers** — Add `get_contact_reminders`, `add_contact_reminder`, `delete_contact_reminder`, `get_due_crm_reminders` to `routers/home_crm_db.py`. All use `get_db()`, not raw `aiosqlite.connect()`.
- [ ] **Step 3 — Routes** — Add 4 routes to `routers/home_crm.py`. Update the `from routers.home_crm_db import (...)` block. Add `import datetime` and `from fastapi import Query` to stdlib/FastAPI imports.
- [ ] **Step 4 — Modal UI patch** — In `home-page-crm.js`, split the date-type field out of the combined `iType` else-branch. Add `<div id="crm-rem-${f.id}">` placeholder in edit mode. Change `const iType` to `var iType` in the remaining branch.
- [ ] **Step 5 — Poll init hook** — Add `if (typeof initCrmRemindersPolling === 'function') initCrmRemindersPolling();` to end of `initCrmPage(pid)` in `home-page-crm.js`.
- [ ] **Step 6 — Post-modal loader** — Add the date-field reminder loader loop after `_crmShowModal(body)` in `_crmContactModal`.
- [ ] **Step 7 — New JS module** — Create `static/js/home-page-crm-reminders.js` with all functions from the JS Function Signatures section. Use `var` for module-level state. Use `_crmEsc()` (global from `home-page-crm.js`) for all user text.
- [ ] **Step 8 — Register script tag** — Add `<script src="/static/js/home-page-crm-reminders.js?v={{ static_v }}" defer></script>` to `templates/base.html` after line 575.
- [ ] **Step 9 — Smoke test (modal)** — Edit an existing contact with a date field. Confirm reminder placeholder renders. Add a reminder. Confirm it appears with label, date, time, and delete button. Delete it. Confirm it disappears. Open Add Contact modal — confirm NO reminder section.
- [ ] **Step 10 — Smoke test (toast)** — Add a reminder for today's date, set time to current minute + 1. Wait for the 30 s poll. Confirm toast fires with text "{contact_name} — {field_label}".
- [ ] **Step 11 — Template audit** — Run `bookworm-template-audit`. Pass: files = `base.html`, `home-page-crm.js`, `home-page-crm-reminders.js`.
- [ ] **Step 12 — QA** — Run `bookworm-qa`. Pass: new endpoints, modal guard (add vs edit), toast behavior, delete behavior.
- [ ] **Step 13 — Pre-commit** — Run `bookworm-pre-commit`.
- [ ] **Step 14 — Docs sync** — Run `bookworm-docs-keeper`. Update `crm_contact_reminders` in schema, add routes + JS module to file map.

---

## Open Questions

1. **Repeat rules?** The existing reminder widget supports `repeat_unit` / `repeat_interval`. Should CRM date-field reminders repeat (e.g., "remind me every year on this date")? Not included here — additive migration if needed later.

2. **Unified vs per-field reminder section:** This plan renders a separate reminder sub-section under each date field. If a contact has 3 date fields there will be 3 independent reminder sections. Alternative: a single "Reminders" panel at the bottom of the modal listing all reminders across fields, with the field name as a tag. Decide before implementation.

3. **Missed reminder bell badge:** The existing reminder widget feeds `_remLogMissed()` to show a bell badge on widget headers. Should CRM reminders also feed into that bell? Not included — the poll only calls `_showReminderToast`.

4. **Reminder count on contact cards:** Should gallery/table views show a 🔔 badge on contacts that have upcoming reminders? Out of scope for Phase 1 — flag for Phase 2 CRM.

5. **`GET /home/crm-reminders/due` route ordering:** Verify in `home_crm.py` that the literal path `/home/crm-reminders/due` does not conflict with the parameterized `/home/crm/{page_id}/...` family. FastAPI resolves literal paths before parameterized ones so this should be safe, but worth confirming after implementation.
