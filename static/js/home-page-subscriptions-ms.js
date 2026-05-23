/**
 * home-page-subscriptions-ms.js
 * Long-press multiselect + bulk-delete for subscription cards.
 * Companion to home-page-subscriptions.js — loaded right after it.
 *
 * Flow:
 *   Hold a card 500 ms  →  enter multiselect mode
 *   Tap cards           →  toggle selection (red outline + ✓)
 *   "Delete (N)"        →  bulk-DELETE then full reload
 *   "Cancel"            →  exit multiselect
 *
 * Rules: ALL var — no let/const (HTMX re-injection safety).
 */

/* ── Module state ──────────────────────────────────────────────────────────── */
var _subsMsActive   = false;   // multiselect mode on/off
var _subsMsSelected = {};      // sub id (string) → true
var _subsMsToolbar  = null;    // fixed-bottom toolbar DOM element
var _subsMsLpTimer  = null;    // long-press setTimeout handle
var _subsMsLpX      = 0;
var _subsMsLpY      = 0;

/* ── One-time CSS injection ────────────────────────────────────────────────── */
function _subsMsInjectCss() {
  if (document.getElementById('subs-ms-styles')) return;
  var s = document.createElement('style');
  s.id  = 'subs-ms-styles';
  s.textContent = [
    /* Circular checkbox — hidden until MS mode activates */
    '.subs-ms-cb{position:absolute;top:6px;right:6px;z-index:3;',
    'width:20px;height:20px;border-radius:50%;',
    'border:2px solid #d1d5db;background:#fff;',
    'display:none;align-items:center;justify-content:center;',
    'pointer-events:none;transition:border-color .15s,background .15s;}',
    '.dark .subs-ms-cb{background:#27272a;border-color:#52525b;}',
    /* Show checkboxes when grid is in MS mode */
    '.subs-ms-active .subs-ms-cb{display:flex;}',
    '.subs-ms-active [data-sub-id]{cursor:pointer;user-select:none;}',
    /* Selected card: red outline + filled checkbox */
    '.subs-ms-sel{outline:2px solid #ea1100 !important;outline-offset:1px;}',
    '.subs-ms-sel .subs-ms-cb{background:#ea1100;border-color:#ea1100;}',
    /* Checkmark inside the circle */
    '.subs-ms-cb-tick{display:none;color:#fff;font-size:11px;',
    'font-weight:700;line-height:1;}',
    '.subs-ms-sel .subs-ms-cb-tick{display:block;}',
  ].join('');
  document.head.appendChild(s);
}

/* ── Wire long-press + click delegation on #subs-list ─────────────────────── */
// Called by _subsRenderList() after every render. Guards via data-ms-wired so
// the listeners attach only once per #subs-list element lifetime.
function _subsMsWire() {
  _subsMsInjectCss();
  var el = document.getElementById('subs-list');
  if (!el || el.dataset.msWired) return;
  el.dataset.msWired = '1';

  /* Long-press detection ─────────────────────────────────────────────────── */
  el.addEventListener('pointerdown', function(e) {
    var card = e.target.closest('[data-sub-id]');
    if (!card) return;
    _subsMsLpX = e.clientX;
    _subsMsLpY = e.clientY;
    _subsMsLpTimer = setTimeout(function() {
      _subsMsEnter(card.dataset.subId);
    }, 500);
  });

  function _cancelLp() {
    if (_subsMsLpTimer) { clearTimeout(_subsMsLpTimer); _subsMsLpTimer = null; }
  }
  el.addEventListener('pointermove', function(e) {
    if (Math.abs(e.clientX - _subsMsLpX) > 8 ||
        Math.abs(e.clientY - _subsMsLpY) > 8) _cancelLp();
  });
  el.addEventListener('pointerup',     _cancelLp);
  el.addEventListener('pointercancel', _cancelLp);

  /* Click interception in MS mode ─────────────────────────────────────────
     Capture phase fires before inline onclick on edit/delete buttons,
     letting us toggle selection without opening the edit modal.          */
  el.addEventListener('click', function(e) {
    if (!_subsMsActive) return;
    var card = e.target.closest('[data-sub-id]');
    if (!card) return;
    e.stopPropagation();
    e.preventDefault();
    _subsMsToggle(card.dataset.subId, card);
  }, true);
}

/* ── Enter multiselect ─────────────────────────────────────────────────────── */
function _subsMsEnter(firstId) {
  if (_subsMsActive) return;
  _subsMsActive   = true;
  _subsMsSelected = {};

  var el = document.getElementById('subs-list');
  if (el) el.classList.add('subs-ms-active');

  // Immediately select the card that triggered the long-press
  if (firstId) {
    var card = el && el.querySelector('[data-sub-id="' + firstId + '"]');
    _subsMsToggle(firstId, card);
  }

  _subsMsShowToolbar();
  if (navigator.vibrate) navigator.vibrate(40);
}

