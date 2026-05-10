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
var _tripChartSelectedPerson = null;  // null = All, or name string from settle panel

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
  _tripRenderPersonPicker(data);     // drill.js — person pill filter
  _tripRenderStatCards(data);
  _tripRenderTypeChart(data);
  _tripRenderBudgetChart(data);
  _tripRenderBudgetPanels(data);     // drill.js — panel cards
  _tripRenderSettlePanels(data);     // drill.js — panel cards
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
  var cur = _tripChartCurrency;

  // Spot estimates total (from researched spots with estimated_cost)
  var spotTotal = 0;
  (data.raw_by_type || []).forEach(function(r) {
    spotTotal += _tripConvert(r.total_cost, r.currency);
  });

  // Budget panel ceiling total (user's intentional planned budget)
  var budgetCeiling = 0;
  (data.budget_panels || []).forEach(function(bp) {
    budgetCeiling += _tripConvert(bp.ceiling, bp.currency);
  });

  var costVal, costLabel, costSub;
  if (_tripChartSelectedPerson) {
    var personOwes = 0, personPaid = 0, personBal = 0;
    (data.settle_panels || []).forEach(function(sp) {
      (sp.per_person || []).forEach(function(pp) {
        if (pp.name === _tripChartSelectedPerson) {
          personOwes += _tripConvert(pp.owes,    sp.currency);
          personPaid += _tripConvert(pp.paid,    sp.currency);
          personBal  += _tripConvert(pp.balance, sp.currency);
        }
      });
    });
    // Net cost = what they'll ultimately pay after all settlements
    // = paid - balance (if positive) or paid + |balance| (if negative)
    // which always equals owes/fair-share, but framed as a real spend figure.
    var netCost = personPaid - personBal;   // same as personOwes
    var fmt = function(n) {
      return cur + ' ' + Math.abs(Math.round(n)).toLocaleString('en-US');
    };
    costVal   = fmt(netCost);
    costLabel = _tripChartSelectedPerson + "'s Net Trip Cost";
    // Sub-note breaks down how we got there
    var paidStr = fmt(personPaid);
    if (personBal > 0.5) {
      // they overpaid — getting money back
      costSub =
        '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">' +
          'Paid ' + paidStr +
          ' &minus; <span class="text-[#2a8703] dark:text-green-400 font-medium">' +
            fmt(personBal) + ' back✓' +
          '</span>' +
        '</p>';
    } else if (personBal < -0.5) {
      // they underpaid — still owe more
      costSub =
        '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">' +
          'Paid ' + paidStr +
          ' + <span class="text-[#ea1100] dark:text-red-400 font-medium">' +
            fmt(Math.abs(personBal)) + ' owed⚠' +
          '</span>' +
        '</p>';
    } else {
      costSub =
        '<p class="text-[10px] text-[#2a8703] dark:text-green-400 font-medium mt-0.5">Settled up ✓</p>';
    }
  } else if (budgetCeiling > 0) {
    costVal   = cur + ' ' + budgetCeiling.toLocaleString('en-US', {maximumFractionDigits: 0});
    costLabel = 'Budget Ceiling (' + cur + ')';
    costSub   = '';
  } else if (spotTotal > 0) {
    costVal   = cur + ' ' + spotTotal.toLocaleString('en-US', {maximumFractionDigits: 0});
    if (data.mixed_currencies) costVal += ' *';
    costLabel = 'Spot Estimates (' + cur + ')';
    costSub   = '';
  } else {
    costVal   = '—';
    costLabel = 'Est. Cost (' + cur + ')';
    costSub   = '';
  }

  var scopeNote = _tripChartPlanId
    ? (_tripChartPlans.find(function(p){ return p.id === _tripChartPlanId; }) || {}).plan_name || ''
    : 'All Research';

  var cards = [
    {icon: '📍', label: 'Locations',       value: data.total_locations || 0, sub: ''},
    {icon: '🎯', label: 'Spots Researched', value: data.total_spots    || 0, sub: ''},
    {icon: '🗓️', label: 'Days Planned',     value: data.total_days     || 0, sub: ''},
    {icon: '💰', label: costLabel,           value: costVal,                  sub: costSub || ''},
  ];

  var intro = '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mb-3 px-1">' +
    'Showing stats for: <strong class="text-gray-600 dark:text-zinc-300">' +
    _tripEsc(scopeNote) + '</strong>' +
    (data.mixed_currencies
      ? ' &nbsp;·&nbsp; <span title="Costs converted using approximate FX rates">💱 Mixed currencies → ' + cur + '</span>'
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
          (c.sub || '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>' +
    (data.mixed_currencies
      ? '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-1 px-1 italic">' +
        '* Costs converted from ' + (data.currencies || []).join(', ') +
        ' using approximate rates. Actual costs may vary.</p>'
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
        onClick: function(evt, elements) {
          if (!elements.length) return;
          var idx = elements[0].index;
          var t   = byType[idx];
          if (t) _tripChartOpenSpotTypeDrawer(t.spot_type, _tripChartLastData);
        },
      },
    });
    if (canvas.style) canvas.style.cursor = 'pointer';
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

