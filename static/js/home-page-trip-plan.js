/**
 * home-page-trip-plan.js — Plan tab: day CRUD + HTML5 drag-and-drop.
 * Depends on _tripPid, _tripFetch, _tripShowToast, _tripEsc (home-page-trip.js).
 * All state uses var.
 */

// ── Module state ──────────────────────────────────────────────────────────────
var _tripDays       = [];
var _tripDayEditing = null;   // null = add, int = edit day id

// ── Entry: load plan data ─────────────────────────────────────────────────────
window.tripLoadPlan = function() {
  _tripFetch('/home/trip/' + _tripPid + '/days')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _tripDays = Array.isArray(data) ? data : [];
      _tripRenderPlan();
    })
    .catch(function() { _tripShowToast('Failed to load plan', true); });
};

// ── Render all day lanes ──────────────────────────────────────────────────────
function _tripRenderPlan() {
  var container = document.getElementById('trip-days-container');
  if (!container) return;
  if (!_tripDays.length) {
    container.innerHTML =
      '<div class="flex items-center justify-center w-full h-48 ' +
        'text-gray-400 dark:text-zinc-500 text-sm text-center">' +
        '🗓️ No days yet.<br>' +
        '<span class="text-xs block mt-1">Click <strong>＋ Add Day</strong> to start building your itinerary.</span>' +
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
        'Drag a spot here or use<br>the ＋ button on a card</div>';

  var dateLabel = d.day_date
    ? '<span class="text-[10px] text-gray-400 dark:text-zinc-500 ml-1">' +
        _tripEsc(d.day_date) + '</span>'
    : '';

  return '<div class="flex-shrink-0 w-64 bg-white dark:bg-zinc-900 rounded-xl ' +
    'border border-gray-200 dark:border-zinc-800 flex flex-col overflow-hidden ' +
    'shadow-sm" style="max-height:calc(100vh - 12rem);">' +
    // Lane header
    '<div class="flex items-center gap-1 px-3 py-2 ' +
      'border-b border-gray-100 dark:border-zinc-800 flex-shrink-0">' +
      '<p class="text-sm font-semibold text-gray-700 dark:text-zinc-200 flex-1 truncate">' +
        _tripEsc(d.day_label || 'Day') + dateLabel +
      '</p>' +
      '<button onclick="tripOpenEditDay(' + d.id + ')" ' +
        'class="text-gray-400 hover:text-[#0053e2] transition text-xs">✏️</button>' +
      '<button onclick="tripConfirmDeleteDay(' + d.id + ',\'' +
        _tripEsc((d.day_label||'Day').replace(/'/g,'\\\'')) + '\')" ' +
        'class="text-gray-400 hover:text-red-500 transition text-xs ml-0.5">🗑️</button>' +
    '</div>' +
    // Drop zone
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
    ? '<span class="text-[10px] text-[#0053e2] font-medium">' + _tripEsc(s.time_label) + '</span>'
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

// ── Day modal ─────────────────────────────────────────────────────────────────
window.tripOpenAddDay = function() {
  _tripDayEditing = null;
  document.getElementById('trip-day-modal-title').textContent = 'Add Day';
  document.getElementById('trip-day-submit').textContent = 'Add Day';
  document.getElementById('trip-day-label').value = '';
  document.getElementById('trip-day-date').value  = '';
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
  document.getElementById('trip-day-submit').textContent = 'Save';
  document.getElementById('trip-day-label').value = d.day_label || '';
  document.getElementById('trip-day-date').value  = d.day_date  || '';
  document.getElementById('trip-day-modal').classList.remove('hidden');
};

window.tripCloseDayModal = function() {
  document.getElementById('trip-day-modal').classList.add('hidden');
  _tripDayEditing = null;
};

window.tripSubmitDay = function() {
  var label = (document.getElementById('trip-day-label') || {}).value || '';
  var date  = (document.getElementById('trip-day-date')  || {}).value || '';
  var fd = new URLSearchParams();
  fd.append('day_label', label.trim());
  fd.append('day_date',  date.trim());
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

// ── Edit time label inline ────────────────────────────────────────────────────
window.tripEditDaySpotTime = function(dayId, spotId, tdsId) {
  var row = document.querySelector('[data-tds-id="' + tdsId + '"]');
  if (!row) return;
  var cur = _tripDays.reduce(function(acc, d) {
    if (d.id !== dayId) return acc;
    var sp = d.spots.find(function(s) { return s.tds_id === tdsId; });
    return sp ? sp.time_label : acc;
  }, '');
  var newTime = window.prompt('Time label (e.g. "9:00 AM"):', cur || '');
  if (newTime === null) return;  // cancelled
  var fd = new URLSearchParams();
  fd.append('time_label', newTime.trim());
  _tripFetch('/home/trip/' + _tripPid + '/days/' + dayId + '/spots/' + spotId, {
    method: 'PUT', body: fd,
  }).then(function() { tripLoadPlan(); })
    .catch(function() { _tripShowToast('Save failed', true); });
};

// ── Drag-and-drop: Research → Day lane ───────────────────────────────────────
window.tripDragDayOver = function(event, dayId) {
  event.preventDefault();   // REQUIRED — without this, drop never fires
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

  // Could be a spot from Research tab or a spot row being reordered
  var spotId = event.dataTransfer.getData('bw-spot-id');
  if (spotId) {
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
  }
};

// ── Drag-and-drop: Reorder within a day lane ──────────────────────────────────
var _tripDragSrcDayId  = null;
var _tripDragSrcTdsId  = null;

window.tripDragDaySpotStart = function(event, dayId, tdsId) {
  event.stopPropagation();  // Don't trigger the Research card drag
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
  if (_tripDragSrcDayId !== dayId) return;  // cross-lane reorder not supported
  var srcTdsId = parseInt(event.dataTransfer.getData('bw-tds-id'), 10);
  if (!srcTdsId || srcTdsId === targetTdsId) return;

  // Build new order from current DOM
  var lane = document.getElementById('trip-day-lane-' + dayId);
  if (!lane) return;
  var rows = lane.querySelectorAll('[data-tds-id]');
  var orderedIds = Array.prototype.slice.call(rows).map(function(r) {
    return parseInt(r.dataset.tdsId, 10);
  });
  // Move srcTdsId before targetTdsId
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
