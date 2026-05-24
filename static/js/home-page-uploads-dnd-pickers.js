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
function _dndBulkFolderPicker() {
  if (!Object.keys(_dndSelected).length) return;
  _dndPickerSheet(
    'Move ' + Object.keys(_dndSelected).length + ' file(s) to folder',
    _dndFolderPickerItems(),
    function(value) {
      _dndBulkMoveToFolder(value === 'null' ? null : +value);
    }
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
function _dndBulkCatalogPicker() {
  if (!Object.keys(_dndSelected).length) return;
  var cats = (typeof _uplCatData !== 'undefined') ? _uplCatData : [];
  if (!cats.length) {
    if (typeof _uplShowToast === 'function')
      _uplShowToast('No catalogs yet. Create one in the sidebar.', true);
    return;
  }
  _dndPickerSheet(
    'Add ' + Object.keys(_dndSelected).length + ' file(s) to catalog',
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
// title   — header string shown at the top of the sheet
// items   — [{value, label, depth}]  depth drives left indentation
// onPick  — callback(value) fired when the user picks a row
function _dndPickerSheet(title, items, onPick) {
  var old = document.getElementById('dnd-picker-sheet');
  if (old) old.remove();

  var isDark = document.documentElement.classList.contains('dark');
  var bg     = isDark ? 'rgba(16,17,22,0.97)' : 'rgba(255,255,255,0.97)';
  var border = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  var txt    = isDark ? '#f1f1f3'               : '#111827';
  var sub    = isDark ? 'rgba(255,255,255,0.35)' : '#9ca3af';
  var hover  = isDark ? 'rgba(255,255,255,0.05)' : '#f9fafb';

  // ── Backdrop ─────────────────────────────────────────────────────────────
  var backdrop = document.createElement('div');
  backdrop.id = 'dnd-picker-sheet';
  backdrop.style.cssText =
    'position:fixed;inset:0;z-index:60;background:rgba(0,0,0,0.45);' +
    'display:flex;align-items:flex-end;';

  // ── Sheet panel ───────────────────────────────────────────────────────────
  var panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', title);
  panel.style.cssText =
    'width:100%;max-height:65vh;overflow-y:auto;' +
    'background:' + bg + ';' +
    'backdrop-filter:blur(16px) saturate(150%);' +
    '-webkit-backdrop-filter:blur(16px) saturate(150%);' +
    'border-top:1px solid ' + border + ';' +
    'border-radius:16px 16px 0 0;' +
    'padding-bottom:env(safe-area-inset-bottom,0);' +
    'box-shadow:0 -8px 40px rgba(0,0,0,0.2);';

  // ── Header ────────────────────────────────────────────────────────────────
  var hdr = document.createElement('div');
  hdr.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;' +
    'padding:14px 16px 10px;border-bottom:1px solid ' + border + ';' +
    'position:sticky;top:0;background:' + bg + ';z-index:1;';

  var titleEl = document.createElement('span');
  titleEl.style.cssText = 'font-size:13px;font-weight:600;color:' + txt + ';';
  titleEl.textContent   = title;

  var closeBtn = document.createElement('button');
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.cssText =
    'background:none;border:none;cursor:pointer;color:' + sub + ';' +
    'font-size:20px;line-height:1;padding:2px 4px;touch-action:manipulation;';
  closeBtn.textContent = '\u00D7';
  function closeSheet() { backdrop.remove(); }
  closeBtn.addEventListener('click',    closeSheet);
  closeBtn.addEventListener('touchend', function(e) { e.preventDefault(); closeSheet(); }, { passive: false });

  hdr.appendChild(titleEl);
  hdr.appendChild(closeBtn);

  // ── List ──────────────────────────────────────────────────────────────────
  var list = document.createElement('ul');
  list.setAttribute('role', 'listbox');
  list.style.cssText = 'list-style:none;margin:0;padding:6px 0;';

  items.forEach(function(item) {
    var li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('tabindex', '0');
    li.style.cssText =
      'padding:12px 16px 12px ' + (16 + item.depth * 20) + 'px;' +
      'cursor:pointer;color:' + txt + ';font-size:13px;' +
      'border-bottom:1px solid ' + border + ';' +
      'touch-action:manipulation;-webkit-tap-highlight-color:transparent;' +
      'transition:background 0.1s;';
    li.textContent = item.label;

    function pick() { backdrop.remove(); onPick(item.value); }
    li.addEventListener('click',    function(e) { e.stopPropagation(); pick(); });
    li.addEventListener('touchend', function(e) { e.preventDefault(); e.stopPropagation(); pick(); }, { passive: false });
    li.addEventListener('keydown',  function(e) {
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

  backdrop.addEventListener('click', function(e) {
    if (e.target === backdrop) backdrop.remove();
  });
  document.addEventListener('keydown', function _esc(e) {
    if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', _esc); }
  });

  // Focus first item for keyboard / screen-reader users
  var first = list.querySelector('[role="option"]');
  if (first) setTimeout(function() { first.focus(); }, 50);
}
