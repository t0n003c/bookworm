/**
 * home-page-uploads-folders.js
 * Virtual folder tree for the Uploads Homespace sidebar.
 *
 * Entry point: _uplFolderEnterUploadsPage(pid)  — called by home-widgets.js
 * Exit point:  _uplFolderExitUploadsPage()       — called by home-widgets.js
 * Filter hook: _uplFolderGetFilter()             — called by home-page-uploads.js
 *
 * All var — no let/const — so re-declaration is safe across repeated
 * _initSwappedPage() calls in home-widgets.js.
 */

// ── Module state ─────────────────────────────────────────────────────────────
var _uplFldPid    = 0;     // active uploads page_id (0 = not on an uploads page)
var _uplFldData   = [];    // flat folder list [{id, name, parent_id, sort_order}]
var _uplFldActive = null;  // selected folder id (null = "All files")
var _uplFldBusy   = false; // request-in-flight guard

// Modal state
var _uplFldModalMode   = '';   // 'create' | 'rename'
var _uplFldModalParent = null; // parent_id for 'create'
var _uplFldModalTarget = null; // folder id for 'rename'

// Drag state
var _uplFldDragId     = null;  // folder id currently being dragged (null = not dragging)
var _uplFldDropIntent = null;  // 'before' | 'inside' | 'after' — set during dragover

// Collapse state  {[folderId]: true} means that folder's children are hidden
var _uplFldCollapsed  = {};

// Hidden state  {[folderId]: true} means that folder row is dimmed in the sidebar
var _uplFldHidden     = {};

// Manage-hidden mode  — when true the sidebar shows all hidden items greyed out
var _uplFldHideMode   = false;

// Delete-modal pending folder id
var _uplFldDelPending = null;

// Purge-modal pending item {type, id, name}
var _uplPurgePending  = null;

// Row context-menu state
var _uplRowMenuIsOpen = false;
var _uplRowMenuCtx  = null;  // {type, id, name, isHidden}

// Trash state
var _uplTrashData     = [];   // [{id, type, name, deleted_at}]

// ── localStorage helpers ──────────────────────────────────────────────────────
function _uplFldHiddenKey(pid) { return 'bw_upl_' + pid + '_fld_hidden'; }
function _uplFldLoadHidden(pid) {
  try { _uplFldHidden = JSON.parse(localStorage.getItem(_uplFldHiddenKey(pid)) || '{}'); }
  catch (_) { _uplFldHidden = {}; }
}
function _uplFldSaveHidden(pid) {
  try { localStorage.setItem(_uplFldHiddenKey(pid), JSON.stringify(_uplFldHidden)); } catch (_) {}
}

// ── Public API ────────────────────────────────────────────────────────────────

function _uplFolderEnterUploadsPage(pid) {
  _uplFldPid    = pid;
  _uplFldActive = null;
  _uplFldLoadHidden(pid);
  _uplFldHideMode = false; // always start with manage-mode off
  _uplFolderUpdateHideModeBtn();  // reset button to OFF appearance
  _uplTrashFetch();

  // Show Folders tab button, hide Search tab button
  var tabFolders = document.getElementById('sb-tab-folders');
  var tabSearch  = document.getElementById('sb-tab-search');
  if (tabFolders) { tabFolders.classList.remove('hidden'); tabFolders.classList.add('flex'); }
  if (tabSearch)  { tabSearch.classList.add('hidden'); }

  // Switch sidebar to Folders tab
  if (typeof switchSidebarTab === 'function') switchSidebarTab('folders');

  // Clear any prior lasso selection on page re-entry
  if (typeof _dndReset === 'function') _dndReset();

  _uplFolderFetch();
  if (typeof _uplCatalogEnterUploadsPage === 'function') _uplCatalogEnterUploadsPage(pid);
}

function _uplFolderExitUploadsPage() {
  _uplRowMenuClose();
  if (_uplFldPid === 0) return; // not on an uploads page — nothing to do
  _uplFldPid      = 0;
  _uplFldActive   = null;
  _uplFldData     = [];
  _uplFldHideMode = false; // always reset manage-hidden mode on page leave

  // Restore Search tab, hide Folders tab
  var tabFolders = document.getElementById('sb-tab-folders');
  var tabSearch  = document.getElementById('sb-tab-search');
  if (tabFolders) { tabFolders.classList.add('hidden'); tabFolders.classList.remove('flex'); }
  if (tabSearch)  { tabSearch.classList.remove('hidden'); }

  // Switch sidebar back to Workspaces
  if (typeof switchSidebarTab === 'function') switchSidebarTab('workspaces');

  // Clear tree
  var tree = document.getElementById('upl-folder-tree');
  if (tree) tree.innerHTML = '';
  if (typeof _uplCatalogExitUploadsPage === 'function') _uplCatalogExitUploadsPage();
}

// ── Public clear (called by catalog module on catalog selection) ─────────────
function _uplFolderClearActive() {
  _uplFldActive = null;
  _uplFolderRender();
}

/** Toggle a folder's hidden/dimmed state in the sidebar. */
function _uplFolderToggleHidden(folderId) {
  if (_uplFldHidden[folderId]) {
    delete _uplFldHidden[folderId];
  } else {
    _uplFldHidden[folderId] = true;
    // Auto-enable manage-mode so the item dims instead of vanishing entirely.
    // The user can then click ⋮ → Unhide without hunting for the eye button.
    if (!_uplFldHideMode) { _uplFldHideMode = true; _uplFolderUpdateHideModeBtn(); }
  }
  _uplFldSaveHidden(_uplFldPid);
  _uplFolderRender();
  if (typeof _uplCatalogRender === 'function') _uplCatalogRender();
}

/** Toggle manage-hidden mode for both folders and catalogs. */
function _uplFolderToggleHideMode() {
  _uplFldHideMode = !_uplFldHideMode;
  _uplFolderUpdateHideModeBtn();
  _uplFolderRender();
  if (typeof _uplCatalogRender === 'function') _uplCatalogRender();
}

