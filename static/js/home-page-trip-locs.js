/**
 * home-page-trip-locs.js — Location layer for Trip Research tab.
 * Depends on: _tripPid, _tripFetch, _tripShowToast, _tripEsc (home-page-trip.js).
 * All state: var only.
 *
 * Two-level navigation:
 *   Locations grid  →  click card  →  Spots view (spots for that location)
 *   Spots view      →  "← Back"   →  Locations grid
 */

// ── Module state ──────────────────────────────────────────────────────────────
var _tripLocations   = [];
var _tripActiveLocId = null;   // null = top level (location grid shown)
var _tripActiveLoc   = null;   // full location object when drilling in
var _tripLocEditing  = null;   // null = add, int = edit loc id

// Expose to other modules (spots need to know active loc)
window._tripLocations   = _tripLocations;
window._tripActiveLocId = null;
window._tripActiveLoc   = null;

// ── Entry: called from initTripPage() in home-page-trip.js ───────────────────
// Pass restoreSession=true only on initial page load so session state is
// restored exactly once.  Subsequent calls (e.g. from tripCloseLocView) should
// NOT restore — that caused a race condition where the user's click got
// overridden by a stale sessionStorage key.
window.tripLoadLocations = function(restoreSession) {
  _tripFetch('/home/trip/' + _tripPid + '/locations')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _tripLocations = Array.isArray(data) ? data : [];
      window._tripLocations = _tripLocations;
      if (restoreSession) {
        var savedKey = 'bw-trip-loc-' + _tripPid;
        var savedId  = sessionStorage.getItem(savedKey);
        if (savedId) {
          var restoredId = parseInt(savedId, 10);
          var found = _tripLocations.find(function(l) { return l.id === restoredId; });
          if (found) { tripOpenLoc(restoredId); return; }
          // Stale key (location deleted) — clean up silently
          try { sessionStorage.removeItem(savedKey); } catch(e) {}
        }
      }
      _tripRenderLocGrid();
    })
    .catch(function() { _tripShowToast('Failed to load locations', true); });
};

// ── View switching (locations ↔ spots) ────────────────────────────────────────
window.tripOpenLoc = function(locId) {
  var loc = _tripLocations.find(function(l) { return l.id === locId; });
  if (!loc) return;
  _tripActiveLocId          = locId;
  _tripActiveLoc            = loc;
  window._tripActiveLocId   = locId;
  window._tripActiveLoc     = loc;
  // Persist so a page refresh restores this view
  try { sessionStorage.setItem('bw-trip-loc-' + _tripPid, locId); } catch(e) {}

  var locsView  = document.getElementById('trip-locs-view');
  var spotsView = document.getElementById('trip-spots-view');
  if (locsView)  locsView.classList.add('hidden');
  if (spotsView) spotsView.classList.remove('hidden');

  // Tell the topbar to re-render with "+ Add Spot"
  if (typeof _tripRenderTopbarControls === 'function') _tripRenderTopbarControls();
  // Load spots for this location
  if (typeof _tripLoadSpots === 'function') _tripLoadSpots(locId);
};

window.tripCloseLocView = function() {
  _tripActiveLocId          = null;
  _tripActiveLoc            = null;
  window._tripActiveLocId   = null;
  window._tripActiveLoc     = null;
  try { sessionStorage.removeItem('bw-trip-loc-' + _tripPid); } catch(e) {}

  var locsView  = document.getElementById('trip-locs-view');
  var spotsView = document.getElementById('trip-spots-view');
  if (locsView)  locsView.classList.remove('hidden');
  if (spotsView) spotsView.classList.add('hidden');

  // Reset Quick-Assign drawer so it starts closed on next location open
  _tripAssignDrawerOpen     = false;
  _tripAssignDays           = [];
  _tripAssignSelectedPlanId = null;
  var _adr = document.getElementById('trip-assign-drawer');
  if (_adr) _adr.classList.add('hidden');

  if (typeof _tripRenderTopbarControls === 'function') _tripRenderTopbarControls();
  // Refresh locations in case a spot count changed
  tripLoadLocations();
};

