/* home-page-crm-calendar.js — Calendar view for CRM Homespace page (BookWorm).
   State vars (_crmCalYear, _crmCalMonth, _crmCalSelDay, _crmAllReminders,
   _crmCalRemindersLoaded) are declared in home-page-crm.js so they survive
   repeated HTMX re-nav calls.

   Public API (called from onclick strings in generated HTML):
     crmCalPrev()         — go to previous month
     crmCalNext()         — go to next month
     crmCalToday()        — jump to current month
     crmCalSelectDay(iso) — toggle selection on a day cell

   Entry point: _crmRenderCalendar() — called by _crmRender() in home-page-crm.js.
*/
'use strict';

// ── Contact color palette (10 high-contrast colours, cycled by contact_id) ───
var _CRM_CAL_PALETTE = [
  '#0053e2','#ffc220','#2a8703','#ea1100','#7c3aed',
  '#0891b2','#c2410c','#4f46e5','#047857','#b45309',
];

function _crmCalColor(contactId) {
  return _CRM_CAL_PALETTE[Math.abs(contactId || 0) % _CRM_CAL_PALETTE.length];
}

// ── Date helpers (no UTC-shift — always stay in local time) ──────────────────
var _CRM_CAL_MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
var _CRM_CAL_DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function _crmCalTodayStr() {
  var n = new Date();
  return n.getFullYear() + '-'
    + String(n.getMonth() + 1).padStart(2, '0') + '-'
    + String(n.getDate()).padStart(2, '0');
}