/** Sync the eye button appearance with the current _uplFldHideMode state. */
function _uplFolderUpdateHideModeBtn() {
  var btn  = document.getElementById('upl-hide-mode-btn');
  var icon = document.getElementById('upl-hide-mode-icon');
  if (!btn) return;
  var ON_CLS  = ['text-[#0053e2]', 'bg-blue-50', 'dark:bg-zinc-800', 'dark:text-blue-400'];
  var OFF_CLS = ['text-gray-400', 'dark:text-zinc-500',
                 'hover:text-gray-600', 'dark:hover:text-zinc-300'];
  if (_uplFldHideMode) {
    ON_CLS.forEach(function(c)  { btn.classList.add(c); });
    OFF_CLS.forEach(function(c) { btn.classList.remove(c); });
    btn.setAttribute('aria-pressed', 'true');
    if (icon) icon.innerHTML =
      '<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>';
  } else {
    OFF_CLS.forEach(function(c) { btn.classList.add(c); });
    ON_CLS.forEach(function(c)  { btn.classList.remove(c); });
    btn.setAttribute('aria-pressed', 'false');
    if (icon) icon.innerHTML =
      '<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>'
      + '<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>';
  }
}

function _uplFolderGetFilter() {
  if (_uplFldPid === 0 || _uplFldActive === null) return '';
  return '&folder_id=' + _uplFldActive;
}

// ── Fetch & render ────────────────────────────────────────────────────────────

function _uplFolderFetch() {
  if (!_uplFldPid || _uplFldBusy) return;
  _uplFldBusy = true;
  fetch('/home/uploads/' + _uplFldPid + '/folders', { credentials: 'same-origin' })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(data) {
      _uplFldData = data.folders || [];
      _uplFolderRender();
    })
    .catch(function(e) { console.error('[folders] fetch error', e); })
    .finally(function() { _uplFldBusy = false; });
}

function _uplFolderRender() {
  var tree = document.getElementById('upl-folder-tree');
  if (!tree) return;

  _uplFolderEnsureModal();

  // Build parent->children map
  var byParent = { '__root__': [] };
  _uplFldData.forEach(function(f) {
    var key = f.parent_id === null || f.parent_id === undefined ? '__root__' : String(f.parent_id);
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(f);
  });

  var html = '';

  // "All files" root node — also a file-drag drop target (move to root / unfile)
  var allActive = _uplFldActive === null;
  html += '<div class="flex items-center gap-1 group/row rounded-lg px-2 py-1.5 cursor-pointer transition ' +
    (allActive ? 'bg-blue-50 dark:bg-zinc-800 text-[#0053e2]' : 'text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800') +
    '" id="upl-fld-root-node" onclick="_uplFolderSelect(null)"' +
    ' ondragover="_uplFldRootDragOver(event)"' +
    ' ondragleave="_uplFldRootDragLeave(event)"' +
    ' ondrop="_uplFldRootDrop(event)">' +
    '<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1V10"/></svg>' +
    '<span class="flex-1 text-xs font-semibold truncate">All files</span>' +
    '<button class="flex-shrink-0 p-1 rounded-lg opacity-40 hover:opacity-100 hover:bg-gray-100 dark:hover:bg-zinc-700 text-[#0053e2] transition" ' +
    'onclick="event.stopPropagation();_uplFolderOpenCreate(null)" title="New root folder" aria-label="New root folder">' +
    '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>' +
    '</button></div>';

  html += _buildFolderTreeHtml('__root__', 0, byParent);

  // "Unfiled" node (page-src files with no folder)
  var unfiledActive = _uplFldActive === 0;
  html += '<div class="flex items-center gap-1 group/row rounded-lg px-2 py-1.5 cursor-pointer transition mt-1 border-t border-gray-100 dark:border-zinc-800 pt-2 ' +
    (unfiledActive ? 'bg-blue-50 dark:bg-zinc-800 text-[#0053e2]' : 'text-gray-500 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-800') +
    '" onclick="_uplFolderSelect(0)">' +
    '<svg class="w-4 h-4 flex-shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-3-3v6"/><circle cx="12" cy="12" r="9"/></svg>' +
    '<span class="flex-1 text-xs truncate italic">Unfiled</span>' +
    '</div>';

  tree.innerHTML = html;
  // Re-attach the touch DnD listener after every render (idempotent).
  if (typeof _utdInit === 'function') _utdInit();
}

