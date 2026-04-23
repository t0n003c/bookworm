/**
 * home-page-trip.js — Trip Planning core module.
 * Handles: tab switching, shared utils, spot state + CRUD, spot modal (updated layout).
 * Location layer: home-page-trip-locs.js
 * Plan tab:  home-page-trip-plan.js
 * Chart tab: home-page-trip-chart.js
 * All state: var only (safe for HTMX re-injection).
 * Entry: initTripPage(pid) called by _initSwappedPage() in home-widgets.js.
 */

// ── Module state ──────────────────────────────────────────────────────────────
var _tripPid        = 0;
var _tripSpots      = [];
var _tripTab        = 'research';
var _tripTypeFilter = null;
var _tripQuery      = '';
var _tripEditingId  = null;   // null = adding, int = editing
var _tripSpotUploadedCoverUrl = '';   // set by upload-cover endpoint

var _TRIP_TYPES = [
  'Restaurant', 'Hotel', 'Camping', 'Hiking',
  'City Attraction', 'Beach', 'Museum', 'Other'
];

var _TRIP_TYPE_EMOJI = {
  'Restaurant':      '🍽️',
  'Hotel':           '🏨',
  'Camping':         '⛺',
  'Hiking':          '🥾',
  'City Attraction': '🏛️',
  'Beach':           '🏖️',
  'Museum':          '🖼️',
  'Other':           '📍',
};

var _TRIP_CHART_COLORS = [
  '#0053e2','#ffc220','#2a8703','#ea1100',
  '#7c3aed','#0891b2','#d97706','#db2777'
];

// ── Entry ─────────────────────────────────────────────────────────────────────
window.initTripPage = function(pid) {
  _tripPid                  = pid;
  _tripSpots                = [];
  _tripTab                  = 'research';
  _tripTypeFilter           = null;
  _tripQuery                = '';
  _tripEditingId            = null;
  _tripSpotUploadedCoverUrl = '';
  tripSetTab('research');
  // Load locations (top level of Research tab)
  if (typeof tripLoadLocations === 'function') tripLoadLocations();
};

// ── Tab switching ─────────────────────────────────────────────────────────────
window.tripSetTab = function(tab) {
  _tripTab = tab;
  ['research','plan','chart'].forEach(function(t) {
    var panel = document.getElementById('trip-panel-' + t);
    var btn   = document.getElementById('trip-tab-' + t);
    if (!panel || !btn) return;
    var active = t === tab;
    panel.classList.toggle('hidden', !active);
    if (active) {
      btn.classList.add('bg-white','dark:bg-zinc-700','text-gray-800',
                        'dark:text-zinc-100','shadow-sm');
      btn.classList.remove('text-gray-500','dark:text-zinc-400',
                           'hover:text-gray-700','dark:hover:text-zinc-200');
    } else {
      btn.classList.remove('bg-white','dark:bg-zinc-700','text-gray-800',
                           'dark:text-zinc-100','shadow-sm');
      btn.classList.add('text-gray-500','dark:text-zinc-400',
                        'hover:text-gray-700','dark:hover:text-zinc-200');
    }
  });
  _tripRenderTopbarControls();
  if (tab === 'plan'  && typeof tripLoadPlan  === 'function') tripLoadPlan();
  if (tab === 'chart' && typeof tripLoadChart === 'function') tripLoadChart();
};

// Exposed so locs.js can call it after view changes
window._tripRenderTopbarControls = function() {
  var el = document.getElementById('trip-topbar-controls');
  if (!el) return;
  var inLoc = !!(window._tripActiveLocId);
  if (_tripTab === 'research') {
    if (inLoc) {
      // Inside a location — show search + add spot
      el.innerHTML =
        '<input id="trip-search" type="search" placeholder="Search spots…" ' +
          'oninput="tripSearch()" ' +
          'class="px-3 py-1.5 text-sm rounded-lg border border-gray-200 ' +
                 'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
                 'text-gray-800 dark:text-zinc-100 focus:outline-none ' +
                 'focus:ring-2 focus:ring-[#0053e2]/40 w-36">' +
        '<button onclick="tripOpenAddSpot()" ' +
          'class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
                 'bg-[#0053e2] hover:bg-[#0046c0] text-white font-medium transition">' +
          '＋ Add Spot</button>';
    } else {
      // Top-level locations view
      el.innerHTML =
        '<button onclick="tripOpenAddLoc()" ' +
          'class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
                 'bg-[#0053e2] hover:bg-[#0046c0] text-white font-medium transition">' +
          '＋ Add Location</button>';
    }
  } else if (_tripTab === 'plan') {
    el.innerHTML =
      '<button onclick="tripOpenAddDay()" ' +
        'class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
               'bg-[#0053e2] hover:bg-[#0046c0] text-white font-medium transition">' +
        '＋ Add Day</button>';
  } else {
    el.innerHTML = '';
  }
};

