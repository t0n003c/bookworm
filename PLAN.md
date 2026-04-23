# Plan: Subscriptions Summary Widget (Phase 2)
Date: 2026-04-22
Estimated complexity: Medium

---

## Summary

Add a new `subscriptions_summary` dashboard widget type that lets users pin a
read-only summary of any Subscriptions page directly on a widget canvas.  The
widget renders an internal 2-slide carousel (no dependency on the stack widget
system): Slide 0 shows up to 5 active subscriptions in a compact list with a
monthly-total footer; Slide 1 shows a Chart.js donut chart broken down by
category plus annual / monthly totals.  Slide position is saved to
`localStorage` so it survives browser refresh with zero server round-trips.
All data comes from the two existing endpoints
`GET /home/subscriptions/{page_id}/list` and
`GET /home/subscriptions/{page_id}/summary`.

No database migrations, no new router files, no auth changes.

---

## Files to Change

Touch in this exact sequence to avoid forward-reference surprises.

| # | File | What changes |
|---|---|---|
| 1 | `templates/partials/home_page.html` | Add `render_subscriptions_summary(w)` macro; add `elif` branch in the top-level widget dispatch grid; add `elif` branch in `render_stack_child` |
| 2 | `templates/partials/home_add_widget_modal.html` | Add `('subscriptions_summary', '💳', 'Subscriptions')` button to the **Advanced** section |
| 3 | `static/js/home-widgets.js` | Add entry to `WIDGET_STYLES`; add entry to `WIDGET_CONFIG_FIELDS` with a new `select-subs-pages` field type; add `select-subs-pages` handler inside `aw_refreshConfig`; add `initHomeWidgets` dispatch for `.subs-summary-widget` elements |
| 4 | `static/js/home-widgets-settings.js` | Add `select-subs-pages` handler inside the settings field-renderer loop (mirrors the existing `select-crm-pages` block); add post-save reload call for `subscriptions_summary` widgets |
| 5 | `static/js/home-widgets-render.js` | Add the full `_loadSubscriptionsSummary(el)` engine function |
| 6 | `static/js/home-widget-stack.js` | Add label-map entry: `subscriptions_summary: ['Subscriptions', '💳']` |

## New Files to Create

_None._ All code fits into the existing files above.

---

## DB Migrations Needed

**None.** `config_json` in `home_widgets` already holds arbitrary JSON, so
`{"page_id": 42}` is valid without any schema change.  The `subscriptions`
table and all five subscription endpoints already exist from Phase 1.

---

## Widget Config Schema

```json
{
  "page_id": 42,
  "col_span": 1,
  "row_span": 2
}
```

`page_id` — integer ID of a `subscriptions`-type home page owned by the user.
             `0` / missing = unconfigured; widget shows a setup prompt.
`col_span` / `row_span` — standard BookWorm widget sizing keys (managed by the
             existing size-picker, not this feature).

