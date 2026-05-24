/**
 * home-page-uploads-sidebar-touch-dnd.js
 *
 * Touch long-press drag-to-reorder for the Uploads sidebar folder + catalog trees.
 *
 * Why this file exists
 * ────────────────────
 * The folder and catalog trees use the native HTML5 Drag API (draggable /
 * ondragstart / ondragover / ondrop).  Mobile browsers don't fire those events
 * at all — only touch events fire on iOS / Android.  This module adds a
 * parallel touch layer that calls the same backend move helpers the mouse
 * path already uses.
 *
 * Interaction model
 * ─────────────────
 *   1. Press-and-hold (400 ms) on any folder or catalog row.
 *   2. Vibrate + ghost pill appears above the finger → drag is armed.
 *   3. Slide up/down — the row under the finger is highlighted with the same
 *      CSS indicators the desktop DnD uses (before / inside / after).
 *   4. Lift finger — the move is committed using the existing helpers.
 *   5. If the finger moves > 8 px before 400 ms, the hold is cancelled and
 *      normal scrolling continues.
 *
 * Container elements (their innerHTML is replaced on every render but the
 * elements themselves persist, so event-delegation listeners stay attached):
 *   - #upl-folder-tree   — folder rows carry data-fld-id
 *   - #upl-catalog-tree  — catalog rows carry data-cat-id
 *
 * All declarations use var / function so re-injection across HTMX navigations
 * is safe (no let/const TDZ issues).
 */

// ── State ─────────────────────────────────────────────────────────────────────
var _utdHoldTimer  = null;   // setTimeout handle during long-press
var _utdDragging   = false;  // true once the 400 ms hold fires
var _utdDragType   = null;   // 'folder' | 'catalog'
var _utdDragId     = null;   // numeric id of the item being dragged
var _utdDragName   = '';     // display text used on the ghost pill
var _utdStartX     = 0;
var _utdStartY     = 0;
var _utdGhost      = null;   // floating pill element
var _utdHoverEl    = null;   // currently highlighted target row
var _utdDropIntent = null;   // 'before' | 'inside' | 'after'
var _utdHoverType  = null;   // 'folder' | 'catalog' of the highlighted row
var _utdOnZone     = false;  // true when finger is over #upl-delete-zone

// ── Tuning constants ──────────────────────────────────────────────────────────
var _UTD_HOLD_MS   = 400;    // hold duration before drag activates
var _UTD_CANCEL_PX = 8;      // movement in px that aborts the hold

// ── Ghost pill ────────────────────────────────────────────────────────────────
function _utdGhostCreate(name) {
  if (_utdGhost) return;
  var g = document.createElement('div');
  g.id = 'upl-touch-dnd-ghost';
  g.setAttribute('aria-hidden', 'true');
  g.style.cssText = [
    'position:fixed',
    'z-index:9999',
    'pointer-events:none',
    'background:#0053e2',
    'color:#fff',
    'font-size:11px',
    'font-weight:600',
    'font-family:inherit',
    'padding:4px 10px',
    'border-radius:999px',
    'box-shadow:0 4px 14px rgba(0,83,226,0.40)',
    'white-space:nowrap',
    'max-width:180px',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'opacity:0.93',
    'transform:translate(-50%,-150%)',
    'top:0',
    'left:0',
  ].join(';');
  g.textContent = '\u2195 ' + name;
  document.body.appendChild(g);
  _utdGhost = g;
}

function _utdGhostMove(x, y) {
  if (!_utdGhost) return;
  _utdGhost.style.left = x + 'px';
  _utdGhost.style.top  = y + 'px';
}

function _utdGhostRemove() {
  if (!_utdGhost) return;
  if (_utdGhost.parentNode) _utdGhost.parentNode.removeChild(_utdGhost);
  _utdGhost = null;
}

// ── Drop indicators ───────────────────────────────────────────────────────────
// Reuse the same Tailwind class arrays the desktop DnD helpers use.
function _utdClearIndicators() {
  if (!_utdHoverEl) return;
  var all = _utdHoverType === 'folder'
    ? (typeof _DND_ALL !== 'undefined' ? _DND_ALL : [])
    : (typeof _CAT_ALL !== 'undefined' ? _CAT_ALL : []);
  all.forEach(function(c) { _utdHoverEl.classList.remove(c); });
  _utdHoverEl    = null;
  _utdDropIntent = null;
  _utdHoverType  = null;
}

