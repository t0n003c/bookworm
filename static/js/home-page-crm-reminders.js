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

/** Return a short display label for any recurrence value (including custom:N:unit). */
function _crmRecLabel(rec) {
  if (!rec || rec === 'none') return '';
  if (_REC_LABELS[rec]) return _REC_LABELS[rec];
  if (rec.startsWith('custom:')) {
    var parts = rec.split(':');
    if (parts.length === 3) {
      var n = parts[1], unit = parts[2];
      return 'Every ' + n + ' ' + unit + ' 🔁';
    }
  }
  return rec;
}

/** Serialize a reminder row as HTML-safe JSON for a data attribute. */
function _remJson(r) {
  var obj = {
    id: r.id,
    label: r.label || '',
    message: r.message || '',
    reminder_date: r.reminder_date || '',
    reminder_time: r.reminder_time || '',
    recurrence: r.recurrence || 'none'
  };
  return JSON.stringify(obj).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

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
      // Fire if the reminder time has arrived or passed today (not just exact minute).
      // _crmRemFired dedup prevents repeat toasts within the same tab session.
      if (item.reminder_time > hhmm) return;
      var key = item.id + '-' + today;
      if (_crmRemFired[key]) return;
      _crmRemFired[key] = true;
      var toastText = (item.contact_name ? item.contact_name + ' — ' : '') + item.label;
      if (item.message) toastText += '\n' + item.message;
      var rec = item.recurrence || 'none';
      if (rec !== 'none') toastText += ' (' + _crmRecLabel(rec) + ')';
      if (typeof _showReminderToast === 'function') _showReminderToast('🔔 ' + toastText);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
        new Notification('🔔 CRM Reminder', { body: toastText, icon: '/static/favicon.ico' });
      // Advance recurring reminders; delete one-shot reminders after they fire.
      if (rec !== 'none' && item.page_id && item.contact_id) {
        fetch('/home/crm/' + item.page_id + '/contacts/' + item.contact_id + '/reminders/' + item.id + '/advance',
          { method: 'POST', credentials: 'same-origin' }).catch(function() {});
      } else if (rec === 'none' && item.page_id && item.contact_id) {
        fetch('/home/crm/' + item.page_id + '/contacts/' + item.contact_id + '/reminders/' + item.id + '/delete',
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
    var editArgs = r.id + "," + fieldId + "," + contactId + ",'" + _crmEsc(fieldLabel) + "','" + _crmEsc(contactName) + "','" + _crmEsc(dateVal) + "'";
    var rec = r.recurrence || 'none';
    var recBadge = rec !== 'none'
      ? `<span class="px-1 py-0.5 rounded text-[9px] font-semibold bg-blue-50 dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-300 shrink-0">${_crmEsc(_crmRecLabel(rec))}</span>`
      : '';
    return `<div class="py-1.5 border-b border-gray-100 dark:border-zinc-700/60 last:border-0"
      data-rem-row-id="${r.id}" data-rem-json="${_remJson(r)}">
      <div class="flex items-start gap-2 text-xs text-gray-700 dark:text-zinc-300">
        <span class="text-sm leading-none mt-0.5 shrink-0">🔔</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium truncate flex-1">${_crmEsc(r.label)}</span>
            ${recBadge}
            <span class="text-gray-400 shrink-0 tabular-nums">${_crmEsc(r.reminder_date)} ${_crmEsc(r.reminder_time)}</span>
            <button type="button" title="Edit reminder"
              onclick="crmEditReminder(${editArgs})"
              class="text-gray-300 hover:text-[#0053e2] transition leading-none shrink-0">✎</button>
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

  // Inject compact toggle button into the inline slot on the date row
  var btnEl = document.getElementById('crm-rem-btn-' + fieldId);
  if (btnEl) {
    btnEl.innerHTML =
      '<button type="button" onclick="_crmToggleRemForm(this,' + contactId + ',' + fieldId + ')"' +
      ' class="flex items-center gap-1 text-xs font-medium' +
      ' text-gray-400 dark:text-zinc-500' +
      ' hover:text-[#0053e2] dark:hover:text-blue-400 transition flex-shrink-0">' +
      '\uD83D\uDD14 ' + (reminders.length ? '(' + reminders.length + ')' : '+ Set') +
      '</button>';
  }

  // Detail block: existing rows + add form, rendered below the date row
  el.innerHTML = `
    <div>
      ${existingRows ? `<div class="mt-1.5 border border-gray-200 dark:border-zinc-700 rounded-lg px-3">${existingRows}</div>` : ''}

      <div id="crm-rem-form-${fieldId}"
           class="hidden mt-1.5 border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-3
                  bg-gray-50 dark:bg-zinc-800/60">
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
              onchange="var cw=this.parentElement.querySelector('[data-rem-custom-row]');if(cw)cw.style.display=this.value==='custom'?'flex':'none';"
              class="w-full border border-gray-300 dark:border-zinc-600 rounded-md px-2 py-1.5 text-xs
                     bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                     focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
              <option value="none">No repeat (once)</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom…</option>
            </select>
            <div data-rem-custom-row style="display:none"
              class="mt-2 flex items-center gap-2">
              <span class="text-xs text-gray-500 dark:text-zinc-400 shrink-0">Every</span>
              <input type="number" data-rem-custom-n
                min="1" max="999" value="1"
                class="w-16 border border-gray-300 dark:border-zinc-600 rounded-md px-2 py-1.5 text-xs
                       bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                       focus:outline-none focus:ring-1 focus:ring-[#0053e2]"/>
              <select data-rem-custom-unit
                class="flex-1 border border-gray-300 dark:border-zinc-600 rounded-md px-2 py-1.5 text-xs
                       bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                       focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
                <option value="days">day(s)</option>
                <option value="weeks">week(s)</option>
                <option value="months">month(s)</option>
                <option value="years">year(s)</option>
              </select>
            </div>
          </div>

          <div class="flex gap-2 justify-end pt-1">
            <button type="button" onclick="_crmToggleRemForm(${cancelArgs})"
              class="px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-zinc-600
                     text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700 transition">
              Cancel</button>
            <button type="button" onclick="crmAddReminder(${addArgs})"
              data-rem-save-btn
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
  // Clear edit state whenever the form closes
  if (!isOpening) {
    delete form.dataset.editingId;
    delete form.dataset.editingContactId;
    var saveBtn = form.querySelector('[data-rem-save-btn]');
    if (saveBtn) saveBtn.textContent = 'Save Reminder';
  }
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
  if (rec === 'custom') {
    var n    = parseInt(section.querySelector('[data-rem-custom-n]')?.value || '1', 10);
    var unit = section.querySelector('[data-rem-custom-unit]')?.value || 'days';
    n = Math.max(1, Math.min(999, n || 1));
    rec = 'custom:' + n + ':' + unit;
  }
  if (!date) { section.querySelector('[data-rem-date]')?.focus(); return; }
  if (!label) label = contactName + ' \u2014 ' + fieldLabel;
  var editingId = section.dataset.editingId || '';
  var editingContactId = section.dataset.editingContactId || contactId;
  try {
    btn.disabled = true;
    var fd = new FormData();
    fd.append('field_id',      fieldId);
    fd.append('label',         label);
    fd.append('message',       message);
    fd.append('reminder_date', date);
    fd.append('reminder_time', time);
    fd.append('recurrence',    rec);
    var url = editingId
      ? '/home/crm/' + _crmPid + '/contacts/' + editingContactId + '/reminders/' + editingId + '/update'
      : '/home/crm/' + _crmPid + '/contacts/' + contactId + '/reminders/add';
    await fetch(url, { method: 'POST', body: fd });
    // Clear edit state + reset button before reloading
    delete section.dataset.editingId;
    delete section.dataset.editingContactId;
    var saveBtn = section.querySelector('[data-rem-save-btn]');
    if (saveBtn) saveBtn.textContent = 'Save Reminder';
    await crmLoadReminders(contactId, contactName, fieldId, fieldLabel, dateVal);
  } catch(e) {
    alert('Could not save reminder: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Populate the reminder form with an existing reminder's data and switch to edit mode.
 * remId, fieldId, contactId — integers. fieldLabel/contactName/dateVal — strings.
 */
function crmEditReminder(remId, fieldId, contactId, fieldLabel, contactName, dateVal) {
  var section = document.getElementById('crm-rem-form-' + fieldId);
  if (!section) return;

  // Read stored JSON from the row element
  var rowEl = section.closest('.mt-2')?.querySelector('[data-rem-row-id="' + remId + '"]');
  if (!rowEl) return;
  var raw = {};
  try { raw = JSON.parse(rowEl.dataset.remJson); } catch(e) { return; }

  // Populate fields
  var lbl = section.querySelector('[data-rem-label]');
  var msg = section.querySelector('[data-rem-message]');
  var dt  = section.querySelector('[data-rem-date]');
  var tm  = section.querySelector('[data-rem-time]');
  var rec = section.querySelector('[data-rem-recurrence]');
  if (lbl) lbl.value = raw.label || '';
  if (msg) msg.value = raw.message || '';
  if (dt)  dt.value  = raw.reminder_date || '';
  if (tm)  tm.value  = raw.reminder_time || '09:00';

  // Restore recurrence (including custom:N:unit)
  if (rec) {
    var recVal = raw.recurrence || 'none';
    var isCustom = recVal.startsWith('custom:');
    rec.value = isCustom ? 'custom' : recVal;
    var customRow = section.querySelector('[data-rem-custom-row]');
    if (customRow) {
      customRow.style.display = isCustom ? 'flex' : 'none';
      if (isCustom) {
        var parts = recVal.split(':');
        var nIn = section.querySelector('[data-rem-custom-n]');
        var uIn = section.querySelector('[data-rem-custom-unit]');
        if (nIn) nIn.value = parts[1] || '1';
        if (uIn) uIn.value = parts[2] || 'days';
      }
    }
  }

  // Mark edit mode on the form
  section.dataset.editingId = remId;
  section.dataset.editingContactId = contactId;
  var saveBtn = section.querySelector('[data-rem-save-btn]');
  if (saveBtn) saveBtn.textContent = 'Update Reminder';

  // Show form and scroll into view
  if (section.classList.contains('hidden')) section.classList.remove('hidden');
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      var modalBody = document.getElementById('crm-modal-body');
      if (modalBody) modalBody.scrollTop = modalBody.scrollHeight;
    });
  });
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

// ── Bell-panel CRM section (mobile) ──────────────────────────────────────────────────
// Compact renderer — fetches the same data as the slide panel but renders a
// minimal list suitable for the narrow top-bar bell dropdown on mobile.
window._crmLoadBellSection = async function() {
  var body = document.getElementById('rem-bell-crm-body');
  if (!body || !_crmPid) return;
  body.innerHTML = '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center py-3">Loading…</p>';
  try {
    var results = await Promise.all([
      _crmFetch('/home/crm/' + _crmPid + '/reminders/upcoming'),
      _crmFetch('/home/crm/' + _crmPid + '/birthdays/upcoming'),
    ]);
    var items     = Array.isArray(results[0]) ? results[0] : [];
    var birthdays = Array.isArray(results[1]) ? results[1] : [];

    if (items.length === 0 && birthdays.length === 0) {
      body.innerHTML = '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center py-3">No upcoming reminders 🎉</p>';
      return;
    }

    var rowCls = 'flex items-start gap-2 py-2 border-b border-gray-100'
               + ' dark:border-zinc-800 last:border-0';

    var html = '';

    // Birthday rows
    birthdays.forEach(function(b) {
      var days = b.days_away === 0 ? 'Today! 🎉'
               : b.days_away === 1 ? 'Tomorrow'
               : b.days_away + ' days';
      html += '<div class="' + rowCls + '">'
            + '<span class="text-sm leading-none mt-0.5 shrink-0">🎂</span>'
            + '<div class="flex-1 min-w-0">'
            + '<p class="text-xs font-medium text-gray-800 dark:text-zinc-100 truncate">'
            + _crmEsc(b.contact_name) + '</p>'
            + '<p class="text-[10px] text-gray-400 dark:text-zinc-500">' + _crmEsc(days) + '</p>'
            + '</div></div>';
    });

    // Reminder rows
    items.forEach(function(r) {
      html += '<div class="' + rowCls + '">'
            + '<span class="text-sm leading-none mt-0.5 shrink-0">🔔</span>'
            + '<div class="flex-1 min-w-0">'
            + '<p class="text-xs font-medium text-gray-800 dark:text-zinc-100 truncate">'
            + _crmEsc(r.contact_name || '\u2014') + '</p>'
            + '<p class="text-[10px] text-gray-400 dark:text-zinc-500 truncate">'
            + _crmEsc(r.label) + ' · ' + _crmEsc(r.reminder_date)
            + (r.reminder_time ? ' ' + _crmEsc(r.reminder_time) : '') + '</p>'
            + '</div></div>';
    });

    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = '<p class="text-xs text-red-400 text-center py-3">Could not load</p>';
  }
};

// ── Upcoming Reminders Panel ────────────────────────────────────────────
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
    var results = await Promise.all([
      _crmFetch('/home/crm/' + _crmPid + '/reminders/upcoming'),
      _crmFetch('/home/crm/' + _crmPid + '/birthdays/upcoming'),
    ]);
    var items     = Array.isArray(results[0]) ? results[0] : [];
    var birthdays = Array.isArray(results[1]) ? results[1] : [];

    if (items.length === 0 && birthdays.length === 0) {
      body.innerHTML = '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center mt-8">No upcoming reminders 🎉</p>';
      return;
    }

    var html = '';

    // ── Birthday section ──────────────────────────────────────────────
    if (birthdays.length > 0) {
      html += '<div class="mb-3"><div class="text-[10px] font-bold uppercase tracking-wider'
            + ' text-gray-400 dark:text-zinc-500 px-1 py-1 sticky top-0'
            + ' bg-white dark:bg-zinc-900">🎂 Upcoming Birthdays</div>';
      birthdays.forEach(function(b) {
        var daysLabel = b.days_away === 0 ? 'Today! 🎉'
                      : b.days_away === 1 ? 'Tomorrow'
                      : b.days_away + ' days away';
        html += '<div class="rounded-lg border border-[#ffc220]/40 dark:border-[#ffc220]/20'
              + ' bg-[#ffc220]/5 dark:bg-[#ffc220]/10 px-3 py-2 mb-1.5">'
              + '<div class="flex items-start gap-2">'
              + '<span class="text-sm leading-none mt-0.5 shrink-0">🎂</span>'
              + '<div class="flex-1 min-w-0">'
              + '<p class="text-xs font-semibold text-gray-800 dark:text-zinc-100 truncate">'
              + _crmEsc(b.contact_name) + '</p>'
              + '<p class="text-[11px] text-[#995213] dark:text-[#ffc220] truncate">'
              + _crmEsc(b.field_label) + ' &middot; ' + _crmEsc(daysLabel) + '</p>'
              + '</div></div></div>';
      });
      html += '</div>';
    }

    // ── Reminders section (existing grouping logic, preserved verbatim) ───
    if (items.length > 0) {
      var today    = new Date().toISOString().slice(0, 10);
      var tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      var groups   = {};
      items.forEach(function(r) {
        var d = r.reminder_date;
        var label = d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : _crmFmtDate(d);
        if (!groups[label]) groups[label] = [];
        groups[label].push(r);
      });
      Object.keys(groups).forEach(function(grp) {
        html += '<div class="mb-3"><div class="text-[10px] font-bold uppercase tracking-wider'
              + ' text-gray-400 dark:text-zinc-500 px-1 py-1 sticky top-0'
              + ' bg-white dark:bg-zinc-900">' + _crmEsc(grp) + '</div>';
        groups[grp].forEach(function(r) {
          var rec = r.recurrence || 'none';
          var recBadge = rec !== 'none'
            ? '<span class="px-1 py-0.5 rounded text-[9px] font-semibold bg-blue-50 dark:bg-blue-900/30'
              + ' text-[#0053e2] dark:text-blue-300">' + _crmEsc(_crmRecLabel(rec)) + '</span>'
            : '';
          html += '<div class="rounded-lg border border-gray-100 dark:border-zinc-700/60'
                + ' bg-gray-50 dark:bg-zinc-800/50 px-3 py-2 mb-1.5">'
                + '<div class="flex items-start gap-2">'
                + '<span class="text-sm leading-none mt-0.5 shrink-0">🔔</span>'
                + '<div class="flex-1 min-w-0">'
                + '<div class="flex items-center gap-1.5 flex-wrap">'
                + '<p class="text-xs font-semibold text-gray-800 dark:text-zinc-100 truncate flex-1">'
                + _crmEsc(r.label) + '</p>' + recBadge + '</div>'
                + '<p class="text-[11px] text-gray-500 dark:text-zinc-400 truncate">'
                + _crmEsc(r.contact_name) + ' &middot; ' + _crmEsc(r.reminder_time) + '</p>'
                + (r.message ? '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 break-words">'
                  + _crmEsc(r.message) + '</p>' : '')
                + '</div>'
                + '<button type="button" onclick="_crmPanelDelete(\'' + r.id + '\')"'
                + ' title="Delete reminder" class="text-gray-300 hover:text-red-500 transition'
                + ' text-xs leading-none shrink-0 pt-0.5">✕</button>'
                + '</div></div>';
        });
        html += '</div>';
      });
    }

    body.innerHTML = html;
  } catch(e) {
    console.error('[CRM reminders panel]', e);
    body.innerHTML = '<p class="text-xs text-red-400 text-center mt-8">Could not load reminders — '
      + _crmEsc(e.message || String(e)) + '</p>';
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

// ── Global auto-start ─────────────────────────────────────────────────────────
// Start the reminder poll as soon as this script loads — not just when the CRM
// page is visited.  _crmFetch and _showReminderToast are both loaded globally
// via base.html so the poll works correctly on every Homespace page.
// initCrmPage() calls initCrmRemindersPolling() too; that's fine — it just
// resets the interval (idempotent via the HTMX guard inside the function).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCrmRemindersPolling);
} else {
  initCrmRemindersPolling();
}
