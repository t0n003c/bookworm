// home-page-crm-gallery.js
// Gallery view — dispatcher + 5 card styles: cards | compact | profile | minimal | photo.
// Globals from home-page-crm.js / siblings:
//   _crmPid, _crmContacts, _crmFields, _crmQuery, _crmGalleryStyle
//   _crmEsc, _crmSetMain, _crmFiltered, _crmRender, _crmFetch, _crmFieldDisplay
//   crmColVisible, crmOpenEdit, crmDeleteContact, _crmBulkMode, _crmSelected
'use strict';

var _galDragId = null;

// ── Gallery style setter ──────────────────────────────────────────────────────
function crmSetGalleryStyle(s) {
  if (typeof _crmGalleryStyle !== 'undefined') _crmGalleryStyle = s;
  localStorage.setItem('bw_crm_gstyle', s);
  if (typeof crmRenderToolbar === 'function') crmRenderToolbar(); // show/hide slider
  _crmRenderGallery();
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function _galAvatar(c, dimCls, rndCls, txtCls) {
  var inner = c.profile_pic
    ? `<img src="${_crmEsc(c.profile_pic)}" class="${dimCls} ${rndCls} object-cover flex-shrink-0" alt=""/>`
    : `<div class="${dimCls} ${rndCls} flex-shrink-0 flex items-center justify-center ${txtCls} leading-none
            bg-gradient-to-br from-[#e8f0ff] to-[#c7d8ff] dark:from-zinc-700 dark:to-zinc-600">${_crmEsc(c.avatar_emoji||'👤')}</div>`;
  var bud = (window._crmBudHealthMap||{})[String(c.id)];
  if (!bud) return inner;
  var hp = bud.health||0, col = hp>=75?'#2a8703':hp>=40?'#ffc220':'#ea1100', ico = hp>=75?'🌸':hp>=40?'🌼':'🦇';
  return '<div class="relative">' + inner
    + '<div class="absolute bottom-0 right-0 flex items-center gap-0.5 bg-white/90 dark:bg-zinc-900/90 rounded-tl-lg px-1 py-0.5" title="Bud HP ' + hp + '">'
    + '<span class="text-[10px] leading-none">' + ico + '</span>'
    + '<div class="w-8 h-1 bg-gray-200 rounded-full overflow-hidden ml-0.5">'
    + '<div class="h-full rounded-full" style="width:' + hp + '%;background:' + col + '"></div>'
    + '</div></div></div>';
}

function _galTags(c, cv) {
  if (!cv('tags')) return '';
  return (c.tags||'').split(',').filter(Boolean).map(t =>
    `<span class="inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium
            bg-[#e8f0ff] dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-300">${_crmEsc(t.trim())}</span>`
  ).join(' ');
}

function _galCfRows(c, cv) {
  return (typeof _crmFields !== 'undefined' ? _crmFields : [])
    .filter(f => cv(`cf_${f.id}`))
    .map(f => {
      var display = (typeof _crmFieldDisplay === 'function') ? _crmFieldDisplay(f, c) : '';
      if (!display) return '';
      if (f.field_type === 'checkbox') {
        var isChecked = display === '\u2705';
        return `<label onclick="event.stopPropagation()" class="flex items-center gap-1.5 text-[11px] mt-0.5 cursor-pointer select-none">
          <input type="checkbox" ${isChecked?'checked':''}
            onchange="crmQuickCheckbox(event,${c.id},${f.id},this.checked)"
            class="accent-[#0053e2] w-3.5 h-3.5 flex-shrink-0 cursor-pointer"/>
          <span class="${isChecked?'text-gray-700 dark:text-zinc-200':'text-gray-400 dark:text-zinc-500'} truncate">${_crmEsc(f.label)}</span>
        </label>`;
      }
      return `<div class="flex items-baseline gap-1 text-[11px] mt-0.5">
        <span class="text-gray-400 dark:text-zinc-500 flex-shrink-0 truncate max-w-[70px]" title="${_crmEsc(f.label)}">${_crmEsc(f.label)}:</span>
        <span class="text-gray-700 dark:text-zinc-200 truncate">${display}</span>
      </div>`;
    }).filter(Boolean).join('');
}

function _galGroupHdr(rows, i, c) {
  if (typeof _crmGroupField !== 'string' || !_crmGroupField || typeof _crmGroupValue !== 'function') return '';
  var gC = _crmGroupValue(c, _crmGroupField);
  var gP = i > 0 ? _crmGroupValue(rows[i-1], _crmGroupField) : null;
  if (gC === gP) return '';
  return `<div class="col-span-full text-[11px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider pt-2 pb-1 border-b border-gray-200 dark:border-zinc-700">${_crmEsc(gC||'—')}</div>`;
}

function _galDragAttrs(c, bulkMode) {
  if (bulkMode) return `data-cid="${c.id}"`;
  return `draggable="true" data-cid="${c.id}"
    ondragstart="crmGalDragStart(event,${c.id})"
    ondragover="crmGalDragOver(event)"
    ondragleave="crmGalDragLeave(event)"
    ondrop="crmGalDrop(event,${c.id})"
    ondragend="crmGalDragEnd()"`;
}

function _galActionBtns(c) {
  return `
    <button onclick="event.stopPropagation();crmOpenEdit(${c.id})" title="Edit contact"
      class="w-5 h-5 rounded flex items-center justify-center text-xs leading-none
             text-gray-300 dark:text-zinc-600
             hover:text-[#0053e2] dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition">✎</button>
    <button onclick="event.stopPropagation();crmDeleteContact(${c.id})" title="Delete contact"
      class="w-5 h-5 rounded flex items-center justify-center text-xs leading-none
             text-gray-300 dark:text-zinc-600
             hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition">✕</button>
    <button onclick="event.stopPropagation();_crmTrackAsBud(${c.id},${_crmEsc(JSON.stringify(c.name||''))})" title="Track as Bud"
      class="w-5 h-5 rounded flex items-center justify-center text-xs leading-none
             text-gray-300 dark:text-zinc-600
             hover:text-pink-500 dark:hover:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-900/20 transition">🌸</button>`;
}

// ── Main dispatcher ────────────────────────────────────────────────────────────
function _crmRenderGallery() {
  if (typeof _crmLoadColPrefs === 'function') _crmLoadColPrefs(_crmPid);
  var cv   = (typeof crmColVisible === 'function') ? crmColVisible : () => true;
  var rows = _crmFiltered();
  if (!rows.length) {
    _crmSetMain(`<p class="text-sm text-gray-400 dark:text-zinc-500 text-center mt-12">
      ${_crmQuery ? 'No contacts match your search.' : 'No contacts yet — click <strong>+ Contact</strong> to add one.'}</p>`);
    return;
  }
  var style = (typeof _crmGalleryStyle !== 'undefined') ? _crmGalleryStyle : 'cards';
  if      (style === 'compact') _crmRenderGallery_compact(rows, cv);
  else if (style === 'profile') _crmRenderGallery_profile(rows, cv);
  else if (style === 'minimal') _crmRenderGallery_minimal(rows, cv);
  else if (style === 'photo')   _crmRenderGallery_photo(rows, cv);
  else                          _crmRenderGallery_cards(rows, cv);
}

// ── Style: cards (default) ─────────────────────────────────────────────────────────────────
// Horizontal cards — square avatar on the left, info stacks on the right.
// Card height collapses to content — no forced min-height, no wasted space.
// Card + avatar size is driven by window._crmCardSize (1–5), set by the toolbar slider.
function _crmRenderGallery_cards(rows, cv) {
  // Size scale: step 1 = smallest, step 5 = largest
  var step       = Math.max(1, Math.min(5, window._crmCardSize || 3));
  var cardMin    = 200 + (step - 1) * 60;  // 200 / 260 / 320 / 380 / 440
  var cardMax    = cardMin + 40;
  var avatarPx   = 80  + (step - 1) * 20;  // 80  / 100 / 120 / 140 / 160
  var rowMinH    = [56, 72, 90, 112, 136][step - 1]; // flex row min-height
  var padY       = [6,  10, 14, 20,  28][step - 1];  // info panel vertical padding (always grows)
  var emojiPx    = [24, 30, 36, 42,  48][step - 1];  // emoji font-size px
  var bulkMode = typeof _crmBulkMode !== 'undefined' && _crmBulkMode;
  var html = rows.map(function(c, i) {
    var tags   = _galTags(c, cv);
    var cfRows = _galCfRows(c, cv);
    var grpHdr = _galGroupHdr(rows, i, c);
    var isSel  = typeof _crmSelected !== 'undefined' && _crmSelected.has(c.id);
    var selCls = bulkMode && isSel
      ? 'ring-2 ring-[#0053e2]'
      : 'ring-2 ring-transparent hover:ring-[#0053e2]/30';

    // Square avatar — sized to content, stretches to match info height
    var avatarInner = c.profile_pic
      ? `<img src="${_crmEsc(c.profile_pic)}"
             class="absolute inset-0 w-full h-full object-cover" alt=""/>`
      : `<div class="absolute inset-0 flex items-center justify-center leading-none
               bg-gradient-to-br from-[#e8f0ff] to-[#c7d8ff] dark:from-zinc-700 dark:to-zinc-600"
             style="font-size:${emojiPx}px">
           ${_crmEsc(c.avatar_emoji||'\uD83D\uDC64')}
         </div>`;

    var bud = (window._crmBudHealthMap||{})[String(c.id)];
    var budBar = bud ? (function() {
      var hp  = bud.health || 0;
      var col = hp >= 75 ? '#2a8703' : hp >= 40 ? '#ffc220' : '#ea1100';
      var ico = hp >= 75 ? '\uD83C\uDF38' : hp >= 40 ? '\uD83C\uDF3C' : '\uD83E\uDD87';
      return `<div class="absolute bottom-0 left-0 right-0 flex items-center gap-1
                   bg-black/30 px-1.5 py-0.5" title="Bud HP ${hp}">
        <span class="text-[10px] leading-none">${ico}</span>
        <div class="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
          <div class="h-full rounded-full" style="width:${hp}%;background:${col}"></div>
        </div>
      </div>`;
    })() : '';

    return grpHdr + `
      <div class="crm-gallery-card group relative bg-white dark:bg-zinc-900 rounded-xl shadow-sm
                  hover:shadow-lg transition-all duration-150 overflow-hidden cursor-pointer
                  border border-gray-100 dark:border-zinc-800 ${selCls}"
           ${_galDragAttrs(c, bulkMode)}
           onclick="typeof _crmBulkMode!=='undefined'&&_crmBulkMode?crmBulkToggle(${c.id}):crmOpenDetail(${c.id})">
        <div class="h-[3px] bg-gradient-to-r from-[#0053e2] to-[#ffc220]"></div>
        <div class="flex" style="min-height:${rowMinH}px">

          <!-- Avatar panel — width+height both set inline; flex row min-height does the rest -->
          <div class="relative flex-shrink-0 bg-gray-100 dark:bg-zinc-800"
               style="width:${avatarPx}px;min-height:${rowMinH}px">
            ${avatarInner}
            ${budBar}
            ${bulkMode ? `<label onclick="event.stopPropagation()" class="absolute top-2 left-2 z-10">
              <input type="checkbox" ${isSel?'checked':''}
                onchange="crmBulkToggle(${c.id},this.checked)"
                class="w-4 h-4 accent-[#0053e2] cursor-pointer"/></label>` : ''}
          </div>

          <!-- Info — padY scales with step so height grows even with dense content -->
          <div class="flex-1 min-w-0 flex flex-col justify-center"
               style="padding:${padY}px 12px ${padY}px 20px">
            <div class="flex items-start justify-between gap-1">
              <p class="font-semibold text-sm text-gray-900 dark:text-zinc-100 truncate leading-tight">
                ${_crmEsc(c.name||'\u2014')}
              </p>
              <div class="flex gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
                ${_galActionBtns(c)}
              </div>
            </div>
            ${cv('company')&&c.company ? `<p class="text-[11px] text-gray-500 dark:text-zinc-400 truncate mt-0.5">${_crmEsc(c.company)}</p>` : ''}
            ${cv('email')&&c.email    ? `<a href="mailto:${_crmEsc(c.email)}" onclick="event.stopPropagation()"
              class="text-[11px] text-[#0053e2] dark:text-blue-400 truncate hover:underline block mt-0.5">
              ${_crmEsc(c.email)}</a>` : ''}
            ${cv('phone')&&c.phone   ? `<p class="text-[11px] text-gray-500 dark:text-zinc-400 mt-0.5">${_crmEsc(_crmPhone(c.phone))}</p>` : ''}
            ${cfRows ? `<div class="mt-1 min-w-0">${cfRows}</div>` : ''}
            ${tags   ? `<div class="flex flex-wrap gap-1 mt-1.5">${tags}</div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
  // auto-fill caps card width so the info panel never stretches empty.
  // On mobile (<640 px) a single full-width column is forced regardless of
  // the size slider — the slider is hidden on mobile anyway.
  var _galCols = window.innerWidth < 640
    ? '1fr'
    : 'repeat(auto-fill,minmax(' + cardMin + 'px,' + cardMax + 'px))';
  _crmSetMain(`<div class="grid gap-3" style="grid-template-columns:${_galCols}">${html}</div>`);;
}
// ── Style: compact (list rows) ────────────────────────────────────────────────
// Full-width rows — small avatar, name + company + email on one line. Great for
// long contact lists where scanability beats visual richness.
function _crmRenderGallery_compact(rows, cv) {
  var bulkMode = typeof _crmBulkMode !== 'undefined' && _crmBulkMode;
  var html = rows.map((c, i) => {
    var isSel  = typeof _crmSelected !== 'undefined' && _crmSelected.has(c.id);
    var tags   = (c.tags||'').split(',').filter(Boolean);
    var grpHdr = _galGroupHdr(rows, i, c);
    var avatar = _galAvatar(c, 'w-9 h-9', 'rounded-full', 'text-base');
    var meta   = [cv('company')&&c.company?_crmEsc(c.company):'', cv('email')&&c.email?_crmEsc(c.email):''].filter(Boolean).join(' · ');
    var selBg  = bulkMode && isSel ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-zinc-800/60';
    return grpHdr + `
      <div class="crm-gallery-card group relative flex items-center gap-3 px-3 py-2.5 cursor-pointer
                  border-b border-gray-100 dark:border-zinc-800 transition ${selBg}"
           ${_galDragAttrs(c, bulkMode)}
           onclick="typeof _crmBulkMode!=='undefined'&&_crmBulkMode?crmBulkToggle(${c.id}):crmOpenDetail(${c.id})">
        ${bulkMode?`<input type="checkbox" ${isSel?'checked':''} onchange="crmBulkToggle(${c.id},this.checked)"
          onclick="event.stopPropagation()" class="w-4 h-4 accent-[#0053e2] cursor-pointer flex-shrink-0"/>`:''}
        <div class="flex-shrink-0">${avatar}</div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-gray-900 dark:text-zinc-100 truncate leading-tight">${_crmEsc(c.name||'—')}</p>
          ${meta?`<p class="text-[11px] text-gray-400 dark:text-zinc-500 truncate">${meta}</p>`:''}
        </div>
        ${cv('phone')&&c.phone?`<p class="text-[11px] text-gray-400 dark:text-zinc-500 flex-shrink-0 hidden sm:block">${_crmEsc(_crmPhone(c.phone))}</p>`:''}
        ${tags.length?`<div class="hidden sm:flex gap-1 flex-shrink-0 items-center">
          ${tags.slice(0,3).map(t=>`<span class="w-2 h-2 rounded-full bg-[#0053e2] opacity-50" title="${_crmEsc(t.trim())}"></span>`).join('')}
          ${tags.length>3?`<span class="text-[10px] text-gray-400 dark:text-zinc-500">+${tags.length-3}</span>`:''}
        </div>`:''}
        <div class="opacity-0 group-hover:opacity-100 flex gap-0.5 flex-shrink-0 transition">
          <button onclick="event.stopPropagation();crmOpenEdit(${c.id})" title="Edit"
            class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-300
                   hover:text-[#0053e2] hover:bg-blue-50 dark:hover:bg-blue-900/20 transition">✎</button>
          <button onclick="event.stopPropagation();crmDeleteContact(${c.id})" title="Delete"
            class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-300
                   hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">✕</button>
        </div>
      </div>`;
  }).join('');
  _crmSetMain(`<div>${html}</div>`);
}

// ── Style: profile (portrait cards) ───────────────────────────────────────────
// Centered portrait layout — avatar rings up from a header gradient. LinkedIn /
// Contacts app feel. Denser column count, great for photo-heavy contact books.
function _crmRenderGallery_profile(rows, cv) {
  var bulkMode = typeof _crmBulkMode !== 'undefined' && _crmBulkMode;
  var html = rows.map((c, i) => {
    var isSel  = typeof _crmSelected !== 'undefined' && _crmSelected.has(c.id);
    var tags   = _galTags(c, cv);
    var grpHdr = _galGroupHdr(rows, i, c);
    var selCls = bulkMode && isSel ? 'ring-2 ring-[#0053e2]' : 'ring-2 ring-transparent hover:ring-[#0053e2]/30';
    return grpHdr + `
      <div class="crm-gallery-card group relative bg-white dark:bg-zinc-900 rounded-2xl shadow-sm
                  hover:shadow-lg transition-all duration-150 overflow-hidden cursor-pointer
                  border border-gray-100 dark:border-zinc-800 flex flex-col ${selCls}"
           ${_galDragAttrs(c, bulkMode)}
           onclick="typeof _crmBulkMode!=='undefined'&&_crmBulkMode?crmBulkToggle(${c.id}):crmOpenDetail(${c.id})">
        ${bulkMode?`<label onclick="event.stopPropagation()" class="absolute top-2 left-2 z-10">
          <input type="checkbox" ${isSel?'checked':''} onchange="crmBulkToggle(${c.id},this.checked)"
            class="w-4 h-4 accent-[#0053e2] cursor-pointer"/></label>`:''}
        <div class="absolute top-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition z-10">
          ${_galActionBtns(c)}
        </div>
        <div class="h-14 bg-gradient-to-br from-[#e8f0ff] to-[#c7d8ff] dark:from-zinc-800 dark:to-zinc-700 flex-shrink-0"></div>
        <div class="flex flex-col items-center px-4 pb-4 -mt-7">
          <div class="ring-4 ring-white dark:ring-zinc-900 rounded-full mb-2 flex-shrink-0">
            ${_galAvatar(c, 'w-14 h-14', 'rounded-full', 'text-2xl')}
          </div>
          <p class="font-bold text-sm text-gray-900 dark:text-zinc-100 text-center truncate w-full leading-tight">${_crmEsc(c.name||'—')}</p>
          ${cv('company')&&c.company?`<p class="text-[11px] text-gray-500 dark:text-zinc-400 text-center truncate w-full mt-0.5">${_crmEsc(c.company)}</p>`:''}
          ${cv('email')&&c.email?`<a href="mailto:${_crmEsc(c.email)}" onclick="event.stopPropagation()"
            class="text-[11px] text-[#0053e2] dark:text-blue-400 truncate hover:underline mt-1 w-full text-center block">${_crmEsc(c.email)}</a>`:''}
          ${tags?`<div class="flex flex-wrap gap-1 justify-center mt-2">${tags}</div>`:''}
        </div>
      </div>`;
  }).join('');
  _crmSetMain(`<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">${html}</div>`);
}

// ── Style: minimal (text-dense) ────────────────────────────────────────────────
// No big avatar — just a colored initial badge. Maximum contacts per screen.
// Great for power users who know their contacts by name.
function _crmRenderGallery_minimal(rows, cv) {
  var bulkMode = typeof _crmBulkMode !== 'undefined' && _crmBulkMode;
  var html = rows.map((c, i) => {
    var isSel   = typeof _crmSelected !== 'undefined' && _crmSelected.has(c.id);
    var grpHdr  = _galGroupHdr(rows, i, c);
    var initial = (c.name||'?')[0].toUpperCase();
    var hue     = [...(c.name||'?')].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 360;
    var selCls  = bulkMode && isSel ? 'ring-2 ring-[#0053e2]' : 'ring-1 ring-transparent hover:ring-[#0053e2]/30';
    return grpHdr + `
      <div class="crm-gallery-card group relative bg-white dark:bg-zinc-900 rounded-xl cursor-pointer
                  border border-gray-200 dark:border-zinc-800 p-3
                  hover:border-[#0053e2]/40 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition ${selCls}"
           ${_galDragAttrs(c, bulkMode)}
           onclick="typeof _crmBulkMode!=='undefined'&&_crmBulkMode?crmBulkToggle(${c.id}):crmOpenDetail(${c.id})">
        ${bulkMode?`<input type="checkbox" ${isSel?'checked':''} onchange="crmBulkToggle(${c.id},this.checked)"
          onclick="event.stopPropagation()" class="absolute top-2 left-2 w-4 h-4 accent-[#0053e2] cursor-pointer"/>`:''}
        <div class="flex items-center gap-2 mb-1">
          <div class="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center
                      text-[11px] font-bold text-white leading-none"
               style="background:hsl(${hue},55%,52%)">${_crmEsc(initial)}</div>
          <p class="font-semibold text-sm text-gray-900 dark:text-zinc-100 truncate flex-1 leading-tight">${_crmEsc(c.name||'—')}</p>
          <div class="opacity-0 group-hover:opacity-100 flex gap-0.5 flex-shrink-0 transition">
            <button onclick="event.stopPropagation();crmOpenEdit(${c.id})" title="Edit"
              class="w-5 h-5 rounded flex items-center justify-center text-xs
                     text-gray-300 hover:text-[#0053e2] transition">✎</button>
            <button onclick="event.stopPropagation();crmDeleteContact(${c.id})" title="Delete"
              class="w-5 h-5 rounded flex items-center justify-center text-xs
                     text-gray-300 hover:text-red-500 transition">✕</button>
          </div>
        </div>
        ${cv('company')&&c.company?`<p class="text-[11px] text-gray-400 dark:text-zinc-500 truncate">${_crmEsc(c.company)}</p>`:''}
        ${cv('email')&&c.email?`<p class="text-[11px] text-[#0053e2]/70 dark:text-blue-500 truncate">${_crmEsc(c.email)}</p>`:''}
      </div>`;
  }).join('');
  _crmSetMain(`<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">${html}</div>`);
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

// ── Style: photo (full-bleed photo wall) ───────────────────────────────────────────────
// Square cards where the photo IS the card. No fields shown.
// Name + company overlaid at the bottom with a dark gradient scrim.
// Click → crmOpenDetail().
function _crmRenderGallery_photo(rows, cv) {
  // Step 3 = 260px (large default). Steps 1-2 shrink, 4-5 grow.
  var step   = Math.max(1, Math.min(5, window._crmCardSize || 3));
  var cellPx = [130, 190, 260, 320, 390][step - 1];
  var bulkMode = typeof _crmBulkMode !== 'undefined' && _crmBulkMode;
  var html = rows.map(function(c, i) {
    var isSel  = typeof _crmSelected !== 'undefined' && _crmSelected.has(c.id);
    var grpHdr = _galGroupHdr(rows, i, c);
    var selCls = bulkMode && isSel
      ? 'ring-4 ring-[#0053e2]'
      : 'ring-4 ring-transparent hover:ring-[#0053e2]/40';

    // Full-bleed image or emoji fallback
    var thumb = c.profile_pic
      ? `<img src="${_crmEsc(c.profile_pic)}"
             class="absolute inset-0 w-full h-full object-cover"
             alt="${_crmEsc(c.name||'')}"/>`
      : `<div class="absolute inset-0 flex items-center justify-center
               bg-gradient-to-br from-[#e8f0ff] to-[#c7d8ff]
               dark:from-zinc-700 dark:to-zinc-600 leading-none select-none"
             style="font-size:${Math.round(cellPx * 0.38)}px">
           ${_crmEsc(c.avatar_emoji || '\uD83D\uDC64')}
         </div>`;

    return grpHdr + `
      <div class="crm-gallery-card group relative overflow-hidden rounded-2xl
                  cursor-pointer aspect-square shadow-sm
                  hover:shadow-xl transition-all duration-150 ${selCls}"
           ${_galDragAttrs(c, bulkMode)}
           onclick="typeof _crmBulkMode!=='undefined'&&_crmBulkMode?crmBulkToggle(${c.id}):crmOpenDetail(${c.id})">

        ${thumb}

        <!-- Dark gradient scrim + name at the bottom -->
        <div class="absolute inset-x-0 bottom-0 pt-10
                    bg-gradient-to-t from-black/80 via-black/30 to-transparent
                    px-3 pb-3">
          <p class="text-white font-bold text-xl truncate leading-tight drop-shadow-lg">
            ${_crmEsc(c.name || '\u2014')}
          </p>
          ${c.company ? `<p class="text-white/70 text-sm truncate mt-0.5">${_crmEsc(c.company)}</p>` : ''}
        </div>

        <!-- Action buttons — appear on hover, top-right -->
        <div class="absolute top-2 right-2 flex gap-0.5
                    opacity-0 group-hover:opacity-100 transition">
          ${_galActionBtns(c)}
        </div>

        <!-- Bulk select checkbox — top-left -->
        ${bulkMode ? `<label onclick="event.stopPropagation()" class="absolute top-2 left-2 z-10">
          <input type="checkbox" ${isSel ? 'checked' : ''}
            onchange="crmBulkToggle(${c.id}, this.checked)"
            class="w-4 h-4 accent-[#0053e2] cursor-pointer"/>
        </label>` : ''}
      </div>`;
  }).join('');

  var _photoCols = window.innerWidth < 640
    ? '1fr'
    : 'repeat(auto-fill,minmax(' + cellPx + 'px,' + cellPx + 'px))';
  _crmSetMain(`<div class="grid gap-2" style="grid-template-columns:${_photoCols}">${html}</div>`);
}
