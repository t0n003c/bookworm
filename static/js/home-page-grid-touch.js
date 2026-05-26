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

/* ── Multi-select state ──────────────────────────────────────────────────── */
var _msActive         = false;
var _msSelected       = new Set();  // Set of selected cell IDs (integers)
var _msCellClickHandler = null;     // stored so we can remove it on exit

/* ── Gesture state ──────────────────────────────────────────────────────── */
var _tpTouchId      = null;   // Touch.identifier for the current gesture
var _tpStartX       = 0;
var _tpStartY       = 0;
var _tpCellId       = null;   // cell under the initial touch
var _tpLpFired      = false;  // true after 500 ms long-press (multiselect) timer fires
var _tpLpTimer      = null;
var _tpArmed        = false;  // true after 200 ms arm timer: drag is now intent
var _tpArmTimer     = null;
var _tpDragging     = false;  // true while ghost is live
var _tpMultiDrag    = false;  // true if dragging multiple selected cells
var _tpLastY        = 0;      // last clientY seen, used by edge-scroll interval
var _tpSuppressClick = false; // block the synthetic click that follows touchend
var _tpScrollCache  = null;   // cached scroll container found by _tpScrollEl()

/* ── Ghost ──────────────────────────────────────────────────────────────────────── */
var _tpGhost    = null;
var _tpDragOver = null;   // cell id currently under ghost

/* ── Edge-scroll during drag ───────────────────────────────────────────────────── */
// setInterval runs BETWEEN touch events — this is what actually renders on
// real Android Chrome. Writing scrollTop synchronously inside touchmove fires
// during compositor scheduling and the visual update is deferred until after
// the gesture ends.  The interval fires on the next JS task, which the
// compositor picks up at the next vsync.
var _TP_SCROLL_ZONE  = 120;   // px from viewport edge that activates scroll
var _TP_SCROLL_MAX   = 24;    // px per interval tick at peak speed (~60 fps)
var _tpEdgeScrollInt = null;  // setInterval handle

// Walk up from #grid-canvas to find the element that actually scrolls.
// Result is cached in _tpScrollCache for the duration of a drag so we
// never call getComputedStyle() inside the 16 ms interval callback.
function _tpScrollEl() {
    if (_tpScrollCache) return _tpScrollCache;
    var el = document.getElementById('grid-canvas');
    while (el && el !== document.documentElement) {
        el = el.parentElement;
        if (!el) break;
        var oy = window.getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
            _tpScrollCache = el;
            return el;
        }
    }
    _tpScrollCache = document.scrollingElement || document.documentElement;
    return _tpScrollCache;
}

function _tpEdgeScrollStart() {
    if (_tpEdgeScrollInt) return;
    _tpEdgeScrollInt = setInterval(function() {
        var el  = _tpScrollEl();
        var vh  = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        var bot = vh - _tpLastY;
        var top = _tpLastY;
        if (bot < _TP_SCROLL_ZONE) {
            el.scrollTop += Math.max(2, Math.round(_TP_SCROLL_MAX * (1 - bot / _TP_SCROLL_ZONE)));
        } else if (top < _TP_SCROLL_ZONE) {
            el.scrollTop -= Math.max(2, Math.round(_TP_SCROLL_MAX * (1 - top / _TP_SCROLL_ZONE)));
        }
    }, 16);
}

function _tpEdgeScrollStop() {
    if (_tpEdgeScrollInt) { clearInterval(_tpEdgeScrollInt); _tpEdgeScrollInt = null; }
}

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

/* ── Multi-select enter / exit ─────────────────────────────────────────────── */
function _msEnter(firstId) {
    _msActive = true;
    _msSelected.clear();
    if (firstId != null) _msSelected.add(firstId);
    _msRebuildCheckboxes();
    _msUpdateBar();

    // ─ Cursor hint only — draggable stays true so HTML5 drag-to-reorder works ─
    document.querySelectorAll('[data-grid-cell-id]').forEach(function(el) {
        el.style.cursor = 'pointer';
    });

    // ─ Event delegation in CAPTURE phase so we intercept before inline onclicks ─
    var canvas = _msCanvas();
    if (canvas) {
        _msCellClickHandler = function(e) {
            var cell = e.target.closest('[data-grid-cell-id]');
            if (!cell) return;
            e.stopPropagation();  // prevent lightbox inline onclick
            e.preventDefault();
            var id = parseInt(cell.dataset.gridCellId, 10);
            if (!isNaN(id)) _msToggle(id);
        };
        canvas.addEventListener('click', _msCellClickHandler, true);
    }

    var bar = _msBar();
    if (bar) bar.classList.remove('hidden');
    var enterBtn = document.getElementById('grid-ms-enter-btn');
    if (enterBtn) enterBtn.classList.add('hidden');
    var doneBtn  = document.getElementById('grid-ms-done-btn');
    if (doneBtn)  doneBtn.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate(40);
}

