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

// Quick-Assign Drawer state
var _tripAssignDrawerOpen = false;   // is the drawer currently visible?
var _tripAssignDays       = [];      // days fetched by drawer (owned separately from _tripDays)

// Touch DnD fallback state
var _tripTouchMode      = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
var _tripSelectedSpotId = 0;         // spot id selected for tap-assign; 0 = none

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
  _tripAssignDrawerOpen     = false;
  _tripAssignDays           = [];
  _tripAssignSelectedPlanId = null;
  _tripSelectedSpotId       = 0;
  // Re-seed _TRIP_TYPES: base list + custom cats saved for this trip.
  // Rebuild the array IN PLACE so the window._TRIP_TYPES reference stays valid.
  try {
    var _cckKey    = 'trip_custom_cats_' + pid;
    var _cckStored = JSON.parse(localStorage.getItem(_cckKey) || '[]');
    _TRIP_TYPES.length = 0;
    ['Restaurant','Hotel','Camping','Hiking','City Attraction','Beach','Museum'].forEach(function(t) {
      _TRIP_TYPES.push(t);
    });
    _cckStored.forEach(function(c) {
      if (c && _TRIP_TYPES.indexOf(c) === -1) _TRIP_TYPES.push(c);
    });
    _TRIP_TYPES.push('Other');
  } catch(e) {}
  tripSetTab('research');
  // Load locations — pass true so sessionStorage drill-in is restored exactly once
  if (typeof tripLoadLocations === 'function') tripLoadLocations(true);
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
  // Close the Quick-Assign drawer when leaving the research tab
  if (tab !== 'research') {
    _tripAssignDrawerOpen = false;
    _tripAssignDays       = [];
    var _adr = document.getElementById('trip-assign-drawer');
    if (_adr) _adr.classList.add('hidden');
  }
  // Slider only belongs in the Day lanes view (inside a trip).
  // tripOpenPlan / tripClosePlan own its visibility — always hide on tab switch.
  var sizeWrap = document.getElementById('trip-day-size-wrap');
  if (sizeWrap) { sizeWrap.classList.add('hidden'); sizeWrap.classList.remove('flex'); }
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
      // Inside a location — show search + add spot (Assign to Days is in the filter bar)
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
      // Top-level locations view — search + add
      el.innerHTML =
        '<input id="trip-search" type="search" placeholder="Search locations…" ' +
          'oninput="tripSearchLoc()" ' +
          'value="' + (typeof _locQuery !== 'undefined' ? _locQuery : '').replace(/"/g, '&quot;') + '" ' +
          'class="px-3 py-1.5 text-sm rounded-lg border border-gray-200 ' +
                 'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
                 'text-gray-800 dark:text-zinc-100 focus:outline-none ' +
                 'focus:ring-2 focus:ring-[#0053e2]/40 w-36">' +
        '<button onclick="tripOpenAddLoc()" ' +
          'class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
                 'bg-[#0053e2] hover:bg-[#0046c0] text-white font-medium transition">' +
          '＋ Add Location</button>';
    }
  } else if (_tripTab === 'plan') {
    if (window._tripActivePlanId) {
      // Inside a trip — show Add Day
      el.innerHTML =
        '<button onclick="tripOpenAddDay()" ' +
          'class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
                 'bg-[#0053e2] hover:bg-[#0046c0] text-white font-medium transition">' +
          '＋ Add Day</button>';
    } else {
      // Top-level trip cards — show Add Trip
      el.innerHTML =
        '<button onclick="tripOpenAddPlan()" ' +
          'class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
                 'bg-[#0053e2] hover:bg-[#0046c0] text-white font-medium transition">' +
          '＋ Add Trip</button>';
    }
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


// ── Research: spot card grid (groups from _tripApplySpotOps) ────────────────
function _tripRenderResearch() {
  var grid = document.getElementById('trip-spots-grid');
  if (!grid) return;
  var groups = (typeof _tripApplySpotOps === 'function')
    ? _tripApplySpotOps(_tripSpots)
    : [{groupLabel: null, items: _tripSpots}];
  var totalVisible = groups.reduce(function(n, g) { return n + g.items.length; }, 0);
  if (!totalVisible) {
    grid.innerHTML =
      '<div class="col-span-full text-center py-16 text-gray-400 dark:text-zinc-500 text-sm">' +
        (_tripSpots.length
          ? '🔍 No spots match the filter.'
          : '📍 No spots in this location yet.<br>' +
            '<span class="text-xs">Click <strong>＋ Add Spot</strong> to start!</span>') +
      '</div>';
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
    html += g.items.map(_tripRenderSpotCard).join('');
  });
  grid.innerHTML = html;
};

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
  var attrs = (s.attrs && s.attrs.length)
    ? '<div class="flex flex-wrap gap-1 mt-0.5">' +
        s.attrs.slice(0, 3).map(function(a) {
          return '<span class="px-1.5 py-0.5 text-[10px] rounded-full ' +
            'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">' +
            _tripEsc(a.attr_key) + ': ' + _tripEsc(a.attr_value) + '</span>';
        }).join('') +
        (s.attrs.length > 3
          ? '<span class="px-1.5 py-0.5 text-[10px] rounded-full ' +
              'bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-500">+' +
              (s.attrs.length - 3) + '</span>'
          : '') +
      '</div>'
    : '';
  var cover = s.cover_url
    ? '<div class="h-40 bg-gray-100 dark:bg-zinc-800 overflow-hidden">' +
        '<img src="' + _tripEsc(s.cover_url) + '" alt="" ' +
          'class="w-full h-full object-cover" ' +
          'onerror="this.parentNode.style.display=\'none\'">' +
      '</div>'
    : '<div class="h-28 flex items-center justify-center bg-gradient-to-br ' +
        'from-blue-50 to-indigo-100 dark:from-zinc-800 dark:to-zinc-900 text-5xl ' +
        'select-none">' + emoji + '</div>';

  // Add-to-day section — only useful when a plan is open and has days loaded
  var daySection = '';
  if (typeof _tripDays !== 'undefined' && _tripDays.length) {
    var dayOpts = '<option value="">\u2014 pick a day \u2014</option>';
    _tripDays.forEach(function(d) {
      dayOpts += '<option value="' + d.id + '">' +
        _tripEsc(d.day_label || 'Day') + '</option>';
    });
    daySection =
      '<div class="flex items-center gap-1 mt-0.5">' +
        '<select id="trip-add-day-sel-' + s.id + '" ' +
          'class="flex-1 text-xs px-1.5 py-1.5 rounded-lg border border-gray-200 ' +
                 'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
                 'text-gray-700 dark:text-zinc-200 focus:outline-none">' +
          dayOpts +
        '</select>' +
        '<button onclick="tripAddSpotToDay(' + s.id + ')" ' +
          'class="px-3 py-1.5 text-xs rounded-lg bg-[#0053e2] text-white ' +
                 'hover:bg-[#0046c0] transition font-medium">＋ Day</button>' +
      '</div>';
  } else if (typeof window._tripActivePlanId !== 'undefined' && window._tripActivePlanId) {
    daySection =
      '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5 italic">' +
        'No days yet — add days in Plan tab</p>';
  } else {
    daySection =
      '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5 italic">' +
        'Open a trip in Plan tab to schedule</p>';
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
      attrs +
      '<div class="flex items-center gap-2 mt-auto pt-1">' +
        mapBtn +
        (_tripTouchMode
          ? '<button onclick="event.stopPropagation();tripSelectSpotForAssign(' + s.id + ')" ' +
              'class="text-xs ' +
              (_tripSelectedSpotId === s.id
                ? 'text-[#0053e2] font-bold'
                : 'text-gray-400 hover:text-[#0053e2]') +
              ' transition" title="Select for tap-assign">📌</button>'
          : '') +
        '<button onclick="event.stopPropagation();tripOpenEditSpot(' + s.id + ')" ' +
          'class="text-[10px] text-gray-400 hover:text-[#0053e2] transition ml-auto">✏️ Edit</button>' +
        '<button onclick="event.stopPropagation();tripConfirmDeleteSpot(' + s.id + ',' +
          '\'' + _tripEsc(s.name.replace(/'/g,'\\\'')) + '\')" ' +
          'class="text-[10px] text-gray-400 hover:text-red-500 transition">🗑️</button>' +
      '</div>' +
      daySection +
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

// tripSetTypeFilter, tripSearch, _tripRenderFilterBar live in home-page-trip-filters.js
window.tripSearch = function() {
  var el = document.getElementById('trip-search');
  _tripQuery = el ? el.value : '';
  if (typeof _tripRenderFilterBar === 'function') _tripRenderFilterBar();
  window._tripRenderResearch();
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
  // Detach format toolbar before hiding so listeners don’t accumulate on reopen
  var _ce = document.getElementById('tsf-notes-ce');
  if (_ce && typeof window.bwFmtDetach === 'function') window.bwFmtDetach(_ce);
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
  typeOpts += '<option value="custom"' + (isCustom ? ' selected' : '') + '>Custom category…</option>';

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
      '<label class="' + _lc() + '">Category</label>' +
      '<select id="tsf-type" onchange="tripSpotTypeChange()" class="' + _ic() + '">' +
        typeOpts + '</select>' +
    '</div>' +
    '<div id="tsf-custom-wrap" class="' + (isCustom ? '' : 'hidden') + '">' +
      '<label class="' + _lc() + '">Custom category</label>' +
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
    // Custom attributes (before Notes)
    '<div>' +
      '<label class="' + _lc() + '">Custom Attributes</label>' +
      '<div id="tsf-attrs-list" class="space-y-1.5">' +
        ((v.attrs || []).map(function(a, i) {
          return _tripSpotAttrRow(i, a.attr_key || '', a.attr_value || '');
        }).join('')) +
      '</div>' +
      '<button type="button" onclick="tripSpotAddAttrRow()" ' +
        'class="mt-2 text-xs text-[#0053e2] hover:underline">＋ Add attribute</button>' +
    '</div>' +
    // Notes (at the bottom, vertically resizable)
    '<div>' +
      '<label class="' + _lc() + '">Notes</label>' +
      // Mini WYSIWYG CE editor — slash commands (⁄), format toolbar, markdown round-trip
      '<div id="tsf-notes-ce" contenteditable="true" spellcheck="true" ' +
        'aria-label="Notes" aria-multiline="true" ' +
        'class="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 ' +
               'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
               'text-gray-800 dark:text-zinc-100 focus:outline-none ' +
               'focus:ring-2 focus:ring-[#0053e2]/40 overflow-y-auto cursor-text" ' +
        'style="min-height:80px;max-height:280px"></div>' +
    '</div>';

  document.getElementById('trip-spot-modal-body').innerHTML = html;
  _tripSpotNotesInit(v.notes || '');  // populate CE + wire slash & fmt
}

// ── Notes CE helpers ───────────────────────────────────────────────────────────────
// Load markdown into the CE on modal open, then wire slash commands + fmt toolbar.
function _tripSpotNotesInit(markdown) {
  var ce = document.getElementById('tsf-notes-ce');
  if (!ce) return;
  if (markdown && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    marked.use({ gfm: true, breaks: true });
    ce.innerHTML = DOMPurify.sanitize(marked.parse(markdown));
  } else {
    // Seed with a block element so the cursor lands inside a <p> on focus.
    // Without this, formatBlock (quote, headings) and insertHTML (code block)
    // operate on a bare text node at the CE root and fail silently in Chrome.
    // Mirrors _tripNoteInit in home-page-trip-plan.js.
    ce.innerHTML = '<p><br></p>';
  }
  if (typeof window.bwSlashAttachCE === 'function') window.bwSlashAttachCE(ce);
  if (typeof window.bwFmtAttach    === 'function') window.bwFmtAttach(ce);
  // Tab / Shift+Tab in a <li> → indent / dedent.
  // Guard against listener stacking when the modal is closed and reopened.
  if (ce._bwTabHandler) ce.removeEventListener('keydown', ce._bwTabHandler);
  ce._bwTabHandler = function(e) { if (typeof window._bwCeTabIndent === 'function') window._bwCeTabIndent(e); };
  ce.addEventListener('keydown', ce._bwTabHandler);
}

// Convert the CE’s HTML back to Markdown for persistence.
function _tripSpotNotesToMd() {
  var ce = document.getElementById('tsf-notes-ce');
  if (!ce) return '';
  if (typeof TurndownService === 'undefined') return ce.innerText || '';
  var td = new TurndownService({
    bulletListMarker: '-',
    headingStyle:     'atx',
    codeBlockStyle:   'fenced',
  });
  if (window.turndownPluginGfm) td.use(turndownPluginGfm.gfm);
  return td.turndown(ce.innerHTML).trimEnd();
}

window.tripSpotTypeChange = function() {
  var sel  = document.getElementById('tsf-type');
  var wrap = document.getElementById('tsf-custom-wrap');
  if (sel && wrap) wrap.classList.toggle('hidden', sel.value !== 'custom');
};

// Spot modal attr-row helpers
function _tripSpotAttrRow(idx, key, val) {
  return '<div class="flex gap-1.5 items-center" id="tsf-attr-row-' + idx + '">' +
    '<input type="text" placeholder="Attribute" value="' + _tripEsc(key) + '" ' +
      'data-sattr-key data-idx="' + idx + '" ' +
      'class="flex-1 px-2 py-1.5 text-xs rounded-lg border border-gray-200 ' +
             'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
             'text-gray-700 dark:text-zinc-200 focus:outline-none ' +
             'focus:ring-2 focus:ring-[#0053e2]/40">' +
    '<input type="text" placeholder="Value" value="' + _tripEsc(val) + '" ' +
      'data-sattr-val data-idx="' + idx + '" ' +
      'class="flex-1 px-2 py-1.5 text-xs rounded-lg border border-gray-200 ' +
             'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
             'text-gray-700 dark:text-zinc-200 focus:outline-none ' +
             'focus:ring-2 focus:ring-[#0053e2]/40">' +
    '<button type="button" onclick="tripSpotRemoveAttrRow(' + idx + ')" ' +
      'class="text-gray-300 hover:text-red-500 transition text-sm px-1">✕</button>' +
  '</div>';
}

window.tripSpotAddAttrRow = function() {
  var list = document.getElementById('tsf-attrs-list');
  if (!list) return;
  var idx = list.children.length;
  var div = document.createElement('div');
  div.innerHTML = _tripSpotAttrRow(idx, '', '');
  list.appendChild(div.firstChild);
};

window.tripSpotRemoveAttrRow = function(idx) {
  var row = document.getElementById('tsf-attr-row-' + idx);
  if (row) row.remove();
};

function _tripSpotCollectAttrs() {
  var list   = document.getElementById('tsf-attrs-list');
  var attrs  = [];
  if (!list) return attrs;
  var keyEls = list.querySelectorAll('[data-sattr-key]');
  var valEls = list.querySelectorAll('[data-sattr-val]');
  for (var i = 0; i < keyEls.length; i++) {
    var k = (keyEls[i].value || '').trim();
    var v = valEls[i] ? valEls[i].value : '';
    if (k) attrs.push({attr_key: k, attr_value: v});
  }
  return attrs;
}

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
  var notes    = _tripSpotNotesToMd();
  var priority = parseInt((document.getElementById('tsf-priority') || {}).value || '3', 10);
  var cost     = parseFloat((document.getElementById('tsf-cost')   || {}).value || '0') || 0;
  var currency = (document.getElementById('tsf-currency')   || {}).value || 'USD';

  if (!name.trim()) { _tripShowToast('Name is required', true); return; }
  // Register new custom category so it appears in Budget + Settle Up pickers immediately
  if (spotType === 'custom' && custom.trim()) window._tripAddCustomCat(custom.trim());

  var attrs = _tripSpotCollectAttrs();
  var fd = new URLSearchParams();
  fd.append('attrs',            JSON.stringify(attrs));
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

// ── Quick-Assign Drawer ────────────────────────────────────────────────────────────────────────────
window.tripToggleAssignDrawer = function() {
  _tripAssignDrawerOpen = !_tripAssignDrawerOpen;
  var drawer = document.getElementById('trip-assign-drawer');
  if (drawer) drawer.classList.toggle('hidden', !_tripAssignDrawerOpen);
  _tripRenderFilterBar();   // re-renders filter bar so the Assign button updates its active state
  window._tripRenderAssignDrawer();
};

window._tripRenderAssignDrawer = function() {
  var inner = document.getElementById('trip-assign-drawer-inner');
  if (!inner) return;

  // Effective plan: Plan tab's active plan takes priority over drawer-local pick
  var effectivePlanId = window._tripActivePlanId || _tripAssignSelectedPlanId;

  if (!effectivePlanId) {
    // No plan active anywhere — show a plan picker
    inner.innerHTML =
      '<p class="text-[10px] text-gray-400 dark:text-zinc-500 font-medium mb-1.5">Pick a plan to assign spots to:</p>' +
      '<div id="trip-assign-plan-list" class="flex flex-wrap gap-1.5">' +
        '<span class="text-[10px] text-gray-400 italic">Loading plans…</span>' +
      '</div>';
    _tripAssignFetchPlans();
    return;
  }

  // Prefer _tripDays (Plan tab state) when it belongs to the effective plan;
  // otherwise fall back to our own fetch cache.
  var days = (typeof _tripDays !== 'undefined' && _tripDays.length &&
              window._tripActivePlanId === effectivePlanId)
    ? _tripDays
    : _tripAssignDays;

  if (!days.length) {
    inner.innerHTML =
      '<p class="text-xs text-gray-400 dark:text-zinc-500 italic py-2">Loading days…</p>';
    window._tripAssignLoadDays(effectivePlanId);
    return;
  }

  // ─ Header: plan name + “switch plan” button (full-width row)
  var headerHtml =
    '<div class="flex items-center gap-2 w-full flex-shrink-0">' +
      '<span class="text-[10px] text-gray-400 dark:text-zinc-500 font-medium uppercase tracking-wide">Plan:</span>' +
      '<span id="trip-assign-plan-name" class="text-[10px] font-semibold text-gray-700 dark:text-zinc-200 truncate flex-1">…</span>' +
      '<button onclick="tripAssignClearPlan()" ' +
        'class="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg ' +
               'bg-[#0053e2] text-white text-xs font-semibold ' +
               'hover:bg-blue-700 active:bg-blue-800 transition ' +
               'min-h-[2rem] touch-manipulation">' +
        '↺ Switch Plan' +
      '</button>' +
    '</div>';

  // ─ Chips row: horizontally scrollable, chips stay on one line
  var chipsHtml = '<div class="flex items-center gap-2 overflow-x-auto pb-0.5" style="min-width:0;">';
  days.forEach(function(d) {
    chipsHtml +=
      '<div id="trip-assign-chip-' + d.id + '" ' +
        'onclick="tripAssignChipTap(event,' + d.id + ')" ' +
        'ondragover="tripAssignDragOver(event)" ' +
        'ondragleave="tripAssignDragLeave(event)" ' +
        'ondrop="tripAssignDrop(event,' + d.id + ')" ' +
        'class="flex-shrink-0 flex flex-col items-center justify-center gap-0.5 ' +
               'px-3 py-2 rounded-xl border-2 border-dashed border-gray-300 ' +
               'dark:border-zinc-600 bg-white dark:bg-zinc-800 text-center ' +
               'select-none transition" ' +
        'style="min-width:5.5rem; max-width:7rem; cursor:pointer;">' +
        '<span class="text-xs font-semibold text-gray-700 dark:text-zinc-200 ' +
               'truncate w-full text-center">' +
          _tripEsc(d.day_label || 'Day') +
        '</span>' +
        (d.day_date
          ? '<span class="text-[10px] text-gray-400 da-zinc-500">' +
              _tripEsc(d.day_date) + '</span>'
          : '') +
        '<span class="text-[10px] text-[#0053e2]">' +
          (_tripTouchMode ? '👆 Tap' : 'Drop ↓') +
        '</span>' +
      '</div>';
  });
  chipsHtml += '</div>';

  inner.innerHTML = headerHtml + chipsHtml;

  // Fill in plan name from cache (async if needed)
  _tripAssignFillPlanName(effectivePlanId);
};

window._tripAssignLoadDays = function(planId) {
  var pid = planId || window._tripActivePlanId || _tripAssignSelectedPlanId;
  if (!pid) return;
  _tripFetch('/home/trip/' + _tripPid + '/days?plan_id=' + pid)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _tripAssignDays = Array.isArray(data) ? data : [];
      window._tripRenderAssignDrawer();
    })
    .catch(function() {
      var inner = document.getElementById('trip-assign-drawer-inner');
      if (inner) {
        inner.innerHTML =
          '<p class="text-xs text-red-500 italic py-2">Failed to load days.</p>';
      }
    });
};

