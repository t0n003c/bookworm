/**
 * home-page-trip-plan.js — Plan tab: Trip cards → Day lanes → drag-and-drop.
 * Hierarchy: Plan cards (top level) → click into Trip → Day lanes.
 * Depends on _tripPid, _tripFetch, _tripShowToast, _tripEsc (home-page-trip.js).
 * All state uses var (HTMX-safe).
 */

// ── Module state ──────────────────────────────────────────────────────────────
var _tripPlans        = [];
var _tripPlanEditing  = null;   // null = add mode, int = plan id being edited

var _tripDays         = [];
var _tripDayEditing   = null;   // null = add mode, int = day id being edited

// Active plan — exposed on window so home-page-trip.js topbar can branch
window._tripActivePlanId   = null;
window._tripActivePlanName = '';

// ── Entry: called by tripSetTab('plan') and after CRUD refreshes ──────────────
window.tripLoadPlan = function() {
  if (window._tripActivePlanId) {
    _loadDaysForPlan(window._tripActivePlanId);
  } else {
    _loadPlans();
  }
};

// ── Plan list ─────────────────────────────────────────────────────────────────
function _loadPlans() {
  _tripFetch('/home/trip/' + _tripPid + '/plans')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _tripPlans = Array.isArray(data) ? data : [];
      _tripRenderPlanCards();
    })
    .catch(function() { _tripShowToast('Failed to load trips', true); });
}

function _tripRenderPlanCards() {
  var grid = document.getElementById('trip-plans-grid');
  if (!grid) return;
  if (!_tripPlans.length) {
    grid.innerHTML =
      '<div class="flex flex-col items-center justify-center col-span-full h-48 ' +
        'text-gray-400 dark:text-zinc-500 text-center">' +
        '<span class="text-2xl mb-2">🗺️</span>' +
        '<span class="text-sm">No trips yet.</span>' +
        '<span class="text-xs mt-1">Click <strong>＋ Add Trip</strong> to start planning!</span>' +
      '</div>';
    return;
  }
  grid.innerHTML = _tripPlans.map(function(p) {
    return _tripRenderPlanCard(p);
  }).join('');
}

function _tripRenderPlanCard(p) {
  var safeName = _tripEsc(p.plan_name);
  var jsName   = safeName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  var dateRange = '';
  if (p.start_date || p.end_date) {
    dateRange =
      '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">' +
        (p.start_date ? _tripEsc(p.start_date) : '') +
        (p.start_date && p.end_date ? ' → ' : '') +
        (p.end_date ? _tripEsc(p.end_date) : '') +
      '</p>';
  }
  var descHtml = p.plan_desc
    ? '<p class="text-xs text-gray-500 dark:text-zinc-400 mt-1 line-clamp-2">' +
        _tripEsc(p.plan_desc) + '</p>'
    : '';
  var dayLabel = p.day_count + ' day' + (p.day_count !== 1 ? 's' : '');

  return '<div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 ' +
    'dark:border-zinc-800 shadow-sm overflow-hidden cursor-pointer group ' +
    'hover:shadow-md hover:border-[#0053e2]/40 transition-all" ' +
    'onclick="tripOpenPlan(' + p.id + ',\'' + jsName + '\')">' +
    '<div class="p-4">' +
      '<div class="flex items-start justify-between gap-2">' +
        '<div class="flex-1 min-w-0">' +
          '<p class="font-semibold text-gray-800 dark:text-zinc-100 truncate text-sm">' +
            '🗓️ ' + safeName +
          '</p>' +
          dateRange + descHtml +
        '</div>' +
        '<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" ' +
             'onclick="event.stopPropagation()">' +
          '<button onclick="tripOpenEditPlan(' + p.id + ')" ' +
            'class="text-gray-400 hover:text-[#0053e2] transition text-xs" ' +
            'title="Edit trip">✏️</button>' +
          '<button onclick="tripConfirmDeletePlan(' + p.id + ',\'' + jsName + '\')" ' +
            'class="text-gray-400 hover:text-red-500 transition text-xs ml-0.5" ' +
            'title="Delete trip">🗑️</button>' +
        '</div>' +
      '</div>' +
      '<p class="mt-3 text-xs text-gray-400 dark:text-zinc-500">📅 ' + dayLabel + '</p>' +
    '</div>' +
  '</div>';
}