function _buildFolderTreeHtml(parentKey, depth, byParent) {
  if (depth > 10) return ''; // cycle guard
  var children = byParent[parentKey] || [];
  var html = '';
  children.forEach(function(f) {
    var isActive     = _uplFldActive === f.id;
    var childKey     = String(f.id);
    var hasChildren  = !!(byParent[childKey] && byParent[childKey].length);
    var indent       = depth * 12; // px
    var isCollapsed  = !!_uplFldCollapsed[f.id];
    var isHidden     = !!_uplFldHidden[f.id];
    var parentIdArg  = (f.parent_id !== null && f.parent_id !== undefined) ? f.parent_id : 'null';

    // Skip hidden folders entirely unless manage-mode is active or the folder is currently selected
    if (isHidden && !_uplFldHideMode && !isActive) return;

    // Chevron toggle — only rendered when folder has children
    var chevron = hasChildren
      ? '<button onclick="event.stopPropagation();_uplFolderToggleCollapse(' + f.id + ')"' +
        ' class="flex-shrink-0 p-0.5 rounded text-gray-400 hover:text-[#0053e2] transition"' +
        ' aria-label="' + (isCollapsed ? 'Expand' : 'Collapse') + ' folder"' +
        ' title="' + (isCollapsed ? 'Expand' : 'Collapse') + '">' +
        '<svg class="w-3 h-3 transition-transform ' + (isCollapsed ? '' : 'rotate-90') + '"' +
        ' fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true">' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></button>'
      : '<span class="w-4 flex-shrink-0 inline-block"></span>'; // alignment spacer

    html += '<div style="padding-left:' + indent + 'px">' +
      '<div class="flex items-center gap-1 group/row rounded-lg px-2 py-1.5 cursor-pointer transition ' +
      (isActive ? 'bg-blue-50 dark:bg-zinc-800 text-[#0053e2]' : 'text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800') +
      (isHidden ? ' opacity-40' : '') +
      '" data-fld-id="' + f.id + '"' +
      ' draggable="true"' +
      ' onclick="_uplFolderSelect(' + f.id + ')"' +
      ' ondragstart="_uplFldDragStart(event,' + f.id + ')"' +
      ' ondragover="_uplFldDragOver(event,' + f.id + ',' + parentIdArg + ')"' +
      ' ondragleave="_uplFldDragLeave(event,' + f.id + ')"' +
      ' ondrop="_uplFldDrop(event,' + f.id + ',' + parentIdArg + ')">' +
      chevron +
      '<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      (isActive
        ? '<path stroke-linecap="round" stroke-linejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v1"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 14l-9 5-9-5"/>'
        : '<path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>') +
      '</svg>' +
      '<span class="flex-1 text-xs truncate">' + _uplFldEsc(f.name) + '</span>' +
      // ⋮ context menu button — always visible, works on touch
      '<button onclick="event.stopPropagation();_uplRowMenuOpen(event,\'folder\',' + f.id + ')"' +
      ' title="Folder options" aria-label="Options for ' + _uplFldEsc(f.name) + '" aria-haspopup="true"' +
      ' class="flex-shrink-0 p-1 rounded-lg opacity-40 hover:opacity-100 hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-500 dark:text-zinc-400 transition">' +
      '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>' +
      '</button>' +
      '</div>';

    // Recurse children (skip when collapsed)
    if (hasChildren && !isCollapsed) {
      html += _buildFolderTreeHtml(childKey, depth + 1, byParent);
    }
    html += '</div>';
  });
  return html;
}

// ── Collapse toggle ───────────────────────────────────────────────────────────

function _uplFolderToggleCollapse(id) {
  _uplFldCollapsed[id] = !_uplFldCollapsed[id];
  _uplFolderRender();
}

// ── Selection ─────────────────────────────────────────────────────────────────

function _uplFolderSelect(idOrNull) {
  _uplFldActive = idOrNull;
  if (typeof _uplCatalogClearActive === 'function') _uplCatalogClearActive();
  _uplFolderRender();
  if (typeof _uplFetch === 'function') _uplFetch(1);
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────

function _uplFolderOpenCreate(parentId) {
  _uplFldModalMode   = 'create';
  _uplFldModalParent = parentId;
  _uplFldModalTarget = null;
  var modal = document.getElementById('upl-folder-modal');
  var title = document.getElementById('upl-folder-modal-title');
  var input = document.getElementById('upl-folder-modal-input');
  if (!modal || !title || !input) return;
  title.textContent = parentId === null ? 'New Folder' : 'New Sub-folder';
  input.value = '';
  modal.classList.remove('hidden');
  setTimeout(function() { input.focus(); }, 50);
}

function _uplFolderCreate(name, parentId) {
  if (!name || !_uplFldPid) return;
  fetch('/home/uploads/' + _uplFldPid + '/folders', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, parent_id: parentId }),
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() { _uplFolderFetch(); })
    .catch(function(e) { console.error('[folders] create error', e); });
}

function _uplFolderOpenRename(id, currentName) {
  _uplFldModalMode   = 'rename';
  _uplFldModalParent = null;
  _uplFldModalTarget = id;
  var modal = document.getElementById('upl-folder-modal');
  var title = document.getElementById('upl-folder-modal-title');
  var input = document.getElementById('upl-folder-modal-input');
  if (!modal || !title || !input) return;
  title.textContent = 'Rename Folder';
  input.value = currentName;
  modal.classList.remove('hidden');
  setTimeout(function() { input.focus(); input.select(); }, 50);
}

function _uplFolderRename(id, name) {
  if (!name || !_uplFldPid) return;
  fetch('/home/uploads/' + _uplFldPid + '/folders/' + id, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name }),
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() { _uplFolderFetch(); })
    .catch(function(e) { console.error('[folders] rename error', e); });
}

// ── Folder delete modal (matching catalog-delete style) ─────────────────────

function _uplFolderEnsureDelModal() {
  if (document.getElementById('upl-fld-del-modal')) return;
  var el = document.createElement('div');
  el.id = 'upl-fld-del-modal';
  el.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40';
  el.innerHTML =
    '<div class="bg-white dark:bg-zinc-900 rounded-xl shadow-xl p-5 w-80 mx-4">'
    + '<div class="flex items-center gap-3 mb-3">'
    + '<div class="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">'
    + '<svg class="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>'
    + '</div>'
    + '<div><p class="text-sm font-semibold text-gray-900 dark:text-zinc-100">Move folder to Trash?</p>'
    + '<p class="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">Restored within 7 days, or auto-deleted after. Sub-folders move to root. Files become unfiled.</p>'
    + '</div></div>'
    + '<div class="flex gap-2 justify-end mt-4">'
    + '<button onclick="_uplFolderDelCancel()" class="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">Cancel</button>'
    + '<button onclick="_uplFolderDelConfirm()" class="px-3 py-1.5 rounded-lg text-sm bg-red-500 text-white hover:bg-red-600 transition">Move to Trash</button>'
    + '</div></div>';
  document.body.appendChild(el);
}

function _uplFolderOpenDelete(id, name) {
  _uplFolderEnsureDelModal();
  _uplFldDelPending = id;
  // Update the title to include the folder name
  var modal = document.getElementById('upl-fld-del-modal');
  if (modal) {
    var titleEl = modal.querySelector('p.font-semibold');
    if (titleEl) titleEl.textContent = '\u201c' + name + '\u201d \u2192 Trash?';
    modal.classList.remove('hidden');
  }
}

