# Plan: CRM Phase 3 — Filter/Sort/Group + New Field Types
Date: 2026-04-12
Estimated complexity: Medium

> **How to use this file:** This is an addendum to PLAN.md (which covers CRM Phases 1 & 2).
> Implement Feature A and Feature B independently — they share only one file (`home-page-crm.js`)
> but have zero ordering dependency between them. Feature B is slightly smaller; do it first
> to get the field-type foundation right before building the sort/filter dropdowns that reference
> field types.

---

## Summary

Two independent enhancements to the CRM Homespace page.

**Feature A — Filter / Sort / Group** adds a compact toolbar row below the existing
search/view-toggle bar. Users can sort contacts (by name, company, or any custom field A→Z/Z→A),
filter contacts (by company value or custom field value from a dropdown of unique values in the
dataset), and group contacts under collapsible section headers in both Table and Gallery views.
All processing is **fully client-side** — `field_values` are already embedded in `_crmContacts`
by the existing `_attach_field_values()` query. Zero new API endpoints.

**Feature B — New Field Types: Checkbox, Multi-select, File Links** extends the custom field
system with three new `field_type` values. Storage is already in place (`crm_contact_field_values.value`
is a TEXT column; `crm_custom_fields.options` already exists). The only backend change is
expanding `VALID_TYPES` in `home_crm.py`. All render/edit/serialize logic is JS-only.

---

## Pre-Implementation Discoveries — Do NOT Re-Investigate

These facts were confirmed by reading source before writing this plan.

| Fact | Confirmed In | Impact |
|---|---|---|
| `field_values: {field_id: value}` is on every contact object returned by `GET /contacts` | `home_crm_db.py` `_attach_field_values()` — single JOIN, not N+1 | Feature A: **zero API changes** |
| `crm_custom_fields.options TEXT NOT NULL DEFAULT ''` already exists in the live schema | `database.py` line ~435 (`CREATE TABLE IF NOT EXISTS crm_custom_fields`) | Feature B: **zero DB migrations** |
| `add_field`, `update_field`, `get_fields` already pass `options` column through unchanged | `home_crm_db.py` | Feature B DB layer is complete |
| `create_field` and `edit_field` endpoints already accept `options: str = Form("")` | `home_crm.py` lines ~155, ~177 | Feature B router change = update `VALID_TYPES` only |
| Existing `select` type stores options as pipe-separated string: `"Low\|Med\|High"` | `home-page-crm.js` `crmToggleOptions()` + `_crmContactModal()` | `multi_select` reuses pipe-sep for option *definitions*; stored *values* are JSON arrays |
| `_crmContacts`, `_crmFields`, `_crmView`, `_crmQuery` are all `var` at module top | `home-page-crm.js` lines 17–22 | New state vars must also be `var` |
| No `_crmRenderFieldCell()` or `_crmEditFieldValue()` functions exist | Read full `home-page-crm.js` | Extension point is the `fieldVals` template literal inside `_crmRenderTable()` |
| Gallery view does NOT currently render custom field values | `home-page-crm.js` `_crmRenderGallery()` | Gallery group headers are the only custom-field touch for Feature A |
| `crmEditField()` currently shows an alert ("Full inline edit coming soon") | `home-page-crm.js` line ~402 | Feature B must replace this with a real edit sub-form |
| `crmSaveContact()` uses `data.get('cf_' + f.id)` for every field uniformly | `home-page-crm.js` lines ~282–295 | `multi_select` needs `data.getAll()`; `checkbox` needs explicit `'0'` on null |
| `VALID_TYPES` is defined identically in both `create_field` AND `edit_field` | `home_crm.py` — two separate `VALID_TYPES = {...}` literals | Must update **both** — easy to miss the second one |

---

## Files to Change — Feature A (Filter / Sort / Group)

| # | File | What changes |
|---|---|---|
| 1 | `templates/partials/home_page_crm.html` | Add one empty `<div id="crm-toolbar">` between search bar row and `#crm-main` |
| 2 | `static/js/home-page-crm.js` | New state vars; `_crmRenderToolbar()`; `crmSetSort/Filter/Group()`; rename `_crmFiltered()` → `_crmProcessed()` with full pipeline; update table + gallery renderers for group shape |

## Files to Change — Feature B (New Field Types)

