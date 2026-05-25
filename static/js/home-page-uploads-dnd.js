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

// ── Check-mode state ("Select" button + mouse hold-to-select) ────────────────
// When true, clicking a file card toggles its selection instead of opening it.
var _uplCheckMode         = false;

// Hold-to-select (laptop mouse, mirrors touch long-press)
var _uplHoldTimer         = null;
var _uplHoldCard          = null;   // {src, id, folderId, key} of the pressed card
var _uplHoldStartX        = 0;
var _uplHoldStartY        = 0;
var _uplHoldSuppressKey   = null;   // file-key whose post-hold click we must swallow
var _uplHoldSuppressUntil = 0;      // epoch-ms after which suppress expires
var _UTD_HOLD_MS          = 500;    // ms to hold before multiselect activates
var _UTD_HOLD_CANCEL_PX   = 6;      // cursor drift (px) that aborts the hold

// ── Check-mode helpers ────────────────────────────────────────────────────────
function _uplCheckModeEnter() {
  if (_uplCheckMode) return;
  _uplCheckMode = true;
  var btn = document.getElementById('upl-doc-select-btn');
  if (btn) btn.innerHTML = '\u2612<span class="upl-rsp-label"> Done</span>';
  // Inject checkboxes on ALL visible cards so users see the mode is active
  _uplCheckInjectBoxes();
}

function _uplCheckModeExit() {
  if (!_uplCheckMode) return;
  _uplCheckMode = false;
  var btn = document.getElementById('upl-doc-select-btn');
  if (btn) btn.innerHTML = '\u2610<span class="upl-rsp-label"> Select</span>';
  document.querySelectorAll('.upl-chk-overlay').forEach(function(el) { el.remove(); });
}

// Inject a small ☐/☑ overlay in the top-left corner of every file card.
// Idempotent — safe to call on re-render.
function _uplCheckInjectBoxes() {
  document.querySelectorAll('[data-upl-file-key]').forEach(function(card) {
    if (card.querySelector('.upl-chk-overlay')) return; // already has one
    var key = card.dataset.uplFileKey;
    var ov  = document.createElement('span');
    ov.className  = 'upl-chk-overlay';
    ov.title      = 'Click to select';
    var isSelected = !!_dndSelected[key];
    ov.textContent = isSelected ? '\u2611' : '\u2610';
    ov.style.cssText = [
      'position:absolute;top:6px;left:6px;z-index:10;',
      'font-size:16px;line-height:1;pointer-events:none;',
      isSelected
        ? 'color:#0053e2;text-shadow:0 0 3px #fff;'
        : 'color:#555;text-shadow:0 0 3px #fff;',
    ].join('');
    card.style.position = 'relative';
    card.prepend(ov);
  });
}

// ── Init (idempotent) ──────────────────────────────────────────────────────────────
function _dndInit() {
  if (_dndListenersAttached) return;
  _dndListenersAttached = true;
  document.addEventListener('mousedown', _dndMouseDown);
  document.addEventListener('mousemove', _dndMouseMove);
  document.addEventListener('mouseup',   _dndMouseUp);
  // Capture-phase listener: suppress the click that fires after a hold-to-select
  document.addEventListener('click', function(e) {
    if (!_uplHoldSuppressKey) return;
    if (Date.now() > _uplHoldSuppressUntil) { _uplHoldSuppressKey = null; return; }
    var card = e.target.closest ? e.target.closest('[data-upl-file-key]') : null;
    if (card && card.dataset.uplFileKey === _uplHoldSuppressKey) {
      _uplHoldSuppressKey   = null;
      _uplHoldSuppressUntil = 0;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true /* capture */);
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
  // Drag started — cancel any pending hold-to-select timer
  if (_uplHoldTimer) {
    clearTimeout(_uplHoldTimer);
    _uplHoldTimer = null;
    _uplHoldCard  = null;
  }

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
    // Read tags from the card's own data attribute — always in sync with what's rendered.
    var rawTags = card ? (card.dataset.uplTags || '') : '';
    var tags = rawTags ? rawTags.split(',').filter(Boolean) : [];
    _dndSelected[key] = { src: src, id: id, folderId: folderId, tags: tags };
    if (card) {
      card.style.outline    = '2px solid #0053e2';
      card.style.boxShadow  = '0 0 0 4px rgba(0,83,226,0.15)';
    }
  }
  // Refresh the ☐/☑ overlay on this specific card if check mode is on
  if (_uplCheckMode && card) {
    var ov = card.querySelector('.upl-chk-overlay');
    if (ov) {
      var sel = !!_dndSelected[key];
      ov.textContent = sel ? '\u2611' : '\u2610';
      ov.style.color = sel ? '#0053e2' : '#555';
    }
  }
  _dndSelBadgeUpdate();
}

function _dndSelClear() {
  _dndSelected = {};
  _uplCheckModeExit();  // exit check mode whenever selection is cleared
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

  badge.appendChild(_mkBtn('\uD83C\uDFF7\uFE0F Tags',   function() { if (typeof _uplBulkTagPanel       === 'function') _uplBulkTagPanel(); }));
  badge.appendChild(_mkBtn('\uD83D\uDDD1\uFE0F Delete', function() { if (typeof _uplBulkDeleteSelected === 'function') _uplBulkDeleteSelected(); }, true));

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

  // Clicking a card: start hold-to-select timer (Ctrl+click handled by card onclick)
  var card = target.closest ? target.closest('[data-upl-file-key]') : null;
  if (card) {
    // Don't arm hold on modifier keys or interactive elements inside the card
    if (event.ctrlKey || event.metaKey) return;
    if (target.closest('button') || target.closest('a')) return;

    _uplHoldStartX = event.clientX;
    _uplHoldStartY = event.clientY;
    _uplHoldCard   = {
      key:      card.dataset.uplFileKey,
      src:      card.dataset.uplSrc,
      id:       parseInt(card.dataset.uplId, 10),
      folderId: card.dataset.uplFolderId ? parseInt(card.dataset.uplFolderId, 10) : null,
    };
    _uplHoldTimer = setTimeout(function() {
      _uplHoldTimer = null;
      var hc = _uplHoldCard;
      _uplHoldCard  = null;
      if (!hc) return;
      if (navigator.vibrate) navigator.vibrate(28);  // subtle haptic on supported laptops
      _uplCheckModeEnter();
      _dndSelToggle(hc.src, hc.id, hc.folderId);
      // Suppress the click that fires when the mouse button is released
      _uplHoldSuppressKey   = hc.key;
      _uplHoldSuppressUntil = Date.now() + 800;
    }, _UTD_HOLD_MS);
    return;
  }

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
  // Cancel hold-to-select if cursor drifts too far
  if (_uplHoldTimer && _uplHoldCard) {
    var dx = event.clientX - _uplHoldStartX;
    var dy = event.clientY - _uplHoldStartY;
    if (Math.abs(dx) > _UTD_HOLD_CANCEL_PX || Math.abs(dy) > _UTD_HOLD_CANCEL_PX) {
      clearTimeout(_uplHoldTimer);
      _uplHoldTimer = null;
      _uplHoldCard  = null;
    }
  }

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
        var rawTags = card.dataset.uplTags || '';
        var ltags   = rawTags ? rawTags.split(',').filter(Boolean) : [];
        _dndSelected[key] = { src: src, id: id, folderId: fid, tags: ltags };
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
  // Cancel hold-to-select if button released before timer fires
  if (_uplHoldTimer) {
    clearTimeout(_uplHoldTimer);
    _uplHoldTimer = null;
    _uplHoldCard  = null;
  }

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