function _uplFolderDelCancel() {
  _uplFldDelPending = null;
  var modal = document.getElementById('upl-fld-del-modal');
  if (modal) modal.classList.add('hidden');
}

function _uplFolderDelConfirm() {
  var id = _uplFldDelPending;
  _uplFldDelPending = null;
  var modal = document.getElementById('upl-fld-del-modal');
  if (modal) modal.classList.add('hidden');
  if (id !== null) _uplFolderDelete(id);
}

function _uplFolderDelete(id) {
  if (!_uplFldPid) return;
  fetch('/home/uploads/' + _uplFldPid + '/folders/' + id, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
    .then(function(r) {
      if (!r.ok) return Promise.reject(r.status);
      if (_uplFldActive === id) _uplFolderSelect(null);
      else _uplFolderFetch();
      _uplTrashFetch(); // refresh trash panel
    })
    .catch(function(e) { console.error('[folders] delete error', e); });
}

// ── Delete drop zone ─────────────────────────────────────────────────────────────────

var _DZ_ON  = ['border-red-400', 'dark:border-red-500', 'bg-red-50',
               'dark:bg-red-900/20', 'text-red-500', 'dark:text-red-400'];
var _DZ_OFF = ['border-gray-200', 'dark:border-zinc-700',
               'text-gray-300', 'dark:text-zinc-600'];

function _uplDzSetActive(on) {
  var zone = document.getElementById('upl-delete-zone');
  if (!zone) return;
  if (on) {
    _DZ_OFF.forEach(function(c) { zone.classList.remove(c); });
    _DZ_ON.forEach(function(c)  { zone.classList.add(c); });
  } else {
    _DZ_ON.forEach(function(c)  { zone.classList.remove(c); });
    _DZ_OFF.forEach(function(c) { zone.classList.add(c); });
  }
}

function _uplDeleteZoneDragOver(event) {
  var isFolder  = event.dataTransfer.types.indexOf('application/x-upl-folder')  !== -1;
  var isCatalog = event.dataTransfer.types.indexOf('application/x-upl-catalog') !== -1;
  if (!isFolder && !isCatalog) return; // ignore plain-file drags
  event.preventDefault();
  event.stopPropagation();
  _uplDzSetActive(true);
}

function _uplDeleteZoneDragLeave(event) {
  var zone = document.getElementById('upl-delete-zone');
  // Only reset when the pointer truly leaves the zone (not entering a child element)
  if (zone && zone.contains(event.relatedTarget)) return;
  _uplDzSetActive(false);
}

function _uplDeleteZoneDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  _uplDzSetActive(false);

  var isFolder  = event.dataTransfer.types.indexOf('application/x-upl-folder')  !== -1;
  var isCatalog = event.dataTransfer.types.indexOf('application/x-upl-catalog') !== -1;
  var draggedId;

  if (isFolder && _uplFldDragId !== null) {
    draggedId = _uplFldDragId;
    _uplFldDragId = null;
    var folder = null;
    _uplFldData.forEach(function(f) { if (f.id === draggedId) folder = f; });
    _uplFolderOpenDelete(draggedId, folder ? folder.name : String(draggedId));

  } else if (isCatalog && typeof _uplCatDragId !== 'undefined' && _uplCatDragId !== null) {
    draggedId = _uplCatDragId;
    _uplCatDragId = null; // _uplCatDragId is a global var — safe to reset here
    if (typeof _uplCatalogConfirmDelete === 'function') _uplCatalogConfirmDelete(draggedId);
  }
}

// ── Row ⋮ context menu ──────────────────────────────────────────────────────────────────

function _uplRowMenuEnsure() {
  if (document.getElementById('upl-row-menu')) return;
  var el = document.createElement('div');
  el.id = 'upl-row-menu';
  // Positioned absolute by JS; z-50 to float above tree rows
  el.className = 'fixed z-40 min-w-[140px] bg-white dark:bg-zinc-900 border border-gray-200'
    + ' dark:border-zinc-700 rounded-xl shadow-lg py-1 text-xs'
    + ' text-gray-700 dark:text-zinc-300';
  el.style.display = 'none';
  el.setAttribute('role', 'menu');
  document.body.appendChild(el);
}

function _uplRowMenuBtn(icon, label, onclick, colorCls) {
  return '<button role="menuitem" onclick="' + onclick + '"'
    + ' class="w-full flex items-center gap-2 px-3 py-1.5 text-left'
    + ' hover:bg-gray-50 dark:hover:bg-zinc-800 transition'
    + (colorCls ? ' ' + colorCls : '')
    + '">'
    + '<span class="w-3.5 flex-shrink-0" aria-hidden="true">' + icon + '</span>'
    + label
    + '</button>';
}

