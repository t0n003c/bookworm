/**
 * home-page-uploads-touch-select.js
 *
 * Long-press touch → multi-select for the Uploads file grid.
 *
 * Interaction model
 * ─────────────────
 *   1. Press-and-hold (400 ms) on any file card in the grid.
 *   2. Buzz at 270 ms ("get ready" — motor finishes before hold completes).
 *   3. At 400 ms: multiselect mode ON, pressed card gets the blue ring.
 *   4. Tap any other card → toggles its selection ring.
 *   5. Use the floating badge's Tags / Delete / × buttons to act or exit.
 *
 * Why touchstart/touchend (not pointer events)?
 * File cards carry draggable="true".  Android Chrome fires pointercancel
 * immediately on draggable elements, killing any pointerdown-based long-press
 * timer before it can complete.  Touch events are immune to this.
 *
 * Two-stage timer pattern (mirrors sidebar-touch-dnd.js):
 *   270 ms  → haptic preview (vibration motor done well before hold fires)
 *   400 ms  → first card selected, multiselect mode activated
 *
 * Depends on (loaded before this file — see base.html):
 *   home-page-uploads-dnd.js  → _dndSelToggle, _dndSelClear, _dndSelected
 *
 * All var / function — HTMX re-injection safe.
 */

// ── State ─────────────────────────────────────────────────────────────────────
var _uplTsActive       = false;  // multiselect mode on/off
var _uplTsHoldTimer    = null;   // arms multiselect at _UTD_TS_HOLD_MS
var _uplTsHapticTimer  = null;   // fires haptic at _UTD_TS_HAPTIC_MS
var _uplTsSuppressNext = false;  // eat the synthetic click right after long-press
var _uplTsStartX       = 0;
var _uplTsStartY       = 0;
var _uplTsDocBound     = false;  // doc-level cancel listeners are attached

// ── Tuning ────────────────────────────────────────────────────────────────────
var _UTD_TS_HOLD_MS   = 400;   // hold before multiselect activates
var _UTD_TS_HAPTIC_MS = 270;   // haptic fires 130 ms before activation
var _UTD_TS_CANCEL_PX = 8;     // finger drift (px) that aborts the hold

// ── Hook _dndSelClear to also exit touch-select mode ─────────────────────────
// Wrapped once (sentinel guard survives HTMX re-injection).
if (!window._uplTsSelClearWrapped) {
  window._uplTsSelClearWrapped = true;
  var _uplTs_origClear = _dndSelClear;
  _dndSelClear = function() {
    _uplTs_origClear.apply(this, arguments);
    _uplTsActive       = false;
    _uplTsSuppressNext = false;
  };
}

// ── touchstart — delegated on #uploads-main ───────────────────────────────────
function _uplTsOnTouchStart(e) {
  if (e.touches.length !== 1) return;

  // Ignore taps that originate inside interactive controls
  var cur = e.target;
  while (cur && cur !== e.currentTarget) {
    if (cur.tagName === 'BUTTON' || cur.tagName === 'A') return;
    cur = cur.parentElement;
  }

  // Walk up to the nearest file card
  var card = null;
  cur = e.target;
  while (cur && cur !== e.currentTarget) {
    if (cur.dataset && cur.dataset.uplFileKey) { card = cur; break; }
    cur = cur.parentElement;
  }
  if (!card) return;

  // In active multiselect, taps are handled by the capture click listener.
  if (_uplTsActive) return;

  var src      = card.getAttribute('data-upl-src');
  var id       = +(card.getAttribute('data-upl-id'));
  var rawFid   = card.getAttribute('data-upl-folder-id');
  var folderId = rawFid ? +rawFid : null;

  _uplTsStartX = e.touches[0].clientX;
  _uplTsStartY = e.touches[0].clientY;

  // Stage 1: haptic preview (motor finishes before hold fires → no race)
  _uplTsHapticTimer = setTimeout(function() {
    _uplTsHapticTimer = null;
    if (navigator.vibrate) navigator.vibrate(32);
  }, _UTD_TS_HAPTIC_MS);

  // Stage 2: activate multiselect
  _uplTsHoldTimer = setTimeout(function() {
    _uplTsHoldTimer    = null;
    _uplTsActive       = true;
    _uplTsSuppressNext = true;  // eat the click fired on the upcoming touchend

    if (typeof _dndSelToggle === 'function') {
      _dndSelToggle(src, id, folderId);
    }

    _uplTsUnbindDoc();  // hold complete — cancel listeners no longer needed
  }, _UTD_TS_HOLD_MS);

  _uplTsBindDoc();
}

