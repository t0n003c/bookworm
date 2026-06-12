// home-page-crm-convo.js
// Conversation log feature for CRM contacts.
//
// Globals from home-page-crm.js:
//   _crmPid, _crmEsc
//
// Public API (called by home-page-crm.js and home-page-crm-gallery.js):
//   crmConvoInit(contactId)          — fetch + render conversations section in modal
//   crmConvoAdd(contactId)           — submit new entry from modal quick-input
//   crmConvoStartEdit(cvid)          — switch entry to inline edit mode
//   crmConvoCancelEdit(cvid)         — revert inline edit
//   crmConvoSaveEdit(cvid,contactId) — persist inline edit
//   crmConvoDelete(cvid,contactId)   — delete an entry
//   crmConvoShowAll(contactId)       — toggle "see all" overflow
//   crmGalConvoPop(contactId, btn)   — gallery card quick-log popover (open)
//   crmGalConvoClose()               — close gallery popover
//   crmGalConvoSubmit(contactId)     — submit from gallery popover
'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────
var _CONVO_PREVIEW = 3; // entries shown before "See all"

// ── Date formatter ─────────────────────────────────────────────────────────────
function _convoFmt(isoStr) {
  if (!isoStr) return '';
  // SQLite CURRENT_TIMESTAMP is UTC "YYYY-MM-DD HH:MM:SS"
  var d = new Date(isoStr.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return isoStr;
  var now   = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var dDay  = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var diffMs = today - dDay;
  var diffD  = Math.round(diffMs / 86400000);

  var time = d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
  if (diffD === 0) return 'Today · ' + time;
  if (diffD === 1) return 'Yesterday · ' + time;

  var opts = {month: 'short', day: 'numeric'};
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts) + ' · ' + time;
}

// ── Timeline HTML ──────────────────────────────────────────────────────────────
function _convoEntryHtml(cv, contactId, hidden) {
  var hidCls = hidden ? ' hidden convo-overflow' : '';
  return `
  <div id="convo-${cv.id}" class="flex gap-3 group${hidCls}">
    <div class="flex flex-col items-center pt-1 flex-shrink-0">
      <div class="w-2 h-2 rounded-full bg-[#0053e2] dark:bg-blue-400 mt-0.5 flex-shrink-0"></div>
      <div class="w-px flex-1 bg-gray-200 dark:bg-zinc-700 mt-1"></div>
    </div>
    <div class="flex-1 pb-4 min-w-0">
      <div class="flex items-center gap-2 mb-0.5">
        <span class="text-xs text-gray-400 dark:text-zinc-500 font-medium">${_crmEsc(_convoFmt(cv.logged_at))}</span>
        <span class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex-shrink-0">
          <button onclick="crmConvoStartEdit(${cv.id})" title="Edit"
            class="w-5 h-5 rounded flex items-center justify-center text-xs
                   text-gray-300 hover:text-[#0053e2] hover:bg-blue-50
                   dark:text-zinc-600 dark:hover:text-blue-400 dark:hover:bg-blue-900/20 transition">✎</button>
          <button onclick="crmConvoDelete(${cv.id},${contactId})" title="Delete"
            class="w-5 h-5 rounded flex items-center justify-center text-xs
                   text-gray-300 hover:text-red-500 hover:bg-red-50
                   dark:text-zinc-600 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition">✕</button>
        </span>
      </div>
      <div id="convo-text-${cv.id}"
           class="text-sm text-gray-700 dark:text-zinc-300 leading-relaxed break-words"
           >${_crmEsc(cv.note)}</div>
    </div>
  </div>`;
}

