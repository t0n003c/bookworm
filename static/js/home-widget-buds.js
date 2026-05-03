/* home-widget-buds.js — Buds friendship-health-tracker widget engine
   Rules: var at module scope (initHomeWidgets re-runs on HTMX nav).
   All fetch calls use credentials:'same-origin'.
*/

var _budsState          = _budsState          || {};  // {wid: {buds:[], busy:false}}
var _budsModalsInjected = _budsModalsInjected || false;

var _BUDS_SPECIES = ['blue_flower','calla','daffodil','daisy',
                     'pink','purple','sunflower','tulip'];
var _BUDS_NAMES   = {
  blue_flower:'Blue Flower', calla:'Calla Lily', daffodil:'Daffodil',
  daisy:'Daisy', pink:'Pink Flower', purple:'Purple Flower',
  sunflower:'Sunflower', tulip:'Tulip'
};

// ── Bootstrap ────────────────────────────────────────────────────────────────

function initBudsWidgets() {
  _budsInjectModals();
  document.querySelectorAll('.bw-buds-widget[data-widget-id]').forEach(function(el) {
    _budsInit(el.dataset.widgetId);
  });
}

function _budsRoot(wid) {
  return document.querySelector('.bw-buds-widget[data-widget-id="'+wid+'"]');
}

function _budsInit(wid) {
  _budsState[wid] = {buds: [], busy: false};
  fetch('/home/buds/'+wid+'/list', {credentials:'same-origin'})
    .then(function(r) { return r.ok ? r.json() : {buds:[]}; })
    .then(function(data) {
      _budsState[wid].buds = data.buds || [];
      _budsRender(wid);
    })
    .catch(function() {
      var el = _budsRoot(wid);
      if (el) el.innerHTML = '<p class="text-xs text-red-400 pt-2">Failed to load buds.</p>';
    });
}

// ── Render ───────────────────────────────────────────────────────────────────

function _budsFlowerImg(species, tier) {
  return '/static/img/buds/'+(species||'daisy')+'_'+(tier||0)+'.png';
}

function _budsHealthTier(h) { return h >= 70 ? 0 : h >= 50 ? 1 : 2; }

function _budsHealthColor(tier) {
  return tier === 0 ? '#2a8703' : tier === 1 ? '#ffc220' : '#ea1100';
}

function _budsWeekKey() {
  // ISO 8601: week belongs to the year of its Thursday.
  // Bug fixed: jan4.getDay() returns 0 for Sunday but ISO treats Sunday as 7,
  // so years where Jan 4 is a Sunday (e.g. 2026) produced week numbers one too low.
  var d   = new Date();
  var day = d.getDay() || 7;             // 1=Mon … 7=Sun
  var mon = new Date(d);
  mon.setDate(d.getDate() - day + 1);   // Monday of current week
  mon.setHours(0, 0, 0, 0);
  // Thursday of this week → determines which ISO year the week belongs to
  var thu = new Date(mon);
  thu.setDate(mon.getDate() + 3);
  var isoYear = thu.getFullYear();
  // Find the Monday that starts ISO week 1 of isoYear:
  // Jan 4 of isoYear is always in week 1; walk back to its Monday.
  var jan4    = new Date(isoYear, 0, 4);
  var jan4Day = jan4.getDay() || 7;     // 1=Mon … 7=Sun (Sunday→7, not 0)
  var w1Mon   = new Date(jan4);
  w1Mon.setDate(jan4.getDate() - jan4Day + 1);
  w1Mon.setHours(0, 0, 0, 0);
  var week = Math.round((mon - w1Mon) / (7 * 86400000)) + 1;
  return isoYear + '-W' + String(week).padStart(2, '0');
}

function _budsApplyDecay(bud) {
  if (!bud.health_updated_at) return bud.health;
  var anchor = new Date(bud.health_updated_at); anchor.setHours(0,0,0,0);
  var today  = new Date(); today.setHours(0,0,0,0);
  var days   = Math.max(0, Math.round((today - anchor) / 86400000));
  if (days <= 0) return bud.health;
  var loss   = (25 / Math.max(bud.see_every_days, 1)) * days;
  return Math.max(0, Math.min(100, bud.health - loss));
}

