# Plan: Widget Stack (Carousel)
Date: 2026-04-21
Estimated complexity: High

## Summary
Allow any non-Divider widget on a dashboard home page to be grouped into a **Stack** — a single grid card holding 2+ child widgets, navigable left/right via swipe (touch) and pagination dots/arrow buttons (mouse). A **Stack Mode toggle** is added inside the existing `pg-layout-modal`. While stack mode is active, dropping a widget card on top of another card creates (or extends) a stack; dropping in a grid gap behaves as normal reorder. Stack mode is persisted per-page in `home_pages.config_json` as `"stack_mode": true`. Each stack widget's active slide index is persisted to its own `config_json` via the existing `/home/widgets/{id}/update-config` endpoint. Divider widgets and nested stacks are explicitly rejected at the endpoint level.

---

## Files to Change
Touch in this exact order to satisfy dependencies (DB → query layer → routes → templates → JS).

| # | File | What changes |
|---|---|---|
| 1 | `database.py` | Add `group_id` column migration to `home_widgets` in `init_db()` |
| 2 | `routers/home_db.py` | Update `get_widgets()` to nest children; add 3 new stack DB helpers |
| 3 | `routers/home.py` | Import new helpers; add `_render_widget_html()` private helper; add 3 new stack POST endpoints |
| 4 | `templates/partials/home_page.html` | Add `render_stack_child(w)` macro; add `render_stack(w)` macro; add `data-stack-mode` attr to grid div; add `stack` branch to widget loop |
| 5 | `templates/index.html` | Add Stack Mode toggle row to `pg-layout-modal` (below col-picker, above Done button) |
| 6 | `templates/base.html` | Add `<script src="/static/js/home-widget-stack.js?v={{ static_v }}" defer></script>` after `home-widgets-settings.js` line |
| 7 | `static/js/home-widget-stack.js` | **New file** — carousel engine (touch swipe, arrows, dots, `active_index` persist, unstack DOM reconcile) |
| 8 | `static/js/home-widgets.js` | Stack-mode drag-drop: detect drop-on-card vs drop-in-gap; `_stackDropOnCard()`; `_stackApplyResponse()` |
| 9 | `static/js/home-widgets-settings.js` | `openPageLayout()` reads + renders stack toggle state; new `toggleStackMode()` handler |

---

## New Files to Create

| File | Purpose |
|---|---|
| `static/js/home-widget-stack.js` | Carousel engine — boots all stack cards on page load/nav, handles swipe/arrows/dots, persists `active_index`, exposes `unstackWidget()` |

---

## DB Migrations Needed

### Migration 1 — `group_id` column on `home_widgets` (additive, safe)

Add inside `init_db()` in `database.py`, using the standard `try/except` idempotency pattern.  
Place it **after** the existing `rss_page_feeds` migration block.

```python
# home_widgets — stack grouping (self-referential FK; ON DELETE SET NULL frees children automatically)
try:
    await db.execute(
        "ALTER TABLE home_widgets ADD COLUMN group_id INTEGER "
        "REFERENCES home_widgets(id) ON DELETE SET NULL"
    )
    await db.commit()
except Exception:
    pass  # column already exists — safe to ignore
```

**Why this is safe:**
- `ALTER TABLE … ADD COLUMN` with a DEFAULT-NULL value is always additive — no data is touched.
- Wrapping in `try/except` makes it idempotent (runs safely 10× on a live DB).
- SQLite respects `ON DELETE SET NULL` because `get_db()` sets `PRAGMA foreign_keys = ON` on every connection.
- No index needed now; queries filter `group_id` on small per-page widget sets. Revisit if per-page widget counts exceed ~200.

---

## Detailed Implementation Steps

### Step 1 — `database.py`
Add the migration block above to `init_db()`.

---

### Step 2 — `routers/home_db.py`

#### 2a — Update `get_widgets(page_id)` — nest children

Current implementation returns a flat list. New implementation fetches all rows once, partitions in Python (no extra SQL round-trips), and returns only top-level items with a `children` list attached.

```python
async def get_widgets(page_id: int) -> list[dict]:
    """Return top-level widgets for a page, with stack children nested under w['children']."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM home_widgets WHERE page_id=? ORDER BY sort_order, id",
            (page_id,),
        )
        rows = await cur.fetchall()

    all_widgets: list[dict] = []
    for r in rows:
        w = dict(r)
        try:
            w["config"] = json.loads(w["config_json"])
        except Exception:
            w["config"] = {}
        w.setdefault("children", [])
        all_widgets.append(w)

    # Nest children under their parent stack widget
    by_id = {w["id"]: w for w in all_widgets}
    top_level: list[dict] = []
    for w in all_widgets:
        gid = w.get("group_id")
        if gid and gid in by_id:
            by_id[gid]["children"].append(w)
        else:
            top_level.append(w)

    return top_level
```

#### 2b — New helper: `create_stack_widget(page_id, child_ids) -> int`

```python
async def create_stack_widget(page_id: int, child_ids: list[int]) -> int:
    """
    Create a new 'stack' widget row, then assign group_id on each child.
    Stack is inserted at the sort_order of the first child.
    Returns the new stack widget id.
    Caller must validate that child_ids are all stackable (not divider/stack, not already grouped).
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT sort_order FROM home_widgets WHERE id=? AND page_id=?",
            (child_ids[0], page_id),
        )
        row = await cur.fetchone()
        sort = row["sort_order"] if row else 0

        cur = await db.execute(
            "INSERT INTO home_widgets(page_id, widget_type, style, config_json, sort_order)"
            " VALUES(?, 'stack', '', ?, ?)",
            (page_id, json.dumps({"active_index": 0}), sort),
        )
        stack_id = cur.lastrowid

        for cid in child_ids:
            await db.execute(
                "UPDATE home_widgets SET group_id=? WHERE id=? AND page_id=?",
                (stack_id, cid, page_id),
            )
        await db.commit()
    return stack_id
```