**No `slide` key in config_json.** Slide position is persisted to
`localStorage` with key `bw-subs-slide-{widgetId}` to avoid an
`update-config` POST on every dot click (see Open Questions #1).

---

## Skills to Invoke

- **bookworm-template-audit** — after touching `home_page.html` and the JS
  files (check `var` usage in partials, `| tojson | safe` on any new data
  attributes, `?v={{ static_v }}` — no new `<script src>` tags in this
  feature so the cache-busting risk is low, but audit anyway)
- **bookworm-qa** — after implementation; verify the widget renders on a
  dashboard page, the two slides flip, the donut chart paints, and the
  "Open Subscriptions page" link navigates correctly
- **bookworm-pre-commit** — before committing; verify no `let`/`const` inside
  `home-widgets-render.js` additions, no hardcoded IDs

---

## BookWorm Gotchas That Apply to This Feature

**Quirk A — `var` only in `home-widgets-render.js`.**
The file uses `'use strict';` at the top but every function-scoped variable
uses `var`.  `initHomeWidgets` re-runs on every HTMX page swap, so `let`/
`const` at module scope would throw `SyntaxError: Identifier already declared`
on the second swap.  Every line of `_loadSubscriptionsSummary` must use `var`.

**Quirk B — Chart.js lazy-load promise must be widget-local, not shared.**
`home-page-subscriptions.js` already has `_subsChartLibsPromise` but that
module only runs on subscriptions *pages*, not on dashboard pages.  The widget
engine runs inside `home-widgets-render.js`.  Declare a separate module-level
`var _subsWgtChartPromise = null;` at the top of the new function block so
multiple widgets on the same canvas share one load attempt.  The `src` path is
`/static/js/vendor/chart.umd.min.js` (bundled locally — no CDN).

**Quirk C — Canvas must live inside a fixed-height parent div.**
Chart.js with `responsive: true` ignores the `<canvas>` element's `height`
attribute and instead reads the parent element's CSS height.  Wrap the canvas
in `<div style="position:relative; height:140px;">` (or a Tailwind `h-36`
class that is already in the built CSS).  Without this the canvas collapses to
0 px and Chart.js throws a warning.

**Quirk D — `data-widget-config` attribute uses `| tojson | e`, not `| safe`.**
The card macro already writes:
```
data-widget-config='{{ _wcfg | tojson | e }}'
```
The new macro must follow the same pattern for any data attribute that embeds
JSON — use `| tojson | e` (HTML-entity-escaped), **never** `| tojson | safe`
inside an HTML attribute value.

**Quirk E — Two dispatch locations in `home_page.html`.**
Every widget type appears in **two** places: (1) the top-level grid loop
around line 1818, and (2) the `render_stack_child` macro around line 1622.
Missing either one means the widget breaks when dropped into a stack.

**Quirk F — `select-subs-pages` field type must be handled in both JS files.**
`aw_refreshConfig` in `home-widgets.js` handles the *add-widget* modal.
The field-renderer loop in `home-widgets-settings.js` handles the *settings*
modal.  Both must recognise `f.type === 'select-subs-pages'` and use the
`GET /home/pages` endpoint filtered to `page_type === 'subscriptions'`.
Missing either one leaves a broken `<select>` in one of the two contexts.

**Quirk G — `openHomePage` is already global.**
`home-widgets.js` exports `window.openHomePage` (or it's declared at global
scope).  The "Open Subscriptions page" link in the widget just calls
`openHomePage(pageId)` inline — no need to import or re-declare it.

---

## Macro Skeleton (Step 1 reference)

Add this macro to `home_page.html` **before** the `render_stack_child` macro
(so it can be referenced by it):

```jinja2
{% macro render_subscriptions_summary(w) %}
{%- set cfg    = w.get('config', {}) -%}
{%- set pid    = cfg.get('page_id', 0) | int -%}
{% call card(w) %}
  {{ widget_header(w, 'Subscriptions', '💳') }}
  {%- if pid %}
  {#- JS engine mounts into this div on widget boot -#}
  <div class="subs-summary-widget flex-1 min-h-0 flex flex-col"
       id="subs-sw-{{ w.id }}"
       data-widget-id="{{ w.id }}"
       data-page-id="{{ pid }}">
    {#- Skeleton shown until JS paints -#}
    <div class="flex items-center justify-center h-full
                text-gray-300 dark:text-zinc-600 text-xs select-none">
      Loading…
    </div>
  </div>
  {%- else %}
  <div class="flex-1 flex flex-col items-center justify-center gap-2
              text-center text-xs text-gray-400 dark:text-zinc-500 px-4">
    <span class="text-2xl">💳</span>
    <p>Configure this widget — open <strong>⚙️ Settings</strong>
       and pick a Subscriptions page.</p>
  </div>
  {%- endif %}
{% endcall %}
{% endmacro %}
```

---

## Render Function Skeleton (Step 5 reference)

Add to the **bottom** of `home-widgets-render.js`.  Every local variable is
`var`.  The function is self-contained — no shared state with the subscriptions
page module.

```javascript
// ── Subscriptions Summary Widget ─────────────────────────────────────────────
// Chart.js lib promise — shared across all subs-summary widgets on the page.
var _subsWgtChartPromise = null;

function _loadSubscriptionsSummary(el) {
  var wid = el.dataset.widgetId;
  var pid = el.dataset.pageId;
  if (!pid || pid === '0') return;  // not configured

  // Show spinner
  el.innerHTML =
    '<div class="flex items-center gap-2 text-gray-400 text-xs h-full justify-center">'
    + '<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-wblue"></div>'
    + '<span>Loading…</span></div>';

  // Fetch list + summary in parallel
  Promise.all([
    fetch('/home/subscriptions/' + pid + '/list',    {credentials: 'same-origin'}).then(function(r){ return r.json(); }),
    fetch('/home/subscriptions/' + pid + '/summary', {credentials: 'same-origin'}).then(function(r){ return r.json(); }),
  ]).then(function(results) {
    var items   = results[0];   // array of subscription objects
    var summary = results[1];   // {monthly_total, yearly_total, by_category, currency}

    // Handle API errors
    if (!Array.isArray(items)) {
      el.innerHTML = '<p class="text-xs text-red-400 p-2">Could not load subscriptions.</p>';
      return;
    }

    // Active only
    var active = items.filter(function(s){ return s.active; });

    // Restore last slide from localStorage (default 0)
    var savedSlide = parseInt(localStorage.getItem('bw-subs-slide-' + wid) || '0', 10);
    if (savedSlide !== 0 && savedSlide !== 1) savedSlide = 0;

    // Build HTML
    el.innerHTML = _subsWgtBuildHtml(wid, pid, active, summary, savedSlide);

    // Paint chart if starting on slide 1, or pre-load lib
    _subsWgtEnsureChart(function() {
      if (savedSlide === 1) _subsWgtRenderChart(wid, summary);
    });
  }).catch(function(err) {
    console.error('[subs-widget] load failed:', err);
    el.innerHTML = '<p class="text-xs text-red-400 p-2">Failed to load data.</p>';
  });
}

function _subsWgtBuildHtml(wid, pid, active, summary, slide) {
  var currency = (summary.currency || 'USD');
  var monthly  = (summary.monthly_total || 0).toFixed(2);
  var yearly   = (summary.yearly_total  || 0).toFixed(2);
  var maxRows  = 5;
  var shown    = active.slice(0, maxRows);
  var extra    = active.length - shown.length;

  // ── Slide 0: list ──────────────────────────────────────────────────────
  var cycleLabel = {1:'daily', 2:'weekly', 3:'monthly', 4:'yearly'};
  var rows = shown.map(function(s) {
    var dot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;'
            + 'background:' + (s.color || '#0053e2') + ';flex-shrink:0;"></span>';
    var cycle = cycleLabel[s.cycle] || 'mo';
    return '<div class="flex items-center gap-1.5 py-0.5">'
      + dot
      + '<span class="flex-1 min-w-0 text-xs truncate text-gray-700 dark:text-zinc-200">'
      + _swEsc(s.name) + '</span>'
      + '<span class="text-xs tabular-nums text-gray-500 dark:text-zinc-400 flex-shrink-0">'
      + currency + '\u00a0' + Number(s.amount).toFixed(2)
      + '<span class="text-[10px] text-gray-400 dark:text-zinc-500">/'+cycle+'</span>'
      + '</span></div>';
  }).join('');

  var moreRow = extra > 0
    ? '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-1">+' + extra + ' more</p>'
    : '';

  var slide0 =
    '<div class="flex-1 min-h-0 overflow-y-auto">'
    + (rows || '<p class="text-xs text-gray-400 dark:text-zinc-500">No active subscriptions.</p>')
    + moreRow + '</div>'
    + _subsWgtFooter(currency, monthly, pid);

  // ── Slide 1: donut ─────────────────────────────────────────────────────
  var slide1 =
    '<div class="flex-1 min-h-0 flex flex-col items-center justify-center">'
    + '<div style="position:relative;height:140px;width:100%;">'
    + '<canvas id="subs-sw-chart-' + wid + '"></canvas>'
    + '</div>'
    + '<p class="text-[11px] text-gray-500 dark:text-zinc-400 mt-1 tabular-nums">'
    + 'Monthly: ' + currency + '\u00a0' + monthly
    + '\u2002\u00b7\u2002Yearly: ' + currency + '\u00a0' + yearly + '</p>'
    + '</div>'
    + _subsWgtFooter(currency, monthly, pid);

  // ── Chrome: dots + arrows ──────────────────────────────────────────────
  var dot = function(idx) {
    var active = idx === slide ? 'background:#0053e2;' : 'background:#d1d5db;';
    return '<button type="button" '
      + 'onclick="_subsWgtGoto(\'' + wid + '\',' + idx + ')" '
      + 'aria-label="Slide ' + (idx+1) + '" '
      + 'style="width:6px;height:6px;border-radius:50%;border:none;cursor:pointer;padding:0;'
      + active + '"></button>';
  };

  var nav =
    '<div class="flex items-center justify-center gap-1.5 pt-1 pb-0.5">'
    + dot(0) + dot(1) + '</div>';

  return '<div class="flex flex-col h-full" id="subs-sw-inner-' + wid + '">'
    + '<div id="subs-sw-s0-' + wid + '" class="flex flex-col flex-1 min-h-0"'
    + (slide === 1 ? ' style="display:none"' : '') + '>' + slide0 + '</div>'
    + '<div id="subs-sw-s1-' + wid + '" class="flex flex-col flex-1 min-h-0"'
    + (slide === 0 ? ' style="display:none"' : '') + '>' + slide1 + '</div>'
    + nav + '</div>';
}

function _subsWgtFooter(currency, monthly, pid) {
  return '<div class="border-t border-gray-100 dark:border-zinc-800 pt-1 mt-1'
    + ' flex items-center justify-between">'
    + '<span class="text-[11px] text-gray-500 dark:text-zinc-400 tabular-nums">'
    + 'Monthly: ' + currency + '\u00a0' + monthly + '</span>'
    + '<button type="button" onclick="openHomePage(' + pid + ')" '
    + 'class="text-[11px] text-wblue hover:underline">→ Open</button>'
    + '</div>';
}

function _subsWgtGoto(wid, idx) {
  var s0 = document.getElementById('subs-sw-s0-' + wid);
  var s1 = document.getElementById('subs-sw-s1-' + wid);
  if (!s0 || !s1) return;
  s0.style.display = idx === 0 ? '' : 'none';
  s1.style.display = idx === 1 ? '' : 'none';
  // Update dots by rebuilding just the nav row — simplest approach:
  // Re-query all dot buttons inside the widget's nav div and flip their color.
  var inner = document.getElementById('subs-sw-inner-' + wid);
  if (inner) {
    inner.querySelectorAll('button[aria-label^="Slide"]').forEach(function(btn, i) {
      btn.style.background = (i === idx) ? '#0053e2' : '#d1d5db';
    });
  }
  // Persist slide choice
  try { localStorage.setItem('bw-subs-slide-' + wid, idx); } catch(_) {}
  // Paint chart on demand (lazy — only if not already painted)
  if (idx === 1) {
    _subsWgtEnsureChart(function() {
      _subsWgtRenderChart(wid, _subsWgtSummaryCache[wid]);
    });
  }
}

// Cache summary per widget so _subsWgtGoto can pass data to chart renderer
// without a second fetch.
var _subsWgtSummaryCache = {};

// --- re-wire _loadSubscriptionsSummary to populate the cache ---
// (Add the line `_subsWgtSummaryCache[wid] = summary;` inside the .then()
//  block in _loadSubscriptionsSummary, before calling _subsWgtBuildHtml.)

function _subsWgtEnsureChart(cb) {
  if (typeof Chart !== 'undefined') { cb(); return; }
  if (!_subsWgtChartPromise) {
    _subsWgtChartPromise = new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = '/static/js/vendor/chart.umd.min.js';
      s.onload  = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  _subsWgtChartPromise.then(cb).catch(function(e) {
    console.error('[subs-widget] Chart.js load failed:', e);
  });
}

// Map of widgetId → Chart instance for proper destroy-before-recreate
var _subsWgtCharts = {};

function _subsWgtRenderChart(wid, summary) {
  var canvas = document.getElementById('subs-sw-chart-' + wid);
  if (!canvas || typeof Chart === 'undefined') return;
  if (_subsWgtCharts[wid]) { _subsWgtCharts[wid].destroy(); delete _subsWgtCharts[wid]; }

  var cats    = (summary && summary.by_category) || [];
  if (cats.length === 0) {
    if (canvas.parentElement) {
      canvas.parentElement.innerHTML =
        '<p class="text-xs text-gray-400 flex items-center justify-center h-full">No category data</p>';
    }
    return;
  }

  var palette = ['#0053e2','#ffc220','#2a8703','#ea1100',
                 '#6366f1','#f59e0b','#10b981','#8b5cf6','#06b6d4'];
  var labels  = cats.map(function(c){ return c.category || 'Other'; });
  var data    = cats.map(function(c){ return c.monthly_total; });
  var colors  = labels.map(function(_,i){ return palette[i % palette.length]; });

  _subsWgtCharts[wid] = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: data, backgroundColor: colors,
            borderWidth: 1, borderColor: '#ffffff' }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return ' ' + ctx.label + ': ' + (summary.currency||'USD') + ' '
                + Number(ctx.parsed).toFixed(2) + '/mo';
            }
          }
        }
      }
    }
  });
}

function _swEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
```

> **Note on `_subsWgtSummaryCache`:** inside `_loadSubscriptionsSummary`'s
> `.then()`, add `_subsWgtSummaryCache[wid] = summary;` immediately before
> the `el.innerHTML = _subsWgtBuildHtml(…)` call.  This lets `_subsWgtGoto`
> pass the correct summary to the chart renderer without a second fetch.

---

## `WIDGET_STYLES` entry (Step 3 reference)

In `home-widgets.js`, add inside the `WIDGET_STYLES` object (after the
`upload_preview` entry):

```javascript
subscriptions_summary: [['default', '💳 Summary']],
```

A single style so the style picker shows one option and sets `style='default'`
automatically — no user choice needed.

---

## `WIDGET_CONFIG_FIELDS` entry (Step 3 reference)

```javascript
subscriptions_summary: () => [
  { id: 'cf-subs-page', label: 'Subscriptions page',
    type: 'select-subs-pages', name: 'page_id' },
],
```

---

## `select-subs-pages` handler — `aw_refreshConfig` (Step 3 reference)

Inside `aw_refreshConfig` in `home-widgets.js`, add immediately after the
`if (f.type === 'select-crm-pages') { … }` block:

```javascript
if (f.type === 'select-subs-pages') {
  var _subsSelId   = f.id;
  var _subsSelName = f.name;
  setTimeout(function() {
    fetch('/home/pages', { credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
    .then(function(r) { return r.ok ? r.json() : { pages: [] }; })
    .then(function(data) {
      var pages = (data.pages || []).filter(function(p) {
        return p.page_type === 'subscriptions';
      });
      var sel = document.getElementById(_subsSelId);
      if (!sel) return;
      if (pages.length === 0) {
        sel.innerHTML = '<option value="">— no Subscriptions pages found —</option>';
        return;
      }
      sel.innerHTML = '<option value="">— pick a page —</option>'
        + pages.map(function(p) {
            return '<option value="' + p.id + '">' + p.name + '</option>';
          }).join('');
    }).catch(function() {});
  }, 50);
  return '<div>' + lbl
    + '<select id="' + f.id + '" data-name="' + f.name + '"'
    + ' class="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg'
    + ' px-3 py-2 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    + ' focus:outline-none focus:ring-2 focus:ring-wblue">'
    + '<option value="">Loading…</option></select></div>';
}
```

---

## `select-subs-pages` handler — settings modal (Step 4 reference)

In `home-widgets-settings.js`, inside the field-renderer loop, add after the
`} else if (f.type === 'select-crm-pages') { … }` block:

```javascript
} else if (f.type === 'select-subs-pages') {
  const _ssId   = f.id;
  const _ssKey  = f.name;
  const _ssSaved = String(curVal || '');
  const _ssSaveFn = `saveWidgetSettings(${widgetId})`;
  wrap.innerHTML = lbl + `<select id="${_ssId}" data-cfg-key="${_ssKey}"
    class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
           bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
           focus:outline-none focus:ring-2 focus:ring-wblue"
    onchange="${_ssSaveFn}">
    <option value="">Loading…</option>
  </select>`;
  body.appendChild(wrap);
  fetch('/home/pages', { credentials: 'same-origin',
    headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
    .then(r => r.ok ? r.json() : { pages: [] })
    .then(data => {
      const sel = document.getElementById(_ssId);
      if (!sel) return;
      const pages = (data.pages || []).filter(p => p.page_type === 'subscriptions');
      sel.innerHTML = '<option value="">— pick a page —</option>'
        + pages.map(p =>
            `<option value="${p.id}"${String(p.id) === _ssSaved ? ' selected' : ''}>${p.name}</option>`
          ).join('');
    }).catch(() => {});
  return;  // early-out — already appended
```

**Post-save reload hook:** At the end of `_saveWidgetFullConfig`, after the
DOM `dataset.widgetConfig` update block, add:

```javascript
// Reload subscriptions summary widgets after config save
if (card && card.dataset.widgetType === 'subscriptions_summary') {
  var ssEl = card.querySelector('.subs-summary-widget');
  if (ssEl) {
    var newPid = config.page_id;
    if (newPid) {
      ssEl.dataset.pageId = newPid;
      if (typeof _loadSubscriptionsSummary === 'function') _loadSubscriptionsSummary(ssEl);
    }
  }
}
```

---

## `initHomeWidgets` dispatch (Step 3 reference)

In `initHomeWidgets()` in `home-widgets.js`, add after the `Upload Preview`
block and before the `Stack carousel` block:

```javascript
// Subscriptions Summary widgets
document.querySelectorAll('.subs-summary-widget').forEach(function(el) {
  if (typeof _loadSubscriptionsSummary === 'function') _loadSubscriptionsSummary(el);
});
```

---

## Add-Widget Modal entry (Step 2 reference)

In `home_add_widget_modal.html`, inside the **Advanced** section Jinja2 loop,
add `('subscriptions_summary', '💳', 'Subscriptions')` after the `buds` entry:

```jinja2
{% for wtype, icon, label in [
    ('rss_feed', '📡', 'RSS Feed'),
    ('buds',     '🌸', 'Buds'),
    ('subscriptions_summary', '💳', 'Subscriptions'),
] %}
```

---

## Stack label map entry (Step 6 reference)

In `home-widget-stack.js`, inside the widget label map object, add after the
`upload_preview` entry:

```javascript
subscriptions_summary: ['Subscriptions', '💳'],
```

---

## Implementation Checklist

- [ ] **1** — Open `templates/partials/home_page.html`.
  Add the `render_subscriptions_summary(w)` macro (use skeleton above) just
  before the `render_stack_child` macro (≈ line 1570).

- [ ] **2** — In the same file, find the top-level widget dispatch grid
  (≈ line 1818, the big `{% for w in widgets %}` loop).
  Add the branch:
  ```jinja2
  {% elif w.widget_type == 'subscriptions_summary' %}  {{ render_subscriptions_summary(w) }}
  ```
  immediately after the `upload_preview` branch.

- [ ] **3** — In the same file, find `render_stack_child` (≈ line 1622).
  Add the branch:
  ```jinja2
  {% elif w.widget_type == 'subscriptions_summary' %}  {{ render_subscriptions_summary(w) }}
  ```
  after the `upload_preview` branch there too.

- [ ] **4** — Open `templates/partials/home_add_widget_modal.html`.
  Add `('subscriptions_summary', '💳', 'Subscriptions')` to the **Advanced**
  section Jinja2 loop (after the `buds` entry).

- [ ] **5** — Open `static/js/home-widgets.js`.
  Add `subscriptions_summary: [['default', '💳 Summary']],` inside
  `WIDGET_STYLES` after the `upload_preview` entry.

- [ ] **6** — In `home-widgets.js`, add the `WIDGET_CONFIG_FIELDS` entry for
  `subscriptions_summary` (see reference above) after the `upload_preview`
  entry.

- [ ] **7** — In `home-widgets.js`, inside `aw_refreshConfig`, add the
  `select-subs-pages` handler block (see reference above) immediately after
  the matching `select-crm-pages` block.

- [ ] **8** — In `home-widgets.js`, inside `initHomeWidgets()`, add the
  `.subs-summary-widget` dispatch block (see reference above).

- [ ] **9** — Open `static/js/home-widgets-settings.js`.
  Add the `select-subs-pages` handler in the field-renderer loop (see
  reference above) immediately after the `select-crm-pages` block.

- [ ] **10** — In `home-widgets-settings.js`, add the post-save reload hook
  at the end of `_saveWidgetFullConfig` (see reference above).

- [ ] **11** — Open `static/js/home-widgets-render.js`.
  Append the entire `_loadSubscriptionsSummary` engine block (all functions
  from the skeleton above) to the **bottom** of the file.
  Confirm every local variable is `var`, not `let`/`const`.
  Add `_subsWgtSummaryCache[wid] = summary;` inside the `.then()` of
  `_loadSubscriptionsSummary` before the `el.innerHTML` call.

- [ ] **12** — Open `static/js/home-widget-stack.js`.
  Add `subscriptions_summary: ['Subscriptions', '💳'],` to the widget label
  map after the `upload_preview` entry.

- [ ] **13** — Smoke-test locally:
  - Create a `subscriptions` type home page, add a few subscriptions.
  - Navigate to a `dashboard` page, add a `Subscriptions Summary` widget.
  - Open widget ⚙️ Settings → pick the subscriptions page → widget reloads.
  - Verify Slide 0 (list) renders ≤5 rows + "+N more" if applicable.
  - Click the dot / arrow to Slide 1 → donut chart paints.
  - Refresh the browser → correct slide is restored from localStorage.
  - Click "→ Open" → navigates to the subscriptions page.
  - Drag the widget into a stack → both slides still work.

- [ ] **14** — Run `bookworm-template-audit` (pass: files changed + what
  changed).

- [ ] **15** — Run `bookworm-qa` (pass: new widget type, endpoints used, what
  to verify).

- [ ] **16** — Run `bookworm-pre-commit` (pass: staged files list).

- [ ] **17** — Run `bookworm-docs-keeper` to add `subscriptions_summary` to
  the widget table in `CODEPUPPY_NOTES.md`.

---

## Open Questions

**Q1 — Slide persistence: `localStorage` vs `config_json`?**
The brief says store `slide` in `config_json` but then says "no extra endpoints
needed" — those two statements are contradictory (writing `config_json`
_requires_ a POST to `/home/widgets/{id}/update-config`).  This plan uses
`localStorage` (zero network cost, survives refresh, cleared only if the user
clears browser storage).  If server-side persistence is required instead, add
a debounced call to `_saveWidgetFullConfig` on slide change and include
`slide` in the config schema.  Confirm with the developer before coding.

