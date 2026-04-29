/**
 * home-page-trip-plan.js — Plan tab: Trip cards → Day lanes → drag-and-drop.
 * Hierarchy: Plan cards (top level) → click into Trip → Day lanes.
 * Depends on _tripPid, _tripFetch, _tripShowToast, _tripEsc (home-page-trip.js).
 * All state uses var (HTMX-safe).
 */

// ── Module state ──────────────────────────────────────────────────────────────
var _tripPlans               = [];
var _tripPlanEditing         = null;  // null = add mode, int = plan id being edited
var _tripPlanUploadedCoverUrl = '';   // URL returned by upload-cover endpoint

var _tripDays         = [];
var _tripDayEditing   = null;   // null = add mode, int = day id being edited
var _tripPlanMode     = 'view'; // 'edit' | 'view'

// Panels — populated by home-page-trip-panels.js via window._tripLoadPanels()
window._tripPanels    = [];

// Active plan — exposed on window so home-page-trip.js topbar can branch
window._tripActivePlanId   = null;
window._tripActivePlanName = '';

// ── Day card size (slider controls width; height is derived proportionally) ──────
var _TRIP_DAY_W_KEY     = 'bw-trip-day-card-width';
var _tripDayCardWidth   = parseInt(localStorage.getItem(_TRIP_DAY_W_KEY) || '256', 10);

// Height scales with width at a 1.8× ratio, capped at the visible viewport.
function _tripDayCardHeight() {
  return Math.min(Math.round(_tripDayCardWidth * 1.8), window.innerHeight - 192);
}

window.tripToggleMode = function() {
  _tripPlanMode = _tripPlanMode === 'edit' ? 'view' : 'edit';
  _tripRenderDaysToolbar();
  _tripRenderPlan();
};

window.tripSetDayCardWidth = function(w) {
  _tripDayCardWidth = parseInt(w, 10);
  try { localStorage.setItem(_TRIP_DAY_W_KEY, _tripDayCardWidth); } catch(e) {}
  // Update all rendered lanes live — no full re-render needed
  var h = _tripDayCardHeight() + 'px';
  document.querySelectorAll('.trip-day-lane-card, .trip-panel-card').forEach(function(el) {
    el.style.width  = _tripDayCardWidth + 'px';
    el.style.height = h;
  });
};

function _tripSyncSizeSlider() {
  var sl = document.getElementById('trip-day-size-slider');
  if (sl) sl.value = _tripDayCardWidth;
}

// ── Day-block state ───────────────────────────────────────────────────────────────
var _tripBlocks              = {};    // day_id → array of block dicts
var _tripBlockEditing        = null;  // null | {dayId, blockId}
var _tripBlockEditingType    = null;  // block_type string while modal is open
var _tripBlockPickerDayId    = null;  // which lane's picker is open
var _tripPickerListenerAdded = false; // guard: only attach document click once
var _tripDragSrcBlockDayId   = null;
var _tripDragSrcBlockId      = null;

// One-time document listener: click outside closes the type-picker popover
if (!_tripPickerListenerAdded) {
  _tripPickerListenerAdded = true;
  document.addEventListener('click', function() {
    var el = document.getElementById('trip-block-picker-popover');
    if (el) { el.remove(); _tripBlockPickerDayId = null; }
  });
}

// ── Time helpers ───────────────────────────────────────────────────────────
// _normalizeTime: accepts loose user input → stores as HH:MM (24h).
// Handles: "9", "9am", "9:30", "9:30am", "2:30 PM", "14:30".
// Falls back to raw string so no data is ever silently discarded.
function _normalizeTime(v) {
  v = (v || '').trim();
  if (!v) return '';
  // Already HH:MM or H:MM (24h) — pass through normalised
  if (/^\d{1,2}:\d{2}$/.test(v)) {
    var parts = v.split(':');
    return parts[0].padStart(2,'0') + ':' + parts[1];
  }
  // 12h with AM/PM: "9:30 AM", "9:30AM", "9:30pm", "2 PM", "2pm"
  var m12 = v.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (m12) {
    var h   = parseInt(m12[1], 10);
    var min = m12[2] || '00';
    if (/pm/i.test(m12[3]) && h !== 12) h += 12;
    if (/am/i.test(m12[3]) && h === 12) h  = 0;
    return String(h).padStart(2,'0') + ':' + min;
  }
  // Bare hour: "9" → "09:00"
  if (/^\d{1,2}$/.test(v)) return String(parseInt(v,10)).padStart(2,'0') + ':00';
  return v; // unrecognised — store as-is, _formatTime will display it raw
}

// _formatTime: HH:MM (24h) → "H:MM AM/PM" for lane display.
// Falls back to raw value so old data is never broken.
function _formatTime(v) {
  if (!v) return '';
  var m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return v;
  var h   = parseInt(m[1], 10);
  var min = m[2];
  return (h % 12 || 12) + ':' + min + ' ' + (h >= 12 ? 'PM' : 'AM');
}

// ── Note CE formatter ────────────────────────────────────────────────────
// Called by toolbar buttons (onmousedown=preventDefault keeps CE focused).
// Mirrors the CE branch of mdFmt in note_form.html.
// Color palette: key → { border hex, light-mode bg, dark-mode bg }
// Inline styles used at render time (avoids Tailwind purge of dynamic classes).
var _TRIP_NOTE_COLORS = {
  amber:  { border: '#f59e0b', bg: '#fffbeb', bgDark: 'rgba(120,53,15,0.18)' },
  blue:   { border: '#3b82f6', bg: '#eff6ff', bgDark: 'rgba(30,58,138,0.18)' },
  green:  { border: '#22c55e', bg: '#f0fdf4', bgDark: 'rgba(20,83,45,0.18)'  },
  rose:   { border: '#f43f5e', bg: '#fff1f2', bgDark: 'rgba(136,19,55,0.18)' },
  purple: { border: '#a855f7', bg: '#faf5ff', bgDark: 'rgba(88,28,135,0.18)' },
  sky:    { border: '#0ea5e9', bg: '#f0f9ff', bgDark: 'rgba(12,74,110,0.18)' },
};

window._tripNoteCeFmt = function(type) {
  var ce = document.getElementById('trip-block-note-ce');
  if (!ce) return;
  // Mirrors _applyCE in slash_commands.js:
  // Windows/Chrome deactivates the CE selection on mouseup even when focus
  // hasn't moved. Defer via setTimeout so all mouse events have settled,
  // then re-focus + restore the last known range before firing execCommand.
  var savedRange = ce._bwSavedRange || null;
  setTimeout(function() {
    ce.focus();
    if (savedRange) {
      try {
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } catch (_) { /* range stale — ignore, cursor will be at end */ }
    }
    if (type === 'bold')        { document.execCommand('bold'); }
    else if (type === 'italic') { document.execCommand('italic'); }
    else if (type === 'strike') { document.execCommand('strikeThrough'); }
    else if (type === 'h1')     { document.execCommand('formatBlock', false, 'H1'); }
    else if (type === 'h2')     { document.execCommand('formatBlock', false, 'H2'); }
    else if (type === 'ul')     { _tripNoteInsertList('ul'); }
    else if (type === 'ol')     { _tripNoteInsertList('ol'); }
  }, 0);
};

// Direct DOM list insertion — more reliable than execCommand inside a modal CE.
// Creates <ul><li> or <ol><li> around the current block and parks caret inside.
function _tripNoteInsertList(tag) {
  var sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  var range = sel.getRangeAt(0);
  var node  = range.startContainer;
  var ce    = document.getElementById('trip-block-note-ce');
  if (!ce) return;
  // Find the block element containing the caret
  var block = (node.nodeType === 3) ? node.parentElement : node;
  var BLOCKS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
  while (block && block !== ce && !BLOCKS.includes(block.tagName)) {
    block = block.parentElement;
  }
  var list = document.createElement(tag);
  var li   = document.createElement('li');
  if (block && block !== ce) {
    // Preserve existing text (if any) in the new <li>
    li.innerHTML = block.innerHTML || '<br>';
    list.appendChild(li);
    block.parentNode.replaceChild(list, block);
  } else {
    // Fallback: append new empty list at end of CE
    li.innerHTML = '<br>';
    list.appendChild(li);
    ce.appendChild(list);
  }
  // Park caret at start of the new <li>
  var r = document.createRange();
  r.selectNodeContents(li);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// ── Note CE init: render markdown → HTML, wire slash commands + fmt toolbar ──────
// Mirrors _tripSpotNotesInit in home-page-trip.js.
function _tripNoteInit(markdown) {
  var ce = document.getElementById('trip-block-note-ce');
  if (!ce) return;
  if (markdown && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    marked.use({ gfm: true, breaks: true });
    ce.innerHTML = DOMPurify.sanitize(marked.parse(markdown));
  } else {
    // Always seed with a <p> so the cursor lands inside a block element.
    // Without this, formatBlock and the auto-bullet block-walker both break.
    ce.innerHTML = '<p><br></p>';
  }
  if (typeof window.bwSlashAttachCE === 'function') window.bwSlashAttachCE(ce);
  if (typeof window.bwFmtAttach     === 'function') window.bwFmtAttach(ce);

  // ---- One-time event wiring (survives modal reopen) ----
  if (!ce._bwTripNoteWired) {
    ce._bwTripNoteWired = true;

    // Track last-known selection so _tripNoteCeFmt can restore it after
    // the toolbar-button mouseup deactivates the CE selection on Windows.
    function _saveRange() {
      var s = window.getSelection();
      if (!s || !s.rangeCount) return;
      try { ce._bwSavedRange = s.getRangeAt(0).cloneRange(); } catch (_) {}
    }
    ce.addEventListener('mouseup', _saveRange);
    ce.addEventListener('keyup',   _saveRange);

    // CE-level auto-list: intercepts `- ` + Space BEFORE the global handler
    // and converts the current line to a proper <ul><li> using direct DOM
    // manipulation. The global handler's execCommand path is unreliable in
    // modal CEs on Windows, so we stopPropagation to prevent it running.
    ce.addEventListener('keydown', function(e) {
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return;

      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
      var range = sel.getRangeAt(0);
      var node  = range.startContainer;

      // Walk to the nearest block ancestor inside CE
      var block = (node.nodeType === 3) ? node.parentElement : node;
      var BLOCKS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
      while (block && block !== ce && !BLOCKS.includes(block.tagName)) {
        block = block.parentElement;
      }
      if (!block || block === ce) return;

      var text = block.textContent.trim();

      if (text === '-') {
        e.preventDefault();
        e.stopPropagation(); // prevent global handler double-processing
        _tripNoteReplaceBlockWithList(block, ce, 'ul');
        return;
      }
      if (text === '1.') {
        e.preventDefault();
        e.stopPropagation();
        _tripNoteReplaceBlockWithList(block, ce, 'ol');
      }
    }, true); // capture phase — fires before global document handler

    // Tab / Shift+Tab inside a <li> → indent / dedent the list item.
    // Without this, Tab escapes to the Cancel button (browser default focus-move).
    ce.addEventListener('keydown', function(e) {
      if (typeof window._bwCeTabIndent === 'function') window._bwCeTabIndent(e);
    });
  }
}

// Replace a block element with a <ul>/<ol> list and park caret in the first <li>.
function _tripNoteReplaceBlockWithList(block, ce, tag) {
  var list = document.createElement(tag);
  var li   = document.createElement('li');
  li.innerHTML = '<br>';
  list.appendChild(li);
  (block.parentNode || ce).replaceChild(list, block);
  var r = document.createRange();
  r.selectNodeContents(li);
  r.collapse(true);
  var sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(r); }
}

