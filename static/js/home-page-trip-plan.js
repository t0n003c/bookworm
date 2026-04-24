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

// ── Day card width (slider) ───────────────────────────────────────────────────
var _TRIP_DAY_W_KEY     = 'bw-trip-day-card-width';
var _tripDayCardWidth   = parseInt(localStorage.getItem(_TRIP_DAY_W_KEY) || '256', 10);

window.tripSetDayCardWidth = function(w) {
  _tripDayCardWidth = parseInt(w, 10);
  try { localStorage.setItem(_TRIP_DAY_W_KEY, _tripDayCardWidth); } catch(e) {}
  // Update all rendered lanes live — no full re-render needed
  document.querySelectorAll('.trip-day-lane-card').forEach(function(el) {
    el.style.width = _tripDayCardWidth + 'px';
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
  _tripSyncSizeSlider();
}

function _tripRenderDayLane(d) {
  // Merge spots + blocks into one sorted list
  var allItems = [];
  (d.spots || []).forEach(function(s) {
    allItems.push({kind: 'spot',  order_idx: s.sort_order || 0, data: s});
  });
  (_tripBlocks[d.id] || []).forEach(function(b) {
    allItems.push({kind: 'block', order_idx: b.order_idx, data: b});
  });
  allItems.sort(function(a, b) { return a.order_idx - b.order_idx; });

  var itemsHtml = allItems.length
    ? allItems.map(function(item) {
        return item.kind === 'spot'
          ? _tripRenderDaySpotRow(d.id, item.data)
          : _tripRenderDayBlockRow(d.id, item.data);
      }).join('')
    : '<div class="trip-drop-hint text-xs text-center text-gray-300 dark:text-zinc-600 py-6 px-3 ' +
        'border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-lg">' +
        'No items yet —<br>use <strong>＋ Add</strong> below</div>';

  var dateLabel = d.day_date
    ? '<span class="text-[10px] text-gray-400 dark:text-zinc-500 ml-1">' +
        _tripEsc(d.day_date) + '</span>'
    : '';

  return '<div class="trip-day-lane-card flex-shrink-0 bg-white dark:bg-zinc-900 rounded-xl ' +
    'border border-gray-200 dark:border-zinc-800 flex flex-col overflow-hidden ' +
    'shadow-sm" style="width:' + _tripDayCardWidth + 'px;max-height:calc(100vh - 12rem);">' +
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
      itemsHtml +
    '</div>' +
    '<div class="flex-shrink-0 px-2 pb-2 pt-1">' +
      '<button onclick="tripToggleBlockPicker(' + d.id + ', event)" ' +
        'class="w-full text-xs text-gray-400 dark:text-zinc-500 ' +
               'hover:text-[#0053e2] dark:hover:text-blue-400 transition ' +
               'border border-dashed border-gray-200 dark:border-zinc-700 ' +
               'rounded-lg py-1 hover:border-[#0053e2]/40">' +
        '＋ Add</button>' +
    '</div>' +
  '</div>';
}

function _tripRenderDaySpotRow(dayId, s) {
  var emoji = (typeof _TRIP_TYPE_EMOJI !== 'undefined' && _TRIP_TYPE_EMOJI[s.spot_type])
    || '📍';
  var timeLabel = s.time_label
    ? '<span class="text-[10px] text-[#0053e2] dark:text-blue-400 font-medium">' + _tripEsc(_formatTime(s.time_label)) + '</span>'
    : '';
  return '<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg ' +
    'bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 ' +
    'group cursor-grab active:cursor-grabbing" ' +
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
      'class="opacity-0 group-hover:opacity-100 transition text-[10px] ' +
             'text-gray-400 hover:text-[#0053e2]">🕐</button>' +
    '<button onclick="tripRemoveSpotFromDay(' + dayId + ',' + s.spot_id + ')" ' +
      'class="opacity-0 group-hover:opacity-100 transition text-[10px] ' +
             'text-gray-400 hover:text-red-500">✕</button>' +
  '</div>';
}

// ── Day block row renderer ────────────────────────────────────────────────────────────
function _tripRenderDayBlockRow(dayId, b) {
  var c = {};
  try { c = JSON.parse(b.content); } catch(e) {}

  var dragAttrs = 'draggable="true" data-block-id="' + b.id + '" ' +
    'ondragstart="tripDragBlockStart(event,' + dayId + ',' + b.id + ')" ' +
    'ondragover="tripDragDaySpotOver(event)" ' +
    'ondrop="tripDragLaneItemDrop(event,' + dayId + ',' + b.id + ',null)"';

  var editBtn  = '<button onclick="tripOpenBlockModal(' + dayId + ',\'' + b.block_type +
    '\',' + b.id + ')" class="opacity-0 group-hover:opacity-100 transition text-[10px] ' +
    'text-gray-400 hover:text-[#0053e2]">✏️</button>';
  var delBtn   = '<button onclick="tripDeleteBlock(' + dayId + ',' + b.id + ')" ' +
    'class="opacity-0 group-hover:opacity-100 transition text-[10px] ' +
    'text-gray-400 hover:text-red-500">🗑️</button>';
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
    return '<div class="flex items-start gap-2 rounded-lg group cursor-grab" ' +
      'style="' + cardStyle + '" ' + dragAttrs + '>' +
      '<span class="text-sm flex-shrink-0 mt-0.5">📝</span>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-xs text-gray-700 dark:text-zinc-200 truncate leading-snug">' +
          (preview || '<span class="italic text-gray-400">(empty)</span>') + '</p>' +
        timeSpan +
      '</div>' +
      editBtn + delBtn +
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
    return '<div class="flex items-start gap-2 px-2 py-1.5 rounded-lg group cursor-grab ' +
      'border border-dashed border-blue-300 dark:border-blue-700 ' +
      'bg-blue-50/50 dark:bg-blue-900/10" ' + dragAttrs + '>' +
      '<span class="text-sm flex-shrink-0 mt-0.5">🚗</span>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate">' +
          _tripEsc(c.from || '') + ' → ' + _tripEsc(c.to || '') + '</p>' +
        meta + timeSpan +
      '</div>' +
      editBtn + delBtn +
    '</div>';
  }

  if (b.block_type === 'bookmark') {
    return '<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg group cursor-grab ' +
      'bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700" ' + dragAttrs + '>' +
      '<span class="text-sm flex-shrink-0">🔖</span>' +
      '<div class="flex-1 min-w-0">' +
        '<a href="' + _tripEsc(c.url || '#') + '" target="_blank" rel="noopener" ' +
          'onclick="event.stopPropagation()" ' +
          'class="text-xs font-medium text-[#0053e2] dark:text-blue-400 hover:underline truncate block">' +
          _tripEsc(c.title || c.url || '') + '</a>' +
        timeSpan +
      '</div>' +
      editBtn + delBtn +
    '</div>';
  }

  if (b.block_type === 'divider') {
    return '<div class="flex items-center gap-2 py-1 select-none" data-block-id="' + b.id + '">' +
      '<hr class="flex-1 border-gray-200 dark:border-zinc-700">' +
      (c.label
        ? '<span class="text-[10px] text-gray-400 dark:text-zinc-500 whitespace-nowrap font-medium">' +
            _tripEsc(c.label) + '</span>' +
          '<hr class="flex-1 border-gray-200 dark:border-zinc-700">'
        : '') +
      '<button onclick="tripOpenBlockModal(' + dayId + ',\'divider\',' + b.id + ')" ' +
        'class="text-[10px] text-gray-300 dark:text-zinc-600 hover:text-gray-500 transition">✏️</button>' +
      '<button onclick="tripDeleteBlock(' + dayId + ',' + b.id + ')" ' +
        'class="text-[10px] text-gray-300 dark:text-zinc-600 hover:text-red-400 transition">×</button>' +
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
