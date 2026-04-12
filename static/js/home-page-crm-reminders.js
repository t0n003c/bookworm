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

// \u2500\u2500 Module state \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
var _crmRemFired    = {};   // dedup: `${reminderId}-${todayDate}` \u2192 true
var _crmRemInterval = null; // setInterval handle \u2014 cleared on HTMX re-nav

// \u2500\u2500 Polling \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
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
      var msg = (item.contact_name ? item.contact_name + ' \u2014 ' : '') + item.label;
      if (typeof _showReminderToast === 'function') _showReminderToast('\ud83d\udd14 ' + msg);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
        new Notification('\ud83d\udd14 CRM Reminder', { body: msg, icon: '/static/favicon.ico' });
    });
  } catch(e) { /* silent \u2014 poll failures must not break the UI */ }
}

// \u2500\u2500 Modal reminder section \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
/**
 * Fetch reminders for a contact and render the sub-section under a date field.
 * Called from _crmContactModal() for each date-type custom field (edit mode only).
 */
async function crmLoadReminders(contactId, contactName, fieldId, fieldLabel, dateVal) {
  var el = document.getElementById('crm-rem-' + fieldId);
  if (!el) return;
  try {
    var all = await _crmFetch('/home/crm/' + _crmPid + '/contacts/' + contactId + '/reminders');
    var mine = all.filter(function(r) { return r.field_id === fieldId; });
    _crmRenderReminderSection(el, mine, contactId, contactName, fieldId, fieldLabel, dateVal);
  } catch(e) {
    el.innerHTML = '<span class="text-red-400 text-xs">Could not load reminders</span>';
  }
}

function _crmRenderReminderSection(el, reminders, contactId, contactName, fieldId, fieldLabel, dateVal) {
  var existingRows = reminders.map(function(r) {
    var displayDate = r.reminder_date || '';
    var displayTime = r.reminder_time || '';
    return `<div class="flex items-center gap-2 py-1 text-xs text-gray-600 dark:text-zinc-300">
      <span class="text-base leading-none">&#x1F514;</span>
      <span class="flex-1 truncate font-medium">${_crmEsc(r.label)}</span>
      <span class="text-gray-400 shrink-0">${_crmEsc(displayDate)} ${_crmEsc(displayTime)}</span>
      <button type="button"
        title="Delete reminder"
        onclick="crmDeleteReminder('${r.id}',${contactId},${fieldId},'${_crmEsc(fieldLabel)}','${_crmEsc(contactName)}','${_crmEsc(dateVal)}')"
        class="text-gray-300 hover:text-red-500 transition leading-none flex-shrink-0">\u2715</button>
    </div>`;
  }).join('');

  var defaultLabel = _crmEsc(contactName + ' \u2014 ' + fieldLabel);
  var defaultDate  = _crmEsc(dateVal || '');

  el.innerHTML = `
    <div class="mt-2 border border-gray-100 dark:border-zinc-700 rounded-lg overflow-hidden">
      <button type="button"
        onclick="_crmToggleRemForm(this, ${contactId},${fieldId})"
        class="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
               text-[#0053e2] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20
               transition text-left">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
        </svg>
        ${reminders.length ? 'Reminders (' + reminders.length + ')' : '+ Set Reminder'}
      </button>
      ${existingRows ? `<div class="px-3 pb-1 border-t border-gray-100 dark:border-zinc-700">${existingRows}</div>` : ''}
      <div id="crm-rem-form-${fieldId}" class="hidden border-t border-gray-100 dark:border-zinc-700 px-3 py-2 bg-gray-50 dark:bg-zinc-800/60">
        <div class="flex flex-col gap-2">
          <input type="text" data-rem-label
            value="${defaultLabel}"
            placeholder="Reminder label"
            class="w-full border border-gray-300 dark:border-zinc-600 rounded px-2 py-1 text-xs
                   bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                   focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
          <div class="flex gap-2">
            <input type="date" data-rem-date
              value="${defaultDate}"
              class="flex-1 border border-gray-300 dark:border-zinc-600 rounded px-2 py-1 text-xs
                     bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                     focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
            <input type="time" data-rem-time
              value="09:00"
              class="w-28 border border-gray-300 dark:border-zinc-600 rounded px-2 py-1 text-xs
                     bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                     focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
          </div>
          <div class="flex gap-2 justify-end">
            <button type="button" onclick="_crmToggleRemForm(null,${contactId},${fieldId})"
              class="px-3 py-1 text-xs rounded border border-gray-300 dark:border-zinc-600
                     text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700 transition">
              Cancel</button>
            <button type="button"
              onclick="crmAddReminder(this,${contactId},${fieldId},'${_crmEsc(fieldLabel)}','${_crmEsc(contactName)}','${_crmEsc(dateVal)}')"
              class="px-3 py-1 text-xs rounded bg-[#0053e2] text-white font-semibold
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
  form.classList.toggle('hidden');
}

// \u2500\u2500 Add / Delete \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function crmAddReminder(btn, contactId, fieldId, fieldLabel, contactName, dateVal) {
  var section = document.getElementById('crm-rem-form-' + fieldId);
  if (!section) return;
  var label = (section.querySelector('[data-rem-label]')?.value || '').trim();
  var date  = (section.querySelector('[data-rem-date]')?.value  || '').trim();
  var time  = (section.querySelector('[data-rem-time]')?.value  || '09:00').trim();
  if (!date) { section.querySelector('[data-rem-date]')?.focus(); return; }
  if (!label) label = contactName + ' \u2014 ' + fieldLabel;
  try {
    btn.disabled = true;
    var fd = new FormData();
    fd.append('field_id',      fieldId);
    fd.append('label',         label);
    fd.append('reminder_date', date);
    fd.append('reminder_time', time);
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
  } catch(e) {
    alert('Could not delete reminder: ' + e.message);
  }
}