// ── Render location grid ────────────────────────────────────────────────────
function _tripRenderLocGrid() {
  // Sync filter bar first
  if (typeof window._tripRenderLocFilterBar === 'function') window._tripRenderLocFilterBar();

  var grid = document.getElementById('trip-locs-grid');
  if (!grid) return;
  if (!_tripLocations.length) {
    grid.innerHTML =
      '<div class="col-span-full text-center py-20 text-gray-400 dark:text-zinc-500 text-sm">' +
        '📍 No locations yet.<br>' +
        '<span class="text-xs mt-1 block">Click <strong>＋ Add Location</strong> to start!</span>' +
      '</div>';
    return;
  }

  var groups = (typeof _tripApplyLocOps === 'function')
    ? _tripApplyLocOps(_tripLocations)
    : [{groupLabel: null, items: _tripLocations}];

  var totalVisible = groups.reduce(function(n, g) { return n + g.items.length; }, 0);
  if (!totalVisible) {
    grid.innerHTML =
      '<div class="col-span-full text-center py-20 text-gray-400 dark:text-zinc-500 text-sm">' +
        '🔍 No locations match the filter.</div>';
    return;
  }

  var html = '';
  groups.forEach(function(g) {
    if (g.groupLabel) {
      html += '<div class="col-span-full text-xs font-semibold text-gray-500 ' +
        'dark:text-zinc-400 uppercase tracking-wide pt-2 pb-0.5 border-b ' +
        'border-gray-100 dark:border-zinc-800">' +
        _tripEsc(g.groupLabel) + ' <span class="font-normal normal-case">(' + g.items.length + ')</span>' +
        '</div>';
    }
    html += g.items.map(_tripRenderLocCard).join('');
  });
  grid.innerHTML = html;
}

function _tripRenderLocCard(loc) {
  var stars = _tripLocStars(loc.priority, loc.id);
  var attrs = loc.attrs && loc.attrs.length
    ? '<div class="flex flex-wrap gap-1 mt-1">' +
        loc.attrs.slice(0, 4).map(function(a) {
          return '<span class="px-1.5 py-0.5 text-[10px] rounded-full ' +
            'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">' +
            _tripEsc(a.attr_key) + ': ' + _tripEsc(a.attr_value) + '</span>';
        }).join('') +
        (loc.attrs.length > 4
          ? '<span class="px-1.5 py-0.5 text-[10px] rounded-full ' +
              'bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-500">' +
              '+' + (loc.attrs.length - 4) + ' more</span>'
          : '') +
      '</div>'
    : '';
  var cover = loc.cover_url
    ? '<div class="h-40 bg-gray-100 dark:bg-zinc-800 overflow-hidden">' +
        '<img src="' + _tripEsc(loc.cover_url) + '" alt="" ' +
          'class="w-full h-full object-cover" ' +
          'onerror="this.parentNode.style.display=\'none\'">' +
      '</div>'
    : '<div class="h-28 flex items-center justify-center bg-gradient-to-br ' +
        'from-blue-50 to-indigo-100 dark:from-zinc-800 dark:to-zinc-900 text-5xl ' +
        'select-none">📍</div>';

  return '<div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 ' +
    'dark:border-zinc-800 overflow-hidden shadow-sm hover:shadow-md transition ' +
    'flex flex-col cursor-pointer group" ' +
    'onclick="tripOpenLoc(' + loc.id + ')">' +
    cover +
    '<div class="p-3 flex flex-col gap-1.5 flex-1">' +
      '<div class="flex items-start justify-between gap-2">' +
        '<p class="text-sm font-semibold text-gray-800 dark:text-zinc-100 leading-tight flex-1">' +
          _tripEsc(loc.name) + '</p>' +
        '<div class="flex gap-1 flex-shrink-0">' +
          '<button onclick="event.stopPropagation();tripOpenEditLoc(' + loc.id + ')" ' +
            'class="text-gray-300 hover:text-[#0053e2] transition text-xs ' +
                   'opacity-0 group-hover:opacity-100">✏️</button>' +
          '<button onclick="event.stopPropagation();tripConfirmDeleteLoc(' + loc.id + ',' +
            '\'' + _tripEsc((loc.name||'').replace(/'/g,'\\\'')) + '\')" ' +
            'class="text-gray-300 hover:text-red-500 transition text-xs ' +
                   'opacity-0 group-hover:opacity-100">🗑️</button>' +
        '</div>' +
      '</div>' +
      '<div class="flex items-center gap-1">' + stars + '</div>' +
      (loc.notes
        ? '<p class="text-[11px] text-gray-500 dark:text-zinc-400 line-clamp-2">' +
            _tripEsc(loc.notes) + '</p>'
        : '') +
      attrs +

    '</div>' +
  '</div>';
}