function _budsRender(wid) {
  var el  = _budsRoot(wid); if (!el) return;
  var st  = _budsState[wid] || {buds:[]};
  var cfg = {};
  try { cfg = JSON.parse(el.dataset.config || '{}'); } catch(e) {}
  var compact = (el.dataset.style === 'compact');

  if (!st.buds.length) {
    el.innerHTML = '<div class="flex flex-col items-center gap-2 py-6 text-center">'
      + '<span class="text-4xl">🌱</span>'
      + '<p class="text-sm text-gray-500 dark:text-zinc-400">No buds yet!<br>Add your first friend below.</p>'
      + '<button onclick="_budsAddOpen(\''+wid+'\')" class="mt-1 px-3 py-1.5 bg-wblue text-white'
      + ' text-xs font-semibold rounded-lg hover:bg-blue-700 transition">+ Add Bud</button></div>';
    return;
  }

  var cards = st.buds.map(function(b) {
    var h       = Math.round(_budsApplyDecay(b));
    var tier    = _budsHealthTier(h);
    var color   = _budsHealthColor(tier);
    var img     = _budsFlowerImg(b.flower_species, tier);
    var watered = (b.last_watered_week === _budsWeekKey());
    var hasPlan = !!(b.pending_plan);
    var waterCls   = watered
      ? 'text-gray-300 dark:text-zinc-600 cursor-not-allowed p-1'
      : 'hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 hover:text-blue-700 p-1.5';
    var waterTitle = watered ? 'Already watered this week' : 'Water — chat this week';
    var waterDis   = watered ? 'disabled' : '';
    var waterBtn = '<button title="'+waterTitle+'" '+waterDis
      +' onclick="_budsWater(\''+wid+'\','+b.id+')"'
      +' class="rounded-lg text-sm transition flex-shrink-0 '+waterCls+'">\uD83D\uDCA7</button>';

    // fertilizeBtn shared between compact and full layouts
    var fertilizeBtn = '<button title="'+(hasPlan?'View / complete visit plan':'Plan in-person visit')+'"'
      +' onclick="_budsFertilizeOpen(\''+wid+'\','+b.id+')"'
      +' class="p-1.5 rounded-lg text-sm hover:bg-green-50 dark:hover:bg-green-900/20'
      +' text-green-600 hover:text-green-800 transition '+(hasPlan?' ring-1 ring-green-400':'')+'">\uD83C\uDF31</button>';

    if (compact) {
      // ── Compact: dense list row — fits many buds in a small widget ──────────
      return '<div class="flex items-center gap-2 py-1 px-1 border-b border-gray-100'
        + ' dark:border-zinc-800 last:border-0">'
        + '<img src="'+img+'" class="w-8 h-8 object-contain flex-shrink-0 cursor-pointer opacity-90"'
        + '     onclick="_budsDetailOpen(\''+wid+'\','+b.id+')" alt="'+_esc(b.name)+'">'
        + '<div class="flex-1 min-w-0">'
        + '  <p class="text-xs font-medium text-gray-800 dark:text-zinc-100 truncate leading-tight">'+_esc(b.name)+'</p>'
        + '  <div class="h-1 bg-gray-200 dark:bg-zinc-700 rounded-full overflow-hidden mt-0.5">'
        + '    <div class="h-full rounded-full" style="width:'+h+'%;background:'+color+'"></div>'
        + '  </div>'
        + '</div>'
        + waterBtn
        + fertilizeBtn
        + '</div>';
    }

    // ── Full: spacious card with species, HP number, plan badge, all actions ──
    var planLabel = hasPlan
      ? ('<span class="text-xs text-blue-600 dark:text-blue-400">📅 '+_esc(b.pending_plan.planned_date)+'</span>')
      : '';
    var speciesName = _BUDS_NAMES[b.flower_species] || b.flower_species;
    return '<div class="flex items-center gap-3 rounded-xl border border-gray-100'
      + ' dark:border-zinc-700 bg-white dark:bg-zinc-800/60 p-3 shadow-sm">'
      + '<img src="'+img+'" class="w-16 h-16 object-contain flex-shrink-0 cursor-pointer"'
      + '     onclick="_budsDetailOpen(\''+wid+'\','+b.id+')" alt="'+_esc(b.name)+'">'
      + '<div class="flex-1 min-w-0">'
      + '  <p class="text-sm font-semibold text-gray-800 dark:text-zinc-100 truncate">'+_esc(b.name)+'</p>'
      + '  <p class="text-xs text-gray-400 dark:text-zinc-500 truncate mb-1">'+_esc(speciesName)+'</p>'
      + '  <div class="flex items-center gap-1">'
      + '    <div class="flex-1 h-2 bg-gray-200 dark:bg-zinc-600 rounded-full overflow-hidden">'
      + '      <div class="h-full rounded-full transition-all" style="width:'+h+'%;background:'+color+'"></div>'
      + '    </div>'
      + '    <span class="text-xs font-mono text-gray-400 w-8 text-right">'+h+'</span>'
      + '  </div>'
      + (planLabel ? '  <div class="mt-1">'+planLabel+'</div>' : '')
      + '</div>'
      + '<div class="flex flex-col items-center gap-1 flex-shrink-0">'
      + waterBtn
      + fertilizeBtn
      + '  <button title="Edit / delete"'
      + ' onclick="_budsMenuToggle(\''+wid+'\','+b.id+',event)"'
      + ' class="p-1.5 rounded-lg text-xs text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-700 hover:text-gray-600 transition">\u22EE</button>'
      + '</div>'
      + '</div>';
  }).join('');

  var wrapCls = compact ? 'flex flex-col pt-0.5' : 'flex flex-col gap-2 pt-1';
  el.innerHTML = '<div class="'+wrapCls+'">'+cards+'</div>'
    + '<div class="mt-2 flex justify-center">'
    + '<button onclick="_budsAddOpen(\''+wid+'\')" class="text-xs text-wblue hover:underline'
    + ' dark:text-blue-400">+ Add Bud</button></div>';
}

