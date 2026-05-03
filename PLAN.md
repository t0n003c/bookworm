# Plan: Note Link Widget — Multiple Notes & Workspace Database Links
Date: 2026-05-02
Estimated complexity: Medium

---

## Summary

The `note_link` widget currently pins exactly one note. This plan upgrades it to an
**N-item link list** that can hold any mix of notes (opened via popup / sidebar /
workspace) and workspace database links (navigated via `wsSingleClick`). The config
JSON shape is extended from a flat single-note object to an `items` array. Full
backward-compatibility is maintained: old `note_id`-keyed configs are silently
normalised at render time in both the Jinja2 template and the JS settings panel, and
are permanently migrated to the new shape the first time the user saves.
**No DB migration is needed** — the change lives entirely inside the existing
`config_json TEXT` column.

---

## Files to Change

Touch in this exact order to avoid dependency issues.

| # | File | What changes |
|---|---|---|
| 1 | `routers/home.py` | Add `GET /home/workspaces-for-picker` JSON endpoint |
| 2 | `templates/partials/home_page.html` | Rewrite `render_note_link` macro: normalise config, render scrollable item list |
| 3 | `static/js/home-widgets.js` | Update `WIDGET_CONFIG_FIELDS['note_link']` to use new `link-list-editor` field type |
| 4 | `static/js/home-widgets-settings.js` | Add `link-list-editor` handler + helper functions; retire `_saveNoteLinkSettings` |

---

## New Files to Create

*None.* All changes are additive edits inside existing files.

---

## DB Migrations Needed

**None.** `home_widgets.config_json` is an untyped `TEXT` column. The shape change is
purely application-level. Existing widgets keep their old JSON untouched; the app
normalises it on every read.

---

## New Config Shape

### New (v2) — written to DB after first settings save
```json
{
  "items": [
    { "type": "note",      "id": 42, "title": "Sprint Notes", "snippet": "First line…" },
    { "type": "workspace", "id": 7,  "name":  "Grocery DB",   "emoji": "🛒", "ws_type": "database" }
  ],
  "open_mode": "popup",
  "col_span": 1,
  "row_span": 1
}
```

### Legacy (v1) — still in DB for existing widgets, must still render
```json
{ "note_id": 42, "note_title": "Sprint Notes", "note_snippet": "...", "open_mode": "popup" }
```

### Normalisation rule (apply in BOTH template and JS)
```
if config.items exists → use it
else if config.note_id exists → wrap it: [{type:'note', id:note_id, title:note_title, snippet:note_snippet}]
else → empty list []
```

---

## Detailed Changes

### 1 · `routers/home.py` — new picker endpoint

Add **after** the existing `list_pages_json` route and **before** any
`/pages/{page_id}` wildcard route (to avoid route shadowing):

```python
@router.get("/workspaces-for-picker")
async def workspaces_for_picker(request: Request):
    """Return the user's workspaces for the note-link widget's workspace picker.
    Intentionally separate from /home/pages (which returns home pages, not workspaces).
    """
    uid = _uid(request)
    wss = await get_all_workspaces(uid)
    return JSONResponse([
        {"id": w["id"], "name": w["name"],
         "emoji": w.get("emoji") or "",
         "ws_type": w.get("ws_type") or "workspace"}
        for w in wss
    ])
```

`get_all_workspaces` is already imported at line 37.
`JSONResponse` is already imported via `starlette.responses`.
Route is inside the `/home` router (auth-gated by middleware) — **no `_PUBLIC` entry
needed**.

---

### 2 · `templates/partials/home_page.html` — rewrite `render_note_link` macro

Macro starts at ~line 418. Full replacement of the macro body between the
`{% macro render_note_link(w) %}` and `{% endmacro %}` tags.

#### Step A — Normalise config into a unified `_items` list at top of macro

```jinja
{% macro render_note_link(w) %}
{%- set _raw = w.config.get('items', none) -%}
{#- Backward-compat: old single-note shape stores note_id at top level -#}
{%- if _raw is none and w.config.get('note_id') -%}
  {%- set _raw = [{'type': 'note'                 'id':      w.config.get('note_id'),
                   'title':   w.config.get('note_title', 'Linked Note'),
                   'snippet': w.config.get('note_snippet', '')}] -%}
{%- elif _raw is none -%}
  {%- set _raw = [] -%}
{%- endif -%}
{%- set _items    = _raw -%}
{%- set open_mode = w.config.get('open_mode', 'popup') -%}
```

