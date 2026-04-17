/**
 * home-page-uploads-catalogs.js — Catalog tree for the Uploads sidebar.
 * Many-to-many: one file can belong to multiple catalogs.
 * Supports parent/child nesting and DnD reorder + reparent.
 *
 * Public API (hooked from home-page-uploads-folders.js):
 *   _uplCatalogEnterUploadsPage(pid) / _uplCatalogExitUploadsPage()
 *   _uplCatalogGetFilter()           → '&catalog_id=N' or ''
 *   _uplCatalogClearActive()         → called on folder selection
 *   _uplRenderDetailCatalogs(f)      → catalog badges in detail pane
 *
 * All declarations use var/function — never let/const (HTMX re-injection).
 */

// ── Module state ─────────────────────────────────────────────────────────────
var _uplCatPid         = 0;     // active page_id
var _uplCatData        = [];    // [{id,name,parent_id,sort_order}]
var _uplCatActive      = null;  // selected catalog id
var _uplCatBusy        = false;
var _uplCatModalMode   = 'create';
var _uplCatModalParent = null;
var _uplCatModalTarget = null;
var _uplCatDragId      = null;
var _uplCatDropIntent  = null;
var _uplCatCollapsed   = {};
var _uplCatDelPending  = null;

// ── DnD CSS class sets ───────────────────────────────────────────────────────
var _CAT_RING   = ['ring-2','ring-inset','ring-[#0053e2]','bg-blue-50','dark:bg-blue-900/20'];
var _CAT_BEFORE = ['border-t-2','border-[#0053e2]','rounded-none'];
var _CAT_AFTER  = ['border-b-2','border-[#0053e2]','rounded-none'];
var _CAT_ALL    = ['ring-2','ring-inset','ring-[#0053e2]','bg-blue-50','dark:bg-blue-900/20',
                   'border-t-2','border-b-2','border-[#0053e2]','rounded-none'];

// ── Public API ───────────────────────────────────────────────────────────────

function _uplCatalogEnterUploadsPage(pid) {
  _uplCatPid       = pid;
  _uplCatActive    = null;
  _uplCatCollapsed = {};
  _uplCatalogFetch();
}

function _uplCatalogExitUploadsPage() {
  if (_uplCatPid === 0) return;
  _uplCatPid    = 0;
  _uplCatActive = null;
  _uplCatData   = [];
  var tree = document.getElementById('upl-catalog-tree');
  if (tree) tree.innerHTML = '';
}

function _uplCatalogGetFilter() {
  if (_uplCatPid === 0 || _uplCatActive === null) return '';
  return '&catalog_id=' + _uplCatActive;
}

function _uplCatalogClearActive() {
  _uplCatActive = null;
  _uplCatalogRender();
}

// ── Fetch & render ───────────────────────────────────────────────────────────

function _uplCatalogFetch() {
  if (!_uplCatPid || _uplCatBusy) return;
  _uplCatBusy = true;
  fetch('/home/uploads/' + _uplCatPid + '/catalogs', { credentials: 'same-origin' })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(data) {
      _uplCatData = data.catalogs || [];
      _uplCatalogRender();
    })
    .catch(function(e) { console.error('[catalogs] fetch error', e); })
    .finally(function() { _uplCatBusy = false; });
}

function _uplCatalogRender() {
  var tree = document.getElementById('upl-catalog-tree');
  if (!tree) return;

  _uplCatalogEnsureModal();
  _uplCatalogEnsureDelModal();

  // Build parent→children map
  var byParent = { '__root__': [] };
  _uplCatData.forEach(function(c) {
    var key = (c.parent_id === null || c.parent_id === undefined) ? '__root__' : String(c.parent_id);
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(c);
  });

  var html = '';

  // "Add root catalog" button
  html += '<div class="flex items-center gap-1 group/row rounded-lg px-2 py-1 cursor-pointer transition '
    + 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800"'
    + ' onclick="_uplCatalogOpenModal(\'create\',null,null)"'
    + ' title="New catalog" aria-label="New catalog">'
    + '<svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>'
    + '<span class="text-xs">New catalog</span></div>';

  html += _buildCatalogTreeHtml('__root__', 0, byParent);

  if (_uplCatData.length === 0) {
    html += '<p class="px-2 py-2 text-[10px] text-gray-400 dark:text-zinc-500 italic">'
      + 'No catalogs yet. Create one above.</p>';
  }

  tree.innerHTML = html;
}