#### 2c — New helper: `stack_add_child(stack_id, widget_id, page_id) -> bool`

```python
async def stack_add_child(stack_id: int, widget_id: int, page_id: int) -> bool:
    """
    Set group_id=stack_id on widget_id.
    Validates: both rows belong to page_id; widget is not a divider/stack; not already grouped.
    Returns False if any validation fails.
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT widget_type, group_id FROM home_widgets WHERE id=? AND page_id=?",
            (widget_id, page_id),
        )
        row = await cur.fetchone()
        if not row:
            return False
        if row["widget_type"] in ("divider", "stack"):
            return False
        if row["group_id"] is not None:
            return False  # already belongs to a stack

        cur = await db.execute(
            "SELECT id FROM home_widgets WHERE id=? AND page_id=? AND widget_type='stack'",
            (stack_id, page_id),
        )
        if not await cur.fetchone():
            return False

        await db.execute(
            "UPDATE home_widgets SET group_id=? WHERE id=?",
            (stack_id, widget_id),
        )
        await db.commit()
    return True
```

#### 2d — New helper: `unstack_widget(stack_id, page_id) -> list[int]`

```python
async def unstack_widget(stack_id: int, page_id: int) -> list[int]:
    """
    Clear group_id on all children, then delete the stack widget row.
    Returns list of freed child widget IDs (in sort_order order).
    The ON DELETE SET NULL FK would also free children, but we do it
    explicitly here to capture the IDs before deletion.
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id FROM home_widgets WHERE group_id=? AND page_id=? ORDER BY sort_order, id",
            (stack_id, page_id),
        )
        child_ids = [r["id"] for r in await cur.fetchall()]

        await db.execute(
            "UPDATE home_widgets SET group_id=NULL WHERE group_id=?",
            (stack_id,),
        )
        await db.execute(
            "DELETE FROM home_widgets WHERE id=? AND page_id=?",
            (stack_id, page_id),
        )
        await db.commit()
    return child_ids
```

---

### Step 3 — `routers/home.py`

#### 3a — Update imports

Add to the existing `from routers.home_db import (...)` block:
```python
create_stack_widget, stack_add_child, unstack_widget,
```

#### 3b — New private helper: `_render_widget_html(w)`

Place near the top of `home.py` (after `_ERR` constant). Dispatches a widget dict to its Jinja2 macro and returns the rendered HTML string.

```python
def _render_widget_html(w: dict) -> str:
    """Render one widget dict to HTML using home_page.html macros."""
    mod = templates.get_template("partials/home_page.html").module
    wt  = w.get("widget_type", "")
    dispatch = {
        "clock":          mod.render_clock,
        "weather":        mod.render_weather,
        "calendar":       mod.render_calendar,
        "todo":           mod.render_todo,
        "note_link":      mod.render_note_link,
        "timer":          mod.render_timer,
        "countdown":      mod.render_countdown,
        "event":          mod.render_event,
        "reminder":       mod.render_reminder,
        "title":          mod.render_title,
        "banner":         mod.render_banner,
        "text":           mod.render_text,
        "sticky":         mod.render_sticky,
        "quote":          mod.render_quote,
        "rss_feed":       mod.render_rss_feed,
        "buds":           mod.render_buds,
        "upload_preview": mod.render_upload_preview,
        "stack":          mod.render_stack,
    }
    fn = dispatch.get(wt)
    return str(fn(w)) if fn else ""
```

#### 3c — New endpoint: `POST /home/widgets/stack`

> ⚠️ **Declare this BEFORE `POST /home/widgets/{widget_id}/update-config`** in `home.py`. The literal path segment `stack` will otherwise be matched as a `widget_id` int and cause a 422. Add a comment marker.

```python
# ── Stack endpoints — MUST come before /{widget_id}/… routes ─────────────────

@router.post("/widgets/stack", response_class=JSONResponse)
async def create_stack(
    request:    Request,
    page_id:    int = Form(...),
    widget_ids: str = Form(...),   # comma-separated widget IDs e.g. "5,12"
):
    uid  = _uid(request)
    page = await get_home_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)

    try:
        ids = [int(x.strip()) for x in widget_ids.split(",") if x.strip()]
    except ValueError:
        return JSONResponse({"error": "invalid widget_ids"}, status_code=400)
    if len(ids) < 2:
        return JSONResponse({"error": "stack requires >= 2 widgets"}, status_code=400)

    for wid in ids:
        w = await get_widget_by_id(wid)
        if not w or w["page_id"] != page_id:
            return JSONResponse({"error": f"widget {wid} not found on page"}, status_code=400)
        if w["widget_type"] in ("divider", "stack"):
            return JSONResponse({"error": f"widget {wid} cannot be stacked"}, status_code=400)
        if w.get("group_id"):
            return JSONResponse({"error": f"widget {wid} is already in a stack"}, status_code=400)

    stack_id = await create_stack_widget(page_id, ids)
    widgets  = await get_widgets(page_id)
    stack_w  = next((w for w in widgets if w["id"] == stack_id), None)
    if not stack_w:
        return JSONResponse({"error": "stack creation failed"}, status_code=500)

    return JSONResponse({
        "stack_html":  _render_widget_html(stack_w),
        "removed_ids": [f"hw-card-{i}" for i in ids],
        "stack_id":    stack_id,
    })
```