// Fetch all plans for this trip page and render as selectable chips
function _tripAssignFetchPlans() {
  _tripFetch('/home/trip/' + _tripPid + '/plans')
    .then(function(r) { return r.json(); })
    .then(function(plans) {
      window._tripAssignPlanCache = Array.isArray(plans) ? plans : [];
      var list = document.getElementById('trip-assign-plan-list');
      if (!list) return;
      if (!window._tripAssignPlanCache.length) {
        list.innerHTML =
          '<p class="text-[10px] text-gray-400 dark:text-zinc-500 italic">No plans found for this trip.</p>';
        return;
      }
      list.innerHTML = window._tripAssignPlanCache.map(function(pl) {
        return '<button onclick="tripAssignSelectPlan(' + pl.id + ')" ' +
          'class="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 ' +
                 'dark:border-zinc-600 bg-white dark:bg-zinc-800 ' +
                 'text-gray-700 dark:text-zinc-200 ' +
                 'hover:border-[#0053e2] hover:text-[#0053e2] dark:hover:text-blue-400 ' +
                 'transition cursor-pointer">' +
          _tripEsc(pl.plan_name || 'Plan') +
        '</button>';
      }).join('');
    })
    .catch(function() {
      var list = document.getElementById('trip-assign-plan-list');
      if (list) list.innerHTML =
        '<p class="text-[10px] text-red-500 italic">Failed to load plans.</p>';
    });
}