function _buildCatalogTreeHtml(parentKey, depth, byParent) {
  var children = (byParent[parentKey] || []).slice().sort(function(a, b) {
    return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  });
  var html = '';
  children.forEach(function(c) {
    var isActive    = _uplCatActive === c.id;
    var hasChildren = !!(byParent[String(c.id)] && byParent[String(c.id)].length);
    var collapsed   = !!_uplCatCollapsed[c.id];
    var indent      = depth * 14;

    html += '<div class="flex items-center gap-1 group/row rounded-lg px-2 py-1.5 cursor-pointer transition select-none '
      + (isActive ? 'bg-blue-50 dark:bg-zinc-800 text-[#0053e2]' : 'text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800')
      + '" style="padding-left:' + (8 + indent) + 'px"'
      + ' data-cat-id="' + c.id + '"'
      + ' draggable="true"'
      + ' ondragstart="_uplCatDragStart(event,' + c.id + ')"'
      + ' ondragover="_uplCatDragOver(event,' + c.id + ')"'
      + ' ondragleave="_uplCatDragLeave(event,' + c.id + ')"'
      + ' ondragend="_uplCatDragEnd()"'
      + ' ondrop="_uplCatDrop(event,' + c.id + ',' + (c.parent_id === null ? 'null' : c.parent_id) + ')"'
      + ' onclick="_uplCatalogSelect(' + c.id + ')">';

    // Collapse toggle or spacer
    if (hasChildren) {
      html += '<button class="flex-shrink-0 p-0.5 rounded hover:bg-blue-100 dark:hover:bg-zinc-700"'
        + ' onclick="event.stopPropagation();_uplCatToggleCollapse(' + c.id + ')" aria-label="Toggle">'
        + '<svg class="w-3 h-3 transition-transform ' + (collapsed ? '' : 'rotate-90') + '"'
        + ' fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">'
        + '<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></button>';
    } else {
      html += '<span class="w-3 flex-shrink-0"></span>';
    }

    // Tag icon
    html += '<svg class="w-3.5 h-3.5 flex-shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">'
      + '<path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"/></svg>';

    // Name
    html += '<span class="flex-1 text-xs truncate">' + _uplCatEsc(c.name) + '</span>';

    // Action buttons (visible on hover)
    html += '<span class="opacity-0 group-hover/row:opacity-100 transition flex gap-0.5 flex-shrink-0">'
      + '<button class="p-0.5 rounded hover:bg-blue-100 dark:hover:bg-zinc-700 text-[#0053e2]"'
      + ' onclick="event.stopPropagation();_uplCatalogOpenModal(\'create\',' + c.id + ',null)"'
      + ' title="Add sub-catalog" aria-label="Add sub-catalog">'
      + '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg></button>'
      + '<button class="p-0.5 rounded hover:bg-blue-100 dark:hover:bg-zinc-700 text-gray-500 dark:text-zinc-400"'
      + ' onclick="event.stopPropagation();_uplCatalogOpenModal(\'rename\',' + c.id + ',null)"'
      + ' title="Rename" aria-label="Rename">✎</button>'
      + '<button class="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"'
      + ' onclick="event.stopPropagation();_uplCatalogConfirmDelete(' + c.id + ')"'
      + ' title="Delete" aria-label="Delete">✕</button>'
      + '</span></div>';

    // Recursively render children (unless collapsed)
    if (hasChildren && !collapsed) {
      html += _buildCatalogTreeHtml(String(c.id), depth + 1, byParent);
    }
  });
  return html;
}

function _uplCatEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Selection ────────────────────────────────────────────────────────────────

function _uplCatalogSelect(id) {
  // Toggle: clicking the active catalog deselects it
  _uplCatActive = (_uplCatActive === id) ? null : id;
  if (_uplCatActive !== null) {
    if (typeof _uplFolderClearActive === 'function') _uplFolderClearActive();
  }
  _uplCatalogRender();
  if (typeof _uplFetch === 'function') _uplFetch(1);
}

function _uplCatToggleCollapse(id) {
  _uplCatCollapsed[id] = !_uplCatCollapsed[id];
  _uplCatalogRender();
}

// ── Create / Rename modal ───────────────────────────────────────────────────

