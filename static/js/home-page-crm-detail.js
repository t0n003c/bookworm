// home-page-crm-detail.js
// Full contact detail page rendered inside #crm-main.
// Globals it uses: _crmPid, _crmContacts, _crmFields, _crmDeals, _crmView,
//   _crmDetailContactId, _crmPrevView, _crmSetMain, _crmRender, _crmEsc,
//   _crmFetch, _crmFieldDisplay, crmOpenEdit, crmDeleteContact
'use strict';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Shorten a URL for display: strips protocol + www, truncates to 50 chars.
 * Full URL is preserved in the href.
 * e.g. https://www.example.com/some/long/path → example.com/some/long/pa…
 */
function _crmShortenUrl(raw) {
  try {
    var u = new URL(raw);
    var display = (u.hostname + u.pathname + u.search).replace(/^www\./, '');
    display = display.replace(/\/$/, '');
    return display.length > 50 ? display.slice(0, 49) + '\u2026' : display;
  } catch (_) {
    return raw.length > 50 ? raw.slice(0, 49) + '\u2026' : raw;
  }
}

// ── State (declared in home-page-crm.js, referenced here) ─────────────────────
// var _crmDetailContactId = null;
// var _crmPrevView        = 'table';

// ── Entry & exit ──────────────────────────────────────────────────────────────
function crmOpenDetail(contactId) {
  _crmPrevView        = _crmView;
  _crmView            = 'detail';
  _crmDetailContactId = contactId;
  _crmRender();
}

function crmDetailBack() {
  _crmView = _crmPrevView || 'table';
  _crmDetailContactId = null;
  _crmRender();
}

