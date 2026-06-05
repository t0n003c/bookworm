/**
 * home-page-ai-budget.js — Budget tracker + history retention for the AI Dashboard.
 * Depends on globals from home-page-ai-dashboard.js:
 *   _aiPid, _aiLastCost, _aiLastPeriod, _AI_LS_BUDGET, _AI_LS_RETENTION,
 *   _aiEsc(), aiLoadOverview()
 * All var — HTMX-safe on repeated swaps.
 */
'use strict';

// ── Budget tracker ────────────────────────────────────────────────────────────
function _aiRenderBudget(cost, period) {
  var el = document.getElementById('ai-budget-card');
  if (!el) return;
  var budget    = parseFloat(localStorage.getItem(_AI_LS_BUDGET) || '0');
  var pct       = budget > 0 ? Math.min(cost / budget * 100, 100) : 0;
  var over      = budget > 0 && cost > budget;
  var barColor  = over ? '#ea1100' : (pct > 80 ? '#f59e0b' : '#0053e2');
  var remaining = budget > 0 ? Math.max(budget - cost, 0) : null;

  el.innerHTML =
    '<div class="rounded-2xl border border-gray-100 dark:border-zinc-800'
    + ' bg-white dark:bg-zinc-900 p-4 h-full flex flex-col gap-3">'

    // Budget input row
    + '<div class="flex items-center gap-2">'
    +   '<label class="text-[10px] font-semibold text-gray-400 dark:text-zinc-500'
    +          ' uppercase tracking-wide flex-shrink-0">Monthly Budget</label>'
    +   '<span class="text-gray-400 dark:text-zinc-600 text-xs">$</span>'
    +   '<input id="ai-budget-input" type="number" min="0" step="0.01" placeholder="0.00"'
    +     ' value="' + (budget > 0 ? budget.toFixed(2) : '') + '"'
    +     ' class="w-24 text-xs border border-gray-200 dark:border-zinc-700 rounded-lg'
    +     ' px-2 py-1 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300'
    +     ' focus:outline-none focus:ring-2 focus:ring-wblue"/>'
    +   '<button onclick="aiBudgetSave()"'
    +     ' class="text-xs px-3 py-1 rounded-lg bg-wblue text-white font-semibold'
    +     ' hover:bg-blue-700 transition focus:outline-none focus:ring-2 focus:ring-wblue">'
    +     'Set'
    +   '</button>'
    + '</div>'

    // Spent vs budget numbers
    + '<div class="flex items-end justify-between">'
    +   '<div>'
    +     '<p class="text-2xl font-bold leading-none tracking-tight '
    +       (over ? 'text-red-500' : 'text-gray-900 dark:text-zinc-100') + '">'
    +       '$' + cost.toFixed(4)
    +     '</p>'
    +     '<p class="text-[10px] text-gray-400 dark:text-zinc-600 mt-0.5">'
    +       'spent &middot; ' + _aiEsc(period)
    +     '</p>'
    +   '</div>'
    +   (budget > 0
      ? '<div class="text-right">'
        + '<p class="text-sm font-bold '
        + (over ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400') + '">'
        + (over
            ? '+$' + (cost - budget).toFixed(4) + ' over'
            : '$' + remaining.toFixed(4) + ' left')
        + '</p>'
        + '<p class="text-[10px] text-gray-400 dark:text-zinc-600">of $'
        + budget.toFixed(2) + ' budget</p>'
        + '</div>'
      : '<p class="text-[10px] text-gray-400 dark:text-zinc-600">Set a budget to track</p>')
    + '</div>'

    // Progress bar (only when budget is set)
    + (budget > 0
      ? '<div class="h-2 rounded-full bg-gray-100 dark:bg-zinc-800 overflow-hidden">'
        + '<div class="h-full rounded-full transition-all duration-500"'
        + ' style="width:' + pct.toFixed(1) + '%;background:' + barColor + '"></div>'
        + '</div>'
        + '<p class="text-[10px] text-gray-400 dark:text-zinc-600">'
        + pct.toFixed(1) + '% of monthly budget used</p>'
      : '')

    + '</div>';
}

function aiBudgetSave() {
  var inp = document.getElementById('ai-budget-input');
  if (!inp) return;
  var val = parseFloat(inp.value);
  if (isNaN(val) || val < 0) val = 0;
  localStorage.setItem(_AI_LS_BUDGET, String(val));
  _aiRenderBudget(_aiLastCost, _aiLastPeriod);
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
