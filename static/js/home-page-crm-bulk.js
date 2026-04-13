// home-page-crm-bulk.js
// Bulk contact selection + batch actions (delete, tag).
// Globals: _crmBulkMode, _crmSelected, _crmPid, _crmContacts, _crmView,
//          _crmFetch, _crmRender, _crmLoadAll, _crmEsc, _crmShowModal, crmCloseModal
'use strict';

// ── Toggle bulk mode ───────────────────────────────────────────────────────────
function crmToggleBulkMode() {
  _crmBulkMode = !_crmBulkMode;
  _crmSelected = new Set();
  _crmRender();
}

function crmExitBulkMode() {
  _crmBulkMode = false;
  _crmSelected = new Set();
  _crmRender();
}

// ── Selection helpers ─────────────────────────────────────────────────────────
/**
 * crmBulkToggle(id, forceChecked?)
 * Called from table row onclick (no 2nd arg) or checkbox onchange (bool).
 */
function crmBulkToggle(id, forceChecked) {
  if (typeof forceChecked === 'boolean') {
    forceChecked ? _crmSelected.add(id) : _crmSelected.delete(id);
  } else {
    _crmSelected.has(id) ? _crmSelected.delete(id) : _crmSelected.add(id);
  }
  // Lightweight DOM update — avoid full re-render for perf
  _crmBulkRefreshRow(id);
  _crmRenderBulkBar();
}

function _crmBulkRefreshRow(id) {
  // Table row
  var tr = document.querySelector(`tr[data-cid="${id}"]`);
  if (tr) {
    var chk = tr.querySelector('input[type=checkbox]');
    if (chk) chk.checked = _crmSelected.has(id);
    if (_crmSelected.has(id)) {
      tr.classList.add('bg-blue-50','dark:bg-blue-900/20');
      tr.classList.remove('hover:bg-blue-50/40','dark:hover:bg-zinc-800/60');
    } else {
      tr.classList.remove('bg-blue-50','dark:bg-blue-900/20');
      tr.classList.add('hover:bg-blue-50/40','dark:hover:bg-zinc-800/60');
    }
  }
  // Gallery card
  var card = document.querySelector(`.crm-gallery-card[data-cid="${id}"]`);
  if (card) {
    var gChk = card.querySelector('input[type=checkbox]');
    if (gChk) gChk.checked = _crmSelected.has(id);
    if (_crmSelected.has(id)) {
      card.classList.add('ring-2','ring-[#0053e2]');
      card.classList.remove('ring-transparent');
    } else {
      card.classList.remove('ring-2','ring-[#0053e2]');
      card.classList.add('ring-transparent');
    }
  }
}

function crmBulkSelectAll() {
  _crmContacts.forEach(function(c){ _crmSelected.add(c.id); });
  _crmRender(); // need full re-render to check all rows
}

function crmBulkDeselectAll() {
  _crmSelected = new Set();
  _crmRender();
}

// ── Bulk bar (sticky bottom) ──────────────────────────────────────────────────
function _crmRenderBulkBar() {
  var existing = document.getElementById('crm-bulk-bar');
  var main     = document.getElementById('crm-main');
  if (!main) return;

  if (!_crmBulkMode) {
    if (existing) existing.remove();
    return;
  }

  var n = _crmSelected.size;
  var html = `<div id="crm-bulk-bar"
    class="sticky bottom-0 left-0 right-0 z-30 mt-3
           flex items-center gap-3 px-4 py-2.5
           bg-white dark:bg-zinc-900
           border-t border-gray-200 dark:border-zinc-700 shadow-lg rounded-b-xl">
    <span class="text-sm font-semibold text-gray-700 dark:text-zinc-200 flex-shrink-0">
      ${n} selected
    </span>
    <div class="flex gap-2 flex-1 flex-wrap">
      <button onclick="crmBulkSelectAll()"
        class="px-3 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-600
               text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">
        All (${_crmContacts.length})
      </button>
      <button onclick="crmBulkDeselectAll()"
        class="px-3 py-1 text-xs rounded-lg border border-gray-300 dark:border-zinc-600
               text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">
        None
      </button>
      <button onclick="crmBulkTagPrompt()" ${n===0?'disabled':''} title="Add a tag to selected"
        class="px-3 py-1 text-xs font-semibold rounded-lg border border-gray-300 dark:border-zinc-600
               text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 transition
               disabled:opacity-40 disabled:cursor-not-allowed">
        🏷 Tag…
      </button>
      <button onclick="crmBulkDeletePrompt()" ${n===0?'disabled':''} title="Delete selected"
        class="px-3 py-1 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-800
               text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition
               disabled:opacity-40 disabled:cursor-not-allowed">
        🗑 Delete ${n>0?'('+n+')':''}
      </button>
    </div>
    <button onclick="crmExitBulkMode()"
      class="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 transition flex-shrink-0">
      ✕ Cancel
    </button>
  </div>`;

  if (existing) {
    // NOTE: outerHTML assignment detaches `existing` from the DOM.
    // Do NOT read or call methods on `existing` after this line.
    existing.outerHTML = html;
  } else {
    // Append after #crm-main's parent
    var container = main.parentElement || document.body;
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    container.appendChild(tmp.firstElementChild);
  }
}