**Return shape:**
```json
{
  "stack_html":  "<div id='hw-card-123' class='hw-card ...' ...>…</div>",
  "removed_ids": ["hw-card-5", "hw-card-12"],
  "stack_id":    123
}
```

#### 3d — New endpoint: `POST /home/widgets/{stack_id}/stack-add`

```python
@router.post("/widgets/{stack_id}/stack-add", response_class=JSONResponse)
async def stack_add(
    request:   Request,
    stack_id:  int,
    widget_id: int = Form(...),
    page_id:   int = Form(...),
):
    uid  = _uid(request)
    page = await get_home_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)

    ok = await stack_add_child(stack_id, widget_id, page_id)
    if not ok:
        return JSONResponse({"error": "cannot add widget to stack"}, status_code=400)

    widgets = await get_widgets(page_id)
    stack_w = next((w for w in widgets if w["id"] == stack_id), None)
    if not stack_w:
        return JSONResponse({"error": "stack not found after update"}, status_code=500)

    return JSONResponse({
        "stack_html":  _render_widget_html(stack_w),
        "removed_ids": [f"hw-card-{widget_id}"],
        "stack_id":    stack_id,
    })
```

#### 3e — New endpoint: `POST /home/widgets/{stack_id}/unstack`

```python
@router.post("/widgets/{stack_id}/unstack", response_class=JSONResponse)
async def unstack(
    request:  Request,
    stack_id: int,
    page_id:  int = Form(...),
):
    uid  = _uid(request)
    page = await get_home_page(page_id, uid)
    if not page:
        return JSONResponse({"error": "page not found"}, status_code=404)

    child_ids = await unstack_widget(stack_id, page_id)

    # Re-fetch top-level widgets to get the freshly-freed children
    widgets = await get_widgets(page_id)
    by_id   = {w["id"]: w for w in widgets}

    children_html = [
        _render_widget_html(by_id[cid])
        for cid in child_ids
        if cid in by_id
    ]

    return JSONResponse({
        "children_html": children_html,
        "stack_card_id": f"hw-card-{stack_id}",
        "child_ids":     child_ids,
    })
```

**Return shape:**
```json
{
  "children_html": ["<div id='hw-card-5' …>", "<div id='hw-card-12' …>"],
  "stack_card_id": "hw-card-123",
  "child_ids":     [5, 12]
}
```

---

### Step 4 — `templates/partials/home_page.html`

#### 4a — New macro: `render_stack_child(w)`

Add near the other widget macros (after `render_divider`, before `render_stack`). This renders only the child body inset inside the slide viewport — the outer `.hw-card` wrapper comes from the parent `render_stack`.

```jinja2
{% macro render_stack_child(w) %}
<div class="stack-child-frame w-full h-full overflow-y-auto"
     data-child-id="{{ w.id }}"
     data-widget-type="{{ w.widget_type }}">
  {% if w.widget_type == 'clock' %}          {{ render_clock(w) }}
  {% elif w.widget_type == 'weather' %}      {{ render_weather(w) }}
  {% elif w.widget_type == 'calendar' %}     {{ render_calendar(w) }}
  {% elif w.widget_type == 'todo' %}         {{ render_todo(w) }}
  {% elif w.widget_type == 'note_link' %}    {{ render_note_link(w) }}
  {% elif w.widget_type == 'timer' %}        {{ render_timer(w) }}
  {% elif w.widget_type == 'countdown' %}    {{ render_countdown(w) }}
  {% elif w.widget_type == 'event' %}        {{ render_event(w) }}
  {% elif w.widget_type == 'reminder' %}     {{ render_reminder(w) }}
  {% elif w.widget_type == 'title' %}        {{ render_title(w) }}
  {% elif w.widget_type == 'banner' %}       {{ render_banner(w) }}
  {% elif w.widget_type == 'text' %}         {{ render_text(w) }}
  {% elif w.widget_type == 'sticky' %}       {{ render_sticky(w) }}
  {% elif w.widget_type == 'quote' %}        {{ render_quote(w) }}
  {% elif w.widget_type == 'rss_feed' %}     {{ render_rss_feed(w) }}
  {% elif w.widget_type == 'buds' %}         {{ render_buds(w) }}
  {% elif w.widget_type == 'upload_preview' %} {{ render_upload_preview(w) }}
  {% endif %}
</div>
{% endmacro %}
```

#### 4b — New macro: `render_stack(w)`

Add immediately after `render_stack_child`. `w.children` is populated by the updated `get_widgets()`.

