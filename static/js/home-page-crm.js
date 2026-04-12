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
    if (typeof initCrmPipeline === 'function') {
      initCrmPipeline(_crmPid, _crmStages, _crmDeals, _crmContacts);
    }
    return;
  }
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

// ── Table view ────────────────────────────────────────────────────────────────
function _crmRenderTable() {
  const rows = _crmFiltered();
  const thCls = 'px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 whitespace-nowrap';
  const tdCls = 'px-3 py-2 text-sm text-gray-700 dark:text-zinc-200 whitespace-nowrap max-w-[160px] truncate';

  const fieldCols = _crmFields.map(f =>
    `<th class="${thCls}">${_crmEsc(f.label)}</th>`
  ).join('');

  const bodyRows = rows.length ? rows.map(c => {
    const tags = (c.tags||'').split(',').filter(Boolean).map(t =>
      `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 mr-0.5">${_crmEsc(t.trim())}</span>`
    ).join('');
    const fieldVals = _crmFields.map(f =>
      `<td class="${tdCls}">${_crmEsc((c.field_values||{})[f.id] || '')}</td>`
    ).join('');
    return `<tr class="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition">
      <td class="px-3 py-2 text-xl leading-none">${_crmEsc(c.avatar_emoji||'👤')}</td>
      <td class="${tdCls} font-semibold">
        <button onclick="crmOpenEdit(${c.id})" class="hover:text-[#0053e2] transition text-left">${_crmEsc(c.name||'—')}</button>
      </td>
      <td class="${tdCls}">${_crmEsc(c.company||'')}</td>
      <td class="${tdCls}"><a href="mailto:${_crmEsc(c.email||'')}" class="hover:text-[#0053e2]">${_crmEsc(c.email||'')}</a></td>
      <td class="${tdCls}">${_crmEsc(c.phone||'')}</td>
      <td class="px-3 py-2 text-sm">${tags||'—'}</td>
      ${fieldVals}
      <td class="px-3 py-2 text-right whitespace-nowrap">
        <button onclick="crmOpenEdit(${c.id})" title="Edit"
          class="text-gray-300 hover:text-[#0053e2] transition mr-1">✎</button>
        <button onclick="crmDeleteContact(${c.id})" title="Delete"
          class="text-gray-300 hover:text-red-500 transition">✕</button>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="${6 + _crmFields.length + 1}"
      class="text-center text-sm text-gray-400 dark:text-zinc-500 py-12">
      ${_crmQuery ? 'No contacts match your search.' : 'No contacts yet — click <strong>+ Contact</strong> to add one.'}
    </td></tr>`;

  _crmSetMain(`
    <div class="overflow-x-auto rounded-xl border border-gray-200 dark:border-zinc-700">
      <table class="w-full min-w-max bg-white dark:bg-zinc-900">
        <thead class="bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
          <tr>
            <th class="${thCls} w-8"></th>
            <th class="${thCls}">Name</th>
            <th class="${thCls}">Company</th>
            <th class="${thCls}">Email</th>
            <th class="${thCls}">Phone</th>
            <th class="${thCls}">Tags</th>
            ${fieldCols}
            <th class="${thCls} w-16"></th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <p class="mt-2 text-[11px] text-gray-400 dark:text-zinc-600 text-right">${rows.length} contact${rows.length !== 1 ? 's' : ''}</p>
  `);
}

// ── Gallery view ──────────────────────────────────────────────────────────────
function _crmRenderGallery() {
  const rows = _crmFiltered();
  if (!rows.length) {
    _crmSetMain(`<p class="text-sm text-gray-400 dark:text-zinc-500 text-center mt-12">
      ${_crmQuery ? 'No contacts match your search.' : 'No contacts yet — click <strong>+ Contact</strong> to add one.'}</p>`);
    return;
  }
  const cards = rows.map(c => {
    const tags = (c.tags||'').split(',').filter(Boolean).map(t =>
      `<span class="inline-block px-1.5 py-0.5 rounded-full text-[10px]
              bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
        >${_crmEsc(t.trim())}</span>`
    ).join(' ');
    return `
      <div class="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700
                  rounded-2xl p-4 flex flex-col gap-2 shadow-sm hover:shadow-md transition">
        <div class="flex items-center gap-3">
          <span class="text-3xl leading-none w-10 h-10 flex items-center justify-center
                       rounded-full bg-gray-100 dark:bg-zinc-800">${_crmEsc(c.avatar_emoji||'👤')}</span>
          <div class="min-w-0">
            <p class="font-semibold text-sm text-gray-900 dark:text-zinc-100 truncate">${_crmEsc(c.name||'—')}</p>
            <p class="text-xs text-gray-500 dark:text-zinc-400 truncate">${_crmEsc(c.company||'')}</p>
          </div>
        </div>
        ${c.email ? `<a href="mailto:${_crmEsc(c.email)}" class="text-xs text-[#0053e2] dark:text-blue-400 truncate hover:underline">${_crmEsc(c.email)}</a>` : ''}
        ${c.phone ? `<p class="text-xs text-gray-500 dark:text-zinc-400">${_crmEsc(c.phone)}</p>` : ''}
        ${tags ? `<div class="flex flex-wrap gap-1 mt-1">${tags}</div>` : ''}
        <div class="flex gap-2 mt-auto pt-2 border-t border-gray-100 dark:border-zinc-800">
          <button onclick="crmOpenEdit(${c.id})"
            class="flex-1 text-xs py-1 rounded-lg border border-gray-200 dark:border-zinc-700
                   text-gray-600 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2] transition">✎ Edit</button>
          <button onclick="crmDeleteContact(${c.id})"
            class="text-xs px-3 py-1 rounded-lg border border-gray-200 dark:border-zinc-700
                   text-gray-400 hover:border-red-400 hover:text-red-500 transition">✕</button>
        </div>
      </div>`;
  }).join('');
  _crmSetMain(`<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">${cards}</div>`);
}

function _crmFiltered() {
  if (!_crmQuery) return _crmContacts;
  return _crmContacts.filter(c => {
    const hay = [c.name, c.email, c.phone, c.company, c.tags].join(' ').toLowerCase();
    return hay.includes(_crmQuery);
  });
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
    if (f.field_type === 'select') {
      const opts = (f.options||'').split('|').filter(Boolean).map(o =>
        `<option value="${_crmEsc(o)}" ${o===val?'selected':''}>${_crmEsc(o)}</option>`
      ).join('');
      control = `<select name="cf_${f.id}"
        class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5
               text-sm bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
        <option value="">—</option>${opts}</select>`;
    } else {
      control = inp(`cf_${f.id}`, val, f.field_type === 'date' ? 'date' : f.field_type === 'number' ? 'number' : f.field_type === 'url' ? 'url' : 'text');
    }
    return `<div><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">${_crmEsc(f.label)}</label>${control}</div>`;
  }).join('');

  const body = `
    <div class="h-1.5 w-full bg-gradient-to-r from-[#0053e2] to-[#ffc220]"></div>
    <div class="p-6">
      <h2 class="text-base font-bold text-gray-900 dark:text-zinc-100 mb-4">${isEdit ? '✎ Edit Contact' : '+ Add Contact'}</h2>
      <form id="crm-contact-form" onsubmit="crmSaveContact(event,${c?c.id:0})">
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div class="col-span-2 flex gap-3 items-end">
            <div><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Avatar</label>
              <input name="avatar_emoji" value="${_crmEsc(c?c.avatar_emoji:'👤')}" maxlength="4"
                class="w-16 text-center text-2xl border border-gray-300 dark:border-zinc-700 rounded-lg py-1
                       bg-white dark:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/></div>
            <div class="flex-1"><label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Name <span class="text-red-400">*</span></label>
              ${inp('name', c?.name, 'text', 'Full name')}</div>
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
      const val = (data.get(`cf_${f.id}`) || '').trim();
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

// ── Fields modal ──────────────────────────────────────────────────────────────
function crmOpenFields() {
  const TYPE_LABELS = {text:'Text', select:'Select', url:'URL', date:'Date', number:'Number'};
  const list = _crmFields.map(f => `
    <div class="flex items-center gap-2 py-1.5 border-b border-gray-100 dark:border-zinc-800">
      <span class="flex-1 text-sm text-gray-800 dark:text-zinc-100">${_crmEsc(f.label)}</span>
      <span class="text-xs text-gray-400 dark:text-zinc-500 px-2 py-0.5 rounded bg-gray-100 dark:bg-zinc-800">${TYPE_LABELS[f.field_type]||f.field_type}</span>
      <button onclick="crmEditField(${f.id})" class="text-gray-300 hover:text-[#0053e2] transition text-xs">✎</button>
      <button onclick="crmDeleteField(${f.id})" class="text-gray-300 hover:text-red-500 transition text-xs">✕</button>
    </div>`).join('') || '<p class="text-sm text-gray-400 dark:text-zinc-500 py-3">No custom fields yet.</p>';

  const typeOpts = ['text','select','url','date','number'].map(t =>
    `<option value="${t}">${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('');

  _crmShowModal(`
    <div class="h-1.5 w-full bg-gradient-to-r from-[#0053e2] to-[#ffc220]"></div>
    <div class="p-6">
      <h2 class="text-base font-bold text-gray-900 dark:text-zinc-100 mb-3">⚙ Custom Fields</h2>
      <div class="mb-4">${list}</div>
      <form id="crm-field-form" onsubmit="crmSaveField(event,0)" class="space-y-2">
        <p class="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Add field</p>
        <div class="flex gap-2">
          <input name="label" placeholder="Field label" required
            class="flex-1 border border-gray-300 dark:border-zinc-700 rounded-lg px-2 py-1.5 text-sm
                   bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                   focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
          <select name="field_type"
            class="border border-gray-300 dark:border-zinc-700 rounded-lg px-2 py-1.5 text-sm
                   bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                   focus:outline-none focus:ring-1 focus:ring-[#0053e2]"
            onchange="crmToggleOptions(this)">${typeOpts}</select>
        </div>
        <input name="options" id="crm-field-options" placeholder="Options (pipe-separated): Low|Medium|High" style="display:none"
          class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-2 py-1.5 text-sm
                 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                 focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
        <p id="crm-field-err" class="hidden text-xs text-red-500"></p>
        <div class="flex gap-2 justify-end">
          <button type="button" onclick="crmCloseModal()"
            class="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                   text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">Close</button>
          <button type="submit"
            class="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#0053e2] text-white hover:bg-blue-700 transition">+ Add Field</button>
        </div>
      </form>
    </div>`);
}

function crmToggleOptions(sel) {
  const el = document.getElementById('crm-field-options');
  if (el) el.style.display = sel.value === 'select' ? 'block' : 'none';
}

async function crmSaveField(e, fieldId) {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('crm-field-err');
  const label = form.label.value.trim();
  if (!label) { _crmShowErr(errEl, 'Label is required.'); return; }
  const body = new URLSearchParams({
    label, field_type: form.field_type.value,
    options: (form.options?.value || '').trim(),
  });
  const url = fieldId
    ? `/home/crm/${_crmPid}/fields/${fieldId}/update`
    : `/home/crm/${_crmPid}/fields/add`;
  try {
    _crmFields = await _crmFetch(url, {method:'POST', body});
    crmOpenFields(); // re-render fields modal with updated list
  } catch(err) { _crmShowErr(errEl, err.message || 'Could not save field.'); }
}

async function crmDeleteField(id) {
  const f = _crmFields.find(x => x.id === id);
  if (!confirm(`Delete field "${f?.label}"? All contact values for this field will be lost.`)) return;
  try {
    _crmFields = await _crmFetch(`/home/crm/${_crmPid}/fields/${id}/delete`, {method:'POST'});
    crmOpenFields();
  } catch(e) { alert('Delete failed: ' + e.message); }
}

function crmEditField(id) {
  // For simplicity, editing a field just focuses the label input with existing values.
  // A full edit UI would be Phase 1.5 polish; for now, delete + re-add.
  alert('To edit a field, delete it and re-add it with the new settings.\n(Full inline edit coming soon.)');
}

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