#### Step B — SVG icon definitions

Keep the existing `_doc_icon` setblock unchanged. Add a `_db_icon` setblock for
workspace items (use a simple table/rows SVG):

```jinja
{% set _db_icon %}
<svg class="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="1.75" aria-hidden="true">
  <path stroke-linecap="round" stroke-linejoin="round"
        d="M3 10h18M3 6h18M3 14h18M3 18h18"/>
</svg>
{% endset %}
```

#### Step C — "Manage links" button (replaces old "Change note" button)

```jinja
{% set _manage_btn %}
<button type="button"
        onclick="openWidgetSettings({{ w.id }}, 'Note', '📄')"
        class="mt-1.5 flex items-center gap-1 text-[11px]
               text-gray-400 dark:text-zinc-500
               hover:text-wblue dark:hover:text-blue-400 transition">
  <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.5" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992
             m-4.993 0 3.181 3.183a8.25 8.25 0 0013.803-3.7
             M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
  </svg>
  Manage links
</button>
{% endset %}
```

#### Step D — Empty-state CTA (update copy only)

Replace "Pick a note" with "Add links" and the subtitle with
"Pin notes & databases".

#### Step E — Scrollable item list (used in BOTH minimal and card branches)

Replace the existing single-button body with:

```jinja
{# item list ── scrollable, max ~5 rows ───────────────────────────── #}
<div class="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 space-y-0.5">
  {% for item in _items %}
  {% if item.get('type') == 'workspace' %}
  <button type="button"
          onclick="wsSingleClick({{ item.id }})"
          class="flex items-center gap-2.5 w-full text-left group/nli
                 px-2 py-1.5 rounded-lg
                 hover:bg-gray-50 dark:hover:bg-zinc-800/70 transition"
          aria-label="Open {{ item.get('name', 'Workspace') | e }}">
    <span class="flex-shrink-0 text-gray-300 dark:text-zinc-600
                 group-hover/nli:text-wblue dark:group-hover/nli:text-blue-400 transition">
      {% if item.get('emoji') %}
        <span class="text-base leading-none" aria-hidden="true">{{ item.emoji }}</span>
      {% else %}
        {{ _db_icon }}
      {% endif %}
    </span>
    <span class="flex-1 min-w-0 text-sm font-medium truncate
                 text-gray-700 dark:text-zinc-300
                 group-hover/nli:text-wblue dark:group-hover/nli:text-blue-400 transition">
      {{ item.get('name', 'Workspace') | e }}
    </span>
    {% if item.get('ws_type') == 'database' %}
    <span class="flex-shrink-0 text-[9px] font-semibold uppercase tracking-wide
                 px-1 py-0.5 rounded bg-gray-100 dark:bg-zinc-800
                 text-gray-400 dark:text-zinc-500">DB</span>
    {% endif %}
  </button>
  {% else %}
  {# Note item #}
  <button type="button"
          onclick="openNotePreview({{ w.id }}, {{ item.get('id') }}, '{{ open_mode }}')"
          class="flex items-center gap-2.5 w-full text-left group/nli
                 px-2 py-1.5 rounded-lg
                 hover:bg-gray-50 dark:hover:bg-zinc-800/70 transition"
          aria-label="Open note {{ item.get('title', 'Note') | e }}">
    <span class="flex-shrink-0 text-gray-300 dark:text-zinc-600
                 group-hover/nli:text-wblue dark:group-hover/nli:text-blue-400 transition">
      {{ _doc_icon }}
    </span>
    <span class="flex-1 min-w-0 text-sm font-medium truncate
                 text-gray-700 dark:text-zinc-300
                 group-hover/nli:text-wblue dark:group-hover/nli:text-blue-400 transition">
      {{ item.get('title', 'Note') | e }}
    </span>
    <svg class="w-3.5 h-3.5 flex-shrink-0 text-gray-300 dark:text-zinc-600
                group-hover/nli:text-wblue dark:group-hover/nli:text-blue-400
                group-hover/nli:translate-x-0.5 transition"
         viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
         aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
    </svg>
  </button>
  {% endif %}
  {% endfor %}
</div>
```

