/**
 * home-page-trip-panels.js — Trip Plan panel cards.
 * Panel types: documents | packing | budget | emergency | notes
 *
 * Depends on: _tripPid, _tripFetch, _tripShowToast, _tripEsc, _tripMdToHtml,
 *             _tripPlanMode, _tripDayCardWidth (home-page-trip*.js)
 * Exposes via window: _tripLoadPanels, _tripRenderPanelCards,
 *   tripOpenAddPanelModal, tripClosePanelModal, tripSubmitPanelModal,
 *   tppSelectType, tppEditPanel, tppDeletePanel, tppMovePanel,
 *   tppTogglePack, tppClearDone, tppShowForm, tppHideForm,
 *   tppSave*Item, tppSaveNotes, tppSaveBudgetTotal
 */

var _TPP_TYPES = {
  documents: { icon: '📎', label: 'Documents',    desc: 'Links, confirmations, tickets' },
  packing:   { icon: '🎒', label: 'Packing List', desc: 'Gear, clothes, toiletries' },
  budget:    { icon: '💰', label: 'Budget',        desc: 'Track spend vs budget' },
  emergency: { icon: '🆘', label: 'Emergency',    desc: 'Contacts, insurance, medical' },
  notes:     { icon: '📝', label: 'Trip Notes',   desc: 'Free-form scratchpad' },
};

var _tppModalMode    = 'add';   // 'add' | 'edit'
var _tppModalPanel   = null;    // panel being edited
var _tppSelectedType = null;    // chosen type in add modal
var _tppPlanId       = null;    // current plan_id

// ── Load & refresh ────────────────────────────────────────────────────────────

window._tripLoadPanels = function(planId) {
  _tppPlanId = planId;
  _tripFetch('/home/trip/' + _tripPid + '/plans/' + planId + '/panels')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      window._tripPanels = Array.isArray(data) ? data : [];
      var c = document.getElementById('trip-days-container');
      if (c) window._tripRenderPanelCards(c);
    })
    .catch(function() { _tripShowToast('Failed to load panels', true); });
};

function _tppReload() {
  if (_tppPlanId) window._tripLoadPanels(_tppPlanId);
}

// ── Render cards row ──────────────────────────────────────────────────────────

window._tripRenderPanelCards = function(container) {
  // Remove stale panel DOM
  Array.prototype.slice.call(
    container.querySelectorAll('.trip-panel-card, .trip-panel-add-btn')
  ).forEach(function(el) { el.remove(); });

  var isEdit = _tripPlanMode === 'edit';
  var panels = window._tripPanels || [];

  panels.forEach(function(p) {
    var card = document.createElement('div');
    card.className =
      'trip-panel-card flex-shrink-0 bg-white dark:bg-zinc-900 rounded-xl ' +
      'border border-gray-200 dark:border-zinc-800 flex flex-col overflow-hidden shadow-sm';
    card.style.cssText =
      'width:' + _tripDayCardWidth + 'px;max-height:calc(100vh - 12rem)';
    card.id = 'trip-panel-card-' + p.id;
    card.innerHTML = _tppBuildCard(p, isEdit);
    container.appendChild(card);
  });

  if (isEdit) {
    var addCard = document.createElement('div');
    addCard.className =
      'trip-panel-add-btn flex-shrink-0 rounded-xl border-2 border-dashed ' +
      'border-gray-200 dark:border-zinc-700 flex items-center justify-center ' +
      'cursor-pointer hover:border-[#0053e2]/60 hover:bg-blue-50/30 ' +
      'dark:hover:bg-blue-900/10 transition';
    addCard.style.cssText = 'width:140px;max-height:calc(100vh - 12rem);min-height:90px';
    addCard.onclick = window.tripOpenAddPanelModal;
    addCard.innerHTML =
      '<div class="text-center select-none">' +
        '<p class="text-2xl mb-1 text-gray-300 dark:text-zinc-600">＋</p>' +
        '<p class="text-xs text-gray-400 dark:text-zinc-500 font-medium">Add Card</p>' +
      '</div>';
    container.appendChild(addCard);
  }
};

