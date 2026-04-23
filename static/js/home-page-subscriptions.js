/**
 * home-page-subscriptions.js
 * Wallos-inspired subscription tracker for BookWorm homespace pages.
 * Activated by _initSwappedPage() when #subs-page-root is in the DOM.
 *
 * Rules: ALL var — zero let/const (HTMX re-injection safety).
 * Chart.js: lazy-loaded from /static/js/vendor/chart.umd.min.js (bundled locally —
 * no CDN dependency, works on Walmart network and in Docker with no internet).
 */

// ── Module-level state (var — safe for repeated initSubsPage calls) ───────────
var _subsPid = 0;
var _subsData = [];              // raw rows from /list (includes computed fields)
var _subsSummary = {};           // from /summary endpoint
var _subsFilterActive = 'all';   // 'all' | 'active' | 'inactive'
var _subsFilterCat = '';         // '' = no category filter
var _subsSort = 'name';          // 'name' | 'amount' | 'date'
var _subsChartDonut = null;
var _subsChartBar = null;
var _subsChartLibsPromise = null;
var _subsEditingId = 0;          // 0 = add mode, >0 = edit mode (sub id)

var _SUBS_CURRENCIES = [
  'USD','EUR','GBP','JPY','CAD','AUD','CHF',
  'SGD','HKD','MXN','BRL','INR','KRW','SEK','NOK'
];
var _SUBS_CYCLES = [
  {v:3,l:'Monthly'}, {v:4,l:'Yearly'},
  {v:2,l:'Weekly'},  {v:1,l:'Daily'}
];

// ── Entry point ────────────────────────────────────────────────────────────────

function initSubsPage(pid) {
  _subsPid           = pid;
  _subsData          = [];
  _subsSummary       = {};
  _subsFilterActive  = 'all';
  _subsFilterCat     = '';
  _subsSort          = 'name';
  _subsEditingId     = 0;
  _subsSetLoading(true);
  _subsLoadAll();
}

// ── Data loading ───────────────────────────────────────────────────────────────

function _subsLoadAll() {
  Promise.all([
    fetch('/home/subscriptions/' + _subsPid + '/list').then(function(r){ return r.json(); }),
    fetch('/home/subscriptions/' + _subsPid + '/summary').then(function(r){ return r.json(); })
  ]).then(function(results) {
    _subsData    = Array.isArray(results[0]) ? results[0] : [];
    _subsSummary = results[1] || {};
    _subsSetLoading(false);
    _subsRenderFilterBar();
    _subsRenderList();
    _subsRenderSummaryCards();
    _subsLoadCharts();
  }).catch(function(e) {
    _subsSetLoading(false);
    console.error('[subs] load failed:', e);
    var el = document.getElementById('subs-list');
    if (el) el.innerHTML = '<p class="p-4 text-sm text-red-500">Failed to load subscriptions.</p>';
  });
}

function _subsSetLoading(on) {
  var el = document.getElementById('subs-loading');
  if (el) el.textContent = on ? 'Loading…' : '';
}

// ── Filter bar ─────────────────────────────────────────────────────────────────

