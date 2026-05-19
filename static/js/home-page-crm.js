/* home-page-crm.js — CRM Homespace page (BookWorm).
   Activated by _initSwappedPage() when #crm-page-root is in the DOM.
   APIs:
     GET  /home/crm/{pid}/contacts
     POST /home/crm/{pid}/contacts/add
     POST /home/crm/{pid}/contacts/{id}/update
     POST /home/crm/{pid}/contacts/{id}/delete
     POST /home/crm/{pid}/contacts/{id}/field-value
     GET  /home/crm/{pid}/fields
     POST /home/crm/{pid}/fields/add
     POST /home/crm/{pid}/fields/{id}/update
     POST /home/crm/{pid}/fields/{id}/delete
*/
'use strict';

// ── Module state (var — safe for repeated _initSwappedPage calls) ──────────────
var _crmPid      = null;
var _crmContacts = [];
var _crmFields   = [];
var _crmStages   = [];
var _crmDeals    = [];
var _crmProjects = [];
var _crmView         = 'table';   // 'table' | 'gallery' | 'pipeline' | 'calendar' | 'detail'
var _crmGalleryStyle = 'cards';   // 'cards' | 'compact' | 'profile' | 'minimal'
var _crmQuery    = '';

// Calendar state (owned by home-page-crm-calendar.js, declared here for reset)
var _crmAllReminders       = [];
var _crmCalRemindersLoaded = false;
var _crmCalYear            = null;
var _crmCalMonth           = null;
var _crmCalSelDay          = null;

// Detail view state (owned by home-page-crm-detail.js)
var _crmDetailContactId = null;
var _crmPrevView        = 'table';

// Bulk selection state (owned by home-page-crm-bulk.js)
var _crmBulkMode = false;
var _crmSelected = new Set();

// Duplicate detection
var _crmDupOverride = false;

// ── Entry point ───────────────────────────────────────────────────────────────
function initCrmPage(pid) {
  _crmPid  = pid;
  _crmView         = localStorage.getItem('bw_crm_view')   || 'table';
  _crmGalleryStyle  = localStorage.getItem('bw_crm_gstyle') || 'cards';
  _crmQuery = '';
  // Reset calendar state on every HTMX re-nav (reminders lazy-reload per session)
  _crmAllReminders       = [];
  _crmCalRemindersLoaded = false;
  _crmCalYear   = null;
  _crmCalMonth  = null;
  _crmCalSelDay = null;
  // Reset detail + bulk state
  _crmDetailContactId = null;
  _crmPrevView        = 'table';
  _crmBulkMode        = false;
  _crmSelected        = new Set();
  _crmDupOverride     = false;
  _crmProjects        = [];
  _crmBudWidgets      = null; // reset so it re-fetches if user changes page
  if (typeof _crmColPrefsLoaded !== 'undefined') _crmColPrefsLoaded = false; // reset on nav
  if (typeof _crmLoadColPrefs  === 'function')   _crmLoadColPrefs(pid);
  const s = document.getElementById('crm-search');
  if (s) s.value = '';
  _crmRenderViewToggle();
  // Buds health badge map — async, re-renders when ready
  window._crmBudHealthMap = {};
  fetch('/home/buds/crm-lookup/' + pid, {credentials:'same-origin'})
    .then(function(r){ return r.ok ? r.json() : {}; })
    .then(function(map){ window._crmBudHealthMap = map || {}; _crmRender(); })
    .catch(function(){ window._crmBudHealthMap = {}; });
  _crmLoadAll();
  if (typeof _crmInitLongPress   === 'function') _crmInitLongPress();
  if (typeof initCrmRemindersPolling === 'function') initCrmRemindersPolling();
}

async function _crmLoadAll() {
  _crmSetMain('<p class="text-sm text-gray-400 dark:text-zinc-500 text-center mt-12">Loading…</p>');

  // allSettled so one flaky endpoint never kills the whole page.
  // Each entry: { label, fallback, promise }
  var _fetches = [
    { label: 'contacts', fallback: [], promise: _crmFetch(`/home/crm/${_crmPid}/contacts`) },
    { label: 'fields',   fallback: [], promise: _crmFetch(`/home/crm/${_crmPid}/fields`)   },
    { label: 'stages',   fallback: [], promise: _crmFetch(`/home/crm/${_crmPid}/stages`)   },
    { label: 'deals',    fallback: [], promise: _crmFetch(`/home/crm/${_crmPid}/deals`)    },
    { label: 'projects', fallback: [], promise: _crmFetch(`/home/crm/${_crmPid}/projects`) },
  ];

  var results = await Promise.allSettled(_fetches.map(function(f){ return f.promise; }));

  var errors = [];
  var resolved = results.map(function(r, i) {
    if (r.status === 'fulfilled') return r.value;
    errors.push(_fetches[i].label + ': ' + r.reason.message);
    return _fetches[i].fallback;
  });

  _crmContacts = resolved[0];
  _crmFields   = resolved[1];
  _crmStages   = resolved[2];
  _crmDeals    = resolved[3];
  _crmProjects = resolved[4];

  if (errors.length && resolved[0].length === 0 && resolved[1].length === 0) {
    // All or most endpoints failed — show hard error
    _crmSetMain(`<p class="text-sm text-red-500 text-center mt-12">Failed to load (${_crmEsc(errors.join('; '))})</p>`);
    return;
  }
  if (errors.length) {
    // Partial failure — render anyway, surface a soft warning
    console.warn('[CRM] partial load errors:', errors);
  }
  _crmRender();
}

function _crmRender() {
  if (_crmView === 'pipeline') {
    const tb = document.getElementById('crm-toolbar');
    if (tb) tb.innerHTML = '';
    if (typeof initCrmPipeline === 'function')
      initCrmPipeline(_crmPid, _crmStages, _crmDeals, _crmContacts, _crmProjects);
    return;
  }
  if (_crmView === 'calendar') {
    const tb = document.getElementById('crm-toolbar');
    if (tb) tb.innerHTML = '';
    if (typeof _crmRenderCalendar === 'function') _crmRenderCalendar();
    return;
  }
  if (_crmView === 'detail') {
    const tb = document.getElementById('crm-toolbar');
    if (tb) tb.innerHTML = '';
    if (typeof _crmRenderDetail === 'function') _crmRenderDetail();
    return;
  }
  if (typeof crmRenderToolbar === 'function') crmRenderToolbar();
  _crmRenderViewToggle();
  _crmView === 'gallery' ? _crmRenderGallery() : _crmRenderTable();
  if (typeof _crmRenderBulkBar === 'function') _crmRenderBulkBar();
}

// ── View toggle ──────────────────────────────────────────────────────
// Mobile (<640 px): one icon button + stacked popup (view + gallery style).
// Desktop: the original select dropdowns. Select/bulk button removed
//          everywhere — long-press on any card activates multi-select.
function _crmRenderViewToggle() {
  const el = document.getElementById('crm-view-toggle');
  if (!el) return;

  const views = [
    ['table',    '☰', 'Table'],
    ['gallery',  '⊞', 'Gallery'],
    ['pipeline', '⬜', 'Pipeline'],
    ['calendar', '📅', 'Calendar'],
  ];
  const galStyles = [
    ['cards',   '⊟', 'Cards'],
    ['compact', '☰', 'Compact'],
    ['profile', '◉', 'Profile'],
    ['minimal', '⧡', 'Minimal'],
    ['photo',   '◼', 'Photo'],
  ];

  const isMobile = window.innerWidth < 640;

  if (isMobile) {
    // ── Mobile: icon button + floating popup ─────────────────────────
    const cur    = views.find(function(v){ return v[0] === _crmView; }) || views[0];
    const popId  = 'crm-view-popup';
    const base   = 'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg text-left transition ';
    const on     = 'bg-[#0053e2]/10 text-[#0053e2] dark:text-blue-400 font-semibold';
    const off    = 'text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800';
    const chk    = '<span class="ml-auto text-[#0053e2]">✓</span>';

    const viewRows = views.map(function(v) {
      const a = _crmView === v[0];
      return '<button onclick="crmSetView(\'' + v[0] + '\')" class="' + base + (a ? on : off) + '">'
           + '<span>' + v[1] + '</span><span>' + v[2] + '</span>' + (a ? chk : '') + '</button>';
    }).join('');

    const galRows = _crmView === 'gallery'
      ? '<div class="mt-1 pt-1 border-t border-gray-100 dark:border-zinc-700">'
        + '<div class="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">Style</div>'
        + galStyles.map(function(s) {
            const a = _crmGalleryStyle === s[0];
            return '<button onclick="crmSetGalleryStyle(\'' + s[0] + '\')" class="' + base + (a ? on : off) + '">'
                 + '<span>' + s[1] + '</span><span>' + s[2] + '</span>' + (a ? chk : '') + '</button>';
          }).join('') + '</div>'
      : '';

    el.innerHTML =
      '<div class="relative">'
      + '<button onclick="crmToggleViewPopup()" aria-haspopup="true" title="View options"'
      + ' class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border'
      + ' border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-200'
      + ' text-xs font-medium transition hover:border-[#0053e2] hover:text-[#0053e2]">'
      + cur[1]
      + '<svg class="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">'
      + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>'
      + '</button>'
      + '<div id="' + popId + '" class="hidden absolute right-0 top-full mt-1 w-44'
      + ' bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700'
      + ' rounded-xl shadow-xl z-50 py-1 overflow-hidden">' + viewRows + galRows + '</div>'
      + '</div>';
  } else {
    // ── Desktop: original select dropdowns ───────────────────────────
    const opts = views.map(function(v) {
      return '<option value="' + v[0] + '" ' + (_crmView === v[0] ? 'selected' : '') + '>' + v[2] + '</option>';
    }).join('');
    const galPicker = _crmView === 'gallery'
      ? '<select onchange="crmSetGalleryStyle(this.value)"'
        + ' class="text-[11px] px-2 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-600'
        + ' bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200'
        + ' focus:outline-none focus:ring-1 focus:ring-[#0053e2] cursor-pointer">'
        + galStyles.map(function(s) {
            return '<option value="' + s[0] + '" ' + (_crmGalleryStyle === s[0] ? 'selected' : '') + '>' + s[2] + '</option>';
          }).join('') + '</select>'
      : '';
    el.innerHTML =
      '<select onchange="crmSetView(this.value)"'
      + ' class="text-[11px] px-2 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-600'
      + ' bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200'
      + ' focus:outline-none focus:ring-1 focus:ring-[#0053e2] cursor-pointer">'
      + opts + '</select>' + (galPicker ? ' ' + galPicker : '');
  }
}

