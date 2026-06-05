/**
 * home-page-ai-dashboard.js — AI Dashboard engine.
 * Entry: initAiDashboardPage(pid)  called by _initSwappedPage() + inline boot.
 * All var — HTMX-safe on repeated swaps.
 */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
var _aiPid         = null;
var _aiTab         = 'overview';
var _aiCharts      = {};
var _aiHistPage    = 1;
var _aiHistBusy    = false;
var _aiHistTimer   = null;
var _aiDays        = 30;

// ── Chart.js lazy loader ──────────────────────────────────────────────────────
var _aiCjReady   = false;
var _aiCjPromise = null;
function _aiLoadCj() {
  if (_aiCjReady)   return Promise.resolve();
  if (_aiCjPromise) return _aiCjPromise;
  _aiCjPromise = new Promise(function(res, rej) {
    if (window.Chart) { _aiCjReady = true; res(); return; }
    var s = document.createElement('script');
    s.src = '/static/js/vendor/chart.umd.min.js';
    s.onload  = function() { _aiCjReady = true; res(); };
    s.onerror = function() { rej(new Error('Chart.js failed to load')); };
    document.head.appendChild(s);
  });
  return _aiCjPromise;
}

// ── Entry ─────────────────────────────────────────────────────────────────────
function initAiDashboardPage(pid) {
  _aiPid      = pid;
  _aiCharts   = {};
  _aiHistPage = 1;
  var saved = localStorage.getItem('bw_ai_tab') || 'overview';
  _aiApplyTab(saved);
  if (saved === 'history') { aiLoadHistory(1); } else { aiLoadOverview(); }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function aiSwitchTab(tab) {
  _aiTab = tab;
  _aiApplyTab(tab);
  localStorage.setItem('bw_ai_tab', tab);
  if (tab === 'history') { aiLoadHistory(1); } else { aiLoadOverview(); }
}

function _aiApplyTab(tab) {
  _aiTab = tab;
  ['overview','history'].forEach(function(t) {
    var panel = document.getElementById('ai-panel-' + t);
    var btn   = document.getElementById('ai-tab-' + t);
    if (!panel || !btn) return;
    var on = t === tab;
    panel.classList.toggle('hidden', !on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) {
      btn.classList.add('ai-tab-active');
      btn.classList.remove('text-gray-500','dark:text-zinc-400',
                           'hover:bg-gray-100','dark:hover:bg-zinc-800');
    } else {
      btn.classList.remove('ai-tab-active');
      btn.classList.add('text-gray-500','dark:text-zinc-400',
                        'hover:bg-gray-100','dark:hover:bg-zinc-800');
    }
  });
}

// ── Overview ──────────────────────────────────────────────────────────────────
function aiLoadOverview() {
  var sel = document.getElementById('ai-days-select');
  _aiDays = sel ? parseInt(sel.value, 10) : 30;
  _aiSetCardsSkeleton();
  fetch('/home/ai-dashboard/' + _aiPid + '/overview?days=' + _aiDays)
    .then(function(r) { return r.json(); })
    .then(_aiRenderOverview)
    .catch(function(e) {
      console.error('[ai-dash] overview:', e);
      _aiSetCardsErr();
    });
}

function _aiSetCardsSkeleton() {
  var el = document.getElementById('ai-summary-cards');
  if (!el) return;
  el.innerHTML = '<div class="col-span-full flex gap-3">'
    + '<div class="ai-skel flex-1 h-24 rounded-2xl"></div>'
    + '<div class="ai-skel flex-1 h-24 rounded-2xl"></div>'
    + '<div class="ai-skel flex-1 h-24 rounded-2xl hidden sm:block"></div>'
    + '<div class="ai-skel flex-1 h-24 rounded-2xl hidden lg:block"></div>'
    + '<div class="ai-skel flex-1 h-24 rounded-2xl hidden lg:block"></div>'
    + '</div>';
}

function _aiSetCardsErr() {
  var el = document.getElementById('ai-summary-cards');
  if (el) el.innerHTML = '<p class="col-span-full text-center text-xs text-red-500 py-6">'
    + '⚠ Failed to load data — check the console for details.</p>';
}

// Card definitions: [icon svg path, label, value fn, color classes]
var _AI_CARD_DEFS = [
  { key:'queries',  label:'Queries',       icon:'search',   accent:'blue'   },
  { key:'input',    label:'Input Tokens',  icon:'upload',   accent:'violet' },
  { key:'output',   label:'Output Tokens', icon:'download', accent:'emerald'},
  { key:'tokens',   label:'Total Tokens',  icon:'chip',     accent:'sky'    },
  { key:'cost',     label:'Est. Cost',     icon:'currency', accent:'amber'  },
];

var _AI_ACCENT = {
  blue:    { bg:'bg-blue-50 dark:bg-blue-950/40',    txt:'text-blue-600 dark:text-blue-400'   },
  violet:  { bg:'bg-violet-50 dark:bg-violet-950/40',txt:'text-violet-600 dark:text-violet-400'},
  emerald: { bg:'bg-emerald-50 dark:bg-emerald-950/40',txt:'text-emerald-600 dark:text-emerald-400'},
  sky:     { bg:'bg-sky-50 dark:bg-sky-950/40',      txt:'text-sky-600 dark:text-sky-400'     },
  amber:   { bg:'bg-amber-50 dark:bg-amber-950/40',  txt:'text-amber-600 dark:text-amber-400' },
};

var _AI_ICONS = {
  search:   '<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>',
  upload:   '<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>',
  download: '<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>',
  chip:     '<path stroke-linecap="round" stroke-linejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>',
  currency: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 13v-1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
};

function _aiCardHtml(def, value, sub) {
  var a   = _AI_ACCENT[def.accent] || _AI_ACCENT.blue;
  var ico = _AI_ICONS[def.icon] || _AI_ICONS.search;
  return '<div class="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm p-4 flex flex-col gap-2">'
    + '<div class="flex items-start justify-between gap-2">'
    +   '<span class="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 leading-tight">'
    +     _aiEsc(def.label)
    +   '</span>'
    +   '<span class="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 ' + a.bg + '">'
    +     '<svg class="w-3.5 h-3.5 ' + a.txt + '" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">'
    +       ico
    +     '</svg>'
    +   '</span>'
    + '</div>'
    + '<p class="text-xl font-bold text-gray-900 dark:text-zinc-100 leading-none tracking-tight">' + _aiEsc(value) + '</p>'
    + (sub ? '<p class="text-[10px] text-gray-400 dark:text-zinc-600">' + _aiEsc(sub) + '</p>' : '')
    + '</div>';
}

function _aiRenderOverview(data) {
  var s = data.summary || {}, daily = data.daily || [], models = data.models || [];
  var empty = !s.total_queries;

  // Empty state toggle
  var emptyEl = document.getElementById('ai-overview-empty');
  if (emptyEl) emptyEl.classList.toggle('hidden', !empty);

  // Stat cards
  var q   = s.total_queries || 0;
  var inp = s.total_input   || 0;
  var out = s.total_output  || 0;
  var tot = s.total_tokens  || 0;
  var cost = s.total_cost   || 0;
  var period = 'Last ' + _aiDays + ' day' + (_aiDays === 1 ? '' : 's');
  var cardsEl = document.getElementById('ai-summary-cards');
  if (cardsEl) {
    cardsEl.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3';
    cardsEl.innerHTML =
      _aiCardHtml(_AI_CARD_DEFS[0], _aiFmtN(q),   period)  +
      _aiCardHtml(_AI_CARD_DEFS[1], _aiFmtN(inp),  period)  +
      _aiCardHtml(_AI_CARD_DEFS[2], _aiFmtN(out),  period)  +
      _aiCardHtml(_AI_CARD_DEFS[3], _aiFmtN(tot),  period)  +
      _aiCardHtml(_AI_CARD_DEFS[4], '$' + cost.toFixed(4), period);
  }

  // Charts
  _aiLoadCj().then(function() {
    _aiDrawBar(daily);
    _aiDrawTokens(daily);
    _aiDrawCost(daily);
    _aiDrawModels(models);
  }).catch(function(e) {
    console.error('[ai-dash] Chart.js:', e);
  });
}

// ── Chart helpers ─────────────────────────────────────────────────────────────
function _aiDestroy(id) {
  if (_aiCharts[id]) { try { _aiCharts[id].destroy(); } catch(_) {} delete _aiCharts[id]; }
}
function _isDark() { return document.documentElement.classList.contains('dark'); }
function _aiGrid()  { return _isDark() ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; }
function _aiTick()  { return _isDark() ? '#71717a' : '#9ca3af'; }

function _aiBaseOpts(extra) {
  return Object.assign({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: _aiGrid(), drawBorder: false },
           ticks: { color: _aiTick(), font: { size: 10 }, maxRotation: 35, maxTicksLimit: 8 },
           border: { display: false } },
      y: { grid: { color: _aiGrid(), drawBorder: false },
           ticks: { color: _aiTick(), font: { size: 10 } },
           border: { display: false }, beginAtZero: true },
    },
  }, extra || {});
}