// ── Note CE → Markdown for persistence ──────────────────────────────────
// Mirrors _tripSpotNotesToMd in home-page-trip.js.
function _tripNoteToMd() {
  var ce = document.getElementById('trip-block-note-ce');
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

// ── Color swatch picker ───────────────────────────────────────────────
window._tripNotePickColor = function(btn) {
  document.querySelectorAll('#trip-block-note-modal [data-note-color]').forEach(function(sw) {
    sw.classList.remove('ring-2', 'ring-offset-1',
      'ring-amber-400', 'ring-blue-400', 'ring-green-400',
      'ring-rose-400',  'ring-purple-400', 'ring-sky-400');
  });
  btn.classList.add('ring-2', 'ring-offset-1', 'ring-' + btn.dataset.noteColor + '-400');
};

function _tripNotePreview(text) {
  if (!text) return '';
  // Take first non-empty line
  var line = '';
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    line = lines[i].trim();
    if (line) break;
  }
  // Strip leading markdown syntax: headings, list markers, blockquote, code fence
  line = line
    .replace(/^#{1,6}\s+/, '')   // # Heading
    .replace(/^[-*+]\s+/, '')    // - bullet
    .replace(/^\d+\.\s+/, '')    // 1. ordered
    .replace(/^>\s*/, '')        // > blockquote
    .replace(/^`{1,3}/, '')      // ` code
    .replace(/\*\*(.*?)\*\*/g, '$1')   // **bold**
    .replace(/\*(.*?)\*/g, '$1')       // *italic*
    .replace(/~~(.*?)~~/g, '$1')       // ~~strike~~
    .replace(/`(.*?)`/g, '$1')         // `code`
    .trim();
  if (line.length > 70) line = line.substring(0, 68) + '…';
  return line;
}


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
      if (typeof window._tripRenderPlanFilterBar === 'function') window._tripRenderPlanFilterBar();
      _tripRenderPlanCards();
    })
    .catch(function() { _tripShowToast('Failed to load trips', true); });
}

function _tripRenderPlanCards() {
  var grid = document.getElementById('trip-plans-grid');
  if (!grid) return;

  // Apply filter/sort ops from filters module (may be identity if no filter active)
  var visible = (typeof window._tripApplyPlanOps === 'function')
    ? window._tripApplyPlanOps(_tripPlans)
    : _tripPlans;

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

  if (!visible.length) {
    grid.innerHTML =
      '<div class="col-span-full text-center py-16 text-gray-400 dark:text-zinc-500 text-sm">' +
        '🔍 No trips match the filter.' +
      '</div>';
    return;
  }

  // When a custom sort is active, render flat (filter already applied above).
  // When on default sort, group by status (applying filter to each group).
  var _planSortByVal = typeof _planSortBy !== 'undefined' ? _planSortBy : 'default';

  if (_planSortByVal !== 'default') {
    grid.innerHTML = visible.map(_tripRenderPlanCard).join('');
    return;
  }

  // ── Grouped by status (default sort) ─────────────────────────────────────────
  var groups = { active: [], upcoming: [], past: [], undated: [] };
  visible.forEach(function(p) { groups[_tripPlanStatus(p).key].push(p); });

  function byDate(field, asc) {
    return function(a, b) {
      var av = a[field] || '', bv = b[field] || '';
      return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    };
  }
  groups.active.sort(byDate('end_date', true));
  groups.upcoming.sort(byDate('start_date', true));
  groups.past.sort(byDate('end_date', false));

  var SECTIONS = [
    { key: 'active',   emoji: '✈️', label: 'Happening Now',
      cls: 'text-green-600 dark:text-green-400 border-green-200 dark:border-green-900' },
    { key: 'upcoming', emoji: '📅', label: 'Upcoming',
      cls: 'text-[#0053e2] dark:text-blue-400 border-blue-200 dark:border-blue-900' },
    { key: 'past',     emoji: '🗂️', label: 'Past Trips',
      cls: 'text-gray-400 dark:text-zinc-500 border-gray-200 dark:border-zinc-800' },
    { key: 'undated',  emoji: '📋', label: 'No Date Set',
      cls: 'text-gray-400 dark:text-zinc-500 border-gray-200 dark:border-zinc-800' },
  ];

  var html = '';
  SECTIONS.forEach(function(sec) {
    var plans = groups[sec.key];
    if (!plans.length) return;
    html +=
      '<div class="col-span-full flex items-center gap-2 mt-4 mb-1 first:mt-0">' +
        '<span class="text-xs font-bold uppercase tracking-wider ' + sec.cls + '">' +
          sec.emoji + ' ' + sec.label +
          ' <span class="font-normal normal-case opacity-70">('+plans.length+')</span>' +
        '</span>' +
        '<div class="flex-1 border-t ' + sec.cls + '"></div>' +
      '</div>';
    html += plans.map(_tripRenderPlanCard).join('');
  });
  grid.innerHTML = html;
}

// ── Status helpers ──────────────────────────────────────────────────────────
function _tripPlanStatus(p) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var todayStr = today.toISOString().slice(0, 10);
  var s = p.start_date || null;
  var e = p.end_date   || null;
  if (!s && !e) return { key: 'undated' };
  if (s && e) {
    if (todayStr >= s && todayStr <= e) return { key: 'active' };
    if (todayStr < s)                  return { key: 'upcoming' };
    return { key: 'past' };
  }
  if (s && !e) return todayStr < s ? { key: 'upcoming' } : { key: 'active' };
  /* !s && e */  return todayStr <= e ? { key: 'upcoming' } : { key: 'past' };
}

// Format ISO date → "Jun 15, 2025"
function _tripFmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) { return iso; }
}

// Build a human-readable countdown/progress string
function _tripPlanMeta(p) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var status = _tripPlanStatus(p);

  if (status.key === 'active' && p.start_date && p.end_date) {
    var dayN    = Math.floor((today - new Date(p.start_date + 'T12:00:00')) / 86400000) + 1;
    var totalD  = Math.round((new Date(p.end_date + 'T12:00:00') - new Date(p.start_date + 'T12:00:00')) / 86400000) + 1;
    return '• Day ' + dayN + ' of ' + totalD;
  }
  if (status.key === 'upcoming' && p.start_date) {
    var ms   = new Date(p.start_date + 'T12:00:00') - today;
    var days = Math.ceil(ms / 86400000);
    if (days === 0)  return '• Tomorrow';
    if (days <= 30)  return '• In ' + days + ' day' + (days !== 1 ? 's' : '');
    var months = Math.round(days / 30.4);
    return '• In ~' + months + ' month' + (months !== 1 ? 's' : '');
  }
  if (status.key === 'past' && p.end_date) {
    var msAgo   = today - new Date(p.end_date + 'T12:00:00');
    var daysAgo = Math.floor(msAgo / 86400000);
    if (daysAgo <= 30)  return '• ' + daysAgo + ' day' + (daysAgo !== 1 ? 's' : '') + ' ago';
    var moAgo = Math.round(daysAgo / 30.4);
    return '• ' + moAgo + ' month' + (moAgo !== 1 ? 's' : '') + ' ago';
  }
  return '';
}

