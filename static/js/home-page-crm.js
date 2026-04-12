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
var _crmView     = 'table';   // 'table' | 'gallery' | 'pipeline'
var _crmQuery    = '';

// ── Entry point ───────────────────────────────────────────────────────────────
function initCrmPage(pid) {
  _crmPid  = pid;
  _crmView = localStorage.getItem('bw_crm_view') || 'table';
  _crmQuery = '';
  if (typeof _crmColPrefsLoaded !== 'undefined') _crmColPrefsLoaded = false; // reset on nav
  if (typeof _crmLoadColPrefs  === 'function')   _crmLoadColPrefs(pid);
  const s = document.getElementById('crm-search');
  if (s) s.value = '';
  _crmRenderViewToggle();
  _crmLoadAll();
}

async function _crmLoadAll() {
  _crmSetMain('<p class="text-sm text-gray-400 dark:text-zinc-500 text-center mt-12">Loading…</p>');
  try {
    const [contacts, fields, stages, deals] = await Promise.all([
      _crmFetch(`/home/crm/${_crmPid}/contacts`),
      _crmFetch(`/home/crm/${_crmPid}/fields`),
      _crmFetch(`/home/crm/${_crmPid}/stages`),
      _crmFetch(`/home/crm/${_crmPid}/deals`),
    ]);
    _crmContacts = contacts;
    _crmFields   = fields;
    _crmStages   = stages;
    _crmDeals    = deals;
    _crmRender();
  } catch(e) {
    _crmSetMain(`<p class="text-sm text-red-500 text-center mt-12">Failed to load: ${_crmEsc(e.message)}</p>`);
  }
}

function _crmRender() {
  if (_crmView === 'pipeline') {
    const tb = document.getElementById('crm-toolbar');
    if (tb) tb.innerHTML = '';
    if (typeof initCrmPipeline === 'function') {
      initCrmPipeline(_crmPid, _crmStages, _crmDeals, _crmContacts);
    }
    return;
  }
  if (typeof crmRenderToolbar === 'function') crmRenderToolbar();
  _crmView === 'gallery' ? _crmRenderGallery() : _crmRenderTable();
}

// ── View toggle ───────────────────────────────────────────────────────────────
function _crmRenderViewToggle() {
  const el = document.getElementById('crm-view-toggle');
  if (!el) return;
  const btn = (v, label) => {
    const on = _crmView === v;
    return `<button onclick="crmSetView('${v}')"
      class="text-[11px] px-2.5 py-1 rounded-lg border transition
             ${on ? 'bg-[#0053e2] text-white border-[#0053e2]'
                  : 'border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 hover:border-[#0053e2]'}"
    >${label}</button>`;
  };
  el.innerHTML = btn('table','☰ Table') + btn('gallery','⊞ Gallery') + btn('pipeline','⬜ Pipeline');
}