// ── Delete-zone hover ─────────────────────────────────────────────────────────
// Check whether screen coordinates (x, y) land inside #upl-delete-zone and
// update its visual state.  Returns true when the finger is over the zone.
function _utdCheckDeleteZone(x, y) {
  var zone = document.getElementById('upl-delete-zone');
  if (!zone) return false;
  var r = zone.getBoundingClientRect();
  var over = (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  if (over !== _utdOnZone) {
    _utdOnZone = over;
    if (typeof _uplDzSetActive === 'function') _uplDzSetActive(over);
  }
  return over;
}

// ── Hit-test ──────────────────────────────────────────────────────────────────
// Find the nearest sidebar row at screen coordinates (x, y).
// The ghost is briefly hidden so it never blocks elementFromPoint.
function _utdRowAtPoint(x, y) {
  var g = _utdGhost;
  if (g) g.style.display = 'none';
  var under = document.elementFromPoint(x, y);
  if (g) g.style.display = '';
  if (!under) return null;
  // Walk up the DOM looking for a sidebar row
  var el = under;
  while (el && el !== document.body) {
    if (el.hasAttribute && (el.hasAttribute('data-fld-id') || el.hasAttribute('data-cat-id'))) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// ── touchstart (delegated, passive) ──────────────────────────────────────────
function _utdOnTouchStart(e) {
  if (e.touches.length !== 1) return;

  // Ignore taps originating inside interactive controls (⋮ button, chevron, etc.)
  var origin = e.target;
  var cur = origin;
  while (cur && cur !== e.currentTarget) {
    if (cur.tagName === 'BUTTON' || cur.tagName === 'A') return;
    cur = cur.parentElement;
  }

  // Require a direct hit on a draggable sidebar row
  var row = null;
  cur = origin;
  while (cur && cur !== e.currentTarget) {
    if (cur.hasAttribute && (cur.hasAttribute('data-fld-id') || cur.hasAttribute('data-cat-id'))) {
      row = cur; break;
    }
    cur = cur.parentElement;
  }
  if (!row) return;

  var type   = row.hasAttribute('data-fld-id') ? 'folder' : 'catalog';
  var id     = +(row.getAttribute(type === 'folder' ? 'data-fld-id' : 'data-cat-id'));
  var nameEl = row.querySelector('span.flex-1');
  var name   = nameEl ? nameEl.textContent.trim() : String(id);

  _utdStartX = e.touches[0].clientX;
  _utdStartY = e.touches[0].clientY;

  // Arm the hold timer — fires after _UTD_HOLD_MS if finger hasn't moved
  _utdHoldTimer = setTimeout(function() {
    _utdHoldTimer = null;
    _utdDragging  = true;
    _utdDragType  = type;
    _utdDragId    = id;
    _utdDragName  = name;
    _utdGhostCreate(name);
    _utdGhostMove(_utdStartX, _utdStartY);
    if (navigator.vibrate) navigator.vibrate(40);
  }, _UTD_HOLD_MS);

  // Register document-level handlers immediately so we can cancel the hold
  // on movement and commit the drop on release.
  // touchmove must be non-passive so we can call preventDefault during drag.
  document.addEventListener('touchmove',   _utdOnDocMove,   { passive: false });
  document.addEventListener('touchend',    _utdOnDocEnd,    { passive: true  });
  document.addEventListener('touchcancel', _utdOnDocCancel, { passive: true  });
}

// ── touchmove (document, non-passive) ────────────────────────────────────────
function _utdOnDocMove(e) {
  var t = e.touches[0];

  if (!_utdDragging) {
    // Still in hold phase — cancel if finger drifted too far
    var dx = t.clientX - _utdStartX;
    var dy = t.clientY - _utdStartY;
    if (Math.abs(dx) > _UTD_CANCEL_PX || Math.abs(dy) > _UTD_CANCEL_PX) {
      _utdCleanup();
    }
    return; // don't preventDefault — allow normal scroll during hold phase
  }

  // Active drag — lock the sidebar scroll
  e.preventDefault();

  var x = t.clientX;
  var y = t.clientY;
  _utdGhostMove(x, y);

  // Resolve what's under the finger
  var row = _utdRowAtPoint(x, y);

  // ── Delete-zone check (pinned below the scroll area) ────────────────────────
  // _utdCheckDeleteZone handles lighting up / resetting the zone and updates
  // _utdOnZone.  If the finger is over the zone we skip row targeting entirely.
  if (_utdCheckDeleteZone(x, y)) {
    _utdClearIndicators();
    return;
  }

  if (!row) { _utdClearIndicators(); return; }

  var rowType = row.hasAttribute('data-fld-id') ? 'folder' : 'catalog';
  var rowId   = +(row.getAttribute(rowType === 'folder' ? 'data-fld-id' : 'data-cat-id'));

  // Don't drop onto the item being dragged, or across type boundaries
  if (rowType !== _utdDragType || rowId === _utdDragId) {
    _utdClearIndicators(); return;
  }

  // Vertical position within the row → intent
  var rect   = row.getBoundingClientRect();
  var relY   = (y - rect.top) / (rect.height || 1);
  var intent = relY < 0.33 ? 'before' : (relY > 0.67 ? 'after' : 'inside');

  // Only update indicators when target or intent actually changes
  if (row === _utdHoverEl && intent === _utdDropIntent) return;

  _utdClearIndicators();
  _utdHoverEl    = row;
  _utdDropIntent = intent;
  _utdHoverType  = rowType;

  var RING   = rowType === 'folder'
    ? (typeof _DND_RING   !== 'undefined' ? _DND_RING   : [])
    : (typeof _CAT_RING   !== 'undefined' ? _CAT_RING   : []);
  var BEFORE = rowType === 'folder'
    ? (typeof _DND_BEFORE !== 'undefined' ? _DND_BEFORE : [])
    : (typeof _CAT_BEFORE !== 'undefined' ? _CAT_BEFORE : []);
  var AFTER  = rowType === 'folder'
    ? (typeof _DND_AFTER  !== 'undefined' ? _DND_AFTER  : [])
    : (typeof _CAT_AFTER  !== 'undefined' ? _CAT_AFTER  : []);

  var cls = intent === 'before' ? BEFORE : (intent === 'after' ? AFTER : RING);
  cls.forEach(function(c) { row.classList.add(c); });
}

// ── touchend (document, passive) ─────────────────────────────────────────────
function _utdOnDocEnd() {
  if (!_utdDragging) { _utdCleanup(); return; }

  // Capture all state BEFORE cleanup resets it
  var dragId     = _utdDragId;
  var dragType   = _utdDragType;
  var dragName   = _utdDragName;
  var onZone     = _utdOnZone;
  var targetEl   = _utdHoverEl;
  var targetType = _utdHoverType;
  var intent     = _utdDropIntent;

  _utdCleanup();

  if (dragId === null) return;

  // ── Drop on the delete zone ───────────────────────────────────────────────
  if (onZone) {
    if (dragType === 'folder') {
      if (typeof _uplFolderOpenDelete === 'function')
        _uplFolderOpenDelete(dragId, dragName);
    } else {
      if (typeof _uplCatalogConfirmDelete === 'function')
        _uplCatalogConfirmDelete(dragId);
    }
    return;
  }

  // ── Drop on a sibling / parent row ───────────────────────────────────────
  if (!targetEl || !intent) return;

  var targetId = +(targetEl.getAttribute(targetType === 'folder' ? 'data-fld-id' : 'data-cat-id'));
  if (dragType !== targetType || targetId === dragId) return;

  if (dragType === 'folder') {
    _utdCommitFolder(dragId, targetId, intent);
  } else {
    _utdCommitCatalog(dragId, targetId, intent);
  }
}

// ── touchcancel (document, passive) ──────────────────────────────────────────
function _utdOnDocCancel() { _utdCleanup(); }

// ── Commit helpers ────────────────────────────────────────────────────────────
function _utdCommitFolder(draggedId, targetId, intent) {
  if (intent === 'inside') {
    if (typeof _uplFldIsDescendant === 'function' && _uplFldIsDescendant(draggedId, targetId)) {
      if (typeof _uplShowToast === 'function')
        _uplShowToast('Cannot move a folder into its own sub-folder.', true);
      return;
    }
    if (typeof _uplFolderMove === 'function') _uplFolderMove(draggedId, targetId, false);
  } else {
    if (typeof _uplFolderMoveToSiblingOf === 'function')
      _uplFolderMoveToSiblingOf(draggedId, targetId, intent === 'before');
  }
}

function _utdCommitCatalog(draggedId, targetId, intent) {
  if (intent === 'inside') {
    if (typeof _uplCatIsDescendant === 'function' && _uplCatIsDescendant(draggedId, targetId)) {
      if (typeof _uplShowToast === 'function')
        _uplShowToast('Cannot nest a catalog inside its own child.', true);
      return;
    }
    if (typeof _uplCatalogMove === 'function') _uplCatalogMove(draggedId, targetId, false);
  } else {
    if (typeof _uplCatMoveToSiblingOf === 'function')
      _uplCatMoveToSiblingOf(draggedId, targetId, intent === 'before');
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function _utdCleanup() {
  clearTimeout(_utdHoldTimer);
  _utdHoldTimer = null;

  _utdClearIndicators();
  _utdGhostRemove();

  document.removeEventListener('touchmove',   _utdOnDocMove);
  document.removeEventListener('touchend',    _utdOnDocEnd);
  document.removeEventListener('touchcancel', _utdOnDocCancel);

  // Always reset the delete zone highlight on cleanup
  if (_utdOnZone && typeof _uplDzSetActive === 'function') _uplDzSetActive(false);

  _utdDragging  = false;
  _utdDragType  = null;
  _utdDragId    = null;
  _utdDragName  = '';
  _utdStartX    = 0;
  _utdStartY    = 0;
  _utdOnZone    = false;
}

// ── Init ──────────────────────────────────────────────────────────────────────
// Attach a single delegated touchstart listener to each persistent tree
// container.  The trees' innerHTML is replaced on every render but the
// containers themselves stay in the DOM, so one-time attachment is enough.
// Called again from _uplFolderRender / _uplCatalogRender to recover after
// any HTMX full-sidebar swap (idempotent: remove-then-add pattern).
function _utdInit() {
  var containers = [
    document.getElementById('upl-folder-tree'),
    document.getElementById('upl-catalog-tree'),
  ];
  containers.forEach(function(el) {
    if (!el) return;
    el.removeEventListener('touchstart', _utdOnTouchStart);
    el.addEventListener('touchstart', _utdOnTouchStart, { passive: true });
  });
}

// Boot — runs once when the script is first parsed.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _utdInit);
} else {
  _utdInit();
}
