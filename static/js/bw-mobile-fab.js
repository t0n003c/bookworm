/**
 * bw-mobile-fab.js — Mobile search FAB + AI toggle pill
 *
 * Manages the bottom-right floating action button that replaces Ctrl+K on
 * mobile.  Reads / writes 'bw-ai-mob-on' from localStorage to persist the
 * AI-answer toggle between sessions.  Exposes window.bwMobileAiEnabled so
 * bw-search-qa.js can check it before streaming (works on desktop too — the
 * pill is visible inside the search panel on all screen sizes).
 *
 * Two visual states:
 *   AI OFF → plain book-worm search icon (blue FAB)
 *   AI ON  → sparkle book-worm icon (blue FAB + gold ring) + gold pill badge
 */
(function () {
  'use strict';

  var LS_KEY = 'bw-ai-mob-on';

  /* Default: ON (users who set up LLM want it available immediately) */
  var _aiOn = localStorage.getItem(LS_KEY) !== 'false';
  window.bwMobileAiEnabled = _aiOn;

  /* ── DOM refs (resolved on DOMContentLoaded) ── */
  var _fab      = null;  // main circle button
  var _pill     = null;  // AI toggle pill
  var _iconBase = null;  // non-AI SVG
  var _iconAi   = null;  // AI SVG

  /* ── update all visual state from _aiOn ── */
  function _sync() {
    if (!_fab) return;
    window.bwMobileAiEnabled = _aiOn;

    if (_iconBase) _iconBase.classList.toggle('hidden', _aiOn);
    if (_iconAi)   _iconAi.classList.toggle('hidden', !_aiOn);

    if (_pill) {
      _pill.classList.toggle('bg-[#ffc220]',               _aiOn);
      _pill.classList.toggle('text-zinc-900',              _aiOn);
      _pill.classList.toggle('shadow-[0_0_8px_#ffc22066]', _aiOn);
      _pill.classList.toggle('bg-gray-200',                !_aiOn);
      _pill.classList.toggle('dark:bg-zinc-700',           !_aiOn);
      _pill.classList.toggle('text-gray-400',              !_aiOn);
      _pill.classList.toggle('dark:text-zinc-500',         !_aiOn);
      _pill.setAttribute('aria-label',
        _aiOn ? 'AI answers ON — tap to disable' : 'AI answers OFF — tap to enable');
      _pill.setAttribute('title',
        _aiOn ? 'AI answers: ON' : 'AI answers: OFF');
    }
  }

  /* ── hide FAB when search panel is open (avoid z-index confusion) ── */
  function _watchPanel() {
    var panel = document.getElementById('bw-sq-panel');
    var wrap  = document.getElementById('bw-mob-fab-wrap');
    if (!panel || !wrap) return;

    var obs = new MutationObserver(function () {
      wrap.classList.toggle('opacity-0',           !panel.classList.contains('hidden'));
      wrap.classList.toggle('pointer-events-none', !panel.classList.contains('hidden'));
    });
    obs.observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('DOMContentLoaded', function () {
    _fab      = document.getElementById('bw-mob-search-btn');
    // Pill lives inside the search panel header (all screen sizes)
    _pill     = document.getElementById('bw-mob-ai-pill');
    _iconBase = document.getElementById('bw-mob-icon-base');
    _iconAi   = document.getElementById('bw-mob-icon-ai');

    if (!_fab) return;

    /* Main FAB → open search panel */
    _fab.addEventListener('click', function () {
      if (typeof window.bwSearchOpen === 'function') window.bwSearchOpen();
    });

    /* AI toggle pill */
    if (_pill) {
      _pill.addEventListener('click', function (e) {
        e.stopPropagation();
        _aiOn = !_aiOn;
        localStorage.setItem(LS_KEY, String(_aiOn));
        _sync();
        /* micro-bounce feedback */
        _pill.classList.add('scale-95');
        setTimeout(function () { _pill.classList.remove('scale-95'); }, 120);
      });
    }

    _sync();
    _watchPanel();
  });
}());
