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
    if (badge) badge.classList.add('hidden');
    return;
  }

  // Bottom action bar — flex-wrap so it gracefully grows on narrow screens
  if (!badge) {
    badge = document.createElement('div');
    badge.id        = 'upl-sel-badge';
    badge.setAttribute('role', 'toolbar');
    badge.setAttribute('aria-label', 'Bulk file actions');
    badge.style.cssText = [
      'position:fixed;bottom:0;left:0;right:0;z-index:50;',
      'display:flex;align-items:center;flex-wrap:wrap;gap:6px;',
      'padding:10px 16px 10px;',
      'background:#0053e2;color:#fff;',
      'box-shadow:0 -2px 16px rgba(0,83,226,0.25);',
      'font-size:12px;font-weight:600;font-family:inherit;',
      'user-select:none;pointer-events:auto;',
    ].join('');
    document.body.appendChild(badge);
  }

  var BTN = 'display:inline-flex;align-items:center;gap:4px;' +
            'background:rgba(255,255,255,0.18);border:none;color:#fff;' +
            'font-size:11px;font-weight:600;font-family:inherit;cursor:pointer;' +
            'padding:5px 10px;border-radius:999px;transition:background 0.15s;';
  var BTN_RED = BTN.replace('rgba(255,255,255,0.18)', 'rgba(234,17,0,0.75)');

  // Remove-from-catalog: shown when a catalog filter is active (all visible
  // files are guaranteed to be members of that catalog).
  var catBtn = '';
  if (typeof _uplCatActive !== 'undefined' && _uplCatActive !== null) {
    var catName = '';
    if (typeof _uplCatData !== 'undefined') {
      for (var i = 0; i < _uplCatData.length; i++) {
        if (_uplCatData[i].id === _uplCatActive) { catName = _uplCatData[i].name; break; }
      }
    }
    var rmLabel = catName
      ? '\u2212 ' + _uplEsc(catName.length > 18 ? catName.slice(0, 16) + '\u2026' : catName)
      : '\u2212 Catalog';
    catBtn = '<button onclick="_uplCatBulkRemove()" style="' + BTN_RED + '" ' +
             'title="Remove selected files from this catalog">' + rmLabel + '</button>';
  }

  badge.innerHTML =
    '<span style="flex:1 1 auto;white-space:nowrap;">' +
      count + ' file' + (count === 1 ? '' : 's') + ' selected' +
    '</span>' +
    '<button onclick="_dndBulkFolderPicker()" style="' + BTN + '" ' +
    '  title="Move selected files to a folder">' +
    '  \uD83D\uDCC1 Move' +
    '</button>' +
    '<button onclick="_dndBulkCatalogPicker()" style="' + BTN + '" ' +
    '  title="Add selected files to a catalog">' +
    '  + Catalog' +
    '</button>' +
    catBtn +
    '<button onclick="_uplBulkTagPanel()" style="' + BTN + '" ' +
    '  title="Add / remove tags on selected files">' +
    '  \uD83C\uDFF7\uFE0F Tags' +
    '</button>' +
    '<button onclick="_uplBulkDeleteSelected()" style="' + BTN_RED + '" ' +
    '  title="Delete all selected files">' +
    '  \uD83D\uDDD1\uFE0F Delete' +
    '</button>' +
    '<button onclick="_dndSelClear()" style="' + BTN + 'opacity:0.7;" ' +
    '  aria-label="Clear selection">' +
    '  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">' +
    '    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>' +
    '  </svg>' +
    '</button>';

  badge.style.display = 'flex';
}

// ── Bulk: folder picker sheet ─────────────────────────────────────────────────
function _dndBulkFolderPicker() {
  if (!Object.keys(_dndSelected).length) return;
  _dndPickerSheet(
    '\uD83D\uDCC1 Move ' + Object.keys(_dndSelected).length + ' file(s) to folder',
    _dndFolderPickerItems(),
    function(value) {
      // value is folderId (number) or 'null' for Unfiled
      var fid = value === 'null' ? null : +value;
      _dndBulkMoveToFolder(fid);
    }
  );
}

function _dndFolderPickerItems() {
  var items = [{ value: 'null', label: '\uD83D\uDCC2 Unfiled (no folder)', depth: 0 }];
  if (typeof _uplFldData === 'undefined' || !_uplFldData.length) return items;

  var byParent = { '__root__': [] };
  _uplFldData.forEach(function(f) {
    var k = (f.parent_id === null || f.parent_id === undefined) ? '__root__' : String(f.parent_id);
    if (!byParent[k]) byParent[k] = [];
    byParent[k].push(f);
  });

  function walk(pKey, depth) {
    var kids = (byParent[pKey] || []).slice().sort(function(a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name);
    });
    kids.forEach(function(f) {
      items.push({ value: String(f.id), label: '\uD83D\uDCC1 ' + f.name, depth: depth });
      walk(String(f.id), depth + 1);
    });
  }
  walk('__root__', 1);
  return items;
}

function _dndBulkMoveToFolder(folderId) {
  var keys = Object.keys(_dndSelected);
  var noteCount = 0;
  var pageIds   = [];
  keys.forEach(function(k) {
    var item = _dndSelected[k];
    if (item.src === 'note') { noteCount++; return; }
    pageIds.push(item.id);
  });
  if (noteCount && typeof _uplShowToast === 'function')
    _uplShowToast(noteCount + ' note attachment(s) skipped \u2014 cannot assign to folders.', true);
  if (!pageIds.length) return;

  pageIds.forEach(function(id) { _dndAssignFileToFolder(id, folderId); });
  _dndSelClear();
  var dest = folderId === null ? 'Unfiled' : (function() {
    var f = (typeof _uplFldData !== 'undefined') && _uplFldData.find(function(x) { return x.id === folderId; });
    return f ? f.name : 'folder';
  }());
  if (typeof _uplShowToast === 'function')
    _uplShowToast('\u2713 ' + pageIds.length + ' file(s) moved to ' + dest + '.', false);
  setTimeout(function() { if (typeof _uplFetch === 'function') _uplFetch(1); }, 300);
}