function _tripLocStars(priority, locId) {
  var html = '<span class="flex items-center gap-0 text-sm leading-none">';
  for (var i = 1; i <= 5; i++) {
    html += '<button onclick="event.stopPropagation();tripSetLocPriority(' + locId + ',' + i + ')" ' +
      'class="transition ' +
      (i <= priority ? 'text-[#ffc220]' : 'text-gray-300 dark:text-zinc-600') +
      ' hover:text-[#ffc220]" title="Priority ' + i + '">★</button>';
  }
  return html + '</span>';
}

window.tripSetLocPriority = function(locId, priority) {
  var loc = _tripLocations.find(function(l) { return l.id === locId; });
  if (!loc) return;
  var fd = new URLSearchParams();
  fd.append('name',      loc.name);
  fd.append('priority',  priority);
  fd.append('notes',     loc.notes || '');
  fd.append('cover_url', loc.cover_url || '');
  fd.append('attrs',     JSON.stringify(loc.attrs || []));
  _tripFetch('/home/trip/' + _tripPid + '/locations/' + locId, {method: 'PUT', body: fd})
    .then(function(r) { return r.json(); })
    .then(function() {
      loc.priority = priority;
      window._tripLocations = _tripLocations;
      _tripRenderLocGrid();
    })
    .catch(function() { _tripShowToast('Failed to save priority', true); });
};

// ── Location modal ────────────────────────────────────────────────────────────
var _tripLocUploadedCoverUrl = '';   // stores URL returned by upload-cover endpoint

window.tripOpenAddLoc = function() {
  _tripLocEditing          = null;
  _tripLocUploadedCoverUrl = '';
  document.getElementById('trip-loc-modal-title').textContent = 'Add Location';
  document.getElementById('trip-loc-submit').textContent = 'Add Location';
  _tripRenderLocForm({});
  document.getElementById('trip-loc-modal').classList.remove('hidden');
  setTimeout(function() {
    var el = document.getElementById('tlf-name');
    if (el) el.focus();
  }, 60);
};

window.tripOpenEditLoc = function(locId) {
  var loc = _tripLocations.find(function(l) { return l.id === locId; });
  if (!loc) return;
  _tripLocEditing          = locId;
  _tripLocUploadedCoverUrl = '';
  document.getElementById('trip-loc-modal-title').textContent = 'Edit Location';
  document.getElementById('trip-loc-submit').textContent = 'Save Changes';
  _tripRenderLocForm(loc);
  document.getElementById('trip-loc-modal').classList.remove('hidden');
};

window.tripCloseLocModal = function() {
  document.getElementById('trip-loc-modal').classList.add('hidden');
  _tripLocEditing          = null;
  _tripLocUploadedCoverUrl = '';
};

function _tripLocInputCls() {
  return 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 ' +
         'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
         'text-gray-800 dark:text-zinc-100 focus:outline-none ' +
         'focus:ring-2 focus:ring-[#0053e2]/40';
}

function _tripLocLabelCls() {
  return 'block text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1';
}