Follow the list with `{{ _manage_btn }}` (populated state) or `{{ _empty_cta }}`
(empty state — `_items | length == 0`).

The `minimal` and `card` style branches both use this same item-list block.
The `card` style previously showed `note_snippet` as a subtitle — **drop this** since
compact rows don't have space for it, and multiple items would make it cluttered.

**⚠️ No `<script>` blocks.** The macro is pure Jinja2 HTML.

---

### 3 · `static/js/home-widgets.js` — update `WIDGET_CONFIG_FIELDS['note_link']`

Location: lines 857–861. Replace the `note_link` lambda:

```javascript
  note_link: () => [
    { id: 'cf-links',    label: 'Links',        type: 'link-list-editor', name: 'items' },
    { id: 'cf-openmode', label: 'Open notes as', type: 'select',          name: 'open_mode',
      options: [['popup','💬 Popup modal'],['sidebar','📌 Slide-in sidebar'],['workspace','🗂️ Workspace']] },
  ],
```

`open_mode` continues to be saved by the existing `saveWidgetSettings()` scan.
It applies only to note items; workspace items always call `wsSingleClick`.

---

### 4 · `static/js/home-widgets-settings.js`

#### 4-A. Module-level state (add near top of file; must use `var`)

```javascript
// ── note-link multi-item editor state ─────────────────────────────────────────
var _nlWsCache  = null;   // fetched workspace list; null = not yet loaded
var _nlItems    = [];     // working copy of the items array for the current editor
```

#### 4-B. `link-list-editor` branch inside `_buildFieldsForType`

Add as an `else if` after the `upload-picker` branch (around line 468), before the
fallback `<input>`:

```javascript
} else if (f.type === 'link-list-editor') {
  // Normalise legacy config → items array
  var rawCfg   = _getCardConfig(widgetId);
  var legacyIt = rawCfg.note_id
    ? [{type:'note', id:rawCfg.note_id,
        title:rawCfg.note_title||'Note', snippet:rawCfg.note_snippet||''}]
    : [];
  _nlItems = Array.isArray(rawCfg.items) ? rawCfg.items.slice() : legacyIt;

  wrap.innerHTML = lbl
    + '<input type="hidden" id="' + f.id + '"'
    + ' data-cfg-key="' + f.name + '" data-json="1" value=\'\'>'
    + '<div id="nl-editor-list" class="space-y-0.5 mb-2 max-h-40 overflow-y-auto"></div>'
    + '<div class="flex gap-2 mt-1">'
    +   '<select id="nl-note-picker"'
    +     ' class="flex-1 text-xs border border-gray-200 dark:border-zinc-700 rounded-lg'
    +             ' px-2 py-1.5 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    +             ' focus:outline-none focus:ring-2 focus:ring-wblue"'
    +     ' onchange="_nlPickNote(' + widgetId + ',this)">'
    +     '<option value="">＋ Add note…</option>'
    +   '</select>'
    +   '<select id="nl-ws-picker"'
    +     ' class="flex-1 text-xs border border-gray-200 dark:border-zinc-700 rounded-lg'
    +             ' px-2 py-1.5 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    +             ' focus:outline-none focus:ring-2 focus:ring-wblue"'
    +     ' onchange="_nlPickWorkspace(' + widgetId + ',this)">'
    +     '<option value="">＋ Add workspace…</option>'
    +   '</select>'
    + '</div>';
  body.appendChild(wrap);
  _nlRefreshEditor(widgetId);      // render list rows + sync hidden input
  _nlRefreshNotePicker();          // populate note dropdown from DOM cache (sync)
  _nlLoadWorkspaces(widgetId);     // populate workspace dropdown (async fetch)
  return;
```

#### 4-C. Seven helper functions (add after the removed `_saveNoteLinkSettings`)

All functions use `var`-safe style (no `const`/`let` at function scope).

