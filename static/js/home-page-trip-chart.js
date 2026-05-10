/**
 * home-page-trip-chart.js — Chart tab: lazy Chart.js + stats render.
 * Depends on _tripPid, _tripFetch, _tripShowToast, _tripChartColors (home-page-trip.js).
 * All state uses var. No let/const.
 *
 * Features:
 *   • Plan filter  — scope stats to a specific trip plan or see all
 *   • FX converter — auto-convert mixed currencies to any target currency
 *   • Descriptions — inline explanations of every chart section
 */

// ── Module state ──────────────────────────────────────────────────────────────
var _tripChartLibLoaded  = false;
var _tripChartLibPromise = null;
var _tripTypeChart       = null;
var _tripBudgetChart     = null;
var _tripChartPlanId     = 0;       // 0 = all plans
var _tripChartCurrency   = 'USD';   // target display currency
var _tripChartPlans      = [];      // [{id, plan_name, start_date, end_date}]
var _tripChartLastData   = null;    // last raw API response (for re-render on FX change)

// ── Approximate FX rates (all → USD base, updated periodically) ──────────────
// These are indicative rates for planning purposes only — not live data.
var _TRIP_FX_TO_USD = {
  USD: 1.0,    EUR: 1.08,  GBP: 1.27,  JPY: 0.0067,
  IDR: 0.000062, AUD: 0.65, CAD: 0.74,  CHF: 1.12,
  SGD: 0.74,   THB: 0.028, MXN: 0.052, KRW: 0.00073,
  INR: 0.012,  VND: 0.000039, BRL: 0.20, MYR: 0.22,
  PHP: 0.017,  HKD: 0.13,  TWD: 0.031, NZD: 0.60,
};
var _TRIP_FX_LABELS = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','SGD',
                        'THB','IDR','MXN','INR','KRW','BRL','MYR','PHP'];

// Convert an amount from srcCurrency to _tripChartCurrency.
function _tripConvert(amount, srcCurrency) {
  var src = (_TRIP_FX_TO_USD[srcCurrency]  || 1);
  var dst = (_TRIP_FX_TO_USD[_tripChartCurrency] || 1);
  return amount * src / dst;
}

// ── Entry ─────────────────────────────────────────────────────────────────────
window.tripLoadChart = function() {
  _tripEnsureChartLib()
    .then(function() { return _tripChartLoadPlans(); })
    .then(function() { _tripChartRefresh(); })
    .catch(function(e) {
      console.error('[trip-chart]', e);
      _tripShowToast('Failed to load chart library', true);
    });
};