// Fill the active plan name label from cache; re-fetches once if not cached yet
function _tripAssignFillPlanName(planId) {
  var nameEl = document.getElementById('trip-assign-plan-name');
  if (!nameEl) return;
  var cache = window._tripAssignPlanCache || [];
  for (var i = 0; i < cache.length; i++) {
    if (cache[i].id === planId) { nameEl.textContent = cache[i].plan_name || 'Plan'; return; }
  }
  // Not in cache yet — fetch plans to warm the cache, then fill
  _tripFetch('/home/trip/' + _tripPid + '/plans')
    .then(function(r) { return r.json(); })
    .then(function(plans) {
      window._tripAssignPlanCache = Array.isArray(plans) ? plans : [];
      for (var i = 0; i < window._tripAssignPlanCache.length; i++) {
        if (window._tripAssignPlanCache[i].id === planId) {
          var el = document.getElementById('trip-assign-plan-name');
          if (el) el.textContent = window._tripAssignPlanCache[i].plan_name || 'Plan';
          break;
        }
      }
    }).catch(function() {});
}

window.tripAssignSelectPlan = function(planId) {
  _tripAssignSelectedPlanId = planId;
  _tripAssignDays = [];          // clear stale cache so fresh days are fetched
  window._tripRenderAssignDrawer();
};

