/**
 * home-page-uploads-dnd-pickers.js
 * Bottom-sheet pickers for bulk Move-to-folder and Add-to-catalog actions.
 *
 * Companion to home-page-uploads-dnd.js (must load after it).
 * Depends on globals defined there:
 *   _dndSelected, _dndSelClear, _dndAssignFileToFolder, _dndFileDropOnCatalog
 * And from other uploads modules:
 *   _uplFldData, _uplCatData, _uplShowToast, _uplFetch
 *
 * All var / function — HTMX re-injection safe.
 */

// ── Folder picker ─────────────────────────────────────────────────────────────
function _dndBulkFolderPicker(anchor) {
  if (!Object.keys(_dndSelected).length) return;

  // Work out which folder(s) the selected files currently live in.
  // folderId is stored on each _dndSelected entry — zero extra network calls.
  var folderIds = {};
  Object.values(_dndSelected).forEach(function(item) {
    var fid = item.folderId == null ? 'null' : String(item.folderId);
    folderIds[fid] = true;
  });
  var uniqueIds   = Object.keys(folderIds);
  var currentVals = uniqueIds; // pass to picker so rows get checkmarks

  // Build human-readable subtitle for the sheet header
  var subtitle = '';
  if (uniqueIds.length === 1) {
    var fid = uniqueIds[0];
    if (fid === 'null') {
      subtitle = 'Currently: Unfiled';
    } else {
      var fd = typeof _uplFldData !== 'undefined' &&
               _uplFldData.find(function(f) { return String(f.id) === fid; });
      subtitle = 'Currently: ' + (fd ? fd.name : 'a folder');
    }
  } else {
    subtitle = 'Currently in ' + uniqueIds.length + ' different folders';
  }

  _dndPickerSheet(
    'Move ' + Object.keys(_dndSelected).length + ' file(s) to folder',
    _dndFolderPickerItems(),
    function(value) { _dndBulkMoveToFolder(value === 'null' ? null : +value); },
    subtitle,
    currentVals,
    anchor
  );
}

