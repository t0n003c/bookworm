# Plan: DB Card Attribute Types — `date_range`, `progress`, `rating`
Date: 2026-05-03
Estimated complexity: Medium

## Summary
Adds three new attribute types to the workspace Database card system: a date-range picker
(`date_range`), a 0–100 progress slider (`progress`), and a 1–5 star rating (`rating`).
All three store their value as plain text in the existing `db_card_attrs.attr_value` column —
no schema change required. Each type needs a compact grid pill (rendered by `_dbAttrPills`)
and a full interactive editor (rendered by `_dbAttrValueHtml` inside the detail panel), plus
three small save-helper functions. Everything lives in one file: `workspace-database.js`.

---

## Files to Change

| # | File | What changes |
|---|---|---|
| 1 | `static/js/workspace-database.js` | All changes — type registry, helper fns, grid pills, detail-panel renderers |

---

## Architecture: Two Separate Rendering Paths

> ⚠️ The user brief says "grid cell rendering uses `_dbAttrValueHtml`; detail panel uses
> the same function." After reading the source: **this is only half correct.**
> Both paths exist and are separate. Read carefully before coding.

| Context | Function | Location |
|---|---|---|
| **Card grid preview** (compact pills on the kanban-style card) | `_dbAttrPills(attrs, cardId)` | ~line 1955 |
| **Detail panel** (attribute table inside the open card side-panel) | `_dbAttrValueHtml(cardId, a)` | line 4742 (called at line 5264) |

`_dbAttrPills` is called from `_dbCardHtml` which is called from `_dbRenderGrid`.
`_dbAttrValueHtml` is called once — inside `_dbRenderDetailPanel` at line 5264.
There is **no context flag** inside `_dbAttrValueHtml`; it is never called from the grid.
Each new type needs a branch in **both** functions.

---

## Exact Insertion Points

### 1 — `_DB_ATTR_TYPES` array (~line 110)

Current last entry: `{ id: 'place', label: 'Place', icon: '\uD83D\uDCCD' }`.
Add three entries **before** the closing `];`:

```js
  { id: 'date_range', label: 'Date Range', icon: '\uD83D\uDCC5' },
  { id: 'progress',   label: 'Progress',   icon: '\uD83D\uDCCA' },
  { id: 'rating',     label: 'Rating',     icon: '\u2B50'       },
```

---

### 2 — `_dbFormatDateRange(v)` helper (~line 3900, after `_dbParseUserDate` closes)

Parses `"YYYY-MM-DD|YYYY-MM-DD"` into a human display string for grid pills.
Place immediately after the closing `}` of `_dbParseUserDate`.

```js
// Parse "YYYY-MM-DD|YYYY-MM-DD" → "Apr 15, 2026 → Apr 30, 2026".
// Either half may be empty; both empty → returns ''.
function _dbFormatDateRange(v) {
  var parts  = (v || '').split('|');
  var s = (parts[0] || '').trim().slice(0, 10);
  var e = (parts[1] || '').trim().slice(0, 10);
  var sLabel = s ? _dbFormatDate(s, 'short') : '';
  var eLabel = e ? _dbFormatDate(e, 'short') : '';
  if (!sLabel && !eLabel) return '';
  if (!eLabel) return sLabel + ' \u2192';
  if (!sLabel) return '\u2192 ' + eLabel;
  return sLabel + ' \u2192 ' + eLabel;
}
```

---

### 3 — Three new save-helper functions (~line 6828, after `_dbDatePickerChange` closes)

Add in this order, right after `_dbDatePickerChange`:

#### `_dbDateRangeChange` — reads both date inputs, saves pipe-joined value

```js
function _dbDateRangeChange(cardId, attrId, key) {
  var s = document.getElementById('dtr-' + attrId + '-s');
  var e = document.getElementById('dtr-' + attrId + '-e');
  var sv = s ? s.value : '';
  var ev = e ? e.value : '';
  _dbSaveAttrVal(cardId, attrId, key, sv + '|' + ev);
}
```

#### `_dbProgressChange` — 400 ms debounced save using `_dbSaveTimers`

Timer key: `'prog-' + cardId + '-' + attrId` (avoids collision with `'detail_' + cardId`).