```jinja2
{% macro render_stack(w) %}
{%- set cfg = w.get('config', {}) -%}
{%- set active = cfg.get('active_index', 0)|int -%}
{%- set child_count = w.children|length -%}
<div id="hw-card-{{ w.id }}"
     class="hw-card group/wcard relative rounded-2xl bg-white dark:bg-zinc-900
            border border-gray-200 dark:border-zinc-800 shadow-sm overflow-hidden
            flex flex-col"
     data-widget-id="{{ w.id }}"
     data-widget-type="stack"
     data-col-span="{{ cfg.get('col_span', 1) }}"
     data-row-span="{{ cfg.get('row_span', 1) }}"
     data-widget-config="{{ cfg | tojson | e }}"
     data-child-count="{{ child_count }}"
     draggable="true"
     style="grid-column: span {{ cfg.get('col_span', 1) }};
            grid-row:    span {{ cfg.get('row_span', 1) }};">

  {# ── Header: name + slide counter + prev/next arrows ── #}
  <div class="flex items-center justify-between px-3 py-2 border-b
              border-gray-100 dark:border-zinc-800 flex-shrink-0">
    <span class="text-xs font-semibold text-gray-500 dark:text-zinc-400 truncate">
      {{ cfg.get('custom_name') or 'Stack' }}
    </span>
    <div class="flex items-center gap-1.5 ml-2 flex-shrink-0">
      <span class="stack-counter text-[10px] text-gray-400 dark:text-zinc-500 tabular-nums"
            data-stack-id="{{ w.id }}">
        {% if child_count > 0 %}{{ active + 1 }}/{{ child_count }}{% endif %}
      </span>
      {% if child_count > 1 %}
      <button type="button" onclick="stackPrev({{ w.id }})" aria-label="Previous slide"
              class="p-0.5 rounded text-gray-400 hover:text-gray-700
                     dark:hover:text-zinc-200 transition">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
             stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
        </svg>
      </button>
      <button type="button" onclick="stackNext({{ w.id }})" aria-label="Next slide"
              class="p-0.5 rounded text-gray-400 hover:text-gray-700
                     dark:hover:text-zinc-200 transition">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
             stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
        </svg>
      </button>
      {% endif %}
    </div>
  </div>

  {# ── Slide viewport — overflow:hidden clips child content ── #}
  <div class="stack-viewport relative flex-1 overflow-hidden min-h-0"
       data-stack-id="{{ w.id }}"
       data-active="{{ active }}">
    {% for child in w.children %}
    <div class="stack-slide absolute inset-0 transition-opacity duration-200
                {% if loop.index0 == active %}opacity-100 z-10
                {% else %}opacity-0 z-0 pointer-events-none{% endif %}"
         data-slide-index="{{ loop.index0 }}">
      {{ render_stack_child(child) }}
    </div>
    {% endfor %}
  </div>

  {# ── Dot navigation ── #}
  {% if child_count > 1 %}
  <div class="flex justify-center gap-1.5 py-2 flex-shrink-0">
    {% for child in w.children %}
    <button type="button"
            onclick="stackGoTo({{ w.id }}, {{ loop.index0 }})"
            aria-label="Go to slide {{ loop.index0 + 1 }}"
            class="stack-dot w-1.5 h-1.5 rounded-full transition
                   {% if loop.index0 == active %}bg-wblue
                   {% else %}bg-gray-300 dark:bg-zinc-600 hover:bg-gray-400{% endif %}">
    </button>
    {% endfor %}
  </div>
  {% endif %}

  {# ── Unstack button — only visible when stack mode is active (toggled via JS) ── #}
  <button type="button"
          onclick="unstackWidget({{ w.id }}, {{ w.page_id }})"
          title="Break stack apart"
          class="stack-unstack-btn hidden absolute top-1.5 right-1.5 z-20
                 px-1.5 py-0.5 text-[10px] font-medium rounded
                 bg-red-50 dark:bg-red-900/30 text-red-500
                 hover:bg-red-100 dark:hover:bg-red-900/50 transition">
    ✕ unstack
  </button>
</div>
{% endmacro %}
```

#### 4c — Add `data-stack-mode` to the widget grid `<div>`

At ~line 1620, update the existing grid `<div>` opening tag:

```jinja2
{%- set _pgcfg = page.get('config', {}) -%}
<div class="grid gap-3"
     id="widget-grid-{{ page.id }}"
     data-col-count="{{ _pgcfg.get('col_count', 3) }}"
     data-stack-mode="{{ 'true' if _pgcfg.get('stack_mode') else 'false' }}"
     style="grid-template-columns: repeat({{ _pgcfg.get('col_count', 3) }}, minmax(0, 1fr)); grid-auto-rows: auto;">
```

#### 4d — Add `stack` branch to widget loop

In the `{% for w in widgets %}` block (~line 1625), add after the `upload_preview` branch:

```jinja2
{% elif w.widget_type == 'stack' %}     {{ render_stack(w) }}
```

> No loop-level `group_id` filter needed — `get_widgets()` already returns only top-level rows.

---

### Step 5 — `templates/index.html`

Inside `<div id="pg-layout-modal">`, find the `<div class="flex justify-end">` Done button row (~line 3356) and insert the Stack Mode toggle **above** it:

```html
    <!-- Stack Mode toggle -->
    <div class="flex items-center justify-between py-3 border-t
                border-gray-100 dark:border-zinc-800 mt-1 mb-3">
      <div>
        <p class="text-xs font-semibold text-gray-700 dark:text-zinc-200">Stack Mode</p>
        <p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">
          Drop a card onto another to stack them.
        </p>
      </div>
      <button type="button"
              id="pg-stack-mode-toggle"
              role="switch"
              aria-checked="false"
              onclick="toggleStackMode()"
              class="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full
                     bg-gray-200 dark:bg-zinc-700 transition-colors duration-200
                     focus:outline-none focus:ring-2 focus:ring-wblue focus:ring-offset-1">
        <span id="pg-stack-mode-knob"
              class="translate-x-0.5 inline-block h-4 w-4 rounded-full
                     bg-white shadow-sm transition-transform duration-200 ease-in-out">
        </span>
      </button>
    </div>
```

---

### Step 6 — `templates/base.html`

After line 568 (`home-widgets-settings.js` script tag), add:

```html
<script src="/static/js/home-widget-stack.js?v={{ static_v }}" defer></script>
```

---

### Step 7 — `static/js/home-widget-stack.js` (new file)

**Load context:** Static file, loaded once, not HTMX-reinjected. `var`/`let`/`const` are all acceptable. Use `var` for consistency with `home-widgets.js`.

**Public surface (called from `onclick` attributes in template and from `home-widgets.js`):**