window.tripAssignClearPlan = function() {
  _tripAssignSelectedPlanId = null;
  _tripAssignDays = [];
  window._tripRenderAssignDrawer();
};

window.tripAssignDragOver = function(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  var el = event.currentTarget;
  el.style.outline    = '2px solid #0053e2';
  el.style.background = 'rgba(0,83,226,0.06)';
};

window.tripAssignDragLeave = function(event) {
  var el = event.currentTarget;
  el.style.outline    = '';
  el.style.background = '';
};

window.tripAssignDrop = function(event, dayId) {
  event.preventDefault();
  event.stopPropagation();
  var el = event.currentTarget;
  el.style.outline    = '';
  el.style.background = '';
  var spotId = parseInt(event.dataTransfer.getData('bw-spot-id'), 10);
  if (!spotId) return;
  _tripFetch('/home/trip/' + _tripPid + '/days/' + dayId + '/spots/' + spotId, {
    method: 'POST',
    body: new URLSearchParams({time_label: ''}),
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.error) { _tripShowToast(d.error || 'Could not add spot', true); return; }
    // Brief flash on the chip to confirm
    var chip = document.getElementById('trip-assign-chip-' + dayId);
    if (chip) {
      chip.style.background = 'rgba(0,83,226,0.12)';
      setTimeout(function() { if (chip) chip.style.background = ''; }, 800);
    }
    _tripShowToast('✅ Added to day!');
    // NOTE: do NOT call tripLoadPlan() here — it would re-render the Plan tab
    // DOM and wipe #trip-topbar-controls while the user is still on Research.
    // The Plan tab refreshes its own state the next time it is activated.
  })
  .catch(function() { _tripShowToast('Drop failed', true); });
};

