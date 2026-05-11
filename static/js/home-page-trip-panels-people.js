/**
 * home-page-trip-panels-people.js — "People" Trip Resource card.
 *
 * Stores trip members with optional phone, email, and emergency contact.
 * Can link to a Settle Up panel to display live per-person balances.
 *
 * Data format:
 *   { members: [{name, phone, email, emergency_name, emergency_phone}],
 *     linked_settle_id: <int|null> }
 *
 * Exposes via window:
 *   _tppPeople, tppShowPersonForm, tppHidePersonForm, tppEditPersonItem,
 *   tppSavePersonItem, tppDeletePersonItem,
 *   tppSavePeopleSettleLink, tppUnlinkPeopleSettle,
 *   _tppFindLinkedPeoplePanel
 *
 * Called from home-page-trip-panels.js (_tppBody dispatch + settle badge).
 */

// ── People card renderer ───────────────────────────────────────────────────────

window._tppPeople = function(p, data, isEdit) {
  var members        = data.members || [];
  var rawSettleId    = data.linked_settle_id;
  var linkedSettleId = rawSettleId != null ? parseInt(rawSettleId, 10) : null;

  // ── Resolve settle panel & compute per-person balances ───────────────────
  var settlePanel = null;
  var balances    = {};   // name → {paid, owes, balance}
  var settleCur   = 'USD';

  if (linkedSettleId !== null) {
    (window._tripPanels || []).forEach(function(x) {
      if (x.id === linkedSettleId) settlePanel = x;
    });
  }
  if (settlePanel) {
    var sd      = _tppParse(settlePanel.content);
    settleCur   = sd.currency || 'USD';
    var sdNames = sd.people   || [];
    sdNames.forEach(function(name) {
      balances[name] = { paid: 0, owes: 0, balance: 0 };
    });
    (sd.expenses || []).forEach(function(exp) {
      var paidBy   = parseInt(exp.paid_by, 10);
      var split    = exp.split || [];
      var amount   = parseFloat(exp.amount) || 0;
      if (!isNaN(paidBy) && sdNames[paidBy]) {
        balances[sdNames[paidBy]].paid += amount;
      }
      if (split.length) {
        var share = amount / split.length;
        split.forEach(function(idx) {
          if (sdNames[idx]) balances[sdNames[idx]].owes += share;
        });
      }
    });
    sdNames.forEach(function(name) {
      if (balances[name]) {
        balances[name].balance = balances[name].paid - balances[name].owes;
      }
    });
  }

  // ── Member rows ────────────────────────────────────────────────────────────
  var rows = members.map(function(m, idx) {
    var name     = m.name || '?';
    var initial  = name.trim().charAt(0).toUpperCase();
    var hue      = name.split('').reduce(function(a, c) { return a + c.charCodeAt(0); }, 0) % 360;
    var avatarBg = 'background:hsl(' + hue + ',50%,46%)';

    // Settle balance badge
    var balBadge = '';
    if (settlePanel && balances[name] !== undefined) {
      var bal    = balances[name].balance;
      var balAbs = settleCur + '\u00a0' + Math.abs(Math.round(bal)).toLocaleString('en-US');
      balBadge = bal > 0.5
        ? '<span class="ml-1 text-[9px] font-semibold text-[#2a8703] dark:text-green-400 ' +
            'bg-green-50 dark:bg-green-900/30 px-1.5 rounded-full whitespace-nowrap">+' + balAbs + '</span>'
        : bal < -0.5
          ? '<span class="ml-1 text-[9px] font-semibold text-[#ea1100] dark:text-red-400 ' +
              'bg-red-50 dark:bg-red-900/30 px-1.5 rounded-full whitespace-nowrap">\u2212' + balAbs + '</span>'
          : '<span class="ml-1 text-[9px] font-semibold text-[#2a8703] dark:text-green-400 ' +
              'bg-green-50 dark:bg-green-900/30 px-1.5 rounded-full">\u2713 settled</span>';
    }

    // Contact lines
    var phoneHtml = m.phone
      ? '<a href="tel:' + _tripEsc(m.phone.replace(/[\s\-]/g, '')) + '" ' +
          'onclick="event.stopPropagation()" ' +
          'class="text-[10px] text-[#0053e2] dark:text-blue-400 hover:underline ' +
                 'flex items-center gap-0.5 leading-tight">' +
          '\uD83D\uDCDE\uFE0F ' + _tripEsc(m.phone) +
        '</a>'
      : '';
    var emailHtml = m.email
      ? '<a href="mailto:' + _tripEsc(m.email) + '" ' +
          'onclick="event.stopPropagation()" ' +
          'class="text-[10px] text-[#0053e2] dark:text-blue-400 hover:underline ' +
                 'flex items-center gap-0.5 leading-tight truncate">' +
          '\u2709\uFE0F ' + _tripEsc(m.email) +
        '</a>'
      : '';
    var emergHtml = '';
    if (m.emergency_name || m.emergency_phone) {
      var emergPhone = m.emergency_phone
        ? ' \u00b7 <a href="tel:' + _tripEsc(m.emergency_phone.replace(/[\s\-]/g, '')) + '" ' +
            'onclick="event.stopPropagation()" ' +
            'class="text-[#0053e2] dark:text-blue-400 hover:underline">' +
            _tripEsc(m.emergency_phone) + '</a>'
        : '';
      emergHtml =
        '<p class="text-[10px] text-gray-400 dark:text-zinc-500 leading-tight mt-0.5">' +
          '\u26A0\uFE0F ' + _tripEsc(m.emergency_name || '') + emergPhone +
        '</p>';
    }

    var editBtns = isEdit
      ? '<div class="flex-shrink-0 flex gap-1.5 ml-1 self-start pt-0.5">' +
          '<button onclick="tppEditPersonItem(' + p.id + ',' + idx + ')" ' +
            'title="Edit" aria-label="Edit person" ' +
            'class="text-gray-300 dark:text-zinc-600 hover:text-[#0053e2] ' +
                   'dark:hover:text-blue-400 text-xs leading-none">\u270E</button>' +
          '<button onclick="tppDeletePersonItem(' + p.id + ',' + idx + ')" ' +
            'title="Remove" aria-label="Remove person" ' +
            'class="text-gray-300 dark:text-zinc-600 hover:text-red-400 text-xs leading-none">\u2715</button>' +
        '</div>'
      : '';

    return '<div class="flex items-start gap-2 px-3 py-2.5 border-b ' +
      'border-gray-50 dark:border-zinc-800 last:border-0 ' +
      'hover:bg-gray-50/50 dark:hover:bg-zinc-800/30 transition-colors">' +
      // Avatar circle
      '<div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ' +
        'text-white text-[13px] font-bold select-none" style="' + avatarBg + '">' +
        _tripEsc(initial) +
      '</div>' +
      '<div class="flex-1 min-w-0 overflow-hidden">' +
        '<div class="flex items-center flex-wrap">' +
          '<span class="text-xs font-semibold text-gray-800 dark:text-zinc-100">' +
            _tripEsc(name) +
          '</span>' +
          balBadge +
        '</div>' +
        phoneHtml + emailHtml + emergHtml +
      '</div>' +
      editBtns +
    '</div>';
  }).join('');

  // ── Add / Edit form (edit mode only) ─────────────────────────────────────
  var form = isEdit
    ? '<div id="tpp-person-form-' + p.id + '" ' +
        'class="hidden px-3 py-2.5 space-y-1.5 flex-shrink-0 ' +
               'border-t border-gray-100 dark:border-zinc-800 ' +
               'bg-gray-50 dark:bg-zinc-800/50">' +
        '<input type="hidden" id="tpp-person-edit-idx-' + p.id + '" value="-1" />' +
        '<p class="text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide">Person</p>' +
        '<input id="tpp-person-name-' + p.id + '" type="text" ' +
          'placeholder="Name *" maxlength="80" ' +
          'class="' + _tppInputCls() + '" />' +
        '<input id="tpp-person-phone-' + p.id + '" type="tel" ' +
          'placeholder="Phone (optional)" maxlength="40" ' +
          'class="' + _tppInputCls() + '" />' +
        '<input id="tpp-person-email-' + p.id + '" type="email" ' +
          'placeholder="Email (optional)" maxlength="120" ' +
          'class="' + _tppInputCls() + '" />' +
        '<p class="text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide pt-1">' +
          'Emergency Contact</p>' +
        '<input id="tpp-person-ename-' + p.id + '" type="text" ' +
          'placeholder="Contact name (optional)" maxlength="80" ' +
          'class="' + _tppInputCls() + '" />' +
        '<input id="tpp-person-ephone-' + p.id + '" type="tel" ' +
          'placeholder="Contact phone (optional)" maxlength="40" ' +
          'class="' + _tppInputCls() + '" />' +
        '<div class="flex gap-1.5">' +
          '<button onclick="tppSavePersonItem(' + p.id + ')" ' +
            'class="' + _tppBtnPrimary() + '">Save</button>' +
          '<button onclick="tppHidePersonForm(' + p.id + ')" ' +
            'class="' + _tppBtnSecondary() + '">Cancel</button>' +
        '</div>' +
      '</div>'
    : '';

  // ── Settle-link section ───────────────────────────────────────────────────
  var settleSection = _tppPeopleSettleSection(p, linkedSettleId, settlePanel, isEdit);

  // ── Add Person button ─────────────────────────────────────────────────────
  var footer = isEdit ? _tppAddBtn('tppShowPersonForm(' + p.id + ')', '\uFF0B Add Person') : '';

  return '<div class="flex-1 overflow-y-auto min-h-0">' +
      (rows || _tppEmpty('No people added yet \u2014 tap \u201c+ Add Person\u201d below.')) +
    '</div>' +
    form + footer + settleSection;
};

