/* home-widget-settle.js — Settle Up dashboard widget engine
 *
 * Supports two modes:
 *   standalone — owns its own {currency, people, expenses} stored in widget config
 *   sync       — reads from / writes back to a Trip Planning Settle Up panel
 *
 * Rules: ALL variables use var (safe for HTMX re-injection).
 *        No alert() / confirm() — all feedback via inline status badges.
 *        _suCascadePlans / _suCascadePanels live in home-widgets.js.
 */

// ── Module state ──────────────────────────────────────────────────────────────
// Keyed by widget id (string).  One entry per Settle Up widget on the page.
var _suState = {};

// ── Currency symbol lookup ────────────────────────────────────────────────────
var _suCurrencySymbols = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  CAD: 'CA$', AUD: 'A$', VND: '₫', KRW: '₩', THB: '฿',
};

function _suSym(currency) {
  return _suCurrencySymbols[currency] || currency;
}

// ── Entry point ───────────────────────────────────────────────────────────────
function _settleUpInit(el) {
  var wid      = String(el.dataset.widgetId  || '');
  var pageId   = String(el.dataset.pageId    || '');
  var syncPgId = String(el.dataset.syncedPageId  || '0');
  var syncPlId = String(el.dataset.syncedPlanId  || '0');
  var syncPaId = String(el.dataset.syncedPanelId || '0');
  var synced   = (syncPgId !== '0' && syncPlId !== '0' && syncPaId !== '0');

  _suState[wid] = {
    people:          [],
    expenses:        [],
    currency:        'USD',
    synced:          synced,
    synced_page_id:  syncPgId,
    synced_plan_id:  syncPlId,
    synced_panel_id: syncPaId,
    page_id:         pageId,
    busy:            false,
    panel_title:     '',    // preserved for sync writes
    editingExpIdx:   -2,    // -2 = no form open, -1 = new, ≥0 = editing idx
  };

  if (synced) {
    _suFetchSync(wid, el);
  } else {
    var seedEl = document.getElementById('su-data-' + wid);
    var seed   = {};
    try { seed = seedEl ? JSON.parse(seedEl.textContent) : {}; } catch (e) {}
    _suState[wid].currency = seed.currency || 'USD';
    _suState[wid].people   = seed.people   || [];
    _suState[wid].expenses = seed.expenses || [];
    _suRender(wid, el);
  }
}