// ── Open / close a plan (swap plans-view ↔ days-view) ────────────────────────
window.tripOpenPlan = function(planId, planName) {
  window._tripActivePlanId   = planId;
  window._tripActivePlanName = planName || 'Trip';

  var plansView = document.getElementById('trip-plans-view');
  var daysView  = document.getElementById('trip-days-view');
  if (plansView) plansView.classList.add('hidden');
  if (daysView)  daysView.classList.remove('hidden');

  _tripRenderDaysToolbar();
  _loadDaysForPlan(planId);
  if (typeof _tripRenderTopbarControls === 'function') _tripRenderTopbarControls();
};

window.tripClosePlan = function() {
  window._tripActivePlanId   = null;
  window._tripActivePlanName = '';

  var plansView = document.getElementById('trip-plans-view');
  var daysView  = document.getElementById('trip-days-view');
  if (daysView)  daysView.classList.add('hidden');
  if (plansView) plansView.classList.remove('hidden');

  _loadPlans();
  if (typeof _tripRenderTopbarControls === 'function') _tripRenderTopbarControls();
};

function _tripRenderDaysToolbar() {
  var tb = document.getElementById('trip-plan-toolbar');
  if (!tb) return;
  tb.innerHTML =
    '<button onclick="tripClosePlan()" ' +
      'class="flex items-center gap-1 text-sm text-gray-500 dark:text-zinc-400 ' +
             'hover:text-gray-800 dark:hover:text-zinc-100 transition">' +
      '← Trips' +
    '</button>' +
    '<span class="text-gray-300 dark:text-zinc-600 select-none">|</span>' +
    '<p class="text-sm font-semibold text-gray-700 dark:text-zinc-200 truncate">' +
      '🗓️ ' + _tripEsc(window._tripActivePlanName) +
    '</p>';
}

// ── Day list ──────────────────────────────────────────────────────────────────
function _loadDaysForPlan(planId) {
  _tripFetch('/home/trip/' + _tripPid + '/days?plan_id=' + planId)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _tripDays = Array.isArray(data) ? data : [];
      _tripRenderPlan();
      // Refresh spot cards so the “+ Day” dropdown reflects the loaded days
      if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
    })
    .catch(function() { _tripShowToast('Failed to load plan', true); });
}

// ── Render all day lanes ──────────────────────────────────────────────────────
function _tripRenderPlan() {
  var container = document.getElementById('trip-days-container');
  if (!container) return;
  if (!_tripDays.length) {
    container.innerHTML =
      '<div class="flex flex-col items-center justify-center w-full h-48 ' +
        'text-gray-400 dark:text-zinc-500 text-center">' +
        '<span class="text-sm">🗓️ No days yet.</span>' +
        '<span class="text-xs mt-1">Click <strong>＋ Add Day</strong> to build your itinerary.</span>' +
      '</div>';
    return;
  }
  container.innerHTML = _tripDays.map(function(d) {
    return _tripRenderDayLane(d);
  }).join('');
}