| Function | Called from | Purpose |
|---|---|---|
| `initStackCards()` | `initHomeWidgets()` in `home-widgets.js` | Boot all `.hw-card[data-widget-type=stack]` on page |
| `stackGoTo(stackId, index)` | template `onclick` on dots | Navigate to specific slide index |
| `stackPrev(stackId)` | template `onclick` on ‹ arrow | Go to previous slide (wraps) |
| `stackNext(stackId)` | template `onclick` on › arrow | Go to next slide (wraps) |
| `unstackWidget(stackId, pageId)` | template `onclick` on unstack button | POST unstack, reconcile DOM |

**Internal helpers:**

```
_stackSetActive(stackId, index)       — update slide visibility, counter, dot fill
_stackPersist(stackId, index)         — fire-and-forget POST to update-config
_stackInitTouchSwipe(viewportEl, id)  — bind touchstart/touchend swipe detection
_stackApplyUnstackResponse(data, pid) — DOM reconcile after unstack JSON response
```

**Key implementation details:**

**`_stackSetActive(stackId, index)`**
```javascript
var viewport = document.querySelector('.stack-viewport[data-stack-id="' + stackId + '"]');
if (!viewport) return;
var slides = viewport.querySelectorAll('.stack-slide');
var count  = slides.length;
if (count === 0) return;
index = ((index % count) + count) % count;   // wrap-safe modulo

slides.forEach(function(slide, i) {
  var active = i === index;
  slide.classList.toggle('opacity-100',        active);
  slide.classList.toggle('z-10',               active);
  slide.classList.toggle('opacity-0',          !active);
  slide.classList.toggle('z-0',                !active);
  slide.classList.toggle('pointer-events-none',!active);
});
viewport.dataset.active = index;

// Update counter
var counter = document.querySelector('.stack-counter[data-stack-id="' + stackId + '"]');
if (counter) counter.textContent = (index + 1) + '/' + count;

// Update dots
var card = document.getElementById('hw-card-' + stackId);
if (card) {
  card.querySelectorAll('.stack-dot').forEach(function(dot, i) {
    dot.classList.toggle('bg-wblue',                          i === index);
    dot.classList.toggle('bg-gray-300',                       i !== index);
    dot.classList.toggle('dark:bg-zinc-600',                  i !== index);
  });
}
```

**`_stackPersist(stackId, index)`**
```javascript
var card = document.getElementById('hw-card-' + stackId);
if (!card) return;
var cfg = {};
try { cfg = JSON.parse(card.dataset.widgetConfig || '{}'); } catch(e) {}
cfg.active_index = index;
card.dataset.widgetConfig = JSON.stringify(cfg);   // keep DOM in sync
_post('/home/widgets/' + stackId + '/update-config',
      { config_json: JSON.stringify(cfg) });
// fire-and-forget — active_index loss on network failure is acceptable
```

**`stackGoTo(stackId, index)`**
```javascript
_stackSetActive(stackId, index);
_stackPersist(stackId, index);
```

**`stackPrev(stackId)` / `stackNext(stackId)`**
```javascript
var viewport = document.querySelector('.stack-viewport[data-stack-id="' + stackId + '"]');
var cur = parseInt(viewport ? viewport.dataset.active : '0', 10);
var count = viewport ? viewport.querySelectorAll('.stack-slide').length : 0;
stackGoTo(stackId, cur - 1);   // stackNext uses cur + 1
```

**`_stackInitTouchSwipe(viewportEl, stackId)`**
```javascript
var _tx = 0;
viewportEl.addEventListener('touchstart', function(e) {
  _tx = e.touches[0].clientX;
}, { passive: true });
viewportEl.addEventListener('touchend', function(e) {
  var dx = e.changedTouches[0].clientX - _tx;
  if (dx < -40) stackNext(stackId);
  if (dx >  40) stackPrev(stackId);
}, { passive: true });
```

**`initStackCards()`**
```javascript
document.querySelectorAll('.hw-card[data-widget-type="stack"]').forEach(function(card) {
  var stackId  = parseInt(card.dataset.widgetId, 10);
  var viewport = card.querySelector('.stack-viewport');
  if (viewport && !viewport.dataset.swipeInited) {
    _stackInitTouchSwipe(viewport, stackId);
    viewport.dataset.swipeInited = '1';
  }
});
```

**`unstackWidget(stackId, pageId)`**
```javascript
async function unstackWidget(stackId, pageId) {
  var resp = await _post('/home/widgets/' + stackId + '/unstack', { page_id: pageId });
  if (!resp.ok) { _bwToast('Unstack failed', 'error'); return; }
  var data = await resp.json();
  if (data.error) { _bwToast(data.error, 'error'); return; }
  _stackApplyUnstackResponse(data, pageId);
}
```

**`_stackApplyUnstackResponse(data, pageId)`**
```javascript
// Remove the stack card
var stackEl = document.getElementById(data.stack_card_id);
var grid    = stackEl && stackEl.closest('[id^="widget-grid-"]');
stackEl && stackEl.remove();

// Insert freed child cards into the grid
if (grid) {
  (data.children_html || []).forEach(function(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var el = tmp.firstElementChild;
    if (el) grid.appendChild(el);
  });
}
_bwToast('Stack removed', 'info');
if (typeof invalidateHomePageCache === 'function') invalidateHomePageCache(pageId);
// Re-init drag-drop on newly inserted cards
if (typeof initHomeWidgets === 'function') initHomeWidgets();
```

---

### Step 8 — `static/js/home-widgets.js`

#### 8a — Call `initStackCards()` from `initHomeWidgets()`

At the end of `initHomeWidgets()` (the dashboard page boot function), add:

```javascript
if (typeof initStackCards === 'function') {
  try { initStackCards(); } catch(e) { console.error('[stack] initStackCards:', e); }
}
```

#### 8b — Stack-mode drop-on-card detection