// ── Inline menu (edit / delete) ───────────────────────────────────────────────

function _budsMenuToggle(wid, budId, evt) {
  evt.stopPropagation();
  var existing = document.getElementById('buds-inline-menu');
  if (existing) { existing.remove(); if (existing.dataset.budId == budId) return; }
  var btn = evt.currentTarget;
  var rect = btn.getBoundingClientRect();
  var menu = document.createElement('div');
  menu.id = 'buds-inline-menu';
  menu.dataset.budId = budId;
  menu.className = 'fixed z-50 bg-white dark:bg-zinc-800 border border-gray-200'
    + ' dark:border-zinc-600 rounded-xl shadow-xl py-1 w-32';
  menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  menu.style.left = (rect.right  + window.scrollX - 128) + 'px';
  menu.innerHTML  =
    '<button onclick="_budsEditOpen(\''+wid+'\','+budId+')" class="w-full text-left px-3 py-1.5'
    + ' text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700">✏️ Edit</button>'
    + '<button onclick="_budsDelete(\''+wid+'\','+budId+')" class="w-full text-left px-3 py-1.5'
    + ' text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">🗑️ Delete</button>';
  document.body.appendChild(menu);
  setTimeout(function() {
    document.addEventListener('click', function _away(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click',_away); }
    });
  }, 0);
}

// ── Water ─────────────────────────────────────────────────────────────────────