function _subsRenderFilterBar() {
  var bar = document.getElementById('subs-filter-bar');
  if (!bar) return;

  // Collect distinct categories from loaded data
  var cats = {};
  _subsData.forEach(function(s) { if (s.category) cats[s.category] = 1; });
  var catKeys = Object.keys(cats).sort();

  var tabs = [
    {k:'all',    l:'All'},
    {k:'active', l:'Active'},
    {k:'inactive',l:'Inactive'}
  ];
  var tabHtml = tabs.map(function(t) {
    var active = t.k === _subsFilterActive;
    return '<button onclick="_subsSetFilter(\'' + t.k + '\',_subsFilterCat)" ' +
      'class="px-2 py-0.5 rounded text-xs font-medium transition ' +
      (active
        ? 'bg-[#0053e2] text-white'
        : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800') +
      '">' + _subsEsc(t.l) + '</button>';
  }).join('');

  var catHtml = '';
  if (catKeys.length > 0) {
    catHtml = '<select onchange="_subsSetFilter(_subsFilterActive,this.value)" ' +
      'class="ml-auto text-xs border border-gray-200 dark:border-zinc-700 ' +
      'rounded px-2 py-0.5 bg-white dark:bg-zinc-800 ' +
      'text-gray-700 dark:text-zinc-200">' +
      '<option value="">All categories</option>' +
      catKeys.map(function(c) {
        return '<option value="' + _subsEsc(c) + '"' +
          (c === _subsFilterCat ? ' selected' : '') + '>' + _subsEsc(c) + '</option>';
      }).join('') +
      '</select>';
  }

  bar.innerHTML = tabHtml + catHtml;
}

function _subsSetFilter(active, cat) {
  _subsFilterActive = active;
  _subsFilterCat    = cat || '';
  _subsRenderFilterBar();
  _subsRenderList();
}

// ── Subscription list ──────────────────────────────────────────────────────────

function _subsApplyFilters(data) {
  return data.filter(function(s) {
    if (_subsFilterActive === 'active'   && !s.active) return false;
    if (_subsFilterActive === 'inactive' &&  s.active) return false;
    if (_subsFilterCat && s.category !== _subsFilterCat) return false;
    return true;
  });
}

function _subsApplySort(data) {
  var arr = data.slice();
  arr.sort(function(a, b) {
    if (_subsSort === 'amount') return (b.monthly_equiv || 0) - (a.monthly_equiv || 0);
    if (_subsSort === 'date') {
      if (!a.next_payment_date) return 1;
      if (!b.next_payment_date) return -1;
      return a.next_payment_date.localeCompare(b.next_payment_date);
    }
    return a.name.localeCompare(b.name);
  });
  return arr;
}

function _subsRenderList() {
  var el = document.getElementById('subs-list');
  if (!el) return;

  var filtered = _subsApplySort(_subsApplyFilters(_subsData));

  if (filtered.length === 0) {
    el.innerHTML = '<div class="p-6 text-center">' +
      '<p class="text-sm text-gray-400 dark:text-zinc-500">' +
      (_subsData.length === 0
        ? 'No subscriptions yet.<br>Click <strong>＋ Add Subscription</strong> to start.'
        : 'No subscriptions match the current filter.') +
      '</p></div>';
    return;
  }

  el.innerHTML = filtered.map(function(s) {
    return _subsRowHtml(s);
  }).join('');
}

// ── Favicon helper ────────────────────────────────────────────────────────────
// Returns a Google favicon URL for the given website URL, or null if invalid.
// Falls back gracefully to the colored dot via onerror in the img tag.
function _subsGetFaviconUrl(websiteUrl) {
  if (!websiteUrl) return null;
  try {
    var url = websiteUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    var hostname = new URL(url).hostname;
    if (!hostname || hostname.indexOf('.') === -1) return null;
    return 'https://www.google.com/s2/favicons?domain=' +
           encodeURIComponent(hostname) + '&sz=32';
  } catch (e) {
    return null;
  }
}

function _subsRowHtml(s) {
  var daysUntil = s.days_until_due;
  var badge = '';
  if (daysUntil !== null && daysUntil !== undefined) {
    if (daysUntil < 0) {
      badge = '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 ' +
        'dark:bg-red-900/40 dark:text-red-300 whitespace-nowrap">Overdue</span>';
    } else if (daysUntil <= 7) {
      badge = '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 ' +
        'dark:bg-red-900/40 dark:text-red-300 whitespace-nowrap">Due in ' + daysUntil + 'd</span>';
    } else if (daysUntil <= 30) {
      badge = '<span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 ' +
        'dark:bg-amber-900/40 dark:text-amber-300 whitespace-nowrap">Due in ' + daysUntil + 'd</span>';
    }
  }

  var inactive = !s.active;
  var color = s.color || '#0053e2';
  var pct = s.progress_pct || 0;
  var monthlyStr = '$' + (s.monthly_equiv || 0).toFixed(2) + '/mo';
  if (s.currency !== 'USD') monthlyStr = s.currency + ' equiv';

  // Icon: favicon if website_url set, colored dot as fallback
  var faviconUrl = _subsGetFaviconUrl(s.website_url || '');
  var iconHtml = faviconUrl
    ? '<img src="' + faviconUrl + '" width="16" height="16" ' +
        'style="flex-shrink:0;border-radius:3px;" alt="" ' +
        'onerror="this.style.display=\'none\';this.nextSibling.style.display=\'inline-block\';">'
      + '<span class="w-3 h-3 rounded-full flex-shrink-0" ' +
        'style="display:none;background:' + _subsEsc(color) + ';"></span>'
    : '<span class="w-3 h-3 rounded-full flex-shrink-0" ' +
        'style="background:' + _subsEsc(color) + ';"></span>';

  return '<div class="flex flex-col gap-1 px-3 py-2.5 border-b border-gray-50 ' +
    'dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/60 transition ' +
    (inactive ? 'opacity-50' : '') + '">' +
    '<div class="flex items-center gap-2 min-w-0">' +
      iconHtml +
      '<span class="text-sm font-semibold text-gray-800 dark:text-zinc-100 truncate flex-1">' +
        _subsEsc(s.name) +
      '</span>' +
      badge +
      '<span class="text-xs text-gray-500 dark:text-zinc-400 whitespace-nowrap ml-auto pl-1">' +
        _subsEsc(s.currency) + ' ' + (s.amount || 0).toFixed(2) +
      '</span>' +
    '</div>' +
    '<div class="flex items-center gap-2">' +
      '<div class="flex-1 h-1 rounded-full bg-gray-100 dark:bg-zinc-700 overflow-hidden">' +
        '<div class="h-full rounded-full transition-all" ' +
          'style="width:' + pct + '%; background:' + _subsEsc(color) + '"></div>' +
      '</div>' +
      '<span class="text-[10px] text-gray-400 dark:text-zinc-500 whitespace-nowrap">' +
        _subsEsc(s.cycle_label || '') +
      '</span>' +
    '</div>' +
    '<div class="flex items-center gap-1 justify-end">' +
      '<span class="text-[10px] text-gray-400 dark:text-zinc-500 mr-auto">' +
        _subsEsc(monthlyStr) +
      '</span>' +
      '<button onclick="_subsEdit(' + s.id + ')" ' +
        'class="text-xs text-gray-400 hover:text-[#0053e2] transition px-1" ' +
        'aria-label="Edit ' + _subsEscAttr(s.name) + '">✏️</button>' +
      '<button onclick="_subsDeletePrompt(' + s.id + ',\'' + _subsJsStr(s.name) + '\')" ' +
        'class="text-xs text-gray-400 hover:text-red-500 transition px-1" ' +
        'aria-label="Delete ' + _subsEscAttr(s.name) + '">🗑️</button>' +
    '</div>' +
  '</div>';
}

// ── Summary cards ──────────────────────────────────────────────────────────────

function _subsRenderSummaryCards() {
  var el = document.getElementById('subs-summary-cards');
  if (!el) return;
  var s = _subsSummary;
  var cards = [
    {label:'Monthly Total', value: _subsFmtMoney(s.monthly_total), icon:'📅'},
    {label:'Yearly Total',  value: _subsFmtMoney(s.yearly_total),  icon:'📆'},
    {label:'Active',        value: (s.active_count || 0) + ' / ' + (s.total_count || 0), icon:'✅'},
    {label:'Next Due',      value: _subsNextDueLabel(s.upcoming),  icon:'⏰'},
  ];
  el.innerHTML = cards.map(function(c) {
    return '<div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 ' +
      'dark:border-zinc-800 shadow-sm p-3 flex flex-col gap-1">' +
      '<div class="flex items-center gap-1.5">' +
        '<span aria-hidden="true">' + c.icon + '</span>' +
        '<span class="text-[11px] font-medium text-gray-500 dark:text-zinc-400">' + _subsEsc(c.label) + '</span>' +
      '</div>' +
      '<p class="text-sm font-bold text-gray-900 dark:text-zinc-100 truncate">' + _subsEsc(c.value) + '</p>' +
    '</div>';
  }).join('');
}

function _subsFmtMoney(val) {
  if (val === null || val === undefined) return '$0.00';
  return '$' + Number(val).toFixed(2);
}

function _subsNextDueLabel(upcoming) {
  if (!upcoming || !upcoming.length) return '—';
  var u = upcoming[0];
  var d = u.days_until;
  if (d === null || d === undefined) return u.name;
  if (d < 0) return u.name + ' (overdue)';
  if (d === 0) return u.name + ' (today)';
  return u.name + ' in ' + d + 'd';
}

// ── Charts ─────────────────────────────────────────────────────────────────────

function _subsLoadCharts() {
  if (!_subsChartLibsPromise) {
    _subsChartLibsPromise = new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = '/static/js/vendor/chart.umd.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  _subsChartLibsPromise.then(function() {
    _subsRenderCharts();
    _subsRenderUpcoming();
  }).catch(function(e) {
    console.error('[subs] Chart.js vendor bundle load failed:', e);
    _subsRenderUpcoming(); // still render upcoming list without charts
  });
}