function _tppBuildCard(p, isEdit) {
  var cfg  = _TPP_TYPES[p.panel_type] || { icon: '📋', label: p.panel_type };
  var data = _tppParse(p.content);
  var title = p.title || cfg.label;

  var moveBtns = isEdit
    ? '<button onclick="tppMovePanel(' + p.id + ',-1)" ' +
        'title="Move left" ' +
        'class="text-gray-300 dark:text-zinc-600 hover:text-gray-500 transition text-xs">◀</button>' +
      '<button onclick="tppMovePanel(' + p.id + ',1)" ' +
        'title="Move right" ' +
        'class="text-gray-300 dark:text-zinc-600 hover:text-gray-500 transition text-xs">▶</button>'
    : '';

  var actBtns = isEdit
    ? '<button onclick="tppEditPanel(' + p.id + ')" ' +
        'class="text-gray-400 hover:text-[#0053e2] transition text-xs" title="Rename">✏️</button>' +
      '<button onclick="tppDeletePanel(' + p.id + ',\'' + _tripEsc(title.replace(/'/g, '')) + '\')" ' +
        'class="text-gray-400 hover:text-red-500 transition text-xs ml-0.5" title="Delete">🗑️</button>'
    : '';

  var header =
    '<div class="flex items-center gap-1 px-3 py-2 flex-shrink-0 ' +
         'border-b border-gray-100 dark:border-zinc-800 ' +
         'bg-gradient-to-r from-blue-50/60 to-white dark:from-zinc-800 dark:to-zinc-900">' +
      '<span class="text-base flex-shrink-0">' + cfg.icon + '</span>' +
      '<p class="text-xs font-semibold text-gray-700 dark:text-zinc-200 flex-1 truncate">' +
        _tripEsc(title) + '</p>' +
      moveBtns + actBtns +
    '</div>';

  return header + _tppBody(p, data, isEdit);
}

// Refresh a single card in place
function _tppRefreshCard(panelId) {
  var p = _tppGetPanel(panelId);
  if (!p) return;
  var card = document.getElementById('trip-panel-card-' + panelId);
  if (!card) return;
  card.innerHTML = _tppBuildCard(p, _tripPlanMode === 'edit');
}

function _tppParse(raw) {
  try { return JSON.parse(raw); } catch(e) { return {}; }
}

function _tppGetPanel(panelId) {
  var found = null;
  (window._tripPanels || []).forEach(function(x) { if (x.id === panelId) found = x; });
  return found;
}

// Persist content update + refresh card
function _tppSave(panelId, newContent, onDone) {
  var p = _tppGetPanel(panelId);
  if (!p) return;
  p.content = JSON.stringify(newContent);
  _tripFetch('/home/trip/' + _tripPid + '/plans/' + _tppPlanId + '/panels/' + panelId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: p.title, content: newContent }),
  }).then(function() {
    if (onDone) onDone();
    _tppRefreshCard(panelId);
  }).catch(function() { _tripShowToast('Save failed', true); });
}

// ── Body dispatch ─────────────────────────────────────────────────────────────

function _tppBody(p, data, isEdit) {
  if (p.panel_type === 'documents') return _tppDocs(p, data, isEdit);
  if (p.panel_type === 'packing')   return _tppPacking(p, data, isEdit);
  if (p.panel_type === 'budget')    return _tppBudget(p, data, isEdit);
  if (p.panel_type === 'emergency') return _tppEmerg(p, data, isEdit);
  if (p.panel_type === 'notes')     return _tppNotes(p, data, isEdit);
  return _tppEmpty('Unknown type');
}

// ── Documents ─────────────────────────────────────────────────────────────────