function _tripRenderDayLane(d) {
  var spotsHtml = d.spots.length
    ? d.spots.map(function(s) { return _tripRenderDaySpotRow(d.id, s); }).join('')
    : '<div class="trip-drop-hint text-xs text-center text-gray-300 dark:text-zinc-600 py-6 px-3 ' +
        'border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-lg">' +
        'No spots yet — use the<br><strong>picker on Research tab cards</strong></div>';

  var dateLabel = d.day_date
    ? '<span class="text-[10px] text-gray-400 dark:text-zinc-500 ml-1">' +
        _tripEsc(d.day_date) + '</span>'
    : '';

  return '<div class="flex-shrink-0 w-64 bg-white dark:bg-zinc-900 rounded-xl ' +
    'border border-gray-200 dark:border-zinc-800 flex flex-col overflow-hidden ' +
    'shadow-sm" style="max-height:calc(100vh - 12rem);">' +
    '<div class="flex items-center gap-1 px-3 py-2 ' +
      'border-b border-gray-100 dark:border-zinc-800 flex-shrink-0">' +
      '<p class="text-sm font-semibold text-gray-700 dark:text-zinc-200 flex-1 truncate">' +
        _tripEsc(d.day_label || 'Day') + dateLabel +
      '</p>' +
      '<button onclick="tripOpenEditDay(' + d.id + ')" ' +
        'class="text-gray-400 hover:text-[#0053e2] transition text-xs">✏️</button>' +
      '<button onclick="tripConfirmDeleteDay(' + d.id + ',\'' +
        _tripEsc((d.day_label || 'Day').replace(/'/g, "\\'")) + '\')" ' +
        'class="text-gray-400 hover:text-red-500 transition text-xs ml-0.5">🗑️</button>' +
    '</div>' +
    '<div id="trip-day-lane-' + d.id + '" ' +
      'class="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-16" ' +
      'ondragover="tripDragDayOver(event,' + d.id + ')" ' +
      'ondragleave="tripDragDayLeave(event,' + d.id + ')" ' +
      'ondrop="tripDragDayDrop(event,' + d.id + ')">' +
      spotsHtml +
    '</div>' +
  '</div>';
}

function _tripRenderDaySpotRow(dayId, s) {
  var emoji = (typeof _TRIP_TYPE_EMOJI !== 'undefined' && _TRIP_TYPE_EMOJI[s.spot_type])
    || '📍';
  var timeLabel = s.time_label
    ? '<span class="text-[10px] text-[#0053e2] dark:text-blue-400 font-medium">' + _tripEsc(s.time_label) + '</span>'
    : '';
  return '<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg ' +
    'bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 ' +
    'group cursor-grab active:cursor-grabbing" ' +
    'draggable="true" ' +
    'data-tds-id="' + s.tds_id + '" ' +
    'ondragstart="tripDragDaySpotStart(event,' + dayId + ',' + s.tds_id + ')" ' +
    'ondragover="tripDragDaySpotOver(event)" ' +
    'ondrop="tripDragDaySpotDrop(event,' + dayId + ',' + s.tds_id + ')">' +
    '<span class="text-base flex-shrink-0">' + emoji + '</span>' +
    '<div class="flex-1 min-w-0">' +
      '<p class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate">' +
        _tripEsc(s.name) + '</p>' +
      timeLabel +
    '</div>' +
    '<button onclick="tripEditDaySpotTime(' + dayId + ',' + s.spot_id + ',' + s.tds_id + ')" ' +
      'title="Set time" ' +
      'class="opacity-0 group-hover:opacity-100 transition text-[10px] ' +
             'text-gray-400 hover:text-[#0053e2]">🕐</button>' +
    '<button onclick="tripRemoveSpotFromDay(' + dayId + ',' + s.spot_id + ')" ' +
      'class="opacity-0 group-hover:opacity-100 transition text-[10px] ' +
             'text-gray-400 hover:text-red-500">✕</button>' +
  '</div>';
}

// ── Plan modal (Add / Edit Trip) ──────────────────────────────────────────────
window.tripOpenAddPlan = function() {
  _tripPlanEditing = null;
  document.getElementById('trip-plan-modal-title').textContent = 'Add Trip';
  document.getElementById('trip-plan-submit').textContent      = 'Add Trip';
  document.getElementById('trip-plan-name').value  = '';
  document.getElementById('trip-plan-desc').value  = '';
  document.getElementById('trip-plan-start').value = '';
  document.getElementById('trip-plan-end').value   = '';
  document.getElementById('trip-plan-modal').classList.remove('hidden');
  setTimeout(function() {
    var el = document.getElementById('trip-plan-name');
    if (el) el.focus();
  }, 50);
};

window.tripOpenEditPlan = function(planId) {
  var p = _tripPlans.find(function(x) { return x.id === planId; });
  if (!p) return;
  _tripPlanEditing = planId;
  document.getElementById('trip-plan-modal-title').textContent = 'Edit Trip';
  document.getElementById('trip-plan-submit').textContent      = 'Save';
  document.getElementById('trip-plan-name').value  = p.plan_name  || '';
  document.getElementById('trip-plan-desc').value  = p.plan_desc  || '';
  document.getElementById('trip-plan-start').value = p.start_date || '';
  document.getElementById('trip-plan-end').value   = p.end_date   || '';
  document.getElementById('trip-plan-modal').classList.remove('hidden');
};

window.tripClosePlanModal = function() {
  document.getElementById('trip-plan-modal').classList.add('hidden');
  _tripPlanEditing = null;
};

window.tripSubmitPlan = function() {
  var name  = (document.getElementById('trip-plan-name')  || {}).value || '';
  var desc  = (document.getElementById('trip-plan-desc')  || {}).value || '';
  var start = (document.getElementById('trip-plan-start') || {}).value || '';
  var end   = (document.getElementById('trip-plan-end')   || {}).value || '';
  if (!name.trim()) { _tripShowToast('Trip name is required', true); return; }
  var fd = new URLSearchParams();
  fd.append('plan_name',  name.trim());
  fd.append('plan_desc',  desc.trim());
  fd.append('start_date', start);
  fd.append('end_date',   end);
  var url    = _tripPlanEditing
    ? '/home/trip/' + _tripPid + '/plans/' + _tripPlanEditing
    : '/home/trip/' + _tripPid + '/plans/add';
  var method = _tripPlanEditing ? 'PUT' : 'POST';
  _tripFetch(url, {method: method, body: fd})
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { _tripShowToast(d.error, true); return; }
      tripClosePlanModal();
      _loadPlans();
      _tripShowToast(_tripPlanEditing ? 'Trip updated!' : 'Trip added!');
    })
    .catch(function() { _tripShowToast('Save failed', true); });
};