function _tripRenderPlanCard(p) {
  var safeName = _tripEsc(p.plan_name);
  var jsName   = safeName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  var status   = _tripPlanStatus(p);
  var meta     = _tripPlanMeta(p);

  var BADGE = {
    active:   '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] ' +
               'font-semibold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">' +
               '✈️ Active</span>',
    upcoming: '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] ' +
               'font-semibold bg-blue-100 dark:bg-blue-900/40 text-[#0053e2] dark:text-blue-400">' +
               '📅 Upcoming</span>',
    past:     '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] ' +
               'font-semibold bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">' +
               '🗂️ Past</span>',
    undated:  '',
  };

  var fStart = _tripFmtDate(p.start_date);
  var fEnd   = _tripFmtDate(p.end_date);
  var dateRange = (fStart || fEnd)
    ? '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 flex items-center gap-1">' +
        (fStart || '') + (fStart && fEnd ? ' → ' : '') + (fEnd || '') +
        (meta ? ' <span class="text-[10px] opacity-70">' + _tripEsc(meta) + '</span>' : '') +
      '</p>'
    : '';

  var descHtml = p.plan_desc
    ? '<p class="text-xs text-gray-500 dark:text-zinc-400 mt-1 line-clamp-2">' +
        _tripEsc(p.plan_desc) + '</p>'
    : '';
  var dayLabel = p.day_count + ' day' + (p.day_count !== 1 ? 's' : '');

  // ── Cover image or gradient placeholder ────────────────────────────────────
  var cover = p.cover_url
    ? '<div class="relative h-36 bg-gray-100 dark:bg-zinc-800 overflow-hidden">' +
        '<img src="' + _tripEsc(p.cover_url) + '" alt="" ' +
             'class="w-full h-full object-cover" ' +
             'onerror="this.parentNode.style.display=\'none\'">' +
        // Status badge overlaid on cover top-right
        (BADGE[status.key]
          ? '<div class="absolute top-2 right-2">' + BADGE[status.key] + '</div>'
          : '') +
        // Edit/delete overlay on cover top-left
        '<div class="absolute top-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" ' +
             'onclick="event.stopPropagation()">' +
          '<button onclick="tripOpenEditPlan(' + p.id + ')" ' +
            'class="bg-black/50 text-white rounded-full w-6 h-6 text-xs flex items-center ' +
                   'justify-center hover:bg-black/70 transition" title="Edit trip">✏️</button>' +
          '<button onclick="tripConfirmDeletePlan(' + p.id + ',\'' + jsName + '\')" ' +
            'class="bg-black/50 text-white rounded-full w-6 h-6 text-xs flex items-center ' +
                   'justify-center hover:bg-red-600/80 transition" title="Delete trip">🗑️</button>' +
        '</div>' +
      '</div>'
    : '<div class="h-28 flex items-center justify-center bg-gradient-to-br ' +
        (status.key === 'active'
          ? 'from-green-50 to-emerald-100 dark:from-zinc-800 dark:to-zinc-900'
          : status.key === 'past'
            ? 'from-gray-50 to-gray-100 dark:from-zinc-800 dark:to-zinc-900'
            : 'from-blue-50 to-indigo-100 dark:from-zinc-800 dark:to-zinc-900') +
        ' text-5xl select-none">🗺️</div>';

  var cardBorder = status.key === 'active'
    ? 'border-green-300 dark:border-green-700'
    : status.key === 'past'
      ? 'border-gray-200 dark:border-zinc-800 opacity-80'
      : 'border-gray-200 dark:border-zinc-800';

  // When no cover: badge + edit/delete go in the body header row
  var headerActions = p.cover_url ? '' :
    '<div class="flex flex-col items-end gap-1.5 flex-shrink-0">' +
      (BADGE[status.key] || '') +
      '<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" ' +
           'onclick="event.stopPropagation()">' +
        '<button onclick="tripOpenEditPlan(' + p.id + ')" ' +
          'class="text-gray-400 hover:text-[#0053e2] transition text-xs" ' +
          'title="Edit trip">✏️</button>' +
        '<button onclick="tripConfirmDeletePlan(' + p.id + ',\'' + jsName + '\')" ' +
          'class="text-gray-400 hover:text-red-500 transition text-xs ml-0.5" ' +
          'title="Delete trip">🗑️</button>' +
      '</div>' +
    '</div>';

  return '<div class="bg-white dark:bg-zinc-900 rounded-xl border shadow-sm overflow-hidden ' +
    'cursor-pointer group hover:shadow-md hover:border-[#0053e2]/40 transition-all ' + cardBorder + '" ' +
    'onclick="tripOpenPlan(' + p.id + ',\'' + jsName + '\')">' +
    cover +
    '<div class="p-4">' +
      '<div class="flex items-start justify-between gap-2">' +
        '<div class="flex-1 min-w-0">' +
          '<p class="font-semibold text-gray-800 dark:text-zinc-100 truncate text-sm">' +
            '🗺️ ' + safeName +
          '</p>' +
          dateRange + descHtml +
        '</div>' +
        headerActions +
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

  // Show card-width slider now that Day lanes are visible
  var sizeWrap = document.getElementById('trip-day-size-wrap');
  var sl       = document.getElementById('trip-day-size-slider');
  if (sizeWrap) { sizeWrap.classList.remove('hidden'); sizeWrap.classList.add('flex'); }
  if (sl)       { sl.value = _tripDayCardWidth; }

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

  // Hide card-width slider — not relevant on the trip cards grid
  var sizeWrap = document.getElementById('trip-day-size-wrap');
  if (sizeWrap) { sizeWrap.classList.add('hidden'); sizeWrap.classList.remove('flex'); }

  _loadPlans();
  if (typeof _tripRenderTopbarControls === 'function') _tripRenderTopbarControls();
};

function _tripRenderDaysToolbar() {
  var tb = document.getElementById('trip-plan-toolbar');
  if (!tb) return;
  var isEdit   = _tripPlanMode === 'edit';
  var modeLbl  = isEdit ? '👁️ View' : '✏️ Edit';
  var modeCls  = isEdit
    ? 'text-xs px-2.5 py-1 rounded-full border border-gray-200 dark:border-zinc-700 ' +
      'text-gray-500 dark:text-zinc-400 hover:border-[#0053e2] hover:text-[#0053e2] ' +
      'dark:hover:text-blue-400 transition'
    : 'text-xs px-2.5 py-1 rounded-full bg-[#0053e2] text-white ' +
      'hover:bg-[#0046c0] transition font-medium';
  tb.innerHTML =
    '<button onclick="tripClosePlan()" ' +
      'class="flex items-center gap-1 text-sm text-gray-500 dark:text-zinc-400 ' +
             'hover:text-gray-800 dark:hover:text-zinc-100 transition">' +
      '← Trips' +
    '</button>' +
    '<span class="text-gray-300 dark:text-zinc-600 select-none">|</span>' +
    '<p class="text-sm font-semibold text-gray-700 dark:text-zinc-200 truncate flex-1">' +
      '🗓️ ' + _tripEsc(window._tripActivePlanName) +
    '</p>' +
    '<button onclick="tripToggleMode()" class="' + modeCls + '" title="Switch mode">' +
      modeLbl +
    '</button>';
}

// ── Day list ──────────────────────────────────────────────────────────────────
function _loadDaysForPlan(planId) {
  _tripFetch('/home/trip/' + _tripPid + '/days?plan_id=' + planId)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _tripDays   = Array.isArray(data) ? data : [];
      _tripBlocks = {};
      var promises = _tripDays.map(function(d) {
        return _tripFetch('/home/trip/' + _tripPid + '/days/' + d.id + '/blocks')
          .then(function(r) { return r.json(); })
          .then(function(blocks) {
            _tripBlocks[d.id] = Array.isArray(blocks) ? blocks : [];
          });
      });
      return Promise.all(promises);
    })
    .then(function() {
      _tripRenderPlan();
      if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
      // Panels module (home-page-trip-panels.js) — defensive guard
      if (typeof window._tripLoadPanels === 'function') {
        window._tripLoadPanels(planId);
      }
    })
    .catch(function() { _tripShowToast('Failed to load plan', true); });
}

// ── Itinerary collapse state ─────────────────────────────────────────────────────
var _ITIN_LS_KEY = 'bw-trip-itin-open';
function _itinIsOpen() { return localStorage.getItem(_ITIN_LS_KEY) !== 'false'; }
window.tripToggleItinCollapse = function() {
  localStorage.setItem(_ITIN_LS_KEY, _itinIsOpen() ? 'false' : 'true');
  var row     = document.getElementById('trip-days-row');
  var chevron = document.getElementById('trip-itin-chevron');
  var btn     = document.getElementById('trip-itin-toggle-btn');
  if (!row || !chevron) return;
  var open = _itinIsOpen();
  row.classList.toggle('hidden', !open);
  chevron.textContent = open ? '▾' : '▸';
  if (btn) btn.setAttribute('aria-expanded', String(open));
};

// ── Render all day lanes ────────────────────────────────────────────────────
function _tripRenderPlan() {
  var container = document.getElementById('trip-days-container');
  if (!container) return;

  var itinOpen = _itinIsOpen();

  // Days group — always rendered (may show empty state)
  var dayCardsHtml = _tripDays.length
    ? _tripDays.map(_tripRenderDayLane).join('')
    : '<div class="flex flex-col items-center justify-center h-40 ' +
        'text-gray-400 dark:text-zinc-500 text-center px-4" style="width:220px">' +
        '<span class="text-sm">📅 No days yet.</span>' +
        '<span class="text-xs mt-1">Click <strong>＋ Add Day</strong> to build your itinerary.</span>' +
      '</div>';

  container.innerHTML =
    '<div id="trip-days-group" class="flex flex-col flex-shrink-0 gap-1">' +
      '<button type="button" id="trip-itin-toggle-btn" onclick="tripToggleItinCollapse()" ' +
        'aria-expanded="' + itinOpen + '" ' +
        'class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest ' +
               'text-gray-400 dark:text-zinc-500 px-1 pb-0.5 select-none ' +
               'hover:text-gray-600 dark:hover:text-zinc-300 transition w-fit">' +
        '<span id="trip-itin-chevron">' + (itinOpen ? '▾' : '▸') + '</span>' +
        '<span>📅 Itinerary</span>' +
      '</button>' +
      '<div id="trip-days-row" class="flex flex-wrap gap-4 pb-2' + (itinOpen ? '' : ' hidden') + '">' +
        dayCardsHtml +
      '</div>' +
    '</div>';

  // Panel cards group (home-page-trip-panels.js) — defensive guard
  if (typeof window._tripRenderPanelCards === 'function') {
    window._tripRenderPanelCards(container);
  }
  _tripSyncSizeSlider();
}