// Toggle the mobile view popup. Global so inline onclick can reach it.
window.crmToggleViewPopup = function() {
  var p = document.getElementById('crm-view-popup');
  if (!p) return;
  var nowOpen = !p.classList.toggle('hidden');
  if (nowOpen) {
    // Close on next outside-click (one-shot).
    setTimeout(function() {
      function _outsideClose(e) {
        var pop = document.getElementById('crm-view-popup');
        if (!pop) { document.removeEventListener('click', _outsideClose); return; }
        var toggle = document.getElementById('crm-view-toggle');
        if (toggle && !toggle.contains(e.target)) {
          pop.classList.add('hidden');
          document.removeEventListener('click', _outsideClose);
        }
      }
      document.addEventListener('click', _outsideClose);
    }, 0);
  }
};

function crmSetView(v) {
  // Exit bulk mode when switching to views that don't support it
  if (v === 'pipeline' || v === 'calendar') {
    _crmBulkMode = false;
    _crmSelected = new Set();
  }
  _crmView = v;
  localStorage.setItem('bw_crm_view', v);
  _crmRenderViewToggle();
  _crmRender();
}

function crmSearch() {
  const s = document.getElementById('crm-search');
  _crmQuery = s ? s.value.trim().toLowerCase() : '';
  _crmRender();
}

