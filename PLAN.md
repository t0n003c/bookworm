# Plan: Trip Layer in Plan Tab (Plans → Days Two-Level Nav)
Date: 2026-04-24
Estimated complexity: Medium

## Summary
The Plan tab currently shows a flat list of Day lanes for a single implicit itinerary.
This feature introduces an intermediate **Trip plan** layer — matching the Research tab's
Location → Spot two-level nav exactly. After the change the hierarchy is:

> **Plan tab → Plan cards grid** (`#trip-plans-view`) →
> **click a card** → **Day lanes** (`#trip-days-view`)

A new `trip_plans` table holds named plans (name, description, start/end dates).
`trip_days` gains a nullable `plan_id` FK so existing un-scoped days are not lost.
All day-CRUD API calls pass `plan_id`; the toolbar and JS state machine mirror the
locs/spots pattern already established in `home-page-trip-locs.js`.

---

## Files to Change
Touch in this exact sequence to avoid import/runtime dependency issues.

| # | File | What changes |
|---|---|---|
| 1 | `database.py` | Add `trip_plans` table + index; add `trip_days.plan_id` FK column via PRAGMA guard |
| 2 | `routers/home_trip_db.py` | Add 4 plan CRUD helpers; update `get_trip_days` + `add_trip_day` to accept `plan_id` |
| 3 | `routers/home_trip.py` | Add 4 plan API routes; update `list_days` + `add_day` to pass `plan_id`; add imports |
| 4 | `templates/partials/home_page_trip.html` | Split plan panel into two sub-views; add `#trip-plan-modal` |
| 5 | `static/js/home-page-trip-plan.js` | Full rewrite: plan state, plan cards render, open/close plan, plan CRUD, day CRUD updated to pass `plan_id` |
| 6 | `static/js/home-page-trip.js` | Update `_tripRenderTopbarControls()` to branch on `window._tripActivePlanId` |

---

## New Files to Create
None — all changes are in existing files.

---

## DB Migrations Needed

### Migration 1 — New table `trip_plans` (additive, safe)
Place this block inside `init_db()`, immediately after the existing `trip_spot_attrs` block
and the `location_id` PRAGMA migration, before the `await db.commit()` at the end of the trip section.

```sql
CREATE TABLE IF NOT EXISTS trip_plans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  plan_name  TEXT    NOT NULL DEFAULT 'Trip',
  plan_desc  TEXT    NOT NULL DEFAULT '',
  start_date TEXT    NOT NULL DEFAULT '',
  end_date   TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trip_plans_page ON trip_plans(page_id, user_id);
```

### Migration 2 — Add `plan_id` to `trip_days` (additive, PRAGMA-guarded)
Add this Python block immediately after the `trip_plans` CREATE above.

```python
cur = await db.execute("PRAGMA table_info(trip_days)")
_td_cols = {r[1] for r in await cur.fetchall()}
if "plan_id" not in _td_cols:
    await db.execute(
        "ALTER TABLE trip_days ADD COLUMN "
        "plan_id INTEGER REFERENCES trip_plans(id) ON DELETE CASCADE"
    )
```

`plan_id` is nullable — existing days retain `NULL` and are not surfaced in the new UI
(safe data preservation; no rows are lost or modified). This is the deliberate safe choice.

Both migrations are fully additive. No table-swap dance required.

---

## Skills to Invoke
- **bookworm-db-migration** — after steps 1–3, verify both migrations run idempotently on a
  fresh DB **and** on an existing DB that already has `trip_days` rows with `plan_id IS NULL`
- **bookworm-template-audit** — after steps 4–6, to catch `let`/`const`, missing `?v=`,
  broken `hx-target` IDs
- **bookworm-qa** — after all steps: walk Plan tab → plan cards → Add Trip → open plan →
  day lanes → Add Day → add spot to day → back → confirm day_count badge updates
- **bookworm-pre-commit** — before committing
- **bookworm-docs-keeper** — after merge, to add `trip_plans` table + `trip_days.plan_id`
  to the schema section of `CODEPUPPY_NOTES.md`

---

## BookWorm Gotchas That Apply to This Feature

**`var` only in JS — `home-page-trip-plan.js` is HTMX-reinjected**
Every new state variable and loop variable must use `var`. The file is already all-`var`;
do not introduce `let` or `const` anywhere.

