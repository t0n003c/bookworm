# Plan: `upload_preview` Dashboard Widget
Date: 2026-04-20
Estimated complexity: Medium

---

## Summary

Add a new `upload_preview` widget type to the BookWorm Dashboard. The widget lets
the user pin one or more files from any of their Uploads homespace pages and
display them in a thumbnail gallery or horizontal carousel directly inside a
Dashboard tile. Images show as cover thumbnails, videos show with a play-icon
overlay (native `<video preload="metadata">`), PDFs and documents show a file-type
icon with the filename, and audio shows a musical-note icon. The user picks files
through a reusable file-picker modal (modelled exactly on the Grid page's
`gridOpenMediaPicker` / `_gridMediaFetch` pattern). Picked file IDs are stored as
a JSON array in `home_widgets.config_json → upload_ids`. No new DB tables are
needed — the `home_widgets` table already stores config as JSON, and the existing
`page_uploads` table already has all file rows.

---

## Files to Change

Touch in this order to avoid dependency issues (DB helper → API → JS engine →
template → template dispatch → settings wiring → modal entry point).

| # | File | What changes |
|---|---|---|
| 1 | `routers/uploads_db.py` | Add `get_page_uploads_by_ids(ids, user_id)` — single `SELECT … WHERE id IN (…) AND user_id = ?` query; returns list[dict] in same shape as `get_uploads_page` file rows |
| 2 | `routers/home_uploads.py` | Add `GET /home/uploads/pinned-files?ids=1,2,3` endpoint **above** the `/{page_id}/…` routes; calls the new DB helper; returns `JSONResponse([{id, filename, original_name, mime_type, size}])` |
| 3 | `static/js/home-widget-upload-preview.js` | **New file** — full JS engine for this widget (see New Files section) |
| 4 | `templates/base.html` | Add one `<script src="/static/js/home-widget-upload-preview.js?v={{ static_v }}">` tag in the existing static-JS block, after `home-widgets-render.js` |
| 5 | `templates/partials/home_add_widget_modal.html` | Add `('upload_preview', '🖼️', 'File Preview')` button to the **Advanced** grid (alongside `rss_feed` and `buds`) |
| 6 | `templates/partials/home_page.html` | (a) Add `render_upload_preview(w)` Jinja2 macro; (b) Add dispatch line in the widget-for-loop; (c) Add `#upl-prev-picker-modal` HTML block near the bottom (after `#add-widget-modal`) |
| 7 | `static/js/home-widgets.js` | Add `WIDGET_STYLES['upload_preview']`, `WIDGET_CONFIG_FIELDS['upload_preview']`, and an `upload-picker` branch in `aw_refreshConfig` |
| 8 | `static/js/home-widgets-settings.js` | Add `upload-picker` branch in `_buildFieldsForType`; add `upload_preview` post-save re-render hook inside `_saveWidgetFullConfig` (mirrors the existing RSS re-render hook) |

---

## New Files to Create

| File | Purpose |
|---|---|
| `static/js/home-widget-upload-preview.js` | Widget JS engine: `_loadUploadPreview(el)` renderer, `_uplPrevOpenPicker(widgetId)`, `_uplPrevClosePicker()`, `_uplPrevLoadFiles(uploadsPageId)`, `_uplPrevToggleFile(fileId)`, `_uplPrevConfirm()`, `_uplPrevFetchPages()`. All module-level state uses `var`. |

---

## DB Migrations Needed

**None.** The `home_widgets` table already exists with `config_json TEXT`. The
`page_uploads` table already exists with all required columns. No `ALTER TABLE` or
new table is needed.

The only DB work is a new read-only query function in `uploads_db.py` — no
migration step required.

---

## Config JSON Schema

The full config object stored in `home_widgets.config_json` for an
`upload_preview` widget:

```json
{
  "upload_ids": [123, 456, 789],
  "caption":    false,
  "col_span":   2,
  "row_span":   2,
  "show_name":  false,
  "custom_name": "",
  "card_bg":    "1"
}
```