// ── Shared input + timeline HTML (used by both modal and detail view) ─────────
function _convoBodyHtml(contactId, convos) {
  var total    = convos.length;
  var visible  = convos.slice(0, _CONVO_PREVIEW);
  var overflow = convos.slice(_CONVO_PREVIEW);

  var entriesHtml = visible.map(cv => _convoEntryHtml(cv, contactId, false)).join('');
  entriesHtml    += overflow.map(cv => _convoEntryHtml(cv, contactId, true)).join('');

  var seeAllBtn = overflow.length
    ? `<button onclick="crmConvoShowAll(${contactId})" id="convo-see-all"
         class="text-xs text-[#0053e2] dark:text-blue-400 hover:underline mt-1 ml-5">
         See all ${total} conversations ▾</button>`
    : '';

  return `
    <div class="flex gap-2 mb-4">
      <input id="convo-input" type="text" maxlength="1000"
        placeholder="Log a conversation…"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();crmConvoAdd(${contactId});}"
        class="flex-1 min-w-0 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-600
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               placeholder-gray-300 dark:placeholder-zinc-500
               focus:outline-none focus:ring-2 focus:ring-[#0053e2]/30 focus:border-[#0053e2]
               transition"/>
      <button onclick="crmConvoAdd(${contactId})"
        class="px-3 py-1.5 text-sm font-semibold rounded-lg bg-[#0053e2] text-white
               hover:bg-blue-700 transition flex-shrink-0">Log</button>
    </div>
    <div id="convo-timeline" class="flex flex-col">
      ${entriesHtml || '<p class="text-sm text-gray-400 dark:text-zinc-500 ml-5 mb-2">No conversations yet.</p>'}
    </div>
    ${seeAllBtn}`;
}

// Modal wrapper: adds section heading + border-top (used inside the contact modal)
function _convoSectionHtml(contactId, convos) {
  var total = convos.length;
  return `
  <div class="mt-6 pt-5 border-t border-gray-100 dark:border-zinc-700/60">
    <h3 class="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-3 flex items-center gap-2">
      <span>💬</span> Conversations
      ${total ? `<span class="text-[10px] bg-gray-100 dark:bg-zinc-700 text-gray-500 dark:text-zinc-400 rounded-full px-1.5 py-0.5 font-normal normal-case tracking-normal">${total}</span>` : ''}
    </h3>
    ${_convoBodyHtml(contactId, convos)}
  </div>`;
}

