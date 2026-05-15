'use strict';
/**
 * CRM toolbar — home-page-crm-toolbar.js
 * Defines: crmRenderToolbar, _crmProcessed, _crmGroupValue
 *
 * Layout:
 *   Row 1 │ [flex spacer]        [⇔ Autofit] [⚙ View▾] [☰ Columns▾]
 *   Row 2 │ [All] [Tab…×] [Tab…×]  [+ Save view ___________]
 */

// ── Module state ──────────────────────────────────────────────────────────────
var _crmSortKey      = '';
var _crmFilterField  = '';
var _crmFilterValue  = '';
var _crmGroupField   = '';
var _colPanelOpen    = false;
var _sfgPanelOpen    = false;
var _crmActiveViewId = null;   // null = 'All' pseudo-tab

// ── Shared escape helper ──────────────────────────────────────────────────────
function _tbEsc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Refresh content without toggling panels ───────────────────────────────────
function _crmRefreshContent() {
  if (typeof crmRenderToolbar === 'function') crmRenderToolbar();
  if (typeof _crmView === 'undefined') return;
  if (_crmView === 'gallery') { if (typeof _crmRenderGallery === 'function') _crmRenderGallery(); }
  else                        { if (typeof _crmRenderTable   === 'function') _crmRenderTable();   }
}

// ── Saved views (localStorage, per CRM page) ──────────────────────────────────
function _viewsKey() {
  return 'bw_crm_views_' + (typeof _crmPid !== 'undefined' ? _crmPid : '0');
}
function _loadViews() {
  try { return JSON.parse(localStorage.getItem(_viewsKey()) || '[]'); } catch { return []; }
}
function _saveViews(views) {
  localStorage.setItem(_viewsKey(), JSON.stringify(views));
}

window.crmSaveView = function(name) {
  if (!name || !name.trim()) return;
  var views = _loadViews();
  var id = Date.now().toString(36);
  views.push({
    id, name: name.trim(),
    sort: _crmSortKey, filterField: _crmFilterField,
    filterValue: _crmFilterValue, group: _crmGroupField,
  });
  _saveViews(views);
  _crmActiveViewId = id;
  if (typeof crmRenderToolbar === 'function') crmRenderToolbar();
};

window.crmSaveViewFromInput = function(el) {
  var name = el.value.trim();
  if (!name) return;
  crmSaveView(name);
  el.value = '';
  el.classList.add('hidden');
};

window.crmToggleSaveInput = function() {
  var inp = document.getElementById('crm-view-save-inp');
  if (!inp) return;
  var hidden = inp.classList.toggle('hidden');
  if (!hidden) setTimeout(function() { inp.focus(); }, 0);
};

window.crmDeleteView = function(id) {
  _saveViews(_loadViews().filter(function(v) { return v.id !== id; }));
  if (_crmActiveViewId === id) _crmActiveViewId = null;
  if (typeof crmRenderToolbar === 'function') crmRenderToolbar();
};

window.crmApplyView = function(id) {
  _crmActiveViewId = id;
  if (!id) {
    _crmSortKey = _crmFilterField = _crmFilterValue = _crmGroupField = '';
  } else {
    var v = _loadViews().find(function(x) { return x.id === id; });
    if (!v) return;
    _crmSortKey     = v.sort        || '';
    _crmFilterField = v.filterField || '';
    _crmFilterValue = v.filterValue || '';
    _crmGroupField  = v.group       || '';
  }
  _crmRefreshContent();
};

