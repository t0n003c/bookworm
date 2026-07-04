// home-page-crm-detail.js
// Full contact detail page rendered inside #crm-main.
// Styled as an "aged page in a book" (tea-stained parchment) — all presentation
// lives in static/css/crm-aged-paper.css, scoped under .crm-aged-wrap.
// Globals it uses: _crmPid, _crmContacts, _crmFields, _crmDeals, _crmView,
//   _crmDetailContactId, _crmPrevView, _crmSetMain, _crmRender, _crmEsc,
//   _crmFetch, _crmFieldDisplay, _crmPhone, crmOpenEdit, crmDeleteContact
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
    return display.length > 50 ? display.slice(0, 49) + '…' : display;
  } catch (_) {
    return raw.length > 50 ? raw.slice(0, 49) + '…' : raw;
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

// Click on the desk backdrop (outside the parchment sheet) → exit the detail view.
function crmDetailBgClick(e) {
  if (e.target.closest('.crm-aged-page')) return;  // click landed on the page itself
  crmDetailBack();
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

  // Avatar — framed like a tipped-in vintage photograph (sepia, photo corners)
  var avatar = '<div class="crm-aged-photo">' + (c.profile_pic
    ? `<img src="${_crmEsc(c.profile_pic)}" alt=""/>`
    : `<div class="ph">${_crmIconHtml(c.avatar_emoji || '👤')}</div>`) + '</div>';

  // Tags → rubber-stamp pills
  var tagHtml = (c.tags||'').split(',').filter(Boolean).map(function(t){
    return `<span class="crm-aged-stamp">${_crmEsc(t.trim())}</span>`;
  }).join('');

  // Relationship → rubber-stamp pills
  var _relArr = [];
  try { _relArr = JSON.parse(c.relationship || '[]'); } catch {}
  if (!Array.isArray(_relArr)) _relArr = (c.relationship||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
  var relHtml = _relArr.length
    ? _relArr.map(function(v){ return `<span class="crm-aged-stamp">${_crmEsc(String(v))}</span>`; }).join('')
    : '';
  var stampsHtml = (tagHtml || relHtml)
    ? `<div class="crm-aged-stamps">${tagHtml}${relHtml}</div>` : '';

  // Custom fields — display-only "ledger" entries
  var cfHtml = _crmFields.map(function(f){
    var raw = String(fv[f.id] ?? '');
    var display = '';
    if (f.field_type === 'checkbox') {
      display = raw === '1'
        ? `<span style="color:#4a6a2a;font-weight:600;">✅ Yes</span>`
        : `<span style="color:#9a7a4a;">☐ No</span>`;
    } else if (f.field_type === 'multi_select') {
      try {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length)
          display = arr.map(function(v){
            return `<span class="crm-aged-chip">${_crmEsc(v)}</span>`;
          }).join(' ');
      } catch(e) {}
    } else if (f.field_type === 'file_links') {
      try {
        var links = JSON.parse(raw);
        if (Array.isArray(links) && links.length)
          display = links.map(function(l){
            return `<a href="${_crmEsc(l)}" target="_blank" rel="noopener"
              class="crm-aged-link" style="display:block;font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_crmEsc(l)}</a>`;
          }).join('');
      } catch(e) {}
    } else if (f.field_type === 'url' && raw) {
      display = `<a href="${_crmEsc(raw)}" target="_blank" rel="noopener"
        title="${_crmEsc(raw)}" class="crm-aged-link">${_crmEsc(_crmShortenUrl(raw))}</a>`;
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
            timeStr = ' · ' + ((h % 12) || 12) + ':' + String(m).padStart(2,'0') + ' ' + (h < 12 ? 'AM' : 'PM');
          }
          var recLabels = {
            none:'', daily:'Repeats daily', weekly:'Repeats weekly',
            biweekly:'Repeats bi-weekly', monthly:'Repeats monthly', yearly:'Repeats yearly'
          };
          var recStr = (ro.rec && ro.rec !== 'none') ? recLabels[ro.rec] || ro.rec : '';
          display = `<span style="font-weight:600;">🔔 ${_crmEsc(dateStr + timeStr)}</span>`
            + (ro.msg ? ` <span style="color:#6b573a;font-style:italic;">· ${_crmEsc(ro.msg)}</span>` : '')
            + (recStr ? `<br><span style="font-size:.75rem;color:#7a5a2a;">🔁 ${_crmEsc(recStr)}</span>` : '');
        }
      } catch(e) {}
    } else {
      display = _crmEsc(raw);
    }
    if (!display) return '';
    return `<div class="crm-aged-entry">
      <div class="crm-aged-entry-label">${_crmEsc(f.label)}</div>
      <div class="crm-aged-entry-value">${display}</div>
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
        return `<div class="crm-aged-deal">
          <div>
            <div class="crm-aged-deal-title">${_crmEsc(d.title||'Untitled')}</div>
            ${stageMap[d.stage_id] ? `<div class="crm-aged-deal-stage">${_crmEsc(stageMap[d.stage_id])}</div>` : ''}
          </div>
          ${d.value ? `<span class="crm-aged-deal-val">$${_crmEsc(String(d.value))}</span>` : ''}
        </div>`;
      }).join('')
    : `<p class="crm-aged-empty">No linked deals.</p>`;

  // Contact lines (email / phone / address)
  var contactBits = '';
  if (c.email)   contactBits += `<a href="mailto:${_crmEsc(c.email)}">✉ ${_crmEsc(c.email)}</a>`;
  if (c.phone)   contactBits += `<span>📞 ${_crmEsc(_crmPhone(c.phone))}</span>`;
  if (c.address) contactBits += `<a href="https://maps.google.com/?q=${encodeURIComponent(c.address)}"
                     target="_blank" rel="noopener" title="Open in Google Maps">📍 ${_crmEsc(c.address)}</a>`;
  var contactHtml = contactBits ? `<div class="crm-aged-contact">${contactBits}</div>` : '';

  _crmSetMain(`
    <div class="crm-aged-wrap" onclick="crmDetailBgClick(event)">
      <div class="crm-aged-page">

        <!-- Top bar -->
        <div class="crm-aged-topbar">
          <button class="crm-aged-back" onclick="crmDetailBack()">❦ Back</button>
          <div class="crm-aged-spacer"></div>
          <button class="crm-aged-btn" onclick="crmOpenEdit(${c.id})">✎ Edit</button>
          <button class="crm-aged-btn danger" onclick="crmDeleteContact(${c.id})">Delete</button>
        </div>

        <!-- Hero -->
        <div class="crm-aged-hero">
          <div>${avatar}</div>
          <div style="flex:1;min-width:0;">
            <div class="crm-aged-name">${_crmEsc(c.name||'—')}</div>
            ${c.company ? `<div class="crm-aged-company">${_crmEsc(c.company)}</div>` : ''}
            ${contactHtml}
            ${stampsHtml}
          </div>
        </div>

        <hr class="crm-aged-rule"/>

        <!-- Two-column body -->
        <div class="crm-aged-cols">
          <div class="crm-aged-section">
            <div class="crm-aged-h">Custom Fields</div>
            ${cfHtml || '<p class="crm-aged-empty">No custom fields recorded yet.</p>'}
          </div>
          <div class="crm-aged-col">
            <div class="crm-aged-section">
              <div class="crm-aged-h">Reminders</div>
              <div id="crm-detail-reminders" class="crm-aged-empty">Loading…</div>
            </div>
            ${deals.length ? `
            <div class="crm-aged-section">
              <div class="crm-aged-h">Linked Deals</div>
              ${dealsHtml}
            </div>` : ''}
          </div>
        </div>

        <!-- Conversations (full-width) -->
        <div class="crm-aged-section full">
          <div class="crm-aged-h"><span>💬</span> Conversations</div>
          <div id="crm-detail-convo" class="crm-aged-empty">Loading…</div>
        </div>

        <!-- Decorative aged edges: torn top-right corner + curled bottom-right corner -->
        <div class="crm-aged-tear" aria-hidden="true"></div>
        <div class="crm-aged-curl" aria-hidden="true"></div>

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
      el.innerHTML = '<p class="crm-aged-empty">No reminders set.</p>';
      return;
    }
    el.innerHTML = reminders.map(function(r){
      var dateStr = r.reminder_date
        ? new Date(r.reminder_date + 'T' + (r.reminder_time||'00:00')).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
        : '';
      return `<div class="crm-aged-rem">
        <span class="ico">🔔</span>
        <div style="flex:1;min-width:0;">
          <div class="crm-aged-rem-title">${_crmEsc(r.label||r.message||'Reminder')}</div>
          ${dateStr ? `<div class="crm-aged-rem-meta">${dateStr}</div>` : ''}
          ${r.recurrence && r.recurrence !== 'none' ? `<div class="crm-aged-rem-meta" style="font-style:italic;">${_crmEsc(r.recurrence)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch(err) {
    if (el) el.innerHTML = '<p class="crm-aged-empty" style="color:#7c2d1a;">Could not load reminders.</p>';
  }
}
