'use strict';
/* ─────────────────────────────────────────────────────────────────────────────
   home-widget-events.js — Events widget
   • Recurring events with flexible repeat patterns (including custom N-unit)
   • Lead-time alerts (N days/weeks before the target date)
   • Click any event card to edit it in-place
   • Feeds window._bwEventStore so calendar widgets paint date dots
   • Pushes lead alerts into the top-bar notification bell
   ───────────────────────────────────────────────────────────────────────────── */

// ── Global date-keyed store (read by _renderCalendar) ─────────────────────────
window._bwEventStore = {};

const _EVT_COLORS = ['#0053e2','#2a8703','#ea1100','#7c3aed','#f59e0b','#ec4899'];

// Preset repeat options shown as a labelled select
const _EVT_REPEAT_PRESETS = [
  ['none',    'No repeat'],
  ['day:1',   'Daily'],
  ['week:1',  'Weekly'],
  ['week:2',  'Every 2 weeks'],
  ['week:3',  'Every 3 weeks'],
  ['month:1', 'Monthly'],
  ['month:3', 'Quarterly (every 3 months)'],
  ['year:1',  'Yearly'],
  ['custom',  'Custom…'],
];

/** Human-readable label for any repeat setting on an item. */
function _evtRepeatLabel(item) {
  const unit = item.repeat_unit || 'none';
  if (unit === 'none') return '';
  const iv = item.repeat_interval || 1;
  const key = `${unit}:${iv}`;
  const preset = _EVT_REPEAT_PRESETS.find(([v]) => v === key);
  if (preset) return preset[1];
  // Custom
  const unitLabel = { day:'day', week:'week', month:'month', year:'year' }[unit] || unit;
  return `Every ${iv} ${unitLabel}${iv > 1 ? 's' : ''}`;
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function _evtParse(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function _evtToday() {
  const t = new Date(); t.setHours(0, 0, 0, 0); return t;
}

function _evtAdvance(d, unit, iv) {
  if (unit === 'day')   d.setDate(d.getDate() + iv);
  if (unit === 'week')  d.setDate(d.getDate() + 7 * iv);
  if (unit === 'month') d.setMonth(d.getMonth() + iv);
  if (unit === 'year')  d.setFullYear(d.getFullYear() + iv);
}

/** Returns the next occurrence of an item on or after today. */
function _evtNext(item) {
  const t     = _evtParse(item.target_date);
  const today = _evtToday();
  const unit  = item.repeat_unit || 'none';
  if (unit === 'none') return t;
  if (t >= today) return t;
  const iv = item.repeat_interval || 1;
  const n = new Date(t);
  while (n < today) _evtAdvance(n, unit, iv);
  return n;
}

/** ISO date strings this item occurs on within a given calendar month. */
function _evtOccurrencesInMonth(item, y, m) {
  const unit  = item.repeat_unit || 'none';
  const iv    = item.repeat_interval || 1;
  const t     = _evtParse(item.target_date);
  const start = new Date(y, m, 1);
  const end   = new Date(y, m + 1, 0);
  const hits  = [];

  if (unit === 'none') {
    if (t >= start && t <= end) hits.push(t.toISOString().slice(0, 10));
    return hits;
  }
  if (t > end) return hits;

  const n = new Date(t);
  while (n < start) _evtAdvance(n, unit, iv);
  while (n <= end) {
    hits.push(n.toISOString().slice(0, 10));
    _evtAdvance(n, unit, iv);
  }
  return hits;
}

// ── Event store + calendar refresh ────────────────────────────────────────────

function _evtBuildStore() {
  window._bwEventStore = {};
  document.querySelectorAll('[id^="evt-json-"]').forEach(el => {
    const wid   = el.id.replace('evt-json-', '');
    const items = _evtReadItems(wid);
    const now   = new Date();
    for (let mo = -1; mo <= 12; mo++) {
      const d = new Date(now.getFullYear(), now.getMonth() + mo, 1);
      const y = d.getFullYear(), m = d.getMonth();
      items.forEach(item => {
        _evtOccurrencesInMonth(item, y, m).forEach(iso => {
          (window._bwEventStore[iso] ??= []).push({
            text: item.text, color: item.color || '#0053e2', wid, id: item.id,
          });
        });
      });
    }
  });
  document.querySelectorAll('.calendar-widget').forEach(el => {
    if (typeof _renderCalendar === 'function') _renderCalendar(el);
  });
}

// ── Data I/O ──────────────────────────────────────────────────────────────────

function _evtReadItems(wid) {
  try {
    return JSON.parse(document.getElementById(`evt-json-${wid}`)?.textContent || '[]');
  } catch { return []; }
}

async function _evtSaveItems(wid, items) {
  // ── 1. Update the JSON script tag (used by _evtReadItems) ──────────────────
  const el = document.getElementById(`evt-json-${wid}`);
  if (el) el.textContent = JSON.stringify(items);

  // ── 2. Merge items into the FULL card config so col_span / row_span and
  //       any other settings are preserved.  Using just { items } would
  //       silently nuke everything else in the stored config. ────────────────
  let fullConfig = {};
  try {
    const card = document.getElementById(`hw-card-${wid}`);
    fullConfig = JSON.parse(card?.dataset.widgetConfig || '{}');
  } catch { /* start clean if the attribute is missing/corrupt */ }
  fullConfig.items = items;

  // ── 3. Keep data-widget-config in sync so _selectSize / saveWidgetSettings
  //       always see the current items and don't overwrite them on resize ────
  const card = document.getElementById(`hw-card-${wid}`);
  if (card) card.dataset.widgetConfig = JSON.stringify(fullConfig);

  // ── 4. Persist the full merged config to the server ───────────────────────
  const res = await fetch(`/home/widgets/${wid}/update-config`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ config_json: JSON.stringify(fullConfig) }),
  });
  if (!res.ok) console.error('[evt] save failed', wid, res.status);

  // Bust the home-page HTML cache so navigating away and back within the
  // 5-minute TTL doesn't serve stale content that's missing the new event.
  const _evtPageId = Number(sessionStorage.getItem('bw-hp'));
  if (_evtPageId && typeof invalidateHomePageCache === 'function') {
    invalidateHomePageCache(_evtPageId);
  }

  _evtBuildStore();
  _evtRenderList(wid, items);
}