// ── Touch-mode tap-select flow ───────────────────────────────────────────────────────
window.tripSelectSpotForAssign = function(spotId) {
  _tripSelectedSpotId = (_tripSelectedSpotId === spotId) ? 0 : spotId;
  _tripRenderResearch();   // re-render cards to update 📌 active state
  _tripShowToast(
    _tripSelectedSpotId
      ? '📌 Spot selected — tap a day chip in the Assign drawer'
      : 'Spot deselected'
  );
};

window.tripAssignChipTap = function(event, dayId) {
  // On desktop this fires too, but drag-drop already handles it;
  // skip if this is the end of a drag operation (no selectedSpotId set)
  if (!_tripSelectedSpotId) {
    if (!_tripTouchMode) return;  // desktop: silently ignore chip click
    _tripShowToast('Select a spot first (📌 button on the card)', true);
    return;
  }
  var spotId = _tripSelectedSpotId;
  _tripFetch('/home/trip/' + _tripPid + '/days/' + dayId + '/spots/' + spotId, {
    method: 'POST',
    body: new URLSearchParams({time_label: ''}),
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.error) { _tripShowToast(d.error || 'Could not add spot', true); return; }
    _tripSelectedSpotId = 0;
    var chip = document.getElementById('trip-assign-chip-' + dayId);
    if (chip) {
      chip.style.background = 'rgba(0,83,226,0.12)';
      setTimeout(function() { if (chip) chip.style.background = ''; }, 800);
    }
    _tripShowToast('✅ Added to day!');
    _tripRenderResearch();          // update 📌 button active state
    window._tripRenderAssignDrawer(); // clear selection hint
  })
  .catch(function() { _tripShowToast('Tap-assign failed', true); });
};

