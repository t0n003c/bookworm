/* home-page-grid-touch.js — Mobile touch UX for the Grid Homespace page.
 *
 * Three behaviours:
 *  1. Tap image  → opens lightbox  (unchanged, image onclick handles it)
 *     Tap video  → opens lightbox  (fixed: was play/pause; intercepted here)
 *  2. Long-press (500 ms) → enters multi-select
 *       • Tap cells to toggle selection
 *       • Action bar: Delete selected / Done
 *  3. While in multi-select, long-press-then-drag a cell → touch-drag reorder
 *       • Ghost clone follows finger
 *       • Blue inset stripe shows insert position
 *       • Drop calls _gridReorder()
 *
 * Self-disables on hover-capable devices (desktop).
 *
 * Bug fixes vs previous version
 * ──────────────────────────────
 * Bug 1 — Icons still showing:
 *   <style> tags injected via HTMX innerHTML are silently ignored by some
 *   browsers.  CSS is now injected into <head> directly from JS so it
 *   always applies regardless of how the page content was loaded.
 *
 * Bug 2 — Multiselect/drag broken:
 *   setPointerCapture() was called on the child cellEl, which redirected
 *   all subsequent pointer events to that element — bypassing the canvas
 *   listeners entirely.  Fixed by attaching pointermove/up/cancel to the
 *   document for the lifetime of the gesture (removed on cleanup).
 *   Drag cancel threshold raised 8 → 20 px (fingers drift more than 8 px
 *   even on a stationary press).
 *
 * Bug 3 — Video lightbox broken:
 *   The expand button lived inside [data-grid-hover-ctrls] which is hidden
 *   on touch, and the video element had play/pause on its onclick.  Fixed
 *   by intercepting clicks on video cells in the capture phase and routing
 *   them to gridLightboxOpen() instead.
 *
 * Depends on globals from home-page-grid.js / home-page-grid-lightbox.js:
 *   _gridCells, _gridPid, _gridReorder(), _gridLoadCells(), gridLightboxOpen()
 */

/* ── Constants ───────────────────────────────────────────────────────────────── */
var _LONG_PRESS_MS  = 500;  // hold duration to trigger long-press
var _DRAG_THRESHOLD = 20;   // px of movement that cancels a long-press (finger drift)

/* ── Multi-select state ──────────────────────────────────────────────────────── */
var _msActive   = false;
var _msSelected = new Set();

/* ── Gesture tracking ────────────────────────────────────────────────────────── */
var _tpId       = null;   // active pointerId
var _tpStartX   = 0;
var _tpStartY   = 0;
var _tpCellId   = null;   // cell id under the first touch
var _tpLpFired  = false;  // did the long-press timer fire yet?
var _tpLpTimer  = null;
var _tpDragging = false;

/* ── Drag ghost ──────────────────────────────────────────────────────────────── */
var _tpGhost    = null;
var _tpDragOver = null;

/* ── DOM helpers ─────────────────────────────────────────────────────────────── */
function _msCanvas()   { return document.getElementById('grid-canvas'); }
function _msBar()      { return document.getElementById('grid-ms-bar'); }
function _msBadge()    { return document.getElementById('grid-ms-count'); }
function _msCellEl(id) { return document.querySelector('[data-grid-cell-id="' + id + '"]'); }

/* ── Enter / exit multi-select ───────────────────────────────────────────────── */
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

/* ── Checkbox overlay ────────────────────────────────────────────────────────── */
function _msChkHtml(selected) {
    return selected
        ? '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24"'
          + ' stroke="currentColor" stroke-width="3">'
          + '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
        : '';
}