// ── Doc-level cancel listeners (only live during the hold phase) ──────────────
function _uplTsBindDoc() {
  if (_uplTsDocBound) return;
  _uplTsDocBound = true;
  document.addEventListener('touchmove',   _uplTsDocMove,   { passive: true });
  document.addEventListener('touchend',    _uplTsDocEnd,    { passive: true });
  document.addEventListener('touchcancel', _uplTsDocCancel, { passive: true });
}

function _uplTsUnbindDoc() {
  if (!_uplTsDocBound) return;
  _uplTsDocBound = false;
  document.removeEventListener('touchmove',   _uplTsDocMove);
  document.removeEventListener('touchend',    _uplTsDocEnd);
  document.removeEventListener('touchcancel', _uplTsDocCancel);
}

function _uplTsDocMove(e) {
  if (!e.touches.length) return;
  var dx = e.touches[0].clientX - _uplTsStartX;
  var dy = e.touches[0].clientY - _uplTsStartY;
  if (Math.abs(dx) > _UTD_TS_CANCEL_PX || Math.abs(dy) > _UTD_TS_CANCEL_PX) {
    _uplTsAbort();
  }
}

function _uplTsDocEnd()    { _uplTsAbort(); }
function _uplTsDocCancel() { _uplTsAbort(); }

function _uplTsAbort() {
  clearTimeout(_uplTsHoldTimer);
  clearTimeout(_uplTsHapticTimer);
  _uplTsHoldTimer   = null;
  _uplTsHapticTimer = null;
  _uplTsUnbindDoc();
}

// ── Capture-phase click interceptor — always live on #uploads-main ────────────
// Fires BEFORE the card's inline onclick, letting us redirect or suppress it.
function _uplTsOnClick(e) {
  // Eat the single synthetic click that fires right after a long-press lifts
  if (_uplTsSuppressNext) {
    _uplTsSuppressNext = false;
    e.stopPropagation();
    e.preventDefault();
    return;
  }

  if (!_uplTsActive) return;

  // Find the file card the tap landed on
  var card = null;
  var cur  = e.target;
  var main = document.getElementById('uploads-main');
  while (cur && cur !== main) {
    if (cur.dataset && cur.dataset.uplFileKey) { card = cur; break; }
    cur = cur.parentElement;
  }
  if (!card) return;

  e.stopPropagation();
  e.preventDefault();

  var src      = card.getAttribute('data-upl-src');
  var id       = +(card.getAttribute('data-upl-id'));
  var rawFid   = card.getAttribute('data-upl-folder-id');
  var folderId = rawFid ? +rawFid : null;

  if (typeof _dndSelToggle === 'function') {
    _dndSelToggle(src, id, folderId);
  }

  // Auto-exit if the user just deselected the last card
  if (typeof _dndSelected !== 'undefined' &&
      Object.keys(_dndSelected).length === 0) {
    _uplTsActive = false;
  }
}

// ── Init — idempotent, called after every grid render ─────────────────────────
function _uplTsInit() {
  var main = document.getElementById('uploads-main');
  if (!main) return;
  // remove-then-add is safe to call multiple times
  main.removeEventListener('touchstart', _uplTsOnTouchStart);
  main.addEventListener('touchstart', _uplTsOnTouchStart, { passive: true });

  main.removeEventListener('click', _uplTsOnClick, true);
  main.addEventListener('click', _uplTsOnClick, true);
}

// Boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _uplTsInit);
} else {
  _uplTsInit();
}
