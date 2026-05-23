/* home-page-grid-touch.js — Mobile touch UX for the Grid Homespace page.
 *
 * Why Touch Events (not Pointer Events)?
 * ─────────────────────────────────────────
 * Pointer Events fire `pointercancel` the instant the browser suspects a
 * scroll gesture. By the time our 500 ms long-press timer fires, the browser
 * has already cancelled us. Touch Events give us a `{passive:false}` listener
 * on `touchmove` so we can call `e.preventDefault()` *after* the long-press
 * fires and block the scroll ourselves — without the browser taking over.
 *
 * Three behaviours
 * ─────────────────
 * 1. Tap image/video  → lightbox (video was fixed: was play/pause before)
 * 2. Long-press (500 ms) → multi-select mode
 *      • Short tap on cell  → toggle checkbox
 *      • Action bar: Delete selected / Done
 * 3. In multi-select, press-and-move → touch drag reorder
 *      • Ghost clone follows finger
 *      • Blue stripe shows insert position
 *      • Lift finger → _gridReorder() called
 *
 * Self-disables on hover-capable desktops.
 *
 * Depends on globals: _gridCells, _gridPid, _gridReorder(),
 *                     _gridLoadCells(), gridLightboxOpen()
 */

/* ── Constants ───────────────────────────────────────────────────────────────── */
var _LONG_PRESS_MS  = 500;
var _DRAG_THRESHOLD = 20;   // px — finger drift tolerance before drag starts

/* ── Multi-select state ──────────────────────────────────────────────────────── */
var _msActive   = false;
var _msSelected = new Set();

/* ── Gesture tracking ────────────────────────────────────────────────────────── */
var _tpTouchId  = null;   // Touch.identifier of active touch
var _tpStartX   = 0;
var _tpStartY   = 0;
var _tpCellId   = null;
var _tpLpFired  = false;  // true after 500 ms long-press timer fires
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

function _tpFindTouch(list) {
    for (var i = 0; i < list.length; i++) {
        if (list[i].identifier === _tpTouchId) return list[i];
    }
    return null;
}

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

/* ── Touch event handlers ────────────────────────────────────────────────────── */
function _tpOnTouchStart(e) {
    if (_tpTouchId !== null) return;         // already tracking a touch
    if (e.touches.length !== 1) return;      // ignore multi-touch (pinch etc.)

    var touch  = e.touches[0];
    var cellEl = touch.target.closest('[data-grid-cell-id]');
    if (!cellEl) return;

    _tpTouchId  = touch.identifier;
    _tpStartX   = touch.clientX;
    _tpStartY   = touch.clientY;
    _tpCellId   = parseInt(cellEl.dataset.gridCellId, 10);
    _tpLpFired  = false;
    _tpDragging = false;

    // Attach move/end/cancel to document so they fire even when finger leaves canvas
    document.addEventListener('touchmove',   _tpOnTouchMove,   { passive: false });
    document.addEventListener('touchend',    _tpOnTouchEnd,    { passive: true });
    document.addEventListener('touchcancel', _tpOnTouchCancel, { passive: true });

    _tpLpTimer = setTimeout(function() {
        _tpLpFired = true;
        if (!_msActive) _msEnter(_tpCellId);
        // If already in multiselect, drag is triggered by movement in _tpOnTouchMove
    }, _LONG_PRESS_MS);
}

function _tpOnTouchMove(e) {
    var touch = _tpFindTouch(e.changedTouches) || _tpFindTouch(e.touches);
    if (!touch) return;

    // ── Critical: prevent browser scroll ONCE we've committed to a gesture ──
    // In multiselect (_msActive): always own the touch — no accidental scrolling.
    // After long-press fires: own it so drag can proceed without pointercancel.
    if (_tpLpFired || _tpDragging || _msActive) e.preventDefault();

    if (_tpDragging) {
        _tpGhostMove(touch.clientX, touch.clientY);
        var overId = _tpCellUnder(touch.clientX, touch.clientY);
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

    var dx   = touch.clientX - _tpStartX;
    var dy   = touch.clientY - _tpStartY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= _DRAG_THRESHOLD) return;

    if (_msActive) {
        // Movement in multiselect = start drag reorder immediately (no second long-press)
        clearTimeout(_tpLpTimer);
        _tpLpFired = true;
        var srcEl = _msCellEl(_tpCellId);
        if (srcEl) {
            _tpDragging = true;
            _tpGhost = _tpGhostCreate(srcEl);
            if (navigator.vibrate) navigator.vibrate(20);
        }
    } else {
        // Not in multiselect + too much movement = user is scrolling, cancel gesture
        _tpReset();
    }
}