function _dndFolderPickerItems() {
  var items = [{ value: 'null', label: 'Unfiled  —  no folder', depth: 0 }];
  if (typeof _uplFldData === 'undefined' || !_uplFldData.length) return items;

  var byParent = { '__root__': [] };
  _uplFldData.forEach(function(f) {
    var k = (f.parent_id === null || f.parent_id === undefined) ? '__root__' : String(f.parent_id);
    if (!byParent[k]) byParent[k] = [];
    byParent[k].push(f);
  });

  function walk(pKey, depth) {
    (byParent[pKey] || []).slice()
      .sort(function(a, b) {
        return (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name);
      })
      .forEach(function(f) {
        items.push({ value: String(f.id), label: f.name, depth: depth });
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
    var f = (typeof _uplFldData !== 'undefined') &&
            _uplFldData.find(function(x) { return x.id === folderId; });
    return f ? f.name : 'folder';
  }());
  if (typeof _uplShowToast === 'function')
    _uplShowToast('\u2713 ' + pageIds.length + ' file(s) moved to ' + dest + '.', false);
  setTimeout(function() { if (typeof _uplFetch === 'function') _uplFetch(1); }, 300);
}

// ── Catalog picker ────────────────────────────────────────────────────────────
function _dndBulkCatalogPicker(anchor) {
  if (!Object.keys(_dndSelected).length) return;
  var cats = (typeof _uplCatData !== 'undefined') ? _uplCatData : [];
  if (!cats.length) {
    if (typeof _uplShowToast === 'function')
      _uplShowToast('No catalogs yet. Create one in the sidebar.', true);
    return;
  }

  // Show whichever catalog is currently being browsed as the "current" hint.
  // Catalog membership is many-to-many so we use the active filter as the
  // best available single-source signal without extra network calls.
  var subtitle    = '';
  var currentVals = [];
  if (typeof _uplCatActive !== 'undefined' && _uplCatActive !== null) {
    var activeCat = cats.find(function(c) { return c.id === _uplCatActive; });
    if (activeCat) {
      subtitle    = 'Currently browsing: ' + activeCat.name;
      currentVals = [String(_uplCatActive)];
    }
  }

  _dndPickerSheet(
    'Add ' + Object.keys(_dndSelected).length + ' file(s) to catalog',
    _dndCatalogPickerItems(cats),
    function(value) { _dndFileDropOnCatalog(+value); },
    subtitle,
    currentVals,
    anchor
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
    (byParent[pKey] || []).slice()
      .sort(function(a, b) {
        return (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name);
      })
      .forEach(function(c) {
        items.push({ value: String(c.id), label: c.name, depth: depth });
        walk(String(c.id), depth + 1);
      });
  }
  walk('__root__', 0);
  return items;
}

// ── Shared bottom-sheet picker ────────────────────────────────────────────────
// title        — header string shown at the top of the sheet
// items        — [{value, label, depth}]  depth drives left indentation
// onPick       — callback(value) fired when the user picks a row
// subtitle     — (optional) small grey line shown below the title
// currentVals  — (optional) string[] of values already selected; those rows
//                get a ✓ checkmark and a subtle highlight
// anchor       — (optional) DOMRect of the triggering button; when present
//                AND viewport >= 640px the panel floats near the button
//                instead of sliding up as a bottom sheet
function _dndPickerSheet(title, items, onPick, subtitle, currentVals, anchor) {
  currentVals = currentVals || [];
  // Desktop popover: anchor supplied + wide-enough viewport + not a touch-only device
  var PANEL_W   = 360;
  var usePopover = anchor && window.innerWidth >= 640;
  var old = document.getElementById('dnd-picker-sheet');
  if (old) old.remove();
  var oldPanel = document.getElementById('dnd-picker-panel');
  if (oldPanel) oldPanel.remove();

  var isDark = document.documentElement.classList.contains('dark');
  var bg     = isDark ? 'rgba(16,17,22,0.97)' : 'rgba(255,255,255,0.97)';
  var border = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  var txt    = isDark ? '#f1f1f3'               : '#111827';
  var sub    = isDark ? 'rgba(255,255,255,0.35)' : '#9ca3af';
  var hover  = isDark ? 'rgba(255,255,255,0.05)' : '#f9fafb';

  // ── Backdrop ────────────────────────────────────────────────────────────────
  var backdrop = document.createElement('div');
  backdrop.id = 'dnd-picker-sheet';
  // Popover: transparent backdrop, panel positioned near button.
  // Sheet   : dark scrim, panel aligned to bottom edge.
  backdrop.style.cssText = usePopover
    ? 'position:fixed;inset:0;z-index:60;'
    : 'position:fixed;inset:0;z-index:60;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end;';

  // ── Sheet panel ────────────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', title);
  panel.id = 'dnd-picker-panel';

  if (usePopover) {
    // Position: appear above the button, horizontally centred on it,
    // clamped so it never overflows the viewport.
    var gap    = 8;
    var left   = Math.round(anchor.left + anchor.width / 2 - PANEL_W / 2);
    left       = Math.max(gap, Math.min(left, window.innerWidth - PANEL_W - gap));
    // Prefer opening above; if not enough room above, open below.
    var spaceAbove = anchor.top - gap;
    var maxH       = Math.min(spaceAbove > 220 ? spaceAbove - gap : window.innerHeight - anchor.bottom - gap, 420);
    var topVal     = spaceAbove > 220
      ? ''    // will use bottom positioning
      : (anchor.bottom + gap) + 'px';
    var bottomVal  = spaceAbove > 220
      ? (window.innerHeight - anchor.top + gap) + 'px'
      : '';

    panel.style.cssText =
      'position:fixed;' +
      'left:' + left + 'px;' +
      (bottomVal ? 'bottom:' + bottomVal + ';' : 'top:' + topVal + ';') +
      'width:' + PANEL_W + 'px;' +
      'max-height:' + maxH + 'px;overflow-y:auto;' +
      'background:' + bg + ';' +
      'backdrop-filter:blur(16px) saturate(150%);' +
      '-webkit-backdrop-filter:blur(16px) saturate(150%);' +
      'border:1px solid ' + border + ';' +
      'border-radius:12px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.22);' +
      'z-index:61;';
  } else {
    panel.style.cssText =
      'width:100%;max-width:480px;margin:0 auto;max-height:65vh;overflow-y:auto;'  +
      'background:' + bg + ';' +
      'backdrop-filter:blur(16px) saturate(150%);' +
      '-webkit-backdrop-filter:blur(16px) saturate(150%);' +
      'border-top:1px solid ' + border + ';' +
      'border-radius:16px 16px 0 0;' +
      'padding-bottom:env(safe-area-inset-bottom,0);' +
      'box-shadow:0 -8px 40px rgba(0,0,0,0.2);';
  }

  // ── Header ────────────────────────────────────────────────────────────────
  var hdr = document.createElement('div');
  hdr.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;' +
    'padding:14px 16px 10px;border-bottom:1px solid ' + border + ';' +
    'position:sticky;top:0;background:' + bg + ';z-index:1;';

  // Title + optional subtitle sit inside a flex-1 wrapper so closeBtn stays right
  var titleWrapper = document.createElement('div');
  titleWrapper.style.cssText = 'flex:1;min-width:0;';

  var titleEl = document.createElement('p');
  titleEl.style.cssText = 'margin:0;font-size:13px;font-weight:600;color:' + txt + ';';
  titleEl.textContent   = title;
  titleWrapper.appendChild(titleEl);

  if (subtitle) {
    var subEl = document.createElement('p');
    subEl.style.cssText = 'margin:2px 0 0;font-size:10px;color:' + sub + ';';
    subEl.textContent   = subtitle;
    titleWrapper.appendChild(subEl);
  }

  var closeBtn = document.createElement('button');
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.cssText =
    'background:none;border:none;cursor:pointer;color:' + sub + ';' +
    'font-size:20px;line-height:1;padding:2px 4px;touch-action:manipulation;flex-shrink:0;';
  closeBtn.textContent = '\u00D7';
  function closeSheet() { backdrop.remove(); panel.remove(); }
  closeBtn.addEventListener('click',    closeSheet);
  closeBtn.addEventListener('touchend', function(e) { e.preventDefault(); closeSheet(); }, { passive: false });

  hdr.appendChild(titleWrapper);
  hdr.appendChild(closeBtn);

  // ── List ──────────────────────────────────────────────────────────────────
  var list = document.createElement('ul');
  list.setAttribute('role', 'listbox');
  list.style.cssText = 'list-style:none;margin:0;padding:6px 0;';

  items.forEach(function(item) {
    var isCurrent = currentVals.indexOf(item.value) !== -1;
    var li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('tabindex', '0');
    li.style.cssText =
      'padding:12px 16px 12px ' + (16 + item.depth * 20) + 'px;' +
      'cursor:pointer;color:' + txt + ';font-size:13px;' +
      'border-bottom:1px solid ' + border + ';' +
      'touch-action:manipulation;-webkit-tap-highlight-color:transparent;' +
      'transition:background 0.1s;' +
      (isCurrent ? 'background:' + (isDark ? 'rgba(0,83,226,0.15)' : 'rgba(0,83,226,0.06)') + ';' : '');

    // Label + optional checkmark
    var labelSpan = document.createElement('span');
    labelSpan.textContent = item.label;
    li.appendChild(labelSpan);
    if (isCurrent) {
      var check = document.createElement('span');
      check.textContent   = '\u2713';
      check.style.cssText = 'margin-left:auto;padding-left:10px;color:#0053e2;font-weight:700;flex-shrink:0;';
      li.style.display    = 'flex';
      li.style.alignItems = 'center';
      li.appendChild(check);
    }

  // close() on pick
    function pick() { closeSheet(); onPick(item.value); }
    li.addEventListener('click',    function(e) { e.stopPropagation(); pick(); });
    li.addEventListener('touchend', function(e) { e.preventDefault(); e.stopPropagation(); pick(); }, { passive: false });
    li.addEventListener('keydown',  function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    var baseBg = isCurrent ? (isDark ? 'rgba(0,83,226,0.15)' : 'rgba(0,83,226,0.06)') : '';
    li.addEventListener('mouseover',  function() { li.style.background = hover; });
    li.addEventListener('mouseleave', function() { li.style.background = baseBg; });
    list.appendChild(li);
  });

  panel.appendChild(hdr);
  panel.appendChild(list);

  // ── Mount ───────────────────────────────────────────────────────────────────
  // Popover: panel is position:fixed itself, backdrop is transparent click-catcher.
  // Sheet  : panel is a flex child of the dark scrim backdrop.
  if (usePopover) {
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
  } else {
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
  }

  backdrop.addEventListener('click', function() { closeSheet(); });
  document.addEventListener('keydown', function _esc(e) {
    if (e.key === 'Escape') { closeSheet(); document.removeEventListener('keydown', _esc); }
  });

  // Focus first item for keyboard / screen-reader users
  var first = list.querySelector('[role="option"]');
  if (first) setTimeout(function() { first.focus(); }, 50);
}
