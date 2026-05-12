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
var _tripChartPhase      = 'actuals'; // 'actuals' | 'planning'  — Actuals is the default view

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

// ── Phase toggle (Planning vs Actuals) ─────────────────────────────────────
function _tripChartRenderPhaseToggle() {
  var el = document.getElementById('trip-chart-phase-toggle');
  if (!el) return;
  var btnCls = function(phase) {
    var active = _tripChartPhase === phase;
    return 'px-4 py-1.5 text-xs font-semibold rounded-full transition ' +
      (active
        ? (phase === 'planning'
            ? 'bg-[#0053e2] text-white shadow'
            : 'bg-[#2a8703] text-white shadow')
        : 'bg-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200');
  };
  el.innerHTML =
    '<div class="flex items-center justify-center gap-1 px-4 py-2.5 ' +
    'border-b border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-950">' +
      '<span class="text-xs text-gray-400 dark:text-zinc-500 mr-2">View:</span>' +
      '<div class="flex items-center gap-0.5 bg-gray-100 dark:bg-zinc-800 rounded-full p-0.5">' +
        '<button onclick="tripChartSetPhase(\'actuals\')" class="' + btnCls('actuals') + '">' +
          '✅ Actuals' +
        '</button>' +
        '<button onclick="tripChartSetPhase(\'planning\')" class="' + btnCls('planning') + '">' +
          '🗺️ Planning' +
        '</button>' +
      '</div>' +
      '<span class="ml-3 text-[10px] text-gray-400 dark:text-zinc-500 italic">' +
        (_tripChartPhase === 'planning'
          ? 'Spot estimates &amp; budget ceiling'
          : 'Logged expenses &amp; settlements') +
      '</span>' +
    '</div>';
}

window.tripChartSetPhase = function(phase) {
  _tripChartPhase = phase;
  _tripChartSelectedPerson = null; // reset person filter on phase switch
  // Always re-fetch on phase switch — avoids serving a stale cached response
  // that pre-dates backend changes (e.g. category field added to budget items).
  _tripChartRefresh();
};

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
  _tripChartRenderPhaseToggle();
  _tripChartRenderControls();
  _tripFetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _tripChartLastData = data;
      window._tripChartLastData = data;   // expose for Plan tab ceiling display
      _tripChartRenderAll(data);
    })
    .catch(function(e) {
      console.error('[trip-chart] stats fetch failed', e);
      _tripShowToast('Failed to load stats', true);
    });
}

