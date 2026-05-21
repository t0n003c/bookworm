/**
 * home-page-trip-chart-drill.js
 * Drill-down drawer, person picker, and panel card renders for the Chart tab.
 * Depends on: home-page-trip-chart.js (state vars + _tripConvert, _tripEsc)
 *
 * Globals exposed:
 *   tripChartSelectPerson(name|null) — called by person pill onclick
 *   tripChartCloseDrawer()          — called by backdrop / close btn
 *   _tripRenderPersonPicker(data)   — called from _tripChartRenderAll
 *   _tripRenderBudgetPanels(data)   — panel card section
 *   _tripRenderSettlePanels(data)   — panel card section (+ person highlight)
 *   _tripChartOpenSpotTypeDrawer(rawType, data)   — doughnut + blue bars
 *   _tripChartOpenBudgetItemDrawer(entry, data)   — yellow bars
 */

// ── Person picker ──────────────────────────────────────────────────────────────────
// Extracts unique person names from settle panels and renders pill buttons.
// In planning mode, chart.js passes null — clear the container and bail.
function _tripRenderPersonPicker(data) {
  var el = document.getElementById('trip-chart-person-picker');
  if (!el) return;
  if (!data) { el.innerHTML = ''; return; }  // planning mode: hide picker
  var panels = data.settle_panels || [];
  // Collect unique names across ALL settle panels
  var seen = {}, people = [];
  panels.forEach(function(sp) {
    (sp.per_person || []).forEach(function(pp) {
      if (!seen[pp.name]) { seen[pp.name] = true; people.push(pp.name); }
    });
  });
  if (!people.length) { el.innerHTML = ''; return; }

  var pillBase = 'px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer border ';
  var pillOff  = 'border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 ' +
                 'bg-white dark:bg-zinc-900 hover:border-[#0053e2] hover:text-[#0053e2]';
  var pillOn   = 'border-[#0053e2] bg-[#0053e2] text-white';

  var pills = ['<button onclick="tripChartSelectPerson(null)" ' +
    'class="' + pillBase + (_tripChartSelectedPerson === null ? pillOn : pillOff) + '">All</button>'];

  people.forEach(function(name) {
    var active  = _tripChartSelectedPerson === name;
    // JSON.stringify wraps in double-quotes; escape them for the HTML attribute
    var safeArg = JSON.stringify(name).replace(/"/g, '&quot;');
    pills.push('<button onclick="tripChartSelectPerson(' + safeArg + ')" ' +
      'class="' + pillBase + (active ? pillOn : pillOff) + '">' + _tripEsc(name) + '</button>');
  });

  el.innerHTML =
    '<div id="trip-chart-person-bar" class="flex items-center gap-2 flex-wrap px-4 py-2 ' +
         'border-b border-gray-100 dark:border-zinc-800 ' +
         'bg-gray-50 dark:bg-zinc-900/60">' +
      '<span class="text-[11px] text-gray-400 dark:text-zinc-500 flex-shrink-0">' +
        '<span class="trip-chart-ctrl-lbl">View by </span>Person:' +
      '</span>' +
      pills.join('') +
    '</div>';
}

window.tripChartSelectPerson = function(name) {
  _tripChartSelectedPerson = name || null;
  if (_tripChartLastData) _tripChartRenderAll(_tripChartLastData);
};

// ── Drawer shell ─────────────────────────────────────────────────────────────
function _tripGetOrCreateDrawer() {
  var d = document.getElementById('trip-chart-drawer');
  if (d) return d;
  var backdrop = document.createElement('div');
  backdrop.id = 'trip-chart-drawer-backdrop';
  backdrop.className = 'hidden fixed inset-0 z-40 bg-black/30 backdrop-blur-sm';
  backdrop.onclick = function() { tripChartCloseDrawer(); };

  d = document.createElement('div');
  d.id = 'trip-chart-drawer';
  d.className = 'hidden fixed top-0 right-0 bottom-0 z-50 w-full max-w-sm ' +
    'bg-white dark:bg-zinc-900 shadow-2xl border-l border-gray-200 dark:border-zinc-800 ' +
    'flex flex-col';
  d.innerHTML =
    '<div class="flex items-start justify-between p-4 border-b border-gray-100 dark:border-zinc-800 flex-shrink-0">' +
      '<div>' +
        '<p id="trip-drawer-title" class="text-sm font-semibold text-gray-800 dark:text-zinc-100"></p>' +
        '<p id="trip-drawer-sub"   class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5"></p>' +
      '</div>' +
      '<button onclick="tripChartCloseDrawer()" ' +
        'class="ml-2 flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300 text-lg leading-none">✕</button>' +
    '</div>' +
    '<div id="trip-drawer-body" class="flex-1 overflow-y-auto p-4"></div>';

  document.body.appendChild(backdrop);
  document.body.appendChild(d);
  return d;
}

function _tripOpenDrawer(title, sub, bodyHtml) {
  var d = _tripGetOrCreateDrawer();
  document.getElementById('trip-drawer-title').textContent = title;
  document.getElementById('trip-drawer-sub').textContent   = sub;
  document.getElementById('trip-drawer-body').innerHTML    = bodyHtml;
  document.getElementById('trip-chart-drawer-backdrop').classList.remove('hidden');
  d.classList.remove('hidden');
}

window.tripChartCloseDrawer = function() {
  var d  = document.getElementById('trip-chart-drawer');
  var bd = document.getElementById('trip-chart-drawer-backdrop');
  if (d)  d.classList.add('hidden');
  if (bd) bd.classList.add('hidden');
};

// ── Spot-type drawer (doughnut slices + blue bar clicks) ──────────────────────
window._tripChartOpenSpotTypeDrawer = function(rawType, data) {
  var spots = (data.spots_detail || []).filter(function(s) {
    return s.spot_type === rawType;
  });
  var label = rawType ? (rawType.charAt(0).toUpperCase() + rawType.slice(1)) : rawType;
  var cur   = _tripChartCurrency;

  if (!spots.length) {
    _tripOpenDrawer(label + ' Spots', 'No spots found for this type.', '');
    return;
  }

  var rows = spots.map(function(s) {
    var costStr = (s.estimated_cost !== null && s.estimated_cost !== undefined)
      ? cur + ' ' + Math.round(_tripConvert(s.estimated_cost, s.currency)).toLocaleString()
      : 'No estimate';
    // priority: 1=Low 2=Medium 3=High (null = unset)
    var priorityMap = {1: 'Low', 2: 'Medium', 3: 'High'};
    var priorityColorMap = {
      1: 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400',
      2: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
      3: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    };
    var priEl = s.priority
      ? '<span class="text-[10px] px-1.5 py-0.5 rounded-full font-medium ' +
          (priorityColorMap[s.priority] || priorityColorMap[1]) + '">' +
          (priorityMap[s.priority] || 'P' + s.priority) + ' priority</span>'
      : '';
    // Prefer map_url as the clickable link; fall back to cover_url
    var linkUrl = s.map_url || s.cover_url || '';
    var nameEl = linkUrl
      ? '<a href="' + _tripEsc(linkUrl) + '" target="_blank" rel="noopener" ' +
          'class="font-medium text-[#0053e2] dark:text-blue-400 hover:underline">' +
          _tripEsc(s.name) + ' ↗</a>'
      : '<span class="font-medium text-gray-800 dark:text-zinc-100">' + _tripEsc(s.name) + '</span>';
    var locBadge = s.location_name
      ? '<span class="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-zinc-800 ' +
          'text-gray-500 dark:text-zinc-400 rounded-full">' + _tripEsc(s.location_name) + '</span>'
      : '';
    var noteEl = s.notes
      ? '<p class="text-[11px] text-gray-500 dark:text-zinc-400 mt-1 line-clamp-2">' + _tripEsc(s.notes) + '</p>'
      : '';
    return '<div class="py-3 border-b border-gray-100 dark:border-zinc-800 last:border-0">' +
      '<div class="flex items-start justify-between gap-2">' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex flex-wrap items-center gap-1.5">' + nameEl + locBadge + priEl + '</div>' +
          noteEl +
        '</div>' +
        '<div class="text-right flex-shrink-0">' +
          '<p class="text-xs font-semibold text-gray-800 dark:text-zinc-100">' + costStr + '</p>' +
          (s.currency !== cur && s.estimated_cost !== null
            ? '<p class="text-[10px] text-gray-400">' + s.currency + ' ' +
              Number(s.estimated_cost).toLocaleString('en-US', {maximumFractionDigits: 0}) + '</p>'
            : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  _tripOpenDrawer(
    label + ' Spots (' + spots.length + ')',
    'Estimated costs converted to ' + cur + '. Click name to open URL.',
    rows
  );
};

// ── Budget item drawer (yellow bar clicks) ────────────────────────────────────
window._tripChartOpenBudgetItemDrawer = function(entry, data) {
  var cur = _tripChartCurrency;
  // Find the source budget panel that owns this item label
  var ownerPanel = null;
  (data.budget_panels || []).forEach(function(bp) {
    (bp.items || []).forEach(function(it) {
      if (it.label === entry.label) ownerPanel = bp;
    });
  });
  var sourceItem = null;
  if (ownerPanel) {
    (ownerPanel.items || []).forEach(function(it) {
      if (it.label === entry.label) sourceItem = it;
    });
  }

  var amtConverted = cur + ' ' + entry.cost.toLocaleString();
  var amtOrig = ownerPanel && ownerPanel.currency !== cur
    ? '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">Original: ' +
        ownerPanel.currency + ' ' + (sourceItem ? Number(sourceItem.amount).toLocaleString() : '—') + '</p>'
    : '';
  var noteEl = sourceItem && sourceItem.note
    ? '<div class="mt-3 p-3 bg-gray-50 dark:bg-zinc-800 rounded-lg">' +
        '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 mb-1">Note</p>' +
        '<p class="text-xs text-gray-600 dark:text-zinc-300">' + _tripEsc(sourceItem.note) + '</p>' +
      '</div>'
    : '';
  var panelEl = ownerPanel
    ? '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-3">From panel: ' +
        '<strong class="text-gray-600 dark:text-zinc-300">' + _tripEsc(ownerPanel.title) + '</strong></p>'
    : '';

  var body =
    '<div class="py-2">' +
      '<p class="text-2xl font-bold text-gray-800 dark:text-zinc-100">' + amtConverted + '</p>' +
      amtOrig +
      noteEl +
      panelEl +
    '</div>';

  _tripOpenDrawer(
    _tripEsc(entry.label),
    'Budget plan item · tap a bar to explore other items',
    body
  );
};

// ── Budget panel cards ────────────────────────────────────────────────────────────
function _tripRenderBudgetPanels(data) {
  var el = document.getElementById('trip-chart-budget-panels');
  if (!el) return;
  if (!data) { el.innerHTML = ''; return; }  // planning mode: hide panels
  // When a person is selected, only show group panels + that person's individual panels.
  var selected = _tripChartSelectedPerson;
  var panels = (data.budget_panels || []).filter(function(p) {
    if (!selected) return true;
    if ((p.budget_scope || 'group') !== 'individual') return true;
    return (p.budget_person || '').trim() === selected;
  });
  if (!panels.length) { el.innerHTML = ''; return; }
  var cur = _tripChartCurrency;
  var cardCls = 'bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-4';

  var cards = panels.map(function(p) {
    var ceiling    = _tripConvert(p.ceiling, p.currency);
    var spent      = _tripConvert(p.spent,   p.currency);
    var remaining  = ceiling - spent;
    var pct        = ceiling > 0 ? Math.min(Math.round(spent / ceiling * 100), 100) : 0;
    var barColor   = pct >= 90 ? '#ea1100' : pct >= 70 ? '#f59e0b' : '#2a8703';
    var overBudget = ceiling > 0 && spent > ceiling;
    var fxNote     = p.currency !== cur
      ? '<span class="text-[10px] text-gray-400 dark:text-zinc-500 ml-1">(orig. ' + p.currency + ')</span>' : '';

    var itemRows = (p.items || []).filter(function(it) { return it.amount > 0; }).map(function(it) {
      var conv  = _tripConvert(it.amount, p.currency);
      var itPct = spent > 0 ? Math.round(conv / spent * 100) : 0;
      // Reconciliation badge: confirmed items are green-tagged
      var reconcBadge = it.reconciled
        ? '<span class="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded-full ' +
            'bg-green-50 dark:bg-green-900/30 text-[#2a8703] dark:text-green-400 font-medium ml-1">' +
            '✓ confirmed</span>'
        : '';
      return '<div class="flex items-center gap-2 py-1 border-b border-gray-50 dark:border-zinc-800/60 last:border-0">' +
        '<div class="flex-1 min-w-0 flex items-center flex-wrap gap-0.5">' +
          '<span class="text-[11px] text-gray-600 dark:text-zinc-300 truncate">' + _tripEsc(it.label || '—') + '</span>' +
          reconcBadge +
        '</div>' +
        '<div class="w-16 h-1.5 bg-gray-100 dark:bg-zinc-700 rounded-full overflow-hidden flex-shrink-0">' +
          '<div class="h-full rounded-full" style="width:' + itPct + '%;background:' + barColor + '"></div>' +
        '</div>' +
        '<span class="text-[11px] font-medium text-gray-700 dark:text-zinc-200 w-20 text-right flex-shrink-0">' +
          cur + ' ' + conv.toLocaleString('en-US', {maximumFractionDigits: 0}) + '</span>' +
      '</div>';
    }).join('');

    // Ceiling source badge
    var ceilSrcBadge = p.ceiling_source === 'spots'
      ? '<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 ' +
          'text-[#0053e2] dark:text-blue-400 font-medium ml-1" title="Ceiling is auto-computed from spot estimates">' +
          '📍 from spots</span>'
      : '';
    var reconciledCount = p.reconciled_count || 0;
    var reconciledSummary = reconciledCount > 0 && p.total_items > 0
      ? '<p class="text-[10px] text-[#2a8703] dark:text-green-400 mt-1">' +
          '✓ ' + reconciledCount + ' of ' + p.total_items + ' item' + (p.total_items === 1 ? '' : 's') +
          ' confirmed via Settle Up</p>'
      : '';

    return '<div class="' + cardCls + '">' +
      '<div class="flex items-center gap-2 mb-3">' +
        '<span class="text-base">💰</span>' +
        '<p class="text-xs font-semibold text-gray-700 dark:text-zinc-200 flex-1">' + _tripEsc(p.title) + '</p>' +
        ceilSrcBadge +
        '<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-400 font-medium">📊 in chart</span>' +
        fxNote +
      '</div>' +
      '<div class="mb-2">' +
        '<div class="flex justify-between text-[11px] mb-1">' +
          '<span class="font-semibold ' + (overBudget ? 'text-red-500' : 'text-gray-700 dark:text-zinc-200') + '">' +
            cur + ' ' + spent.toLocaleString('en-US', {maximumFractionDigits: 0}) + ' spent</span>' +
          '<span class="text-gray-400 dark:text-zinc-500">' + (ceiling > 0
            ? (overBudget ? '⚠️ over by ' + cur + ' ' + Math.abs(remaining).toLocaleString('en-US', {maximumFractionDigits: 0})
                          : cur + ' ' + remaining.toLocaleString('en-US', {maximumFractionDigits: 0}) + ' left of ' +
                            cur + ' ' + ceiling.toLocaleString('en-US', {maximumFractionDigits: 0}))
            : 'No ceiling set') + '</span>' +
        '</div>' +
        '<div class="h-2 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">' +
          '<div class="h-full rounded-full transition-all" style="width:' + pct + '%;background:' + barColor + '"></div>' +
        '</div>' +
        '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5 text-right">' + pct + '% of budget used</p>' +
        reconciledSummary +
      '</div>' +
      (itemRows
        ? '<div class="mt-3 pt-2 border-t border-gray-100 dark:border-zinc-800">' +
            '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 mb-1">Line items</p>' +
            itemRows + '</div>'
        : '<p class="text-[11px] text-gray-400 dark:text-zinc-500 italic">No line items added yet.</p>') +
    '</div>';
  }).join('');

  el.innerHTML =
    '<div class="mb-3"><p class="text-xs font-semibold text-gray-700 dark:text-zinc-200">💰 Budget Trackers</p>' +
      '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">Manual budget panels — ceiling vs logged spend.</p></div>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' + cards + '</div>';
}

// ── Settle panel cards ───────────────────────────────────────────────────────────────
function _tripRenderSettlePanels(data) {
  var el = document.getElementById('trip-chart-settle-panels');
  if (!el) return;
  if (!data) { el.innerHTML = ''; return; }  // planning mode: hide panels
  var panels = data.settle_panels || [];
  if (!panels.length) { el.innerHTML = ''; return; }
  var cur      = _tripChartCurrency;
  var cardCls  = 'bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-4';
  var selected = _tripChartSelectedPerson;

  var cards = panels.map(function(p) {
    var totalConv  = _tripConvert(p.total_expenses, p.currency);
    var fxNote     = p.currency !== cur
      ? ' <span class="text-[10px] text-gray-400 dark:text-zinc-500">(orig. ' + p.currency + ')</span>' : '';

    var rows = (p.per_person || []).map(function(person) {
      var isMe     = selected && person.name === selected;
      var paid     = _tripConvert(person.paid,    p.currency);
      var owes     = _tripConvert(person.owes,    p.currency);
      var balance  = _tripConvert(person.balance, p.currency);
      var balColor = balance >= 0 ? 'text-[#2a8703] dark:text-green-400' : 'text-[#ea1100] dark:text-red-400';
      var balPfx   = balance >= 0 ? '+' : '';
      var rowCls   = isMe
        ? 'border-b border-gray-50 dark:border-zinc-800 last:border-0 bg-blue-50/60 dark:bg-blue-900/20'
        : 'border-b border-gray-50 dark:border-zinc-800 last:border-0';
      return '<tr class="' + rowCls + '">' +
        '<td class="py-1.5 pr-3 text-[11px] font-medium text-gray-700 dark:text-zinc-200">' +
          (isMe ? '👤 ' : '') + _tripEsc(person.name) + '</td>' +
        '<td class="py-1.5 pr-3 text-[11px] text-gray-500 dark:text-zinc-400 text-right">' +
          cur + ' ' + paid.toLocaleString('en-US', {maximumFractionDigits: 0}) + '</td>' +
        '<td class="py-1.5 pr-3 text-[11px] text-gray-500 dark:text-zinc-400 text-right">' +
          cur + ' ' + owes.toLocaleString('en-US', {maximumFractionDigits: 0}) + '</td>' +
        '<td class="py-1.5 text-[11px] font-semibold text-right ' + balColor + '">' +
          balPfx + cur + ' ' + Math.abs(balance).toLocaleString('en-US', {maximumFractionDigits: 0}) + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="' + cardCls + '">' +
      '<div class="flex items-center gap-2 mb-3">' +
        '<span class="text-base">🤝</span>' +
        '<p class="text-xs font-semibold text-gray-700 dark:text-zinc-200 flex-1">' + _tripEsc(p.title) + '</p>' +
        '<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-400 font-medium">📊 in chart</span>' +
      '</div>' +
      '<p class="text-[11px] text-gray-500 dark:text-zinc-400 mb-3">Total: <strong class="text-gray-700 dark:text-zinc-200">' +
        cur + ' ' + totalConv.toLocaleString('en-US', {maximumFractionDigits: 0}) + '</strong>' + fxNote + '</p>' +
      (rows
        ? '<div class="overflow-x-auto">' +
            '<table class="w-full">' +
              '<thead><tr class="border-b border-gray-100 dark:border-zinc-800">' +
                '<th class="pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 text-left">Person</th>' +
                '<th class="pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 text-right">Paid</th>' +
                '<th class="pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 text-right">Fair Share</th>' +
                '<th class="pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 text-right">Balance</th>' +
              '</tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
            '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-2">Green → gets back · Red → still owes</p>' +
          '</div>'
        : '<p class="text-[11px] text-gray-400 dark:text-zinc-500 italic">No people added yet.</p>') +
    '</div>';
  }).join('');

  el.innerHTML =
    '<div class="mb-3"><p class="text-xs font-semibold text-gray-700 dark:text-zinc-200">🤝 Group Expenses (Settle Up)</p>' +
      '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">Per-person paid / fair share / balance. ' +
      (selected ? '👤 Showing <strong class="text-gray-600 dark:text-zinc-300">' + _tripEsc(selected) + '</strong> highlighted.' : 'Select a person above to highlight their row.') +
      '</p></div>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' + cards + '</div>';
}
