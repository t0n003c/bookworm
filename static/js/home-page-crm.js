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
var _crmView     = 'table';   // 'table' | 'gallery' | 'pipeline' | 'calendar' | 'detail'
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
  _crmView = localStorage.getItem('bw_crm_view') || 'table';
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
function _crmRenderViewToggle() {
  const el = document.getElementById('crm-view-toggle');
  if (!el) return;
  const views = [
    ['table',    '☰ Table'],
    ['gallery',  '⊞ Gallery'],
    ['pipeline', '⬜ Pipeline'],
    ['calendar', '📅 Calendar'],
  ];
  const opts = views.map(([v, l]) =>
    `<option value="${v}" ${_crmView === v ? 'selected' : ''}>${l}</option>`
  ).join('');
  // Bulk "Select" toggle — only relevant for table & gallery
  const canBulk = (_crmView === 'table' || _crmView === 'gallery');
  const bulkBtn = canBulk
    ? `<button onclick="crmToggleBulkMode()"
         class="text-[11px] px-2.5 py-1 rounded-lg border transition
                ${_crmBulkMode
                    ? 'bg-[#ffc220] text-gray-900 border-[#ffc220]'
                    : 'border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 hover:border-[#ffc220]'}"
       >☑ Select</button>`
    : '';
  el.innerHTML =
    `<select onchange="crmSetView(this.value)"
       class="text-[11px] px-2 py-1.5 rounded-lg border border-gray-300 dark:border-zinc-600
              bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200
              focus:outline-none focus:ring-1 focus:ring-[#0053e2] cursor-pointer">
       ${opts}
     </select>${canBulk ? ' ' + bulkBtn : ''}`;
}

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
      if (col.id === 'phone')   return `<td class="${tdCls}">${_crmEsc(c.phone||'')}</td>`;
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
        <button onclick="event.stopPropagation();_crmTrackAsBud(${c.id},${JSON.stringify(c.name||'')})" title="Track as Bud" class="text-gray-300 hover:text-pink-500 transition mr-1">🌸</button>
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

