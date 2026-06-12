/**
 * home-page-trip-filters.js — Filter, Sort, Group By for Trip spots + locations.
 * Depends on: _tripEsc, _tripSpots, _tripLocations, _tripTypeFilter, _tripQuery,
 *             _tripActiveLocId, _tripActiveLoc, _tripPid  (trip.js / locs.js).
 * Overrides:  _tripRenderFilterBar() (redefines the same global name from trip.js).
 * Exposes:    _tripRenderLocFilterBar(), _tripApplySpotOps(), _tripApplyLocOps().
 * All state:  var only.
 *
 * Sort encoding:
 *   Built-in keys  → 'default' | 'name' | 'priority' | 'cost'
 *   Custom attr key → 'attr:<key>'  (e.g. 'attr:Budget')
 * Direction: 'asc' | 'desc'  (applies to every sort except 'default').
 */

// ── Spot filter/sort/group state ────────────────────────────────────────────────────────────────────
var _tripSortBy    = 'default'; // 'default' | 'name' | 'priority' | 'cost' | 'attr:<key>'
var _tripSortDir   = 'asc';     // 'asc' | 'desc'
var _tripGroupBy   = 'none';    // 'none' | 'type' | 'priority' | attr key string
var _tripFilterKey = '';        // '' | 'priority' | 'map' | custom attr key
var _tripFilterVal = '';        // value depends on key
var _spotSfgOpen   = false;
var _spotColOpen   = false;
var _tripSpotHiddenAttrs  = {};
var _tripSpotHiddenFields = {};

var _SPOT_BUILTIN_FIELDS = [
  { key: 'category', label: 'Category' },
  { key: 'priority', label: 'Priority'  },
  { key: 'cost',     label: 'Est. Cost' },
  { key: 'map',      label: 'Map Link'  },
];

// ── Location filter/sort/group state ─────────────────────────────────────────────────────────────────
var _locSortBy    = 'default';
var _locSortDir   = 'asc';
var _locGroupBy   = 'none';
var _locFilterKey = '';          // '' | 'priority' | custom attr key
var _locFilterVal = '';          // value depends on key
var _locQuery     = '';
var _locSfgOpen   = false;
var _locColOpen   = false;
var _locHiddenAttrs  = {};
var _locHiddenFields = {};

var _LOC_BUILTIN_FIELDS = [
  { key: 'cover',    label: 'Cover Image' },
  { key: 'priority', label: 'Priority'    },
  { key: 'notes',    label: 'Notes'       },
];

// ── Spot filter bar ───────────────────────────────────────────────────────────
window._tripRenderFilterBar = function() {
  var bar = document.getElementById('trip-filter-bar');
  if (!bar) return;
  var loc     = window._tripActiveLoc;
  var locName = loc ? loc.name : 'Location';
  var spots   = typeof _tripSpots !== 'undefined' ? _tripSpots : [];

  // ── Left: breadcrumb + location name + type pills ──
  var leftHtml =
    '<div class="flex items-center gap-2 flex-wrap min-w-0">' +
      '<button onclick="tripCloseLocView()" ' +
        'class="flex items-center gap-1 text-xs font-semibold text-[#0053e2] ' +
               'hover:underline whitespace-nowrap">← All Locations</button>' +
      '<span class="text-gray-300 dark:text-zinc-600 text-xs">|</span>' +
      '<span class="text-xs text-gray-600 dark:text-zinc-300 font-medium truncate max-w-[8rem]">' +
        _tripEsc(locName) + '</span>';

  var presentTypes = {};
  spots.forEach(function(s) { presentTypes[s.spot_type] = true; });
  var types = Object.keys(presentTypes).sort();
  if (types.length) {
    leftHtml += '<div class="trip-type-pills-wrap flex items-center gap-1 flex-wrap">' +
      '<span class="text-gray-300 dark:text-zinc-600 text-xs">|</span>' +
      _typePill(null, _tripTypeFilter === null);
    types.forEach(function(t) { leftHtml += _typePill(t, _tripTypeFilter === t); });
    leftHtml += '</div>';
  }
  leftHtml += '</div>';

  // ── Right: Assign to Days + consolidated Sort / Group / Filter button ──
  var attrKeys = _collectAttrKeys(spots);
  var sortOpts = [
    ['default',  'Default'],
    ['name',     'Name'],
    ['priority', 'Priority'],
    ['cost',     'Cost'],
  ];
  attrKeys.forEach(function(k) { sortOpts.push(['attr:' + k, k]); });

  var groupOpts = [['none', 'None'], ['type', 'Type'], ['priority', 'Priority']];
  attrKeys.forEach(function(k) { groupOpts.push([k, k]); });

  var hasActive = _tripSortBy !== 'default' || _tripGroupBy !== 'none' || _tripFilterKey !== '';

  var rightHtml = '<div class="flex items-center gap-2 ml-auto flex-shrink-0">';

  // Assign to Days button
  var _assignCls = (typeof _tripAssignDrawerOpen !== 'undefined' && _tripAssignDrawerOpen)
    ? 'flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg ' +
      'bg-[#0053e2] text-white font-medium transition'
    : 'flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border ' +
      'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
      'text-gray-700 dark:text-zinc-200 hover:bg-gray-50 ' +
      'dark:hover:bg-zinc-700 transition';
  rightHtml += '<button onclick="tripToggleAssignDrawer()" ' +
    'id="trip-assign-toggle" title="Quick-assign spots to day cards" ' +
    'class="' + _assignCls + '">🗓️ Assign to Days</button>';

  // ── Attribute visibility button (eye icon — always shown in spot view) ──
  var _hasHidden = Object.keys(_tripSpotHiddenAttrs).length > 0 ||
                   Object.keys(_tripSpotHiddenFields).length > 0;
    var _colCls = 'flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition ' +
      (_hasHidden
        ? 'border-[#0053e2] text-[#0053e2] dark:text-blue-300'
        : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
          'text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700');
    var _colStyle = _hasHidden ? ' style="background:rgba(0,83,226,0.06)"' : '';
    rightHtml += '<div class="relative" id="trip-col-anchor">';
    rightHtml +=   '<button onclick="tripToggleSpotColPanel(event)"' + _colStyle +
                   ' title="Show / hide attributes on spot cards" class="' + _colCls + '">' +
                     '<svg xmlns="http://www.w3.org/2000/svg" ' +
                     'style="width:14px;height:14px;display:inline;vertical-align:-2px" ' +
                     'viewBox="0 0 20 20" fill="currentColor">' +
                     '<path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/>' +
                     '<path fill-rule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41z" clip-rule="evenodd"/>' +
                     '</svg>' +
                     (_hasHidden
                       ? '<span class="inline-block w-2 h-2 rounded-full bg-[#0053e2] ' +
                               'dark:bg-blue-400 flex-shrink-0"></span>'
                       : '') +
                   '</button>';
    if (_spotColOpen) rightHtml += _spotColPanelHtml(attrKeys);
    rightHtml += '</div>';

  // ── Sort / Group / Filter button (funnel icon) ──
  var _sfgCls = 'flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition ' +
    (hasActive
      ? 'border-[#0053e2] text-[#0053e2] dark:text-blue-300'
      : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
        'text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700');
  var _sfgStyle = hasActive ? ' style="background:rgba(0,83,226,0.06)"' : '';
  rightHtml += '<div class="relative" id="trip-sfg-anchor">';
  rightHtml +=   '<button onclick="tripToggleSpotSfgPanel(event)"' + _sfgStyle +
                 ' title="Sort, group &amp; filter spots" class="' + _sfgCls + '">' +
                   '<svg xmlns="http://www.w3.org/2000/svg" ' +
                   'style="width:14px;height:14px;display:inline;vertical-align:-2px" ' +
                   'viewBox="0 0 20 20" fill="currentColor">' +
                   '<path fill-rule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clip-rule="evenodd"/>' +
                   '</svg>' +
                   (hasActive
                     ? '<span class="inline-block w-2 h-2 rounded-full bg-[#0053e2] ' +
                               'dark:bg-blue-400 flex-shrink-0"></span>'
                     : '') +
                 '</button>';
  if (_spotSfgOpen) rightHtml += _spotSfgPanelHtml(spots, attrKeys, sortOpts, groupOpts);
  rightHtml += '</div>';
  rightHtml += '</div>';

  bar.innerHTML = leftHtml + rightHtml;

  // Keep CSS vars fresh for mobile sticky positioning.
  // Both vars are consumed by the @media (max-width:767px) rules in
  // home_page_trip.html — harmless on desktop (sticky isn't applied there).
  var _topbarEl = document.getElementById('trip-topbar');
  if (_topbarEl) {
    document.documentElement.style.setProperty(
      '--bw-trip-topbar-h', _topbarEl.getBoundingClientRect().height + 'px'
    );
  }
  // getBoundingClientRect() forces a synchronous layout so the height
  // reflects the just-written innerHTML immediately.
  document.documentElement.style.setProperty(
    '--bw-trip-filter-bar-h', bar.getBoundingClientRect().height + 'px'
  );
};
function _tripRenderFilterBar() { window._tripRenderFilterBar(); }