function _budsWater(wid, budId) {
  if (_budsState[wid] && _budsState[wid].busy) return;
  if (_budsState[wid]) _budsState[wid].busy = true;
  fetch('/home/buds/'+wid+'/'+budId+'/water',
    {method:'POST', credentials:'same-origin'})
  .then(function(r) {
    if (r.status === 409) { window._bwToast && window._bwToast('Already watered this week!','warn'); return null; }
    return r.ok ? r.json() : null;
  })
  .then(function(data) {
    if (_budsState[wid]) _budsState[wid].busy = false;
    if (!data) return;
    var buds = _budsState[wid].buds;
    for (var i=0; i<buds.length; i++) {
      if (buds[i].id === data.bud.id) { buds[i] = data.bud; break; }
    }
    _budsRender(wid);
    window._bwToast && window._bwToast('💧 Watered! +10 HP','success');
  })
  .catch(function() {
    if (_budsState[wid]) _budsState[wid].busy = false;
    window._bwToast && window._bwToast('Water failed — try again','error');
  });
}

// ── Fertilize ─────────────────────────────────────────────────────────────────

function _budsFertilizeOpen(wid, budId) {
  var bud = _budsFindBud(wid, budId); if (!bud) return;
  var modal = document.getElementById('buds-fertilize-modal');
  if (!modal) return;
  modal.dataset.wid   = wid;
  modal.dataset.budId = budId;
  var plan = bud.pending_plan;
  document.getElementById('bfm-title').textContent = '🌱 ' + bud.name;
  document.getElementById('bfm-plan-date').value = plan ? (plan.planned_date||'') : '';
  document.getElementById('bfm-plan-note').value = plan ? (plan.note||'') : '';
  document.getElementById('bfm-complete-btn').style.display = plan ? '' : 'none';
  document.getElementById('bfm-complete-btn').dataset.planId = plan ? plan.id : '';
  modal.classList.remove('hidden');
}

function _budsFertilizeSubmit() {
  var modal = document.getElementById('buds-fertilize-modal');
  var wid   = modal.dataset.wid, budId = modal.dataset.budId;
  var date  = document.getElementById('bfm-plan-date').value;
  var note  = document.getElementById('bfm-plan-note').value;
  var fd    = new FormData();
  fd.append('planned_date', date);
  fd.append('note', note);
  fetch('/home/buds/'+wid+'/'+budId+'/fertilize-plan',
    {method:'POST', credentials:'same-origin', body:fd})
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (!data) return;
    _budsReloadWidget(wid);
    modal.classList.add('hidden');
    window._bwToast && window._bwToast('📅 Visit planned!','success');
  });
}

function _budsFertilizeComplete() {
  var modal  = document.getElementById('buds-fertilize-modal');
  var wid    = modal.dataset.wid, budId = modal.dataset.budId;
  var planId = document.getElementById('bfm-complete-btn').dataset.planId;
  fetch('/home/buds/'+wid+'/'+budId+'/fertilize-complete/'+planId,
    {method:'POST', credentials:'same-origin'})
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (!data) return;
    var buds = _budsState[wid].buds;
    for (var i=0; i<buds.length; i++) {
      if (buds[i].id == budId) { buds[i] = data.bud; break; }
    }
    _budsRender(wid);
    modal.classList.add('hidden');
    window._bwToast && window._bwToast('🌱 Visit logged! +25 HP','success');
  });
}

// ── Add / Edit ────────────────────────────────────────────────────────────────

function _budsAddOpen(wid) {
  var modal = document.getElementById('buds-add-edit-modal'); if (!modal) return;
  modal.dataset.wid   = wid;
  modal.dataset.budId = '';
  document.getElementById('baem-title').textContent     = '🌸 Add Bud';
  document.getElementById('baem-name').value            = '';
  document.getElementById('baem-days').value            = '7';
  document.getElementById('baem-notes').value           = '';
  document.getElementById('baem-crm-id').value          = '';
  _budsSelectSpecies('daisy');
  modal.classList.remove('hidden');
  document.getElementById('baem-name').focus();
}

function _budsEditOpen(wid, budId) {
  document.getElementById('buds-inline-menu') && document.getElementById('buds-inline-menu').remove();
  var bud = _budsFindBud(wid, budId); if (!bud) return;
  var modal = document.getElementById('buds-add-edit-modal'); if (!modal) return;
  modal.dataset.wid   = wid;
  modal.dataset.budId = budId;
  document.getElementById('baem-title').textContent  = '✏️ Edit Bud';
  document.getElementById('baem-name').value         = bud.name;
  document.getElementById('baem-days').value         = bud.see_every_days;
  document.getElementById('baem-notes').value        = bud.notes || '';
  document.getElementById('baem-crm-id').value       = bud.crm_contact_id || '';
  _budsSelectSpecies(bud.flower_species);
  modal.classList.remove('hidden');
}