**Expose shared state on `window` — mirrors locs.js pattern**
`_tripActivePlanId` and `_tripActivePlanName` must be mirrored to `window._tripActivePlanId`
and `window._tripActivePlanName` so `home-page-trip.js` can read them in
`_tripRenderTopbarControls()`. The Research tab does exactly this for `window._tripActiveLocId`.

**No `window.confirm()` or `window.alert()` for plan delete**
Plan delete must reuse the existing shared `#trip-del-modal` — set `#trip-del-msg` text and
wire `#trip-del-confirm` onclick before un-hiding the modal, identical to `tripConfirmDeleteDay`.

**`get_db()` only in all new DB helpers**
`routers/home_trip_db.py` already imports and uses `get_db`. Every new plan helper must follow
the same `async with get_db() as db:` pattern. Never call `aiosqlite.connect()` directly.

**Sort_order sub-query in `add_trip_day` must be scoped by `plan_id`**
The current INSERT uses `COALESCE(MAX(sort_order),0)+10 FROM trip_days WHERE page_id=?`.
After adding `plan_id`, extend to `WHERE page_id=? AND plan_id IS ?` so sort_order is
per-plan, not global across all plans on the page. (Use SQL `IS` not `=` so that the NULL
case for legacy days also works correctly if ever called without a plan.)

**`?v={{ static_v }}` cache-busting**
Confirm `home-page-trip-plan.js` already has `?v={{ static_v }}` on its `<script src>` in
`base.html`. If missing, add it. No new `<script>` tags are needed — the file already exists.

**Tailwind CSS rebuild**
Plan card grid reuses classes from the loc card grid (`grid-cols-1 sm:grid-cols-2
md:grid-cols-3 lg:grid-cols-4 gap-4 content-start`) — these are almost certainly already in
the built CSS. However, run `rebuild_css.bat` and commit the updated `static/css/tailwind.css`
if any new utility classes appear that are not already used elsewhere.

---

## Implementation Checklist

### Phase 1 — DB schema (database.py)
- [ ] 1a. Inside `init_db()`, after the `location_id` PRAGMA migration block (line ~937),
      add the `CREATE TABLE IF NOT EXISTS trip_plans` statement and its index.
- [ ] 1b. Immediately after, add the `PRAGMA table_info(trip_days)` guard and `ALTER TABLE`
      for the `plan_id` column.
- [ ] 1c. Confirm both additions land before the `await db.commit()` that closes the trip block.

### Phase 2 — DB helpers (routers/home_trip_db.py)

- [ ] 2a. Add `get_trip_plans(page_id: int, user_id: int) -> list[dict]`:
  ```python
  async def get_trip_plans(page_id: int, user_id: int) -> list[dict]:
      async with get_db() as db:
          cur = await db.execute(
              """
              SELECT p.id, p.plan_name, p.plan_desc, p.start_date, p.end_date,
                     p.sort_order, p.created_at,
                     (SELECT COUNT(*) FROM trip_days d
                       WHERE d.plan_id = p.id) AS day_count
                FROM trip_plans p
               WHERE p.page_id=? AND p.user_id=?
               ORDER BY p.sort_order, p.id
              """,
              (page_id, user_id),
          )
          rows = await cur.fetchall()
      return [dict(r) for r in rows]
  ```

- [ ] 2b. Add `add_trip_plan(page_id, user_id, plan_name, plan_desc, start_date, end_date) -> int`:
  - INSERT with sort_order sub-query: `COALESCE(MAX(sort_order),0)+10 FROM trip_plans WHERE page_id=?`
  - `await db.commit()`, return `cur.lastrowid`.

- [ ] 2c. Add `update_trip_plan(plan_id, page_id, user_id, plan_name, plan_desc, start_date, end_date) -> bool`:
  - `UPDATE trip_plans SET plan_name=?, plan_desc=?, start_date=?, end_date=? WHERE id=? AND page_id=? AND user_id=?`
  - Return `cur.rowcount == 1`.

- [ ] 2d. Add `delete_trip_plan(plan_id, page_id, user_id) -> bool`:
  - `DELETE FROM trip_plans WHERE id=? AND page_id=? AND user_id=?`
  - Return `cur.rowcount == 1`.
  - Days cascade-delete via `ON DELETE CASCADE` on `trip_days.plan_id`; that in turn
    cascade-deletes `trip_day_spots`. Spots themselves are untouched.