// ── Table view ───────────────────────────────────────────────────────────────────
function _crmRenderTable() {
  if (typeof _crmLoadColPrefs === 'function') _crmLoadColPrefs(_crmPid);
  const cols = (typeof _crmCols === 'function') ? _crmCols() : [];
  const rows = _crmFiltered();
  const tdCls = 'px-3 py-2 text-sm text-gray-700 dark:text-zinc-200 whitespace-nowrap max-w-[200px] truncate';
  const widths = (typeof _crmColWidths !== 'undefined') ? _crmColWidths : {};

  const colgroup = `<colgroup>
    <col data-col="_avatar" style="width:${widths['_avatar']||40}px"/>
    ${cols.map(col => `<col data-col="${_crmEsc(col.id)}" style="width:${widths[col.id] ? widths[col.id]+'px' : 'auto'}"/>`).join('')}
    <col data-col="_actions" style="width:${widths['_actions']||72}px"/>
  </colgroup>`;

  const thCls = 'px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 select-none whitespace-nowrap relative';
  const rh    = '<span class="crm-rh absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-[#0053e2]/30 rounded"></span>';

  const thead = `<thead class="bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
    <tr>
      ${_crmBulkMode ? `<th class="${thCls} w-8">
        <input type="checkbox" title="Select all"
          onchange="this.checked ? crmBulkSelectAll() : crmBulkDeselectAll()"
          class="w-4 h-4 accent-[#0053e2] cursor-pointer"/>
      </th>` : '<th class="'+thCls+' w-10"></th>'}
      ${cols.map(col =>
        `<th class="${thCls}" data-col="${_crmEsc(col.id)}" draggable="true">
          ${_crmEsc(col.label)}
          ${rh}
        </th>`).join('')}
      <th class="${thCls} w-16"></th>
    </tr>
  </thead>`;

  const bodyRows = rows.length ? rows.map((c, i) => {
    const grpHdr = (typeof _crmGroupField === 'string' && _crmGroupField && typeof _crmGroupValue === 'function')
      ? (() => {
          const gC = _crmGroupValue(c, _crmGroupField);
          const gP = i > 0 ? _crmGroupValue(rows[i-1], _crmGroupField) : null;
          return gC !== gP
            ? `<tr><td colspan="${cols.length+2}" class="px-3 py-1 text-[11px] font-bold text-gray-400 dark:text-zinc-500 bg-gray-50 dark:bg-zinc-800/80 uppercase tracking-wider border-t border-gray-200 dark:border-zinc-700">${_crmEsc(gC||'—')}</td></tr>` : '';
        })()
      : '';

    const dataCells = cols.map(col => {
      if (col.id === 'name') return `<td class="${tdCls} font-semibold"><button onclick="crmOpenDetail(${c.id})" class="hover:text-[#0053e2] transition text-left">${_crmEsc(c.name||'—')}</button></td>`;
      if (col.id === 'company') return `<td class="${tdCls}">${_crmEsc(c.company||'')}</td>`;
      if (col.id === 'email')   return `<td class="${tdCls}"><a href="mailto:${_crmEsc(c.email||'')}" class="hover:text-[#0053e2]">${_crmEsc(c.email||'')}</a></td>`;
      if (col.id === 'phone')   return `<td class="${tdCls}">${_crmEsc(_crmPhone(c.phone||''))}</td>`;
      if (col.id === 'tags') {
        const tags = (c.tags||'').split(',').filter(Boolean).map(t =>
          `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 mr-0.5">${_crmEsc(t.trim())}</span>`
        ).join('');
        return `<td class="px-3 py-2 text-sm">${tags||'—'}</td>`;
      }
      // Custom field
      const f = col.fieldDef;
      return f ? `<td class="${tdCls}">${_crmFieldDisplay(f, c)}</td>` : `<td></td>`;
    }).join('');

    const _budTbl = (window._crmBudHealthMap||{})[String(c.id)];
    // Use server-computed tier (0=healthy,1=warn,2=wilting) — matches _health_tier() thresholds exactly.
    const _budDotColor = _budTbl ? (_budTbl.tier===0?'#2a8703':_budTbl.tier===1?'#ffc220':'#ea1100') : '';
    const _budDot  = _budTbl
      ? `<span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full
             border-2 border-white dark:border-zinc-900"
           style="background:${_budDotColor}"
           title="Bud HP ${_budTbl.health}"></span>`
      : '';
    const avatarCell = `<td class="px-3 py-2">
      <div class="relative inline-block">
        ${c.profile_pic
          ? `<img src="${_crmEsc(c.profile_pic)}" class="w-8 h-8 rounded-full object-cover" alt=""/>`
          : `<span class="text-xl leading-none">${_crmEsc(c.avatar_emoji||'👤')}</span>`}
        ${_budDot}
      </div></td>`;

    const chkCell = _crmBulkMode
      ? `<td class="px-2 py-2 w-8">
           <input type="checkbox" ${_crmSelected.has(c.id)?'checked':''}
             onchange="crmBulkToggle(${c.id},this.checked)"
             class="w-4 h-4 accent-[#0053e2] cursor-pointer"
             onclick="event.stopPropagation()"/>
         </td>` : '';
    const rowSel = _crmBulkMode && _crmSelected.has(c.id)
      ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-blue-50/40 dark:hover:bg-zinc-800/60';
    return grpHdr + `<tr data-cid="${c.id}"
      onclick="_crmBulkMode ? crmBulkToggle(${c.id}) : (event.target.closest('button,a') ? null : crmOpenDetail(${c.id}))"
      class="border-b border-gray-100 dark:border-zinc-800 transition cursor-pointer ${rowSel}">
      ${chkCell}${avatarCell}${dataCells}
      <td class="px-3 py-2 text-right whitespace-nowrap">
        <button onclick="event.stopPropagation();crmOpenDetail(${c.id})" title="View" class="text-gray-300 hover:text-[#0053e2] transition mr-1">👁️</button>
        <button onclick="event.stopPropagation();crmOpenEdit(${c.id})" title="Edit" class="text-gray-300 hover:text-[#0053e2] transition mr-1">✎</button>
        <button onclick="event.stopPropagation();_crmTrackAsBud(${c.id},${_crmEsc(JSON.stringify(c.name||''))})" title="Track as Bud" class="text-gray-300 hover:text-pink-500 transition mr-1">🌸</button>
        <button onclick="event.stopPropagation();crmDeleteContact(${c.id})" title="Delete" class="text-gray-300 hover:text-red-500 transition">✕</button>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="${cols.length + (_crmBulkMode?3:2)}" class="text-center text-sm text-gray-400 dark:text-zinc-500 py-12">
      ${_crmQuery ? 'No contacts match your search.' : 'No contacts yet — click <strong>+ Contact</strong> to add one.'}
    </td></tr>`;

  _crmSetMain(`
    <div class="overflow-x-auto rounded-xl border border-gray-200 dark:border-zinc-700">
      <table id="crm-table" class="w-full min-w-max bg-white dark:bg-zinc-900">
        ${colgroup}
        ${thead}
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <p class="mt-2 text-[11px] text-gray-400 dark:text-zinc-600 text-right">${rows.length} contact${rows.length !== 1 ? 's' : ''}</p>
  `);
  if (typeof initTableInteractions === 'function')
    initTableInteractions(document.getElementById('crm-table'));
}

function _crmFiltered() {
  if (typeof _crmProcessed === 'function') return _crmProcessed();
  if (!_crmQuery) return _crmContacts;
  return _crmContacts.filter(c => {
    const hay = [c.name, c.email, c.phone, c.company, c.tags].join(' ').toLowerCase();
    return hay.includes(_crmQuery);
  });
}

// ── Text-field textarea: auto-bullet on `- ` and auto-continue on Enter ──────
function _crmTextBulletKey(e) {
  // Space after a lone dash on an empty line → convert to `• `
  if (e.key === ' ') {
    var ta2  = e.target;
    var pos2 = ta2.selectionStart;
    if (ta2.selectionEnd !== pos2) return;
    var val2      = ta2.value;
    var ls2       = val2.lastIndexOf('\n', pos2 - 1) + 1;
    if (val2.substring(ls2, pos2) !== '-') return;
    e.preventDefault();
    ta2.value = val2.slice(0, ls2) + '\u2022 ' + val2.slice(pos2);
    ta2.setSelectionRange(ls2 + 2, ls2 + 2);
    ta2.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (e.key !== 'Enter') return;
  var ta        = e.target;
  var pos       = ta.selectionStart;
  var val       = ta.value;
  // Find the start of the line the cursor is on
  var lineStart = val.lastIndexOf('\n', pos - 1) + 1;
  var line      = val.substring(lineStart, pos);
  // Only intercept when the current line begins with a bullet
  if (line.charAt(0) !== '\u2022') return;
  e.preventDefault();
  // Empty bullet line — pressing Enter escapes the list
  if (line.trimEnd() === '\u2022') {
    ta.value = val.substring(0, lineStart) + val.substring(pos);
    ta.selectionStart = ta.selectionEnd = lineStart;
  } else {
    // Non-empty bullet — insert a new bullet on the next line
    var ins = '\n\u2022 ';
    ta.value = val.substring(0, pos) + ins + val.substring(pos);
    ta.selectionStart = ta.selectionEnd = pos + ins.length;
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function _crmFieldDisplay(f, c) {
  const raw = String((c.field_values || {})[f.id] ?? '');
  if (f.field_type === 'checkbox')     return raw === '1' ? '✅' : '☐';
  if (f.field_type === 'number')       return _crmFmtNumber(raw);
  if (f.field_type === 'priority') {
    var n = parseInt(raw) || 0;
    var icon = f.options || '⭐';
    return n ? Array.from({length:n}, function(){ return icon; }).join('') : '—';
  }
  if (f.field_type === 'multi_select') {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length)
        return arr.map(v => `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 mr-0.5">${_crmEsc(v)}</span>`).join('');
    } catch {}
    return '';
  }
  if (f.field_type === 'file_links') {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length)
        return arr.map(url => `<a href="${_crmEsc(url)}" target="_blank" rel="noopener noreferrer" class="text-[#0053e2] hover:underline text-xs block truncate">${_crmEsc(url)}</a>`).join('');
    } catch {}
    return raw ? `<a href="${_crmEsc(raw)}" target="_blank" rel="noopener noreferrer" class="text-[#0053e2] hover:underline text-xs truncate">${_crmEsc(raw)}</a>` : '';
  }
  if (f.field_type === 'text' && raw.includes('\n')) {
    // Preserve line breaks in display — each line escaped individually
    return raw.split('\n').map(function(l){ return _crmEsc(l); }).join('<br>');
  }
  return _crmEsc(raw);
}

// ── Contact modal (add / edit) ────────────────────────────────────────────────
function crmOpenAdd() { _crmContactModal(null); }
function crmOpenEdit(id) {
  _crmContactModal(_crmContacts.find(c => c.id === id) || null);
}

function _crmContactModal(c) {
  const isEdit = !!c;
  const fv = c ? (c.field_values || {}) : {};

  // Bordered input — used for Tags and custom fields
  const inp = (name, val, type='text', placeholder='') =>
    `<input name="${name}" type="${type}" value="${_crmEsc(val||'')}" placeholder="${placeholder}"
      class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5
             text-sm bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
             placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>`;

  // Flat underline input — used for the 6 built-in default fields
  const flat = (name, val, type='text', placeholder='', extraAttrs='') =>
    `<input name="${name}" type="${type}" value="${_crmEsc(val||'')}" placeholder="${placeholder}" ${extraAttrs}
      class="w-full bg-transparent border-b border-gray-200 dark:border-zinc-700 px-0 py-1
             text-sm text-gray-800 dark:text-zinc-100 placeholder-gray-300 dark:placeholder-zinc-600
             focus:outline-none focus:border-[#0053e2] transition"/>`;

  const flatLbl = (text, required=false) =>
    `<label class="block text-[10px] font-semibold uppercase tracking-wider
                   text-gray-400 dark:text-zinc-500 mb-0.5">
       ${text}${required ? ' <span class="text-red-400">*</span>' : ''}
     </label>`;

  // Shared × delete button for custom fields
  const delFieldBtn = (fid) =>
    `<button type="button" onclick="crmModalDeleteField(${fid},${c?.id||0})"
       title="Remove field from all contacts"
       class="ml-auto text-gray-300 hover:text-red-500 transition text-xs leading-none flex-shrink-0">
       ×
     </button>`;

  // ── Drag-to-reorder state (scoped to this modal render) ──────────────────
  var _dragSrcId = null;

  // Row wrapper: drop target on the div, draggable ONLY on the ⠿ handle span.
  // Keeping draggable off the row div lets child inputs/labels receive clicks.
  const wrapDrag = (fieldId, innerHtml) =>
    `<div class="crm-cf-row flex items-start gap-1 group"
          data-field-id="${fieldId}"
          ondragover="crmCfDragOver(event)"
          ondragleave="crmCfDragLeave(event)"
          ondrop="crmCfDrop(event,${fieldId},${c?.id||0})"
          ondragend="crmCfDragEnd(event)">
       <span class="crm-cf-handle flex-shrink-0 cursor-grab text-gray-200 dark:text-zinc-700
                    group-hover:text-gray-400 dark:group-hover:text-zinc-500
                    select-none pt-1 text-base leading-none"
             draggable="true"
             title="Drag to reorder · Click to edit field"
             onclick="crmCfHandleClick(event,${fieldId})"
             ondragstart="crmCfDragStart(event,${fieldId})">⠿</span>
       <div class="flex-1 min-w-0">${innerHtml}</div>
       <button type="button" onclick="crmModalDeleteField(${fieldId},${c?.id||0})"
         title="Remove field from all contacts"
         class="flex-shrink-0 ml-1 text-gray-300 hover:text-red-500 transition
                text-xs leading-none pt-1">×</button>
     </div>`;

  const customFields = _crmFields.map(f => {
    const val = fv[f.id] || '';
    let control;
    if (f.field_type === 'checkbox') {
      return wrapDrag(f.id,
        `<div class="flex items-center gap-2">
          <span class="w-28 flex-shrink-0 text-xs font-medium text-gray-500 dark:text-zinc-400 truncate"
                title="${_crmEsc(f.label)}">${_crmEsc(f.label)}</span>
          <label class="relative flex items-center cursor-pointer shrink-0">
            <input type="checkbox" name="cf_${f.id}" value="1"
                   id="cf_chk_${f.id}" ${val==='1'?'checked':''}
                   class="sr-only peer"/>
            <div class="w-10 h-5 rounded-full bg-gray-200 dark:bg-zinc-600
                        peer-checked:bg-[#0053e2] transition-colors"></div>
            <div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow
                        transition-transform peer-checked:translate-x-5"></div>
          </label>
        </div>`);
    }
    if (f.field_type === 'multi_select') {
      var ms = []; try { ms = JSON.parse(val); } catch {}
      const opts = (f.options||'').split('|').filter(Boolean);
      const pills = opts.length
        ? opts.map(o =>
            `<label class="cursor-pointer">
               <input type="checkbox" name="cf_${f.id}" value="${_crmEsc(o)}"
                      ${ms.includes(o)?'checked':''} class="sr-only peer"/>
               <span class="inline-flex px-2.5 py-0.5 text-xs rounded-full transition-all
                            bg-gray-100 dark:bg-zinc-800
                            text-gray-500 dark:text-zinc-400
                            peer-checked:bg-blue-50 peer-checked:text-[#0053e2]
                            peer-checked:font-medium">
                 ${_crmEsc(o)}
               </span>
             </label>`).join('')
        : `<span class="text-xs text-amber-600 dark:text-amber-400">No options yet — go to ⚙️ Fields to add some.</span>`;
      return wrapDrag(f.id,
        `<div class="flex items-start gap-2">
          <span class="w-28 flex-shrink-0 text-xs font-medium text-gray-500 dark:text-zinc-400 truncate pt-0.5"
                title="${_crmEsc(f.label)}">${_crmEsc(f.label)}</span>
          <div class="flex flex-wrap gap-1.5">${pills}</div>
        </div>`);
    } else if (f.field_type === 'select') {
      const opts = (f.options||'').split('|').filter(Boolean);
      const pills = opts.length
        ? `<label class="cursor-pointer">
             <input type="radio" name="cf_${f.id}" value="" ${!val?'checked':''} class="sr-only peer"/>
             <span class="inline-flex px-2.5 py-0.5 text-xs rounded-full transition-all
                          bg-gray-100 dark:bg-zinc-800
                          text-gray-500 dark:text-zinc-400
                          peer-checked:bg-blue-50 peer-checked:text-[#0053e2]
                          peer-checked:font-medium">None</span>
           </label>` +
          opts.map(o =>
            `<label class="cursor-pointer">
               <input type="radio" name="cf_${f.id}" value="${_crmEsc(o)}"
                      ${o===val?'checked':''} class="sr-only peer"/>
               <span class="inline-flex px-2.5 py-0.5 text-xs rounded-full transition-all
                            bg-gray-100 dark:bg-zinc-800
                            text-gray-500 dark:text-zinc-400
                            peer-checked:bg-blue-50 peer-checked:text-[#0053e2]
                            peer-checked:font-medium">
                 ${_crmEsc(o)}
               </span>
             </label>`).join('')
        : `<span class="text-xs text-amber-600 dark:text-amber-400">No options yet — go to ⚙️ Fields to add some.</span>`;
      return wrapDrag(f.id,
        `<div class="flex items-start gap-2">
          <span class="w-28 flex-shrink-0 text-xs font-medium text-gray-500 dark:text-zinc-400 truncate pt-0.5"
                title="${_crmEsc(f.label)}">${_crmEsc(f.label)}</span>
          <div class="flex flex-wrap gap-1.5">${pills}</div>
        </div>`);
    } else if (f.field_type === 'file_links') {
      var fl = []; try { fl = JSON.parse(val); } catch {}
      control = `<textarea name="cf_${f.id}" rows="2" placeholder="One URL per line"
        class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               focus:outline-none focus:ring-1 focus:ring-[#0053e2]">${_crmEsc(fl.join('\n'))}</textarea>`;
    } else if (f.field_type === 'priority') {
      var icon = f.options || '⭐';
      var priVal = parseInt(val) || 0;
      control = '<input type="hidden" name="cf_' + f.id + '" id="cf_pri_' + f.id + '" value="' + priVal + '"/>' +
        '<div class="flex gap-0.5 mt-0.5">' +
        [1,2,3,4,5].map(function(i) {
          return '<button type="button"' +
            ' data-pri-field="' + f.id + '" data-pri-val="' + i + '"' +
            ' onclick="crmSetFieldPriority(' + f.id + ',' + i + ')"' +
            ' style="font-size:1.5rem;line-height:1;background:none;border:none;cursor:pointer;' +
              'padding:0 1px;opacity:' + (i <= priVal ? '1' : '0.2') + ';transition:opacity .15s">' +
            icon + '</button>';
        }).join('') +
        '</div>';
    } else if (f.field_type === 'date') {
      return wrapDrag(f.id,
        `<div>
          <div class="flex items-center gap-2">
            <span class="w-28 flex-shrink-0 text-xs font-medium text-gray-500 dark:text-zinc-400 truncate"
                  title="${_crmEsc(f.label)}">${_crmEsc(f.label)}</span>
            <input name="cf_${f.id}" type="date" value="${_crmEsc(val)}"
              class="flex-1 bg-transparent border-b border-gray-200 dark:border-zinc-700
                     text-sm text-gray-800 dark:text-zinc-100 px-0 py-0.5
                     focus:outline-none focus:border-[#0053e2] transition"/>
            ${isEdit ? `<span id="crm-rem-btn-${f.id}" class="flex-shrink-0"></span>` : ''}
          </div>
          ${isEdit ? `<div id="crm-rem-${f.id}" class="mt-1"></div>` : ''}
        </div>`);
    } else if (f.field_type === 'text') {
      control = `<textarea name="cf_${f.id}" rows="3"
        onkeydown="_crmTextBulletKey(event)"
        class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#0053e2]">${_crmEsc(val)}</textarea>`;
    } else if (f.field_type === 'number') {
      return wrapDrag(f.id,
        `<div class="flex items-center gap-2">
          <span class="w-28 flex-shrink-0 text-xs font-medium text-gray-500 dark:text-zinc-400 truncate"
                title="${_crmEsc(f.label)}">${_crmEsc(f.label)}</span>
          <input name="cf_${f.id}" type="text" value="${_crmEsc(_crmFmtNumber(val))}"
            onblur="crmFmtNumberInput(this)"
            class="flex-1 bg-transparent border-b border-gray-200 dark:border-zinc-700
                   text-sm text-gray-800 dark:text-zinc-100 px-0 py-0.5
                   placeholder-gray-300 dark:placeholder-zinc-600
                   focus:outline-none focus:border-[#0053e2] transition"/>
        </div>`);
    } else {
      var iType = {url:'url', email:'email'}[f.field_type] || 'text';
      return wrapDrag(f.id,
        `<div class="flex items-center gap-2">
          <span class="w-28 flex-shrink-0 text-xs font-medium text-gray-500 dark:text-zinc-400 truncate"
                title="${_crmEsc(f.label)}">${_crmEsc(f.label)}</span>
          <input name="cf_${f.id}" type="${iType}" value="${_crmEsc(val)}"
            class="flex-1 bg-transparent border-b border-gray-200 dark:border-zinc-700
                   text-sm text-gray-800 dark:text-zinc-100 px-0 py-0.5
                   placeholder-gray-300 dark:placeholder-zinc-600
                   focus:outline-none focus:border-[#0053e2] transition"/>
        </div>`);
    }
    return wrapDrag(f.id,
      `<div>
        <label class="text-xs font-medium text-gray-500 dark:text-zinc-400 block mb-1">${_crmEsc(f.label)}</label>
        ${control}
      </div>`);
  }).join('');

  const body = `
    <div class="h-1.5 w-full bg-gradient-to-r from-[#0053e2] to-[#ffc220]"></div>
    <div class="p-6">
      <h2 class="text-base font-bold text-gray-900 dark:text-zinc-100 mb-4">${isEdit ? '✎ Edit Contact' : '+ Add Contact'}</h2>
      <form id="crm-contact-form" onsubmit="crmSaveContact(event,${c?c.id:0})">

        <!-- Photo + Emoji row -->
        <div class="flex gap-4 items-start mb-4">
          <div class="flex-shrink-0">
            <label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Photo</label>
            <div id="crm-pic-preview"
              class="w-16 h-16 rounded-full overflow-hidden bg-gray-100 dark:bg-zinc-800
                     flex items-center justify-center text-3xl leading-none
                     border-2 border-gray-200 dark:border-zinc-700
                     ${isEdit ? 'cursor-pointer hover:opacity-75 transition' : 'opacity-50'}"
              title="${isEdit ? 'Click to upload a photo' : 'Save contact first, then edit to add a photo'}"
              onclick="${isEdit ? 'document.getElementById(\'crm-pic-file\').click()' : ''}">
              ${c?.profile_pic
                ? `<img id="crm-pic-img" src="${_crmEsc(c.profile_pic)}" class="w-full h-full object-cover" alt=""/>`
                : `<span id="crm-pic-img">${_crmEsc(c?.avatar_emoji||'👤')}</span>`}
            </div>
            <p class="text-[10px] text-center text-gray-400 mt-1 italic">${isEdit?'click to upload':'—'}</p>
            <input type="hidden" name="profile_pic" id="crm-pic-url" value="${_crmEsc(c?.profile_pic||'')}"/>
            <input type="file" id="crm-pic-file" accept="image/jpeg,image/png,image/gif,image/webp"
                   class="hidden" onchange="crmHandlePicFile(this,${c?c.id:0})"/>
          </div>
          <div class="flex-shrink-0">
            <label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Emoji</label>
            <button type="button" id="crm-emoji-btn"
              title="Choose an emoji avatar"
              class="w-16 h-16 rounded-full flex items-center justify-center text-3xl leading-none
                     border-2 border-dashed border-gray-300 dark:border-zinc-600
                     hover:border-[#0053e2] hover:bg-blue-50 dark:hover:bg-zinc-800
                     transition focus:outline-none focus:ring-2 focus:ring-[#0053e2]">
              ${_crmEsc(c?.avatar_emoji||'👤')}
            </button>
            <input type="hidden" id="crm-emoji-val" name="avatar_emoji"
              value="${_crmEsc(c?.avatar_emoji||'👤')}"/>
          </div>
        </div>

        <!-- Default fields: flat underline style, 2-column grid -->
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 mb-4">
          <div>
            ${flatLbl('Name', true)}
            ${flat('name', c?.name, 'text', 'Full name')}
          </div>
          <div>
            ${flatLbl('Relationship')}
            ${flat('relationship', c?.relationship, 'text', 'Friend, colleague…')}
          </div>
          <div>
            ${flatLbl('Email')}
            ${flat('email', c?.email, 'email', 'email@example.com')}
          </div>
          <div>
            ${flatLbl('Phone')}
            ${flat('phone', c?.phone, 'tel', '+1 555 000 0000', 'oninput="crmFmtPhone(this)"')}
          </div>
          <div>
            ${flatLbl('Birthday')}
            ${flat('birthday', c?.birthday, 'date')}
          </div>
          <div>
            ${flatLbl('First Met Date')}
            ${flat('first_met_date', c?.first_met_date, 'date')}
          </div>
          <div class="col-span-2">
            ${flatLbl('Company')}
            ${flat('company', c?.company, 'text', 'Acme Corp')}
          </div>
        </div>

        <!-- Custom fields — flex-col so drag rows stack cleanly -->
        ${customFields ? `<div class="flex flex-col gap-2 border-t border-gray-100 dark:border-zinc-800 pt-3 mt-1">${customFields}</div>` : ''}

        <!-- Add field expanded form (hidden; appears above action row) -->
        <div id="crm-af-form" style="display:none"
          class="mb-3 p-3 rounded-lg bg-gray-50 dark:bg-zinc-800/60
                 border border-gray-200 dark:border-zinc-700">
          <div class="flex gap-2 items-center">
            <input id="crm-af-label" placeholder="Field name"
              class="flex-1 border border-gray-300 dark:border-zinc-700 rounded-lg px-2 py-1.5
                     text-xs bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                     placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
            <select id="crm-af-type" onchange="crmAfTypeChange(this)"
              class="border border-gray-300 dark:border-zinc-700 rounded-lg px-2 py-1.5
                     text-xs bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200
                     focus:outline-none focus:ring-1 focus:ring-[#0053e2] cursor-pointer">
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="url">URL</option>
              <option value="email">Email</option>
              <option value="select">Select</option>
              <option value="multi_select">Multi-select</option>
              <option value="checkbox">Checkbox</option>
              <option value="priority">Priority ⭐</option>
            </select>
            <button type="button" id="crm-af-btn" onclick="crmModalAddField(${c?.id||0})"
              class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0053e2] text-white
                     hover:bg-blue-700 transition flex-shrink-0">Add</button>
          </div>
          <!-- Icon picker — only shown for Priority type -->
          <div id="crm-af-icon-row" style="display:none"
            class="flex items-center gap-1 mt-2 flex-wrap">
            <span class="text-[10px] text-gray-400 dark:text-zinc-500 mr-1">Icon:</span>
            ${ ['⭐','❤️','🔥','🌳','🏆','🪱','🌟','👍','🥳','🍎'].map(ico =>
              `<button type="button" class="crm-af-icon-btn text-xl px-1 py-0.5 rounded
                       hover:bg-gray-100 dark:hover:bg-zinc-700 transition"
                onclick="crmAfSelectIcon(this,'${ico}')">${ico}</button>`
            ).join('') }
            <input type="hidden" id="crm-af-icon" value="⭐"/>
          </div>
        </div>

        <p id="crm-contact-err" class="hidden text-xs text-red-500 mb-2"></p>
        <div id="crm-dup-warn" class="hidden mb-3"></div>
        <div id="crm-action-btns" class="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
          <button type="button" id="crm-af-toggle" onclick="crmToggleAddField()"
            class="flex items-center gap-1 text-xs text-gray-400 dark:text-zinc-500
                   hover:text-[#0053e2] dark:hover:text-blue-400 transition">
            <span class="text-sm leading-none">+</span> Add field
          </button>
          <div class="flex gap-2 ml-auto">
            <button type="button" onclick="crmCloseModal()"
              class="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                     text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">Cancel</button>
            <button type="submit" id="crm-contact-save"
              class="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#0053e2] text-white hover:bg-blue-700 transition">
              ${isEdit ? 'Save' : 'Add Contact'}</button>
          </div>
        </div>
      </form>
    </div>`;
  _crmShowModal(body);
  // Stamp the contact id so the field-handle popover can re-open this modal after a save
  var _modalWrap = document.getElementById('crm-modal');
  if (_modalWrap) _modalWrap.setAttribute('data-contact-id', c ? String(c.id) : '');
  // Attach slash-command palette to all text fields in the modal
  if (typeof _crmAttachSlash === 'function') {
    setTimeout(function() {
      var form = document.getElementById('crm-contact-form');
      if (form) _crmAttachSlash(form);
    }, 0);
  }
  setTimeout(_crmInitEmojiPicker, 0);
  if (isEdit && typeof crmLoadReminders === 'function') {
    _crmFields.filter(function(f) { return f.field_type === 'date'; })
      .forEach(function(f) {
        crmLoadReminders(c.id, c.name, f.id, f.label, fv[f.id] || '');
      });
  }
}

// ── Duplicate detection ──────────────────────────────────────────────────────
function _crmNameTokens(name) {
  return (name||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').split(/\s+/).filter(Boolean);
}

function _crmNameSimilarity(a, b) {
  var ta = _crmNameTokens(a), tb = _crmNameTokens(b);
  if (!ta.length || !tb.length) return 0;
  var inter = ta.filter(function(t){ return tb.includes(t); }).length;
  return 2 * inter / (ta.length + tb.length);
}

/** Returns null (no dup) | {level:'strong'|'soft', match:contact} */
function _crmCheckDuplicates(name, email, currentId) {
  var normEmail = (email||'').trim().toLowerCase();
  for (var i = 0; i < _crmContacts.length; i++) {
    var c = _crmContacts[i];
    if (c.id === currentId) continue;
    if (normEmail && normEmail === (c.email||'').trim().toLowerCase())
      return {level:'strong', match:c};
    if (_crmNameSimilarity(name, c.name) >= 0.8)
      return {level:'soft', match:c};
  }
  return null;
}

function _crmShowDupWarning(dup, contactId, label) {
  var warn = document.getElementById('crm-dup-warn');
  var btns = document.getElementById('crm-action-btns');
  if (!warn || !btns) return;
  var isStrong = dup.level === 'strong';
  var title = isStrong ? '⚠️ Duplicate email detected' : '🔍 Possible duplicate name';
  var reason = isStrong
    ? 'A contact with this email already exists:'
    : 'A contact with a similar name already exists:';
  var cardCls = isStrong
    ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
    : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20';
  var titleCls = isStrong ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400';
  warn.className = '';
  warn.innerHTML = `<div class="rounded-lg border p-3 ${cardCls}">
    <p class="text-xs font-semibold ${titleCls} mb-1">${title}</p>
    <p class="text-xs text-gray-600 dark:text-zinc-400 mb-1">${reason}</p>
    <p class="text-xs font-medium text-gray-800 dark:text-zinc-200">${_crmEsc(dup.match.name)}
      ${dup.match.email ? '<span class="font-normal text-gray-500">· '+_crmEsc(dup.match.email)+'</span>' : ''}</p>
    <div class="flex gap-2 mt-2">
      <button type="button" onclick="_crmDupCancel()"
        class="px-3 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-300">
        ← Edit</button>
      <button type="button" onclick="_crmDupSaveAnyway(${contactId},'${_crmEsc(label)}')"
        class="px-3 py-1 text-xs font-semibold rounded-lg bg-gray-700 text-white hover:bg-gray-900 transition">
        Save Anyway</button>
    </div>
  </div>`;
  btns.classList.add('hidden');
}

function _crmDupCancel() {
  var warn = document.getElementById('crm-dup-warn');
  var btns = document.getElementById('crm-action-btns');
  if (warn) warn.innerHTML = '';
  if (btns) btns.classList.remove('hidden');
  _crmDupOverride = false;
}

function _crmDupSaveAnyway(contactId, label) {
  _crmDupOverride = true;
  var warn = document.getElementById('crm-dup-warn');
  var btns = document.getElementById('crm-action-btns');
  if (warn) warn.innerHTML = '';
  if (btns) btns.classList.remove('hidden');
  // Re-trigger form submit — the override flag will skip the dup check
  var form = document.getElementById('crm-contact-form');
  if (form) form.requestSubmit();
}

// ── Emoji avatar picker ───────────────────────────────────────────────────────
function _crmInitEmojiPicker() {
  var btn    = document.getElementById('crm-emoji-btn');
  var hidden = document.getElementById('crm-emoji-val');
  if (!btn || !hidden) return;

  /* Remove stale popup from a previous open */
  var old = document.getElementById('crm-emoji-pop');
  if (old) old.remove();

  var SECTIONS = [
    { label: 'People',    emojis: ['👤','👥','👨','👩','🧑','👴','👵','🧔','👦','👧','👶','🧒','🧑\u200d💼','👨\u200d💼','👩\u200d💼','🧑\u200d💻','👨\u200d💻','👩\u200d💻','🧑\u200d🔬','👨\u200d🔬','👩\u200d🔬','🧑\u200d🎨','👨\u200d🎨','👩\u200d🎨','🧑\u200d🏫','👨\u200d🏫','👩\u200d🏫','🧑\u200d⚕️','👨\u200d⚕️','👩\u200d⚕️'] },
    { label: 'Work',      emojis: ['💼','🏢','🤝','📊','💰','🎯','🏆','📋','📝','🔑','📞','📧','🖥️','💻','📱','✈️','🚗','📣','🎤','📡'] },
    { label: 'Emotions',  emojis: ['❤️','💙','💚','💛','💜','🧡','🖤','🤍','🤎','💗','💓','😊','😄','😎','🥳','🤩','🤗','🙏','👍','💪','🌟','⭐','🔥','🎉'] },
    { label: 'Animals',   emojis: ['🦁','🐯','🐻','🦊','🐼','🐨','🐸','🐙','🦋','🦅','🦜','🐬','🐺','🦒','🦓','🐘','🦔','🐝'] },
  ];

  var dark = document.documentElement.classList.contains('dark');

  /* Build popup on body so modal overflow-hidden won't clip it */
  var pop = document.createElement('div');
  pop.id = 'crm-emoji-pop';
  Object.assign(pop.style, {
    position: 'fixed', zIndex: '9999', display: 'none',
    width: '272px', maxHeight: '300px', overflowY: 'auto',
    background: dark ? '#18181b' : '#fff',
    border:     dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
    borderRadius: '12px', padding: '10px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
  });

  SECTIONS.forEach(function(sec) {
    var hdr = document.createElement('p');
    hdr.textContent = sec.label;
    Object.assign(hdr.style, {
      fontSize: '10px', fontWeight: '600', letterSpacing: '.05em',
      textTransform: 'uppercase', color: dark ? '#71717a' : '#9ca3af',
      margin: '4px 0 4px',
    });
    pop.appendChild(hdr);

    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,1fr);gap:2px;margin-bottom:4px';

    sec.emojis.forEach(function(em) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = em;
      Object.assign(b.style, {
        fontSize: '20px', lineHeight: '1', padding: '4px', borderRadius: '6px',
        border: 'none', background: 'transparent', cursor: 'pointer',
      });
      b.addEventListener('mouseenter', function() { b.style.background = dark ? '#3f3f46' : '#eff6ff'; });
      b.addEventListener('mouseleave', function() { b.style.background = 'transparent'; });
      b.addEventListener('mousedown', function(e) {
        e.preventDefault(); // don't steal focus from the form
        _crmEmojiSelect(em);
        _crmEmojiClose();
      });
      grid.appendChild(b);
    });
    pop.appendChild(grid);
  });

  document.body.appendChild(pop);

  /* ── Helpers ── */
  function _crmEmojiSelect(emoji) {
    hidden.value = emoji;
    btn.textContent = emoji;
    /* Also update the big photo-preview circle if it's still showing the emoji span */
    var pic = document.getElementById('crm-pic-img');
    if (pic && pic.tagName === 'SPAN') pic.textContent = emoji;
  }

  function _crmEmojiOpen() {
    var rect = btn.getBoundingClientRect();
    pop.style.display = 'block';
    /* Flip above if too close to viewport bottom */
    var spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 320) {
      pop.style.top  = (rect.top - pop.offsetHeight - 6) + 'px';
    } else {
      pop.style.top  = (rect.bottom + 6) + 'px';
    }
    pop.style.left = rect.left + 'px';
    btn.setAttribute('aria-expanded', 'true');
    setTimeout(function() {
      document.addEventListener('mousedown', _outsideClick);
      document.addEventListener('keydown',   _escKey);
    }, 0);
  }

  function _crmEmojiClose() {
    pop.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', _outsideClick);
    document.removeEventListener('keydown',   _escKey);
  }

  function _outsideClick(e) {
    if (!pop.contains(e.target) && e.target !== btn) _crmEmojiClose();
  }

  function _escKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); _crmEmojiClose(); }
  }

  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (pop.style.display === 'none') _crmEmojiOpen(); else _crmEmojiClose();
  });
}

