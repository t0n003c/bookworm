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
  var _btp = document.getElementById('upl-bulk-tag-panel');
  if (_btp) _btp.remove();
  var _bdm = document.getElementById('upl-bulk-del-modal');
  if (_bdm) _bdm.classList.add('hidden');
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
    if (badge) badge.style.display = 'none';
    return;
  }

  // Create the bar once; rebuild its children on every update so buttons
  // always get fresh addEventListener calls (no stale onclick references).
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'upl-sel-badge';
    badge.setAttribute('role', 'toolbar');
    badge.setAttribute('aria-label', 'Bulk file actions');
    badge.style.cssText = [
      'position:fixed;bottom:0;left:0;right:0;z-index:50;',
      'display:flex;align-items:center;flex-wrap:wrap;gap:6px;',
      'padding:10px 16px;',
      'padding-bottom:max(10px,env(safe-area-inset-bottom,10px));',
      'background:rgba(15,17,22,0.92);',
      'backdrop-filter:blur(12px) saturate(160%);',
      '-webkit-backdrop-filter:blur(12px) saturate(160%);',
      'border-top:1px solid rgba(255,255,255,0.07);',
      'box-shadow:0 -4px 32px rgba(0,0,0,0.35);',
      'color:#f1f1f3;font-size:12px;font-family:inherit;',
      'user-select:none;pointer-events:auto;touch-action:manipulation;',
    ].join('');
    document.body.appendChild(badge);
  }

  // Wipe and rebuild children — guarantees fresh listeners on every call
  badge.style.display = 'flex';
  while (badge.firstChild) badge.removeChild(badge.firstChild);

  // Count label
  var countEl = document.createElement('span');
  countEl.style.cssText = 'flex:1 1 auto;white-space:nowrap;font-size:12px;' +
                          'font-weight:500;color:rgba(255,255,255,0.55);letter-spacing:0.01em;';
  countEl.textContent = count + ' selected';
  badge.appendChild(countEl);

  // ── Button factory ──────────────────────────────────────────────────────
  // Using addEventListener + touchend so clicks reliably fire on iOS/Android
  // regardless of how/when the button was inserted into the DOM.
  function _mkBtn(label, action, danger) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.style.cssText = [
      'display:inline-flex;align-items:center;gap:5px;',
      'padding:6px 13px;border-radius:8px;border:none;',
      'font-size:11px;font-weight:500;font-family:inherit;',
      'letter-spacing:0.01em;cursor:pointer;',
      'touch-action:manipulation;-webkit-tap-highlight-color:transparent;',
      danger
        ? 'background:rgba(220,38,38,0.18);color:#f87171;'
        : 'background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.85);',
      'transition:background 0.15s,opacity 0.15s;',
    ].join('');
    b.textContent = label;
    function fire(e) { e.preventDefault(); e.stopPropagation(); action(); }
    b.addEventListener('click',    fire);
    b.addEventListener('touchend', fire, { passive: false });
    b.addEventListener('mouseover',  function() {
      b.style.background = danger ? 'rgba(220,38,38,0.30)' : 'rgba(255,255,255,0.14)';
    });
    b.addEventListener('mouseleave', function() {
      b.style.background = danger ? 'rgba(220,38,38,0.18)' : 'rgba(255,255,255,0.08)';
    });
    return b;
  }

  badge.appendChild(_mkBtn('Move to folder', _dndBulkFolderPicker));
  badge.appendChild(_mkBtn('Add to catalog', _dndBulkCatalogPicker));

  // Remove-from-catalog: only when a catalog filter is active
  if (typeof _uplCatActive !== 'undefined' && _uplCatActive !== null) {
    var catName = '';
    if (typeof _uplCatData !== 'undefined') {
      for (var ci = 0; ci < _uplCatData.length; ci++) {
        if (_uplCatData[ci].id === _uplCatActive) { catName = _uplCatData[ci].name; break; }
      }
    }
    var rmLabel = '\u2212 ' + (catName
      ? _uplEsc(catName.length > 16 ? catName.slice(0, 14) + '\u2026' : catName)
      : 'Catalog');
    badge.appendChild(_mkBtn(rmLabel, _uplCatBulkRemove, true));
  }

  badge.appendChild(_mkBtn('Tags',   function() { if (typeof _uplBulkTagPanel     === 'function') _uplBulkTagPanel(); }));
  badge.appendChild(_mkBtn('Delete', function() { if (typeof _uplBulkDeleteSelected === 'function') _uplBulkDeleteSelected(); }, true));

  // Close button — icon-only, slightly subtler
  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Clear selection');
  closeBtn.style.cssText = [
    'display:inline-flex;align-items:center;justify-content:center;',
    'width:30px;height:30px;border-radius:8px;border:none;',
    'background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.45);',
    'cursor:pointer;touch-action:manipulation;',
    '-webkit-tap-highlight-color:transparent;transition:background 0.15s;',
  ].join('');
  closeBtn.innerHTML =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" ' +
         'stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
      '<path d="M6 18L18 6M6 6l12 12"/>' +
    '</svg>';
  function doClose(e) { e.preventDefault(); e.stopPropagation(); _dndSelClear(); }
  closeBtn.addEventListener('click',    doClose);
  closeBtn.addEventListener('touchend', doClose, { passive: false });
  closeBtn.addEventListener('mouseover',  function() { closeBtn.style.background = 'rgba(255,255,255,0.12)'; });
  closeBtn.addEventListener('mouseleave', function() { closeBtn.style.background = 'rgba(255,255,255,0.06)'; });
  badge.appendChild(closeBtn);
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

// ── Drop on catalog (called by catalog tree drop handlers) ──────────────────
function _dndFileDropOnCatalog(catalogId) {
  var keys    = Object.keys(_dndSelected);
  var pageIds = [];

  if (keys.length === 0) {
    // Single-file drag
    if (!_dndDragFileId || _dndDragFileSrc !== 'page') {
      if (_dndDragFileSrc === 'note' && typeof _uplShowToast === 'function')
        _uplShowToast('Note attachments cannot be added to catalogs.', true);
      return;
    }
    pageIds.push(_dndDragFileId);
  } else {
    var noteCount = 0;
    keys.forEach(function(k) {
      var item = _dndSelected[k];
      if (item.src !== 'page') { noteCount++; return; }
      pageIds.push(item.id);
    });
    if (noteCount && typeof _uplShowToast === 'function')
      _uplShowToast(noteCount + ' note attachment' + (noteCount === 1 ? '' : 's') +
        ' skipped \u2014 only standalone files can be added to catalogs.', true);
  }

  var pid = (typeof _uplCatPid !== 'undefined' && _uplCatPid)
    ? _uplCatPid
    : (typeof _uplFldPid !== 'undefined' ? _uplFldPid : 0);
  if (!pid || !pageIds.length) return;

  pageIds.forEach(function(id) {
    fetch('/home/uploads/' + pid + '/catalogs/' + catalogId + '/files', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_id: id }),
    }).catch(function(e) { console.error('[dnd] catalog assign error', e); });
  });

  _dndSelClear();
  if (typeof _uplShowToast === 'function')
    _uplShowToast('\u2713 ' + pageIds.length + ' file' + (pageIds.length === 1 ? '' : 's') + ' added to catalog.', false);

  // Refresh detail panel catalog badges if the open file was one of those assigned
  if (typeof _uplCurrentDetail !== 'undefined' && _uplCurrentDetail &&
      pageIds.indexOf(_uplCurrentDetail.id) !== -1 &&
      typeof _uplRenderDetailCatalogs === 'function') {
    _uplRenderDetailCatalogs(_uplCurrentDetail);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
_dndInit();