// ── Render event cards ─────────────────────────────────────────────────────────

function _evtRenderList(wid, items) {
  const container = document.getElementById(`evt-list-${wid}`);
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="flex flex-col items-center py-6 text-center">
      <span class="text-3xl mb-1.5">📅</span>
      <span class="text-xs text-gray-400 dark:text-zinc-500">No events yet — add one below</span>
    </div>`;
    return;
  }
  const today   = _evtToday();
  const indexed = items
    .map((item, idx) => ({ item, idx, next: _evtNext(item) }))
    .sort((a, b) => a.next - b.next);

  container.innerHTML = indexed.map(({ item, idx, next }) => {
    const days    = Math.round((next - today) / 86400000);
    const color   = item.color || '#0053e2';
    const repLbl  = _evtRepeatLabel(item);
    const badge   = days === 0 ? '🎉 Today'
                  : days < 0  ? `${-days}d ago`
                  : days === 1 ? 'Tomorrow'
                  : `${days}d`;
    const bCls    = days === 0 ? 'bg-wgreen/20 text-wgreen dark:bg-green-900/30'
                  : days <= 3  ? 'bg-red-100 text-wred dark:bg-red-900/30'
                  : days <= 7  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30'
                  : 'bg-blue-50 text-wblue dark:bg-wblue/10';
    const dateStr = next.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    return `
    <div class="group/evt flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer
                border border-gray-100 dark:border-zinc-800
                bg-white dark:bg-zinc-900 hover:shadow-sm transition mb-1.5"
         style="border-left:3px solid ${color}"
         onclick="evtOpenEdit(${wid}, ${idx})"
         role="button" tabindex="0" aria-label="Edit event: ${_evtEsc(item.text)}"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();evtOpenEdit(${wid},${idx});}">
      <div class="flex-1 min-w-0">
        <p class="text-xs font-semibold text-gray-800 dark:text-zinc-100 truncate">${_evtEsc(item.text)}</p>
        <p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">
          ${dateStr}${repLbl ? ` &middot; <em>${_evtEsc(repLbl)}</em>` : ''}
        </p>
      </div>
      <span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${bCls}">${badge}</span>
      <button onclick="event.stopPropagation(); evtDelete(${wid}, ${idx})"
              class="opacity-0 group-hover/evt:opacity-100 p-0.5 text-gray-400 hover:text-wred transition flex-shrink-0"
              aria-label="Delete event">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join('');
}

// ── Add / Delete (public) ─────────────────────────────────────────────────────

/** Show a styled confirm modal before permanently deleting an event. */
window.evtDelete = function (wid, idx) {
  _evtConfirmDelete(wid, idx);
};

