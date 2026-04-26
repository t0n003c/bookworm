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
 *   tppSave*Item, tppSaveNotes, tppSaveBudgetTotal,
 *   tppSaveBudgetLink, tppBudgetSettleChanged, tppUnlinkBudget
 */

var _TPP_TYPES = {
  documents: { icon: '📎', label: 'Documents',    desc: 'Links, confirmations, tickets' },
  packing:   { icon: '🎒', label: 'Packing List', desc: 'Gear, clothes, toiletries' },
  budget:    { icon: '💰', label: 'Budget',        desc: 'Track spend vs budget' },
  emergency: { icon: '🆘', label: 'Emergency',    desc: 'Contacts, insurance, medical' },
  notes:     { icon: '📝', label: 'Trip Notes',   desc: 'Free-form scratchpad' },
  settle:    { icon: '🤝', label: 'Settle Up',    desc: 'Split costs & settle debts' },
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

// ── Collapse state helpers (Quick Cards) ─────────────────────────────────────
var _QC_LS_KEY = 'bw-trip-qc-open';
function _tppQcIsOpen() { return localStorage.getItem(_QC_LS_KEY) !== 'false'; }
window.tppToggleQcCollapse = function() {
  localStorage.setItem(_QC_LS_KEY, _tppQcIsOpen() ? 'false' : 'true');
  var row      = document.getElementById('trip-panels-row');
  var chevron  = document.getElementById('trip-qc-chevron');
  var btn      = document.getElementById('trip-qc-toggle-btn');
  var subtitle = document.getElementById('trip-qc-subtitle');
  if (!row || !chevron) return;
  var open = _tppQcIsOpen();
  row.classList.toggle('hidden', !open);
  chevron.textContent = open ? '▾' : '▸';
  if (btn)      btn.setAttribute('aria-expanded', String(open));
  if (subtitle) subtitle.classList.toggle('hidden', !open);
};

// ── Render cards row ──────────────────────────────────────────────────────
window._tripRenderPanelCards = function(container) {
  // Remove stale panel DOM (divider + group)
  Array.prototype.slice.call(
    container.querySelectorAll('.trip-panel-group-divider, #trip-panels-group')
  ).forEach(function(el) { el.remove(); });

  var isEdit = _tripPlanMode === 'edit';
  var panels = window._tripPanels || [];

  // Nothing to show in view mode with no panels
  if (!panels.length && !isEdit) return;

  // ─ Horizontal divider ───────────────────────────────────
  var divider = document.createElement('div');
  divider.className =
    'trip-panel-group-divider ' +
    'border-t border-dashed border-gray-200 dark:border-zinc-700';
  container.appendChild(divider);

  var qcOpen = _tppQcIsOpen();

  // ─ Panels group wrapper ────────────────────────────
  var group = document.createElement('div');
  group.id        = 'trip-panels-group';
  group.className = 'flex flex-col flex-shrink-0 gap-1';

  // Group label — collapse toggle button
  var label = document.createElement('button');
  label.type = 'button';
  label.id = 'trip-qc-toggle-btn';
  label.setAttribute('aria-expanded', String(qcOpen));
  label.onclick = window.tppToggleQcCollapse;
  // WCAG 4.1.2 — set initial aria-expanded so screen readers know the state
  label.setAttribute('aria-expanded', String(qcOpen));
  label.className =
    'flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest ' +
    'text-gray-400 dark:text-zinc-500 px-1 pb-0.5 select-none ' +
    'hover:text-gray-600 dark:hover:text-zinc-300 transition w-fit';
  label.innerHTML =
    '<span id="trip-qc-chevron">' + (qcOpen ? '▾' : '▸') + '</span>' +
    '<span>🗂️ Trip Resources</span>';
  group.appendChild(label);

  // Subtitle — explains the concept; hidden when collapsed
  var subtitle = document.createElement('p');
  subtitle.id        = 'trip-qc-subtitle';
  subtitle.className = 'text-[10px] text-gray-400 dark:text-zinc-500 px-1 pb-1 leading-snug' +
                       (qcOpen ? '' : ' hidden');
  subtitle.textContent = 'Planning docs for the whole trip — drag any card onto a day lane to link it.';
  group.appendChild(subtitle);

  // Inner flex row for cards (hidden when collapsed)
  var row = document.createElement('div');
  row.id        = 'trip-panels-row';
  row.className = 'flex flex-wrap gap-4 pb-2' + (qcOpen ? '' : ' hidden');
  group.appendChild(row);

  // Panel cards — draggable so they can be dropped onto day lanes
  panels.forEach(function(p) {
    var card = document.createElement('div');
    card.className =
      'trip-panel-card flex-shrink-0 bg-white dark:bg-zinc-900 rounded-xl ' +
      'border border-gray-200 dark:border-zinc-800 flex flex-col overflow-hidden shadow-sm';
    card.style.cssText =
      'width:' + _tripDayCardWidth + 'px;max-height:calc(100vh - 12rem)';
    card.id = 'trip-panel-card-' + p.id;
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-panel-id', String(p.id));
    card.addEventListener('dragstart', function(ev) {
      var cfg = _TPP_TYPES[p.panel_type] || { icon: '📋', label: p.panel_type };
      ev.dataTransfer.setData('bw-panel-id',    String(p.id));
      ev.dataTransfer.setData('bw-panel-title', p.title || cfg.label);
      ev.dataTransfer.setData('bw-panel-icon',  cfg.icon);
      ev.dataTransfer.setData('bw-panel-type',  p.panel_type);
      ev.dataTransfer.effectAllowed = 'copy';
      setTimeout(function() { card.style.opacity = '0.5'; }, 0);
    });
    card.addEventListener('dragend', function() { card.style.opacity = ''; });
    card.innerHTML = _tppBuildCard(p, isEdit);
    row.appendChild(card);
    // Notes CE must be seeded after the element is in the DOM
    if (p.panel_type === 'notes') window.tppNotesInitCe(p.id);
  });

  // ✕ Add Card button (edit mode only)
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
    row.appendChild(addCard);
  }

  container.appendChild(group);
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

  // Settle Up: show an edit icon even in view mode
  var settleViewEdit = (!isEdit && p.panel_type === 'settle')
    ? '<button onclick="tppOpenSettleModal(' + p.id + ')" ' +
        'class="text-gray-400 hover:text-[#0053e2] transition text-xs ml-1" ' +
        'title="Add / edit expenses">✏️</button>'
    : '';

  var header =
    '<div class="flex items-center gap-1 px-3 py-2 flex-shrink-0 ' +
         'border-b border-gray-100 dark:border-zinc-800 ' +
         'bg-gradient-to-r from-blue-50/60 to-white dark:from-zinc-800 dark:to-zinc-900">' +
      '<span class="text-base flex-shrink-0">' + cfg.icon + '</span>' +
      '<p class="text-xs font-semibold text-gray-700 dark:text-zinc-200 flex-1 truncate">' +
        _tripEsc(title) + '</p>' +
      moveBtns + actBtns + settleViewEdit +
    '</div>';

  return header + _tppBody(p, data, isEdit);
}