| # | File | What changes |
|---|---|---|
| 1 | `routers/home_crm.py` | Expand `VALID_TYPES` in `create_field` and `edit_field` (both occurrences) |
| 2 | `static/js/home-page-crm.js` | `TYPE_LABELS` + `typeOpts` + `crmToggleOptions()` + `_crmContactModal()` field rendering + `crmSaveContact()` serialization + new `_crmFieldDisplay()` helper + `_crmRenderTable()` cell update + real `crmEditField()` |

## New Files to Create

None.

---

## DB Migrations Needed

**None for either feature.**

- Feature A is pure client-side.
- Feature B: `crm_custom_fields.options` already exists. `crm_contact_field_values.value`
  (existing `TEXT NOT NULL DEFAULT ''`) stores checkbox `"1"/"0"`, multi_select
  `'["A","B"]'`, and file_links `'["https://..."]'` as-is.

> ⚠️ CRITICAL: Do NOT add `ALTER TABLE crm_custom_fields ADD COLUMN options` —
> the column already exists. That statement would throw `duplicate column name: options`
> and crash `init_db()` on startup.

---

## Feature A — JS Architecture

### New module-level state vars
Add immediately after `var _crmQuery = '';` (line 22):

```js
var _crmSort   = '';  // '' | 'name_az' | 'name_za' | 'company_az' | 'company_za' | 'field_{id}_az' | 'field_{id}_za'
var _crmFilter = {};  // {} | {company:'Acme'} | {field_123:'Value'} — one key max
var _crmGroup  = '';  // '' | 'company' | 'field_{id}'
```

Persisted to localStorage: `bw_crm_sort` (string), `bw_crm_filter` (JSON string), `bw_crm_group` (string).

### `initCrmPage()` additions
After `_crmQuery = '';`, before `_crmLoadAll()`:

```js
_crmSort   = localStorage.getItem('bw_crm_sort')   || '';
_crmFilter = JSON.parse(localStorage.getItem('bw_crm_filter') || '{}');
_crmGroup  = localStorage.getItem('bw_crm_group')  || '';
```

Reset-then-read pattern: always assign default before reading localStorage (defensive against
corrupt storage values from old app versions).

### Template change — `home_page_crm.html`
Find the existing search bar `<div>` and the `<div id="crm-main">`. Between them, insert:

```html
<div id="crm-toolbar" class="px-4 pb-2 flex flex-wrap items-center gap-2"></div>
```

