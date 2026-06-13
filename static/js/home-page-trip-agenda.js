/**
 * home-page-trip-agenda.js — PHONE-ONLY "Trip View".
 *
 * A collapse-by-default agenda overview of the whole trip (Phase 1), plus
 * quick-capture (Phase 2) and light edits (Phase 3). It REUSES the data loader
 * and the view-mode row renderers from home-page-trip-plan.js rather than
 * re-rendering anything — the desktop experience is completely untouched.
 *
 * Every entry point guards on window._tripPhone, and all of this view's DOM is
 * also force-hidden ≥768px in CSS, so desktop never runs or shows phone bits.
 *
 * Loaded (defer) after home-page-trip-plan.js / -panels.js, so the reused
 * globals (_tripDays, _tripBlocks, _tripPlanMode, _tripRenderDaySpotRow,
 * _tripRenderDayBlockRow, _loadDaysForPlan, tripOpenPlan, _tripEsc, _tripFetch,
 * _tppParse, window._tripPanels) are all defined by call time.
 */

// Set in home-page-trip.js initTripPage; gates the render branch in
// _loadDaysForPlan (home-page-trip-plan.js).
window._tripAgendaActive    = false;
window._tripAgendaAutoOpened = false;   // one-shot single-plan auto-open guard
var _tripAgendaStats = null;            // last /stats payload for the strip

// ── Local "today" + resolve today's day id (also used by Phase 2 capture) ──────
function _tripLocalToday() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
window._tripResolveTodayDayId = function() {
  var days = (typeof _tripDays !== 'undefined' && _tripDays) ? _tripDays : [];
  if (!days.length) return null;
  var today = _tripLocalToday();
  var exact = days.filter(function(d) { return d.day_date === today; })[0];
  if (exact) return exact.id;
  var upcoming = days.filter(function(d) { return d.day_date && d.day_date >= today; })
                     .sort(function(a, b) { return a.day_date < b.day_date ? -1 : 1; });
  if (upcoming.length) return upcoming[0].id;
  var dated = days.filter(function(d) { return d.day_date; })
                  .sort(function(a, b) { return a.day_date < b.day_date ? 1 : -1; });
  if (dated.length) return dated[0].id;
  return days[0].id;
};

// ── Collapse state (per plan, default collapsed except today) ──────────────────
function _agendaKey(planId) { return 'bw-trip-agenda-open-' + planId; }
function _agendaOpenMap(planId) {
  try { return JSON.parse(localStorage.getItem(_agendaKey(planId)) || '{}') || {}; }
  catch (e) { return {}; }
}
function _agendaIsOpen(dayId) {
  var map = _agendaOpenMap(window._tripActivePlanId);
  if (Object.prototype.hasOwnProperty.call(map, dayId)) return !!map[dayId];
  return dayId === window._tripResolveTodayDayId();   // first-view default
}
window.tripAgendaToggleDay = function(dayId) {
  var pid = window._tripActivePlanId;
  var map = _agendaOpenMap(pid);
  var cur = Object.prototype.hasOwnProperty.call(map, dayId)
    ? !!map[dayId]
    : (dayId === window._tripResolveTodayDayId());
  map[dayId] = !cur;
  try { localStorage.setItem(_agendaKey(pid), JSON.stringify(map)); } catch (e) {}
  window._tripRenderAgenda();
};

// ── Open / leave the agenda ────────────────────────────────────────────────────
window.tripOpenAgenda = function(planId, name) {
  if (!window._tripPhone) {   // safety: desktop falls back to the normal editor
    if (typeof tripOpenPlan === 'function') tripOpenPlan(planId, name);
    return;
  }
  window._tripActivePlanId   = planId;
  window._tripActivePlanName = name || 'Trip';
  window._tripAgendaActive   = true;
  if (typeof _tripPlanMode !== 'undefined') _tripPlanMode = 'view';

  var plansView  = document.getElementById('trip-plans-view');
  var daysView   = document.getElementById('trip-days-view');
  var agendaView = document.getElementById('trip-agenda-view');
  if (plansView)  plansView.classList.add('hidden');
  if (daysView)   daysView.classList.add('hidden');
  if (agendaView) {
    agendaView.classList.remove('hidden');
    agendaView.innerHTML =
      '<div class="p-6 text-center text-sm text-gray-400 dark:text-zinc-500">Loading trip…</div>';
  }
  if (typeof _tripRenderTopbarControls === 'function') _tripRenderTopbarControls();

  // Stat strip (independent fetch; refresh the strip when it lands).
  _tripAgendaStats = null;
  _tripFetch('/home/trip/' + _tripPid + '/stats?plan_id=' + planId)
    .then(function(r) { return r.json(); })
    .then(function(s) { _tripAgendaStats = s; if (window._tripAgendaActive) window._tripRenderAgenda(); })
    .catch(function() {});

  // Days + blocks (+ panels). Reuse the existing loader; its .then renders the
  // agenda because _tripAgendaActive is true.
  if (typeof _loadDaysForPlan === 'function') _loadDaysForPlan(planId);
};