// ── Sync fetch ────────────────────────────────────────────────────────────────
function _suFetchSync(wid, el) {
  var st  = _suState[wid];
  var url = '/home/trip/' + st.synced_page_id
            + '/plans/' + st.synced_plan_id
            + '/panels/' + st.synced_panel_id;
  if (!el) el = document.getElementById('settle-up-' + wid);
  if (el) el.innerHTML = '<div class="text-xs text-gray-300 dark:text-zinc-600 text-center py-4 select-none">Syncing…</div>';
  fetch(url, {credentials: 'same-origin',
    headers: {'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}})
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (!data) {
      _suShowStatus(wid, '⚠ Sync failed — panel not found', true);
      return;
    }
    var c = data.content || {};
    _suState[wid].panel_title = data.title || 'Settle Up';
    _suState[wid].currency    = c.currency || 'USD';
    _suState[wid].people      = c.people   || [];
    _suState[wid].expenses    = c.expenses || [];
    var rootEl = document.getElementById('settle-up-' + wid);
    _suRender(wid, rootEl);
  })
  .catch(function() { _suShowStatus(wid, '⚠ Network error', true); });
}

// ── Render ────────────────────────────────────────────────────────────────────
function _suRender(wid, el) {
  if (!el) el = document.getElementById('settle-up-' + wid);
  if (!el) return;
  var st       = _suState[wid];
  var people   = st.people   || [];
  var expenses = st.expenses || [];
  var cur      = _suSym(st.currency);
  var isEdit   = st.editingExpIdx !== -2;  // any form open?

  // ── Header bar ──────────────────────────────────────────────────────────
  var syncBadge = st.synced
    ? '<span class="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded '
      + 'bg-blue-50 dark:bg-blue-950 text-blue-500 dark:text-blue-400 ml-2">⇄ synced</span>'
    : '';
  var header = '<div class="flex items-center gap-2 px-3 pt-2 pb-1">'
    + '<span class="text-xs font-semibold text-gray-500 dark:text-zinc-400 flex-1">'
    + st.currency + syncBadge + '</span>'
    + '<span id="su-status-' + wid + '" class="text-[10px]"></span>'
    + '</div>';

  // ── People section ───────────────────────────────────────────────────────
  var peoplePills = people.map(function(name, idx) {
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs '
      + 'bg-gray-100 dark:bg-zinc-700 text-gray-700 dark:text-zinc-200">'
      + _suEsc(name)
      + '<button onclick="_suRemovePerson(\'' + wid + '\',' + idx + ')" '
      + 'class="text-gray-300 hover:text-red-400 transition ml-0.5 text-[10px] leading-none">'
      + '✕</button></span>';
  }).join(' ');

  var addPersonHtml = '<div id="su-add-person-' + wid + '">'
    + '<button onclick="_suShowAddPerson(\'' + wid + '\')" '
    + 'class="text-xs text-gray-400 dark:text-zinc-500 hover:text-wblue dark:hover:text-blue-400 '
    + 'transition mt-1 inline-flex items-center gap-1">'
    + '<span class="text-sm leading-none">+</span> Add person</button></div>';

  var peopleSection = '<div class="px-3 pb-1">'
    + '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 '
    + 'dark:text-zinc-500 mb-1">People</p>'
    + '<div class="flex flex-wrap gap-1.5 mb-1">' + (peoplePills || '') + '</div>'
    + addPersonHtml
    + '</div>';

  // ── Expenses section ─────────────────────────────────────────────────────
  var expRows = expenses.map(function(exp, idx) {
    var splitArr = exp.split || [];
    var share    = splitArr.length > 0 ? (parseFloat(exp.amount) / splitArr.length) : parseFloat(exp.amount);
    var payer    = people[parseInt(exp.paid_by, 10)] || '?';
    var editBtn  = '<button onclick="_suOpenExpenseForm(\'' + wid + '\',' + idx + ')" '
      + 'class="text-gray-300 hover:text-wblue transition text-[10px] ml-1">\u270f\ufe0f</button>';
    var delBtn   = '<button onclick="_suDeleteExpense(\'' + wid + '\',' + idx + ')" '
      + 'class="text-gray-300 hover:text-red-400 transition text-[10px] ml-0.5">\u2715</button>';
    return '<div class="flex items-center gap-2 px-3 py-1 border-b '
      + 'border-gray-50 dark:border-zinc-800 last:border-0">'
      + '<div class="flex-1 min-w-0">'
      + '<p class="text-xs text-gray-700 dark:text-zinc-200 truncate">' + _suEsc(exp.desc || 'Expense') + '</p>'
      + '<p class="text-[10px] text-gray-400 dark:text-zinc-500">paid by ' + _suEsc(payer)
      + (splitArr.length > 1 ? ' · split ' + splitArr.length + ' ways' : '') + '</p>'
      + '</div>'
      + '<span class="text-xs font-semibold text-gray-600 dark:text-zinc-300 flex-shrink-0">'
      + cur + ' ' + (parseFloat(exp.amount) || 0).toFixed(2) + '</span>'
      + editBtn + delBtn
      + '</div>';
  }).join('');

  var addExpBtn = '<button onclick="_suOpenExpenseForm(\'' + wid + '\',-1)" '
    + 'class="text-xs text-gray-400 dark:text-zinc-500 hover:text-wblue dark:hover:text-blue-400 '
    + 'transition mt-1 ml-3 mb-2 inline-flex items-center gap-1">'
    + '<span class="text-sm leading-none">+</span> Add expense</button>';

  var expSection = '<div>'
    + '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 '
    + 'dark:text-zinc-500 px-3 pt-2 pb-0.5">Expenses</p>'
    + (expRows || '<p class="text-xs text-gray-300 dark:text-zinc-600 px-3 pb-1">No expenses yet.</p>')
    + addExpBtn
    + '</div>';

  // ── Expense form (inline, shown when editingExpIdx ≥ -1) ─────────────────
  var formHtml = '';
  if (st.editingExpIdx >= -1 && people.length > 0) {
    formHtml = _suExpenseFormHtml(wid);
  } else if (st.editingExpIdx >= -1 && people.length === 0) {
    formHtml = '<p class="text-xs text-amber-500 px-3 pb-2">Add at least one person first.</p>';
  }

  // ── Settlement section ────────────────────────────────────────────────────
  var settlementHtml = _suSettlementHtml(wid);

  el.innerHTML = header + peopleSection + expSection + formHtml + settlementHtml;
}

// ── Expense form HTML ─────────────────────────────────────────────────────────
function _suExpenseFormHtml(wid) {
  var st      = _suState[wid];
  var people  = st.people || [];
  var editIdx = st.editingExpIdx;
  var cur     = st.expenses[editIdx] || {};

  var descVal   = _suEscAttr(cur.desc    || '');
  var amtVal    = cur.amount  != null ? parseFloat(cur.amount).toFixed(2) : '';
  var paidBy    = cur.paid_by != null ? cur.paid_by : 0;
  var splitArr  = Array.isArray(cur.split) ? cur.split : people.map(function(_, i) { return i; });

  var payerOpts = people.map(function(name, idx) {
    return '<option value="' + idx + '"' + (idx === paidBy ? ' selected' : '') + '>'
      + _suEsc(name) + '</option>';
  }).join('');

  var splitCbs = people.map(function(name, idx) {
    var checked = splitArr.indexOf(idx) !== -1 ? ' checked' : '';
    return '<label class="flex items-center gap-1 text-xs text-gray-600 dark:text-zinc-300 cursor-pointer">'
      + '<input type="checkbox" id="su-split-' + wid + '-' + idx + '"' + checked
      + ' class="accent-wblue rounded"> ' + _suEsc(name) + '</label>';
  }).join('');

  var title = editIdx >= 0 ? 'Edit expense' : 'Add expense';
  return '<div class="mx-3 mb-3 p-3 rounded-xl border border-gray-200 dark:border-zinc-700 '
    + 'bg-gray-50 dark:bg-zinc-800/60 space-y-2">'
    + '<p class="text-xs font-semibold text-gray-600 dark:text-zinc-300">' + title + '</p>'
    + '<div class="flex gap-2">'
    + '<input id="su-exp-desc-' + wid + '" type="text" placeholder="Description" value="' + descVal + '"'
    + ' class="flex-1 text-xs border border-gray-200 dark:border-zinc-600 rounded-lg px-2 py-1.5'
    + ' bg-white dark:bg-zinc-700 text-gray-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-wblue">'
    + '<input id="su-exp-amt-' + wid + '" type="number" min="0" step="0.01" placeholder="0.00" value="' + amtVal + '"'
    + ' class="w-24 text-xs border border-gray-200 dark:border-zinc-600 rounded-lg px-2 py-1.5'
    + ' bg-white dark:bg-zinc-700 text-gray-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-wblue">'
    + '</div>'
    + '<div><label class="block text-[10px] font-semibold text-gray-400 dark:text-zinc-500 mb-1">Paid by</label>'
    + '<select id="su-exp-paidby-' + wid + '"'
    + ' class="w-full text-xs border border-gray-200 dark:border-zinc-600 rounded-lg px-2 py-1.5'
    + ' bg-white dark:bg-zinc-700 text-gray-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-wblue">'
    + payerOpts + '</select></div>'
    + '<div><label class="block text-[10px] font-semibold text-gray-400 dark:text-zinc-500 mb-1">Split between</label>'
    + '<div class="flex flex-wrap gap-x-3 gap-y-1">' + splitCbs + '</div></div>'
    + '<div id="su-exp-err-' + wid + '" class="text-[10px] text-red-500 hidden"></div>'
    + '<div class="flex gap-2 pt-1">'
    + '<button onclick="_suSaveExpense(\'' + wid + '\')" '
    + 'class="px-3 py-1.5 bg-wblue text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition">'
    + (editIdx >= 0 ? 'Update' : 'Add') + '</button>'
    + '<button onclick="_suCloseExpenseForm(\'' + wid + '\')" '
    + 'class="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-zinc-600 '
    + 'text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700 transition">Cancel</button>'
    + '</div></div>';
}

// ── Settlement section HTML ───────────────────────────────────────────────────
function _suSettlementHtml(wid) {
  var st       = _suState[wid];
  var people   = st.people   || [];
  var expenses = st.expenses || [];
  var cur      = _suSym(st.currency);

  if (people.length < 2 || !expenses.length) {
    return '<div class="px-3 pb-3">'
      + '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 '
      + 'dark:text-zinc-500 pt-2 pb-1">Who owes who</p>'
      + '<p class="text-xs text-gray-300 dark:text-zinc-600">Add people and expenses to see settlements.</p>'
      + '</div>';
  }

  var settlements = _suSettlementCalc(people, expenses);

  if (!settlements.length) {
    return '<div class="px-3 pb-3">'
      + '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 '
      + 'dark:text-zinc-500 pt-2 pb-1">Who owes who</p>'
      + '<p class="text-xs text-green-600 dark:text-green-400 font-medium">✓ All settled up!</p>'
      + '</div>';
  }

  var rows = settlements.map(function(s) {
    return '<div class="flex items-center gap-2 py-1">'
      + '<span class="text-xs text-gray-700 dark:text-zinc-200">'
      + _suEsc(people[s.fromIdx]) + '</span>'
      + '<span class="text-[10px] text-gray-400 dark:text-zinc-500">\u2192 owes</span>'
      + '<span class="text-xs font-semibold text-[#0053e2] dark:text-blue-400">'
      + cur + ' ' + s.amount.toFixed(2) + '</span>'
      + '<span class="text-[10px] text-gray-400 dark:text-zinc-500">to</span>'
      + '<span class="text-xs text-gray-700 dark:text-zinc-200">' + _suEsc(people[s.toIdx]) + '</span>'
      + '</div>';
  }).join('');

  return '<div class="px-3 pb-3">'
    + '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 '
    + 'dark:text-zinc-500 pt-2 pb-0.5">Who owes who</p>'
    + rows + '</div>';
}

// ── Settlement calculation ────────────────────────────────────────────────────
function _suSettlementCalc(people, expenses) {
  var n       = people.length;
  var balance = [];
  var i, exp, splitArr, share;
  for (i = 0; i < n; i++) balance.push(0);

  for (i = 0; i < expenses.length; i++) {
    exp      = expenses[i];
    splitArr = exp.split || [];
    if (!splitArr.length) continue;
    share    = (parseFloat(exp.amount) || 0) / splitArr.length;
    // payer's balance goes up (is owed money)
    var payer = parseInt(exp.paid_by, 10);
    if (payer >= 0 && payer < n) balance[payer] += (parseFloat(exp.amount) || 0);
    // each person in split owes their share
    for (var j = 0; j < splitArr.length; j++) {
      var idx = parseInt(splitArr[j], 10);
      if (idx >= 0 && idx < n) balance[idx] -= share;
    }
  }

  // Greedy debt simplification
  var creditors = [], debtors = [];
  for (i = 0; i < n; i++) {
    if (balance[i] > 0.005)  creditors.push({idx: i, amount: balance[i]});
    if (balance[i] < -0.005) debtors.push({idx: i, amount: -balance[i]});
  }

  var results = [];
  var ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    var cred  = creditors[ci];
    var debt  = debtors[di];
    var amt   = Math.min(cred.amount, debt.amount);
    if (amt > 0.005) {
      results.push({fromIdx: debt.idx, toIdx: cred.idx, amount: Math.round(amt * 100) / 100});
    }
    cred.amount -= amt;
    debt.amount -= amt;
    if (cred.amount < 0.005) ci++;
    if (debt.amount < 0.005) di++;
  }
  return results;
}

