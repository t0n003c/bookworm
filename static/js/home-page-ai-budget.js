/**
 * home-page-ai-budget.js — Budget tracker line chart + retention popover.
 *
 * Depends on globals from home-page-ai-dashboard.js:
 *   _aiPid, _aiLastDaily, _AI_LS_RETENTION, _aiCharts,
 *   _aiDestroy(), _isDark(), _aiGrid(), _aiTick(), aiLoadOverview()
 * All var — HTMX-safe on repeated swaps.
 */
'use strict';

var _AI_LS_BUDGET    = 'bw-ai-budget';      // JSON array of {date,amount}
var _AI_LS_RETENTION = 'bw-ai-retention';   // keep_days string

// ── Budget tracker — payment store ───────────────────────────────────────────
function _aiBudgetPayments() {
  try { return JSON.parse(localStorage.getItem(_AI_LS_BUDGET) || '[]'); }
  catch (_) { return []; }
}

function _aiBudgetSave(payments) {
  // Sort ascending by date so the chart always reads chronologically
  payments.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  localStorage.setItem(_AI_LS_BUDGET, JSON.stringify(payments));
}

function aiBudgetAddPayment() {
  var dateEl   = document.getElementById('ai-budget-date');
  var amountEl = document.getElementById('ai-budget-amount');
  if (!dateEl || !amountEl) return;

  var date   = dateEl.value;
  var amount = parseFloat(amountEl.value);
  if (!date || isNaN(amount) || amount <= 0) return;

  var payments = _aiBudgetPayments();
  payments.push({ date: date, amount: amount });
  _aiBudgetSave(payments);

  // Clear inputs
  dateEl.value   = '';
  amountEl.value = '';

  // Redraw with current data
  _aiRenderBudget(_aiLastDaily);
}

function aiBudgetRemovePayment(idx) {
  var payments = _aiBudgetPayments();
  payments.splice(idx, 1);
  _aiBudgetSave(payments);
  _aiRenderBudget(_aiLastDaily);
}

// ── Budget tracker — render pills + chart ────────────────────────────────────
function _aiRenderBudget(daily) {
  _aiRenderPaymentPills();
  _aiDrawBudget(daily);
}

function _aiRenderPaymentPills() {
  var el = document.getElementById('ai-budget-payments');
  if (!el) return;
  var payments = _aiBudgetPayments();
  if (!payments.length) { el.innerHTML = ''; return; }

  // Use _isDark() for inline styles — Tailwind doesn't scan dark: classes
  // in runtime-generated strings, so the compiled CSS may omit them.
  var dark      = typeof _isDark === 'function' && _isDark();
  var pillBg    = dark ? 'rgba(96,165,250,0.18)'  : 'rgba(0,83,226,0.07)';
  var pillColor = dark ? '#93c5fd'                : '#0053e2';
  var pillBrd   = dark ? 'rgba(96,165,250,0.40)'  : 'rgba(0,83,226,0.22)';
  var xColor    = dark ? '#a1a1aa'                : '#9ca3af';

  el.innerHTML = payments.map(function(p, i) {
    return '<span style="'
      + 'display:inline-flex;align-items:center;gap:4px;'
      + 'font-size:10px;font-weight:600;white-space:nowrap;'
      + 'padding:2px 8px;border-radius:9999px;'
      + 'background:' + pillBg + ';'
      + 'color:' + pillColor + ';'
      + 'border:1px solid ' + pillBrd + ';'
      + '">'
      + _aiEsc(p.date) + ' &nbsp;$' + Number(p.amount).toFixed(2)
      + '<button onclick="aiBudgetRemovePayment(' + i + ')"'
      + ' style="margin-left:2px;background:none;border:none;cursor:pointer;'
      + 'padding:0;font-size:13px;line-height:1;color:' + xColor + ';"'
      + ' aria-label="Remove payment">&times;</button>'
      + '</span>';
  }).join('');
}