async function crmSaveContact(e, contactId) {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('crm-contact-err');
  const saveBtn = document.getElementById('crm-contact-save');
  if (!saveBtn) return;
  if (!form.name.value.trim()) {
    _crmShowErr(errEl, 'Name is required.'); return;
  }
  // ─ Duplicate detection (client-side, skip if user already chose "Save Anyway") ─
  if (!_crmDupOverride) {
    var dup = _crmCheckDuplicates(form.name.value.trim(), (form.email||{}).value||'', contactId||0);
    if (dup) {
      _crmShowDupWarning(dup, contactId||0, contactId ? 'Save' : 'Add Contact');
      return;
    }
  }
  _crmDupOverride = false; // reset after passing
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  try {
    const data = new FormData(form);
    // Strip custom field keys — send them separately
    const cfKeys = _crmFields.map(f => `cf_${f.id}`);
    const body = new URLSearchParams();
    for (const [k,v] of data.entries()) { if (!cfKeys.includes(k)) body.append(k,v); }

    const url = contactId
      ? `/home/crm/${_crmPid}/contacts/${contactId}/update`
      : `/home/crm/${_crmPid}/contacts/add`;
    const contacts = await _crmFetch(url, {method:'POST', body});
    _crmContacts = contacts;

    // Save custom field values (find new contact ID if adding)
    const savedId = contactId || Math.max(...contacts.map(c => c.id));
    await Promise.all(_crmFields.map(f => {
      var val;
      if (f.field_type === 'multi_select') {
        val = JSON.stringify(data.getAll(`cf_${f.id}`));
      } else if (f.field_type === 'checkbox') {
        val = data.has(`cf_${f.id}`) ? '1' : '0';
      } else if (f.field_type === 'file_links') {
        val = JSON.stringify(
          (data.get(`cf_${f.id}`) || '').trim().split('\n').map(l => l.trim()).filter(Boolean)
        );
      } else {
        val = (data.get(`cf_${f.id}`) || '').trim();
      }
      const fBody = new URLSearchParams({field_id: f.id, value: val});
      return _crmFetch(`/home/crm/${_crmPid}/contacts/${savedId}/field-value`,
                       {method:'POST', body: fBody}).catch(() => {});
    }));
    // Reload to get updated field_values
    _crmContacts = await _crmFetch(`/home/crm/${_crmPid}/contacts`);
    crmCloseModal();
    _crmRender();
  } catch(err) {
    _crmShowErr(errEl, err.message || 'Could not save contact.');
    saveBtn.disabled = false; saveBtn.textContent = contactId ? 'Save' : 'Add Contact';
  }
}