// Settle-link section (extracted to keep _tppPeople readable)
function _tppPeopleSettleSection(p, linkedSettleId, settlePanel, isEdit) {
  if (!isEdit && !settlePanel) return '';

  // View mode: compact badge only
  if (!isEdit) {
    return '<div class="px-3 py-1.5 border-t border-gray-100 dark:border-zinc-800 flex-shrink-0">' +
      '<span class="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full ' +
        'bg-blue-50 dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-400">' +
        '\uD83D\uDD17 ' + _tripEsc(settlePanel.title || 'Settle Up') +
      '</span>' +
    '</div>';
  }

  // Edit mode: dropdown + link/unlink button
  var settlePanels = (window._tripPanels || []).filter(function(x) {
    return x.panel_type === 'settle';
  });

  var inner = '';
  if (settlePanels.length) {
    inner =
      '<p class="text-[10px] text-gray-400 dark:text-zinc-500 mb-1">' +
        '\uD83D\uDD17 Link to Settle Up \u2014 show live balances per person</p>' +
      '<div class="flex gap-1">' +
        '<select id="tpp-people-settle-sel-' + p.id + '" ' +
          'class="flex-1 text-xs rounded-lg border border-gray-200 dark:border-zinc-700 ' +
                 'bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 px-2 py-1.5">' +
          '<option value="">— No link —</option>' +
          settlePanels.map(function(sp) {
            var sel = linkedSettleId === sp.id ? ' selected' : '';
            return '<option value="' + sp.id + '"' + sel + '>' +
              _tripEsc(sp.title || 'Settle Up') + '</option>';
          }).join('') +
        '</select>' +
        '<button onclick="tppSavePeopleSettleLink(' + p.id + ')" ' +
          'class="' + _tppBtnPrimary() + ' flex-shrink-0">Link</button>' +
      '</div>' +
      (linkedSettleId
        ? '<button onclick="tppUnlinkPeopleSettle(' + p.id + ')" ' +
            'class="mt-1 text-[10px] text-red-400 hover:text-red-500">\u2715 Remove link</button>'
        : '');
  } else {
    inner =
      '<p class="text-[10px] text-gray-400 dark:text-zinc-500 italic">' +
        'Add a Settle Up card first to link balances.</p>';
  }

  return '<div class="px-3 py-2 border-t border-gray-100 dark:border-zinc-800 ' +
    'bg-gray-50 dark:bg-zinc-800/30 flex-shrink-0">' + inner + '</div>';
}