// ── Lazy-load Chart.js from local vendor ─────────────────────────────────────
function _tripEnsureChartLib() {
  if (_tripChartLibLoaded && window.Chart) return Promise.resolve();
  if (_tripChartLibPromise) return _tripChartLibPromise;
  _tripChartLibPromise = new Promise(function(resolve, reject) {
    var s   = document.createElement('script');
    s.src   = '/static/js/vendor/chart.umd.min.js';
    s.onload  = function() { _tripChartLibLoaded = true; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return _tripChartLibPromise;
}

// ── Load plans list (once per session) ───────────────────────────────────────
function _tripChartLoadPlans() {
  if (_tripChartPlans.length) return Promise.resolve();
  return _tripFetch('/home/trip/' + _tripPid + '/plans')
    .then(function(r) { return r.json(); })
    .then(function(d) { _tripChartPlans = Array.isArray(d) ? d : (d.plans || []); })
    .catch(function() { _tripChartPlans = []; });
}

// ── Controls bar (plan picker + currency picker) ──────────────────────────────
function _tripChartRenderControls() {
  var el = document.getElementById('trip-chart-controls');
  if (!el) return;

  // Plan options
  var planOpts = '<option value="0">🗺️ All Plans</option>' +
    _tripChartPlans.map(function(p) {
      var dates = (p.start_date && p.end_date)
        ? ' (' + p.start_date + ' → ' + p.end_date + ')' : '';
      return '<option value="' + p.id + '"' +
        (p.id === _tripChartPlanId ? ' selected' : '') +
        '>' + _tripEsc(p.plan_name) + dates + '</option>';
    }).join('');

  // Currency options
  var curOpts = _TRIP_FX_LABELS.map(function(c) {
    return '<option value="' + c + '"' + (c === _tripChartCurrency ? ' selected' : '') + '>' + c + '</option>';
  }).join('');

  var selCls = 'text-xs rounded-lg border border-gray-200 dark:border-zinc-700 ' +
               'bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 ' +
               'px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#0053e2]/40';

  el.innerHTML =
    '<div class="flex flex-wrap items-center gap-3 px-4 py-2 ' +
    'border-b border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/60">' +
      '<label class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400">' +
        '🗓️ <span>Plan</span>' +
        '<select class="' + selCls + '" onchange="tripChartSetPlan(+this.value)">' +
          planOpts +
        '</select>' +
      '</label>' +
      '<label class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400">' +
        '💱 <span>Display in</span>' +
        '<select class="' + selCls + '" onchange="tripChartSetCurrency(this.value)">' +
          curOpts +
        '</select>' +
      '</label>' +
      '<span class="text-[10px] text-gray-400 dark:text-zinc-500 italic ml-auto">' +
        'FX rates are approximate — for planning only' +
      '</span>' +
    '</div>';
}

window.tripChartSetPlan = function(planId) {
  _tripChartPlanId = planId;
  _tripChartRefresh();
};

window.tripChartSetCurrency = function(cur) {
  _tripChartCurrency = cur;
  // Re-render from cached data — no new fetch needed
  if (_tripChartLastData) _tripChartRenderAll(_tripChartLastData);
};

// ── Fetch + refresh ───────────────────────────────────────────────────────────
function _tripChartRefresh() {
  var url = '/home/trip/' + _tripPid + '/stats';
  if (_tripChartPlanId) url += '?plan_id=' + _tripChartPlanId;
  _tripChartRenderControls();
  _tripFetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _tripChartLastData = data;
      _tripChartRenderAll(data);
    })
    .catch(function(e) {
      console.error('[trip-chart] stats fetch failed', e);
      _tripShowToast('Failed to load stats', true);
    });
}

// ── Master render ─────────────────────────────────────────────────────────────
function _tripChartRenderAll(data) {
  _tripRenderStatCards(data);
  _tripRenderTypeChart(data);
  _tripRenderBudgetChart(data);
  _tripRenderBudgetPanels(data);
  _tripRenderSettlePanels(data);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _tripEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _tripChartSubhead(icon, title, desc) {
  return '<div class="px-1 pt-4 pb-1">' +
    '<p class="text-xs font-semibold text-gray-700 dark:text-zinc-200">' + icon + ' ' + title + '</p>' +
    '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">' + desc + '</p>' +
  '</div>';
}

// ── Stat cards ────────────────────────────────────────────────────────────────
function _tripRenderStatCards(data) {
  var el = document.getElementById('trip-stats-cards');
  if (!el) return;

  // Convert grand total if single currency, or sum raw_by_type with FX
  var budgetVal = '—';
  var raw = data.raw_by_type || [];
  if (raw.length) {
    var converted = 0;
    raw.forEach(function(r) { converted += _tripConvert(r.total_cost, r.currency); });
    if (converted > 0) {
      budgetVal = _tripChartCurrency + ' ' + converted.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0});
      if (data.mixed_currencies) budgetVal += ' *';
    }
  }

  var scopeNote = _tripChartPlanId
    ? (_tripChartPlans.find(function(p){ return p.id===_tripChartPlanId; }) || {}).plan_name || ''
    : 'All Research';

  var cards = [
    {icon: '📍', label: 'Locations',        value: data.total_locations || 0},
    {icon: '🎯', label: 'Spots Researched',  value: data.total_spots    || 0},
    {icon: '🗓️', label: 'Days Planned',      value: data.total_days     || 0},
    {icon: '💰', label: 'Est. Cost (' + _tripChartCurrency + ')', value: budgetVal},
  ];

  var intro = '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mb-3 px-1">' +
    'Showing stats for: <strong class="text-gray-600 dark:text-zinc-300">' +
    _tripEsc(scopeNote) + '</strong>' +
    (data.mixed_currencies
      ? ' &nbsp;·&nbsp; <span title="Costs converted using approximate FX rates">💱 Mixed currencies auto-converted to ' + _tripChartCurrency + '</span>'
      : '') +
  '</p>';

  el.innerHTML = intro + '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
    cards.map(function(c) {
      return '<div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 ' +
        'dark:border-zinc-800 p-4 flex items-center gap-3">' +
        '<span class="text-2xl" aria-hidden="true">' + c.icon + '</span>' +
        '<div>' +
          '<p class="text-xs text-gray-500 dark:text-zinc-400">' + c.label + '</p>' +
          '<p class="text-lg font-bold text-gray-800 dark:text-zinc-100">' + c.value + '</p>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>' +
    (data.mixed_currencies
      ? '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-1 px-1 italic">' +
        '* Costs converted from ' + (data.currencies || []).join(', ') +
        ' using approximate rates. Actual costs may vary.' +
        '</p>'
      : '');
}

// ── Spot-type doughnut ────────────────────────────────────────────────────────
function _tripRenderTypeChart(data) {
  var wrap   = document.getElementById('trip-chart-type-wrap');
  var canvas = document.getElementById('trip-canvas-type');
  if (!canvas || !window.Chart) return;

  if (_tripTypeChart) { _tripTypeChart.destroy(); _tripTypeChart = null; }

  var byType = data.by_type || [];
  if (!byType.length) {
    canvas.parentNode.innerHTML =
      '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center pt-10">No data yet</p>';
  } else {
    var colors = window._tripChartColors || ['#0053e2','#ffc220','#2a8703','#ea1100'];
    _tripTypeChart = new window.Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: byType.map(function(t) {
          return t.spot_type.charAt(0).toUpperCase() + t.spot_type.slice(1);
        }),
        datasets: [{
          data: byType.map(function(t) { return t.count; }),
          backgroundColor: byType.map(function(_, i) { return colors[i % colors.length]; }),
          borderWidth: 2,
          borderColor: '#ffffff',
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {position: 'bottom', labels: {font: {size: 11}, padding: 10, boxWidth: 12}},
          tooltip: {callbacks: {label: function(ctx) {
            return ' ' + ctx.label + ': ' + ctx.raw + ' spot' + (ctx.raw === 1 ? '' : 's');
          }}},
        },
      },
    });
  }

  if (wrap) {
    var desc = document.getElementById('trip-chart-type-desc');
    if (!desc) {
      desc = document.createElement('p');
      desc.id = 'trip-chart-type-desc';
      desc.className = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-2 text-center px-2';
      wrap.appendChild(desc);
    }
    desc.textContent = 'Each slice = one spot type. Size reflects count, not cost. ' +
      byType.map(function(t) {
        return (t.spot_type.charAt(0).toUpperCase()+t.spot_type.slice(1)) + ': ' + t.count;
      }).join(' · ');
  }
}