function _tppDocs(p, data, isEdit) {
  var items = data.items || [];
  var rows = items.map(function(item, idx) {
    var del = isEdit
      ? '<button onclick="tppDeleteDocItem(' + p.id + ',' + idx + ')" ' +
          'class="text-gray-300 hover:text-red-400 text-xs flex-shrink-0 ml-1">✕</button>'
      : '';
    return '<div class="flex items-start gap-2 px-3 py-2 border-b ' +
           'border-gray-50 dark:border-zinc-800 last:border-0">' +
      '<span class="text-sm flex-shrink-0 mt-0.5">🔗</span>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate">' +
          _tripEsc(item.title || 'Link') + '</p>' +
        (item.url
          ? '<a href="' + _tripEsc(item.url) + '" target="_blank" rel="noopener" ' +
              'onclick="event.stopPropagation()" ' +
              'class="text-[10px] text-[#0053e2] dark:text-blue-400 hover:underline truncate block">' +
              _tripEsc(item.url) + '</a>'
          : '') +
        (item.note ? '<p class="text-[10px] text-gray-400 truncate">' + _tripEsc(item.note) + '</p>' : '') +
      '</div>' + del + '</div>';
  }).join('');

  var form = isEdit
    ? '<div id="tpp-doc-form-' + p.id + '" class="hidden px-3 py-2 space-y-1.5 ' +
        'border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50">' +
        '<input id="tpp-doc-title-' + p.id + '" type="text" placeholder="Title" maxlength="80" ' +
          'class="' + _tppInputCls() + '" />' +
        '<input id="tpp-doc-url-' + p.id + '" type="url" placeholder="https://…" ' +
          'class="' + _tppInputCls() + '" />' +
        '<input id="tpp-doc-note-' + p.id + '" type="text" placeholder="Note (optional)" maxlength="120" ' +
          'class="' + _tppInputCls() + '" />' +
        _tppFormBtns('tppSaveDocItem(' + p.id + ')', 'tppHideForm(' + p.id + ',\'doc\')') +
      '</div>'
    : '';

  var footer = isEdit
    ? _tppAddBtn('tppShowForm(' + p.id + ',\'doc\')', '＋ Add Link')
    : '';

  return '<div class="flex-1 overflow-y-auto">' + (rows || _tppEmpty('No links yet')) + '</div>' +
         form + footer;
}

// ── Packing List ──────────────────────────────────────────────────────────────

function _tppPacking(p, data, isEdit) {
  var groups = data.groups || [];
  var total = 0, done = 0;
  groups.forEach(function(g) {
    (g.items || []).forEach(function(it) { total++; if (it.done) done++; });
  });

  var progressBar =
    '<div class="px-3 py-1.5 flex-shrink-0 border-b border-gray-50 dark:border-zinc-800">' +
      '<div class="flex items-center justify-between mb-1">' +
        '<span class="text-[10px] text-gray-500 dark:text-zinc-400">' +
          done + ' / ' + total + ' packed</span>' +
        (isEdit
          ? '<button onclick="tppClearDone(' + p.id + ')" ' +
              'class="text-[10px] text-gray-400 hover:text-gray-600 transition">Reset</button>'
          : '') +
      '</div>' +
      '<div class="h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">' +
        '<div class="h-full bg-[#0053e2] rounded-full transition-all" ' +
             'style="width:' + (total > 0 ? Math.round(done / total * 100) : 0) + '%"></div>' +
      '</div>' +
    '</div>';

  var groupsHtml = groups.map(function(g, gIdx) {
    var itemRows = (g.items || []).map(function(it, iIdx) {
      var del = isEdit
        ? '<button onclick="tppDeletePackItem(' + p.id + ',' + gIdx + ',' + iIdx + ')" ' +
            'class="opacity-0 group-hover:opacity-100 text-gray-300 ' +
                   'hover:text-red-400 text-xs flex-shrink-0 transition">✕</button>'
        : '';
      return '<div class="group flex items-center gap-2 px-3 py-1 ' +
               'hover:bg-gray-50 dark:hover:bg-zinc-800/60 cursor-pointer transition" ' +
               'onclick="tppTogglePack(' + p.id + ',' + gIdx + ',' + iIdx + ')">' +
        '<span class="text-sm flex-shrink-0">' + (it.done ? '✅' : '⬜') + '</span>' +
        '<span class="text-xs flex-1 ' +
          (it.done ? 'line-through text-gray-400' : 'text-gray-700 dark:text-zinc-200') + '">' +
          _tripEsc(it.text) + '</span>' + del +
      '</div>';
    }).join('');

    return '<div>' +
      '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 ' +
         'dark:text-zinc-500 px-3 pt-2 pb-0.5 select-none">' + _tripEsc(g.name) + '</p>' +
      itemRows +
    '</div>';
  }).join('');

  var form = isEdit
    ? '<div id="tpp-pack-form-' + p.id + '" class="hidden px-3 py-2 space-y-1.5 ' +
        'border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50">' +
        '<input id="tpp-pack-item-' + p.id + '" type="text" placeholder="Item name" maxlength="80" ' +
          'class="' + _tppInputCls() + '" />' +
        '<input id="tpp-pack-group-' + p.id + '" type="text" ' +
          'placeholder="Group (e.g. Clothing)" maxlength="40" ' +
          'class="' + _tppInputCls() + '" />' +
        _tppFormBtns('tppSavePackItem(' + p.id + ')', 'tppHideForm(' + p.id + ',\'pack\')') +
      '</div>'
    : '';

  var footer = isEdit ? _tppAddBtn('tppShowForm(' + p.id + ',\'pack\')', '＋ Add Item') : '';

  return progressBar +
    '<div class="flex-1 overflow-y-auto">' + (groupsHtml || _tppEmpty('No items yet')) + '</div>' +
    form + footer;
}