Inside the existing `drop` event handler (after `event.preventDefault()`, before the normal reorder logic):

```javascript
var grid       = document.getElementById('widget-grid-' + pageId);
var stackMode  = grid && grid.dataset.stackMode === 'true';

if (stackMode && target && target !== _dragSrc) {
  var tRect  = target.getBoundingClientRect();
  var relX   = (event.clientX - tRect.left) / tRect.width;
  var relY   = (event.clientY - tRect.top)  / tRect.height;
  var onCard = relX > 0.15 && relX < 0.85 && relY > 0.15 && relY < 0.85;

  if (onCard) {
    _clearStackDropHighlight();
    _stackDropOnCard(target, _dragSrc, pageId);
    return;   // skip normal reorder
  }
}
// ... normal reorder continues ...
```

#### 8c — `_stackDropOnCard(targetCard, srcCard, pageId)` function

```javascript
async function _stackDropOnCard(targetCard, srcCard, pageId) {
  var tId   = parseInt(targetCard.dataset.widgetId, 10);
  var sId   = parseInt(srcCard.dataset.widgetId, 10);
  var tType = targetCard.dataset.widgetType;
  var sType = srcCard.dataset.widgetType;

  if (sType === 'divider' || sType === 'stack') {
    _bwToast('This widget type cannot be stacked', 'error'); return;
  }
  if (tType === 'divider') {
    _bwToast('Cannot stack onto a divider', 'error'); return;
  }

  var url, body;
  if (tType === 'stack') {
    url  = '/home/widgets/' + tId + '/stack-add';
    body = { widget_id: sId, page_id: pageId };
  } else {
    url  = '/home/widgets/stack';
    body = { page_id: pageId, widget_ids: tId + ',' + sId };
  }

  var resp = await _post(url, body);
  if (!resp.ok) { _bwToast('Stack failed', 'error'); return; }
  var data = await resp.json();
  _stackApplyStackResponse(data, pageId);
}
```

#### 8d — `_stackApplyStackResponse(data, pageId)` function

```javascript
function _stackApplyStackResponse(data, pageId) {
  if (data.error) { _bwToast(data.error, 'error'); return; }

  // Remove original card elements
  (data.removed_ids || []).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.remove();
  });

  // Insert new stack card at end of grid (sort_order preserved server-side)
  var grid = document.querySelector('#widget-grid-' + pageId);
  if (grid && data.stack_html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = data.stack_html;
    var card = tmp.firstElementChild;
    if (card) grid.appendChild(card);
  }

  if (typeof initStackCards === 'function') initStackCards();
  if (typeof invalidateHomePageCache === 'function') invalidateHomePageCache(pageId);
}
```

#### 8e — Stack-mode drag hover highlight

In the `dragover` handler, add/remove inline outline style on the hovered card (safer than CSS class — avoids Tailwind CDN purge issues):

```javascript
// In dragover handler, after determining 'target':
var stackMode = grid && grid.dataset.stackMode === 'true';
if (stackMode && target && target !== _dragSrc) {
  var tRect  = target.getBoundingClientRect();
  var relX   = (event.clientX - tRect.left)  / tRect.width;
  var relY   = (event.clientY - tRect.top)   / tRect.height;
  var onCard = relX > 0.15 && relX < 0.85 && relY > 0.15 && relY < 0.85;
  target.style.outline = onCard ? '2px solid #0053e2' : '';
}

// Helper to clear all highlights (call at dragend and before any drop action):
function _clearStackDropHighlight() {
  document.querySelectorAll('.hw-card').forEach(function(c) {
    c.style.outline = '';
  });
}
```

Also call `_clearStackDropHighlight()` in the `dragend` handler.

---

### Step 9 — `static/js/home-widgets-settings.js`

#### 9a — Update `openPageLayout(pageId)` — sync stack toggle

Add after the existing col-picker highlight block:

```javascript
// Sync Stack Mode toggle state from grid data attribute
var stackGrid = document.querySelector('[data-page-id="' + pageId + '"] [data-stack-mode]')
             || document.getElementById('widget-grid-' + pageId);
var stackOn   = stackGrid && stackGrid.dataset.stackMode === 'true';
var toggle    = document.getElementById('pg-stack-mode-toggle');
var knob      = document.getElementById('pg-stack-mode-knob');

if (toggle) toggle.setAttribute('aria-checked', stackOn ? 'true' : 'false');
if (toggle) {
  toggle.classList.toggle('bg-wblue',            stackOn);
  toggle.classList.toggle('dark:bg-blue-700',    stackOn);
  toggle.classList.toggle('bg-gray-200',         !stackOn);
  toggle.classList.toggle('dark:bg-zinc-700',    !stackOn);
}
if (knob) {
  knob.style.transform = stackOn ? 'translateX(1.125rem)' : 'translateX(0.125rem)';
}
```

> Using inline `style.transform` instead of Tailwind `translate-x-*` classes avoids Tailwind CDN purge issues for non-standard translate values.

#### 9b — New function: `toggleStackMode()`

```javascript
async function toggleStackMode() {
  var modal  = document.getElementById('pg-layout-modal');
  var pageId = modal && modal.dataset.pageId;
  if (!pageId) return;

  var grid    = document.getElementById('widget-grid-' + pageId);
  var current = grid && grid.dataset.stackMode === 'true';
  var next    = !current;

  // Optimistic DOM update
  if (grid) grid.dataset.stackMode = next ? 'true' : 'false';

  // Refresh toggle visuals (reads data-stack-mode from DOM)
  openPageLayout(pageId);

  // Show/hide unstack buttons on all existing stack cards
  document.querySelectorAll('.hw-card[data-widget-type="stack"] .stack-unstack-btn')
    .forEach(function(btn) { btn.classList.toggle('hidden', !next); });

  // Persist — the server merges this into existing config_json (stack_mode does not clobber col_count)
  await _post('/home/pages/' + pageId + '/update-config',
    { config_json: JSON.stringify({ stack_mode: next }) });
}
```

