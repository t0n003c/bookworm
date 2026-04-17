/**
 * home-page-uploads-dnd.js
 * Lasso multi-select + file-to-folder drag orchestration for Uploads Homespace.
 *
 * Depends on (loaded before this file — see base.html):
 *   home-page-uploads.js         → _uplFetch(), _uplShowToast()
 *   home-page-uploads-folders.js → _uplFldPid
 *
 * Public surface consumed by home-page-uploads.js card onclick/ondragstart:
 *   _dndSelToggle(src, id, folderId)
 *   _dndOnFileDragStart(event, src, id, folderId)
 *   _dndOnFileDragEnd(event)
 *
 * Public surface consumed by home-page-uploads-folders.js drop handlers:
 *   _dndFileDropOnFolder(folderId)
 *
 * Public surface consumed by home-page-uploads-folders.js on page re-entry:
 *   _dndReset()
 *
 * All var — no let/const (HTMX re-injection safety).
 */

// ── Module state ──────────────────────────────────────────────────────────────
var _dndSelected          = {};     // key="src:id" → {src, id, folderId}
var _dndLassoActive       = false;
var _dndLassoStart        = { x: 0, y: 0 };
var _dndLassoEl           = null;
var _dndDragFileSrc       = null;
var _dndDragFileId        = null;
var _dndDragFileFolderId  = null;
var _dndListenersAttached = false;  // prevent double-binding across SPA nav
var _dndRafId             = null;   // requestAnimationFrame throttle id

// ── Init (idempotent) ─────────────────────────────────────────────────────────
function _dndInit() {
  if (_dndListenersAttached) return;
  _dndListenersAttached = true;
  document.addEventListener('mousedown', _dndMouseDown);
  document.addEventListener('mousemove', _dndMouseMove);
  document.addEventListener('mouseup',   _dndMouseUp);
}

// ── Reset (called on uploads page re-entry) ───────────────────────────────────
function _dndReset() {
  _dndSelClear();
  _dndLassoActive = false;
  if (_dndLassoEl) {
    _dndLassoEl.remove();
    _dndLassoEl = null;
  }
  _dndDragFileSrc      = null;
  _dndDragFileId       = null;
  _dndDragFileFolderId = null;
}

// ── File drag events (attached via ondragstart on card elements) ──────────────
function _dndOnFileDragStart(event, src, id, folderId) {
  _dndDragFileSrc      = src;
  _dndDragFileId       = id;
  _dndDragFileFolderId = folderId;
  event.dataTransfer.setData('application/x-upl-file', src + ':' + id);
  event.dataTransfer.effectAllowed = 'move';

  // If the dragged card is not already in the selection, treat it as single-file drag
  var key = src + ':' + id;
  if (!_dndSelected[key]) {
    // Don't clear existing selection — user may have selected a group; this file
    // will be dragged solo (the selection is ignored in _dndFileDropOnFolder if empty).
  }
}

function _dndOnFileDragEnd(event) {
  _dndDragFileSrc      = null;
  _dndDragFileId       = null;
  _dndDragFileFolderId = null;
}

// ── Drop on folder (called by folder tree drop handlers) ─────────────────────
function _dndFileDropOnFolder(folderId) {
  var keys     = Object.keys(_dndSelected);
  var noteCount = 0;
  var pageIds   = [];

  if (keys.length === 0) {
    // Single-file drag (no lasso selection active)
    if (_dndDragFileSrc === 'note') {
      if (typeof _uplShowToast === 'function') {
        _uplShowToast('Note attachments cannot be assigned to folders.', true);
      }
      return;
    }
    if (_dndDragFileId !== null) {
      _dndAssignFileToFolder(_dndDragFileId, folderId);
      setTimeout(function() { if (typeof _uplFetch === 'function') _uplFetch(1); }, 250);
    }
    return;
  }

  // Bulk: process selection
  keys.forEach(function(k) {
    var item = _dndSelected[k];
    if (item.src === 'note') { noteCount++; return; }
    pageIds.push(item.id);
  });

  var total = pageIds.length;
  pageIds.forEach(function(id) { _dndAssignFileToFolder(id, folderId); });

  if (noteCount) {
    if (typeof _uplShowToast === 'function') {
      _uplShowToast(
        noteCount + ' note attachment' + (noteCount === 1 ? '' : 's') +
        ' skipped \u2014 cannot assign to a folder.',
        true
      );
    }
  }
  _dndSelClear();
  // Refresh after all PATCHes settle (simple delay — adequate for ≤50 files)
  if (total > 0) {
    setTimeout(function() { if (typeof _uplFetch === 'function') _uplFetch(1); }, 300);
  }
}

function _dndAssignFileToFolder(uploadId, folderId) {
  var pid = (typeof _uplFldPid !== 'undefined') ? _uplFldPid : 0;
  if (!pid) return;
  fetch('/home/uploads/' + pid + '/files/page/' + uploadId + '/folder', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_id: folderId }),
  }).catch(function(e) {
    if (typeof _uplShowToast === 'function') {
      _uplShowToast('Could not move file ' + uploadId + '.', true);
    }
    console.error('[dnd] assign error', e);
  });
}

// ── Multi-select ──────────────────────────────────────────────────────────────
function _dndSelToggle(src, id, folderId) {
  var key  = src + ':' + id;
  var card = document.querySelector('[data-upl-file-key="' + key + '"]');
  if (_dndSelected[key]) {
    delete _dndSelected[key];
    if (card) { card.style.outline = ''; card.style.boxShadow = ''; }
  } else {
    _dndSelected[key] = { src: src, id: id, folderId: folderId };
    if (card) {
      card.style.outline    = '2px solid #0053e2';
      card.style.boxShadow  = '0 0 0 4px rgba(0,83,226,0.15)';
    }
  }
  _dndSelBadgeUpdate();
}

