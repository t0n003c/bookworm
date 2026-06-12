/**
 * home-page-trip-multiselect.js
 * Shared long-press multiselect engine for the Trip page card grids:
 *   • Location cards  (#trip-locs-grid,   data-loc-id)
 *   • Spot cards      (#trip-spots-grid,   data-spot-id)
 *   • Trip/Plan cards (#trip-plans-grid,   data-plan-id)
 *
 * Usage (called from the render function of each card grid):
 *   tripMsWireGrid({ gridId, cardAttr, deleteUrl, removeLocal, rerender })
 *
 * Exit from anywhere:
 *   tripMsExit()
 *
 * Rules: var only — safe for HTMX re-injection, no let/const.
 */

/* ── Module state ─────────────────────────────────────────────────────────── */
var _tripMsActive    = false;   // multiselect mode on/off
var _tripMsSelected  = {};      // id (string) → true
var _tripMsCfg       = null;    // active grid config object
var _tripMsToolbar   = null;    // fixed-bottom toolbar DOM element
var _tripMsLongTimer = null;    // long-press timer handle
var _tripMsStartX    = 0;
var _tripMsStartY    = 0;

/* ── One-time CSS injection ───────────────────────────────────────────────── */
function _tripMsInjectCss() {
  if (document.getElementById('trip-ms-styles')) return;
  var s = document.createElement('style');
  s.id = 'trip-ms-styles';
  s.textContent = [
    /* Circular checkbox overlay — hidden by default */
    '.trip-ms-cb{position:absolute;top:8px;left:8px;z-index:2;',
    'width:20px;height:20px;border-radius:50%;border:2px solid #d1d5db;',
    'background:#fff;display:none;align-items:center;justify-content:center;',
    'pointer-events:none;transition:border-color .15s,background .15s;}',
    '.dark .trip-ms-cb{background:#27272a;border-color:#52525b;}',
    /* Show checkboxes and change cursor when grid is in MS mode */
    '.trip-ms-active .trip-ms-cb{display:flex;}',
    '.trip-ms-active [data-loc-id],.trip-ms-active [data-spot-id],.trip-ms-active [data-plan-id]',
    '{cursor:pointer;user-select:none;}',
    /* Selected card: purple outline + filled checkbox */
    '.trip-ms-sel{outline:2px solid #7c3aed !important;outline-offset:1px;}',
    '.trip-ms-sel .trip-ms-cb{background:#7c3aed;border-color:#7c3aed;}',
    /* Checkmark inside the circle */
    '.trip-ms-cb-tick{display:none;color:#fff;}',
    '.trip-ms-sel .trip-ms-cb-tick{display:block;}',
  ].join('');
  document.head.appendChild(s);
}

/* ── Checkbox HTML fragment (injected into each card) ─────────────────────── */
var _TRIP_MS_CB_HTML = (
  '<div class="trip-ms-cb" aria-hidden="true">' +
  '<svg class="trip-ms-cb-tick" style="width:12px;height:12px" fill="none"' +
  ' viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">' +
  '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>' +
  '</svg></div>'
);

/* ── Enter multiselect ────────────────────────────────────────────────────── */
function _tripMsEnter(cfg, firstId) {
  if (_tripMsActive) _tripMsExit();   // clean up any prior grid
  _tripMsActive   = true;
  _tripMsCfg      = cfg;
  _tripMsSelected = {};
  var grid = document.getElementById(cfg.gridId);
  if (grid) grid.classList.add('trip-ms-active');
  if (firstId != null) _tripMsToggle(String(firstId));
  _tripMsShowToolbar();
  document.addEventListener('keydown', _tripMsEscKey);
}

/* ── Exit multiselect ─────────────────────────────────────────────────────── */
function _tripMsExit() {
  _tripMsActive = false;
  if (_tripMsCfg) {
    var grid = document.getElementById(_tripMsCfg.gridId);
    if (grid) {
      grid.classList.remove('trip-ms-active');
      grid.querySelectorAll('.trip-ms-sel').forEach(function(el) {
        el.classList.remove('trip-ms-sel');
      });
    }
  }
  _tripMsCfg      = null;
  _tripMsSelected = {};
  if (_tripMsToolbar) { _tripMsToolbar.remove(); _tripMsToolbar = null; }
  document.removeEventListener('keydown', _tripMsEscKey);
}
window.tripMsExit = _tripMsExit;

function _tripMsEscKey(e) {
  if (e.key === 'Escape') _tripMsExit();
}

/* ── Toggle one card selected / deselected ────────────────────────────────── */
function _tripMsToggle(id, forceOn) {
  var attr = _tripMsCfg && _tripMsCfg.cardAttr;
  var sel  = attr
    ? document.querySelector('#' + _tripMsCfg.gridId + ' [' + attr + '="' + id + '"]')
    : null;
  var on = (forceOn !== undefined) ? forceOn : !_tripMsSelected[id];
  if (on) {
    _tripMsSelected[id] = true;
    if (sel) sel.classList.add('trip-ms-sel');
  } else {
    delete _tripMsSelected[id];
    if (sel) sel.classList.remove('trip-ms-sel');
  }
  _tripMsUpdateCount();
}