function _uplCatalogEnsureModal() {
  if (document.getElementById('upl-cat-modal')) return;
  var el = document.createElement('div');
  el.id = 'upl-cat-modal';
  el.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40';
  el.innerHTML = '<div class="bg-white dark:bg-zinc-900 rounded-xl shadow-xl p-5 w-72 mx-4">'
    + '<h3 id="upl-cat-modal-title" class="text-sm font-bold mb-3 text-gray-900 dark:text-zinc-100">New Catalog</h3>'
    + '<input id="upl-cat-modal-input" type="text" maxlength="80"'
    + ' class="w-full border border-gray-300 dark:border-zinc-600 rounded-lg px-3 py-1.5 text-sm'
    + ' bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#0053e2] mb-4"'
    + ' placeholder="Catalog name"'
    + ' onkeydown="if(event.key===\'Enter\')_uplCatalogModalConfirm();if(event.key===\'Escape\')_uplCatalogModalCancel()"/>'
    + '<div class="flex gap-2 justify-end">'
    + '<button onclick="_uplCatalogModalCancel()"'
    + ' class="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">Cancel</button>'
    + '<button id="upl-cat-modal-confirm" onclick="_uplCatalogModalConfirm()"'
    + ' class="px-3 py-1.5 rounded-lg text-sm bg-[#0053e2] text-white hover:bg-[#003eb3] transition">Save</button>'
    + '</div></div>';
  document.body.appendChild(el);
}

function _uplCatalogOpenModal(mode, catalogId, parentId) {
  _uplCatalogEnsureModal();
  _uplCatModalMode   = mode;
  _uplCatModalTarget = catalogId;   // used for rename
  _uplCatModalParent = parentId;    // used for create
  var modal = document.getElementById('upl-cat-modal');
  var title = document.getElementById('upl-cat-modal-title');
  var input = document.getElementById('upl-cat-modal-input');
  if (!modal || !title || !input) return;
  if (mode === 'rename') {
    var cat = null;
    _uplCatData.forEach(function(c) { if (c.id === catalogId) cat = c; });
    title.textContent = 'Rename Catalog';
    input.value = cat ? cat.name : '';
  } else {
    title.textContent = catalogId !== null ? 'New Sub-catalog' : 'New Catalog';
    // For create-child, parentId is actually the catalogId passed as first arg
    _uplCatModalParent = catalogId;
    _uplCatModalTarget = null;
    input.value = '';
  }
  modal.classList.remove('hidden');
  setTimeout(function() { input.focus(); if (mode === 'rename') input.select(); }, 50);
}

function _uplCatalogModalCancel() {
  var modal = document.getElementById('upl-cat-modal');
  if (modal) modal.classList.add('hidden');
}

function _uplCatalogModalConfirm() {
  var input = document.getElementById('upl-cat-modal-input');
  if (!input) return;
  var name = (input.value || '').trim();
  if (!name) return;
  var modal = document.getElementById('upl-cat-modal');
  if (modal) modal.classList.add('hidden');
  if (_uplCatModalMode === 'rename') {
    _uplCatalogRename(_uplCatModalTarget, name);
  } else {
    _uplCatalogCreate(name, _uplCatModalParent);
  }
}

// ── Delete confirm modal ─────────────────────────────────────────────────────

function _uplCatalogEnsureDelModal() {
  if (document.getElementById('upl-cat-del-modal')) return;
  var el = document.createElement('div');
  el.id = 'upl-cat-del-modal';
  el.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40';
  el.innerHTML = '<div class="bg-white dark:bg-zinc-900 rounded-xl shadow-xl p-5 w-80 mx-4">'
    + '<div class="flex items-center gap-3 mb-3">'
    + '<div class="flex-shrink-0 w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">'
    + '<svg class="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>'
    + '</div>'
    + '<div><p class="text-sm font-semibold text-gray-900 dark:text-zinc-100">Delete catalog?</p>'
    + '<p class="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">Files are not deleted. Sub-catalogs move to root.</p>'
    + '</div></div>'
    + '<div class="flex gap-2 justify-end mt-4">'
    + '<button onclick="_uplCatalogDelCancel()"'
    + ' class="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">Cancel</button>'
    + '<button onclick="_uplCatalogDelConfirm()"'
    + ' class="px-3 py-1.5 rounded-lg text-sm bg-red-500 text-white hover:bg-red-600 transition">Delete</button>'
    + '</div></div>';
  document.body.appendChild(el);
}

function _uplCatalogConfirmDelete(id) {
  _uplCatalogEnsureDelModal();
  _uplCatDelPending = id;
  var modal = document.getElementById('upl-cat-del-modal');
  if (modal) modal.classList.remove('hidden');
}

