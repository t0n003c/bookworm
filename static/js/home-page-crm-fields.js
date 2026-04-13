'use strict';
/**
 * CRM Custom Fields modal — home-page-crm-fields.js
 * Loaded after home-page-crm.js (see base.html).
 * Handles the ⚙ Fields modal: list, add, edit, delete custom field definitions.
 * All state (_crmFields, _crmPid, etc.) lives in home-page-crm.js (global scope).
 */

const _CRM_FIELD_TYPE_DEFS = [
  {v:'text',l:'Text'},{v:'select',l:'Select'},{v:'multi_select',l:'Multi-select'},
  {v:'checkbox',l:'Checkbox'},{v:'url',l:'URL'},{v:'email',l:'Email'},
  {v:'date',l:'Date'},{v:'number',l:'Number'},{v:'file_links',l:'File links'},
];
const _CRM_TYPE_LABELS = Object.fromEntries(_CRM_FIELD_TYPE_DEFS.map(t => [t.v, t.l]));

// ── Fields list modal ─────────────────────────────────────────────────────────
function crmOpenFields() {
  const typeOpts = _CRM_FIELD_TYPE_DEFS.map(t => `<option value="${t.v}">${t.l}</option>`).join('');
  const list = _crmFields.map(f => `
    <div class="flex items-center gap-2 py-1.5 border-b border-gray-100 dark:border-zinc-800">
      <span class="flex-1 text-sm text-gray-800 dark:text-zinc-100">${_crmEsc(f.label)}</span>
      <span class="text-xs text-gray-400 dark:text-zinc-500 px-2 py-0.5 rounded bg-gray-100 dark:bg-zinc-800">${_CRM_TYPE_LABELS[f.field_type]||f.field_type}</span>
      <button onclick="crmEditField(${f.id})" class="text-gray-300 hover:text-[#0053e2] transition text-xs">✎</button>
      <button onclick="crmDeleteField(${f.id})" class="text-gray-300 hover:text-red-500 transition text-xs">✕</button>
    </div>`).join('') || '<p class="text-sm text-gray-400 dark:text-zinc-500 py-3">No custom fields yet.</p>';

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
        <div id="crm-field-options-wrap" style="display:none">
          <label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">
            Options <span class="text-red-400">*</span>
            <span class="font-normal text-gray-400">(pipe-separated — e.g. Low|Medium|High)</span>
          </label>
          <input name="options" id="crm-field-options"
            placeholder="Low|Medium|High"
            class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-2 py-1.5 text-sm
                   bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                   focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
        </div>
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
  var wrap = document.getElementById('crm-field-options-wrap');
  if (wrap) wrap.style.display = ['select','multi_select'].includes(sel.value) ? 'block' : 'none';
}

async function crmSaveField(e, fieldId) {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('crm-field-err');
  const label = form.querySelector('[name="label"]').value.trim();
  if (!label) { _crmShowErr(errEl, 'Label is required.'); return; }
  const body = new URLSearchParams({
    label,
    field_type: form.querySelector('[name="field_type"]').value,
    options: (form.querySelector('[name="options"]')?.value || '').trim(),
  });
  const url = fieldId
    ? `/home/crm/${_crmPid}/fields/${fieldId}/update`
    : `/home/crm/${_crmPid}/fields/add`;
  try {
    _crmFields = await _crmFetch(url, {method:'POST', body});
    crmOpenFields();
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

// ── Edit field modal ───────────────────────────────────────────────────────────
function crmEditField(id) {
  const f = _crmFields.find(x => x.id === id);
  if (!f) return;
  const showOpts = ['select','multi_select'].includes(f.field_type);
  _crmShowModal(`
    <div class="h-1.5 w-full bg-gradient-to-r from-[#0053e2] to-[#ffc220]"></div>
    <div class="p-6">
      <h2 class="text-base font-bold text-gray-900 dark:text-zinc-100 mb-4">✎ Edit Field</h2>
      <form id="crm-field-edit-form" onsubmit="crmSaveFieldEdit(event,${id})">
        <label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Label</label>
        <input name="label" value="${_crmEsc(f.label)}" required
          class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm
                 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                 focus:outline-none focus:ring-1 focus:ring-[#0053e2] mb-3"/>
        <input type="hidden" name="field_type" value="${f.field_type}"/>
        <p class="text-xs text-gray-400 dark:text-zinc-500 mb-3">
          Type: <strong class="text-gray-600 dark:text-zinc-300">${_CRM_TYPE_LABELS[f.field_type]||f.field_type}</strong>
          <span class="ml-1 italic">(to change type, delete and re-add)</span>
        </p>
        ${showOpts ? `
          <label class="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">Options <span class="font-normal text-gray-400">(pipe-separated)</span></label>
          <input name="options" value="${_crmEsc(f.options||'')}" placeholder="Option A|Option B|Option C"
            class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm
                   bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                   focus:outline-none focus:ring-1 focus:ring-[#0053e2] mb-3"/>` :
          '<input type="hidden" name="options" value=""/>'}
        <p id="crm-field-edit-err" class="hidden text-xs text-red-500 mb-2"></p>
        <div class="flex gap-2 justify-end">
          <button type="button" onclick="crmCloseModal()"
            class="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                   text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">Cancel</button>
          <button type="submit"
            class="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#0053e2] text-white hover:bg-blue-700 transition">
            Save Field</button>
        </div>
      </form>
    </div>`);
}

async function crmSaveFieldEdit(e, fieldId) {
  e.preventDefault();
  const form = e.target;
  const errEl = document.getElementById('crm-field-edit-err');
  const label = form.querySelector('[name="label"]').value.trim();
  if (!label) { _crmShowErr(errEl, 'Label is required.'); return; }
  const body = new URLSearchParams({
    label,
    field_type: form.querySelector('[name="field_type"]').value,
    options: (form.querySelector('[name="options"]')?.value || '').trim(),
  });
  try {
    _crmFields = await _crmFetch(`/home/crm/${_crmPid}/fields/${fieldId}/update`, {method:'POST', body});
    crmCloseModal();
    _crmRender();
  } catch(err) { _crmShowErr(errEl, err.message || 'Could not save field.'); }
}
