'use strict';
/**
 * CRM table column preferences — home-page-crm-table.js
 * Handles: column order, hide/show, column widths, drag-to-reorder, resize.
 * Must load BEFORE home-page-crm-toolbar.js (see base.html).
 */

// ── Built-in column definitions ───────────────────────────────────────────────
const _BUILTIN_COLS = [
  {id:'name',    label:'Name',    minW:100, hideable:false, fieldDef:null},
  {id:'company', label:'Company', minW:80,  hideable:true,  fieldDef:null},
  {id:'email',   label:'Email',   minW:120, hideable:true,  fieldDef:null},
  {id:'phone',   label:'Phone',   minW:80,  hideable:true,  fieldDef:null},
  {id:'tags',    label:'Tags',    minW:80,  hideable:true,  fieldDef:null},
];

// ── Module state (var → window-scoped, accessible across sibling modules) ─────
var _crmColOrder       = [];
var _crmHiddenCols     = new Set();
var _crmColWidths      = {};
var _crmColPrefsLoaded = false;

// ── Prefs persistence ─────────────────────────────────────────────────────────
function _colKey(pid) { return `bw_crm_${pid}_cols`; }

window._crmLoadColPrefs = function(pid) {
  if (_crmColPrefsLoaded) return;
  _crmColPrefsLoaded = true;
  try {
    const raw = localStorage.getItem(_colKey(pid));
    if (!raw) return;
    const p = JSON.parse(raw);
    if (Array.isArray(p.order))  _crmColOrder   = p.order;
    if (Array.isArray(p.hidden)) _crmHiddenCols  = new Set(p.hidden);
    if (p.widths && typeof p.widths === 'object') _crmColWidths = p.widths;
  } catch {}
};

function _saveColPrefs() {
  if (typeof _crmPid === 'undefined' || !_crmPid) return;
  try {
    localStorage.setItem(_colKey(_crmPid), JSON.stringify({
      order:  _crmColOrder,
      hidden: [..._crmHiddenCols],
      widths: _crmColWidths,
    }));
  } catch {}
}

// ── Public API — column visibility ────────────────────────────────────────────
/** True when the column is NOT hidden. */
window.crmColVisible = function(id) { return !_crmHiddenCols.has(id); };

/** Toggle a column and re-render. */
window.crmToggleCol = function(id) {
  if (_crmHiddenCols.has(id)) _crmHiddenCols.delete(id);
  else _crmHiddenCols.add(id);
  _saveColPrefs();
  if (typeof crmRenderToolbar === 'function') crmRenderToolbar();
  if (typeof _crmView === 'undefined') return;
  if (_crmView === 'gallery')       { if (typeof _crmRenderGallery === 'function') _crmRenderGallery(); }
  else if (_crmView === 'table')    { if (typeof _crmRenderTable   === 'function') _crmRenderTable();   }
};

// ── Public API — column specs ─────────────────────────────────────────────────
/** Returns ordered, visible column specs (built-ins + custom fields). */
window._crmCols = function() {
  const fields  = typeof _crmFields !== 'undefined' ? _crmFields : [];
  const custom  = fields.map(f => ({id:`cf_${f.id}`, label:f.label, minW:80, hideable:true, fieldDef:f}));
  const all     = [..._BUILTIN_COLS, ...custom];
  const known   = new Set(all.map(c => c.id));

  // Apply saved order (unknown IDs are appended at the end)
  const head    = _crmColOrder.filter(id => known.has(id)).map(id => all.find(c => c.id === id));
  const tail    = all.filter(c => !_crmColOrder.includes(c.id));
  return [...head, ...tail].filter(c => c && !_crmHiddenCols.has(c.id));
};

/** All hideable columns (for the Columns panel). */
window._crmAllHideableCols = function() {
  const fields = typeof _crmFields !== 'undefined' ? _crmFields : [];
  return [
    ..._BUILTIN_COLS.filter(c => c.hideable),
    ...fields.map(f => ({id:`cf_${f.id}`, label:f.label, hideable:true})),
  ];
};

// ── Public API — table interactions ───────────────────────────────────────────
var _dragColId = null;

window.initTableInteractions = function(tableEl) {
  if (!tableEl) return;
  _wireDrag(tableEl);
  _wireResize(tableEl);
};

// ── Drag-to-reorder ───────────────────────────────────────────────────────────
function _wireDrag(tableEl) {
  tableEl.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('dragstart', e => {
      _dragColId = th.dataset.col;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => th.classList.add('opacity-40'), 0);
    });
    th.addEventListener('dragend', () => th.classList.remove('opacity-40'));
    th.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      th.classList.add('bg-[#e8f0ff]', 'dark:bg-blue-900/30');
    });
    th.addEventListener('dragleave', () =>
      th.classList.remove('bg-[#e8f0ff]', 'dark:bg-blue-900/30'));
    th.addEventListener('drop', e => {
      e.preventDefault();
      th.classList.remove('bg-[#e8f0ff]', 'dark:bg-blue-900/30');
      const toId = th.dataset.col;
      if (!_dragColId || !toId || _dragColId === toId) { _dragColId = null; return; }
      // Ensure _crmColOrder is fully populated before mutating
      const fields = typeof _crmFields !== 'undefined' ? _crmFields : [];
      const allIds = [..._BUILTIN_COLS.map(c => c.id), ...fields.map(f => `cf_${f.id}`)];
      if (!_crmColOrder.length) _crmColOrder = allIds.slice();
      allIds.forEach(id => { if (!_crmColOrder.includes(id)) _crmColOrder.push(id); });

      const fi = _crmColOrder.indexOf(_dragColId);
      const ti = _crmColOrder.indexOf(toId);
      if (fi < 0 || ti < 0) { _dragColId = null; return; }
      _crmColOrder.splice(fi, 1);
      _crmColOrder.splice(ti, 0, _dragColId);
      _dragColId = null;
      _saveColPrefs();
      if (typeof _crmRenderTable === 'function') _crmRenderTable();
    });
  });
}

// ── Column resize ─────────────────────────────────────────────────────────────
function _wireResize(tableEl) {
  tableEl.querySelectorAll('th[data-col] .crm-rh').forEach(handle => {
    const th    = handle.closest('th');
    const colId = th.dataset.col;
    const colEl = tableEl.querySelector(`col[data-col="${colId}"]`);
    let sx, sw;

    handle.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      sx = e.clientX; sw = th.offsetWidth;
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = ev => {
        const w = Math.max(60, sw + ev.clientX - sx);
        _crmColWidths[colId] = w;
        if (colEl) colEl.style.width = w + 'px';
      };
      const onUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        _saveColPrefs();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  });
}