// ── Master render ─────────────────────────────────────────────────────────────
function _tripChartRenderAll(data) {
  _tripChartRenderPhaseToggle();
  _tripRenderStatCards(data);
  _tripRenderTypeChart(data);
  _tripRenderBudgetChart(data);
  // Actuals-only sections
  var isActuals = _tripChartPhase === 'actuals';
  _tripRenderPersonPicker(isActuals ? data : null);  // drill.js
  _tripRenderBudgetPanels(isActuals ? data : null);  // drill.js
  _tripRenderSettlePanels(isActuals ? data : null);  // drill.js
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _tripEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Shared all-persons entry builder ─────────────────────────────────────────
// Canonical entry list for the "All" (no person selected) Actuals view.
// Matches the same sources as Net Spent: settleNetSpent + budgetTracked.
//   • Settle panel expenses — full group amounts, by category
//   • Unreconciled budget items only (reconciled ones are already inside settle)
function _tripAllEntries(data) {
  var entries = [];

  // 1. Settle panel expenses (complete group spend)
  (data.settle_panels || []).forEach(function(sp) {
    (sp.expenses || []).forEach(function(exp) {
      var conv = Math.round(_tripConvert(parseFloat(exp.amount) || 0, sp.currency));
      if (conv <= 0) return;
      entries.push({
        label:    exp.desc || 'Expense',
        cost:     conv,
        category: exp.category || '',
        source:   'settle',
        panel:    sp.title,
      });
    });
  });

  // 2. Unreconciled budget items only (skip reconciled — already in settle above)
  (data.budget_panels || []).forEach(function(bp) {
    (bp.items || []).forEach(function(it) {
      if (it.reconciled) return;
      var conv = Math.round(_tripConvert(parseFloat(it.amount) || 0, bp.currency));
      if (conv <= 0) return;
      entries.push({
        label:    it.label || it.note || 'Budget Item',
        cost:     conv,
        category: it.category || '',
        source:   'budget',
        panel:    bp.title,
      });
    });
  });

  return entries;
}
// Computes the canonical flat list of cost entries for a specific person.
// Used by BOTH the doughnut (Budget by Category) and bar (Actual Expenses)
// charts so they always display the same total.
//
// Each entry: { label, cost, didPay, panel, category, isManual }
function _tripPersonEntries(data, person) {
  var entries = [];

  // ─ 1. Settle panel expenses ───────────────────────────────────────
  (data.settle_panels || []).forEach(function(sp) {
    var personIdx = -1;
    (sp.per_person || []).forEach(function(pp, loopI) {
      if (pp.name === person) personIdx = (pp.idx !== undefined ? pp.idx : loopI);
    });
    if (personIdx < 0) return;
    (sp.expenses || []).forEach(function(exp) {
      var splitArr = Array.isArray(exp.split) ? exp.split : [];
      if (!splitArr.length && sp.per_person && sp.per_person.length) {
        for (var fi = 0; fi < sp.per_person.length; fi++) splitArr.push(fi);
      }
      if (splitArr.indexOf(personIdx) === -1) return;
      var shareConv = Math.round(_tripConvert(exp.amount / (splitArr.length || 1), sp.currency));
      if (shareConv <= 0) return;
      entries.push({
        label:    exp.desc || 'Expense',
        cost:     shareConv,
        didPay:   exp.paid_by === personIdx,
        panel:    sp.title,
        category: exp.category || '',
      });
    });
  });

  // ─ 2. Budget panel items ─────────────────────────────────────────
  var settleNames = {};
  (data.settle_panels || []).forEach(function(sp) {
    (sp.per_person || []).forEach(function(pp) { settleNames[pp.name] = true; });
  });
  var settlePeopleCount = Object.keys(settleNames).length;

  (data.budget_panels || []).forEach(function(bp) {
    var scope = (bp.budget_scope || 'group');
    if (scope === 'individual') {
      if ((bp.budget_person || '').trim() !== person) return;
      (bp.items || []).forEach(function(it) {
        var conv = Math.round(_tripConvert(parseFloat(it.amount) || 0, bp.currency));
        if (conv <= 0) return;
        entries.push({
          label:    it.label || it.note || 'Budget Item',
          cost:     conv,
          didPay:   true,
          panel:    bp.title,
          category: it.category || '',
          isManual: true,
        });
      });
    } else {
      // Group: divide equally; use people_count from linked People card, else
      // fall back to unique names across all settle panels.
      var divisor = (bp.people_count && bp.people_count > 0)
        ? bp.people_count
        : (settlePeopleCount > 0 ? settlePeopleCount : 1);
      (bp.items || []).forEach(function(it) {
        var share = Math.round(_tripConvert(parseFloat(it.amount) || 0, bp.currency) / divisor);
        if (share <= 0) return;
        entries.push({
          label:    it.label || it.note || 'Group Budget Item',
          cost:     share,
          didPay:   false,
          panel:    bp.title + ' (÷' + divisor + ')',
          category: it.category || '',
          isManual: true,
        });
      });
    }
  });

  return entries;
}

function _tripChartSubhead(icon, title, desc) {
  return '<div class="px-1 pt-4 pb-1">' +
    '<p class="text-xs font-semibold text-gray-700 dark:text-zinc-200">' + icon + ' ' + title + '</p>' +
    '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">' + desc + '</p>' +
  '</div>';
}

// ── Stat cards ──────────────────────────────────────────────────────────────
function _tripRenderStatCards(data) {
  var el = document.getElementById('trip-stats-cards');
  if (!el) return;
  var cur = _tripChartCurrency;

  // Spot estimates total
  var spotTotal = 0;
  (data.raw_by_type || []).forEach(function(r) {
    spotTotal += _tripConvert(r.total_cost, r.currency);
  });

  // Budget ceiling total
  var budgetCeiling = 0;
  (data.budget_panels || []).forEach(function(bp) {
    budgetCeiling += _tripConvert(bp.ceiling, bp.currency);
  });

  var scopeNote = _tripChartPlanId
    ? (_tripChartPlans.find(function(p){ return p.id === _tripChartPlanId; }) || {}).plan_name || ''
    : 'All Research';

  var intro = '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mb-3 px-1">' +
    'Showing stats for: <strong class="text-gray-600 dark:text-zinc-300">' +
    _tripEsc(scopeNote) + '</strong>' +
    (data.mixed_currencies
      ? ' &nbsp;·&nbsp; <span title="Costs converted using approximate FX rates">💱 Mixed currencies → ' + cur + '</span>'
      : '') +
  '</p>';

  // ── PLANNING MODE: spot estimates + budget ceiling only ─────────────────
  if (_tripChartPhase === 'planning') {
    var estVal  = spotTotal > 0
      ? cur + '\u00a0' + Math.round(spotTotal).toLocaleString('en-US')
      : '—';
    var ceilVal = budgetCeiling > 0
      ? cur + '\u00a0' + Math.round(budgetCeiling).toLocaleString('en-US')
      : '—';
    var planningCards = [
      {icon: '📍', label: 'Locations',        value: data.total_locations || 0, sub: ''},
      {icon: '🎯', label: 'Spots Researched', value: data.total_spots    || 0, sub: ''},
      {icon: '🗓️', label: 'Days Planned',     value: data.total_days     || 0, sub: ''},
      {icon: '💰', label: 'Est. Cost (' + cur + ')',
        value: estVal,
        sub: budgetCeiling > 0
          ? '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">of ' +
              ceilVal + ' ceiling</p>'
          : ''},
    ];
    el.innerHTML = intro + '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
      planningCards.map(function(c) {
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
    return;
  }

  // ── ACTUALS MODE ──────────────────────────────────────────────────────────
  var settleNetSpent = 0;
  (data.settle_panels || []).forEach(function(sp) {
    settleNetSpent += _tripConvert(sp.total_expenses, sp.currency);
  });

  // Budget tracked = sum of unreconciled manual items across all budget panels.
  var budgetTracked = 0;
  (data.budget_panels || []).forEach(function(bp) {
    budgetTracked += _tripConvert(bp.spent, bp.currency);
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
    // Also include budget panel items for this person:
    //   • Individual panels explicitly assigned to them
    //   • Group panels divided equally among the group members
    var settleNamesMap = {};
    (data.settle_panels || []).forEach(function(sp) {
      (sp.per_person || []).forEach(function(pp) { settleNamesMap[pp.name] = true; });
    });
    var fallbackCount = Object.keys(settleNamesMap).length;

    var indivBudgetSpent = 0;
    (data.budget_panels || []).forEach(function(bp) {
      var scope = (bp.budget_scope || 'group');
      if (scope === 'individual') {
        if ((bp.budget_person || '').trim() !== _tripChartSelectedPerson) return;
        indivBudgetSpent += _tripConvert(bp.spent, bp.currency);
      } else {
        // Group budget: add this person's equal share
        var div = (bp.people_count && bp.people_count > 0)
          ? bp.people_count
          : (fallbackCount > 0 ? fallbackCount : 1);
        // bp.spent = sum of unreconciled items
        indivBudgetSpent += _tripConvert(bp.spent, bp.currency) / div;
      }
    });
    // Net cost = fair-share from settle + manual budget spend
    var netCost = (personPaid - personBal) + indivBudgetSpent;
    var fmt = function(n) {
      return cur + ' ' + Math.abs(Math.round(n)).toLocaleString('en-US');
    };
    costVal   = fmt(netCost);
    costLabel = _tripChartSelectedPerson + "'s Net Trip Cost";
    var paidStr = fmt(personPaid);
    if (personBal > 0.5) {
      costSub =
        '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">' +
          'Settle: paid ' + paidStr +
          ' &minus; <span class="text-[#2a8703] dark:text-green-400 font-medium">' +
            fmt(personBal) + ' back ✓' +
          '</span>' +
          (indivBudgetSpent > 0 ? ' + ' + fmt(indivBudgetSpent) + ' manual' : '') +
        '</p>';
    } else if (personBal < -0.5) {
      costSub =
        '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">' +
          'Settle: paid ' + paidStr +
          ' + <span class="text-[#ea1100] dark:text-red-400 font-medium">' +
            fmt(Math.abs(personBal)) + ' still owed ⚠' +
          '</span>' +
          (indivBudgetSpent > 0 ? ' + ' + fmt(indivBudgetSpent) + ' manual' : '') +
        '</p>';
    } else if (indivBudgetSpent > 0) {
      costSub =
        '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">' +
          (personOwes > 0 ? 'Settle settled ✓ · ' : '') +
          fmt(indivBudgetSpent) + ' tracked manually' +
        '</p>';
    } else {
      costSub = personOwes > 0
        ? '<p class="text-[10px] text-[#2a8703] dark:text-green-400 font-medium mt-0.5">Settled up ✓</p>'
        : '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">No expenses recorded yet</p>';
    }
  } else if (budgetCeiling > 0 || settleNetSpent > 0 || budgetTracked > 0) {
    // Both sources are additive — budgetTracked only counts UNRECONCILED manual
    // items (reconciled ones are already inside settleNetSpent), so no double-counting.
    var displaySpent = settleNetSpent + budgetTracked;
    var overBudget   = budgetCeiling > 0 && displaySpent > budgetCeiling;
    var spentPct     = budgetCeiling > 0
      ? Math.round(displaySpent / budgetCeiling * 100)
      : null;
    var pctColor     = overBudget
      ? 'text-[#ea1100] dark:text-red-400'
      : spentPct >= 80 ? 'text-[#995213] dark:text-yellow-400'
      : 'text-[#2a8703] dark:text-green-400';
    costVal   = cur + '\u00a0' + Math.round(displaySpent).toLocaleString('en-US');
    costLabel = settleNetSpent > 0 ? 'Net Spent (' + cur + ')' : 'Budget Tracked (' + cur + ')';
    // Sub-note: ceiling progress + source breakdown when both contribute
    var subParts = [];
    if (budgetCeiling > 0) {
      subParts.push(
        'of ' + cur + '\u00a0' + Math.round(budgetCeiling).toLocaleString('en-US') + ' ceiling' +
        (spentPct !== null
          ? ' <span class="font-medium ' + pctColor + '">(' + spentPct + '%)</span>'
          : '')
      );
    }
    if (settleNetSpent > 0 && budgetTracked > 0) {
      subParts.push(
        cur + '\u00a0' + Math.round(settleNetSpent).toLocaleString('en-US') + ' settle' +
        ' + ' + cur + '\u00a0' + Math.round(budgetTracked).toLocaleString('en-US') + ' manual'
      );
    }
    costSub = subParts.length
      ? '<p class="text-[10px] mt-0.5 text-gray-400 dark:text-zinc-500">' + subParts.join(' \u00b7 ') + '</p>'
      : '';
  } else if (spotTotal > 0) {
    costVal   = cur + '\u00a0' + Math.round(spotTotal).toLocaleString('en-US');
    if (data.mixed_currencies) costVal += ' *';
    costLabel = 'Spot Estimates (' + cur + ')';
    costSub   = (settleNetSpent > 0 || budgetTracked > 0)
      ? '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">' +
          'Actual logged: ' + cur + '\u00a0' +
          Math.round(settleNetSpent > 0 ? settleNetSpent : budgetTracked).toLocaleString('en-US') +
        '</p>'
      : '';
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

// ── Doughnut: Spots by Type (Planning) │ Budget by Category (Actuals) ───────
// Title and subtitle swap with the phase toggle so the card always makes sense.
function _tripRenderTypeChart(data) {
  var wrap    = document.getElementById('trip-chart-type-wrap');
  var slot    = document.getElementById('trip-canvas-type-slot');
  var titleEl = document.getElementById('trip-chart-type-title');
  var subEl   = document.getElementById('trip-chart-type-sub');
  if (!window.Chart || !slot) return;

  var isActuals = _tripChartPhase === 'actuals';
  var person    = _tripChartSelectedPerson;   // null = All, string = specific person
  var cur       = _tripChartCurrency;

  // Update title + sub regardless of data availability so they never get stuck
  if (titleEl) {
    titleEl.textContent = isActuals
      ? '💰 Budget by Category'
      : '📊 Spots by Type';
  }
  if (subEl) {
    subEl.innerHTML = isActuals
      ? 'Manual budget items grouped by category. Slice size = total spend per category.'
      : 'How your researched spots are distributed across categories. ' +
        '<span class="text-[#0053e2] dark:text-blue-400 font-medium cursor-default">Click a slice →</span>';
  }

  if (_tripTypeChart) { _tripTypeChart.destroy(); _tripTypeChart = null; }

  // Ensure canvas exists (empty-state path replaces it with a <p>)
  var canvas = document.getElementById('trip-canvas-type');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'trip-canvas-type';
    slot.innerHTML = '';
    slot.appendChild(canvas);
  }

  // Helper shared by both branches
  function _showEmpty(msg) {
    slot.innerHTML =
      '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center pt-14">' + msg + '</p>';
  }

  // ── ACTUALS: Budget by Category doughnut ──────────────────────────────────
  if (isActuals) {
    var _tc = window._tripTypeColor || function() { return '#6b7280'; };
    var catMap = {};

    if (person) {
      // ─ Person selected: use the shared entry builder so the doughnut total
      // always matches the Net Trip Cost stat card and the bar chart.
      _tripPersonEntries(data, person).forEach(function(e) {
        var cat = (e.category || '').trim() || 'Uncategorized';
        catMap[cat] = (catMap[cat] || 0) + e.cost;
      });
    } else {
      // ─ All: settle expenses + unreconciled budget items — same sources as Net Spent.
      _tripAllEntries(data).forEach(function(e) {
        var cat = (e.category || '').trim() || 'Uncategorized';
        catMap[cat] = (catMap[cat] || 0) + e.cost;
      });
    }
    var catEntries = Object.keys(catMap)
      .map(function(cat) { return { label: cat, total: catMap[cat] }; })
      .filter(function(e) { return e.total > 0; })
      .sort(function(a, b) { return b.total - a.total; });

    if (!catEntries.length) {
      _showEmpty('No budget items yet — add expenses to a Budget panel.');
      return;
    }
    var grandTotal = catEntries.reduce(function(s, e) { return s + e.total; }, 0);
    _tripTypeChart = new window.Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: catEntries.map(function(e) { return e.label; }),
        datasets: [{
          data: catEntries.map(function(e) { return Math.round(e.total); }),
          backgroundColor: catEntries.map(function(e) {
            return e.label === 'Uncategorized' ? '#ffc220cc' : _tc(e.label) + 'cc';
          }),
          borderColor: catEntries.map(function(e) {
            return e.label === 'Uncategorized' ? '#995213' : _tc(e.label);
          }),
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {position: 'bottom', labels: {font: {size: 11}, padding: 10, boxWidth: 12}},
          tooltip: {callbacks: {label: function(ctx) {
            var pct = grandTotal > 0 ? Math.round(ctx.raw / grandTotal * 100) : 0;
            return ' ' + ctx.label + ': ' + cur + ' ' + ctx.raw.toLocaleString() + ' (' + pct + '%)';
          }}},
        },
      },
    });
    // Bottom description line
    var desc = document.getElementById('trip-chart-type-desc');
    if (!desc) {
      desc = document.createElement('p');
      desc.id = 'trip-chart-type-desc';
      desc.className = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-2 text-center px-2';
      if (wrap) wrap.appendChild(desc);
    }
    desc.textContent = catEntries.map(function(e) {
      return e.label + ': ' + cur + ' ' + Math.round(e.total).toLocaleString();
    }).join(' · ');
    return;
  }

  // ── PLANNING: Spots by Type doughnut ──────────────────────────────────
  var byType = (data.by_type || []).filter(function(t) { return t.count > 0; });
  if (!byType.length) {
    _showEmpty('No spot data yet');
    return;
  }
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
        var t = byType[elements[0].index];
        if (t) _tripChartOpenSpotTypeDrawer(t.spot_type, _tripChartLastData);
      },
    },
  });
  if (canvas.style) canvas.style.cursor = 'pointer';

  var desc = document.getElementById('trip-chart-type-desc');
  if (!desc) {
    desc = document.createElement('p');
    desc.id = 'trip-chart-type-desc';
    desc.className = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-2 text-center px-2';
    if (wrap) wrap.appendChild(desc);
  }
  desc.textContent = 'Each slice = one spot type. Size reflects count, not cost. ' +
    byType.map(function(t) {
      return (t.spot_type.charAt(0).toUpperCase() + t.spot_type.slice(1)) + ': ' + t.count;
    }).join(' · ');
}

