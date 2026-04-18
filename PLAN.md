# Plan: Buds — Friendship Health Tracker Widget + CRM Integration
Date: 2026-04-18
Estimated complexity: High

---

## Summary

Add a **Buds widget** to BookWorm's dashboard home pages. Each instance of the
widget maintains a private list of "buds" (friends-as-flowers). Health decays
daily based on the configured contact interval; two care actions restore it:
💧 **Water** (once per calendar week, small boost) and 🌱 **Fertilize** (in-person
visit, planned ahead, larger boost). Flowers are rendered with one of 24 static
images (8 species × 3 health tiers). The widget lives on any dashboard page as a
standard drag-and-drop card; it is classified **Advanced** in the add-widget modal
and gets its own JS engine file (`home-widget-buds.js`).

CRM integration adds two complementary features: a **"Track as Bud"** button on
CRM contact gallery/table cards (Option A) that creates a linked bud entry in any
of the user's Buds widgets, and a **health badge** (Option B) on those same CRM
cards when a contact is already tracked. This gives a team-facing Rolodex and a
personal friendship-health view that stay loosely in sync without tight coupling.

---

## Files to Change (in dependency order)

| # | File | What changes |
|---|---|---|
| 1 | `database.py` | Add `buds` + `bud_fertilize_plans` tables + 3 indexes in `init_db()` |
| 2 | `routers/home_buds_db.py` | **NEW** — all DB helpers for buds |
| 3 | `routers/home_buds.py` | **NEW** — API router, prefix `/home/buds` |
| 4 | `main.py` | Import + register `home_buds_router` after `home_crm_router` |
| 5 | `static/img/buds/` | **NEW DIR** — 24 flower PNG files committed as static assets |
| 6 | `templates/partials/home_page.html` | Add `render_buds(w)` Jinja2 macro; include it in the widget-dispatch block |
| 7 | `templates/partials/home_add_widget_modal.html` | Add `('buds', '🌸', 'Buds')` to the ⚡ Advanced grid |
| 8 | `static/js/home-widget-buds.js` | **NEW** — full buds widget JS engine |
| 9 | `static/js/home-widgets.js` | Add `WIDGET_STYLES.buds` + `WIDGET_CONFIG_FIELDS.buds` entries |
| 10 | `static/js/home-widgets-render.js` | Add `initBudsWidgets()` call at the end of `initHomeWidgets()` |
| 11 | `templates/base.html` | Add `<script src="/static/js/home-widget-buds.js?v={{ static_v }}" defer></script>` after `home-widgets-render.js` |
| 12 | `static/js/home-page-crm.js` | Add "Track as Bud" button + health badge to gallery + table card renders |

---

## New Files to Create

| File | Purpose |
|---|---|
| `routers/home_buds_db.py` | All async DB helpers: list, add, update, delete, water, fertilize-plan, fertilize-complete, crm-lookup |
| `routers/home_buds.py` | FastAPI router prefix `/home/buds` — 8 endpoints (see API section) |
| `static/js/home-widget-buds.js` | Widget JS engine — boot, render, decay, care actions, add/edit/detail modals |
| `static/img/buds/*.png` | 24 flower images (8 species × 3 health tiers) committed to the repo |

---

## DB Migrations Needed

All migrations are **additive** and safe to run multiple times (idempotent). Add
them to `init_db()` in `database.py` at the bottom of the migration block, after
the existing CRM/RSS migrations.

### 1. `buds` table — additive, safe