// ── Sort / Group / Filter panel (Spots) ────────────────────────────────────────────
function _spotSfgPanelHtml(spots, attrKeys, sortOpts, groupOpts) {
  var hasActive = _tripSortBy !== 'default' || _tripGroupBy !== 'none' || _tripFilterKey !== '';

  // Unified attribute key options: built-ins first, then custom attrs
  var keyOpts = [['', 'Any']];
  keyOpts.push(['priority', 'Priority']);
  keyOpts.push(['map', 'Map Link']);
  attrKeys.forEach(function(k) { keyOpts.push([k, k]); });

  // Value options depend on which key is selected
  var valOpts = null;
  if (_tripFilterKey === 'priority') {
    valOpts = [['','Any'],['1','★ 1+ stars'],['2','★★ 2+ stars'],['3','★★★ 3+ stars'],['4','★★★★ 4+ stars'],['5','★★★★★ 5 stars only']];
  } else if (_tripFilterKey === 'map') {
    valOpts = [['','Any'],['yes','Has map link'],['no','No map link']];
  } else if (_tripFilterKey) {
    valOpts = [['', 'Any value']];
    _collectAttrVals(spots, _tripFilterKey).forEach(function(v) { valOpts.push([v, v]); });
  }

  var p =
    '<div id="trip-sfg-panel" ' +
    'class="absolute right-0 top-full mt-1.5 z-50 w-64 ' +
           'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 ' +
           'rounded-xl shadow-xl p-4 flex flex-col gap-4">';

  // ── Sort ──
  p += '<div>';
  p +=   '<div class="text-xs font-semibold uppercase tracking-wider mb-1.5 ' +
               'text-gray-400 dark:text-zinc-500">Sort</div>';
  p +=   '<div class="flex items-center gap-2">';
  p +=     _panelSelect('tripSetSpotSort', _tripSortBy, sortOpts, 'flex-1');
  if (_tripSortBy !== 'default') p += _panelDirBtn('tripToggleSpotSortDir', _tripSortDir);
  p +=   '</div>';
  p += '</div>';

  // ── Group by ──
  p += '<div>';
  p +=   '<div class="text-xs font-semibold uppercase tracking-wider mb-1.5 ' +
               'text-gray-400 dark:text-zinc-500">Group by</div>';
  p +=   _panelSelect('tripSetSpotGroup', _tripGroupBy, groupOpts, 'w-full');
  p += '</div>';

  // ── Filter ──
  p += '<div>';
  p +=   '<div class="text-xs font-semibold uppercase tracking-wider mb-1.5 ' +
               'text-gray-400 dark:text-zinc-500">Filter</div>';
  p +=   '<div class="flex flex-col gap-2">';
  p +=     '<div class="flex items-center gap-2">' +
             _panelSelect('tripSetSpotFilterKey', _tripFilterKey, keyOpts, 'w-full') +
           '</div>';
  if (valOpts) {
    p +=   '<div class="flex items-center gap-2">' +
             _panelSelect('tripSetSpotFilterVal', _tripFilterVal, valOpts, 'w-full') +
           '</div>';
  }
  p +=   '</div>';
  p += '</div>'; // end Filter

  // ── Clear All footer ──
  if (hasActive) {
    p += '<button onclick="tripClearSpotSfg()" ' +
      'class="w-full text-center text-xs text-[#ea1100] hover:text-red-700 ' +
             'font-medium pt-2 border-t border-gray-100 dark:border-zinc-800 transition">' +
      'Clear All</button>';
  }

  p += '</div>';
  return p;
}