function _tripRenderDayLane(d) {
  var isEdit = _tripPlanMode === 'edit';

  // Merge spots + blocks into one sorted list
  var allItems = [];
  (d.spots || []).forEach(function(s) {
    allItems.push({kind: 'spot',  order_idx: s.sort_order || 0, data: s});
  });
  (_tripBlocks[d.id] || []).forEach(function(b) {
    allItems.push({kind: 'block', order_idx: b.order_idx, data: b});
  });
  allItems.sort(function(a, b) { return a.order_idx - b.order_idx; });

  var emptyHint = isEdit
    ? '<div class="trip-drop-hint text-xs text-center text-gray-300 dark:text-zinc-600 py-6 px-3 ' +
        'border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-lg">' +
        'No items yet —<br>use <strong>＋ Add</strong> below</div>'
    : '<p class="text-xs text-center text-gray-300 dark:text-zinc-600 py-6">Nothing scheduled</p>';

  var itemsHtml = allItems.length
    ? allItems.map(function(item) {
        return item.kind === 'spot'
          ? _tripRenderDaySpotRow(d.id, item.data)
          : _tripRenderDayBlockRow(d.id, item.data);
      }).join('')
    : emptyHint;

  var dateLabel = d.day_date
    ? '<span class="text-[10px] text-gray-400 dark:text-zinc-500 ml-1">' +
        _tripEsc(d.day_date) + '</span>'
    : '';

  // Header: edit controls only in edit mode
  var headerBtns = isEdit
    ? '<button onclick="tripOpenEditDay(' + d.id + ')" ' +
        'class="text-gray-400 hover:text-[#0053e2] transition text-xs">✏️</button>' +
      '<button onclick="tripConfirmDeleteDay(' + d.id + ',\'' +
        _tripEsc((d.day_label || 'Day').replace(/'/g, "\\'")) + '\')" ' +
        'class="text-gray-400 hover:text-red-500 transition text-xs ml-0.5">🗑️</button>'
    : '';

  // Drop zone attrs only in edit mode
  var dropAttrs = isEdit
    ? 'ondragover="tripDragDayOver(event,' + d.id + ')" ' +
      'ondragleave="tripDragDayLeave(event,' + d.id + ')" ' +
      'ondrop="tripDragDayDrop(event,' + d.id + ')"'
    : '';

  // ＋ Add footer only in edit mode
  var footer = isEdit
    ? '<div class="flex-shrink-0 px-2 pb-2 pt-1">' +
        '<button onclick="tripToggleBlockPicker(' + d.id + ', event)" ' +
          'class="w-full text-xs text-gray-400 dark:text-zinc-500 ' +
                 'hover:text-[#0053e2] dark:hover:text-blue-400 transition ' +
                 'border border-dashed border-gray-200 dark:border-zinc-700 ' +
                 'rounded-lg py-1 hover:border-[#0053e2]/40">' +
          '＋ Add</button>' +
      '</div>'
    : '';

  return '<div class="trip-day-lane-card flex-shrink-0 bg-white dark:bg-zinc-900 rounded-xl ' +
    'border border-gray-200 dark:border-zinc-800 flex flex-col overflow-hidden ' +
    'shadow-sm" style="width:' + _tripDayCardWidth + 'px;height:' + _tripDayCardHeight() + 'px;max-height:calc(100vh - 12rem);">' +
    '<div class="flex items-center gap-1 px-3 py-2 ' +
      'border-b border-gray-100 dark:border-zinc-800 flex-shrink-0">' +
      '<p class="text-sm font-semibold text-gray-700 dark:text-zinc-200 flex-1 truncate">' +
        _tripEsc(d.day_label || 'Day') + dateLabel +
      '</p>' +
      headerBtns +
    '</div>' +
    '<div id="trip-day-lane-' + d.id + '" ' +
      'class="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-16" ' +
      dropAttrs + '>' +
      itemsHtml +
    '</div>' +
    footer +
  '</div>';
}

function _tripRenderDaySpotRow(dayId, s) {
  var isEdit = _tripPlanMode === 'edit';
  var emoji  = (typeof _TRIP_TYPE_EMOJI !== 'undefined' && _TRIP_TYPE_EMOJI[s.spot_type]) || '📍';
  var timeLabel = s.time_label
    ? '<span class="text-[10px] text-[#0053e2] dark:text-blue-400 font-medium">' +
        _tripEsc(_formatTime(s.time_label)) + '</span>'
    : '';

  if (!isEdit) {
    return '<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg ' +
      'bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 ' +
      'cursor-pointer hover:border-[#0053e2]/40 hover:bg-blue-50/30 ' +
      'dark:hover:bg-blue-900/10 transition" ' +
      'onclick="tripViewDetail(\'spot\',' + dayId + ',' + s.tds_id + ')">' +
      '<span class="text-base flex-shrink-0">' + emoji + '</span>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate">' +
          _tripEsc(s.name) + '</p>' +
        timeLabel +
      '</div>' +
      '<span class="text-gray-300 dark:text-zinc-600 text-[10px] flex-shrink-0">›</span>' +
    '</div>';
  }

  // Edit mode — always-visible action buttons, drag enabled
  return '<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg ' +
    'bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 cursor-grab active:cursor-grabbing" ' +
    'draggable="true" ' +
    'data-tds-id="' + s.tds_id + '" ' +
    'ondragstart="tripDragDaySpotStart(event,' + dayId + ',' + s.tds_id + ')" ' +
    'ondragover="tripDragDaySpotOver(event)" ' +
    'ondrop="tripDragLaneItemDrop(event,' + dayId + ',null,' + s.tds_id + ')">' +
    '<span class="text-base flex-shrink-0">' + emoji + '</span>' +
    '<div class="flex-1 min-w-0">' +
      '<p class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate">' +
        _tripEsc(s.name) + '</p>' +
      timeLabel +
    '</div>' +
    '<button onclick="tripEditDaySpotTime(' + dayId + ',' + s.spot_id + ',' + s.tds_id + ')" ' +
      'title="Set time" ' +
      'class="text-[10px] text-gray-400 hover:text-[#0053e2] transition">🕐</button>' +
    '<button onclick="tripRemoveSpotFromDay(' + dayId + ',' + s.spot_id + ')" ' +
      'class="text-[10px] text-gray-400 hover:text-red-500 transition">✕</button>' +
  '</div>';
}

// ── Day block row renderer ────────────────────────────────────────────────────────────
function _tripRenderDayBlockRow(dayId, b) {
  var isEdit = _tripPlanMode === 'edit';
  var c = {};
  try { c = JSON.parse(b.content); } catch(e) {}

  var dragAttrs = isEdit
    ? 'draggable="true" data-block-id="' + b.id + '" ' +
      'ondragstart="tripDragBlockStart(event,' + dayId + ',' + b.id + ')" ' +
      'ondragover="tripDragDaySpotOver(event)" ' +
      'ondrop="tripDragLaneItemDrop(event,' + dayId + ',' + b.id + ',null)"'
    : 'data-block-id="' + b.id + '"';

  var editBtn = isEdit
    ? '<button onclick="tripOpenBlockModal(' + dayId + ',\'' + b.block_type +
        '\',' + b.id + ')" class="text-[10px] text-gray-400 hover:text-[#0053e2] transition">✏️</button>'
    : '';
  var delBtn  = isEdit
    ? '<button onclick="tripDeleteBlock(' + dayId + ',' + b.id + ')" ' +
        'class="text-[10px] text-gray-400 hover:text-red-500 transition">🗑️</button>'
    : '';
  // itemCls: drag cursor in edit, tap cursor + hover in view (via class, not style)
  var itemCls;
  if (isEdit) {
    itemCls = ' group cursor-grab active:cursor-grabbing';
  } else if (b.block_type !== 'divider') {
    itemCls = ' cursor-pointer hover:opacity-90 transition-opacity';
  } else {
    itemCls = '';
  }
  var viewClick = (!isEdit && b.block_type !== 'divider')
    ? 'onclick="tripViewDetail(\'block\',' + dayId + ',' + b.id + ')"'
    : '';
  var viewChevron = (!isEdit && b.block_type !== 'divider')
    ? '<span class="text-gray-300 dark:text-zinc-600 text-[10px] flex-shrink-0 ml-auto">›</span>'
    : '';
  var timeSpan = b.time_label
    ? '<span class="text-[10px] text-[#0053e2] dark:text-blue-400 font-medium">' +
        _tripEsc(_formatTime(b.time_label)) + '</span>'
    : '';

  if (b.block_type === 'note') {
    var preview = _tripEsc(_tripNotePreview(c.text || ''));
    var nc  = _TRIP_NOTE_COLORS[c.color] || _TRIP_NOTE_COLORS.amber;
    var dark = document.documentElement.classList.contains('dark');
    var cardStyle = 'border-left:4px solid ' + nc.border + ';background:' +
                    (dark ? nc.bgDark : nc.bg) + ';padding:6px 8px;';
    return '<div class="flex items-start gap-2 rounded-lg' + itemCls + '" ' +
      'style="' + cardStyle + '" ' + viewClick + ' ' + dragAttrs + '>' +
      '<span class="text-sm flex-shrink-0 mt-0.5">📝</span>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-xs text-gray-700 dark:text-zinc-200 truncate leading-snug">' +
          (preview || '<span class="italic text-gray-400">(empty)</span>') + '</p>' +
        timeSpan +
      '</div>' +
      editBtn + delBtn + viewChevron +
    '</div>';
  }

  if (b.block_type === 'drive') {
    var mapLink = c.map_url
      ? ' <a href="' + _tripEsc(c.map_url) + '" target="_blank" rel="noopener" ' +
          'onclick="event.stopPropagation()" class="text-[10px] text-[#0053e2] hover:underline">🗺️</a>'
      : '';
    var meta = (c.duration || c.distance)
      ? '<p class="text-[10px] text-gray-400 dark:text-zinc-500">' +
          [c.duration, c.distance].filter(Boolean).join(' · ') + mapLink + '</p>'
      : (c.map_url ? '<p class="text-[10px]">' + mapLink + '</p>' : '');
    return '<div class="flex items-start gap-2 px-2 py-1.5 rounded-lg' + itemCls + ' ' +
      'border border-dashed border-blue-300 dark:border-blue-700 ' +
      'bg-blue-50/50 dark:bg-blue-900/10" ' + viewClick + ' ' + dragAttrs + '>' +
      '<span class="text-sm flex-shrink-0 mt-0.5">🚗</span>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate">' +
          _tripEsc(c.from || '') + ' → ' + _tripEsc(c.to || '') + '</p>' +
        meta + timeSpan +
      '</div>' +
      editBtn + delBtn + viewChevron +
    '</div>';
  }

  if (b.block_type === 'bookmark') {
    return '<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg' + itemCls + ' ' +
      'bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700" ' + viewClick + ' ' + dragAttrs + '>' +
      '<span class="text-sm flex-shrink-0">🔖</span>' +
      '<div class="flex-1 min-w-0">' +
        '<a href="' + _tripEsc(c.url || '#') + '" target="_blank" rel="noopener" ' +
          'onclick="event.stopPropagation()" ' +
          'class="text-xs font-medium text-[#0053e2] dark:text-blue-400 hover:underline truncate block">' +
          _tripEsc(c.title || c.url || '') + '</a>' +
        timeSpan +
      '</div>' +
      editBtn + delBtn + viewChevron +
    '</div>';
  }

  if (b.block_type === 'divider') {
    var divEditBtns = isEdit
      ? '<button onclick="tripOpenBlockModal(' + dayId + ',\'divider\',' + b.id + ')" ' +
          'class="text-[10px] text-gray-300 dark:text-zinc-600 hover:text-gray-500 transition">✏️</button>' +
        '<button onclick="tripDeleteBlock(' + dayId + ',' + b.id + ')" ' +
          'class="text-[10px] text-gray-300 dark:text-zinc-600 hover:text-red-400 transition">×</button>'
      : '';
    return '<div class="flex items-center gap-2 py-1 select-none" data-block-id="' + b.id + '">' +
      '<hr class="flex-1 border-gray-200 dark:border-zinc-700">' +
      (c.label
        ? '<span class="text-[10px] text-gray-400 dark:text-zinc-500 whitespace-nowrap font-medium">' +
            _tripEsc(c.label) + '</span>' +
          '<hr class="flex-1 border-gray-200 dark:border-zinc-700">'
        : '') +
      divEditBtns +
    '</div>';
  }

  if (b.block_type === 'panel_ref') {
    // panel_ref: only delete is valid — no editable modal exists for this type
    var panelRefDel = isEdit
      ? '<button onclick="event.stopPropagation();tripDeleteBlock(' + dayId + ',' + b.id + ')" ' +
          'class="text-[10px] text-gray-400 hover:text-red-500 transition">🗑️</button>'
      : '';
    // Synced reference to a Quick Card — resolve live panel data if available
    var panelId  = c.panel_id;
    var refTitle = c.title      || 'Quick Card';
    var refIcon  = c.icon       || '📋';
    var refType  = c.panel_type || '';
    var livePanel = null;
    (window._tripPanels || []).forEach(function(x) { if (x.id === panelId) livePanel = x; });
    if (livePanel) {
      var cfg2 = (typeof _TPP_TYPES !== 'undefined') ? (_TPP_TYPES[livePanel.panel_type] || {}) : {};
      refTitle = livePanel.title || cfg2.label || refTitle;
      refIcon  = cfg2.icon  || refIcon;
      refType  = livePanel.panel_type || refType;
    }
    var syncBadge = refType
      ? '<span class="ml-1 text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded ' +
          'bg-blue-100 dark:bg-blue-900/40 text-[#0053e2] dark:text-blue-300">sync</span>'
      : '';
    return '<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg' + itemCls + ' ' +
      'border border-blue-200 dark:border-blue-800 ' +
      'bg-blue-50/40 dark:bg-blue-900/10 cursor-pointer" ' + dragAttrs +
      ' onclick="if(typeof tppShowPanelRefPopup===\'function\')tppShowPanelRefPopup(' + panelId + ')">' +
      '<span class="text-base flex-shrink-0">' + _tripEsc(refIcon) + '</span>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate flex items-center">' +
          _tripEsc(refTitle) + syncBadge +
        '</p>' +
        timeSpan +
      '</div>' +
      panelRefDel +
    '</div>';
  }

  return '';
}

// ── Type-picker popover ───────────────────────────────────────────────────────────────────
window.tripToggleBlockPicker = function(dayId, event) {
  event.stopPropagation();
  var existing = document.getElementById('trip-block-picker-popover');
  if (existing && _tripBlockPickerDayId === dayId) {
    existing.remove(); _tripBlockPickerDayId = null; return;
  }
  if (existing) existing.remove();
  _tripBlockPickerDayId = dayId;

  var el = document.createElement('div');
  el.id        = 'trip-block-picker-popover';
  el.className = 'fixed z-40 bg-white dark:bg-zinc-900 rounded-xl shadow-xl ' +
    'border border-gray-200 dark:border-zinc-700 p-2 flex gap-1';
  el.innerHTML =
    _tripBlockPickerBtn('📝', 'Note',     dayId, 'note')    +
    _tripBlockPickerBtn('🚗', 'Drive',    dayId, 'drive')   +
    _tripBlockPickerBtn('🔖', 'Bookmark', dayId, 'bookmark') +
    _tripBlockPickerBtn('─',  'Divider',  dayId, 'divider');

  var rect = event.currentTarget.getBoundingClientRect();
  el.style.position = 'fixed';
  el.style.top      = (rect.top - 64) + 'px';
  el.style.left     = rect.left + 'px';
  document.body.appendChild(el);
};

function _tripBlockPickerBtn(emoji, label, dayId, type) {
  return '<button onclick="tripOpenBlockModal(' + dayId + ',\'' + type + '\',null)" ' +
    'class="flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg ' +
           'hover:bg-gray-100 dark:hover:bg-zinc-800 transition text-center min-w-[3rem]">' +
    '<span class="text-lg leading-tight">' + emoji + '</span>' +
    '<span class="text-[9px] text-gray-500 dark:text-zinc-400 leading-none">' + label + '</span>' +
  '</button>';
}

// ── Block modal open / close / submit ─────────────────────────────────────────────────────
window.tripOpenBlockModal = function(dayId, blockType, blockIdOrData) {
  var picker = document.getElementById('trip-block-picker-popover');
  if (picker) { picker.remove(); _tripBlockPickerDayId = null; }

  // blockIdOrData may be a numeric ID (from edit button onclick) or null
  var existingBlock = null;
  if (blockIdOrData) {
    var bid = parseInt(blockIdOrData, 10);
    (_tripBlocks[dayId] || []).forEach(function(b) {
      if (b.id === bid) existingBlock = b;
    });
  }

  _tripBlockEditing     = existingBlock ? {dayId: dayId, blockId: existingBlock.id} : null;
  _tripBlockEditingType = blockType;
  // Remember which day we're adding to (for submit)
  if (!existingBlock) _tripBlockPickerDayId = dayId;

  if (existingBlock) {
    var c = {}; try { c = JSON.parse(existingBlock.content); } catch(e) {}
    _tripFillBlockModal(blockType, existingBlock.time_label || '', c);
  } else {
    _tripClearBlockModal(blockType);
  }

  document.getElementById('trip-block-' + blockType + '-modal').classList.remove('hidden');
  setTimeout(function() {
    if (blockType === 'note') {
      // CE editor — slash commands + fmt toolbar already wired by _tripNoteInit.
      // Just focus and place cursor at end.
      var ce = document.getElementById('trip-block-note-ce');
      if (ce) {
        ce.focus();
        var r = document.createRange();
        r.selectNodeContents(ce);
        r.collapse(false);
        var s = window.getSelection();
        if (s) { s.removeAllRanges(); s.addRange(r); }
      }
    } else {
      var first = document.querySelector('#trip-block-' + blockType + '-modal input');
      if (first) first.focus();
    }
  }, 50);
};

window.tripCloseBlockModal = function(blockType) {
  document.getElementById('trip-block-' + blockType + '-modal').classList.add('hidden');
  _tripBlockEditing     = null;
  _tripBlockEditingType = null;
};

window.tripSubmitBlock = function(blockType) {
  var dayId = _tripBlockEditing ? _tripBlockEditing.dayId : _tripBlockPickerDayId;
  if (!dayId) { _tripShowToast('No day selected', true); return; }

  var content = _tripCollectBlockContent(blockType);
  if (content === null) return;

  var tlEl      = document.getElementById('trip-block-' + blockType + '-time');
  var timeLabel = _normalizeTime(tlEl ? tlEl.value : '');

  var fd = new URLSearchParams();
  fd.append('block_type', blockType);
  fd.append('content',    JSON.stringify(content));
  fd.append('time_label', timeLabel);

  var url    = '/home/trip/' + _tripPid + '/days/' + dayId + '/blocks';
  var method = 'POST';
  if (_tripBlockEditing) {
    url    += '/' + _tripBlockEditing.blockId;
    method  = 'PUT';
  }

  _tripFetch(url, {method: method, body: fd})
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { _tripShowToast(d.error, true); return; }
      tripCloseBlockModal(blockType);
      tripLoadPlan();
      _tripShowToast(_tripBlockEditing ? 'Updated!' : 'Added!');
    })
    .catch(function() { _tripShowToast('Save failed', true); });
};

