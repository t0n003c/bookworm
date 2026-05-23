/* home-page-grid-touch.js — Mobile touch UX for the Grid Homespace page.
 *
 * Gesture model (redesigned)
 * ───────────────────────────
 *  • Tap quickly            → lightbox  (or toggle checkbox in multiselect)
 *  • Press + move >20 px    → single-item drag reorder  (no hold needed)
 *  • Hold 500 ms, no move   → enter multiselect  (first cell auto-selected)
 *    ↳ Tap cell             → toggle checkbox
 *    ↳ Drag any cell        → multi-drag: ALL selected cells move together
 *    ↳ "Done" button        → exit multiselect
 *    ↳ "Delete" button      → batch delete selected
 *
 * Why Touch Events (not Pointer Events)?
 * The browser fires `pointercancel` the instant it decides a touch is a
 * scroll — before our 500 ms timer even fires.  `touchmove` with
 * `{passive:false}` lets us call e.preventDefault() after the long-press
 * fires, blocking the browser from ever reclaiming the gesture.
 *
 * Depends on globals: _gridCells, _gridPid, _gridBusy,
 *                     _gridRender, _gridLoadCells, gridLightboxOpen
 */

/* ── Constants ───────────────────────────────────────────────────────────────── */
var _LONG_PRESS_MS  = 500;
var _DRAG_THRESHOLD = 20;    // px of finger movement before drag begins

/* ── Multi-select state ──────────────────────────────────────────────────────── */
var _msActive   = false;
var _msSelected = new Set();  // Set of selected cell IDs (integers)

/* ── Gesture state ───────────────────────────────────────────────────────────── */
var _tpTouchId  = null;    // Touch.identifier for the current gesture
var _tpStartX   = 0;
var _tpStartY   = 0;
var _tpCellId   = null;    // cell under the initial touch
var _tpLpFired  = false;   // true after 500 ms long-press timer fires
var _tpLpTimer  = null;
var _tpDragging = false;   // true while ghost is live
var _tpMultiDrag = false;  // true if dragging multiple selected cells

/* ── Ghost ───────────────────────────────────────────────────────────────────── */
var _tpGhost    = null;
var _tpDragOver = null;   // cell id currently under ghost

/* ── DOM helpers ─────────────────────────────────────────────────────────────── */
function _msCanvas()   { return document.getElementById('grid-canvas'); }
function _msBar()      { return document.getElementById('grid-ms-bar'); }
function _msBadge()    { return document.getElementById('grid-ms-count'); }
function _msCellEl(id) { return document.querySelector('[data-grid-cell-id="' + id + '"]'); }

function _tpFindTouch(list) {
    for (var i = 0; i < list.length; i++) {
        if (list[i].identifier === _tpTouchId) return list[i];
    }
    return null;
}

/* ── Multi-select enter / exit ───────────────────────────────────────────────── */
function _msEnter(firstId) {
    _msActive = true;
    _msSelected.clear();
    if (firstId != null) _msSelected.add(firstId);
    _msRebuildCheckboxes();
    _msUpdateBar();
    var bar = _msBar();
    if (bar) bar.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate(40);
}

function _msExit() {
    _msActive = false;
    _msSelected.clear();
    _msRemoveCheckboxes();
    var bar = _msBar();
    if (bar) bar.classList.add('hidden');
}

/* ── Checkbox helpers ────────────────────────────────────────────────────────── */
function _msChkHtml(sel) {
    return sel
        ? '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24"'
          + ' stroke="currentColor" stroke-width="3">'
          + '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
        : '';
}

function _msChkClass(sel) {
    return 'absolute top-1.5 left-1.5 z-30 w-5 h-5 rounded-full border-2 border-white'
        + ' flex items-center justify-center shadow transition-colors pointer-events-none'
        + (sel ? ' bg-[#0053e2]' : ' bg-black/40');
}

function _msRebuildCheckboxes() {
    var canvas = _msCanvas();
    if (!canvas) return;
    canvas.querySelectorAll('[data-grid-cell-id]').forEach(function(el) {
        if (el.querySelector('[data-ms-check]')) return;
        var id  = parseInt(el.dataset.gridCellId, 10);
        var sel = _msSelected.has(id);
        var chk = document.createElement('div');
        chk.dataset.msCheck = '1';
        chk.className = _msChkClass(sel);
        chk.innerHTML  = _msChkHtml(sel);
        el.appendChild(chk);
        _msCellRing(el, sel);
    });
}