function _uplRowMenuOpen(event, type, id) {
  event.stopPropagation();
  _uplRowMenuEnsure();

  // Build context from in-memory data
  var item = null;
  if (type === 'folder') {
    _uplFldData.forEach(function(f) { if (f.id === id) item = f; });
  } else {
    if (typeof _uplCatData !== 'undefined') {
      _uplCatData.forEach(function(c) { if (c.id === id) item = c; });
    }
  }
  var name     = item ? item.name : '';
  var isHidden = type === 'folder' ? !!_uplFldHidden[id]
               : (typeof _uplCatHidden !== 'undefined' ? !!_uplCatHidden[id] : false);
  var parentId = item ? item.parent_id : null;
  _uplRowMenuCtx = { type: type, id: id, name: name, isHidden: isHidden, parentId: parentId };

  // Build menu HTML
  var ICON_PLUS = '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>';
  var ICON_PEN  = '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828A2 2 0 0110 16H8v-2a2 2 0 01.586-1.414z"/></svg>';
  var ICON_HIDE = isHidden
    ? '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>'
    : '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/></svg>';
  var ICON_TRASH = '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';

  var html = '';
  if (type === 'folder') {
    html += _uplRowMenuBtn(ICON_PLUS,  'New sub-folder', '_uplRowMenuClose();_uplFolderOpenCreate(_uplRowMenuCtx.id)');
    html += _uplRowMenuBtn(ICON_PEN,   'Rename',         '_uplRowMenuClose();_uplFolderOpenRename(_uplRowMenuCtx.id,_uplRowMenuCtx.name)');
    html += _uplRowMenuBtn(ICON_HIDE, isHidden ? 'Unhide' : 'Hide', '_uplRowMenuClose();_uplFolderToggleHidden(_uplRowMenuCtx.id)');
    html += '<div class="border-t border-gray-100 dark:border-zinc-800 my-1"></div>';
    html += _uplRowMenuBtn(ICON_TRASH, 'Move to Trash',  '_uplRowMenuClose();_uplFolderOpenDelete(_uplRowMenuCtx.id,_uplRowMenuCtx.name)', 'text-red-500 dark:text-red-400');
  } else {
    html += _uplRowMenuBtn(ICON_PLUS,  'New sub-catalog', '_uplRowMenuClose();_uplCatalogOpenModal(\'create\',_uplRowMenuCtx.id,null)');
    html += _uplRowMenuBtn(ICON_PEN,   'Rename',          '_uplRowMenuClose();_uplCatalogOpenModal(\'rename\',_uplRowMenuCtx.id,null)');
    html += _uplRowMenuBtn(ICON_HIDE, isHidden ? 'Unhide' : 'Hide', '_uplRowMenuClose();_uplCatToggleHidden(_uplRowMenuCtx.id)');
    html += '<div class="border-t border-gray-100 dark:border-zinc-800 my-1"></div>';
    html += _uplRowMenuBtn(ICON_TRASH, 'Move to Trash',   '_uplRowMenuClose();_uplCatalogConfirmDelete(_uplRowMenuCtx.id)', 'text-red-500 dark:text-red-400');
  }

  var menu = document.getElementById('upl-row-menu');
  menu.innerHTML = html;

  // Position the menu near the button
  var rect = event.currentTarget.getBoundingClientRect();
  menu.style.display = 'block';
  var mw = menu.offsetWidth  || 160;
  var mh = menu.offsetHeight || 120;
  var left = Math.min(rect.right, window.innerWidth  - mw - 8);
  var top  = (rect.bottom + mh + 8 > window.innerHeight)
             ? rect.top - mh - 4
             : rect.bottom + 4;
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
  _uplRowMenuIsOpen = true;

  // Close on next outside interaction (mouse or touch)
  setTimeout(function() {
    function _outside(e) {
      if (!document.getElementById('upl-row-menu').contains(e.target)) {
        _uplRowMenuClose();
        document.removeEventListener('mousedown', _outside, true);
        document.removeEventListener('touchstart', _outside, true);
      }
    }
    document.addEventListener('mousedown', _outside, true);
    document.addEventListener('touchstart', _outside, true);
  }, 0);
}

function _uplRowMenuClose() {
  var menu = document.getElementById('upl-row-menu');
  if (menu) menu.style.display = 'none';
  _uplRowMenuIsOpen = false;
}

// ── Trash panel ──────────────────────────────────────────────────────────────

var _TRASH_7D_MS = 7 * 24 * 60 * 60 * 1000;

function _uplTrashDaysLeft(deletedAt) {
  var ms = new Date(deletedAt.replace(' ', 'T') + 'Z').getTime();
  return Math.max(0, Math.ceil((_TRASH_7D_MS - (Date.now() - ms)) / 86400000));
}

function _uplTrashFetch() {
  if (!_uplFldPid) return;
  fetch('/home/uploads/' + _uplFldPid + '/trash', { credentials: 'same-origin' })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(data) {
      _uplTrashData = data.items || [];
      _uplTrashRender();
    })
    .catch(function(e) { console.error('[trash] fetch error', e); });
}

function _uplTrashRender() {
  var section = document.getElementById('upl-trash-section');
  var list    = document.getElementById('upl-trash-list');
  var badge   = document.getElementById('upl-trash-count');
  var hdr     = document.getElementById('upl-trash-toggle');
  if (!list) return;

  var count = _uplTrashData.length;

  // Show / hide the entire trash section
  if (section) section.classList.toggle('hidden', count === 0);

  // Badge
  if (badge) {
    badge.textContent = count;
    if (count > 0) badge.classList.remove('hidden');
    else           badge.classList.add('hidden');
  }

  // Auto-collapse if empty
  if (count === 0) {
    list.classList.add('hidden');
    if (hdr) hdr.setAttribute('aria-expanded', 'false');
    list.innerHTML = '';
    return;
  }

  var html = '';
  _uplTrashData.forEach(function(item) {
    var daysLeft = _uplTrashDaysLeft(item.deleted_at);
    var urgent   = daysLeft <= 1;
    var isFolder = item.type === 'folder';

    // Type icon: folder SVG or tag SVG
    var typeIcon = isFolder
      ? '<svg class="w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>'
      : '<svg class="w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"/></svg>';

    var dayLabel = daysLeft === 1 ? '1d' : daysLeft + 'd';
    var dayCls   = urgent
      ? 'text-red-500 dark:text-red-400 font-semibold'
      : 'text-gray-400 dark:text-zinc-500';

    html +=
      '<div class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg'
      + ' text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition group/tr">'
      + typeIcon
      + '<span class="flex-1 text-xs truncate" title="' + _uplFldEsc(item.name) + '">' + _uplFldEsc(item.name) + '</span>'
      + '<span class="text-[9px] ' + dayCls + '">' + dayLabel + '</span>'
      + '<button onclick="_uplRestoreItem(\'' + item.type + '\',' + item.id + ')"'
      + ' title="Restore" aria-label="Restore ' + _uplFldEsc(item.name) + '"'
      + ' class="p-0.5 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-gray-400 dark:text-zinc-500 hover:text-green-600 dark:hover:text-green-400">'
      + '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>'
      + '</button>'
      + '<button onclick="_uplPurgeItem(\'' + item.type + '\',' + item.id + ')"'
      + ' title="Delete permanently" aria-label="Permanently delete ' + _uplFldEsc(item.name) + '"'
      + ' class="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400">'
      + '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'
      + '</button>'
      + '</div>';
  });
  list.innerHTML = html;
}