function _tripCollectBlockContent(blockType) {
  if (blockType === 'note') {
    var text = _tripNoteToMd();
    if (!text.trim()) { _tripShowToast('Note text is required', true); return null; }
    var colorPicked = document.querySelector('#trip-block-note-modal [data-note-color].ring-2');
    return { text: text.trim(), color: colorPicked ? colorPicked.dataset.noteColor : 'amber' };
  }
  if (blockType === 'drive') {
    var from = (document.getElementById('trip-block-drive-from') || {}).value || '';
    var to   = (document.getElementById('trip-block-drive-to')   || {}).value || '';
    if (!from.trim() || !to.trim()) { _tripShowToast('From and To are required', true); return null; }
    return {
      from:     from.trim(),
      to:       to.trim(),
      duration: ((document.getElementById('trip-block-drive-duration') || {}).value || '').trim(),
      distance: ((document.getElementById('trip-block-drive-distance') || {}).value || '').trim(),
      map_url:  ((document.getElementById('trip-block-drive-map')      || {}).value || '').trim(),
    };
  }
  if (blockType === 'bookmark') {
    var title = (document.getElementById('trip-block-bookmark-title') || {}).value || '';
    var burl  = (document.getElementById('trip-block-bookmark-url')   || {}).value || '';
    if (!title.trim() || !burl.trim()) { _tripShowToast('Title and URL are required', true); return null; }
    return {title: title.trim(), url: burl.trim()};
  }
  if (blockType === 'divider') {
    var label = (document.getElementById('trip-block-divider-label') || {}).value || '';
    return {label: label.trim()};
  }
  return {};
}