// ── People CRUD ───────────────────────────────────────────────────────────────
function _suShowAddPerson(wid) {
  var container = document.getElementById('su-add-person-' + wid);
  if (!container) return;
  container.innerHTML = '<div class="flex items-center gap-1 mt-1">'
    + '<input id="su-new-person-' + wid + '" type="text" placeholder="Name" maxlength="80"'
    + ' class="flex-1 text-xs border border-gray-200 dark:border-zinc-600 rounded-lg px-2 py-1'
    + ' bg-white dark:bg-zinc-700 text-gray-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-wblue"'
    + ' onkeydown="if(event.key===\'Enter\')_suCommitPerson(\'' + wid + '\');'
    + ' if(event.key===\'Escape\')_suCancelAddPerson(\'' + wid + '\');">'
    + '<button onclick="_suCommitPerson(\'' + wid + '\')" '
    + 'class="text-xs px-2 py-1 bg-wblue text-white rounded-lg hover:bg-blue-700 transition">Add</button>'
    + '<button onclick="_suCancelAddPerson(\'' + wid + '\')" '
    + 'class="text-xs px-2 py-1 text-gray-400 hover:text-gray-600 transition">✕</button>'
    + '</div>';
  var inp = document.getElementById('su-new-person-' + wid);
  if (inp) { inp.focus(); }
}