| Key | Type | Default | Notes |
|---|---|---|---|
| `upload_ids` | `int[]` | `[]` | IDs from `page_uploads.id`; user-owned only |
| `caption` | `bool` | `false` | Show filename below each thumbnail |
| `col_span` | `int` | `1` | Standard widget width (1–N) |
| `row_span` | `int` | `1` | Standard widget height (1–4) |
| `show_name` | `bool` | `false` | Show the `custom_name` label strip |
| `custom_name` | `str` | `""` | Label text when `show_name` is true |
| `card_bg` | `str` | `"1"` | `"0"` = transparent shell; anything else = framed |

The widget's DB `style` column holds `'grid'` (mosaic layout, default) or
`'carousel'` (horizontal scroll strip with prev/next arrows). Style is picked at
add-time and controls the tile's overall layout.

---

## Detailed Implementation Notes

### 1 — `routers/uploads_db.py` — new query

```python
async def get_page_uploads_by_ids(ids: list[int], user_id: int) -> list[dict]:
    """Fetch specific page_uploads rows by ID, scoped to user ownership.

    Returns only page-src files (note attachments are excluded — v1 scope).
    Order is preserved: rows come back in the same order as `ids`.
    """
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    async with get_db() as db:
        cur = await db.execute(
            f"SELECT id, filename, original_name, mime_type, size "
            f"FROM page_uploads "
            f"WHERE id IN ({placeholders}) AND user_id = ?",
            (*ids, user_id),
        )
        rows = {r["id"]: dict(r) for r in await cur.fetchall()}
    # Return in the caller's requested order (preserves user's pin order).
    return [rows[i] for i in ids if i in rows]
```

### 2 — `routers/home_uploads.py` — new endpoint

Add **above** the first `@router.get("/{page_id}/files")` route so Starlette never
tries to cast `"pinned-files"` to `int`. (The `int` type annotation on `page_id`
already prevents the conflict, but fixed routes before parameterised routes is the
project convention — see home.py header comment.)

```python
@router.get("/pinned-files")
async def pinned_files(request: Request, ids: str = Query("")):
    """Return file metadata for a comma-separated list of page_upload IDs.

    Auth-gated. Only returns rows owned by the requesting user.
    IDs that don't exist or belong to another user are silently omitted.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    try:
        id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()]
    except ValueError:
        id_list = []
    rows = await get_page_uploads_by_ids(id_list, uid)
    return JSONResponse(rows)
```

Import `get_page_uploads_by_ids` from `routers.uploads_db` at the top of the file.

### 3 — `static/js/home-widget-upload-preview.js`

All module-level state as `var` (not `let`/`const`) per codebase convention:

```
var _uplPrevWidgetId    = null;   // widget ID whose picker is open
var _uplPrevSelected    = [];     // ordered list of selected upload IDs
var _uplPrevPickerPage  = 1;      // current page in picker
var _uplPrevPickerTotal = 0;      // total files on current uploads page
var _uplPrevPickerPid   = null;   // current uploads page id in picker
var _uplPrevBusy        = false;  // guard against concurrent fetches
```

**Key functions:**