- [ ] 2e. Update `get_trip_days` signature to `(page_id: int, user_id: int, plan_id: int | None = None)`:
  - When `plan_id` is not None, add `AND td.plan_id=?` to the WHERE clause and append
    `plan_id` to the params tuple.
  - When `plan_id` is None, the query is unchanged (returns all days — only used if caller
    explicitly wants unscoped days; normal UI path always passes a plan_id).

- [ ] 2f. Update `add_trip_day` signature to `(page_id, user_id, day_label, day_date, plan_id=None)`:
  - Add `plan_id` to the INSERT column list and VALUES.
  - Sort_order sub-query: `WHERE page_id=? AND plan_id IS ?` (bind `page_id, plan_id`).

### Phase 3 — API routes (routers/home_trip.py)

- [ ] 3a. Import the 4 new helpers:
  ```python
  from routers.home_trip_db import (
      ...existing imports...,
      get_trip_plans,
      add_trip_plan,
      update_trip_plan,
      delete_trip_plan,
  )
  ```

- [ ] 3b. Add `GET /trip/{page_id}/plans`:
  ```python
  @router.get("/trip/{page_id}/plans")
  async def list_plans(request: Request, page_id: int):
      try:
          uid = _uid(request)
      except PermissionError:
          return _err("not logged in", 401)
      if not await _get_trip_page(page_id, uid):
          return _err("not found", 404)
      return JSONResponse(await get_trip_plans(page_id, uid))
  ```

- [ ] 3c. Add `POST /trip/{page_id}/plans/add` — Form: `plan_name str`, `plan_desc str = ""`,
      `start_date str = ""`, `end_date str = ""`; return `{"id": new_id}` status 201.

- [ ] 3d. Add `PUT /trip/{page_id}/plans/{plan_id}` — same Form params; return `{"ok": bool}`.

- [ ] 3e. Add `DELETE /trip/{page_id}/plans/{plan_id}` — return `{"ok": bool}`.

- [ ] 3f. Update `list_days` — add `plan_id: int | None = Query(None)` param; pass to `get_trip_days`:
  ```python
  from fastapi import Query
  ...
  @router.get("/trip/{page_id}/days")
  async def list_days(request: Request, page_id: int, plan_id: int | None = Query(None)):
      ...
      return JSONResponse(await get_trip_days(page_id, uid, plan_id))
  ```

- [ ] 3g. Update `add_day` — add `plan_id: int | None = Form(None)` and pass to `add_trip_day`.

### Phase 4 — Template (templates/partials/home_page_trip.html)

- [ ] 4a. Lines 82–91 (the `#trip-panel-plan` inner content): replace the current single-level
      `#trip-plan-toolbar` + `#trip-days-container` with two sub-views:

  ```html
  {# Plans grid view — shown by default #}
  <div id="trip-plans-view" class="flex-1 overflow-y-auto p-4">
    <div id="trip-plans-grid"
         class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4
                gap-4 content-start">
    </div>
  </div>

  {# Days view — hidden until a plan is opened #}
  <div id="trip-days-view" class="hidden flex flex-col flex-1 overflow-hidden">
    <div id="trip-plan-toolbar"
         class="flex-shrink-0 flex items-center gap-2 px-4 py-2
                border-b border-gray-100 dark:border-zinc-800
                bg-gray-50 dark:bg-zinc-900">
    </div>
    <div id="trip-days-container"
         class="flex-1 overflow-x-auto overflow-y-hidden p-4 flex gap-4 items-start">
    </div>
  </div>
  ```
  **Critical:** `#trip-plan-toolbar` and `#trip-days-container` IDs are preserved unchanged
  so all existing day-lane JS continues to work without modification.

- [ ] 4b. Add `#trip-plan-modal` after the closing `</div>` of `#trip-day-modal` (before the
      `#trip-loc-modal`). Follow the standard BookWorm modal pattern from CODEPUPPY_NOTES.md.
      Required elements inside the modal body:
      - `<h2 id="trip-plan-modal-title">Add Trip</h2>` (JS toggles text)
      - `<input id="trip-plan-name" type="text" required placeholder="e.g. Main Itinerary">`
      - `<input id="trip-plan-desc" type="text" placeholder="Short description (optional)">`
      - `<input id="trip-plan-start" type="date">`
      - `<input id="trip-plan-end" type="date">`
      - Submit: `<button id="trip-plan-submit" onclick="tripSubmitPlan()">Save</button>`
      - Cancel: `<button onclick="tripClosePlanModal()">Cancel</button>`