// ── Budget ────────────────────────────────────────────────────────────────────

function _tppBudget(p, data, isEdit) {
  var total = parseFloat(data.total) || 0;
  var cur   = data.currency || 'USD';
  var items = data.items || [];
  var spent = 0;
  items.forEach(function(it) { spent += parseFloat(it.amount) || 0; });
  var pct      = total > 0 ? Math.min(Math.round(spent / total * 100), 100) : 0;
  var barColor = pct >= 90 ? '#ea1100' : pct >= 70 ? '#f59e0b' : '#2a8703';
  var remaining = total - spent;

  var summary =
    '<div class="px-3 py-2 flex-shrink-0 border-b border-gray-100 dark:border-zinc-800">' +
      (isEdit
        ? '<div class="flex gap-1 items-center mb-2">' +
            '<input id="tpp-budget-total-' + p.id + '" type="number" step="1" min="0" ' +
              'value="' + total.toFixed(0) + '" placeholder="Budget" ' +
              'class="' + _tppInputCls() + ' w-24" />' +
            '<input id="tpp-budget-cur-' + p.id + '" type="text" maxlength="5" ' +
              'value="' + _tripEsc(cur) + '" placeholder="USD" ' +
              'class="' + _tppInputCls() + ' w-14" />' +
            '<button onclick="tppSaveBudgetTotal(' + p.id + ')" ' +
              'class="' + _tppBtnPrimary() + '">Set</button>' +
          '</div>'
        : '') +
      '<div class="flex items-end justify-between mb-1">' +
        '<span class="text-xs font-semibold text-gray-700 dark:text-zinc-200">' +
          cur + ' ' + spent.toFixed(2) + ' spent</span>' +
        '<span class="text-[10px] text-gray-400">' +
          (remaining >= 0 ? cur + ' ' + remaining.toFixed(2) + ' left' : 'Over budget') +
        '</span>' +
      '</div>' +
      '<div class="h-2 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">' +
        '<div class="h-full rounded-full transition-all" ' +
             'style="width:' + pct + '%;background:' + barColor + '"></div>' +
      '</div>' +
    '</div>';

  var rows = items.map(function(item, idx) {
    var del = isEdit
      ? '<button onclick="tppDeleteBudgetItem(' + p.id + ',' + idx + ')" ' +
          'class="text-gray-300 hover:text-red-400 text-xs flex-shrink-0 ml-1">✕</button>'
      : '';
    return '<div class="flex items-center gap-2 px-3 py-1.5 border-b ' +
           'border-gray-50 dark:border-zinc-800 last:border-0">' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-xs text-gray-700 dark:text-zinc-200 truncate">' +
          _tripEsc(item.note || item.category || 'Expense') + '</p>' +
        (item.category && item.note
          ? '<p class="text-[10px] text-gray-400">' + _tripEsc(item.category) + '</p>' : '') +
      '</div>' +
      '<span class="text-xs font-semibold text-gray-700 dark:text-zinc-200 flex-shrink-0">' +
        cur + ' ' + (parseFloat(item.amount) || 0).toFixed(2) + '</span>' +
      del + '</div>';
  }).join('');

  var form = isEdit
    ? '<div id="tpp-budget-form-' + p.id + '" class="hidden px-3 py-2 space-y-1.5 ' +
        'border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50">' +
        '<input id="tpp-budget-note-' + p.id + '" type="text" placeholder="Description" maxlength="80" ' +
          'class="' + _tppInputCls() + '" />' +
        '<input id="tpp-budget-cat-' + p.id + '" type="text" ' +
          'placeholder="Category (e.g. Food)" maxlength="40" ' +
          'class="' + _tppInputCls() + '" />' +
        '<input id="tpp-budget-amt-' + p.id + '" type="number" step="0.01" min="0" ' +
          'placeholder="Amount" class="' + _tppInputCls() + '" />' +
        _tppFormBtns('tppSaveBudgetItem(' + p.id + ')', 'tppHideForm(' + p.id + ',\'budget\')') +
      '</div>'
    : '';

  var footer = isEdit ? _tppAddBtn('tppShowForm(' + p.id + ',\'budget\')', '＋ Add Expense') : '';

  return summary +
    '<div class="flex-1 overflow-y-auto">' + (rows || _tppEmpty('No expenses yet')) + '</div>' +
    form + footer;
}

