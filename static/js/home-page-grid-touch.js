/* home-page-grid-touch.js — Mobile touch UX for the Grid Homespace page.
 *
 * Provides two features that replace the hover-only desktop controls:
 *
 *  1. Long-press (500 ms) enters multi-select mode:
 *       • Checkboxes appear on every cell.
 *       • Tap a cell to toggle its selection.
 *       • Action bar at the bottom offers "Delete selected" and "Done".
 *
 *  2. While in multi-select, long-press-then-drag a cell to reorder it
 *     (touch-drag ghost follows the finger; drop triggers _gridReorder).
 *
 * Desktop is unaffected — the module self-disables when `(hover:hover)` matches.
 *
 * Depends on globals from home-page-grid.js:
 *   _gridCells, _gridPid, _gridReorder(), _gridLoadCells(), _gridEsc()
 */

/* ── Constants ──────────────────────────────────────────────────────────────── */
var _LONG_PRESS_MS  = 500;   // hold duration to trigger long-press
var _DRAG_THRESHOLD = 8;     // px moved before a long-press becomes a drag

/* ── Multi-select state ─────────────────────────────────────────────────────── */
var _msActive   = false;         // is multi-select mode on?
var _msSelected = new Set();     // set of selected cell IDs (integers)

/* ── Touch / pointer tracking ───────────────────────────────────────────────── */
var _tpId        = null;  // active pointerId
var _tpStartX    = 0;
var _tpStartY    = 0;
var _tpCellId    = null;  // cell under the initial touch
var _tpLpFired   = false; // did the long-press timer fire?
var _tpLpTimer   = null;  // setTimeout handle
var _tpDragging  = false; // are we currently doing a touch-drag reorder?

/* ── Touch-drag ghost ───────────────────────────────────────────────────────── */
var _tpGhost     = null;  // the translucent drag ghost element
var _tpDragOver  = null;  // cell id currently under the ghost

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function _msCanvas()    { return document.getElementById('grid-canvas'); }
function _msBar()       { return document.getElementById('grid-ms-bar'); }
function _msBadge()     { return document.getElementById('grid-ms-count'); }
function _msCellEl(id)  { return document.querySelector('[data-grid-cell-id="' + id + '"]'); }

/* ── Enter / exit multi-select ──────────────────────────────────────────────── */
function _msEnter(firstCellId) {
    _msActive = true;
    _msSelected.clear();
    if (firstCellId != null) _msSelected.add(firstCellId);
    _msRebuildCheckboxes();
    _msUpdateBar();
    var bar = _msBar();
    if (bar) bar.classList.remove('hidden');
    // Haptic pulse on devices that support it
    if (navigator.vibrate) navigator.vibrate(40);
}

function _msExit() {
    _msActive = false;
    _msSelected.clear();
    _msRemoveCheckboxes();
    var bar = _msBar();
    if (bar) bar.classList.add('hidden');
}

/* ── Checkbox overlay management ────────────────────────────────────────────── */
function _msRebuildCheckboxes() {
    var canvas = _msCanvas();
    if (!canvas) return;
    canvas.querySelectorAll('[data-grid-cell-id]').forEach(function(el) {
        var id = parseInt(el.dataset.gridCellId, 10);
        if (el.querySelector('[data-ms-check]')) return;  // already has one

        var chk = document.createElement('div');
        chk.dataset.msCheck = '1';
        chk.className = 'absolute top-1.5 left-1.5 z-30 w-5 h-5 rounded-full border-2 border-white'
            + ' flex items-center justify-center shadow transition-colors pointer-events-none'
            + (_msSelected.has(id)
                ? ' bg-[#0053e2]'
                : ' bg-black/40');
        chk.innerHTML = _msSelected.has(id)
            ? '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">'
              + '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
            : '';
        el.appendChild(chk);
        _msCellHighlight(el, id);
    });
}

function _msCellHighlight(el, id) {
    if (_msSelected.has(id)) {
        el.classList.add('ring-2', 'ring-[#0053e2]');
    } else {
        el.classList.remove('ring-2', 'ring-[#0053e2]');
    }
}