// ── Bulk delete ───────────────────────────────────────────────────────────────
function crmBulkDeletePrompt() {
  var n = _crmSelected.size;
  if (!n) return;
  _crmShowModal(`
    <div class="h-1.5 w-full bg-gradient-to-r from-red-500 to-red-400"></div>
    <div class="p-6">
      <h2 class="text-base font-bold text-gray-900 dark:text-zinc-100 mb-2">
        🗑 Delete ${n} contact${n!==1?'s':''}?
      </h2>
      <p class="text-sm text-gray-500 dark:text-zinc-400 mb-5">
        This will permanently delete ${n} contact${n!==1?'s':''} and all their data.
        This cannot be undone.
      </p>
      <div class="flex gap-2 justify-end">
        <button onclick="crmCloseModal()"
          class="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                 text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">
          Cancel
        </button>
        <button id="crm-bulk-del-btn" onclick="crmBulkDeleteConfirmed()"
          class="px-4 py-1.5 text-sm font-semibold rounded-lg bg-red-500 text-white hover:bg-red-600 transition">
          Delete ${n}
        </button>
      </div>
    </div>`);
}

async function crmBulkDeleteConfirmed() {
  var btn = document.getElementById('crm-bulk-del-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  var ids = Array.from(_crmSelected);
  var failed = 0;
  for (var i = 0; i < ids.length; i++) {
    try {
      await _crmFetch(`/home/crm/${_crmPid}/contacts/${ids[i]}/delete`, {method:'POST'});
    } catch(e) { failed++; }
  }
  crmCloseModal();
  _crmBulkMode = false;
  _crmSelected = new Set();
  await _crmLoadAll();
  if (failed) alert(`${failed} contact(s) could not be deleted.`);
}

// ── Bulk tag ──────────────────────────────────────────────────────────────────
function crmBulkTagPrompt() {
  var n = _crmSelected.size;
  if (!n) return;
  _crmShowModal(`
    <div class="h-1.5 w-full bg-gradient-to-r from-[#0053e2] to-[#ffc220]"></div>
    <div class="p-6">
      <h2 class="text-base font-bold text-gray-900 dark:text-zinc-100 mb-1">
        🏷 Add tag to ${n} contact${n!==1?'s':''}
      </h2>
      <p class="text-sm text-gray-500 dark:text-zinc-400 mb-3">
        The tag will be appended to each contact's existing tags.
      </p>
      <input id="crm-bulk-tag-input" type="text" placeholder="e.g. vip, follow-up"
        class="w-full border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-1.5
               text-sm bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               focus:outline-none focus:ring-1 focus:ring-[#0053e2] mb-4"
        onkeydown="if(event.key==='Enter'){event.preventDefault();crmBulkTagConfirmed();}"/>
      <p id="crm-bulk-tag-err" class="hidden text-xs text-red-500 mb-2"></p>
      <div class="flex gap-2 justify-end">
        <button onclick="crmCloseModal()"
          class="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                 text-gray-600 dark:text-zinc-300 hover:border-gray-400 transition">Cancel</button>
        <button onclick="crmBulkTagConfirmed()"
          class="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#0053e2] text-white hover:bg-blue-700 transition">
          Apply Tag
        </button>
      </div>
    </div>`);
  setTimeout(function(){ var el = document.getElementById('crm-bulk-tag-input'); if(el) el.focus(); }, 50);
}

async function crmBulkTagConfirmed() {
  var input = document.getElementById('crm-bulk-tag-input');
  var errEl = document.getElementById('crm-bulk-tag-err');
  var tag = (input ? input.value.trim() : '').replace(/,$/, '');
  if (!tag) {
    if (errEl) { errEl.textContent = 'Enter a tag.'; errEl.classList.remove('hidden'); }
    return;
  }
  if (errEl) errEl.classList.add('hidden');
  if (input) { input.disabled = true; }

  var ids = Array.from(_crmSelected);
  var failed = 0;
  for (var i = 0; i < ids.length; i++) {
    var contact = _crmContacts.find(function(c){ return c.id === ids[i]; });
    if (!contact) continue;
    var existingTags = (contact.tags||'').split(',').map(function(t){ return t.trim(); }).filter(Boolean);
    if (existingTags.includes(tag)) continue; // already has tag — skip
    existingTags.push(tag);
    var body = new URLSearchParams({
      name:         contact.name || '',
      email:        contact.email || '',
      phone:        contact.phone || '',
      company:      contact.company || '',
      tags:         existingTags.join(', '),
      avatar_emoji: contact.avatar_emoji || '👤',
      profile_pic:  contact.profile_pic || '',
    });
    try {
      await _crmFetch(`/home/crm/${_crmPid}/contacts/${ids[i]}/update`, {method:'POST', body});
    } catch(e) { failed++; }
  }

  crmCloseModal();
  _crmBulkMode = false;
  _crmSelected = new Set();
  await _crmLoadAll();
  if (failed) alert(`${failed} contact(s) could not be updated.`);
}