function _aiDrawBar(daily) {
  var id = 'ai-chart-queries'; _aiDestroy(id);
  var c = document.getElementById(id); if (!c) return;
  _aiCharts[id] = new Chart(c, {
    type: 'bar',
    data: {
      labels: daily.map(function(d) { return d.day; }),
      datasets: [{ label:'Queries', data: daily.map(function(d){ return d.queries; }),
        backgroundColor: _isDark() ? 'rgba(99,179,237,.7)' : 'rgba(0,83,226,.7)',
        hoverBackgroundColor: _isDark() ? '#63b3ed' : '#0053e2',
        borderRadius: 5, borderSkipped: false }],
    },
    options: _aiBaseOpts({
      plugins: { legend: { display: false },
                 tooltip: { callbacks: { label: function(i) { return i.raw + ' quer' + (i.raw === 1 ? 'y' : 'ies'); } } } },
    }),
  });
}

function _aiDrawTokens(daily) {
  var id = 'ai-chart-tokens'; _aiDestroy(id);
  var c = document.getElementById(id); if (!c) return;
  _aiCharts[id] = new Chart(c, {
    type: 'line',
    data: {
      labels: daily.map(function(d) { return d.day; }),
      datasets: [
        { label:'Input',  data: daily.map(function(d){ return d.input_tokens; }),
          borderColor:'#8b5cf6', backgroundColor:'rgba(139,92,246,.1)',
          fill:true, tension:.4, pointRadius:0, pointHoverRadius:4, borderWidth:2 },
        { label:'Output', data: daily.map(function(d){ return d.output_tokens; }),
          borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.1)',
          fill:true, tension:.4, pointRadius:0, pointHoverRadius:4, borderWidth:2 },
      ],
    },
    options: _aiBaseOpts({
      plugins: { legend: { display: true, position: 'bottom',
                           labels: { color: _aiTick(), font: { size: 10 }, boxWidth: 10, padding: 12 } } },
    }),
  });
}