// Refresh a single card in place (and the settle modal if it's open for this card)
function _tppRefreshCard(panelId) {
  var p = _tppGetPanel(panelId);
  if (!p) return;
  var isEdit = _tripPlanMode === 'edit';
  var card = document.getElementById('trip-panel-card-' + panelId);
  if (card) {
    card.innerHTML = _tppBuildCard(p, isEdit);
    // Notes CE must be seeded after innerHTML is set
    if (p.panel_type === 'notes') window.tppNotesInitCe(panelId);
  }
  // Also refresh the floating settle modal if it's currently showing this panel
  var modal = document.getElementById('tpp-settle-modal');
  if (modal && modal.dataset.panelId === String(panelId)) {
    var body = document.getElementById('tpp-settle-modal-body');
    if (body) body.innerHTML = _tppSettleModalContent(p);
  }
}

function _tppParse(raw) {
  try { return JSON.parse(raw); } catch(e) { return {}; }
}

// ── Phone number detector / formatter ────────────────────────────────────
// Returns {tel, label} if `raw` looks like a phone number, null otherwise.
function _tppFormatPhone(raw) {
  var digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) {
    return {
      tel:   '+1' + digits,
      label: '(' + digits.slice(0,3) + ')' + digits.slice(3,6) + '-' + digits.slice(6),
    };
  }
  if (digits.length === 11 && digits[0] === '1') {
    return {
      tel:   '+' + digits,
      label: '+1(' + digits.slice(1,4) + ')' + digits.slice(4,7) + '-' + digits.slice(7),
    };
  }
  return null;
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
  if (p.panel_type === 'settle')    return _tppSettle(p, data, isEdit);
  return _tppEmpty('Unknown type');
}

// ── Documents ─────────────────────────────────────────────────────────────────