```javascript
// ── note-link multi-item editor helpers ──────────────────────────────────────

/** Re-render the visible item rows and sync the hidden JSON input. */
function _nlRefreshEditor(widgetId) {
  var list = document.getElementById('nl-editor-list');
  var inp  = document.getElementById('cf-links');
  if (!list || !inp) return;
  inp.value = JSON.stringify(_nlItems);
  if (!_nlItems.length) {
    list.innerHTML =
      '<p class="text-xs text-gray-400 dark:text-zinc-500 italic py-1">No links yet.</p>';
    return;
  }
  list.innerHTML = _nlItems.map(function(item, idx) {
    var icon  = item.type === 'workspace' ? (item.emoji || '🗂️') : '📄';
    var label = item.type === 'workspace'
      ? (item.name || 'Workspace') + (item.ws_type === 'database' ? ' (DB)' : '')
      : (item.title || 'Note');
    return '<div class="flex items-center gap-1.5 py-1 px-1.5 rounded'
      + ' bg-gray-50 dark:bg-zinc-800/60 text-xs text-gray-700 dark:text-zinc-300">'
      + '<span class="flex-shrink-0" aria-hidden="true">' + _esc(icon) + '</span>'
      + '<span class="flex-1 min-w-0 truncate">' + _esc(label) + '</span>'
      + '<button type="button" onclick="_nlRemoveItem(' + widgetId + ',' + idx + ')"'
      + ' class="flex-shrink-0 text-gray-300 dark:text-zinc-600'
      + ' hover:text-[#ea1100] transition leading-none text-sm"'
      + ' aria-label="Remove">&times;</button>'
      + '</div>';
  }).join('');
}

/** Populate the note picker from the all-notes-data DOM script tag (no fetch). */
function _nlRefreshNotePicker() {
  var sel    = document.getElementById('nl-note-picker');
  if (!sel) return;
  var cached = document.getElementById('all-notes-data');
  var notes  = cached ? JSON.parse(cached.textContent || '[]') : [];
  sel.innerHTML = '<option value="">＋ Add note…</option>'
    + notes.map(function(n) {
        var t = _escAttr(n.title || 'Untitled');
        var s = _escAttr((n.content || '').replace(/<[^>]*>/g,'').slice(0, 120));
        return '<option value="' + n.id + '"'
          + ' data-title="' + t + '" data-snippet="' + s + '">' + t + '</option>';
      }).join('');
}

/** Fetch workspaces from /home/workspaces-for-picker (cached per JS session). */
function _nlLoadWorkspaces(widgetId) {
  if (_nlWsCache !== null) { _nlRefreshWsPicker(); return; }
  fetch('/home/workspaces-for-picker', {credentials:'same-origin'})
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(data) { _nlWsCache = data; _nlRefreshWsPicker(); })
    .catch(function(e) { console.warn('workspaces-for-picker failed:', e); });
}

/** Populate the workspace picker from the cache. */
function _nlRefreshWsPicker() {
  var sel = document.getElementById('nl-ws-picker');
  if (!sel || !_nlWsCache) return;
  sel.innerHTML = '<option value="">＋ Add workspace…</option>'
    + _nlWsCache.map(function(w) {
        var badge   = w.ws_type === 'database' ? ' (DB)' : '';
        var display = _escAttr((w.emoji ? w.emoji + ' ' : '') + w.name + badge);
        return '<option value="' + w.id + '"'
          + ' data-name="'   + _escAttr(w.name)    + '"'
          + ' data-emoji="'  + _escAttr(w.emoji)   + '"'
          + ' data-wstype="' + _escAttr(w.ws_type) + '">'
          + display + '</option>';
      }).join('');
}

/** Add a note item; called from nl-note-picker onchange. */
function _nlPickNote(widgetId, sel) {
  var opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  if (_nlItems.length >= 10) {
    if (typeof _bwToast === 'function') _bwToast('Max 10 links per widget.', 'warning');
    sel.selectedIndex = 0;
    return;
  }
  _nlItems.push({type:'note', id:+opt.value,
    title:opt.dataset.title||opt.text, snippet:opt.dataset.snippet||''});
  sel.selectedIndex = 0;
  _nlRefreshEditor(widgetId);
}

/** Add a workspace item; called from nl-ws-picker onchange. */
function _nlPickWorkspace(widgetId, sel) {
  var opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  if (_nlItems.length >= 10) {
    if (typeof _bwToast === 'function') _bwToast('Max 10 links per widget.', 'warning');
    sel.selectedIndex = 0;
    return;
  }
  _nlItems.push({type:'workspace', id:+opt.value,
    name:opt.dataset.name||opt.text, emoji:opt.dataset.emoji||'',
    ws_type:opt.dataset.wstype||'workspace'});
  sel.selectedIndex = 0;
  _nlRefreshEditor(widgetId);
}

/** Remove an item by index. */
function _nlRemoveItem(widgetId, idx) {
  _nlItems.splice(idx, 1);
  _nlRefreshEditor(widgetId);
}
```

