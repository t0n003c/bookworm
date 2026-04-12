'use strict';
/**
 * CRM Filter / Sort / Group toolbar — home-page-crm-toolbar.js
 * Loaded after home-page-crm.js (see base.html).
 * Defines window.crmRenderToolbar, window._crmProcessed, window._crmGroupValue.
 * Called from _crmRender() in home-page-crm.js for table/gallery views.
 */

// ── Module state ──────────────────────────────────────────────────────────────
var _crmSortKey     = '';   // '{field}_{dir}': 'name_asc' | 'company_desc' | 'cf_73_asc'
var _crmFilterField = '';   // 'company' | 'cf_{id}'
var _crmFilterValue = '';   // exact value to match
var _crmGroupField  = '';   // 'company' | 'cf_{id}'

// ── Helpers ───────────────────────────────────────────────────────────────────
function _tbEsc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _crmRefreshContent() {
  if (typeof crmRenderToolbar === 'function') crmRenderToolbar();
  if (typeof _crmView === 'undefined') return;
  if (_crmView === 'gallery') { if (typeof _crmRenderGallery === 'function') _crmRenderGallery(); }
  else                        { if (typeof _crmRenderTable   === 'function') _crmRenderTable();   }
}

// ── Toolbar render ────────────────────────────────────────────────────────────
window.crmRenderToolbar = function() {
  const el = document.getElementById('crm-toolbar');
  if (!el) return;

  const fields = (typeof _crmFields !== 'undefined' ? _crmFields : []);

  // Sort options
  const sortDefs = [
    ['', '\u2500 Sort \u2500'],
    ['name_asc', 'Name A\u2192Z'], ['name_desc', 'Name Z\u2192A'],
    ['company_asc', 'Company A\u2192Z'], ['company_desc', 'Company Z\u2192A'],
  ];
  for (const f of fields) {
    const l = _tbEsc(f.label || ('Field ' + f.id));
    sortDefs.push([`cf_${f.id}_asc`, l + ' A\u2192Z'], [`cf_${f.id}_desc`, l + ' Z\u2192A']);
  }

  // Filter field options
  const filterDefs = [['', '\u2500 Filter \u2500'], ['company', 'Company']];
  for (const f of fields) filterDefs.push([`cf_${f.id}`, _tbEsc(f.label || ('Field ' + f.id))]);

  // Filter value options — unique values from the chosen field
  const filterVals = [];
  if (_crmFilterField && typeof _crmContacts !== 'undefined') {
    const seen = new Set();
    for (const c of _crmContacts) {
      const v = _crmGroupValue(c, _crmFilterField);
      // fan out multi_select arrays
      try {
        const arr = JSON.parse(v);
        if (Array.isArray(arr)) { arr.forEach(x => x && seen.add(String(x))); continue; }
      } catch {}
      if (v) seen.add(v);
    }
    [...seen].sort().forEach(v => filterVals.push(v));
  }

  // Group options
  const groupDefs = [['', 'No grouping'], ['company', 'By Company']];
  for (const f of fields) groupDefs.push([`cf_${f.id}`, 'By ' + _tbEsc(f.label || ('Field ' + f.id))]);

  const sc = [
    'border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1',
    'text-[11px] bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-300',
    'focus:outline-none focus:ring-1 focus:ring-[#0053e2] cursor-pointer',
  ].join(' ');

  const sel = (defs, cur, cb) =>
    `<select class="${sc}" onchange="${cb}(this.value)">` +
    defs.map(([v, l]) => `<option value="${_tbEsc(v)}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('') +
    `</select>`;

  const filterValSel = _crmFilterField
    ? `<select class="${sc}" onchange="crmSetFilterValue(this.value)">` +
      `<option value="">All</option>` +
      filterVals.map(v => `<option value="${_tbEsc(v)}" ${_crmFilterValue === v ? 'selected' : ''}>${_tbEsc(v)}</option>`).join('') +
      `</select>`
    : '';

  const hasActive = _crmSortKey || _crmFilterField || _crmGroupField;
  const clearBtn = hasActive
    ? `<button onclick="crmClearFilters()" title="Clear sort/filter/group"
         class="text-[11px] px-2 py-1 rounded-lg border border-gray-200 dark:border-zinc-700
                text-gray-400 hover:text-red-500 hover:border-red-300 dark:hover:border-red-700 transition">\u2715 Clear</button>`
    : '';

  const lbl = t => `<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">${t}</span>`;

  el.innerHTML =
    `<div class="flex flex-wrap items-center gap-2 px-1 py-2 border-b border-gray-100 dark:border-zinc-800">` +
    lbl('Sort') + ' ' + sel(sortDefs, _crmSortKey, 'crmSetSort') +
    lbl('Filter') + ' ' + sel(filterDefs, _crmFilterField, 'crmSetFilterField') + ' ' + filterValSel +
    lbl('Group') + ' ' + sel(groupDefs, _crmGroupField, 'crmSetGroup') +
    ' ' + clearBtn +
    `</div>`;
};

// ── Setters ───────────────────────────────────────────────────────────────────
window.crmSetSort        = function(key)   { _crmSortKey = key;     _crmRefreshContent(); };
window.crmSetFilterField = function(field) { _crmFilterField = field; _crmFilterValue = ''; _crmRefreshContent(); };
window.crmSetFilterValue = function(val)   { _crmFilterValue = val; _crmRefreshContent(); };
window.crmSetGroup       = function(field) { _crmGroupField = field; _crmRefreshContent(); };
window.crmClearFilters   = function()      { _crmSortKey = _crmFilterField = _crmFilterValue = _crmGroupField = ''; _crmRefreshContent(); };

// ── _crmGroupValue: extract grouping/sorting key from a contact ───────────────
window._crmGroupValue = function(c, field) {
  if (!field) return '';
  if (field === 'company') return c.company || '';
  if (field.startsWith('cf_')) {
    const fid = parseInt(field.replace('cf_', ''), 10);
    const raw = String((c.field_values || {})[fid] ?? '');
    try { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr[0] || ''; } catch {}
    return raw;
  }
  return '';
};

// ── _crmProcessed: full filter + sort + group pipeline ────────────────────────
window._crmProcessed = function() {
  let rows = (typeof _crmContacts !== 'undefined' ? _crmContacts : []).slice();

  // 1. Text search (delegates to existing _crmQuery)
  const q = (typeof _crmQuery !== 'undefined' ? _crmQuery : '').toLowerCase();
  if (q) {
    rows = rows.filter(c =>
      [c.name, c.email, c.phone, c.company, c.tags].join(' ').toLowerCase().includes(q)
    );
  }

  // 2. Field filter
  if (_crmFilterField && _crmFilterValue) {
    const fv = _crmFilterValue;
    rows = rows.filter(c => {
      // multi_select: check each selected option
      if (_crmFilterField.startsWith('cf_')) {
        const fid = parseInt(_crmFilterField.replace('cf_', ''), 10);
        const raw = String((c.field_values || {})[fid] ?? '');
        try { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.includes(fv); } catch {}
      }
      return _crmGroupValue(c, _crmFilterField) === fv;
    });
  }

  // 3. Sort (group field takes priority so rows cluster together)
  rows.sort((a, b) => {
    // Primary: group field (always ascending to keep clusters together)
    if (_crmGroupField) {
      const ga = _crmGroupValue(a, _crmGroupField).toLowerCase();
      const gb = _crmGroupValue(b, _crmGroupField).toLowerCase();
      if (ga < gb) return -1;
      if (ga > gb) return  1;
    }
    // Secondary: chosen sort key
    if (!_crmSortKey) return 0;
    const lastUS = _crmSortKey.lastIndexOf('_');
    const sf  = _crmSortKey.slice(0, lastUS);          // field key
    const dir = _crmSortKey.slice(lastUS + 1);         // 'asc' | 'desc'
    const va  = sf === 'name' ? (a.name || '') : _crmGroupValue(a, sf);
    const vb  = sf === 'name' ? (b.name || '') : _crmGroupValue(b, sf);
    const cmp = va.toLowerCase() < vb.toLowerCase() ? -1 : va.toLowerCase() > vb.toLowerCase() ? 1 : 0;
    return dir === 'desc' ? -cmp : cmp;
  });

  return rows;
};