function _tppDocs(p, data, isEdit) {
  var items = data.items || [];
  var rows = items.map(function(item, idx) {
    var isUpload = item.url && item.url.indexOf('/uploads/') === 0;
    var icon     = isUpload ? '📄' : '🔗';
    var linkHtml = item.url
      ? '<a href="' + _tripEsc(item.url) + '" target="_blank" rel="noopener" ' +
          'onclick="event.stopPropagation()" ' +
          'class="text-[10px] text-[#0053e2] dark:text-blue-400 hover:underline truncate block">' +
          (isUpload
            ? _tripEsc(item.url.split('/').pop())
            : _tripEsc(item.url)) +
        '</a>'
      : '';
    var del = isEdit
      ? '<button onclick="tppDeleteDocItem(' + p.id + ',' + idx + ')" ' +
          'class="text-gray-300 hover:text-red-400 text-xs flex-shrink-0 ml-1">✕</button>'
      : '';
    return '<div class="flex items-start gap-2 px-3 py-2 border-b ' +
           'border-gray-50 dark:border-zinc-800 last:border-0">' +
      '<span class="text-sm flex-shrink-0 mt-0.5">' + icon + '</span>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate">' +
          _tripEsc(item.title || 'Document') + '</p>' +
        linkHtml +
        (item.note ? '<p class="text-[10px] text-gray-400 truncate">' + _tripEsc(item.note) + '</p>' : '') +
      '</div>' + del + '</div>';
  }).join('');

  var form = isEdit
    ? '<div id="tpp-doc-form-' + p.id + '" class="hidden px-3 py-2 space-y-1.5 ' +
        'border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50">' +
        '<input id="tpp-doc-title-' + p.id + '" type="text" placeholder="Title" maxlength="80" ' +
          'class="' + _tppInputCls() + '" />' +
        '<div class="flex gap-1.5 items-center">' +
          '<input id="tpp-doc-url-' + p.id + '" type="text" placeholder="https://… or upload a file" ' +
            'class="' + _tppInputCls() + ' flex-1" />' +
          '<button type="button" onclick="tppPickDocFile(' + p.id + ')" ' +
            'title="Upload a file" ' +
            'class="flex-shrink-0 px-2 py-1.5 text-xs rounded-lg border border-gray-200 ' +
                   'dark:border-zinc-700 text-gray-500 dark:text-zinc-400 ' +
                   'hover:bg-gray-100 dark:hover:bg-zinc-700 transition whitespace-nowrap">' +
            '📁 Upload' +
          '</button>' +
        '</div>' +
        '<input id="tpp-doc-file-' + p.id + '" type="file" ' +
          'onchange="tppUploadDocFile(' + p.id + ')" ' +
          'style="display:none" />' +
        '<p id="tpp-doc-status-' + p.id + '" class="text-[10px] text-gray-400 -mt-0.5 min-h-[1rem]"></p>' +
        '<input id="tpp-doc-note-' + p.id + '" type="text" placeholder="Note (optional)" maxlength="120" ' +
          'class="' + _tppInputCls() + '" />' +
        _tppFormBtns('tppSaveDocItem(' + p.id + ')', 'tppHideForm(' + p.id + ',\'doc\')') +
      '</div>'
    : '';

  var footer = isEdit
    ? _tppAddBtn('tppShowForm(' + p.id + ',\'doc\')', '＋ Add Document')
    : '';

  return '<div class="flex-1 overflow-y-auto">' + (rows || _tppEmpty('No documents yet')) + '</div>' +
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

// ── Budget ────────────────────────────────────────────────────────────────────────────────

function _tppBudget(p, data, isEdit) {
  var total  = parseFloat(data.total) || 0;
  var cur    = data.currency || 'USD';
  var items  = data.items   || [];   // manual expenses

  // ── Resolve linked Settle Up ───────────────────────────────────────────────
  var linkedSettleId  = data.linked_settle_id  != null ? parseInt(data.linked_settle_id,  10) : null;
  var linkedPersonIdx = data.linked_person_idx != null ? parseInt(data.linked_person_idx, 10) : null;
  var settlePanel = null;
  var linkedPersonName = '';
  var linkedExps  = [];
  var linkedSpent = 0;

  if (linkedSettleId !== null) {
    (window._tripPanels || []).forEach(function(x) {
      if (x.id === linkedSettleId) settlePanel = x;
    });
  }
  if (settlePanel) {
    var sd = _tppParse(settlePanel.content);
    var sdPeople = sd.people || [];
    linkedPersonName = linkedPersonIdx !== null ? (sdPeople[linkedPersonIdx] || '') : '';
    (sd.expenses || []).forEach(function(exp) {
      if (parseInt(exp.paid_by, 10) === linkedPersonIdx) {
        linkedExps.push(exp);
        linkedSpent += parseFloat(exp.amount) || 0;
      }
    });
  } else {
    // linked panel gone — ignore stale IDs in this render
    linkedSettleId  = null;
    linkedPersonIdx = null;
  }

  // ── Totals ─────────────────────────────────────────────────────────────────────────
  var manualSpent = 0;
  items.forEach(function(it) { manualSpent += parseFloat(it.amount) || 0; });
  var spent     = linkedSpent + manualSpent;
  var pct       = total > 0 ? Math.min(Math.round(spent / total * 100), 100) : 0;
  var barColor  = pct >= 90 ? '#ea1100' : pct >= 70 ? '#f59e0b' : '#2a8703';
  var remaining = total - spent;

  // ── Summary / progress bar ───────────────────────────────────────────────────
  var linkedBadge = linkedPersonName
    ? '<span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ' +
        'bg-blue-50 dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-400 font-medium mb-1">' +
        '🔗 ' + _tripEsc(linkedPersonName) + ' · Settle Up' +
      '</span>'
    : '';

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
      (linkedBadge ? '<div>' + linkedBadge + '</div>' : '') +
      '<div class="flex items-end justify-between mb-1">' +
        '<span class="text-xs font-semibold text-gray-700 dark:text-zinc-200">' +
          cur + ' ' + spent.toFixed(2) + ' spent</span>' +
        '<span class="text-[10px] text-gray-400">' +
          (remaining >= 0 ? cur + ' ' + remaining.toFixed(2) + ' left' : '⚠️ Over budget') +
        '</span>' +
      '</div>' +
      '<div class="h-2 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">' +
        '<div class="h-full rounded-full transition-all" ' +
             'style="width:' + pct + '%;background:' + barColor + '"></div>' +
      '</div>' +
      // Breakdown line only when both sources have data
      (linkedSpent > 0 && manualSpent > 0
        ? '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-1">' +
            cur + ' ' + linkedSpent.toFixed(2) + ' from Settle Up · ' +
            cur + ' ' + manualSpent.toFixed(2) + ' manual' +
          '</p>'
        : '') +
    '</div>';

  // ── Link / Unlink UI (edit mode only) ────────────────────────────────────────────
  var settlePanels = (window._tripPanels || []).filter(function(x) { return x.panel_type === 'settle'; });
  var linkSection  = '';
  if (isEdit) {
    if (linkedPersonName && settlePanel) {
      // Already linked — show status + unlink
      linkSection =
        '<div class="px-3 py-2 border-b border-gray-100 dark:border-zinc-800 ' +
             'bg-blue-50/50 dark:bg-blue-900/10 flex items-center gap-2">' +
          '<span class="text-[10px] text-gray-500 dark:text-zinc-400 flex-1">' +
            'Tracking expenses paid by <strong>' + _tripEsc(linkedPersonName) + '</strong>' +
          '</span>' +
          '<button onclick="tppUnlinkBudget(' + p.id + ')" ' +
            'class="text-[10px] text-gray-400 hover:text-red-500 transition whitespace-nowrap">Unlink</button>' +
        '</div>';
    } else if (settlePanels.length > 0) {
      // Show settle panel + person pickers
      var settleOpts = settlePanels.map(function(sp) {
        return '<option value="' + sp.id + '">' + _tripEsc(sp.title || 'Settle Up') + '</option>';
      }).join('');
      var firstSd   = _tppParse(settlePanels[0].content);
      var firstPpl  = firstSd.people || [];
      var personOpts = firstPpl.length
        ? firstPpl.map(function(name, i) {
            return '<option value="' + i + '">' + _tripEsc(name) + '</option>';
          }).join('')
        : '<option value="">Add people to Settle Up first</option>';
      linkSection =
        '<div class="px-3 py-2 border-b border-gray-100 dark:border-zinc-800 ' +
             'bg-gray-50 dark:bg-zinc-800/50 space-y-1.5">' +
          '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 ' +
               'dark:text-zinc-500">🔗 Link to Settle Up person</p>' +
          '<div class="flex gap-1.5 items-center">' +
            '<select id="tpp-budget-link-settle-' + p.id + '" ' +
              'onchange="tppBudgetSettleChanged(' + p.id + ')" ' +
              'class="' + _tppInputCls() + ' flex-1">' +
              settleOpts +
            '</select>' +
            '<select id="tpp-budget-link-person-' + p.id + '" ' +
              'class="' + _tppInputCls() + ' flex-1">' +
              personOpts +
            '</select>' +
            '<button onclick="tppSaveBudgetLink(' + p.id + ')" ' +
              'class="' + _tppBtnPrimary() + ' whitespace-nowrap">Link</button>' +
          '</div>' +
        '</div>';
    }
  }

  // ── Linked expenses (read-only rows from Settle Up) ──────────────────────────
  var linkedRows = '';
  if (linkedExps.length) {
    linkedRows =
      '<p class="text-[10px] font-semibold uppercase tracking-wide text-[#0053e2] dark:text-blue-400 ' +
         'px-3 pt-2 pb-0.5 select-none">🔗 From Settle Up</p>' +
      linkedExps.map(function(exp) {
        return '<div class="flex items-center gap-2 px-3 py-1.5 border-b ' +
               'border-gray-50 dark:border-zinc-800 last:border-0">' +
          '<p class="text-xs text-gray-600 dark:text-zinc-300 flex-1 truncate">' +
            _tripEsc(exp.desc || 'Expense') + '</p>' +
          '<span class="text-xs font-semibold text-[#0053e2] dark:text-blue-400 flex-shrink-0">' +
            cur + ' ' + (parseFloat(exp.amount) || 0).toFixed(2) + '</span>' +
        '</div>';
      }).join('');
  }

  // ── Manual expenses ─────────────────────────────────────────────────────────────────
  var manualLabel = (linkedRows || (isEdit && settlePanels.length > 0))
    ? '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 ' +
        'dark:text-zinc-500 px-3 pt-2 pb-0.5 select-none">✏️ Manual</p>'
    : '';

  var manualRows = items.map(function(item, idx) {
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

  var footer = isEdit ? _tppAddBtn('tppShowForm(' + p.id + ',\'budget\')', '＋ Add Manual Expense') : '';
  var allEmpty = !linkedRows && !manualRows;

  return summary + linkSection +
    '<div class="flex-1 overflow-y-auto">' +
      (allEmpty ? _tppEmpty('No expenses yet — add one or link to Settle Up') : linkedRows + manualLabel + manualRows) +
    '</div>' +
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
    // Auto-detect phone numbers and render as clickable tel: links
    var phone = _tppFormatPhone(item.value);
    var valueHtml = phone
      ? '<a href="tel:' + _tripEsc(phone.tel) + '" ' +
          'onclick="event.stopPropagation()" ' +
          'class="text-xs text-[#0053e2] dark:text-blue-400 hover:underline ' +
                 'break-words leading-snug font-medium">' +
          '📞 ' + _tripEsc(phone.label) +
        '</a>'
      : '<p class="text-xs text-gray-700 dark:text-zinc-200 break-words leading-snug">' +
          _tripEsc(item.value) + '</p>';
    return '<div class="flex items-start gap-2 px-3 py-2 border-b ' +
           'border-gray-50 dark:border-zinc-800 last:border-0">' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 ' +
           'dark:text-zinc-500">' + _tripEsc(item.key) + '</p>' +
        valueHtml +
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
  // Notes are ALWAYS rendered as a CE editor — regardless of plan edit/view mode.
  // tppNotesInitCe() seeds the content + wires slash commands after DOM insertion.
  // isEdit only affects whether the card header shows move/delete controls.
  return '<div class="flex-1 flex flex-col p-2 gap-1.5 min-h-0">' +
    '<div id="tpp-notes-ce-' + p.id + '" contenteditable="true" ' +
         'class="flex-1 w-full text-xs text-gray-800 dark:text-zinc-100 ' +
                'bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-600 ' +
                'rounded-lg px-2 py-2 overflow-y-auto ' +
                'focus:outline-none focus:ring-2 focus:ring-[#0053e2]/40 ' +
                'leading-relaxed min-h-[8rem] ' +
                'prose prose-xs dark:prose-invert max-w-none">' +
    '</div>' +
    '<button onclick="tppSaveNotes(' + p.id + ')" ' +
      'class="' + _tppBtnPrimary() + ' w-full flex-shrink-0">💾 Save</button>' +
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

// Trigger hidden file picker
window.tppPickDocFile = function(panelId) {
  var inp = document.getElementById('tpp-doc-file-' + panelId);
  if (inp) inp.click();
};

// Upload selected file → populate URL + title fields
window.tppUploadDocFile = function(panelId) {
  var fileInp   = document.getElementById('tpp-doc-file-' + panelId);
  var urlInp    = document.getElementById('tpp-doc-url-'  + panelId);
  var titleInp  = document.getElementById('tpp-doc-title-' + panelId);
  var statusEl  = document.getElementById('tpp-doc-status-' + panelId);
  var addBtn    = fileInp && fileInp.closest('div[id^="tpp-doc-form"]') &&
                  fileInp.closest('div[id^="tpp-doc-form"]').querySelector('button[onclick^="tppSaveDocItem"]');
  if (!fileInp || !fileInp.files || !fileInp.files[0]) return;
  var file = fileInp.files[0];

  if (statusEl) statusEl.textContent = '⏳ Uploading…';
  if (addBtn)   addBtn.setAttribute('disabled', '');

  var fd = new FormData();
  fd.append('file', file);
  _tripFetch(
    '/home/trip/' + _tripPid + '/plans/' + _tppPlanId + '/panels/' + panelId + '/upload-doc',
    { method: 'POST', body: fd }
  ).then(function(r) { return r.json(); })
   .then(function(data) {
     if (data.error) throw new Error(data.error);
     if (urlInp)   urlInp.value   = data.url;
     if (titleInp && !titleInp.value.trim()) titleInp.value = data.name;
     if (statusEl) statusEl.textContent = '✓ Ready — click Add to save';
     if (addBtn)   addBtn.removeAttribute('disabled');
     // Reset file input so the same file can be re-picked
     fileInp.value = '';
   })
   .catch(function(err) {
     if (statusEl) statusEl.textContent = '❌ ' + (err.message || 'Upload failed');
     if (addBtn)   addBtn.removeAttribute('disabled');
   });
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

// When the Settle Up dropdown changes, repopulate the person dropdown
window.tppBudgetSettleChanged = function(panelId) {
  var settleEl  = document.getElementById('tpp-budget-link-settle-' + panelId);
  var personEl  = document.getElementById('tpp-budget-link-person-' + panelId);
  if (!settleEl || !personEl) return;
  var sid = parseInt(settleEl.value, 10);
  var sp = null;
  (window._tripPanels || []).forEach(function(x) { if (x.id === sid) sp = x; });
  var people = sp ? (_tppParse(sp.content).people || []) : [];
  personEl.innerHTML = people.length
    ? people.map(function(name, i) {
        return '<option value="' + i + '">' + _tripEsc(name) + '</option>';
      }).join('')
    : '<option value="">Add people to Settle Up first</option>';
};

// Save the Budget ↔ Settle Up person link
window.tppSaveBudgetLink = function(panelId) {
  var settleEl = document.getElementById('tpp-budget-link-settle-' + panelId);
  var personEl = document.getElementById('tpp-budget-link-person-' + panelId);
  if (!settleEl || !personEl || personEl.value === '') {
    _tripShowToast('Select a Settle Up card and a person first', true);
    return;
  }
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  d.linked_settle_id  = parseInt(settleEl.value, 10);
  d.linked_person_idx = parseInt(personEl.value, 10);
  _tppSave(panelId, d);
};

// Remove the Budget ↔ Settle Up person link
window.tppUnlinkBudget = function(panelId) {
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  delete d.linked_settle_id;
  delete d.linked_person_idx;
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
// ── Notes CE editor init ────────────────────────────────────────────────────────────
// Call this after inserting a notes-type panel card into the DOM.
// Seeds markdown from panel data, wires slash commands, fmt toolbar, auto-bullet.
// Uses setTimeout(0) so all defer'd scripts (slash_commands.js etc.) are ready.
window.tppNotesInitCe = function(panelId) {
  setTimeout(function() {
    var ce = document.getElementById('tpp-notes-ce-' + panelId);
    if (!ce) return;

    // Look up markdown from live panel data—no data-attr needed (no newline loss)
    var p  = _tppGetPanel(panelId);
    var md = p ? (_tppParse(p.content).text || '') : '';

    if (md && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      marked.use({ gfm: true, breaks: true });
      ce.innerHTML = DOMPurify.sanitize(marked.parse(md));
    } else {
      if (!ce.innerHTML.trim()) ce.innerHTML = '<p><br></p>';
    }

    if (typeof window.bwSlashAttachCE === 'function') window.bwSlashAttachCE(ce);
    if (typeof window.bwFmtAttach     === 'function') window.bwFmtAttach(ce);

    // One-time keyboard wiring (guard against re-init on the same element)
    if (ce._bwTppNoteWired) return;
    ce._bwTppNoteWired = true;

    function _saveRange() {
      var s = window.getSelection();
      if (!s || !s.rangeCount) return;
      try { ce._bwSavedRange = s.getRangeAt(0).cloneRange(); } catch (_) {}
    }
    ce.addEventListener('mouseup', _saveRange);
    ce.addEventListener('keyup',   _saveRange);

    // Capture-phase keydown: `- ` → <ul><li>  |  `1. ` → <ol><li>
    ce.addEventListener('keydown', function(e) {
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return;
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
      var node  = sel.getRangeAt(0).startContainer;
      var block = (node.nodeType === 3) ? node.parentElement : node;
      var BLOCKS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
      while (block && block !== ce && BLOCKS.indexOf(block.tagName) === -1) {
        block = block.parentElement;
      }
      if (!block || block === ce) return;
      var text = block.textContent.trim();
      if (text === '-') {
        e.preventDefault(); e.stopPropagation();
        _tppNoteReplaceBlockWithList(block, ce, 'ul');
      } else if (text === '1.') {
        e.preventDefault(); e.stopPropagation();
        _tppNoteReplaceBlockWithList(block, ce, 'ol');
      }
    }, true);
  }, 0);
};

function _tppNoteReplaceBlockWithList(block, ce, tag) {
  var list = document.createElement(tag);
  var li   = document.createElement('li');
  li.innerHTML = '<br>';
  list.appendChild(li);
  (block.parentNode || ce).replaceChild(list, block);
  var r = document.createRange();
  r.selectNodeContents(li);
  r.collapse(true);
  var s = window.getSelection();
  if (s) { s.removeAllRanges(); s.addRange(r); }
}

window.tppSaveNotes = function(panelId) {
  var ce  = document.getElementById('tpp-notes-ce-' + panelId);
  var text;
  if (ce) {
    if (typeof TurndownService !== 'undefined') {
      var td = new TurndownService({ bulletListMarker: '-', headingStyle: 'atx', codeBlockStyle: 'fenced' });
      if (window.turndownPluginGfm) td.use(turndownPluginGfm.gfm);
      text = td.turndown(ce.innerHTML).trimEnd();
    } else {
      text = ce.innerText || '';
    }
  } else {
    // Fallback: old textarea (should never be reached post-upgrade)
    text = ((document.getElementById('tpp-notes-' + panelId) || {}).value || '');
  }
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content); d.text = text;
  _tppSave(panelId, d, function() { _tripShowToast('Notes saved ✓'); });
};

// ── Settle Up ────────────────────────────────────────────────────────────────────

// ── Settle Up — view-mode modal ─────────────────────────────────────────────────────

// Build the content rendered inside the settle modal (full edit UI for the panel)
function _tppSettleModalContent(p) {
  var data = _tppParse(p.content);
  // _tppSettle(p, data, true) already includes the layout picker row
  return _tppSettle(p, data, true);
}

window.tppOpenSettleModal = function(panelId) {
  var p = _tppGetPanel(panelId);
  if (!p) return;

  // Remove any existing modal
  var old = document.getElementById('tpp-settle-modal');
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id             = 'tpp-settle-modal';
  overlay.dataset.panelId = String(panelId);
  overlay.className      = 'fixed inset-0 z-50 flex items-center justify-center p-4';
  overlay.style.background = 'rgba(0,0,0,0.45)';
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) window.tppCloseSettleModal();
  });

  var cfg   = _TPP_TYPES.settle;
  var title = p.title || cfg.label;
  overlay.innerHTML =
    '<div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden" ' +
         'style="width:420px;max-width:96vw;max-height:88vh">' +
      '<div class="flex items-center gap-2 px-4 py-3 flex-shrink-0 ' +
               'border-b border-gray-100 dark:border-zinc-800 ' +
               'bg-gradient-to-r from-blue-50/60 to-white dark:from-zinc-800 dark:to-zinc-900">' +
        '<span class="text-lg">' + cfg.icon + '</span>' +
        '<p class="flex-1 text-sm font-semibold text-gray-700 dark:text-zinc-200 truncate">' +
          _tripEsc(title) + '</p>' +
        '<button onclick="tppCloseSettleModal()" ' +
          'class="text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 text-xl leading-none ' +
                 'transition ml-1" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div id="tpp-settle-modal-body" class="flex-1 overflow-y-auto">' +
        _tppSettleModalContent(p) +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  // Trap focus: focus the first input
  setTimeout(function() {
    var inp = overlay.querySelector('input');
    if (inp) inp.focus();
  }, 60);
};

window.tppCloseSettleModal = function() {
  var m = document.getElementById('tpp-settle-modal');
  if (m) m.remove();
};

// ── Panel-ref popup (click a synced day block → view the Quick Card detail) ──────────
window.tppShowPanelRefPopup = function(panelId) {
  var p = _tppGetPanel(panelId);
  if (!p) { _tripShowToast('Quick Card not found', true); return; }

  // Remove any existing popup
  var old = document.getElementById('tpp-panelref-popup');
  if (old) old.remove();

  var cfg   = _TPP_TYPES[p.panel_type] || { icon: '📋', label: p.panel_type };
  var title = p.title || cfg.label;

  var overlay = document.createElement('div');
  overlay.id = 'tpp-panelref-popup';
  overlay.className =
    'fixed inset-0 z-50 flex items-center justify-center ' +
    'bg-black/40 dark:bg-black/60 backdrop-blur-sm';
  overlay.onclick = function(e) {
    if (e.target === overlay) window.tppClosePanelRefPopup();
  };

  overlay.innerHTML =
    '<div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden" ' +
         'style="width:380px;max-width:96vw;max-height:85vh" onclick="event.stopPropagation()">' +
      // Header
      '<div class="flex items-center gap-2 px-4 py-3 flex-shrink-0 ' +
               'border-b border-gray-100 dark:border-zinc-800 ' +
               'bg-gradient-to-r from-blue-50/60 to-white dark:from-zinc-800 dark:to-zinc-900">' +
        '<span class="text-lg flex-shrink-0">' + _tripEsc(cfg.icon) + '</span>' +
        '<span class="flex-1 text-sm font-semibold text-gray-700 dark:text-zinc-200 truncate">' +
          _tripEsc(title) + '</span>' +
        '<span class="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' +
          'bg-blue-100 dark:bg-blue-900/40 text-[#0053e2] dark:text-blue-300 flex-shrink-0">sync</span>' +
        '<button onclick="tppClosePanelRefPopup()" ' +
          'class="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 ' +
                 'text-xl leading-none transition flex-shrink-0" aria-label="Close">&times;</button>' +
      '</div>' +
      // Body — notes get read-only markdown; others use the standard view body
      '<div class="flex-1 overflow-y-auto">' +
        (p.panel_type === 'notes'
          ? (function() {
              var md = _tppParse(p.content).text || '';
              return '<div class="p-3 text-xs text-gray-800 dark:text-zinc-100 leading-relaxed ' +
                'prose prose-xs dark:prose-invert max-w-none">' +
                (md.trim()
                  ? (typeof _tripMdToHtml === 'function'
                      ? _tripMdToHtml(md)
                      : _tripEsc(md).replace(/\n/g, '<br>'))
                  : '<span class="text-gray-400 dark:text-zinc-500 italic">No notes yet.</span>') +
              '</div>';
            })()
          : _tppBody(p, _tppParse(p.content), false)) +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
};

window.tppClosePanelRefPopup = function() {
  var m = document.getElementById('tpp-panelref-popup');
  if (m) m.remove();
};

// Change the layout of a Settle Up card and persist it
window.tppSettleSetLayout = function(panelId, layout) {
  var p = _tppGetPanel(panelId);
  if (!p) return;
  var d = _tppParse(p.content);
  d.layout = layout;
  _tppSave(panelId, d, null); // _tppRefreshCard fires inside _tppSave
};

function _tppSettleCompact(p, data) {
  var people   = data.people   || [];
  var expenses = data.expenses || [];
  var cur      = data.currency || 'USD';
  var total    = expenses.reduce(function(s, e) { return s + (parseFloat(e.amount) || 0); }, 0);
  var txns     = _tppComputeSettlement(data);
  var txnRows  = txns.map(function(t) {
    return '<div class="flex items-center gap-1 py-0.5">' +
      '<span class="text-xs font-medium truncate max-w-[35%]">' + _tripEsc(people[t.from] || '?') + '</span>' +
      '<span class="text-[10px] text-gray-400 flex-shrink-0">→</span>' +
      '<span class="text-xs font-medium truncate flex-1">' + _tripEsc(people[t.to] || '?') + '</span>' +
      '<span class="text-xs font-semibold text-[#0053e2] ml-auto">' + cur + ' ' + t.amt.toFixed(2) + '</span>' +
    '</div>';
  }).join('');
  return '<div class="px-3 py-2 text-center border-b border-gray-100 dark:border-zinc-800">' +
      '<p class="text-[10px] text-gray-400 dark:text-zinc-500">' + expenses.length + ' expenses</p>' +
      '<p class="text-xl font-bold text-gray-700 dark:text-zinc-200">' + cur + ' ' + total.toFixed(2) + '</p>' +
    '</div>' +
    '<div class="px-3 py-2">' +
      (txnRows || '<p class="text-[10px] text-gray-400 italic text-center py-2">🎉 All settled!</p>') +
    '</div>';
}

function _tppSettleLedger(p, data) {
  var people   = data.people   || [];
  var expenses = data.expenses || [];
  var cur      = data.currency || 'USD';
  if (!people.length) return '<p class="text-[10px] text-gray-400 italic px-3 py-2">No people yet</p>';

  var paid  = people.map(function() { return 0; });
  var share = people.map(function() { return 0; });
  expenses.forEach(function(exp) {
    var amt   = parseFloat(exp.amount) || 0;
    var payer = parseInt(exp.paid_by, 10);
    var spl   = exp.split || [];
    if (isNaN(payer) || payer < 0 || payer >= people.length || !spl.length) return;
    paid[payer] += amt;
    var perHead = amt / spl.length;
    spl.forEach(function(i) { if (i >= 0 && i < people.length) share[i] += perHead; });
  });

  var rows = people.map(function(name, i) {
    var net = paid[i] - share[i];
    var netCls = net > 0.005
      ? 'text-[#2a8703] dark:text-green-400 font-semibold'
      : (net < -0.005 ? 'text-[#ea1100] dark:text-red-400 font-semibold' : 'text-gray-400 dark:text-zinc-500');
    var netStr = (net >= 0 ? '+' : '') + net.toFixed(2);
    return '<tr class="border-b border-gray-50 dark:border-zinc-800 last:border-0">' +
      '<td class="py-1.5 px-2 text-xs font-medium text-gray-700 dark:text-zinc-200 max-w-[80px] truncate">' + _tripEsc(name) + '</td>' +
      '<td class="py-1.5 px-2 text-xs text-right text-gray-600 dark:text-zinc-300">' + paid[i].toFixed(2) + '</td>' +
      '<td class="py-1.5 px-2 text-xs text-right text-gray-600 dark:text-zinc-300">' + share[i].toFixed(2) + '</td>' +
      '<td class="py-1.5 px-2 text-xs text-right ' + netCls + '">' + netStr + '</td>' +
    '</tr>';
  }).join('');

  return '<div class="overflow-x-auto">' +
    '<table class="w-full text-left">' +
      '<thead>' +
        '<tr class="border-b border-gray-100 dark:border-zinc-700">' +
          '<th class="py-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500">Person</th>' +
          '<th class="py-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 text-right">Paid</th>' +
          '<th class="py-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 text-right">Share</th>' +
          '<th class="py-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-zinc-500 text-right">Net</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>' +
  '</div>' +
  '<p class="text-[10px] text-gray-400 dark:text-zinc-500 px-3 py-1">' + cur + ' • + owed to you / − you owe</p>';
}

function _tppSettleReceipt(p, data) {
  var people   = data.people   || [];
  var expenses = data.expenses || [];
  var cur      = data.currency || 'USD';
  if (!expenses.length) return '<p class="text-[10px] text-gray-400 italic px-3 py-2">No expenses recorded</p>';

  var total = 0;
  var rows = expenses.map(function(exp) {
    var amt      = parseFloat(exp.amount) || 0;
    total += amt;
    var payer    = people[parseInt(exp.paid_by, 10)] || '?';
    var splitNames = (exp.split || []).map(function(i) { return people[i] || '?'; }).join(', ');
    return '<div class="flex items-start gap-2 px-3 py-1.5 border-b border-gray-50 dark:border-zinc-800 last:border-0">' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate">' + _tripEsc(exp.desc || 'Expense') + '</p>' +
        '<p class="text-[10px] text-gray-400 dark:text-zinc-500 truncate">💳 ' + _tripEsc(payer) + ' · 🧑‍🧑‍🧒 ' + _tripEsc(splitNames) + '</p>' +
      '</div>' +
      '<span class="text-xs font-semibold text-gray-700 dark:text-zinc-200 flex-shrink-0">' + cur + ' ' + amt.toFixed(2) + '</span>' +
    '</div>';
  }).join('');

  return '<div class="max-h-60 overflow-y-auto">' + rows + '</div>' +
    '<div class="flex justify-between items-center px-3 py-2 border-t border-gray-200 dark:border-zinc-700 ' +
               'bg-gray-50 dark:bg-zinc-800">' +
      '<span class="text-xs font-semibold text-gray-500 dark:text-zinc-400">Total</span>' +
      '<span class="text-sm font-bold text-gray-700 dark:text-zinc-200">' + cur + ' ' + total.toFixed(2) + '</span>' +
    '</div>';
}

// ── Settle Up (main renderer) ───────────────────────────────────────────────────

function _tppSettle(p, data, isEdit) {
  var people   = data.people   || [];
  var expenses = data.expenses || [];
  var cur      = data.currency || 'USD';
  var layout   = data.layout   || 'standard';

  // ─ Layout picker (shown in BOTH view and edit mode) ─────────────────────────────
  var layouts = ['standard','compact','ledger','receipt'];
  var layoutPicker =
    '<div class="flex items-center gap-1 px-3 pt-2 pb-1 flex-shrink-0 ' +
      'border-b border-gray-100 dark:border-zinc-800">' +
      '<span class="text-[10px] text-gray-400 dark:text-zinc-500 mr-1 flex-shrink-0">View:</span>' +
      layouts.map(function(l) {
        var active = l === layout;
        return '<button type="button" onclick="tppSettleSetLayout(' + p.id + ',\'' + l + '\')" ' +
          'class="px-1.5 py-0.5 rounded text-[10px] font-semibold transition ' +
          (active
            ? 'bg-[#0053e2] text-white'
            : 'bg-gray-100 dark:bg-zinc-700 text-gray-500 dark:text-zinc-300 ' +
              'hover:bg-gray-200 dark:hover:bg-zinc-600') + '">' +
          l.charAt(0).toUpperCase() + l.slice(1) + '</button>';
      }).join('') +
    '</div>';

  // ─ View mode: dispatch non-standard layouts (standard falls through) ─────────
  if (!isEdit) {
    if (layout === 'compact') return layoutPicker + _tppSettleCompact(p, data);
    if (layout === 'ledger')  return layoutPicker + _tppSettleLedger(p, data);
    if (layout === 'receipt') return layoutPicker + _tppSettleReceipt(p, data);
    // 'standard' falls through to the full standard renderer below
  }

  // ─ Currency row (edit mode) ────────────────────────────────────
  var curRow = isEdit
    ? '<div class="flex items-center gap-1.5 px-3 pt-2 pb-1">' +
        '<span class="text-[10px] text-gray-500 dark:text-zinc-400 flex-shrink-0">Currency:</span>' +
        '<input id="tpp-settle-cur-' + p.id + '" type="text" maxlength="5" ' +
          'value="' + _tripEsc(cur) + '" ' +
          'class="w-14 text-xs rounded border border-gray-200 dark:border-zinc-700 ' +
                 'bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 ' +
                 'px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#0053e2]/40" />' +
        '<button onclick="tppSettleSaveCur(' + p.id + ')" ' +
          'class="text-[10px] px-2 py-1 rounded bg-gray-100 dark:bg-zinc-700 ' +
                 'text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-600 transition">Set</button>' +
      '</div>'
    : '';

  // ─ People chips ───────────────────────────────────────
  var chips = people.map(function(name, idx) {
    var del = isEdit
      ? '<button onclick="tppRemoveSettlePerson(' + p.id + ',' + idx + ')" ' +
          'class="ml-0.5 text-gray-400 hover:text-red-400 leading-none">&times;</button>'
      : '';
    return '<span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] ' +
      'bg-blue-50 dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-300 border ' +
      'border-blue-200 dark:border-blue-700">' +
      _tripEsc(name) + del + '</span>';
  }).join('');

  var addPersonRow = isEdit
    ? '<div class="flex gap-1 mt-1">' +
        '<input id="tpp-settle-person-' + p.id + '" type="text" maxlength="40" ' +
          'placeholder="Name" ' +
          'class="flex-1 text-xs rounded border border-gray-200 dark:border-zinc-700 ' +
                 'bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 ' +
                 'px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#0053e2]/40" ' +
          'onkeydown="if(event.key===\'Enter\'){tppAddSettlePerson(' + p.id + ');event.preventDefault();}" />' +
        '<button onclick="tppAddSettlePerson(' + p.id + ')" ' +
          'class="flex-shrink-0 px-2 py-1 text-xs rounded bg-[#0053e2] text-white ' +
                 'hover:bg-[#0046c0] transition">＋</button>' +
      '</div>'
    : '';

  var peopleSection =
    '<div class="px-3 py-2 flex-shrink-0 border-b border-gray-100 dark:border-zinc-800">' +
      '<p class="text-[10px] font-semibold uppercase tracking-wide ' +
         'text-gray-400 dark:text-zinc-500 mb-1">👥 People</p>' +
      '<div class="flex flex-wrap gap-1">' +
        (chips || '<span class="text-[10px] text-gray-400 dark:text-zinc-500 italic">No people yet</span>') +
      '</div>' +
      addPersonRow +
    '</div>';

  // ─ Expenses list ──────────────────────────────────────
  var expRows = expenses.map(function(exp, idx) {
    var payer    = people[exp.paid_by] || '?';
    var splitNames = (exp.split || []).map(function(i) { return people[i] || '?'; }).join(', ');
    var del = isEdit
      ? '<button onclick="tppDeleteSettleExp(' + p.id + ',' + idx + ')" ' +
          'class="text-gray-300 hover:text-red-400 text-xs flex-shrink-0 ml-1">✕</button>'
      : '';
    return '<div class="flex items-start gap-1 px-3 py-1.5 border-b ' +
             'border-gray-50 dark:border-zinc-800/60 last:border-0">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-baseline justify-between gap-1">' +
          '<span class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate">' +
            _tripEsc(exp.desc || 'Expense') + '</span>' +
          '<span class="text-xs font-semibold text-gray-700 dark:text-zinc-200 flex-shrink-0">' +
            cur + ' ' + parseFloat(exp.amount || 0).toFixed(2) + '</span>' +
        '</div>' +
        '<p class="text-[10px] text-gray-400 dark:text-zinc-500 truncate">' +
          '💳 ' + _tripEsc(payer) +
          ' · split: ' + _tripEsc(splitNames) + '</p>' +
      '</div>' + del + '</div>';
  }).join('');

  var expSection =
    '<div class="flex-shrink-0 border-b border-gray-100 dark:border-zinc-800">' +
      '<p class="text-[10px] font-semibold uppercase tracking-wide ' +
         'text-gray-400 dark:text-zinc-500 px-3 pt-2 pb-0.5">💸 Expenses</p>' +
      '<div class="max-h-40 overflow-y-auto">' +
        (expRows || '<p class="text-[10px] text-gray-400 dark:text-zinc-500 italic px-3 py-1">No expenses yet</p>') +
      '</div>' +
    '</div>';

  // ─ Expense add form ──────────────────────────────────
  var splitBtns = people.length
    ? people.map(function(name, idx) {
        return '<button type="button" data-split-idx="' + idx + '" data-selected="1" ' +
          'onclick="tppToggleSettleSplit(this)" ' +
          'class="tpp-split-btn px-1.5 py-0.5 text-[10px] rounded-full border transition ' +
                 'bg-[#0053e2] border-[#0053e2] text-white ' +
                 'dark:bg-[#0053e2] dark:border-[#0053e2]">' +
          _tripEsc(name) + '</button>';
      }).join('')
    : '<span class="text-[10px] text-gray-400 dark:text-zinc-500 italic">Add people first</span>';

  var expForm = isEdit && people.length >= 2
    ? '<div id="tpp-settle-form-' + p.id + '" class="hidden px-3 py-2 space-y-1.5 ' +
        'border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50">' +
        '<input id="tpp-settle-desc-' + p.id + '" type="text" placeholder="What was it?" maxlength="60" ' +
          'class="' + _tppInputCls() + '" />' +
        '<div class="flex gap-1.5">' +
          '<input id="tpp-settle-amt-' + p.id + '" type="number" step="0.01" min="0" ' +
            'placeholder="Amount" class="' + _tppInputCls() + ' flex-1" />' +
          '<select id="tpp-settle-payer-' + p.id + '" class="' + _tppInputCls() + ' flex-1">' +
            people.map(function(name, i) {
              return '<option value="' + i + '">' + _tripEsc(name) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<div>' +
          '<p class="text-[10px] text-gray-500 dark:text-zinc-400 mb-1">Split between:</p>' +
          '<div id="tpp-settle-split-' + p.id + '" class="flex flex-wrap gap-1">' +
            splitBtns +
          '</div>' +
        '</div>' +
        _tppFormBtns('tppSaveSettleExp(' + p.id + ')', 'tppHideForm(' + p.id + ',\'settle\')') +
      '</div>'
    : '';

  // ─ Settlement summary ─────────────────────────────────
  var txns = _tppComputeSettlement(data);
  var txnRows = txns.map(function(t) {
    return '<div class="flex items-center gap-1 py-1">' +
      '<span class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate max-w-[35%]">' +
        _tripEsc(people[t.from] || '?') + '</span>' +
      '<span class="text-[10px] text-gray-400 flex-shrink-0">→ pays</span>' +
      '<span class="text-xs font-medium text-gray-700 dark:text-zinc-200 truncate flex-1 max-w-[35%]">' +
        _tripEsc(people[t.to] || '?') + '</span>' +
      '<span class="text-xs font-semibold text-[#0053e2] dark:text-blue-400 flex-shrink-0 ml-auto">' +
        cur + ' ' + t.amt.toFixed(2) + '</span>' +
    '</div>';
  }).join('');

  var settleSection = expenses.length && people.length >= 2
    ? '<div class="flex-shrink-0 px-3 py-2 ' +
        'bg-blue-50/50 dark:bg-blue-900/10 ' +
        'border-t border-blue-100 dark:border-blue-900/30">' +
        '<p class="text-[10px] font-semibold uppercase tracking-wide ' +
           'text-[#0053e2] dark:text-blue-400 mb-1">✅ Who Pays Who</p>' +
        (txnRows ||
          '<p class="text-[10px] text-gray-400 dark:text-zinc-500 italic">All square! 🎉</p>') +
      '</div>'
    : '';

  var footer = isEdit && people.length >= 2
    ? _tppAddBtn('tppShowForm(' + p.id + ',\'settle\')', '＋ Add Expense')
    : (isEdit && people.length < 2
      ? '<p class="text-[10px] text-gray-400 dark:text-zinc-500 italic text-center py-2">' +
          'Add at least 2 people to start</p>'
      : '');

  return layoutPicker + curRow + peopleSection + expSection + expForm + settleSection + footer;
}

// Compute minimum transactions to settle all debts (greedy algorithm)
function _tppComputeSettlement(data) {
  var people   = data.people   || [];
  var expenses = data.expenses || [];
  if (people.length < 2 || !expenses.length) return [];

  // Net balance: positive = owed money, negative = owes money
  var bal = people.map(function() { return 0; });
  expenses.forEach(function(exp) {
    var amt   = parseFloat(exp.amount) || 0;
    var payer = parseInt(exp.paid_by, 10);
    var split = exp.split || [];
    if (!split.length || isNaN(payer) || payer < 0 || payer >= people.length) return;
    var share = amt / split.length;
    bal[payer] += amt;
    split.forEach(function(idx) {
      if (idx >= 0 && idx < people.length) bal[idx] -= share;
    });
  });

  // Separate into creditors (positive) and debtors (negative)
  var cred = [], debt = [];
  bal.forEach(function(b, i) {
    if (b >  0.005) cred.push({ idx: i, amt: b });
    if (b < -0.005) debt.push({ idx: i, amt: -b });
  });
  cred.sort(function(a, b) { return b.amt - a.amt; });
  debt.sort(function(a, b) { return b.amt - a.amt; });

  var txns = [], ci = 0, di = 0;
  while (ci < cred.length && di < debt.length) {
    var settle = Math.min(cred[ci].amt, debt[di].amt);
    if (settle > 0.005) {
      txns.push({ from: debt[di].idx, to: cred[ci].idx, amt: Math.round(settle * 100) / 100 });
    }
    cred[ci].amt -= settle;
    debt[di].amt -= settle;
    if (cred[ci].amt < 0.005) ci++;
    if (debt[di].amt < 0.005) di++;
  }
  return txns;
}

// Settle Up window functions
window.tppToggleSettleSplit = function(btn) {
  var sel = btn.getAttribute('data-selected') === '1';
  btn.setAttribute('data-selected', sel ? '0' : '1');
  if (!sel) {
    btn.className = btn.className
      .replace('bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-600',
               'bg-[#0053e2] border-[#0053e2] text-white dark:bg-[#0053e2] dark:border-[#0053e2]');
  } else {
    btn.className = btn.className
      .replace('bg-[#0053e2] border-[#0053e2] text-white dark:bg-[#0053e2] dark:border-[#0053e2]',
               'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-600');
  }
};

window.tppAddSettlePerson = function(panelId) {
  var inp  = document.getElementById('tpp-settle-person-' + panelId);
  var name = inp ? inp.value.trim() : '';
  if (!name) return;
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  if (!d.people) d.people = [];
  d.people.push(name);
  _tppSave(panelId, d);
};

window.tppRemoveSettlePerson = function(panelId, idx) {
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  // Remove person, then remap expense references
  d.people.splice(idx, 1);
  var total = d.people.length;
  d.expenses = (d.expenses || []).filter(function(exp) {
    exp.split    = (exp.split || []).filter(function(i) { return i !== idx; })
                                    .map(function(i) { return i > idx ? i - 1 : i; });
    if (exp.paid_by === idx) return false;         // remove expenses paid by deleted person
    if (exp.paid_by > idx) exp.paid_by -= 1;
    return exp.split.length > 0 && exp.paid_by >= 0 && exp.paid_by < total;
  });
  _tppSave(panelId, d);
};

window.tppSaveSettleExp = function(panelId) {
  var desc  = ((document.getElementById('tpp-settle-desc-'  + panelId) || {}).value || '').trim();
  var amt   = parseFloat((document.getElementById('tpp-settle-amt-' + panelId) || {}).value || '0');
  var payer = parseInt((document.getElementById('tpp-settle-payer-' + panelId) || {}).value || '0', 10);
  var splitContainer = document.getElementById('tpp-settle-split-' + panelId);
  var splitIdxs = [];
  if (splitContainer) {
    var btns = splitContainer.querySelectorAll('.tpp-split-btn');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-selected') === '1') {
        splitIdxs.push(parseInt(btns[i].getAttribute('data-split-idx'), 10));
      }
    }
  }
  if (!desc) { _tripShowToast('Description required', true); return; }
  if (!amt || amt <= 0) { _tripShowToast('Amount required', true); return; }
  if (!splitIdxs.length) { _tripShowToast('Select at least one person to split with', true); return; }
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  if (!d.expenses) d.expenses = [];
  d.expenses.push({ desc: desc, paid_by: payer, amount: amt, split: splitIdxs });
  _tppSave(panelId, d);
};

window.tppDeleteSettleExp = function(panelId, idx) {
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content);
  (d.expenses || []).splice(idx, 1);
  _tppSave(panelId, d);
};

window.tppSettleSaveCur = function(panelId) {
  var cur = ((document.getElementById('tpp-settle-cur-' + panelId) || {}).value || 'USD').trim().toUpperCase();
  var p = _tppGetPanel(panelId); if (!p) return;
  var d = _tppParse(p.content); d.currency = cur;
  _tppSave(panelId, d);
};

// ── Panel-level CRUD ────────────────────────────────────────────────

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