function _subsRenderCharts() {
  _subsRenderDonut();
  _subsRenderBar();
}

function _subsRenderDonut() {
  var canvas = document.getElementById('subs-donut-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_subsChartDonut) { _subsChartDonut.destroy(); _subsChartDonut = null; }

  var cats = (_subsSummary.by_category || []);
  if (cats.length === 0) {
    canvas.parentElement.innerHTML = '<p class="text-xs text-gray-400 dark:text-zinc-500 ' +
      'flex items-center justify-center h-full">No category data</p>';
    return;
  }

  var palette = ['#0053e2','#ffc220','#2a8703','#ea1100','#6366f1','#f59e0b',
                 '#10b981','#ef4444','#8b5cf6','#06b6d4'];
  var labels = cats.map(function(c){ return c.category; });
  var data   = cats.map(function(c){ return c.monthly_total; });
  var colors = labels.map(function(_,i){ return palette[i % palette.length]; });

  _subsChartDonut = new Chart(canvas, {
    type: 'doughnut',
    data: {labels: labels, datasets: [{data: data, backgroundColor: colors, borderWidth: 1}]},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {position: 'right', labels: {boxWidth: 10, font: {size: 10}}},
        tooltip: {callbacks: {label: function(ctx) {
          return ' ' + ctx.label + ': $' + Number(ctx.raw).toFixed(2) + '/mo';
        }}}
      }
    }
  });
}

