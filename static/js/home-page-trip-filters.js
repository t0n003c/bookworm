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

// ── Spot filter/sort/group state ──────────────────────────────────────────────
var _tripSortBy  = 'default'; // 'default' | 'name' | 'priority' | 'cost' | 'attr:<key>'
var _tripSortDir = 'asc';     // 'asc' | 'desc'
var _tripGroupBy = 'none';    // 'none' | 'type' | 'priority' | attr key string
var _tripAttrKey = '';        // filter: attr key  ('' = off)
var _tripAttrVal = '';        // filter: attr value ('' = any)

// ── Location filter/sort/group state ─────────────────────────────────────────────
var _locSortBy  = 'default';  // 'default' | 'name' | 'priority' | 'attr:<key>'
var _locSortDir = 'asc';
var _locGroupBy = 'none';     // 'none' | 'priority' | attr key string
var _locAttrKey = '';
var _locAttrVal = '';
var _locQuery   = '';         // text search across name + notes

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
    leftHtml += '<span class="text-gray-300 dark:text-zinc-600 text-xs">|</span>';
    leftHtml += _typePill(null, _tripTypeFilter === null);
    types.forEach(function(t) { leftHtml += _typePill(t, _tripTypeFilter === t); });
  }
  leftHtml += '</div>';

  // ── Right: sort + dir + group + attr filter ──
  var attrKeys = _collectAttrKeys(spots);
  var sortOpts = [
    ['default',  'Sort: Default'],
    ['name',     'Sort: Name'],
    ['priority', 'Sort: Priority'],
    ['cost',     'Sort: Cost'],
  ];
  attrKeys.forEach(function(k) { sortOpts.push(['attr:' + k, 'Sort: ' + k]); });

  var groupOpts = [['none', 'Group: None'], ['type', 'Group: Type'], ['priority', 'Group: Priority']];
  attrKeys.forEach(function(k) { groupOpts.push([k, 'Group: ' + k]); });

  var rightHtml = '<div class="flex items-center gap-2 ml-auto flex-shrink-0">';
  rightHtml += _selectCtrl('tripSetSpotSort', _tripSortBy, sortOpts);
  if (_tripSortBy !== 'default') rightHtml += _dirToggle('tripToggleSpotSortDir', _tripSortDir);
  rightHtml += _selectCtrl('tripSetSpotGroup', _tripGroupBy, groupOpts);
  if (attrKeys.length) {
    rightHtml += _selectCtrl('tripSetSpotAttrKey', _tripAttrKey,
      [['', 'Filter: All']].concat(attrKeys.map(function(k) { return [k, k]; })));
    if (_tripAttrKey) {
      var valOpts = [['', 'Any']];
      _collectAttrVals(spots, _tripAttrKey).forEach(function(v) { valOpts.push([v, v]); });
      rightHtml += _selectCtrl('tripSetSpotAttrVal', _tripAttrVal, valOpts);
    }
  }
  rightHtml += '</div>';

  bar.innerHTML = leftHtml + rightHtml;
};
function _tripRenderFilterBar() { window._tripRenderFilterBar(); }

// ── Location filter bar ───────────────────────────────────────────────────────────
window._tripRenderLocFilterBar = function() {
  var bar  = document.getElementById('trip-locs-filter-bar');
  var locs = typeof _tripLocations !== 'undefined' ? _tripLocations : [];
  if (!bar) return;
  if (!locs.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');

  var attrKeys  = _collectAttrKeys(locs);
  var sortOpts  = [
    ['default',  'Sort: Default'],
    ['name',     'Sort: Name'],
    ['priority', 'Sort: Priority'],
  ];
  attrKeys.forEach(function(k) { sortOpts.push(['attr:' + k, 'Sort: ' + k]); });

  var groupOpts = [['none', 'Group: None'], ['priority', 'Group: Priority']];
  attrKeys.forEach(function(k) { groupOpts.push([k, 'Group: ' + k]); });

  // All controls pushed to the right end of the bar
  var html = '<div class="ml-auto flex items-center gap-2 flex-shrink-0">';
  html += _selectCtrl('tripSetLocSort', _locSortBy, sortOpts);
  if (_locSortBy !== 'default') html += _dirToggle('tripToggleLocSortDir', _locSortDir);
  html += _selectCtrl('tripSetLocGroup', _locGroupBy, groupOpts);
  if (attrKeys.length) {
    html += _selectCtrl('tripSetLocAttrKey', _locAttrKey,
      [['', 'Filter: All']].concat(attrKeys.map(function(k) { return [k, k]; })));
    if (_locAttrKey) {
      var valOpts = [['', 'Any']];
      _collectAttrVals(locs, _locAttrKey).forEach(function(v) { valOpts.push([v, v]); });
      html += _selectCtrl('tripSetLocAttrVal', _locAttrVal, valOpts);
    }
  }
  html += '</div>';

  bar.innerHTML = html;
};

// ── Spot ops: filter → sort → group ──────────────────────────────────────────
window._tripApplySpotOps = function(spots) {
  var tf = typeof _tripTypeFilter !== 'undefined' ? _tripTypeFilter : null;
  var q  = (typeof _tripQuery !== 'undefined' ? _tripQuery : '').toLowerCase();
  var items = spots.filter(function(s) {
    if (tf && s.spot_type !== tf) return false;
    if (q && s.name.toLowerCase().indexOf(q) === -1 &&
             (s.notes || '').toLowerCase().indexOf(q) === -1) return false;
    if (_tripAttrKey) {
      var match = (s.attrs || []).some(function(a) {
        return a.attr_key === _tripAttrKey &&
               (!_tripAttrVal || a.attr_value === _tripAttrVal);
      });
      if (!match) return false;
    }
    return true;
  });
  items = _sortItems(items, _tripSortBy, _tripSortDir);
  return _groupItems(items, _tripGroupBy);
};

// ── Location ops: filter → sort → group ───────────────────────────────────────────
window._tripApplyLocOps = function(locs) {
  var q = _locQuery.toLowerCase();
  var items = locs.filter(function(l) {
    if (q && l.name.toLowerCase().indexOf(q) === -1 &&
             (l.notes || '').toLowerCase().indexOf(q) === -1) return false;
    if (_locAttrKey) {
      var match = (l.attrs || []).some(function(a) {
        return a.attr_key === _locAttrKey &&
               (!_locAttrVal || a.attr_value === _locAttrVal);
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

window.tripSetSpotAttrKey = function(val) {
  _tripAttrKey = val;
  _tripAttrVal = '';
  _tripRenderFilterBar();
  if (typeof _tripRenderResearch === 'function') _tripRenderResearch();
};

window.tripSetSpotAttrVal = function(val) {
  _tripAttrVal = val;
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

window.tripSetLocAttrKey = function(val) {
  _locAttrKey = val;
  _locAttrVal = '';
  window._tripRenderLocFilterBar();
  if (typeof _tripRenderLocGrid === 'function') _tripRenderLocGrid();
};

window.tripSetLocAttrVal = function(val) {
  _locAttrVal = val;
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