function _budsSelectSpecies(species) {
  document.querySelectorAll('.buds-species-btn').forEach(function(btn) {
    var active = btn.dataset.species === species;
    btn.classList.toggle('ring-2',       active);
    btn.classList.toggle('ring-wblue',   active);
    btn.classList.toggle('ring-offset-1',active);
  });
  document.getElementById('baem-species').value = species;
}

function _budsAddEditSubmit() {
  var modal  = document.getElementById('buds-add-edit-modal');
  var wid    = modal.dataset.wid;
  var budId  = modal.dataset.budId;
  var name   = document.getElementById('baem-name').value.trim();
  if (!name) { document.getElementById('baem-name').focus(); return; }
  var fd = new FormData();
  fd.append('name',           name);
  fd.append('flower_species', document.getElementById('baem-species').value);
  fd.append('see_every_days', document.getElementById('baem-days').value);
  fd.append('notes',          document.getElementById('baem-notes').value);
  var crmId = document.getElementById('baem-crm-id').value;
  if (crmId) fd.append('crm_contact_id', crmId);
  var url = budId
    ? '/home/buds/'+wid+'/'+budId+'/update'
    : '/home/buds/'+wid+'/add';
  fetch(url, {method:'POST', credentials:'same-origin', body:fd})
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (!data) return;
    _budsState[wid].buds = data.buds;
    _budsRender(wid);
    modal.classList.add('hidden');
    window._bwToast && window._bwToast(budId ? 'Bud updated!' : '🌸 Bud added!', 'success');
    if (typeof invalidateHomePageCache === 'function')
      invalidateHomePageCache(sessionStorage.getItem('bw-hp'));
  });
}

// ── Delete ────────────────────────────────────────────────────────────────────

var _budsDelPending = null; // {wid, budId}

function _budsDelete(wid, budId) {
  document.getElementById('buds-inline-menu') && document.getElementById('buds-inline-menu').remove();
  var bud   = _budsFindBud(wid, budId);
  var modal = document.getElementById('buds-del-modal');
  if (!modal) {
    // safety fallback — modal missing from template, use native confirm
    if (!confirm('Remove ' + (bud ? bud.name : 'this bud') + '?')) return;
    _budsDoPermanentDelete(wid, budId);
    return;
  }
  _budsDelPending = {wid: wid, budId: budId};
  document.getElementById('buds-del-name').textContent = bud ? bud.name : 'this bud';
  modal.classList.remove('hidden');
  setTimeout(function() {
    var btn = document.getElementById('buds-del-confirm-btn');
    if (btn) btn.focus();
  }, 50);
}

function _closeBudsDelModal() {
  var modal = document.getElementById('buds-del-modal');
  if (modal) modal.classList.add('hidden');
  _budsDelPending = null;
}

function _confirmBudsDel() {
  var pending = _budsDelPending;
  _closeBudsDelModal();
  if (!pending) return;
  _budsDoPermanentDelete(pending.wid, pending.budId);
}