```js
function _dbProgressChange(cardId, attrId, key, val) {
  var timerKey = 'prog-' + cardId + '-' + attrId;
  if (_dbSaveTimers[timerKey]) clearTimeout(_dbSaveTimers[timerKey]);
  _dbSaveTimers[timerKey] = setTimeout(function() {
    delete _dbSaveTimers[timerKey];
    var clamped = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
    _dbSaveAttrVal(cardId, attrId, key, String(clamped));
  }, 400);
}
```

#### `_dbRatingSave` — saves immediately; clicking the active star resets to 0

Performs an optimistic in-place DOM update so the detail panel reflects the change
immediately (before the async `_dbSaveAttrVal` fetch returns).

```js
function _dbRatingSave(cardId, attrId, key, stars, currentVal) {
  var isDark = document.documentElement.classList.contains('dark');
  var newVal = (stars === currentVal) ? 0 : stars;
  // Optimistic in-place star update inside the detail panel
  var row = document.querySelector('.db-attr-row[data-attr-id="' + attrId + '"]');
  if (row) {
    row.querySelectorAll('.db-rating-btn').forEach(function(btn, idx) {
      var i      = idx + 1;
      var active = i <= newVal;
      btn.style.color = active ? '#f59e0b' : (isDark ? '#52525b' : '#d1d5db');
      btn.innerHTML   = active ? '&#9733;' : '&#9734;';
    });
  }
  // Optimistic in-memory update so the grid pill refreshes correctly on _dbRenderGrid()
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var meta = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  if (meta) meta.attr_value = String(newVal);
  _dbRenderGrid();
  _dbSaveAttrVal(cardId, attrId, key, String(newVal));
}
```

> Note: `_dbSaveAttrVal` internally sets `meta.attr_value` again on success and calls
> `_dbRenderGrid()` again — that second render is a no-op visually (same value). Fine.

---

### 4 — `_dbAttrValueHtml` — three new `if` branches

**Insert location:** after the `phone` block's closing `}` and before `if (t === 'status')`.
The `phone` block returns `'<div class="db-ph-wrap"...'` and ends ~line 5057.
`if (t === 'status')` starts ~line 5058.

Variables already in scope at this point in the function:
- `kJ` — attr key, JSON-encoded and HTML-escaped, safe for inline JS handlers
- `v` — current `attr_value` string (may be `''`)
- `isDark` — boolean, set at function top
- `restInputStyle` — the invisible-at-rest input CSS string, set at function top
- `a.id` — attribute row id (number)
- `cardId` — card id (number)