function _msRemoveCheckboxes() {
    document.querySelectorAll('[data-ms-check]').forEach(function(n) { n.remove(); });
    document.querySelectorAll('[data-grid-cell-id]').forEach(function(el) {
        el.classList.remove('ring-2', 'ring-[#0053e2]');
    });
}

function _msCellRing(el, sel) {
    el.classList.toggle('ring-2',         sel);
    el.classList.toggle('ring-[#0053e2]', sel);
}

function _msToggle(cellId) {
    _msSelected.has(cellId) ? _msSelected.delete(cellId) : _msSelected.add(cellId);
    var el  = _msCellEl(cellId);
    var chk = el && el.querySelector('[data-ms-check]');
    if (chk) {
        var sel = _msSelected.has(cellId);
        chk.className = _msChkClass(sel);
        chk.innerHTML  = _msChkHtml(sel);
        _msCellRing(el, sel);
    }
    _msUpdateBar();
}

function _msUpdateBar() {
    var badge = _msBadge();
    if (badge) badge.textContent = _msSelected.size + ' selected';
    var btn = document.getElementById('grid-ms-del');
    if (btn) btn.disabled = (_msSelected.size === 0);
}

/* ── Batch delete ────────────────────────────────────────────────────────────── */
async function _msDeleteSelected() {
    if (_msSelected.size === 0) return;
    var btn = document.getElementById('grid-ms-del');
    if (btn) btn.disabled = true;
    for (var id of Array.from(_msSelected)) {
        try { await fetch('/home/grid/' + _gridPid + '/cells/' + id, { method: 'DELETE' }); }
        catch(e) { console.error('[grid-touch] delete', id, e); }
    }
    _msExit();
    await _gridLoadCells();
}

/* ── Multi-item reorder ──────────────────────────────────────────────────────── */
// Moves all selected cells to just before/after targetId, preserving their
// relative order.  Uses the same optimistic-update + server POST pattern as
// _gridReorder() in the main grid file.
async function _msMoveSelected(targetId, insertBefore) {
    if (_gridBusy) return;
    _gridBusy = true;

    var selIds   = Array.from(_msSelected);  // ordered by Set insertion = visual order

    // Pull selected cells out, keeping them in their current relative order
    var remaining = _gridCells.filter(function(c) { return !_msSelected.has(c.id); });
    var moving    = [];
    _gridCells.forEach(function(c) { if (_msSelected.has(c.id)) moving.push(c); });

    // Find where to insert inside the remaining array
    var idx = remaining.findIndex(function(c) { return c.id === targetId; });
    if (idx === -1) {
        // targetId is itself selected — insert at end
        idx = remaining.length;
    } else if (!insertBefore) {
        idx += 1;
    }

    // Splice selected group in at the target position
    var newCells = remaining.slice();
    newCells.splice.apply(newCells, [idx, 0].concat(moving));

    // Optimistic update
    newCells.forEach(function(c, i) { c.position = i; });
    _gridCells = newCells;
    _gridRender();

    try {
        var r = await fetch('/home/grid/' + _gridPid + '/reorder', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ order: _gridCells.map(function(c) { return c.id; }) })
        });
        if (!r.ok) throw new Error('reorder ' + r.status);
    } catch(err) {
        console.error('[grid-touch] multi-reorder failed:', err);
        await _gridLoadCells();
    } finally {
        _gridBusy = false;
    }
}

/* ── Ghost helpers ───────────────────────────────────────────────────────────── */
function _tpGhostCreate(srcEl, count) {
    var r = srcEl.getBoundingClientRect();
    var g = srcEl.cloneNode(true);
    // Remove checkbox overlay from the ghost — looks cleaner
    var chk = g.querySelector('[data-ms-check]');
    if (chk) chk.remove();
    g.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;'
        + 'width:' + r.width + 'px;height:' + r.height + 'px;'
        + 'opacity:.80;pointer-events:none;z-index:9999;border-radius:12px;'
        + 'box-shadow:0 8px 32px rgba(0,0,0,.45);transform:scale(1.05);';
    // Badge showing how many items are moving (multi-drag only)
    if (count && count > 1) {
        var badge = document.createElement('div');
        badge.style.cssText = 'position:absolute;top:-8px;right:-8px;'
            + 'background:#0053e2;color:#fff;font-size:12px;font-weight:700;'
            + 'border-radius:999px;min-width:22px;height:22px;'
            + 'display:flex;align-items:center;justify-content:center;'
            + 'box-shadow:0 2px 6px rgba(0,0,0,.3);padding:0 5px;';
        badge.textContent = count;
        g.appendChild(badge);
    }
    document.body.appendChild(g);
    srcEl.style.opacity = '0.3';
    return g;
}