// ── Delete plan ───────────────────────────────────────────────────────────────
window.tripConfirmDeletePlan = function(planId, name) {
  var msg = document.getElementById('trip-del-msg');
  var btn = document.getElementById('trip-del-confirm');
  if (msg) msg.textContent = 'Delete "' + name + '"? All days inside will also be deleted.';
  if (btn) btn.onclick = function() { tripDeletePlan(planId); };
  document.getElementById('trip-del-modal').classList.remove('hidden');
};

window.tripDeletePlan = function(planId) {
  if (typeof tripCloseDelModal === 'function') tripCloseDelModal();
  _tripFetch('/home/trip/' + _tripPid + '/plans/' + planId, {method: 'DELETE'})
    .then(function(r) { return r.json(); })
    .then(function() { _loadPlans(); _tripShowToast('Trip deleted'); })
    .catch(function() { _tripShowToast('Delete failed', true); });
};

// ── Day modal ─────────────────────────────────────────────────────────────────

// Apply min/max from active plan to the date input, and show/hide hint.
function _applyDayDateRange() {
  var plan  = _tripPlans.find(function(p) { return p.id === window._tripActivePlanId; });
  var input = document.getElementById('trip-day-date');
  var hint  = document.getElementById('trip-day-date-hint');
  if (!input) return;
  var start = (plan && plan.start_date) ? plan.start_date : '';
  var end   = (plan && plan.end_date)   ? plan.end_date   : '';
  input.min = start;
  input.max = end;
  if (hint) {
    if (start || end) {
      hint.textContent = '📅 Trip range: ' + (start || '—') + ' → ' + (end || '—');
      hint.classList.remove('hidden');
    } else {
      hint.classList.add('hidden');
    }
  }
}