// ── ⚙ View panel (Sort / Filter / Group) ─────────────────────────────────────
function _buildSfgPanel(sortDefs, filterDefs, filterVals, groupDefs, sc) {
  if (!_sfgPanelOpen) return '';

  const sel = (defs, cur, cb) =>
    `<select class="${sc} w-full" onchange="${cb}(this.value)">` +
    defs.map(([v, l]) =>
      `<option value="${_tbEsc(v)}" ${cur === v ? 'selected' : ''}>${l}</option>`
    ).join('') + `</select>`;

  const filterValSel = _crmFilterField
    ? `<select class="${sc} w-full mt-1" onchange="crmSetFilterValue(this.value)">
         <option value="">— All —</option>` +
      filterVals.map(v =>
        `<option value="${_tbEsc(v)}" ${_crmFilterValue === v ? 'selected' : ''}>${_tbEsc(v)}</option>`
      ).join('') + `</select>`
    : '';

  const section = (label, body) =>
    `<div class="mb-3">
       <p class="text-[10px] font-bold uppercase tracking-wider
                 text-gray-400 dark:text-zinc-500 mb-1.5">${label}</p>
       ${body}
     </div>`;

  const hasActive = _crmSortKey || _crmFilterField || _crmGroupField;

  return `
    <div id="crm-sfg-panel"
         class="absolute z-30 top-full right-0 mt-1 w-72
                bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700
                rounded-xl shadow-xl p-4">
      <p class="text-[11px] font-bold text-gray-700 dark:text-zinc-200 mb-3">View Settings</p>
      ${section('Sort',          sel(sortDefs,   _crmSortKey,     'crmSetSort'))}
      ${section('Filter by',     sel(filterDefs, _crmFilterField, 'crmSetFilterField') + filterValSel)}
      ${section('Group by',      sel(groupDefs,  _crmGroupField,  'crmSetGroup'))}
      ${hasActive ? `
      <div class="border-t border-gray-100 dark:border-zinc-800 pt-3">
        <button onclick="crmClearFilters()"
          class="text-[11px] w-full py-1.5 rounded-lg border border-gray-200 dark:border-zinc-700
                 text-gray-400 hover:text-red-500 hover:border-red-300
                 dark:hover:border-red-700 transition">✕ Clear all</button>
      </div>` : ''}
    </div>`;
}

// ── Saved-views tabs row ──────────────────────────────────────────────────────
function _buildTabsRow() {
  var views   = _loadViews();
  var allActive = !_crmActiveViewId ||
                  !views.find(function(v) { return v.id === _crmActiveViewId; });

  var tabCls = function(active) {
    return 'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium '
      + 'transition whitespace-nowrap flex-shrink-0 ' + (
      active
        ? 'bg-[#0053e2] text-white shadow-sm'
        : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 '
          + 'hover:bg-gray-200 dark:hover:bg-zinc-700');
  };

  var tabs =
    `<button class="${tabCls(allActive)}" onclick="crmApplyView(null)">All</button>`;

  tabs += views.map(function(v) {
    var active = _crmActiveViewId === v.id;
    return `<button class="${tabCls(active)}" onclick="crmApplyView('${_tbEsc(v.id)}')">`
      + _tbEsc(v.name)
      + `<span onclick="event.stopPropagation();crmDeleteView('${_tbEsc(v.id)}')"
               title="Remove view"
               class="ml-1 leading-none opacity-50 hover:opacity-100
                      hover:text-red-300 transition cursor-pointer">&times;</span>`
      + `</button>`;
  }).join('');

  return `
    <div class="flex items-center gap-1.5 px-1 py-2 overflow-x-auto
                border-b border-gray-100 dark:border-zinc-800">
      ${tabs}
      <div class="flex items-center gap-1.5 ml-2 flex-shrink-0">
        <input id="crm-view-save-inp" type="text" placeholder="View name…"
          onkeydown="if(event.key==='Enter'){crmSaveViewFromInput(this)}
                     else if(event.key==='Escape'){this.value='';this.classList.add('hidden')}"
          class="hidden text-xs px-2 py-1 rounded-lg border border-[#0053e2]
                 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200
                 focus:outline-none focus:ring-1 focus:ring-[#0053e2] w-32 transition"/>
        <button onclick="crmToggleSaveInput()" title="Save current settings as a named view"
          class="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium
                 bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400
                 hover:bg-[#0053e2] hover:text-white transition">
          + Save view
        </button>
      </div>
    </div>`;
}

