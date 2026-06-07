/**
 * quick-ask.js — BookWorm Quick Ask overlay engine.
 *
 * Handles:
 *   - SSE streaming from GET /qa/stream?q= (fetch + ReadableStream pump)
 *   - Source results from GET /qa/search?q=
 *   - Session history in localStorage (pills in history rail)
 *   - Auto-submit when ?q= param is present on load (Web Share Target / shortcut)
 *   - Stop button via AbortController
 *   - Back navigation
 *
 * Rules: all var, IIFE wrapper, 'use strict' — HTMX-safe codebase convention.
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  var _qaAbort     = null;   // AbortController for the active stream
  var _qaText      = '';     // accumulated answer text
  var _HISTORY_KEY = 'bw-qa-history';
  var _MAX_HISTORY = 8;

  // ── Element shortcuts ──────────────────────────────────────────────────────
  function _el(id) { return document.getElementById(id); }

  // ── Theme ──────────────────────────────────────────────────────────────────
  function _qaSyncThemeIcon() {
    var isDark = document.documentElement.classList.contains('dark');
    var sun  = _el('qa-icon-sun');
    var moon = _el('qa-icon-moon');
    if (sun)  sun.classList.toggle('hidden', !isDark);
    if (moon) moon.classList.toggle('hidden',  isDark);
  }

  function qaToggleTheme() {
    var isDark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('bw-theme', isDark ? 'dark' : 'light'); } catch (_) {}
    _qaSyncThemeIcon();
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  function qaBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/';
    }
  }

  // ── Stream control ─────────────────────────────────────────────────────────
  function qaStopStream() {
    if (_qaAbort) {
      _qaAbort.abort();
      _qaAbort = null;
    }
    _el('qa-thinking').classList.add('hidden');
    _el('qa-send-btn').classList.remove('hidden');
    _el('qa-stop-btn').classList.add('hidden');
  }

  // ── Main stream ────────────────────────────────────────────────────────────
  function qaStartStream(q) {
    _qaText = '';
    var ansEl     = _el('qa-answer');
    var wrapEl    = _el('qa-answer-wrap');
    var thinkEl   = _el('qa-thinking');
    var nudgeEl   = _el('qa-empty-nudge');
    var offlineEl = _el('qa-offline-msg');

    // Reset UI
    ansEl.textContent = '';
    wrapEl.classList.add('hidden');
    nudgeEl.classList.add('hidden');
    offlineEl.classList.add('hidden');
    _el('qa-placeholder').classList.add('hidden');
    _el('qa-sources-wrap').classList.add('hidden');
    _el('qa-sources-panel').classList.add('hidden');
    _el('qa-sources-toggle').setAttribute('aria-expanded', 'false');
    _el('qa-sources-toggle').textContent = 'Show sources';

    thinkEl.classList.remove('hidden');
    _el('qa-send-btn').classList.add('hidden');
    _el('qa-stop-btn').classList.remove('hidden');

    _qaAbort = new AbortController();
    var firstToken = true;
    var buf = '';

    fetch('/qa/stream?q=' + encodeURIComponent(q), {
      signal: _qaAbort.signal,
    })
      .then(function (resp) {
        // Session expired — server sends a redirect to /login
        if (resp.redirected || resp.status === 401 || resp.status === 302) {
          window.location.href = resp.url || '/login?next=/quick-ask';
          return;
        }
        if (!resp.ok || !resp.body) {
          throw new Error('Stream failed: ' + resp.status);
        }

        var reader  = resp.body.getReader();
        var decoder = new TextDecoder();

        function pump() {
          reader.read().then(function (chunk) {
            if (chunk.done) {
              qaStopStream();
              if (_qaText === '') {
                nudgeEl.classList.remove('hidden');
              }
              return;
            }

            buf += decoder.decode(chunk.value, { stream: true });
            var lines = buf.split('\n');
            buf = lines.pop();   // keep incomplete line for next chunk

            lines.forEach(function (line) {
              if (!line.startsWith('data: ')) return;
              var raw = line.slice(6).trim();
              if (!raw) return;
              if (raw === '[DONE]' || raw === '[ERROR]') {
                qaStopStream();
                if (_qaText === '') {
                  nudgeEl.classList.remove('hidden');
                }
                return;
              }
              try {
                var token = JSON.parse(raw);
                if (firstToken) {
                  firstToken = false;
                  thinkEl.classList.add('hidden');
                  wrapEl.classList.remove('hidden');
                }
                _qaText += token;
                ansEl.textContent = _qaText;
                // Keep answer area scrolled to bottom
                var area = _el('qa-answer-area');
                area.scrollTop = area.scrollHeight;
              } catch (_) { /* ignore parse errors */ }
            });

            pump();
          }).catch(function (err) {
            if (err && err.name === 'AbortError') return;
            qaStopStream();
          });
        }

        pump();
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        qaStopStream();
      });
  }

  // ── Source results ─────────────────────────────────────────────────────────
  function qaFetchResults(q) {
    fetch('/qa/search?q=' + encodeURIComponent(q) + '&limit=5')
      .then(function (resp) {
        if (resp.redirected || resp.status === 401) {
          window.location.href = resp.url || '/login?next=/quick-ask';
          return null;
        }
        return resp.ok ? resp.json() : null;
      })
      .then(function (data) {
        if (!data || !data.results || !data.results.length) return;
        qaRenderSources(data.results);
        _el('qa-sources-wrap').classList.remove('hidden');
      })
      .catch(function () { /* sources are optional — silently ignore */ });
  }

  function qaRenderSources(results) {
    var panel = _el('qa-sources-panel');
    panel.innerHTML = '';
    results.forEach(function (r) {
      var card = document.createElement('a');
      // Navigate to the note in the full app
      card.href = r.item_type === 'note'
        ? '/?note=' + encodeURIComponent(r.item_id)
        : '/';
      card.className = [
        'block rounded-xl border border-gray-100 dark:border-zinc-800',
        'bg-gray-50 dark:bg-zinc-800 px-3 py-2 hover:bg-gray-100',
        'dark:hover:bg-zinc-700 transition-colors',
      ].join(' ');
      var title = document.createElement('p');
      title.className = 'text-sm font-semibold text-gray-900 dark:text-zinc-100 truncate';
      title.textContent = r.title || 'Untitled';
      var sub = document.createElement('p');
      sub.className = 'text-xs text-gray-400 dark:text-zinc-500 mt-0.5 truncate';
      sub.textContent = r.workspace_name || r.item_type || '';
      card.appendChild(title);
      card.appendChild(sub);
      panel.appendChild(card);
    });
  }

  function qaToggleSources() {
    var panel  = _el('qa-sources-panel');
    var toggle = _el('qa-sources-toggle');
    var open   = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? 'Hide sources' : 'Show sources';
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  function qaSubmit() {
    var input = _el('qa-input');
    var q     = (input.value || '').trim();
    if (!q) return;

    if (!navigator.onLine) {
      _el('qa-offline-msg').classList.remove('hidden');
      _el('qa-placeholder').classList.add('hidden');
      return;
    }

    // Fire stream + search results in parallel (no await)
    qaStartStream(q);
    qaFetchResults(q);
    qaAddHistory(q);
  }

  // ── Session history ────────────────────────────────────────────────────────
  function _readHistory() {
    try {
      return JSON.parse(localStorage.getItem(_HISTORY_KEY) || '[]');
    } catch (_) { return []; }
  }

  function qaAddHistory(q) {
    var hist = _readHistory().filter(function (h) { return h !== q; });
    hist.unshift(q);
    if (hist.length > _MAX_HISTORY) hist = hist.slice(0, _MAX_HISTORY);
    try { localStorage.setItem(_HISTORY_KEY, JSON.stringify(hist)); } catch (_) {}
    qaRenderHistory();
  }

  function qaRenderHistory() {
    var hist    = _readHistory();
    var wrap    = _el('qa-history-wrap');
    var rail    = _el('qa-history');
    if (!hist.length) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    rail.innerHTML = '';
    hist.forEach(function (q) {
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.textContent = q;
      pill.title = q;
      pill.className = [
        'flex-shrink-0 max-w-[160px] truncate rounded-full px-3 py-1',
        'text-xs font-medium border border-gray-200 dark:border-zinc-700',
        'bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300',
        'hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
      ].join(' ');
      pill.onclick = function () {
        _el('qa-input').value = q;
        qaSubmit();
      };
      rail.appendChild(pill);
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var input    = _el('qa-input');
    var autoq    = (document.body.dataset.autoq || '').trim();

    // Sync sun/moon icon to match current theme
    _qaSyncThemeIcon();

    // Follow OS dark/light changes — only when no explicit user choice stored
    var _mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (_mq) {
      _mq.addEventListener('change', function (e) {
        if (localStorage.getItem('bw-theme')) return;
        document.documentElement.classList.toggle('dark', e.matches);
        _qaSyncThemeIcon();
      });
    }

    if (autoq) {
      input.value = autoq;
      // Small delay so the page is fully painted before streaming starts
      setTimeout(qaSubmit, 120);
    } else {
      input.focus();
    }

    qaRenderHistory();

    // Keyboard: Enter submits, Shift+Enter is a no-op (single-line input)
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        qaSubmit();
      }
    });
  });

  // Expose globals for inline onclick handlers in the template
  window.qaBack          = qaBack;
  window.qaSubmit        = qaSubmit;
  window.qaStopStream    = qaStopStream;
  window.qaToggleSources = qaToggleSources;
  window.qaToggleTheme   = qaToggleTheme;

})();
