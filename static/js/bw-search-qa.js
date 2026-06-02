/* bw-search-qa.js — Ctrl+K floating search panel (Phase 3, Hybrid + LLM streaming)
 * All var, IIFE-wrapped — BookWorm JS conventions.
 * Exposes: bwSearchOpen, bwSearchClose, bwSearchGo, bwSqStopStream on window.
 *
 * XSS note: _bwSqSnippet() HTML-escapes FIRST, then injects <mark> tags.
 * Wrong order = XSS. Do not change the sequence.
 *
 * Streaming: Enter (no card highlighted) → POST /qa/stream, render tokens.
 * Enter (card highlighted) → open that note. Arrow keys navigate cards.
 * AbortController wired to the Stop button — cancels the fetch stream.
 */
(function () {
  'use strict';

  var _bwSqTimer    = null;   // debounce handle
  var _bwSqIdx      = -1;     // keyboard-highlighted result index (-1 = none)
  var _bwSqCount    = 0;      // number of result cards currently rendered
  var _bwSqAbort    = null;   // AbortController for the active LLM stream

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
    _bwSqResetAnswer();

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
    bwSqStopStream();   // cancel any active LLM stream on close
  };

  window.bwSearchGo = function (itemType, itemId, linkData) {
    bwSearchClose();
    var ld = linkData || {};
    if (itemType === 'note') {
      window.location.href = '/?note=' + itemId;
    } else if (itemType === 'db_card') {
      window.location.href = ld.ws_id ? '/?ws=' + ld.ws_id : '/';
    } else if (itemType === 'workspace') {
      window.location.href = '/?ws=' + itemId;
    } else if (itemType === 'widget') {
      window.location.href = ld.page_id ? '/?hp=' + ld.page_id : '/';
    } else if (itemType === 'crm_contact') {
      window.location.href = ld.page_id ? '/?hp=' + ld.page_id : '/';
    } else {
      window.location.href = '/';
    }
  };

  window.bwSqStopStream = function () {
    if (_bwSqAbort) {
      _bwSqAbort.abort();
      _bwSqAbort = null;
    }
    var btn = document.getElementById('bw-sq-stop-btn');
    var thinking = document.getElementById('bw-sq-thinking');
    if (btn)     btn.classList.add('hidden');
    if (thinking) thinking.classList.add('hidden');
  };

  /* ── internal helpers ─────────────────────────────────────────────── */
  function _bwSqEsc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Escape HTML first, THEN inject <mark> tags from STX/ETX markers. */
  function _bwSqSnippet(s) {
    var escaped = _bwSqEsc(s);
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

  function _bwSqResetAnswer() {
    var wrap    = document.getElementById('bw-sq-answer-wrap');
    var ansEl   = document.getElementById('bw-sq-answer');
    var thinking = document.getElementById('bw-sq-thinking');
    bwSqStopStream();
    if (wrap)    wrap.classList.add('hidden');
    if (ansEl)   ansEl.textContent = '';
    if (thinking) thinking.classList.remove('hidden');
  }

  function _bwSqItemIcon(itemType) {
    if (itemType === 'note')        return '🗒';
    if (itemType === 'db_card')     return '🗂';
    if (itemType === 'workspace')   return '📁';
    if (itemType === 'widget')      return '🧩';
    if (itemType === 'crm_contact') return '👤';
    return '📄';
  }

  function _bwSqHandleClick(el) {
    var itype = el.getAttribute('data-item-type') || 'note';
    var iid   = Number(el.getAttribute('data-item-id'));
    var ld    = {};
    try { ld = JSON.parse(el.getAttribute('data-link-data') || '{}'); } catch (e) {}
    bwSearchGo(itype, iid, ld);
  }

  function _bwSqRender(results) {
    var el = document.getElementById('bw-sq-results');
    if (!el) return;
    _bwSqIdx   = -1;
    _bwSqCount = results ? results.length : 0;

    if (!results || results.length === 0) {
      el.innerHTML =
        '<p class="px-4 py-6 text-sm text-center text-gray-400 dark:text-zinc-500">' +
        'No results found</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < results.length; i++) {
      var r        = results[i];
      var itype    = r.item_type || 'note';
      var iid      = r.item_id   || r.note_id;
      var ld       = r.link_data || {};
      var icon     = _bwSqItemIcon(itype);
      var subLabel = r.workspace_name || '';

      // For non-note types show a type label when no workspace name is available
      if (!subLabel) {
        if (itype === 'db_card')     subLabel = 'Database card';
        if (itype === 'workspace')   subLabel = 'Workspace';
        if (itype === 'widget')      subLabel = 'Widget';
        if (itype === 'crm_contact') subLabel = (ld.company || '') || 'Contact';
      }

      html +=
        '<div class="bw-sq-item px-4 py-2.5 cursor-pointer' +
        ' hover:bg-gray-50 dark:hover:bg-zinc-800 border-b' +
        ' border-gray-50 dark:border-zinc-800 last:border-0"' +
        ' role="option" aria-selected="false"' +
        ' data-item-type="' + _bwSqEsc(itype) + '"' +
        ' data-item-id="'   + iid  + '"' +
        ' data-link-data="' + _bwSqEsc(JSON.stringify(ld)) + '"' +
        ' onclick="_bwSqHandleClick(this)">' +

        '<div class="flex items-center gap-1.5 mb-0.5">' +
        '<span class="text-sm leading-none select-none" aria-hidden="true">' + icon + '</span>' +
        '<span class="text-xs text-gray-400 dark:text-zinc-500 truncate">' +
        _bwSqEsc(subLabel) + '</span>' +
        '</div>' +

        '<p class="text-sm font-medium text-gray-900 dark:text-zinc-100 truncate">' +
        _bwSqEsc(r.title) + '</p>' +

        '<p class="bw-sq-snippet text-xs text-gray-500 dark:text-zinc-400' +
        ' line-clamp-2 mt-0.5"></p>' +
        '</div>';
    }
    el.innerHTML = html;

    var cards = el.querySelectorAll('.bw-sq-item');
    for (var j = 0; j < results.length; j++) {
      var snipEl = cards[j] && cards[j].querySelector('.bw-sq-snippet');
      if (snipEl) snipEl.innerHTML = _bwSqSnippet(results[j].snippet || '');
    }
  }

  function _bwSqFetch(q) {
    fetch('/qa/search?q=' + encodeURIComponent(q) + '&limit=12')
      .then(function (r) {
        if (r.redirected) { bwSearchClose(); return null; }
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        _bwSqRender(data.results);
      })
      .catch(function () { _bwSqRender([]); });
  }

  /* ── LLM streaming ────────────────────────────────────────────────── */
  function _bwSqStream(q) {
    _bwSqResetAnswer();

    var wrap    = document.getElementById('bw-sq-answer-wrap');
    var ansEl   = document.getElementById('bw-sq-answer');
    var stopBtn = document.getElementById('bw-sq-stop-btn');
    var thinking = document.getElementById('bw-sq-thinking');
    if (!wrap || !ansEl) return;

    wrap.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');

    _bwSqAbort = new AbortController();
    var text = '';

    fetch('/qa/stream?q=' + encodeURIComponent(q), { signal: _bwSqAbort.signal })
      .then(function (resp) {
        if (resp.redirected) { bwSearchClose(); return; }
        if (!resp.body)      { bwSqStopStream(); return; }

        var reader  = resp.body.getReader();
        var decoder = new TextDecoder();
        var buf     = '';

        function pump() {
          reader.read().then(function (chunk) {
            if (chunk.done) { bwSqStopStream(); return; }
            buf += decoder.decode(chunk.value, { stream: true });

            var lines = buf.split('\n');
            buf = lines.pop(); // keep incomplete line

            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (!line.startsWith('data:')) continue;
              var raw = line.slice(5).trim();
              if (raw === '[DONE]' || raw === '[ERROR]') {
                bwSqStopStream();
                // Hide answer wrap if nothing was streamed
                if (!text) wrap.classList.add('hidden');
                return;
              }
              try {
                var token = JSON.parse(raw);
                text += token;
                ansEl.textContent = text;
                // Hide "thinking…" once we get the first token
                if (thinking) thinking.classList.add('hidden');
              } catch (e) { /* malformed chunk — skip */ }
            }
            pump();
          }).catch(function () { bwSqStopStream(); });
        }
        pump();
      })
      .catch(function (err) {
        // AbortError is expected when user clicks Stop — no-op
        if (err && err.name !== 'AbortError') { bwSqStopStream(); }
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
          _bwSqResetAnswer();
          return;
        }
        _bwSqTimer = setTimeout(function () { _bwSqFetch(q); }, 300);
      });

      /* Arrow key nav + Enter */
      inputEl.addEventListener('keydown', function (e) {
        var items = _bwSqItems();

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          _bwSqIdx = Math.min(_bwSqIdx + 1, items.length - 1);
          _bwSqHighlight(items);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          _bwSqIdx = Math.max(_bwSqIdx - 1, 0);
          _bwSqHighlight(items);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (_bwSqIdx >= 0 && items[_bwSqIdx]) {
            // Card highlighted → open it
            var card = items[_bwSqIdx];
            var itype = card.getAttribute('data-item-type') || 'note';
            var iid   = Number(card.getAttribute('data-item-id'));
            var ld    = {};
            try { ld = JSON.parse(card.getAttribute('data-link-data') || '{}'); } catch(e2){}
            bwSearchGo(itype, iid, ld);
          } else {
            // No highlight → ask AI
            var q = inputEl.value.trim();
            if (q) _bwSqStream(q);
          }
        }
      });
    }
  });

}());