function _tripRenderTopbarControls() { window._tripRenderTopbarControls(); }

// ── Research: load spots for a specific location ──────────────────────────────
window._tripLoadSpots = function(locId) {
  var url = '/home/trip/' + _tripPid + '/spots?location_id=' + (locId || 0);
  _tripFetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _tripSpots      = Array.isArray(data) ? data : [];
      _tripTypeFilter = null;
      _tripQuery      = '';
      _tripRenderFilterBar();
      _tripRenderResearch();
    })
    .catch(function() { _tripShowToast('Failed to load spots', true); });
};

function _tripLoadSpots(locId) { window._tripLoadSpots(locId); }

// ── Filter bar (inside a location) ───────────────────────────────────────────
function _tripRenderFilterBar() {
  var bar = document.getElementById('trip-filter-bar');
  if (!bar) return;
  var loc  = window._tripActiveLoc;
  var locName = loc ? loc.name : 'Location';
  // Breadcrumb
  var html =
    '<button onclick="tripCloseLocView()" ' +
      'class="flex items-center gap-1 text-xs font-semibold text-[#0053e2] ' +
             'hover:underline whitespace-nowrap">' +
      '← All Locations</button>' +
    '<span class="text-gray-300 dark:text-zinc-600 text-xs">|</span>' +
    '<span class="text-xs text-gray-600 dark:text-zinc-300 font-medium truncate max-w-32">' +
      _tripEsc(locName) + '</span>';

  // Type filter pills (only types that exist in this location's spots)
  var present = {};
  _tripSpots.forEach(function(s) { present[s.spot_type] = true; });
  var types = Object.keys(present).sort();
  if (types.length) {
    html += '<span class="text-gray-300 dark:text-zinc-600 text-xs">|</span>';
    html += '<button onclick="tripSetTypeFilter(null)" ' +
      'class="trip-pill px-2.5 py-1 rounded-full text-xs font-medium transition ' +
      (_tripTypeFilter === null
        ? 'bg-[#0053e2] text-white'
        : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 ' +
          'hover:bg-gray-200 dark:hover:bg-zinc-700') + '">All</button>';
    types.forEach(function(t) {
      var active = _tripTypeFilter === t;
      html += '<button onclick="tripSetTypeFilter(\'' + _tripEsc(t) + '\')" ' +
        'class="trip-pill px-2.5 py-1 rounded-full text-xs font-medium transition ' +
        (active
          ? 'bg-[#0053e2] text-white'
          : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 ' +
            'hover:bg-gray-200 dark:hover:bg-zinc-700') + '">' +
        (_TRIP_TYPE_EMOJI[t] || '📍') + ' ' + _tripEsc(t) + '</button>';
    });
  }
  bar.innerHTML = html;
}