function _uplTrashToggle() {
  var list = document.getElementById('upl-trash-list');
  var hdr  = document.getElementById('upl-trash-toggle');
  if (!list || !_uplTrashData.length) return; // nothing to expand
  var open = !list.classList.contains('hidden');
  list.classList.toggle('hidden', open);
  if (hdr) hdr.setAttribute('aria-expanded', String(!open));
}

function _uplRestoreItem(type, id) {
  if (!_uplFldPid) return;
  var url = '/home/uploads/' + _uplFldPid + '/' + (type === 'folder' ? 'folders' : 'catalogs') + '/' + id + '/restore';
  fetch(url, { method: 'POST', credentials: 'same-origin' })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() {
      _uplTrashFetch();
      _uplFolderFetch();
      if (type === 'catalog' && typeof _uplCatalogFetch === 'function') _uplCatalogFetch();
    })
    .catch(function(e) { console.error('[trash] restore error', e); });
}

function _uplPurgeEnsureModal() {
  if (document.getElementById('upl-purge-modal')) return;
  var el = document.createElement('div');
  el.id = 'upl-purge-modal';
  el.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40';
  el.innerHTML =
    '<div class="bg-white dark:bg-zinc-900 rounded-xl shadow-xl p-5 w-80 mx-4">'
    + '<div class="flex items-center gap-3 mb-3">'
    + '<div class="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">'
    + '<svg class="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>'
    + '</div>'
    + '<div><p id="upl-purge-title" class="text-sm font-semibold text-gray-900 dark:text-zinc-100">Delete permanently?</p>'
    + '<p class="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">This cannot be undone. It will be gone forever.</p>'
    + '</div></div>'
    + '<div class="flex gap-2 justify-end mt-4">'
    + '<button onclick="_uplPurgeCancel()" class="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">Cancel</button>'
    + '<button onclick="_uplPurgeConfirm()" class="px-3 py-1.5 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 transition">Delete Forever</button>'
    + '</div></div>';
  document.body.appendChild(el);
}

function _uplPurgeItem(type, id) {
  if (!_uplFldPid) return;
  _uplPurgeEnsureModal();
  _uplPurgePending = { type: type, id: id };
  // Look up the name from in-memory trash data — avoids onclick escaping headaches
  var item    = _uplTrashData.find(function(x) { return x.type === type && x.id === id; });
  var name    = item ? item.name : type;
  var titleEl = document.getElementById('upl-purge-title');
  if (titleEl) titleEl.textContent = '\u201c' + name + '\u201d \u2014 delete forever?';
  var modal = document.getElementById('upl-purge-modal');
  if (modal) modal.classList.remove('hidden');
}

function _uplPurgeCancel() {
  _uplPurgePending = null;
  var modal = document.getElementById('upl-purge-modal');
  if (modal) modal.classList.add('hidden');
}

function _uplPurgeConfirm() {
  var pending = _uplPurgePending;
  _uplPurgePending = null;
  var modal = document.getElementById('upl-purge-modal');
  if (modal) modal.classList.add('hidden');
  if (!pending || !_uplFldPid) return;
  var url = '/home/uploads/' + _uplFldPid + '/' + (pending.type === 'folder' ? 'folders' : 'catalogs') + '/' + pending.id + '/purge';
  fetch(url, { method: 'DELETE', credentials: 'same-origin' })
    .then(function(r) {
      if (!r.ok) return Promise.reject(r.status);
      _uplTrashFetch();
    })
    .catch(function(e) { console.error('[trash] purge error', e); });
}

// ── Assign file to folder (called from file detail panel) ─────────────────────

function _uplFolderAssign(uploadId, folderId) {
  if (!_uplFldPid) return;
  fetch('/home/uploads/' + _uplFldPid + '/files/page/' + uploadId + '/folder', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_id: folderId }),
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() {
      // Refresh grid if a folder filter is active (file may leave current view)
      if (typeof _uplFetch === 'function') _uplFetch(1);
    })
    .catch(function(e) { console.error('[folders] assign error', e); });
}

// ── Folder drag-to-reparent / reorder ────────────────────────────────────────
//
// Drop intent is determined by where on the target row the cursor lands:
//   top 33%    -> 'before'  (blue top-border line: place dragged ABOVE target)
//   middle 34% -> 'inside'  (blue ring: nest dragged INSIDE target)
//   bottom 33% -> 'after'   (blue bottom-border line: place dragged BELOW target)
//
// File drags always land 'inside' a folder (files don't reorder the folder tree).

var _DND_RING   = ['ring-2', 'ring-inset', 'ring-[#0053e2]', 'bg-blue-50', 'dark:bg-blue-900/20'];
var _DND_BEFORE = ['border-t-2', 'border-[#0053e2]', 'rounded-none'];
var _DND_AFTER  = ['border-b-2', 'border-[#0053e2]', 'rounded-none'];
var _DND_ALL    = ['ring-2', 'ring-inset', 'ring-[#0053e2]', 'bg-blue-50', 'dark:bg-blue-900/20',
                   'border-t-2', 'border-b-2', 'border-[#0053e2]', 'rounded-none'];

function _uplFldClearDndCls(el) {
  if (!el) return;
  _DND_ALL.forEach(function(c) { el.classList.remove(c); });
}