---

## Skills to Invoke

| When | Skill | Reason |
|---|---|---|
| After Step 1 | `bookworm-db-migration` | Verify `group_id` migration is idempotent; run against live DB; confirm FK enforcement |
| After Steps 4–6 | `bookworm-template-audit` | Verify `render_stack` macro: `tojson|e` on attribute, no `let`/`const` in any `<script>` block, new `<script src>` has `?v={{ static_v }}` |
| After all steps | `bookworm-qa` | Test: stack creation via drag-drop, carousel navigation, touch swipe, unstack, page duplicate, stack mode persists on hard refresh |
| Before commit | `bookworm-pre-commit` | Check for raw `aiosqlite.connect()`, missing `_PUBLIC` entries (these endpoints are auth-gated — correct), no hardcoded secrets |
| After commit | `bookworm-docs-keeper` | Update CODEPUPPY_NOTES.md: `home_widgets` schema row (`group_id` column), 3 new endpoints, `home-widget-stack.js` file entry |

---

## BookWorm Gotchas That Apply to This Feature

**Gotcha 1 — `var` only in HTMX-reinjected `<script>` partial blocks.**
`home-widget-stack.js` is a static file, loaded once — `var`/`let`/`const` are fine there. The `render_stack(w)` macro must **not** contain an inline `<script>` block. All boot logic belongs in `home-widget-stack.js` called via `initStackCards()`. If a future revision adds an inline `<script>` to the macro (e.g. to init a widget engine for a specific child type), every variable in it must use `var`.

**Gotcha 2 — Tailwind CDN cannot purge JS-dynamic class strings.**
Do NOT use Tailwind classes like `ring-wblue` or `translate-x-[1.125rem]` exclusively from JS — the CDN build won't include them. Use inline `style` assignments for stack-mode highlight (`target.style.outline`) and knob translate (`knob.style.transform`), and use existing Tailwind token classes (`opacity-0`, `opacity-100`, `bg-wblue`, `bg-gray-200`) which already appear in the static HTML and will be retained.

**Gotcha 3 — `tojson | e` vs `tojson | safe` — context matters.**
In the `render_stack` macro: `data-widget-config="{{ cfg | tojson | e }}"` uses `| e` (HTML entity escape) which is correct for an HTML attribute value. Do **not** use `| safe` on an HTML attribute — it would leave raw `"` characters that break the attribute parser. If config is ever dumped inside a `<script>` tag (e.g. `var cfg = {{ cfg | tojson | safe }};`), use `| safe` — but only there.

**Gotcha 4 — Route ordering: `/widgets/stack` must precede `/widgets/{widget_id}/…`**
Starlette matches routes in declaration order. `POST /home/widgets/stack` must appear in `home.py` **before** any `POST /home/widgets/{widget_id}/…` route; otherwise Starlette treats the literal `stack` as an integer `widget_id`, fails the int cast, and returns 422. Add a visible comment marker: `# ── Stack endpoints — MUST precede /{widget_id}/… routes ──`.

**Gotcha 5 — `duplicate_home_page()` does not handle `group_id` yet.**
The existing `home_db.py` clone loop copies `widget_type, style, config_json, sort_order` only. After this feature, duplicating a page that contains stacks will produce a broken state: children are cloned with `group_id` pointing to the **original** stack ID (wrong page). Fix requires a two-pass approach in `duplicate_home_page()` — see Open Questions OQ-1.

**Gotcha 6 — `selectPageLayout()` and `toggleStackMode()` both rely on the server-side config merge.**
The `update_page_config_handler` endpoint does `merged = {**existing, **patch}` — it is a merge, not an overwrite. This means `toggleStackMode()` posting `{"stack_mode": true}` will not clobber `col_count`, and `selectPageLayout()` posting `{"col_count": 3}` will not clobber `stack_mode`. Do **not** change `update_page_config_handler` to a full overwrite or this cross-write safety breaks.

**Gotcha 7 — `initStackCards()` must be called on every HTMX page swap.**
`_initSwappedPage()` in `home-widgets.js` routes dashboard pages to `initHomeWidgets()`. The `initStackCards()` call must be inside `initHomeWidgets()` (not at module top-level), or it misses subsequent HTMX navigation swaps. Always guard with `typeof initStackCards === 'function'` in case the file loads out of order.

**Gotcha 8 — Child widget JS engines run against hidden slides.**
Engines like the clock ticker and weather fetch target `#hw-card-{id}` by ID. Child widgets inside a stack have their full `.hw-card` markup in the DOM (inside `.stack-slide`), so engines will find them even when the slide is hidden. Widgets that check `offsetParent` or `getBoundingClientRect()` for visibility may behave unexpectedly on hidden slides. Flag for `bookworm-qa`: test a stack containing a clock widget; confirm the clock ticks correctly when it is not the active slide and when it becomes active.

---

## Implementation Checklist

