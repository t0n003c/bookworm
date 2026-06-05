/**
 * home-page-ai-dashboard.js — AI Dashboard homespace page engine.
 * Entry: initAiDashboardPage(pid) called by _initSwappedPage() in home-widgets.js.
 * All var — safe for repeated _initSwappedPage calls (HTMX re-injection rule).
 */
'use strict';

// ── Module state ──────────────────────────────────────────────────────────────
var _aiPid          = null;
var _aiTab          = 'overview';
var _aiCharts       = {};          // keyed by canvas id
var _aiHistPage     = 1;
var _aiHistBusy     = false;
var _aiHistTimer    = null;
var _aiOverviewDays = 30;

// ── Chart.js lazy loader ──────────────────────────────────────────────────────
var _aiChartJsReady    = false;
var _aiChartJsPromise  = null;

function _aiLoadChartJs() {
  if (_aiChartJsReady) return Promise.resolve();
  if (_aiChartJsPromise) return _aiChartJsPromise;
  _aiChartJsPromise = new Promise(function(resolve, reject) {
    if (window.Chart) { _aiChartJsReady = true; resolve(); return; }
    var s = document.createElement('script');
    s.src = '/static/js/vendor/chart.umd.min.js';
    s.onload  = function() { _aiChartJsReady = true; resolve(); };
    // Pass a proper Error so unhandledrejection shows something useful
    s.onerror = function(e) { reject(new Error('Chart.js failed to load: ' + s.src)); };
    document.head.appendChild(s);
  });
  return _aiChartJsPromise;
}