function _uplFldDragStart(event, id) {
  _uplFldDragId = id;
  event.dataTransfer.setData('application/x-upl-folder', String(id));
  event.dataTransfer.effectAllowed = 'move';
}

function _uplFldDragOver(event, targetId, targetParentId) {
  event.preventDefault();
  event.stopPropagation();
  var isFile   = event.dataTransfer.types.indexOf('application/x-upl-file')   !== -1;
  var isFolder = event.dataTransfer.types.indexOf('application/x-upl-folder') !== -1;
  if (!isFile && !isFolder) return;
  if (isFolder && _uplFldDragId === targetId) return;

  var el = document.querySelector('[data-fld-id="' + targetId + '"]');
  if (!el) return;
  _uplFldClearDndCls(el);

  if (isFile) {
    // Files always go INSIDE a folder
    _uplFldDropIntent = 'inside';
    _DND_RING.forEach(function(c) { el.classList.add(c); });
  } else {
    // Folder-on-folder: vertical position decides intent
    var rect = el.getBoundingClientRect();
    var relY = (event.clientY - rect.top) / (rect.height || 1);
    if (relY < 0.33) {
      _uplFldDropIntent = 'before';
      _DND_BEFORE.forEach(function(c) { el.classList.add(c); });
    } else if (relY > 0.67) {
      _uplFldDropIntent = 'after';
      _DND_AFTER.forEach(function(c) { el.classList.add(c); });
    } else {
      _uplFldDropIntent = 'inside';
      _DND_RING.forEach(function(c) { el.classList.add(c); });
    }
  }
  event.dataTransfer.dropEffect = 'move';
}

function _uplFldDragLeave(event, targetId) {
  var el = document.querySelector('[data-fld-id="' + targetId + '"]');
  _uplFldClearDndCls(el);
  _uplFldDropIntent = null;
}

function _uplFldDrop(event, targetId, targetParentId) {
  event.preventDefault();
  event.stopPropagation();
  var el = document.querySelector('[data-fld-id="' + targetId + '"]');
  _uplFldClearDndCls(el);

  var isFile   = event.dataTransfer.types.indexOf('application/x-upl-file')   !== -1;
  var isFolder = event.dataTransfer.types.indexOf('application/x-upl-folder') !== -1;
  var intent   = _uplFldDropIntent || 'inside';
  _uplFldDropIntent = null;

  if (isFile) {
    if (typeof _dndFileDropOnFolder === 'function') _dndFileDropOnFolder(targetId);
    return;
  }
  if (!isFolder || _uplFldDragId === null || _uplFldDragId === targetId) return;

  if (intent === 'inside') {
    // Nest dragged folder inside target — circular guard
    if (_uplFldIsDescendant(_uplFldDragId, targetId)) {
      if (typeof _uplShowToast === 'function') _uplShowToast('Cannot move a folder into its own sub-folder.', true);
      _uplFldDragId = null; return;
    }
    _uplFolderMove(_uplFldDragId, targetId, false);
  } else {
    // Place dragged as sibling of target (before or after)
    _uplFolderMoveToSiblingOf(_uplFldDragId, targetId, intent === 'before');
  }
  _uplFldDragId = null;
}

function _uplFldRootDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  var isFile   = event.dataTransfer.types.indexOf('application/x-upl-file')   !== -1;
  var isFolder = event.dataTransfer.types.indexOf('application/x-upl-folder') !== -1;
  if (!isFile && !isFolder) return;
  var el = document.getElementById('upl-fld-root-node');
  if (el) _DND_RING.forEach(function(c) { el.classList.add(c); });
  event.dataTransfer.dropEffect = 'move';
}

function _uplFldRootDragLeave(event) {
  var el = document.getElementById('upl-fld-root-node');
  if (el) _DND_ALL.forEach(function(c) { el.classList.remove(c); });
}

function _uplFldRootDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  _uplFldRootDragLeave(event);
  var isFile   = event.dataTransfer.types.indexOf('application/x-upl-file')   !== -1;
  var isFolder = event.dataTransfer.types.indexOf('application/x-upl-folder') !== -1;

  if (isFile) {
    // Drop file onto root = unfile it (folder_id = null)
    if (typeof _dndFileDropOnFolder === 'function') _dndFileDropOnFolder(null);
    return;
  }
  if (isFolder && _uplFldDragId !== null) {
    _uplFolderMove(_uplFldDragId, null, true);
    _uplFldDragId = null;
  }
}

// ── Move / reorder helpers ────────────────────────────────────────────────────

/**
 * Move `draggedId` so it becomes a sibling of `targetId`, placed before or
 * after it in the sort order.  Also handles cross-level reparenting: if the
 * dragged folder is currently in a different parent than the target, it gets
 * reparented as part of the same PATCH.
 */
