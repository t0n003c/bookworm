/**
 * note-workspace-dnd.js
 * Hold a note card for 500 ms → drag it to any workspace in the sidebar tree
 * to reassign it.  Works on desktop (mouse) and mobile (touch/pointer).
 *
 * Rules (enforced by the server, mirrored in UI feedback):
 *  • same workspace           → no-op, no toast
 *  • parent → nested child    → blocked (note stays in parent)
 *  • nested → parent          → allowed (note moves up)
 *  • sibling (unrelated) move → allowed (note disappears from source)
 *
 * Mobile extra:  while dragging, move pointer to x < 80 px → sidebar opens
 * automatically after 300 ms so the workspace tree is reachable.
 */

(function () {
  'use strict';

  /* ── constants ─────────────────────────────────────────── */
  var HOLD_MS        = 500;   // hold duration before drag arms
  var MOVE_THRESHOLD = 8;     // px — movement cancels hold timer
  var EDGE_PX        = 80;    // px from left edge → open sidebar
  var EDGE_DELAY_MS  = 300;   // ms before sidebar auto-opens

  /* ── state ──────────────────────────────────────────────── */
  var _armed       = false;   // hold timer fired, drag is live
  var _noteId      = null;    // id being dragged
  var _noteTitle   = null;    // display title for ghost
  var _startX      = 0;
  var _startY      = 0;
  var _holdTimer   = null;
  var _edgeTimer   = null;
  var _targetWsId  = null;    // workspace currently under cursor
  var _prevTarget  = null;    // for highlight cleanup

  /* ── ghost element ──────────────────────────────────────── */
  function _getGhost() {
    var g = document.getElementById('_nwdnd-ghost');
    if (!g) {
      g = document.createElement('div');
      g.id = '_nwdnd-ghost';
      g.style.cssText = [
        'position:fixed', 'z-index:9999', 'pointer-events:none',
        'display:none',
        'max-width:220px', 'padding:6px 12px',
        'background:#0053e2', 'color:#fff',
        'border-radius:999px', 'font-size:12px', 'font-weight:600',
        'box-shadow:0 4px 16px rgba(0,0,0,0.25)',
        'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
        'transform:translate(-50%,-50%)',
        'user-select:none',
      ].join(';');
      document.body.appendChild(g);
    }
    return g;
  }

  function _showGhost(x, y) {
    var g = _getGhost();
    g.textContent = '📄 ' + (_noteTitle || 'Note');
    g.style.left    = x + 'px';
    g.style.top     = y + 'px';
    g.style.display = 'block';
  }

  function _moveGhost(x, y) {
    var g = document.getElementById('_nwdnd-ghost');
    if (g) { g.style.left = x + 'px'; g.style.top = y + 'px'; }
  }

  function _hideGhost() {
    var g = document.getElementById('_nwdnd-ghost');
    if (g) g.style.display = 'none';
  }

  /* ── workspace highlight ────────────────────────────────── */
  function _highlightWs(el) {
    if (_prevTarget && _prevTarget !== el) _unhighlightWs(_prevTarget);
    if (!el) { _prevTarget = null; return; }
    el.style.outline       = '2px solid #0053e2';
    el.style.outlineOffset = '-2px';
    el.style.borderRadius  = '8px';
    _prevTarget = el;
  }

  function _unhighlightWs(el) {
    if (!el) return;
    el.style.outline       = '';
    el.style.outlineOffset = '';
    el.style.borderRadius  = '';
  }

  function _clearHighlight() {
    _unhighlightWs(_prevTarget);
    _prevTarget  = null;
    _targetWsId  = null;
  }

  /* ── find the workspace row under the pointer ───────────── */
  function _wsRowAt(x, y) {
    var g = document.getElementById('_nwdnd-ghost');
    var prev = g ? g.style.display : 'none';
    if (g) g.style.display = 'none';            // hide ghost so it's not the hit target
    var el = document.elementFromPoint(x, y);
    if (g) g.style.display = prev;
    if (!el) return null;
    var row = el.closest('[data-dnd-drop-ws-id]');
    return row;
  }

  /* ── mobile sidebar auto-open ───────────────────────────── */
  function _checkEdge(x) {
    if (x < EDGE_PX) {
      if (!_edgeTimer) {
        _edgeTimer = setTimeout(function () {
          var sb = document.getElementById('sidebar');
          // Only open if actually closed (mobile overlay not already visible)
          if (sb && (!sb.style.width || sb.style.width === '0px' ||
                     sb.classList.contains('w-0'))) {
            // Force sidebar workspace tab active so the tree is visible
            if (typeof switchSidebarTab === 'function') switchSidebarTab('workspaces');
            if (typeof _mobileSidebarOpen === 'function') _mobileSidebarOpen();
          }
        }, EDGE_DELAY_MS);
      }
    } else {
      if (_edgeTimer) { clearTimeout(_edgeTimer); _edgeTimer = null; }
    }
  }

  /* ── cancel / cleanup ───────────────────────────────────── */
  function _cancel() {
    _armed = false;
    if (_holdTimer)  { clearTimeout(_holdTimer);  _holdTimer = null; }
    if (_edgeTimer)  { clearTimeout(_edgeTimer);  _edgeTimer = null; }
    _hideGhost();
    _clearHighlight();
    document.body.style.userSelect = '';
    document.body.style.touchAction = '';
    _noteId    = null;
    _noteTitle = null;
  }

  /* ── do the move ────────────────────────────────────────── */
  function _doMove(wsId, wsName) {
    if (!_noteId) return;
    var noteId = _noteId;
    _cancel();  // clean up before async work

    fetch('/notes/' + noteId + '/move', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ target_ws_id: wsId }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { _toast('⚠️ Could not move note', 'error'); return; }
        if (!data.moved) {
          if (data.reason === 'parent_to_nested') {
          // 'same' → silent no-op
          return;
        }
        _toast('✅ Moved to ' + (wsName || 'workspace'), 'ok');
        // Reload the current note list so the moved note disappears/appears correctly
        var nl = document.getElementById('note-list');
        if (nl && typeof htmx !== 'undefined') {
          htmx.trigger(nl, 'bw:sync');
        }
      })
      .catch(function () { _toast('⚠️ Network error', 'error'); });
  }

  /* ── toast ──────────────────────────────────────────────── */
  function _toast(msg, type) {
    var t = document.createElement('div');
    var bg = type === 'ok' ? '#2a8703' : type === 'warn' ? '#995213' : '#ea1100';
    t.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%',
      'transform:translateX(-50%)',
      'z-index:10000', 'pointer-events:none',
      'padding:10px 20px', 'border-radius:999px',
      'background:' + bg, 'color:#fff',
      'font-size:13px', 'font-weight:600',
      'box-shadow:0 4px 16px rgba(0,0,0,0.2)',
      'transition:opacity 0.3s',
    ].join(';');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 350);
    }, 2200);
  }

  /* ── should we ignore this target? ─────────────────────── */
  function _targetIsNote(el) {
    // Only arm on article[data-note-id] in the standard note list.
    // Skip timeline view (it has its own DnD), and database views.
    var nl = document.getElementById('note-list');
    if (!nl) return false;
    if (nl.dataset.view === 'timeline') return false;
    var art = el.closest('article[data-note-id]');
    if (!art) return false;
    // Don't start drag if user is clicking a button / link inside the card
    if (el.closest('button,a,input,textarea,select')) return false;
    return art;
  }

  /* ── pointer events ─────────────────────────────────────── */
  document.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return; // left button only
    var art = _targetIsNote(e.target);
    if (!art) return;

    _noteId    = art.dataset.noteId;
    _noteTitle = (art.dataset.title || art.querySelector('h2')?.textContent || 'Note').trim();
    _startX    = e.clientX;
    _startY    = e.clientY;

    _holdTimer = setTimeout(function () {
      _armed = true;
      document.body.style.userSelect  = 'none';
      document.body.style.touchAction = 'none';
      _showGhost(_startX, _startY);
    }, HOLD_MS);
  }, { passive: true });

  document.addEventListener('pointermove', function (e) {
    if (!_noteId) return;

    // Cancel hold if pointer moved too far before 500 ms
    if (!_armed) {
      if (Math.hypot(e.clientX - _startX, e.clientY - _startY) > MOVE_THRESHOLD) {
        _cancel();
      }
      return;
    }

    e.preventDefault();   // stop scroll while dragging

    _moveGhost(e.clientX, e.clientY);
    _checkEdge(e.clientX);

    var row = _wsRowAt(e.clientX, e.clientY);
    if (row) {
      var wsId = +row.dataset.dndDropWsId;
      _targetWsId = wsId;
      _highlightWs(row);
    } else {
      _clearHighlight();
    }
  }, { passive: false });

  document.addEventListener('pointerup', function (e) {
    if (!_noteId) return;
    var wasArmed = _armed;
    var wsId     = _targetWsId;
    var wsRow    = _prevTarget;
    var wsName   = wsRow
      ? (wsRow.querySelector('button[data-ws-id]')?.textContent?.trim() || '')
      : '';

    _cancel();

    if (!wasArmed || !wsId) return;   // not a real drag, or no target
    _doMove(wsId, wsName);
  });

  document.addEventListener('pointercancel', function () { _cancel(); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _armed) _cancel();
  });
})();