function _dndSelClear() {
  _dndSelected = {};
  document.querySelectorAll('[data-upl-file-key]').forEach(function(c) {
    c.style.outline   = '';
    c.style.boxShadow = '';
  });
  _dndSelBadgeUpdate();
}

function _dndSelBadgeUpdate() {
  var count = Object.keys(_dndSelected).length;
  var badge = document.getElementById('upl-sel-badge');

  if (count === 0) {
    if (badge) badge.classList.add('hidden');
    return;
  }

  // Inject badge as floating pill (bottom-center of uploads-main) if not present
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'upl-sel-badge';
    badge.className =
      'fixed bottom-6 left-1/2 -translate-x-1/2 z-40 ' +
      'flex items-center gap-2 ' +
      'bg-[#0053e2] text-white text-xs font-semibold ' +
      'px-4 py-2 rounded-full shadow-lg ' +
      'select-none pointer-events-auto';
    badge.innerHTML =
      '<span id="upl-sel-badge-count"></span>' +
      '<button onclick="_dndSelClear()" ' +
        'class="ml-1 opacity-70 hover:opacity-100 transition" ' +
        'aria-label="Clear selection">' +
        '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>' +
        '</svg>' +
      '</button>';
    document.body.appendChild(badge);
  }

  var countEl = document.getElementById('upl-sel-badge-count');
  if (countEl) countEl.textContent = count + ' file' + (count === 1 ? '' : 's') + ' selected';
  badge.classList.remove('hidden');
}

// ── Lasso (rubber-band) selection ─────────────────────────────────────────────

function _dndIsInsideUploadsGrid(target) {
  var main = document.getElementById('uploads-main');
  return main && main.contains(target);
}

function _dndMouseDown(event) {
  // Only left-button
  if (event.button !== 0) return;
  // Only when on an uploads page
  if (!(typeof _uplFldPid !== 'undefined' && _uplFldPid)) return;

  var target = event.target;

  // Clicking a card: Ctrl+click handled by card onclick — just track for deselect
  if (target.closest('[data-upl-file-key]')) return;

  // Clicking modal / sidebar / toolbar: ignore
  if (target.closest('#upl-folder-modal') || target.closest('#sidebar') ||
      target.closest('[id^="sb-"]') || target.closest('.fixed')) return;

  // Clicking inside uploads-main on empty space: start lasso or clear selection
  if (_dndIsInsideUploadsGrid(target)) {
    _dndSelClear();
    _dndLassoActive = true;
    _dndLassoStart  = { x: event.clientX, y: event.clientY };
    if (!_dndLassoEl) {
      _dndLassoEl = document.createElement('div');
      _dndLassoEl.style.cssText =
        'position:fixed;pointer-events:none;z-index:200;' +
        'border:2px dashed #0053e2;border-radius:4px;' +
        'background:rgba(0,83,226,0.06);';
      document.body.appendChild(_dndLassoEl);
    }
    _dndLassoEl.style.display = 'block';
    _dndLassoEl.style.left   = event.clientX + 'px';
    _dndLassoEl.style.top    = event.clientY + 'px';
    _dndLassoEl.style.width  = '0px';
    _dndLassoEl.style.height = '0px';
    event.preventDefault();
    return;
  }

  // Clicking completely outside the grid: clear selection
  if (!target.closest('#upl-sel-badge')) {
    _dndSelClear();
  }
}

function _dndMouseMove(event) {
  if (!_dndLassoActive || !_dndLassoEl) return;

  // Throttle to animation frames
  if (_dndRafId) return;
  _dndRafId = requestAnimationFrame(function() {
    _dndRafId = null;
    if (!_dndLassoActive || !_dndLassoEl) return;

    var x1 = _dndLassoStart.x, y1 = _dndLassoStart.y;
    var x2 = event.clientX,    y2 = event.clientY;

    var left   = Math.min(x1, x2);
    var top    = Math.min(y1, y2);
    var width  = Math.abs(x2 - x1);
    var height = Math.abs(y2 - y1);

    _dndLassoEl.style.left   = left   + 'px';
    _dndLassoEl.style.top    = top    + 'px';
    _dndLassoEl.style.width  = width  + 'px';
    _dndLassoEl.style.height = height + 'px';

    // Hit-test all visible file cards
    var lassoBounds = { left: left, top: top, right: left + width, bottom: top + height };
    document.querySelectorAll('[data-upl-file-key]').forEach(function(card) {
      var r    = card.getBoundingClientRect();
      var hits = r.left < lassoBounds.right && r.right  > lassoBounds.left &&
                 r.top  < lassoBounds.bottom && r.bottom > lassoBounds.top;
      var key  = card.dataset.uplFileKey;
      var src  = card.dataset.uplSrc;
      var id   = parseInt(card.dataset.uplId, 10);
      var fid  = card.dataset.uplFolderId ? parseInt(card.dataset.uplFolderId, 10) : null;

      if (hits && !_dndSelected[key]) {
        _dndSelected[key] = { src: src, id: id, folderId: fid };
        card.style.outline   = '2px solid #0053e2';
        card.style.boxShadow = '0 0 0 4px rgba(0,83,226,0.15)';
      } else if (!hits && _dndSelected[key]) {
        delete _dndSelected[key];
        card.style.outline   = '';
        card.style.boxShadow = '';
      }
    });
    _dndSelBadgeUpdate();
  });
}

function _dndMouseUp(event) {
  if (!_dndLassoActive) return;
  _dndLassoActive = false;
  if (_dndLassoEl) _dndLassoEl.style.display = 'none';
  if (_dndRafId) { cancelAnimationFrame(_dndRafId); _dndRafId = null; }
  _dndSelBadgeUpdate();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
_dndInit();