function _uplCatalogDelCancel() {
  _uplCatDelPending = null;
  var modal = document.getElementById('upl-cat-del-modal');
  if (modal) modal.classList.add('hidden');
}

function _uplCatalogDelConfirm() {
  var id = _uplCatDelPending;
  _uplCatDelPending = null;
  var modal = document.getElementById('upl-cat-del-modal');
  if (modal) modal.classList.add('hidden');
  if (id !== null) _uplCatalogDelete(id);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

function _uplCatalogCreate(name, parentId) {
  if (!name || !_uplCatPid) return;
  fetch('/home/uploads/' + _uplCatPid + '/catalogs', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, parent_id: parentId }),
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() { _uplCatalogFetch(); })
    .catch(function(e) { console.error('[catalogs] create error', e); });
}

function _uplCatalogRename(id, name) {
  if (!name || !_uplCatPid) return;
  fetch('/home/uploads/' + _uplCatPid + '/catalogs/' + id, {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name }),
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() { _uplCatalogFetch(); })
    .catch(function(e) { console.error('[catalogs] rename error', e); });
}

function _uplCatalogDelete(id) {
  if (!_uplCatPid) return;
  fetch('/home/uploads/' + _uplCatPid + '/catalogs/' + id, {
    method: 'DELETE', credentials: 'same-origin',
  })
    .then(function(r) {
      if (!r.ok) return Promise.reject(r.status);
      if (_uplCatActive === id) {
        _uplCatActive = null;
        if (typeof _uplFetch === 'function') _uplFetch(1);
      }
      _uplCatalogFetch();
    })
    .catch(function(e) { console.error('[catalogs] delete error', e); });
}

// ── DnD: reorder / reparent ─────────────────────────────────────────────────

function _uplCatClearDndCls(el) {
  if (!el) return;
  _CAT_ALL.forEach(function(c) { el.classList.remove(c); });
}

function _uplCatDragStart(event, id) {
  _uplCatDragId = id;
  event.dataTransfer.setData('application/x-upl-catalog', String(id));
  event.dataTransfer.effectAllowed = 'move';
}

function _uplCatDragOver(event, targetId) {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer.types.indexOf('application/x-upl-catalog') === -1) return;
  if (_uplCatDragId === targetId) return;

  var el = document.querySelector('[data-cat-id="' + targetId + '"]');
  if (!el) return;
  _uplCatClearDndCls(el);

  var rect = el.getBoundingClientRect();
  var relY = (event.clientY - rect.top) / (rect.height || 1);
  if (relY < 0.33) {
    _uplCatDropIntent = 'before';
    _CAT_BEFORE.forEach(function(c) { el.classList.add(c); });
  } else if (relY > 0.67) {
    _uplCatDropIntent = 'after';
    _CAT_AFTER.forEach(function(c) { el.classList.add(c); });
  } else {
    _uplCatDropIntent = 'inside';
    _CAT_RING.forEach(function(c) { el.classList.add(c); });
  }
  event.dataTransfer.dropEffect = 'move';
}

function _uplCatDragLeave(event, targetId) {
  var el = document.querySelector('[data-cat-id="' + targetId + '"]');
  _uplCatClearDndCls(el);
  _uplCatDropIntent = null;
}

function _uplCatDragEnd() {
  _uplCatDragId     = null;
  _uplCatDropIntent = null;
  document.querySelectorAll('[data-cat-id]').forEach(function(el) { _uplCatClearDndCls(el); });
}

function _uplCatDrop(event, targetId, targetParentId) {
  event.preventDefault();
  event.stopPropagation();
  var el = document.querySelector('[data-cat-id="' + targetId + '"]');
  _uplCatClearDndCls(el);

  if (event.dataTransfer.types.indexOf('application/x-upl-catalog') === -1) return;
  var intent = _uplCatDropIntent || 'inside';
  _uplCatDropIntent = null;
  if (_uplCatDragId === null || _uplCatDragId === targetId) { _uplCatDragId = null; return; }

  if (intent === 'inside') {
    // Cycle guard (client-side fast-path; server validates too)
    if (_uplCatIsDescendant(_uplCatDragId, targetId)) {
      if (typeof _uplShowToast === 'function') _uplShowToast('Cannot nest a catalog inside its own child.', true);
      _uplCatDragId = null; return;
    }
    _uplCatalogMove(_uplCatDragId, targetId, false);
  } else {
    _uplCatMoveToSiblingOf(_uplCatDragId, targetId, intent === 'before');
  }
  _uplCatDragId = null;
}