// ── Delete-confirmation modal ─────────────────────────────────────────────────

let _evtDelWid = null;
let _evtDelIdx = null;

function _evtConfirmDelete(wid, idx) {
  _evtDelWid = wid;
  _evtDelIdx = idx;
  const items = _evtReadItems(wid);
  const label = items[idx]?.text || 'this event';
  let modal = document.getElementById('evt-del-confirm-modal');
  if (!modal) { modal = _evtBuildDelModal(); document.body.appendChild(modal); }
  modal.querySelector('#evt-del-name').textContent = `"${label}"`;
  modal.classList.remove('hidden');
  setTimeout(() => modal.querySelector('#evt-del-cancel-btn')?.focus(), 50);
}

window.evtCancelDelete = function () {
  document.getElementById('evt-del-confirm-modal')?.classList.add('hidden');
  _evtDelWid = _evtDelIdx = null;
};

window.evtConfirmDelete = async function () {
  const wid = _evtDelWid;
  const idx = _evtDelIdx;
  evtCancelDelete();
  if (wid === null || idx === null) return;
  const items = _evtReadItems(wid);
  items.splice(idx, 1);
  await _evtSaveItems(wid, items);
};

function _evtBuildDelModal() {
  const el = document.createElement('div');
  el.id = 'evt-del-confirm-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'evt-del-modal-title');
  el.className = 'hidden fixed inset-0 z-50 flex items-center justify-center';
  el.setAttribute('onkeydown', "if(event.key==='Escape') evtCancelDelete()");
  el.innerHTML = `
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"
         onclick="evtCancelDelete()" aria-hidden="true"></div>
    <div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
      <div class="flex items-center gap-3 mb-4">
        <span class="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30
                     flex items-center justify-center text-wred" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none"
               viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round"
                  d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94
                     a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
        </span>
        <h2 id="evt-del-modal-title"
            class="text-base font-bold text-gray-900 dark:text-zinc-100">Delete event?</h2>
      </div>
      <p class="text-sm text-gray-600 dark:text-zinc-400 mb-1">
        <span class="font-semibold text-gray-800 dark:text-zinc-200" id="evt-del-name"></span>
      </p>
      <p class="text-sm text-gray-600 dark:text-zinc-400 mb-5">
        This event will be permanently deleted and cannot be recovered.
      </p>
      <div class="flex gap-3 justify-end">
        <button id="evt-del-cancel-btn" type="button" onclick="evtCancelDelete()"
          class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800
                 transition focus:outline-none focus:ring-2 focus:ring-gray-300">Cancel</button>
        <button type="button" onclick="evtConfirmDelete()"
          class="px-4 py-2 text-sm rounded-lg bg-wred text-white font-semibold
                 hover:bg-red-700 transition focus:outline-none focus:ring-2 focus:ring-wred">
          Delete Event
        </button>
      </div>
    </div>`;
  return el;
}

// ── Lead-days helpers ───────────────────────────────────────────────────────

const _EVT_LEAD_PRESETS = [1, 3, 7, 14, 21];
const _EVT_LEAD_LABELS  = { 1:'1 day', 3:'3 days', 7:'1 week', 14:'2 wks', 21:'3 wks' };

function _evtToggleCustomLead(checkbox) {
  const input = document.getElementById('evt-lead-custom-n');
  if (!input) return;
  input.disabled = !checkbox.checked;
  if (checkbox.checked) { input.focus(); }
  else                  { input.value = ''; }
}

// ── Modal state ─────────────────────────────────────────────────────────────

let _evtActiveWid  = null;
let _evtEditingIdx = null;   // null = "add new", number = "edit existing"

window.evtOpenModal = function (wid) {
  _evtActiveWid  = wid;
  _evtEditingIdx = null;
  const modal = _evtGetModal();
  _evtResetForm(modal);
  modal.querySelector('#evt-modal-title').textContent = 'Add Event';
  modal.querySelector('#evt-save-btn').textContent    = 'Save Event';
  modal.classList.remove('hidden');
  modal.querySelector('#evt-f-text').focus();
};

