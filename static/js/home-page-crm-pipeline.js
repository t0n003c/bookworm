'use strict';
/**
 * CRM Kanban Pipeline — home-page-crm-pipeline.js
 * Loaded after home-page-crm.js. Entry point: initCrmPipeline().
 * Calls window.crmReload() after any mutation to refresh shared state.
 */

// ── Module state ─────────────────────────────────────────────────────────────
var _ppPid      = null;
var _ppStages   = [];
var _ppDeals    = [];
var _ppContacts = [];
var _ppDragId   = null;  // deal id currently being dragged

// Colour palette for stage picker
var _PP_COLOURS = [
  '#0053e2','#2a8703','#ea1100','#ffc220','#7c3aed',
  '#0891b2','#d97706','#be185d','#64748b','#1d4ed8',
];

// ── Entry point ───────────────────────────────────────────────────────────────
window.initCrmPipeline = function(pid, stages, deals, contacts) {
  _ppPid      = pid;
  _ppStages   = stages  || [];
  _ppDeals    = deals   || [];
  _ppContacts = contacts || [];
  _ppRender();
};

// ── Board render ──────────────────────────────────────────────────────────────
function _ppRender() {
  const byStage = {};
  for (const s of _ppStages) byStage[s.id] = [];
  const unsorted = [];
  for (const d of _ppDeals) {
    if (d.stage_id && byStage[d.stage_id]) byStage[d.stage_id].push(d);
    else unsorted.push(d);
  }

  let cols = '';
  if (unsorted.length) cols += _ppColumn(null, 'Unsorted', '#64748b', unsorted, null);
  for (const s of _ppStages) cols += _ppColumn(s.id, s.name, s.color, byStage[s.id] || [], s);

  cols += `
    <div class="flex-shrink-0 flex items-start pt-1">
      <button onclick="ppOpenStage(null)"
        class="text-sm px-4 py-2 rounded-xl border-2 border-dashed border-gray-300 dark:border-zinc-700
               text-gray-400 hover:border-[#0053e2] hover:text-[#0053e2] transition whitespace-nowrap">
        + Stage
      </button>
    </div>`;

  const empty = _ppStages.length === 0 && unsorted.length === 0;

  document.getElementById('crm-main').innerHTML = `
    <div class="px-2 pt-1 pb-4">
      ${empty ? _ppEmptyState() : ''}
      <div class="flex gap-4 overflow-x-auto pb-2 items-start" style="min-height:420px">
        ${cols}
      </div>
    </div>`;
}

function _ppEmptyState() {
  return `
    <p class="text-center text-sm text-gray-400 dark:text-zinc-500 mb-6 mt-2">
      No stages yet — click <strong>+ Stage</strong> to build your pipeline.
    </p>`;
}

function _ppColumn(stageId, name, color, deals, stage) {
  const total    = deals.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const valLabel = total > 0 ? ` · $${total.toLocaleString()}` : '';
  const isUnsorted = stageId === null;
  const sid = stageId ?? 'null';

  const actions = stage ? `
    <button onclick="event.stopPropagation();ppOpenStage(${stage.id})"
      class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-[#0053e2] transition text-xs px-0.5">✎</button>
    <button onclick="event.stopPropagation();ppDeleteStage(${stage.id})"
      class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition text-xs px-0.5">✕</button>
  ` : '';

  const cards = deals.length
    ? deals.map(d => _ppCard(d)).join('')
    : `<div class="text-center text-[11px] text-gray-300 dark:text-zinc-600 py-6 select-none leading-relaxed">
        No deals yet<br><span class="text-[10px] italic">Add one below ↓ or drag a card from another column</span>
      </div>`;

  return `
    <div class="flex-shrink-0 w-60 flex flex-col rounded-xl border border-gray-200 dark:border-zinc-700
                bg-gray-50 dark:bg-zinc-800/50 group"
         data-stage-id="${sid}"
         ondragover="ppDragOver(event,'${sid}')"
         ondrop="ppDrop(event,'${sid}')">
      <div class="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-zinc-700 rounded-t-xl">
        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${_ppEsc(color)}"></span>
        <span class="font-semibold text-[13px] text-gray-800 dark:text-zinc-100 truncate flex-1">${_ppEsc(name)}</span>
        <span class="text-[10px] text-gray-400 dark:text-zinc-500 whitespace-nowrap">${deals.length}${valLabel}</span>
        ${actions}
      </div>
      <div class="flex-1 overflow-y-auto p-2 space-y-2 min-h-[80px]"
           id="pp-zone-${sid}"
           ondragover="ppDragOver(event,'${sid}')"
           ondrop="ppDrop(event,'${sid}')">
        ${cards}
      </div>
      ${!isUnsorted ? `
        <div class="px-3 py-2 border-t border-gray-200 dark:border-zinc-700 rounded-b-xl">
          <button onclick="ppOpenDeal(null,${stageId})"
            class="w-full text-xs text-gray-400 hover:text-[#0053e2] transition text-left py-0.5">
            + Add deal
          </button>
        </div>` : ''}
    </div>`;
}