// ── Emergency Info ────────────────────────────────────────────────────────────

function _tppEmerg(p, data, isEdit) {
  var items = data.items || [];
  var rows = items.map(function(item, idx) {
    var del = isEdit
      ? '<button onclick="tppDeleteEmergItem(' + p.id + ',' + idx + ')" ' +
          'class="text-gray-300 hover:text-red-400 text-xs flex-shrink-0 ml-1">✕</button>'
      : '';
    return '<div class="flex items-start gap-2 px-3 py-2 border-b ' +
           'border-gray-50 dark:border-zinc-800 last:border-0">' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 ' +
           'dark:text-zinc-500">' + _tripEsc(item.key) + '</p>' +
        '<p class="text-xs text-gray-700 dark:text-zinc-200 break-words leading-snug">' +
          _tripEsc(item.value) + '</p>' +
      '</div>' + del + '</div>';
  }).join('');

  var form = isEdit
    ? '<div id="tpp-emerg-form-' + p.id + '" class="hidden px-3 py-2 space-y-1.5 ' +
        'border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50">' +
        '<input id="tpp-emerg-key-' + p.id + '" type="text" ' +
          'placeholder="Label (e.g. Insurance #)" maxlength="50" ' +
          'class="' + _tppInputCls() + '" />' +
        '<input id="tpp-emerg-val-' + p.id + '" type="text" ' +
          'placeholder="Number / details" maxlength="200" ' +
          'class="' + _tppInputCls() + '" />' +
        _tppFormBtns('tppSaveEmergItem(' + p.id + ')', 'tppHideForm(' + p.id + ',\'emerg\')') +
      '</div>'
    : '';

  var footer = isEdit ? _tppAddBtn('tppShowForm(' + p.id + ',\'emerg\')', '＋ Add Entry') : '';

  return '<div class="flex-1 overflow-y-auto">' + (rows || _tppEmpty('No entries yet')) + '</div>' +
    form + footer;
}

// ── Trip Notes ────────────────────────────────────────────────────────────────