#### 4-D. Delete `_saveNoteLinkSettings` (lines 735–756)

This function is no longer called — the `onchange` that invoked it was on the old
single-`select-notes` dropdown, which is removed in step 4-B. The new path is:
picker `onchange` → `_nlPickNote` / `_nlPickWorkspace` → `_nlRefreshEditor` (syncs
hidden input) → user clicks "Save" in the settings panel → `saveWidgetSettings()` →
reads `[data-cfg-key="items"][data-json="1"]` → calls `_saveWidgetFullConfig`.

#### 4-E. `saveWidgetSettings` — no changes needed

The existing loop already handles `el.dataset.json`:
```javascript
if (el.dataset.json) {
  config[el.dataset.cfgKey] = JSON.parse(el.value || '[]');
}
```
The hidden `<input data-cfg-key="items" data-json="1">` fits this pattern exactly.

---

## Skills to Invoke

| When | Skill | Why |
|---|---|---|
| After steps 2 + 4 | `bookworm-template-audit` | Verify no `let`/`const` in partials; confirm `tojson \| e` usage; check Tailwind classes present in compiled CSS |
| After all steps | `bookworm-qa` | Test old-config widget (legacy normalisation), new multi-item widget (notes + workspace), workspace navigation from card |
| Before commit | `bookworm-pre-commit` | Standard gate |
| After commit | `bookworm-docs-keeper` | Update CODEPUPPY_NOTES.md widget table: `note_link` now has `items[]` config shape |

---

## BookWorm Gotchas That Apply to This Feature

**Quirk #13 — `var` not `let`/`const` in HTMX-reinjected partial `<script>` blocks.**
The new template macro has **no `<script>` blocks** (correct). The new module-level
vars in `home-widgets-settings.js` use `var` as required. Do not use `const`/`let`
at the top level of any new functions that could end up in an HTMX partial.

**`tojson | e` in the card macro.**
`data-widget-config='{{ _wcfg | tojson | e }}'` (line 81 of `home_page.html`) is
already inside the `card()` macro and is NOT touched by this change. The `render_note_link`
macro must NOT write its own `data-widget-config` attribute — the card macro handles this.

**`wsSingleClick` is in `index.html`, not a `.js` file.**
`wsSingleClick` is defined inside a `<script>` block in `templates/index.html`
(line ~3109). It is always available on home pages (where the widget renders). Call it
directly from the `onclick` attribute in the template — do not redefine it.

**Workspace picker fetch requires session cookie.**
`fetch('/home/workspaces-for-picker', {credentials:'same-origin'})` — the
`credentials:'same-origin'` is mandatory. The route is NOT in `_PUBLIC`.

**`rebuild_css.bat` if new Tailwind classes are absent.**
New classes introduced: `max-h-40`, `overflow-y-auto`, `space-y-0.5`, `text-[9px]`.
Before shipping, grep `static/css/tailwind.css` for each. If any are missing, run
`rebuild_css.bat` (Windows) and commit the updated `static/css/tailwind.css`.
(`max-h-40` and `overflow-y-auto` are very likely already present from other widgets.)

**`_escAttr` is already defined in `home-widgets-settings.js`.**
Confirmed at line ~461. Safe to use in the new helpers.

**`_bwToast` is globally available (defined in `home-widgets.js` line 27).**
The 10-item cap toast uses `if (typeof _bwToast === 'function')` guard as a safety net.

---

## Implementation Checklist