window.tripAgendaToCards = function() {
  window._tripAgendaActive   = false;
  window._tripActivePlanId   = null;
  window._tripActivePlanName = '';
  var plansView  = document.getElementById('trip-plans-view');
  var agendaView = document.getElementById('trip-agenda-view');
  if (agendaView) agendaView.classList.add('hidden');
  if (plansView)  plansView.classList.remove('hidden');
  if (typeof window.tripCloseCaptureSheet === 'function') window.tripCloseCaptureSheet();
  if (typeof window._tripUpdateFab === 'function') window._tripUpdateFab();
  if (typeof _tripRenderTopbarControls === 'function') _tripRenderTopbarControls();
};

// Escape hatch → the full day-lane editor (the existing Plan editing UI).
window.tripAgendaFullEditor = function() {
  window._tripAgendaActive = false;
  if (typeof _tripPlanMode !== 'undefined') _tripPlanMode = 'edit';
  var agendaView = document.getElementById('trip-agenda-view');
  if (agendaView) agendaView.classList.add('hidden');
  if (typeof window.tripCloseCaptureSheet === 'function') window.tripCloseCaptureSheet();
  if (typeof window._tripUpdateFab === 'function') window._tripUpdateFab();
  if (typeof tripOpenPlan === 'function') {
    tripOpenPlan(window._tripActivePlanId, window._tripActivePlanName);
  }
};

// Return from the editor back to the agenda (phone-only toolbar button).
window.tripAgendaBack = function() {
  var daysView = document.getElementById('trip-days-view');
  if (daysView) daysView.classList.add('hidden');
  if (typeof _tripPlanMode !== 'undefined') _tripPlanMode = 'view';
  window.tripOpenAgenda(window._tripActivePlanId, window._tripActivePlanName);
};

// ── Stat strip ─────────────────────────────────────────────────────────────────
function _agendaPeopleCount() {
  var panels = window._tripPanels || [];
  var pp = panels.filter(function(p) { return p.panel_type === 'people'; })[0];
  if (!pp) return null;
  try {
    var d = (typeof _tppParse === 'function') ? _tppParse(pp.content) : (JSON.parse(pp.content || '{}'));
    var arr = d.people || d.members || d.items || [];
    return Array.isArray(arr) ? arr.length : null;
  } catch (e) { return null; }
}
function _agendaMoney(amt, cur) {
  var n = Math.round((amt || 0) * 100) / 100;
  var sym = ({ USD: '$', EUR: '€', GBP: '£', JPY: '¥' })[cur] || '';
  return sym ? (sym + n) : (n + ' ' + (cur || ''));
}
function _agendaChip(icon, text) {
  return '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs ' +
    'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 ' +
    'border border-gray-200 dark:border-zinc-700">' +
    '<span>' + icon + '</span><span class="font-medium">' + _tripEsc(String(text)) + '</span></span>';
}
function _agendaStatStrip() {
  var s = _tripAgendaStats || {};
  var days  = (typeof _tripDays !== 'undefined' && _tripDays) ? _tripDays.length : (s.total_days || 0);
  var spots = (s.spots_in_plan != null) ? s.spots_in_plan : 0;
  var chips = [
    _agendaChip('📅', days + ' day' + (days !== 1 ? 's' : '')),
    _agendaChip('📍', spots + ' spot' + (spots !== 1 ? 's' : '')),
  ];
  if (s.grand_total != null) {
    chips.push(_agendaChip('💰', 'est. ' + _agendaMoney(s.grand_total, s.grand_currency)));
  } else if (s.mixed_currencies) {
    chips.push(_agendaChip('💰', 'mixed'));
  }
  var ppl = _agendaPeopleCount();
  if (ppl != null) chips.push(_agendaChip('👤', ppl + ' ' + (ppl === 1 ? 'person' : 'people')));
  return '<div class="flex flex-wrap gap-2 px-3 pt-3 pb-1">' + chips.join('') + '</div>';
}