// ── Move helpers ─────────────────────────────────────────────────────────────

function _uplCatalogMove(draggedId, newParentId, useRoot) {
  if (!_uplCatPid) return;
  var body = useRoot
    ? { move_to_root: true }
    : { parent_id: newParentId };
  fetch('/home/uploads/' + _uplCatPid + '/catalogs/' + draggedId, {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function(r) {
      if (r.status === 400) {
        if (typeof _uplShowToast === 'function') _uplShowToast('Cannot create a circular catalog structure.', true);
        return Promise.reject('circular');
      }
      return r.ok ? r.json() : Promise.reject(r.status);
    })
    .then(function() { _uplCatalogFetch(); })
    .catch(function(e) { if (e !== 'circular') console.error('[catalogs] move error', e); });
}

function _uplCatMoveToSiblingOf(draggedId, targetId, insertBefore) {
  if (!_uplCatPid) return;
  var target = null;
  _uplCatData.forEach(function(c) { if (c.id === targetId) target = c; });
  if (!target) return;

  var newParentId = target.parent_id;
  var siblings = _uplCatData.filter(function(c) {
    return c.id !== draggedId &&
           ((newParentId == null && c.parent_id == null) || c.parent_id === newParentId);
  }).sort(function(a, b) { return a.sort_order - b.sort_order; });

  var idx = -1;
  siblings.forEach(function(c, i) { if (c.id === targetId) idx = i; });
  if (idx === -1) return;

  var newOrder;
  if (insertBefore) {
    var prev = idx > 0 ? siblings[idx - 1].sort_order : (siblings[idx].sort_order - 20);
    var curr = siblings[idx].sort_order;
    newOrder = Math.floor((prev + curr) / 2);
    if (newOrder === prev || newOrder === curr) {
      newOrder = _uplCatGapCollapse(siblings, draggedId, idx, newParentId, true);
      return;
    }
  } else {
    var curr2 = siblings[idx].sort_order;
    var next  = idx < siblings.length - 1 ? siblings[idx + 1].sort_order : (curr2 + 20);
    newOrder  = Math.floor((curr2 + next) / 2);
    if (newOrder === curr2 || newOrder === next) {
      newOrder = _uplCatGapCollapse(siblings, draggedId, idx, newParentId, false);
      return;
    }
  }

  var body = newParentId === null
    ? { move_to_root: true, sort_order: newOrder }
    : { parent_id: newParentId, sort_order: newOrder };

  fetch('/home/uploads/' + _uplCatPid + '/catalogs/' + draggedId, {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() { _uplCatalogFetch(); })
    .catch(function(e) { console.error('[catalogs] reorder error', e); });
}

function _uplCatGapCollapse(siblings, draggedId, targetIdx, parentId, insertBefore) {
  var base = 0;
  siblings.forEach(function(c, i) {
    var order = base + i * 10;
    fetch('/home/uploads/' + _uplCatPid + '/catalogs/' + c.id, {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: order }),
    });
    base = order;
  });
  var slotIdx = insertBefore ? targetIdx : targetIdx + 1;
  var newOrder = base + slotIdx * 10 + 5;
  var body = parentId === null
    ? { move_to_root: true, sort_order: newOrder }
    : { parent_id: parentId, sort_order: newOrder };
  fetch('/home/uploads/' + _uplCatPid + '/catalogs/' + draggedId, {
    method: 'PATCH', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() { _uplCatalogFetch(); })
    .catch(function(e) { console.error('[catalogs] gap-collapse error', e); });
}

function _uplCatIsDescendant(dragId, candidateParentId) {
  if (candidateParentId === null || candidateParentId === undefined) return false;
  if (candidateParentId === dragId) return true;
  var visited = {};
  var current = candidateParentId;
  var byId = {};
  _uplCatData.forEach(function(c) { byId[c.id] = c; });
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

// ── Detail panel — catalog badges ───────────────────────────────────────────

function _uplRenderDetailCatalogs(f) {
  var container = document.getElementById('upl-detail-catalogs');
  if (!container || !f || f.src !== 'page') return;

  container.innerHTML = '<p class="text-[10px] text-gray-400 dark:text-zinc-500 italic">Loading catalogs\u2026</p>';

  fetch('/home/uploads/' + (f.page_id || _uplCatPid) + '/files/page/' + f.id + '/catalogs', {
    credentials: 'same-origin',
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(data) {
      var fileCats  = data.catalogs || [];
      var allCats   = _uplCatData;
      if (!container.isConnected) return;

      var html = '<div class="mt-1">'
        + '<p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-zinc-500 mb-1.5">Catalogs</p>';

      // Badges for assigned catalogs
      if (fileCats.length === 0) {
        html += '<p class="text-[10px] text-gray-400 dark:text-zinc-500 italic mb-2">None</p>';
      } else {
        html += '<div class="flex flex-wrap gap-1 mb-2">';
        fileCats.forEach(function(cat) {
          html += '<span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-300 border border-blue-200 dark:border-blue-800">'
            + _uplCatEsc(cat.name)
            + '<button class="ml-0.5 hover:text-red-500 transition leading-none"'
            + ' onclick="_uplCatRemoveFile(' + cat.id + ',' + f.id + ',' + (f.page_id || _uplCatPid) + ')"'
            + ' aria-label="Remove from ' + _uplCatEsc(cat.name) + '">&times;</button>'
            + '</span>';
        });
        html += '</div>';
      }

      // Add-to-catalog dropdown (only show catalogs not yet assigned)
      var assignedIds = {};
      fileCats.forEach(function(cat) { assignedIds[cat.id] = true; });
      var available = allCats.filter(function(c) { return !assignedIds[c.id]; });

      if (available.length > 0) {
        html += '<div class="flex gap-1">'
          + '<select id="upl-cat-add-sel" class="flex-1 text-[10px] border border-gray-300 dark:border-zinc-600 rounded-lg px-2 py-1 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-[#0053e2]">';

        // Build indented option list
        var byParent2 = { '__root__': [] };
        available.forEach(function(c) {
          var k = (c.parent_id === null || c.parent_id === undefined) ? '__root__' : String(c.parent_id);
          if (!byParent2[k]) byParent2[k] = [];
          byParent2[k].push(c);
        });

        function _renderOpts(parentKey, depth) {
          var kids = (byParent2[parentKey] || []).slice().sort(function(a, b) { return a.sort_order - b.sort_order || a.name.localeCompare(b.name); });
          kids.forEach(function(c) {
            html += '<option value="' + c.id + '">' + '\u2014'.repeat(depth) + (depth ? ' ' : '') + _uplCatEsc(c.name) + '</option>';
            _renderOpts(String(c.id), depth + 1);
          });
        }
        _renderOpts('__root__', 0);

        html += '</select>'
          + '<button onclick="_uplCatAddFile(document.getElementById(\'upl-cat-add-sel\').value,' + f.id + ',' + (f.page_id || _uplCatPid) + ')"'
          + ' class="px-2 py-1 text-[10px] rounded-lg bg-[#0053e2] text-white hover:bg-[#003eb3] transition whitespace-nowrap">+ Add</button>'
          + '</div>';
      }

      html += '</div>';
      container.innerHTML = html;
    })
    .catch(function(e) {
      if (container.isConnected) container.innerHTML = '';
      console.error('[catalogs] detail fetch error', e);
    });
}

function _uplCatAddFile(catalogId, uploadId, pageId) {
  catalogId = parseInt(catalogId, 10);
  if (!catalogId || !uploadId) return;
  fetch('/home/uploads/' + (pageId || _uplCatPid) + '/catalogs/' + catalogId + '/files', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_id: uploadId }),
  })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() {
      // Re-render detail catalog panel with the file object we know
      var f = typeof _uplCurrentDetail !== 'undefined' ? _uplCurrentDetail : null;
      if (f && f.id === uploadId) _uplRenderDetailCatalogs(f);
    })
    .catch(function(e) { console.error('[catalogs] add file error', e); });
}

function _uplCatRemoveFile(catalogId, uploadId, pageId) {
  fetch('/home/uploads/' + (pageId || _uplCatPid) + '/catalogs/' + catalogId + '/files/' + uploadId, {
    method: 'DELETE', credentials: 'same-origin',
  })
    .then(function(r) {
      if (!r.ok) return Promise.reject(r.status);
      var f = typeof _uplCurrentDetail !== 'undefined' ? _uplCurrentDetail : null;
      if (f && f.id === uploadId) _uplRenderDetailCatalogs(f);
    })
    .catch(function(e) { console.error('[catalogs] remove file error', e); });
}