function _suCancelAddPerson(wid) {
  var el = document.getElementById('settle-up-' + wid);
  _suRender(wid, el);
}

function _suCommitPerson(wid) {
  var inp  = document.getElementById('su-new-person-' + wid);
  var name = (inp ? inp.value : '').trim();
  if (!name) { _suCancelAddPerson(wid); return; }
  _suState[wid].people.push(name);
  var el = document.getElementById('settle-up-' + wid);
  _suRender(wid, el);
  _suSave(wid);
}

function _suRemovePerson(wid, idx) {
  var st       = _suState[wid];
  var expenses = st.expenses || [];
  // Block if any expense references this person
  for (var i = 0; i < expenses.length; i++) {
    var exp = expenses[i];
    if (parseInt(exp.paid_by, 10) === idx) {
      _suShowStatus(wid, '⚠ Remove expenses paid by this person first', true);
      return;
    }
    var splitArr = exp.split || [];
    if (splitArr.indexOf(idx) !== -1) {
      _suShowStatus(wid, '⚠ Remove expenses this person splits first', true);
      return;
    }
  }
  st.people.splice(idx, 1);
  // Re-index expense references
  for (var j = 0; j < expenses.length; j++) {
    var e = expenses[j];
    if (parseInt(e.paid_by, 10) > idx) e.paid_by = parseInt(e.paid_by, 10) - 1;
    e.split = (e.split || []).map(function(s) { return parseInt(s, 10) > idx ? s - 1 : s; });
  }
  var el = document.getElementById('settle-up-' + wid);
  _suRender(wid, el);
  _suSave(wid);
}