// ── Entry point ───────────────────────────────────────────────────────────────
function initAiDashboardPage(pid) {
  _aiPid    = pid;
  _aiTab    = 'overview';
  _aiCharts = {};
  _aiHistPage = 1;

  // Restore tab from localStorage
  var saved = localStorage.getItem('bw_ai_tab');
  if (saved === 'history') {
    _aiApplyTab('history');
  } else {
    _aiApplyTab('overview');
    aiLoadOverview();
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function aiSwitchTab(tab) {
  _aiTab = tab;
  _aiApplyTab(tab);
  localStorage.setItem('bw_ai_tab', tab);
  if (tab === 'overview') {
    aiLoadOverview();
  } else {
    aiLoadHistory(1);
  }
}

function _aiApplyTab(tab) {
  var panels = ['overview', 'history'];
  panels.forEach(function(t) {
    var panel = document.getElementById('ai-panel-' + t);
    var btn   = document.getElementById('ai-tab-' + t);
    if (!panel || !btn) return;
    var active = t === tab;
    panel.classList.toggle('hidden', !active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) {
      btn.classList.add('border-wblue', 'text-wblue', 'dark:text-blue-400', 'dark:border-blue-400');
      btn.classList.remove('border-transparent', 'text-gray-500', 'dark:text-zinc-400',
                           'hover:text-gray-700', 'dark:hover:text-zinc-200');
    } else {
      btn.classList.remove('border-wblue', 'text-wblue', 'dark:text-blue-400', 'dark:border-blue-400');
      btn.classList.add('border-transparent', 'text-gray-500', 'dark:text-zinc-400',
                        'hover:text-gray-700', 'dark:hover:text-zinc-200');
    }
  });
}

// ── Overview ──────────────────────────────────────────────────────────────────
function aiLoadOverview() {
  var sel = document.getElementById('ai-days-select');
  _aiOverviewDays = sel ? parseInt(sel.value, 10) : 30;

  _aiSetCardsLoading();
  fetch('/home/ai-dashboard/' + _aiPid + '/overview?days=' + _aiOverviewDays)
    .then(function(r) { return r.json(); })
    .then(function(data) { _aiRenderOverview(data); })
    .catch(function(e) {
      console.error('[ai-dash] overview fetch failed:', e);
      _aiSetCardsError();
    });
}

function _aiSetCardsLoading() {
  var el = document.getElementById('ai-summary-cards');
  if (el) el.innerHTML =
    '<div class="col-span-full text-center py-8 text-gray-400 dark:text-zinc-600 text-sm animate-pulse">Loading…</div>';
}

function _aiSetCardsError() {
  var el = document.getElementById('ai-summary-cards');
  if (el) el.innerHTML =
    '<div class="col-span-full text-center py-8 text-red-500 text-sm">Failed to load data. Check console.</div>';
}

function _aiRenderOverview(data) {
  var s = data.summary || {};
  var daily  = data.daily  || [];
  var models = data.models || [];

  // ── Empty state ──────────────────────────────────────────────────────────
  var emptyEl = document.getElementById('ai-overview-empty');
  if (emptyEl) emptyEl.classList.toggle('hidden', s.total_queries > 0);

  // ── Summary cards ────────────────────────────────────────────────────────
  var cards = [
    { icon:'🔍', label:'Queries',      value: _aiFmt(s.total_queries || 0) },
    { icon:'⬆️',  label:'Input Tokens', value: _aiFmtNum(s.total_input  || 0) },
    { icon:'⬇️',  label:'Output Tokens',value: _aiFmtNum(s.total_output || 0) },
    { icon:'🪙',  label:'Total Tokens', value: _aiFmtNum(s.total_tokens || 0) },
    { icon:'💵',  label:'Est. Cost',    value: '$' + ((s.total_cost || 0).toFixed(4)) },
  ];
  var cardsEl = document.getElementById('ai-summary-cards');
  if (cardsEl) {
    cardsEl.innerHTML = cards.map(function(c) {
      return '<div class="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800' +
             ' p-4 shadow-sm flex flex-col items-center gap-1 text-center">' +
             '<span class="text-2xl leading-none">' + c.icon + '</span>' +
             '<span class="text-lg font-bold text-gray-900 dark:text-zinc-100 leading-tight">' + _aiEsc(c.value) + '</span>' +
             '<span class="text-xs text-gray-400 dark:text-zinc-500">' + _aiEsc(c.label) + '</span>' +
             '</div>';
    }).join('');
  }

  // ── Charts ────────────────────────────────────────────────────────────────────────────────
  _aiLoadChartJs().then(function() {
    _aiRenderQueryChart(daily);
    _aiRenderTokenChart(daily);
    _aiRenderCostChart(daily);
    _aiRenderModelChart(models);
  }).catch(function(err) {
    console.error('[ai-dash] Chart.js failed to load:', err);
    // Show a non-blocking warning under the cards instead of crashing
    var warn = document.createElement('p');
    warn.className = 'text-xs text-amber-600 dark:text-amber-400 text-center mt-2';
    warn.textContent = '⚠️ Charts unavailable — Chart.js could not load.';
    var cards = document.getElementById('ai-summary-cards');
    if (cards && cards.parentNode) cards.parentNode.insertBefore(warn, cards.nextSibling);
  });
}

// ── Chart helpers ─────────────────────────────────────────────────────────────
var _AI_BLUE   = '#0053e2';
var _AI_GREEN  = '#2a8703';
var _AI_AMBER  = '#f59e0b';
var _AI_SPARK  = '#ffc220';
var _AI_COLORS = [
  '#0053e2','#ffc220','#2a8703','#ea1100','#8b5cf6',
  '#06b6d4','#f97316','#ec4899','#10b981','#64748b',
];

function _aiDestroyChart(id) {
  if (_aiCharts[id]) { try { _aiCharts[id].destroy(); } catch(e) {} delete _aiCharts[id]; }
}

function _aiIsDark() {
  return document.documentElement.classList.contains('dark');
}
function _aiGridColor() { return _aiIsDark() ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'; }
function _aiTextColor() { return _aiIsDark() ? '#a1a1aa' : '#6b7280'; }

function _aiBaseScales() {
  return {
    x: { grid: { color: _aiGridColor() }, ticks: { color: _aiTextColor(), maxRotation: 45, maxTicksLimit: 10, font: { size: 10 } } },
    y: { grid: { color: _aiGridColor() }, ticks: { color: _aiTextColor(), font: { size: 10 } }, beginAtZero: true },
  };
}

function _aiRenderQueryChart(daily) {
  var id = 'ai-chart-queries';
  _aiDestroyChart(id);
  var canvas = document.getElementById(id);
  if (!canvas) return;
  _aiCharts[id] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels:   daily.map(function(d) { return d.day; }),
      datasets: [{ label: 'Queries', data: daily.map(function(d) { return d.queries; }),
        backgroundColor: _AI_BLUE + 'cc', borderRadius: 4, borderSkipped: false }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: function(i) { return i[0].label; },
        label: function(i) { return i.raw + ' quer' + (i.raw === 1 ? 'y' : 'ies'); },
      }}},
      scales: _aiBaseScales(),
    },
  });
}