```
_loadUploadPreview(el)
  Called by initHomeWidgets() for each [data-widget-type="upload_preview"] card.
  Reads el.dataset.uploadIds (JSON).
  If empty → renders empty-state HTML (emoji + "No files pinned—open ⚙️ to add some").
  Else → GET /home/uploads/pinned-files?ids=1,2,3
          → _uplPrevRender(el, files, style, caption)

_uplPrevRender(el, files, style, caption)
  Renders thumbnails based on mime_type:
    image/*         → <img src="/uploads/{filename}" class="w-full h-full object-cover">
    video/*         → <video preload="metadata"> + 🎬 play-icon overlay
    application/pdf → 📄 icon + truncated original_name
    audio/*         → 🎵 icon + truncated original_name
    application/vnd.openxmlformats-officedocument.* → 📝 icon + name
    anything else   → 📎 icon + name
  style === 'grid'     → CSS grid (auto-fill columns based on file count and col_span)
  style === 'carousel' → flex row with overflow-x-auto + prev/next arrow buttons

_uplPrevOpenPicker(widgetId)
  Reads current upload_ids from card's data-widget-config.
  Initialises _uplPrevSelected (copy of current IDs).
  Calls _uplPrevFetchPages() then _uplPrevLoadFiles(firstPageId).
  Removes 'hidden' from #upl-prev-picker-modal.

_uplPrevClosePicker()
  Adds 'hidden' to #upl-prev-picker-modal.
  Resets _uplPrevSelected, _uplPrevWidgetId, page counters.

_uplPrevFetchPages()
  GET /home/pages with Accept: application/json + X-Requested-With: XMLHttpRequest.
  Filter pages where page_type === 'uploads'.
  Populates the <select id="upl-prev-page-sel"> inside the modal.
  Auto-selects first page, then calls _uplPrevLoadFiles(firstId).

_uplPrevLoadFiles(uploadsPageId)
  _uplPrevPickerPid = uploadsPageId; _uplPrevPickerPage = 1;
  Calls _uplPrevFetch().

_uplPrevFetch()
  GET /home/uploads/{_uplPrevPickerPid}/files?scoped=1&page={_uplPrevPickerPage}
  (Reuses the existing scoped file list endpoint — identical pattern to _gridMediaFetch)
  Renders a 4-column thumbnail grid inside #upl-prev-files.
  Already-selected files get a blue checkmark overlay.
  Clicking any thumbnail calls _uplPrevToggleFile(f.id).

_uplPrevToggleFile(fileId)
  Toggle fileId in _uplPrevSelected (add if absent, remove if present).
  Update the checkmark overlay on the clicked thumbnail.
  Update #upl-prev-count badge.

_uplPrevConfirm()
  Reads current card config via _getCardConfig(_uplPrevWidgetId).
  Merges { upload_ids: _uplPrevSelected } into existing config.
  Calls _saveWidgetFullConfig(_uplPrevWidgetId, mergedConfig).
  Closes picker.
  Re-renders the widget tile: calls _loadUploadPreview(card).
```

### 4 — `templates/base.html` — script tag

Add immediately after the existing `home-widgets-render.js` script tag:

```html
<script src="/static/js/home-widget-upload-preview.js?v={{ static_v }}"></script>
```

### 5 — `templates/partials/home_add_widget_modal.html`

Add to the **Advanced** grid (the second grid block, the one that has `rss_feed`
and `buds`):

```jinja2
('upload_preview', '🖼️', 'File Preview'),
```

### 6 — `templates/partials/home_page.html`

**6a — New macro** (add near the top of the macros section, below `render_quote`):

```jinja2
{# ═══════════════════════════════════════════════════════════════════
   UPLOAD PREVIEW widget
   Renders a shell div; JS engine (_loadUploadPreview) fetches file
   metadata and renders thumbnails client-side.
   ═══════════════════════════════════════════════════════════════════ #}
{% macro render_upload_preview(w) %}
{%- set cfg     = w.get('config', {}) -%}
{%- set ids     = cfg.get('upload_ids', []) -%}
{%- set caption = cfg.get('caption', false) -%}
{% call card(w) %}
  {{ widget_header(w, 'File Preview', '🖼️') }}
  <div class="flex-1 min-h-0 overflow-hidden"
       id="upl-prev-{{ w.id }}"
       data-upload-ids="{{ ids | tojson | e }}"
       data-style="{{ w.style }}"
       data-caption="{{ '1' if caption else '0' }}"
       data-widget-id="{{ w.id }}">
    {# JS engine populates this on page load #}
    <div class="flex items-center justify-center h-full text-gray-300 dark:text-zinc-600 text-xs select-none">
      Loading…
    </div>
  </div>
{% endcall %}
{% endmacro %}
```