// ── Research: spot card grid ──────────────────────────────────────────────────
function _tripRenderResearch() {
  var grid = document.getElementById('trip-spots-grid');
  if (!grid) return;
  var q = _tripQuery.toLowerCase();
  var filtered = _tripSpots.filter(function(s) {
    if (_tripTypeFilter && s.spot_type !== _tripTypeFilter) return false;
    if (q && s.name.toLowerCase().indexOf(q) === -1 &&
             (s.notes || '').toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  if (!filtered.length) {
    grid.innerHTML =
      '<div class="col-span-full text-center py-16 text-gray-400 dark:text-zinc-500 text-sm">' +
        (_tripSpots.length
          ? '🔍 No spots match the filter.'
          : '📍 No spots in this location yet.<br>' +
            '<span class="text-xs">Click <strong>＋ Add Spot</strong> to start!</span>') +
      '</div>';
    return;
  }
  grid.innerHTML = filtered.map(_tripRenderSpotCard).join('');
}

function _tripRenderSpotCard(s) {
  var emoji  = _TRIP_TYPE_EMOJI[s.spot_type] || '📍';
  var stars  = _tripStars(s.priority, s.id);
  var cost   = s.estimated_cost > 0
    ? '<span class="text-xs text-gray-500 dark:text-zinc-400">' +
        _tripEsc(s.currency) + ' ' + Number(s.estimated_cost).toFixed(2) + '</span>'
    : '';
  var mapBtn = s.map_url
    ? '<a href="' + _tripEsc(s.map_url) + '" target="_blank" rel="noopener noreferrer" ' +
        'onclick="event.stopPropagation()" ' +
        'class="text-[10px] text-[#0053e2] hover:underline">📍 Map</a>'
    : '';
  var cover = s.cover_url
    ? '<div class="h-32 bg-gray-100 dark:bg-zinc-800 overflow-hidden">' +
        '<img src="' + _tripEsc(s.cover_url) + '" alt="" ' +
          'class="w-full h-full object-cover" ' +
          'onerror="this.parentNode.style.display=\'none\'">' +
      '</div>'
    : '<div class="h-20 flex items-center justify-center bg-gray-50 ' +
        'dark:bg-zinc-800 text-3xl">' + emoji + '</div>';

  // Add-to-day dropdown using days from the plan module if loaded
  var dayOpts = '<option value="">— pick a day —</option>';
  if (typeof _tripDays !== 'undefined' && _tripDays.length) {
    _tripDays.forEach(function(d) {
      dayOpts += '<option value="' + d.id + '">' +
        _tripEsc(d.day_label || 'Day') + '</option>';
    });
  }

  return '<div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 ' +
    'dark:border-zinc-800 overflow-hidden shadow-sm hover:shadow-md transition ' +
    'flex flex-col group" ' +
    'draggable="true" ' +
    'ondragstart="tripDragSpotStart(event,' + s.id + ')" ' +
    'ondragend="tripDragSpotEnd(event)">' +
    cover +
    '<div class="p-3 flex flex-col gap-1.5 flex-1">' +
      '<div class="flex items-start justify-between gap-1">' +
        '<p class="text-sm font-semibold text-gray-800 dark:text-zinc-100 leading-tight truncate">' +
          _tripEsc(s.name) + '</p>' +
        '<span class="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ' +
               'text-white whitespace-nowrap" ' +
               'style="background:' + _tripTypeColor(s.spot_type) + '">' +
          emoji + ' ' + _tripEsc(s.spot_type) + '</span>' +
      '</div>' +
      '<div class="flex items-center gap-1">' + stars + cost + '</div>' +
      (s.notes
        ? '<p class="text-[11px] text-gray-500 dark:text-zinc-400 line-clamp-2">' +
            _tripEsc(s.notes) + '</p>'
        : '') +
      '<div class="flex items-center gap-2 mt-auto pt-1">' +
        mapBtn +
        '<button onclick="event.stopPropagation();tripOpenEditSpot(' + s.id + ')" ' +
          'class="text-[10px] text-gray-400 hover:text-[#0053e2] transition ml-auto">✏️ Edit</button>' +
        '<button onclick="event.stopPropagation();tripConfirmDeleteSpot(' + s.id + ',' +
          '\'' + _tripEsc(s.name.replace(/'/g,'\\\'')) + '\')" ' +
          'class="text-[10px] text-gray-400 hover:text-red-500 transition">🗑️</button>' +
      '</div>' +
      '<div class="flex items-center gap-1 mt-0.5">' +
        '<select id="trip-add-day-sel-' + s.id + '" ' +
          'class="flex-1 text-[10px] px-1.5 py-1 rounded-lg border border-gray-200 ' +
                 'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
                 'text-gray-700 dark:text-zinc-200 focus:outline-none">' +
          dayOpts +
        '</select>' +
        '<button onclick="tripAddSpotToDay(' + s.id + ')" ' +
          'class="px-2 py-1 text-[10px] rounded-lg bg-[#0053e2] text-white ' +
                 'hover:bg-[#0046c0] transition font-medium">＋ Day</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function _tripStars(priority, spotId) {
  var html = '<span class="flex items-center gap-0 text-sm leading-none">';
  for (var i = 1; i <= 5; i++) {
    html += '<button onclick="event.stopPropagation();tripSetStarPriority(' + spotId + ',' + i + ')" ' +
      'class="transition ' +
      (i <= priority ? 'text-[#ffc220]' : 'text-gray-300 dark:text-zinc-600') +
      ' hover:text-[#ffc220]" title="Priority ' + i + '">★</button>';
  }
  return html + '</span>';
}

function _tripTypeColor(spotType) {
  var idx = _TRIP_TYPES.indexOf(spotType);
  return _TRIP_CHART_COLORS[
    (idx >= 0 ? idx : _TRIP_TYPES.length - 1) % _TRIP_CHART_COLORS.length
  ];
}

// ── Public: filter / search ───────────────────────────────────────────────────
window.tripSetTypeFilter = function(type) {
  _tripTypeFilter = type;
  _tripRenderFilterBar();
  _tripRenderResearch();
};

window.tripSearch = function() {
  var el = document.getElementById('trip-search');
  _tripQuery = el ? el.value : '';
  _tripRenderResearch();
};

// ── Add spot to day (from spot card) ─────────────────────────────────────────
window.tripAddSpotToDay = function(spotId) {
  var sel   = document.getElementById('trip-add-day-sel-' + spotId);
  var dayId = sel ? parseInt(sel.value, 10) : 0;
  if (!dayId) return;
  _tripFetch('/home/trip/' + _tripPid + '/days/' + dayId + '/spots/' + spotId, {
    method: 'POST', body: new URLSearchParams({time_label: ''}),
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok && typeof tripLoadPlan === 'function') {
      _tripShowToast('Added to day!');
      tripLoadPlan();
    }
  }).catch(function() { _tripShowToast('Failed to add to day', true); });
};

// ── Inline star priority ──────────────────────────────────────────────────────
window.tripSetStarPriority = function(spotId, priority) {
  var fd = new URLSearchParams();
  fd.append('priority', priority);
  _tripFetch('/home/trip/' + _tripPid + '/spots/' + spotId + '/priority', {
    method: 'PATCH', body: fd,
  }).then(function(r) { return r.json(); }).then(function() {
    _tripSpots.forEach(function(s) { if (s.id === spotId) s.priority = priority; });
    _tripRenderResearch();
  }).catch(function() { _tripShowToast('Failed to save priority', true); });
};

// ── Spot modal ────────────────────────────────────────────────────────────────
window.tripOpenAddSpot = function() {
  _tripEditingId            = null;
  _tripSpotUploadedCoverUrl = '';
  document.getElementById('trip-spot-modal-title').textContent = 'Add Spot';
  document.getElementById('trip-spot-submit').textContent = 'Add Spot';
  _tripRenderSpotForm({});
  document.getElementById('trip-spot-modal').classList.remove('hidden');
};

window.tripOpenEditSpot = function(id) {
  var s = _tripSpots.find(function(x) { return x.id === id; });
  if (!s) return;
  _tripEditingId            = id;
  _tripSpotUploadedCoverUrl = '';
  document.getElementById('trip-spot-modal-title').textContent = 'Edit Spot';
  document.getElementById('trip-spot-submit').textContent = 'Save Changes';
  _tripRenderSpotForm(s);
  document.getElementById('trip-spot-modal').classList.remove('hidden');
};

window.tripCloseSpotModal = function() {
  document.getElementById('trip-spot-modal').classList.add('hidden');
  _tripEditingId            = null;
  _tripSpotUploadedCoverUrl = '';
};

function _ic() {  // input class shorthand
  return 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 ' +
         'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
         'text-gray-800 dark:text-zinc-100 focus:outline-none ' +
         'focus:ring-2 focus:ring-[#0053e2]/40';
}
function _lc() {  // label class shorthand
  return 'block text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1';
}

function _tripRenderSpotForm(v) {
  var typeOpts = _TRIP_TYPES.map(function(t) {
    return '<option value="' + t + '"' + (v.spot_type === t ? ' selected' : '') + '>' + t + '</option>';
  }).join('');
  var isCustom = v.spot_type && _TRIP_TYPES.indexOf(v.spot_type) === -1;
  typeOpts += '<option value="custom"' + (isCustom ? ' selected' : '') + '>Other (custom…)</option>';

  var currentCover = (v.cover_url || '').trim();
  var coverPreview = currentCover
    ? '<img id="tsf-cover-preview" src="' + _tripEsc(currentCover) + '" alt="" ' +
        'class="w-full h-24 object-cover rounded-lg mb-2 border border-gray-200 ' +
               'dark:border-zinc-700" onerror="this.style.display=\'none\'">'
    : '<div id="tsf-cover-preview" class="hidden"></div>';

  // Layout (Notes at bottom; Currency inline with Est. Cost)
  var html =
    // Name
    '<div>' +
      '<label class="' + _lc() + '">Spot Name *</label>' +
      '<input id="tsf-name" type="text" value="' + _tripEsc(v.name || '') + '" ' +
        'placeholder="e.g. Clingmans Dome" class="' + _ic() + '">' +
    '</div>' +
    // Type
    '<div>' +
      '<label class="' + _lc() + '">Type</label>' +
      '<select id="tsf-type" onchange="tripSpotTypeChange()" class="' + _ic() + '">' +
        typeOpts + '</select>' +
    '</div>' +
    '<div id="tsf-custom-wrap" class="' + (isCustom ? '' : 'hidden') + '">' +
      '<label class="' + _lc() + '">Custom type</label>' +
      '<input id="tsf-type-custom" type="text" ' +
        'value="' + _tripEsc(isCustom ? v.spot_type : '') + '" ' +
        'placeholder="e.g. Winery" class="' + _ic() + '">' +
    '</div>' +
    // Priority
    '<div>' +
      '<label class="' + _lc() + '">Priority (stars)</label>' +
      '<select id="tsf-priority" class="' + _ic() + '">' +
        [1,2,3,4,5].map(function(n) {
          return '<option value="' + n + '"' +
            ((v.priority || 3) === n ? ' selected' : '') + '>' +
            '★'.repeat(n) + '☆'.repeat(5 - n) + '</option>';
        }).join('') +
      '</select>' +
    '</div>' +
    // Est. Cost + Currency (inline, 2-col)
    '<div class="grid grid-cols-2 gap-3">' +
      '<div>' +
        '<label class="' + _lc() + '">Est. Cost</label>' +
        '<input id="tsf-cost" type="number" min="0" step="0.01" ' +
          'value="' + (v.estimated_cost || 0) + '" class="' + _ic() + '">' +
      '</div>' +
      '<div>' +
        '<label class="' + _lc() + '">Currency</label>' +
        '<input id="tsf-currency" type="text" value="' + _tripEsc(v.currency || 'USD') + '" ' +
          'placeholder="USD" maxlength="3" style="text-transform:uppercase" ' +
          'class="' + _ic() + '">' +
      '</div>' +
    '</div>' +
    // Map link
    '<div>' +
      '<label class="' + _lc() + '">Map Link</label>' +
      '<input id="tsf-map" type="url" value="' + _tripEsc(v.map_url || '') + '" ' +
        'placeholder="Google Maps URL" class="' + _ic() + '">' +
    '</div>' +
    // Cover image: URL or Upload
    '<div>' +
      '<label class="' + _lc() + '">Cover Image</label>' +
      coverPreview +
      '<div class="flex gap-1 mb-2 bg-gray-100 dark:bg-zinc-800 rounded-lg p-0.5 w-fit">' +
        '<button type="button" id="tsf-tab-url" onclick="tripSpotCoverTab(\'url\')" ' +
          'class="px-3 py-1 text-xs rounded-md font-medium transition ' +
          'bg-white dark:bg-zinc-700 text-gray-800 shadow-sm">🔗 URL</button>' +
        '<button type="button" id="tsf-tab-file" onclick="tripSpotCoverTab(\'file\')" ' +
          'class="px-3 py-1 text-xs rounded-md font-medium transition ' +
          'text-gray-500 dark:text-zinc-400 hover:text-gray-700">📁 Upload</button>' +
      '</div>' +
      '<div id="tsf-cover-url-wrap">' +
        '<input id="tsf-cover-url" type="url" value="' + _tripEsc(currentCover) + '" ' +
          'placeholder="https://…" class="' + _ic() + '">' +
      '</div>' +
      '<div id="tsf-cover-file-wrap" class="hidden">' +
        '<input id="tsf-cover-file" type="file" accept="image/*" ' +
          'onchange="tripSpotUploadCover()" ' +
          'class="block w-full text-sm text-gray-500 dark:text-zinc-400 ' +
                 'file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 ' +
                 'file:text-sm file:font-medium file:bg-[#0053e2] file:text-white ' +
                 'file:cursor-pointer hover:file:bg-[#0046c0]">' +
        '<p id="tsf-upload-status" class="text-[10px] text-gray-400 mt-1"></p>' +
      '</div>' +
    '</div>' +
    // Notes (at the bottom, vertically resizable)
    '<div>' +
      '<label class="' + _lc() + '">Notes</label>' +
      '<textarea id="tsf-notes" rows="4" placeholder="Tips, must-try items, notes…" ' +
        'class="' + _ic() + ' resize-y min-h-[80px]">' +
        _tripEsc(v.notes || '') +
      '</textarea>' +
    '</div>';

  document.getElementById('trip-spot-modal-body').innerHTML = html;
}

window.tripSpotTypeChange = function() {
  var sel  = document.getElementById('tsf-type');
  var wrap = document.getElementById('tsf-custom-wrap');
  if (sel && wrap) wrap.classList.toggle('hidden', sel.value !== 'custom');
};

// Cover tab toggle (spot modal)
window.tripSpotCoverTab = function(tab) {
  var urlWrap  = document.getElementById('tsf-cover-url-wrap');
  var fileWrap = document.getElementById('tsf-cover-file-wrap');
  var btnUrl   = document.getElementById('tsf-tab-url');
  var btnFile  = document.getElementById('tsf-tab-file');
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

// Immediate upload on file pick (spot cover)
window.tripSpotUploadCover = function() {
  var fileInput = document.getElementById('tsf-cover-file');
  var status    = document.getElementById('tsf-upload-status');
  if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
  if (!_tripEditingId) {
    if (status) status.textContent = 'Save the spot first, then upload a cover image.';
    return;
  }
  if (status) status.textContent = 'Uploading…';
  var fd = new FormData();
  fd.append('file', fileInput.files[0]);
  _tripFetch('/home/trip/' + _tripPid + '/spots/' + _tripEditingId + '/upload-cover', {
    method: 'POST', body: fd,
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { if (status) status.textContent = d.error; return; }
      _tripSpotUploadedCoverUrl = d.url;
      if (status) status.textContent = '✅ Uploaded!';
      var preview = document.getElementById('tsf-cover-preview');
      if (preview) {
        preview.src = d.url;
        preview.style.display = '';
        preview.classList.remove('hidden');
      }
    })
    .catch(function() { if (status) status.textContent = 'Upload failed'; });
};

window.tripSubmitSpot = function() {
  var name     = (document.getElementById('tsf-name')        || {}).value || '';
  var spotType = (document.getElementById('tsf-type')        || {}).value || 'Other';
  var custom   = (document.getElementById('tsf-type-custom') || {}).value || '';
  var coverUrl = _tripSpotUploadedCoverUrl ||
                 (document.getElementById('tsf-cover-url') || {}).value || '';
  var mapUrl   = (document.getElementById('tsf-map')         || {}).value || '';
  var notes    = (document.getElementById('tsf-notes')       || {}).value || '';
  var priority = parseInt((document.getElementById('tsf-priority') || {}).value || '3', 10);
  var cost     = parseFloat((document.getElementById('tsf-cost')   || {}).value || '0') || 0;
  var currency = (document.getElementById('tsf-currency')   || {}).value || 'USD';

  if (!name.trim()) { _tripShowToast('Name is required', true); return; }

  var fd = new URLSearchParams();
  fd.append('name',             name.trim());
  fd.append('spot_type',        spotType);
  fd.append('spot_type_custom', custom.trim());
  fd.append('cover_url',        coverUrl.trim());
  fd.append('map_url',          mapUrl.trim());
  fd.append('notes',            notes.trim());
  fd.append('priority',         Math.max(1, Math.min(5, priority)));
  fd.append('estimated_cost',   Math.max(0, cost));
  fd.append('currency',         (currency.trim().toUpperCase() || 'USD'));
  fd.append('location_id',      window._tripActiveLocId || 0);

  var url    = _tripEditingId
    ? '/home/trip/' + _tripPid + '/spots/' + _tripEditingId
    : '/home/trip/' + _tripPid + '/spots/add';
  var method = _tripEditingId ? 'PUT' : 'POST';

  var btn = document.getElementById('trip-spot-submit');
  if (btn) btn.disabled = true;
  _tripFetch(url, {method: method, body: fd})
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { _tripShowToast(d.error, true); return; }
      tripCloseSpotModal();
      _tripLoadSpots(window._tripActiveLocId);
      _tripShowToast(_tripEditingId ? 'Spot updated!' : 'Spot added!');
    })
    .catch(function() { _tripShowToast('Save failed', true); })
    .finally(function() { if (btn) btn.disabled = false; });
};

// ── Delete spot ───────────────────────────────────────────────────────────────
window.tripConfirmDeleteSpot = function(id, name) {
  var msg = document.getElementById('trip-del-msg');
  var btn = document.getElementById('trip-del-confirm');
  if (msg) msg.textContent = 'Delete "' + name + '"? It will also be removed from all day plans.';
  if (btn) btn.onclick = function() { tripDeleteSpot(id); };
  document.getElementById('trip-del-modal').classList.remove('hidden');
};

window.tripCloseDelModal = function() {
  document.getElementById('trip-del-modal').classList.add('hidden');
};

window.tripDeleteSpot = function(id) {
  tripCloseDelModal();
  _tripFetch('/home/trip/' + _tripPid + '/spots/' + id, {method: 'DELETE'})
    .then(function(r) { return r.json(); })
    .then(function() {
      _tripLoadSpots(window._tripActiveLocId);
      if (typeof tripLoadPlan === 'function') tripLoadPlan();
      _tripShowToast('Spot deleted');
    })
    .catch(function() { _tripShowToast('Delete failed', true); });
};

// ── Drag source (spot card → day lane) ────────────────────────────────────────
window.tripDragSpotStart = function(event, spotId) {
  event.dataTransfer.setData('bw-spot-id', String(spotId));
  event.dataTransfer.effectAllowed = 'copy';
  var el = event.currentTarget;
  setTimeout(function() { if (el) el.style.opacity = '0.5'; }, 0);
};

window.tripDragSpotEnd = function(event) {
  if (event.currentTarget) event.currentTarget.style.opacity = '';
};

// ── Shared utilities (used by all trip-*.js modules) ─────────────────────────
window._tripEsc = function(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
};
function _tripEsc(s) { return window._tripEsc(s); }

window._tripFetch = function(url, opts) {
  return fetch(url, opts || {}).then(function(r) {
    if (r.status === 401) { location.href = '/login'; throw new Error('401'); }
    return r;
  });
};
function _tripFetch(url, opts) { return window._tripFetch(url, opts); }

window._tripShowToast = function(msg, isErr) {
  var wrap = document.getElementById('rem-fun-popup-wrap') ||
             document.querySelector('[data-toast-wrap]');
  if (!wrap) { console.log('[Trip]', msg); return; }
  var el = document.createElement('div');
  el.className = 'pointer-events-auto px-4 py-2 rounded-xl shadow-lg text-sm font-medium ' +
    'border animate-[bw-slideup_.3s_ease_both] ' +
    (isErr
      ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
      : 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-700 text-gray-800 dark:text-zinc-100');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(function() { el.remove(); }, 3000);
};
function _tripShowToast(msg, isErr) { window._tripShowToast(msg, isErr); }

// Expose for chart + plan modules
window._tripChartColors = _TRIP_CHART_COLORS;
window._tripTypeColor   = _tripTypeColor;
window._TRIP_TYPE_EMOJI = _TRIP_TYPE_EMOJI;