// ── Cost bar: spot estimates + budget panel items merged ──────────────────────
// Blue bars = costs from researched spots (grouped by spot_type).
// Yellow bars = line items from budget panels (flights, hotel, etc.).
// Both are converted to the selected display currency.
function _tripRenderBudgetChart(data) {
  var wrap   = document.getElementById('trip-chart-budget-wrap');
  var canvas = document.getElementById('trip-canvas-budget');
  if (!canvas || !window.Chart) return;
  if (_tripBudgetChart) { _tripBudgetChart.destroy(); _tripBudgetChart = null; }

  var cur = _tripChartCurrency;

  // ── Dataset A: spot-type estimates (blue) ──────────────────────────────────
  var typeMap = {};
  (data.raw_by_type || []).forEach(function(r) {
    if (!typeMap[r.spot_type]) typeMap[r.spot_type] = 0;
    typeMap[r.spot_type] += _tripConvert(r.total_cost, r.currency);
  });
  var spotEntries = Object.keys(typeMap)
    .map(function(k) {
      return {
        label:   k.charAt(0).toUpperCase() + k.slice(1),
        rawType: k,     // original snake_case key for drill-down filtering
        cost:    Math.round(typeMap[k]),
        source:  'spot',
      };
    })
    .filter(function(e) { return e.cost > 0; })
    .sort(function(a, b) { return b.cost - a.cost; });

  // ── Dataset B: budget panel items (yellow) ─────────────────────────────────
  var budgetEntries = [];
  (data.budget_panels || []).forEach(function(bp) {
    (bp.items || []).forEach(function(it) {
      var converted = Math.round(_tripConvert(it.amount, bp.currency));
      if (converted > 0) {
        budgetEntries.push({label: it.label || 'Item', cost: converted,
                            source: 'budget', panel: bp.title});
      }
    });
  });
  budgetEntries.sort(function(a, b) { return b.cost - a.cost; });
  var allEntries = spotEntries.concat(budgetEntries);

  if (!allEntries.length) {
    canvas.parentNode.innerHTML =
      '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center pt-10">' +
      'No cost data yet — add estimated costs to spots, or line items to a Budget panel.</p>';
    return;
  }

  var total = allEntries.reduce(function(s, e) { return s + e.cost; }, 0);
  // Colors: blue for spot, spark-yellow for budget items
  var BG_SPOT   = '#0053e2cc';
  var BG_BUDGET = '#ffc220cc';
  var BD_SPOT   = '#0053e2';
  var BD_BUDGET = '#995213';   // spark.140 for border contrast

  _tripBudgetChart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: allEntries.map(function(e) { return e.label; }),
      datasets: [{
        label: 'Cost (' + cur + ')',
        data:  allEntries.map(function(e) { return e.cost; }),
        backgroundColor: allEntries.map(function(e) {
          return e.source === 'spot' ? BG_SPOT : BG_BUDGET;
        }),
        borderColor: allEntries.map(function(e) {
          return e.source === 'spot' ? BD_SPOT : BD_BUDGET;
        }),
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
            var e   = allEntries[ctx.dataIndex];
            var pct = total > 0 ? Math.round(ctx.raw / total * 100) : 0;
            var src = e.source === 'spot' ? 'Spot estimate' : ('Budget: ' + (e.panel || ''));
            return [' ' + cur + ' ' + ctx.raw.toLocaleString() + ' (' + pct + '%)', ' Source: ' + src];
          },
        }},
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {color: 'rgba(148,163,184,0.15)'},
          ticks: {font: {size: 11}, callback: function(v) { return cur + ' ' + v.toLocaleString(); }},
        },
        x: {grid: {display: false}, ticks: {font: {size: 10}, maxRotation: 35}},
      },
      onClick: function(evt, elements) {
        if (!elements.length) return;
        var e = allEntries[elements[0].index];
        if (!e) return;
        if (e.source === 'spot') {
          _tripChartOpenSpotTypeDrawer(e.rawType, _tripChartLastData);
        } else {
          _tripChartOpenBudgetItemDrawer(e, _tripChartLastData);
        }
      },
    },
  });
  if (canvas.style) canvas.style.cursor = 'pointer';

  // Manual color legend + summary below chart
  if (wrap) {
    var leg = document.getElementById('trip-chart-budget-legend');
    if (!leg) {
      leg = document.createElement('div');
      leg.id = 'trip-chart-budget-legend';
      leg.className = 'flex flex-wrap gap-3 mt-2 px-1';
      wrap.appendChild(leg);
    }
    var legendItems = [];
    if (spotEntries.length)   legendItems.push('<span class="flex items-center gap-1 text-[11px] text-gray-500 dark:text-zinc-400"><span class="inline-block w-3 h-3 rounded-sm flex-shrink-0" style="background:#0053e2"></span>Spot estimates</span>');
    if (budgetEntries.length) legendItems.push('<span class="flex items-center gap-1 text-[11px] text-gray-500 dark:text-zinc-400"><span class="inline-block w-3 h-3 rounded-sm flex-shrink-0" style="background:#ffc220"></span>Budget plan items</span>');
    leg.innerHTML = legendItems.join('');

    var desc = document.getElementById('trip-chart-budget-desc');
    if (!desc) {
      desc = document.createElement('p');
      desc.id = 'trip-chart-budget-desc';
      desc.className = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1 px-1';
      wrap.appendChild(desc);
    }
    desc.textContent =
      (spotEntries.length   ? spotEntries.length   + ' spot type' + (spotEntries.length   > 1 ? 's' : '') + ' · ' : '') +
      (budgetEntries.length ? budgetEntries.length + ' budget item' + (budgetEntries.length > 1 ? 's' : '') + ' · ' : '') +
      'Total ' + cur + ' ' + total.toLocaleString() + '. Hover bars for source detail.';
  }
}