function _msExit() {
    // ─ Remove delegated listener ─
    var canvas = _msCanvas();
    if (canvas && _msCellClickHandler) {
        canvas.removeEventListener('click', _msCellClickHandler, true);
        _msCellClickHandler = null;
    }

    _msActive = false;
    _msSelected.clear();
    _msRemoveCheckboxes();

    // ─ Restore cursor ─
    document.querySelectorAll('[data-grid-cell-id]').forEach(function(el) {
        el.style.cursor = '';
    });

    var bar = _msBar();
    if (bar) bar.classList.add('hidden');
    var enterBtn = document.getElementById('grid-ms-enter-btn');
    if (enterBtn) enterBtn.classList.remove('hidden');
    var doneBtn  = document.getElementById('grid-ms-done-btn');
    if (doneBtn)  doneBtn.classList.add('hidden');
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
    // Critical: strip the cell-id attribute so elementFromPoint in _tpDropTarget
    // never mistakes the ghost for a valid drop target (would make overId === srcId
    // permanently, suppressing the drop indicator and the reorder call).
    g.removeAttribute('data-grid-cell-id');
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
    // display:none is the only reliable way to exclude an element from
    // elementFromPoint on iOS Safari — visibility:hidden is NOT sufficient.
    if (_tpGhost) _tpGhost.style.display = 'none';
    var el = document.elementFromPoint(x, y);
    if (_tpGhost) _tpGhost.style.display = '';
    while (el && !el.dataset.gridCellId) el = el.parentElement;
    if (!el) return { cellId: null, insertBefore: true };
    var r = el.getBoundingClientRect();
    return {
        cellId:       parseInt(el.dataset.gridCellId, 10),
        insertBefore: x < r.left + r.width / 2
    };
}

function _tpDropIndicator(target) {
    _tpDragOver = target ? target.cellId : null;
    if (_tpDragOver == null) { _gridHideDropLine(); return; }
    var el = _msCellEl(_tpDragOver);
    if (!el) { _gridHideDropLine(); return; }
    _gridShowDropLine(el, target.insertBefore);
}

function _tpGhostDestroy() {
    _tpEdgeScrollStop();
    if (_tpGhost) { _tpGhost.remove(); _tpGhost = null; }
    var src = _msCellEl(_tpCellId);
    if (src) src.style.opacity = '';
    _gridHideDropLine();
    _tpDragOver = null;
}

/* ── Drag start helper ──────────────────────────────────────────────────────────────── */
function _tpStartDrag(x, y) {
    var srcEl = _msCellEl(_tpCellId);
    if (!srcEl) return;

    _tpDragging  = true;
    _tpMultiDrag = _msActive && _msSelected.size > 0;
    _tpScrollEl();  // warm the cache now — before the 16 ms interval starts

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
    if (!cellEl) return;  // no cell → native scroll handles it

    _tpTouchId   = touch.identifier;
    _tpStartX    = touch.clientX;
    _tpStartY    = touch.clientY;
    _tpLastY     = touch.clientY;
    _tpCellId    = parseInt(cellEl.dataset.gridCellId, 10);
    _tpLpFired   = false;
    _tpArmed     = false;
    _tpDragging  = false;
    _tpMultiDrag = false;
    // Note: do NOT call e.preventDefault() here.
    // Keeping touchstart passive lets the compositor start its scroll pipeline,
    // but our non-passive touchmove listener can still call preventDefault() to
    // stop it — as long as we do so on the first touchmove that moves past the
    // slop threshold.  This way vertical swipes get native scroll and only
    // drag gestures get handed to JS.

    document.addEventListener('touchmove',   _tpOnTouchMove,   { passive: false });
    document.addEventListener('touchend',    _tpOnTouchEnd,    { passive: true  });
    document.addEventListener('touchcancel', _tpOnTouchCancel, { passive: true  });

    // Arm timer (200 ms): holding still signals drag intent.
    _tpArmTimer = setTimeout(function() {
        if (_tpDragging) return;
        _tpArmed = true;
        var el = _msCellEl(_tpCellId);
        if (el) el.style.opacity = '0.65';  // visual cue: ready to drag
        if (navigator.vibrate) navigator.vibrate(15);
    }, 200);

    // Long-press timer (500 ms): enter multiselect
    _tpLpTimer = setTimeout(function() {
        if (_tpDragging) return;
        _tpLpFired = true;
        if (!_msActive) _msEnter(_tpCellId);
    }, _LONG_PRESS_MS);
}