function _tppNotes(p, data, isEdit) {
  var text = data.text || '';
  if (isEdit) {
    return '<div class="flex-1 flex flex-col p-2 min-h-0">' +
      '<textarea id="tpp-notes-' + p.id + '" ' +
        'class="flex-1 w-full text-xs text-gray-700 dark:text-zinc-200 ' +
               'bg-transparent resize-none outline-none leading-relaxed ' +
               'border-0 focus:ring-0 min-h-[8rem]" ' +
        'placeholder="Write anything… Markdown supported.">' +
        _tripEsc(text) +
      '</textarea>' +
      '<div class="flex-shrink-0 pt-1">' +
        '<button onclick="tppSaveNotes(' + p.id + ')" ' +
          'class="' + _tppBtnPrimary() + ' w-full">💾 Save Notes</button>' +
      '</div>' +
    '</div>';
  }
  return '<div class="flex-1 overflow-y-auto p-3">' +
    '<div class="md-body text-xs text-gray-700 dark:text-zinc-200 leading-relaxed">' +
      (text.trim()
        ? (typeof _tripMdToHtml === 'function' ? _tripMdToHtml(text) : _tripEsc(text))
        : '<span class="text-gray-400 italic">No notes yet.</span>') +
    '</div>' +
  '</div>';
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function _tppEmpty(msg) {
  return '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center py-6 italic">' +
    msg + '</p>';
}
function _tppInputCls() {
  return 'w-full text-xs rounded-lg border border-gray-200 dark:border-zinc-700 ' +
         'bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 ' +
         'px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0053e2]/40';
}
function _tppBtnPrimary() {
  return 'px-3 py-1.5 text-xs rounded-lg bg-[#0053e2] text-white font-medium ' +
         'hover:bg-[#0046c0] transition';
}
function _tppBtnSecondary() {
  return 'px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-zinc-700 ' +
         'text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800 transition';
}
function _tppFormBtns(saveFn, cancelFn) {
  return '<div class="flex gap-1.5">' +
    '<button onclick="' + saveFn + '" class="' + _tppBtnPrimary() + '">Add</button>' +
    '<button onclick="' + cancelFn + '" class="' + _tppBtnSecondary() + '">Cancel</button>' +
  '</div>';
}
function _tppAddBtn(fn, label) {
  return '<div class="flex-shrink-0 px-3 pb-2 pt-1">' +
    '<button onclick="' + fn + '" ' +
      'class="w-full text-xs text-gray-400 dark:text-zinc-500 ' +
             'hover:text-[#0053e2] dark:hover:text-blue-400 transition ' +
             'border border-dashed border-gray-200 dark:border-zinc-700 ' +
             'rounded-lg py-1 hover:border-[#0053e2]/40">' +
      label +
    '</button>' +
  '</div>';
}

window.tppShowForm = function(panelId, prefix) {
  var el = document.getElementById('tpp-' + prefix + '-form-' + panelId);
  if (el) el.classList.remove('hidden');
};
window.tppHideForm = function(panelId, prefix) {
  var el = document.getElementById('tpp-' + prefix + '-form-' + panelId);
  if (el) el.classList.add('hidden');
};

// ── Item-level mutations ───────────────────────────────────────────────────────

// Documents
window.tppDeleteDocItem = function(panelId, idx) {
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  (d.items || []).splice(idx, 1);
  _tppSave(panelId, d);
};
window.tppSaveDocItem = function(panelId) {
  var title = ((document.getElementById('tpp-doc-title-' + panelId) || {}).value || '').trim();
  var url   = ((document.getElementById('tpp-doc-url-'   + panelId) || {}).value || '').trim();
  var note  = ((document.getElementById('tpp-doc-note-'  + panelId) || {}).value || '').trim();
  if (!url && !title) { _tripShowToast('Title or URL required', true); return; }
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  if (!d.items) d.items = [];
  d.items.push({ title: title, url: url, note: note });
  _tppSave(panelId, d);
};

// Packing
window.tppTogglePack = function(panelId, gIdx, iIdx) {
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  if (!d.groups || !d.groups[gIdx] || !d.groups[gIdx].items || !d.groups[gIdx].items[iIdx]) return;
  d.groups[gIdx].items[iIdx].done = !d.groups[gIdx].items[iIdx].done;
  _tppSave(panelId, d);
};
window.tppDeletePackItem = function(panelId, gIdx, iIdx) {
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  if (d.groups && d.groups[gIdx]) d.groups[gIdx].items.splice(iIdx, 1);
  _tppSave(panelId, d);
};
window.tppSavePackItem = function(panelId) {
  var text  = ((document.getElementById('tpp-pack-item-'  + panelId) || {}).value || '').trim();
  var group = ((document.getElementById('tpp-pack-group-' + panelId) || {}).value || '').trim() || 'General';
  if (!text) { _tripShowToast('Item name required', true); return; }
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  if (!d.groups) d.groups = [];
  var g = null;
  d.groups.forEach(function(x) { if (x.name === group) g = x; });
  if (!g) { g = { name: group, items: [] }; d.groups.push(g); }
  g.items.push({ text: text, done: false });
  _tppSave(panelId, d);
};
window.tppClearDone = function(panelId) {
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  (d.groups || []).forEach(function(g) {
    (g.items || []).forEach(function(it) { it.done = false; });
  });
  _tppSave(panelId, d);
};

// Budget
window.tppDeleteBudgetItem = function(panelId, idx) {
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  (d.items || []).splice(idx, 1);
  _tppSave(panelId, d);
};
window.tppSaveBudgetItem = function(panelId) {
  var note = ((document.getElementById('tpp-budget-note-' + panelId) || {}).value || '').trim();
  var cat  = ((document.getElementById('tpp-budget-cat-'  + panelId) || {}).value || '').trim();
  var amt  = parseFloat((document.getElementById('tpp-budget-amt-' + panelId) || {}).value || '0');
  if (!note && !amt) { _tripShowToast('Description or amount required', true); return; }
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  if (!d.items) d.items = [];
  d.items.push({ note: note, category: cat, amount: amt });
  _tppSave(panelId, d);
};
window.tppSaveBudgetTotal = function(panelId) {
  var total = parseFloat((document.getElementById('tpp-budget-total-' + panelId) || {}).value || '0');
  var cur   = ((document.getElementById('tpp-budget-cur-' + panelId) || {}).value || 'USD').trim().toUpperCase();
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content); d.total = total; d.currency = cur;
  _tppSave(panelId, d);
};

