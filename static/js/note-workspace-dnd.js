/**
 * note-workspace-dnd.js
 * Hold a note card 500 ms then drag it onto a sidebar workspace row to
 * reassign it.  Works on desktop (mouse) and mobile (touch/pointer).
 *
 * Key rule: every move is always allowed (same-ws drops are silent no-ops).
 * Parent workspaces still show the note after a parent→nested move because
 * the notes query uses get_descendant_ids() — "stays visible" is a view
 * effect, not a copy.
 */

(function () {
  'use strict';

  /* ── constants ───────────────────────────────────────────── */
  var HOLD_MS        = 500;  // ms before drag arms
  var MOVE_THRESHOLD = 8;    // px movement that cancels the hold timer
  var EDGE_PX        = 80;   // distance from left edge that opens sidebar
  var EDGE_DELAY_MS  = 300;  // ms to wait at edge before opening sidebar

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

  /* ── reset all state ─────────────────────────────────────── */
  function _reset() {
    _armed     = false;
    _noteId    = null;
    _noteTitle = null;
    if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null; }
    if (_edgeTimer) { clearTimeout(_edgeTimer); _edgeTimer = null; }
    _hideGhost();
    _clearHighlight();
    document.body.style.userSelect  = '';
    document.body.style.touchAction = '';
  }

  /* ── cancel an in-progress drag ──────────────────────────── */
  function _cancel() { _reset(); }

  /* ── execute the move via fetch ──────────────────────────── */
  function _doMove(noteId, wsId, wsName) {
    if (!noteId || !wsId) return;

    var url  = '/nwdnd/move';
    var body = { note_id: Number(noteId), target_ws_id: wsId };

    fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { status: r.status, data: data };
        });
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

  /* ── pointer event wiring ────────────────────────────────── */

  // pointerdown: start the hold timer
  document.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    var art = _noteCardAt(e.target);
    if (!art) return;

    _noteId    = art.dataset.noteId;
    var h2     = art.querySelector('h2');
    _noteTitle = (art.dataset.title || (h2 ? h2.textContent : '') || 'Note').trim();
    _startX    = e.clientX;
    _startY    = e.clientY;

    _holdTimer = setTimeout(function () {
      _armed = true;
      document.body.style.userSelect  = 'none';
      document.body.style.touchAction = 'none';
      _showGhost(_startX, _startY);
    }, HOLD_MS);
  }, { passive: true });

  // pointermove: move ghost + track drop target
  document.addEventListener('pointermove', function (e) {
    if (!_noteId) return;

    if (!_armed) {
      // Cancel hold if the pointer strays before the timer fires
      if (Math.hypot(e.clientX - _startX, e.clientY - _startY) > MOVE_THRESHOLD) {
        _reset();
      }
      return;
    }

    e.preventDefault();  // prevent scroll while dragging (needs non-passive)

    _moveGhost(e.clientX, e.clientY);
    _checkEdge(e.clientX);

    var row = _wsRowAt(e.clientX, e.clientY);
    if (row) {
      _targetWsId = Number(row.dataset.dndDropWsId);
      _highlight(row);
    } else {
      _clearHighlight();
    }
  }, { passive: false });

  // pointerup: commit the drop — capture everything BEFORE _reset()
  document.addEventListener('pointerup', function () {
    if (!_noteId) return;

    // Snapshot state before reset wipes it
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

  document.addEventListener('pointercancel', _reset);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') _reset();
  });

})();