- [ ] **1** — `database.py`: add `group_id INTEGER REFERENCES home_widgets(id) ON DELETE SET NULL` migration in `init_db()`, wrapped in `try/except`
- [ ] **2a** — `home_db.py`: update `get_widgets()` to nest children under `w["children"]`; top-level list excludes rows where `group_id IS NOT NULL`
- [ ] **2b** — `home_db.py`: add `create_stack_widget(page_id, child_ids) -> int`
- [ ] **2c** — `home_db.py`: add `stack_add_child(stack_id, widget_id, page_id) -> bool` with type validation (no divider, no stack, not already grouped)
- [ ] **2d** — `home_db.py`: add `unstack_widget(stack_id, page_id) -> list[int]` (clears group_id, deletes stack row, returns child IDs)
- [ ] **3a** — `home.py`: add `create_stack_widget, stack_add_child, unstack_widget` to imports
- [ ] **3b** — `home.py`: add private `_render_widget_html(w) -> str` helper with full widget-type dispatch dict
- [ ] **3c** — `home.py`: add `POST /home/widgets/stack` endpoint — **placed before any `/{widget_id}/` route**
- [ ] **3d** — `home.py`: add `POST /home/widgets/{stack_id}/stack-add` endpoint
- [ ] **3e** — `home.py`: add `POST /home/widgets/{stack_id}/unstack` endpoint
- [ ] **4a** — `home_page.html`: add `render_stack_child(w)` macro
- [ ] **4b** — `home_page.html`: add `render_stack(w)` macro
- [ ] **4c** — `home_page.html`: add `data-stack-mode="{{ 'true' if _pgcfg.get('stack_mode') else 'false' }}"` to widget grid `<div>`
- [ ] **4d** — `home_page.html`: add `{% elif w.widget_type == 'stack' %} {{ render_stack(w) }}` to widget loop
- [ ] **5** — `index.html`: insert Stack Mode toggle HTML section inside `pg-layout-modal`, above Done button
- [ ] **6** — `base.html`: add `<script src="/static/js/home-widget-stack.js?v={{ static_v }}" defer></script>` after `home-widgets-settings.js`
- [ ] **7** — Create `static/js/home-widget-stack.js` — all public + internal functions as specified above
- [ ] **8a** — `home-widgets.js`: call `initStackCards()` at end of `initHomeWidgets()` (guarded by `typeof` check)
- [ ] **8b** — `home-widgets.js`: add stack-mode drop-on-card detection in `drop` handler
- [ ] **8c** — `home-widgets.js`: implement `_stackDropOnCard(targetCard, srcCard, pageId)`
- [ ] **8d** — `home-widgets.js`: implement `_stackApplyStackResponse(data, pageId)`
- [ ] **8e** — `home-widgets.js`: add inline `style.outline` drag hover highlight in `dragover`; `_clearStackDropHighlight()` in `dragend`
- [ ] **9a** — `home-widgets-settings.js`: update `openPageLayout()` to read `data-stack-mode` and sync toggle UI (use `knob.style.transform` not Tailwind class)
- [ ] **9b** — `home-widgets-settings.js`: implement `toggleStackMode()` (optimistic DOM update → `openPageLayout` refresh → unstack button visibility → persist via merge endpoint)
- [ ] **Resolve OQ-1** — decide `duplicate_home_page()` strategy (two-pass remap vs flatten) before closing this feature
- [ ] **Resolve OQ-4** — decide auto-unstack when last child deleted vs allow 1-child degenerate stacks
- [ ] **Run** `bookworm-db-migration` → `bookworm-template-audit` → `bookworm-qa` → `bookworm-pre-commit` → `bookworm-docs-keeper`

---

## Open Questions

**OQ-1 — `duplicate_home_page()` stack handling (required fix before shipping)**
The clone loop in `home_db.py` copies `widget_type, style, config_json, sort_order` only. After this feature, cloning a page with stacks will copy `group_id` values that point to the **original** page's stack widget IDs — broken cross-page FK references. Two options:
- **Option A (correct, more work):** Two-pass clone — pass 1 inserts all widgets and builds `old_id → new_id` map; pass 2 updates `group_id` in cloned rows using the map.
- **Option B (simpler, loses structure):** Set `group_id = NULL` for all cloned widgets; user gets individual top-level cards instead of stacks.
**Decision needed before implementing Step 2.**

**OQ-2 — Stack card height / `row_span` default**
The spec says "inherits from tallest child OR stack's own `row_span`." Auto-height from tallest child requires JS measurement at runtime (fragile; children may not be rendered yet). Recommended default: stack card uses its own `row_span` config (default `2`) and users resize it via the existing size picker. Auto-height from children is a future v2 enhancement.

**OQ-3 — Widget size picker targeting stack vs child cards**
The existing size picker in `home-widgets-settings.js` listens for click on `.hw-card`. Stack child cards are fully rendered `.hw-card` elements inside `.stack-slide` divs. If a click on a child card bubbles to the size picker, it may try to resize the child (which is inside a stack, not the grid directly). Verify that the size picker's event handler targets only top-level grid cards, or add a guard: `if (card.closest('.stack-slide')) return;`.

**OQ-4 — Auto-unstack when last child is deleted**
The existing `DELETE /home/widgets/{id}` route calls `delete_widget(widget_id)`. If the deleted widget is the last child of a stack (i.e., `group_id IS NOT NULL` and no other children remain), the stack is left with 0 children — a broken state. Two options:
- **Option A (clean UX):** Modify the delete route to detect this case and auto-unstack (delete the stack row too) if `remaining_children == 0`.
- **Option B (simple):** Allow degenerate stacks; the template already hides arrows/dots when `child_count <= 1`, so a 1-child stack degrades gracefully to a single card. Minimum enforcement = 0 children only.
**Decision needed before shipping.**

**OQ-5 — Stack mode visual feedback approach confirmed**
Plan uses inline `style.outline = '2px solid #0053e2'` for drop-target highlight (avoids Tailwind CDN purge). Confirm this approach is acceptable or choose alternative (e.g. add a `ring-2` Tailwind class to an existing static template to force it into the CDN bundle, then toggle it from JS).