// ── Expense CRUD ──────────────────────────────────────────────────────────────
function _suOpenExpenseForm(wid, editIdx) {
  _suState[wid].editingExpIdx = editIdx;
  var el = document.getElementById('settle-up-' + wid);
  _suRender(wid, el);
  // Auto-focus desc
  var descInp = document.getElementById('su-exp-desc-' + wid);
  if (descInp) { setTimeout(function() { descInp.focus(); }, 50); }
}

function _suCloseExpenseForm(wid) {
  _suState[wid].editingExpIdx = -2;
  var el = document.getElementById('settle-up-' + wid);
  _suRender(wid, el);
}

function _suSaveExpense(wid) {
  var st      = _suState[wid];
  var people  = st.people || [];
  var desc    = (document.getElementById('su-exp-desc-'   + wid) || {}).value || '';
  var amtStr  = (document.getElementById('su-exp-amt-'    + wid) || {}).value || '';
  var paidBy  = parseInt((document.getElementById('su-exp-paidby-' + wid) || {}).value || '0', 10);
  var errEl   = document.getElementById('su-exp-err-' + wid);

  var amount  = parseFloat(amtStr);
  if (!amount || amount <= 0) {
    if (errEl) { errEl.textContent = 'Enter a valid amount.'; errEl.classList.remove('hidden'); }
    return;
  }

  var split = [];
  for (var i = 0; i < people.length; i++) {
    var cb = document.getElementById('su-split-' + wid + '-' + i);
    if (cb && cb.checked) split.push(i);
  }
  if (!split.length) {
    if (errEl) { errEl.textContent = 'Select at least one person in the split.'; errEl.classList.remove('hidden'); }
    return;
  }

  var exp = {
    desc:    desc.trim() || 'Expense',
    paid_by: paidBy,
    amount:  Math.round(amount * 100) / 100,
    split:   split,
  };

  var editIdx = st.editingExpIdx;
  if (editIdx >= 0 && editIdx < st.expenses.length) {
    st.expenses[editIdx] = exp;
  } else {
    st.expenses.push(exp);
  }
  st.editingExpIdx = -2;

  var el = document.getElementById('settle-up-' + wid);
  _suRender(wid, el);
  _suSave(wid);
}