// ── Init helpers ──────────────────────────────────────────────────────────
async function _convoFetch(contactId) {
  var res = await fetch(`/home/crm/${_crmPid}/contacts/${contactId}/conversations`);
  if (!res.ok) throw new Error('fetch failed');
  var data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Modal: called after _crmShowModal — renders into #crm-convo-section
async function crmConvoInit(contactId) {
  var section = document.getElementById('crm-convo-section');
  if (!section) return;
  section.innerHTML = '<p class="mt-6 text-xs text-gray-400 dark:text-zinc-500 animate-pulse">Loading conversations…</p>';
  try {
    var convos = await _convoFetch(contactId);
    section.innerHTML = _convoSectionHtml(contactId, convos);
    var inp = document.getElementById('convo-input');
    if (inp) inp.focus();
  } catch (_) {
    section.innerHTML = '<p class="mt-6 text-xs text-red-400">Could not load conversations.</p>';
  }
}

// Detail view: called after _crmSetMain — renders into #crm-detail-convo
async function crmConvoInitDetail(contactId) {
  var el = document.getElementById('crm-detail-convo');
  if (!el) return;
  try {
    var convos = await _convoFetch(contactId);
    el.innerHTML = _convoBodyHtml(contactId, convos);
  } catch (_) {
    el.innerHTML = '<p class="text-xs text-red-400">Could not load conversations.</p>';
  }
}

// ── Re-render helper (works for both modal and detail view) ─────────────────
function _convoRerender(contactId, convos) {
  // Modal
  var section = document.getElementById('crm-convo-section');
  if (section) { section.innerHTML = _convoSectionHtml(contactId, convos); return; }
  // Detail view
  var el = document.getElementById('crm-detail-convo');
  if (el) el.innerHTML = _convoBodyHtml(contactId, convos);
}

// ── Add ────────────────────────────────────────────────────────────────────────
async function crmConvoAdd(contactId) {
  var inp = document.getElementById('convo-input');
  if (!inp) return;
  var note = inp.value.trim();
  if (!note) { inp.focus(); return; }
  inp.disabled = true;
  try {
    var fd = new FormData();
    fd.append('note', note);
    var res = await fetch(`/home/crm/${_crmPid}/contacts/${contactId}/conversations`,
      {method: 'POST', body: fd});
    if (!res.ok) throw new Error(await res.text());
    var convos = await res.json();
    _convoRerender(contactId, convos);
    var newInp = document.getElementById('convo-input');
    if (newInp) newInp.focus();
  } catch (e) {
    inp.disabled = false;
    inp.focus();
    alert('Could not save: ' + e.message);
  }
}

// ── Edit ───────────────────────────────────────────────────────────────────────
function crmConvoStartEdit(cvid) {
  var textEl = document.getElementById('convo-text-' + cvid);
  if (!textEl) return;
  var original = textEl.textContent.trim();
  textEl.innerHTML =
    `<textarea id="convo-edit-${cvid}" rows="2"
       class="w-full text-sm px-2 py-1 rounded border border-[#0053e2]/50 dark:border-blue-500/50
              bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
              focus:outline-none focus:ring-2 focus:ring-[#0053e2]/30 resize-none"
       >${_crmEsc(original)}</textarea>
     <div class="flex gap-2 mt-1.5">
       <button onclick="crmConvoSaveEdit(${cvid},_convoActiveContactId)"
         class="text-xs px-2 py-1 rounded bg-[#0053e2] text-white hover:bg-blue-700 transition">Save</button>
       <button onclick="crmConvoCancelEdit(${cvid})"
         class="text-xs px-2 py-1 rounded border border-gray-300 dark:border-zinc-600
                text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">Cancel</button>
     </div>`;
  var ta = document.getElementById('convo-edit-' + cvid);
  if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
}

function crmConvoCancelEdit(cvid) {
  // Re-fetch from server to restore original text cleanly.
  // Works for both modal (#crm-convo-section) and detail view (#crm-detail-convo).
  if (typeof _convoActiveContactId !== 'undefined' && _convoActiveContactId) {
    if (document.getElementById('crm-convo-section'))  crmConvoInit(_convoActiveContactId);
    else if (document.getElementById('crm-detail-convo')) crmConvoInitDetail(_convoActiveContactId);
  }
}

async function crmConvoSaveEdit(cvid, contactId) {
  var ta = document.getElementById('convo-edit-' + cvid);
  if (!ta) return;
  var note = ta.value.trim();
  if (!note) return;
  ta.disabled = true;
  try {
    var fd = new FormData();
    fd.append('note', note);
    var res = await fetch(
      `/home/crm/${_crmPid}/contacts/${contactId}/conversations/${cvid}/update`,
      {method: 'POST', body: fd}
    );
    if (!res.ok) throw new Error(await res.text());
    var convos = await res.json();
    _convoRerender(contactId, convos);
  } catch (e) {
    ta.disabled = false;
    alert('Could not save: ' + e.message);
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────────
async function crmConvoDelete(cvid, contactId) {
  if (!confirm('Delete this conversation entry?')) return;
  try {
    var res = await fetch(
      `/home/crm/${_crmPid}/contacts/${contactId}/conversations/${cvid}/delete`,
      {method: 'POST'}
    );
    if (!res.ok) throw new Error(await res.text());
    var convos = await res.json();
    _convoRerender(contactId, convos);
  } catch (e) {
    alert('Could not delete: ' + e.message);
  }
}

// ── See all toggle ─────────────────────────────────────────────────────────────
function crmConvoShowAll(contactId) {
  var btn = document.getElementById('convo-see-all');
  document.querySelectorAll('.convo-overflow').forEach(function(el) {
    el.classList.remove('hidden');
  });
  if (btn) btn.remove();
}

// ── Gallery card quick-log popover ─────────────────────────────────────────────
var _galConvoPopContactId = null;

function crmGalConvoPop(contactId, btn) {
  crmGalConvoClose(); // close any existing
  _galConvoPopContactId = contactId;

  var pop = document.createElement('div');
  pop.id = 'crm-gal-convo-pop';
  pop.className =
    'fixed z-50 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-600 ' +
    'rounded-xl shadow-xl p-3 w-72';
  pop.innerHTML =
    `<p class="text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-2">💬 Log conversation</p>
     <textarea id="gal-convo-ta" rows="2" maxlength="1000"
       placeholder="One or two sentences…"
       class="w-full text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-600
              bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
              placeholder-gray-300 dark:placeholder-zinc-500
              focus:outline-none focus:ring-2 focus:ring-[#0053e2]/30 focus:border-[#0053e2]
              resize-none transition"></textarea>
     <div class="flex gap-2 mt-2 justify-end">
       <button onclick="crmGalConvoClose()"
         class="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-zinc-600
                text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">Cancel</button>
       <button onclick="crmGalConvoSubmit(${contactId})"
         class="text-xs px-2.5 py-1 rounded bg-[#0053e2] text-white hover:bg-blue-700 transition font-semibold">Log</button>
     </div>`;

  // Position near the button
  document.body.appendChild(pop);
  var r   = btn.getBoundingClientRect();
  var pw  = pop.offsetWidth  || 288;
  var ph  = pop.offsetHeight || 130;
  var top = r.bottom + 6;
  var left = Math.min(r.left, window.innerWidth - pw - 12);
  if (top + ph > window.innerHeight - 12) top = r.top - ph - 6;
  pop.style.top  = top  + 'px';
  pop.style.left = left + 'px';

  var ta = document.getElementById('gal-convo-ta');
  if (ta) {
    ta.focus();
    ta.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        crmGalConvoSubmit(contactId);
      }
      if (e.key === 'Escape') crmGalConvoClose();
    });
  }

  // Close on outside click (next tick so this click doesn't immediately close it)
  setTimeout(function() {
    document.addEventListener('click', _galConvoOutsideClick, {once: true, capture: true});
  }, 0);
}