function _tripFillBlockModal(blockType, timeLabel, c) {
  var tl = document.getElementById('trip-block-' + blockType + '-time');
  if (tl) tl.value = timeLabel;
  if (blockType === 'note') {
    _tripNoteInit(c.text || '');
    // Restore color swatch selection
    var savedColor = c.color || 'amber';
    document.querySelectorAll('#trip-block-note-modal [data-note-color]').forEach(function(sw) {
      sw.classList.toggle('ring-2', sw.dataset.noteColor === savedColor);
      sw.classList.toggle('ring-offset-1', sw.dataset.noteColor === savedColor);
    });
  } else if (blockType === 'drive') {
    var ids = ['from','to','duration','distance','map'];
    ids.forEach(function(k) {
      var fld = document.getElementById('trip-block-drive-' + k);
      if (fld) fld.value = (k === 'map' ? c.map_url : c[k]) || '';
    });
  } else if (blockType === 'bookmark') {
    var t = document.getElementById('trip-block-bookmark-title');
    var u = document.getElementById('trip-block-bookmark-url');
    if (t) t.value = c.title || '';
    if (u) u.value = c.url   || '';
  } else if (blockType === 'divider') {
    var l = document.getElementById('trip-block-divider-label');
    if (l) l.value = c.label || '';
  }
}

function _tripClearBlockModal(blockType) {
  var modal = document.getElementById('trip-block-' + blockType + '-modal');
  if (!modal) return;
  modal.querySelectorAll('input').forEach(function(el) { el.value = ''; });
  if (blockType === 'note') {
    _tripNoteInit(''); // clear + re-wire CE
    // Reset to default color (amber)
    document.querySelectorAll('#trip-block-note-modal [data-note-color]').forEach(function(sw) {
      var isAmber = sw.dataset.noteColor === 'amber';
      sw.classList.toggle('ring-2', isAmber);
      sw.classList.toggle('ring-offset-1', isAmber);
    });
  }
}

// ── Block delete ──────────────────────────────────────────────────────────────────────────
window.tripDeleteBlock = function(dayId, blockId) {
  _tripFetch(
    '/home/trip/' + _tripPid + '/days/' + dayId + '/blocks/' + blockId,
    {method: 'DELETE'}
  ).then(function() { tripLoadPlan(); })
   .catch(function() { _tripShowToast('Delete failed', true); });
};

// ── Unified drag-reorder (blocks + spots mixed) ───────────────────────────────────────
window.tripDragBlockStart = function(event, dayId, blockId) {
  event.stopPropagation();
  event.dataTransfer.setData('bw-block-id', String(blockId));
  event.dataTransfer.effectAllowed = 'move';
  _tripDragSrcBlockDayId = dayId;
  _tripDragSrcBlockId    = blockId;
};

// Drop target: blockId is the block we're dropping onto; tdsId is a spot we're dropping onto
window.tripDragLaneItemDrop = function(event, dayId, targetBlockId, targetTdsId) {
  event.preventDefault();
  event.stopPropagation();
  // Only reorder within same lane
  var isSrcBlock = !!_tripDragSrcBlockId;
  var isSrcSpot  = !!_tripDragSrcTdsId;
  if (!isSrcBlock && !isSrcSpot) return;
  if (isSrcBlock && _tripDragSrcBlockDayId !== dayId) return;

  var lane = document.getElementById('trip-day-lane-' + dayId);
  if (!lane) return;

  // Read current DOM order by scanning data-tds-id and data-block-id
  var items = [];
  lane.querySelectorAll('[data-tds-id], [data-block-id]').forEach(function(el) {
    if (el.dataset.tdsId) {
      items.push({kind: 'spot',  id: parseInt(el.dataset.tdsId, 10)});
    } else if (el.dataset.blockId) {
      items.push({kind: 'block', id: parseInt(el.dataset.blockId, 10)});
    }
  });

  // Locate source index
  var srcIdx = -1;
  if (isSrcBlock) {
    srcIdx = items.findIndex(function(i) {
      return i.kind === 'block' && i.id === _tripDragSrcBlockId;
    });
  } else {
    srcIdx = items.findIndex(function(i) {
      return i.kind === 'spot' && i.id === _tripDragSrcTdsId;
    });
  }

  var targetIdx = -1;
  if (targetBlockId) {
    targetIdx = items.findIndex(function(i) {
      return i.kind === 'block' && i.id === targetBlockId;
    });
  } else if (targetTdsId) {
    targetIdx = items.findIndex(function(i) {
      return i.kind === 'spot' && i.id === targetTdsId;
    });
  }

  if (srcIdx < 0 || targetIdx < 0 || srcIdx === targetIdx) {
    _tripDragSrcBlockDayId = null; _tripDragSrcBlockId = null;
    return;
  }

  var moved = items.splice(srcIdx, 1)[0];
  items.splice(targetIdx, 0, moved);

  var payload = items.map(function(item, idx) {
    return {kind: item.kind, id: item.id, order_idx: idx * 10};
  });

  _tripDragSrcBlockDayId = null; _tripDragSrcBlockId = null; _tripDragSrcTdsId = null;

  _tripFetch('/home/trip/' + _tripPid + '/days/' + dayId + '/blocks/reorder', {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({items: payload}),
  }).then(function() { tripLoadPlan(); })
    .catch(function() { _tripShowToast('Reorder failed', true); });
};

// ── View-mode detail drawer ────────────────────────────────────────────────────────────────────
// Slides up from the bottom when the user clicks an item in View mode.
// Reads all data from in-memory module state — no extra fetch needed.

function _tripMdToHtml(text) {
  if (!text) return '';
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    marked.use({ gfm: true, breaks: true });
    return DOMPurify.sanitize(marked.parse(text));
  }
  return _tripEsc(text).replace(/\n/g, '<br>');
}

// ── Close ────────────────────────────────────────────────────────────────────
window.tripCloseDetailDrawer = function() {
  var bd = document.getElementById('trip-detail-backdrop');
  var dr = document.getElementById('trip-detail-drawer');
  if (dr && dr._escHandler) document.removeEventListener('keydown', dr._escHandler);
  if (bd) bd.style.opacity   = '0';
  if (dr) { dr.style.opacity = '0'; dr.style.transform = 'scale(0.96)'; }
  setTimeout(function() {
    var b = document.getElementById('trip-detail-backdrop');
    var d = document.getElementById('trip-detail-drawer');
    if (b) b.remove();
    if (d) d.remove();
  }, 200);
};

// _tripShowDrawer(contentHtml)
// Renders a centred popup modal; close button always pinned top-right.
function _tripShowDrawer(contentHtml) {
  // Dismiss any existing modal synchronously
  var oldBd = document.getElementById('trip-detail-backdrop');
  var oldDr = document.getElementById('trip-detail-drawer');
  if (oldDr && oldDr._escHandler) document.removeEventListener('keydown', oldDr._escHandler);
  if (oldBd) oldBd.remove();
  if (oldDr) oldDr.remove();

  var dk = document.documentElement.classList.contains('dark');

  // Backdrop — full-screen dimmer, click outside to close
  var bd = document.createElement('div');
  bd.id = 'trip-detail-backdrop';
  bd.style.cssText =
    'position:fixed;inset:0;z-index:40;' +
    'background:rgba(0,0,0,0.5);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);' +
    'display:flex;align-items:center;justify-content:center;padding:20px;' +
    'transition:opacity 180ms;opacity:0';
  bd.setAttribute('aria-hidden', 'true');
  // Click on backdrop itself (not the panel) closes
  bd.addEventListener('click', function(e) {
    if (e.target === bd) window.tripCloseDetailDrawer();
  });
  document.body.appendChild(bd);

  // Panel
  var dr = document.createElement('div');
  dr.id = 'trip-detail-drawer';
  dr.setAttribute('role', 'dialog');
  dr.setAttribute('aria-modal', 'true');
  dr.style.cssText =
    'position:relative;z-index:50;' +
    'width:100%;max-width:480px;max-height:85vh;' +
    'border-radius:16px;overflow:hidden;' +
    'display:flex;flex-direction:column;' +
    'box-shadow:0 8px 48px rgba(0,0,0,0.28);' +
    'background:' + (dk ? '#18181b' : '#ffffff') + ';' +
    'transition:opacity 180ms,transform 180ms cubic-bezier(.4,0,.2,1);' +
    'opacity:0;transform:scale(0.96)';

  // Close button — absolute top-right, always visible
  var closeBtn = document.createElement('button');
  closeBtn.id          = 'trip-detail-close-btn';
  closeBtn.innerHTML   = '×';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.onclick     = window.tripCloseDetailDrawer;
  closeBtn.style.cssText =
    'position:absolute;top:10px;right:12px;z-index:60;' +
    'width:30px;height:30px;border-radius:50%;border:none;cursor:pointer;' +
    'font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.35);color:#fff;' +
    'transition:background 150ms';
  closeBtn.onmouseover = function() { this.style.background = 'rgba(0,0,0,0.55)'; };
  closeBtn.onmouseout  = function() { this.style.background = 'rgba(0,0,0,0.35)'; };

  // Scrollable content
  var scroll = document.createElement('div');
  scroll.style.cssText = 'flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:28px';
  scroll.innerHTML     = contentHtml;

  dr.appendChild(closeBtn);
  dr.appendChild(scroll);
  bd.appendChild(dr);

  // ESC key
  dr._escHandler = function(e) {
    if (e.key === 'Escape') window.tripCloseDetailDrawer();
  };
  document.addEventListener('keydown', dr._escHandler);

  // Animate in
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      bd.style.opacity   = '1';
      dr.style.opacity   = '1';
      dr.style.transform = 'scale(1)';
    });
  });
}