function _tripRenderLocForm(v) {
  var attrs = (v.attrs || []);
  var attrRows = attrs.map(function(a, i) {
    return _tripLocAttrRow(i, a.attr_key || '', a.attr_value || '');
  }).join('');

  // Cover image section: current preview + toggle URL / Upload
  var currentCover = (v.cover_url || '').trim();
  var coverPreview = currentCover
    ? '<img id="tlf-cover-preview" src="' + _tripEsc(currentCover) + '" alt="cover preview" ' +
        'class="w-full h-28 object-cover rounded-lg mb-2 border border-gray-200 ' +
               'dark:border-zinc-700" onerror="this.style.display=\'none\'">'
    : '<div id="tlf-cover-preview" class="hidden"></div>';

  var html =
    // Name
    '<div>' +
      '<label class="' + _tripLocLabelCls() + '">Location Name *</label>' +
      '<input id="tlf-name" type="text" value="' + _tripEsc(v.name || '') + '" ' +
        'placeholder="e.g. Smoky Mountains" class="' + _tripLocInputCls() + '">' +
    '</div>' +
    // Priority — big clickable stars
    '<div>' +
      '<label class="' + _tripLocLabelCls() + '">Priority</label>' +
      '<div class="flex items-center gap-0.5">' +
        [1,2,3,4,5].map(function(n) {
          var filled = n <= (v.priority || 3);
          return '<button type="button" id="tlf-pstar-' + n + '" ' +
            'onclick="tripLocSetPriorityModal(' + n + ')" ' +
            'class="text-3xl leading-none transition-transform hover:scale-125 active:scale-95 ' +
            (filled ? 'text-[#ffc220]' : 'text-gray-300 dark:text-zinc-600') + '" ' +
            'title="' + n + ' star' + (n > 1 ? 's' : '') + '">★</button>';
        }).join('') +
        '<span id="tlf-priority-label" ' +
          'class="ml-2 text-sm font-semibold text-gray-600 dark:text-zinc-300">' +
          (v.priority || 3) + '/5' +
        '</span>' +
      '</div>' +
      '<input type="hidden" id="tlf-priority" value="' + (v.priority || 3) + '">' +
    '</div>' +
    // Cover image: URL or Upload
    '<div>' +
      '<label class="' + _tripLocLabelCls() + '">Cover Image</label>' +
      coverPreview +
      '<div class="flex gap-1 mb-2 bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5 w-fit">' +
        '<button type="button" id="tlf-tab-url" onclick="tripLocCoverTab(\'url\')" ' +
          'class="px-3 py-1 text-xs rounded-md font-medium transition ' +
          'bg-white dark:bg-zinc-700 text-gray-800 dark:text-zinc-100 shadow-sm">🔗 URL</button>' +
        '<button type="button" id="tlf-tab-file" onclick="tripLocCoverTab(\'file\')" ' +
          'class="px-3 py-1 text-xs rounded-md font-medium transition ' +
          'text-gray-500 dark:text-zinc-400 hover:text-gray-700">📁 Upload</button>' +
      '</div>' +
      '<div id="tlf-cover-url-wrap">' +
        '<input id="tlf-cover-url" type="url" value="' + _tripEsc(currentCover) + '" ' +
          'placeholder="https://…" class="' + _tripLocInputCls() + '">' +
      '</div>' +
      '<div id="tlf-cover-file-wrap" class="hidden">' +
        '<input id="tlf-cover-file" type="file" accept="image/*" ' +
          'onchange="tripLocUploadCover()" ' +
          'class="block w-full text-sm text-gray-500 dark:text-zinc-400 ' +
                 'file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 ' +
                 'file:text-sm file:font-medium file:bg-[#0053e2] file:text-white ' +
                 'file:cursor-pointer hover:file:bg-[#0046c0]">' +
        '<p id="tlf-upload-status" class="text-[10px] text-gray-400 mt-1"></p>' +
      '</div>' +
    '</div>' +
    // Custom attributes
    '<div>' +
      '<label class="' + _tripLocLabelCls() + '">Custom Attributes</label>' +
      '<div id="tlf-attrs-list" class="space-y-1.5">' + attrRows + '</div>' +
      '<button type="button" onclick="tripLocAddAttrRow()" ' +
        'class="mt-2 text-xs text-[#0053e2] hover:underline">＋ Add attribute</button>' +
    '</div>' +
    // Notes (bottom)
    '<div>' +
      '<label class="' + _tripLocLabelCls() + '">Notes</label>' +
      '<textarea id="tlf-notes" rows="4" ' +
        'placeholder="Notes, tips, things to research…" ' +
        'class="' + _tripLocInputCls() + ' resize-y min-h-[80px]">' +
        _tripEsc(v.notes || '') +
      '</textarea>' +
    '</div>';
  document.getElementById('trip-loc-modal-body').innerHTML = html;
}