function _tpOnTouchEnd(e) {
    var touch = _tpFindTouch(e.changedTouches);
    if (!touch) return;
    clearTimeout(_tpLpTimer);

    if (_tpDragging) {
        var targetId = _tpDragOver;
        var srcId    = _tpCellId;
        _tpGhostDestroy();
        _tpDragging = false;
        _tpRemoveListeners();
        _tpTouchId = null;
        if (targetId && targetId !== srcId) _gridReorder(srcId, targetId, true);
        return;
    }

    var lpFired = _tpLpFired;
    var cellId  = _tpCellId;
    _tpRemoveListeners();
    _tpTouchId = null;

    if (lpFired) return;   // long-press entered multiselect — no further action

    // Short tap in multiselect: toggle selection
    if (_msActive && cellId != null) _msToggle(cellId);
    // Short tap outside multiselect: let the synthetic click open lightbox normally
}

function _tpOnTouchCancel() { _tpReset(); }

function _tpReset() {
    clearTimeout(_tpLpTimer);
    _tpGhostDestroy();
    _tpDragging = false;
    _tpLpFired  = false;
    _tpRemoveListeners();
    _tpTouchId = null;
}

function _tpRemoveListeners() {
    document.removeEventListener('touchmove',   _tpOnTouchMove);
    document.removeEventListener('touchend',    _tpOnTouchEnd);
    document.removeEventListener('touchcancel', _tpOnTouchCancel);
}

/* ── Click capture: block clicks in multiselect + video → lightbox ───────────── */
function _tpClickCapture(e) {
    var cellEl = e.target.closest('[data-grid-cell-id]');
    if (!cellEl) return;
    var cellId = parseInt(cellEl.dataset.gridCellId, 10);

    if (_msActive) {
        // Selection is handled in touchend — block native click entirely
        e.stopPropagation();
        e.preventDefault();
        return;
    }

    // Outside multiselect: video cells need lightbox instead of play/pause
    if (e.target.tagName === 'VIDEO' || cellEl.querySelector('video')) {
        e.stopPropagation();
        e.preventDefault();
        gridLightboxOpen(cellId);
    }
}

/* ── CSS injection (into <head> — survives HTMX innerHTML swaps) ─────────────── */
function _tpInjectCSS() {
    if (document.getElementById('bw-touch-style')) return;
    var s = document.createElement('style');
    s.id = 'bw-touch-style';
    s.textContent = [
        /* Hide hover-only desktop controls on touch devices */
        'body.bw-touch [data-grid-hover-ctrls],',
        'body.bw-touch [data-grid-pencil] { display:none !important; }',
        /* Prevent iOS callout menu and text selection on cells.          */
        /* Without this, iOS fires its own 500 ms long-press → touchcancel */
        /* kills our gesture before our timer even fires.                  */
        'body.bw-touch [data-grid-cell-id] {',
        '  -webkit-touch-callout: none;',
        '  -webkit-user-select: none;',
        '  user-select: none;',
        '}'
    ].join('\n');
    document.head.appendChild(s);
}

/* ── Entry point (called from initGridPage in home-page-grid.js) ─────────────── */
function _gridInitTouch() {
    // Self-disable on true desktop (hover+fine-pointer with no touch screen)
    var hasHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    var hasTouch = navigator.maxTouchPoints > 0;
    if (hasHover && !hasTouch) return;

    _tpInjectCSS();
    document.body.classList.add('bw-touch');

    var canvas = _msCanvas();
    if (!canvas) return;

    // Use removeEventListener+add to be safe against HTMX re-inits
    canvas.removeEventListener('touchstart', _tpOnTouchStart);
    canvas.addEventListener('touchstart', _tpOnTouchStart, { passive: true });

    canvas.removeEventListener('click', _tpClickCapture, true);
    canvas.addEventListener('click', _tpClickCapture, true);

    // Suppress browser context menu on long-press (Android Chrome)
    canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); }, { passive: false });
}