window.tripViewDetail = function(kind, dayId, id) {
  var dk = document.documentElement.classList.contains('dark');
  var C  = {
    text:    dk ? '#e4e4e7' : '#111827',
    sub:     dk ? '#a1a1aa' : '#6b7280',
    bg:      dk ? '#27272a' : '#f3f4f6',
    border:  dk ? '#3f3f46' : '#e5e7eb',
    accent:  '#0053e2',
    cardBg:  dk ? '#1f1f23' : '#ffffff',
  };
  var px = 'padding:0 20px';

  // ── SPOT ────────────────────────────────────────────────────────────────────
  if (kind === 'spot') {
    var day = null;
    _tripDays.forEach(function(d) { if (d.id === dayId) day = d; });
    var ds = null;
    if (day) (day.spots || []).forEach(function(s) { if (s.tds_id === id) ds = s; });
    if (!ds) return;

    // Augment from _tripSpots if Research tab was visited
    var spot = null;
    (typeof _tripSpots !== 'undefined' ? _tripSpots : []).forEach(function(s) {
      if (s.id === ds.spot_id) spot = s;
    });
    var name     = (spot && spot.name)            || ds.name        || '';
    var spotType = (spot && spot.spot_type)       || ds.spot_type   || '';
    var coverUrl = (spot && spot.cover_url)       || ds.cover_url   || '';
    var priority = spot ? spot.priority           : ds.priority;
    var estCost  = (spot && spot.estimated_cost)  || ds.estimated_cost || 0;
    var currency = (spot && spot.currency)        || ds.currency    || '';
    var mapUrl   = spot ? (spot.map_url  || '')   : '';
    var attrs    = spot ? (spot.attrs    || [])   : [];
    var notes    = spot ? (spot.notes    || '')   : '';

    var emoji = (typeof _TRIP_TYPE_EMOJI !== 'undefined' && _TRIP_TYPE_EMOJI[spotType]) || '📍';
    var tc    = (typeof _tripTypeColor   !== 'undefined') ? _tripTypeColor(spotType)    : C.accent;
    var stars = (typeof _tripStars       !== 'undefined') ? _tripStars(priority, ds.spot_id) : '';

    // Cover: full-bleed image OR coloured emoji banner
    var cover = coverUrl
      ? '<div style="width:100%;height:180px;overflow:hidden;background:#e5e7eb;flex-shrink:0">' +
          '<img src="' + _tripEsc(coverUrl) + '" alt="" ' +
               'style="width:100%;height:100%;object-fit:cover" ' +
               'onerror="this.parentNode.style.display=\'none\'">' +
        '</div>'
      : '<div style="width:100%;height:96px;display:flex;align-items:center;justify-content:center;' +
          'font-size:52px;flex-shrink:0;' +
          'background:' + (dk ? 'linear-gradient(135deg,#27272a,#18181b)' : 'linear-gradient(135deg,#eff6ff,#e0e7ff)') + '">' +
          emoji +
        '</div>';

    // Type badge
    var badge =
      '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;' +
             'padding:2px 8px;border-radius:99px;color:#fff;font-weight:600;' +
             'background:' + tc + '">' +
        emoji + ' ' + _tripEsc(spotType) +
      '</span>';

    // Chips row (time + cost)
    var chips = [];
    if (ds.time_label) {
      chips.push('<span style="font-size:12px;font-weight:500;color:' + C.accent + '">🕒 ' +
        _tripEsc(_formatTime(ds.time_label)) + '</span>');
    }
    if (estCost > 0) {
      chips.push('<span style="font-size:12px;color:' + C.sub + '">💰 ' +
        _tripEsc(currency) + ' ' + Number(estCost).toFixed(2) + '</span>');
    }
    var chipsRow = chips.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px">' + chips.join('') + '</div>'
      : '';

    // Map button
    var mapBtn = mapUrl
      ? '<a href="' + _tripEsc(mapUrl) + '" target="_blank" rel="noopener noreferrer" ' +
          'style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;' +
                 'padding:9px 18px;border-radius:10px;color:#fff;text-decoration:none;' +
                 'background:' + C.accent + ';margin-top:16px">' +
          '📍 Open in Maps</a>'
      : '';

    // Attributes grid
    var attrsHtml = '';
    if (attrs.length) {
      attrsHtml =
        '<div style="margin-top:20px;' + px + '">' +
          '<p style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +
                   'color:' + C.sub + ';margin-bottom:8px">Details</p>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          attrs.map(function(a) {
            return '<div style="background:' + C.bg + ';border-radius:10px;padding:10px 12px">' +
              '<p style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;' +
                       'color:' + C.sub + ';margin:0 0 3px">' + _tripEsc(a.attr_key) + '</p>' +
              '<p style="font-size:13px;font-weight:500;color:' + C.text + ';margin:0">' +
                _tripEsc(a.attr_value) + '</p>' +
            '</div>';
          }).join('') +
          '</div>' +
        '</div>';
    }

    // Notes section
    var notesHtml = '';
    if (notes && notes.trim()) {
      notesHtml =
        '<div style="margin-top:20px;' + px + '">' +
          '<p style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +
                   'color:' + C.sub + ';margin-bottom:8px">Notes</p>' +
          '<div class="md-body" style="font-size:14px;line-height:1.65;color:' + C.text + '">' +
            _tripMdToHtml(notes) +
          '</div>' +
        '</div>';
    }

    _tripShowDrawer(
      cover +
      '<div style="' + px + ';padding-top:16px">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' + badge + stars + '</div>' +
        '<h2 style="margin:8px 0 0;font-size:20px;font-weight:700;line-height:1.3;color:' + C.text + '">' +
          _tripEsc(name) + '</h2>' +
        chipsRow +
        (mapBtn ? '<div>' + mapBtn + '</div>' : '') +
      '</div>' +
      attrsHtml +
      notesHtml
    );
    return;
  }

  // ── BLOCK ─────────────────────────────────────────────────────────────────
  if (kind === 'block') {
    var blocks = _tripBlocks[dayId] || [];
    var blk    = null;
    blocks.forEach(function(b) { if (b.id === id) blk = b; });
    if (!blk) return;

    var bc = {};
    try { bc = JSON.parse(blk.content); } catch(e) {}
    var timeChip = blk.time_label
      ? '<span style="font-size:12px;font-weight:500;color:' + C.accent + '">🕒 ' +
          _tripEsc(_formatTime(blk.time_label)) + '</span>'
      : '';

    // ── NOTE ──
    if (blk.block_type === 'note') {
      var nc = (typeof _TRIP_NOTE_COLORS !== 'undefined' && _TRIP_NOTE_COLORS[bc.color])
                || { border: '#f59e0b', bg: '#fffbeb', bgDark: '#1c180a' };
      _tripShowDrawer(
        '<div style="' + px + ';padding-top:20px;padding-bottom:8px;' +
             'display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<span style="font-size:24px">📝</span>' +
          '<span style="font-size:17px;font-weight:700;color:' + C.text + '">Note</span>' +
          timeChip +
        '</div>' +
        '<div style="' + px + ';padding-bottom:24px">' +
          '<div style="border-left:4px solid ' + nc.border + ';padding:12px 16px;border-radius:0 10px 10px 0;' +
               'background:' + (dk ? nc.bgDark : nc.bg) + '">' +
            '<div class="md-body" style="font-size:14px;line-height:1.7;color:' + C.text + '">' +
              _tripMdToHtml(bc.text || '(empty)') +
            '</div>' +
          '</div>' +
        '</div>'
      );
      return;
    }

    // ── DRIVE ──
    if (blk.block_type === 'drive') {
      var fromTo =
        '<div style="display:flex;align-items:center;gap:0;margin-top:4px">' +
          '<div style="flex:1;background:' + C.bg + ';border-radius:10px 0 0 10px;padding:12px 14px;' +
               'border:1px solid ' + C.border + ';border-right:none">' +
            '<p style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;' +
                     'color:' + C.sub + ';margin:0 0 2px">From</p>' +
            '<p style="font-size:14px;font-weight:500;color:' + C.text + ';margin:0">' +
              _tripEsc(bc.from || '—') + '</p>' +
          '</div>' +
          '<div style="font-size:20px;color:' + C.sub + ';padding:0 6px;flex-shrink:0">→</div>' +
          '<div style="flex:1;background:' + C.bg + ';border-radius:0 10px 10px 0;padding:12px 14px;' +
               'border:1px solid ' + C.border + ';border-left:none">' +
            '<p style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;' +
                     'color:' + C.sub + ';margin:0 0 2px">To</p>' +
            '<p style="font-size:14px;font-weight:500;color:' + C.text + ';margin:0">' +
              _tripEsc(bc.to || '—') + '</p>' +
          '</div>' +
        '</div>';
      var driveMeta = (bc.duration || bc.distance)
        ? '<p style="font-size:13px;color:' + C.sub + ';margin-top:10px">' +
            [bc.duration, bc.distance].filter(Boolean).join(' · ') + '</p>'
        : '';
      var routeBtn = bc.map_url
        ? '<a href="' + _tripEsc(bc.map_url) + '" target="_blank" rel="noopener" ' +
            'style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;' +
                   'padding:9px 18px;border-radius:10px;color:#fff;text-decoration:none;' +
                   'background:' + C.accent + ';margin-top:16px">' +
            '🗺️ Open Route</a>'
        : '';
      _tripShowDrawer(
        '<div style="' + px + ';padding-top:20px;padding-bottom:8px;' +
             'display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<span style="font-size:24px">🚗</span>' +
          '<span style="font-size:17px;font-weight:700;color:' + C.text + '">Drive</span>' +
          timeChip +
        '</div>' +
        '<div style="' + px + ';padding-bottom:24px">' +
          fromTo + driveMeta +
          (routeBtn ? '<div>' + routeBtn + '</div>' : '') +
        '</div>'
      );
      return;
    }

    // ── BOOKMARK ──
    if (blk.block_type === 'bookmark') {
      var openBtn = bc.url
        ? '<a href="' + _tripEsc(bc.url) + '" target="_blank" rel="noopener" ' +
            'style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;' +
                   'padding:9px 18px;border-radius:10px;color:#fff;text-decoration:none;' +
                   'background:' + C.accent + ';margin-top:16px">' +
            '🔗 Open Link</a>'
        : '';
      _tripShowDrawer(
        '<div style="' + px + ';padding-top:20px;padding-bottom:8px;' +
             'display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<span style="font-size:24px">🔖</span>' +
          '<span style="font-size:17px;font-weight:700;color:' + C.text + '">Bookmark</span>' +
          timeChip +
        '</div>' +
        '<div style="' + px + ';padding-bottom:24px">' +
          '<p style="font-size:16px;font-weight:600;color:' + C.text + ';margin:0 0 8px">' +
            _tripEsc(bc.title || '') + '</p>' +
          (bc.url
            ? '<p style="font-size:12px;color:' + C.sub + ';word-break:break-all;margin:0">' +
                _tripEsc(bc.url) + '</p>'
            : '') +
          (openBtn ? '<div>' + openBtn + '</div>' : '') +
        '</div>'
      );
      return;
    }
  }
};