function _msChkClass(selected) {
    return 'absolute top-1.5 left-1.5 z-30 w-5 h-5 rounded-full border-2 border-white'
        + ' flex items-center justify-center shadow transition-colors pointer-events-none'
        + (selected ? ' bg-[#0053e2]' : ' bg-black/40');
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
        chk.innerHTML = _msChkHtml(sel);
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

function _msCellRing(el, selected) {
    el.classList.toggle('ring-2',        selected);
    el.classList.toggle('ring-[#0053e2]', selected);
}

function _msToggle(cellId) {
    _msSelected.has(cellId) ? _msSelected.delete(cellId) : _msSelected.add(cellId);
    var el  = _msCellEl(cellId);
    var chk = el && el.querySelector('[data-ms-check]');
    if (chk) {
        var sel = _msSelected.has(cellId);
        chk.className = _msChkClass(sel);
        chk.innerHTML = _msChkHtml(sel);
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
        try {
            await fetch('/home/grid/' + _gridPid + '/cells/' + id, { method: 'DELETE' });
        } catch(e) { console.error('[grid-touch] delete cell', id, e); }
    }
    _msExit();
    await _gridLoadCells();
}

/* ── Ghost drag helpers ──────────────────────────────────────────────────────── */
function _tpGhostCreate(srcEl) {
    var r = srcEl.getBoundingClientRect();
    var g = srcEl.cloneNode(true);
    g.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;'
        + 'width:' + r.width + 'px;height:' + r.height + 'px;'
        + 'opacity:.75;pointer-events:none;z-index:9999;border-radius:12px;'
        + 'box-shadow:0 8px 32px rgba(0,0,0,.4);transform:scale(1.05);';
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

function _tpCellUnder(x, y) {
    if (_tpGhost) _tpGhost.style.visibility = 'hidden';
    var el = document.elementFromPoint(x, y);
    if (_tpGhost) _tpGhost.style.visibility = '';
    while (el && !el.dataset.gridCellId) el = el.parentElement;
    return el ? parseInt(el.dataset.gridCellId, 10) : null;
}

function _tpGhostDestroy() {
    if (_tpGhost) { _tpGhost.remove(); _tpGhost = null; }
    var src = _msCellEl(_tpCellId);
    if (src) src.style.opacity = '';
    if (_tpDragOver) {
        var over = _msCellEl(_tpDragOver);
        if (over) over.style.boxShadow = '';
        _tpDragOver = null;
    }
}

/* ── Document-level move/up/cancel (attached per-gesture) ────────────────────── */
function _tpMove(e) {
    if (e.pointerId !== _tpId) return;

    if (_tpDragging) {
        // Ghost is live — track finger and update drop indicator
        e.preventDefault();
        _tpGhostMove(e.clientX, e.clientY);
        var overId = _tpCellUnder(e.clientX, e.clientY);
        if (overId !== _tpDragOver) {
            if (_tpDragOver) {
                var old = _msCellEl(_tpDragOver);
                if (old) old.style.boxShadow = '';
            }
            _tpDragOver = overId;
            if (overId && overId !== _tpCellId) {
                var nov = _msCellEl(overId);
                if (nov) nov.style.boxShadow = 'inset 4px 0 0 0 #0053e2';
            }
        }
        return;
    }

    var dx   = e.clientX - _tpStartX;
    var dy   = e.clientY - _tpStartY;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= _DRAG_THRESHOLD) return;  // still within hold zone — do nothing

    if (_msActive) {
        // ── Multiselect is on: movement past threshold = start drag immediately ──
        // No second long-press needed — any press-and-move reorders.
        clearTimeout(_tpLpTimer);
        _tpLpFired = true;  // prevents _tpUp from treating this as a tap
        var srcEl = _msCellEl(_tpCellId);
        if (srcEl) {
            _tpDragging = true;
            _tpGhost = _tpGhostCreate(srcEl);
            if (navigator.vibrate) navigator.vibrate(20);
        }
    } else {
        // ── Not in multiselect: movement means scroll — cancel the long-press ──
        _tpReset();
    }
}

function _tpUp(e) {
    if (e.pointerId !== _tpId) return;
    clearTimeout(_tpLpTimer);

    if (_tpDragging) {
        var targetId = _tpDragOver;
        var srcId    = _tpCellId;
        _tpGhostDestroy();
        _tpDragging = false;
        _tpRemoveDocListeners();
        _tpId = null;
        if (targetId && targetId !== srcId) _gridReorder(srcId, targetId, true);
        return;
    }

    var lpFired = _tpLpFired;
    var cellId  = _tpCellId;
    _tpRemoveDocListeners();
    _tpId = null;

    if (lpFired) return;  // long-press already handled (entered multiselect)

    // Short tap — toggle selection if in multiselect; otherwise let native click fire
    if (_msActive && cellId != null) {
        _msToggle(cellId);
    }
}

function _tpCancel(e) {
    if (e.pointerId !== _tpId) return;
    _tpReset();
}

function _tpReset() {
    clearTimeout(_tpLpTimer);
    _tpGhostDestroy();
    _tpDragging  = false;
    _tpLpFired   = false;
    _tpRemoveDocListeners();
    _tpId = null;
}

function _tpRemoveDocListeners() {
    document.removeEventListener('pointermove',   _tpMove);
    document.removeEventListener('pointerup',     _tpUp);
    document.removeEventListener('pointercancel', _tpCancel);
}

/* ── Canvas pointerdown ──────────────────────────────────────────────────────── */
function _tpDown(e) {
    if (e.pointerType === 'mouse') return;  // desktop — HTML5 drag handles it
    if (_tpId !== null) return;             // already tracking a touch

    var cellEl = e.target.closest('[data-grid-cell-id]');
    if (!cellEl) return;

    _tpId      = e.pointerId;
    _tpStartX  = e.clientX;
    _tpStartY  = e.clientY;
    _tpCellId  = parseInt(cellEl.dataset.gridCellId, 10);
    _tpLpFired = false;
    _tpDragging = false;

    // Attach move/up/cancel at document level so they fire regardless of
    // which element the pointer is over (avoids the setPointerCapture routing bug).
    document.addEventListener('pointermove',   _tpMove,   { passive: false });
    document.addEventListener('pointerup',     _tpUp,     { passive: true });
    document.addEventListener('pointercancel', _tpCancel, { passive: true });

    _tpLpTimer = setTimeout(function() {
        _tpLpFired = true;
        // Enter multiselect on the first long-press.
        // If already in multiselect the user is doing a stationary long-press;
        // do nothing here — drag-reorder is started by _tpMove once they move.
        if (!_msActive) _msEnter(_tpCellId);
    }, _LONG_PRESS_MS);
}

/* ── Click capture: multiselect block + video → lightbox ─────────────────────── */
function _tpClickCapture(e) {
    var cellEl = e.target.closest('[data-grid-cell-id]');
    if (!cellEl) return;
    var cellId = parseInt(cellEl.dataset.gridCellId, 10);

    if (_msActive) {
        // In multiselect: all cell clicks are handled by _tpUp; block native handlers
        e.stopPropagation();
        e.preventDefault();
        return;
    }

    // Outside multiselect: video cells — route tap to lightbox instead of play/pause
    if (e.target.closest('video') || cellEl.querySelector('video')) {
        e.stopPropagation();
        e.preventDefault();
        gridLightboxOpen(cellId);
    }
}

/* ── CSS injection — puts styles in <head> so they survive HTMX swaps ────────── */
function _tpInjectCSS() {
    if (document.getElementById('bw-touch-style')) return;  // already injected
    var s = document.createElement('style');
    s.id = 'bw-touch-style';
    s.textContent =
        'body.bw-touch [data-grid-hover-ctrls],'
        + 'body.bw-touch [data-grid-pencil]'
        + '{ display:none !important; }';
    document.head.appendChild(s);
}

/* ── Entry point (called from initGridPage in home-page-grid.js) ─────────────── */
function _gridInitTouch() {
    // Self-disable on true hover+fine-pointer devices (mouse/trackpad desktops).
    // Tablets with keyboards or stylus may report hover:hover, so we also check
    // maxTouchPoints as a secondary signal.
    var hasHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    var hasTouch = navigator.maxTouchPoints > 0;
    if (hasHover && !hasTouch) return;

    _tpInjectCSS();
    document.body.classList.add('bw-touch');

    var canvas = _msCanvas();
    if (!canvas) return;

    // pointerdown on canvas (event delegation — covers dynamically added cells)
    canvas.removeEventListener('pointerdown', _tpDown);  // avoid dupes on HTMX re-init
    canvas.addEventListener('pointerdown', _tpDown, { passive: true });

    // Click capture: block cell clicks in multiselect + video → lightbox
    canvas.removeEventListener('click', _tpClickCapture, true);
    canvas.addEventListener('click', _tpClickCapture, true);

    // Suppress browser context menu on long-press (Android Chrome)
    canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); }, { passive: false });
}