- [ ] **1.** `routers/home.py` — add `GET /home/workspaces-for-picker` after `list_pages_json`, before the `pages/{page_id}` wildcard. Confirm `get_all_workspaces` import is on line 37 and `JSONResponse` is imported.
- [ ] **2.** `templates/partials/home_page.html` — open the file and locate `render_note_link` macro (~line 418). Replace the entire macro body with: (A) config normalisation block, (B) `_doc_icon` + new `_db_icon` setblocks, (C) `_manage_btn` setblock, (D) updated `_empty_cta` copy, (E) scrollable `{% for item in _items %}` list, (F) footer with `_manage_btn` / `_empty_cta` conditional. Keep minimal and card style branches.
- [ ] **3.** `templates/partials/home_page.html` — verify the `for` loop generates syntactically valid HTML with no unclosed tags. Test with a legacy config widget (one note) AND a fresh widget (0 items).
- [ ] **4.** `static/js/home-widgets.js` — replace `note_link: () => [...]` at lines 857–861 with the two-field spec (`link-list-editor` + `open_mode` select).
- [ ] **5.** `static/js/home-widgets-settings.js` — add `var _nlWsCache = null;` and `var _nlItems = [];` near top of file (alongside other module state vars).
- [ ] **6.** `static/js/home-widgets-settings.js` — add `link-list-editor` `else if` branch in `_buildFieldsForType` (after `upload-picker` branch, before fallback text input).
- [ ] **7.** `static/js/home-widgets-settings.js` — add the 7 helper functions: `_nlRefreshEditor`, `_nlRefreshNotePicker`, `_nlLoadWorkspaces`, `_nlRefreshWsPicker`, `_nlPickNote`, `_nlPickWorkspace`, `_nlRemoveItem`.
- [ ] **8.** `static/js/home-widgets-settings.js` — delete `_saveNoteLinkSettings` function entirely (lines ~735–756).
- [ ] **9.** Grep `static/css/tailwind.css` for `max-h-40`, `space-y-0`, `text-\[9px\]` — if absent, run `rebuild_css.bat` and commit updated CSS.
- [ ] **10.** Smoke-test **legacy widget**: load a home page with an existing `note_link` widget that has `note_id` config. Confirm: (a) single note row renders, (b) opening settings shows it as a one-item list with a remove button, (c) adding a second note and saving persists the new `items` shape.
- [ ] **11.** Smoke-test **new multi-item widget**: create a fresh note_link widget. Add 2 notes + 1 workspace database. Save. Reload page — all 3 rows appear.
- [ ] **12.** Smoke-test **workspace navigation**: click a workspace row in the widget card. Confirm `wsSingleClick` fires, home canvas exits, workspace loads.
- [ ] **13.** Smoke-test **10-item cap**: try to add an 11th item — confirm the `_bwToast` warning fires and the item is not added.
- [ ] **14.** Run `bookworm-template-audit` — provide: files changed (`home_page.html`, `home-widgets-settings.js`), new endpoint URL, what was modified.
- [ ] **15.** Run `bookworm-qa` — provide: new endpoint `/home/workspaces-for-picker`, legacy widget ID and new multi-item widget ID, all 3 smoke-test scenarios.
- [ ] **16.** Run `bookworm-pre-commit`.
- [ ] **17.** Commit with message: `feat: note_link widget supports multiple notes and workspace database links`.
- [ ] **18.** Run `bookworm-docs-keeper` to update CODEPUPPY_NOTES.md (`note_link` widget table row, config shape).

---

## Open Questions

1. **Item cap:** Plan proposes 10. Is this the right number? If most users have <5 links
   per widget, a lower cap (6–8) avoids scrollbar for typical use. Eddie to confirm.

2. **Duplicate items:** Current plan allows the same note to be added twice. Simple to
   allow; annoying if accidental. To block duplicates, filter the pickers in
   `_nlRefreshNotePicker` / `_nlRefreshWsPicker` to exclude already-added IDs.
   Decision needed before coding step 6.

3. **Widget header label:** The widget header currently shows "Note" / 📄. With mixed
   content, "Links" is more accurate. This is the text passed to `widget_header(w, 'Note', '📄')`.
   Changing it to `'Links', '🔗'` is a one-word edit but is a visible UX change.
   Confirm with the requester.

4. **`open_mode` applies only to notes:** Workspace items always use `wsSingleClick`.
   The settings label "Open notes as" communicates this. If it's confusing, add a
   `(notes only)` suffix in the field label object.

5. **Style variants:** Only `default` and `minimal` styles are in the CODEPUPPY_NOTES.md
   widget table. Confirm no other `note_link` styles exist in production DB before
   removing or simplifying the `else` branch in the macro.