window.tripOpenAddDay = function() {
  if (!window._tripActivePlanId) {
    _tripShowToast('Open a trip first, then add a day.', true); return;
  }
  _tripDayEditing = null;
  document.getElementById('trip-day-modal-title').textContent = 'Add Day';
  document.getElementById('trip-day-submit').textContent      = 'Add Day';
  document.getElementById('trip-day-label').value = '';
  document.getElementById('trip-day-date').value  = '';
  _applyDayDateRange();
  document.getElementById('trip-day-modal').classList.remove('hidden');
  setTimeout(function() {
    var el = document.getElementById('trip-day-label');
    if (el) el.focus();
  }, 50);
};

window.tripOpenEditDay = function(dayId) {
  var d = _tripDays.find(function(x) { return x.id === dayId; });
  if (!d) return;
  _tripDayEditing = dayId;
  document.getElementById('trip-day-modal-title').textContent = 'Edit Day';
  document.getElementById('trip-day-submit').textContent      = 'Save';
  document.getElementById('trip-day-label').value = d.day_label || '';
  document.getElementById('trip-day-date').value  = d.day_date  || '';
  _applyDayDateRange();
  document.getElementById('trip-day-modal').classList.remove('hidden');
};

window.tripCloseDayModal = function() {
  document.getElementById('trip-day-modal').classList.add('hidden');
  _tripDayEditing = null;
};

window.tripSubmitDay = function() {
  var label  = (document.getElementById('trip-day-label') || {}).value || '';
  var date   = (document.getElementById('trip-day-date')  || {}).value || '';
  var fd = new URLSearchParams();
  fd.append('day_label', label.trim());
  fd.append('day_date',  date.trim());
  if (window._tripActivePlanId && !_tripDayEditing) {
    fd.append('plan_id', String(window._tripActivePlanId));
  }
  var url    = _tripDayEditing
    ? '/home/trip/' + _tripPid + '/days/' + _tripDayEditing
    : '/home/trip/' + _tripPid + '/days/add';
  var method = _tripDayEditing ? 'PUT' : 'POST';
  _tripFetch(url, {method: method, body: fd})
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { _tripShowToast(d.error, true); return; }
      tripCloseDayModal();
      tripLoadPlan();
      _tripShowToast(_tripDayEditing ? 'Day updated!' : 'Day added!');
    })
    .catch(function() { _tripShowToast('Save failed', true); });
};

// ── Delete day ────────────────────────────────────────────────────────────────
window.tripConfirmDeleteDay = function(dayId, label) {
  var msg = document.getElementById('trip-del-msg');
  var btn = document.getElementById('trip-del-confirm');
  if (msg) msg.textContent = 'Delete "' + label + '"? Spots in this day are unaffected.';
  if (btn) btn.onclick = function() { tripDeleteDay(dayId); };
  document.getElementById('trip-del-modal').classList.remove('hidden');
};

window.tripDeleteDay = function(dayId) {
  if (typeof tripCloseDelModal === 'function') tripCloseDelModal();
  _tripFetch('/home/trip/' + _tripPid + '/days/' + dayId, {method: 'DELETE'})
    .then(function(r) { return r.json(); })
    .then(function() { tripLoadPlan(); _tripShowToast('Day deleted'); })
    .catch(function() { _tripShowToast('Delete failed', true); });
};

// ── Remove spot from day ──────────────────────────────────────────────────────
window.tripRemoveSpotFromDay = function(dayId, spotId) {
  _tripFetch('/home/trip/' + _tripPid + '/days/' + dayId + '/spots/' + spotId, {method: 'DELETE'})
    .then(function(r) { return r.json(); })
    .then(function() { tripLoadPlan(); })
    .catch(function() { _tripShowToast('Remove failed', true); });
};

// ── Time label modal ───────────────────────────────────────────────────────────────
var _tripTimeDayId  = null;
var _tripTimeSpotId = null;
var _tripTimeTdsId  = null;

window.tripEditDaySpotTime = function(dayId, spotId, tdsId) {
  _tripTimeDayId  = dayId;
  _tripTimeSpotId = spotId;
  _tripTimeTdsId  = tdsId;
  var cur = _tripDays.reduce(function(acc, d) {
    if (d.id !== dayId) return acc;
    var sp = d.spots.find(function(s) { return s.tds_id === tdsId; });
    return sp ? sp.time_label : acc;
  }, '');
  var input = document.getElementById('trip-time-input');
  if (input) input.value = cur || '';
  document.getElementById('trip-time-modal').classList.remove('hidden');
  setTimeout(function() { if (input) input.focus(); }, 50);
};