// ── Bulk: catalog picker sheet ────────────────────────────────────────────────
function _dndBulkCatalogPicker() {
  if (!Object.keys(_dndSelected).length) return;
  var cats = (typeof _uplCatData !== 'undefined') ? _uplCatData : [];
  if (!cats.length) {
    if (typeof _uplShowToast === 'function') _uplShowToast('No catalogs yet. Create one in the sidebar.', true);
    return;
  }
  _dndPickerSheet(
    '+ Add ' + Object.keys(_dndSelected).length + ' file(s) to catalog',
    _dndCatalogPickerItems(cats),
    function(value) { _dndFileDropOnCatalog(+value); }
  );
}

function _dndCatalogPickerItems(cats) {
  var byParent = { '__root__': [] };
  cats.forEach(function(c) {
    var k = (c.parent_id === null || c.parent_id === undefined) ? '__root__' : String(c.parent_id);
    if (!byParent[k]) byParent[k] = [];
    byParent[k].push(c);
  });
  var items = [];
  function walk(pKey, depth) {
    var kids = (byParent[pKey] || []).slice().sort(function(a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name);
    });
    kids.forEach(function(c) {
      items.push({ value: String(c.id), label: '\uD83D\uDDC2\uFE0F ' + c.name, depth: depth });
      walk(String(c.id), depth + 1);
    });
  }
  walk('__root__', 0);
  return items;
}

// ── Shared bottom-sheet picker ────────────────────────────────────────────────
// title    — header string
// items    — [{value, label, depth}]
// onPick   — callback(value)
function _dndPickerSheet(title, items, onPick) {
  // Remove any existing picker
  var old = document.getElementById('dnd-picker-sheet');
  if (old) old.remove();

  var isDark = document.documentElement.classList.contains('dark');
  var bg     = isDark ? '#18181b' : '#fff';
  var border = isDark ? '#3f3f46' : '#e5e7eb';
  var txt    = isDark ? '#f4f4f5' : '#111827';
  var sub    = isDark ? '#a1a1aa' : '#6b7280';
  var hover  = isDark ? '#27272a' : '#f3f4f6';

  // Backdrop
  var backdrop = document.createElement('div');
  backdrop.id = 'dnd-picker-sheet';
  backdrop.style.cssText = [
    'position:fixed;inset:0;z-index:60;',
    'background:rgba(0,0,0,0.4);',
    'display:flex;align-items:flex-end;',
  ].join('');

  // Sheet panel
  var panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', title);
  panel.style.cssText = [
    'width:100%;max-height:65vh;overflow-y:auto;',
    'background:' + bg + ';',
    'border-top:1px solid ' + border + ';',
    'border-radius:16px 16px 0 0;',
    'padding:0 0 env(safe-area-inset-bottom,0);',
    'box-shadow:0 -4px 24px rgba(0,0,0,0.15);',
  ].join('');

  // Header
  var hdr = document.createElement('div');
  hdr.style.cssText = [
    'display:flex;align-items:center;justify-content:space-between;',
    'padding:14px 16px 10px;border-bottom:1px solid ' + border + ';',
    'position:sticky;top:0;background:' + bg + ';z-index:1;',
  ].join('');
  hdr.innerHTML =
    '<span style="font-size:13px;font-weight:700;color:' + txt + ';">' + title + '</span>' +
    '<button id="dnd-picker-close" aria-label="Close" ' +
      'style="background:none;border:none;cursor:pointer;color:' + sub + ';font-size:18px;padding:2px 4px;">\u00D7</button>';

  // List
  var list = document.createElement('ul');
  list.setAttribute('role', 'listbox');
  list.style.cssText = 'list-style:none;margin:0;padding:6px 0;';

  items.forEach(function(item) {
    var li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('tabindex', '0');
    li.style.cssText = [
      'display:flex;align-items:center;gap:8px;',
      'padding:10px 16px 10px ' + (16 + item.depth * 20) + 'px;',
      'cursor:pointer;color:' + txt + ';font-size:13px;',
      'border-bottom:1px solid ' + border + ';',
    ].join('');
    li.textContent = item.label;
    function pick() {
      backdrop.remove();
      onPick(item.value);
    }
    li.addEventListener('click', pick);
    li.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    li.addEventListener('mouseover',  function() { li.style.background = hover; });
    li.addEventListener('mouseleave', function() { li.style.background = ''; });
    list.appendChild(li);
  });

  panel.appendChild(hdr);
  panel.appendChild(list);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  // Close handlers
  var closeBtn = hdr.querySelector('#dnd-picker-close');
  closeBtn.addEventListener('click', function() { backdrop.remove(); });
  backdrop.addEventListener('click', function(e) {
    if (e.target === backdrop) backdrop.remove();
  });
  document.addEventListener('keydown', function _esc(e) {
    if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', _esc); }
  });

  // Focus first option for keyboard users
  var first = list.querySelector('[role="option"]');
  if (first) setTimeout(function() { first.focus(); }, 50);
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