// Pre-arm slop: how far a finger must travel before we classify the gesture.
// 12 px handles real-device drift (skin deformation, OS touch-smoothing).
// Must be < _DRAG_THRESHOLD (20 px) so they don't overlap.
var _TP_SLOP = 12;

function _tpOnTouchMove(e) {
    var touch = _tpFindTouch(e.changedTouches) || _tpFindTouch(e.touches);
    if (!touch) return;

    _tpLastY = touch.clientY;  // keep fresh for edge-scroll interval

    // ── Active drag ──
    if (_tpDragging) {
        e.preventDefault();
        _tpGhostMove(touch.clientX, touch.clientY);
        _tpEdgeScrollStart();
        _tpDropIndicator(_tpDropTarget(touch.clientX, touch.clientY));
        return;
    }

    var absDx = Math.abs(touch.clientX - _tpStartX);
    var absDy = Math.abs(touch.clientY - _tpStartY);
    var dist  = Math.sqrt(absDx * absDx + absDy * absDy);

    // ── Armed or long-press: commit drag on any movement past 5 px ──
    if (_tpArmed || _tpLpFired) {
        e.preventDefault();  // keep compositor locked while we wait for threshold
        if (dist >= 5) {
            clearTimeout(_tpLpTimer);
            clearTimeout(_tpArmTimer);
            _tpLpFired = true;  // suppress lightbox/click on touchend
            _tpStartDrag(touch.clientX, touch.clientY);
        }
        return;
    }

    // ── Pre-arm slop zone: gesture unclassified ──
    // Do NOT call preventDefault() here.  Chrome ≥92 decides whether a touch
    // is a scroll within its first 2 animation frames (~33ms) — long before our
    // 200ms arm timer fires.  Blocking the compositor in the slop zone was
    // causing every grid scroll to stutter while the browser waited for JS,
    // with zero benefit: by the time the arm timer fires the browser has already
    // committed to a scroll frame and ignores any subsequent preventDefault().
    if (dist < _TP_SLOP) {
        return;
    }

    // ── Past slop: classify the gesture ──
    // Vertical: stop preventing → compositor takes over natively
    if (absDy > absDx * 1.5) {
        clearTimeout(_tpArmTimer);
        clearTimeout(_tpLpTimer);
        _tpCleanup();
        _tpTouchId = null;
        // no preventDefault → browser handles this as a native scroll
        return;
    }

    // Horizontal / diagonal before arm: prevent and commit drag once past threshold
    e.preventDefault();
    if (dist >= _DRAG_THRESHOLD) {
        clearTimeout(_tpArmTimer);
        clearTimeout(_tpLpTimer);
        _tpLpFired = true;
        _tpStartDrag(touch.clientX, touch.clientY);
    }
}