function _galConvoOutsideClick(e) {
  var pop = document.getElementById('crm-gal-convo-pop');
  if (pop && !pop.contains(e.target)) {
    crmGalConvoClose();
  } else if (pop) {
    // click was inside — re-attach listener
    setTimeout(function() {
      document.addEventListener('click', _galConvoOutsideClick, {once: true, capture: true});
    }, 0);
  }
}

function crmGalConvoClose() {
  var pop = document.getElementById('crm-gal-convo-pop');
  if (pop) pop.remove();
  _galConvoPopContactId = null;
}

async function crmGalConvoSubmit(contactId) {
  var ta = document.getElementById('gal-convo-ta');
  if (!ta) return;
  var note = ta.value.trim();
  if (!note) { ta.focus(); return; }
  ta.disabled = true;
  try {
    var fd = new FormData();
    fd.append('note', note);
    var res = await fetch(`/home/crm/${_crmPid}/contacts/${contactId}/conversations`,
      {method: 'POST', body: fd});
    if (!res.ok) throw new Error(await res.text());
    // Show a brief success flash then close
    var pop = document.getElementById('crm-gal-convo-pop');
    if (pop) {
      pop.innerHTML =
        '<p class="text-sm text-[#2a8703] dark:text-green-400 font-medium py-1 text-center">✓ Logged!</p>';
      setTimeout(crmGalConvoClose, 900);
    }
  } catch (e) {
    if (ta) { ta.disabled = false; ta.focus(); }
    alert('Could not save: ' + e.message);
  }
}

// ── Shared state: current contact id open in modal ─────────────────────────────
// home-page-crm.js sets this before calling crmConvoInit so that
// crmConvoCancelEdit and crmConvoSaveEdit can reference it.
var _convoActiveContactId = null;