var _crmDelPending = null;

function crmDeleteContact(id) {
  const c = _crmContacts.find(x => x.id === id);
  const modal = document.getElementById('del-contact-modal');
  if (!modal) { _doCrmDel(id); return; } // safety fallback (should never happen)
  _crmDelPending = id;
  document.getElementById('del-contact-name').textContent = c?.name || 'this contact';
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('del-contact-confirm-btn')?.focus(), 50);
}
function _closeCrmDelModal() {
  document.getElementById('del-contact-modal')?.classList.add('hidden');
  _crmDelPending = null;
}
async function _confirmCrmDel() {
  const id = _crmDelPending;
  _closeCrmDelModal();
  if (!id) return;
  await _doCrmDel(id);
}
async function _doCrmDel(id) {
  try {
    _crmContacts = await _crmFetch(`/home/crm/${_crmPid}/contacts/${id}/delete`, {method:'POST'});
    _crmRender();
  } catch(e) { alert('Delete failed: ' + e.message); }
}

// ── Profile picture upload ───────────────────────────────────────────────────
async function crmHandlePicFile(input, contactId) {
  const file = input.files[0];
  if (!file) return;
  if (!contactId) {
    alert('Save the contact first, then edit to add a photo.');
    input.value = '';
    return;
  }
  const MAX = 3 * 1024 * 1024;
  if (file.size > MAX) { alert('File too large \u2014 max 3 MB.'); input.value = ''; return; }
  const preview = document.getElementById('crm-pic-preview');
  const urlInput = document.getElementById('crm-pic-url');
  if (preview) preview.style.opacity = '0.4';
  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`/home/crm/${_crmPid}/contacts/${contactId}/upload-pic`,
                          {method: 'POST', body: fd});
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if (urlInput) urlInput.value = j.url;
    const imgEl = document.getElementById('crm-pic-img');
    if (imgEl) {
      if (imgEl.tagName === 'IMG') {
        imgEl.src = j.url;
      } else {
        const img = document.createElement('img');
        img.id = 'crm-pic-img';
        img.src = j.url;
        img.className = 'w-full h-full object-cover';
        img.alt = '';
        imgEl.replaceWith(img);
      }
    }
  } catch(e) {
    alert('Upload failed: ' + e.message);
  } finally {
    if (preview) preview.style.opacity = '';
    input.value = '';
  }
}