function _tpGhostMove(x, y) {
    if (!_tpGhost) return;
    var r = _tpGhost.getBoundingClientRect();
    _tpGhost.style.left = (x - r.width  / 2) + 'px';
    _tpGhost.style.top  = (y - r.height / 2) + 'px';
}

// Returns { cellId, insertBefore } for the cell under (x,y)
function _tpDropTarget(x, y) {
    if (_tpGhost) _tpGhost.style.visibility = 'hidden';
    var el = document.elementFromPoint(x, y);
    if (_tpGhost) _tpGhost.style.visibility = '';
    while (el && !el.dataset.gridCellId) el = el.parentElement;
    if (!el) return { cellId: null, insertBefore: true };
    var r = el.getBoundingClientRect();
    return {
        cellId:       parseInt(el.dataset.gridCellId, 10),
        insertBefore: x < r.left + r.width / 2
    };
}

function _tpDropIndicator(target) {
    // Clear old indicator
    if (_tpDragOver != null) {
        var old = _msCellEl(_tpDragOver);
        if (old) { old.style.boxShadow = ''; old.style.outline = ''; }
    }
    _tpDragOver = target ? target.cellId : null;
    if (_tpDragOver == null) return;
    var el = _msCellEl(_tpDragOver);
    if (!el) return;
    el.style.boxShadow = target.insertBefore
        ? 'inset 4px 0 0 0 #0053e2'
        : 'inset -4px 0 0 0 #0053e2';
}

function _tpGhostDestroy() {
    if (_tpGhost) { _tpGhost.remove(); _tpGhost = null; }
    var src = _msCellEl(_tpCellId);
    if (src) src.style.opacity = '';
    if (_tpDragOver != null) {
        var over = _msCellEl(_tpDragOver);
        if (over) { over.style.boxShadow = ''; over.style.outline = ''; }
        _tpDragOver = null;
    }
}

/* ── Drag start helper ───────────────────────────────────────────────────────── */
function _tpStartDrag(x, y) {
    var srcEl = _msCellEl(_tpCellId);
    if (!srcEl) return;

    _tpDragging  = true;
    _tpMultiDrag = _msActive && _msSelected.size > 0;

    // Auto-add the touched cell to selection in multi-drag mode
    if (_tpMultiDrag && !_msSelected.has(_tpCellId)) {
        _msToggle(_tpCellId);
    }

    var count = _tpMultiDrag ? _msSelected.size : 0;
    _tpGhost = _tpGhostCreate(srcEl, count);
    _tpGhostMove(x, y);
    if (navigator.vibrate) navigator.vibrate(15);
}

/* ── Touch event handlers ────────────────────────────────────────────────────── */
function _tpOnTouchStart(e) {
    if (_tpTouchId !== null) return;     // already tracking
    if (e.touches.length !== 1) return;  // ignore pinch / multi-touch

    var touch  = e.touches[0];
    var cellEl = touch.target.closest('[data-grid-cell-id]');
    if (!cellEl) return;

    _tpTouchId  = touch.identifier;
    _tpStartX   = touch.clientX;
    _tpStartY   = touch.clientY;
    _tpCellId   = parseInt(cellEl.dataset.gridCellId, 10);
    _tpLpFired  = false;
    _tpDragging = false;
    _tpMultiDrag = false;

    document.addEventListener('touchmove',   _tpOnTouchMove,   { passive: false });
    document.addEventListener('touchend',    _tpOnTouchEnd,    { passive: true  });
    document.addEventListener('touchcancel', _tpOnTouchCancel, { passive: true  });

    _tpLpTimer = setTimeout(function() {
        // Only fire long-press if NOT already dragging (drag beat the timer)
        if (_tpDragging) return;
        _tpLpFired = true;
        if (!_msActive) _msEnter(_tpCellId);
        // If already in multiselect: timer just sets _tpLpFired; drag starts on move
    }, _LONG_PRESS_MS);
}