**Q2 — Widget default size?**
The brief doesn't specify a default `col_span`/`row_span` for this widget.
The add-widget flow in `aw_submit` uses `col_span: 1, row_span: 1` as the
default unless overridden.  The donut chart at slide 1 needs at least `row_span:
2` (≈15rem) to look good.  Should `aw_submit` set a taller default for this
type, or should the user always resize manually?  Current plan: let the user
resize; add a note in the widget placeholder text ("Tip: resize to 2+ rows for
the best chart view").

**Q3 — Currency display when subscriptions use mixed currencies?**
`get_summary_data` sums `monthly_equiv` across all currencies without
conversion (Phase 1 design decision).  The widget will display whatever
currency string comes back from the API (`summary.currency`).  If a user has
subscriptions in USD + EUR the total will be meaningless.  Out of scope for
this widget — document the limitation in the widget footer (e.g.
"Monthly: USD 45.00 *" with a note).  Or simply display the raw number and let
the user understand.  Confirm desired behaviour before coding.

**Q4 — Empty-state for no subscriptions pages?**
If the user has zero pages of type `subscriptions`, the `select-subs-pages`
picker shows "— no Subscriptions pages found —" (already handled in the
skeleton).  Should the Add Widget button be disabled in that case, or let the
user add the widget unconfigured and show the setup-prompt placeholder?
Current plan: allow adding unconfigured — the placeholder tells them what to
do.