// Emergency
window.tppDeleteEmergItem = function(panelId, idx) {
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  (d.items || []).splice(idx, 1);
  _tppSave(panelId, d);
};
window.tppSaveEmergItem = function(panelId) {
  var key = ((document.getElementById('tpp-emerg-key-' + panelId) || {}).value || '').trim();
  var val = ((document.getElementById('tpp-emerg-val-' + panelId) || {}).value || '').trim();
  if (!key || !val) { _tripShowToast('Label and value required', true); return; }
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  if (!d.items) d.items = [];
  d.items.push({ key: key, value: val });
  _tppSave(panelId, d);
};

// Notes
window.tppSaveNotes = function(panelId) {
  var text = ((document.getElementById('tpp-notes-' + panelId) || {}).value || '');
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content); d.text = text;
  _tppSave(panelId, d, function() { _tripShowToast('Notes saved ✓'); });
};

// ── Panel-level CRUD ──────────────────────────────────────────────────────────

window.tppDeletePanel = function(panelId, label) {
  var modal = document.getElementById('trip-del-modal');
  var msg   = document.getElementById('trip-del-msg');
  var btn   = document.getElementById('trip-del-confirm');
  if (!modal || !msg || !btn) return;
  msg.textContent = 'Delete "' + label + '" card? This cannot be undone.';
  btn.onclick = function() {
    _tripFetch(
      '/home/trip/' + _tripPid + '/plans/' + _tppPlanId + '/panels/' + panelId,
      { method: 'DELETE' }
    ).then(function() {
      modal.classList.add('hidden');
      window._tripPanels = (window._tripPanels || []).filter(function(x) {
        return x.id !== panelId;
      });
      var c = document.getElementById('trip-days-container');
      if (c) window._tripRenderPanelCards(c);
    }).catch(function() { _tripShowToast('Delete failed', true); });
  };
  modal.classList.remove('hidden');
};

window.tppMovePanel = function(panelId, dir) {
  var panels = window._tripPanels || [];
  var idx = -1;
  panels.forEach(function(x, i) { if (x.id === panelId) idx = i; });
  if (idx < 0) return;
  var ni = idx + dir;
  if (ni < 0 || ni >= panels.length) return;
  var tmp = panels[idx]; panels[idx] = panels[ni]; panels[ni] = tmp;
  window._tripPanels = panels;
  var c = document.getElementById('trip-days-container');
  if (c) window._tripRenderPanelCards(c);
  _tripFetch(
    '/home/trip/' + _tripPid + '/plans/' + _tppPlanId + '/panels/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ordered_ids: panels.map(function(x) { return x.id; }) }),
  }).catch(function() { _tripShowToast('Reorder failed', true); });
};

window.tppEditPanel = function(panelId) {
  var p = _tppGetPanel(panelId); if (!p) return;
  var cfg = _TPP_TYPES[p.panel_type] || { label: p.panel_type };
  _tppModalMode = 'edit'; _tppModalPanel = p;
  var modal    = document.getElementById('trip-panel-modal');
  var titleEl  = document.getElementById('trip-panel-modal-title');
  var typeRow  = document.getElementById('trip-panel-type-row');
  var inp      = document.getElementById('trip-panel-title');
  var submitBtn = document.getElementById('trip-panel-submit');
  if (!modal) return;
  if (titleEl)   titleEl.textContent = 'Rename Card';
  if (typeRow)   typeRow.classList.add('hidden');
  if (inp)       inp.value = p.title || cfg.label || '';
  if (submitBtn) { submitBtn.textContent = 'Save'; submitBtn.removeAttribute('disabled'); }
  modal.classList.remove('hidden');
};