function crmSetView(v) {
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
      <th class="${thCls} w-10"></th>
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
      if (col.id === 'name') return `<td class="${tdCls} font-semibold"><button onclick="crmOpenEdit(${c.id})" class="hover:text-[#0053e2] transition text-left">${_crmEsc(c.name||'—')}</button></td>`;
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

    const avatarCell = `<td class="px-3 py-2">${c.profile_pic
      ? `<img src="${_crmEsc(c.profile_pic)}" class="w-8 h-8 rounded-full object-cover" alt=""/>`
      : `<span class="text-xl leading-none">${_crmEsc(c.avatar_emoji||'👤')}</span>`}</td>`;

    return grpHdr + `<tr class="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition">
      ${avatarCell}${dataCells}
      <td class="px-3 py-2 text-right whitespace-nowrap">
        <button onclick="crmOpenEdit(${c.id})" title="Edit" class="text-gray-300 hover:text-[#0053e2] transition mr-1">✎</button>
        <button onclick="crmDeleteContact(${c.id})" title="Delete" class="text-gray-300 hover:text-red-500 transition">✕</button>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="${cols.length+2}" class="text-center text-sm text-gray-400 dark:text-zinc-500 py-12">
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

// ── Gallery view ──────────────────────────────────────────────────────────────
var _galDragId = null;

function _crmRenderGallery() {
  if (typeof _crmLoadColPrefs === 'function') _crmLoadColPrefs(_crmPid);
  const cv = (typeof crmColVisible === 'function') ? crmColVisible : () => true;
  const rows = _crmFiltered();
  if (!rows.length) {
    _crmSetMain(`<p class="text-sm text-gray-400 dark:text-zinc-500 text-center mt-12">
      ${_crmQuery ? 'No contacts match your search.' : 'No contacts yet — click <strong>+ Contact</strong> to add one.'}</p>`);
    return;
  }
  const cards = rows.map((c, i) => {
    const tags = cv('tags') ? (c.tags||'').split(',').filter(Boolean).map(t =>
      `<span class="inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium
              bg-[#e8f0ff] dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-300"
        >${_crmEsc(t.trim())}</span>`
    ).join(' ') : '';
    let grpHdr = '';
    if (typeof _crmGroupField === 'string' && _crmGroupField && typeof _crmGroupValue === 'function') {
      const gC = _crmGroupValue(c, _crmGroupField);
      const gP = i > 0 ? _crmGroupValue(rows[i-1], _crmGroupField) : null;
      if (gC !== gP) grpHdr = `<div class="col-span-full text-[11px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider pt-2 pb-1 border-b border-gray-200 dark:border-zinc-700">${_crmEsc(gC||'—')}</div>`;
    }
    const avatar = c.profile_pic
      ? `<img src="${_crmEsc(c.profile_pic)}" class="w-20 h-20 rounded-xl object-cover flex-shrink-0" alt=""/>`
      : `<div class="w-20 h-20 rounded-xl flex-shrink-0 flex items-center justify-center text-3xl leading-none
              bg-gradient-to-br from-[#e8f0ff] to-[#c7d8ff] dark:from-zinc-700 dark:to-zinc-600">${_crmEsc(c.avatar_emoji||'👤')}</div>`;
    // Custom fields — show only visible, non-empty ones
    const cfRows = (typeof _crmFields !== 'undefined' ? _crmFields : [])
      .filter(f => cv(`cf_${f.id}`))
      .map(f => {
        const display = (typeof _crmFieldDisplay === 'function') ? _crmFieldDisplay(f, c) : '';
        if (!display || display === '☐') return ''; // skip blanks and unchecked checkboxes
        return `<div class="flex items-baseline gap-1 text-[11px] mt-0.5">
          <span class="text-gray-400 dark:text-zinc-500 flex-shrink-0 truncate max-w-[70px]" title="${_crmEsc(f.label)}">${_crmEsc(f.label)}:</span>
          <span class="text-gray-700 dark:text-zinc-200 truncate">${display}</span>
        </div>`;
      }).filter(Boolean).join('');
    return grpHdr + `
      <div class="crm-gallery-card relative bg-white dark:bg-zinc-900 rounded-2xl shadow-sm
                  hover:shadow-lg transition-all duration-150 overflow-hidden cursor-pointer
                  border border-gray-100 dark:border-zinc-800
                  ring-2 ring-transparent hover:ring-[#0053e2]/20"
           draggable="true" data-cid="${c.id}"
           onclick="crmOpenEdit(${c.id})"
           ondragstart="crmGalDragStart(event,${c.id})"
           ondragover="crmGalDragOver(event)"
           ondragleave="crmGalDragLeave(event)"
           ondrop="crmGalDrop(event,${c.id})"
           ondragend="crmGalDragEnd()">
        <div class="h-[3px] bg-gradient-to-r from-[#0053e2] to-[#ffc220]"></div>
        <div class="p-4 flex gap-3 items-start">
          ${avatar}
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sm text-gray-900 dark:text-zinc-100 truncate leading-tight">${_crmEsc(c.name||'—')}</p>
            ${cv('company') && c.company ? `<p class="text-[11px] text-gray-500 dark:text-zinc-400 truncate mt-0.5">${_crmEsc(c.company)}</p>` : ''}
            ${cv('email') && c.email ? `<a href="mailto:${_crmEsc(c.email)}" onclick="event.stopPropagation()"
              class="text-[11px] text-[#0053e2] dark:text-blue-400 truncate hover:underline block mt-1 leading-tight">${_crmEsc(c.email)}</a>` : ''}
            ${cv('phone') && c.phone ? `<p class="text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">${_crmEsc(c.phone)}</p>` : ''}
            ${cfRows}
          </div>
        </div>
        ${tags ? `<div class="px-4 pb-3 flex flex-wrap gap-1">${tags}</div>` : '<div class="pb-1"></div>'}
      </div>`;
  }).join('');
  _crmSetMain(`<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">${cards}</div>`);
}

// ── Gallery drag-and-drop ───────────────────────────────────────────────
function _galCards() { return document.querySelectorAll('.crm-gallery-card'); }
function _galClearDrop() {
  _galCards().forEach(el => {
    el.classList.remove('ring-[#0053e2]/60', '!shadow-lg');
    el.style.opacity = '';
  });
}