// Field management → home-page-crm-fields.js

// ── Modal helpers ─────────────────────────────────────────────────────────────
// ── Number formatting ─────────────────────────────────────────────────────────────
function _crmFmtNumber(raw) {
  if (raw === '' || raw === null || raw === undefined) return '';
  var stripped = String(raw).replace(/,/g, '').trim();
  var n = parseFloat(stripped);
  if (isNaN(n)) return stripped;
  return n.toLocaleString('en-US', {maximumFractionDigits: 2});
}

// Called onblur on number inputs in the edit modal
window.crmFmtNumberInput = function(el) {
  var n = parseFloat(el.value.replace(/,/g, '').trim());
  if (!isNaN(n)) el.value = n.toLocaleString('en-US', {maximumFractionDigits: 2});
};

// ── Phone formatting ─────────────────────────────────────────────────────────────
function _crmPhone(raw) {
  if (!raw) return '';
  var s = raw.trim();
  // Keep international numbers (starting with +) as-is if not US
  var digits = s.replace(/\D/g, '');
  if (digits.length === 10) {
    return '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
  }
  if (digits.length === 11 && digits[0] === '1') {
    return '+1 (' + digits.slice(1,4) + ') ' + digits.slice(4,7) + '-' + digits.slice(7);
  }
  return s;
}

// Called oninput on the phone field — formats in place
window.crmFmtPhone = function(el) {
  var digits = el.value.replace(/\D/g, '');
  if (digits.length === 10) {
    el.value = '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
  } else if (digits.length === 11 && digits[0] === '1') {
    el.value = '+1 (' + digits.slice(1,4) + ') ' + digits.slice(4,7) + '-' + digits.slice(7);
  }
};

// ── Inline field management from contact modal ───────────────────────────────────
// Reads IDs injected into the modal DOM — NOT a nested <form>, just a <div>
window.crmModalAddField = async function(contactId) {
  var labelEl = document.getElementById('crm-af-label');
  var typeEl  = document.getElementById('crm-af-type');
  var iconEl  = document.getElementById('crm-af-icon');
  if (!labelEl || !typeEl) return;
  var label = (labelEl.value || '').trim();
  var type  = typeEl.value || 'text';
  var icon  = (iconEl && iconEl.value) ? iconEl.value : '⭐';
  if (!label) { labelEl.focus(); return; }
  var btn = document.getElementById('crm-af-btn');
  if (btn) btn.disabled = true;
  try {
    var body = new URLSearchParams({label: label, field_type: type,
      options: type === 'priority' ? icon : ''});
    _crmFields = await _crmFetch('/home/crm/' + _crmPid + '/fields/add', {method:'POST', body: body});
    var contact = contactId ? (_crmContacts.find(function(c){ return c.id === contactId; }) || null) : null;
    _crmContactModal(contact);
  } catch(err) { alert('Could not add field: ' + (err.message || err)); }
  finally { if (btn) btn.disabled = false; }
};

window.crmModalDeleteField = function(fieldId, contactId) {
  var f = _crmFields.find(function(x){ return x.id === fieldId; });
  var label = f ? f.label : 'this field';
  _crmShowModal(
    '<div class="h-1.5 w-full bg-gradient-to-r from-[#ea1100] to-[#ffc220]"></div>' +
    '<div class="p-6">' +
      '<div class="flex items-start gap-3 mb-5">' +
        '<span class="text-3xl leading-none flex-shrink-0">🗑️</span>' +
        '<div>' +
          '<h2 class="text-base font-bold text-gray-900 dark:text-zinc-100 mb-1">Remove field?</h2>' +
          '<p class="text-sm text-gray-600 dark:text-zinc-300">' +
            'Remove <strong class="text-gray-900 dark:text-zinc-100">' + _crmEsc(label) + '</strong> ' +
            'from every contact on this page? All saved values will be permanently lost.' +
          '</p>' +
        '</div>' +
      '</div>' +
      '<div class="flex gap-2 justify-end">' +
        '<button type="button" onclick="crmCloseModal()" ' +
          'class="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-600 ' +
                 'text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">Cancel</button>' +
        '<button type="button" onclick="_doCrmFieldDelete(' + fieldId + ',' + contactId + ')" ' +
          'class="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#ea1100] text-white ' +
                 'hover:bg-red-700 transition">Remove field</button>' +
      '</div>' +
    '</div>'
  );
};