// ── Cost bar chart ────────────────────────────────────────────────────────────────
// Planning mode  : blue bars = spot estimates by type (no budget items)
// Actuals / All  : blue = spot estimates, yellow = budget items
// Actuals + person: green = expenses they paid upfront,
//                   blue  = their share of expenses they didn’t front
function _tripRenderBudgetChart(data) {
  var wrap    = document.getElementById('trip-chart-budget-wrap');
  var titleEl = document.getElementById('trip-chart-budget-title');
  var subEl   = document.getElementById('trip-chart-budget-sub');
  var slot    = document.getElementById('trip-canvas-budget-slot');  // stable wrapper
  if (!window.Chart || !slot) return;

  var isPlanning = _tripChartPhase === 'planning';
  var person     = _tripChartSelectedPerson;  // null = All, string = specific person
  var cur        = _tripChartCurrency;

  // ─ Update title FIRST (before any early return, so it never gets stuck) ─
  if (titleEl) {
    titleEl.textContent = isPlanning
      ? '💸 Estimated Cost by Spot Type'
      : person
        ? '🧑 ' + person + '’s Actual Expenses'
        : '💰 Budget Items by Category';
  }
  if (subEl) {
    subEl.innerHTML = isPlanning
      ? 'Spot estimates by category — switch to <strong>Actuals</strong> to see budget line items. ' +
        '<span class="text-[#0053e2] dark:text-blue-400 font-medium cursor-default">Click any bar →</span>'
      : person
        ? '<span style="opacity:1">■</span> Bright = paid upfront &nbsp;·&nbsp; ' +
          '<span style="opacity:0.5">■</span> Dim = shared expense. ' +
          'Bars coloured by category. Hover for details.'
        : 'Manual budget items grouped by category. Bars coloured by category type. ' +
          'Select a <strong>person above</strong> to see their individual spend.';
  }

  // ─ Destroy previous chart instance ─────────────────────────────────────
  if (_tripBudgetChart) { _tripBudgetChart.destroy(); _tripBudgetChart = null; }

  // ─ Ensure canvas exists in the slot (it gets wiped by the empty-state path) ─
  var canvas = document.getElementById('trip-canvas-budget');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'trip-canvas-budget';
    slot.innerHTML = '';
    slot.appendChild(canvas);
  }

  // Helper: show empty state without destroying the slot permanently
  function _showEmpty(msg) {
    slot.innerHTML =
      '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center pt-14">' + msg + '</p>';
  }
  // ── ACTUALS + person selected ───────────────────────────────────────────
  if (!isPlanning && person) {
    // Shared helper ensures bar chart and doughnut always use identical totals.
    var personEntries = _tripPersonEntries(data, person);
    personEntries.sort(function(a, b) { return b.cost - a.cost; });

    if (!personEntries.length) {
      _showEmpty('No expenses found for ' + _tripEsc(person) +
        ' — add expenses to a Settle Up panel or a Budget panel.');
      return;
    }

    var pTotal = personEntries.reduce(function(s, e) { return s + e.cost; }, 0);

    // ── Aggregate flat entries into categories ──────────────────────────────
    var _tc = window._tripTypeColor || function() { return '#6b7280'; };
    var catAgg = {};  // category -> { total, paidTotal, sharedTotal, items[] }
    personEntries.forEach(function(e) {
      var cat = (e.category || '').trim() || 'Uncategorized';
      if (!catAgg[cat]) catAgg[cat] = { total: 0, paidTotal: 0, sharedTotal: 0, items: [] };
      catAgg[cat].total       += e.cost;
      catAgg[cat].paidTotal   += e.didPay ? e.cost : 0;
      catAgg[cat].sharedTotal += e.didPay ? 0 : e.cost;
      catAgg[cat].items.push(e);
    });
    var catEntries = Object.keys(catAgg)
      .map(function(cat) { return { cat: cat, d: catAgg[cat] }; })
      .sort(function(a, b) { return b.d.total - a.d.total; });

    _tripBudgetChart = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels:   catEntries.map(function(e) { return e.cat; }),
        datasets: [{
          label: cur + ' share',
          data:  catEntries.map(function(e) { return e.d.total; }),
          backgroundColor: catEntries.map(function(e) {
            var hex = e.cat === 'Uncategorized' ? '#6b7280' : _tc(e.cat);
            return hex + 'cc';
          }),
          borderColor: catEntries.map(function(e) {
            return e.cat === 'Uncategorized' ? '#6b7280' : _tc(e.cat);
          }),
          borderWidth: 1.5, borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {display: false},
          tooltip: {callbacks: {
            label: function(ctx) {
              var e    = catEntries[ctx.dataIndex];
              var pct  = pTotal > 0 ? Math.round(ctx.raw / pTotal * 100) : 0;
              var lines = [' ' + cur + ' ' + ctx.raw.toLocaleString() + ' (' + pct + '%)'];
              if (e.d.paidTotal > 0 && e.d.sharedTotal > 0) {
                lines.push(' 🟢 Paid upfront: ' + cur + ' ' + e.d.paidTotal.toLocaleString());
                lines.push(' 🔵 Shared cost:  ' + cur + ' ' + e.d.sharedTotal.toLocaleString());
              } else if (e.d.paidTotal > 0) {
                lines.push(' 🟢 Paid upfront by ' + person);
              } else {
                lines.push(' 🔵 Shared cost');
              }
              // List up to 5 contributing items
              var shown = e.d.items.slice(0, 5);
              shown.forEach(function(it) {
                lines.push('   • ' + _tripEsc(it.label) + ' – ' + cur + ' ' + it.cost.toLocaleString());
              });
              if (e.d.items.length > 5) {
                lines.push('   … +' + (e.d.items.length - 5) + ' more');
              }
              return lines;
            },
          }},
        },
        scales: {
          y: {beginAtZero: true, grid: {color: 'rgba(148,163,184,0.15)'},
              ticks: {font: {size: 11},
                      callback: function(v) { return cur + ' ' + v.toLocaleString(); }}},
          x: {grid: {display: false}, ticks: {font: {size: 11}, maxRotation: 30}},
        },
      },
    });
    _tripUpdateBudgetLegend(wrap, false, false);
    return;
  }

  // ── Planning OR Actuals / All ───────────────────────────────────────────────────

  // ── PLANNING: spot estimates by type, clickable ───────────────────────────
  if (isPlanning) {
    var typeMap = {};
    (data.raw_by_type || []).forEach(function(r) {
      if (!typeMap[r.spot_type]) typeMap[r.spot_type] = 0;
      typeMap[r.spot_type] += _tripConvert(r.total_cost, r.currency);
    });
    var allEntries = Object.keys(typeMap)
      .map(function(k) { return {
        label: k.charAt(0).toUpperCase() + k.slice(1), rawType: k,
        cost:  Math.round(typeMap[k]), source: 'spot',
      }; })
      .filter(function(e) { return e.cost > 0; })
      .sort(function(a, b) { return b.cost - a.cost; });

    if (!allEntries.length) {
      _showEmpty('No cost data yet — add estimated costs to spots.');
      return;
    }
    var total   = allEntries.reduce(function(s, e) { return s + e.cost; }, 0);
    var BG_SPOT = '#0053e2cc'; var BD_SPOT = '#0053e2';
    _tripBudgetChart = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels:   allEntries.map(function(e) { return e.label; }),
        datasets: [{
          label: 'Cost (' + cur + ')',
          data:  allEntries.map(function(e) { return e.cost; }),
          backgroundColor: BG_SPOT, borderColor: BD_SPOT,
          borderWidth: 1.5, borderRadius: 4,
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
              return [' ' + cur + ' ' + ctx.raw.toLocaleString() + ' (' + pct + '%)', ' Spot estimate'];
            },
          }},
        },
        scales: {
          y: {beginAtZero: true, grid: {color: 'rgba(148,163,184,0.15)'},
              ticks: {font: {size: 11}, callback: function(v) { return cur + ' ' + v.toLocaleString(); }}},
          x: {grid: {display: false}, ticks: {font: {size: 10}, maxRotation: 35}},
        },
        onClick: function(evt, elements) {
          if (!elements.length) return;
          var e = allEntries[elements[0].index];
          _tripChartOpenSpotTypeDrawer(e.rawType, _tripChartLastData);
        },
      },
    });
    if (canvas.style) canvas.style.cursor = 'pointer';
    _tripUpdateBudgetLegend(wrap, true, false);
    return;
  }

  // ─ ACTUALS / ALL: settle expenses + unreconciled budget items by category ────────
  // Uses _tripAllEntries so the chart total always equals Net Spent
  // (settleNetSpent + budgetTracked).
  var _tc = window._tripTypeColor || function() { return '#ffc220'; };
  var catAggAll = {};  // catName → { total, settleTotal, budgetTotal, items[] }
  _tripAllEntries(data).forEach(function(e) {
    var cat = (e.category || '').trim() || 'Uncategorized';
    if (!catAggAll[cat]) catAggAll[cat] = { total: 0, settleTotal: 0, budgetTotal: 0, items: [] };
    catAggAll[cat].total += e.cost;
    if (e.source === 'settle') catAggAll[cat].settleTotal += e.cost;
    else                       catAggAll[cat].budgetTotal  += e.cost;
    catAggAll[cat].items.push(e.label);
  });

  var catEntries = Object.keys(catAggAll)
    .map(function(cat) { return { label: cat, d: catAggAll[cat] }; })
    .filter(function(e) { return e.d.total > 0; })
    .sort(function(a, b) { return b.d.total - a.d.total; });

  if (!catEntries.length) {
    _showEmpty('No expenses yet — add expenses to a Settle Up or Budget panel.');
    return;
  }

  var catTotal = catEntries.reduce(function(s, e) { return s + e.d.total; }, 0);

  _tripBudgetChart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels:   catEntries.map(function(e) { return e.label; }),
      datasets: [{
        label: 'Cost (' + cur + ')',
        data:  catEntries.map(function(e) { return e.d.total; }),
        backgroundColor: catEntries.map(function(e) {
          return (e.label === 'Uncategorized' ? '#ffc220' : _tc(e.label)) + 'cc';
        }),
        borderColor: catEntries.map(function(e) {
          return e.label === 'Uncategorized' ? '#995213' : _tc(e.label);
        }),
        borderWidth: 1.5, borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {display: false},
        tooltip: {callbacks: {
          label: function(ctx) {
            var e   = catEntries[ctx.dataIndex];
            var pct = catTotal > 0 ? Math.round(ctx.raw / catTotal * 100) : 0;
            var lines = [' ' + cur + ' ' + ctx.raw.toLocaleString() + ' (' + pct + '%)'];
            if (e.d.settleTotal > 0 && e.d.budgetTotal > 0) {
              lines.push(' \uD83D\uDFE2 Settle: ' + cur + ' ' + e.d.settleTotal.toLocaleString());
              lines.push(' \uD83D\uDD35 Budget: ' + cur + ' ' + e.d.budgetTotal.toLocaleString());
            } else if (e.d.settleTotal > 0) {
              lines.push(' From Settle Up panels');
            } else {
              lines.push(' From Budget panels (unreconciled)');
            }
            var shown = e.d.items.slice(0, 4);
            shown.forEach(function(it) { lines.push('   \u2022 ' + it); });
            if (e.d.items.length > 4) lines.push('   \u2026 +' + (e.d.items.length - 4) + ' more');
            return lines;
          },
        }},
      },
      scales: {
        y: {beginAtZero: true, grid: {color: 'rgba(148,163,184,0.15)'},
            ticks: {font: {size: 11}, callback: function(v) { return cur + ' ' + v.toLocaleString(); }}},
        x: {grid: {display: false}, ticks: {font: {size: 11}, maxRotation: 30}},
      },
    },
  });
  _tripUpdateBudgetLegend(wrap, false, false);  // category colours are self-labelled
  _tripUpdateBudgetLegend(wrap, false, false);  // category colours are self-labelled
}

// Helper: update the manual color legend below the chart
function _tripUpdateBudgetLegend(wrap, hasSpots, hasBudget) {
  if (!wrap) return;
  var leg = document.getElementById('trip-chart-budget-legend');
  if (!leg) {
    leg = document.createElement('div');
    leg.id = 'trip-chart-budget-legend';
    leg.className = 'flex flex-wrap gap-3 mt-2 px-1';
    wrap.appendChild(leg);
  }
  var items = [];
  if (hasSpots)  items.push('<span class="flex items-center gap-1 text-[11px] text-gray-500 dark:text-zinc-400">' +
    '<span class="inline-block w-3 h-3 rounded-sm flex-shrink-0" style="background:#0053e2"></span>Spot estimates</span>');
  if (hasBudget) items.push('<span class="flex items-center gap-1 text-[11px] text-gray-500 dark:text-zinc-400">' +
    '<span class="inline-block w-3 h-3 rounded-sm flex-shrink-0" style="background:#ffc220"></span>Budget plan items</span>');
  leg.innerHTML = items.join('');
}