function _msRemoveCheckboxes() {
    document.querySelectorAll('[data-ms-check]').forEach(function(el) { el.remove(); });
    document.querySelectorAll('[data-grid-cell-id]').forEach(function(el) {
        el.classList.remove('ring-2', 'ring-[#0053e2]');
    });
}

function _msToggle(cellId) {
    if (_msSelected.has(cellId)) {
        _msSelected.delete(cellId);
    } else {
        _msSelected.add(cellId);
    }
    var el  = _msCellEl(cellId);
    var chk = el ? el.querySelector('[data-ms-check]') : null;
    if (chk) {
        var sel = _msSelected.has(cellId);
        chk.className = 'absolute top-1.5 left-1.5 z-30 w-5 h-5 rounded-full border-2 border-white'
            + ' flex items-center justify-center shadow transition-colors pointer-events-none'
            + (sel ? ' bg-[#0053e2]' : ' bg-black/40');
        chk.innerHTML = sel
            ? '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">'
              + '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
            : '';
        _msCellHighlight(el, cellId);
    }
    _msUpdateBar();
}

function _msUpdateBar() {
    var badge = _msBadge();
    if (badge) badge.textContent = _msSelected.size + ' selected';
    var delBtn = document.getElementById('grid-ms-del');
    if (delBtn) delBtn.disabled = _msSelected.size === 0;
}

/* ── Batch delete ───────────────────────────────────────────────────────────── */
async function _msDeleteSelected() {
    if (_msSelected.size === 0) return;
    var delBtn = document.getElementById('grid-ms-del');
    if (delBtn) delBtn.disabled = true;
    var ids = Array.from(_msSelected);
    for (var i = 0; i < ids.length; i++) {
        try {
            await fetch('/home/grid/' + _gridPid + '/cells/' + ids[i], { method: 'DELETE' });
        } catch(e) {
            console.error('[grid-touch] delete failed for cell', ids[i], e);
        }
    }
    _msExit();
    await _gridLoadCells();
}

/* ── Touch-drag ghost helpers ────────────────────────────────────────────────── */
function _tpCreateGhost(srcEl) {
    var rect  = srcEl.getBoundingClientRect();
    var ghost = srcEl.cloneNode(true);
    ghost.style.cssText = 'position:fixed;top:' + rect.top + 'px;left:' + rect.left + 'px;'
        + 'width:' + rect.width + 'px;height:' + rect.height + 'px;'
        + 'opacity:0.75;pointer-events:none;z-index:9999;'
        + 'border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.35);'
        + 'transform:scale(1.04);transition:transform 0.1s;';
    document.body.appendChild(ghost);
    srcEl.style.opacity = '0.3';
    return ghost;
}

function _tpMoveGhost(clientX, clientY) {
    if (!_tpGhost) return;
    var rect = _tpGhost.getBoundingClientRect();
    _tpGhost.style.left = (clientX - rect.width / 2) + 'px';
    _tpGhost.style.top  = (clientY - rect.height / 2) + 'px';
}

function _tpFindCellUnder(clientX, clientY) {
    // Temporarily hide the ghost so it doesn't block elementFromPoint
    if (_tpGhost) _tpGhost.style.display = 'none';
    var el = document.elementFromPoint(clientX, clientY);
    if (_tpGhost) _tpGhost.style.display = '';
    while (el && !el.dataset.gridCellId) el = el.parentElement;
    return el ? parseInt(el.dataset.gridCellId, 10) : null;
}

function _tpDestroyGhost() {
    if (!_tpGhost) return;
    _tpGhost.remove();
    _tpGhost = null;
    // Restore opacity on source cell
    var srcEl = _msCellEl(_tpCellId);
    if (srcEl) srcEl.style.opacity = '';
    // Clear any drop indicator
    if (_tpDragOver) {
        var overEl = _msCellEl(_tpDragOver);
        if (overEl) overEl.style.boxShadow = '';
        _tpDragOver = null;
    }
}