window.evtOpenEdit = function (wid, idx) {
  _evtActiveWid  = wid;
  _evtEditingIdx = idx;
  const modal = _evtGetModal();
  const items = _evtReadItems(wid);
  const item  = items[idx];
  if (!item) return;

  _evtResetForm(modal);
  modal.querySelector('#evt-f-text').value = item.text || '';
  modal.querySelector('#evt-f-date').value = item.target_date || '';

  // Repeat
  const unit = item.repeat_unit || 'none';
  const iv   = item.repeat_interval || 1;
  const key  = unit === 'none' ? 'none' : `${unit}:${iv}`;
  const sel  = modal.querySelector('#evt-f-repeat');
  const isPreset = [...sel.options].some(o => o.value === key);
  if (isPreset) {
    sel.value = key;
    _evtToggleCustomRepeat(modal, false);
  } else {
    sel.value = 'custom';
    modal.querySelector('#evt-f-custom-n').value    = iv;
    modal.querySelector('#evt-f-custom-unit').value = unit;
    _evtToggleCustomRepeat(modal, true);
  }

  // Lead days — restore presets + custom
  modal.querySelectorAll('input[name="evt-lead"]').forEach(c => {
    c.checked = (item.lead_days || []).includes(+c.value);
  });
  const nonPreset    = (item.lead_days || []).filter(d => !_EVT_LEAD_PRESETS.includes(d));
  const editCustChk  = modal.querySelector('#evt-lead-custom-check');
  const editCustN    = modal.querySelector('#evt-lead-custom-n');
  if (nonPreset.length > 0 && editCustChk && editCustN) {
    editCustChk.checked = true;
    editCustN.value     = nonPreset[0];
    editCustN.disabled  = false;
  }

  // Color
  _evtSetColor(item.color || '#0053e2', modal);

  // Notify time
  modal.querySelector('#evt-f-time').value = item.notify_time || '09:00';

  modal.querySelector('#evt-modal-title').textContent = 'Edit Event';
  modal.querySelector('#evt-save-btn').textContent    = 'Update Event';
  modal.classList.remove('hidden');
  modal.querySelector('#evt-f-text').focus();
};

window.evtCloseModal = function () {
  document.getElementById('evt-add-modal')?.classList.add('hidden');
  _evtActiveWid  = null;
  _evtEditingIdx = null;
};

window.evtSaveModal = async function () {
  const modal = document.getElementById('evt-add-modal');
  const text  = modal.querySelector('#evt-f-text').value.trim();
  const date  = modal.querySelector('#evt-f-date').value;
  if (!text) { modal.querySelector('#evt-f-text').focus(); return; }
  if (!date) { modal.querySelector('#evt-f-date').focus(); return; }

  // Repeat
  let repeatUnit = 'none', repeatInterval = 1;
  const repeatVal = modal.querySelector('#evt-f-repeat').value;
  if (repeatVal === 'custom') {
    repeatUnit     = modal.querySelector('#evt-f-custom-unit').value || 'day';
    repeatInterval = parseInt(modal.querySelector('#evt-f-custom-n').value, 10) || 1;
  } else if (repeatVal !== 'none') {
    const [u, ivStr] = repeatVal.split(':');
    repeatUnit     = u;
    repeatInterval = parseInt(ivStr, 10) || 1;
  }

  // Lead days — read presets + optional custom value
  const leads = [...modal.querySelectorAll('input[name="evt-lead"]:checked')].map(c => +c.value);
  const customCheck = modal.querySelector('#evt-lead-custom-check');
  const customN     = modal.querySelector('#evt-lead-custom-n');
  if (customCheck?.checked && customN?.value) {
    const n = parseInt(customN.value, 10);
    if (n > 0 && !leads.includes(n)) leads.push(n);
  }
  const color       = modal.querySelector('#evt-f-color').value || '#0053e2';
  const notify_time = modal.querySelector('#evt-f-time').value  || '09:00';
  const items = _evtReadItems(_evtActiveWid);

  if (_evtEditingIdx !== null) {
    // Preserve original id so localStorage alert keys stay valid
    const origId = items[_evtEditingIdx]?.id ?? Date.now();
    items[_evtEditingIdx] = {
      id: origId, text, target_date: date, color,
      repeat_unit: repeatUnit, repeat_interval: repeatInterval, lead_days: leads,
      notify_time,
    };
  } else {
    items.push({
      id: Date.now(), text, target_date: date, color,
      repeat_unit: repeatUnit, repeat_interval: repeatInterval, lead_days: leads,
      notify_time,
    });
  }

  await _evtSaveItems(_evtActiveWid, items);
  evtCloseModal();
};

// ── Modal helpers ─────────────────────────────────────────────────────────────

function _evtGetModal() {
  let modal = document.getElementById('evt-add-modal');
  if (!modal) { modal = _evtBuildModal(); document.body.appendChild(modal); }
  return modal;
}