### Phase 5 — Plan JS (static/js/home-page-trip-plan.js)

- [ ] 5a. Add new state variables at the top of the file (after existing vars):
  ```javascript
  var _tripPlans          = [];
  var _tripActivePlanId   = null;
  var _tripActivePlanName = '';
  window._tripActivePlanId   = null;
  window._tripActivePlanName = '';
  ```

- [ ] 5b. Rewrite `tripLoadPlan()` to branch on `_tripActivePlanId`:
  ```javascript
  window.tripLoadPlan = function() {
    if (_tripActivePlanId) {
      _tripLoadDaysForPlan(_tripActivePlanId);
      return;
    }
    _tripFetch('/home/trip/' + _tripPid + '/plans')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _tripPlans = Array.isArray(data) ? data : [];
        _tripRenderPlanCards();
      })
      .catch(function() { _tripShowToast('Failed to load plans', true); });
  };
  ```

- [ ] 5c. Add `_tripRenderPlanCards()` — writes HTML into `#trip-plans-grid`.
  - Empty state: `🗺️ No trip plans yet.<br><span class="text-xs">Click <strong>＋ Add Trip</strong> to start!</span>`
  - Each plan card (same outer classes as loc cards):
    - Click opens plan: `onclick="tripOpenPlan(p.id)"`
    - Gradient emoji header (🗺️), plan name, optional date range, day count badge
    - Edit button with `event.stopPropagation()` → `tripOpenEditPlan(p.id)`
    - Delete button with `event.stopPropagation()` → `tripConfirmDeletePlan(p.id, p.plan_name)`

- [ ] 5d. Add `tripOpenPlan(planId)`:
  - Find plan in `_tripPlans`, set `_tripActivePlanId`, `_tripActivePlanName`, mirror to `window`.
  - Hide `#trip-plans-view`, show `#trip-days-view`.
  - Call `_tripRenderTopbarControls()`.
  - Call `_tripLoadDaysForPlan(planId)`.

- [ ] 5e. Add `tripClosePlan()`:
  - Clear `_tripActivePlanId`, `_tripActivePlanName`, `window.*`, `_tripDays = []`.
  - Show `#trip-plans-view`, hide `#trip-days-view`.
  - Call `_tripRenderTopbarControls()`.
  - Call `tripLoadPlan()` (refreshes plan cards with updated `day_count`).

- [ ] 5f. Add `_tripLoadDaysForPlan(planId)` (module-private):
  ```javascript
  function _tripLoadDaysForPlan(planId) {
    _tripFetch('/home/trip/' + _tripPid + '/days?plan_id=' + planId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _tripDays = Array.isArray(data) ? data : [];
        _tripRenderPlan();
      })
      .catch(function() { _tripShowToast('Failed to load days', true); });
  }
  ```

- [ ] 5g. Update `tripOpenAddDay()` — guard at top:
  ```javascript
  if (!_tripActivePlanId) {
    _tripShowToast('Open a trip plan first', true);
    return;
  }
  ```

- [ ] 5h. Update `tripSubmitDay()` — for the add (POST) path, append `plan_id`:
  ```javascript
  if (!_tripDayEditing && _tripActivePlanId) {
    fd.append('plan_id', _tripActivePlanId);
  }
  ```

- [ ] 5i. Add plan CRUD functions (all `window.*` exports):
  - `tripOpenAddPlan()` — reset form fields, set `#trip-plan-modal-title` to `'Add Trip'`,
    set `#trip-plan-submit` text to `'Add Trip'`, show `#trip-plan-modal`, focus `#trip-plan-name`
  - `tripOpenEditPlan(planId)` — find in `_tripPlans`, populate form, title/button text = `'Edit Trip'`/`'Save'`, show modal
  - `tripClosePlanModal()` — hide `#trip-plan-modal`
  - `tripSubmitPlan()` — read form, POST or PUT, on success: `tripClosePlanModal()` + `tripLoadPlan()` + toast
  - `tripConfirmDeletePlan(planId, name)` — set `#trip-del-msg` to
    `'Delete "' + name + '"? All days in this plan will be deleted. Spots are not affected.'`;
    wire `#trip-del-confirm` onclick to `tripDeletePlan(planId)`; un-hide `#trip-del-modal`
  - `tripDeletePlan(planId)` — close del-modal, DELETE call, on success: `tripClosePlan()` + toast

