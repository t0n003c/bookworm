/**
 * home-page-crm-reminders.js
 * Reminder UI for CRM date fields (edit modal) + 30 s poll to fire toasts.
 *
 * API endpoints consumed:
 *   GET  /home/crm/{pid}/contacts/{cid}/reminders
 *   POST /home/crm/{pid}/contacts/{cid}/reminders/add
 *   POST /home/crm/{pid}/contacts/{cid}/reminders/{rid}/delete
 *   GET  /home/crm-reminders/due?date=YYYY-MM-DD
 *
 * Globals used from other CRM modules (loaded before this file):
 *   _crmPid, _crmFetch(), _crmEsc()  — home-page-crm.js
 */

// ── Module state ──────────────────────────────────────────────────────────────
var _crmRemFired    = {};   // dedup: `${reminderId}-${todayDate}` → true
var _crmRemInterval = null; // setInterval handle — cleared on HTMX re-nav

// Recurrence labels shown in UI
var _REC_LABELS = {
  none:      'Once',
  daily:     'Daily 🔁',
  weekly:    'Weekly 🔁',
  biweekly:  'Bi-weekly 🔁',
  monthly:   'Monthly 🔁',
  yearly:    'Yearly 🔁',
};

// ── Polling ───────────────────────────────────────────────────────────────────
/** Called from initCrmPage(). Clears any previous interval (HTMX guard). */
function initCrmRemindersPolling() {
  if (_crmRemInterval) clearInterval(_crmRemInterval);
  _checkCrmReminders();
  _crmRemInterval = setInterval(_checkCrmReminders, 30_000);
}

async function _checkCrmReminders() {
  try {
    var now   = new Date();
    var today = now.toISOString().slice(0, 10);
    var hhmm  = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    var items = await _crmFetch('/home/crm-reminders/due?date=' + today);
    if (!Array.isArray(items)) return;
    items.forEach(function(item) {
      if (item.reminder_time !== hhmm) return;
      var key = item.id + '-' + today;
      if (_crmRemFired[key]) return;
      _crmRemFired[key] = true;
      var toastText = (item.contact_name ? item.contact_name + ' — ' : '') + item.label;
      if (item.message) toastText += '\n' + item.message;
      var rec = item.recurrence || 'none';
      if (rec !== 'none') toastText += ' (' + (_REC_LABELS[rec] || rec) + ')';
      if (typeof _showReminderToast === 'function') _showReminderToast('🔔 ' + toastText);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
        new Notification('🔔 CRM Reminder', { body: toastText, icon: '/static/favicon.ico' });
      // Advance recurring reminders to their next occurrence
      if (rec !== 'none' && item.page_id && item.contact_id) {
        fetch('/home/crm/' + item.page_id + '/contacts/' + item.contact_id + '/reminders/' + item.id + '/advance',
          { method: 'POST', credentials: 'same-origin' }).catch(function() {});
      }
    });
  } catch(e) { /* silent — poll failures must not break the UI */ }
}

// ── Modal reminder section ────────────────────────────────────────────────────
/**
 * Fetch reminders for a contact and render the sub-section under a date field.
 * Called from _crmContactModal() for each date-type custom field (edit mode only).
 */
async function crmLoadReminders(contactId, contactName, fieldId, fieldLabel, dateVal) {
  var el = document.getElementById('crm-rem-' + fieldId);
  if (!el) return;
  try {
    var all  = await _crmFetch('/home/crm/' + _crmPid + '/contacts/' + contactId + '/reminders');
    var mine = all.filter(function(r) { return r.field_id === fieldId; });
    _crmRenderReminderSection(el, mine, contactId, contactName, fieldId, fieldLabel, dateVal);
  } catch(e) {
    el.innerHTML = '<span class="text-red-400 text-xs">Could not load reminders</span>';
  }
}