/* ── Bottom toolbar ───────────────────────────────────────────────────────── */
function _tripMsShowToolbar() {
  if (_tripMsToolbar) return;
  var dark = document.documentElement.classList.contains('dark');
  var bar  = document.createElement('div');
  bar.id   = 'trip-ms-toolbar';
  Object.assign(bar.style, {
    position:     'fixed',
    bottom:       '24px',
    left:         '50%',
    transform:    'translateX(-50%)',
    zIndex:       '9999',
    display:      'flex',
    alignItems:   'center',
    gap:          '10px',
    padding:      '10px 18px',
    borderRadius: '999px',
    background:   dark ? '#18181b' : '#ffffff',
    border:       '1px solid ' + (dark ? '#3f3f46' : '#e5e7eb'),
    boxShadow:    '0 8px 32px rgba(0,0,0,.22)',
    fontSize:     '14px',
    fontWeight:   '500',
    color:        dark ? '#f4f4f5' : '#111827',
    whiteSpace:   'nowrap',
  });

  var countEl = document.createElement('span');
  countEl.id  = 'trip-ms-count';
  countEl.textContent = '0 selected';

  var sep = document.createElement('div');
  Object.assign(sep.style, {
    width: '1px', height: '20px',
    background: dark ? '#3f3f46' : '#e5e7eb',
  });

  var delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.textContent = '🗑️ Delete selected';
  Object.assign(delBtn.style, {
    padding: '5px 14px', borderRadius: '999px', border: 'none',
    background: '#ea1100', color: '#fff', fontWeight: '600',
    fontSize: '13px', cursor: 'pointer',
  });
  delBtn.addEventListener('click', _tripMsDeleteSelected);

  var cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, {
    padding:    '5px 14px',
    borderRadius: '999px',
    border:     '1px solid ' + (dark ? '#52525b' : '#d1d5db'),
    background: 'transparent',
    color:      dark ? '#a1a1aa' : '#6b7280',
    fontSize:   '13px',
    cursor:     'pointer',
  });
  cancelBtn.addEventListener('click', _tripMsExit);

  bar.appendChild(countEl);
  bar.appendChild(sep);
  bar.appendChild(delBtn);
  bar.appendChild(cancelBtn);
  document.body.appendChild(bar);
  _tripMsToolbar = bar;
  _tripMsUpdateCount();
}

function _tripMsUpdateCount() {
  var n  = Object.keys(_tripMsSelected).length;
  var el = document.getElementById('trip-ms-count');
  if (el) el.textContent = n + (n === 1 ? ' card selected' : ' cards selected');
}

/* ── Delete all selected ──────────────────────────────────────────────────── */
function _tripMsDeleteSelected() {
  var cfg = _tripMsCfg;
  if (!cfg) return;
  var ids = Object.keys(_tripMsSelected);
  if (!ids.length) { _tripMsExit(); return; }
  var n = ids.length;
  if (!confirm('Delete ' + n + (n === 1 ? ' item' : ' items') + '? This cannot be undone.')) return;

  var snapshot = _tripMsSelected;  // capture before exit clears it

  Promise.all(ids.map(function(id) {
    return _tripFetch(cfg.deleteUrl(Number(id)), { method: 'DELETE' })
      .then(function(r) { if (!r.ok) throw new Error('id:' + id); });
  }))
  .then(function() {
    cfg.removeLocal(snapshot);
    _tripMsExit();
    cfg.rerender();
    _tripShowToast('Deleted ' + n + (n === 1 ? ' item.' : ' items.'));
  })
  .catch(function() {
    _tripShowToast('Some items could not be deleted.', true);
    _tripMsExit();
    cfg.rerender();
  });
}

/* ── Wire a grid: long-press + click delegation ───────────────────────────── */
window.tripMsWireGrid = function(cfg) {
  _tripMsInjectCss();
  var grid = document.getElementById(cfg.gridId);
  if (!grid || grid._tripMsWired) return;
  grid._tripMsWired = true;

  var attr = cfg.cardAttr;

  /* Long-press detection ──────────────────────────────────────── */
  grid.addEventListener('pointerdown', function(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;  // left-click only for mouse
    var card = e.target.closest('[' + attr + ']');
    if (!card) return;
    _tripMsStartX    = e.clientX;
    _tripMsStartY    = e.clientY;
    _tripMsLongTimer = setTimeout(function() {
      _tripMsLongTimer = null;
      var id = card.getAttribute(attr);
      if (!_tripMsActive) {
        _tripMsEnter(cfg, id);
      } else if (_tripMsCfg && _tripMsCfg.gridId === cfg.gridId) {
        _tripMsToggle(id);
      }
    }, 500);
  });

  function _cancelLong() {
    if (_tripMsLongTimer) { clearTimeout(_tripMsLongTimer); _tripMsLongTimer = null; }
  }
  grid.addEventListener('pointermove', function(e) {
    if (!_tripMsLongTimer) return;
    var dx = e.clientX - _tripMsStartX;
    var dy = e.clientY - _tripMsStartY;
    if (dx * dx + dy * dy > 64) _cancelLong();   // moved > 8 px, cancel
  });
  grid.addEventListener('pointerup',     _cancelLong);
  grid.addEventListener('pointercancel', _cancelLong);

  /* Click: intercept in capture phase so inline onclick doesn't fire ─── */
  grid.addEventListener('click', function(e) {
    if (!_tripMsActive) return;
    if (!_tripMsCfg || _tripMsCfg.gridId !== cfg.gridId) return;
    var card = e.target.closest('[' + attr + ']');
    if (!card) return;
    e.stopPropagation();
    _tripMsToggle(card.getAttribute(attr));
  }, true);
};
