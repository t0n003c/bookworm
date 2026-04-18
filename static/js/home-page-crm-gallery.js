// home-page-crm-gallery.js
// Gallery view renderer, drag-and-drop reorder, and inline checkbox toggle.
// All globals it references (_crmPid, _crmContacts, _crmFields, _crmQuery,
// _crmEsc, _crmSetMain, _crmFiltered, _crmRender, _crmFetch, _crmFieldDisplay,
// crmColVisible, crmOpenEdit, crmDeleteContact) are defined in home-page-crm.js
// or its sibling modules and share the same global scope.
'use strict';

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
    const cfRows = (typeof _crmFields !== 'undefined' ? _crmFields : [])
      .filter(f => cv(`cf_${f.id}`))
      .map(f => {
        const display = (typeof _crmFieldDisplay === 'function') ? _crmFieldDisplay(f, c) : '';
        if (!display) return '';
        if (f.field_type === 'checkbox') {
          const isChecked = display === '\u2705';
          return `<label onclick="event.stopPropagation()" class="flex items-center gap-1.5 text-[11px] mt-0.5 cursor-pointer select-none">
            <input type="checkbox" ${isChecked ? 'checked' : ''}
              onchange="crmQuickCheckbox(event,${c.id},${f.id},this.checked)"
              class="accent-[#0053e2] w-3.5 h-3.5 flex-shrink-0 cursor-pointer"/>
            <span class="${isChecked ? 'text-gray-700 dark:text-zinc-200' : 'text-gray-400 dark:text-zinc-500'} truncate">${_crmEsc(f.label)}</span>
          </label>`;
        }
        return `<div class="flex items-baseline gap-1 text-[11px] mt-0.5">
          <span class="text-gray-400 dark:text-zinc-500 flex-shrink-0 truncate max-w-[70px]" title="${_crmEsc(f.label)}">${_crmEsc(f.label)}:</span>
          <span class="text-gray-700 dark:text-zinc-200 truncate">${display}</span>
        </div>`;
      }).filter(Boolean).join('');
    const isSelected = typeof _crmSelected !== 'undefined' && _crmSelected.has(c.id);
    const bulkMode    = typeof _crmBulkMode !== 'undefined' && _crmBulkMode;
    const cardSelCls  = bulkMode && isSelected ? 'ring-2 ring-[#0053e2]' : 'ring-2 ring-transparent hover:ring-[#0053e2]/20';
    return grpHdr + `
      <div class="crm-gallery-card relative bg-white dark:bg-zinc-900 rounded-2xl shadow-sm
                  hover:shadow-lg transition-all duration-150 overflow-hidden cursor-pointer
                  border border-gray-100 dark:border-zinc-800 ${cardSelCls}"
           draggable="${bulkMode ? 'false' : 'true'}" data-cid="${c.id}"
           onclick="typeof _crmBulkMode !== 'undefined' && _crmBulkMode ? crmBulkToggle(${c.id}) : crmOpenDetail(${c.id})"
           ondragstart="crmGalDragStart(event,${c.id})"
           ondragover="crmGalDragOver(event)"
           ondragleave="crmGalDragLeave(event)"
      ondrop="crmGalDrop(event,${c.id})"
           ondragend="crmGalDragEnd()">
        <div class="h-[3px] bg-gradient-to-r from-[#0053e2] to-[#ffc220]"></div>
        ${bulkMode ? `<label onclick="event.stopPropagation()" title="Select"
          class="absolute top-2 left-2 z-10 flex items-center justify-center">
          <input type="checkbox" ${isSelected?'checked':''}
            onchange="crmBulkToggle(${c.id},this.checked)"
            class="w-4 h-4 accent-[#0053e2] cursor-pointer"/>
        </label>` : ''}
        <button onclick="event.stopPropagation();crmOpenEdit(${c.id})" title="Edit contact"
          class="absolute top-2 right-2 w-5 h-5 rounded flex items-center justify-center
                 text-xs leading-none text-gray-300 dark:text-zinc-600
                 hover:text-[#0053e2] dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition">✎</button>
        <button onclick="event.stopPropagation();crmDeleteContact(${c.id})" title="Delete contact"
          class="absolute top-2 right-8 w-5 h-5 rounded flex items-center justify-center
                 text-xs leading-none text-gray-300 dark:text-zinc-600
                 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition">
          ✕</button>
        <button onclick="event.stopPropagation();_crmTrackAsBud(${c.id},${JSON.stringify(c.name||'')})" title="Track as Bud"
          class="absolute top-2 right-14 w-5 h-5 rounded flex items-center justify-center
                 text-xs leading-none text-gray-300 dark:text-zinc-600
                 hover:text-pink-500 dark:hover:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-900/20 transition">🌸</button>
        <div class="p-4 flex gap-3 items-start">
          <div class="flex flex-col items-center gap-1.5 flex-shrink-0 w-20">
            ${(function(){
              var bud = (window._crmBudHealthMap||{})[String(c.id)];
              if (!bud) return avatar;
              var hp  = bud.health || 0;
              var col = hp >= 75 ? '#2a8703' : hp >= 40 ? '#ffc220' : '#ea1100';
              var ico = hp >= 75 ? '🌸' : hp >= 40 ? '🌼' : '🦇';
              return '<div class="relative">' + avatar
                + '<div class="absolute bottom-0 right-0 flex items-center gap-0.5'
                + ' bg-white/90 dark:bg-zinc-900/90 rounded-tl-lg px-1 py-0.5" title="Bud HP ' + hp + '">'
                + '<span class="text-[10px] leading-none">' + ico + '</span>'
                + '<div class="w-8 h-1 bg-gray-200 rounded-full overflow-hidden ml-0.5">'
                + '<div class="h-full rounded-full" style="width:' + hp + '%;background:' + col + '"></div>'
                + '</div></div></div>';
            })()}
            ${tags ? `<div class="flex flex-wrap gap-1 w-full">${tags}</div>` : ''}
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sm text-gray-900 dark:text-zinc-100 truncate leading-tight">${_crmEsc(c.name||'—')}</p>
            ${cv('company') && c.company ? `<p class="text-[11px] text-gray-500 dark:text-zinc-400 truncate mt-0.5">${_crmEsc(c.company)}</p>` : ''}
            ${cv('email') && c.email ? `<a href="mailto:${_crmEsc(c.email)}" onclick="event.stopPropagation()"
              class="text-[11px] text-[#0053e2] dark:text-blue-400 truncate hover:underline block mt-1 leading-tight">${_crmEsc(c.email)}</a>` : ''}
            ${cv('phone') && c.phone ? `<p class="text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">${_crmEsc(c.phone)}</p>` : ''}
            ${cfRows}
          </div>
        </div>
      </div>`;
  }).join('');
  _crmSetMain(`<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">${cards}</div>`);
}