**6b — Dispatch line** in the widget-for-loop (add after the `buds` line):

```jinja2
{% elif w.widget_type == 'upload_preview' %} {{ render_upload_preview(w) }}
```

**6c — Picker modal** (add after the existing `{% include 'partials/home_add_widget_modal.html' %}` line):

```jinja2
{# ── Upload Preview file-picker modal ──────────────────────────── #}
<div id="upl-prev-picker-modal"
     class="hidden fixed inset-0 z-50 flex items-center justify-center p-4"
     role="dialog" aria-modal="true" aria-labelledby="upl-prev-picker-title"
     onkeydown="if(event.key==='Escape') _uplPrevClosePicker()">
  <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"
       onclick="_uplPrevClosePicker()" aria-hidden="true"></div>
  <div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl
              w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
    <div class="flex items-center justify-between px-5 py-4 border-b
                border-gray-200 dark:border-zinc-700 flex-shrink-0">
      <h2 id="upl-prev-picker-title"
          class="text-base font-bold text-gray-900 dark:text-zinc-100">
        Pick Files to Pin
      </h2>
      <button onclick="_uplPrevClosePicker()" aria-label="Close"
              class="p-1.5 rounded-lg text-gray-400 hover:text-gray-700
                     hover:bg-gray-100 dark:hover:bg-zinc-800 transition">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24"
             stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round"
                d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>

    {# Toolbar: page selector + pagination + count badge #}
    <div class="flex items-center gap-3 px-4 py-2.5 border-b
                border-gray-100 dark:border-zinc-800 flex-shrink-0 flex-wrap">
      <select id="upl-prev-page-sel"
              onchange="_uplPrevLoadFiles(this.value)"
              class="text-sm border border-gray-200 dark:border-zinc-700
                     rounded-lg px-2 py-1 bg-white dark:bg-zinc-800
                     text-gray-700 dark:text-zinc-200
                     focus:outline-none focus:ring-2 focus:ring-wblue">
        <option value="">Loading pages…</option>
      </select>
      <span class="text-xs text-gray-400 dark:text-zinc-500 ml-auto"
            id="upl-prev-page-label">Page 1</span>
      <button onclick="_uplPrevPrevPage()"
              class="px-2 py-1 text-xs rounded border border-gray-200
                     dark:border-zinc-700 hover:bg-gray-50
                     dark:hover:bg-zinc-800 transition">&#8592;</button>
      <button onclick="_uplPrevNextPage()"
              class="px-2 py-1 text-xs rounded border border-gray-200
                     dark:border-zinc-700 hover:bg-gray-50
                     dark:hover:bg-zinc-800 transition">&#8594;</button>
    </div>

    {# File thumbnail grid (populated by JS) #}
    <div id="upl-prev-files"
         class="flex-1 overflow-y-auto p-3 min-h-0">
      <p class="text-sm text-gray-400 p-4">Loading…</p>
    </div>

    {# Footer: count + confirm #}
    <div class="flex items-center justify-between px-5 py-3 border-t
                border-gray-200 dark:border-zinc-700 flex-shrink-0">
      <span class="text-xs text-gray-500 dark:text-zinc-400">
        <span id="upl-prev-count">0</span> file(s) selected
      </span>
      <div class="flex gap-3">
        <button onclick="_uplPrevClosePicker()"
                class="px-4 py-2 text-sm rounded-lg border border-gray-300
                       dark:border-zinc-600 text-gray-700 dark:text-zinc-300
                       hover:bg-gray-50 dark:hover:bg-zinc-800 transition">
          Cancel
        </button>
        <button onclick="_uplPrevConfirm()"
                class="px-5 py-2 bg-wblue text-white text-sm font-semibold
                       rounded-lg hover:bg-blue-700 transition">
          Pin Selected
        </button>
      </div>
    </div>
  </div>
</div>
{# NOTE: No <script> block in this modal — all JS lives in
   home-widget-upload-preview.js (a static file, not re-injected by HTMX). #}
```

