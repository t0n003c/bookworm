/**
 * home-page-trip.js — Trip Planning core module (Research tab + tab switching).
 * All state uses var (safe for repeated _initSwappedPage() calls — no re-declaration errors).
 * Entry: initTripPage(pid) called by _initSwappedPage() in home-widgets.js.
 */

// ── Module state ─────────────────────────────────────────────────────────────
var _tripPid        = 0;
var _tripSpots      = [];
var _tripTab        = 'research';
var _tripTypeFilter = null;
var _tripQuery      = '';
var _tripEditingId  = null;  // null = adding, int = editing

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

// ── Entry point ───────────────────────────────────────────────────────────────
window.initTripPage = function(pid) {
  _tripPid        = pid;
  _tripSpots      = [];
  _tripTab        = 'research';
  _tripTypeFilter = null;
  _tripQuery      = '';
  _tripEditingId  = null;
  _tripLoadSpots();
  tripSetTab('research');
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

function _tripRenderTopbarControls() {
  var el = document.getElementById('trip-topbar-controls');
  if (!el) return;
  if (_tripTab === 'research') {
    el.innerHTML =
      '<input id="trip-search" type="search" placeholder="Search spots…" oninput="tripSearch()" ' +
        'class="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 ' +
               'bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 ' +
               'focus:outline-none focus:ring-2 focus:ring-[#0053e2]/40 w-40">' +
      '<button onclick="tripOpenAddSpot()" ' +
        'class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
               'bg-[#0053e2] hover:bg-[#0046c0] text-white font-medium transition">' +
        '＋ Add Spot</button>';
  } else if (_tripTab === 'plan') {
    el.innerHTML =
      '<button onclick="tripOpenAddDay()" ' +
        'class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
               'bg-[#0053e2] hover:bg-[#0046c0] text-white font-medium transition">' +
        '＋ Add Day</button>';
  } else {
    el.innerHTML = '';
  }
}

// ── Research: load + render ───────────────────────────────────────────────────
function _tripLoadSpots() {
  _tripFetch('/home/trip/' + _tripPid + '/spots')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _tripSpots = Array.isArray(data) ? data : [];
      _tripRenderFilterBar();
      _tripRenderResearch();
    })
    .catch(function() { _tripShowToast('Failed to load spots', true); });
}

function _tripRenderFilterBar() {
  var bar = document.getElementById('trip-filter-bar');
  if (!bar) return;
  // Collect types present in spots
  var present = {};
  _tripSpots.forEach(function(s) { present[s.spot_type] = true; });
  var types = Object.keys(present).sort();
  var html = '<button onclick="tripSetTypeFilter(null)" ' +
    'class="trip-pill px-3 py-1 rounded-full text-xs font-medium transition ' +
    (_tripTypeFilter === null
      ? 'bg-[#0053e2] text-white'
      : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 ' +
        'hover:bg-gray-200 dark:hover:bg-zinc-700') + '">All</button>';
  types.forEach(function(t) {
    var active = _tripTypeFilter === t;
    html += '<button onclick="tripSetTypeFilter(\'' + _tripEsc(t) + '\')" ' +
      'class="trip-pill px-3 py-1 rounded-full text-xs font-medium transition ' +
      (active
        ? 'bg-[#0053e2] text-white'
        : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 ' +
          'hover:bg-gray-200 dark:hover:bg-zinc-700') + '">' +
      (_TRIP_TYPE_EMOJI[t] || '📍') + ' ' + _tripEsc(t) + '</button>';
  });
  bar.innerHTML = html;
}