// ── Gallery drag-and-drop ─────────────────────────────────────────────────────
function _galCards() { return document.querySelectorAll('.crm-gallery-card'); }
function _galClearDrop() {
  _galCards().forEach(el => { el.classList.remove('ring-[#0053e2]/60','!shadow-lg'); el.style.opacity = ''; });
}
function crmGalDragStart(e, id) {
  _galDragId = id; e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { const el = e.target.closest('.crm-gallery-card'); if (el) el.style.opacity = '0.35'; }, 0);
}
function crmGalDragOver(e) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('ring-[#0053e2]/60','!shadow-lg');
}
function crmGalDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget))
    e.currentTarget.classList.remove('ring-[#0053e2]/60','!shadow-lg');
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
  _crmFetch(`/home/crm/${_crmPid}/contacts/reorder`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(_crmContacts.map(c => c.id)),
  }).then(fresh => { _crmContacts = fresh; }).catch(() => {});
}
function crmGalDragEnd() { _galClearDrop(); _galDragId = null; }

// ── Inline checkbox toggle (no modal) ────────────────────────────────────────
async function crmQuickCheckbox(e, cid, fid, checked) {
  e.stopPropagation();
  var val = checked ? '1' : '0';
  await _crmFetch(`/home/crm/${_crmPid}/contacts/${cid}/field-value`,
    {method:'POST', body: new URLSearchParams({field_id: fid, value: val})}
  ).catch(err => alert('Could not save: ' + err.message));
  var c = _crmContacts.find(x => x.id === cid);
  if (c) (c.field_values = c.field_values || {})[fid] = val;
}