// ── Text-field textarea: auto-continue bullet points on Enter ───────────────
function _crmTextBulletKey(e) {
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
  const inp = (name, val, type='text', placeholder='') =>
    `<input name="${name}" type="${type}" value="${_crmEsc(val||'')}" placeholder="${placeholder}"
      class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5
             text-sm bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
             placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>`;

  const customFields = _crmFields.map(f => {
    const val = fv[f.id] || '';
    let control;
    if (f.field_type === 'checkbox') {
      // Toggle switch — visually obvious, no JS needed (peer utilities)
      return `<div class="col-span-2 flex items-center justify-between
                          rounded-lg border border-gray-200 dark:border-zinc-700
                          px-3 py-2.5">
        <span class="text-sm font-medium text-gray-700 dark:text-zinc-200">${_crmEsc(f.label)}</span>
        <label class="relative flex items-center cursor-pointer shrink-0">
          <input type="checkbox" name="cf_${f.id}" value="1"
                 id="cf_chk_${f.id}" ${val==='1'?'checked':''}
                 class="sr-only peer"/>
          <div class="w-10 h-5 rounded-full bg-gray-200 dark:bg-zinc-600
                      peer-checked:bg-[#0053e2] transition-colors"></div>
          <div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow
                      transition-transform peer-checked:translate-x-5"></div>
        </label>
      </div>`;
    }
    if (f.field_type === 'multi_select') {
      var ms = []; try { ms = JSON.parse(val); } catch {}
      const opts = (f.options||'').split('|').filter(Boolean);
      // Pill/chip toggles — sr-only checkbox + peer-checked styling on visible span
      control = opts.length
        ? `<div class="flex flex-wrap gap-1.5">${opts.map(o =>
            `<label class="cursor-pointer">
               <input type="checkbox" name="cf_${f.id}" value="${_crmEsc(o)}"
                      ${ms.includes(o)?'checked':''} class="sr-only peer"/>
               <span class="inline-flex px-3 py-1 text-xs rounded-full border transition-all
                            border-gray-300 dark:border-zinc-600
                            text-gray-600 dark:text-zinc-300
                            peer-checked:bg-[#0053e2] peer-checked:border-[#0053e2]
                            peer-checked:text-white">
                 ${_crmEsc(o)}
               </span>
             </label>`).join('')}
          </div>`
        : `<p class="text-xs text-amber-600 dark:text-amber-400 py-1">
             No options yet — go to ⚙️ Fields to add some.
           </p>`;
    } else if (f.field_type === 'file_links') {
      var fl = []; try { fl = JSON.parse(val); } catch {}
      control = `<textarea name="cf_${f.id}" rows="2" placeholder="One URL per line"
        class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               focus:outline-none focus:ring-1 focus:ring-[#0053e2]">${_crmEsc(fl.join('\n'))}</textarea>`;
    } else if (f.field_type === 'select') {
      const opts = (f.options||'').split('|').filter(Boolean);
      if (!opts.length) {
        control = `<p class="text-xs text-amber-600 dark:text-amber-400 py-1">
          No options yet — go to ⚙️ Fields to add some.</p>`;
      } else {
        control = `<select name="cf_${f.id}"
          class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5
                 text-sm bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                 focus:outline-none focus:ring-1 focus:ring-[#0053e2] cursor-pointer">
          <option value="" class="text-gray-400" ${!val?'selected':''}>— none —</option>
          ${opts.map(o =>
            `<option value="${_crmEsc(o)}" ${o===val?'selected':''}>${_crmEsc(o)}</option>`
          ).join('')}
        </select>`;
      }
    } else if (f.field_type === 'date') {
      control = inp(`cf_${f.id}`, val, 'date');
      var remDiv = isEdit
        ? `<div id="crm-rem-${f.id}" class="mt-1.5 text-xs text-gray-400 italic">Loading reminders…</div>`
        : '';
      return `<div class="col-span-2">
        <label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">${_crmEsc(f.label)}</label>
        ${control}${remDiv}
      </div>`;
    } else if (f.field_type === 'text') {
      // Multi-line textarea — resize handle matches the file_links box behaviour
      control = `<textarea name="cf_${f.id}" rows="3"
        onkeydown="_crmTextBulletKey(event)"
        class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#0053e2]">${_crmEsc(val)}</textarea>`;
    } else {
      var iType = {number:'number', url:'url', email:'email'}[f.field_type] || 'text';
      control = inp(`cf_${f.id}`, val, iType);
    }
    return `<div class="col-span-2"><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">${_crmEsc(f.label)}</label>${control}</div>`;
  }).join('');

  const body = `
    <div class="h-1.5 w-full bg-gradient-to-r from-[#0053e2] to-[#ffc220]"></div>
    <div class="p-6">
      <h2 class="text-base font-bold text-gray-900 dark:text-zinc-100 mb-4">${isEdit ? '✎ Edit Contact' : '+ Add Contact'}</h2>
      <form id="crm-contact-form" onsubmit="crmSaveContact(event,${c?c.id:0})">
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div class="col-span-2 flex gap-4 items-start">
            <!-- Profile picture upload -->
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
            <!-- Emoji fallback + Name -->
            <div class="flex-1 space-y-2">
              <div>
                <label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Emoji <span class="font-normal text-gray-400 dark:text-zinc-500">(fallback)</span></label>
                <input name="avatar_emoji" value="${_crmEsc(c?c.avatar_emoji:'👤')}" maxlength="4"
                  class="w-16 text-center text-2xl border border-gray-300 dark:border-zinc-700 rounded-lg py-1
                         bg-white dark:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Name <span class="text-red-400">*</span></label>
                ${inp('name', c?.name, 'text', 'Full name')}
              </div>
            </div>
          </div>
          <div><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Email</label>${inp('email', c?.email, 'email', 'email@example.com')}</div>
          <div><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Phone</label>${inp('phone', c?.phone, 'tel', '+1 555 000 0000')}</div>
          <div class="col-span-2"><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Company</label>${inp('company', c?.company, 'text', 'Acme Corp')}</div>
          <div class="col-span-2"><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Tags <span class="text-gray-400 font-normal">(comma-separated)</span></label>${inp('tags', c?.tags, 'text', 'vendor, priority')}</div>
          ${customFields ? `<div class="col-span-2 border-t border-gray-100 dark:border-zinc-800 pt-3 mt-1 grid grid-cols-2 gap-3">${customFields}</div>` : ''}
        </div>
        <p id="crm-contact-err" class="hidden text-xs text-red-500 mb-2"></p>
        <div id="crm-dup-warn" class="hidden mb-3"></div>
        <div id="crm-action-btns" class="flex gap-2 justify-end pt-2">
          <button type="button" onclick="crmCloseModal()"
            class="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                   text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">Cancel</button>
          <button type="submit" id="crm-contact-save"
            class="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#0053e2] text-white hover:bg-blue-700 transition">
            ${isEdit ? 'Save' : 'Add Contact'}</button>
        </div>
      </form>
    </div>`;
  _crmShowModal(body);
  // Attach slash-command palette to all text fields in the modal
  if (typeof _crmAttachSlash === 'function') {
    setTimeout(function() {
      var form = document.getElementById('crm-contact-form');
      if (form) _crmAttachSlash(form);
    }, 0);
  }
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

  var speciesOpts = [
    ['blue_flower','💙 Blue Flower'], ['calla','🤍 Calla'], ['daffodil','📸 Daffodil'],
    ['daisy','🌼 Daisy'], ['pink','💗 Pink'], ['purple','💜 Purple'],
    ['sunflower','🌻 Sunflower'], ['tulip','🌷 Tulip']
  ].map(function(s) {
    return '<option value="'+s[0]+'">'+s[1]+'</option>';
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
      <label class="block">
        <span class="text-xs text-gray-500 dark:text-zinc-400">Species</span>
        <select id="crm-bud-species" class="mt-1 w-full rounded border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm px-2 py-1.5 text-gray-800 dark:text-zinc-100">
          ${speciesOpts}
        </select>
      </label>
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