// ── Cost-by-type bar ─────────────────────────────────────────────────────────
function _tripRenderBudgetChart(data) {
  var wrap   = document.getElementById('trip-chart-budget-wrap');
  var canvas = document.getElementById('trip-canvas-budget');
  if (!canvas || !window.Chart) return;

  if (_tripBudgetChart) { _tripBudgetChart.destroy(); _tripBudgetChart = null; }

  // Build converted totals per spot_type using raw_by_type
  var raw = data.raw_by_type || [];
  var typeMap = {};
  raw.forEach(function(r) {
    if (!typeMap[r.spot_type]) typeMap[r.spot_type] = 0;
    typeMap[r.spot_type] += _tripConvert(r.total_cost, r.currency);
  });

  var entries = Object.keys(typeMap)
    .map(function(k) { return {type: k, cost: typeMap[k]}; })
    .filter(function(e) { return e.cost > 0; })
    .sort(function(a,b) { return b.cost - a.cost; });

  if (!entries.length) {
    canvas.parentNode.innerHTML =
      '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center pt-10">No cost estimates yet — ' +
      'add estimated costs to your spots to see the breakdown.</p>';
    return;
  }

  var cur    = _tripChartCurrency;
  var colors = window._tripChartColors || ['#0053e2','#ffc220','#2a8703','#ea1100'];
  var total  = entries.reduce(function(s,e){ return s+e.cost; }, 0);

  _tripBudgetChart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: entries.map(function(e) {
        return e.type.charAt(0).toUpperCase() + e.type.slice(1);
      }),
      datasets: [{
        label: 'Est. Cost (' + cur + ')',
        data:  entries.map(function(e) { return Math.round(e.cost); }),
        backgroundColor: entries.map(function(_, i) { return colors[i % colors.length] + 'cc'; }),
        borderColor:     entries.map(function(_, i) { return colors[i % colors.length]; }),
        borderWidth: 1.5,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {display: false},
        tooltip: {callbacks: {
          label: function(ctx) {
            var pct = total > 0 ? Math.round(ctx.raw / total * 100) : 0;
            return ' ' + cur + ' ' + ctx.raw.toLocaleString() + '  (' + pct + '% of total)';
          },
        }},
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {color: 'rgba(148,163,184,0.15)'},
          ticks: {font: {size: 11}, callback: function(v) { return cur + ' ' + v.toLocaleString(); }},
        },
        x: {grid: {display: false}, ticks: {font: {size: 11}}},
      },
    },
  });

  if (wrap) {
    var desc = document.getElementById('trip-chart-budget-desc');
    if (!desc) {
      desc = document.createElement('p');
      desc.id = 'trip-chart-budget-desc';
      desc.className = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-2 px-2';
      wrap.appendChild(desc);
    }
    var lines = entries.map(function(e) {
      var pct = total > 0 ? Math.round(e.cost/total*100) : 0;
      return (e.type.charAt(0).toUpperCase()+e.type.slice(1)) + ' ' + pct + '%';
    });
    desc.textContent = 'Estimated cost per category converted to ' + cur + '. ' +
      'Breakdown: ' + lines.join(' · ') + '. ' +
      (data.mixed_currencies ? 'Original currencies: ' + (data.currencies||[]).join(', ') + '. ' : '') +
      'Hover bars for exact amounts.';
  }
}