function _panelSelect(onchangeFn, currentVal, options, widthCls) {
  var opts = options.map(function(o) {
    return '<option value="' + _tripEsc(o[0]) + '"' +
      (o[0] === currentVal ? ' selected' : '') + '>' + _tripEsc(o[1]) + '</option>';
  }).join('');
  return '<select onchange="' + onchangeFn + '(this.value)" ' +
    'class="' + widthCls + ' px-2 py-1.5 text-xs rounded-lg border border-gray-200 ' +
           'dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 ' +
           'focus:outline-none focus:ring-2 focus:ring-[#0053e2]/40 cursor-pointer">' +
    opts + '</select>';
}

function _panelDirBtn(fn, dir) {
  return '<button onclick="' + fn + '()" title="Toggle sort direction" ' +
    'class="flex-shrink-0 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 ' +
           'dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 ' +
           'hover:bg-gray-50 dark:hover:bg-zinc-700 transition font-medium">' +
    (dir === 'asc' ? '\u2191 Asc' : '\u2193 Desc') + '</button>';
}

window.tripToggleSpotSfgPanel = function(e) {
  if (e) e.stopPropagation();
  // Close col panel if open before toggling sfg
  if (_spotColOpen) {
    _spotColOpen = false;
    document.removeEventListener('mousedown', _spotColOutsideClick);
    document.removeEventListener('keydown', _spotColEscHandler);
  }
  _spotSfgOpen = !_spotSfgOpen;
  _tripRenderFilterBar();
  if (_spotSfgOpen) {
    setTimeout(function() {
      document.addEventListener('mousedown', _spotSfgOutsideClick);
      document.addEventListener('keydown', _spotSfgEscHandler);
    }, 0);
  } else {
    document.removeEventListener('mousedown', _spotSfgOutsideClick);
    document.removeEventListener('keydown', _spotSfgEscHandler);
  }
};

function _spotSfgOutsideClick(e) {
  // Always re-query: the anchor is rebuilt on every filter-bar re-render.
  var anchor = document.getElementById('trip-sfg-anchor');
  if (anchor && anchor.contains(e.target)) return;
  _spotSfgOpen = false;
  document.removeEventListener('mousedown', _spotSfgOutsideClick);
  document.removeEventListener('keydown', _spotSfgEscHandler);
  _tripRenderFilterBar();
}

function _spotSfgEscHandler(e) {
  if (e.key !== 'Escape') return;
  _spotSfgOpen = false;
  document.removeEventListener('mousedown', _spotSfgOutsideClick);
  document.removeEventListener('keydown', _spotSfgEscHandler);
  _tripRenderFilterBar();
}

window.tripClearSpotSfg = function() {
  _tripSortBy = 'default'; _tripSortDir = 'asc';
  _tripGroupBy = 'none'; _tripFilterKey = ''; _tripFilterVal = '';
  _spotSfgOpen = false;
  document.removeEventListener('mousedown', _spotSfgOutsideClick);
  document.removeEventListener('keydown', _spotSfgEscHandler);
  _tripRenderFilterBar();
  if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
};