function _evtResetForm(modal) {
  modal.querySelector('#evt-f-text').value  = '';
  modal.querySelector('#evt-f-date').value  = '';
  modal.querySelector('#evt-f-repeat').value = 'none';
  modal.querySelector('#evt-f-custom-n').value    = '1';
  modal.querySelector('#evt-f-custom-unit').value = 'day';
  _evtToggleCustomRepeat(modal, false);
  modal.querySelectorAll('input[name="evt-lead"]').forEach(c => { c.checked = false; });
  const rstCheck = modal.querySelector('#evt-lead-custom-check');
  const rstN     = modal.querySelector('#evt-lead-custom-n');
  if (rstCheck) rstCheck.checked = false;
  if (rstN)     { rstN.value = ''; rstN.disabled = true; }
  _evtSetColor('#0053e2', modal);
  modal.querySelector('#evt-f-time').value = '09:00';
}

function _evtToggleCustomRepeat(modal, show) {
  modal.querySelector('#evt-custom-repeat-row').classList.toggle('hidden', !show);
}

/** Apply a box-shadow ring to the selected swatch, clear others. */
function _evtSetColor(color, modal) {
  modal = modal || document.getElementById('evt-add-modal');
  if (!modal) return;
  modal.querySelector('#evt-f-color').value = color;
  modal.querySelectorAll('[data-evt-color]').forEach(btn => {
    const c = btn.dataset.evtColor;
    btn.style.boxShadow = (c === color)
      ? `0 0 0 2px #fff, 0 0 0 4px ${c}`
      : '';
    btn.setAttribute('aria-pressed', c === color ? 'true' : 'false');
  });
}

// ── Build modal DOM (once) ────────────────────────────────────────────────────

function _evtBuildModal() {
  const inputCls   = 'w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-1.5'
                   + ' bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
                   + ' focus:outline-none focus:ring-2 focus:ring-wblue';

  const el = document.createElement('div');
  el.id = 'evt-add-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'evt-modal-title');
  el.className = 'hidden fixed inset-0 z-50 flex items-center justify-center p-4';

  el.innerHTML = `
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"
         onclick="evtCloseModal()" aria-hidden="true"></div>
    <div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm p-6">
      <h2 id="evt-modal-title"
          class="text-sm font-bold text-gray-900 dark:text-zinc-100 mb-4">Add Event</h2>

      <div class="space-y-3">
        <!-- Name -->
        <div>
          <label for="evt-f-text"
                 class="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">Event name</label>
          <input id="evt-f-text" type="text" placeholder="e.g. Quarterly Review"
                 class="${inputCls}"
                 onkeydown="if(event.key==='Enter') evtSaveModal()">
        </div>

        <!-- Target date -->
        <div>
          <label for="evt-f-date"
                 class="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">Target date</label>
          <input id="evt-f-date" type="date" class="${inputCls}">
        </div>

        <!-- Repeat -->
        <div>
          <label for="evt-f-repeat"
                 class="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">Repeat</label>
          <select id="evt-f-repeat" class="${inputCls}"
                  onchange="_evtToggleCustomRepeat(this.closest('[role=dialog]'), this.value==='custom')">
            ${_EVT_REPEAT_PRESETS.map(([v, l]) =>
              `<option value="${v}">${l}</option>`).join('')}
          </select>
          <!-- Custom repeat row (hidden unless "Custom" selected) -->
          <div id="evt-custom-repeat-row" class="hidden flex gap-2 mt-1.5">
            <input id="evt-f-custom-n" type="number" min="1" max="365" value="1"
                   class="w-20 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
                          bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                          focus:outline-none focus:ring-2 focus:ring-wblue"
                   aria-label="Every N">
            <select id="evt-f-custom-unit"
                    class="flex-1 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
                           bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                           focus:outline-none focus:ring-2 focus:ring-wblue">
              <option value="day">day(s)</option>
              <option value="week">week(s)</option>
              <option value="month">month(s)</option>
              <option value="year">year(s)</option>
            </select>
          </div>
        </div>

        <!-- Lead alerts -->
        <div>
          <p class="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1.5">Remind me before</p>
          <div class="flex flex-wrap gap-x-4 gap-y-1.5">
            ${_EVT_LEAD_PRESETS.map(d => `
            <label class="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" name="evt-lead" value="${d}"
                     class="w-3.5 h-3.5 rounded text-wblue border-gray-300 dark:border-zinc-600
                            focus:ring-wblue accent-wblue">
              <span class="text-xs text-gray-600 dark:text-zinc-400">${_EVT_LEAD_LABELS[d]}</span>
            </label>`).join('')}
          </div>
          <!-- Custom lead days -->
          <div class="flex items-center gap-2 mt-2">
            <label class="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" id="evt-lead-custom-check"
                     class="w-3.5 h-3.5 rounded text-wblue border-gray-300 dark:border-zinc-600
                            focus:ring-wblue accent-wblue"
                     onchange="_evtToggleCustomLead(this)">
              <span class="text-xs text-gray-600 dark:text-zinc-400">Custom:</span>
            </label>
            <input id="evt-lead-custom-n" type="number" min="1" max="365"
                   placeholder="days" disabled
                   class="w-16 text-xs border border-gray-200 dark:border-zinc-700 rounded-lg
                          px-2 py-1 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                          focus:outline-none focus:ring-2 focus:ring-wblue
                          disabled:opacity-40 disabled:cursor-not-allowed">
            <span class="text-[11px] text-gray-400 dark:text-zinc-500">days before</span>
          </div>
        </div>

        <!-- Color picker -->
        <div>
          <p class="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1.5">Color</p>
          <div class="flex gap-2.5" role="group" aria-label="Event color">
            ${_EVT_COLORS.map(c => `
            <button type="button" data-evt-color="${c}" aria-pressed="false"
                    onclick="_evtSetColor('${c}', this.closest('[role=dialog]'))"
                    class="w-6 h-6 rounded-full transition-transform hover:scale-110 focus:outline-none
                           focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-400"
                    style="background:${c}" title="${c}"></button>`).join('')}
          </div>
          <input id="evt-f-color" type="hidden" value="#0053e2">
        </div>

        <!-- Push notification time -->
        <div>
          <label for="evt-f-time"
                 class="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">Push notification time</label>
          <input id="evt-f-time" type="time" value="09:00" class="${inputCls}">
          <p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">What time to send the push on alert days (default 9:00 AM)</p>
        </div>
      </div>

      <div class="flex gap-3 justify-end mt-5">
        <button onclick="evtCloseModal()"
                class="px-4 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                       text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">
          Cancel
        </button>
        <button id="evt-save-btn" onclick="evtSaveModal()"
                class="px-5 py-1.5 bg-wblue text-white text-sm font-semibold rounded-lg
                       hover:bg-blue-700 transition">
          Save Event
        </button>
      </div>
    </div>`;
  return el;
}