// ── Event handlers ─────────────────────────────────────────────────────────────

window.tppShowPersonForm = function(panelId) {
  var el = document.getElementById('tpp-person-form-' + panelId);
  if (!el) return;
  el.classList.remove('hidden');
  var nameEl = document.getElementById('tpp-person-name-' + panelId);
  if (nameEl) nameEl.focus();
};

window.tppHidePersonForm = function(panelId) {
  var el = document.getElementById('tpp-person-form-' + panelId);
  if (el) el.classList.add('hidden');
  // Reset all fields
  ['edit-idx', 'name', 'phone', 'email', 'ename', 'ephone'].forEach(function(f) {
    var inp = document.getElementById('tpp-person-' + f + '-' + panelId);
    if (inp) inp.value = f === 'edit-idx' ? '-1' : '';
  });
};

window.tppEditPersonItem = function(panelId, idx) {
  var p = _tppGetPanel(panelId);
  if (!p) return;
  var d = _tppParse(p.content);
  var m = (d.members || [])[idx];
  if (!m) return;
  var set = function(field, val) {
    var el = document.getElementById('tpp-person-' + field + '-' + panelId);
    if (el) el.value = val || '';
  };
  set('edit-idx', idx);
  set('name',     m.name);
  set('phone',    m.phone);
  set('email',    m.email);
  set('ename',    m.emergency_name);
  set('ephone',   m.emergency_phone);
  window.tppShowPersonForm(panelId);
  var form = document.getElementById('tpp-person-form-' + panelId);
  if (form) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.tppSavePersonItem = function(panelId) {
  var get = function(field) {
    var el = document.getElementById('tpp-person-' + field + '-' + panelId);
    return el ? el.value.trim() : '';
  };
  var name = get('name');
  if (!name) { _tripShowToast('Name is required', true); return; }
  var editIdx = parseInt(get('edit-idx'), 10);
  var member = {
    name:            name,
    phone:           get('phone'),
    email:           get('email'),
    emergency_name:  get('ename'),
    emergency_phone: get('ephone'),
  };
  var p = _tppGetPanel(panelId);
  if (!p) return;
  var d = _tppParse(p.content);
  if (!d.members) d.members = [];
  if (editIdx >= 0 && editIdx < d.members.length) {
    d.members[editIdx] = member;
  } else {
    d.members.push(member);
  }
  _tppSave(panelId, d, function() { _tppSyncPeopleToSettle(panelId); });
};

window.tppDeletePersonItem = function(panelId, idx) {
  var p = _tppGetPanel(panelId);
  if (!p) return;
  var d = _tppParse(p.content);
  if (!d.members) return;
  var _removedName = (d.members[idx] || {}).name || null;
  d.members.splice(idx, 1);
  _tppSave(panelId, d, function() {
    if (_removedName) _tppRemovePersonFromSettleByName(panelId, _removedName);
    else              _tppSyncPeopleToSettle(panelId);
  });
};

window.tppSavePeopleSettleLink = function(panelId) {
  var sel = document.getElementById('tpp-people-settle-sel-' + panelId);
  if (!sel) return;
  var sid = sel.value ? parseInt(sel.value, 10) : null;
  var p   = _tppGetPanel(panelId);
  if (!p) return;
  var d = _tppParse(p.content);
  var prevSid = d.linked_settle_id;
  d.linked_settle_id = sid;

  // When linking a NEW settle panel that already has people, seed any
  // names not yet in this People card (preserves existing members).
  if (sid && sid !== prevSid) {
    var sp = _tppGetPanel(sid);
    if (sp) {
      var sd     = _tppParse(sp.content);
      var sNames = sd.people || [];
      var existing = (d.members || []).map(function(m) { return m.name; });
      if (!d.members) d.members = [];
      sNames.forEach(function(name) {
        if (name && existing.indexOf(name) === -1) {
          d.members.push({ name: name, phone: '', email: '', emergency_name: '', emergency_phone: '' });
        }
      });
    }
  }
  _tppSave(panelId, d, function() {
    // After linking, sync this people card's members INTO the settle panel
    // so the settle panel's people array is always the merged source of truth.
    _tppSyncPeopleToSettle(panelId);
  });
};

window.tppUnlinkPeopleSettle = function(panelId) {
  var p = _tppGetPanel(panelId);
  if (!p) return;
  var d = _tppParse(p.content);
  d.linked_settle_id = null;
  _tppSave(panelId, d);
};

// ── People ↔ Settle sync helpers ────────────────────────────────────────────────

// Rebuild settle panel's people array from all people panel members.
// Safe to call after any add/edit in the people card.
function _tppSyncPeopleToSettle(peoplePanelId) {
  var pp = _tppGetPanel(peoplePanelId);
  if (!pp) return;
  var pd = _tppParse(pp.content);
  var sid = pd.linked_settle_id != null ? parseInt(pd.linked_settle_id, 10) : null;
  if (!sid) return;
  var sp = _tppGetPanel(sid);
  if (!sp) return;
  var sd = _tppParse(sp.content);
  var next = (pd.members || []).map(function(m) { return m.name || ''; });
  if (JSON.stringify(sd.people || []) === JSON.stringify(next)) return; // no-op guard
  sd.people = next;
  _tppSave(sid, sd);
}

// Remove a named person from the linked settle panel + remap expense indices.
// Mirrors the remap logic from tppRemoveSettlePerson.
function _tppRemovePersonFromSettleByName(peoplePanelId, name) {
  var pp = _tppGetPanel(peoplePanelId);
  if (!pp) return;
  var pd = _tppParse(pp.content);
  var sid = pd.linked_settle_id != null ? parseInt(pd.linked_settle_id, 10) : null;
  if (!sid) return;
  var sp = _tppGetPanel(sid);
  if (!sp) return;
  var sd = _tppParse(sp.content);
  var idx = (sd.people || []).indexOf(name);
  if (idx === -1) return;
  sd.people.splice(idx, 1);
  var total = sd.people.length;
  sd.expenses = (sd.expenses || []).filter(function(exp) {
    exp.split = (exp.split || []).filter(function(i) { return i !== idx; })
                                 .map(function(i) { return i > idx ? i - 1 : i; });
    if (exp.paid_by === idx) return false;
    if (exp.paid_by > idx) exp.paid_by -= 1;
    return exp.split.length > 0 && exp.paid_by >= 0 && exp.paid_by < total;
  });
  _tppSave(sid, sd);
}

// ── Discovery helper (called by settle & budget renderers) ─────────────────────
// Returns the first People panel that links to the given settle panel id, or null.
window._tppFindLinkedPeoplePanel = function(settlePanelId) {
  var found = null;
  (window._tripPanels || []).forEach(function(x) {
    if (found || x.panel_type !== 'people') return;
    try {
      var d = JSON.parse(x.content || '{}');
      if (d.linked_settle_id === settlePanelId) found = x;
    } catch (e) {}
  });
  return found;
};