// ── Plan modal (Add / Edit Trip) ──────────────────────────────────────────────
// ── Plan modal helpers ─────────────────────────────────────────────────────────
function _tripPlanResetCoverUI() {
  _tripPlanUploadedCoverUrl = '';
  var urlIn = document.getElementById('trip-plan-cover-url');
  var prev  = document.getElementById('trip-plan-cover-preview');
  var fi    = document.getElementById('trip-plan-cover-file');
  var stat  = document.getElementById('trip-plan-upload-status');
  if (urlIn) urlIn.value = '';
  if (prev)  prev.classList.add('hidden');
  if (fi)    fi.value = '';
  if (stat)  stat.textContent = '';
  _tripPlanCoverTabSwitch('url');
}

function _tripPlanSetCoverPreview(url) {
  var img  = document.getElementById('trip-plan-cover-img');
  var prev = document.getElementById('trip-plan-cover-preview');
  if (img && prev && url) {
    img.src = url;
    prev.classList.remove('hidden');
  } else if (prev) {
    prev.classList.add('hidden');
  }
}

function _tripPlanCoverTabSwitch(tab) {
  var urlWrap  = document.getElementById('trip-plan-cover-url-wrap');
  var fileWrap = document.getElementById('trip-plan-cover-file-wrap');
  var tabUrl   = document.getElementById('trip-plan-tab-url');
  var tabFile  = document.getElementById('trip-plan-tab-file');
  var activeCls   = ['bg-white','dark:bg-zinc-700','text-gray-800','dark:text-zinc-100','shadow-sm'];
  var inactiveCls = ['text-gray-500','dark:text-zinc-400','hover:text-gray-700'];
  if (tab === 'url') {
    if (urlWrap)  urlWrap.classList.remove('hidden');
    if (fileWrap) fileWrap.classList.add('hidden');
    if (tabUrl)   { activeCls.forEach(function(c){tabUrl.classList.add(c);}); inactiveCls.forEach(function(c){tabUrl.classList.remove(c);}); }
    if (tabFile)  { inactiveCls.forEach(function(c){tabFile.classList.add(c);}); activeCls.forEach(function(c){tabFile.classList.remove(c);}); }
  } else {
    if (urlWrap)  urlWrap.classList.add('hidden');
    if (fileWrap) fileWrap.classList.remove('hidden');
    if (tabFile)  { activeCls.forEach(function(c){tabFile.classList.add(c);}); inactiveCls.forEach(function(c){tabFile.classList.remove(c);}); }
    if (tabUrl)   { inactiveCls.forEach(function(c){tabUrl.classList.add(c);}); activeCls.forEach(function(c){tabUrl.classList.remove(c);}); }
  }
}

window.tripPlanCoverTab = function(tab) { _tripPlanCoverTabSwitch(tab); };

window.tripPlanCoverUrlPreview = function() {
  var url = (document.getElementById('trip-plan-cover-url') || {}).value || '';
  _tripPlanSetCoverPreview(url.trim());
};

window.tripPlanClearCover = function() {
  _tripPlanUploadedCoverUrl = '';
  _tripPlanResetCoverUI();
};

window.tripPlanUploadCover = function() {
  if (!_tripPlanEditing) {
    var stat = document.getElementById('trip-plan-upload-status');
    if (stat) stat.textContent = 'Save the trip first, then upload a cover image.';
    return;
  }
  var fi = document.getElementById('trip-plan-cover-file');
  if (!fi || !fi.files[0]) return;
  var stat = document.getElementById('trip-plan-upload-status');
  if (stat) stat.textContent = 'Uploading…';
  var fd = new FormData();
  fd.append('file', fi.files[0]);
  _tripFetch(
    '/home/trip/' + _tripPid + '/plans/' + _tripPlanEditing + '/upload-cover',
    {method: 'POST', body: fd}
  ).then(function(r) { return r.json(); })
   .then(function(d) {
     if (d.error) { if (stat) stat.textContent = d.error; return; }
     _tripPlanUploadedCoverUrl = d.url;
     _tripPlanSetCoverPreview(d.url);
     if (stat) stat.textContent = '✓ Uploaded!';
   })
   .catch(function() { if (stat) stat.textContent = 'Upload failed.'; });
};

// ── Plan modal open/close/submit ────────────────────────────────────────────────────
window.tripOpenAddPlan = function() {
  _tripPlanEditing = null;
  document.getElementById('trip-plan-modal-title').textContent = 'Add Trip';
  document.getElementById('trip-plan-submit').textContent      = 'Add Trip';
  document.getElementById('trip-plan-name').value  = '';
  document.getElementById('trip-plan-desc').value  = '';
  document.getElementById('trip-plan-start').value = '';
  document.getElementById('trip-plan-end').value   = '';
  _tripPlanResetCoverUI();
  document.getElementById('trip-plan-modal').classList.remove('hidden');
  setTimeout(function() {
    var el = document.getElementById('trip-plan-name');
    if (el) el.focus();
  }, 50);
};

window.tripOpenEditPlan = function(planId) {
  var p = _tripPlans.find(function(x) { return x.id === planId; });
  if (!p) return;
  _tripPlanEditing          = planId;
  _tripPlanUploadedCoverUrl = p.cover_url || '';
  document.getElementById('trip-plan-modal-title').textContent = 'Edit Trip';
  document.getElementById('trip-plan-submit').textContent      = 'Save';
  document.getElementById('trip-plan-name').value  = p.plan_name  || '';
  document.getElementById('trip-plan-desc').value  = p.plan_desc  || '';
  document.getElementById('trip-plan-start').value = p.start_date || '';
  document.getElementById('trip-plan-end').value   = p.end_date   || '';
  _tripPlanResetCoverUI();
  // Pre-fill cover URL if set
  var coverUrl = p.cover_url || '';
  var urlIn = document.getElementById('trip-plan-cover-url');
  if (urlIn) urlIn.value = coverUrl;
  _tripPlanSetCoverPreview(coverUrl);
  document.getElementById('trip-plan-modal').classList.remove('hidden');
};

window.tripClosePlanModal = function() {
  document.getElementById('trip-plan-modal').classList.add('hidden');
  _tripPlanEditing          = null;
  _tripPlanUploadedCoverUrl = '';
};

window.tripSubmitPlan = function() {
  var name  = (document.getElementById('trip-plan-name')  || {}).value || '';
  var desc  = (document.getElementById('trip-plan-desc')  || {}).value || '';
  var start = (document.getElementById('trip-plan-start') || {}).value || '';
  var end   = (document.getElementById('trip-plan-end')   || {}).value || '';
  // cover_url: prefer the uploaded file URL, fall back to URL-input
  var urlIn    = document.getElementById('trip-plan-cover-url');
  var coverUrl = _tripPlanUploadedCoverUrl || (urlIn ? urlIn.value.trim() : '');
  if (!name.trim()) { _tripShowToast('Trip name is required', true); return; }
  var fd = new URLSearchParams();
  fd.append('plan_name',  name.trim());
  fd.append('plan_desc',  desc.trim());
  fd.append('start_date', start);
  fd.append('end_date',   end);
  fd.append('cover_url',  coverUrl);
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
  var val   = _normalizeTime(input ? input.value : '');
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

  // ─ Drop a Quick Card → create a synced panel_ref block ──────────────────────
  var panelId = event.dataTransfer.getData('bw-panel-id');
  if (panelId) {
    panelId = parseInt(panelId, 10);
    var pTitle    = event.dataTransfer.getData('bw-panel-title') || 'Quick Card';
    var pIcon     = event.dataTransfer.getData('bw-panel-icon')  || '📋';
    var pType     = event.dataTransfer.getData('bw-panel-type')  || '';
    var content   = JSON.stringify({ panel_id: panelId, title: pTitle, icon: pIcon, panel_type: pType });
    _tripFetch('/home/trip/' + _tripPid + '/days/' + dayId + '/blocks', {
      method: 'POST',
      body: new URLSearchParams({ block_type: 'panel_ref', content: content, time_label: '' }),
    }).then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) { _tripShowToast(d.error, true); return; }
        _tripShowToast('📋 Synced to day!');
        tripLoadPlan();
      })
      .catch(function() { _tripShowToast('Drop failed', true); });
    return;
  }

  // ─ Drop a Spot card → existing behaviour ──────────────────────────────
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