function _crmRenderReminderSection(el, reminders, contactId, contactName, fieldId, fieldLabel, dateVal) {
  var existingRows = reminders.map(function(r) {
    var delArgs = "'" + r.id + "'," + contactId + "," + fieldId + ",'" + _crmEsc(fieldLabel) + "','" + _crmEsc(contactName) + "','" + _crmEsc(dateVal) + "'";
    var rec = r.recurrence || 'none';
    var recBadge = rec !== 'none'
      ? `<span class="px-1 py-0.5 rounded text-[9px] font-semibold bg-blue-50 dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-300 shrink-0">${_crmEsc(_REC_LABELS[rec] || rec)}</span>`
      : '';
    return `<div class="py-1.5 border-b border-gray-100 dark:border-zinc-700/60 last:border-0">
      <div class="flex items-start gap-2 text-xs text-gray-700 dark:text-zinc-300">
        <span class="text-sm leading-none mt-0.5 shrink-0">🔔</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium truncate flex-1">${_crmEsc(r.label)}</span>
            ${recBadge}
            <span class="text-gray-400 shrink-0 tabular-nums">${_crmEsc(r.reminder_date)} ${_crmEsc(r.reminder_time)}</span>
            <button type="button" title="Delete reminder"
              onclick="crmDeleteReminder(${delArgs})"
              class="text-gray-300 hover:text-red-500 transition leading-none shrink-0">✕</button>
          </div>
          ${r.message ? `<p class="text-gray-400 dark:text-zinc-500 mt-0.5 break-words">${_crmEsc(r.message)}</p>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  var defaultLabel = _crmEsc(contactName + ' — ' + fieldLabel);
  var defaultDate  = _crmEsc(dateVal || '');
  var addArgs      = "this," + contactId + "," + fieldId + ",'" + _crmEsc(fieldLabel) + "','" + _crmEsc(contactName) + "','" + _crmEsc(dateVal) + "'";
  var cancelArgs   = "null," + contactId + "," + fieldId;

  el.innerHTML = `
    <div class="mt-2 border border-gray-200 dark:border-zinc-700 rounded-lg">
      <button type="button"
        onclick="_crmToggleRemForm(this,${contactId},${fieldId})"
        class="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
               text-[#0053e2] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20
               transition text-left">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 shrink-0" fill="none"
             viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159
                   c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
        </svg>
        ${reminders.length ? 'Reminders (' + reminders.length + ')' : '+ Set Reminder'}
      </button>

      ${existingRows ? `<div class="px-3 border-t border-gray-100 dark:border-zinc-700">${existingRows}</div>` : ''}

      <div id="crm-rem-form-${fieldId}"
           class="hidden border-t border-gray-200 dark:border-zinc-700 px-3 py-3
                  bg-gray-50 dark:bg-zinc-800/60 rounded-b-lg">
        <div class="flex flex-col gap-2">

          <div>
            <label class="block text-[10px] font-semibold uppercase tracking-wide
                          text-gray-400 dark:text-zinc-500 mb-0.5">Label</label>
            <input type="text" data-rem-label
              value="${defaultLabel}"
              placeholder="Short reminder title"
              class="w-full border border-gray-300 dark:border-zinc-600 rounded-md px-2 py-1.5 text-xs
                     bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                     focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
          </div>

          <div>
            <label class="block text-[10px] font-semibold uppercase tracking-wide
                          text-gray-400 dark:text-zinc-500 mb-0.5">Message <span class="normal-case font-normal">(optional)</span></label>
            <textarea data-rem-message rows="2"
              placeholder="Add more detail about this reminder…"
              class="w-full border border-gray-300 dark:border-zinc-600 rounded-md px-2 py-1.5 text-xs
                     bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                     focus:outline-none focus:ring-1 focus:ring-[#0053e2] resize-none"></textarea>
          </div>

          <div class="flex gap-2">
            <div class="flex-1">
              <label class="block text-[10px] font-semibold uppercase tracking-wide
                            text-gray-400 dark:text-zinc-500 mb-0.5">Date</label>
              <input type="date" data-rem-date
                value="${defaultDate}"
                class="w-full border border-gray-300 dark:border-zinc-600 rounded-md px-2 py-1.5 text-xs
                       bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                       focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
            </div>
            <div>
              <label class="block text-[10px] font-semibold uppercase tracking-wide
                            text-gray-400 dark:text-zinc-500 mb-0.5">Time</label>
              <input type="time" data-rem-time
                value="09:00"
                class="w-28 border border-gray-300 dark:border-zinc-600 rounded-md px-2 py-1.5 text-xs
                       bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                       focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
            </div>
          </div>

          <div>
            <label class="block text-[10px] font-semibold uppercase tracking-wide
                          text-gray-400 dark:text-zinc-500 mb-0.5">Repeat</label>
            <select data-rem-recurrence
              class="w-full border border-gray-300 dark:border-zinc-600 rounded-md px-2 py-1.5 text-xs
                     bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                     focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
              <option value="none">No repeat (once)</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>

          <div class="flex gap-2 justify-end pt-1">
            <button type="button" onclick="_crmToggleRemForm(${cancelArgs})"
              class="px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-zinc-600
                     text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700 transition">
              Cancel</button>
            <button type="button" onclick="crmAddReminder(${addArgs})"
              class="px-3 py-1.5 text-xs rounded-md bg-[#0053e2] text-white font-semibold
                     hover:bg-blue-700 transition">
              Save Reminder</button>
          </div>

        </div>
      </div>
    </div>`;
}

function _crmToggleRemForm(btn, contactId, fieldId) {
  var form = document.getElementById('crm-rem-form-' + fieldId);
  if (!form) return;
  var isOpening = form.classList.contains('hidden');
  form.classList.toggle('hidden');
  // Double-rAF: ensures the browser has done a full layout pass after un-hiding
  // before we read scrollHeight. Instant scrollTop (no 'smooth') is reliable;
  // smooth can be interrupted mid-animation leaving the form still clipped.
  if (isOpening) {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        var modalBody = document.getElementById('crm-modal-body');
        if (modalBody) modalBody.scrollTop = modalBody.scrollHeight;
      });
    });
  }
}