// ── Lead-alert notifications ───────────────────────────────────────────────────

function _evtCheckLeadAlerts() {
  const today    = _evtToday();
  const todayIso = today.toISOString().slice(0, 10);
  document.querySelectorAll('[id^="evt-json-"]').forEach(el => {
    const wid = el.id.replace('evt-json-', '');
    _evtReadItems(wid).forEach(item => {
      const next = _evtNext(item);
      (item.lead_days || []).forEach(ld => {
        const alertDate = new Date(next);
        alertDate.setDate(alertDate.getDate() - ld);
        if (alertDate.toISOString().slice(0, 10) !== todayIso) return;
        const key = `bw-evt-${wid}-${item.id}-${next.toISOString().slice(0, 10)}-${ld}`;
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, '1');
        const daysUntil = Math.round((next - today) / 86400000);
        const when    = daysUntil === 1 ? 'tomorrow' : daysUntil === 0 ? 'today' : `in ${daysUntil} days`;
        const dateStr = next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const msg = `${item.text} — ${when} (${dateStr})`;
        if (typeof _remLogMissed      === 'function') _remLogMissed(msg, dateStr);
        if (typeof _showReminderToast === 'function') _showReminderToast(msg);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
          new Notification('📅 Event Reminder', { body: msg, icon: '/static/favicon.ico' });
      });
    });
  });
}

// ── Util ──────────────────────────────────────────────────────────────────────

function _evtEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

window._evtInit = function () {
  document.querySelectorAll('[id^="evt-json-"]').forEach(el => {
    const wid = el.id.replace('evt-json-', '');
    _evtRenderList(wid, _evtReadItems(wid));
  });
  _evtBuildStore();
  _evtCheckLeadAlerts();
};

// ── Self-boot ─────────────────────────────────────────────────────────────────
// home-widgets.js loads before us (defer = document order) so its
// `typeof window._evtInit === 'function'` guard fires before we define it.
// Call ourselves here — by the time any defer script runs, the DOM is ready.
window._evtInit();
