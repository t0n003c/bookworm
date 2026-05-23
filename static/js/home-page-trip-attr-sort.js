/**
 * home-page-trip-attr-sort.js
 * Drag-to-reorder for custom attribute rows in the spot and location edit forms.
 *
 * Public API:
 *   window.tripAttrSortWire(listId)
 *     Wire one attr list element for drag-reorder. Call after each form render
 *     (safe to call repeatedly — the list is rebuilt fresh on each modal open).
 *
 * Works for both:
 *   #tsf-attrs-list  (spot modal,     row attr: data-attr-row)
 *   #tlf-attrs-list  (location modal, row attr: data-attr-row)
 *
 * Technique: pointer-capture delegation on the list element.
 *   pointerdown on .trip-attr-grip → capture pointer to list
 *   pointermove                    → reposition the purple insert-line indicator
 *   pointerup / pointercancel      → commit reorder or abort
 *
 * Save order: both _tripSpotCollectAttrs and _tripLocCollectAttrs iterate DOM
 * order positionally, so moving rows in the DOM automatically persists order.
 *
 * Rules: var only — no let/const (global defer script).
 */

/* ── Six-dot drag grip SVG (2×3 grid) ────────────────────────────────────── */
var _TRIP_GRIP_SVG = (
  '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" ' +
  'aria-hidden="true" focusable="false">' +
  '<circle cx="3"   cy="2.5"  r="1.2"/>' +
  '<circle cx="7"   cy="2.5"  r="1.2"/>' +
  '<circle cx="3"   cy="7"    r="1.2"/>' +
  '<circle cx="7"   cy="7"    r="1.2"/>' +
  '<circle cx="3"   cy="11.5" r="1.2"/>' +
  '<circle cx="7"   cy="11.5" r="1.2"/>' +
  '</svg>'
);

/* ── HTML injected as the first child of every attr row ──────────────────── */
// -ml-4 pulls the grip into the pl-4 wrapper padding zone so the key
// input that follows stays aligned with the detail-row label column.
var _TRIP_GRIP_HTML = (
  '<div class="trip-attr-grip flex-shrink-0 -ml-4 w-4 h-7 flex items-center justify-center ' +
  'rounded cursor-grab active:cursor-grabbing select-none ' +
  'text-gray-300 dark:text-zinc-600 ' +
  'hover:text-gray-500 dark:hover:text-zinc-400 ' +
  'hover:bg-gray-100 dark:hover:bg-zinc-800 transition" ' +
  'title="Drag to reorder" aria-label="Drag to reorder">' +
  _TRIP_GRIP_SVG +
  '</div>'
);

/* ── Wire drag-reorder on one list element ───────────────────────────────── */
window.tripAttrSortWire = function(listId) {
  var list = document.getElementById(listId);
  if (!list) return;

  /* Private state — scoped to this list invocation */
  var _dragging     = null;   // the row currently being dragged
  var _indicator    = null;   // 2-px purple line shown between rows
  var _insertBefore = null;   // insert dragged row before this element (null = append)

  /* ── Indicator line ──────────────────────────────────────────────────── */
  function _mkIndicator() {
    var el = document.createElement('div');
    Object.assign(el.style, {
      position:      'absolute',
      left:          '0',
      right:         '0',
      height:        '2px',
      borderRadius:  '1px',
      background:    '#7c3aed',
      pointerEvents: 'none',
      zIndex:        '50',
    });
    return el;
  }

  /* ── Find which row the pointer is between ───────────────────────────── */
  function _rowAbovePointer(clientY) {
    var rows = Array.prototype.slice.call(list.querySelectorAll('[data-attr-row]'));
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] === _dragging) continue;
      var mid = rows[i].getBoundingClientRect().top + rows[i].getBoundingClientRect().height / 2;
      if (clientY < mid) return rows[i];
    }
    return null;  // pointer is below all rows → append
  }

  /* ── Reposition indicator ────────────────────────────────────────────── */
  function _placeIndicator(clientY) {
    _insertBefore = _rowAbovePointer(clientY);
    var listTop   = list.getBoundingClientRect().top;
    var topPx;

    if (_insertBefore) {
      topPx = _insertBefore.getBoundingClientRect().top - listTop - 1;
    } else {
      var allRows = list.querySelectorAll('[data-attr-row]');
      if (allRows.length) {
        var last = allRows[allRows.length - 1];
        topPx = last.getBoundingClientRect().bottom - listTop + 1;
      } else {
        topPx = 0;
      }
    }
    _indicator.style.top = Math.max(0, topPx) + 'px';
  }

  /* ── Clean up after drag ends ────────────────────────────────────────── */
  function _cleanup() {
    if (_dragging) {
      _dragging.style.opacity      = '';
      _dragging.style.outline      = '';
      _dragging.style.outlineOffset = '';
      _dragging = null;
    }
    if (_indicator) { _indicator.remove(); _indicator = null; }
    _insertBefore = null;
  }

  /* ── Ensure list has relative positioning for the indicator ─────────── */
  function _ensureRelative() {
    if (window.getComputedStyle(list).position === 'static') {
      list.style.position = 'relative';
    }
  }

  /* ── Event delegation on the list ───────────────────────────────────── */
  list.addEventListener('pointerdown', function(e) {
    if (!e.target.closest('.trip-attr-grip')) return;
    var row = e.target.closest('[data-attr-row]');
    if (!row || row.parentElement !== list) return;

    e.preventDefault();   // prevent text selection during drag
    _dragging = row;

    row.style.opacity      = '0.4';
    row.style.outline      = '2px dashed #7c3aed';
    row.style.outlineOffset = '2px';

    _ensureRelative();
    _indicator = _mkIndicator();
    list.appendChild(_indicator);
    _placeIndicator(e.clientY);

    list.setPointerCapture(e.pointerId);
  });

  list.addEventListener('pointermove', function(e) {
    if (!_dragging) return;
    e.preventDefault();
    _placeIndicator(e.clientY);
  });

  list.addEventListener('pointerup', function(e) {
    if (!_dragging) return;
    e.preventDefault();
    var row = _dragging;
    var target = _insertBefore;
    _cleanup();
    if (target) {
      list.insertBefore(row, target);
    } else {
      list.appendChild(row);
    }
  });

  list.addEventListener('pointercancel', _cleanup);
};