function _subsRenderBar() {
  var canvas = document.getElementById('subs-bar-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_subsChartBar) { _subsChartBar.destroy(); _subsChartBar = null; }

  var active = _subsData.filter(function(s){ return s.active; });
  active.sort(function(a,b){ return (b.monthly_equiv||0) - (a.monthly_equiv||0); });
  var top = active.slice(0, 12);

  if (top.length === 0) {
    canvas.parentElement.innerHTML = '<p class="text-xs text-gray-400 dark:text-zinc-500 ' +
      'flex items-center justify-center h-full">No active subscriptions</p>';
    return;
  }

  var labels = top.map(function(s){ return s.name; });
  var data   = top.map(function(s){ return s.monthly_equiv || 0; });
  var colors = top.map(function(s){ return s.color || '#0053e2'; });

  _subsChartBar = new Chart(canvas, {
    type: 'bar',
    data: {labels: labels, datasets: [{
      data: data, backgroundColor: colors, borderRadius: 4, borderSkipped: false
    }]},
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {display: false},
        tooltip: {callbacks: {label: function(ctx) {
          return ' $' + Number(ctx.raw).toFixed(2) + '/mo';
        }}}
      },
      scales: {
        x: {ticks: {font: {size: 10}}, grid: {color: 'rgba(0,0,0,0.05)'}},
        y: {ticks: {font: {size: 10}}}
      }
    }
  });
}

// ── Upcoming renewals ──────────────────────────────────────────────────────────

function _subsRenderUpcoming() {
  var el = document.getElementById('subs-upcoming');
  if (!el) return;
  var upcoming = (_subsSummary.upcoming || []);
  if (upcoming.length === 0) {
    el.innerHTML = '';
    return;
  }
  var rows = upcoming.map(function(u) {
    var d = u.days_until;
    var dLabel = d === null ? '—' : d < 0 ? 'Overdue' : d === 0 ? 'Today' : 'In ' + d + ' days';
    var dColor = (d !== null && d <= 7) ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-zinc-400';
    return '<div class="flex items-center gap-3 py-2 border-b border-gray-50 dark:border-zinc-800">' +
      '<span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:' + _subsEsc(u.color||'#0053e2') + '"></span>' +
      '<span class="text-sm text-gray-800 dark:text-zinc-100 flex-1 truncate">' + _subsEsc(u.name) + '</span>' +
      '<span class="text-xs text-gray-400 dark:text-zinc-500 whitespace-nowrap">' +
        _subsEsc(u.next_payment_date || '') +
      '</span>' +
      '<span class="text-xs font-medium whitespace-nowrap ' + dColor + '">' + _subsEsc(dLabel) + '</span>' +
    '</div>';
  }).join('');

  el.innerHTML = '<div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 ' +
    'dark:border-zinc-800 shadow-sm p-4">' +
    '<p class="text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-2">⏰ Upcoming Renewals</p>' +
    rows +
    '</div>';
}