function _aiRenderTokenChart(daily) {
  var id = 'ai-chart-tokens';
  _aiDestroyChart(id);
  var canvas = document.getElementById(id);
  if (!canvas) return;
  _aiCharts[id] = new Chart(canvas, {
    type: 'line',
    data: {
      labels:   daily.map(function(d) { return d.day; }),
      datasets: [
        { label: 'Input',  data: daily.map(function(d) { return d.input_tokens; }),
          borderColor: _AI_BLUE,  backgroundColor: _AI_BLUE  + '22',
          fill: true, tension: 0.3, pointRadius: 3 },
        { label: 'Output', data: daily.map(function(d) { return d.output_tokens; }),
          borderColor: _AI_GREEN, backgroundColor: _AI_GREEN + '22',
          fill: true, tension: 0.3, pointRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: _aiTextColor(), font: { size: 11 } } } },
      scales: _aiBaseScales(),
    },
  });
}

function _aiRenderCostChart(daily) {
  var id = 'ai-chart-cost';
  _aiDestroyChart(id);
  var canvas = document.getElementById(id);
  if (!canvas) return;
  _aiCharts[id] = new Chart(canvas, {
    type: 'line',
    data: {
      labels:   daily.map(function(d) { return d.day; }),
      datasets: [{ label: 'Cost (USD)', data: daily.map(function(d) { return +(d.cost_usd || 0).toFixed(6); }),
        borderColor: _AI_AMBER, backgroundColor: _AI_AMBER + '22',
        fill: true, tension: 0.3, pointRadius: 3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(i) { return '$' + i.raw.toFixed(6); } } },
      },
      scales: Object.assign({}, _aiBaseScales(), {
        y: Object.assign({}, _aiBaseScales().y, {
          ticks: Object.assign({}, _aiBaseScales().y.ticks, {
            callback: function(v) { return '$' + v.toFixed(4); },
          }),
        }),
      }),
    },
  });
}

function _aiRenderModelChart(models) {
  var id = 'ai-chart-models';
  _aiDestroyChart(id);
  var canvas = document.getElementById(id);
  if (!canvas) return;

  if (!models.length) {
    var ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = _aiTextColor();
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data', canvas.width / 2, canvas.height / 2);
    }
    var leg = document.getElementById('ai-model-legend');
    if (leg) leg.innerHTML = '';
    return;
  }

  var labels = models.map(function(m) { return m.model || 'unknown'; });
  var counts = models.map(function(m) { return m.count; });
  var colors = labels.map(function(_, i) { return _AI_COLORS[i % _AI_COLORS.length]; });

  _aiCharts[id] = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 2,
            borderColor: _aiIsDark() ? '#18181b' : '#fff' }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: { legend: { display: false },
                 tooltip: { callbacks: { label: function(i) {
                   var total = i.dataset.data.reduce(function(a,b){return a+b;},0);
                   var pct = total ? ((i.raw/total)*100).toFixed(1) : 0;
                   return i.label + ': ' + i.raw + ' (' + pct + '%)';
                 }}}},
    },
  });

  // Custom legend pills below the donut
  var leg = document.getElementById('ai-model-legend');
  if (leg) {
    leg.innerHTML = labels.map(function(lbl, i) {
      return '<span class="flex items-center gap-1 text-xs text-gray-600 dark:text-zinc-400">' +
             '<span class="inline-block w-3 h-3 rounded-full flex-shrink-0" style="background:' + colors[i] + '"></span>' +
             _aiEsc(lbl.length > 20 ? lbl.slice(0,18) + '…' : lbl) +
             '</span>';
    }).join('');
  }
}

// ── History ───────────────────────────────────────────────────────────────────
function aiHistDebounceSearch() {
  if (_aiHistTimer) clearTimeout(_aiHistTimer);
  _aiHistTimer = setTimeout(function() { aiLoadHistory(1); }, 350);
}

function aiLoadHistory(page) {
  if (_aiHistBusy) return;
  _aiHistBusy = true;
  _aiHistPage = page || 1;

  var q   = (document.getElementById('ai-hist-search') || {}).value || '';
  var url = '/home/ai-dashboard/' + _aiPid + '/history?page=' + _aiHistPage + '&q=' + encodeURIComponent(q);

  var thread = document.getElementById('ai-history-thread');
  if (thread) thread.innerHTML =
    '<div class="text-center py-8 text-gray-400 dark:text-zinc-600 text-sm animate-pulse">Loading…</div>';

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _aiRenderHistory(data);
      _aiHistBusy = false;
    })
    .catch(function(e) {
      console.error('[ai-dash] history fetch failed:', e);
      _aiHistBusy = false;
      if (thread) thread.innerHTML =
        '<p class="text-center text-red-500 text-sm py-8">Failed to load history.</p>';
    });
}