function _tripRenderResearch() {
  var grid = document.getElementById('trip-spots-grid');
  if (!grid) return;
  var q = _tripQuery.toLowerCase();
  var filtered = _tripSpots.filter(function(s) {
    if (_tripTypeFilter && s.spot_type !== _tripTypeFilter) return false;
    if (q && s.name.toLowerCase().indexOf(q) === -1 &&
             s.notes.toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  if (!filtered.length) {
    grid.innerHTML = '<div class="col-span-full text-center py-16 text-gray-400 ' +
      'dark:text-zinc-500 text-sm">' +
      (_tripSpots.length ? '🔍 No spots match the filter.' :
        '✈️ No spots yet.<br>' +
        '<span class="text-xs">Click <strong>＋ Add Spot</strong> to start researching!</span>') +
      '</div>';
    return;
  }
  grid.innerHTML = filtered.map(function(s) { return _tripRenderSpotCard(s); }).join('');
}

function _tripRenderSpotCard(s) {
  var emoji  = _TRIP_TYPE_EMOJI[s.spot_type] || '📍';
  var stars  = _tripStars(s.priority, s.id);
  var cost   = s.estimated_cost > 0
    ? '<span class="text-xs text-gray-500 dark:text-zinc-400">' +
        _tripEsc(s.currency) + ' ' + s.estimated_cost.toFixed(2) + '</span>'
    : '';
  var mapBtn = s.map_url
    ? '<a href="' + _tripEsc(s.map_url) + '" target="_blank" rel="noopener noreferrer" ' +
        'onclick="event.stopPropagation()" ' +
        'class="text-[10px] text-[#0053e2] hover:underline">📍 Map</a>'
    : '';
  var cover = s.cover_url
    ? '<div class="h-32 bg-gray-100 dark:bg-zinc-800 overflow-hidden">' +
        '<img src="' + _tripEsc(s.cover_url) + '" alt="" ' +
          'class="w-full h-full object-cover" onerror="this.parentNode.style.display=\'none\'">' +
      '</div>'
    : '<div class="h-24 flex items-center justify-center bg-gray-50 dark:bg-zinc-800 ' +
        'text-4xl">' + emoji + '</div>';

  // Add-to-day dropdown options
  var dayOpts = '<option value="">— pick a day —</option>';
  if (typeof _tripDays !== 'undefined' && _tripDays.length) {
    _tripDays.forEach(function(d) {
      dayOpts += '<option value="' + d.id + '">' + _tripEsc(d.day_label || 'Day') + '</option>';
    });
  }
  var addToDayBtn =
    '<div class="flex items-center gap-1 mt-1">' +
      '<select id="trip-add-day-sel-' + s.id + '" ' +
        'class="flex-1 text-[10px] px-1.5 py-1 rounded-lg border border-gray-200 ' +
               'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
               'text-gray-700 dark:text-zinc-200 focus:outline-none">' +
        dayOpts +
      '</select>' +
      '<button onclick="tripAddSpotToDay(' + s.id + ')" ' +
        'class="px-2 py-1 text-[10px] rounded-lg bg-[#0053e2] text-white ' +
               'hover:bg-[#0046c0] transition font-medium">＋</button>' +
    '</div>';

  return '<div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 ' +
    'dark:border-zinc-800 overflow-hidden shadow-sm hover:shadow-md transition ' +
    'flex flex-col cursor-pointer group" ' +
    'draggable="true" ' +
    'ondragstart="tripDragSpotStart(event,' + s.id + ')" ' +
    'ondragend="tripDragSpotEnd(event)">' +
    cover +
    '<div class="p-3 flex flex-col gap-1.5 flex-1">' +
      '<div class="flex items-start justify-between gap-1">' +
        '<p class="text-sm font-semibold text-gray-800 dark:text-zinc-100 leading-tight ' +
           'truncate">' + _tripEsc(s.name) + '</p>' +
        '<span class="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ' +
               'text-white whitespace-nowrap" ' +
               'style="background:' + _tripTypeColor(s.spot_type) + '">' +
          emoji + ' ' + _tripEsc(s.spot_type) + '</span>' +
      '</div>' +
      '<div class="flex items-center gap-1">' + stars + cost + '</div>' +
      (s.notes ? '<p class="text-[11px] text-gray-500 dark:text-zinc-400 line-clamp-2">' +
        _tripEsc(s.notes) + '</p>' : '') +
      '<div class="flex items-center gap-2 mt-auto pt-1">' +
        mapBtn +
        '<button onclick="event.stopPropagation();tripOpenEditSpot(' + s.id + ')" ' +
          'class="text-[10px] text-gray-400 hover:text-[#0053e2] transition ml-auto">✏️ Edit</button>' +
        '<button onclick="event.stopPropagation();tripConfirmDeleteSpot(' + s.id + ',' +
          '\'' + _tripEsc(s.name.replace(/'/g,'\\\'')) + '\')" ' +
          'class="text-[10px] text-gray-400 hover:text-red-500 transition">🗑️</button>' +
      '</div>' +
      addToDayBtn +
    '</div>' +
  '</div>';
}

function _tripStars(priority, spotId) {
  var html = '<span class="flex items-center gap-0 text-sm leading-none">';
  for (var i = 1; i <= 5; i++) {
    var active = i <= priority;
    html += '<button onclick="event.stopPropagation();tripSetStarPriority(' + spotId + ',' + i + ')" ' +
      'class="transition ' + (active ? 'text-[#ffc220]' : 'text-gray-300 dark:text-zinc-600') +
      ' hover:text-[#ffc220]" title="Priority ' + i + '">★</button>';
  }
  html += '</span>';
  return html;
}

function _tripTypeColor(spotType) {
  var idx = _TRIP_TYPES.indexOf(spotType);
  return _TRIP_CHART_COLORS[(idx >= 0 ? idx : _TRIP_TYPES.length - 1) % _TRIP_CHART_COLORS.length];
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

// ── Public: Add-to-day from card dropdown ─────────────────────────────────────
window.tripAddSpotToDay = function(spotId) {
  var sel = document.getElementById('trip-add-day-sel-' + spotId);
  var dayId = sel ? parseInt(sel.value, 10) : 0;
  if (!dayId) return;
  _tripFetch('/home/trip/' + _tripPid + '/days/' + dayId + '/spots/' + spotId, {
    method: 'POST',
    body: new URLSearchParams({time_label: ''}),
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok && typeof tripLoadPlan === 'function') {
      _tripShowToast('Added to day!');
      // Silently re-load plan data so the dropdown has fresh days next time
      tripLoadPlan();
    }
  }).catch(function() { _tripShowToast('Failed to add to day', true); });
};

// ── Public: inline star priority ─────────────────────────────────────────────
window.tripSetStarPriority = function(spotId, priority) {
  var fd = new URLSearchParams();
  fd.append('priority', priority);
  _tripFetch('/home/trip/' + _tripPid + '/spots/' + spotId + '/priority', {
    method: 'PATCH', body: fd,
  }).then(function(r) { return r.json(); }).then(function() {
    // Update local cache + re-render (no full re-fetch needed)
    _tripSpots.forEach(function(s) { if (s.id === spotId) s.priority = priority; });
    _tripRenderResearch();
  }).catch(function() { _tripShowToast('Failed to save priority', true); });
};

// ── Spot modal ────────────────────────────────────────────────────────────────
window.tripOpenAddSpot = function() {
  _tripEditingId = null;
  document.getElementById('trip-spot-modal-title').textContent = 'Add Spot';
  document.getElementById('trip-spot-submit').textContent = 'Add Spot';
  _tripRenderSpotForm({});
  document.getElementById('trip-spot-modal').classList.remove('hidden');
};

window.tripOpenEditSpot = function(id) {
  var s = _tripSpots.find(function(x) { return x.id === id; });
  if (!s) return;
  _tripEditingId = id;
  document.getElementById('trip-spot-modal-title').textContent = 'Edit Spot';
  document.getElementById('trip-spot-submit').textContent = 'Save Changes';
  _tripRenderSpotForm(s);
  document.getElementById('trip-spot-modal').classList.remove('hidden');
};

window.tripCloseSpotModal = function() {
  document.getElementById('trip-spot-modal').classList.add('hidden');
  _tripEditingId = null;
};

function _tripInputCls() {
  return 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 ' +
         'dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
         'text-gray-800 dark:text-zinc-100 focus:outline-none ' +
         'focus:ring-2 focus:ring-[#0053e2]/40';
}

function _tripLabelCls() {
  return 'block text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1';
}

function _tripRenderSpotForm(v) {
  var typeOptions = _TRIP_TYPES.map(function(t) {
    var sel = (v.spot_type === t) ? ' selected' : '';
    return '<option value="' + t + '"' + sel + '>' + t + '</option>';
  }).join('');
  // Check if current type is a custom value (not in the preset list)
  var isCustom = v.spot_type && _TRIP_TYPES.indexOf(v.spot_type) === -1;
  typeOptions += '<option value="custom"' + (isCustom ? ' selected' : '') + '>Other (custom…)</option>';

  var html =
    '<div>' +
      '<label class="' + _tripLabelCls() + '">Name *</label>' +
      '<input id="tsf-name" type="text" value="' + _tripEsc(v.name || '') + '" ' +
        'placeholder="Place name" class="' + _tripInputCls() + '">' +
    '</div>' +
    '<div>' +
      '<label class="' + _tripLabelCls() + '">Type</label>' +
      '<select id="tsf-type" onchange="tripSpotTypeChange()" class="' + _tripInputCls() + '">' +
        typeOptions + '</select>' +
    '</div>' +
    '<div id="tsf-custom-wrap" class="' + (isCustom ? '' : 'hidden') + '">' +
      '<label class="' + _tripLabelCls() + '">Custom type</label>' +
      '<input id="tsf-type-custom" type="text" value="' + _tripEsc(isCustom ? v.spot_type : '') + '" ' +
        'placeholder="e.g. Winery" class="' + _tripInputCls() + '">' +
    '</div>' +
    '<div>' +
      '<label class="' + _tripLabelCls() + '">Cover Image URL</label>' +
      '<input id="tsf-cover" type="url" value="' + _tripEsc(v.cover_url || '') + '" ' +
        'placeholder="https://…" class="' + _tripInputCls() + '">' +
    '</div>' +
    '<div>' +
      '<label class="' + _tripLabelCls() + '">Map Link</label>' +
      '<input id="tsf-map" type="url" value="' + _tripEsc(v.map_url || '') + '" ' +
        'placeholder="Google Maps URL" class="' + _tripInputCls() + '">' +
    '</div>' +
    '<div>' +
      '<label class="' + _tripLabelCls() + '">Notes</label>' +
      '<textarea id="tsf-notes" rows="3" placeholder="Notes, tips, must-try dishes…" ' +
        'class="' + _tripInputCls() + ' resize-none">' + _tripEsc(v.notes || '') + '</textarea>' +
    '</div>' +
    '<div class="grid grid-cols-2 gap-3">' +
      '<div>' +
        '<label class="' + _tripLabelCls() + '">Priority (stars)</label>' +
        '<select id="tsf-priority" class="' + _tripInputCls() + '">' +
          [1,2,3,4,5].map(function(n) {
            return '<option value="' + n + '"' + ((v.priority || 3) === n ? ' selected' : '') + '>' +
              '★'.repeat(n) + '☆'.repeat(5 - n) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div>' +
        '<label class="' + _tripLabelCls() + '">Est. Cost</label>' +
        '<input id="tsf-cost" type="number" min="0" step="0.01" ' +
          'value="' + (v.estimated_cost || 0) + '" class="' + _tripInputCls() + '">' +
      '</div>' +
    '</div>' +
    '<div>' +
      '<label class="' + _tripLabelCls() + '">Currency</label>' +
      '<input id="tsf-currency" type="text" value="' + _tripEsc(v.currency || 'USD') + '" ' +
        'placeholder="USD" maxlength="3" style="text-transform:uppercase" ' +
        'class="' + _tripInputCls() + '">' +
    '</div>';
  document.getElementById('trip-spot-modal-body').innerHTML = html;
}

window.tripSpotTypeChange = function() {
  var sel  = document.getElementById('tsf-type');
  var wrap = document.getElementById('tsf-custom-wrap');
  if (sel && wrap) wrap.classList.toggle('hidden', sel.value !== 'custom');
};

window.tripSubmitSpot = function() {
  var name     = (document.getElementById('tsf-name')         || {}).value || '';
  var spotType = (document.getElementById('tsf-type')         || {}).value || 'Other';
  var custom   = (document.getElementById('tsf-type-custom')  || {}).value || '';
  var cover    = (document.getElementById('tsf-cover')        || {}).value || '';
  var mapUrl   = (document.getElementById('tsf-map')          || {}).value || '';
  var notes    = (document.getElementById('tsf-notes')        || {}).value || '';
  var priority = parseInt((document.getElementById('tsf-priority') || {}).value || '3', 10);
  var cost     = parseFloat((document.getElementById('tsf-cost')   || {}).value || '0') || 0;
  var currency = (document.getElementById('tsf-currency')    || {}).value || 'USD';

  if (!name.trim()) { _tripShowToast('Name is required', true); return; }

  var fd = new URLSearchParams();
  fd.append('name',             name.trim());
  fd.append('spot_type',        spotType);
  fd.append('spot_type_custom', custom.trim());
  fd.append('cover_url',        cover.trim());
  fd.append('map_url',          mapUrl.trim());
  fd.append('notes',            notes.trim());
  fd.append('priority',         priority);
  fd.append('estimated_cost',   Math.max(0, cost));
  fd.append('currency',         currency.trim().toUpperCase() || 'USD');

  var url = _tripEditingId
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
      _tripLoadSpots();
      _tripShowToast(_tripEditingId ? 'Spot updated!' : 'Spot added!');
    })
    .catch(function() { _tripShowToast('Save failed', true); })
    .finally(function() { if (btn) btn.disabled = false; });
};

// ── Delete spot ───────────────────────────────────────────────────────────────
window.tripConfirmDeleteSpot = function(id, name) {
  var msg = document.getElementById('trip-del-msg');
  var btn = document.getElementById('trip-del-confirm');
  if (msg) msg.textContent = 'Delete "' + name + '"? This also removes it from all day plans.';
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
      _tripLoadSpots();
      if (typeof tripLoadPlan === 'function') tripLoadPlan();
      _tripShowToast('Spot deleted');
    })
    .catch(function() { _tripShowToast('Delete failed', true); });
};

// ── Drag source (spot card → day lane) ────────────────────────────────────────
window.tripDragSpotStart = function(event, spotId) {
  event.dataTransfer.setData('bw-spot-id', String(spotId));
  event.dataTransfer.effectAllowed = 'copy';
  // Add opacity to dragged element via a short timeout (immediate doesn't work in Chrome)
  var el = event.currentTarget;
  setTimeout(function() { if (el) el.style.opacity = '0.5'; }, 0);
};

window.tripDragSpotEnd = function(event) {
  if (event.currentTarget) event.currentTarget.style.opacity = '';
};

// ── Shared utilities ──────────────────────────────────────────────────────────
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

window._tripChartColors = _TRIP_CHART_COLORS;
window._tripTypeColor   = _tripTypeColor;
window._TRIP_TYPE_EMOJI = _TRIP_TYPE_EMOJI;
