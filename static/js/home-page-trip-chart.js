/**
 * home-page-trip-chart.js — Chart tab: lazy Chart.js + stats render.
 * Depends on _tripPid, _tripFetch, _tripShowToast, _tripChartColors (home-page-trip.js).
 * All state uses var.
 */

// ── Module state ──────────────────────────────────────────────────────────────
var _tripChartLibLoaded  = false;
var _tripChartLibPromise = null;
var _tripTypeChart       = null;
var _tripBudgetChart     = null;

// ── Entry ─────────────────────────────────────────────────────────────────────
window.tripLoadChart = function() {
  _tripEnsureChartLib().then(function() {
    _tripFetchStats();
  }).catch(function() {
    _tripShowToast('Failed to load chart library', true);
  });
};

// ── Lazy-load Chart.js from local vendor (same pattern as subscriptions) ──────
function _tripEnsureChartLib() {
  if (_tripChartLibLoaded && window.Chart) {
    return Promise.resolve();
  }
  if (_tripChartLibPromise) return _tripChartLibPromise;
  _tripChartLibPromise = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = '/static/js/vendor/chart.umd.min.js';
    s.onload = function() { _tripChartLibLoaded = true; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return _tripChartLibPromise;
}

// ── Fetch stats + render ──────────────────────────────────────────────────────
function _tripFetchStats() {
  _tripFetch('/home/trip/' + _tripPid + '/stats')
    .then(function(r) { return r.json(); })
    .then(function(data) { _tripRenderStats(data); })
    .catch(function() { _tripShowToast('Failed to load stats', true); });
}

function _tripRenderStats(data) {
  _tripRenderStatCards(data);
  _tripRenderTypeChart(data);
  _tripRenderBudgetChart(data);
}

function _tripRenderStatCards(data) {
  var el = document.getElementById('trip-stats-cards');
  if (!el) return;
  var budget = data.grand_total !== null && data.grand_total !== undefined
    ? data.grand_currency + ' ' + Number(data.grand_total).toFixed(2)
    : (data.currency_note ? '⚠️ Mixed currencies' : '—');
  var cards = [
    {icon: '📍', label: 'Spots Researched', value: data.total_spots || 0},
    {icon: '🗓️', label: 'Days Planned',     value: data.total_days  || 0},
    {icon: '✅', label: 'Spots in Plan',    value: data.spots_in_plan || 0},
    {icon: '💰', label: 'Est. Budget',      value: budget},
  ];
  el.innerHTML = cards.map(function(c) {
    return '<div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 ' +
      'dark:border-zinc-800 p-4 flex items-center gap-3">' +
      '<span class="text-2xl">' + c.icon + '</span>' +
      '<div>' +
        '<p class="text-xs text-gray-500 dark:text-zinc-400">' + c.label + '</p>' +
        '<p class="text-lg font-bold text-gray-800 dark:text-zinc-100">' + c.value + '</p>' +
      '</div>' +
    '</div>';
  }).join('');
}

function _tripRenderTypeChart(data) {
  var canvas = document.getElementById('trip-canvas-type');
  if (!canvas || !window.Chart) return;
  if (_tripTypeChart) { _tripTypeChart.destroy(); _tripTypeChart = null; }
  var byType = data.by_type || [];
  if (!byType.length) {
    canvas.parentNode.innerHTML =
      '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center pt-10">No data yet</p>';
    return;
  }
  var colors = window._tripChartColors || ['#0053e2','#ffc220','#2a8703','#ea1100'];
  _tripTypeChart = new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: byType.map(function(t) { return t.spot_type; }),
      datasets: [{
        data: byType.map(function(t) { return t.count; }),
        backgroundColor: byType.map(function(_, i) { return colors[i % colors.length]; }),
        borderWidth: 2,
        borderColor: '#ffffff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: {size: 11}, padding: 10, boxWidth: 12 },
        },
      },
    },
  });
}

function _tripRenderBudgetChart(data) {
  var canvas = document.getElementById('trip-canvas-budget');
  if (!canvas || !window.Chart) return;
  if (_tripBudgetChart) { _tripBudgetChart.destroy(); _tripBudgetChart = null; }
  var byType = (data.by_type || []).filter(function(t) { return t.total_cost > 0; });
  if (!byType.length) {
    canvas.parentNode.innerHTML =
      '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center pt-10">' +
      'No cost estimates yet</p>';
    return;
  }
  var colors = window._tripChartColors || ['#0053e2','#ffc220','#2a8703','#ea1100'];
  _tripBudgetChart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: byType.map(function(t) { return t.spot_type; }),
      datasets: [{
        label: 'Est. Cost',
        data: byType.map(function(t) { return t.total_cost; }),
        backgroundColor: byType.map(function(_, i) { return colors[i % colors.length] + 'cc'; }),
        borderColor:     byType.map(function(_, i) { return colors[i % colors.length]; }),
        borderWidth: 1.5,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {display: false},
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return ' ' + Number(ctx.raw).toFixed(2);
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {color: 'rgba(148,163,184,0.15)'},
          ticks: {font: {size: 11}},
        },
        x: {
          grid: {display: false},
          ticks: {font: {size: 11}},
        },
      },
    },
  });
}