function _tpOnTouchMove(e) {
    var touch = _tpFindTouch(e.changedTouches) || _tpFindTouch(e.touches);
    if (!touch) return;

    // Prevent browser scroll once we've committed to any gesture
    if (_tpDragging || _tpLpFired || _msActive) e.preventDefault();

    if (_tpDragging) {
        _tpGhostMove(touch.clientX, touch.clientY);
        _tpDropIndicator(_tpDropTarget(touch.clientX, touch.clientY));
        return;
    }

    var dx   = touch.clientX - _tpStartX;
    var dy   = touch.clientY - _tpStartY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= _DRAG_THRESHOLD) return;

    // ── Movement crossed threshold ──────────────────────────────────────────
    if (_msActive || !_tpLpFired) {
        // Start drag: single-item outside multiselect, or multi-drag inside
        clearTimeout(_tpLpTimer);
        _tpLpFired = true;           // marks this as a drag, not a tap
        _tpStartDrag(touch.clientX, touch.clientY);
    }
    // (If we somehow get here with no msActive and lpFired=false, scroll wins — handled above)
}

function _tpOnTouchEnd(e) {
    var touch = _tpFindTouch(e.changedTouches);
    if (!touch) return;
    clearTimeout(_tpLpTimer);

    if (_tpDragging) {
        var target    = _tpDropTarget(touch.clientX, touch.clientY);
        var srcId     = _tpCellId;
        var isMulti   = _tpMultiDrag;
        _tpGhostDestroy();
        _tpDragging  = false;
        _tpMultiDrag = false;
        _tpCleanup();

        if (target.cellId != null) {
            if (isMulti) {
                _msMoveSelected(target.cellId, target.insertBefore);
            } else if (target.cellId !== srcId) {
                _gridReorder(srcId, target.cellId, target.insertBefore);
            }
        }
        return;
    }

    var lpFired = _tpLpFired;
    var cellId  = _tpCellId;
    _tpCleanup();

    if (lpFired) return;  // long-press fired → multiselect entered; no further action

    // Short tap
    if (_msActive && cellId != null) {
        _msToggle(cellId);  // toggle selection in multiselect
    }
    // Outside multiselect: let the synthetic click bubble to open lightbox
}

function _tpOnTouchCancel() { _tpReset(); }

function _tpReset() {
    clearTimeout(_tpLpTimer);
    _tpGhostDestroy();
    _tpDragging  = false;
    _tpMultiDrag = false;
    _tpLpFired   = false;
    _tpCleanup();
}

function _tpCleanup() {
    document.removeEventListener('touchmove',   _tpOnTouchMove);
    document.removeEventListener('touchend',    _tpOnTouchEnd);
    document.removeEventListener('touchcancel', _tpOnTouchCancel);
    _tpTouchId = null;
}

/* ── Click capture: block clicks in multiselect + video → lightbox ───────────── */
function _tpClickCapture(e) {
    var cellEl = e.target.closest('[data-grid-cell-id]');
    if (!cellEl) return;
    var cellId = parseInt(cellEl.dataset.gridCellId, 10);

    if (_msActive) {
        e.stopPropagation();
        e.preventDefault();
        return;
    }

    if (e.target.tagName === 'VIDEO' || cellEl.querySelector('video')) {
        e.stopPropagation();
        e.preventDefault();
        gridLightboxOpen(cellId);
    }
}

/* ── CSS injection ───────────────────────────────────────────────────────────── */
function _tpInjectCSS() {
    if (document.getElementById('bw-touch-style')) return;
    var s = document.createElement('style');
    s.id = 'bw-touch-style';
    s.textContent = [
        'body.bw-touch [data-grid-hover-ctrls],',
        'body.bw-touch [data-grid-pencil] { display:none !important; }',
        /* Prevent iOS callout + text-selection long-press (both fire touchcancel) */
        'body.bw-touch [data-grid-cell-id] {',
        '  -webkit-touch-callout: none;',
        '  -webkit-user-select:   none;',
        '  user-select:           none;',
        '}'
    ].join('\n');
    document.head.appendChild(s);
}

/* ── Entry point ─────────────────────────────────────────────────────────────── */
function _gridInitTouch() {
    var hasHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    var hasTouch = navigator.maxTouchPoints > 0;
    if (hasHover && !hasTouch) return;

    _tpInjectCSS();
    document.body.classList.add('bw-touch');

    var canvas = _msCanvas();
    if (!canvas) return;

    canvas.removeEventListener('touchstart', _tpOnTouchStart);
    canvas.addEventListener('touchstart', _tpOnTouchStart, { passive: true });

    canvas.removeEventListener('click', _tpClickCapture, true);
    canvas.addEventListener('click', _tpClickCapture, true);

    canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); }, { passive: false });
}
