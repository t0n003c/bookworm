/**
 * note-workspace-dnd.js
 * Hold a note card 450 ms then drag it onto a sidebar workspace row to
 * reassign it.  Works on desktop (mouse) and mobile (touch).
 *
 * Key rule: every move is always allowed (same-ws drops are silent no-ops).
 *
 * ── Mobile strategy (Touch Events, not Pointer Events) ──────────────────────
 * iOS Safari has a quirk: even with pointerdown {passive:false} +
 * e.preventDefault(), the browser fires pointercancel when it decides a touch
 * will scroll, killing the hold timer before 450 ms.  Touch Events don't have
 * this problem — touchcancel only fires for genuine OS interruptions (call,
 * notification) rather than scroll-detection.
 *
 * Touch path:
 *   touchstart {passive:false} → preventDefault() (kills scroll tracking,
 *     suppresses synthesised click) → arm hold timer.
 *   touchmove  {passive:false} → if armed: preventDefault() + move ghost.
 *                              → if not armed and moved > threshold: _reset().
 *   touchend                   → commit drop or restore tap (via .click()).
 *   touchcancel                → _reset().
 *
 * Mouse path: unchanged — pointerdown (mouse only), pointermove, pointerup.
 */

(function () {
  'use strict';

  /* ── constants ───────────────────────────────────────────── */
  var HOLD_MS        = 450;  // ms before drag arms
  var MOVE_THRESHOLD = 22;   // px movement that cancels the hold timer (touch jitter can reach 15-20 px)
  var EDGE_PX        = 80;   // distance from left edge that opens sidebar
  var EDGE_DELAY_MS  = 300;  // ms to wait at edge before opening sidebar
  var SCROLL_ZONE_PX = 64;   // px from sidebar top/bottom that triggers auto-scroll
  var SCROLL_SPEED   = 7;    // px per animation frame (~420 px/s at 60 fps)

  /* ── module state ────────────────────────────────────────── */
  var _armed      = false;
  var _noteId     = null;
  var _noteTitle  = null;
  var _startX     = 0;
  var _startY     = 0;
  var _holdTimer  = null;
  var _edgeTimer  = null;
  var _targetWsId = null;
  var _prevTarget = null;
  // Touch-specific: remember what to click if the user just tapped.
  var _tapTarget  = null;   // <article> element to click() on a quick tap
  var _isTouch    = false;  // true when active pointer is touch or pen
  // Sidebar auto-scroll state
  var _scrollRaf  = null;   // requestAnimationFrame handle
  var _scrollDir  = 0;      // -1 = scroll up, 0 = idle, +1 = scroll down

  /* ── ghost pill ──────────────────────────────────────────── */
  function _ghost() {
    var g = document.getElementById('_nwdnd-ghost');
    if (!g) {
      g = document.createElement('div');
      g.id = '_nwdnd-ghost';
      g.setAttribute('aria-hidden', 'true');
      g.style.cssText = [
        'position:fixed', 'z-index:9999', 'pointer-events:none',
        'display:none',
        'max-width:220px', 'padding:6px 14px',
        'background:#0053e2', 'color:#fff',
        'border-radius:999px', 'font-size:12px', 'font-weight:600',
        'box-shadow:0 4px 16px rgba(0,0,0,.25)',
        'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
        'transform:translate(-50%,-50%)',
        'user-select:none',
      ].join(';');
      document.body.appendChild(g);
    }
    return g;
  }

  function _showGhost(x, y) {
    var g = _ghost();
    g.textContent   = '📄 ' + (_noteTitle || 'Note');
    g.style.left    = x + 'px';
    g.style.top     = y + 'px';
    g.style.display = 'block';
  }

  function _moveGhost(x, y) {
    var g = document.getElementById('_nwdnd-ghost');
    if (!g) return;
    g.style.left = x + 'px';
    g.style.top  = y + 'px';
  }

  function _hideGhost() {
    var g = document.getElementById('_nwdnd-ghost');
    if (g) g.style.display = 'none';
  }

  /* ── workspace highlight ─────────────────────────────────── */
  function _highlight(el) {
    if (_prevTarget && _prevTarget !== el) _unhighlight(_prevTarget);
    if (!el) { _prevTarget = null; return; }
    el.style.outline       = '2px solid #0053e2';
    el.style.outlineOffset = '-2px';
    el.style.borderRadius  = '6px';
    _prevTarget = el;
  }

  function _unhighlight(el) {
    if (!el) return;
    el.style.outline       = '';
    el.style.outlineOffset = '';
    el.style.borderRadius  = '';
  }

  function _clearHighlight() {
    _unhighlight(_prevTarget);
    _prevTarget  = null;
    _targetWsId  = null;
  }

  /* ── find the workspace drop row under the pointer ───────── */
  function _wsRowAt(x, y) {
    // Temporarily hide ghost so it doesn't intercept elementFromPoint
    var g    = document.getElementById('_nwdnd-ghost');
    var prev = g ? g.style.display : '';
    if (g) g.style.display = 'none';
    var el = document.elementFromPoint(x, y);
    if (g) g.style.display = prev;
    if (!el) return null;
    return el.closest('[data-dnd-drop-ws-id]');
  }

  /* ── mobile: auto-open sidebar when dragging near left edge ─ */
  function _checkEdge(x) {
    if (x < EDGE_PX) {
      if (!_edgeTimer) {
        _edgeTimer = setTimeout(function () {
          if (typeof switchSidebarTab === 'function') switchSidebarTab('workspaces');
          if (typeof _mobileSidebarOpen === 'function') _mobileSidebarOpen();
        }, EDGE_DELAY_MS);
      }
    } else {
      if (_edgeTimer) { clearTimeout(_edgeTimer); _edgeTimer = null; }
    }
  }

  /* ── sidebar auto-scroll during drag ────────────────────── */
  function _stopSidebarScroll() {
    if (_scrollRaf) { cancelAnimationFrame(_scrollRaf); _scrollRaf = null; }
    _scrollDir = 0;
  }

  function _startSidebarScroll(dir) {
    if (_scrollDir === dir) return;   // already scrolling that way
    _scrollDir = dir;
    if (_scrollRaf) cancelAnimationFrame(_scrollRaf);
    var sb = document.getElementById('sidebar');
    function _step() {
      if (!_scrollDir || !sb) return;
      sb.scrollTop += _scrollDir * SCROLL_SPEED;
      _scrollRaf = requestAnimationFrame(_step);
    }
    _scrollRaf = requestAnimationFrame(_step);
  }

  // Called every pointermove while armed.  Only scrolls when the mobile
  // sidebar overlay is open (backdrop sentinel) and the pointer is inside it.
  function _checkSidebarScroll(x, y) {
    if (!document.getElementById('_sb-mobile-backdrop')) {
      _stopSidebarScroll();
      return;
    }
    var sb = document.getElementById('sidebar');
    if (!sb) { _stopSidebarScroll(); return; }
    var rect = sb.getBoundingClientRect();
    // Pointer must be horizontally inside the sidebar panel
    if (x < rect.left || x > rect.right) { _stopSidebarScroll(); return; }
    var relY = y - rect.top;
    if (relY < SCROLL_ZONE_PX) {
      _startSidebarScroll(-1);               // near top — scroll up
    } else if (relY > rect.height - SCROLL_ZONE_PX) {
      _startSidebarScroll(1);                // near bottom — scroll down
    } else {
      _stopSidebarScroll();                  // middle zone — idle
    }
  }

  /* ── reset all state ─────────────────────────────── */
  function _reset() {
    _armed      = false;
    _noteId     = null;
    _noteTitle  = null;
    _tapTarget  = null;
    _isTouch    = false;
    if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null; }
    if (_edgeTimer) { clearTimeout(_edgeTimer); _edgeTimer = null; }
    _stopSidebarScroll();
    _hideGhost();
    _clearHighlight();
    document.body.style.userSelect = '';
  }

  /* ── execute the move via fetch ──────────────────────────── */
  function _doMove(noteId, wsId, wsName) {
    if (!noteId || !wsId) return;

    fetch('/nwdnd/move', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ note_id: Number(noteId), target_ws_id: wsId }),
    })
      .then(function (r) {
        return r.json().then(function (data) { return { status: r.status, data: data }; });
      })
      .then(function (res) {
        if (res.status !== 200 || !res.data.ok) {
          _toast('⚠️ Could not move note', 'error');
          return;
        }
        if (!res.data.moved) return;   // same-workspace — silent no-op
        _toast('✅ Moved to ' + (wsName || 'workspace'), 'ok');
        var inp = document.getElementById('active-workspace');
        var aid = inp ? inp.value : '';
        if (aid && typeof htmx !== 'undefined') {
          htmx.ajax('GET', '/notes', {
            target: '#note-list',
            swap:   'innerHTML',
            values: { workspace_id: aid },
          });
        }
      })
      .catch(function () { _toast('⚠️ Network error', 'error'); });
  }

  /* ── toast notification ──────────────────────────────────── */
  function _toast(msg, type) {
    var t  = document.createElement('div');
    var bg = type === 'ok' ? '#2a8703' : type === 'warn' ? '#995213' : '#ea1100';
    t.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%',
      'transform:translateX(-50%)',
      'z-index:10000', 'pointer-events:none',
      'padding:10px 20px', 'border-radius:999px',
      'background:' + bg, 'color:#fff',
      'font-size:13px', 'font-weight:600',
      'box-shadow:0 4px 16px rgba(0,0,0,.2)',
      'transition:opacity .3s',
    ].join(';');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 350);
    }, 2200);
  }

  /* ── gate: only arm on note cards in the standard list view ─ */
  function _noteCardAt(el) {
    var nl = document.getElementById('note-list');
    if (!nl) return null;
    if (nl.dataset.view === 'timeline') return null;
    if (el.closest('button,a,input,textarea,select')) return null;
    return el.closest('article[data-note-id]');
  }

  /* ============================================================
   * TOUCH PATH  (iOS / Android)
   * Using native Touch Events instead of Pointer Events because
   * iOS Safari fires pointercancel during scroll detection even
   * after e.preventDefault() on pointerdown, which kills the
   * hold timer.  touchcancel only fires on genuine OS interrupts.
   * ============================================================ */

  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;   // multitouch — ignore
    var t   = e.touches[0];
    var art = _noteCardAt(t.target);
    if (!art) return;

    // Prevent default: blocks native scroll tracking AND suppresses the
    // synthesised click.  We restore the click manually in touchend.
    e.preventDefault();

    _noteId    = art.dataset.noteId;
    _tapTarget = art;
    _isTouch   = true;
    var h2     = art.querySelector('h2');
    _noteTitle = (art.dataset.title || (h2 ? h2.textContent : '') || 'Note').trim();
    _startX    = t.clientX;
    _startY    = t.clientY;

    _holdTimer = setTimeout(function () {
      _armed = true;
      document.body.style.userSelect = 'none';
      _showGhost(_startX, _startY);
    }, HOLD_MS);
  }, { passive: false });

  document.addEventListener('touchmove', function (e) {
    if (!_noteId) return;
    var t = e.touches[0];

    if (!_armed) {
      if (Math.hypot(t.clientX - _startX, t.clientY - _startY) > MOVE_THRESHOLD) {
        // Finger drifted before the hold armed — treat as a scroll intent.
        _reset();
      }
      return;
    }

    // Armed: own the gesture fully — block scroll, move ghost.
    e.preventDefault();
    _moveGhost(t.clientX, t.clientY);
    _checkEdge(t.clientX);
    _checkSidebarScroll(t.clientX, t.clientY);

    var row = _wsRowAt(t.clientX, t.clientY);
    if (row) {
      _targetWsId = Number(row.dataset.dndDropWsId);
      _highlight(row);
    } else {
      _clearHighlight();
    }
  }, { passive: false });

  document.addEventListener('touchend', function (e) {
    if (!_noteId) return;

    var wasArmed  = _armed;
    var noteId    = _noteId;
    var wsId      = _targetWsId;
    var row       = _prevTarget;
    var tapTarget = _tapTarget;
    var btn       = row ? row.querySelector('button[data-ws-id]') : null;
    var wsName    = btn ? btn.textContent.trim() : '';

    _reset();

    if (!wasArmed) {
      // Quick tap: click() restores the HTMX navigation we suppressed.
      if (tapTarget) tapTarget.click();
      return;
    }

    if (document.getElementById('_sb-mobile-backdrop') &&
        typeof _mobileSidebarClose === 'function') {
      _mobileSidebarClose();
    }

    if (!wsId) return;
    _doMove(noteId, wsId, wsName);
  });

  document.addEventListener('touchcancel', _reset);

  /* ============================================================
   * MOUSE PATH  (desktop only)
   * ============================================================ */

  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse') return;  // touch/pen handled above
    if (e.button !== 0) return;
    var art = _noteCardAt(e.target);
    if (!art) return;

    _noteId    = art.dataset.noteId;
    _tapTarget = art;
    _isTouch   = false;
    var h2     = art.querySelector('h2');
    _noteTitle = (art.dataset.title || (h2 ? h2.textContent : '') || 'Note').trim();
    _startX    = e.clientX;
    _startY    = e.clientY;

    _holdTimer = setTimeout(function () {
      _armed = true;
      document.body.style.userSelect = 'none';
      _showGhost(_startX, _startY);
    }, HOLD_MS);
  });

  document.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    if (!_noteId) return;

    if (!_armed) {
      if (Math.hypot(e.clientX - _startX, e.clientY - _startY) > MOVE_THRESHOLD) {
        _reset();
      }
      return;
    }

    _moveGhost(e.clientX, e.clientY);
    _checkEdge(e.clientX);
    _checkSidebarScroll(e.clientX, e.clientY);

    var row = _wsRowAt(e.clientX, e.clientY);
    if (row) {
      _targetWsId = Number(row.dataset.dndDropWsId);
      _highlight(row);
    } else {
      _clearHighlight();
    }
  });

  document.addEventListener('pointerup', function (e) {
    if (e.pointerType !== 'mouse') return;
    if (!_noteId) return;

    var wasArmed = _armed;
    var noteId   = _noteId;
    var wsId     = _targetWsId;
    var row      = _prevTarget;
    var btn      = row ? row.querySelector('button[data-ws-id]') : null;
    var wsName   = btn ? btn.textContent.trim() : '';

    _reset();

    if (!wasArmed || !wsId) return;
    _doMove(noteId, wsId, wsName);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (_armed && document.getElementById('_sb-mobile-backdrop') &&
        typeof _mobileSidebarClose === 'function') {
      _mobileSidebarClose();
    }
    _reset();
  });

})();