### Phase 6 — Toolbar (static/js/home-page-trip.js)

- [ ] 6a. In `_tripRenderTopbarControls()` (the `else if (_tripTab === 'plan')` branch),
      replace the current single-button HTML with a two-branch conditional:

  ```javascript
  } else if (_tripTab === 'plan') {
    if (window._tripActivePlanId) {
      el.innerHTML =
        '<button onclick="tripClosePlan()" ' +
          'class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
                 'border border-gray-200 dark:border-zinc-700 text-gray-600 ' +
                 'dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">' +
          '← Back</button>' +
        '<span class="text-sm font-medium text-gray-700 dark:text-zinc-200 ' +
               'truncate max-w-[160px]">' +
          _tripEsc(window._tripActivePlanName || '') +
        '</span>' +
        '<button onclick="tripOpenAddDay()" ' +
          'class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
                 'bg-[#0053e2] hover:bg-[#0046c0] text-white font-medium transition">' +
          '＋ Add Day</button>';
    } else {
      el.innerHTML =
        '<button onclick="tripOpenAddPlan()" ' +
          'class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
                 'bg-[#0053e2] hover:bg-[#0046c0] text-white font-medium transition">' +
          '＋ Add Trip</button>';
    }
  ```

### Phase 7 — Verification & Cleanup

- [ ] 7a. Run `bookworm-db-migration` — confirm idempotent on fresh and existing DBs.
- [ ] 7b. Run `bookworm-template-audit` — check `home_page_trip.html`, `home-page-trip-plan.js`,
      `home-page-trip.js` for `let`/`const`, missing `?v=`, broken IDs.
- [ ] 7c. Check `<script src>` for `home-page-trip-plan.js` in `base.html` — add `?v={{ static_v }}`
      if missing.
- [ ] 7d. Run `rebuild_css.bat` if any new Tailwind classes were introduced; commit updated
      `static/css/tailwind.css`.
- [ ] 7e. Run `bookworm-qa` — full walkthrough of the Plan tab two-level nav.
- [ ] 7f. Run `bookworm-pre-commit`.
- [ ] 7g. Run `bookworm-docs-keeper` to sync `CODEPUPPY_NOTES.md` schema section.

---

## Open Questions

1. **Orphaned days** — existing `trip_days` rows with `plan_id IS NULL` are invisible in the
   new UI. If Trip homespace pages already have real user data with days, add a data-migration
   step in `init_db()` that: for each distinct `(page_id, user_id)` that has un-scoped days,
   creates a default `trip_plans` row named `"My Trip"` and sets `trip_days.plan_id` to its
   new id. If no production data exists yet, skip this and close the question.

2. **Day add-to-spot dropdown in Research tab** — `_tripRenderSpotCard()` in
   `home-page-trip.js` reads `_tripDays` to build a "Add to day" `<select>`. After this
   change, `_tripDays` is only populated when the user has opened a plan this session.
   Confirm: is an empty dropdown acceptable when no plan has been opened? If not, decide
   whether to (a) load all days across all plans eagerly at init, or (b) remove the inline
   dropdown from spot cards entirely (user must drag onto a day lane instead).

3. **Plan cover images** — `trip_plans` has no `cover_url` column. Cards use a gradient + 🗺️.
   If a cover image is wanted later, add `cover_url TEXT NOT NULL DEFAULT ''` to the
   CREATE TABLE in Migration 1 now (one extra column is trivial; retrofitting it via
   ALTER TABLE later is a separate migration with an upload endpoint change).

4. **`reorder_trip_days`** — the existing day reorder endpoint only uses `id + page_id +
   user_id`. It does not need `plan_id` because it updates `sort_order` by primary key;
   `plan_id` is irrelevant to the ordering. No change needed — confirm this is understood.

5. **Session restore (sessionStorage)** — the Research tab persists the active location ID
   to `sessionStorage` so a page refresh restores the drill-in state. Consider whether the
   Plan tab should do the same for `_tripActivePlanId` (store key `bw-trip-plan-{pid}`).
   This is a nice-to-have; not required for the initial implementation.