// ── Add / Delete ──────────────────────────────────────────────────────────────
async function crmAddReminder(btn, contactId, fieldId, fieldLabel, contactName, dateVal) {
  var section = document.getElementById('crm-rem-form-' + fieldId);
  if (!section) return;
  var label   = (section.querySelector('[data-rem-label]')?.value   || '').trim();
  var message = (section.querySelector('[data-rem-message]')?.value || '').trim();
  var date    = (section.querySelector('[data-rem-date]')?.value    || '').trim();
  var time    = (section.querySelector('[data-rem-time]')?.value    || '09:00').trim();
  var rec     = (section.querySelector('[data-rem-recurrence]')?.value || 'none').trim();
  if (!date) { section.querySelector('[data-rem-date]')?.focus(); return; }
  if (!label) label = contactName + ' — ' + fieldLabel;
  try {
    btn.disabled = true;
    var fd = new FormData();
    fd.append('field_id',      fieldId);
    fd.append('label',         label);
    fd.append('message',       message);
    fd.append('reminder_date', date);
    fd.append('reminder_time', time);
    fd.append('recurrence',    rec);
    await fetch('/home/crm/' + _crmPid + '/contacts/' + contactId + '/reminders/add',
      { method: 'POST', body: fd });
    await crmLoadReminders(contactId, contactName, fieldId, fieldLabel, dateVal);
  } catch(e) {
    alert('Could not save reminder: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function crmDeleteReminder(reminderIdStr, contactId, fieldId, fieldLabel, contactName, dateVal) {
  try {
    await fetch('/home/crm/' + _crmPid + '/contacts/' + contactId + '/reminders/' + reminderIdStr + '/delete',
      { method: 'POST' });
    await crmLoadReminders(contactId, contactName, fieldId, fieldLabel, dateVal);
    // Refresh the panel if it's open so the deleted reminder disappears
    var panel = document.getElementById('crm-rem-panel');
    if (panel && !panel.classList.contains('hidden')) _crmLoadUpcomingPanel();
  } catch(e) {
    alert('Could not delete reminder: ' + e.message);
  }
}

// ── Upcoming Reminders Panel ────────────────────────────────────────────────────
function crmToggleRemindersPanel() {
  var panel = document.getElementById('crm-rem-panel');
  var btn   = document.getElementById('crm-rem-panel-btn');
  if (!panel) return;
  var opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (btn) btn.classList.toggle('border-[#0053e2]', opening);
  if (btn) btn.classList.toggle('text-[#0053e2]', opening);
  if (opening) _crmLoadUpcomingPanel();
}

async function _crmLoadUpcomingPanel() {
  var body = document.getElementById('crm-rem-panel-body');
  if (!body) return;
  body.innerHTML = '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center mt-8">Loading…</p>';
  try {
    var items = await _crmFetch('/home/crm/' + _crmPid + '/reminders/upcoming');
    if (!Array.isArray(items) || items.length === 0) {
      body.innerHTML = '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center mt-8">No upcoming reminders 🎉</p>';
      return;
    }
    // Group by date
    var today    = new Date().toISOString().slice(0, 10);
    var tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    var groups   = {};
    items.forEach(function(r) {
      var d = r.reminder_date;
      var label = d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : _crmFmtDate(d);
      if (!groups[label]) groups[label] = [];
      groups[label].push(r);
    });
    var html = '';
    Object.keys(groups).forEach(function(grp) {
      html += `<div class="mb-3">
        <div class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500
                    px-1 py-1 sticky top-0 bg-white dark:bg-zinc-900">${_crmEsc(grp)}</div>`;
      groups[grp].forEach(function(r) {
        var rec = r.recurrence || 'none';
        var recBadge = rec !== 'none'
          ? `<span class="px-1 py-0.5 rounded text-[9px] font-semibold bg-blue-50 dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-300">${_crmEsc(_REC_LABELS[rec] || rec)}</span>`
          : '';
        html += `
          <div class="rounded-lg border border-gray-100 dark:border-zinc-700/60
                      bg-gray-50 dark:bg-zinc-800/50 px-3 py-2 mb-1.5">
            <div class="flex items-start gap-2">
              <span class="text-sm leading-none mt-0.5 shrink-0">🔔</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <p class="text-xs font-semibold text-gray-800 dark:text-zinc-100 truncate flex-1">
                    ${_crmEsc(r.label)}</p>
                  ${recBadge}
                </div>
                <p class="text-[11px] text-gray-500 dark:text-zinc-400 truncate">
                  ${_crmEsc(r.contact_name)} &middot; ${_crmEsc(r.reminder_time)}</p>
                ${r.message ? `<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 break-words">${_crmEsc(r.message)}</p>` : ''}
              </div>
              <button type="button"
                onclick="_crmPanelDelete('${r.id}')"
                title="Delete reminder"
                class="text-gray-300 hover:text-red-500 transition text-xs leading-none shrink-0 pt-0.5">
                ✕</button>
            </div>
          </div>`;
      });
      html += '</div>';
    });
    body.innerHTML = html;
  } catch(e) {
    console.error('[CRM reminders panel]', e);
    body.innerHTML = '<p class="text-xs text-red-400 text-center mt-8">Could not load reminders — ' + _crmEsc(e.message || String(e)) + '</p>';
  }
}

function _crmFmtDate(iso) {
  try {
    // Parse as local date to avoid UTC-shift weirdness
    var parts = iso.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch(e) { return iso; }
}

async function _crmPanelDelete(reminderIdStr) {
  try {
    // We only have the reminder id here — use a generic delete path via contact_id
    var items = await _crmFetch('/home/crm/' + _crmPid + '/reminders/upcoming');
    var rem   = (items || []).find(function(r) { return String(r.id) === String(reminderIdStr); });
    if (!rem) return;
    await fetch('/home/crm/' + _crmPid + '/contacts/' + rem.contact_id + '/reminders/' + reminderIdStr + '/delete',
      { method: 'POST' });
    _crmLoadUpcomingPanel();
  } catch(e) {
    alert('Could not delete: ' + e.message);
  }
}