// ── Day card (collapsed summary → expanded read rows) ──────────────────────────
function _agendaDayMerged(d) {
  var items = [];
  (d.spots || []).forEach(function(s) { items.push({ kind: 'spot', order_idx: s.sort_order || 0, data: s }); });
  ((typeof _tripBlocks !== 'undefined' && _tripBlocks[d.id]) || []).forEach(function(b) {
    items.push({ kind: 'block', order_idx: b.order_idx, data: b });
  });
  items.sort(function(a, b) { return a.order_idx - b.order_idx; });
  return items;
}
function _agendaRenderDay(d, isToday) {
  var open  = _agendaIsOpen(d.id);
  var stops = (d.spots || []).length;
  var notes = ((typeof _tripBlocks !== 'undefined' && _tripBlocks[d.id]) || []).length;
  var bits  = [stops + ' stop' + (stops !== 1 ? 's' : '')];
  if (notes) bits.push(notes + ' note' + (notes !== 1 ? 's' : ''));
  var summary = bits.join(' · ');

  var dateLabel = d.day_date
    ? '<span class="text-[11px] text-gray-400 dark:text-zinc-500">' + _tripEsc(d.day_date) + '</span>'
    : '';
  var todayBadge = isToday
    ? '<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#0053e2] text-white">Today</span>'
    : '';

  var body = '';
  if (open) {
    var items = _agendaDayMerged(d);
    body = items.length
      ? '<div class="px-3 pb-3 space-y-1.5">' +
          items.map(function(it) {
            return it.kind === 'spot'
              ? _tripRenderDaySpotRow(d.id, it.data)
              : _tripRenderDayBlockRow(d.id, it.data);
          }).join('') +
        '</div>'
      : '<div class="px-3 pb-3 text-xs text-gray-300 dark:text-zinc-600">Nothing scheduled</div>';
  }

  return '<div class="bg-white dark:bg-zinc-900 rounded-xl border ' +
    (isToday ? 'border-[#0053e2]/50' : 'border-gray-200 dark:border-zinc-800') +
    ' shadow-sm overflow-hidden">' +
    '<button type="button" onclick="tripAgendaToggleDay(' + d.id + ')" ' +
      'class="w-full flex items-center gap-2 px-3 py-3 text-left">' +
      '<span class="text-gray-400 dark:text-zinc-500 text-xs flex-shrink-0">' + (open ? '▾' : '▸') + '</span>' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2 flex-wrap">' +
          '<span class="text-sm font-semibold text-gray-800 dark:text-zinc-100">' +
            _tripEsc(d.day_label || 'Day') + '</span>' + todayBadge + dateLabel +
        '</div>' +
        '<div class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">' + _tripEsc(summary) + '</div>' +
      '</div>' +
    '</button>' +
    body +
  '</div>';
}

// ── Main render ────────────────────────────────────────────────────────────────
window._tripRenderAgenda = function() {
  if (!window._tripPhone) return;
  var el = document.getElementById('trip-agenda-view');
  if (!el) return;
  var days    = (typeof _tripDays !== 'undefined' && _tripDays) ? _tripDays : [];
  var todayId = window._tripResolveTodayDayId();

  var header =
    '<div class="flex items-center gap-2 px-3 pt-3">' +
      '<button onclick="tripAgendaToCards()" ' +
        'class="text-sm text-gray-500 dark:text-zinc-400 hover:text-gray-800 ' +
        'dark:hover:text-zinc-100 transition flex items-center gap-1">← Trips</button>' +
      '<p class="text-sm font-semibold text-gray-700 dark:text-zinc-200 truncate flex-1">🗺️ ' +
        _tripEsc(window._tripActivePlanName || 'Trip') + '</p>' +
      '<button onclick="tripAgendaFullEditor()" ' +
        'class="text-xs px-2.5 py-1 rounded-full border border-gray-200 dark:border-zinc-700 ' +
        'text-gray-500 dark:text-zinc-400 hover:border-[#0053e2] hover:text-[#0053e2] transition">✏️ Edit</button>' +
    '</div>';

  var body = days.length
    // padding-bottom inline (≈6rem) clears the FAB — pb-24 isn't in the bundle.
    ? '<div class="px-3 pt-1 space-y-2" style="padding-bottom:6rem">' +
        days.map(function(d) { return _agendaRenderDay(d, d.id === todayId); }).join('') +
      '</div>'
    : '<div class="px-3 py-12 text-center text-sm text-gray-400 dark:text-zinc-500">' +
        'No days yet. Tap <strong>✏️ Edit</strong> to build your itinerary.</div>';

  el.innerHTML = header + _agendaStatStrip() + body;
  if (typeof window._tripUpdateFab === 'function') window._tripUpdateFab();
};

// ── Phase 2: quick-capture FAB + bottom sheet ──────────────────────────────────
// Show the FAB only while the agenda is the active surface on a phone.
function _tripFabShow(show) {
  var fab = document.getElementById('trip-capture-fab');
  if (fab) fab.style.display = show ? 'flex' : 'none';
}
window._tripUpdateFab = function() {
  var inAgenda = window._tripPhone &&
                 (typeof _tripTab === 'undefined' || _tripTab === 'plan') &&
                 window._tripAgendaActive;
  _tripFabShow(inAgenda);
};