```js
  if (t === 'date_range') {
    var drParts = v.split('|');
    var drS  = (drParts[0] || '').trim().slice(0, 10);
    var drE  = (drParts[1] || '').trim().slice(0, 10);
    var drSId = 'dtr-' + a.id + '-s';
    var drEId = 'dtr-' + a.id + '-e';
    var drCb  = '_dbDateRangeChange(' + cardId + ',' + a.id + ',' + kJ + ')';
    var drMut = isDark ? '#a1a1aa' : '#6b7280';
    return (
      '<div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">'
      + '<span style="font-size:0.65rem;color:' + drMut + ';">Start</span>'
      + '<input type="date" id="' + _esc(drSId) + '" value="' + _esc(drS) + '"'
      + ' style="' + restInputStyle + 'width:auto;min-width:0;"'
      + ' onchange="' + drCb + '">'
      + '<span style="color:' + drMut + ';font-size:0.75rem;">&#8594;</span>'
      + '<span style="font-size:0.65rem;color:' + drMut + ';">End</span>'
      + '<input type="date" id="' + _esc(drEId) + '" value="' + _esc(drE) + '"'
      + ' style="' + restInputStyle + 'width:auto;min-width:0;"'
      + ' onchange="' + drCb + '">'
      + '</div>'
    );
  }
  if (t === 'progress') {
    var progV   = parseInt(v || '0', 10);
    if (isNaN(progV) || progV < 0) progV = 0;
    if (progV > 100) progV = 100;
    var progRId = 'dpr-' + a.id;
    var progLId = 'dpr-' + a.id + '-lbl';
    var progMut = isDark ? '#a1a1aa' : '#6b7280';
    return (
      '<div style="display:flex;align-items:center;gap:0.5rem;width:100%;">'
      + '<input type="range" min="0" max="100" value="' + progV + '" id="' + _esc(progRId) + '"'
      + ' style="flex:1;min-width:0;accent-color:#0053e2;cursor:pointer;"'
      + ' oninput="_dbProgressChange(' + cardId + ',' + a.id + ',' + kJ + ',this.value);'
      + 'document.getElementById(\\'' + _esc(progLId) + '\\').textContent=this.value+\\'%\\';">'
      + '<span id="' + _esc(progLId) + '" style="flex-shrink:0;font-size:0.72rem;'
      + 'color:' + progMut + ';width:2.5rem;text-align:right;font-variant-numeric:tabular-nums;">'
      + progV + '%</span>'
      + '</div>'
    );
  }
  if (t === 'rating') {
    var rV    = parseInt(v || '0', 10);
    if (isNaN(rV) || rV < 0) rV = 0;
    if (rV > 5) rV = 5;
    var rHtml = '';
    for (var rSi = 1; rSi <= 5; rSi++) {
      var rActive = rSi <= rV;
      var rClr    = rActive ? '#f59e0b' : (isDark ? '#52525b' : '#d1d5db');
      rHtml += '<button type="button" class="db-rating-btn"'
        + ' onclick="_dbRatingSave(' + cardId + ',' + a.id + ',' + kJ + ',' + rSi + ',' + rV + ')"'
        + ' style="background:none;border:none;cursor:pointer;padding:0.05rem 0.1rem;'
        + 'font-size:1.25rem;line-height:1;color:' + rClr + ';">'
        + (rActive ? '&#9733;' : '&#9734;')
        + '</button>';
    }
    return '<div style="display:inline-flex;align-items:center;">' + rHtml + '</div>';
  }
```

> **`class="db-rating-btn"`** is required on each button — `_dbRatingSave` queries this
> class for its optimistic DOM update.

---

### 5 — `_dbAttrPills` — three new branches in the grid pill renderer

`_dbAttrPills` is the large `for` loop (~line 1955) that sorts attrs into four buckets:
`chipParts`, `priorityParts`, `normalParts`, `fileParts`.

#### 5a — `rating` in `priorityParts` chain

Insert after the `url`/`email` block (the `} else if ((t === 'url' || t === 'email') && v)`)
and before the `// ── NORMAL attrs` comment (~line 2092):

```js
    } else if (t === 'rating' && v && v !== '0') {
      var rPillVal = parseInt(v, 10);
      if (!isNaN(rPillVal) && rPillVal > 0) {
        var rPillStr = '';
        for (var rpi = 1; rpi <= 5; rpi++) {
          rPillStr += rpi <= rPillVal ? '\u2605' : '\u2606'; // ★ / ☆
        }
        priorityParts.push(
          '<span style="font-size:0.78rem;color:#f59e0b;'
          + 'letter-spacing:-0.02em;white-space:nowrap;">'
          + rPillStr + '</span>'
        );
      }
```

#### 5b — `date_range` in `normalParts` chain

Insert after the `number` block (after `normalParts.push(...)` for `number`)
and before the `files` block (~line 2107):

```js
    } else if (t === 'date_range' && v) {
      var drPillLabel = _dbFormatDateRange(v);
      if (drPillLabel) {
        normalParts.push(
          '<span class="text-xs text-gray-500 dark:text-zinc-400">'
          + '\uD83D\uDCC5\u00a0' + _esc(drPillLabel) + '</span>'
        );
      }
```

#### 5c — `progress` in `normalParts` chain

Insert immediately after the `date_range` block above:

```js
    } else if (t === 'progress' && v !== '') {
      var progPillPct = parseInt(v, 10);
      if (!isNaN(progPillPct)) {
        var progPillCl  = Math.max(0, Math.min(100, progPillPct));
        var progPillTrk = isDark ? '#3f3f46' : '#e5e7eb';
        normalParts.push(
          '<div style="display:inline-flex;align-items:center;gap:0.3rem;width:80px;">'
          + '<div style="flex:1;height:5px;background:' + progPillTrk
          + ';border-radius:9999px;overflow:hidden;">'
          + '<div style="width:' + progPillCl + '%;height:100%;background:#0053e2;'
          + 'border-radius:9999px;"></div></div>'
          + '<span style="font-size:0.65rem;color:' + (isDark ? '#a1a1aa' : '#6b7280') + ';'
          + 'flex-shrink:0;font-variant-numeric:tabular-nums;">'
          + progPillCl + '%</span>'
          + '</div>'
        );
      }
```

---

## DB Migrations Needed
None. All three types use the existing `db_card_attrs.attr_value TEXT` column. No `attr_options` changes.

---

## Skills to Invoke
- **bookworm-template-audit** — after implementation (pass: file = `workspace-database.js`, what changed = 3 new attr type branches; confirm no `let`/`const`, no bad inline-handler escaping)
- **bookworm-pre-commit** — before committing

No `bookworm-db-migration` or `bookworm-widget-scaffolder` needed.

---

## BookWorm Gotchas That Apply to This Feature

### Gotcha 1 — `var` not `let`/`const` everywhere (line 3 of file)
File-level rule: "ALL var — no let/const."
All new variables and loop counters must use `var`. This includes:
- `for (var rSi = 1; rSi <= 5; rSi++)` in `_dbAttrValueHtml`
- `for (var rpi = 1; rpi <= 5; rpi++)` in `_dbAttrPills`
- Every local inside the new helper functions

### Gotcha 2 — The `kJ` escaping pattern is mandatory for inline JS handlers
```js
var kJ = _esc(JSON.stringify(a.attr_key));
```
`JSON.stringify` quotes the key → `_esc` converts `"` → `&quot;` → browser decodes back
to `"` before running JS. Always use `kJ`, not `a.attr_key` or raw `JSON.stringify`, when
embedding the key into an `onclick`/`onchange`/`oninput` HTML attribute string.

### Gotcha 3 — Single-quote escaping inside multi-level `oninput` strings
When building JS inside an HTML attribute string in JS source code, inner single quotes
need `\\'` (in source) to produce `\'` in the rendered attribute. Pattern from existing
`date` type:
```js
'p.showPicker?p.showPicker():p.click()'
// becomes:
'onclick=\"...if(p.showPicker)p.showPicker()...\"'
```
The `oninput` for `progress` references `document.getElementById(\\'...\\')`  using
this same `\\'` pattern. Copy it exactly.

### Gotcha 4 — `_dbSaveTimers` key uniqueness
`_dbSaveTimers` is a module-level `var {}` shared by all debounce callers. Key format:
- Note debounce: `'detail_' + cardId`
- Number input: (not in `_dbSaveTimers`, uses its own `_dbPlaceTimer`)
- **Progress (new):** `'prog-' + cardId + '-' + attrId`  ← must include both IDs

### Gotcha 5 — `_dbSaveAttrVal` already calls `_dbRenderGrid()` on success
After a successful save, the grid auto-refreshes — the `_dbAttrPills` branches for the new
types will be exercised automatically. Do NOT add a second `_dbRenderGrid()` call inside
the helpers (except `_dbRatingSave`, which does it optimistically before the fetch).

### Gotcha 6 — `class="db-rating-btn"` on each star `<button>` is required
`_dbRatingSave` uses `row.querySelectorAll('.db-rating-btn')` for optimistic DOM update.
If the class is missing, the in-place update silently no-ops — the stars won't update
until the async fetch returns and `_dbRenderGrid()` fires (which doesn't re-render the
detail panel anyway). The class must be present in the `_dbAttrValueHtml` rating output.

### Gotcha 7 — `restInputStyle` is already in scope inside `_dbAttrValueHtml`
It's declared at the top of the function (~line 4760). Do not redeclare it. The
`date_range` renderer reuses it for both date inputs as-is.

---

## Implementation Checklist