function _suDeleteExpense(wid, idx) {
  _suState[wid].expenses.splice(idx, 1);
  _suState[wid].editingExpIdx = -2;
  var el = document.getElementById('settle-up-' + wid);
  _suRender(wid, el);
  _suSave(wid);
}

// ── Persist ───────────────────────────────────────────────────────────────────
function _suSave(wid) {
  var st = _suState[wid];
  if (st.busy) return;
  st.busy = true;

  var body;
  var url;
  var method = 'PUT';

  if (st.synced) {
    // Write back to the trip panel
    url  = '/home/trip/' + st.synced_page_id
           + '/plans/' + st.synced_plan_id
           + '/panels/' + st.synced_panel_id;
    body = JSON.stringify({
      title:   st.panel_title || 'Settle Up',
      content: {
        currency: st.currency,
        people:   st.people,
        expenses: st.expenses,
      },
    });
  } else {
    // Write to the standalone widget config
    url  = '/home/pages/' + st.page_id + '/widgets/' + wid + '/settle';
    body = JSON.stringify({
      currency: st.currency,
      people:   st.people,
      expenses: st.expenses,
    });
  }

  fetch(url, {
    method:      method,
    credentials: 'same-origin',
    headers:     {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'},
    body:        body,
  })
  .then(function(r) {
    st.busy = false;
    if (r.ok) {
      _suShowStatus(wid, '✓ Saved', false);
    } else {
      r.text().then(function(t) { _suShowStatus(wid, '✗ ' + (r.status || 'Error'), true); });
    }
  })
  .catch(function(err) {
    st.busy = false;
    _suShowStatus(wid, '✗ Network error', true);
  });
}

// ── Status badge ──────────────────────────────────────────────────────────────
function _suShowStatus(wid, msg, isError) {
  var el = document.getElementById('su-status-' + wid);
  if (!el) return;
  el.textContent  = msg;
  el.className    = 'text-[10px] ' + (isError
    ? 'text-red-500 dark:text-red-400'
    : 'text-green-600 dark:text-green-400');
  clearTimeout(el._suTimer);
  el._suTimer = setTimeout(function() {
    if (el) { el.textContent = ''; el.className = 'text-[10px]'; }
  }, isError ? 4000 : 2000);
}

// ── Escape helpers ────────────────────────────────────────────────────────────
function _suEsc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _suEscAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