function _budsDoPermanentDelete(wid, budId) {
  fetch('/home/buds/'+wid+'/'+budId,
    {method:'DELETE', credentials:'same-origin'})
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (!data) return;
    _budsState[wid].buds = (_budsState[wid].buds || []).filter(function(b) {
      return b.id != budId;
    });
    _budsRender(wid);
    window._bwToast && window._bwToast('Bud removed.','info');
    if (typeof invalidateHomePageCache === 'function')
      invalidateHomePageCache(sessionStorage.getItem('bw-hp'));
  });
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function _budsDetailOpen(wid, budId) {
  var bud = _budsFindBud(wid, budId); if (!bud) return;
  var panel = document.getElementById('buds-detail-panel'); if (!panel) return;
  var h     = Math.round(_budsApplyDecay(bud));
  var tier  = _budsHealthTier(h);
  var color = _budsHealthColor(tier);
  panel.querySelector('#bdp-img').src       = _budsFlowerImg(bud.flower_species, tier);
  panel.querySelector('#bdp-name').textContent = bud.name;
  panel.querySelector('#bdp-species').textContent = _BUDS_NAMES[bud.flower_species] || bud.flower_species;
  panel.querySelector('#bdp-days').textContent = 'Every '+bud.see_every_days+' days';
  panel.querySelector('#bdp-health-bar').style.width     = h+'%';
  panel.querySelector('#bdp-health-bar').style.background = color;
  panel.querySelector('#bdp-health-num').textContent     = h+'/100';
  panel.querySelector('#bdp-notes').textContent = bud.notes || '—';
  panel.querySelector('#bdp-plan').textContent  = bud.pending_plan
    ? ('📅 '+bud.pending_plan.planned_date+(bud.pending_plan.note?' — '+bud.pending_plan.note:''))
    : 'No upcoming visit planned';
  panel.querySelector('#bdp-edit-btn').onclick   = function() { _budsDetailClose(); _budsEditOpen(wid,budId); };
  panel.querySelector('#bdp-delete-btn').onclick  = function() { _budsDetailClose(); _budsDelete(wid,budId); };
  panel.classList.remove('translate-x-full');
}