function _tpOnTouchEnd(e) {
    var touch = _tpFindTouch(e.changedTouches);
    if (!touch) return;
    clearTimeout(_tpLpTimer);
    clearTimeout(_tpArmTimer);

    if (_tpDragging) {
        var target    = _tpDropTarget(touch.clientX, touch.clientY);
        var srcId     = _tpCellId;
        var isMulti   = _tpMultiDrag;
        _tpGhostDestroy();
        _tpDragging    = false;
        _tpMultiDrag   = false;
        _tpScrollCache = null;
        _tpCleanup();
        _tpSuppressNextClick();

        if (target.cellId != null) {
            if (isMulti) {
                _msMoveSelected(target.cellId, target.insertBefore);
            } else if (target.cellId !== srcId) {
                _gridReorder(srcId, target.cellId, target.insertBefore);
            }
        }
        return;
    }

    // Restore arm-dim if drag never started
    var src = _msCellEl(_tpCellId);
    if (src) src.style.opacity = '';

    var lpFired = _tpLpFired;
    var armed   = _tpArmed;
    var cellId  = _tpCellId;
    _tpArmed    = false;
    _tpCleanup();

    if (lpFired || armed) {
        _tpSuppressNextClick();  // arm lift / long-press: no lightbox
        return;
    }

    // Short tap in multiselect: handle here and suppress synthetic click
    if (_msActive && cellId != null) {
        _msToggle(cellId);
        _tpSuppressNextClick();
        return;
    }
    // Normal short tap: let the synthetic click propagate → _tpClickCapture
    // will call gridLightboxOpen.  No need to do it here.
}

function _tpSuppressNextClick() {
    _tpSuppressClick = true;
    // Synthetic click fires 100–300 ms after touchend on Android.
    // Clear the flag after 600 ms so future taps aren’t affected.
    setTimeout(function() { _tpSuppressClick = false; }, 600);
}

function _tpOnTouchCancel() { _tpReset(); }

function _tpReset() {
    clearTimeout(_tpLpTimer);
    clearTimeout(_tpArmTimer);
    _tpEdgeScrollStop();
    _tpGhostDestroy();
    _tpDragging    = false;
    _tpMultiDrag   = false;
    _tpLpFired     = false;
    _tpArmed       = false;
    _tpScrollCache = null;  // invalidate cache for next gesture
    // Restore arm-dimming if ghost wasn't created
    var src = _msCellEl(_tpCellId);
    if (src) src.style.opacity = '';
    _tpCleanup();
}

function _tpCleanup() {
    document.removeEventListener('touchmove',   _tpOnTouchMove);
    document.removeEventListener('touchend',    _tpOnTouchEnd);
    document.removeEventListener('touchcancel', _tpOnTouchCancel);
    _tpTouchId = null;
}

/* ── Click capture: block post-drag/arm clicks; open lightbox for quick taps ── */
function _tpClickCapture(e) {
    // Suppress synthetic clicks that follow arm lifts, long-presses, or drags.
    // stopImmediatePropagation (not stopPropagation) is required: _msCellClickHandler
    // sits on the SAME element (canvas) in the SAME capture phase, and
    // stopPropagation() would not prevent it from firing.
    if (_tpSuppressClick) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
    }

    var cellEl = e.target.closest('[data-grid-cell-id]');
    if (!cellEl) return;
    var cellId = parseInt(cellEl.dataset.gridCellId, 10);

    // Multiselect: handle the toggle HERE and block _msCellClickHandler
    // (same capture-phase listener on the same canvas) to avoid double-toggle.
    // This path is hit for MOUSE clicks on touch-capable devices (trackpad Mac,
    // touchscreen laptops) where _tpOnTouchEnd never fired for this click.
    // Pure non-touch desktops never register _tpClickCapture at all, so
    // _msCellClickHandler handles those clicks exclusively.
    if (_msActive) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (!isNaN(cellId)) _msToggle(cellId);
        return;
    }

    // Normal quick tap: route to lightbox
    var hasMedia = cellEl.querySelector('img, video');
    if (hasMedia) {
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
        /* Canvas touchstart is non-passive; preventDefault() is called there
         * for every cell touch, so the compositor never starts a scroll
         * pipeline for those gestures.  Native scroll on empty canvas space
         * (non-cell touches) is unaffected. */
        'body.bw-touch .grid-ms-enter { display: flex; }',
        'body.bw-touch [data-grid-cell-id] {',
        '  -webkit-touch-callout: none;',
        '  -webkit-user-select:   none;',
        '  user-select:           none;',
        '}',
        /* img/video inside cells: pointer-events:none so Android never fires
         * the native "save image" long-press that sends touchcancel to our handler.
         * Taps still bubble from the cell container to open the lightbox. */
        'body.bw-touch [data-grid-cell-id] img,',
        'body.bw-touch [data-grid-cell-id] video {',
        '  pointer-events:        none;',
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