window._doCrmFieldDelete = async function(fieldId, contactId) {
  try {
    _crmFields = await _crmFetch('/home/crm/' + _crmPid + '/fields/' + fieldId + '/delete',
      {method:'POST', body: new URLSearchParams({})});
    var contact = contactId ? (_crmContacts.find(function(c){ return c.id === contactId; }) || null) : null;
    _crmContactModal(contact);
  } catch(err) {
    crmCloseModal();
    alert('Could not delete field: ' + (err.message || err));
  }
};

// Priority icon field — inline interaction inside the contact modal
window.crmSetFieldPriority = function(fieldId, val) {
  var inp = document.getElementById('cf_pri_' + fieldId);
  if (!inp) return;
  // Clicking same value again clears it
  var newVal = (parseInt(inp.value) === val) ? 0 : val;
  inp.value = String(newVal);
  document.querySelectorAll('[data-pri-field="' + fieldId + '"]').forEach(function(b) {
    b.style.opacity = parseInt(b.dataset.priVal) <= newVal ? '1' : '0.25';
  });
};

// ── Custom-field drag-to-reorder ─────────────────────────────────────────────────
var _crmDragFieldId = null;

window.crmCfDragStart = function(e, fieldId) {
  _crmDragFieldId = fieldId;
  window._crmCfDragged = true;          // tells click handler: this was a drag
  e.dataTransfer.effectAllowed = 'move';
  // Fade the whole row, not just the handle span
  var row = e.currentTarget.closest('.crm-cf-row');
  if (row) row.style.opacity = '0.4';
};

window.crmCfDragEnd = function(e) {
  var row = e.currentTarget.closest('.crm-cf-row');
  if (row) row.style.opacity = '';
  document.querySelectorAll('.crm-cf-row').forEach(function(el) {
    el.style.borderTop = '';
  });
  // Clear flag after the browser fires any synthetic click from the drag gesture
  setTimeout(function() { window._crmCfDragged = false; }, 120);
};

window.crmCfDragOver = function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // Show drop-indicator line above this row
  document.querySelectorAll('.crm-cf-row').forEach(function(el) { el.style.borderTop = ''; });
  e.currentTarget.style.borderTop = '2px solid #0053e2';
};

window.crmCfDragLeave = function(e) {
  // Only clear if truly leaving the row (not entering a child)
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.style.borderTop = '';
  }
};

window.crmCfDrop = async function(e, targetFieldId, contactId) {
  e.preventDefault();
  document.querySelectorAll('.crm-cf-row').forEach(function(el) { el.style.borderTop = ''; });
  var srcId = _crmDragFieldId;
  _crmDragFieldId = null;
  if (!srcId || srcId === targetFieldId) return;
  // Build new order: move src before target
  var ids = _crmFields.map(function(f) { return f.id; });
  ids.splice(ids.indexOf(srcId), 1);
  ids.splice(ids.indexOf(targetFieldId), 0, srcId);
  try {
    _crmFields = await _crmFetch('/home/crm/' + _crmPid + '/fields/reorder',
      {method:'POST', body: new URLSearchParams({order: ids.join(',')})});
    var contact = contactId ? (_crmContacts.find(function(c){ return c.id===contactId; })||null) : null;
    _crmContactModal(contact);
  } catch(err) { alert('Reorder failed: ' + (err.message||err)); }
};

// Add-field toggle — show/hide the form below the trigger button

// ── Handle-click popover (click ≦5 to edit a custom field from the contact modal) ──
window.crmCfHandleClick = function(e, fieldId) {
  e.stopPropagation();
  if (window._crmCfDragged) return;   // was a drag, not a plain click
  var f = (_crmFields || []).find(function(x) { return x.id === fieldId; });
  if (!f) return;

  // Remove any existing popover first
  crmCfPopClose();

  var showOpts = f.field_type === 'select' || f.field_type === 'multi_select';
  var typeLabels = {
    text: 'Text', number: 'Number', date: 'Date', checkbox: 'Checkbox',
    select: 'Select', multi_select: 'Multi-select', url: 'URL',
    email: 'Email', phone: 'Phone', priority: 'Priority',
  };
  var typeName = typeLabels[f.field_type] || f.field_type;

  // Position the popover next to the handle
  var rect  = e.currentTarget.getBoundingClientRect();
  var top   = rect.bottom + 6;
  var left  = rect.left;
  // Flip up if not enough room below
  var popH  = showOpts ? 240 : 180;
  if (top + popH > window.innerHeight - 20) top = rect.top - popH - 6;
  // Keep inside the right edge
  if (left + 280 > window.innerWidth - 16) left = window.innerWidth - 296;

  var pop = document.createElement('div');
  pop.id  = 'crm-cf-pop';
  pop.style.cssText = 'position:fixed;z-index:9999;width:272px;'
    + 'top:' + top + 'px;left:' + left + 'px;'
    + 'background:#fff;border:1px solid #e5e7eb;border-radius:12px;'
    + 'box-shadow:0 8px 24px rgba(0,0,0,.14);overflow:hidden;';
  // Dark-mode
  if (document.documentElement.classList.contains('dark')) {
    pop.style.background = '#18181b';
    pop.style.border = '1px solid #3f3f46';
    pop.style.color  = '#f4f4f5';
  }

  pop.innerHTML =
    '<div style="height:3px;background:linear-gradient(90deg,#0053e2,#ffc220)"></div>'
    + '<div style="padding:14px 16px">'
    + '<p style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;'
    +    'color:#9ca3af;margin:0 0 10px">Edit field</p>'
    + '<label style="display:block;font-size:11px;font-weight:500;color:#6b7280;margin-bottom:4px">Label</label>'
    + '<input id="crm-cf-pop-label" value="' + _crmEsc(f.label) + '" required'
    +   ' style="width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;'
    +          'padding:6px 10px;font-size:13px;outline:none;background:inherit;color:inherit;"/>'
    + '<p style="font-size:11px;color:#9ca3af;margin:8px 0 ' + (showOpts?'10px':'12px') + '">'
    +   'Type: <strong style="color:#6b7280">' + typeName + '</strong>'
    +   ' <em>(delete &amp; re-add to change)</em></p>'
    + (showOpts
        ? '<label style="display:block;font-size:11px;font-weight:500;color:#6b7280;margin-bottom:4px">'
          + 'Options <span style="font-weight:400;color:#9ca3af">(pipe-separated)</span></label>'
          + '<input id="crm-cf-pop-opts" value="' + _crmEsc(f.options || '') + '"'
          +   ' placeholder="Option A|Option B|Option C"'
          +   ' style="width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;'
          +          'padding:6px 10px;font-size:13px;outline:none;background:inherit;color:inherit;margin-bottom:12px;"/>'
        : '')
    + '<p id="crm-cf-pop-err" style="display:none;font-size:11px;color:#ea1100;margin-bottom:6px"></p>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end">'
    +   '<button onclick="crmCfPopClose()"'
    +     ' style="padding:5px 14px;font-size:12px;border-radius:8px;'
    +            'border:1px solid #d1d5db;background:transparent;cursor:pointer;color:inherit;">Cancel</button>'
    +   '<button onclick="crmCfPopSave(' + fieldId + ')"'
    +     ' style="padding:5px 14px;font-size:12px;font-weight:600;border-radius:8px;'
    +            'border:none;background:#0053e2;color:#fff;cursor:pointer;">Save</button>'
    + '</div></div>';

  document.body.appendChild(pop);
  var inp = document.getElementById('crm-cf-pop-label');
  if (inp) { inp.focus(); inp.select(); }

  // Close on outside click
  setTimeout(function() {
    document.addEventListener('click', _crmCfPopAway);
    document.addEventListener('keydown', _crmCfPopKey);
  }, 30);
};

function _crmCfPopAway(e) {
  var pop = document.getElementById('crm-cf-pop');
  if (pop && !pop.contains(e.target)) crmCfPopClose();
}
function _crmCfPopKey(e) {
  if (e.key === 'Escape') crmCfPopClose();
}

window.crmCfPopClose = function() {
  var pop = document.getElementById('crm-cf-pop');
  if (pop) pop.remove();
  document.removeEventListener('click', _crmCfPopAway);
  document.removeEventListener('keydown', _crmCfPopKey);
};

window.crmCfPopSave = async function(fieldId) {
  var lblEl  = document.getElementById('crm-cf-pop-label');
  var optsEl = document.getElementById('crm-cf-pop-opts');
  var errEl  = document.getElementById('crm-cf-pop-err');
  var label  = (lblEl ? lblEl.value.trim() : '');
  if (!label) {
    if (errEl) { errEl.textContent = 'Label is required.'; errEl.style.display = 'block'; }
    return;
  }
  var f = (_crmFields || []).find(function(x) { return x.id === fieldId; });
  if (!f) return;
  var body = new URLSearchParams({
    label: label,
    field_type: f.field_type,
    options: (optsEl ? optsEl.value.trim() : (f.options || '')),
  });
  try {
    _crmFields = await _crmFetch('/home/crm/' + _crmPid + '/fields/' + fieldId + '/update',
      { method: 'POST', body });
    crmCfPopClose();
    // Re-open the contact modal so new label is reflected — contact id is on the modal
    var modal = document.getElementById('crm-modal');
    var cidAttr = modal ? modal.getAttribute('data-contact-id') : null;
    var contact = cidAttr ? (_crmContacts.find(function(c) { return String(c.id) === cidAttr; }) || null) : null;
    _crmContactModal(contact);
  } catch(err) {
    if (errEl) { errEl.textContent = err.message || 'Could not save.'; errEl.style.display = 'block'; }
  }
};