function _crmCalIso(year, month1, day) {
  return year + '-' + String(month1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

// ── Event map: { 'YYYY-MM-DD': [{type, label, contactName, contactId, time}] }
function _crmBuildEventMap() {
  var map = {};

  function add(dateStr, evt) {
    if (!dateStr || dateStr.length !== 10) return;
    if (!map[dateStr]) map[dateStr] = [];
    map[dateStr].push(evt);
  }

  // (a) Date-type custom field values — purely client-side, zero extra fetches
  var todayIso = _crmCalTodayStr();
  var thisYear  = new Date().getFullYear();

  // Detect birthday-like field labels
  function isBirthdayField(label) {
    var l = (label || '').toLowerCase();
    return l === 'birthday' || l === 'birth date' || l === 'dob' ||
           l === 'date of birth' || l.indexOf('birthday') !== -1;
  }

  // Project a stored date to the nearest upcoming occurrence this/next year
  function projectAnnual(storedDate) {
    // storedDate is 'YYYY-MM-DD'; we want 'THISYEAR-MM-DD' or 'NEXTYEAR-MM-DD'
    var parts = storedDate.split('-');
    if (parts.length !== 3) return storedDate;
    var mmdd = parts[1] + '-' + parts[2];
    var candidate = thisYear + '-' + mmdd;
    return candidate < todayIso ? (thisYear + 1) + '-' + mmdd : candidate;
  }

  (_crmFields || []).forEach(function(f) {
    if (f.field_type !== 'date') return;
    var isBday = isBirthdayField(f.label);
    (_crmContacts || []).forEach(function(c) {
      // field_values keys may be numbers or strings depending on how they were set
      var fv  = c.field_values || {};
      var val = fv[f.id] || fv[String(f.id)] || '';
      if (!val || val.length !== 10) return;
      var dateStr = isBday ? projectAnnual(val) : val;
      var label   = isBday ? '\ud83c\udf82 ' + f.label : f.label;
      add(dateStr, { type: isBday ? 'birthday' : 'date-field', label: label,
                     contactName:c.name, contactId:c.id, time:null });
    });
  });

  // (b) Reminders — fetched once per session via /reminders/all
  (_crmAllReminders || []).forEach(function(r) {
    add(r.reminder_date, { type:'reminder', label:r.label,
                           contactName:r.contact_name, contactId:r.contact_id,
                           time:r.reminder_time || null });
  });

  return map;
}

// ── Month grid HTML ──────────────────────────────────────────────────────────
function _crmCalBuildGrid(eventMap) {
  var year     = _crmCalYear;
  var month    = _crmCalMonth;   // 0-based
  var todayStr = _crmCalTodayStr();

  var firstDow    = new Date(year, month, 1).getDay();      // 0=Sun
  var daysInMonth = new Date(year, month + 1, 0).getDate();

  // ── Nav bar ──
  var html = '<div class="flex flex-col p-4 overflow-y-auto">';
  html += '<div class="flex items-center gap-2 mb-4 flex-shrink-0">'
        + '<button onclick="crmCalPrev()" aria-label="Previous month"'
        + ' class="px-2.5 py-1 rounded-lg border border-gray-300 dark:border-zinc-600'
        + ' text-gray-500 dark:text-zinc-400 hover:border-[#0053e2] hover:text-[#0053e2]'
        + ' transition text-sm font-medium">&#9664;</button>'
        + '<h2 class="flex-1 text-center text-sm font-semibold text-gray-800 dark:text-zinc-100">'
        + _CRM_CAL_MONTH_NAMES[month] + ' ' + year + '</h2>'
        + '<button onclick="crmCalNext()" aria-label="Next month"'
        + ' class="px-2.5 py-1 rounded-lg border border-gray-300 dark:border-zinc-600'
        + ' text-gray-500 dark:text-zinc-400 hover:border-[#0053e2] hover:text-[#0053e2]'
        + ' transition text-sm font-medium">&#9654;</button>'
        + '<button onclick="crmCalToday()"'
        + ' class="ml-2 px-3 py-1 rounded-lg border border-gray-300 dark:border-zinc-600'
        + ' text-xs text-gray-500 dark:text-zinc-400 hover:border-[#0053e2] hover:text-[#0053e2]'
        + ' transition font-medium">Today</button>'
        + '</div>';

  // ── 7-column grid ──
  html += '<div class="grid grid-cols-7 border-l border-t'
        + ' border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden flex-shrink-0">';

  // Day-of-week headers
  _CRM_CAL_DOW.forEach(function(d) {
    html += '<div class="text-center text-[10px] font-bold text-gray-400 dark:text-zinc-500'
          + ' uppercase tracking-wider py-1.5'
          + ' border-r border-b border-gray-200 dark:border-zinc-700'
          + ' bg-gray-50 dark:bg-zinc-900/60">' + d + '</div>';
  });

  // Leading empty cells
  for (var e = 0; e < firstDow; e++) {
    html += '<div class="min-h-[5.5rem] border-r border-b border-gray-100 dark:border-zinc-800'
          + ' bg-gray-50/40 dark:bg-zinc-950/30"></div>';
  }

  // Day cells
  for (var day = 1; day <= daysInMonth; day++) {
    var iso    = _crmCalIso(year, month + 1, day);
    var isToday = iso === todayStr;
    var isSel   = iso === _crmCalSelDay;
    var evts    = eventMap[iso] || [];
    var evtLen  = evts.length;

    var numCls = 'w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold'
      + (isToday ? ' bg-[#0053e2] text-white'
        : isSel  ? ' bg-blue-100 dark:bg-blue-900/50 text-[#0053e2] dark:text-blue-300'
                    + ' ring-2 ring-[#0053e2]'
                 : ' text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-700');

    var cellBg = isSel
      ? 'bg-blue-50/50 dark:bg-blue-900/10'
      : 'bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800/50';

    html += '<div onclick="crmCalSelectDay(\'' + iso + '\')"'
          + ' class="min-h-[5.5rem] border-r border-b border-gray-100 dark:border-zinc-800'
          + ' p-1.5 cursor-pointer transition ' + cellBg + '">';
    html += '<div class="' + numCls + '">' + day + '</div>';

    if (evtLen > 0) {
      html += '<div class="mt-1 space-y-0.5">';
      var show = Math.min(evtLen, 3);
      for (var ei = 0; ei < show; ei++) {
        var ev = evts[ei];
        var icon = ev.type === 'reminder' ? '&#128276; ' : '&#128204; ';
        html += '<div class="flex items-center gap-1 leading-tight">'
              + '<span class="w-1.5 h-1.5 rounded-full flex-shrink-0" style="background:'
              + _crmCalColor(ev.contactId) + '"></span>'
              + '<span class="text-[9px] text-gray-600 dark:text-zinc-400 truncate">'
              + icon + _crmEsc(ev.label) + '</span>'
              + '</div>';
      }
      if (evtLen > 3) {
        html += '<div class="text-[9px] text-[#0053e2] dark:text-blue-400 pl-2.5 font-semibold">+'
              + (evtLen - 3) + ' more</div>';
      }
      html += '</div>';
    }

    html += '</div>'; // day cell
  }

  // Trailing empty cells to complete last row
  var totalCells   = firstDow + daysInMonth;
  var trailingCells = (7 - (totalCells % 7)) % 7;
  for (var t = 0; t < trailingCells; t++) {
    html += '<div class="min-h-[5.5rem] border-r border-b border-gray-100 dark:border-zinc-800'
          + ' bg-gray-50/40 dark:bg-zinc-950/30"></div>';
  }

  html += '</div>'; // end 7-col grid

  // Detail panel placeholder (populated by _crmCalRenderDetail)
  html += '<div id="crm-cal-detail" class="mt-4 flex-shrink-0"></div>';
  html += '</div>'; // end outer flex

  return html;
}

// ── Day detail panel ─────────────────────────────────────────────────────────
function _crmCalRenderDetail(eventMap) {
  var el = document.getElementById('crm-cal-detail');
  if (!el) return;

  if (!_crmCalSelDay) {
    el.innerHTML = '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center py-3">'
                 + 'Click a day to see its events</p>';
    return;
  }

  var evts  = eventMap[_crmCalSelDay] || [];
  var parts = _crmCalSelDay.split('-');
  var dispDate = new Date(+parts[0], +parts[1] - 1, +parts[2])
    .toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric', year:'numeric' });

  var html = '<div class="border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">'
           + '<div class="flex items-center gap-2 px-4 py-2.5'
           + ' bg-gray-50 dark:bg-zinc-800/60'
           + ' border-b border-gray-200 dark:border-zinc-700">'
           + '<span class="text-sm font-semibold text-gray-800 dark:text-zinc-100">'
           + _crmEsc(dispDate) + '</span>'
           + '<span class="ml-auto text-xs text-gray-400 dark:text-zinc-500">'
           + evts.length + ' event' + (evts.length !== 1 ? 's' : '') + '</span>'
           + '</div>';

  if (!evts.length) {
    html += '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">No events on this day</p>';
  } else {
    // Sort: reminders first, 🎂 birthdays second, date-fields last
    var sorted = evts.slice().sort(function(a, b) {
      var rank = {reminder:0, birthday:1, 'date-field':2};
      var ra = (rank[a.type] !== undefined ? rank[a.type] : 3);
      var rb = (rank[b.type] !== undefined ? rank[b.type] : 3);
      if (ra !== rb) return ra - rb;
      return (a.time || a.label || '').localeCompare(b.time || b.label || '');
    });

    html += '<div class="divide-y divide-gray-100 dark:divide-zinc-800">';
    sorted.forEach(function(ev) {
      var icon = ev.type === 'reminder' ? '&#128276;' : ev.type === 'birthday' ? '&#127874;' : '&#128204;';
      var rowCls = ev.type === 'birthday' ? ' bg-amber-50 dark:bg-amber-900/10' : '';
      html += '<div class="flex items-start gap-3 px-4 py-3' + rowCls + '">'
            + '<span class="text-base leading-none mt-0.5 shrink-0">' + icon + '</span>'
            + '<span class="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"'
            + ' style="background:' + _crmCalColor(ev.contactId) + '"></span>'
            + '<div class="flex-1 min-w-0">'
            + '<p class="text-xs font-semibold text-gray-800 dark:text-zinc-100 truncate">'
            + _crmEsc(ev.label) + '</p>'
            + '<p class="text-[11px] text-gray-500 dark:text-zinc-400 truncate">'
            + _crmEsc(ev.contactName)
            + (ev.time ? ' &middot; ' + _crmEsc(ev.time) : '')
            + '</p>'
            + '</div></div>';
    });
    html += '</div>';
  }

  html += '</div>';
  el.innerHTML = html;
}

// ── Main async render (entry point from _crmRender) ──────────────────────────
async function _crmRenderCalendar() {
  // Initialise to current month on first render
  if (_crmCalYear === null) {
    var now = new Date();
    _crmCalYear  = now.getFullYear();
    _crmCalMonth = now.getMonth();
  }

  // Lazy-load all reminders once per page session
  if (!_crmCalRemindersLoaded) {
    _crmSetMain(
      '<p class="text-sm text-gray-400 dark:text-zinc-500 text-center mt-12 animate-pulse">'
      + 'Loading calendar\u2026</p>'
    );
    try {
      _crmAllReminders       = await _crmFetch('/home/crm/' + _crmPid + '/reminders/all');
      _crmCalRemindersLoaded = true;
    } catch(e) {
      _crmSetMain(
        '<p class="text-sm text-red-500 text-center mt-12">Failed to load reminders: '
        + _crmEsc(e.message) + '</p>'
      );
      return;
    }
  }

  var eventMap = _crmBuildEventMap();
  _crmSetMain(_crmCalBuildGrid(eventMap));
  _crmCalRenderDetail(eventMap);
}

// ── Public navigation functions (called from onclick in grid HTML) ────────────
function crmCalPrev() {
  _crmCalMonth--;
  if (_crmCalMonth < 0) { _crmCalMonth = 11; _crmCalYear--; }
  _crmCalSelDay = null;
  _crmRenderCalendar();
}

function crmCalNext() {
  _crmCalMonth++;
  if (_crmCalMonth > 11) { _crmCalMonth = 0; _crmCalYear++; }
  _crmCalSelDay = null;
  _crmRenderCalendar();
}

function crmCalToday() {
  var now = new Date();
  _crmCalYear  = now.getFullYear();
  _crmCalMonth = now.getMonth();
  _crmCalSelDay = null;
  _crmRenderCalendar();
}

function crmCalSelectDay(isoDate) {
  // Toggle: clicking the same day deselects
  _crmCalSelDay = (_crmCalSelDay === isoDate) ? null : isoDate;
  var eventMap = _crmBuildEventMap();
  _crmSetMain(_crmCalBuildGrid(eventMap));
  _crmCalRenderDetail(eventMap);
}