/* ── Pointer event handlers ─────────────────────────────────────────────────── */
function _tpOnPointerDown(e) {
    // Only handle single-touch primary pointer (ignore mouse on desktop)
    if (e.pointerType === 'mouse') return;
    if (_tpId !== null) return;     // already tracking a touch

    var cellEl = e.target.closest('[data-grid-cell-id]');
    if (!cellEl) return;

    _tpId      = e.pointerId;
    _tpStartX  = e.clientX;
    _tpStartY  = e.clientY;
    _tpCellId  = parseInt(cellEl.dataset.gridCellId, 10);
    _tpLpFired = false;
    _tpDragging = false;

    // Capture so pointermove/up still fire if finger leaves the element
    try { cellEl.setPointerCapture(e.pointerId); } catch(_) {}

    _tpLpTimer = setTimeout(function() {
        _tpLpFired = true;
        if (!_msActive) {
            _msEnter(_tpCellId);
        } else {
            // Already in multiselect: start drag-reorder
            var srcEl = _msCellEl(_tpCellId);
            if (srcEl) {
                _tpDragging = true;
                _tpGhost = _tpCreateGhost(srcEl);
                if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
            }
        }
    }, _LONG_PRESS_MS);
}

function _tpOnPointerMove(e) {
    if (e.pointerId !== _tpId) return;

    var dx = e.clientX - _tpStartX;
    var dy = e.clientY - _tpStartY;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (!_tpLpFired && dist > _DRAG_THRESHOLD) {
        // Moved too much before long-press fired — cancel it (user is scrolling)
        clearTimeout(_tpLpTimer);
        _tpLpTimer = null;
        _tpId = null;
        return;
    }

    if (_tpDragging) {
        e.preventDefault();  // prevent scroll during drag-reorder
        _tpMoveGhost(e.clientX, e.clientY);

        var overId = _tpFindCellUnder(e.clientX, e.clientY);
        if (overId !== _tpDragOver) {
            // Clear old indicator
            if (_tpDragOver) {
                var oldEl = _msCellEl(_tpDragOver);
                if (oldEl) oldEl.style.boxShadow = '';
            }
            _tpDragOver = overId;
            // Set new indicator
            if (overId && overId !== _tpCellId) {
                var newEl = _msCellEl(overId);
                if (newEl) newEl.style.boxShadow = 'inset 4px 0 0 0 #0053e2';
            }
        }
    }
}

function _tpOnPointerUp(e) {
    if (e.pointerId !== _tpId) return;
    clearTimeout(_tpLpTimer);
    _tpId = null;

    if (_tpDragging) {
        var targetId = _tpDragOver;
        _tpDestroyGhost();
        _tpDragging = false;
        if (targetId && targetId !== _tpCellId) {
            _gridReorder(_tpCellId, targetId, true);
        }
        return;
    }

    if (_tpLpFired) return;  // long-press already handled (entered multiselect)

    // Short tap
    if (_msActive && _tpCellId != null) {
        _msToggle(_tpCellId);
    }
    // If not in multiselect, let the synthetic click event open the lightbox normally
}

function _tpOnPointerCancel(e) {
    if (e.pointerId !== _tpId) return;
    clearTimeout(_tpLpTimer);
    _tpDestroyGhost();
    _tpDragging = false;
    _tpId = null;
    _tpLpFired = false;
}

/* ── Block lightbox click in multi-select ───────────────────────────────────── */
function _msBlockClick(e) {
    if (!_msActive) return;
    // Only block clicks on media cells — allow buttons in action bar
    if (e.target.closest('[data-grid-cell-id]')) {
        e.stopPropagation();
        e.preventDefault();
    }
}

/* ── Entry point ────────────────────────────────────────────────────────────── */
function _gridInitTouch() {
    // Touch-only: if the device supports hover (desktop), do nothing.
    // The hover-controls stay visible and the HTML5 drag API already handles reorder.
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    // Signal to CSS that we're on a touch device — hides per-cell hover controls
    document.body.classList.add('bw-touch');

    var canvas = _msCanvas();
    if (!canvas) return;

    canvas.addEventListener('pointerdown',   _tpOnPointerDown,  { passive: true });
    canvas.addEventListener('pointermove',   _tpOnPointerMove,  { passive: false });
    canvas.addEventListener('pointerup',     _tpOnPointerUp,    { passive: true });
    canvas.addEventListener('pointercancel', _tpOnPointerCancel, { passive: true });
    // Capture phase: swallow clicks on cells while in multi-select
    canvas.addEventListener('click', _msBlockClick, true);
    // Suppress the browser context menu on long-press (Android Chrome)
    canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });
}