// ── Main toolbar render ───────────────────────────────────────────────────────
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

  // Filter options
  const filterDefs = [['', '\u2500 Field \u2500'], ['company', 'Company']];
  for (const f of fields) filterDefs.push([`cf_${f.id}`, _tbEsc(f.label || ('Field ' + f.id))]);

  const filterVals = [];
  if (_crmFilterField && typeof _crmContacts !== 'undefined') {
    const seen = new Set();
    for (const c of _crmContacts) {
      const v = _crmGroupValue(c, _crmFilterField);
      try { const arr = JSON.parse(v); if (Array.isArray(arr)) { arr.forEach(x => x && seen.add(String(x))); continue; } } catch {}
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

  // Autofit (table only)
  const isTable    = (typeof _crmView !== 'undefined' && _crmView === 'table');
  const autofitBtn = isTable
    ? `<button onclick="crmAutofitCols()" title="Auto-size all columns"
         class="text-[11px] px-2.5 py-1 rounded-lg border border-gray-200 dark:border-zinc-700
                text-gray-500 dark:text-zinc-400 hover:border-[#0053e2]
                hover:text-[#0053e2] transition">\u21d4 Autofit</button>`
    : '';

  // ⚙ View button — show active setting names on the label
  const hasActive  = _crmSortKey || _crmFilterField || _crmGroupField;
  const sfgActive  = hasActive || _sfgPanelOpen;
  const sfgParts   = [];
  if (_crmSortKey)     sfgParts.push('Sort');
  if (_crmFilterField) sfgParts.push('Filter');
  if (_crmGroupField)  sfgParts.push('Group');
  const sfgLabel   = sfgParts.length ? '\u2699\ufe0e ' + sfgParts.join(' \xb7 ') : '\u2699\ufe0e View';
  const sfgBtnCls  = sfgActive
    ? 'border-[#0053e2] text-[#0053e2] bg-blue-50 dark:bg-blue-900/20'
    : 'border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:border-[#0053e2] hover:text-[#0053e2]';

  // ☰ Columns panel
  const hideableCols = (typeof _crmAllHideableCols === 'function') ? _crmAllHideableCols() : [];
  const viewLabel    = (typeof _crmView !== 'undefined' && _crmView === 'gallery') ? 'Gallery view' : 'Table view';
  const colBtnCls    = _colPanelOpen
    ? 'border-[#0053e2] text-[#0053e2] bg-blue-50 dark:bg-blue-900/20'
    : 'border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:border-[#0053e2] hover:text-[#0053e2]';
  const colsPanel    = _colPanelOpen && hideableCols.length ? `
    <div id="crm-col-panel"
         class="absolute z-30 top-full right-0 mt-1 bg-white dark:bg-zinc-900
                border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl p-3 min-w-[180px]">
      <p class="text-[10px] font-bold uppercase tracking-wider
                text-gray-400 dark:text-zinc-500 mb-1">Show / hide fields</p>
      <p class="text-[10px] text-[#0053e2] dark:text-blue-400 mb-2">${viewLabel} only</p>
      ${hideableCols.map(col => {
        const vis = (typeof crmColVisible === 'function') ? crmColVisible(col.id) : true;
        return `<label class="flex items-center gap-2 py-1 cursor-pointer group">
          <input type="checkbox" ${vis ? 'checked' : ''}
            onchange="crmToggleColFromPanel('${_tbEsc(col.id)}')"
            class="accent-[#0053e2] cursor-pointer"/>
          <span class="text-sm text-gray-700 dark:text-zinc-200
                       group-hover:text-[#0053e2] transition">${_tbEsc(col.label)}</span>
        </label>`;
      }).join('')}
    </div>` : '';

  el.innerHTML =
    // Row 1 — right-side controls
    `<div class="flex items-center gap-1.5 px-1 py-2 border-b border-gray-100 dark:border-zinc-800">
       <div class="flex-1"></div>
       <div class="flex items-center gap-1.5">
         ${autofitBtn}
         <div class="relative">
           <button onclick="crmToggleSfgPanel(event)" title="Sort, filter and group"
             class="text-[11px] px-2.5 py-1 rounded-lg border transition ${sfgBtnCls}">
             ${sfgLabel}
           </button>
           ${_buildSfgPanel(sortDefs, filterDefs, filterVals, groupDefs, sc)}
         </div>
         <div class="relative">
           <button onclick="crmToggleColPanel(event)" title="Show/hide columns"
             class="text-[11px] px-2.5 py-1 rounded-lg border transition ${colBtnCls}">
             \u2630 Columns
           </button>
           ${colsPanel}
         </div>
       </div>
     </div>` +
    // Row 2 — saved-views tabs
    _buildTabsRow();

  // Outside-click: close whichever panel is open
  if (_colPanelOpen || _sfgPanelOpen) {
    setTimeout(function() {
      var handler = function(ev) {
        var sfg  = document.getElementById('crm-sfg-panel');
        var col  = document.getElementById('crm-col-panel');
        var save = document.getElementById('crm-view-save-inp');
        var inside = (sfg  && sfg.contains(ev.target))
                  || (col  && col.contains(ev.target))
                  || (save && save.contains(ev.target))
                  || ev.target.closest('[onclick*="crmToggleSfgPanel"]')
                  || ev.target.closest('[onclick*="crmToggleColPanel"]');
        if (!inside) {
          _sfgPanelOpen = false;
          _colPanelOpen = false;
          document.removeEventListener('click', handler);
          if (typeof crmRenderToolbar === 'function') crmRenderToolbar();
        }
      };
      document.addEventListener('click', handler);
    }, 0);
  }
};

// ── Button toggles ────────────────────────────────────────────────────────────
window.crmToggleSfgPanel = function(e) {
  e.stopPropagation();
  _sfgPanelOpen = !_sfgPanelOpen;
  _colPanelOpen = false;   // mutually exclusive
  if (typeof crmRenderToolbar === 'function') crmRenderToolbar();
};

window.crmToggleColPanel = function(e) {
  e.stopPropagation();
  _colPanelOpen = !_colPanelOpen;
  _sfgPanelOpen = false;   // mutually exclusive
  if (typeof crmRenderToolbar === 'function') crmRenderToolbar();
};

window.crmToggleColFromPanel = function(id) {
  if (typeof crmToggleCol === 'function') crmToggleCol(id);
  if (typeof crmRenderToolbar === 'function') crmRenderToolbar();
};

// ── Setters (called by panel selects) ────────────────────────────────────────
window.crmSetSort        = function(k) { _crmSortKey = k;     _crmRefreshContent(); };
window.crmSetFilterField = function(f) { _crmFilterField = f; _crmFilterValue = ''; _crmRefreshContent(); };
window.crmSetFilterValue = function(v) { _crmFilterValue = v; _crmRefreshContent(); };
window.crmSetGroup       = function(f) { _crmGroupField = f;  _crmRefreshContent(); };
window.crmClearFilters   = function()  {
  _crmSortKey = _crmFilterField = _crmFilterValue = _crmGroupField = '';
  _crmActiveViewId = null;
  _crmRefreshContent();
};

// ── _crmGroupValue — extract sort/group key from a contact ────────────────────
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

// ── _crmProcessed — filter + sort + group pipeline ────────────────────────────
window._crmProcessed = function() {
  let rows = (typeof _crmContacts !== 'undefined' ? _crmContacts : []).slice();

  // 1. Text search
  const q = (typeof _crmQuery !== 'undefined' ? _crmQuery : '').toLowerCase();
  if (q) rows = rows.filter(c =>
    [c.name, c.email, c.phone, c.company, c.tags].join(' ').toLowerCase().includes(q)
  );

  // 2. Field filter
  if (_crmFilterField && _crmFilterValue) {
    const fv = _crmFilterValue;
    rows = rows.filter(c => {
      if (_crmFilterField.startsWith('cf_')) {
        const fid = parseInt(_crmFilterField.replace('cf_', ''), 10);
        const raw = String((c.field_values || {})[fid] ?? '');
        try { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.includes(fv); } catch {}
      }
      return _crmGroupValue(c, _crmFilterField) === fv;
    });
  }

  // 3. Sort (group field keeps clusters together as primary key)
  rows.sort((a, b) => {
    if (_crmGroupField) {
      const ga = _crmGroupValue(a, _crmGroupField).toLowerCase();
      const gb = _crmGroupValue(b, _crmGroupField).toLowerCase();
      if (ga < gb) return -1;
      if (ga > gb) return  1;
    }
    if (!_crmSortKey) return 0;
    const lastUS = _crmSortKey.lastIndexOf('_');
    const sf  = _crmSortKey.slice(0, lastUS);
    const dir = _crmSortKey.slice(lastUS + 1);
    const va  = sf === 'name' ? (a.name || '') : _crmGroupValue(a, sf);
    const vb  = sf === 'name' ? (b.name || '') : _crmGroupValue(b, sf);
    const cmp = va.toLowerCase() < vb.toLowerCase() ? -1 : va.toLowerCase() > vb.toLowerCase() ? 1 : 0;
    return dir === 'desc' ? -cmp : cmp;
  });

  return rows;
};