No `<script>` inside the template (Quirk #13). The div is empty — `_crmRenderToolbar()` fills it.

### `_crmRenderToolbar()` — new function
Injects into `#crm-toolbar`. Called at the end of `_crmLoadAll()` success path (after
`_crmFields` is populated) and by each `crmSet*()` function.

Layout: `[ Sort ▾ ]  [ Filter ▾ ]  [ Group ▾ ]  [✕ Clear]`

**Sort `<select>` options:**
- `""` → "— Sort —"
- `"name_az"` → "Name A→Z", `"name_za"` → "Name Z→A"
- `"company_az"` → "Company A→Z", `"company_za"` → "Company Z→A"
- For each `f` in `_crmFields`: `"field_{f.id}_az"` → "{f.label} A→Z", `"field_{f.id}_za"` → "{f.label} Z→A"
- Current `_crmSort` value pre-selected.

**Filter `<select>` options:**
- `""` → "— Filter —"
- For unique non-empty company values across `_crmContacts`: `"company:{val}"` → "Company: {val}"
- For each field where `field_type !== 'file_links'`:
  - Collect unique values across `_crmContacts` for that field.
  - For `multi_select`: parse JSON array, fan out individual options into the unique-value set.
  - For `checkbox`: emit "Yes" and "No" options (not "1"/"0").
  - Each unique value → `"field_{f.id}:{val}"` → "{f.label}: {val}"
- Current active filter pre-selected (encode as `"company:{val}"` or `"field_{id}:{val}"`).

**Group `<select>` options:**
- `""` → "— Group —"
- `"company"` → "By Company"
- For each field where `field_type` is `text`, `select`, `multi_select`, or `checkbox`:
  `"field_{f.id}"` → "By {f.label}"
- `file_links` fields are excluded (grouping by URL is meaningless).

**Clear button:**
- Text: `"✕ Clear filters"` when any of `_crmSort`, `_crmFilter` (non-empty object), `_crmGroup` is active.
- Blue dot badge or highlighted border when active.
- `onclick="crmClearFilters()"` → resets all three, clears localStorage keys, re-renders.

### `crmSetSort(v)`, `crmSetFilter(v)`, `crmSetGroup(v)` — new public functions

```js
function crmSetSort(v) {
  _crmSort = v;
  localStorage.setItem('bw_crm_sort', v);
  _crmRenderToolbar();
  _crmRender();
}
// crmSetFilter and crmSetGroup follow same pattern.
// crmSetFilter must parse the "company:{val}" / "field_{id}:{val}" encoding:
//   if v === '' → _crmFilter = {}
//   else if v starts with 'company:' → _crmFilter = {company: v.slice(8)}
//   else parse 'field_{id}:{val}' → _crmFilter = {['field_' + id]: val}
// Persist as JSON.stringify(_crmFilter).
```

### Rename `_crmFiltered()` → `_crmProcessed()`
Return type changes based on `_crmGroup`:
- `_crmGroup === ''` → returns `contact[]` (flat array, same shape as before)
- `_crmGroup !== ''` → returns `{key, label, contacts[]}[]` (array of group objects)

Both `_crmRenderTable()` and `_crmRenderGallery()` detect the shape by checking
`Array.isArray(result) && result.length > 0 && result[0].contacts !== undefined`.

**Pipeline (in order):**

1. **Text search** — existing logic (`[name, email, phone, company, tags]`) PLUS
   extend to `Object.values(c.field_values || {}).join(' ')` so custom field text is searchable.

2. **Dropdown filter** — read `_crmFilter`:
   - `{company: val}` → keep contacts where `(c.company||'').toLowerCase() === val.toLowerCase()`
   - `{field_N: val}`:
     - `checkbox`: match contacts where stored value is `'1'` when filter val is `'Yes'`, `'0'`/empty for `'No'`
     - `multi_select`: parse `c.field_values[N]` as JSON array, keep if `includes(val)`
     - others: case-insensitive equality match

3. **Sort** — read `_crmSort`, apply `localeCompare` to the appropriate key:
   - `name_az/za`, `company_az/za` → sort on `c.name` / `c.company`
   - `field_{id}_az/za` → sort on `(c.field_values||{})[id]||''`
     - `checkbox` sort: `'1'` sorts before `'0'`
     - `multi_select` sort: use first JSON-parsed value alphabetically

4. **Group** — read `_crmGroup`:
   - `''` → return flat array (done)
   - `'company'` → group key = `c.company||'(No Company)'`
   - `'field_{id}'`:
     - For normal types: group key = `(c.field_values||{})[id]||'(Empty)'`
     - For `multi_select`: **fan-out** — each contact clones into one group per selected value;
       contacts with no selection go into `'(Empty)'`
     - For `checkbox`: group keys are `'Yes'` (`val==='1'`) and `'No'` (`val!=='1'`)
   - Sort groups alphabetically by key; push `'(No Company)'`, `'(Empty)'`, `'No'` to end.
   - Return `[{key, label, contacts:[]}]` where `label === key`.

### Table group rendering
When `_crmProcessed()` returns group objects, `_crmRenderTable()` iterates groups and
prepends a sticky group header `<tr>` before each group's rows:

```html
<tr class="bg-gray-50 dark:bg-zinc-800/70 sticky top-0 z-10">
  <td colspan="{totalCols}"
      class="px-3 py-1.5 text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase tracking-wider border-b border-gray-200 dark:border-zinc-700">
    {groupLabel}
    <span class="font-normal ml-1 text-gray-400 dark:text-zinc-500">({count})</span>
  </td>
</tr>
```

`totalCols` = 6 (emoji + name + company + email + phone + tags) + `_crmFields.length` + 1 (actions).

### Gallery group rendering
When grouping active, outer container switches from single grid to stacked sections:

```html
<div class="col-span-full mt-4 first:mt-0">
  <h3 class="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mb-3 pb-1 border-b border-gray-100 dark:border-zinc-800">
    {groupLabel}
    <span class="font-normal ml-1">({count})</span>
  </h3>
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
    {cards for this group}
  </div>
</div>
```

---

## Feature B — Detailed Change Specs

### `routers/home_crm.py` — update VALID_TYPES (2 places)

Search for: `VALID_TYPES = {"text", "select", "url", "date", "number"}`

There are **two identical literals** — one in `create_field`, one in `edit_field`. Replace both with:

```python
VALID_TYPES = {"text", "select", "url", "date", "number",
               "checkbox", "multi_select", "file_links"}
```

No other Python changes needed.

### `home-page-crm.js` changes

#### 1. `TYPE_LABELS` in `crmOpenFields()` — add 3 entries

Current: `{text:'Text', select:'Select', url:'URL', date:'Date', number:'Number'}`

Add: `checkbox: 'Checkbox', multi_select: 'Multi-select', file_links: 'File Links'`

#### 2. `typeOpts` in `crmOpenFields()` — extend the hardcoded type list

Current array: `['text','select','url','date','number']`

Replace with a list of `{value, label}` pairs and build options as:

```js
var _ALL_FIELD_TYPES = [
  {value:'text',         label:'Text'},
  {value:'select',       label:'Select'},
  {value:'url',          label:'URL'},
  {value:'date',         label:'Date'},
  {value:'number',       label:'Number'},
  {value:'checkbox',     label:'Checkbox'},
  {value:'multi_select', label:'Multi-select'},
  {value:'file_links',   label:'File Links'},
];
var typeOpts = _ALL_FIELD_TYPES.map(function(t) {
  return '<option value="' + t.value + '">' + t.label + '</option>';
}).join('');
```

Declare `_ALL_FIELD_TYPES` as a `var` at module level (not inside `crmOpenFields`) so it
can be reused by `_crmRenderToolbar()` for building the sort dropdown.

#### 3. `crmToggleOptions()` — show options input for `multi_select` too

```js
function crmToggleOptions(sel) {
  var el = document.getElementById('crm-field-options');
  if (!el) return;
  el.style.display = (sel.value === 'select' || sel.value === 'multi_select') ? 'block' : 'none';
}
```

Placeholder text on the options input is already correct ("Options (pipe-separated)") — no change needed.

#### 4. `crmEditField(id)` — replace alert with real edit sub-form

Currently shows `alert('...')`. Replace entirely:

```js
function crmEditField(id) {
  var f = _crmFields.find(function(x) { return x.id === id; });
  if (!f) return;
  var TYPE_LABELS = {text:'Text', select:'Select', url:'URL', date:'Date', number:'Number',
                     checkbox:'Checkbox', multi_select:'Multi-select', file_links:'File Links'};
  var showOpts = (f.field_type === 'select' || f.field_type === 'multi_select');
  var body = '<div class="h-1.5 w-full bg-gradient-to-r from-[#0053e2] to-[#ffc220]"></div>'
    + '<div class="p-6">'
    + '<h2 class="text-base font-bold text-gray-900 dark:text-zinc-100 mb-4">✎ Edit Field</h2>'
    + '<form id="crm-field-form" onsubmit="crmSaveField(event,' + id + ')" class="space-y-3">'
    + '<div><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Label</label>'
    + '<input name="label" value="' + _crmEsc(f.label) + '" required'
    + '  class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm'
    + '  bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    + '  focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/></div>'
    + '<div><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Type (cannot change)</label>'
    + '<input name="field_type" value="' + _crmEsc(f.field_type) + '" readonly'
    + '  class="w-full border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm'
    + '  bg-gray-50 dark:bg-zinc-800/50 text-gray-500 dark:text-zinc-400 cursor-not-allowed"/></div>'
    + (showOpts
      ? '<div><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Options (pipe-separated)</label>'
        + '<input name="options" value="' + _crmEsc(f.options||'') + '" placeholder="Low|Medium|High"'
        + '  class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm'
        + '  bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
        + '  focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/></div>'
      : '<input name="options" type="hidden" value="' + _crmEsc(f.options||'') + '"/>')
    + '<p id="crm-field-err" class="hidden text-xs text-red-500"></p>'
    + '<div class="flex gap-2 justify-end pt-2">'
    + '<button type="button" onclick="crmOpenFields()"'
    + '  class="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-600'
    + '  text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">Cancel</button>'
    + '<button type="submit"'
    + '  class="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#0053e2] text-white hover:bg-blue-700 transition">Save</button>'
    + '</div></form></div>';
  _crmShowModal(body);
}
```

`crmSaveField(event, fieldId)` already handles the fieldId > 0 case (sends to `.../update`).

#### 5. `_crmContactModal()` — extend custom field rendering

The current field rendering block:

```js
if (f.field_type === 'select') {
  // ... select control ...
} else {
  control = inp('cf_' + f.id, val, ...);
}
```

Replace with a full type switch:

```js
if (f.field_type === 'select') {
  // existing select code — unchanged

} else if (f.field_type === 'checkbox') {
  var checked = val === '1' ? 'checked' : '';
  control = '<label class="flex items-center gap-2 cursor-pointer pt-1">'
    + '<input type="checkbox" name="cf_' + f.id + '" value="1" ' + checked
    + ' class="w-4 h-4 accent-[#0053e2]"/>'
    + '<span class="text-sm text-gray-700 dark:text-zinc-200">Enabled</span>'
    + '</label>';

} else if (f.field_type === 'multi_select') {
  var mSelected = [];
  try { mSelected = JSON.parse(val || '[]'); } catch(e) { mSelected = []; }
  var mOpts = (f.options || '').split('|').filter(Boolean);
  if (mOpts.length === 0) {
    control = '<p class="text-xs text-amber-600 dark:text-amber-400 py-1">'
      + 'No options defined — edit this field to add options.</p>';
  } else {
    control = '<div class="flex flex-col gap-1">'
      + mOpts.map(function(o) {
          var chk = mSelected.indexOf(o) !== -1 ? 'checked' : '';
          return '<label class="flex items-center gap-2">'
            + '<input type="checkbox" name="cf_' + f.id + '[]" value="' + _crmEsc(o) + '" ' + chk
            + ' class="w-4 h-4 accent-[#0053e2]"/>'
            + '<span class="text-sm text-gray-700 dark:text-zinc-200">' + _crmEsc(o) + '</span>'
            + '</label>';
        }).join('')
      + '</div>';
  }

} else if (f.field_type === 'file_links') {
  var fLines = [];
  try { fLines = JSON.parse(val || '[]'); } catch(e) { fLines = []; }
  control = '<textarea name="cf_' + f.id + '" rows="3" placeholder="One URL per line"'
    + ' class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm'
    + ' bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    + ' placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#0053e2]">'
    + _crmEsc(fLines.join('\n')) + '</textarea>';

} else {
  // existing default — text, url, date, number
  control = inp('cf_' + f.id, val, ...);
}
```

#### 6. `crmSaveContact()` — type-aware field value serialization

Replace the existing uniform `data.get('cf_' + f.id)` with:

```js
await Promise.all(_crmFields.map(function(f) {
  var rawVal;
  if (f.field_type === 'checkbox') {
    rawVal = data.get('cf_' + f.id) === '1' ? '1' : '0';
                                          // null (unchecked) → '0'
  } else if (f.field_type === 'multi_select') {
    var picks = data.getAll('cf_' + f.id + '[]');
    rawVal = JSON.stringify(picks);
  } else if (f.field_type === 'file_links') {
    var lines = (data.get('cf_' + f.id) || '').split('\n')
      .map(function(l) { return l.trim(); }).filter(Boolean);
    rawVal = JSON.stringify(lines);
  } else {
    rawVal = (data.get('cf_' + f.id) || '').trim();
  }
  var fBody = new URLSearchParams({field_id: f.id, value: rawVal});
  return _crmFetch('/home/crm/' + _crmPid + '/contacts/' + savedId + '/field-value',
    {method: 'POST', body: fBody}).catch(function() {});
}));
```

#### 7. New `_crmFieldDisplay(f, val)` helper function

Add as a standalone function (near `_crmEsc` at the bottom of the file):

```js
function _crmFieldDisplay(f, val) {
  if (!val && val !== '0') return '—';
  if (f.field_type === 'checkbox') {
    return val === '1'
      ? '<span class="text-green-600 dark:text-green-400 font-bold text-base">✓</span>'
      : '<span class="text-gray-300 dark:text-zinc-600">—</span>';
  }
  if (f.field_type === 'multi_select') {
    var items = [];
    try { items = JSON.parse(val); } catch(e) { items = val ? [val] : []; }
    if (!items.length) return '—';
    return items.map(function(i) {
      return '<span class="inline-block px-1.5 py-0.5 rounded text-[10px] mr-0.5 mb-0.5'
        + ' bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">'
        + _crmEsc(i) + '</span>';
    }).join('');
  }
  if (f.field_type === 'file_links') {
    var links = [];
    try { links = JSON.parse(val); } catch(e) { links = val ? [val] : []; }
    if (!links.length) return '—';
    return links.map(function(u) {
      // Strip non-http schemes to prevent javascript: XSS
      var safe = /^https?:\/\//i.test(u) ? u : '#';
      return '<a href="' + _crmEsc(safe) + '" target="_blank" rel="noopener noreferrer"'
        + ' class="text-[#0053e2] hover:underline text-xs mr-1" title="' + _crmEsc(u) + '">🔗</a>';
    }).join('');
  }
  if (f.field_type === 'url') {
    var safeUrl = /^https?:\/\//i.test(val) ? val : '#';
    return '<a href="' + _crmEsc(safeUrl) + '" target="_blank" rel="noopener noreferrer"'
      + ' class="text-[#0053e2] hover:underline truncate max-w-[140px] inline-block">'
      + _crmEsc(val) + '</a>';
  }
  return _crmEsc(val);
}
```

#### 8. `_crmRenderTable()` — use `_crmFieldDisplay()`

Find the `fieldVals` line inside `_crmRenderTable()`:

```js
const fieldVals = _crmFields.map(f =>
  `<td class="${tdCls}">${_crmEsc((c.field_values||{})[f.id] || '')}</td>`
).join('');
```

Replace with:

```js
var fieldVals = _crmFields.map(function(f) {
  var raw = (c.field_values || {})[f.id] || '';
  return '<td class="' + tdCls + '">' + _crmFieldDisplay(f, raw) + '</td>';
}).join('');
```

Note: switched from arrow function + template literal to `function` + concatenation — both
work in `home-page-crm.js` since it's a static file (not an HTMX partial), but arrow
functions and template literals are fine here as the module is not reinjected into the DOM.
Keep consistent with the file's existing style (it already uses arrow functions freely).

---

## Skills to Invoke

| # | Skill / Agent | When | Why |
|---|---|---|---|
| 1 | `bookworm-template-audit` | After editing `home_page_crm.html` + `home-page-crm.js` | Verify no `let`/`const` in template script blocks, no broken `hx-target` IDs |
| 2 | `bookworm-qa` | After Feature B ships (test field types), again after Feature A ships (test toolbar) | Hit `/home/crm/{id}/contacts`, new field types add/save/render, sort/filter/group produce correct output |
| 3 | `bookworm-pre-commit` | Before every commit | Standard 10-phase safety checklist |
| 4 | `bookworm-docs-keeper` | After both features merged | Update CODEPUPPY_NOTES: CRM `field_type` enum (add 3 new values), module state vars section |

---

## BookWorm Gotchas That Apply to These Features

**Quirk #13 — `var` not `let`/`const` in HTMX-reinjected `<script>` blocks.**
The new `_crmSort`, `_crmFilter`, `_crmGroup` vars go in `home-page-crm.js` (a static file,
not a template partial), so `let`/`const` would technically be safe there. However, the
project convention for module-level CRM state is `var` (see existing lines 17–22). Keep it
consistent. The template partial (`home_page_crm.html`) must have NO `<script>` blocks with
top-level `let`/`const` — the toolbar div is empty HTML only, so this is not a risk here.

**Quirk — unchecked checkboxes are invisible to `FormData`.**
A `<input type="checkbox">` that is unchecked produces NO entry in `FormData`. `data.get('cf_N')`
returns `null`, not `'0'`. The `crmSaveContact()` update must handle `=== null` and substitute
`'0'`, otherwise the stored value for an unchecked checkbox becomes an empty string and future
loads can't distinguish "unchecked" from "not set".

**Quirk — `data.getAll()` naming for multi_select checkboxes.**
`multi_select` checkboxes are named `cf_{id}[]`. The `[]` suffix is a developer convention only
— `FormData` does NOT special-case it. Call `data.getAll('cf_' + f.id + '[]')` — same string
used in the `name` attribute. Using `data.get()` instead returns only the first selected value.

**Quirk — `multi_select` fan-out in grouping.**
A contact with `["A", "B"]` stored must appear in BOTH group "A" AND group "B" when grouped
by that field. The grouping step must clone the contact object into both groups. Without fan-out,
only the first parsed value determines group membership.

**Quirk — `_crmRenderToolbar()` call timing.**
`_crmRenderToolbar()` reads `_crmFields` to build custom-field sort/filter/group options.
If called before `_crmLoadAll()` resolves, `_crmFields` is `[]` and all custom-field options
are silently absent. Call it only inside `_crmLoadAll()` success path or inside `_crmRender()`,
never in `initCrmPage()` directly.

**Quirk — filter dropdown uniqueness for `multi_select` fields.**
When building Filter dropdown options for a `multi_select` field, the stored value in each
contact is a JSON array string like `'["Yes","Maybe"]'`. Collecting unique values naively
(`new Set(contacts.map(c => c.field_values[id]))`) produces `Set{'["Yes","Maybe"]', '["Yes"]'}`
instead of `Set{'Yes', 'Maybe'}`. Must parse each JSON array and fan out individual items.

**Quirk — `file_links` `javascript:` scheme XSS.**
`_crmFieldDisplay()` builds `<a href="...">` from user-supplied URL values. An attacker
can store `javascript:alert(1)` as a file link and trigger it on click. The plan's `_crmFieldDisplay()`
strips non-`http://`/`https://` schemes by substituting `'#'`. This is client-side-only protection;
the server stores the raw value. Acceptable for a private single-tenant app; flag for future audit.

**Quirk — `VALID_TYPES` defined twice in `home_crm.py`.**
`create_field` and `edit_field` each define their own `VALID_TYPES = {...}` local. Search the
file for both occurrences and update both. If only one is updated, users can save a field via
the "add" form but cannot edit it after (or vice versa).

**Quirk re: static_v cache-busting after JS changes.**
After editing `home-page-crm.js`, `static_v` does NOT auto-recompute in a running server.
Restart the server (or run `restart.bat`) before testing so browsers receive the updated JS.
In `--reload` dev mode, Python files auto-reload but static JS does not trigger `static_v` recompute.

---

## Implementation Checklist

### Feature B — New Field Types (do this first — simpler, establishes field-type foundation)

- [x] **B-1** `routers/home_crm.py` — `VALID_TYPES` in `create_field` includes `"checkbox"`, `"multi_select"`, `"file_links"`. ✅
- [x] **B-2** `routers/home_crm.py` — `VALID_TYPES` in `edit_field` identical. ✅
- [x] **B-3** `home-page-crm-fields.js` — `_CRM_FIELD_TYPE_DEFS` (9 types) + `_CRM_TYPE_LABELS` at module level. Moved to `home-page-crm-fields.js` for cohesion. ✅
- [x] **B-4** `home-page-crm-fields.js` — `_CRM_TYPE_LABELS` covers all 9 types. ✅
- [x] **B-5** `home-page-crm-fields.js` — `typeOpts` built from `_CRM_FIELD_TYPE_DEFS`. ✅
- [x] **B-6** `home-page-crm-fields.js` — `crmToggleOptions()` shows options for `['select','multi_select'].includes(sel.value)`. ✅
- [x] **B-7** `home-page-crm-fields.js` — `crmEditField()` real edit sub-form (label editable, type read-only, options for select/multi_select), `crmSaveFieldEdit()` handles save. ✅
- [x] **B-8** `home-page-crm.js` — `_crmContactModal()` has toggle switch (checkbox), pill chips (multi_select), textarea (file_links). ✅
- [x] **B-9** `home-page-crm.js` — `crmSaveContact()` type-aware: checkbox→'1'/'0', multi_select→JSON array (getAll), file_links→JSON array of trimmed lines. ✅
- [x] **B-10** `home-page-crm.js` — `_crmFieldDisplay(f, c)` renders ✅/☐ (checkbox), blue pills (multi_select), anchor links (file_links). ✅
- [x] **B-11** `home-page-crm.js` — `_crmRenderTable()` calls `_crmFieldDisplay(f, c)` for custom field cells. ✅
- [x] **B-12** Verified by `bookworm-qa` — all 3 new field types accepted by API, correctly registered in `VALID_TYPES`, no 500s in logs. ✅

### Feature A — Filter / Sort / Group

- [x] **A-1** `templates/partials/home_page_crm.html` — `<div id="crm-toolbar" class="flex-shrink-0 px-4">` at line 62. ✅
- [x] **A-2** `home-page-crm-toolbar.js` — `_crmSortKey`, `_crmFilterField`, `_crmFilterValue`, `_crmGroupField` state vars. Moved to `home-page-crm-toolbar.js` for cohesion. ✅
- [x] **A-3** State resets on `initCrmPage()` (toolbar vars initialise to `''`). ✅
- [x] **A-4** `home-page-crm-toolbar.js` — `window.crmRenderToolbar` renders Sort/Filter/Group selects + Clear button + Columns panel. ✅
- [x] **A-5** `home-page-crm-toolbar.js` — `crmSetSort`, `crmSetFilterField`, `crmSetFilterValue`, `crmSetGroup`, `crmClearFilters` all on `window`. ✅
- [x] **A-6** `home-page-crm-toolbar.js` — `window._crmProcessed()`: text search → field filter → sort (group-primary) → returns flat `contact[]`. ✅
- [x] **A-7** `home-page-crm.js` — `_crmRenderTable()` uses `_crmGroupField` + `_crmGroupValue()` to inject sticky group `<tr>` header rows. ✅
- [x] **A-8** `home-page-crm-gallery.js` — `_crmRenderGallery()` uses same `_crmGroupField` + `_crmGroupValue()` pattern for group headers between cards. ✅
- [x] **A-9** `_crmRender()` calls `crmRenderToolbar()` (guarded with `typeof` check) for table/gallery views. ✅
- [x] **A-10** Verified by `bookworm-qa` — toolbar div present in template, `_crmProcessed` + `crmRenderToolbar` defined and serving correctly. ✅

### Final

- [x] **F-1** Template audit — `home_page_crm.html` has no new `<script>` blocks; `?v={{ static_v }}` on all CRM JS files. ✅
- [x] **F-2** `bookworm-qa` — 100% green. All 3 new field types accepted, toolbar div present, pipeline functions wired. ✅ (2026-04-11)
- [ ] **F-3** `bookworm-pre-commit` — run before next commit touching CRM files.
- [ ] **F-4** `bookworm-docs-keeper` — update CODEPUPPY_NOTES.md with new field types + toolbar state vars.

---

## Open Questions

**1. Gallery card custom fields — show or hide?**
Gallery view currently shows only core fields (name, company, email, phone, tags). Feature A
adds grouping to gallery but does not add custom field display to gallery cards. Should
`multi_select` pill badges and `checkbox` ✓ badges appear on gallery cards too?
*Recommendation: out of scope for this plan — gallery cards would become too tall. Add as
a separate micro-task.*

**2. Filter: single active filter vs. compound (AND) filters?**
Plan specs one active filter at a time (company OR one custom field). If users need
"Company = Acme AND Status = Active", that requires a tag-strip UI for active filters.
*Recommendation: ship single-filter first. Compound filters are a Phase 4 feature.*

**3. Should `field_type` be editable in `crmEditField()`?**
Plan marks it read-only (shown but disabled `<input>`). Changing type would orphan existing
values (e.g., `"true"` stored in a text field that becomes a checkbox). Escape hatch is
delete + re-add the field.
*Needs confirmation from Tinh — is delete + re-add acceptable UX?*

**4. `file_links` scheme validation — client-only or server too?**
Plan strips non-http schemes in `_crmFieldDisplay()` (client display). The server stores raw
values. A stored `javascript:` URL is inert until rendered.
*Recommendation: client display strip is sufficient for this private app. Log as a known
limitation in CODEPUPPY_NOTES for future security review.*

**5. `_crmQuery` text search extension to field values — JSON noise?**
Extending text search to `Object.values(c.field_values || {}).join(' ')` means searching
raw JSON strings like `'["Yes","No"]'`. A search for `"Yes"` matches, which is correct,
but a search for `"[\"` also matches (cosmetically ugly). Acceptable at this scale — revisit
if users report false positives.*