/* ── Exit multiselect ──────────────────────────────────────────────────────── */
function _subsMsExit() {
  if (!_subsMsActive) return;
  _subsMsActive   = false;
  _subsMsSelected = {};

  var el = document.getElementById('subs-list');
  if (el) {
    el.classList.remove('subs-ms-active');
    el.querySelectorAll('.subs-ms-sel').forEach(function(c) {
      c.classList.remove('subs-ms-sel');
    });
  }

  if (_subsMsToolbar) { _subsMsToolbar.remove(); _subsMsToolbar = null; }
}

/* ── Toggle a single card's selection ─────────────────────────────────────── */
function _subsMsToggle(id, cardEl) {
  if (_subsMsSelected[id]) {
    delete _subsMsSelected[id];
    if (cardEl) cardEl.classList.remove('subs-ms-sel');
  } else {
    _subsMsSelected[id] = true;
    if (cardEl) cardEl.classList.add('subs-ms-sel');
  }
  _subsMsUpdateToolbar();
}

/* ── Fixed-bottom toolbar ──────────────────────────────────────────────────── */
function _subsMsShowToolbar() {
  if (_subsMsToolbar) return;

  var bar = document.createElement('div');
  bar.id = 'subs-ms-toolbar';
  _subsMsToolbar = bar;

  var isDark = document.documentElement.classList.contains('dark');
  bar.style.cssText = [
    'position:fixed;bottom:0;left:0;right:0;z-index:200;',
    'display:flex;align-items:center;justify-content:space-between;',
    'gap:12px;padding:12px 20px;',
    'background:' + (isDark ? '#18181b' : '#fff') + ';',
    'border-top:1px solid ' + (isDark ? '#3f3f46' : '#e5e7eb') + ';',
    'box-shadow:0 -2px 12px rgba(0,0,0,.1);',
  ].join('');

  var countEl = document.createElement('span');
  countEl.id = 'subs-ms-count';
  countEl.style.cssText = 'font-size:13px;color:' + (isDark ? '#a1a1aa' : '#6b7280') + ';';
  countEl.textContent   = '0 selected';

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = [
    'padding:7px 16px;border-radius:8px;font-size:13px;font-weight:500;',
    'border:1px solid ' + (isDark ? '#52525b' : '#d1d5db') + ';',
    'color:' + (isDark ? '#e4e4e7' : '#374151') + ';',
    'background:' + (isDark ? '#27272a' : '#fff') + ';cursor:pointer;',
  ].join('');
  cancelBtn.addEventListener('click', _subsMsExit);

  var deleteBtn = document.createElement('button');
  deleteBtn.id = 'subs-ms-delete-btn';
  deleteBtn.textContent   = 'Delete';
  deleteBtn.disabled      = true;
  deleteBtn.style.cssText = [
    'padding:7px 18px;border-radius:8px;font-size:13px;font-weight:600;',
    'background:#ea1100;color:#fff;border:none;cursor:pointer;',
    'opacity:.4;transition:opacity .15s;',
  ].join('');
  deleteBtn.addEventListener('click', _subsMsBulkDelete);

  var btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px;';
  btns.appendChild(cancelBtn);
  btns.appendChild(deleteBtn);

  bar.appendChild(countEl);
  bar.appendChild(btns);
  document.body.appendChild(bar);
}

function _subsMsUpdateToolbar() {
  var n       = Object.keys(_subsMsSelected).length;
  var countEl = document.getElementById('subs-ms-count');
  var delBtn  = document.getElementById('subs-ms-delete-btn');
  if (countEl) countEl.textContent  = n + (n === 1 ? ' selected' : ' selected');
  if (delBtn) {
    delBtn.disabled      = n === 0;
    delBtn.style.opacity = n === 0 ? '0.4' : '1';
    delBtn.textContent   = n > 0 ? 'Delete (' + n + ')' : 'Delete';
  }
}

/* ── Bulk delete ───────────────────────────────────────────────────────────── */
function _subsMsBulkDelete() {
  var ids = Object.keys(_subsMsSelected);
  if (!ids.length) return;

  var delBtn = document.getElementById('subs-ms-delete-btn');
  if (delBtn) { delBtn.disabled = true; delBtn.textContent = 'Deleting\u2026'; }

  var reqs = ids.map(function(id) {
    return fetch('/home/subscriptions/' + _subsPid + '/items/' + id, {
      method:  'DELETE',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
    });
  });

  Promise.all(reqs).then(function() {
    _subsMsExit();
    _subsLoadAll();   // full reload — updates list, summary cards, and charts
  }).catch(function(err) {
    console.error('[subs-ms] bulk delete error:', err);
    if (delBtn) {
      delBtn.disabled      = false;
      delBtn.textContent   = 'Delete (' + ids.length + ')';
      delBtn.style.opacity = '1';
    }
    alert('Some deletions failed. Please try again.');
  });
}