function _tripLocAttrRow(idx, key, val) {
  return '<div class="flex gap-1.5 items-center" id="tlf-attr-row-' + idx + '">' +
    '<input type="text" placeholder="Attribute" value="' + _tripEsc(key) + '" ' +
      'data-attr-key data-idx="' + idx + '" ' +
      'class="flex-1 px-2 py-1.5 text-xs rounded-lg border border-gray-200 ' +
             'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
             'text-gray-700 dark:text-zinc-200 focus:outline-none ' +
             'focus:ring-2 focus:ring-[#0053e2]/40">' +
    '<input type="text" placeholder="Value" value="' + _tripEsc(val) + '" ' +
      'data-attr-val data-idx="' + idx + '" ' +
      'class="flex-1 px-2 py-1.5 text-xs rounded-lg border border-gray-200 ' +
             'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
             'text-gray-700 dark:text-zinc-200 focus:outline-none ' +
             'focus:ring-2 focus:ring-[#0053e2]/40">' +
    '<button type="button" onclick="tripLocRemoveAttrRow(' + idx + ')" ' +
      'class="text-gray-300 hover:text-red-500 transition text-sm px-1">✕</button>' +
  '</div>';
}

window.tripLocAddAttrRow = function() {
  var list = document.getElementById('tlf-attrs-list');
  if (!list) return;
  var idx = list.children.length;
  var div = document.createElement('div');
  div.innerHTML = _tripLocAttrRow(idx, '', '');
  list.appendChild(div.firstChild);
};

window.tripLocRemoveAttrRow = function(idx) {
  var row = document.getElementById('tlf-attr-row-' + idx);
  if (row) row.remove();
};

// Star priority picker inside the modal
window.tripLocSetPriorityModal = function(n) {
  var input = document.getElementById('tlf-priority');
  var label = document.getElementById('tlf-priority-label');
  if (input) input.value = n;
  if (label) label.textContent = n + '/5';
  for (var i = 1; i <= 5; i++) {
    var star = document.getElementById('tlf-pstar-' + i);
    if (!star) continue;
    if (i <= n) {
      star.classList.add('text-[#ffc220]');
      star.classList.remove('text-gray-300', 'dark:text-zinc-600');
    } else {
      star.classList.remove('text-[#ffc220]');
      star.classList.add('text-gray-300', 'dark:text-zinc-600');
    }
  }
};

// Cover image tab toggle
window.tripLocCoverTab = function(tab) {
  var urlWrap  = document.getElementById('tlf-cover-url-wrap');
  var fileWrap = document.getElementById('tlf-cover-file-wrap');
  var btnUrl   = document.getElementById('tlf-tab-url');
  var btnFile  = document.getElementById('tlf-tab-file');
  if (!urlWrap || !fileWrap) return;
  var showUrl = tab === 'url';
  urlWrap.classList.toggle('hidden', !showUrl);
  fileWrap.classList.toggle('hidden', showUrl);
  if (showUrl) {
    btnUrl.classList.add('bg-white','dark:bg-zinc-700','text-gray-800','shadow-sm');
    btnUrl.classList.remove('text-gray-500','dark:text-zinc-400');
    btnFile.classList.remove('bg-white','dark:bg-zinc-700','text-gray-800','shadow-sm');
    btnFile.classList.add('text-gray-500','dark:text-zinc-400');
  } else {
    btnFile.classList.add('bg-white','dark:bg-zinc-700','text-gray-800','shadow-sm');
    btnFile.classList.remove('text-gray-500','dark:text-zinc-400');
    btnUrl.classList.remove('bg-white','dark:bg-zinc-700','text-gray-800','shadow-sm');
    btnUrl.classList.add('text-gray-500','dark:text-zinc-400');
  }
};