function _aiDrawCost(daily) {
  var id = 'ai-chart-cost'; _aiDestroy(id);
  var c = document.getElementById(id); if (!c) return;
  _aiCharts[id] = new Chart(c, {
    type: 'line',
    data: {
      labels: daily.map(function(d) { return d.day; }),
      datasets: [{ label:'Cost', data: daily.map(function(d){ return +(d.cost_usd||0).toFixed(6); }),
        borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,.12)',
        fill:true, tension:.4, pointRadius:0, pointHoverRadius:4, borderWidth:2 }],
    },
    options: _aiBaseOpts({
      plugins: { legend: { display: false },
                 tooltip: { callbacks: { label: function(i) { return '$' + i.raw.toFixed(6); } } } },
      scales: Object.assign({}, _aiBaseOpts().scales, {
        y: Object.assign({}, _aiBaseOpts().scales.y, {
          ticks: Object.assign({}, _aiBaseOpts().scales.y.ticks, {
            callback: function(v) { return '$' + (+v).toFixed(4); },
          }),
        }),
      }),
    }),
  });
}

var _AI_DONUT_COLORS = ['#0053e2','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#64748b'];

function _aiDrawModels(models) {
  var id = 'ai-chart-models'; _aiDestroy(id);
  var c = document.getElementById(id); if (!c) return;
  var leg = document.getElementById('ai-model-legend');

  if (!models.length) {
    if (leg) leg.innerHTML = '';
    return;
  }
  var labels = models.map(function(m) { return m.model || 'unknown'; });
  var counts  = models.map(function(m) { return m.count; });
  var colors  = labels.map(function(_,i) { return _AI_DONUT_COLORS[i % _AI_DONUT_COLORS.length]; });

  _aiCharts[id] = new Chart(c, {
    type: 'doughnut',
    data: { labels: labels,
            datasets: [{ data: counts, backgroundColor: colors,
                         borderWidth: 3, borderColor: _isDark() ? '#18181b' : '#fff',
                         hoverOffset: 6 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'65%',
               plugins: { legend: { display:false },
                          tooltip: { callbacks: { label: function(i) {
                            var t = i.dataset.data.reduce(function(a,b){return a+b;},0);
                            return i.label + ': ' + i.raw + ' (' + (t ? (i.raw/t*100).toFixed(1) : 0) + '%)';
                          }}}},
    },
  });

  if (leg) {
    leg.innerHTML = labels.map(function(lbl, i) {
      return '<span class="flex items-center gap-1 text-[10px] text-gray-600 dark:text-zinc-400">'
        + '<span class="w-2 h-2 rounded-full flex-shrink-0" style="background:' + colors[i] + '"></span>'
        + _aiEsc(lbl.length > 22 ? lbl.slice(0,20) + '\u2026' : lbl)
        + '</span>';
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
    '<div class="flex flex-col gap-3">'
    + '<div class="ai-skel h-14 rounded-2xl ml-12"></div>'
    + '<div class="ai-skel h-24 rounded-2xl mr-12"></div>'
    + '<div class="ai-skel h-10 rounded-2xl ml-12"></div>'
    + '</div>';

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(d) { _aiRenderHistory(d); _aiHistBusy = false; })
    .catch(function(e) {
      console.error('[ai-dash] history:', e);
      _aiHistBusy = false;
      if (thread) thread.innerHTML = '<p class="text-center text-xs text-red-500 py-8">Failed to load history.</p>';
    });
}

function _aiRenderHistory(data) {
  var items = data.items || [], page = data.page || 1, tp = data.total_pages || 1;
  var thread = document.getElementById('ai-history-thread');
  if (!thread) return;

  if (!items.length) {
    thread.innerHTML =
      '<div class="flex flex-col items-center justify-center py-16 gap-3">'
      + '<div class="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-zinc-800 flex items-center justify-center text-2xl">💬</div>'
      + '<p class="text-sm font-semibold text-gray-600 dark:text-zinc-400">No conversations yet</p>'
      + '<p class="text-xs text-gray-400 dark:text-zinc-600">Ask BookWorm AI a question to start your history.</p>'
      + '</div>';
    _aiRenderPagination(page, tp);
    return;
  }

  thread.innerHTML = items.map(_aiBubblePair).join('');
  _aiRenderPagination(page, tp);
}

function _aiBubblePair(item) {
  var ts    = _aiTs(item.queried_at || '');
  var q     = _aiEsc(item.query_text || '(empty)');
  var ans   = _aiEsc(item.answer_text || '').replace(/\n/g, '<br>');
  var model = item.model ? item.model.split('/').pop() : '';
  var toks  = (item.input_tokens || 0) + (item.output_tokens || 0);
  var cost  = item.cost_usd ? '$' + (+item.cost_usd).toFixed(5) : null;

  // Metadata chips
  var chips = '';
  if (model) chips += _aiChip(model, '#8b5cf6');
  if (toks)  chips += _aiChip(_aiFmtN(toks) + ' tok', '#6b7280');
  if (cost)  chips += _aiChip(cost, '#f59e0b');

  return '<div class="space-y-3">'
    // ── Timestamp divider ──
    + '<div class="flex items-center gap-3">'
    +   '<div class="flex-1 h-px bg-gray-100 dark:bg-zinc-800"></div>'
    +   '<span class="text-[10px] text-gray-400 dark:text-zinc-600 whitespace-nowrap flex-shrink-0">' + _aiEsc(ts) + '</span>'
    +   '<div class="flex-1 h-px bg-gray-100 dark:bg-zinc-800"></div>'
    + '</div>'
    // ── User bubble (right) ──
    + '<div class="flex justify-end">'
    +   '<div class="max-w-[78%] flex flex-col items-end gap-1">'
    +     '<div class="ai-bubble-user text-white text-sm rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-sm leading-relaxed">'
    +       q
    +     '</div>'
    +     '<span class="text-[10px] text-gray-400 dark:text-zinc-600 mr-1">You</span>'
    +   '</div>'
    + '</div>'
    // ── AI bubble (left) ──
    + (ans
      ? '<div class="flex justify-start gap-2">'
        +   '<div class="w-7 h-7 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex-shrink-0 mt-1'
        +        ' flex items-center justify-center text-white text-[10px] font-bold shadow-sm">AI</div>'
        +   '<div class="max-w-[78%] flex flex-col gap-1.5">'
        +     '<div class="bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700'
        +          ' text-gray-800 dark:text-zinc-200 text-sm rounded-2xl rounded-tl-sm'
        +          ' px-4 py-2.5 shadow-sm leading-relaxed">'
        +       ans
        +     '</div>'
        +     (chips ? '<div class="flex flex-wrap gap-1.5 ml-1">' + chips + '</div>' : '')
        +   '</div>'
        + '</div>'
      : '')
    + '</div>';
}

function _aiChip(text, color) {
  return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold text-white"'
    + ' style="background:' + color + '20;color:' + color + '">'
    + _aiEsc(text) + '</span>';
}

function _aiRenderPagination(page, tp) {
  var el = document.getElementById('ai-hist-pagination');
  if (!el) return;
  if (tp <= 1) { el.innerHTML = ''; return; }
  var btn = function(label, pg, disabled) {
    return '<button onclick="aiLoadHistory(' + pg + ')" '
      + (disabled ? 'disabled ' : '')
      + 'class="px-3.5 py-1.5 text-xs font-semibold rounded-full border transition '
      + (disabled
        ? 'border-gray-200 dark:border-zinc-800 text-gray-300 dark:text-zinc-700 cursor-not-allowed'
        : 'border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 hover:border-wblue hover:text-wblue')
      + '">' + label + '</button>';
  };
  el.innerHTML =
    btn('← Prev', page - 1, page <= 1)
    + '<span class="text-[10px] text-gray-400 dark:text-zinc-500 px-1">Page ' + page + ' / ' + tp + '</span>'
    + btn('Next →', page + 1, page >= tp);
}

// ── Formatters ────────────────────────────────────────────────────────────────
function _aiEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _aiFmtN(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return String(n);
}
function _aiTs(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
    return d.toLocaleString(undefined, { month:'short', day:'numeric',
           year:'numeric', hour:'numeric', minute:'2-digit' });
  } catch(_) { return iso; }
}
