/* bw-search-qa.js — Ctrl+K floating search panel (Phase 1, FTS5)
 * All var, IIFE-wrapped — matches BookWorm JS conventions.
 * Exposes: bwSearchOpen, bwSearchClose, bwSearchGo on window.
 *
 * XSS note: _bwSqSnippet() HTML-escapes the full string FIRST,
 * then replaces \u0002/\u0003 (STX/ETX) with <mark>/</mark>.
 * Wrong order = XSS. Do not change the sequence.
 */
(function () {
  'use strict';

  var _bwSqTimer  = null;   // debounce handle
  var _bwSqIdx    = -1;     // keyboard-highlighted result index (-1 = none)
  var _bwSqCount  = 0;      // number of result cards currently rendered

  /* ── public API ──────────────────────────────────────────────────── */
  window.bwSearchOpen = function () {
    var backdrop = document.getElementById('bw-sq-backdrop');
    var panel    = document.getElementById('bw-sq-panel');
    var input    = document.getElementById('bw-sq-input');
    var results  = document.getElementById('bw-sq-results');
    if (!panel) return;

    if (results) results.innerHTML = '';
    _bwSqIdx   = -1;
    _bwSqCount = 0;

    backdrop && backdrop.classList.remove('hidden');
    panel.classList.remove('hidden');
    setTimeout(function () { input && input.focus(); }, 30);
  };

  window.bwSearchClose = function () {
    var backdrop = document.getElementById('bw-sq-backdrop');
    var panel    = document.getElementById('bw-sq-panel');
    var input    = document.getElementById('bw-sq-input');
    backdrop && backdrop.classList.add('hidden');
    panel    && panel.classList.add('hidden');
    if (input) { input.value = ''; }
    _bwSqIdx   = -1;
    _bwSqCount = 0;
    clearTimeout(_bwSqTimer);
  };

  window.bwSearchGo = function (noteId) {
    bwSearchClose();
    window.location.href = '/?note=' + noteId;
  };

  /* ── internal helpers ─────────────────────────────────────────────── */
  function _bwSqEsc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Escape HTML first, THEN inject <mark> tags from STX/ETX markers.
   * This order is mandatory — see XSS note at top of file. */
  function _bwSqSnippet(s) {
    var escaped = _bwSqEsc(s);
    // \u0002 = STX (char(2) from SQLite snippet()), \u0003 = ETX (char(3))
    return escaped
      .replace(/\u0002/g, '<mark>')
      .replace(/\u0003/g, '</mark>');
  }

  function _bwSqHighlight(items) {
    for (var i = 0; i < items.length; i++) {
      if (i === _bwSqIdx) {
        items[i].classList.add('bw-sq-active');
        items[i].setAttribute('aria-selected', 'true');
        items[i].scrollIntoView({ block: 'nearest' });
      } else {
        items[i].classList.remove('bw-sq-active');
        items[i].setAttribute('aria-selected', 'false');
      }
    }
  }

  function _bwSqItems() {
    var results = document.getElementById('bw-sq-results');
    if (!results) return [];
    return Array.prototype.slice.call(results.querySelectorAll('.bw-sq-item'));
  }

  function _bwSqRender(results) {
    var el = document.getElementById('bw-sq-results');
    if (!el) return;
    _bwSqIdx   = -1;
    _bwSqCount = results ? results.length : 0;

    if (!results || results.length === 0) {
      el.innerHTML =
        '<p class="px-4 py-6 text-sm text-center text-gray-400 dark:text-zinc-500">' +
        'No notes found</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      html +=
        '<div class="bw-sq-item px-4 py-2.5 cursor-pointer' +
        ' hover:bg-gray-50 dark:hover:bg-zinc-800 border-b' +
        ' border-gray-50 dark:border-zinc-800 last:border-0"' +
        ' role="option" aria-selected="false"' +
        ' data-note-id="' + r.note_id + '"' +
        ' onclick="bwSearchGo(' + r.note_id + ')">' +

        '<div class="flex items-center gap-1.5 mb-0.5">' +
        '<span class="text-sm leading-none select-none" aria-hidden="true">' +
        _bwSqEsc(r.workspace_emoji) + '</span>' +
        '<span class="text-xs text-gray-400 dark:text-zinc-500 truncate">' +
        _bwSqEsc(r.workspace_name) + '</span>' +
        '</div>' +

        '<p class="text-sm font-medium text-gray-900 dark:text-zinc-100 truncate">' +
        _bwSqEsc(r.title) + '</p>' +

        '<p class="bw-sq-snippet text-xs text-gray-500 dark:text-zinc-400' +
        ' line-clamp-2 mt-0.5"></p>' +
        '</div>';
    }
    el.innerHTML = html;

    // Inject snippet HTML separately (safe — escaped before markers)
    var cards = el.querySelectorAll('.bw-sq-item');
    for (var j = 0; j < results.length; j++) {
      var snipEl = cards[j] && cards[j].querySelector('.bw-sq-snippet');
      if (snipEl) snipEl.innerHTML = _bwSqSnippet(results[j].snippet);
    }
  }

  function _bwSqFetch(q) {
    fetch('/qa/search?q=' + encodeURIComponent(q) + '&limit=12')
      .then(function (r) {
        if (r.redirected) {
          // Session expired — close panel silently
          bwSearchClose();
          return null;
        }
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        _bwSqRender(data.results);
      })
      .catch(function () {
        _bwSqRender([]);
      });
  }

  /* ── event wiring (after DOM ready) ──────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    /* Global Ctrl+K / Cmd+K to open; Escape to close */
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        var panel = document.getElementById('bw-sq-panel');
        if (panel && panel.classList.contains('hidden')) {
          bwSearchOpen();
        } else {
          bwSearchClose();
        }
        return;
      }
      if (e.key === 'Escape') {
        var panel = document.getElementById('bw-sq-panel');
        if (panel && !panel.classList.contains('hidden')) {
          bwSearchClose();
        }
      }
    });

    /* Input: debounced search */
    var inputEl = document.getElementById('bw-sq-input');
    if (inputEl) {
      inputEl.addEventListener('input', function () {
        clearTimeout(_bwSqTimer);
        var q = inputEl.value.trim();
        if (!q) {
          var el = document.getElementById('bw-sq-results');
          if (el) el.innerHTML = '';
          _bwSqCount = 0;
          _bwSqIdx   = -1;
          return;
        }
        _bwSqTimer = setTimeout(function () { _bwSqFetch(q); }, 300);
      });

      /* Arrow key nav + Enter to open */
      inputEl.addEventListener('keydown', function (e) {
        var items = _bwSqItems();
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          _bwSqIdx = Math.min(_bwSqIdx + 1, items.length - 1);
          _bwSqHighlight(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          _bwSqIdx = Math.max(_bwSqIdx - 1, 0);
          _bwSqHighlight(items);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          var active = _bwSqIdx >= 0 ? items[_bwSqIdx] : items[0];
          if (active) {
            var nid = active.getAttribute('data-note-id');
            if (nid) bwSearchGo(Number(nid));
          }
        }
      });
    }
  });

}());