// Immediate upload on file select (returns URL, stored in _tripLocUploadedCoverUrl)
window.tripLocUploadCover = function() {
  var fileInput = document.getElementById('tlf-cover-file');
  var status    = document.getElementById('tlf-upload-status');
  if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
  if (!_tripLocEditing) {
    // No location id yet — must add the location first
    if (status) status.textContent = 'Save the location first, then upload a cover image.';
    return;
  }
  if (status) status.textContent = 'Uploading…';
  var fd = new FormData();
  fd.append('file', fileInput.files[0]);
  _tripFetch('/home/trip/' + _tripPid + '/locations/' + _tripLocEditing + '/upload-cover', {
    method: 'POST', body: fd,
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { if (status) status.textContent = d.error; return; }
      _tripLocUploadedCoverUrl = d.url;
      if (status) status.textContent = '✅ Uploaded!';
      var preview = document.getElementById('tlf-cover-preview');
      if (preview) {
        preview.src = d.url;
        preview.style.display = '';
        preview.classList.remove('hidden');
      }
    })
    .catch(function() { if (status) status.textContent = 'Upload failed'; });
};

function _tripLocCollectAttrs() {
  var list   = document.getElementById('tlf-attrs-list');
  var attrs  = [];
  if (!list) return attrs;
  var keyEls = list.querySelectorAll('[data-attr-key]');
  var valEls = list.querySelectorAll('[data-attr-val]');
  for (var i = 0; i < keyEls.length; i++) {
    var k = (keyEls[i].value || '').trim();
    var v = (valEls[i] ? valEls[i].value : '');
    if (k) attrs.push({attr_key: k, attr_value: v});
  }
  return attrs;
}

window.tripSubmitLoc = function() {
  var name     = (document.getElementById('tlf-name')     || {}).value || '';
  var priority = parseInt((document.getElementById('tlf-priority') || {}).value || '3', 10);
  var notes    = (document.getElementById('tlf-notes')    || {}).value || '';
  var coverUrl = _tripLocUploadedCoverUrl ||
                 (document.getElementById('tlf-cover-url') || {}).value || '';
  var attrs    = _tripLocCollectAttrs();

  if (!name.trim()) { _tripShowToast('Name is required', true); return; }

  var fd = new URLSearchParams();
  fd.append('name',      name.trim());
  fd.append('priority',  max(1, min(5, priority)));
  fd.append('notes',     notes.trim());
  fd.append('cover_url', coverUrl.trim());
  fd.append('attrs',     JSON.stringify(attrs));

  var url    = _tripLocEditing
    ? '/home/trip/' + _tripPid + '/locations/' + _tripLocEditing
    : '/home/trip/' + _tripPid + '/locations/add';
  var method = _tripLocEditing ? 'PUT' : 'POST';

  var btn = document.getElementById('trip-loc-submit');
  if (btn) btn.disabled = true;
  _tripFetch(url, {method: method, body: fd})
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { _tripShowToast(d.error, true); return; }
      tripCloseLocModal();
      tripLoadLocations();
      _tripShowToast(_tripLocEditing ? 'Location updated!' : 'Location added!');
    })
    .catch(function() { _tripShowToast('Save failed', true); })
    .finally(function() { if (btn) btn.disabled = false; });
};

// tiny helpers so we don't need global Math
function max(a, b) { return a > b ? a : b; }
function min(a, b) { return a < b ? a : b; }

// ── Delete location ───────────────────────────────────────────────────────────
window.tripConfirmDeleteLoc = function(locId, name) {
  var msg = document.getElementById('trip-del-msg');
  var btn = document.getElementById('trip-del-confirm');
  if (msg) msg.textContent = 'Delete "' + name + '"? Spots inside will lose their location link but won\'t be deleted.';
  if (btn) btn.onclick = function() { tripDeleteLoc(locId); };
  document.getElementById('trip-del-modal').classList.remove('hidden');
};

window.tripDeleteLoc = function(locId) {
  if (typeof tripCloseDelModal === 'function') tripCloseDelModal();
  _tripFetch('/home/trip/' + _tripPid + '/locations/' + locId, {method: 'DELETE'})
    .then(function(r) { return r.json(); })
    .then(function() { tripLoadLocations(); _tripShowToast('Location deleted'); })
    .catch(function() { _tripShowToast('Delete failed', true); });
};