> ⚠️ **Critical:** Do NOT add a `<script>` block inside this modal. All JS lives
> in the static `home-widget-upload-preview.js` file. HTMX re-injects `home_page.html`
> on page navigation — any `<script>` in the template gets re-executed, and
> `let`/`const` at top level would throw on re-injection (Quirk #13).

### 7 — `static/js/home-widgets.js`

**7a — Styles** (add to the `WIDGET_STYLES` object):

```javascript
WIDGET_STYLES['upload_preview'] = [
  ['grid',     'Grid'],
  ['carousel', 'Carousel'],
];
```

**7b — Config fields** (add to `WIDGET_CONFIG_FIELDS`):

```javascript
WIDGET_CONFIG_FIELDS['upload_preview'] = function(style) {
  return [
    { id: 'cf-upl-prev-caption', label: 'Show filenames under thumbnails',
      type: 'select', name: 'caption',
      options: [['0','No'],['1','Yes']] },
    { id: 'cf-upl-prev-ids', label: 'Pinned files', type: 'upload-picker',
      name: 'upload_ids' },
  ];
};
```

**7c — `aw_refreshConfig` upload-picker case** (add inside the `fields.map(f => {` block):

```javascript
if (f.type === 'upload-picker') {
  return `<div>${lbl}
    <p class="text-xs text-gray-400 mt-1 py-2">
      ✅ Add the widget first, then open its
      <strong>⚙️ Settings</strong> gear to pick files.
    </p>
    <input type="hidden" id="${f.id}" data-name="${f.name}"
           data-json="1" value="[]">
  </div>`;
}
```

### 8 — `static/js/home-widgets-settings.js`

**8a — `_buildFieldsForType` upload-picker case** (add before the final generic `else`
input branch):

```javascript
if (f.type === 'upload-picker') {
  var count = Array.isArray(curVal) ? curVal.length : 0;
  var hiddenVal = JSON.stringify(Array.isArray(curVal) ? curVal : []);
  wrap.innerHTML = lbl
    + '<div class="flex items-center gap-3 mt-1">'
    + '<span class="text-sm text-gray-500 dark:text-zinc-400">'
    + count + ' file(s) pinned</span>'
    + '<button type="button"'
    + ' onclick="_uplPrevOpenPicker(' + widgetId + ')"'
    + ' class="px-3 py-1 text-xs bg-wblue text-white rounded-lg'
    + ' hover:bg-blue-700 transition">Pick Files…</button>'
    + '</div>'
    + '<input type="hidden" id="' + f.id + '"'
    + ' data-name="' + f.name + '" data-json="1"'
    + ' value=\'' + hiddenVal.replace(/'/g, "&#39;") + '\'>';
  body.appendChild(wrap);
  return;  // don't fall through to generic append
}
```

**8b — Post-save update hook** inside `_saveWidgetFullConfig`, after the existing
RSS re-render block (look for `const rssEl = card.querySelector('.rss-widget')`):

```javascript
// Upload Preview: re-render tile immediately when upload_ids changes
var uplPrevEl = card.querySelector('[data-upload-ids]');
if (uplPrevEl && config.upload_ids !== undefined) {
  uplPrevEl.dataset.uploadIds = JSON.stringify(config.upload_ids);
  if (typeof _loadUploadPreview === 'function') {
    _loadUploadPreview(uplPrevEl);
  }
}
```

---

## How `initHomeWidgets()` Triggers the Render

`initHomeWidgets()` in `home-widgets.js` already runs on every Dashboard page
load. The implementation must add a call to bootstrap all `upload_preview`
widgets after the existing init calls (clock, weather, calendar, etc.):

```javascript
// In initHomeWidgets() — add after existing widget init calls:
document.querySelectorAll('[data-upload-ids]').forEach(function(el) {
  _loadUploadPreview(el);
});
```

This is located inside `home-widgets.js` in the `initHomeWidgets` function.
Find the block and add the call there.

---

## File Picker UX Flow (step by step)

```
1. User opens Dashboard page — `initHomeWidgets()` fires.
2. `_loadUploadPreview(el)` is called for each upload_preview card.
3. If upload_ids is empty → empty-state rendered (no API call).
4. If upload_ids has IDs → GET /home/uploads/pinned-files?ids=1,2,3
   → files rendered as thumbnails inside the card.

Picker flow:
5. User clicks ⚙️ on widget card → openWidgetSettings() fires.
6. Settings modal builds fields; upload-picker field shows "3 files pinned"
   + "Pick Files…" button.
7. User clicks "Pick Files…" → _uplPrevOpenPicker(widgetId).
8. Picker modal shows. _uplPrevFetchPages() runs:
   - GET /home/pages (Accept: application/json, X-Requested-With: XMLHttpRequest)
   - Filter pages where page_type === 'uploads'
   - Populate <select id="upl-prev-page-sel">
   - Auto-load first uploads page: _uplPrevLoadFiles(pageId)
9. _uplPrevFetch() runs:
   - GET /home/uploads/{pid}/files?scoped=1&page=1
   - Render 4-col thumbnail grid in #upl-prev-files
   - Files already in _uplPrevSelected get blue checkmark overlay
10. User clicks thumbnails to toggle selection.
    Already-pinned files arrive pre-checked.
    Max items: no hard limit in v1 (widget tile clips overflow naturally).
11. User clicks "Pin Selected":
    - _uplPrevConfirm() merges {upload_ids: _uplPrevSelected}
      into existing card config via _saveWidgetFullConfig()
    - Closes picker
    - Re-renders tile via _loadUploadPreview(card)
    - _saveWidgetFullConfig also calls invalidateHomePageCache(pid)
```

---

## Skills to Invoke

- **`bookworm-widget-scaffolder`** — Run after Step 6 (home_page.html macro done);
  it validates the macro, dispatch, and modal in one sweep.
- **`bookworm-template-audit`** — After touching `home_page.html` and `base.html`;
  catches missing `| safe`, broken `hx-target` IDs, stray `let`/`const` in the modal.
- **`bookworm-qa`** — After full implementation; verify:
  - `GET /home/uploads/pinned-files?ids=X` returns 200 with correct rows
  - Widget tile renders empty-state when `upload_ids` is `[]`
  - Widget tile renders thumbnails after files are pinned
  - Grid and Carousel styles both display correctly
  - Settings gear → Pick Files → confirm → tile re-renders (no page reload needed)
  - `_health_check.py` stays green
- **`bookworm-pre-commit`** — Before committing.
- **`bookworm-docs-keeper`** — After commit; update CODEPUPPY_NOTES.md widget
  table, session log entry, and key-file map for the new JS file.

---

## BookWorm Gotchas That Apply to This Feature

**Quirk #13 — `var` not `let`/`const` in HTMX-reinjected partial `<script>` blocks.**
The picker modal lives inside `home_page.html`, which HTMX re-injects on every
Dashboard navigation. There must be **no `<script>` block inside the picker
modal HTML**. All JS goes in `home-widget-upload-preview.js` (a static file loaded
once in `base.html`). Module-level vars in that static file can also use `var`
as the project convention (even though `let`/`const` would be safe there — stay
consistent).

**Quirk #16 — `| tojson | safe` inside `<script>` tags / `| tojson | e` inside HTML attributes.**
In the `render_upload_preview` macro:
- `data-upload-ids="{{ ids | tojson | e }}"` — HTML attribute → use `| e`
- Anywhere a JSON blob is embedded inside a `<script type="application/json">` → use `| tojson | safe`
The picker modal does not embed any JSON into the template — JS fetches all data
client-side — so there is no second occurrence.

**Quirk #10 — `_hpCache` 5-minute client-side cache.**
`_saveWidgetFullConfig` already calls `invalidateHomePageCache(pid)` at the end.
`_uplPrevConfirm()` must call `_saveWidgetFullConfig` (not a raw `fetch`), so the
cache is invalidated automatically. Do not roll a custom PATCH call.

**Quirk #18 — Unguarded `/uploads/<uuid>` StaticFiles mount.**
Thumbnails in the widget tile load via `<img src="/uploads/{filename}">` which is
unguarded — anyone with the UUID URL can load the file without a session. This is
**existing behaviour** shared with the Grid widget and every other place that
shows upload thumbnails. Do not attempt to gate StaticFiles in this feature;
note it in the PR and add it to the existing tech-debt tracking comment in
CODEPUPPY_NOTES.md Quirk #18.

**`GET /home/pages` JSON response format.**
`_uplPrevFetchPages()` calls `GET /home/pages` with `Accept: application/json`
and `X-Requested-With: XMLHttpRequest`. Verify that `home.py` returns
`{"pages": [...]}` for that Accept header before shipping. The `select-crm-pages`
field in the add-widget modal already does this exact call — check it to confirm
the response shape.

**`_buildFieldsForType` uses `body.appendChild(wrap)` at the end of each iteration.**
The upload-picker branch must `return` (or `continue`) after appending to
`wrap` so the generic `body.appendChild(wrap)` at the bottom of the loop does
not double-append. Use an early `return` pattern inside the field loop callback,
same as the RSS feeds-list field type.

**Route ordering in `home_uploads.py`.**
`GET /home/uploads/pinned-files` is a fixed-path route that must be declared
**before** `GET /home/uploads/{page_id}/files`. Because `page_id` is typed `int`,
Starlette will not match the string `"pinned-files"` to it, so the routes won't
actually conflict — but the project convention (and codebase comment in home.py)
is to register fixed routes before parameterised ones. Follow it.

---

## Implementation Checklist

- [ ] **Step 1** — `routers/uploads_db.py`: add `get_page_uploads_by_ids(ids, user_id)` with IN-clause query; preserve caller's order; return `[]` fast when `ids` is empty
- [ ] **Step 2** — `routers/home_uploads.py`: add `GET /pinned-files` endpoint above `/{page_id}/files`; import the new helper; parse `?ids=` query param defensively (`.isdigit()` check); return `JSONResponse(rows)`
- [ ] **Step 3** — Create `static/js/home-widget-upload-preview.js`; all module vars use `var`; implement `_loadUploadPreview`, `_uplPrevOpenPicker`, `_uplPrevClosePicker`, `_uplPrevFetchPages`, `_uplPrevLoadFiles`, `_uplPrevFetch`, `_uplPrevToggleFile`, `_uplPrevPrevPage`, `_uplPrevNextPage`, `_uplPrevConfirm`
- [ ] **Step 4** — `templates/base.html`: add `<script src="…home-widget-upload-preview.js?v={{ static_v }}">` after `home-widgets-render.js`
- [ ] **Step 5** — `templates/partials/home_add_widget_modal.html`: add `upload_preview` button to Advanced grid
- [ ] **Step 6a** — `templates/partials/home_page.html`: write `render_upload_preview(w)` macro; verify `data-upload-ids` uses `| tojson | e`
- [ ] **Step 6b** — `templates/partials/home_page.html`: add dispatch line in widget-for-loop: `{% elif w.widget_type == 'upload_preview' %} {{ render_upload_preview(w) }}`
- [ ] **Step 6c** — `templates/partials/home_page.html`: add `#upl-prev-picker-modal` HTML block; **no `<script>` block inside it**; all onclick attributes call functions from `home-widget-upload-preview.js`
- [ ] **Step 7a** — `static/js/home-widgets.js`: add `WIDGET_STYLES['upload_preview']` with `['grid','Grid']` and `['carousel','Carousel']` entries
- [ ] **Step 7b** — `static/js/home-widgets.js`: add `WIDGET_CONFIG_FIELDS['upload_preview']` returning the caption select + upload-picker field
- [ ] **Step 7c** — `static/js/home-widgets.js`: add `upload-picker` branch in `aw_refreshConfig` that renders a placeholder message + hidden `<input data-json="1" value="[]">`
- [ ] **Step 7d** — `static/js/home-widgets.js`: in `initHomeWidgets()`, add `document.querySelectorAll('[data-upload-ids]').forEach(el => _loadUploadPreview(el))`
- [ ] **Step 8a** — `static/js/home-widgets-settings.js`: add `upload-picker` branch in `_buildFieldsForType`; show count badge + "Pick Files…" button; set `onclick="_uplPrevOpenPicker(${widgetId})"`; append hidden input with current `upload_ids` JSON; early `return` after appending
- [ ] **Step 8b** — `static/js/home-widgets-settings.js`: add `upload_preview` post-save hook in `_saveWidgetFullConfig` to re-render the tile after `upload_ids` changes
- [ ] **Smoke test** — Add an `upload_preview` widget, verify empty state. Open settings, pick 3 files (1 image, 1 video, 1 PDF). Confirm. Verify grid layout shows thumbnails, video play overlay, PDF icon. Switch to Carousel style via settings. Verify horizontal scroll. Verify `caption = true` shows filenames. Navigate away and back — verify widget re-renders from cache without loss.
- [ ] **Run `bookworm-template-audit`** — pass: files `home_page.html`, `base.html`; changes: new macro + picker modal + new script tag
- [ ] **Run `bookworm-qa`** — pass: new endpoint `/home/uploads/pinned-files?ids=X`, widget rendering, picker flow, settings save
- [ ] **Run `bookworm-pre-commit`** — pass: no hardcoded secrets, new `_db.py`-style helper uses `get_db()`, no raw `aiosqlite.connect()`
- [ ] **Run `bookworm-docs-keeper`** — update widget table in CODEPUPPY_NOTES.md, add session log entry, add `home-widget-upload-preview.js` to key-file map

---

## Open Questions

1. **Note attachments in v1?** The plan scopes `upload_ids` to `page_uploads` only
   (files dropped on an Uploads page). Note attachments (`note_attachments` table)
   are excluded from the picker. Is that acceptable for v1, or should the picker
   also surface the merged file list (like the Uploads page does)?

2. **Max file count in a single widget?** No hard limit is planned; the tile clips
   overflow. Should there be a cap (e.g., 20) to prevent extremely slow loads when
   the tile is small? If yes, enforce in `_loadUploadPreview` with a slice and a
   "…and N more" badge.

3. **Carousel auto-scroll?** The carousel style uses `overflow-x-auto`. Should it
   auto-play (rotate through files every N seconds) or be purely manual? Auto-play
   adds a `setInterval` which requires cleanup on page navigation — needs
   `_initSwappedPage` integration (like the clock widget) if desired.

4. **Lightbox on click?** Should clicking a thumbnail in the rendered widget open
   the file full-screen (reusing the Grid page's `home-page-grid-lightbox.js`
   `_gridLightboxOpen()`)? If yes, add `onclick="_gridLightboxOpen('{url}', '{mime}')"` 
   to image/video thumbnails. Confirm that `home-page-grid-lightbox.js` is
   loaded on Dashboard pages (currently it is only `require`d by Grid pages via
   `base.html`) before relying on it.

5. **`GET /home/pages` JSON support confirmed?** The `select-crm-pages` field
   type in `aw_refreshConfig` already makes this exact call — verify the response
   shape in `routers/home.py` before building `_uplPrevFetchPages()` against it.
   If the route returns HTML by default and only returns JSON for a specific
   `Accept` header, document that contract precisely.