- [ ] **Step 1** — Add `date_range`, `progress`, `rating` entries to `_DB_ATTR_TYPES` (~line 125, before `];`)
- [ ] **Step 2** — Add `_dbFormatDateRange(v)` helper function after `_dbParseUserDate` closing `}` (~line 3900)
- [ ] **Step 3** — Add `_dbDateRangeChange(cardId, attrId, key)` after `_dbDatePickerChange` (~line 6827)
- [ ] **Step 4** — Add `_dbProgressChange(cardId, attrId, key, val)` after `_dbDateRangeChange`
- [ ] **Step 5** — Add `_dbRatingSave(cardId, attrId, key, stars, currentVal)` after `_dbProgressChange` — include optimistic `_dbCards` in-memory update + `_dbRenderGrid()` before the fetch
- [ ] **Step 6** — In `_dbAttrValueHtml`: add `if (t === 'date_range')` branch before `if (t === 'status')` (~line 5058)
- [ ] **Step 7** — In `_dbAttrValueHtml`: add `if (t === 'progress')` branch immediately after Step 6
- [ ] **Step 8** — In `_dbAttrValueHtml`: add `if (t === 'rating')` branch immediately after Step 7 — verify `class="db-rating-btn"` on every `<button>`
- [ ] **Step 9** — In `_dbAttrPills`: add `rating` to `priorityParts` chain after `url`/`email` block (~line 2092)
- [ ] **Step 10** — In `_dbAttrPills`: add `date_range` to `normalParts` chain after `number` block (~line 2107)
- [ ] **Step 11** — In `_dbAttrPills`: add `progress` to `normalParts` chain immediately after Step 10
- [ ] **Step 12** — Manual smoke test: add all three attr types to a DB card; set values; verify grid pills appear correctly
- [ ] **Step 13** — Manual smoke test: open card detail panel; verify all three types render and save correctly in light + dark mode
- [ ] **Step 14** — For `rating`: verify clicking the already-selected star resets to no rating (0); verify grid pill updates
- [ ] **Step 15** — For `progress`: drag slider quickly; verify only one save fires ~400ms after drag stops (check network tab)
- [ ] **Step 16** — Run `bookworm-template-audit`
- [ ] **Step 17** — Run `bookworm-pre-commit`

---

## Open Questions

### Q1 — Should `date_range` inherit the date format from `attr_options`?
The `date` type stores a user-chosen format ID in `attr_options` (`'mdy'`, `'short'`, etc.).
`date_range` currently hardcodes `'short'` (`Apr 15, 2026`). If the team wants the same
format picker to work for `date_range`, `_dbFormatDateRange(v, fmtId)` would accept a
second param, and the caller would read `a.attr_options || 'short'`. This requires no DB
change and no schema change — just a format dropdown in the attr-settings UI.
**Recommendation:** leave as `'short'` for now; add as a follow-up if requested.

### Q2 — Should `_dbRatingSave` also inline-update the onclick attributes to reflect the new `currentVal`?
The detail-panel star buttons store `currentVal` in their `onclick` string. After a click,
the optimistic DOM update changes `btn.innerHTML` and `btn.style.color` but does NOT update
the `onclick` attribute — so the next click uses a stale `currentVal`. The plan above
addresses this by keeping `_dbRatingSave` stateless: `currentVal` is passed from the button,
and the in-memory `meta.attr_value` update plus `_dbRenderGrid()` handle the grid. But
the detail panel stars retain the old `onclick` until the panel is next closed/reopened.
**Fix option:** in the optimistic update loop, rebuild each star's `onclick` attribute with
the new `currentVal`: `btn.setAttribute('onclick', '_dbRatingSave('+cardId+','+attrId+','+kJ+','+i+','+newVal+')')`.
This is safe but adds some complexity. Decide before coding Step 5.

### Q3 — Filter operator support for new types
`_dbOpsForType` in the filter panel has no cases for `date_range`, `progress`, or `rating`.
They fall through to `text` operators, which work but are awkward. Ideally:
- `progress` / `rating` → numeric operators (`=`, `>`, `<`, etc.)
- `date_range` → a future `between` / `overlaps` operator
This is a separate follow-up plan item; not blocking.

### Q4 — Sort order for `progress` and `rating`
The sort engine treats unknown attr types as text strings. `"75" > "9"` is false in
lexicographic order — `progress` sort will be wrong for values `< 10`. Numeric sort
support for these two types is a follow-up. Not blocking.