window.tripCloseTimeModal = function() {
  document.getElementById('trip-time-modal').classList.add('hidden');
  _tripTimeDayId = _tripTimeSpotId = _tripTimeTdsId = null;
};

window.tripSubmitTime = function() {
  if (!_tripTimeDayId) return;
  var input = document.getElementById('trip-time-input');
  var val   = input ? input.value.trim() : '';
  var fd    = new URLSearchParams();
  fd.append('time_label', val);
  _tripFetch('/home/trip/' + _tripPid + '/days/' + _tripTimeDayId + '/spots/' + _tripTimeSpotId, {
    method: 'PUT', body: fd,
  }).then(function() {
    tripCloseTimeModal();
    tripLoadPlan();
  }).catch(function() { _tripShowToast('Save failed', true); });
};

// ── Drag-and-drop: Research → Day lane ───────────────────────────────────────
window.tripDragDayOver = function(event, dayId) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  var lane = document.getElementById('trip-day-lane-' + dayId);
  if (lane) lane.style.outline = '2px solid #0053e2';
};

window.tripDragDayLeave = function(event, dayId) {
  var lane = document.getElementById('trip-day-lane-' + dayId);
  if (lane) lane.style.outline = '';
};

window.tripDragDayDrop = function(event, dayId) {
  event.preventDefault();
  var lane = document.getElementById('trip-day-lane-' + dayId);
  if (lane) lane.style.outline = '';

  var spotId = event.dataTransfer.getData('bw-spot-id');
  if (!spotId) return;
  spotId = parseInt(spotId, 10);
  _tripFetch('/home/trip/' + _tripPid + '/days/' + dayId + '/spots/' + spotId, {
    method: 'POST',
    body: new URLSearchParams({time_label: ''}),
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { _tripShowToast(d.error, true); return; }
      _tripShowToast('Added to day!');
      tripLoadPlan();
    })
    .catch(function() { _tripShowToast('Drop failed', true); });
};

// ── Drag-and-drop: Reorder within a day lane ──────────────────────────────────
var _tripDragSrcDayId = null;
var _tripDragSrcTdsId = null;

window.tripDragDaySpotStart = function(event, dayId, tdsId) {
  event.stopPropagation();
  event.dataTransfer.setData('bw-tds-id', String(tdsId));
  event.dataTransfer.effectAllowed = 'move';
  _tripDragSrcDayId = dayId;
  _tripDragSrcTdsId = tdsId;
};

window.tripDragDaySpotOver = function(event) {
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';
};

window.tripDragDaySpotDrop = function(event, dayId, targetTdsId) {
  event.preventDefault();
  event.stopPropagation();
  if (_tripDragSrcDayId !== dayId) return;
  var srcTdsId = parseInt(event.dataTransfer.getData('bw-tds-id'), 10);
  if (!srcTdsId || srcTdsId === targetTdsId) return;

  var lane = document.getElementById('trip-day-lane-' + dayId);
  if (!lane) return;
  var rows = lane.querySelectorAll('[data-tds-id]');
  var orderedIds = Array.prototype.slice.call(rows).map(function(r) {
    return parseInt(r.dataset.tdsId, 10);
  });
  var fromIdx = orderedIds.indexOf(srcTdsId);
  var toIdx   = orderedIds.indexOf(targetTdsId);
  if (fromIdx < 0 || toIdx < 0) return;
  orderedIds.splice(fromIdx, 1);
  orderedIds.splice(toIdx, 0, srcTdsId);

  _tripFetch('/home/trip/' + _tripPid + '/days/' + dayId + '/spots/reorder', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ordered_ids: orderedIds}),
  }).then(function() { tripLoadPlan(); })
    .catch(function() { _tripShowToast('Reorder failed', true); });
};