// ── Budget panel cards ─────────────────────────────────────────────────────
// Shows each budget panel's ceiling vs actual spend, with line-item rows.
// Amounts are converted to the user's selected display currency.
function _tripRenderBudgetPanels(data) {
  var el = document.getElementById('trip-chart-budget-panels');
  if (!el) return;
  var panels = data.budget_panels || [];
  if (!panels.length) {
    el.innerHTML = '';
    return;
  }
  var cur = _tripChartCurrency;
  var sectionCls = 'bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 ' +
                   'dark:border-zinc-800 p-4';

  var cards = panels.map(function(p) {
    var ceiling  = _tripConvert(p.ceiling,  p.currency);
    var spent    = _tripConvert(p.spent,    p.currency);
    var remaining = ceiling - spent;
    var pct      = ceiling > 0 ? Math.min(Math.round(spent / ceiling * 100), 100) : 0;
    var barColor = pct >= 90 ? '#ea1100' : pct >= 70 ? '#f59e0b' : '#2a8703';
    var overBudget = ceiling > 0 && spent > ceiling;

    // Line-item rows
    var itemRows = (p.items || []).filter(function(it) { return it.amount > 0; })
      .map(function(it) {
        var converted = _tripConvert(it.amount, p.currency);
        var itPct = spent > 0 ? Math.round(converted / spent * 100) : 0;
        return '<div class="flex items-center gap-2 py-1 border-b ' +
               'border-gray-50 dark:border-zinc-800/60 last:border-0">' +
          '<span class="text-[11px] text-gray-600 dark:text-zinc-300 flex-1 truncate">' +
            _tripEsc(it.label || '—') + '</span>' +
          '<div class="w-16 h-1.5 bg-gray-100 dark:bg-zinc-700 rounded-full overflow-hidden flex-shrink-0">' +
            '<div class="h-full rounded-full" style="width:' + itPct + '%;background:' + barColor + '"></div>' +
          '</div>' +
          '<span class="text-[11px] font-medium text-gray-700 dark:text-zinc-200 w-20 text-right flex-shrink-0">' +
            cur + ' ' + converted.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0}) +
          '</span>' +
        '</div>';
      }).join('');

    var converted_note = p.currency !== cur
      ? '<span class="text-[10px] text-gray-400 dark:text-zinc-500 ml-1">(orig. ' + p.currency + ')</span>' : '';

    return '<div class="' + sectionCls + '">' +
      // Header
      '<div class="flex items-center gap-2 mb-3">' +
        '<span class="text-base">💰</span>' +
        '<p class="text-xs font-semibold text-gray-700 dark:text-zinc-200 flex-1">' +
          _tripEsc(p.title) + '</p>' +
        '<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 ' +
               'text-[#0053e2] dark:text-blue-400 font-medium">📊 in chart</span>' +
        converted_note +
      '</div>' +
      // Progress bar + numbers
      '<div class="mb-2">' +
        '<div class="flex justify-between text-[11px] mb-1">' +
          '<span class="font-semibold ' + (overBudget ? 'text-red-500' : 'text-gray-700 dark:text-zinc-200') + '">' +
            cur + ' ' + spent.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0}) + ' spent' +
          '</span>' +
          '<span class="text-gray-400 dark:text-zinc-500">' +
            (ceiling > 0
              ? (overBudget
                  ? '⚠️ over by ' + cur + ' ' + Math.abs(remaining).toLocaleString('en-US', {maximumFractionDigits: 0})
                  : cur + ' ' + remaining.toLocaleString('en-US', {maximumFractionDigits: 0}) + ' left of ' +
                    cur + ' ' + ceiling.toLocaleString('en-US', {maximumFractionDigits: 0}))
              : 'No ceiling set') +
          '</span>' +
        '</div>' +
        '<div class="h-2 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">' +
          '<div class="h-full rounded-full transition-all" style="width:' + pct + '%;background:' + barColor + '"></div>' +
        '</div>' +
        '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5 text-right">' + pct + '% of budget used</p>' +
      '</div>' +
      // Line items
      (itemRows
        ? '<div class="mt-3 pt-2 border-t border-gray-100 dark:border-zinc-800">' +
            '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 mb-1">Line items</p>' +
            itemRows +
          '</div>'
        : '<p class="text-[11px] text-gray-400 dark:text-zinc-500 italic">No line items added yet.</p>') +
    '</div>';
  }).join('');

  el.innerHTML =
    '<div class="mb-3">' +
      '<p class="text-xs font-semibold text-gray-700 dark:text-zinc-200">💰 Budget Trackers</p>' +
      '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">' +
        'Manual budget panels from your trip plan. Ceiling vs what you have logged so far.' +
      '</p>' +
    '</div>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' + cards + '</div>';
}