// ── Renderer ──────────────────────────────────────────────────────────────────
function _crmRenderDetail() {
  var c = _crmContacts.find(function(x){ return x.id === _crmDetailContactId; });
  if (!c) {
    // Contact vanished (deleted elsewhere) — quietly go back
    crmDetailBack();
    return;
  }

  var fv = c.field_values || {};

  // Avatar / header
  var avatar = c.profile_pic
    ? `<img src="${_crmEsc(c.profile_pic)}" class="w-20 h-20 rounded-2xl object-cover ring-2 ring-gray-200 dark:ring-zinc-700" alt=""/>`
    : `<div class="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl leading-none
            bg-gradient-to-br from-[#e8f0ff] to-[#c7d8ff] dark:from-zinc-700 dark:to-zinc-600">${_crmEsc(c.avatar_emoji||'👤')}</div>`;

  // Tags
  var tagHtml = (c.tags||'').split(',').filter(Boolean).map(function(t){
    return `<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium
              bg-[#e8f0ff] dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-300">${_crmEsc(t.trim())}</span>`;
  }).join(' ');

  // Relationship pills
  var _relArr = [];
  try { _relArr = JSON.parse(c.relationship || '[]'); } catch {}
  if (!Array.isArray(_relArr)) _relArr = (c.relationship||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
  var relPills = _relArr.length
    ? '<div class="flex flex-wrap gap-1.5 mt-2">'
        + _relArr.map(function(v){
            return '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium '
              + 'bg-[#e8f0ff] dark:bg-blue-900/30 text-[#0053e2] dark:text-blue-300">'
              + _crmEsc(String(v)) + '</span>';
          }).join('')
        + '</div>'
    : '';

  // Custom fields — display-only cards
  var cfHtml = _crmFields.map(function(f){
    var raw = String(fv[f.id] ?? '');
    var display = '';
    if (f.field_type === 'checkbox') {
      display = raw === '1'
        ? `<span class="text-green-600 font-medium">✅ Yes</span>`
        : `<span class="text-gray-400">☐ No</span>`;
    } else if (f.field_type === 'multi_select') {
      try {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length)
          display = arr.map(function(v){
            return `<span class="inline-block px-2 py-0.5 rounded-full text-xs bg-blue-100 dark:bg-blue-900/40 text-[#0053e2] dark:text-blue-300">${_crmEsc(v)}</span>`;
          }).join(' ');
      } catch(e) {}
    } else if (f.field_type === 'file_links') {
      try {
        var links = JSON.parse(raw);
        if (Array.isArray(links) && links.length)
          display = links.map(function(l){
            return `<a href="${_crmEsc(l)}" target="_blank" rel="noopener"
              class="block text-[#0053e2] dark:text-blue-400 hover:underline text-xs truncate">${_crmEsc(l)}</a>`;
          }).join('');
      } catch(e) {}
    } else if (f.field_type === 'url' && raw) {
      display = `<a href="${_crmEsc(raw)}" target="_blank" rel="noopener"
        title="${_crmEsc(raw)}"
        class="text-[#0053e2] dark:text-blue-400 hover:underline text-sm">${_crmEsc(_crmShortenUrl(raw))}</a>`;
    } else if (f.field_type === 'reminder') {
      try {
        var ro = JSON.parse(raw);
        if (ro.date) {
          // Parse YYYY-MM-DD manually to avoid UTC-midnight timezone shift
          var dp = ro.date.split('-').map(Number);
          var dt = new Date(dp[0], dp[1] - 1, dp[2]);
          var dateStr = dt.toLocaleDateString(undefined, { month:'long', day:'numeric', year:'numeric' });
          var timeStr = '';
          if (ro.time) {
            var tp = ro.time.split(':').map(Number);
            var h = tp[0], m = tp[1];
            timeStr = ' \u00b7 ' + ((h % 12) || 12) + ':' + String(m).padStart(2,'0') + ' ' + (h < 12 ? 'AM' : 'PM');
          }
          var recLabels = {
            none:'', daily:'Repeats daily', weekly:'Repeats weekly',
            biweekly:'Repeats bi-weekly', monthly:'Repeats monthly', yearly:'Repeats yearly'
          };
          var recStr = (ro.rec && ro.rec !== 'none') ? recLabels[ro.rec] || ro.rec : '';
          display = `<span class="font-medium">🔔 ${_crmEsc(dateStr + timeStr)}</span>`
            + (ro.msg ? ` <span class="text-gray-500 dark:text-zinc-400 italic">· ${_crmEsc(ro.msg)}</span>` : '')
            + (recStr ? `<br><span class="text-xs text-[#0053e2] dark:text-blue-400">🔁 ${_crmEsc(recStr)}</span>` : '');
        }
      } catch(e) {}
    } else {
      display = _crmEsc(raw);
    }
    if (!display) return '';
    return `<div class="py-2.5 border-b border-gray-100 dark:border-zinc-800 last:border-0">
      <p class="text-[11px] font-medium text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-0.5">${_crmEsc(f.label)}</p>
      <div class="text-sm text-gray-800 dark:text-zinc-200">${display}</div>
    </div>`;
  }).filter(Boolean).join('');

  // Linked deals — filter from global _crmDeals
  var deals = (typeof _crmDeals !== 'undefined' ? _crmDeals : []).filter(function(d){
    return d.contact_id === c.id;
  });
  var stageMap = {};
  (typeof _crmStages !== 'undefined' ? _crmStages : []).forEach(function(s){ stageMap[s.id] = s.label; });
  var dealsHtml = deals.length
    ? deals.map(function(d){
        return `<div class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-zinc-800 last:border-0">
          <div>
            <p class="text-sm font-medium text-gray-800 dark:text-zinc-200">${_crmEsc(d.title||'Untitled')}</p>
            ${stageMap[d.stage_id] ? `<p class="text-xs text-gray-400">${_crmEsc(stageMap[d.stage_id])}</p>` : ''}
          </div>
          ${d.value ? `<span class="text-sm font-semibold text-green-600 dark:text-green-400">$${_crmEsc(String(d.value))}</span>` : ''}
        </div>`;
      }).join('')
    : `<p class="text-xs text-gray-400 dark:text-zinc-500 italic py-2">No linked deals.</p>`;

  _crmSetMain(`
    <div class="max-w-4xl mx-auto pb-10">

      <!-- Back bar -->
      <div class="flex items-center gap-2 mb-5">
        <button onclick="crmDetailBack()"
          class="flex items-center gap-1 text-sm text-gray-500 dark:text-zinc-400
                 hover:text-[#0053e2] dark:hover:text-blue-400 transition font-medium">
          ← Back
        </button>
        <div class="flex-1"></div>
        <button onclick="crmOpenEdit(${c.id})"
          class="px-3 py-1.5 text-sm font-semibold rounded-lg bg-[#0053e2] text-white hover:bg-blue-700 transition">
          ✎ Edit
        </button>
        <button onclick="crmDeleteContact(${c.id})"
          class="px-3 py-1.5 text-sm font-semibold rounded-lg border border-red-200 text-red-500
                 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 transition">
          Delete
        </button>
      </div>

      <!-- Hero card -->
      <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-700 shadow-sm overflow-hidden mb-4">
        <div class="h-1.5 bg-gradient-to-r from-[#0053e2] to-[#ffc220]"></div>
        <div class="p-6 flex gap-5 items-start">
          <div class="flex-shrink-0">${avatar}</div>
          <div class="flex-1 min-w-0">
            <h1 class="text-2xl font-bold text-gray-900 dark:text-zinc-100 leading-tight">${_crmEsc(c.name||'—')}</h1>
            ${c.company ? `<p class="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">${_crmEsc(c.company)}</p>` : ''}
            <div class="flex flex-wrap gap-2 mt-2">
              ${c.email ? `<a href="mailto:${_crmEsc(c.email)}"
                class="inline-flex items-center gap-1 text-xs text-[#0053e2] dark:text-blue-400 hover:underline">
                ✉ ${_crmEsc(c.email)}</a>` : ''}
              ${c.phone ? `<span class="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400">
                📞 ${_crmEsc(_crmPhone(c.phone))}</span>` : ''}
            </div>
            ${c.address ? `<p class="mt-1.5">
              <a href="https://maps.google.com/?q=${encodeURIComponent(c.address)}"
                 target="_blank" rel="noopener"
                 title="Open in Google Maps"
                 class="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400
                        hover:text-[#0053e2] dark:hover:text-blue-400 hover:underline transition">
                📍 ${_crmEsc(c.address)}
              </a>
            </p>` : ''}
            ${tagHtml ? `<div class="flex flex-wrap gap-1.5 mt-3">${tagHtml}</div>` : ''}
            ${relPills}
          </div>
        </div>
      </div>

      <!-- Two-column body -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

        <!-- Left: Custom fields -->
        <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-700 shadow-sm p-5">
          <h2 class="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-3">
            Custom Fields
          </h2>
          ${cfHtml || '<p class="text-xs text-gray-400 dark:text-zinc-500 italic">No custom fields defined yet.</p>'}
        </div>

        <!-- Right: Reminders + Deals -->
        <div class="flex flex-col gap-4">

          <!-- Reminders -->
          <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-700 shadow-sm p-5">
            <h2 class="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-3">
              Reminders
            </h2>
            <div id="crm-detail-reminders" class="text-xs text-gray-400 italic">Loading…</div>
          </div>

          <!-- Linked Deals -->
          <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-700 shadow-sm p-5">
            <h2 class="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-3">
              Linked Deals
            </h2>
            ${dealsHtml}
          </div>

        </div>
      </div>

      <!-- Conversations (full-width, below two-column grid) -->
      <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-700 shadow-sm p-5 mt-4">
        <h2 class="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-4 flex items-center gap-2">
          <span>💬</span> Conversations
        </h2>
        <div id="crm-detail-convo" class="text-xs text-gray-400 italic">Loading…</div>
      </div>

    </div>
  `);

  // Load async sections
  _crmLoadDetailReminders(c.id);
  _convoActiveContactId = c.id;
  if (typeof crmConvoInitDetail === 'function') crmConvoInitDetail(c.id);
}

async function _crmLoadDetailReminders(contactId) {
  var el = document.getElementById('crm-detail-reminders');
  if (!el) return;
  try {
    var data = await _crmFetch(`/home/crm/${_crmPid}/contacts/${contactId}/reminders`);
    var reminders = Array.isArray(data) ? data : (data.reminders || []);
    if (!reminders.length) {
      el.innerHTML = '<p class="text-xs text-gray-400 dark:text-zinc-500 italic">No reminders set.</p>';
      return;
    }
    el.innerHTML = reminders.map(function(r){
      var dateStr = r.reminder_date
        ? new Date(r.reminder_date + 'T' + (r.reminder_time||'00:00')).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
        : '';
      return `<div class="flex items-start gap-2 py-2 border-b border-gray-100 dark:border-zinc-800 last:border-0">
        <span class="text-base leading-none mt-0.5">🔔</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-800 dark:text-zinc-200">${_crmEsc(r.label||r.message||'Reminder')}</p>
          ${dateStr ? `<p class="text-xs text-gray-400">${dateStr}</p>` : ''}
          ${r.recurrence && r.recurrence !== 'none' ? `<p class="text-xs text-gray-400 italic">${_crmEsc(r.recurrence)}</p>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch(err) {
    if (el) el.innerHTML = '<p class="text-xs text-red-400">Could not load reminders.</p>';
  }
}