// ── Add / Edit modal ───────────────────────────────────────────────────────────

function subsOpenAddModal() {
  _subsEditingId = 0;
  var title = document.getElementById('subs-modal-title');
  if (title) title.textContent = 'Add Subscription';
  _subsRenderModalForm(null);
  _subsShowModal();
}

function _subsEdit(id) {
  var sub = null;
  for (var i = 0; i < _subsData.length; i++) {
    if (_subsData[i].id === id) { sub = _subsData[i]; break; }
  }
  if (!sub) return;
  _subsEditingId = id;
  var title = document.getElementById('subs-modal-title');
  if (title) title.textContent = 'Edit Subscription';
  _subsRenderModalForm(sub);
  _subsShowModal();
}

function _subsShowModal() {
  var m = document.getElementById('subs-modal');
  if (m) { m.classList.remove('hidden'); }
  var err = document.getElementById('subs-modal-error');
  if (err) err.classList.add('hidden');
}

function subsCloseModal() {
  var m = document.getElementById('subs-modal');
  if (m) m.classList.add('hidden');
  _subsEditingId = 0;
}

function _subsRenderModalForm(sub) {
  var container = document.getElementById('subs-modal-form');
  if (!container) return;

  var v = sub || {};
  var cycleOpts = _SUBS_CYCLES.map(function(c) {
    return '<option value="' + c.v + '"' + ((v.cycle||3) === c.v ? ' selected':'') + '>' + c.l + '</option>';
  }).join('');
  var currOpts = _SUBS_CURRENCIES.map(function(c) {
    return '<option value="' + c + '"' + ((v.currency||'USD') === c ? ' selected':'') + '>' + c + '</option>';
  }).join('');
  var activeChk = (v.active === undefined || v.active) ? ' checked' : '';

  container.innerHTML =
    _subsField('Name', '<input id="sf-name" type="text" value="' + _subsEscAttr(v.name||'') + '" ' +
      'class="' + _subsCls() + '" placeholder="e.g. Netflix" maxlength="120">') +
    '<div class="grid grid-cols-2 gap-3">' +
      _subsField('Amount', '<input id="sf-amount" type="number" min="0" step="0.01" ' +
        'value="' + (v.amount||0) + '" class="' + _subsCls() + '">') +
      _subsField('Currency', '<select id="sf-currency" class="' + _subsCls() + '">' + currOpts + '</select>') +
    '</div>' +
    '<div class="grid grid-cols-2 gap-3">' +
      _subsField('Billing Cycle', '<select id="sf-cycle" class="' + _subsCls() + '">' + cycleOpts + '</select>') +
      _subsField('Frequency', '<input id="sf-frequency" type="number" min="1" step="1" ' +
        'value="' + (v.frequency||1) + '" class="' + _subsCls() + '">') +
    '</div>' +
    _subsField('Category', '<input id="sf-category" type="text" value="' + _subsEscAttr(v.category||'') + '" ' +
      'class="' + _subsCls() + '" placeholder="e.g. Entertainment" list="sf-cat-list" maxlength="80">' +
      _subsCatDatalist()) +
    '<div class="grid grid-cols-2 gap-3">' +
      _subsField('Color', '<input id="sf-color" type="color" value="' + _subsEscAttr(v.color||'#0053e2') + '" ' +
        'class="h-9 w-full cursor-pointer rounded-lg border border-gray-200 dark:border-zinc-700 p-0.5">') +
      _subsField('Next Payment Date', '<input id="sf-date" type="date" value="' + _subsEscAttr(v.next_payment_date||'') + '" ' +
        'class="' + _subsCls() + '">') +
    '</div>' +
    _subsField('Notes', '<textarea id="sf-notes" rows="2" class="' + _subsCls() + '" ' +
      'placeholder="Optional notes">' + _subsEsc(v.notes||'') + '</textarea>') +
    (sub ? '<label class="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-200">' +
      '<input id="sf-active" type="checkbox"' + activeChk + ' class="rounded"> Active</label>' : '');
}