// ── Settle / split panel cards ──────────────────────────────────────────────
// Shows each settle panel's per-person paid / owes / balance breakdown.
function _tripRenderSettlePanels(data) {
  var el = document.getElementById('trip-chart-settle-panels');
  if (!el) return;
  var panels = data.settle_panels || [];
  if (!panels.length) {
    el.innerHTML = '';
    return;
  }
  var cur = _tripChartCurrency;
  var sectionCls = 'bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 ' +
                   'dark:border-zinc-800 p-4';

  var cards = panels.map(function(p) {
    var totalConv = _tripConvert(p.total_expenses, p.currency);
    var converted_note = p.currency !== cur
      ? ' <span class="text-[10px] text-gray-400 dark:text-zinc-500">(orig. ' + p.currency + ')</span>' : '';

    var rows = (p.per_person || []).map(function(person) {
      var paid    = _tripConvert(person.paid,    p.currency);
      var owes    = _tripConvert(person.owes,    p.currency);
      var balance = _tripConvert(person.balance, p.currency);
      var balColor = balance >= 0
        ? 'text-[#2a8703] dark:text-green-400'
        : 'text-[#ea1100] dark:text-red-400';
      var balPrefix = balance >= 0 ? '+' : '';
      var balLabel  = balance >= 0 ? 'gets back' : 'still owes';
      return '<tr class="border-b border-gray-50 dark:border-zinc-800 last:border-0">' +
        '<td class="py-1.5 pr-3 text-[11px] font-medium text-gray-700 dark:text-zinc-200">' +
          _tripEsc(person.name) + '</td>' +
        '<td class="py-1.5 pr-3 text-[11px] text-gray-500 dark:text-zinc-400 text-right">' +
          cur + ' ' + paid.toLocaleString('en-US', {maximumFractionDigits: 0}) + '</td>' +
        '<td class="py-1.5 pr-3 text-[11px] text-gray-500 dark:text-zinc-400 text-right">' +
          cur + ' ' + owes.toLocaleString('en-US', {maximumFractionDigits: 0}) + '</td>' +
        '<td class="py-1.5 text-[11px] font-semibold text-right ' + balColor + '" ' +
             'title="' + balLabel + '">' +
          balPrefix + cur + ' ' + Math.abs(balance).toLocaleString('en-US', {maximumFractionDigits: 0}) +
        '</td>' +
      '</tr>';
    }).join('');

    return '<div class="' + sectionCls + '">' +
      '<div class="flex items-center gap-2 mb-3">' +
        '<span class="text-base">🤝</span>' +
        '<p class="text-xs font-semibold text-gray-700 dark:text-zinc-200 flex-1">' +
          _tripEsc(p.title) + '</p>' +
        '<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 ' +
               'text-[#0053e2] dark:text-blue-400 font-medium">📊 in chart</span>' +
      '</div>' +
      '<p class="text-[11px] text-gray-500 dark:text-zinc-400 mb-3">' +
        'Total expenses: <strong class="text-gray-700 dark:text-zinc-200">' +
          cur + ' ' + totalConv.toLocaleString('en-US', {maximumFractionDigits: 0}) +
        '</strong>' + converted_note +
      '</p>' +
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
            '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-2">' +
              'Green → gets money back · Red → still owes' +
            '</p>' +
          '</div>'
        : '<p class="text-[11px] text-gray-400 dark:text-zinc-500 italic">No people added yet.</p>') +
    '</div>';
  }).join('');

  el.innerHTML =
    '<div class="mb-3">' +
      '<p class="text-xs font-semibold text-gray-700 dark:text-zinc-200">🤝 Group Expenses (Settle Up)</p>' +
      '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">' +
        'Per-person paid / fair share / balance from your Settle Up panels.' +
        ' Positive balance means they get money back.' +
      '</p>' +
    '</div>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' + cards + '</div>';
}