window.tripOpenCaptureSheet = function() {
  var body = document.getElementById('trip-capture-body');
  if (body) {
    body.innerHTML =
      '<div class="tcs-grid">' +
        '<button type="button" class="tcs-opt" onclick="tripCaptureNote()">' +
          '<span>📝</span><span>Note</span></button>' +
        '<button type="button" class="tcs-opt" onclick="tripCaptureExpense()">' +
          '<span>💸</span><span>Expense</span></button>' +
        '<button type="button" class="tcs-opt" onclick="tripCaptureReminder()">' +
          '<span>🔔</span><span>Reminder</span></button>' +
      '</div>';
  }
  var sheet = document.getElementById('trip-capture-sheet');
  if (sheet) sheet.style.display = 'block';
};
window.tripCloseCaptureSheet = function() {
  var sheet = document.getElementById('trip-capture-sheet');
  if (sheet) sheet.style.display = 'none';
};

// Note / Reminder → reuse the existing block modals, targeting today's day.
window.tripCaptureNote = function() {
  tripCloseCaptureSheet();
  var dayId = window._tripResolveTodayDayId();
  if (!dayId) { _tripShowToast('Add a day first — tap ✏️ Edit', true); return; }
  if (typeof tripOpenBlockModal === 'function') tripOpenBlockModal(dayId, 'note', null);
};
window.tripCaptureReminder = function() {
  tripCloseCaptureSheet();
  var dayId = window._tripResolveTodayDayId();
  if (!dayId) { _tripShowToast('Add a day first — tap ✏️ Edit', true); return; }
  if (typeof tripOpenBlockModal === 'function') {
    tripOpenBlockModal(dayId, 'reminder', null);
    // Default the reminder date to today for fast "as it happens" capture.
    setTimeout(function() {
      var dEl = document.getElementById('trip-block-reminder-date');
      if (dEl && !dEl.value) dEl.value = _tripLocalToday();
    }, 60);
  }
};

// Expense → an in-sheet form that appends to the plan's Budget card.
window.tripCaptureExpense = function() {
  var budget = (window._tripPanels || []).filter(function(p) { return p.panel_type === 'budget'; })[0];
  if (!budget) {
    tripCloseCaptureSheet();
    _tripShowToast('Add a Budget card first (in ✏️ Edit)', true);
    return;
  }
  var types = (typeof _TRIP_TYPES !== 'undefined' && _TRIP_TYPES.length) ? _TRIP_TYPES.slice() : ['Other'];
  var opts  = types.map(function(t) { return '<option value="' + _tripEsc(t) + '">' + _tripEsc(t) + '</option>'; }).join('');
  var body  = document.getElementById('trip-capture-body');
  if (!body) return;
  body.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:10px;">' +
      '<input id="tcs-exp-desc" class="tcs-field" type="text" placeholder="What was it for?">' +
      '<div class="tcs-row">' +
        '<input id="tcs-exp-amt" class="tcs-field" type="number" inputmode="decimal" step="0.01" ' +
          'placeholder="Amount" style="flex:1;">' +
        '<select id="tcs-exp-cat" class="tcs-field" style="flex:1;">' + opts + '</select>' +
      '</div>' +
      '<div class="tcs-row" style="margin-top:2px;">' +
        '<button type="button" class="tcs-btn" onclick="tripCloseCaptureSheet()">Cancel</button>' +
        '<button type="button" class="tcs-btn primary" onclick="_tripSaveExpense(' + budget.id + ')">Save expense</button>' +
      '</div>' +
    '</div>';
  setTimeout(function() { var e = document.getElementById('tcs-exp-desc'); if (e) e.focus(); }, 50);
};
window._tripSaveExpense = function(panelId) {
  var desc = ((document.getElementById('tcs-exp-desc') || {}).value || '').trim();
  var amt  = parseFloat(((document.getElementById('tcs-exp-amt') || {}).value || '0')) || 0;
  var cat  = (document.getElementById('tcs-exp-cat') || {}).value || '';
  if (!desc && !amt) { _tripShowToast('Description or amount required', true); return; }
  if (typeof _tppGetPanel !== 'function' || typeof _tppSave !== 'function') {
    _tripShowToast('Budget unavailable', true); return;
  }
  var p = _tppGetPanel(panelId);
  if (!p) { _tripShowToast('Budget card missing', true); return; }
  var d = _tppParse(p.content);
  if (!d.items) d.items = [];
  d.items.push({ label: desc, note: desc, category: cat, amount: amt, reconciled: false });
  _tppSave(panelId, d, function() {
    tripCloseCaptureSheet();
    _tripShowToast('Expense added!');
  });
};