// ── Add panel modal ───────────────────────────────────────────────────────────

window.tripOpenAddPanelModal = function() {
  _tppModalMode = 'add'; _tppModalPanel = null; _tppSelectedType = null;
  var modal    = document.getElementById('trip-panel-modal');
  var titleEl  = document.getElementById('trip-panel-modal-title');
  var typeRow  = document.getElementById('trip-panel-type-row');
  var typeGrid = document.getElementById('trip-panel-type-grid');
  var inp      = document.getElementById('trip-panel-title');
  var submitBtn = document.getElementById('trip-panel-submit');
  if (!modal) return;
  if (titleEl)   titleEl.textContent = 'Add Card';
  if (typeRow)   typeRow.classList.remove('hidden');
  if (inp)       inp.value = '';
  if (submitBtn) { submitBtn.textContent = 'Add Card'; submitBtn.setAttribute('disabled', ''); }
  if (typeGrid) {
    typeGrid.innerHTML = Object.keys(_TPP_TYPES).map(function(key) {
      var cfg = _TPP_TYPES[key];
      return '<button type="button" id="tpp-type-btn-' + key + '" ' +
        'onclick="tppSelectType(\'' + key + '\')" ' +
        'class="flex flex-col items-center gap-1 p-2 rounded-xl border-2 ' +
               'border-gray-200 dark:border-zinc-700 hover:border-[#0053e2] ' +
               'transition text-center focus:outline-none">' +
        '<span class="text-xl">' + cfg.icon + '</span>' +
        '<span class="text-[10px] font-medium text-gray-600 dark:text-zinc-300 leading-tight">' +
          cfg.label + '</span>' +
        '<span class="text-[9px] text-gray-400 dark:text-zinc-500 leading-tight">' +
          cfg.desc + '</span>' +
      '</button>';
    }).join('');
  }
  modal.classList.remove('hidden');
};

window.tppSelectType = function(type) {
  _tppSelectedType = type;
  var submitBtn = document.getElementById('trip-panel-submit');
  if (submitBtn) submitBtn.removeAttribute('disabled');
  Object.keys(_TPP_TYPES).forEach(function(k) {
    var btn = document.getElementById('tpp-type-btn-' + k);
    if (!btn) return;
    btn.style.borderColor = k === type ? '#0053e2' : '';
    btn.style.background  = k === type ? 'rgba(0,83,226,0.08)' : '';
  });
};

window.tripClosePanelModal = function() {
  var modal = document.getElementById('trip-panel-modal');
  if (modal) modal.classList.add('hidden');
  _tppModalMode = 'add'; _tppModalPanel = null; _tppSelectedType = null;
};

window.tripSubmitPanelModal = function() {
  var inp   = document.getElementById('trip-panel-title');
  var title = (inp ? inp.value : '').trim();

  if (_tppModalMode === 'add') {
    if (!_tppSelectedType) { _tripShowToast('Pick a card type first', true); return; }
    _tripFetch('/home/trip/' + _tripPid + '/plans/' + _tppPlanId + '/panels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panel_type: _tppSelectedType, title: title }),
    }).then(function(r) { return r.json(); })
      .then(function() {
        window.tripClosePanelModal();
        window._tripLoadPanels(_tppPlanId);
      }).catch(function() { _tripShowToast('Failed to add card', true); });
  } else {
    if (!_tppModalPanel) return;
    var p = _tppGetPanel(_tppModalPanel.id);
    if (!p) return;
    _tripFetch(
      '/home/trip/' + _tripPid + '/plans/' + _tppPlanId + '/panels/' + p.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title, content: _tppParse(p.content) }),
    }).then(function() {
      p.title = title;
      window.tripClosePanelModal();
      _tppRefreshCard(p.id);
    }).catch(function() { _tripShowToast('Failed to save', true); });
  }
};