function _budsDetailClose() {
  var panel = document.getElementById('buds-detail-panel');
  if (panel) panel.classList.add('translate-x-full');
  var bd = document.getElementById('buds-detail-backdrop');
  if (bd) bd.classList.add('hidden');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _budsFindBud(wid, budId) {
  var st = _budsState[wid]; if (!st) return null;
  return st.buds.find(function(b) { return b.id == budId; }) || null;
}

function _budsReloadWidget(wid) {
  fetch('/home/buds/'+wid+'/list', {credentials:'same-origin'})
  .then(function(r) { return r.ok ? r.json() : {buds:[]}; })
  .then(function(data) {
    _budsState[wid].buds = data.buds || [];
    _budsRender(wid);
  });
}

function _esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Modal injection (once per page load) ─────────────────────────────────────

function _budsInjectModals() {
  if (_budsModalsInjected) return;
  _budsModalsInjected = true;

  // Species picker HTML (shared between add/edit modal)
  var speciesPicker = _BUDS_SPECIES.map(function(s) {
    return '<button type="button" data-species="'+s+'" onclick="_budsSelectSpecies(\''+s+'\')"'
      + ' class="buds-species-btn flex flex-col items-center gap-0.5 p-1.5 rounded-lg'
      + ' border border-gray-200 dark:border-zinc-600 hover:border-wblue transition cursor-pointer">'
      + '<img src="/static/img/buds/'+s+'_0.png" class="w-10 h-10 object-contain" alt="'+_BUDS_NAMES[s]+'">'
      + '<span class="text-xs text-gray-600 dark:text-zinc-300">'+_BUDS_NAMES[s]+'</span>'
      + '</button>';
  }).join('');

  var modalsHtml =
    // ── Add / Edit modal ────────────────────────────────────────────────────
    '<div id="buds-add-edit-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4"'
    + ' style="background:rgba(0,0,0,.45);backdrop-filter:blur(4px)"'
    + ' onclick="if(event.target===this)document.getElementById(\'buds-add-edit-modal\').classList.add(\'hidden\')">'
    + '<div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm p-5 relative">'
    + '<button onclick="document.getElementById(\'buds-add-edit-modal\').classList.add(\'hidden\')"'
    + ' class="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200'
    + ' p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-700 transition" aria-label="Close">✕</button>'
    + '<h2 id="baem-title" class="text-base font-bold text-gray-800 dark:text-zinc-100 mb-4">🌸 Add Bud</h2>'
    + '<label class="block text-xs font-semibold text-gray-500 mb-1">Name</label>'
    + '<input id="baem-name" type="text" placeholder="Friend\'s name"'
    + ' onkeydown="if(event.key===\'Enter\')_budsAddEditSubmit()"'
    + ' class="w-full text-sm border border-gray-200 dark:border-zinc-600 rounded-lg px-3 py-2 mb-3'
    + ' bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    + ' focus:outline-none focus:ring-2 focus:ring-wblue">'
    + '<label class="block text-xs font-semibold text-gray-500 mb-1">Flower</label>'
    + '<input type="hidden" id="baem-species" value="daisy">'
    + '<input type="hidden" id="baem-crm-id" value="">'
    + '<div class="grid grid-cols-4 gap-1.5 mb-3">'+speciesPicker+'</div>'
    + '<label class="block text-xs font-semibold text-gray-500 mb-1">'
    + '  Contact every <span id="baem-days-lbl">7</span> days</label>'
    + '<input id="baem-days" type="range" min="1" max="365" value="7"'
    + ' oninput="document.getElementById(\'baem-days-lbl\').textContent=this.value"'
    + ' class="w-full accent-wblue mb-3">'
    + '<label class="block text-xs font-semibold text-gray-500 mb-1">Notes (optional)</label>'
    + '<input id="baem-notes" type="text" placeholder="How you know them…"'
    + ' class="w-full text-sm border border-gray-200 dark:border-zinc-600 rounded-lg px-3 py-2 mb-4'
    + ' bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    + ' focus:outline-none focus:ring-2 focus:ring-wblue">'
    + '<div class="flex gap-2 justify-end">'
    + '<button type="button" onclick="document.getElementById(\'buds-add-edit-modal\').classList.add(\'hidden\')"'
    + ' class="px-4 py-2 text-sm border border-gray-200 dark:border-zinc-600 rounded-lg'
    + ' text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700 transition">Cancel</button>'
    + '<button type="button" onclick="_budsAddEditSubmit()"'
    + ' class="px-4 py-2 bg-wblue text-white text-sm font-semibold rounded-lg'
    + ' hover:bg-blue-700 transition">Save</button>'
    + '</div></div></div>'

    // ── Fertilize modal ──────────────────────────────────────────────────────
    + '<div id="buds-fertilize-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4"'
    + ' style="background:rgba(0,0,0,.45);backdrop-filter:blur(4px)"'
    + ' onclick="if(event.target===this)document.getElementById(\'buds-fertilize-modal\').classList.add(\'hidden\')">'
    + '<div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm p-5 relative">'
    + '<button onclick="document.getElementById(\'buds-fertilize-modal\').classList.add(\'hidden\')"'
    + ' class="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200'
    + ' p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-700 transition" aria-label="Close">✕</button>'
    + '<h2 id="bfm-title" class="text-base font-bold text-gray-800 dark:text-zinc-100 mb-1">🌱 Visit Plan</h2>'
    + '<p class="text-xs text-gray-400 mb-4">Plan a hangout or mark an existing one done.</p>'
    + '<label class="block text-xs font-semibold text-gray-500 mb-1">Visit date</label>'
    + '<input id="bfm-plan-date" type="date"'
    + ' class="w-full text-sm border border-gray-200 dark:border-zinc-600 rounded-lg px-3 py-2 mb-3'
    + ' bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    + ' focus:outline-none focus:ring-2 focus:ring-wblue">'
    + '<label class="block text-xs font-semibold text-gray-500 mb-1">Plan / note (optional)</label>'
    + '<input id="bfm-plan-note" type="text" placeholder="Coffee, walk, game night…"'
    + ' class="w-full text-sm border border-gray-200 dark:border-zinc-600 rounded-lg px-3 py-2 mb-4'
    + ' bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    + ' focus:outline-none focus:ring-2 focus:ring-wblue">'
    + '<div class="flex flex-col gap-2">'
    + '<button id="bfm-complete-btn" type="button" onclick="_budsFertilizeComplete()"'
    + ' class="w-full px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg'
    + ' hover:bg-green-700 transition">✅ We met — fertilize (+25 HP)</button>'
    + '<div class="flex gap-2 justify-end">'
    + '<button type="button" onclick="document.getElementById(\'buds-fertilize-modal\').classList.add(\'hidden\')"'
    + ' class="px-4 py-2 text-sm border border-gray-200 dark:border-zinc-600 rounded-lg'
    + ' text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-700 transition">Cancel</button>'
    + '<button type="button" onclick="_budsFertilizeSubmit()"'
    + ' class="px-4 py-2 bg-wblue text-white text-sm font-semibold rounded-lg'
    + ' hover:bg-blue-700 transition">Save Plan</button>'
    + '</div></div></div></div>'

    // ── Detail slide panel ───────────────────────────────────────────────────
    + '<div id="buds-detail-panel" class="fixed top-0 right-0 h-full w-72 z-50 shadow-2xl'
    + ' bg-white dark:bg-zinc-900 border-l border-gray-200 dark:border-zinc-700'
    + ' transform translate-x-full transition-transform duration-300 flex flex-col">'
    + '<div class="flex items-center justify-between p-4 border-b border-gray-100 dark:border-zinc-700">'
    + '<span class="font-bold text-gray-800 dark:text-zinc-100 text-sm">Bud Details</span>'
    + '<button onclick="_budsDetailClose()" class="text-gray-400 hover:text-gray-600 p-1 rounded-lg'
    + ' hover:bg-gray-100 dark:hover:bg-zinc-700 transition" aria-label="Close">✕</button></div>'
    + '<div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">'
    + '<img id="bdp-img" class="w-24 h-24 object-contain mx-auto" src="" alt="">'
    + '<div class="text-center">'
    + '<p id="bdp-name" class="font-bold text-gray-800 dark:text-zinc-100 text-lg"></p>'
    + '<p id="bdp-species" class="text-xs text-gray-400"></p></div>'
    + '<div>'
    + '<p class="text-xs text-gray-400 mb-1">Health</p>'
    + '<div class="h-2 bg-gray-200 dark:bg-zinc-700 rounded-full overflow-hidden">'
    + '<div id="bdp-health-bar" class="h-full rounded-full transition-all" style="width:100%"></div></div>'
    + '<p id="bdp-health-num" class="text-xs text-gray-400 mt-0.5 text-right"></p></div>'
    + '<div><p class="text-xs text-gray-400">Contact frequency</p>'
    + '<p id="bdp-days" class="text-sm font-medium text-gray-700 dark:text-zinc-200"></p></div>'
    + '<div><p class="text-xs text-gray-400">Upcoming visit</p>'
    + '<p id="bdp-plan" class="text-sm text-gray-700 dark:text-zinc-200"></p></div>'
    + '<div><p class="text-xs text-gray-400">Notes</p>'
    + '<p id="bdp-notes" class="text-sm text-gray-700 dark:text-zinc-200"></p></div></div>'
    + '<div class="p-4 border-t border-gray-100 dark:border-zinc-700 flex gap-2">'
    + '<button id="bdp-edit-btn" class="flex-1 px-3 py-2 border border-gray-200 dark:border-zinc-600'
    + ' rounded-lg text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700'
    + ' transition">✏️ Edit</button>'
    + '<button id="bdp-delete-btn" class="flex-1 px-3 py-2 border border-red-200 rounded-lg text-sm'
    + ' text-red-600 hover:bg-red-50 transition">🗑️ Delete</button>'
    + '</div></div>'

    // Backdrop for detail panel
    + '<div id="buds-detail-backdrop" class="fixed inset-0 z-40 hidden bg-black/20"'
    + ' onclick="_budsDetailClose()"></div>';

  var wrap = document.createElement('div');
  wrap.innerHTML = modalsHtml;
  document.body.appendChild(wrap);

  // Show backdrop when detail panel opens
  var origOpen = _budsDetailOpen;
  window._budsDetailOpen = function(wid, budId) {
    origOpen(wid, budId);
    document.getElementById('buds-detail-backdrop').classList.remove('hidden');
  };

  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    ['buds-add-edit-modal','buds-fertilize-modal'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) el.classList.add('hidden');
    });
    _budsDetailClose();
  });
}