function crmGalDragStart(e, id) {
  _galDragId = id;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { const el = e.target.closest('.crm-gallery-card'); if (el) el.style.opacity = '0.35'; }, 0);
}
function crmGalDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('ring-[#0053e2]/60', '!shadow-lg');
}
function crmGalDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget))
    e.currentTarget.classList.remove('ring-[#0053e2]/60', '!shadow-lg');
}
function crmGalDrop(e, toId) {
  e.preventDefault();
  _galClearDrop();
  if (!_galDragId || _galDragId === toId) { _galDragId = null; return; }
  const fi = _crmContacts.findIndex(c => c.id === _galDragId);
  const ti = _crmContacts.findIndex(c => c.id === toId);
  if (fi < 0 || ti < 0) { _galDragId = null; return; }
  const [moved] = _crmContacts.splice(fi, 1);
  _crmContacts.splice(ti, 0, moved);
  _galDragId = null;
  _crmRenderGallery();
  // persist asynchronously — fire and forget, re-sync on success
  _crmFetch(`/home/crm/${_crmPid}/contacts/reorder`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(_crmContacts.map(c => c.id)),
  }).then(fresh => { _crmContacts = fresh; }).catch(() => {});
}
function crmGalDragEnd() { _galClearDrop(); _galDragId = null; }

function _crmFiltered() {
  if (typeof _crmProcessed === 'function') return _crmProcessed();
  if (!_crmQuery) return _crmContacts;
  return _crmContacts.filter(c => {
    const hay = [c.name, c.email, c.phone, c.company, c.tags].join(' ').toLowerCase();
    return hay.includes(_crmQuery);
  });
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
      return `<div class="flex items-center gap-2 pt-4">
        <input type="checkbox" name="cf_${f.id}" value="1" ${val==='1'?'checked':''} id="cf_chk_${f.id}"
          class="w-4 h-4 rounded accent-[#0053e2]"/>
        <label for="cf_chk_${f.id}" class="text-sm text-gray-700 dark:text-zinc-200 cursor-pointer">${_crmEsc(f.label)}</label>
      </div>`;
    }
    if (f.field_type === 'multi_select') {
      var ms = []; try { ms = JSON.parse(val); } catch {}
      const opts = (f.options||'').split('|').filter(Boolean);
      control = `<div class="flex flex-wrap gap-x-3 gap-y-1">${opts.length
        ? opts.map(o => `<label class="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" name="cf_${f.id}" value="${_crmEsc(o)}" ${ms.includes(o)?'checked':''} class="w-3.5 h-3.5 rounded accent-[#0053e2]"/>
            ${_crmEsc(o)}</label>`).join('')
        : '<span class="text-xs text-gray-400">No options — edit field to add some.</span>'
      }</div>`;
    } else if (f.field_type === 'file_links') {
      var fl = []; try { fl = JSON.parse(val); } catch {}
      control = `<textarea name="cf_${f.id}" rows="2" placeholder="One URL per line"
        class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               focus:outline-none focus:ring-1 focus:ring-[#0053e2]">${_crmEsc(fl.join('\n'))}</textarea>`;
    } else if (f.field_type === 'select') {
      const opts = (f.options||'').split('|').filter(Boolean).map(o =>
        `<option value="${_crmEsc(o)}" ${o===val?'selected':''}>${_crmEsc(o)}</option>`
      ).join('');
      control = `<select name="cf_${f.id}"
        class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5
               text-sm bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
        <option value="">—</option>${opts}</select>`;
    } else {
      const iType = {date:'date', number:'number', url:'url', email:'email'}[f.field_type] || 'text';
      control = inp(`cf_${f.id}`, val, iType);
    }
    return `<div><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">${_crmEsc(f.label)}</label>${control}</div>`;
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
        <div class="flex gap-2 justify-end pt-2">
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
}

async function crmSaveContact(e, contactId) {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('crm-contact-err');
  const saveBtn = document.getElementById('crm-contact-save');
  if (!saveBtn) return; // modal not open (defensive)
  if (!form.name.value.trim()) {
    _crmShowErr(errEl, 'Name is required.'); return;
  }
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

async function crmDeleteContact(id) {
  const c = _crmContacts.find(x => x.id === id);
  if (!confirm(`Delete "${c?.name || 'this contact'}"? This cannot be undone.`)) return;
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
  document.getElementById('crm-modal-body').innerHTML = html;
  document.getElementById('crm-modal').classList.remove('hidden');
  document.getElementById('crm-backdrop').classList.remove('hidden');
}

function crmCloseModal() {
  document.getElementById('crm-modal').classList.add('hidden');
  document.getElementById('crm-backdrop').classList.add('hidden');
  document.getElementById('crm-modal-body').innerHTML = '';
}

function _crmSetMain(html) {
  const el = document.getElementById('crm-main');
  if (el) el.innerHTML = html;
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