function _aiRenderHistory(data) {
  var items      = data.items      || [];
  var total      = data.total      || 0;
  var page       = data.page       || 1;
  var totalPages = data.total_pages|| 1;

  var thread = document.getElementById('ai-history-thread');
  if (!thread) return;

  if (!items.length) {
    thread.innerHTML =
      '<div class="text-center py-16">' +
      '<p class="text-4xl mb-3">💬</p>' +
      '<p class="text-gray-500 dark:text-zinc-400 font-semibold">No conversations yet</p>' +
      '<p class="text-xs text-gray-400 dark:text-zinc-600 mt-1">Use Ctrl+K to ask the AI a question.</p>' +
      '</div>';
    _aiRenderPagination(page, totalPages);
    return;
  }

  thread.innerHTML = items.map(function(item) {
    return _aiRenderBubblePair(item);
  }).join('');

  _aiRenderPagination(page, totalPages);
}

function _aiRenderBubblePair(item) {
  var ts    = _aiFormatTs(item.queried_at || '');
  var model = item.model ? ('<span class="text-[10px] text-gray-400 dark:text-zinc-600">' + _aiEsc(item.model) + '</span>') : '';
  var meta  = '';
  if (item.input_tokens || item.output_tokens) {
    meta = '<span class="text-[10px] text-gray-400 dark:text-zinc-600">' +
           _aiFmtNum((item.input_tokens||0) + (item.output_tokens||0)) + ' tok' +
           (item.cost_usd ? ' · $' + (+item.cost_usd).toFixed(5) : '') +
           '</span>';
  }

  var question = _aiEsc(item.query_text || '');
  var answer   = item.answer_text || '';

  // Convert markdown-ish newlines in answer to <br> for readability
  var answerHtml = _aiEsc(answer).replace(/\n/g, '<br>');

  return '<div class="space-y-2">' +
    // Timestamp divider
    '<div class="flex items-center gap-2 my-1">' +
    '<hr class="flex-1 border-gray-200 dark:border-zinc-800">' +
    '<span class="text-[10px] text-gray-400 dark:text-zinc-600 whitespace-nowrap">' + _aiEsc(ts) + '</span>' +
    '<hr class="flex-1 border-gray-200 dark:border-zinc-800">' +
    '</div>' +
    // User bubble (right-aligned, blue)
    '<div class="flex justify-end">' +
    '<div class="max-w-[80%] flex flex-col items-end gap-1">' +
    '<div class="bg-wblue text-white text-sm rounded-2xl rounded-br-sm px-4 py-2.5 shadow-sm leading-relaxed">' +
    question +
    '</div>' +
    '<span class="text-[10px] text-gray-400 dark:text-zinc-600">You</span>' +
    '</div>' +
    '</div>' +
    // AI bubble (left-aligned, gray)
    (answer ?
      '<div class="flex justify-start">' +
      '<div class="max-w-[80%] flex flex-col items-start gap-1">' +
      '<div class="flex items-start gap-2">' +
      '<span class="mt-1 text-base leading-none flex-shrink-0" title="BookWorm AI">🤖</span>' +
      '<div class="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 ' +
           'text-gray-800 dark:text-zinc-200 text-sm rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm leading-relaxed">' +
      answerHtml +
      '</div>' +
      '</div>' +
      '<div class="flex items-center gap-2 ml-8">' + model + meta + '</div>' +
      '</div>' +
      '</div>'
    : '') +
    '</div>';
}

function _aiRenderPagination(page, totalPages) {
  var el = document.getElementById('ai-hist-pagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  var html = '';
  html += '<button onclick="aiLoadHistory(' + (page - 1) + ')" ' +
          (page <= 1 ? 'disabled ' : '') +
          'class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-700 ' +
          'bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 ' +
          'hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition">← Prev</button>';

  html += '<span class="text-xs text-gray-500 dark:text-zinc-400">Page ' + page + ' of ' + totalPages + '</span>';

  html += '<button onclick="aiLoadHistory(' + (page + 1) + ')" ' +
          (page >= totalPages ? 'disabled ' : '') +
          'class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-700 ' +
          'bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 ' +
          'hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition">Next →</button>';

  el.innerHTML = html;
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function _aiEsc(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function _aiFmt(n) { return String(n); }

function _aiFmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function _aiFormatTs(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
    return d.toLocaleString(undefined, { month:'short', day:'numeric',
           year:'numeric', hour:'numeric', minute:'2-digit' });
  } catch(e) { return iso; }
}