function _uplFolderMoveToSiblingOf(draggedId, targetId, insertBefore) {
  if (!_uplFldPid) return;

  // Find target folder to read its parent_id and sort_order
  var target = null;
  _uplFldData.forEach(function(f) { if (f.id === targetId) target = f; });
  if (!target) return;

  var newParentId = target.parent_id;  // null means root-level

  // Collect siblings of the target (excluding the folder being dragged)
  var siblings = _uplFldData.filter(function(f) {
    return f.id !== draggedId &&
           ((newParentId == null && f.parent_id == null) || f.parent_id === newParentId);
  }).sort(function(a, b) { return a.sort_order - b.sort_order; });

  var idx = -1;
  siblings.forEach(function(f, i) { if (f.id === targetId) idx = i; });
  if (idx === -1) return;

  var newOrder;
  if (insertBefore) {
    var prev = idx > 0 ? siblings[idx - 1].sort_order : (siblings[idx].sort_order - 20);
    var curr = siblings[idx].sort_order;
    newOrder = Math.floor((prev + curr) / 2);
    if (newOrder === prev || newOrder === curr) {
      newOrder = _uplFldGapCollapse(siblings, draggedId, idx, newParentId, true);
    }
  } else {
    var curr2 = siblings[idx].sort_order;
    var next  = idx < siblings.length - 1 ? siblings[idx + 1].sort_order : (curr2 + 20);
    newOrder  = Math.floor((curr2 + next) / 2);
    if (newOrder === curr2 || newOrder === next) {
      newOrder = _uplFldGapCollapse(siblings, draggedId, idx, newParentId, false);
    }
  }

  // One PATCH: update parent + sort_order together
  var body = newParentId === null
    ? { move_to_root: true, sort_order: newOrder }
    : { parent_id: newParentId, sort_order: newOrder };

  fetch('/home/uploads/' + _uplFldPid + '/folders/' + draggedId, {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() { _uplFolderFetch(); })
    .catch(function(e) { console.error('[folders] reorder error', e); });
}

/** Renumber siblings to create gap space, return the new slot for the dragged item. */
function _uplFldGapCollapse(siblings, draggedId, targetIdx, parentId, insertBefore) {
  var base = 0;
  siblings.forEach(function(f, i) {
    var order = base + i * 10;
    fetch('/home/uploads/' + _uplFldPid + '/folders/' + f.id, {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: order }),
    }).catch(function() {});
  });
  if (insertBefore) {
    return targetIdx === 0 ? -5 : (targetIdx - 1) * 10 + 5;
  }
  return targetIdx * 10 + 5;
}

function _uplFolderMove(draggedId, newParentId, useRoot, extraBody) {
  if (!_uplFldPid) return;
  var body = useRoot ? { move_to_root: true } : { parent_id: newParentId };
  if (extraBody) Object.assign(body, extraBody);
  fetch('/home/uploads/' + _uplFldPid + '/folders/' + draggedId, {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() { _uplFolderFetch(); })
    .catch(function(e) { console.error('[folders] move error', e); });
}

function _uplFolderReorderSort(draggedId, newSortOrder) {
  if (!_uplFldPid) return;
  fetch('/home/uploads/' + _uplFldPid + '/folders/' + draggedId, {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sort_order: newSortOrder }),
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() { _uplFolderFetch(); })
    .catch(function(e) { console.error('[folders] reorder error', e); });
}

function _uplFldMidpointSort(draggedId, targetId, parentId) {
  // Collect siblings (same parent, excluding dragged), sorted by sort_order
  var siblings = _uplFldData.filter(function(f) {
    return f.id !== draggedId &&
           ((parentId == null && f.parent_id == null) || f.parent_id === parentId);
  }).sort(function(a, b) { return a.sort_order - b.sort_order; });

  var idx = -1;
  siblings.forEach(function(f, i) { if (f.id === targetId) idx = i; });
  if (idx === -1) return 0;

  var prev = idx > 0 ? siblings[idx - 1].sort_order : (siblings[idx].sort_order - 20);
  var curr = siblings[idx].sort_order;
  var mid  = Math.floor((prev + curr) / 2);

  if (mid === prev || mid === curr) {
    return _uplFldGapCollapse(siblings, draggedId, idx, parentId, true);
  }
  return mid;
}

function _uplFldIsDescendant(dragId, candidateParentId) {
  if (candidateParentId === null || candidateParentId === undefined) return false;
  if (candidateParentId === dragId) return true;
  var visited = {};
  var current = candidateParentId;
  var byId    = {};
  _uplFldData.forEach(function(f) { byId[f.id] = f; });
  while (current !== null && current !== undefined) {
    if (visited[current]) break;
    visited[current] = true;
    var node = byId[current];
    if (!node) break;
    if (node.parent_id === dragId) return true;
    current = node.parent_id;
  }
  return false;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function _uplFolderEnsureModal() {
  if (document.getElementById('upl-folder-modal')) return;
  var el = document.createElement('div');
  el.id = 'upl-folder-modal';
  el.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40';
  el.innerHTML =
    '<div class="bg-white dark:bg-zinc-900 rounded-xl shadow-xl p-6 w-80">' +
      '<h3 id="upl-folder-modal-title" class="text-sm font-bold mb-3 text-gray-900 dark:text-zinc-100">New Folder</h3>' +
      '<input id="upl-folder-modal-input" type="text" maxlength="80"' +
        ' class="w-full text-sm border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-2 mb-4' +
        ' focus:outline-none focus:ring-2 focus:ring-[#0053e2] bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100"' +
        ' placeholder="Folder name"' +
        ' onkeydown="if(event.key===\'Enter\')_uplFolderModalConfirm();if(event.key===\'Escape\')_uplFolderModalCancel();" />' +
      '<div class="flex gap-3 justify-end">' +
        '<button onclick="_uplFolderModalCancel()"' +
          ' class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600' +
          ' text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">Cancel</button>' +
        '<button id="upl-folder-modal-confirm" onclick="_uplFolderModalConfirm()"' +
          ' class="px-4 py-2 text-sm rounded-lg bg-[#0053e2] text-white font-semibold hover:bg-blue-700 transition">Save</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
}

function _uplFolderModalCancel() {
  var modal = document.getElementById('upl-folder-modal');
  if (modal) modal.classList.add('hidden');
  _uplFldModalMode = '';
}

function _uplFolderModalConfirm() {
  var input = document.getElementById('upl-folder-modal-input');
  if (!input) return;
  var name = input.value.trim();
  if (!name) { input.focus(); return; }

  var modal = document.getElementById('upl-folder-modal');
  if (modal) modal.classList.add('hidden');

  if (_uplFldModalMode === 'create') {
    _uplFolderCreate(name, _uplFldModalParent);
  } else if (_uplFldModalMode === 'rename') {
    _uplFolderRename(_uplFldModalTarget, name);
  }
  _uplFldModalMode = '';
}

// ── Util ──────────────────────────────────────────────────────────────────────

function _uplFldEsc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape for embedding in a single-quoted JS string inside HTML attribute
function _uplFldEscQ(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}