```sql
CREATE TABLE IF NOT EXISTS buds (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    widget_id          INTEGER NOT NULL REFERENCES home_widgets(id) ON DELETE CASCADE,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name               TEXT    NOT NULL,
    flower_species     TEXT    NOT NULL DEFAULT 'daisy',
    see_every_days     INTEGER NOT NULL DEFAULT 7,
    health             REAL    NOT NULL DEFAULT 100.0,
    health_updated_at  DATE    NOT NULL DEFAULT (date('now')),
    last_watered_week  TEXT,
    crm_contact_id     INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
    notes              TEXT,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

**Column notes:**
- `widget_id` → CASCADE: bud is destroyed when the widget is deleted.
- `crm_contact_id` → SET NULL: bud survives if the CRM contact is deleted.
- `health_updated_at` is the anchor date for decay calculation. It is updated to
  `date('now')` every time a care action fires, NOT on every read.
- `last_watered_week` stores the ISO week key `'YYYY-Www'` (e.g. `'2026-W16'`).
  Compared to the current week key to gate the 💧 Water button.
- `flower_species` must be one of 8 values:
  `blue_flower | calla | daffodil | daisy | pink | purple | sunflower | tulip`

### 2. `bud_fertilize_plans` table — additive, safe

```sql
CREATE TABLE IF NOT EXISTS bud_fertilize_plans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    bud_id       INTEGER NOT NULL REFERENCES buds(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    planned_date DATE,
    note         TEXT,
    completed_at DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

**Column notes:**
- `completed_at IS NULL` = pending plan; `completed_at IS NOT NULL` = done.
- Only the most recent **pending** plan is shown in the UI.
  (Query: `WHERE bud_id=? AND completed_at IS NULL ORDER BY planned_date LIMIT 1`)

### 3. Indexes — additive, safe

```sql
CREATE INDEX IF NOT EXISTS idx_buds_widget
    ON buds(widget_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_buds_user
    ON buds(user_id);

CREATE INDEX IF NOT EXISTS idx_buds_crm
    ON buds(crm_contact_id);
```

`idx_buds_crm` is the key index for the CRM integration reverse-lookup
(given a contact_id, find its linked bud row quickly).

---

## Flower Image Strategy

**Do NOT use the existing `page_uploads` UUIDs for flower images.**

The `page_uploads` entry (page_id=74, user_id=1) uses opaque UUID filenames
served at `/uploads/{uuid}.png`. These UUIDs are install-specific, user-specific,
and are not queryable by species name without a runtime DB lookup.

**Correct approach: commit all 24 images to `static/img/buds/` with predictable
filenames.** The image URL pattern becomes:

```
/static/img/buds/{species}_{tier}.png
```

Examples:
```
/static/img/buds/sunflower_0.png   ← healthy (≥70)
/static/img/buds/sunflower_1.png   ← warn (50–69)
/static/img/buds/sunflower_2.png   ← wilting (<50)
/static/img/buds/daisy_0.png
...
```

This keeps the widget self-contained, works across all users and installs, and
avoids a `page_uploads` DB lookup on every widget render. Copy the 24 images
from the `page_uploads` folder (identified by page_id=74) using a one-time script
during development.

---

## API Endpoints (`routers/home_buds.py`, prefix `/home/buds`)

All routes require a valid session. Widget ownership is validated by joining
`home_widgets → home_pages` and checking `home_pages.user_id == session.user_id`.

| Method | Path | Returns | Purpose |
|---|---|---|---|
| `GET`  | `/{widget_id}/list` | JSON `{buds: [...]}` | List buds with live-decayed health |
| `POST` | `/{widget_id}/add` | JSON updated list | Add a new bud |
| `POST` | `/{widget_id}/{bud_id}/update` | JSON updated list | Edit bud settings |
| `DELETE`| `/{widget_id}/{bud_id}` | JSON `{ok: true}` | Delete a bud |
| `POST` | `/{widget_id}/{bud_id}/water` | JSON `{bud: {...}}` | Water action (week-gated) |
| `POST` | `/{widget_id}/{bud_id}/fertilize-plan` | JSON `{plan: {...}}` | Create fertilize plan |
| `POST` | `/{widget_id}/{bud_id}/fertilize-complete/{plan_id}` | JSON `{bud: {...}}` | Mark plan done |
| `GET`  | `/crm-lookup/{crm_page_id}` | JSON `{contact_id: bud_row}` | CRM badge reverse-lookup |

### Auth pattern (copy from `routers/home_crm.py::_get_crm_page`)

```python
async def _get_widget_owned(widget_id: int, user_id: int) -> dict | None:
    """Return widget dict if it belongs to user_id, else None."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT hw.* FROM home_widgets hw "
            "JOIN home_pages hp ON hp.id = hw.page_id "
            "WHERE hw.id=? AND hp.user_id=?",
            (widget_id, user_id),
        )
        row = await cur.fetchone()
    return dict(row) if row else None
```

---

## Health Decay Logic (canonical)

Implemented in `routers/home_buds_db.py`. Applied on **every read** (not written
back to DB on GET — only written on care actions).

```python
import datetime

_LOSS_PER_MISSED_INTERVAL = 25.0  # HP lost for missing one full interval

def _apply_decay(health: float, see_every_days: int, health_updated_at: str) -> float:
    """Return current health after applying daily decay since health_updated_at."""
    try:
        anchor = datetime.date.fromisoformat(health_updated_at)
    except (ValueError, TypeError):
        return health
    days_elapsed = (datetime.date.today() - anchor).days
    if days_elapsed <= 0:
        return health
    loss_per_day = _LOSS_PER_MISSED_INTERVAL / max(see_every_days, 1)
    decayed = health - (loss_per_day * days_elapsed)
    return round(max(0.0, min(100.0, decayed)), 2)
```

The client-side JS mirrors this formula for optimistic rendering.

### Care action health boosts (server-side, written to DB)

| Action | HP gained | Conditions | DB writes |
|---|---|---|---|
| 💧 Water | +10 HP | Once per Mon-start week (`last_watered_week != current_week_key`) | `health`, `health_updated_at`, `last_watered_week` |
| 🌱 Fertilize complete | +25 HP | `completed_at IS NULL` on the plan | `health`, `health_updated_at` on `buds`; `completed_at = NOW()` on `bud_fertilize_plans` |

Health is capped at 100.0 after boost. The `health_updated_at` anchor is reset to
`date('now')` on every care action so decay restarts from 0 for the next interval.

### ISO Week Key

```python
def _week_key(d: datetime.date | None = None) -> str:
    """Return 'YYYY-Www' for Monday-anchored ISO week."""
    d = d or datetime.date.today()
    iso = d.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"
```

---

## Widget Template Macro (`home_page.html`)

Add a new `render_buds(w)` macro. It renders the card shell and a data-bearing
root element that the JS engine picks up and hydrates:

```jinja2
{% macro render_buds(w) %}
{%- set cfg = w.config -%}
{% call card(w) %}
  {{ widget_header(w, cfg.get('custom_name') or 'Buds', '🌸') }}
  <div class="bw-buds-widget flex-1 min-h-0 overflow-y-auto"
       data-widget-id="{{ w.id }}"
       data-style="{{ w.style }}"
       data-config='{{ cfg | tojson | e }}'>
    <span class="text-xs text-gray-400 animate-pulse">Loading buds…</span>
  </div>
{% endcall %}
{% endmacro %}
```

Then add to the widget-dispatch block (the `{% if w.widget_type == ... %}` chain
already in `home_page.html`):

```jinja2
{%- elif w.widget_type == 'buds' -%}
  {{ render_buds(w) }}
```

---

## JS Architecture (`static/js/home-widget-buds.js`)

**All module-top-level state uses `var` — never `let`/`const` at module scope.**
(Quirk #13: `initHomeWidgets()` may be called multiple times via `_initSwappedPage()`.)

### Module state

```javascript
var _budsState = {};  // {widgetId: {buds: [], busy: false, pendingPlans: {}}}
```

### Key functions (all `function` declarations — hoisted, safe for re-calls)

| Function | Purpose |
|---|---|
| `initBudsWidgets()` | Called by `initHomeWidgets()`. Finds all `.bw-buds-widget` and calls `_budsInit(wid)` for each. |
| `_budsInit(wid)` | Fetch `GET /home/buds/{wid}/list` → store in `_budsState` → call `_budsRender`. |
| `_budsRender(wid)` | Build flower-card HTML for all buds in state, inject into the widget root. |
| `_budsFlowerImg(species, tier)` | Return `/static/img/buds/{species}_{tier}.png`. |
| `_budsHealthTier(health)` | `health >= 70 → 0`, `50 ≤ h < 70 → 1`, `h < 50 → 2` |
| `_budsWeekKey()` | Return `'YYYY-Www'` for current Mon-anchored week. |
| `_budsWater(wid, budId)` | POST `/home/buds/{wid}/{budId}/water`, re-render. Disables button if already watered this week. |
| `_budsFertilizeOpen(wid, budId)` | Open the fertilize modal (plan a date + note). |
| `_budsFertilizeSubmit(wid, budId)` | POST plan, close modal, re-render. |
| `_budsFertilizeComplete(wid, budId, planId)` | POST complete, re-render. |
| `_budsDetailOpen(wid, budId)` | Open the detail slide-panel (full info + history). |
| `_budsAddOpen(wid)` | Open add-bud modal. |
| `_budsAddSubmit(wid)` | POST add, re-render, close modal. |
| `_budsEditOpen(wid, budId)` | Open edit-bud modal pre-populated with current values. |
| `_budsEditSubmit(wid, budId)` | POST update, re-render, close modal. |
| `_budsDelete(wid, budId)` | Standard confirm modal pattern → DELETE, re-render. |
| `_budsApplyDecay(bud)` | Client-side decay calc (mirrors server formula) for optimistic render. |

### Modals in `home-widget-buds.js`

Three modals, all injected once into `document.body` on first `initBudsWidgets()`:
- `#buds-add-modal` — Add/Edit bud (name, species picker with flower images, interval slider)
- `#buds-fertilize-modal` — Plan fertilize (date input, note textarea, mark-complete button if plan exists)
- `#buds-detail-panel` — Slide-in detail (full health bar, last actions, edit/delete buttons)

All modals follow the **standard BookWorm modal pattern** from CODEPUPPY_NOTES.md
(fixed inset, backdrop blur, Escape key close, ARIA roles).

### Add-widget modal step-2 config fields (in `home-widgets.js`)

```javascript
WIDGET_STYLES['buds'] = [
  ['default', '🌸 Full'],
  ['compact', '🌿 Compact'],
];

WIDGET_CONFIG_FIELDS['buds'] = (s) => [
  { id: 'cf-buds-title', label: 'Widget title', type: 'text',
    placeholder: 'My Buds', name: 'custom_name' },
  { id: 'cf-buds-crm', label: 'Sync friends from CRM page (optional)',
    type: 'select-crm-pages', name: 'linked_crm_page_id' },
];
```

> **Note:** `'select-crm-pages'` is a new custom field type that must be added to
> `aw_refreshConfig()` in `home-widgets.js`. It fetches the user's CRM pages via
> `GET /home/pages` (already returns all pages with `page_type`) and renders a
> `<select>` of CRM page options (none selected = manual-only bud list).

---

## CRM Integration

### Chosen options: A + B (with D as opt-in via widget config)

**Why not C (full care interface in CRM detail panel)?** It would require injecting
Buds widget state and modals into the CRM JS module, creating a hard coupling
between two independent features. YAGNI — the widget itself is the primary UX;
CRM is a secondary view.

**Why not D as the only source?** Not every user has a CRM page. Manual bud entry
must always work. D is implemented as an *optional* widget config field
(`linked_crm_page_id`) that surfaces "Import from CRM" as an action inside the
widget.

### Option A — "Track as Bud" button on CRM contact cards

In `home-page-crm.js`, inside the gallery card and table row render functions,
add a small 🌸 button after existing action buttons:

```html
<button onclick="_crmTrackAsBud(${c.id})" title="Track as Bud"
        class="p-1 rounded text-pink-400 hover:text-pink-600 hover:bg-pink-50
               dark:hover:bg-pink-900/20 transition text-sm">🌸</button>
```

`_crmTrackAsBud(contactId)` function:
1. Fetches `GET /home/pages` to find user's Buds widgets (filter `widget_type == 'buds'`).
   If none found → `_bwToast('Add a Buds widget to your dashboard first.', 'info')`.
2. Opens `#crm-track-bud-modal` — lets user pick which Buds widget + override
   flower species + interval. Pre-fills name from contact name.
3. On submit → `POST /home/buds/{widgetId}/add` with `crm_contact_id` set.
4. Invalidates the buds widget cache (`invalidateHomePageCache`) so next visit
   reflects the new bud.

New modal to add to `home_page_crm.html` (or inject via JS):
- `#crm-track-bud-modal` — standard BookWorm modal (neutral/info colour scheme)

### Option B — Health badge on CRM contact cards

When rendering CRM gallery cards and table rows, check if that contact has a
linked bud. Source of truth: `window._crmBudHealthMap` — a `{contact_id: {health, species, tier}}` 
map populated at CRM page init time via `GET /home/buds/crm-lookup/{crm_page_id}`.

In `initCrmPage(pid)` (inside `home-page-crm.js`), add after contacts are fetched:

```javascript
fetch('/home/buds/crm-lookup/' + pid, {credentials: 'same-origin'})
  .then(r => r.ok ? r.json() : {})
  .then(map => { window._crmBudHealthMap = map || {}; _crmRender(); })
  .catch(() => { window._crmBudHealthMap = {}; });
```

Gallery card render inserts after the avatar:

```javascript
var bud = (window._crmBudHealthMap || {})[c.id];
var budBadge = bud
  ? '<div class="absolute top-1 right-1 flex items-center gap-1">'
    + '<img src="/static/img/buds/' + bud.species + '_' + bud.tier + '.png"'
    + ' class="w-5 h-5 object-contain" title="Health: ' + bud.health + '">'
    + '<div class="w-10 h-1 bg-gray-200 rounded-full overflow-hidden">'
    + '<div class="h-full rounded-full" style="width:' + bud.health + '%;'
    + 'background:' + (bud.tier===0?'#2a8703':bud.tier===1?'#ffc220':'#ea1100') + '"></div>'
    + '</div></div>'
  : '';
```

The `/crm-lookup/{crm_page_id}` endpoint returns a map:
`{contact_id: {health, species, tier, widget_id, bud_id}}`.

It queries `SELECT b.* FROM buds b WHERE b.crm_contact_id IN (SELECT id FROM crm_contacts WHERE page_id=? AND user_id=?) AND b.user_id=?`. Uses `idx_buds_crm` index.

---

## Skills to Invoke

| Skill / Agent | When |
|---|---|
| `bookworm-db-migration` | After updating `database.py` — dry-run the new tables + indexes against live `bookworm.db` |
| `bookworm-widget-scaffolder` | After writing the macro + JS engine — validates all 9 required touch-points are complete |
| `bookworm-template-audit` | After editing `home_page.html`, `home_add_widget_modal.html`, `base.html`, `home_page_crm.html` |
| `bookworm-qa` | After each major milestone (DB done, widget rendering, CRM integration) |
| `bookworm-pre-commit` | Before final commit |
| `bookworm-docs-keeper` | After commit — update CODEPUPPY_NOTES.md schema + widget table |

---

## BookWorm Gotchas That Apply to This Feature

**Quirk #13 — `var` not `let`/`const` in module-scope of `home-widget-buds.js`.**
`initHomeWidgets()` is called on every `_initSwappedPage()`. Any module-scope
`let _budsState = {}` will throw `SyntaxError: already declared` on the second
dashboard navigation. Use `var _budsState = _budsState || {}` or plain `var`.

**Quirk #16 — `| tojson | safe` in `<script>` blocks, `| tojson | e` in `data-*`.**
The buds widget macro uses `data-config='{{ cfg | tojson | e }}'` for the data
attribute (HTML-escaped). If any `<script type="application/json">` block is added,
it MUST use `| safe`.

**Quirk #10 — 5-min `_hpCache` cache.**
After any bud-modifying action (add, water, fertilize, delete) call
`invalidateHomePageCache(pid)` with the current page id so the cache is busted.
Get `pid` from `sessionStorage.getItem('bw-hp')`.

**Quirk #18 — Unguarded `/uploads/` static mount.**
This is why flower images must live in `static/img/buds/` — the `page_uploads`
UUID approach would couple the widget to a specific install's DB rows. Static
assets in `static/` are intentionally public; flower images are non-sensitive.

**Widget scaffolder checklist — 9 required touch-points.**
Every new widget type must: (1) DB table (if needed), (2) API router, (3) Jinja2
macro in `home_page.html`, (4) entry in `home_add_widget_modal.html`,
(5) `WIDGET_STYLES` entry in `home-widgets.js`, (6) `WIDGET_CONFIG_FIELDS` entry
in `home-widgets.js`, (7) JS engine call in `initHomeWidgets()`, (8) new JS file
in `static/js/`, (9) `<script>` tag in `base.html` with `?v={{ static_v }}`.

**CRM card re-render after "Track as Bud".**
`home-page-crm.js` re-renders via `_crmRender()`. After POST `/home/buds/{wid}/add`
completes, call `_crmBudHealthMap[contactId] = {health: 100, species, tier: 0, ...}`
optimistically before calling `_crmRender()` — avoids a second HTTP round-trip to
refresh the badge.

**`select-crm-pages` custom field type in `aw_refreshConfig`.**
This is a new field type in the add-widget modal config builder. It needs a new
`if (f.type === 'select-crm-pages')` branch inside `aw_refreshConfig()` in
`home-widgets.js`. It must fetch `GET /home/pages` (JSON) and filter by
`page_type === 'crm'`. All-`var` inside the async handler; no `let`/`const`.

---

## Implementation Checklist

### Phase 1 — DB + Backend

- [ ] 1.1 Add `buds` table SQL to `CREATE_TABLES_SQL` list in `database.py`
- [ ] 1.2 Add `bud_fertilize_plans` table SQL in same list
- [ ] 1.3 Add 3 indexes (`idx_buds_widget`, `idx_buds_user`, `idx_buds_crm`) in `init_db()` after table creation
- [ ] 1.4 Run `bookworm-db-migration` skill to dry-run and apply to live `bookworm.db`
- [ ] 1.5 Create `routers/home_buds_db.py` with: `_apply_decay()`, `_week_key()`, `list_buds()`, `add_bud()`, `update_bud()`, `delete_bud()`, `water_bud()`, `create_fertilize_plan()`, `complete_fertilize_plan()`, `crm_lookup()`
- [ ] 1.6 Create `routers/home_buds.py` with all 8 endpoints; validate widget ownership via `_get_widget_owned()` helper
- [ ] 1.7 Register `home_buds_router` in `main.py` (import + `app.include_router`)
- [ ] 1.8 Run `_health_check.py` — confirm server starts, no import errors

### Phase 2 — Flower Images

- [ ] 2.1 Identify the 24 flower UUIDs in `page_uploads` (page_id=74, user_id=1) via direct DB query
- [ ] 2.2 Create `static/img/buds/` directory
- [ ] 2.3 Copy all 24 images from `uploads/` to `static/img/buds/{species}_{tier}.png`
- [ ] 2.4 Verify all 24 filenames exist: `blue_flower_0.png` through `tulip_2.png`
- [ ] 2.5 Confirm images are served at `http://localhost:8000/static/img/buds/daisy_0.png`

### Phase 3 — Widget Template + Modal

- [ ] 3.1 Add `render_buds(w)` macro to `templates/partials/home_page.html`
- [ ] 3.2 Add `buds` branch to the widget-dispatch `{% if/elif %}` chain in `home_page.html`
- [ ] 3.3 Add `('buds', '🌸', 'Buds')` entry to the ⚡ Advanced grid in `home_add_widget_modal.html`
- [ ] 3.4 Add `WIDGET_STYLES['buds']` to `home-widgets.js`
- [ ] 3.5 Add `WIDGET_CONFIG_FIELDS['buds']` to `home-widgets.js` (with `select-crm-pages` field)
- [ ] 3.6 Add `select-crm-pages` branch to `aw_refreshConfig()` in `home-widgets.js`

### Phase 4 — JS Engine

- [ ] 4.1 Create `static/js/home-widget-buds.js` (all `var`, no `let`/`const` at module scope)
- [ ] 4.2 Implement `initBudsWidgets()` — DOM scan + per-widget boot
- [ ] 4.3 Implement `_budsRender()` — flower card HTML with health bar, action buttons, tier images
- [ ] 4.4 Implement `_budsWater()` — POST + optimistic render + week-gate UI
- [ ] 4.5 Implement fertilize plan flow — open modal, submit plan, mark complete
- [ ] 4.6 Implement add/edit bud modals — species picker shows flower images, interval field
- [ ] 4.7 Implement detail panel — slide-in, shows full info + pending fertilize plan
- [ ] 4.8 Implement delete — standard BookWorm confirm modal pattern
- [ ] 4.9 Call `initBudsWidgets()` from `initHomeWidgets()` in `home-widgets-render.js`
- [ ] 4.10 Add `<script src="/static/js/home-widget-buds.js?v={{ static_v }}" defer></script>` to `base.html` after `home-widgets-render.js`
- [ ] 4.11 Run `bookworm-widget-scaffolder` to validate all 9 touch-points
- [ ] 4.12 Run `bookworm-template-audit` on changed templates + JS
- [ ] 4.13 Manually test: add buds widget → add 3 friends → water one → check health bars

### Phase 5 — CRM Integration

- [ ] 5.1 Add `_crmBudHealthMap` initialization (fetch + assign) inside `initCrmPage(pid)` in `home-page-crm.js`
- [ ] 5.2 Update gallery card render to inject `budBadge` HTML when `_crmBudHealthMap[c.id]` exists
- [ ] 5.3 Update table row render similarly
- [ ] 5.4 Add `_crmTrackAsBud(contactId)` function to `home-page-crm.js`
- [ ] 5.5 Inject `#crm-track-bud-modal` into DOM on first `initCrmPage()` call (or add to `home_page_crm.html`)
- [ ] 5.6 Wire the 🌸 button into gallery and table card renders
- [ ] 5.7 Run `bookworm-template-audit` on `home-page-crm.js`
- [ ] 5.8 Test: create a CRM contact → click 🌸 Track → pick widget → verify badge appears

### Phase 6 — QA + Commit

- [ ] 6.1 Run `bookworm-qa` — pass: new widget endpoints, care actions, CRM badge
- [ ] 6.2 Run `bookworm-pre-commit` — verify no hardcoded paths, `get_db()` used throughout, no raw `aiosqlite.connect()`
- [ ] 6.3 Run `bookworm-docs-keeper` — update CODEPUPPY_NOTES.md schema + widget table + `_initSwappedPage` note
- [ ] 6.4 Commit with message: `feat: Buds friendship-health-tracker widget + CRM integration`

---

## Open Questions

**OQ-1 — Flower image source confirmation.**
Plan assumes copying the 24 images to `static/img/buds/`. If the originals in
`page_uploads` (page_id=74) are at different paths or filenames, the copy step
(Phase 2) needs to query the DB first to find the actual file UUIDs. Confirm
whether the 8 species filenames in `page_uploads.original_name` match the pattern
`{species}_{tier}.png` exactly.

**OQ-2 — Widget-scoped vs user-scoped bud list.**
Plan scopes buds to `widget_id`. This means: two Buds widgets on different
dashboard pages have **separate friend lists**. Alternative: one global friend
list per user, multiple widgets are just different views. Widget-scoped matches
every other data widget in BookWorm (todo, reminder). Confirm before writing DB
schema — changing this later requires a table rebuild.

**OQ-3 — Water boost amount.**
Original Buds app does not specify exact HP values. Plan proposes: 💧 Water = +10 HP,
🌱 Fertilize complete = +25 HP, both capped at 100. Confirm or override before
implementing `water_bud()` and `complete_fertilize_plan()`.

**OQ-4 — "Track as Bud" widget picker UX.**
When the user clicks 🌸 on a CRM contact, if they have multiple Buds widgets the
modal shows a dropdown picker. If they have exactly one, should it skip the picker
and go straight to the species/interval form? Confirm.

**OQ-5 — Demo mode guard.**
`buds` is per-user-scoped (via `widget_id → home_pages.user_id`). No global table
is involved. Confirm that `_demo_guard()` is NOT needed for any buds write route.
(Demo users do have home pages and can add widgets, so their buds data is isolated
to the demo user account anyway.)

**OQ-6 — `select-crm-pages` field type in settings modal.**
The `WIDGET_CONFIG_FIELDS.buds` config includes a `select-crm-pages` picker so
users can optionally link a CRM page as a contact source. The settings modal
handler (`home-widgets-settings.js`) calls `_buildFieldsForType()` which reads
from `WIDGET_CONFIG_FIELDS`. A new `select-crm-pages` branch needs to be added
there too (not just in `aw_refreshConfig`). Confirm this is in scope or defer
to a follow-up.