function _aiDrawBudget(daily) {
  var id = 'ai-chart-budget';
  _aiDestroy(id);
  var c = document.getElementById(id);
  if (!c) return;

  var payments = _aiBudgetPayments();
  var labels   = (daily || []).map(function(d) { return d.day; });

  // ── Cumulative spend line (always shown) ────────────────────────────────
  var cumSpend = [];
  var running  = 0;
  (daily || []).forEach(function(d) {
    running += +(d.cost_usd || 0);
    cumSpend.push(+running.toFixed(6));
  });

  var datasets = [{
    label:           'Cumulative Spend',
    data:            cumSpend,
    borderColor:     '#f59e0b',
    backgroundColor: 'rgba(245,158,11,0.10)',
    fill:            true,
    tension:         0.4,
    pointRadius:     0,
    pointHoverRadius: 4,
    borderWidth:     2,
    yAxisID:         'y',
  }];

  // ── Remaining balance line (only when payments are entered) ─────────────
  if (payments.length && labels.length) {
    // Sum all payments on or before each label date
    var balLine = labels.map(function(day, i) {
      var prepaid = payments.reduce(function(sum, p) {
        return sum + (p.date <= day ? p.amount : 0);
      }, 0);
      return +(prepaid - cumSpend[i]).toFixed(6);
    });

    var allPositive = balLine.every(function(v) { return v >= 0; });
    datasets.push({
      label:            'Remaining Balance',
      data:             balLine,
      borderColor:      allPositive ? '#2a8703' : '#ea1100',
      backgroundColor:  allPositive ? 'rgba(42,135,3,0.08)' : 'rgba(234,17,0,0.08)',
      fill:             true,
      tension:          0.4,
      pointRadius:      0,
      pointHoverRadius: 4,
      borderWidth:      2,
      yAxisID:          'y',
    });
  }

  var emptyState = !labels.length;
  if (emptyState) {
    // No data yet — show a flat zero chart so the canvas isn't blank
    labels   = ['(no data)'];
    datasets = [{ label: 'Cumulative Spend', data: [0],
                  borderColor: '#f59e0b', borderWidth: 2,
                  pointRadius: 0, fill: false, yAxisID: 'y' }];
  }

  _aiCharts[id] = new Chart(c, {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction:         { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display:  datasets.length > 1,
          position: 'bottom',
          labels:   { color: _aiTick(), font: { size: 10 }, boxWidth: 10, padding: 10 },
        },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return ctx.dataset.label + ': $' + Number(ctx.raw).toFixed(4);
            },
          },
        },
      },
      scales: {
        x: {
          grid:   { color: _aiGrid(), drawBorder: false },
          ticks:  { color: _aiTick(), font: { size: 10 }, maxRotation: 35, maxTicksLimit: 8 },
          border: { display: false },
        },
        y: {
          grid:        { color: _aiGrid(), drawBorder: false },
          border:      { display: false },
          beginAtZero: true,
          ticks: {
            color:    _aiTick(),
            font:     { size: 10 },
            callback: function(v) { return '$' + (+v).toFixed(4); },
          },
        },
      },
    },
  });
}

// ── Retention popover ─────────────────────────────────────────────────────────
function aiToggleRetentionPopover(e) {
  if (e) e.stopPropagation();
  var pop  = document.getElementById('ai-retention-popover');
  var gear = document.getElementById('ai-retention-gear');
  if (!pop) return;
  var opening = pop.classList.contains('hidden');
  pop.classList.toggle('hidden', !opening);
  if (gear) gear.setAttribute('aria-expanded', opening ? 'true' : 'false');
  if (opening) {
    var sel = document.getElementById('ai-retention-select');
    if (sel) sel.value = localStorage.getItem(_AI_LS_RETENTION) || '0';
    setTimeout(function() {
      document.addEventListener('click', _aiCloseRetentionOnOutside, { once: true });
    }, 0);
  }
}

function _aiCloseRetentionOnOutside(e) {
  var wrap = document.getElementById('ai-retention-wrap');
  if (wrap && !wrap.contains(e.target)) {
    var pop  = document.getElementById('ai-retention-popover');
    var gear = document.getElementById('ai-retention-gear');
    if (pop)  pop.classList.add('hidden');
    if (gear) gear.setAttribute('aria-expanded', 'false');
  }
}

// ── Retention / cleanup ───────────────────────────────────────────────────────
function aiApplyRetention() {
  var sel = document.getElementById('ai-retention-select');
  if (!sel) return;
  var keepDays = parseInt(sel.value, 10) || 0;
  localStorage.setItem(_AI_LS_RETENTION, String(keepDays));
  var label = keepDays === 0 ? 'forever' : 'last ' + keepDays + ' days';
  if (!confirm('Trim history to ' + label + '? Older entries will be permanently deleted.')) return;
  _aiDoDelete(keepDays);
}

function aiConfirmDeleteAll() {
  if (!confirm('Delete ALL AI chat history? This cannot be undone.')) return;
  _aiDoDelete(0);
}

function _aiDoDelete(keepDays) {
  var msgEl = document.getElementById('ai-retention-msg');
  fetch('/home/ai-dashboard/' + _aiPid + '/history?keep_days=' + keepDays, { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var n = d.deleted || 0;
      if (msgEl) {
        msgEl.textContent = n + ' record' + (n === 1 ? '' : 's') + ' deleted.';
        msgEl.classList.remove('hidden');
        setTimeout(function() { msgEl.classList.add('hidden'); }, 4000);
      }
      aiLoadOverview();
    })
    .catch(function(e) {
      console.error('[ai-dash] delete history:', e);
      if (msgEl) {
        msgEl.textContent = 'Delete failed — see console.';
        msgEl.classList.remove('hidden');
      }
    });
}