function _subsCatDatalist() {
  var cats = {};
  _subsData.forEach(function(s){ if (s.category) cats[s.category] = 1; });
  var opts = Object.keys(cats).map(function(c){ return '<option value="' + _subsEscAttr(c) + '">'; }).join('');
  return '<datalist id="sf-cat-list">' + opts + '</datalist>';
}

function _subsField(label, input) {
  return '<div class="flex flex-col gap-1">' +
    '<label class="text-xs font-medium text-gray-600 dark:text-zinc-400">' + _subsEsc(label) + '</label>' +
    input + '</div>';
}

function _subsCls() {
  return 'w-full rounded-lg border border-gray-200 dark:border-zinc-700 px-3 py-2 ' +
    'text-sm bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 ' +
    'focus:outline-none focus:ring-2 focus:ring-[#0053e2]/40';
}

function _subsSubmitForm() {
  var name     = (document.getElementById('sf-name')        || {}).value || '';
  var websiteUrl= (document.getElementById('sf-website-url') || {}).value || '';
  var amount   = parseFloat((document.getElementById('sf-amount')   || {}).value || '0') || 0;
  var currency = (document.getElementById('sf-currency') || {}).value || 'USD';
  var cycle    = parseInt((document.getElementById('sf-cycle')      || {}).value || '3', 10);
  var frequency= parseInt((document.getElementById('sf-frequency')  || {}).value || '1', 10);
  var category = (document.getElementById('sf-category') || {}).value || '';
  var color    = (document.getElementById('sf-color')    || {}).value || '#0053e2';
  var date     = (document.getElementById('sf-date')     || {}).value || '';
  var notes    = (document.getElementById('sf-notes')    || {}).value || '';
  var activeEl = document.getElementById('sf-active');
  var active   = activeEl ? (activeEl.checked ? 1 : 0) : 1;

  if (!name.trim()) {
    _subsShowModalError('Name is required.');
    return;
  }

  var fd = new FormData();
  fd.append('name',              name.trim());
  fd.append('website_url',       websiteUrl.trim());
  fd.append('amount',            amount);
  fd.append('currency',          currency);
  fd.append('cycle',             cycle);
  fd.append('frequency',         Math.max(1, frequency));
  fd.append('category',          category.trim());
  fd.append('color',             color);
  fd.append('next_payment_date', date);
  fd.append('notes',             notes.trim());
  if (_subsEditingId) fd.append('active', active);

  var saveBtn = document.getElementById('subs-modal-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  var url, method;
  if (_subsEditingId) {
    url    = '/home/subscriptions/' + _subsPid + '/items/' + _subsEditingId;
    method = 'PUT';
  } else {
    url    = '/home/subscriptions/' + _subsPid + '/add';
    method = 'POST';
  }

  fetch(url, {method: method, body: fd})
    .then(function(r) { return r.json().then(function(j){ return {ok: r.ok, j: j}; }); })
    .then(function(res) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
      if (!res.ok) { _subsShowModalError(res.j.error || 'Save failed.'); return; }
      subsCloseModal();
      _subsLoadAll();
    })
    .catch(function(e) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
      _subsShowModalError('Network error. Please try again.');
      console.error('[subs] submit:', e);
    });
}

function _subsShowModalError(msg) {
  var el = document.getElementById('subs-modal-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── Delete ─────────────────────────────────────────────────────────────────────

function _subsDeletePrompt(id, name) {
  var modal  = document.getElementById('subs-del-modal');
  var body   = document.getElementById('subs-del-body');
  var confirm= document.getElementById('subs-del-confirm');
  if (!modal || !confirm) return;
  if (body) body.textContent = 'Delete "' + name + '"? This cannot be undone.';
  confirm.onclick = function() { _subsDeleteConfirmed(id); };
  modal.classList.remove('hidden');
}

function _subsDeleteConfirmed(id) {
  var modal = document.getElementById('subs-del-modal');
  if (modal) modal.classList.add('hidden');
  fetch('/home/subscriptions/' + _subsPid + '/items/' + id, {method: 'DELETE'})
    .then(function(r) { return r.json(); })
    .then(function() { _subsLoadAll(); })
    .catch(function(e) { console.error('[subs] delete:', e); });
}

// ── Escaping helpers ───────────────────────────────────────────────────────────

function _subsEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function _subsEscAttr(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
function _subsJsStr(s) {
  return String(s || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}