// ── Drag source (spot card → day lane) ────────────────────────────────────────────
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
  if (!wrap) { return; }
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
window._tripChartColors    = _TRIP_CHART_COLORS;
window._tripTypeColor      = _tripTypeColor;
window._TRIP_TYPE_EMOJI    = _TRIP_TYPE_EMOJI;
window._TRIP_TYPES         = _TRIP_TYPES;   // shared with settle + budget panel category pickers

// Register a custom category across all pickers in this session.
// Inserts before 'Other', persists to localStorage, adds a default emoji.
window._tripAddCustomCat = function(catName) {
  catName = (catName || '').trim();
  if (!catName || _TRIP_TYPES.indexOf(catName) >= 0) return;
  var otherIdx = _TRIP_TYPES.indexOf('Other');
  if (otherIdx >= 0) { _TRIP_TYPES.splice(otherIdx, 0, catName); }
  else               { _TRIP_TYPES.push(catName); }
  if (!_TRIP_TYPE_EMOJI[catName]) _TRIP_TYPE_EMOJI[catName] = '📌';
  try {
    var key    = 'trip_custom_cats_' + _tripPid;
    var stored = JSON.parse(localStorage.getItem(key) || '[]');
    if (stored.indexOf(catName) === -1) {
      stored.push(catName);
      localStorage.setItem(key, JSON.stringify(stored));
    }
  } catch(e) {}
};
