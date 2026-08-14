/**
 * home-page-subscriptions.js
 * Wallos-inspired subscription tracker for BookWorm homespace pages.
 * Activated by _initSwappedPage() when #subs-page-root is in the DOM.
 *
 * Rules: ALL var — zero let/const (HTMX re-injection safety).
 * Chart.js: lazy-loaded from /static/js/vendor/chart.umd.min.js (bundled locally —
 * no CDN dependency, works on filtered networks and in Docker with no internet).
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
  'USD','EUR','GBP','JPY','VND','CAD','AUD','CHF',
  'SGD','HKD','MXN','BRL','INR','KRW','SEK','NOK'
];
var _SUBS_CYCLES = [
  {v:3,l:'Monthly'}, {v:4,l:'Yearly'},
  {v:2,l:'Weekly'},  {v:1,l:'Daily'}
];
var _SUBS_REMINDER_PRESETS = [
  {v:30,l:'1 month'}, {v:14,l:'14 days'}, {v:7,l:'7 days'},
  {v:3,l:'3 days'}, {v:1,l:'1 day'}, {v:0,l:'Due day'}
];

// ── Entry point ────────────────────────────────────────────────────────────────

function initSubsPage(pid) {
  _subsPid           = pid;
  _subsData          = [];
  _subsSummary       = {};
  _subsFilterActive  = 'all';
  _subsFilterCat     = '';
  _subsSearchTerm    = '';
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
    _subsRenderTopBarControls();
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
  if (el) el.textContent = on ? 'Loading\u2026' : '';
}

// ── Due-date reminder banner ────────────────────────────────────────────────────
// Shown when an active subscription is within its reminder window.
// Dismissals are stored in localStorage so we don’t nag on every page load.
function _subsCheckReminders() {
  var banner = document.getElementById('subs-reminder-banner');
  if (!banner) return;

  // Check which active subs have a reminder point active for the current due date.
  var due = _subsData.filter(function(s) {
    return s.active && _subsReminderTriggerOffset(s) !== null;
  });

  // Filter out dismissed, keyed by id + date + offset so later reminders can surface.
  var active = due.filter(function(s) {
    var off = _subsReminderTriggerOffset(s);
    var key = 'bw-subs-remind-' + _subsPid + '-' + s.id + '-' + (s.next_payment_date || '') + '-' + off;
    return !localStorage.getItem(key);
  });

  if (active.length === 0) { banner.innerHTML = ''; return; }

  var rows = active.map(function(s) {
    var d = s.days_until_due;
    var urgency = (d !== null && d <= 0)
      ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
      : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
    var textCol = (d !== null && d <= 0)
      ? 'text-red-700 dark:text-red-300'
      : 'text-amber-800 dark:text-amber-200';
    var dueTxt = (d === null || d === undefined) ? 'unknown'
      : (d < 0 ? Math.abs(d) + ' day' + (Math.abs(d) !== 1 ? 's' : '') + ' overdue'
      : d === 0 ? 'due today'
      : 'due in ' + d + ' day' + (d !== 1 ? 's' : ''));
    var off = _subsReminderTriggerOffset(s);
    var offTxt = off === null ? '' : ' · ' + _subsReminderLabel(off);
    var key = 'bw-subs-remind-' + _subsPid + '-' + s.id + '-' + (s.next_payment_date || '') + '-' + off;
    return '<div class="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 ' + urgency + '">' +
      '<span class="text-xs font-medium ' + textCol + '">\uD83D\uDD14 <strong>' + _subsEsc(s.name) + '</strong> is ' + _subsEsc(dueTxt) + _subsEsc(offTxt) + '</span>' +
      '<button onclick="_subsReminderDismiss(\'' + _subsEscAttr(key) + '\')" ' +
        'class="text-xs ' + textCol + ' opacity-60 hover:opacity-100 transition flex-shrink-0" ' +
        'title="Dismiss">\u00D7 Dismiss</button>' +
      '</div>';
  }).join('');

  banner.innerHTML = '<div class="flex flex-col gap-1 px-4 py-2 border-b border-gray-100 dark:border-zinc-800">' + rows + '</div>';
}

function _subsReminderDismiss(key) {
  localStorage.setItem(key, '1');
  _subsCheckReminders();
}

function _subsReminderOffsets(s) {
  var raw = s && s.reminder_offsets;
  var vals = [];
  if (Array.isArray(raw)) {
    raw.forEach(function(v) {
      var n = parseInt(v, 10);
      if (!isNaN(n) && n >= 0 && n <= 366) vals.push(n);
    });
  }
  if (!vals.length && s && s.reminder_days) {
    var legacy = parseInt(s.reminder_days, 10);
    if (!isNaN(legacy) && legacy >= 0 && legacy <= 366) vals.push(legacy);
  }
  vals = vals.filter(function(v, i, arr) { return arr.indexOf(v) === i; });
  vals.sort(function(a, b) { return b - a; });
  return vals;
}

function _subsReminderTriggerOffset(s) {
  var d = s ? s.days_until_due : null;
  if (d === null || d === undefined) return null;
  var offsets = _subsReminderOffsets(s);
  var eligible = offsets.filter(function(v) { return d <= v; });
  if (!eligible.length) return null;
  eligible.sort(function(a, b) { return a - b; });
  return eligible[0];
}

function _subsReminderLabel(days) {
  var n = parseInt(days, 10);
  if (isNaN(n)) return '';
  if (n === 0) return 'Due day';
  if (n === 1) return '1 day before';
  if (n === 30) return '1 month before';
  return n + ' days before';
}

function _subsReminderSummary(s) {
  var offsets = _subsReminderOffsets(s);
  if (!offsets.length) return '';
  return offsets.map(_subsReminderLabel).join(', ');
}

// ── Filter bar ─────────────────────────────────────────────────────────────────

function _subsRenderTopBarControls() {
  var el = document.getElementById('subs-topbar-controls');
  if (!el) return;

  var sortOpts = [
    {v:'name',   l:'Name'},
    {v:'amount', l:'Cost \u2193'},
    {v:'date',   l:'Due Soon'},
  ];
  var sortHtml =
    '<select onchange="_subsSetSort(this.value)"' +
    ' title="Sort by"' +
    ' class="text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5' +
    ' bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200' +
    ' focus:outline-none focus:ring-2 focus:ring-[#0053e2]/40">' +
    sortOpts.map(function(o) {
      return '<option value="' + o.v + '"' + (o.v === _subsSort ? ' selected' : '') + '>' + o.l + '</option>';
    }).join('') +
    '</select>';

  var exportHtml =
    '<button onclick="_subsExportCSV()"' +
    ' title="Export to CSV"' +
    ' class="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border' +
    ' border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300' +
    ' hover:border-[#0053e2] hover:text-[#0053e2] dark:hover:text-blue-400 transition' +
    ' bg-white dark:bg-zinc-800">\u2B07 CSV</button>';

  el.innerHTML =
    '<input type="search" id="subs-search-input"' +
    ' value="' + _subsEscAttr(_subsSearchTerm) + '"' +
    ' placeholder="\uD83D\uDD0D Search\u2026"' +
    ' oninput="_subsSetSearch(this.value)"' +
    ' class="text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2.5 py-1.5' +
    ' bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 w-36' +
    ' focus:outline-none focus:ring-2 focus:ring-[#0053e2]/40">' +
    sortHtml +
    exportHtml;
}

function _subsRenderFilterBar() {
  var bar = document.getElementById('subs-filter-bar');
  if (!bar) return;

  // Collect distinct categories from loaded data
  var cats = {};
  _subsData.forEach(function(s) { if (s.category) cats[s.category] = 1; });
  var catKeys = Object.keys(cats).sort();

  var counts = {
    all:      _subsData.length,
    active:   _subsData.filter(function(s){ return  s.active; }).length,
    inactive: _subsData.filter(function(s){ return !s.active; }).length,
  };
  var tabs = [
    {k:'all',     l:'All',      n: counts.all},
    {k:'active',  l:'Active',   n: counts.active},
    {k:'inactive',l:'Inactive', n: counts.inactive},
  ];
  var tabHtml = tabs.map(function(t) {
    var active = t.k === _subsFilterActive;
    return '<button onclick="_subsSetFilter(\'' + t.k + '\',_subsFilterCat)" ' +
      'class="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition ' +
      (active
        ? 'bg-[#0053e2] text-white'
        : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800') +
      '">' + _subsEsc(t.l) +
      '<span class="text-[10px] px-1 py-px rounded-full ' +
        (active ? 'bg-white/30 text-white' : 'bg-gray-100 dark:bg-zinc-700 text-gray-500 dark:text-zinc-400') +
        '">' + t.n + '</span>' +
      '</button>';
  }).join('');

  var catHtml = '';
  if (catKeys.length > 0) {
    catHtml = '<select onchange="_subsSetFilter(_subsFilterActive,this.value)" ' +
      'class="text-xs border border-gray-200 dark:border-zinc-700 ' +
      'rounded px-2 py-0.5 bg-white dark:bg-zinc-800 ' +
      'text-gray-700 dark:text-zinc-200">' +
      '<option value="">All categories</option>' +
      catKeys.map(function(c) {
        return '<option value="' + _subsEsc(c) + '"' +
          (c === _subsFilterCat ? ' selected' : '') + '>' + _subsEsc(c) + '</option>';
      }).join('') +
      '</select>';
  }

  // Add button lives in the filter bar so it stays visible
  var addBtn = '<button onclick="subsOpenAddModal()" ' +
    'class="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ' +
    'bg-[#0053e2] text-white hover:bg-[#0048c8] transition flex-shrink-0" ' +
    'aria-label="Add subscription">＋ Add</button>';

  bar.innerHTML = tabHtml + catHtml + addBtn;
}

function _subsSetFilter(active, cat) {
  _subsFilterActive = active;
  _subsFilterCat    = cat || '';
  _subsRenderFilterBar();
  _subsRenderList();
}

function _subsSetSearch(term) {
  _subsSearchTerm = (term || '').trim();
  _subsRenderList();
}

function _subsSetSort(key) {
  _subsSort = key || 'name';
  // Don't re-render topbar controls — the select already shows the new value
  // and re-rendering would reset the search input.
  _subsRenderList();
}

// ── CSV export ────────────────────────────────────────────────────────────────────
function _subsExportCSV() {
  var headers = ['Name','Amount','Currency','Cycle','Category','Color',
                 'Next Payment Date','Active','Monthly Equiv','Reminders','Website URL','Notes'];
  var cycleLabel = {1:'Daily',2:'Weekly',3:'Monthly',4:'Yearly'};
  var rows = _subsData.map(function(s) {
    return [
      s.name || '',
      (s.amount || 0).toFixed(2),
      s.currency || 'USD',
      cycleLabel[s.cycle] || 'Monthly',
      s.category || '',
      s.color || '',
      s.next_payment_date || '',
      s.active ? 'Yes' : 'No',
      (s.monthly_equiv || 0).toFixed(2),
      _subsReminderSummary(s),
      s.website_url || '',
      s.notes || '',
    ].map(function(v) {
      // CSV-encode: wrap in quotes if value contains comma, quote, or newline
      var str = String(v).replace(/"/g, '""');
      return /[,"\n]/.test(str) ? '"' + str + '"' : str;
    });
  });
  var csv = [headers].concat(rows).map(function(r) { return r.join(','); }).join('\r\n');
  var blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'subscriptions.csv';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ── Subscription list ──────────────────────────────────────────────────────────

function _subsApplyFilters(data) {
  var term = _subsSearchTerm.toLowerCase();
  return data.filter(function(s) {
    if (_subsFilterActive === 'active'   && !s.active) return false;
    if (_subsFilterActive === 'inactive' &&  s.active) return false;
    if (_subsFilterCat && s.category !== _subsFilterCat) return false;
    if (term && (s.name || '').toLowerCase().indexOf(term) === -1) return false;
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

  // Exit multiselect whenever the list is re-rendered (filter / sort change)
  if (typeof _subsMsExit === 'function') _subsMsExit();

  var filtered = _subsApplySort(_subsApplyFilters(_subsData));

  if (filtered.length === 0) {
    el.style.cssText = '';
    el.innerHTML = '<div class="p-6 text-center">' +
      '<p class="text-sm text-gray-400 dark:text-zinc-500">' +
      (_subsData.length === 0
        ? 'No subscriptions yet.<br>Click <strong>＋ Add</strong> in the filter bar to start.'
        : 'No subscriptions match the current filter.') +
      '</p></div>';
    return;
  }

  el.innerHTML = filtered.map(function(s) {
    return _subsCardHtml(s);
  }).join('');
  el.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));' +
    'gap:10px;padding:12px;align-content:start;';

  // Wire multiselect long-press after every render
  if (typeof _subsMsWire === 'function') _subsMsWire();
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

// ── Favicon preview helpers (used by the Add/Edit modal) ──────────────────────
var _subsAutoFillTimer = null;

// Live-update the favicon preview img as the user types in the URL field.
function _subsUpdateFaviconPreview(urlVal) {
  var img = document.getElementById('sf-favicon-preview');
  if (!img) return;
  var url = _subsGetFaviconUrl(urlVal);
  if (url) {
    img.src   = url;
    img.style.display = 'block';
  } else {
    img.style.display = 'none';
    img.src = '';
  }
}

// When the user types a Name, auto-suggest the website URL if the field is still empty.
// Uses a simple lookup of common services; fills in silently so user can override.
var _SUBS_KNOWN_DOMAINS = {
  'netflix': 'netflix.com',   'spotify': 'spotify.com',
  'youtube': 'youtube.com',   'hulu': 'hulu.com',
  'disney+': 'disneyplus.com','disney plus': 'disneyplus.com',
  'apple tv': 'tv.apple.com', 'apple music': 'music.apple.com',
  'amazon prime': 'amazon.com','prime video': 'amazon.com',
  'hbo': 'hbo.com',           'max': 'max.com',
  'peacock': 'peacocktv.com', 'paramount': 'paramountplus.com',
  'adobe': 'adobe.com',       'microsoft 365': 'microsoft.com',
  'office 365': 'microsoft.com','github': 'github.com',
  'dropbox': 'dropbox.com',   'google one': 'one.google.com',
  'icloud': 'icloud.com',     'notion': 'notion.so',
  'slack': 'slack.com',       'zoom': 'zoom.us',
  'chatgpt': 'openai.com',    'openai': 'openai.com',
  'canva': 'canva.com',       'figma': 'figma.com',
  'duolingo': 'duolingo.com', 'crunchyroll': 'crunchyroll.com',
  'funimation': 'funimation.com', 'twitch': 'twitch.tv',
  'nintendo': 'nintendo.com', 'playstation': 'playstation.com',
  'xbox': 'xbox.com',         'steam': 'store.steampowered.com',
  'nytimes': 'nytimes.com',   'new york times': 'nytimes.com',
  'washington post': 'washingtonpost.com',
  'patreon': 'patreon.com',   'substack': 'substack.com',
  'linkedin': 'linkedin.com', 'nord vpn': 'nordvpn.com',
  'nordvpn': 'nordvpn.com',   'expressvpn': 'expressvpn.com',
  'lastpass': 'lastpass.com', '1password': '1password.com',
  'bitwarden': 'bitwarden.com','dashlane': 'dashlane.com',
};

function _subsAutoFillUrl(name) {
  clearTimeout(_subsAutoFillTimer);
  _subsAutoFillTimer = setTimeout(function() {
    var urlField = document.getElementById('sf-website-url');
    if (!urlField || urlField.value.trim()) return; // don\'t overwrite what the user typed
    var key = name.trim().toLowerCase();
    var domain = _SUBS_KNOWN_DOMAINS[key];
    if (domain) {
      urlField.value = domain;
      _subsUpdateFaviconPreview(domain);
    }
  }, 600);
}

function _subsCardHtml(s) {
  var daysUntil = s.days_until_due;
  var badge = '';
  if (daysUntil !== null && daysUntil !== undefined) {
    if (daysUntil < 0) {
      badge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 ' +
        'dark:bg-red-900/40 dark:text-red-300 whitespace-nowrap">Overdue</span>';
    } else if (daysUntil <= 7) {
      badge = '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 ' +
        'dark:bg-red-900/40 dark:text-red-300 whitespace-nowrap">Due in ' + daysUntil + 'd</span>';
    } else if (daysUntil <= 30) {
      badge = '<span class="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 ' +
        'dark:bg-amber-900/40 dark:text-amber-300 whitespace-nowrap">Due in ' + daysUntil + 'd</span>';
    }
  }

  var inactive = !s.active;
  var color    = s.color || '#0053e2';
  var pct      = s.progress_pct || 0;
  var amtStr   = _subsEsc(s.currency) + ' ' + (s.amount || 0).toFixed(2);
  var moStr    = (s.currency === 'USD' ? '$' : s.currency + ' ') +
                 (s.monthly_equiv || 0).toFixed(2) + '/mo';
  var reminderSummary = _subsReminderSummary(s);

  var faviconUrl = _subsGetFaviconUrl(s.website_url || '');
  var iconHtml = faviconUrl
    ? '<img src="' + faviconUrl + '" width="28" height="28" alt=""' +
        ' style="border-radius:7px;flex-shrink:0;"' +
        ' onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\';">'
      + '<span style="display:none;width:28px;height:28px;border-radius:7px;flex-shrink:0;' +
        'background:' + color + ';color:#fff;font-size:13px;font-weight:700;' +
        'align-items:center;justify-content:center;">' +
        _subsEsc((s.name || '?').charAt(0).toUpperCase()) + '</span>'
    : '<span style="display:flex;width:28px;height:28px;border-radius:7px;flex-shrink:0;' +
        'background:' + color + ';color:#fff;font-size:13px;font-weight:700;' +
        'align-items:center;justify-content:center;">' +
        _subsEsc((s.name || '?').charAt(0).toUpperCase()) + '</span>';

  // Glow color for progress bar
  var glowStyle = 'box-shadow:0 0 6px 1px ' + color + '66;';

  return '<div class="group relative flex flex-col rounded-xl border ' +
    'bg-white dark:bg-zinc-900 border-gray-100 dark:border-zinc-800 ' +
    'shadow-sm overflow-hidden transition hover:shadow-md hover:-translate-y-0.5 ' +
    (inactive ? 'opacity-50 ' : '') + '" ' +
    'data-sub-id="' + s.id + '" ' +
    'style="border-top:3px solid ' + color + ';">' +
    // Circular checkbox overlay (hidden until multiselect mode activates)
    '<div class="subs-ms-cb" aria-hidden="true"><span class="subs-ms-cb-tick">✓</span></div>' +

    // Card body
    '<div class="flex flex-col gap-2 p-3">' +

      // Row 1: icon + name + amount
      '<div class="flex items-start gap-2 min-w-0">' +
        iconHtml +
        '<div class="flex-1 min-w-0">' +
          '<p class="text-sm font-semibold text-gray-800 dark:text-zinc-100 truncate leading-tight">' +
            _subsEsc(s.name) +
          '</p>' +
          '<p class="text-[10px] text-gray-400 dark:text-zinc-500">' +
            _subsEsc(s.cycle_label || '') +
          '</p>' +
        '</div>' +
        '<div class="text-right flex-shrink-0">' +
          '<p class="text-sm font-bold text-gray-800 dark:text-zinc-100">' + amtStr + '</p>' +
          '<p class="text-[10px] text-gray-400 dark:text-zinc-500">' + _subsEsc(moStr) + '</p>' +
        '</div>' +
      '</div>' +

      // Row 2: progress bar
      '<div class="h-1.5 rounded-full bg-gray-100 dark:bg-zinc-700 overflow-visible">' +
        '<div class="h-full rounded-full transition-all" ' +
          'style="width:' + pct + '%;background:' + color + ';' + glowStyle + '"></div>' +
      '</div>' +

      // Row 3: badge + action buttons
      '<div class="flex items-center justify-between gap-1">' +
        (badge || '<span class="text-[10px] text-gray-300 dark:text-zinc-600">' +
          (s.next_payment_date ? _subsEsc(s.next_payment_date) : 'No date') + '</span>') +
        '<div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">' +
          '<button onclick="_subsEdit(' + s.id + ')" ' +
            'class="p-1 rounded text-gray-400 hover:text-[#0053e2] hover:bg-blue-50 ' +
            'dark:hover:bg-blue-900/30 transition" ' +
            'aria-label="Edit ' + _subsEscAttr(s.name) + '">✏️</button>' +
          '<button onclick="_subsDeletePrompt(' + s.id + ',\'' + _subsJsStr(s.name) + '\')" ' +
            'class="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 ' +
            'dark:hover:bg-red-900/30 transition" ' +
            'aria-label="Delete ' + _subsEscAttr(s.name) + '">🗑️</button>' +
        '</div>' +
      '</div>' +
      (reminderSummary
        ? '<p class="text-[10px] text-gray-400 dark:text-zinc-500 truncate" title="' + _subsEscAttr(reminderSummary) + '">\uD83D\uDD14 ' + _subsEsc(reminderSummary) + '</p>'
        : '') +

    '</div>' +
  '</div>';
}


// ── Summary cards ────────────────────────────────────────────────────────────

// RAF counter: animates an element's text from 0 → target over ~700 ms.
function _subsAnimateCount(el, target, prefix, suffix, decimals) {
  var start = performance.now();
  var dur   = 700;
  function step(now) {
    var t   = Math.min((now - start) / dur, 1);
    var ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
    var val = target * ease;
    el.textContent = (prefix || '') + val.toFixed(decimals || 0) + (suffix || '');
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function _subsRenderSummaryCards() {
  var el = document.getElementById('subs-summary-cards');
  if (!el) return;
  var s = _subsSummary;
  var cards = [
    {label:'Monthly',  raw: s.monthly_total,   id:'subs-sc-mo',  prefix:'$', dec:2, topColor:'#0053e2', icon:'💳'},
    {label:'Yearly',   raw: s.yearly_total,    id:'subs-sc-yr',  prefix:'$', dec:2, topColor:'#6366f1', icon:'📆'},
    {label:'Active',   raw: null,              id:'subs-sc-act', prefix:'',  dec:0, topColor:'#2a8703', icon:'✅',
     text: (s.active_count || 0) + ' / ' + (s.total_count || 0)},
    {label:'Next Due', raw: null,              id:'subs-sc-due', prefix:'',  dec:0, topColor:'#f59e0b', icon:'⏰',
     text: _subsNextDueLabel(s.upcoming)},
  ];
  el.innerHTML = cards.map(function(c) {
    var valHtml = c.raw !== null && c.raw !== undefined
      ? '<p id="' + c.id + '" class="text-xl font-bold text-gray-900 dark:text-zinc-100 tabular-nums">'
          + c.prefix + '0.00</p>'
      : '<p id="' + c.id + '" class="text-xl font-bold text-gray-900 dark:text-zinc-100 truncate">' +
          _subsEsc(c.text || '—') + '</p>';
    return '<div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 ' +
      'dark:border-zinc-800 shadow-sm p-3 flex flex-col gap-1" ' +
      'style="border-top:3px solid ' + c.topColor + ';">' +
      '<div class="flex items-center gap-1.5">' +
        '<span aria-hidden="true" class="text-base">' + c.icon + '</span>' +
        '<span class="text-[11px] font-medium text-gray-500 dark:text-zinc-400">' + _subsEsc(c.label) + '</span>' +
      '</div>' +
      valHtml +
    '</div>';
  }).join('');
  // Animate money values
  var moEl = document.getElementById('subs-sc-mo');
  var yrEl = document.getElementById('subs-sc-yr');
  if (moEl && s.monthly_total != null) _subsAnimateCount(moEl, s.monthly_total, '$', '', 2);
  if (yrEl && s.yearly_total  != null) _subsAnimateCount(yrEl, s.yearly_total,  '$', '', 2);
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

// Long-press state for the upcoming renewals list
var _subsLpTimer  = null;
var _subsLpTarget = null;
var _subsLpStartX = 0;
var _subsLpStartY = 0;

function _subsUpcomingWireRow(row, u) {
  // Long-press: 500 ms hold reveals a "Mark as Paid" dismiss button.
  row.addEventListener('pointerdown', function(e) {
    _subsLpStartX = e.clientX;
    _subsLpStartY = e.clientY;
    _subsLpTarget = row;
    _subsLpTimer  = setTimeout(function() {
      _subsShowPaidPrompt(row, u);
    }, 500);
  });
  function _cancelLp() {
    if (_subsLpTimer) { clearTimeout(_subsLpTimer); _subsLpTimer = null; }
  }
  row.addEventListener('pointermove', function(e) {
    if (Math.abs(e.clientX - _subsLpStartX) > 8 ||
        Math.abs(e.clientY - _subsLpStartY) > 8) _cancelLp();
  });
  row.addEventListener('pointerup',     _cancelLp);
  row.addEventListener('pointercancel', _cancelLp);
}

function _subsShowPaidPrompt(row, u) {
  // Prevent duplicate prompts
  if (row.querySelector('.subs-paid-prompt')) return;

  // Dim the row text so the action stands out
  row.style.opacity = '0.7';

  var prompt = document.createElement('div');
  prompt.className = 'subs-paid-prompt';
  prompt.style.cssText = [
    'position:absolute;inset:0;display:flex;align-items:center;',
    'justify-content:flex-end;padding-right:6px;gap:6px;',
    'background:linear-gradient(90deg,transparent 0%,',
    'rgba(255,255,255,.92) 35%);',
    'dark-bg:transparent;border-radius:inherit;z-index:2;',
  ].join('');

  // Apply dark-mode gradient via class instead of inline
  if (document.documentElement.classList.contains('dark')) {
    prompt.style.background =
      'linear-gradient(90deg,transparent 0%,rgba(24,24,27,.94) 35%)';
  }

  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:4px;' +
    'border:1px solid #d1d5db;color:#6b7280;background:#fff;cursor:pointer;';

  var paidBtn = document.createElement('button');
  paidBtn.textContent = '✓ Paid';
  paidBtn.style.cssText = 'font-size:11px;padding:2px 10px;border-radius:4px;' +
    'background:#2a8703;color:#fff;border:none;cursor:pointer;font-weight:600;';

  prompt.appendChild(paidBtn);
  prompt.appendChild(cancelBtn);

  // Make sure the row is position:relative for the absolute overlay
  row.style.position = 'relative';
  row.appendChild(prompt);

  cancelBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    row.style.opacity = '';
    prompt.remove();
  });

  paidBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    _subsClearRenewal(row, u);
  });
}

function _subsClearRenewal(row, u) {
  // Optimistically fade + shrink the row out, then call the API
  row.style.transition = 'opacity .3s, max-height .35s, padding .35s';
  row.style.maxHeight   = row.offsetHeight + 'px';
  row.style.overflow    = 'hidden';
  requestAnimationFrame(function() {
    row.style.opacity   = '0';
    row.style.maxHeight = '0';
    row.style.padding   = '0';
  });

  setTimeout(function() { row.remove(); }, 380);

  fetch('/home/subscriptions/' + _subsPid + '/items/' + u.id + '/clear', {
    method: 'PATCH',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  }).then(function(r) {
    if (!r.ok) console.warn('[subs] clear failed', r.status);
    // Refresh summary + re-render upcoming so the auto-advanced date appears
    return fetch('/home/subscriptions/' + _subsPid + '/summary')
      .then(function(r2) { return r2.json(); })
      .then(function(data) {
        _subsSummary = data;
        _subsRenderUpcoming();
      });
  }).catch(function(err) {
    console.error('[subs] clear error', err);
  });
}

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
    return '<div class="flex items-center gap-3 py-2 border-b border-gray-50 dark:border-zinc-800 select-none" data-sub-id="' + u.id + '">' +
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
    '<p class="text-[10px] text-gray-400 dark:text-zinc-600 mb-3 -mt-1">' +
    'Hold an item to mark it as paid</p>' +
    rows +
    '</div>';

  // Wire long-press on every rendered row
  var container = el.firstElementChild;
  upcoming.forEach(function(u) {
    var row = container.querySelector('[data-sub-id="' + u.id + '"]');
    if (row) _subsUpcomingWireRow(row, u);
  });
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
  var reminderOffsets = _subsReminderOffsets(v);

  container.innerHTML =
    _subsField('Name', '<input id="sf-name" type="text" value="' + _subsEscAttr(v.name||'') + '" ' +
      'class="' + _subsCls() + '" placeholder="e.g. Netflix" maxlength="120"' +
      ' oninput="_subsAutoFillUrl(this.value)">') +
    _subsField('Website URL',
      '<div class="flex items-center gap-2">' +
        '<img id="sf-favicon-preview" src="" alt="" width="20" height="20"' +
          ' style="border-radius:4px;flex-shrink:0;display:' + (v.website_url ? 'block' : 'none') + ';"' +
          ' onerror="this.style.display=\'none\'">' +
        '<input id="sf-website-url" type="text" value="' + _subsEscAttr(v.website_url||'') + '" ' +
          'class="' + _subsCls() + '" placeholder="e.g. netflix.com" maxlength="255"' +
          ' oninput="_subsUpdateFaviconPreview(this.value)">' +
      '</div>') +
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
    _subsField('Color', '<input id="sf-color" type="color" value="' + _subsEscAttr(v.color||'#0053e2') + '" ' +
      'class="h-9 w-full cursor-pointer rounded-lg border border-gray-200 dark:border-zinc-700 p-0.5">') +
    '<div class="grid grid-cols-2 gap-3">' +
      _subsField('Start Date', '<input id="sf-start-date" type="date" value="' + _subsEscAttr(v.start_date||'') + '" ' +
        'class="' + _subsCls() + '">') +
      _subsField('Next Payment Date', '<input id="sf-date" type="date" value="' + _subsEscAttr(v.next_payment_date||'') + '" ' +
        'class="' + _subsCls() + '">') +
    '</div>' +
    _subsField('Notes', '<textarea id="sf-notes" rows="2" class="' + _subsCls() + '" ' +
      'placeholder="Optional notes">' + _subsEsc(v.notes||'') + '</textarea>') +
    _subsField('Remind me before due date',
      '<input id="sf-reminder-offsets-json" type="hidden" value="' + _subsEscAttr(JSON.stringify(reminderOffsets)) + '">' +
      '<div id="sf-reminder-choices" class="flex flex-wrap gap-1.5"></div>' +
      '<div class="flex items-center gap-2 mt-2">' +
        '<input id="sf-reminder-custom" type="number" min="0" max="366" step="1" ' +
          'class="' + _subsCls() + '" placeholder="Custom days">' +
        '<button type="button" onclick="_subsAddCustomReminder()" ' +
          'class="px-2.5 py-2 rounded-lg text-xs font-semibold border border-gray-200 dark:border-zinc-700 ' +
          'text-gray-600 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2] transition">Add</button>' +
      '</div>') +
    (sub ? '<label class="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-200">' +
      '<input id="sf-active" type="checkbox"' + activeChk + ' class="rounded"> Active</label>' : '');
  _subsRenderReminderChoices();
}

function _subsGetFormReminderOffsets() {
  var hidden = document.getElementById('sf-reminder-offsets-json');
  var vals = [];
  try {
    vals = JSON.parse((hidden && hidden.value) || '[]');
  } catch (e) {
    vals = [];
  }
  vals = Array.isArray(vals) ? vals : [];
  vals = vals.map(function(v) { return parseInt(v, 10); })
    .filter(function(v) { return !isNaN(v) && v >= 0 && v <= 366; });
  vals = vals.filter(function(v, i, arr) { return arr.indexOf(v) === i; });
  vals.sort(function(a, b) { return b - a; });
  return vals;
}

function _subsSetFormReminderOffsets(vals) {
  var hidden = document.getElementById('sf-reminder-offsets-json');
  if (!hidden) return;
  hidden.value = JSON.stringify(vals || []);
  _subsRenderReminderChoices();
}

function _subsRenderReminderChoices() {
  var wrap = document.getElementById('sf-reminder-choices');
  if (!wrap) return;
  var vals = _subsGetFormReminderOffsets();
  var map = {};
  vals.forEach(function(v) { map[v] = 1; });
  var all = _SUBS_REMINDER_PRESETS.slice();
  vals.forEach(function(v) {
    var exists = all.some(function(p) { return p.v === v; });
    if (!exists) all.push({v:v,l:_subsReminderLabel(v)});
  });
  all.sort(function(a, b) { return b.v - a.v; });
  wrap.innerHTML = all.map(function(p) {
    var active = !!map[p.v];
    return '<button type="button" onclick="_subsToggleReminderOffset(' + p.v + ')" ' +
      'class="px-2 py-1 rounded-full border text-xs font-medium transition ' +
      (active
        ? 'bg-[#0053e2] border-[#0053e2] text-white'
        : 'border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:border-[#0053e2] hover:text-[#0053e2]') +
      '">' + _subsEsc(p.l) + '</button>';
  }).join('') || '<span class="text-xs text-gray-400">No reminders</span>';
}

function _subsToggleReminderOffset(days) {
  var vals = _subsGetFormReminderOffsets();
  var n = parseInt(days, 10);
  if (isNaN(n) || n < 0 || n > 366) return;
  var idx = vals.indexOf(n);
  if (idx >= 0) vals.splice(idx, 1);
  else vals.push(n);
  vals.sort(function(a, b) { return b - a; });
  _subsSetFormReminderOffsets(vals);
}

function _subsAddCustomReminder() {
  var input = document.getElementById('sf-reminder-custom');
  if (!input) return;
  var n = parseInt(input.value, 10);
  if (isNaN(n) || n < 0 || n > 366) {
    _subsShowModalError('Reminder must be between 0 and 366 days.');
    return;
  }
  var vals = _subsGetFormReminderOffsets();
  if (vals.indexOf(n) < 0) vals.push(n);
  vals.sort(function(a, b) { return b - a; });
  input.value = '';
  _subsSetFormReminderOffsets(vals);
  var err = document.getElementById('subs-modal-error');
  if (err) err.classList.add('hidden');
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
  var startDate= (document.getElementById('sf-start-date') || {}).value || '';
  var notes    = (document.getElementById('sf-notes')    || {}).value || '';
  var activeEl = document.getElementById('sf-active');
  var active   = activeEl ? (activeEl.checked ? 1 : 0) : 1;
  var reminderOffsets = _subsGetFormReminderOffsets();
  var reminderDays = reminderOffsets.length ? reminderOffsets[0] : 0;

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
  fd.append('start_date',        startDate);
  fd.append('notes',             notes.trim());
  fd.append('reminder_days',     reminderDays);
  fd.append('reminder_offsets_json', JSON.stringify(reminderOffsets));
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