// ── Attribute visibility panel (Spots) ─────────────────────────────────────────
// Safe single-quoted JS string literal for embedding inside a double-quoted HTML attribute.
// e.g. _jsStr('it\'s fine') → "'it\\'s fine'"
function _colJsStr(s) {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function _spotColPanelHtml(attrKeys) {
  var anyHidden = Object.keys(_tripSpotHiddenAttrs).length > 0 ||
                  Object.keys(_tripSpotHiddenFields).length > 0;

  var p =
    '<div id="trip-col-panel" ' +
    'class="absolute right-0 top-full mt-1.5 z-50 w-52 ' +
           'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 ' +
           'rounded-xl shadow-xl p-4 flex flex-col gap-1">';

  // ── Built-in fields ──
  p += '<div class="text-xs font-semibold uppercase tracking-wider mb-1 ' +
            'text-gray-400 dark:text-zinc-500">Default fields</div>';
  _SPOT_BUILTIN_FIELDS.forEach(function(f) {
    var isHidden = !!_tripSpotHiddenFields[f.key];
    var kJson = _colJsStr(f.key);
    p += _colCheckRow(
      'tripToggleSpotField(' + kJson + ')',
      !isHidden,
      f.label
    );
  });

  // ── Custom attrs (only when present) ──
  if (attrKeys.length) {
    p += '<div class="text-xs font-semibold uppercase tracking-wider mt-2 mb-1 ' +
              'text-gray-400 dark:text-zinc-500">Custom fields</div>';
    attrKeys.forEach(function(k) {
      var isHidden = !!_tripSpotHiddenAttrs[k];
      var kJson = _colJsStr(k);
      p += _colCheckRow(
        'tripToggleSpotAttr(' + kJson + ')',
        !isHidden,
        k
      );
    });
  }

  if (anyHidden) {
    p += '<button onclick="tripResetSpotAttrs()" ' +
      'class="w-full text-center text-xs text-[#0053e2] hover:text-blue-700 ' +
             'font-medium pt-2 mt-1 border-t border-gray-100 dark:border-zinc-800 transition">' +
      'Show All</button>';
  }

  p += '</div>';
  return p;
}

function _colCheckRow(onchange, checked, label) {
  return '<label class="flex items-center gap-2 text-xs cursor-pointer py-1 ' +
             'text-gray-700 dark:text-zinc-300 select-none ' +
             'hover:text-gray-900 dark:hover:text-zinc-100">' +
           '<input type="checkbox" onchange="' + onchange + '" ' +
             (checked ? 'checked ' : '') +
             'class="rounded border-gray-300 dark:border-zinc-600 cursor-pointer">' +
           '<span>' + _tripEsc(label) + '</span>' +
         '</label>';
}

window.tripToggleSpotColPanel = function(e) {
  if (e) e.stopPropagation();
  // Close sfg panel if open before toggling col
  if (_spotSfgOpen) {
    _spotSfgOpen = false;
    document.removeEventListener('mousedown', _spotSfgOutsideClick);
    document.removeEventListener('keydown', _spotSfgEscHandler);
  }
  _spotColOpen = !_spotColOpen;
  _tripRenderFilterBar();
  if (_spotColOpen) {
    setTimeout(function() {
      document.addEventListener('mousedown', _spotColOutsideClick);
      document.addEventListener('keydown', _spotColEscHandler);
    }, 0);
  } else {
    document.removeEventListener('mousedown', _spotColOutsideClick);
    document.removeEventListener('keydown', _spotColEscHandler);
  }
};

function _spotColOutsideClick(e) {
  var anchor = document.getElementById('trip-col-anchor');
  if (anchor && anchor.contains(e.target)) return;
  _spotColOpen = false;
  document.removeEventListener('mousedown', _spotColOutsideClick);
  document.removeEventListener('keydown', _spotColEscHandler);
  _tripRenderFilterBar();
}

function _spotColEscHandler(e) {
  if (e.key !== 'Escape') return;
  _spotColOpen = false;
  document.removeEventListener('mousedown', _spotColOutsideClick);
  document.removeEventListener('keydown', _spotColEscHandler);
  _tripRenderFilterBar();
}

window.tripToggleSpotField = function(key) {
  if (_tripSpotHiddenFields[key]) { delete _tripSpotHiddenFields[key]; }
  else { _tripSpotHiddenFields[key] = true; }
  _tripRenderFilterBar();
  if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
};

window.tripToggleSpotAttr = function(key) {
  if (_tripSpotHiddenAttrs[key]) { delete _tripSpotHiddenAttrs[key]; }
  else { _tripSpotHiddenAttrs[key] = true; }
  _tripRenderFilterBar();
  if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
};

window.tripResetSpotAttrs = function() {
  _tripSpotHiddenAttrs  = {};
  _tripSpotHiddenFields = {};
  _tripRenderFilterBar();
  if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
};

// ── Location filter bar ───────────────────────────────────────────────────
window._tripRenderLocFilterBar = function() {
  var bar  = document.getElementById('trip-locs-filter-bar');
  var locs = typeof _tripLocations !== 'undefined' ? _tripLocations : [];
  if (!bar) return;
  if (!locs.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');

  var attrKeys = _collectAttrKeys(locs);
  var hasActive = _locSortBy !== 'default' || _locGroupBy !== 'none' || _locFilterKey !== '';
  var hasHidden = Object.keys(_locHiddenAttrs).length > 0 ||
                  Object.keys(_locHiddenFields).length > 0;

  // ── Eye (column visibility) button ──
  var _colCls = 'flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition ' +
    (hasHidden
      ? 'border-[#0053e2] text-[#0053e2] dark:text-blue-300'
      : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
        'text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700');
  var _colStyle = hasHidden ? ' style="background:rgba(0,83,226,0.06)"' : '';

  // ── Funnel (sort/group/filter) button ──
  var _sfgCls = 'flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition ' +
    (hasActive
      ? 'border-[#0053e2] text-[#0053e2] dark:text-blue-300'
      : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 ' +
        'text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700');
  var _sfgStyle = hasActive ? ' style="background:rgba(0,83,226,0.06)"' : '';

  var html = '<div class="ml-auto flex items-center gap-2 flex-shrink-0">' +

    // Eye button
    '<div class="relative" id="trip-loc-col-anchor">' +
      '<button onclick="tripToggleLocColPanel(event)"' + _colStyle +
        ' title="Show / hide fields on location cards" class="' + _colCls + '">' +
        '<svg xmlns="http://www.w3.org/2000/svg" ' +
          'style="width:14px;height:14px;display:inline;vertical-align:-2px" ' +
          'viewBox="0 0 20 20" fill="currentColor">' +
          '<path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/>' +
          '<path fill-rule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41z" clip-rule="evenodd"/>' +
        '</svg>' +
        (hasHidden ? '<span class="inline-block w-2 h-2 rounded-full bg-[#0053e2] dark:bg-blue-400 flex-shrink-0"></span>' : '') +
      '</button>' +
      (_locColOpen ? _locColPanelHtml(attrKeys) : '') +
    '</div>' +

    // Funnel button
    '<div class="relative" id="trip-loc-sfg-anchor">' +
      '<button onclick="tripToggleLocSfgPanel(event)"' + _sfgStyle +
        ' title="Sort, group &amp; filter locations" class="' + _sfgCls + '">' +
        '<svg xmlns="http://www.w3.org/2000/svg" ' +
          'style="width:14px;height:14px;display:inline;vertical-align:-2px" ' +
          'viewBox="0 0 20 20" fill="currentColor">' +
          '<path fill-rule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clip-rule="evenodd"/>' +
        '</svg>' +
        (hasActive ? '<span class="inline-block w-2 h-2 rounded-full bg-[#0053e2] dark:bg-blue-400 flex-shrink-0"></span>' : '') +
      '</button>' +
      (_locSfgOpen ? _locSfgPanelHtml(locs, attrKeys) : '') +
    '</div>' +

  '</div>';

  bar.innerHTML = html;
};

// ── Location column-visibility panel ───────────────────────────────────────────
function _locColPanelHtml(attrKeys) {
  var anyHidden = Object.keys(_locHiddenAttrs).length > 0 ||
                  Object.keys(_locHiddenFields).length > 0;
  var p =
    '<div id="trip-loc-col-panel" ' +
    'class="absolute right-0 top-full mt-1.5 z-50 w-52 ' +
           'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 ' +
           'rounded-xl shadow-xl p-4 flex flex-col gap-1">';

  // ── Default fields ──
  p += '<div class="text-xs font-semibold uppercase tracking-wider mb-1 ' +
            'text-gray-400 dark:text-zinc-500">Default fields</div>';
  _LOC_BUILTIN_FIELDS.forEach(function(f) {
    var isHidden = !!_locHiddenFields[f.key];
    p += _colCheckRow('tripToggleLocField(' + _colJsStr(f.key) + ')', !isHidden, f.label);
  });

  // ── Custom attrs (only when present) ──
  if (attrKeys.length) {
    p += '<div class="text-xs font-semibold uppercase tracking-wider mt-2 mb-1 ' +
              'text-gray-400 dark:text-zinc-500">Custom fields</div>';
    attrKeys.forEach(function(k) {
      var isHidden = !!_locHiddenAttrs[k];
      p += _colCheckRow('tripToggleLocAttr(' + _colJsStr(k) + ')', !isHidden, k);
    });
  }

  if (anyHidden) {
    p += '<button onclick="tripResetLocAttrs()" ' +
      'class="w-full text-center text-xs text-[#0053e2] hover:text-blue-700 ' +
             'font-medium pt-2 mt-1 border-t border-gray-100 dark:border-zinc-800 transition">' +
      'Show All</button>';
  }

  p += '</div>';
  return p;
}

window.tripToggleLocColPanel = function(e) {
  if (e) e.stopPropagation();
  // Close sfg panel if open
  if (_locSfgOpen) {
    _locSfgOpen = false;
    document.removeEventListener('mousedown', _locSfgOutsideClick);
    document.removeEventListener('keydown',   _locSfgEscHandler);
  }
  _locColOpen = !_locColOpen;
  window._tripRenderLocFilterBar();
  if (_locColOpen) {
    setTimeout(function() {
      document.addEventListener('mousedown', _locColOutsideClick);
      document.addEventListener('keydown',   _locColEscHandler);
    }, 0);
  } else {
    document.removeEventListener('mousedown', _locColOutsideClick);
    document.removeEventListener('keydown',   _locColEscHandler);
  }
};

function _locColOutsideClick(e) {
  var anchor = document.getElementById('trip-loc-col-anchor');
  if (anchor && anchor.contains(e.target)) return;
  _locColOpen = false;
  document.removeEventListener('mousedown', _locColOutsideClick);
  document.removeEventListener('keydown',   _locColEscHandler);
  window._tripRenderLocFilterBar();
}

function _locColEscHandler(e) {
  if (e.key !== 'Escape') return;
  _locColOpen = false;
  document.removeEventListener('mousedown', _locColOutsideClick);
  document.removeEventListener('keydown',   _locColEscHandler);
  window._tripRenderLocFilterBar();
}

window.tripToggleLocField = function(key) {
  if (_locHiddenFields[key]) { delete _locHiddenFields[key]; }
  else { _locHiddenFields[key] = true; }
  window._tripRenderLocFilterBar();
  if (typeof _tripRenderLocGrid === 'function') _tripRenderLocGrid();
};

window.tripToggleLocAttr = function(key) {
  if (_locHiddenAttrs[key]) { delete _locHiddenAttrs[key]; }
  else { _locHiddenAttrs[key] = true; }
  window._tripRenderLocFilterBar();
  if (typeof _tripRenderLocGrid === 'function') _tripRenderLocGrid();
};

window.tripResetLocAttrs = function() {
  _locHiddenAttrs  = {};
  _locHiddenFields = {};
  window._tripRenderLocFilterBar();
  if (typeof _tripRenderLocGrid === 'function') _tripRenderLocGrid();
};

// ── Location SFG panel HTML ───────────────────────────────────────────────
function _locSfgPanelHtml(locs, attrKeys) {
  var hasActive = _locSortBy !== 'default' || _locGroupBy !== 'none' || _locFilterKey !== '';

  var sortOpts = [
    ['default',  'Default'],
    ['name',     'Name'],
    ['priority', 'Priority'],
  ];
  attrKeys.forEach(function(k) { sortOpts.push(['attr:' + k, k]); });

  var groupOpts = [['none', 'None'], ['priority', 'Priority']];
  attrKeys.forEach(function(k) { groupOpts.push([k, k]); });

  // Unified attribute key options
  var keyOpts = [['', 'Any']];
  keyOpts.push(['priority', 'Priority']);
  attrKeys.forEach(function(k) { keyOpts.push([k, k]); });

  // Value options depend on selected key
  var valOpts = null;
  if (_locFilterKey === 'priority') {
    valOpts = [['','Any'],['1','★ 1+ stars'],['2','★★ 2+ stars'],['3','★★★ 3+ stars'],['4','★★★★ 4+ stars'],['5','★★★★★ 5 stars only']];
  } else if (_locFilterKey) {
    valOpts = [['', 'Any value']];
    _collectAttrVals(locs, _locFilterKey).forEach(function(v) { valOpts.push([v, v]); });
  }

  var p =
    '<div id="trip-loc-sfg-panel" ' +
    'class="absolute right-0 top-full mt-1.5 z-50 w-64 ' +
           'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 ' +
           'rounded-xl shadow-xl p-4 flex flex-col gap-4">';

  // ── Sort ──
  p += '<div>';
  p +=   '<div class="text-xs font-semibold uppercase tracking-wider mb-1.5 ' +
               'text-gray-400 dark:text-zinc-500">Sort</div>';
  p +=   '<div class="flex items-center gap-2">';
  p +=     _panelSelect('tripSetLocSort', _locSortBy, sortOpts, 'flex-1');
  if (_locSortBy !== 'default') p += _panelDirBtn('tripToggleLocSortDir', _locSortDir);
  p +=   '</div>';
  p += '</div>';

  // ── Group by ──
  p += '<div>';
  p +=   '<div class="text-xs font-semibold uppercase tracking-wider mb-1.5 ' +
               'text-gray-400 dark:text-zinc-500">Group by</div>';
  p +=   _panelSelect('tripSetLocGroup', _locGroupBy, groupOpts, 'w-full');
  p += '</div>';

  // ── Filter ──
  p += '<div>';
  p +=   '<div class="text-xs font-semibold uppercase tracking-wider mb-1.5 ' +
               'text-gray-400 dark:text-zinc-500">Filter</div>';
  p +=   '<div class="flex flex-col gap-2">';
  p +=     '<div class="flex items-center gap-2">' +
             _panelSelect('tripSetLocFilterKey', _locFilterKey, keyOpts, 'w-full') +
           '</div>';
  if (valOpts) {
    p +=   '<div class="flex items-center gap-2">' +
             _panelSelect('tripSetLocFilterVal', _locFilterVal, valOpts, 'w-full') +
           '</div>';
  }
  p +=   '</div>';
  p += '</div>'; // end Filter

  // ── Clear All footer ──
  if (hasActive) {
    p += '<button onclick="tripClearLocSfg()" ' +
      'class="w-full text-center text-xs text-[#ea1100] hover:text-red-700 ' +
             'font-medium pt-2 border-t border-gray-100 dark:border-zinc-800 transition">' +
      'Clear All</button>';
  }

  p += '</div>';
  return p;
}

// ── Location SFG panel toggle + outside-click + Escape ─────────────────────
window.tripToggleLocSfgPanel = function(e) {
  if (e) e.stopPropagation();
  // Close col panel if open
  if (_locColOpen) {
    _locColOpen = false;
    document.removeEventListener('mousedown', _locColOutsideClick);
    document.removeEventListener('keydown',   _locColEscHandler);
  }
  _locSfgOpen = !_locSfgOpen;
  window._tripRenderLocFilterBar();
  if (_locSfgOpen) {
    setTimeout(function() {
      document.addEventListener('mousedown', _locSfgOutsideClick);
      document.addEventListener('keydown',   _locSfgEscHandler);
    }, 0);
  } else {
    document.removeEventListener('mousedown', _locSfgOutsideClick);
    document.removeEventListener('keydown',   _locSfgEscHandler);
  }
};

function _locSfgOutsideClick(e) {
  var anchor = document.getElementById('trip-loc-sfg-anchor');
  if (anchor && anchor.contains(e.target)) return;
  _locSfgOpen = false;
  document.removeEventListener('mousedown', _locSfgOutsideClick);
  document.removeEventListener('keydown',   _locSfgEscHandler);
  window._tripRenderLocFilterBar();
}

function _locSfgEscHandler(e) {
  if (e.key !== 'Escape') return;
  _locSfgOpen = false;
  document.removeEventListener('mousedown', _locSfgOutsideClick);
  document.removeEventListener('keydown',   _locSfgEscHandler);
  window._tripRenderLocFilterBar();
}

window.tripClearLocSfg = function() {
  _locSortBy = 'default'; _locSortDir = 'asc';
  _locGroupBy = 'none'; _locFilterKey = ''; _locFilterVal = '';
  _locSfgOpen = false;
  document.removeEventListener('mousedown', _locSfgOutsideClick);
  document.removeEventListener('keydown',   _locSfgEscHandler);
  window._tripRenderLocFilterBar();
  if (typeof _tripRenderLocGrid === 'function') _tripRenderLocGrid();
};

// ── Spot ops: filter → sort → group ──────────────────────────────────────────────────────────
window._tripApplySpotOps = function(spots) {
  var tf  = typeof _tripTypeFilter !== 'undefined' ? _tripTypeFilter : null;
  var q   = (typeof _tripQuery !== 'undefined' ? _tripQuery : '').toLowerCase();
  var fk  = _tripFilterKey;
  var fv  = _tripFilterVal;
  var items = spots.filter(function(s) {
    if (tf && s.spot_type !== tf) return false;
    if (q && s.name.toLowerCase().indexOf(q) === -1 &&
             (s.notes || '').toLowerCase().indexOf(q) === -1) return false;
    if (fk === 'priority') {
      var min = fv ? parseInt(fv, 10) : 0;
      if (min && (s.priority || 0) < min) return false;
    } else if (fk === 'map') {
      if (fv === 'yes' && !s.map_url) return false;
      if (fv === 'no'  &&  s.map_url) return false;
    } else if (fk) {
      var match = (s.attrs || []).some(function(a) {
        return a.attr_key === fk && (!fv || a.attr_value === fv);
      });
      if (!match) return false;
    }
    return true;
  });
  items = _sortItems(items, _tripSortBy, _tripSortDir);
  return _groupItems(items, _tripGroupBy);
};

// ── Location ops: filter → sort → group ───────────────────────────────────────────────
window._tripApplyLocOps = function(locs) {
  var q  = _locQuery.toLowerCase();
  var fk = _locFilterKey;
  var fv = _locFilterVal;
  var items = locs.filter(function(l) {
    if (q && l.name.toLowerCase().indexOf(q) === -1 &&
             (l.notes || '').toLowerCase().indexOf(q) === -1) return false;
    if (fk === 'priority') {
      var min = fv ? parseInt(fv, 10) : 0;
      if (min && (l.priority || 0) < min) return false;
    } else if (fk) {
      var match = (l.attrs || []).some(function(a) {
        return a.attr_key === fk && (!fv || a.attr_value === fv);
      });
      if (!match) return false;
    }
    return true;
  });
  items = _sortItems(items, _locSortBy, _locSortDir);
  return _groupItems(items, _locGroupBy);
};

// ── Spot controls ─────────────────────────────────────────────────────────────
window.tripSetTypeFilter = function(type) {
  _tripTypeFilter = type;
  _tripRenderFilterBar();
  if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
};

window.tripSetSpotSort = function(val) {
  _tripSortBy = val;
  if (val === 'default') _tripSortDir = 'asc';
  _tripRenderFilterBar();
  if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
};

window.tripToggleSpotSortDir = function() {
  _tripSortDir = _tripSortDir === 'asc' ? 'desc' : 'asc';
  _tripRenderFilterBar();
  if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
};

window.tripSetSpotGroup = function(val) {
  _tripGroupBy = val;
  _tripRenderFilterBar();
  if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
};

window.tripSetSpotFilterKey = function(val) {
  _tripFilterKey = val;
  _tripFilterVal = '';
  _tripRenderFilterBar();
  if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
};

window.tripSetSpotFilterVal = function(val) {
  _tripFilterVal = val;
  _tripRenderFilterBar();
  if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
};

// ── Location controls ─────────────────────────────────────────────────────
window.tripSearchLoc = function() {
  var el = document.getElementById('trip-search');
  _locQuery = el ? el.value : '';
  if (typeof _tripRenderLocGrid === 'function') _tripRenderLocGrid();
};

window.tripSetLocSort = function(val) {
  _locSortBy = val;
  if (val === 'default') _locSortDir = 'asc';
  window._tripRenderLocFilterBar();
  if (typeof _tripRenderLocGrid === 'function') _tripRenderLocGrid();
};

window.tripToggleLocSortDir = function() {
  _locSortDir = _locSortDir === 'asc' ? 'desc' : 'asc';
  window._tripRenderLocFilterBar();
  if (typeof _tripRenderLocGrid === 'function') _tripRenderLocGrid();
};

window.tripSetLocGroup = function(val) {
  _locGroupBy = val;
  window._tripRenderLocFilterBar();
  if (typeof _tripRenderLocGrid === 'function') _tripRenderLocGrid();
};

window.tripSetLocFilterKey = function(val) {
  _locFilterKey = val;
  _locFilterVal = '';
  window._tripRenderLocFilterBar();
  if (typeof _tripRenderLocGrid === 'function') _tripRenderLocGrid();
};

window.tripSetLocFilterVal = function(val) {
  _locFilterVal = val;
  window._tripRenderLocFilterBar();
  if (typeof _tripRenderLocGrid === 'function') _tripRenderLocGrid();
};

// ── Shared helpers ────────────────────────────────────────────────────────────
function _collectAttrKeys(items) {
  var seen = {}, keys = [];
  items.forEach(function(item) {
    (item.attrs || []).forEach(function(a) {
      if (a.attr_key && !seen[a.attr_key]) { seen[a.attr_key] = true; keys.push(a.attr_key); }
    });
  });
  return keys.sort();
}

function _collectAttrVals(items, key) {
  var seen = {}, vals = [];
  items.forEach(function(item) {
    (item.attrs || []).forEach(function(a) {
      if (a.attr_key === key && a.attr_value && !seen[a.attr_value]) {
        seen[a.attr_value] = true; vals.push(a.attr_value);
      }
    });
  });
  return vals.sort();
}

function _sortItems(items, sortBy, dir) {
  var arr = items.slice();
  var rev = (dir === 'desc') ? -1 : 1;

  if (sortBy === 'name') {
    arr.sort(function(a, b) { return rev * a.name.localeCompare(b.name); });

  } else if (sortBy === 'priority') {
    // Priority stored as 1-5; "highest first" is the natural descending default
    arr.sort(function(a, b) { return rev * (b.priority - a.priority); });

  } else if (sortBy === 'cost') {
    arr.sort(function(a, b) { return rev * (b.estimated_cost - a.estimated_cost); });

  } else if (sortBy.indexOf('attr:') === 0) {
    var attrKey = sortBy.slice(5);
    arr.sort(function(a, b) {
      var aAttr = (a.attrs || []).find(function(x) { return x.attr_key === attrKey; });
      var bAttr = (b.attrs || []).find(function(x) { return x.attr_key === attrKey; });
      var aVal = aAttr ? aAttr.attr_value : null;
      var bVal = bAttr ? bAttr.attr_value : null;
      // Items missing the attr always go to the bottom, regardless of direction
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      // Try numeric comparison first; fall back to string
      var aNum = parseFloat(aVal), bNum = parseFloat(bVal);
      if (!isNaN(aNum) && !isNaN(bNum)) return rev * (aNum - bNum);
      return rev * aVal.localeCompare(bVal);
    });
  }
  return arr;
}

function _groupItems(items, groupBy) {
  if (groupBy === 'none' || !groupBy) return [{groupLabel: null, items: items}];
  var groups = {}, order = [];
  items.forEach(function(item) {
    var key;
    if (groupBy === 'type') {
      key = item.spot_type || 'Other';
    } else if (groupBy === 'priority') {
      key = 'Priority ' + item.priority + ' ' + '\u2605'.repeat(item.priority);
    } else {
      var attr = (item.attrs || []).find(function(a) { return a.attr_key === groupBy; });
      key = attr ? attr.attr_value : '\u2014';
    }
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(item);
  });
  return order.map(function(k) { return {groupLabel: k, items: groups[k]}; });
}

function _typePill(type, active) {
  var emoji   = type ? ((_TRIP_TYPE_EMOJI && _TRIP_TYPE_EMOJI[type]) || '\uD83D\uDCCD') : '';
  var label   = type === null ? 'All' : emoji + ' ' + type;
  var onclick = type === null
    ? 'tripSetTypeFilter(null)'
    : 'tripSetTypeFilter(\'' + _tripEsc(type) + '\')';
  return '<button onclick="' + onclick + '" ' +
    'class="trip-pill px-2.5 py-1 rounded-full text-xs font-medium transition ' +
    (active
      ? 'bg-[#0053e2] text-white'
      : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 ' +
        'hover:bg-gray-200 dark:hover:bg-zinc-700') + '">' +
    label + '</button>';
}

function _selectCtrl(onchangeFn, currentVal, options) {
  var opts = options.map(function(o) {
    return '<option value="' + _tripEsc(o[0]) + '"' +
      (o[0] === currentVal ? ' selected' : '') + '>' + _tripEsc(o[1]) + '</option>';
  }).join('');
  return '<select onchange="' + onchangeFn + '(this.value)" ' +
    'class="px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-zinc-700 ' +
           'bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 ' +
           'focus:outline-none focus:ring-2 focus:ring-[#0053e2]/40 cursor-pointer">' +
    opts + '</select>';
}

function _dirToggle(fn, dir) {
  var label = dir === 'asc' ? '\u2191 Asc' : '\u2193 Desc';
  return '<button onclick="' + fn + '()" title="Toggle sort direction" ' +
    'class="px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-zinc-700 ' +
           'bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 ' +
           'hover:bg-gray-50 dark:hover:bg-zinc-700 transition cursor-pointer font-medium">' +
    label + '</button>';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plan filter / sort (trip-plans-view top toolbar)
// ═══════════════════════════════════════════════════════════════════════════════

var _planYearFilter   = 'all';     // 'all' | '2024' | '2025' | …
var _planSortBy       = 'default'; // 'default' | 'name' | 'start_date' | 'end_date' | 'days'
var _planSortDir      = 'asc';

// Collect unique years from start_date / end_date across all plans.
function _planYears(plans) {
  var seen = {};
  plans.forEach(function(p) {
    if (p.start_date) seen[p.start_date.slice(0, 4)] = true;
    if (p.end_date)   seen[p.end_date.slice(0, 4)]   = true;
  });
  return Object.keys(seen).filter(Boolean).sort().reverse(); // newest first
}

window._tripRenderPlanFilterBar = function() {
  var bar = document.getElementById('trip-plans-toolbar');
  if (!bar) return;
  var plans = typeof _tripPlans !== 'undefined' ? _tripPlans : [];
  if (!plans.length) { bar.innerHTML = ''; return; }

  var years    = _planYears(plans);
  var yearOpts = [['all', 'Year: All']].concat(
    years.map(function(y) { return [y, y]; })
  );

  var sortOpts = [
    ['default',    'Sort: Default'],
    ['name',       'Sort: Name'],
    ['start_date', 'Sort: Start Date'],
    ['end_date',   'Sort: End Date'],
    ['days',       'Sort: Day Count'],
  ];

  bar.innerHTML =
    '<div class="flex items-center gap-2 ml-auto flex-shrink-0">' +
      (years.length ? _selectCtrl('tripSetPlanYear', _planYearFilter, yearOpts) : '') +
      _selectCtrl('tripSetPlanSort', _planSortBy, sortOpts) +
      (_planSortBy !== 'default' ? _dirToggle('tripTogglePlanSortDir', _planSortDir) : '') +
    '</div>';
};

// Apply filter + sort — returns a filtered+sorted flat array.
// When sort is 'default', _tripRenderPlanCards groups by status internally.
window._tripApplyPlanOps = function(plans) {
  var items = plans.filter(function(p) {
    // Year filter: plan overlaps the selected year if either date is in that year.
    // Plans with no dates are excluded when any specific year is selected.
    if (_planYearFilter !== 'all') {
      var sy = p.start_date ? p.start_date.slice(0, 4) : '';
      var ey = p.end_date   ? p.end_date.slice(0, 4)   : '';
      if (sy !== _planYearFilter && ey !== _planYearFilter) return false;
    }
    return true;
  });

  if (_planSortBy === 'default') return items; // caller handles status grouping

  var rev = _planSortDir === 'desc' ? -1 : 1;
  return items.slice().sort(function(a, b) {
    if (_planSortBy === 'name')       return rev * (a.plan_name || '').localeCompare(b.plan_name || '');
    if (_planSortBy === 'start_date') return rev * (a.start_date || '').localeCompare(b.start_date || '');
    if (_planSortBy === 'end_date')   return rev * (a.end_date   || '').localeCompare(b.end_date   || '');
    if (_planSortBy === 'days')       return rev * ((a.day_count || 0) - (b.day_count || 0));
    return 0;
  });
};

// ── Plan filter controls ──────────────────────────────────────────────────────
window.tripSetPlanYear = function(val) {
  _planYearFilter = val;
  window._tripRenderPlanFilterBar();
  if (typeof _tripRenderPlanCards === 'function') _tripRenderPlanCards();
};

window.tripSetPlanSort = function(val) {
  _planSortBy = val;
  if (val === 'default') _planSortDir = 'asc';
  window._tripRenderPlanFilterBar();
  if (typeof _tripRenderPlanCards === 'function') _tripRenderPlanCards();
};

window.tripTogglePlanSortDir = function() {
  _planSortDir = _planSortDir === 'asc' ? 'desc' : 'asc';
  window._tripRenderPlanFilterBar();
  if (typeof _tripRenderPlanCards === 'function') _tripRenderPlanCards();
};