function _ppCard(d) {
  const c   = _ppContacts.find(x => x.id === d.contact_id);
  const val = Number(d.value) > 0
    ? `<span class="text-[10px] text-green-600 dark:text-green-400 font-semibold ml-auto">$${Number(d.value).toLocaleString()}</span>`
    : '';
  const cname = c
    ? `<p class="text-[10px] text-gray-400 dark:text-zinc-500 truncate mt-0.5">${_ppEsc(c.name)}</p>` : '';
  return `
    <div class="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700
                rounded-lg p-2.5 cursor-grab active:cursor-grabbing shadow-sm select-none
                hover:shadow-md hover:border-[#0053e2]/40 transition group/card"
         draggable="true" data-deal-id="${d.id}"
         ondragstart="ppDragStart(event,${d.id})"
         ondragend="ppDragEnd(event)">
      <div class="flex items-start gap-1">
        <p class="text-[12px] font-medium text-gray-800 dark:text-zinc-100 truncate flex-1">${_ppEsc(d.title)}</p>
        <div class="flex gap-1 opacity-0 group-hover/card:opacity-100 transition flex-shrink-0">
          <button onclick="event.stopPropagation();ppOpenDeal(${d.id},${d.stage_id ?? 'null'})"
            class="text-gray-300 hover:text-[#0053e2] text-[10px]">✎</button>
          <button onclick="event.stopPropagation();ppDeleteDeal(${d.id})"
            class="text-gray-300 hover:text-red-500 text-[10px]">✕</button>
        </div>
      </div>
      <div class="flex items-center gap-1">
        ${cname}
        ${val}
      </div>
    </div>`;
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────
window.ppDragStart = function(evt, dealId) {
  _ppDragId = dealId;
  evt.dataTransfer.effectAllowed = 'move';
  evt.currentTarget.style.opacity = '0.4';
};

window.ppDragEnd = function(evt) {
  evt.currentTarget.style.opacity = '';
  document.querySelectorAll('[data-stage-id]').forEach(el => {
    el.classList.remove('ring-2','ring-[#0053e2]');
  });
};

window.ppDragOver = function(evt, stageId) {
  evt.preventDefault();
  evt.dataTransfer.dropEffect = 'move';
  // Highlight the column being hovered
  const col = document.querySelector(`[data-stage-id="${stageId}"]`);
  if (col) col.classList.add('ring-2','ring-[#0053e2]');
};

window.ppDrop = function(evt, stageId) {
  evt.preventDefault();
  document.querySelectorAll('[data-stage-id]').forEach(el => {
    el.classList.remove('ring-2','ring-[#0053e2]');
  });
  if (_ppDragId === null) return;
  const sid        = stageId === 'null' ? '' : String(stageId);
  const zoneDeals  = _ppDeals.filter(d => String(d.stage_id ?? 'null') === String(stageId));
  const sort_order = zoneDeals.length;   // append to end
  _ppFetch(`/home/crm/${_ppPid}/deals/${_ppDragId}/move`, {
    method: 'POST',
    body: new URLSearchParams({ stage_id: sid, sort_order }),
  }).then(() => crmReload()).catch(err => console.error('[pipeline] move failed:', err));
  _ppDragId = null;
};

// ── Stage modal ───────────────────────────────────────────────────────────────
window.ppOpenStage = function(stageId) {
  const s       = _ppStages.find(x => x.id === stageId) || null;
  const title   = s ? 'Edit Stage' : 'Add Stage';
  const name    = s ? s.name  : '';
  const color   = s ? s.color : '#0053e2';
  const swatches = _PP_COLOURS.map(c => `
    <button type="button" onclick="_ppPickColor('${c}')"
      class="w-7 h-7 rounded-full border-2 transition hover:scale-110"
      style="background:${c};border-color:${c === color ? '#111' : 'transparent'}"
      data-swatch="${c}"></button>`).join('');
  const action  = s ? `/home/crm/${_ppPid}/stages/${s.id}/update` : `/home/crm/${_ppPid}/stages/add`;

  _ppShowModal(`
    <form id="pp-stage-form" onsubmit="ppSaveStage(event,'${action}')">
      <h3 class="text-base font-bold mb-4 text-gray-800 dark:text-zinc-100">${title}</h3>
      <label class="block text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1">Stage name</label>
      <input id="pp-stage-name" name="name" type="text" value="${_ppEsc(name)}" required
        class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 px-3 py-2 text-sm
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 mb-4
               focus:outline-none focus:ring-2 focus:ring-[#0053e2]"/>
      <label class="block text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-2">Colour</label>
      <input type="hidden" id="pp-stage-color" name="color" value="${color}"/>
      <div class="flex gap-2 flex-wrap mb-5">${swatches}</div>
      <div class="flex justify-end gap-2">
        <button type="button" onclick="_ppCloseModal()"
          class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700 transition">
          Cancel</button>
        <button type="submit"
          class="px-4 py-2 text-sm rounded-lg bg-[#0053e2] text-white font-semibold hover:bg-[#0042b5] transition">
          Save</button>
      </div>
    </form>`);
  setTimeout(() => document.getElementById('pp-stage-name')?.focus(), 50);
};

window._ppPickColor = function(color) {
  document.getElementById('pp-stage-color').value = color;
  document.querySelectorAll('[data-swatch]').forEach(b => {
    b.style.borderColor = b.dataset.swatch === color ? '#111' : 'transparent';
  });
};

window.ppSaveStage = function(evt, action) {
  evt.preventDefault();
  const fd = new FormData(document.getElementById('pp-stage-form'));
  _ppFetch(action, { method: 'POST', body: new URLSearchParams(fd) })
    .then(() => { _ppCloseModal(); crmReload(); })
    .catch(err => alert('Save failed: ' + err.message));
};

window.ppDeleteStage = function(stageId) {
  if (!confirm('Delete this stage? Deals in it will become unsorted.')) return;
  _ppFetch(`/home/crm/${_ppPid}/stages/${stageId}/delete`, { method: 'POST' })
    .then(() => crmReload())
    .catch(err => alert('Delete failed: ' + err.message));
};

// ── Deal modal ────────────────────────────────────────────────────────────────
window.ppOpenDeal = function(dealId, defaultStageId) {
  const d       = _ppDeals.find(x => x.id === dealId) || null;
  const title   = d ? 'Edit Deal' : 'Add Deal';
  const opts    = _ppContacts.map(c =>
    `<option value="${c.id}" ${d?.contact_id === c.id ? 'selected' : ''}>${_ppEsc(c.name)}</option>`
  ).join('');
  const stageOpts = _ppStages.map(s =>
    `<option value="${s.id}" ${(d ? d.stage_id === s.id : s.id === defaultStageId) ? 'selected' : ''}>${_ppEsc(s.name)}</option>`
  ).join('');
  const action  = d
    ? `/home/crm/${_ppPid}/deals/${d.id}/update`
    : `/home/crm/${_ppPid}/deals/add`;
  const stageField = d ? '' : `
    <label class="block text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1 mt-3">Stage</label>
    <select name="stage_id"
      class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 px-3 py-2 text-sm
             bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 mb-1 focus:outline-none focus:ring-2 focus:ring-[#0053e2]">
      <option value="">— Unsorted —</option>
      ${stageOpts}
    </select>`;

  _ppShowModal(`
    <form id="pp-deal-form" onsubmit="ppSaveDeal(event,'${action}')">
      <h3 class="text-base font-bold mb-4 text-gray-800 dark:text-zinc-100">${title}</h3>
      <label class="block text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1">Deal title</label>
      <input id="pp-deal-title" name="title" type="text" value="${_ppEsc(d?.title || '')}" required
        class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 px-3 py-2 text-sm
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 mb-3
               focus:outline-none focus:ring-2 focus:ring-[#0053e2]"/>
      <label class="block text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1">Value ($)</label>
      <input name="value" type="number" min="0" step="0.01" value="${d?.value ?? 0}"
        class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 px-3 py-2 text-sm
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 mb-3
               focus:outline-none focus:ring-2 focus:ring-[#0053e2]"/>
      <label class="block text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1">Contact (optional)</label>
      <select name="contact_id"
        class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 px-3 py-2 text-sm
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#0053e2]">
        <option value="">— None —</option>
        ${opts}
      </select>
      ${stageField}
      <div class="flex justify-end gap-2 mt-5">
        <button type="button" onclick="_ppCloseModal()"
          class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700 transition">
          Cancel</button>
        <button type="submit"
          class="px-4 py-2 text-sm rounded-lg bg-[#0053e2] text-white font-semibold hover:bg-[#0042b5] transition">
          Save</button>
      </div>
    </form>`);
  setTimeout(() => document.getElementById('pp-deal-title')?.focus(), 50);
};

window.ppSaveDeal = function(evt, action) {
  evt.preventDefault();
  const fd = new FormData(document.getElementById('pp-deal-form'));
  _ppFetch(action, { method: 'POST', body: new URLSearchParams(fd) })
    .then(() => { _ppCloseModal(); crmReload(); })
    .catch(err => alert('Save failed: ' + err.message));
};

window.ppDeleteDeal = function(dealId) {
  if (!confirm('Delete this deal?')) return;
  _ppFetch(`/home/crm/${_ppPid}/deals/${dealId}/delete`, { method: 'POST' })
    .then(() => crmReload())
    .catch(err => alert('Delete failed: ' + err.message));
};

// ── Modal helpers ─────────────────────────────────────────────────────────────
function _ppShowModal(html) {
  let el = document.getElementById('pp-modal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pp-modal';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
         onclick="if(event.target===this)_ppCloseModal()">
      <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4
                  border border-gray-200 dark:border-zinc-700">
        ${html}
      </div>
    </div>`;
}

window._ppCloseModal = function() {
  const el = document.getElementById('pp-modal');
  if (el) el.innerHTML = '';
};

// Close on Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') _ppCloseModal();
});

// ── Fetch wrapper ─────────────────────────────────────────────────────────────
function _ppFetch(url, opts) {
  return fetch(url, { credentials: 'same-origin', ...opts })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
}

// ── HTML escape ───────────────────────────────────────────────────────────────
function _ppEsc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