window.crmToggleAddField = function() {
  var form   = document.getElementById('crm-af-form');
  var toggle = document.getElementById('crm-af-toggle');
  if (!form) return;
  var opening = form.style.display === 'none';
  form.style.display = opening ? 'block' : 'none';
  if (toggle) toggle.style.color = opening ? 'var(--tw-color-blue, #0053e2)' : '';
  if (opening) {
    var lbl = document.getElementById('crm-af-label');
    if (lbl) lbl.focus();
  }
};

// Add-field type picker — show/hide icon row
window.crmAfTypeChange = function(sel) {
  var row = document.getElementById('crm-af-icon-row');
  if (row) row.style.display = sel.value === 'priority' ? 'flex' : 'none';
};

window.crmAfSelectIcon = function(btn, icon) {
  var inp = document.getElementById('crm-af-icon');
  if (inp) inp.value = icon;
  document.querySelectorAll('.crm-af-icon-btn').forEach(function(b) {
    b.style.outline = b === btn ? '2px solid #0053e2' : 'none';
    b.style.borderRadius = '4px';
  });
};

function _crmShowModal(html) {
  var body = document.getElementById('crm-modal-body');
  var wrap = document.getElementById('crm-modal');
  var bd   = document.getElementById('crm-backdrop');
  if (!body || !wrap || !bd) return;
  body.innerHTML = html;
  wrap.classList.remove('hidden');
  bd.classList.remove('hidden');
}

function crmCloseModal() {
  if (typeof _slashHide === 'function') _slashHide();
  var ep = document.getElementById('crm-emoji-pop');
  if (ep) ep.remove();
  if (typeof crmCfPopClose === 'function') crmCfPopClose(); // dismiss field popover if open
  var wrap = document.getElementById('crm-modal');
  var bd   = document.getElementById('crm-backdrop');
  var body = document.getElementById('crm-modal-body');
  if (wrap) wrap.classList.add('hidden');
  if (bd)   bd.classList.add('hidden');
  if (body) body.innerHTML = '';
}

function _crmSetMain(html) {
  const el = document.getElementById('crm-main');
  if (el) el.innerHTML = html;
}

// ── Buds integration ────────────────────────────────────────────────────────────────
var _crmBudWidgets = null; // cached widget list

async function _crmTrackAsBud(contactId, contactName) {
  // Lazy-load widgets list
  if (!_crmBudWidgets) {
    try {
      var r = await fetch('/home/buds/user-widgets', {credentials:'same-origin'});
      var data = r.ok ? await r.json() : {};
      _crmBudWidgets = data.widgets || [];
    } catch(e) { _crmBudWidgets = []; }
  }

  var budEntry = (window._crmBudHealthMap||{})[String(contactId)];
  var alreadyTracked = !!budEntry;

  var widgetOpts = (_crmBudWidgets||[]).map(function(w) {
    var label = w.widget_name || w.page_name || 'Buds widget';
    return '<option value="' + w.widget_id + '">' + _crmEsc(label) + '</option>';
  }).join('');

  if (!widgetOpts) {
    _crmShowModal('<div class="p-6"><p class="text-sm text-gray-600 dark:text-zinc-300">No Buds widgets found on your pages. Add a 🌸 Friendship Health Tracker widget to a home page first.</p>'
      + '<button onclick="crmCloseModal()" class="mt-4 px-4 py-1.5 rounded bg-gray-100 dark:bg-zinc-700 text-sm">Close</button></div>');
    return;
  }

  // Visual species grid — reuse global _BUDS_SPECIES/_BUDS_NAMES from home-widget-buds.js
  var _SP = (typeof _BUDS_SPECIES !== 'undefined') ? _BUDS_SPECIES
    : ['blue_flower','calla','daffodil','daisy','pink','purple','sunflower','tulip'];
  var _SN = (typeof _BUDS_NAMES   !== 'undefined') ? _BUDS_NAMES
    : {blue_flower:'Blue Flower',calla:'Calla Lily',daffodil:'Daffodil',daisy:'Daisy',
       pink:'Pink Flower',purple:'Purple Flower',sunflower:'Sunflower',tulip:'Tulip'};
  var speciesPicker = _SP.map(function(s) {
    var isDefault = (s === 'daisy');
    return '<button type="button" data-crm-species="'+s+'"'
      + ' onclick="_crmSelectSpecies(\''+s+'\')"'
      + ' class="crm-species-btn flex flex-col items-center gap-0.5 p-1.5 rounded-lg'
      + ' border border-gray-200 dark:border-zinc-600 hover:border-[#0053e2]'
      + ' bg-white dark:bg-zinc-800 transition cursor-pointer'
      + (isDefault ? ' ring-2 ring-[#0053e2] ring-offset-1' : '') + '">'
      + '<img src="/static/img/buds/'+s+'_0.png" class="w-10 h-10 object-contain" alt="'+(_SN[s]||s)+'">'
      + '<span class="text-[10px] leading-tight text-center text-gray-600 dark:text-zinc-300">'+(_SN[s]||s)+'</span>'
      + '</button>';
  }).join('');

  _crmShowModal(`
    <div class="p-6 space-y-4">
      <h3 class="text-base font-semibold text-gray-800 dark:text-zinc-100">🌸 Track as Bud</h3>
      <p class="text-sm text-gray-500 dark:text-zinc-400">Add <strong>${_crmEsc(contactName)}</strong> to a Friendship Health Tracker widget.</p>
      ${alreadyTracked ? '<div class="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-3 py-2">⚠️ Already tracked — adding again creates a second entry.</div>' : ''}
      <div id="crm-bud-err" class="hidden text-xs text-red-500"></div>
      <label class="block">
        <span class="text-xs text-gray-500 dark:text-zinc-400">Widget</span>
        <select id="crm-bud-widget" class="mt-1 w-full rounded border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm px-2 py-1.5 text-gray-800 dark:text-zinc-100">
          ${widgetOpts}
        </select>
      </label>
      <label class="block">
        <span class="text-xs text-gray-500 dark:text-zinc-400">Name in widget</span>
        <input id="crm-bud-name" type="text" value="${_crmEsc(contactName)}" maxlength="60"
          class="mt-1 w-full rounded border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm px-2 py-1.5 text-gray-800 dark:text-zinc-100"/>
      </label>
      <div>
        <span class="text-xs text-gray-500 dark:text-zinc-400">Species</span>
        <input type="hidden" id="crm-bud-species" value="daisy"/>
        <div class="grid grid-cols-4 gap-1.5 mt-1">${speciesPicker}</div>
      </div>
      <div class="flex gap-2 pt-2">
        <button onclick="_crmBudSave(${contactId})" class="px-4 py-1.5 rounded bg-[#0053e2] text-white text-sm font-medium hover:bg-[#0041b8] transition">🌸 Add Bud</button>
        <button onclick="crmCloseModal()" class="px-4 py-1.5 rounded bg-gray-100 dark:bg-zinc-700 text-sm hover:bg-gray-200 dark:hover:bg-zinc-600 transition">Cancel</button>
      </div>
    </div>
  `);
}

async function _crmBudSave(contactId) {
  var widgetEl  = document.getElementById('crm-bud-widget');
  var nameEl    = document.getElementById('crm-bud-name');
  var speciesEl = document.getElementById('crm-bud-species');
  var errEl     = document.getElementById('crm-bud-err');
  if (!widgetEl || !nameEl) return;
  var widgetId = widgetEl.value;
  var name     = (nameEl.value||'').trim();
  var species  = speciesEl ? speciesEl.value : 'flower';
  if (!name) { if (errEl) { errEl.textContent = 'Name is required'; errEl.classList.remove('hidden'); } return; }
  try {
    var fd = new FormData();
    fd.append('name', name);
    fd.append('flower_species', species);
    fd.append('see_every_days', '7');
    fd.append('crm_contact_id', String(contactId));
    var r = await fetch('/home/buds/' + widgetId + '/add', {
      method: 'POST', credentials: 'same-origin', body: fd
    });
    if (!r.ok) throw new Error(await r.text());
    var data = await r.json();
    // Update local health map so badge appears immediately
    var buds = data.buds || [];
    var newBud = buds.find(function(b){ return String(b.crm_contact_id) === String(contactId); });
    window._crmBudHealthMap = window._crmBudHealthMap || {};
    if (newBud) {
      window._crmBudHealthMap[String(contactId)] = {
        health:    newBud.health || 100,
        tier:      newBud.health_tier != null ? newBud.health_tier : 0, // bud objects use health_tier; new buds always tier 0
        bud_id:    newBud.id,
        widget_id: parseInt(widgetId, 10),
        species:   newBud.flower_species,
      };
    }
    crmCloseModal();
    window._bwToast && window._bwToast('🌸 Bud added!', 'success');
    _crmRender();
  } catch(e) {
    if (errEl) { errEl.textContent = 'Failed: ' + e.message; errEl.classList.remove('hidden'); }
  }
}

function _crmSelectSpecies(species) {
  // Update hidden input
  var inp = document.getElementById('crm-bud-species');
  if (inp) inp.value = species;
  // Toggle ring highlight on picker buttons
  document.querySelectorAll('.crm-species-btn').forEach(function(btn) {
    var active = btn.dataset.crmSpecies === species;
    btn.classList.toggle('ring-2',        active);
    btn.classList.toggle('ring-[#0053e2]', active);
    btn.classList.toggle('ring-offset-1', active);
  });
}

function _crmShowErr(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── Fetch wrapper ─────────────────────────────────────────────────────────────
async function _crmFetch(url, opts) {
  const r = await fetch(url, {credentials: 'same-origin', ...opts});
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    // Session expired → server sent HTML login page
    if (r.status === 401 || !r.ok) throw new Error('Session expired — please reload.');
    throw new Error('Unexpected response from server.');
  }
  const data = await r.json();
  if (!r.ok || data?.error) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

// ── Public reload hook (called by pipeline module after mutations) ─────────────
window.crmReload = function() { _crmLoadAll(); };

// ── HTML escape ────────────────────────────────────────────────────────────────
function _crmEsc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
