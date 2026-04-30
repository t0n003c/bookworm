/* workspace-database.js
 * Client-side logic for workspace Database nodes (Notion-inspired card grid).
 * Rules: ALL var — no let/const. All public funcs prefixed db, private _db.
 * Booted by initDatabaseView() — called from htmx:afterSettle AND DOMContentLoaded in index.html.
 */

/* ── module state ─────────────────────────────────────────────────────────── */
var _dbWsId              = null;   // current database workspace id (int)
var _dbCards             = [];     // array of card objects from server
var _dbSaveTimers        = {};     // {cardId: timeoutId} — per-card note debounce
var _dbDetailId          = null;   // card id currently open in detail panel
var _dbDelTarget         = null;   // card id staged for deletion
var _dbPanelClickHandler = null;   // click-outside handler attached to #panel
var _dbSizeStep          = 3;      // card size slider step (1=small … 5=large)

/* ── block-grip DnD state (DB card note area) ────────────────────────────── */
var _dbGripDragging     = null;   // the block element being dragged
var _dbGripContainer    = null;   // _dbGripDragging.parentElement at dragstart
var _dbGripNoteEl       = null;   // the [data-db-note] container
var _dbGripStartY       = 0;
var _dbGripDidDrag      = false;
var _dbGripGhost        = null;   // label pill following cursor
var _dbGripIndicator    = null;   // blue drop-line
var _dbGripInsertBefore = null;
var _dbGripDropParent   = null;

/* ── number format registry ────────────────────────────────────────── */
// Each entry: { id, label, currency }  — currency=null means non-currency
var _DB_NUM_FORMATS = [
  // ─ plain formats
  { id:'number',     label:'Number',                          currency:null },
  { id:'number_sep', label:'Number with separators',          currency:null },
  { id:'percent',    label:'% Percent',                       currency:null },
  // ─ user-specified currencies
  { id:'gbp', label:'\u00a3 Pound (GBP)',                      currency:'GBP' },
  { id:'usd', label:'$ US Dollar (USD)',                       currency:'USD' },
  { id:'aud', label:'A$ Australian Dollar (AUD)',               currency:'AUD' },
  { id:'cad', label:'C$ Canadian Dollar (CAD)',                 currency:'CAD' },
  { id:'sgd', label:'S$ Singapore Dollar (SGD)',                currency:'SGD' },
  { id:'eur', label:'\u20ac Euro (EUR)',                        currency:'EUR' },
  { id:'rub', label:'\u20bd Ruble (RUB)',                       currency:'RUB' },
  { id:'inr', label:'\u20b9 Rupee (INR)',                       currency:'INR' },
  { id:'krw', label:'\u20a9 Won (KRW)',                         currency:'KRW' },
  { id:'cny', label:'\u00a5 Yuan (CNY)',                        currency:'CNY' },
  { id:'brl', label:'R$ Real (BRL)',                            currency:'BRL' },
  { id:'try', label:'\u20ba Lira (TRY)',                        currency:'TRY' },
  { id:'idr', label:'Rp Rupiah (IDR)',                          currency:'IDR' },
  { id:'chf', label:'Fr Franc (CHF)',                           currency:'CHF' },
  { id:'hkd', label:'HK$ Hong Kong Dollar (HKD)',               currency:'HKD' },
  { id:'nzd', label:'NZ$ New Zealand Dollar (NZD)',             currency:'NZD' },
  { id:'sek', label:'kr Swedish Krona (SEK)',                   currency:'SEK' },
  // ─ additional world currencies
  { id:'jpy', label:'\u00a5 Yen (JPY)',                         currency:'JPY' },
  { id:'mxn', label:'$ Mexican Peso (MXN)',                     currency:'MXN' },
  { id:'nok', label:'kr Norwegian Krone (NOK)',                  currency:'NOK' },
  { id:'dkk', label:'kr Danish Krone (DKK)',                    currency:'DKK' },
  { id:'pln', label:'z\u0142 Polish Zloty (PLN)',               currency:'PLN' },
  { id:'czk', label:'K\u010d Czech Koruna (CZK)',               currency:'CZK' },
  { id:'huf', label:'Ft Hungarian Forint (HUF)',                 currency:'HUF' },
  { id:'ron', label:'lei Romanian Leu (RON)',                    currency:'RON' },
  { id:'uah', label:'\u20b4 Ukrainian Hryvnia (UAH)',            currency:'UAH' },
  { id:'isk', label:'kr Icelandic Kr\u00f3na (ISK)',            currency:'ISK' },
  { id:'bgn', label:'\u043b\u0432 Bulgarian Lev (BGN)',         currency:'BGN' },
  { id:'sar', label:'\ufdfc Saudi Riyal (SAR)',                  currency:'SAR' },
  { id:'aed', label:'\u062f.\u0625 UAE Dirham (AED)',           currency:'AED' },
  { id:'ils', label:'\u20aa Israeli Shekel (ILS)',               currency:'ILS' },
  { id:'qar', label:'\ufdfc Qatari Riyal (QAR)',                 currency:'QAR' },
  { id:'kwd', label:'KD Kuwaiti Dinar (KWD)',                    currency:'KWD' },
  { id:'bhd', label:'BD Bahraini Dinar (BHD)',                   currency:'BHD' },
  { id:'omr', label:'\ufdfc Omani Rial (OMR)',                   currency:'OMR' },
  { id:'egp', label:'\u00a3 Egyptian Pound (EGP)',               currency:'EGP' },
  { id:'zar', label:'R South African Rand (ZAR)',                currency:'ZAR' },
  { id:'ngn', label:'\u20a6 Nigerian Naira (NGN)',               currency:'NGN' },
  { id:'mad', label:'MAD Moroccan Dirham (MAD)',                  currency:'MAD' },
  { id:'kes', label:'KSh Kenyan Shilling (KES)',                  currency:'KES' },
  { id:'ghs', label:'GH\u20b5 Ghanaian Cedi (GHS)',             currency:'GHS' },
  { id:'thb', label:'\u0e3f Thai Baht (THB)',                    currency:'THB' },
  { id:'vnd', label:'\u20ab Vietnamese Dong (VND)',              currency:'VND' },
  { id:'myr', label:'RM Malaysian Ringgit (MYR)',                 currency:'MYR' },
  { id:'php', label:'\u20b1 Philippine Peso (PHP)',              currency:'PHP' },
  { id:'twd', label:'NT$ Taiwan Dollar (TWD)',                    currency:'TWD' },
  { id:'pkr', label:'\u20a8 Pakistani Rupee (PKR)',              currency:'PKR' },
  { id:'bdt', label:'\u09f3 Bangladeshi Taka (BDT)',             currency:'BDT' },
  { id:'lkr', label:'\u20a8 Sri Lankan Rupee (LKR)',             currency:'LKR' },
  { id:'kzt', label:'\u20b8 Kazakhstani Tenge (KZT)',            currency:'KZT' },
  { id:'ars', label:'$ Argentine Peso (ARS)',                     currency:'ARS' },
  { id:'clp', label:'$ Chilean Peso (CLP)',                       currency:'CLP' },
  { id:'cop', label:'$ Colombian Peso (COP)',                     currency:'COP' },
  { id:'pen', label:'S/ Peruvian Sol (PEN)',                      currency:'PEN' },
  { id:'uyu', label:'$ Uruguayan Peso (UYU)',                     currency:'UYU' },
  // ─ crypto — last
  { id:'btc', label:'\u20bf Bitcoin (BTC)',                      currency:null  },
];

/* ── date format registry ──────────────────────────────────────────── */
var _DB_DATE_FORMATS = [
  { id: 'mdy',   label: 'MM/DD/YYYY',      example: '04/22/2025' },
  { id: 'dmy',   label: 'DD/MM/YYYY',      example: '22/04/2025' },
  { id: 'ymd',   label: 'YYYY-MM-DD',      example: '2025-04-22' },
  { id: 'short', label: 'Apr 22, 2025',    example: 'Apr 22, 2025' },
  { id: 'long',  label: 'April 22, 2025',  example: 'April 22, 2025' },
];

/* ── attribute type registry ────────────────────────────────────────── */
var _DB_ATTR_TYPES = [
  { id: 'text',         label: 'Text',         icon: '\uD83D\uDCDD' },
  { id: 'number',       label: 'Number',       icon: '\uD83D\uDD22' },
  { id: 'select',       label: 'Select',       icon: '\u25BE' },
  { id: 'multi_select', label: 'Multi-select', icon: '\u2611' },
  { id: 'status',       label: 'Status',       icon: '\u25CF' },
  { id: 'date',         label: 'Date',         icon: '\uD83D\uDCC5' },
  { id: 'person',       label: 'Person',       icon: '\uD83D\uDC64' },
  { id: 'files',        label: 'Files',        icon: '\uD83D\uDCCE' },
  { id: 'checkbox',     label: 'Checkbox',     icon: '\u2705' },
  { id: 'url',          label: 'URL',          icon: '\uD83D\uDD17' },
  { id: 'email',        label: 'Email',        icon: '\u2709' },
  { id: 'phone',        label: 'Phone',        icon: '\uD83D\uDCDE' },
  { id: 'place',        label: 'Place',        icon: '\uD83D\uDCCD' },
];

/* ── selection toolbar state ─────────────────────────────────────────────── */
var _dbSelBar       = null;  // floating toolbar DOM element
var _dbSelBarTimer  = null;  // hide-debounce timer

/* ═══════════════════════════════════════════════════════════════════════════
   ENTRY POINT
═══════════════════════════════════════════════════════════════════════════ */

function initDatabaseView(wsId) {
  _dbWsId = wsId;
  // Databases have their own Add Card flow — New Note doesn't apply here.
  var btnNN = document.getElementById('btn-new-note');
  if (btnNN) btnNN.classList.add('hidden');
  // Tighten breadcrumb bottom margin so it doesn't gap-stack with the DB header.
  var crumbNav = document.querySelector('#ws-breadcrumb nav');
  if (crumbNav) { crumbNav._bwOldMb = crumbNav.className; crumbNav.classList.remove('mb-5'); crumbNav.classList.add('mb-1'); }
  var raw = document.getElementById('db-cards-data');
  _dbCards = raw ? JSON.parse(raw.textContent || '[]') : [];
  // Restore saved size preference (stored per-workspace so each DB is independent)
  var saved = parseInt(localStorage.getItem('_dbSize_' + wsId), 10);
  _dbSizeStep = (saved >= 1 && saved <= 5) ? saved : 3;
  _dbApplySize(_dbSizeStep);
  _dbRenderGrid();
  _dbBindModals();
  _dbInitStyles();
  _dbSelToolbarInit();
}

/* ── card size slider ─────────────────────────────────────────────────────────────── */
// Five discrete steps. minW drives auto-fill columns; cover/grad heights scale in sync.
var _dbSizeCfg = [
  { minW: '180px', coverH: '6rem'   },  // 1 — compact
  { minW: '260px', coverH: '9rem'   },  // 2
  { minW: '360px', coverH: '12rem'  },  // 3 — default
  { minW: '480px', coverH: '16rem'  },  // 4
  { minW: '600px', coverH: '20rem'  },  // 5 — spacious
];

function _dbApplySize(step) {
  var cfg  = _dbSizeCfg[(step - 1)] || _dbSizeCfg[2];
  var root = document.getElementById('db-view-root');
  var grid = document.getElementById('db-card-grid');
  if (root) {
    root.style.setProperty('--db-cover-h', cfg.coverH);
  }
  if (grid) {
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(' + cfg.minW + ', 1fr))';
  }
  var slider = document.getElementById('db-size-slider');
  if (slider && slider.value != step) slider.value = step;
}

window._dbSetSize = function(step) {
  _dbSizeStep = parseInt(step, 10) || 3;
  if (_dbWsId) localStorage.setItem('_dbSize_' + _dbWsId, _dbSizeStep);
  _dbApplySize(_dbSizeStep);
};

/* ═══════════════════════════════════════════════════════════════════════════
   GRID RENDERING
═══════════════════════════════════════════════════════════════════════════ */

function _dbRenderGrid() {
  var grid  = document.getElementById('db-card-grid');
  var empty = document.getElementById('db-empty-state');
  var count = document.getElementById('db-card-count');
  if (!grid) return;

  if (count) {
    count.textContent = _dbCards.length + ' card' + (_dbCards.length !== 1 ? 's' : '');
  }

  if (_dbCards.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  grid.innerHTML = _dbCards.map(function(c) { return _dbCardHtml(c); }).join('');
}

function _dbCardHtml(card) {
  var cover   = _dbCoverHtml(card);
  var pills   = _dbAttrPills(card.attrs || []);
  var updated = card.updated_at ? card.updated_at.replace('T', ' ').slice(0, 16) : '';

  return (
    '<div class="db-card bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700'
    + ' shadow-sm overflow-hidden flex flex-col group/card" data-card-id="' + card.id + '">'
    + cover
    + '<div class="p-3 flex flex-col flex-1 gap-2">'
    + '<div class="flex items-start gap-2">'
    + '<div contenteditable="true" class="flex-1 font-semibold text-gray-900 dark:text-zinc-100'
    + ' text-sm leading-snug outline-none empty:before:content-[\'Untitled\']'
    + ' empty:before:text-gray-300 dark:empty:before:text-zinc-600"'
    + ' onblur="_dbTitleBlur(' + card.id + ',this)"'
    + ' aria-label="Card title">' + _esc(card.title) + '</div>'
    + '<div class="flex gap-1 flex-shrink-0 opacity-0 group-hover/card:opacity-100 transition">'
    + '<button type="button" onclick="_dbOpenDetail(' + card.id + ')"'
    + ' title="Open card" aria-label="Open card detail"'
    + ' class="p-1 rounded text-gray-400 hover:text-purple-600 hover:bg-purple-50'
    + ' dark:hover:bg-purple-900/30 transition">'
    + '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">'
    + '<path stroke-linecap="round" stroke-linejoin="round"'
    + ' d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>'
    + '</button>'
    + '<button type="button" onclick="_dbDeletePrompt(' + card.id + ')"'
    + ' title="Delete card" aria-label="Delete card"'
    + ' class="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50'
    + ' dark:hover:bg-red-900/20 transition">'
    + '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">'
    + '<path stroke-linecap="round" stroke-linejoin="round"'
    + ' d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>'
    + '</button>'
    + '</div></div>'
    + (pills ? pills : '')
    + '<div class="text-[10px] text-gray-400 dark:text-zinc-500 tabular-nums">'
    + (updated ? 'Updated ' + updated : '') + '</div>'
    + '</div></div>'
  );
}

// Returns true if a cover URL points to a video file (by extension).
function _dbCoverIsVideo(url) {
  if (!url) return false;
  var ext = url.split('?')[0].split('.').pop().toLowerCase();
  return ['mp4', 'mov', 'webm', 'ogg', 'ogv'].indexOf(ext) !== -1;
}

function _dbCoverHtml(card) {
  if (card.cover_url) {
    var isVid = _dbCoverIsVideo(card.cover_url);
    var media = isVid
      ? '<video src="' + _esc(card.cover_url) + '" muted playsinline preload="metadata" loop'
        + ' class="w-full h-full object-cover"'
        + ' onmouseenter="this.play()" onmouseleave="this.pause()"></video>'
      : '<img src="' + _esc(card.cover_url) + '" alt="Cover" loading="lazy"'
        + ' class="w-full h-full object-cover" />';
    return (
      '<div class="relative w-full flex-shrink-0 bg-gray-100 dark:bg-zinc-800 cursor-pointer"'
      + ' style="height:var(--db-cover-h,9rem);"'
      + ' onclick="_dbOpenDetail(' + card.id + ')">'
      + media
      + '</div>'
    );
  }
  // Gradient placeholder with first letter
  var gradients = [
    'from-purple-400 to-purple-600',
    'from-blue-400 to-blue-600',
    'from-pink-400 to-rose-500',
    'from-emerald-400 to-teal-500',
    'from-amber-400 to-orange-500',
  ];
  var grad = gradients[card.id % gradients.length];
  return (
    '<div style="height:var(--db-cover-h,9rem);" class="w-full flex-shrink-0 flex items-center justify-center cursor-pointer'
    + ' bg-gradient-to-br ' + grad + ' opacity-70 dark:opacity-80"'
    + ' onclick="_dbOpenDetail(' + card.id + ')">'
    + '<span class="text-3xl font-bold text-white opacity-50 select-none">'
    + _esc((card.title || 'U')[0].toUpperCase()) + '</span>'
    + '</div>'
  );
}

function _dbAttrPills(attrs) {
  // Splits attrs into two groups:
  //   plainParts  — all types except select/multi_select (no bubble)
  //   chipParts   — select + multi_select (purple pill bubbles)
  // The two groups render on separate lines when both are present.
  if (!attrs || attrs.length === 0) return '';

  var plainParts = [];
  var chipParts  = [];

  for (var i = 0; i < attrs.length; i++) {
    var a = attrs[i];
    var t = a.attr_type  || 'text';
    var v = a.attr_value || '';

    if (t === 'select') {
      if (v) chipParts.push(
        '<span class="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded'
        + ' bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 max-w-[120px] truncate">'
        + _esc(v) + '</span>'
      );
    } else if (t === 'multi_select') {
      var mopts = (a.attr_options || '').split(',').map(function(o) { return o.trim(); }).filter(Boolean);
      v.split(',').map(function(s) { return s.trim(); }).filter(function(s) {
        return s && (mopts.length === 0 || mopts.indexOf(s) !== -1);
      }).forEach(function(s) {
        chipParts.push(
          '<span class="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded'
          + ' bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 max-w-[120px] truncate">'
          + _esc(s) + '</span>'
        );
      });
    } else if (t === 'checkbox') {
      if (v === 'true' || v === '1' || v === 'yes') plainParts.push(
        '<span class="text-[10px] text-green-600 dark:text-green-400 font-medium">'
        + '\u2713\u00a0' + _esc(a.attr_key) + '</span>'
      );
    } else if (t === 'status' && v) {
      var sc = _dbStatusColor(v);
      plainParts.push(
        '<span style="color:' + sc + ';" class="text-[10px] font-semibold max-w-[120px] truncate inline-block">'
        + _esc(v) + '</span>'
      );
    } else if (t === 'date' && v) {
      var fmtId = a.attr_options || 'mdy';
      plainParts.push(
        '<span class="text-[10px] text-gray-500 dark:text-zinc-400">'
        + '\uD83D\uDCC5\u00a0' + _esc(_dbFormatDate(v.slice(0, 10), fmtId)) + '</span>'
      );
    } else if ((t === 'url' || t === 'email' || t === 'phone') && v) {
      plainParts.push(
        '<span class="text-[10px] text-blue-500 dark:text-blue-400 max-w-[140px] truncate inline-block">'
        + _esc(v) + '</span>'
      );
    } else if (v) {
      // text / number / person / place / files
      plainParts.push(
        '<span class="text-[10px] text-gray-500 dark:text-zinc-400 max-w-[120px] truncate inline-block">'
        + _esc(v) + '</span>'
      );
    }
  }

  if (plainParts.length === 0 && chipParts.length === 0) return '';

  var MAX_PLAIN = 3, MAX_CHIPS = 4;
  var html = '';

  if (plainParts.length > 0) {
    var extraP   = plainParts.length - MAX_PLAIN;
    var plainHtml = plainParts.slice(0, MAX_PLAIN).join(
      '<span class="text-[10px] text-gray-300 dark:text-zinc-600 mx-0.5">\u00b7</span>'
    );
    if (extraP > 0) plainHtml += '<span class="text-[10px] text-gray-400 dark:text-zinc-500">\u00a0+' + extraP + '</span>';
    html += '<div class="flex flex-wrap items-center gap-1">' + plainHtml + '</div>';
  }

  if (chipParts.length > 0) {
    var extraC   = chipParts.length - MAX_CHIPS;
    var chipHtml = chipParts.slice(0, MAX_CHIPS).join('');
    if (extraC > 0) chipHtml += '<span class="text-[10px] text-gray-400 dark:text-zinc-500 px-1">+' + extraC + ' more</span>';
    html += '<div class="flex flex-wrap gap-1">' + chipHtml + '</div>';
  }

  return html;
}


/* ═══════════════════════════════════════════════════════════════════════════
   CARD CRUD
═══════════════════════════════════════════════════════════════════════════ */

function dbAddCard() {
  var modal = document.getElementById('db-add-card-modal');
  var inp   = document.getElementById('db-new-card-title');
  if (!modal) return;
  if (inp) inp.value = '';
  modal.classList.remove('hidden');
  setTimeout(function() { if (inp) inp.focus(); }, 50);
}

function _dbSubmitAddCard() {
  var inp   = document.getElementById('db-new-card-title');
  var title = inp ? (inp.value.trim() || 'Untitled') : 'Untitled';
  document.getElementById('db-add-card-modal').classList.add('hidden');

  fetch('/workspaces/' + _dbWsId + '/db/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title }),
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Failed to create card');
    return r.json();
  })
  .then(function(card) {
    _dbCards.push(card);
    _dbRenderGrid();
  })
  .catch(function(e) { _dbToast('Could not create card: ' + e.message, true); });
}

function _dbDeletePrompt(cardId) {
  _dbDelTarget = cardId;
  var card   = _dbCards.find(function(c) { return c.id === cardId; });
  var modal  = document.getElementById('db-del-card-modal');
  var label  = document.getElementById('db-del-card-name');
  if (label) label.textContent = card ? card.title : 'Card';
  if (modal) modal.classList.remove('hidden');
}

function _dbConfirmDelete() {
  if (!_dbDelTarget) return;
  var id = _dbDelTarget;
  _dbDelTarget = null;
  document.getElementById('db-del-card-modal').classList.add('hidden');

  fetch('/workspaces/' + _dbWsId + '/db/cards/' + id, { method: 'DELETE' })
  .then(function(r) {
    if (!r.ok) throw new Error('Delete failed');
    _dbCards = _dbCards.filter(function(c) { return c.id !== id; });
    _dbRenderGrid();
    // Close detail if it was showing this card
    if (_dbDetailId === id) _dbCloseDetail();
  })
  .catch(function(e) { _dbToast('Could not delete card: ' + e.message, true); });
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTOSAVE — note content (detail panel only) + title
═══════════════════════════════════════════════════════════════════════════ */

function _dbSaveNote(cardId, html) {
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  if (!card) return;
  card.note_content = html;
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note_content: html }),
  }).catch(function(e) { console.warn('Note save failed', e); });
}

function _dbTitleBlur(cardId, el) {
  var title = el.textContent.trim() || 'Untitled';
  var card  = _dbCards.find(function(c) { return c.id === cardId; });
  if (!card || card.title === title) return;
  card.title = title;
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title }),
  }).catch(function(e) { console.warn('Title save failed', e); });
}

/* ═══════════════════════════════════════════════════════════════════════════
   NOTE AREA TOOLS  —  heading CSS + slash palette + selection toolbar + paste-as
═══════════════════════════════════════════════════════════════════════════ */

function _dbInitStyles() {
  if (document.getElementById('db-note-styles')) return;
  var s = document.createElement('style');
  s.id = 'db-note-styles';
  s.textContent = [
    /* Heading hierarchy inside the card note area */
    '[data-db-note] h1{font-size:2em;font-weight:800;line-height:1.2;margin:.7em 0 .3em}',
    '[data-db-note] h2{font-size:1.5em;font-weight:700;line-height:1.25;margin:.6em 0 .25em}',
    '[data-db-note] h3{font-size:1.25em;font-weight:700;line-height:1.3;margin:.5em 0 .2em}',
    /* blockquote */
    '[data-db-note] blockquote{border-left:3px solid #a78bfa;margin:.5em 0;padding:.25em .75em;',
    'color:#6b7280;font-style:italic;}',
    '.dark [data-db-note] blockquote{border-color:#7c3aed;color:#a1a1aa;}',
    /* code block — overflow:hidden keeps border-radius clean; scrolling handled by <code> */
    '[data-db-note] pre{background:#f3f4f6;border-radius:.5rem;overflow:hidden;margin:.5em 0;}',
    '.dark [data-db-note] pre{background:#27272a;}',
    /* header bar inside pre — JS-injected language label + copy btn; stripped before save */
    '[data-db-note] .db-code-hdr{display:flex;align-items:center;justify-content:space-between;',
    'padding:.22rem .65rem;border-bottom:1px solid rgba(0,0,0,.07);user-select:none;}',
    '.dark [data-db-note] .db-code-hdr{border-color:rgba(255,255,255,.06);}',
    '[data-db-note] .db-code-hdr-lang{font-size:.6rem;font-weight:700;font-family:ui-sans-serif,system-ui,sans-serif;',
    'text-transform:uppercase;letter-spacing:.06em;color:#6b7280;}',
    '.dark [data-db-note] .db-code-hdr-lang{color:#a1a1aa;}',
    '[data-db-note] .db-code-hdr-copy{background:none;border:none;cursor:pointer;color:#9ca3af;',
    'padding:.1rem .35rem;border-radius:.25rem;font-size:.68rem;line-height:1;',
    'display:inline-flex;align-items:center;gap:.2rem;transition:background .12s,color .12s;}',
    '[data-db-note] .db-code-hdr-copy:hover{background:rgba(0,0,0,.07);color:#374151;}',
    '.dark [data-db-note] .db-code-hdr-copy:hover{background:rgba(255,255,255,.09);color:#d4d4d8;}',
    '[data-db-note] .db-code-hdr-copy.copied{color:#2a8703;}',
    '.dark [data-db-note] .db-code-hdr-copy.copied{color:#4ade80;}',
    /* svg icons inside the copy button */
    '[data-db-note] .db-code-hdr-copy svg{display:block;}',
    /* code element handles horizontal scroll; hljs bg/padding overrides stripped */
    '[data-db-note] pre code{display:block;overflow-x:auto;padding:.6rem 1rem;white-space:pre;',
    'font-size:.875em;font-family:ui-monospace,"Cascadia Code",monospace;background:none!important;color:inherit;line-height:1.6;}',
    '[data-db-note] pre code.hljs{background:none!important;padding:.6rem 1rem!important;line-height:1.6;}',
    /* strip any leftover inline background/color set by paste corruption */
    '[data-db-note] pre code span{background:none!important;}',
    /* special: pre with no content yet (fresh slash-command block) hides header */
    '[data-db-note] pre:not([data-has-content]) .db-code-hdr{display:none;}',
    /* when editing (code focused) shift header down slightly so caret starts right */
    /* plain URL links inserted via paste-as popup */
    '[data-db-note] [data-bw-url]{color:#0053e2;text-decoration:underline;text-underline-offset:2px;cursor:pointer;}',
    '.dark [data-db-note] [data-bw-url]{color:#60a5fa;}',
    /* (pre code rule moved above with overflow and hljs overrides) */
    /* inline code */
    '[data-db-note] code{background:#f3f4f6;border-radius:.25rem;padding:.1em .3em;',
    'font-size:.875em;font-family:ui-monospace,"Cascadia Code",monospace;}',
    '.dark [data-db-note] code{background:#3f3f46;}',
    /* callout blocks (reuse note-form classes) */
    '[data-db-note] .bw-callout{display:flex;gap:.6rem;border-radius:.6rem;padding:.6rem .8rem;margin:.5em 0;}',
    '[data-db-note] .bw-callout-info{background:#eff6ff;}[data-db-note] .bw-callout-warning{background:#fffbeb;}',
    '[data-db-note] .bw-callout-tip{background:#f0fdf4;}[data-db-note] .bw-callout-danger{background:#fef2f2;}',
    '.dark [data-db-note] .bw-callout-info{background:#172554;}.dark [data-db-note] .bw-callout-warning{background:#451a03;}',
    '.dark [data-db-note] .bw-callout-tip{background:#052e16;}.dark [data-db-note] .bw-callout-danger{background:#450a0a;}',
    /* columns */
    '[data-db-note] .bw-cols{display:grid;gap:.75rem;margin:.5em 0;}',
    '[data-db-note] .bw-cols-2{grid-template-columns:repeat(2,1fr);}',
    '[data-db-note] .bw-cols-3{grid-template-columns:repeat(3,1fr);}',
    '[data-db-note] .bw-col{min-width:0;}',
    /* toggle / details */
    '[data-db-note] details.bw-toggle{border-left:3px solid #7c3aed;padding-left:.6rem;margin:.5em 0;}',
    '[data-db-note] details.bw-toggle summary{cursor:pointer;font-weight:700;list-style:none;}',
    '[data-db-note] details.bw-toggle summary::-webkit-details-marker{display:none;}',
    '[data-db-note] .bw-toggle-h1 summary{font-size:2em;}',
    '[data-db-note] .bw-toggle-h2 summary{font-size:1.5em;}',
    '[data-db-note] .bw-toggle-h3 summary{font-size:1.25em;}',
    /* selection toolbar — base row */
    '#db-sel-bar{position:fixed;z-index:9998;display:none;flex-direction:column;',
    'border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.2);overflow:hidden;}',
    '#db-sel-bar .db-sb-row{display:flex;align-items:center;gap:2px;padding:4px 6px;}',
    '#db-sel-bar button{width:28px;height:28px;border:none;border-radius:5px;background:transparent;',
    'cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px;transition:background .1s;}',
    '#db-sel-bar .db-sb-sep{width:1px;height:18px;margin:0 2px;flex-shrink:0;}',
    /* flyout rows for highlight and text color */
    '#db-sel-bar .db-sb-flyout{display:none;flex-wrap:wrap;gap:4px;padding:6px 8px;border-top:1px solid;}',
    '#db-sel-bar .db-sb-flyout.open{display:flex;}',
    '#db-sel-bar .db-sb-swatch{width:20px;height:20px;border-radius:4px;border:2px solid transparent;',
    'cursor:pointer;flex-shrink:0;transition:transform .1s;}',
    '#db-sel-bar .db-sb-swatch:hover{transform:scale(1.2);border-color:#0053e2;}',
    /* ── Inline hljs token colours — GitHub palette, scoped to [data-db-note].
       These work whether or not the CDN stylesheet loads.           ── */
    /* light: keywords/types */
    '[data-db-note] pre code .hljs-keyword,[data-db-note] pre code .hljs-type,',
    '[data-db-note] pre code .hljs-template-variable,[data-db-note] pre code .hljs-variable.language_,',
    '[data-db-note] pre code .hljs-meta .hljs-keyword{color:#d73a49;}',
    /* light: strings */
    '[data-db-note] pre code .hljs-string,[data-db-note] pre code .hljs-regexp,',
    '[data-db-note] pre code .hljs-meta .hljs-string{color:#032f62;}',
    /* light: comments */
    '[data-db-note] pre code .hljs-comment,[data-db-note] pre code .hljs-quote{color:#6a737d;font-style:italic;}',
    /* light: numbers / literals / attrs / operators */
    '[data-db-note] pre code .hljs-number,[data-db-note] pre code .hljs-literal,',
    '[data-db-note] pre code .hljs-attr,[data-db-note] pre code .hljs-attribute,',
    '[data-db-note] pre code .hljs-variable,[data-db-note] pre code .hljs-operator{color:#005cc5;}',
    /* light: titles / class names / selectors */
    '[data-db-note] pre code .hljs-title,[data-db-note] pre code .hljs-title.function_,',
    '[data-db-note] pre code .hljs-title.class_,[data-db-note] pre code .hljs-title.class_.inherited__,',
    '[data-db-note] pre code .hljs-selector-class,[data-db-note] pre code .hljs-selector-id{color:#6f42c1;}',
    /* light: built-ins / symbols */
    '[data-db-note] pre code .hljs-built_in,[data-db-note] pre code .hljs-symbol{color:#e36209;}',
    /* light: tag names */
    '[data-db-note] pre code .hljs-name,[data-db-note] pre code .hljs-tag,',
    '[data-db-note] pre code .hljs-selector-tag,[data-db-note] pre code .hljs-selector-pseudo{color:#22863a;}',
    '[data-db-note] pre code .hljs-section{color:#005cc5;font-weight:700;}',
    '[data-db-note] pre code .hljs-bullet{color:#735c0f;}',
    '[data-db-note] pre code .hljs-emphasis{font-style:italic;}',
    '[data-db-note] pre code .hljs-strong{font-weight:700;}',
    '[data-db-note] pre code .hljs-addition{color:#22863a;background:#f0fff4;}',
    '[data-db-note] pre code .hljs-deletion{color:#b31d28;background:#ffeef0;}',
    /* dark: keywords/types */
    '.dark [data-db-note] pre code .hljs-keyword,.dark [data-db-note] pre code .hljs-type,',
    '.dark [data-db-note] pre code .hljs-template-variable,.dark [data-db-note] pre code .hljs-variable.language_,',
    '.dark [data-db-note] pre code .hljs-meta .hljs-keyword{color:#f47067;}',
    /* dark: strings */
    '.dark [data-db-note] pre code .hljs-string,.dark [data-db-note] pre code .hljs-regexp,',
    '.dark [data-db-note] pre code .hljs-meta .hljs-string{color:#96d0ff;}',
    /* dark: comments */
    '.dark [data-db-note] pre code .hljs-comment,.dark [data-db-note] pre code .hljs-quote{color:#636e7b;font-style:italic;}',
    /* dark: numbers / literals / attrs / operators */
    '.dark [data-db-note] pre code .hljs-number,.dark [data-db-note] pre code .hljs-literal,',
    '.dark [data-db-note] pre code .hljs-attr,.dark [data-db-note] pre code .hljs-attribute,',
    '.dark [data-db-note] pre code .hljs-variable,.dark [data-db-note] pre code .hljs-operator{color:#6cb6ff;}',
    /* dark: titles / selectors */
    '.dark [data-db-note] pre code .hljs-title,.dark [data-db-note] pre code .hljs-title.function_,',
    '.dark [data-db-note] pre code .hljs-title.class_,.dark [data-db-note] pre code .hljs-title.class_.inherited__,',
    '.dark [data-db-note] pre code .hljs-selector-class,.dark [data-db-note] pre code .hljs-selector-id{color:#dcbdfb;}',
    /* dark: built-ins */
    '.dark [data-db-note] pre code .hljs-built_in,.dark [data-db-note] pre code .hljs-symbol{color:#f69d50;}',
    /* dark: tag names */
    '.dark [data-db-note] pre code .hljs-name,.dark [data-db-note] pre code .hljs-tag,',
    '.dark [data-db-note] pre code .hljs-selector-tag,.dark [data-db-note] pre code .hljs-selector-pseudo{color:#8ddb8c;}',
    '.dark [data-db-note] pre code .hljs-section{color:#316dca;font-weight:700;}',
    '.dark [data-db-note] pre code .hljs-bullet{color:#eac55f;}',
    '.dark [data-db-note] pre code .hljs-addition{color:#b4f1b4;background:#1b4721;}',
    '.dark [data-db-note] pre code .hljs-deletion{color:#ffd8d3;background:#78191b;}',
    /* line numbers — grid layout when data-line-nums attr present on pre */
    '[data-db-note] pre[data-line-nums]{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto;}',
    '[data-db-note] pre[data-line-nums] .db-code-hdr{grid-column:1/-1;}',
    '[data-db-note] pre[data-line-nums] .db-line-nums{grid-column:1;grid-row:2;}',
    '[data-db-note] pre[data-line-nums] code{grid-column:2;grid-row:2;padding-left:.5rem;}',
    '[data-db-note] .db-line-nums{display:none;user-select:none;pointer-events:none;text-align:right;',
    'padding:.6rem .4rem .6rem .75rem;font-size:.875em;',
    'font-family:ui-monospace,"Cascadia Code",monospace;line-height:1.6;',
    'color:#9ca3af;border-right:1px solid rgba(0,0,0,.08);}',
    '[data-db-note] pre[data-line-nums] .db-line-nums{display:block;}',
    '[data-db-note] .db-line-nums span{display:block;}',
    '.dark [data-db-note] .db-line-nums{color:#52525b;border-color:rgba(255,255,255,.07);}',
    /* line numbers toggle button in the code header bar */
    '[data-db-note] .db-code-hdr-ln{background:none;border:none;cursor:pointer;color:#9ca3af;',
    'padding:.1rem .35rem;border-radius:.25rem;font-size:.6rem;line-height:1;',
    'font-family:ui-monospace,"Cascadia Code",monospace;font-weight:700;',
    'letter-spacing:-.02em;transition:background .12s,color .12s;}',
    '[data-db-note] .db-code-hdr-ln:hover{background:rgba(0,0,0,.07);color:#374151;}',
    '[data-db-note] .db-code-hdr-ln.active{color:#0053e2;}',
    '.dark [data-db-note] .db-code-hdr-ln{color:#52525b;}',
    '.dark [data-db-note] .db-code-hdr-ln:hover{background:rgba(255,255,255,.09);color:#d4d4d8;}',
    '.dark [data-db-note] .db-code-hdr-ln.active{color:#60a5fa;}',
  /* lists — Tailwind base resets list-style:none + padding:0 on ul/ol,
     so we must explicitly restore markers and indentation. */
  '[data-db-note] ul{list-style-type:disc;padding-left:1.5em;margin:.25em 0;}',
  '[data-db-note] ol{list-style-type:decimal;padding-left:1.5em;margin:.25em 0;}',
  '[data-db-note] ul ul{list-style-type:circle;}',
  '[data-db-note] ol ol{list-style-type:lower-alpha;}',
  '[data-db-note] ul ul ul{list-style-type:square;}',
  '[data-db-note] ol ol ol{list-style-type:lower-roman;}',
  '[data-db-note] li{margin:.1em 0;}',
  ].join('');
document.head.appendChild(s);
}

/* Floating selection toolbar — B / I / S + highlight flyout + text-color flyout + A+/A- */
function _dbSelToolbarInit() {
  if (_dbSelBar) return;

  var HL_COLORS = [
    { label: 'Remove', color: null          },
    { label: 'Yellow',  color: '#fef08a'    },
    { label: 'Green',   color: '#bbf7d0'    },
    { label: 'Blue',    color: '#bfdbfe'    },
    { label: 'Pink',    color: '#fbcfe8'    },
    { label: 'Orange',  color: '#fed7aa'    },
    { label: 'Spark',   color: '#fff0a0'    },
    { label: 'Red',     color: '#fecaca'    },
    { label: 'Purple',  color: '#e9d5ff'    },
  ];
  var TC_COLORS = [
    { label: 'Remove',  color: null         },
    { label: 'Black',   color: '#111111'    },
    { label: 'Gray',    color: '#6b7280'    },
    { label: 'Red',     color: '#ea1100'    },
    { label: 'Orange',  color: '#f97316'    },
    { label: 'Yellow',  color: '#b87800'    },
    { label: 'Green',   color: '#2a8703'    },
    { label: 'Blue',    color: '#0053e2'    },
    { label: 'Purple',  color: '#7c3aed'    },
  ];

  var dark = function() { return document.documentElement.classList.contains('dark'); };

  /* ---- helpers ---- */
  function _theme(el) {
    el.style.background = dark() ? '#18181b' : '#ffffff';
    el.style.borderColor = dark() ? '#3f3f46' : '#e5e7eb';
    el.style.color = dark() ? '#f4f4f5' : '#111827';
  }
  function _btnHover(b) {
    b.addEventListener('mouseenter', function() { b.style.background = dark() ? '#27272a' : '#f3f4f6'; });
    b.addEventListener('mouseleave', function() { b.style.background = 'transparent'; });
  }
  function _sep() {
    var s = document.createElement('div');
    s.className = 'db-sb-sep';
    s.style.background = 'rgba(0,0,0,.12)';
    return s;
  }
  function _mkBtn(label, html) {
    var b = document.createElement('button');
    b.type = 'button'; b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = html;
    _btnHover(b);
    return b;
  }

  /* ---- build bar ---- */
  var bar = document.createElement('div');
  bar.id = 'db-sel-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Text formatting');

  /* Main button row */
  var row = document.createElement('div');
  row.className = 'db-sb-row';
  bar.appendChild(row);

  /* B / I / S */
  var bBtn = _mkBtn('Bold',          '<b style="font-size:13px">B</b>');
  var iBtn = _mkBtn('Italic',        '<i style="font-size:13px">I</i>');
  var sBtn = _mkBtn('Strikethrough', '<s style="font-size:13px">S</s>');
  bBtn.addEventListener('mousedown', function(e) { e.preventDefault(); document.execCommand('bold'); });
  iBtn.addEventListener('mousedown', function(e) { e.preventDefault(); document.execCommand('italic'); });
  sBtn.addEventListener('mousedown', function(e) { e.preventDefault(); document.execCommand('strikeThrough'); });
  row.appendChild(bBtn); row.appendChild(iBtn); row.appendChild(sBtn);
  row.appendChild(_sep());

  /* Highlight flyout toggle */
  var hlFlyout = document.createElement('div');
  hlFlyout.className = 'db-sb-flyout';
  var hlBtn = _mkBtn('Highlight color',
    '<span style="font-size:14px;border-bottom:3px solid #fef08a;line-height:1">A</span>');
  hlBtn.addEventListener('mousedown', function(e) {
    e.preventDefault();
    var open = hlFlyout.classList.contains('open');
    tcFlyout.classList.remove('open');
    hlFlyout.classList.toggle('open', !open);
  });
  row.appendChild(hlBtn);

  /* Text color flyout toggle */
  var tcFlyout = document.createElement('div');
  tcFlyout.className = 'db-sb-flyout';
  var tcBtn = _mkBtn('Text color',
    '<span style="font-size:14px;border-bottom:3px solid #3b82f6;line-height:1">A</span>');
  tcBtn.addEventListener('mousedown', function(e) {
    e.preventDefault();
    var open = tcFlyout.classList.contains('open');
    hlFlyout.classList.remove('open');
    tcFlyout.classList.toggle('open', !open);
  });
  row.appendChild(tcBtn);
  row.appendChild(_sep());

  /* A+ / A- size buttons */
  var szUpBtn = _mkBtn('Increase size', '<span style="font-size:13px">A<sup>+</sup></span>');
  var szDnBtn = _mkBtn('Decrease size', '<span style="font-size:11px">A<sub>-</sub></span>');
  szUpBtn.addEventListener('mousedown', function(e) { e.preventDefault(); _dbChangeSizeStep(+2); });
  szDnBtn.addEventListener('mousedown', function(e) { e.preventDefault(); _dbChangeSizeStep(-2); });
  row.appendChild(szUpBtn); row.appendChild(szDnBtn);

  /* Link row — shown only when selection is inside / on an <a> */
  var linkRow = document.createElement('div');
  linkRow.className = 'db-sb-row';
  linkRow.style.display = 'none';
  linkRow.style.borderTop = '1px solid';

  var _linkAnchor = null;   // captured on each selectionchange

  var lkOpenBtn = _mkBtn('Open link', '&#128279; Open link');
  lkOpenBtn.style.width = 'auto';
  lkOpenBtn.style.padding = '0 8px';
  lkOpenBtn.style.fontSize = '12px';
  lkOpenBtn.addEventListener('mousedown', function(e) {
    e.preventDefault();
    if (_linkAnchor) window.open(_linkAnchor.href, '_blank', 'noopener,noreferrer');
  });

  var lkRemBtn = _mkBtn('Remove link', '&#10005; Remove link');
  lkRemBtn.style.width = 'auto';
  lkRemBtn.style.padding = '0 8px';
  lkRemBtn.style.fontSize = '12px';
  lkRemBtn.style.color = '#ea1100';
  lkRemBtn.addEventListener('mousedown', function(e) {
    e.preventDefault();
    if (!_linkAnchor) return;
    /* Unwrap: replace the <a> with its children in the DOM */
    var parent = _linkAnchor.parentNode;
    while (_linkAnchor.firstChild) parent.insertBefore(_linkAnchor.firstChild, _linkAnchor);
    parent.removeChild(_linkAnchor);
    _linkAnchor = null;
    linkRow.style.display = 'none';
    /* Trigger autosave */
    var noteEl = document.querySelector('[data-db-note]');
    if (noteEl) noteEl.dispatchEvent(new Event('input', { bubbles: true }));
  });

  linkRow.appendChild(lkOpenBtn);
  linkRow.appendChild(lkRemBtn);
  bar.appendChild(linkRow);

  /* ---- build flyout swatches ---- */
  function _buildSwatches(flyout, palette, applyFn) {
    palette.forEach(function(item) {
      var sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'db-sb-swatch';
      sw.title = item.label;
      if (item.color) {
        sw.style.background = item.color;
      } else {
        sw.style.background = '#f3f4f6';
        sw.style.backgroundImage = 'repeating-linear-gradient(135deg,#e5e7eb 0 2px,transparent 0 8px)';
        sw.style.border = '2px solid #d1d5db';
      }
      sw.addEventListener('mousedown', function(e) {
        e.preventDefault();
        applyFn(item.color);
        hlFlyout.classList.remove('open');
        tcFlyout.classList.remove('open');
      });
      flyout.appendChild(sw);
    });
  }

  _buildSwatches(hlFlyout, HL_COLORS, function(c) {
    document.execCommand('hiliteColor', false, c || 'transparent');
  });
  _buildSwatches(tcFlyout, TC_COLORS, function(c) {
    if (c) document.execCommand('foreColor', false, c);
    else   document.execCommand('removeFormat');
  });

  bar.appendChild(hlFlyout);
  bar.appendChild(tcFlyout);
  document.body.appendChild(bar);
  _dbSelBar = bar;

  /* ---- show / hide on selectionchange ---- */
  document.addEventListener('selectionchange', function() {
    if (_dbSelBarTimer) clearTimeout(_dbSelBarTimer);
    _dbSelBarTimer = setTimeout(function() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        _dbSelBar.style.display = 'none';
        hlFlyout.classList.remove('open');
        tcFlyout.classList.remove('open');
        linkRow.style.display = 'none';
        return;
      }
      /* Only show inside a [data-db-note] element */
      var anchor = sel.anchorNode;
      var el = anchor && anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
      var noteContainer = null;
      while (el) {
        if (el.dataset && el.dataset.dbNote) { noteContainer = el; break; }
        el = el.parentElement;
      }
      if (!noteContainer) { _dbSelBar.style.display = 'none'; return; }

      /* Detect if selection is inside an <a> element — show link row */
      _linkAnchor = null;
      var checkEl = sel.getRangeAt(0).commonAncestorContainer;
      if (checkEl && checkEl.nodeType === Node.TEXT_NODE) checkEl = checkEl.parentElement;
      while (checkEl && checkEl !== noteContainer) {
        if (checkEl.tagName === 'A' && checkEl.href) { _linkAnchor = checkEl; break; }
        checkEl = checkEl.parentElement;
      }
      linkRow.style.display  = _linkAnchor ? 'flex' : 'none';
      linkRow.style.borderTopColor = dark() ? '#3f3f46' : '#e5e7eb';

      _theme(bar);
      bar.style.border = dark() ? '1px solid #3f3f46' : '1px solid #e5e7eb';
      [hlFlyout, tcFlyout].forEach(function(f) {
        f.style.borderTopColor = dark() ? '#3f3f46' : '#e5e7eb';
        f.style.background     = dark() ? '#18181b' : '#ffffff';
      });
      bar.querySelectorAll('.db-sb-sep').forEach(function(s) {
        s.style.background = dark() ? 'rgba(255,255,255,.15)' : 'rgba(0,0,0,.12)';
      });

      _dbSelBar.style.display = 'flex';
      var r   = sel.getRangeAt(0).getBoundingClientRect();
      var bw  = _dbSelBar.offsetWidth  || 240;
      var bh  = _dbSelBar.offsetHeight || 40;
      var left = Math.max(4, Math.min(r.left + r.width / 2 - bw / 2, window.innerWidth - bw - 4));
      var top  = r.top - bh - 8;
      if (top < 4) top = r.bottom + 8;
      _dbSelBar.style.left = left + 'px';
      _dbSelBar.style.top  = top  + 'px';
    }, 80);
  });
}

/**
 * Step the font size of the current CE selection up or down by `delta` px.
 * Mirrors note_form.html’s _changeSizeStep but CE-only (DB notes are always CE).
 */
function _dbChangeSizeStep(delta) {
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;

  /* Walk up from anchor to find an existing size span */
  var node = sel.anchorNode;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  var sizeSpan = null;
  var ce = node;
  while (ce && !ce.dataset.dbNote) ce = ce.parentElement;
  var cur = node;
  while (cur && cur !== ce) {
    if (cur.nodeName === 'SPAN' && cur.style && cur.style.fontSize) { sizeSpan = cur; break; }
    cur = cur.parentElement;
  }

  var currentPx = parseFloat(getComputedStyle(node).fontSize) || 14;
  var newPx     = Math.max(10, Math.min(96, currentPx + delta));

  var targetSpan;
  if (sizeSpan) {
    sizeSpan.style.fontSize = newPx + 'px';
    targetSpan = sizeSpan;
  } else {
    var range = sel.getRangeAt(0);
    targetSpan = document.createElement('span');
    targetSpan.style.fontSize = newPx + 'px';
    try {
      range.surroundContents(targetSpan);
    } catch (_) {
      targetSpan.appendChild(range.extractContents());
      range.insertNode(targetSpan);
    }
  }

  /* Re-select so further A+/A- steps keep working */
  sel.removeAllRanges();
  var nr = document.createRange();
  nr.selectNodeContents(targetSpan);
  sel.addRange(nr);
  if (ce) ce.dispatchEvent(new Event('input'));
}

/* ─── Built-in syntax tokenizer — no CDN dependency ─────────────────────
   Produces <span class="hljs-*"> HTML matching the inline CSS colour palette.
   _dbApplyHljs calls this whenever the CDN highlight.js is unavailable.
──────────────────────────────────────────────────────────────────────── */
var _DB_LANG_DEFS = (function(){
  var w=function(s){return new Set(s.split(/\s+/).filter(Boolean));};
  return {
    vbnet:{lc:"'",str:['"'],
      kw:w('AddHandler AddressOf And AndAlso As Boolean ByRef Byte ByVal Call Case Catch CBool CByte CChar CDate CDbl CDec CInt CLng CObj CSByte CShort CSng CStr CType CUInt CULng CUShort Class Const Continue Decimal Declare Default Delegate Dim DirectCast Do Double Each Else ElseIf End Enum Erase Error Event Exit False Finally For Friend Function Get GetType Global GoTo Handles If Implements Imports In Inherits Integer Interface Is IsNot Let Lib Like Long Loop Me Mid Module MustInherit MustOverride MyBase MyClass Namespace Narrowing New Next Not Nothing NotInheritable NotOverridable Object Of On Operator Option Optional Or OrElse Out Overloads Overridable Overrides ParamArray Partial Private Property Protected Public RaiseEvent ReadOnly ReDim RemoveHandler Resume Return SByte Select Set Shadows Shared Short Single Static Step Stop String Structure Sub SyncLock Then Throw To True Try TryCast TypeOf UInteger ULong UShort Using When While Widening With WithEvents WriteOnly Xor'),
      bi:w('MsgBox InputBox Len Left Right Mid UCase LCase Trim CStr CInt CDbl CBool Format Val IsNumeric IsNull IsEmpty Now Today DateAdd Print Console')},
    python:{lc:'#',tc:['"""',"'''"],str:['"',"'"],
      kw:w('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'),
      bi:w('abs all any bin bool bytes callable chr complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip')},
    javascript:{lc:'//',bc:['/*','*/'],str:['"',"'",'`'],
      kw:w('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await'),
      bi:w('Array Boolean Date Error Function JSON Math Number Object Promise RegExp String Symbol console document window undefined null true false NaN Infinity parseInt parseFloat isNaN isFinite')},
    shell:{lc:'#',str:['"',"'"],kw:w('if then else elif fi for while do done case esac function in return export unset local readonly declare')},
    sql:{lc:'--',bc:['/*','*/'],str:["'",'"'],
      kw:w('SELECT INSERT UPDATE DELETE CREATE DROP ALTER TABLE FROM WHERE AND OR NOT IN EXISTS BETWEEN LIKE IS NULL GROUP BY HAVING ORDER LIMIT OFFSET JOIN LEFT RIGHT INNER OUTER FULL CROSS ON AS DISTINCT ALL UNION INTERSECT EXCEPT WITH RECURSIVE INDEX VIEW TRIGGER PROCEDURE FUNCTION DATABASE SCHEMA GRANT REVOKE COMMIT ROLLBACK TRANSACTION BEGIN END CASE WHEN THEN ELSE CAST CONVERT SET INTO VALUES DEFAULT RETURNS DECLARE EXEC EXECUTE'),
      bi:w('COUNT SUM AVG MIN MAX COALESCE NULLIF UPPER LOWER TRIM SUBSTR SUBSTRING LEN LENGTH REPLACE NOW GETDATE CURRENT_TIMESTAMP DATEADD DATEDIFF YEAR MONTH DAY ISNULL IFNULL NVL ROW_NUMBER RANK DENSE_RANK OVER PARTITION')},
    yaml:{lc:'#',str:['"',"'"],kw:w('true false null yes no on off')},
    json:{str:['"'],kw:w('true false null')},
    dockerfile:{lc:'#',str:['"',"'"],kw:w('FROM RUN CMD COPY ADD EXPOSE WORKDIR ENV LABEL ARG ENTRYPOINT VOLUME USER ONBUILD STOPSIGNAL HEALTHCHECK SHELL MAINTAINER')},
    powershell:{lc:'#',bc:['<#','#>'],str:['"',"'"],
      kw:w('if else elseif switch foreach for while do until break continue return function param begin process end filter class try catch finally throw exit where in'),
      bi:w('Write-Host Write-Output Write-Error Write-Warning Get-Item Set-Item Get-Content Set-Content Get-Process Stop-Process Get-Service Start-Service Stop-Service Get-ChildItem Remove-Item Copy-Item Move-Item New-Item Invoke-Command Invoke-Expression ForEach-Object Where-Object Select-Object Sort-Object Group-Object Import-Module')},
  };
})();

function _dbEsc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function _dbSpan(c,s){return '<span class="hljs-'+c+'">'+_dbEsc(s)+'</span>';}

function _dbTokenize(src,lang){
  if(lang==='html')return _dbTokHtml(src);
  var def=_DB_LANG_DEFS[lang];
  if(!def)return _dbEsc(src);
  var out='',i=0,n=src.length,m,j,tok;
  while(i<n){
    var rest=src.slice(i),ch=src[i];
    /* block comment */
    if(def.bc&&rest.startsWith(def.bc[0])){
      j=src.indexOf(def.bc[1],i+def.bc[0].length);if(j<0)j=n-def.bc[1].length;
      out+=_dbSpan('comment',src.slice(i,j+def.bc[1].length));i=j+def.bc[1].length;continue;
    }
    /* line comment */
    if(def.lc&&rest.startsWith(def.lc)){
      j=src.indexOf('\n',i);tok=j<0?src.slice(i):src.slice(i,j);
      out+=_dbSpan('comment',tok);i+=tok.length;continue;
    }
    /* triple-quoted strings (Python) */
    if(def.tc){var th=false;
      for(var t=0;t<def.tc.length;t++){var tq=def.tc[t];
        if(rest.startsWith(tq)){j=src.indexOf(tq,i+tq.length);if(j<0)j=n-tq.length;
          out+=_dbSpan('string',src.slice(i,j+tq.length));i=j+tq.length;th=true;break;}
      } if(th)continue;
    }
    /* string literals */
    if(def.str&&def.str.indexOf(ch)>=0){
      j=i+1;
      while(j<n){if(src[j]==='\\'){j+=2;continue;}if(src[j]===ch){j++;break;}if(src[j]==='\n'&&ch!=='`')break;j++;}
      out+=_dbSpan('string',src.slice(i,j));i=j;continue;
    }
    /* $variable sigil (PowerShell / shell) */
    if(ch==='$'){m=rest.match(/^\$\w+/);if(m){out+=_dbSpan('variable',m[0]);i+=m[0].length;continue;}}
    /* number */
    if(/\d/.test(ch)&&(i===0||!/[A-Za-z_$]/.test(src[i-1]))){
      m=rest.match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if(m){out+=_dbSpan('number',m[0]);i+=m[0].length;continue;}
    }
    /* identifier / keyword / built-in */
    if(/[A-Za-z_]/.test(ch)){
      m=rest.match(/^[A-Za-z_][\w]*(?:-[A-Za-z]\w*)*/);
      if(m){var word=m[0];
        /* YAML key: word immediately followed by ':' */
        if(lang==='yaml'&&/^\s*:/.test(src.slice(i+word.length))){
          out+=_dbSpan('attr',word);i+=word.length;continue;
        }
        var ks=[word,word.toUpperCase(),word.toLowerCase(),word[0].toUpperCase()+word.slice(1).toLowerCase()];
        var isKw=def.kw&&ks.some(function(k){return def.kw.has(k);});
        var isBi=def.bi&&ks.some(function(k){return def.bi.has(k);});
        if(isKw)out+=_dbSpan('keyword',word);
        else if(isBi)out+=_dbSpan('built_in',word);
        else out+=_dbEsc(word);
        i+=word.length;continue;
      }
    }
    out+=_dbEsc(ch);i++;
  }
  return out;
}

function _dbTokHtml(src){
  var out='',i=0,n=src.length;
  while(i<n){
    if(src.slice(i,i+4)==='<!--'){var e=src.indexOf('-->',i+4);if(e<0)e=n-3;out+=_dbSpan('comment',src.slice(i,e+3));i=e+3;continue;}
    if(src[i]==='<'){
      var j=i+1,inQ=false,qCh='';
      while(j<n){if(inQ){if(src[j]===qCh)inQ=false;}else if(src[j]=='"'||src[j]==="'"){inQ=true;qCh=src[j];}else if(src[j]==='>'){j++;break;}j++;}
      out+=_dbTokHtmlTag(src.slice(i,j));i=j;continue;
    }
    out+=_dbEsc(src[i]);i++;
  }
  return out;
}

function _dbTokHtmlTag(tag){
  var out='',i=1,n=tag.length;
  out+=_dbEsc('<');
  if(i<n&&(tag[i]==='/'||tag[i]==='!')){out+=_dbEsc(tag[i]);i++;}
  var nm='';while(i<n&&/[A-Za-z0-9:-]/.test(tag[i])){nm+=tag[i];i++;}
  if(nm)out+=_dbSpan('name',nm);
  while(i<n&&tag[i]!=='>'){
    if(/\s/.test(tag[i])||tag[i]==='/'){out+=_dbEsc(tag[i]);i++;continue;}
    var an='';while(i<n&&/[A-Za-z0-9_:-]/.test(tag[i])){an+=tag[i];i++;}
    if(!an){out+=_dbEsc(tag[i]);i++;continue;}
    var ws='';while(i<n&&tag[i]===' '){ws+=tag[i];i++;}
    if(i<n&&tag[i]==='='){
      out+=_dbSpan('attr',an)+_dbEsc(ws)+'=';i++;
      var vws='';while(i<n&&tag[i]===' '){vws+=tag[i];i++;}
      if(i<n&&(tag[i]=='"'||tag[i]==="'")){
        var q=tag[i],vs=i;i++;while(i<n&&tag[i]!==q)i++;if(i<n)i++;
        out+=_dbEsc(vws)+_dbSpan('string',tag.slice(vs,i));
      }else{var vs2=i;while(i<n&&!/[\s>]/.test(tag[i]))i++;out+=_dbEsc(vws)+_dbSpan('number',tag.slice(vs2,i));}
    }else{out+=_dbSpan('attr',an)+_dbEsc(ws);}
  }
  if(i<n&&tag[i]==='>') out+=_dbEsc('>');
  return out;
}

/**
 * Detect language for a <code> element without running hljs.
 * Returns a label string (e.g. 'yaml', 'python') or '' if unknown.
 */
var _DB_HLJS_NOISE = new Set(['plaintext', 'undefined', 'txt', 'text', '']);
function _dbDetectLang(code) {
  /* 1) From existing class hint left by slash command or previous save */
  var langCls = Array.prototype.find.call(code.classList, function(c) {
    return c.startsWith('language-') && !_DB_HLJS_NOISE.has(c.replace('language-', ''));
  });
  if (langCls) return langCls.replace('language-', '');

  /* 2) Heuristic content scan — ordered most-specific first to avoid false positives */
  var raw = (code.textContent || '').trimStart();
  if (!raw) return '';

  /* Visual Basic / VB.NET — Dim...As and End Sub/Function are unique to VB */
  if (/\b(Dim\s+\w+\s+As\b|End\s+(?:Sub|Function|Class|If|Module)\b|Public\s+Sub\b|Private\s+Sub\b)/i.test(raw))
    return 'vbnet';

  /* Dockerfile — uppercase instruction verbs at line start */
  if (/^(FROM |RUN |CMD[\s\[\{]|COPY |EXPOSE |WORKDIR |ENTRYPOINT |ENV |LABEL |ARG )/m.test(raw))
    return 'dockerfile';

  /* PowerShell — cmdlet-verb pattern + $ sigil required */
  if (/\$/.test(raw) &&
      /^(\$\w+\s*=|Write-(?:Host|Output|Error|Warning)|Get-\w+|Set-\w+|param\s*\(|\[CmdletBinding\])/m.test(raw))
    return 'powershell';

  /* Python — def/class with colon, import patterns */
  if (/^(def |async def |class \w+.*:|import |from .* import|if __name__|@\w+)/m.test(raw))
    return 'python';

  /* JavaScript / TypeScript */
  if (/\b(function[\s(]|var\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|=>\s*[{(]|require\s*\(|export\s+default|export\s+function|import\s+\w+\s+from)/.test(raw))
    return 'javascript';

  /* Shell — common CLI commands at line start */
  if (/^(cd |ls |mkdir |echo |export |git |npm |pip |uv |python |node |curl |wget |set |rmdir |del |copy |move |touch |chmod |chown |sudo |docker |kubectl |bash |sh )/i.test(raw))
    return 'shell';

  /* SQL */
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|WITH|FROM)\b/i.test(raw)) return 'sql';

  /* HTML / XML */
  if (/^\s*<[a-zA-Z]/.test(raw)) return 'html';

  /* YAML — any file with 2+ key: lines that isn't JSON */
  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    var yKeys = (raw.match(/^\s*[\w.-]+\s*:/mg) || []).length;
    if (yKeys >= 2) return 'yaml';
  }

  /* JSON */
  if (/^\s*[\[{]/.test(raw) && /"[^"]+"\s*:/.test(raw)) return 'json';

  return '';
}

/**
 * Inject (or refresh) the language + copy header bar inside a <pre>.
 * Idempotent — removes stale header first.
 */
function _dbInjectCodeHeader(pre, lang) {
  /* Remove any stale header */
  var old = pre.querySelector('.db-code-hdr');
  if (old) old.remove();

  var code = pre.querySelector('code');
  var hasContent = code && code.textContent.trim().length > 0;

  /* Mark content presence on pre (controls header visibility via CSS) */
  if (hasContent) pre.setAttribute('data-has-content', '1');
  else            pre.removeAttribute('data-has-content');

  /* Build header */
  var hdr = document.createElement('div');
  hdr.className = 'db-code-hdr';
  hdr.setAttribute('contenteditable', 'false');
  hdr.setAttribute('data-db-transient', '1');

  /* Language label */
  var lbl = document.createElement('span');
  lbl.className = 'db-code-hdr-lang';
  lbl.textContent = lang || '\u00a0';  /* nbsp keeps row height when no lang */
  hdr.appendChild(lbl);

  /* Copy button — only when there’s content */
  if (hasContent) {
    var lnBtn = document.createElement('button');
    lnBtn.type = 'button';
    lnBtn.className = 'db-code-hdr-ln' + (pre.dataset.lineNums ? ' active' : '');
    lnBtn.title = 'Toggle line numbers';
    lnBtn.setAttribute('aria-label', 'Toggle line numbers');
    lnBtn.textContent = '123';
    lnBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
    lnBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      _dbToggleLineNums(pre);
    });
    hdr.appendChild(lnBtn);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'db-code-hdr-copy';
    btn.title = 'Copy code';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"'
      + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>'
      + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
      + '</svg><span class="db-code-hdr-copy-txt">Copy</span>';
    btn.addEventListener('mousedown', function(e) {
      /* Prevent focus leaving the code element so focusout doesn't
         re-render the header mid-click, detaching the button before
         the click event fires.                                        */
      e.preventDefault();
    });
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var text = code ? code.textContent : '';
      if (!text.trim()) return;
      navigator.clipboard.writeText(text).then(function() {
        btn.classList.add('copied');
        btn.querySelector('.db-code-hdr-copy-txt').textContent = 'Copied!';
        setTimeout(function() {
          btn.classList.remove('copied');
          btn.querySelector('.db-code-hdr-copy-txt').textContent = 'Copy';
        }, 2000);
      }).catch(function() {
        /* Fallback for non-https or blocked clipboard API */
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          btn.classList.add('copied');
          btn.querySelector('.db-code-hdr-copy-txt').textContent = 'Copied!';
          setTimeout(function() {
            btn.classList.remove('copied');
            btn.querySelector('.db-code-hdr-copy-txt').textContent = 'Copy';
          }, 2000);
        } catch (_) {}
      });
    });
    hdr.appendChild(btn);
  }

  /* Insert as first child of pre (before <code>) */
  pre.insertBefore(hdr, pre.firstChild);
}

/**
 * Run hljs on a <code> element, detect language, inject the UI header bar,
 * and lock the <pre> wrapper against direct editing.
 */
function _dbApplyHljs(code) {
  if (!code) return;
  var pre = code.parentElement;

  /* Step 1: exit editing-host mode unconditionally ─────────────────────────
     Must happen before any DOM mutation.  While contenteditable is set,
     Chrome can fight back against textContent/innerHTML writes.           */
  code.removeAttribute('contenteditable');

  /* Step 2: normalise <br> / block-level junk Chrome inserts ───────────────
     When contenteditable="true" is active and the user presses Enter,
     Chrome inserts a <br> element rather than a literal \n text node.
     textContent silently skips <br> elements, so without this step every
     newline in multi-line code vanishes and the block collapses to one line.
     The same pass catches <div>/<p> wrappers from older-Chrome rich-edit
     fallback behaviour.                                                    */
  Array.prototype.slice.call(code.querySelectorAll('br')).forEach(function(br) {
    br.parentNode.insertBefore(document.createTextNode('\n'), br);
    br.parentNode.removeChild(br);
  });
  Array.prototype.slice.call(code.querySelectorAll('div,p')).forEach(function(blk) {
    blk.parentNode.insertBefore(document.createTextNode('\n'), blk);
    while (blk.firstChild) blk.parentNode.insertBefore(blk.firstChild, blk);
    blk.parentNode.removeChild(blk);
  });

  /* Step 3: detect language on now-clean textContent ───────────────────── */
  var lang = _dbDetectLang(code);

  /* Step 4: highlight ───────────────────────────────────────────────────── */
  if (typeof hljs !== 'undefined' && code.textContent.trim()) {
    /* contenteditable already removed in Step 1 */
    if (lang && !code.classList.contains('language-' + lang)) {
      code.classList.add('language-' + lang);
    }
    /* hljs v11 bails immediately when data-highlighted="yes" is present —
       it assumes the element is already done and skips tokenisation entirely.
       Strip it unconditionally here so every _dbApplyHljs call always runs
       a fresh highlight pass, whether this is first-time or a re-highlight
       after stripping stale spans on reopen.                               */
    code.removeAttribute('data-highlighted');
    try { hljs.highlightElement(code); } catch (_) {}
    var hljsCls = Array.prototype.find.call(code.classList, function(c) {
      return c.startsWith('language-') && !_DB_HLJS_NOISE.has(c.replace('language-', ''));
    });
    if (hljsCls) lang = hljsCls.replace('language-', '');
  } else if (code.textContent.trim()) {
    /* contenteditable already removed in Step 1 */
    code.innerHTML = _dbTokenize(code.textContent, lang);
  }

  if (pre && pre.tagName === 'PRE') {
    _dbInjectCodeHeader(pre, lang);
    _dbApplyLineNums(pre);
    pre.contentEditable = 'false';
  }
  code.spellcheck = false;
}

/**
 * Inject (or refresh) the line-number gutter inside a <pre>.
 * Reads line count from code.textContent. Idempotent.
 * The gutter element is transient (stripped on save); data-line-nums on <pre>
 * is the persistent flag that triggers re-injection on every _dbApplyHljs call.
 */
function _dbApplyLineNums(pre) {
  var old = pre.querySelector('.db-line-nums');
  if (old) old.remove();
  if (!pre.dataset.lineNums) return;
  var code = pre.querySelector('code');
  if (!code || !code.textContent.trim()) return;
  var lines = code.textContent.split('\n');
  /* Drop single trailing empty line that appears when saved HTML ends with \n */
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  var gutter = document.createElement('span');
  gutter.className = 'db-line-nums';
  gutter.setAttribute('contenteditable', 'false');
  gutter.setAttribute('data-db-transient', '1');
  gutter.setAttribute('aria-hidden', 'true');
  var html = '';
  for (var i = 1; i <= lines.length; i++) html += '<span>' + i + '</span>';
  gutter.innerHTML = html;
  pre.insertBefore(gutter, code);
}

/**
 * Toggle line numbers on/off for one code block.
 * Persists choice as data-line-nums on <pre> (saved with note HTML),
 * refreshes the gutter, syncs the toggle button state, and fires an
 * input event so the debounced auto-save picks up the change.
 */
function _dbToggleLineNums(pre) {
  if (pre.dataset.lineNums) pre.removeAttribute('data-line-nums');
  else pre.dataset.lineNums = '1';
  _dbApplyLineNums(pre);
  var btn = pre.querySelector('.db-code-hdr-ln');
  if (btn) {
    if (pre.dataset.lineNums) btn.classList.add('active');
    else btn.classList.remove('active');
  }
  var noteEl = pre.closest('[data-db-note]');
  if (noteEl) noteEl.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Serialise noteEl to a clean HTML string suitable for saving.
 * Strips all transient elements (header bars) injected by _dbInjectCodeHeader.
 */
function _dbNoteHtml(el) {
  var clone = el.cloneNode(true);
  clone.querySelectorAll('[data-db-transient]').forEach(function(n) { n.remove(); });
  /* Strip editing attributes from pre/code — Chrome normalises away nested
     <span> elements when it parses saved HTML that has contenteditable on <code>.
     These attrs are re-applied fresh on every load by _dbAttachNoteTools. */
  clone.querySelectorAll('pre').forEach(function(pre) {
    pre.removeAttribute('contenteditable');
    var code = pre.querySelector('code');
    if (code) {
      code.removeAttribute('contenteditable');
      code.removeAttribute('spellcheck');
      /* data-highlighted is a hljs v11 guard that prevents re-highlighting.
         Strip it from saved HTML so reopening the detail panel always gets
         a clean re-highlight pass from _dbApplyHljs on the next load.    */
      code.removeAttribute('data-highlighted');
    }
  });
  return clone.innerHTML;
}

/* ═══════════════════════════════════════════════════════════════════════════
   DB NOTE — BLOCK GRIP DnD + CLICK-FOR-MENU
═══════════════════════════════════════════════════════════════════════════ */

function _dbAddGrip(el) {
  el.style.position = 'relative';
  var grip = document.createElement('span');
  grip.setAttribute('data-db-grip', '');
  grip.setAttribute('data-db-transient', '');  /* stripped by _dbNoteHtml — never saved */
  grip.setAttribute('contenteditable', 'false');
  grip.setAttribute('aria-hidden', 'true');
  grip.textContent = '⢿';
  grip.style.cssText =
    'position:absolute;left:-1.6rem;top:50%;transform:translateY(-50%);'
    + 'width:1.4rem;text-align:center;cursor:grab;pointer-events:auto;'
    + 'color:#d1d5db;font-size:.9rem;line-height:1;user-select:none;'
    + 'opacity:0;transition:opacity .12s,color .12s;border-radius:3px;';
  el.insertBefore(grip, el.firstChild);
  if (!el._dbGripListened) {
    el._dbGripListened = true;
    el.addEventListener('mouseenter',  _dbGripEnter);
    el.addEventListener('mouseleave',  _dbGripLeave);
    el.addEventListener('mousedown',   _dbGripDown, { capture: true });
  }
}

function _dbInjectGrips(noteEl) {
  noteEl.querySelectorAll('[data-db-grip]').forEach(function(g) { g.remove(); });
  Array.prototype.forEach.call(noteEl.children, function(el) { _dbAddGrip(el); });
  /* Also grip individual list items so they can be reordered within their list */
  noteEl.querySelectorAll('li').forEach(function(li) { _dbAddGrip(li); });
}

function _dbGripEnter(e) {
  var grip = e.currentTarget.querySelector('[data-db-grip]');
  if (grip) { grip.style.opacity = '1'; grip.style.color = '#9ca3af'; }
}
function _dbGripLeave(e) {
  if (_dbGripDragging) return;   /* don't fade while dragging */
  var grip = e.currentTarget.querySelector('[data-db-grip]');
  if (grip) { grip.style.opacity = '0'; grip.style.color = '#d1d5db'; }
}

function _dbGripDown(e) {
  if (e.button !== 0) return;
  if (!e.target.hasAttribute('data-db-grip')) return;  /* only the grip span itself */
  e.stopPropagation();
  var noteEl = e.currentTarget.closest('[data-db-note]');
  _dbGripNoteEl    = noteEl;
  _dbGripDragging  = e.currentTarget;   /* the parent block element */
  _dbGripContainer = e.currentTarget.parentElement;
  _dbGripStartY    = e.clientY;
  _dbGripDidDrag   = false;
  document.addEventListener('mousemove', _dbGripMove);
  document.addEventListener('mouseup',   _dbGripUp);
}

function _dbGripMove(e) {
  if (!_dbGripDragging) return;

  if (!_dbGripDidDrag && Math.abs(e.clientY - _dbGripStartY) > 4) {
    _dbGripDidDrag = true;
    document.body.style.userSelect = 'none';

    /* Ghost label */
    _dbGripGhost = document.createElement('div');
    _dbGripGhost.textContent = (_dbGripDragging.textContent || '').trim().slice(0, 80) || '(empty)';
    _dbGripGhost.style.cssText =
      'position:fixed;z-index:9999;pointer-events:none;opacity:.9;'
      + 'background:#eff6ff;border:1px solid #0053e2;border-radius:4px;'
      + 'padding:3px 10px;font-size:.8rem;white-space:nowrap;overflow:hidden;'
      + 'text-overflow:ellipsis;max-width:360px;'
      + 'box-shadow:0 4px 12px rgba(0,83,226,.2);';
    document.body.appendChild(_dbGripGhost);
    _dbGripDragging.style.opacity = '0.3';

    /* Drop indicator line */
    _dbGripIndicator = document.createElement('div');
    _dbGripIndicator.style.cssText =
      'position:fixed;height:2px;background:#0053e2;'
      + 'pointer-events:none;display:none;z-index:9998;';
    document.body.appendChild(_dbGripIndicator);
  }

  if (!_dbGripDidDrag) return;

  _dbGripGhost.style.left = (e.clientX + 14) + 'px';
  _dbGripGhost.style.top  = (e.clientY - 14) + 'px';

  /* Find insert target by scanning all candidates in the note area */
  var cands = [];
  if (_dbGripNoteEl) {
    Array.prototype.forEach.call(_dbGripNoteEl.querySelectorAll(
      ':scope > *:not([data-db-grip])'
    ), function(el) {
      if (el !== _dbGripDragging) cands.push(el);
    });
    _dbGripNoteEl.querySelectorAll('li').forEach(function(li) {
      if (li !== _dbGripDragging) cands.push(li);
    });
  }

  _dbGripInsertBefore = null;
  _dbGripDropParent   = null;
  for (var i = 0; i < cands.length; i++) {
    var r = cands[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { _dbGripInsertBefore = cands[i]; break; }
  }
  if (_dbGripInsertBefore) {
    _dbGripDropParent = _dbGripInsertBefore.parentElement;
  } else if (cands.length) {
    _dbGripDropParent = cands[cands.length - 1].parentElement;
  } else {
    _dbGripDropParent = _dbGripContainer;
  }

  /* Position indicator */
  if (_dbGripIndicator && _dbGripDropParent) {
    var ref = _dbGripInsertBefore || (cands.length ? cands[cands.length - 1] : null);
    if (ref) {
      var rr = ref.getBoundingClientRect();
      var pr = _dbGripDropParent.getBoundingClientRect();
      var y  = _dbGripInsertBefore ? rr.top - 1 : rr.bottom - 1;
      _dbGripIndicator.style.left    = pr.left + 'px';
      _dbGripIndicator.style.width   = pr.width + 'px';
      _dbGripIndicator.style.top     = y + 'px';
      _dbGripIndicator.style.display = 'block';
    }
  }
}

function _dbGripUp() {
  document.removeEventListener('mousemove', _dbGripMove);
  document.removeEventListener('mouseup',   _dbGripUp);
  document.body.style.userSelect = '';
  if (_dbGripGhost)     { _dbGripGhost.remove();     _dbGripGhost = null; }
  if (_dbGripIndicator) { _dbGripIndicator.remove(); _dbGripIndicator = null; }

  var dragging     = _dbGripDragging;
  var noteEl        = _dbGripNoteEl;
  var didDrag       = _dbGripDidDrag;
  var container     = _dbGripContainer;
  var insertBefore  = _dbGripInsertBefore;   /* save BEFORE nulling */
  var dropParent    = _dbGripDropParent;     /* save BEFORE nulling */

  _dbGripDragging = _dbGripContainer = _dbGripNoteEl = null;
  _dbGripInsertBefore = _dbGripDropParent = null;
  _dbGripDidDrag = false;

  if (!dragging) return;
  dragging.style.opacity = '';

  if (didDrag) {
    /* Commit reorder */
    var parent = dropParent || container;
    if (insertBefore && insertBefore.parentElement === parent) {
      parent.insertBefore(dragging, insertBefore);
    } else {
      parent.appendChild(dragging);
    }
    /* Clean up empty lists */
    if (noteEl) {
      noteEl.querySelectorAll('ul,ol').forEach(function(l) {
        if (l.children.length === 0) l.remove();
      });
    }
    /* Persist + re-inject */
    if (noteEl) {
      var cardId = parseInt((noteEl.id || '').replace('db-detail-note-', ''), 10);
      if (cardId) {
        _dbSaveNote(cardId, _dbNoteHtml(noteEl));
        _dbInjectGrips(noteEl);
      }
    }
  } else {
    /* Pure click on grip — open block context menu */
    var gripSpan = dragging.querySelector('[data-db-grip]');
    if (gripSpan && noteEl && typeof window._bwBlockMenu === 'function') {
      var cId = parseInt((noteEl.id || '').replace('db-detail-note-', ''), 10);
      window._bwBlockMenu(gripSpan, dragging, {
        reInjectGrips: function() { if (noteEl) _dbInjectGrips(noteEl); },
        syncToBackend: function() { if (noteEl && cId) _dbSaveNote(cId, _dbNoteHtml(noteEl)); },
        gripAttr: 'data-db-grip',
      });
    }
  }
}

/* ── Tab / Shift+Tab indent for DB card note list items ─────────────────────
   Mirrors _bwCeTab in index.html but targets data-db-note contenteditable divs.
   Returns true if it handled the keydown (caller should return immediately).   */
function _dbNoteTabIndent(e, noteEl) {
  if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return false;

  var sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;

  /* Walk up from cursor to find the <li> containing the caret */
  var li = sel.getRangeAt(0).startContainer;
  while (li && li !== noteEl) {
    if (li.nodeName === 'LI') break;
    li = li.parentNode;
  }
  if (!li || li === noteEl) return false;   /* cursor not in a list item */

  e.preventDefault();
  var parentList = li.parentElement;   /* the <ul> or <ol> the <li> lives in */

  if (!e.shiftKey) {
    /* ── INDENT: nest under the previous sibling <li> ─────────────────────
       If there is no previous sibling we still swallow Tab (return true)
       so the browser doesn't focus the next form field.                   */
    var prevLi = li.previousElementSibling;
    if (!prevLi || prevLi.nodeName !== 'LI') return true;
    /* Re-use existing nested list or create one matching parent type */
    var nested = null;
    Array.prototype.forEach.call(prevLi.children, function(c) {
      if (!nested && (c.nodeName === 'UL' || c.nodeName === 'OL')) nested = c;
    });
    if (!nested) {
      nested = document.createElement(parentList.tagName);  /* same ul/ol type */
      prevLi.appendChild(nested);
    }
    nested.appendChild(li);
  } else {
    /* ── OUTDENT: lift out to the grandparent list ─────────────────────────
       If already at root level swallow Shift+Tab (return true) so the
       browser doesn't focus the previous form field.                       */
    var parentLi    = parentList ? parentList.parentElement : null;
    if (!parentLi || parentLi.nodeName !== 'LI') return true;
    var grandparent = parentLi.parentElement;
    grandparent.insertBefore(li, parentLi.nextSibling);
    if (parentList.children.length === 0) parentList.remove();
  }

  /* Re-inject grips (moved <li> loses its span) + persist */
  _dbInjectGrips(noteEl);
  var cardId = parseInt((noteEl.id || '').replace('db-detail-note-', ''), 10);
  if (cardId) _dbSaveNote(cardId, _dbNoteHtml(noteEl));

  /* Restore cursor to the relocated <li> */
  setTimeout(function() {
    var grip     = li.querySelector('[data-db-grip]');
    var textNode = grip ? grip.nextSibling : li.firstChild;
    if (textNode) {
      var r = document.createRange();
      if (textNode.nodeType === 3 /* TEXT_NODE */) {
        r.setStart(textNode, textNode.length);
        r.collapse(true);
      } else {
        r.selectNodeContents(textNode);
        r.collapse(false);
      }
      sel.removeAllRanges();
      sel.addRange(r);
    }
    noteEl.focus();
  }, 0);

  return true;
}

function _dbAttachNoteTools(noteEl) {
  if (!noteEl) return;
  /* Slash commands — full palette with headings / callouts / columns */
  if (typeof window.bwSlashAttachCE === 'function') window.bwSlashAttachCE(noteEl);
  /* URL paste-as popup */
  if (window.bwPasteAs && typeof window.bwPasteAs.initForCE === 'function') {
    window.bwPasteAs.initForCE(noteEl);
  }
  /* Block grip DnD handles — always re-inject on every panel open */
  _dbInjectGrips(noteEl);

  if (noteEl._dbToolsWired) return;   /* idempotent — only wire DOM handlers once */
  noteEl._dbToolsWired = true;

  /* ── Synchronous: lock every <pre> immediately so the cursor can never land
     in its padding area before the async hljs scan fires.            ── */
  noteEl.querySelectorAll('pre').forEach(function(pre) {
    pre.contentEditable = 'false';
    /* NOTE: do NOT set code.contentEditable here.
       Chrome normalises all HTML children (spans + newlines) of the code
       element the instant contenteditable="plaintext-only" is applied to an
       element that already has child nodes.  The mousedown handler activates
       edit mode by stripping spans FIRST, then safely setting the attribute. */
  });

  /* ── Click on empty space below content — append a paragraph ---- */
  noteEl.addEventListener('click', function(e) {
    /* Link click — open in new tab (must check BEFORE empty-space check) */
    var a = e.target.closest('a[href]');
    if (a) {
      e.preventDefault();
      window.open(a.href, '_blank', 'noopener,noreferrer');
      return;
    }
    /* Only handle clicks directly on the note container itself */
    if (e.target !== noteEl) return;
    /* Reuse the existing trailing empty paragraph instead of appending a new one */
    var last = noteEl.lastElementChild;
    var isEmptyP = last && last.tagName === 'P' &&
                   !last.textContent.trim() &&
                   (last.innerHTML === '<br>' || last.innerHTML === '');
    var target = isEmptyP ? last : null;
    if (!target) {
      target = document.createElement('p');
      target.innerHTML = '<br>';
      noteEl.appendChild(target);
    }
    var r = document.createRange();
    r.setStart(target, 0);
    r.collapse(true);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    noteEl.focus({ preventScroll: true });
  });

  /* ── Paste inside a code block — always plain text, strip background/colours */
  noteEl.addEventListener('paste', function(e) {
    /* e.target is unreliable for nested contenteditable — Chrome often reports
       the outer note div even when the cursor is inside a nested <code>.
       Walk up from the selection's anchor node instead.              */
    var sel = window.getSelection();
    var anchor = sel && sel.anchorNode;
    if (!anchor) return;
    var node = anchor.nodeType === 3 ? anchor.parentElement : anchor;
    var code = (node.tagName === 'CODE') ? node : node.closest('code');
    if (!code) return;
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    /* Normalise CRLF / CR → LF */
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    document.execCommand('insertText', false, text);
  });

  /* ── Ctrl+A inside a code block — select only that block's content ────────── */
  noteEl.addEventListener('keydown', function(e) {
    /* Tab / Shift+Tab on list items — indent / outdent nested bullets */
    if (_dbNoteTabIndent(e, noteEl)) return;

    /* Enter inside an active code block → insert literal \n.
       Without this guard, Chrome inserts a <br> (or <div> in rich-edit
       fallback) which textContent silently skips, so when _dbApplyHljs
       reads the block on blur every newline vanishes → single line.    */
    if (e.key === 'Enter') {
      var sel = window.getSelection();
      if (sel && sel.anchorNode) {
        var eNode = sel.anchorNode.nodeType === 3
          ? sel.anchorNode.parentElement : sel.anchorNode;
        var eCode = (eNode.tagName === 'CODE') ? eNode : eNode.closest('code');
        if (eCode && eCode.contentEditable === 'true') {
          e.preventDefault();
          document.execCommand('insertText', false, '\n');
          return;
        }
      }
      return;  /* Enter outside a code block — let the note handle it */
    }
    if (!((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey))) return;
    var sel = window.getSelection();
    if (!sel || !sel.anchorNode) return;
    var node = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    var code = (node.tagName === 'CODE') ? node : node.closest('code');
    if (!code) return;              /* cursor not in a code block — let default Ctrl+A run */
    e.preventDefault();
    var range = document.createRange();
    range.selectNodeContents(code);
    sel.removeAllRanges();
    sel.addRange(range);
  });

  /* ── Code block: strip hljs on focus, reapply on blur ──────────────────── */
  noteEl.addEventListener('focusin', function(e) {
    var code = e.target.tagName === 'CODE' ? e.target : e.target.closest('code');
    if (!code || !code.closest('[contenteditable]')) return;
    /* Store plain text and strip hljs decoration for clean editing */
    var plain = code.textContent.replace(/\n$/, '');
    var langMatch = (code.className || '').match(/language-(\S+)/);
    var lang = langMatch ? langMatch[1] : '';
    /* Strip decoration from both hljs AND built-in tokenizer spans */
    if (code.classList.contains('hljs') || code.querySelector('.hljs, [class*="hljs-"]')) {
      code.className   = lang ? 'language-' + lang : '';
      code.textContent = plain;
    }
    code.contentEditable = 'true';
    code.spellcheck = false;
  });

  /* ── Code block: click on highlighted block → activate plain-text edit mode ── */
  /* WHY click, not mousedown:
     Calling e.preventDefault() on mousedown was the root cause of three bugs:
     1. The span element gets removed mid-event, Chrome bubbles the subsequent
        click to a stale ancestor (#panel) → detail view closes unexpectedly.
     2. Setting contenteditable during mousedown before Chrome commits its
        rendering cycle triggered editing-host normalisation → multi-line code
        collapsed to one line.
     3. preventDefault blocked proper cursor ownership; mouseup cleared the
        selection set by code.focus() → delete/backspace did nothing.
     Using 'click' instead lets the full mouse-event sequence complete first.
     caretRangeFromPoint is coordinate-based so it still works at click time. */
  noteEl.addEventListener('click', function(e) {
    /* Only fire when the click target is inside a <code> element */
    var node = e.target;
    var code = (node.tagName === 'CODE') ? node : node.closest('code');
    if (!code) return;
    /* Skip if already in edit mode (we set contentEditable='true' on activation) */
    if (code.contentEditable === 'true') return;
    var pre = code.closest('pre');
    if (!pre || pre.contentEditable !== 'false') return;
    /* ── Record click position while spans are still in the DOM ── */
    var charOffset = 0;
    if (document.caretRangeFromPoint) {
      var cr = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (cr && code.contains(cr.startContainer)) {
        var walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, null, false);
        while (walker.nextNode()) {
          var tn = walker.currentNode;
          if (tn === cr.startContainer) { charOffset += cr.startOffset; break; }
          charOffset += tn.textContent.length;
        }
      }
    }
    /* ── Switch to edit mode: strip spans → set contentEditable → focus ── */
    /* No e.preventDefault() — browser completes its event sequence cleanly. */
    var plain = code.textContent;
    code.textContent = plain;      /* strips all span children */
    /* Use contentEditable='true', NOT 'plaintext-only'.
       Chrome normalises the \n character in the text node the instant
       contenteditable="plaintext-only" is set on an element that already
       has child nodes (even just a text node) — converting it to a <br>,
       which textContent then skips, collapsing every newline.           */
    code.contentEditable = 'true';
    code.spellcheck = false;
    code.focus();
    /* Restore cursor at the character offset we computed from the click position */
    var textNode = code.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      var offset = Math.min(charOffset, textNode.length);
      var range = document.createRange();
      range.setStart(textNode, offset);
      range.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  noteEl.addEventListener('focusout', function(e) {
    var code = e.target.tagName === 'CODE' ? e.target : e.target.closest('code');
    if (!code) return;
    /* Defer DOM mutation past the current pointer-event sequence.
       Replacing code.innerHTML synchronously during focusout shifts the DOM;
       the subsequent mouseup/click then lands on #panel (the backdrop) and
       fires _dbCloseDetail() — closing the detail view mid-edit. */
    var capturedCode = code;
    var capturedNote = noteEl;
    setTimeout(function() {
      _dbApplyHljs(capturedCode);
      capturedNote.dispatchEvent(new Event('input', { bubbles: true }));
    }, 0);
  });

  /* ── Initial hljs scan — highlights code blocks already in the loaded note ── */
  setTimeout(function() {
    noteEl.querySelectorAll('pre').forEach(function(pre) {
      var code = pre.querySelector('code');
      if (!code) return;

      /* ―― Corruption recovery ――
         If <code> is empty but <pre> has other children that contain text,
         those are rich-paste debris (spans with colours/backgrounds).
         Salvage their plain text into <code> and remove the garbage nodes. */
      if (!code.textContent.trim()) {
        var salvaged = Array.prototype.filter.call(
          pre.childNodes,
          function(n) { return n !== code; }
        ).map(function(n) { return n.textContent || ''; }).join('');
        salvaged = salvaged.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
        if (salvaged) {
          /* Remove debris nodes */
          Array.prototype.slice.call(pre.childNodes).forEach(function(n) {
            if (n !== code) pre.removeChild(n);
          });
          code.textContent = salvaged;
        }
      }

      /* ―― Strip stale hljs spans first so re-detection is clean ―― */
      var plain = code.textContent.replace(/\n$/, '');
      var langMatch = (code.className || '').match(/language-(\S+)/);
      var lang = langMatch ? langMatch[1] : '';
      if (code.classList.contains('hljs') || code.querySelector('.hljs')) {
        code.className   = lang ? 'language-' + lang : '';
        code.textContent = plain;
        /* data-highlighted is hljs v11's re-highlight guard — must be cleared
           here too so the _dbApplyHljs call below always runs a fresh pass.  */
        code.removeAttribute('data-highlighted');
      }

      _dbApplyHljs(code);
    });
  }, 80);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CARD DETAIL PANEL
═══════════════════════════════════════════════════════════════════════════ */

function _dbOpenDetail(cardId) {
  _dbDetailId = cardId;
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId)
  .then(function(r) {
    if (!r.ok) throw new Error('Card not found');
    return r.json();
  })
  .then(function(card) {
    var idx = _dbCards.findIndex(function(c) { return c.id === cardId; });
    if (idx >= 0) _dbCards[idx] = card;
    _dbRenderDetailPanel(card);
    // Honour the user’s chosen view mode (panel / center / fullscreen)
    if (typeof openPanel === 'function') openPanel(false);
    // Clicking the empty panel area (outside the card content) closes it.
    // Only applies when the panel is a full-viewport flex container (center/fullscreen modes),
    // but attaching in all modes is harmless — a side panel has no empty flex space to click.
    var panelEl = document.getElementById('panel');
    if (panelEl) {
      if (_dbPanelClickHandler) panelEl.removeEventListener('click', _dbPanelClickHandler);
      _dbPanelClickHandler = function(e) {
        // Only fire when the click lands directly on #panel itself, not its children
        if (e.target !== panelEl) return;
        // Don’t close if the user just finished drag-selecting text inside the panel
        if (window.getSelection && window.getSelection().toString().trim()) return;
        _dbCloseDetail();
      };
      panelEl.addEventListener('click', _dbPanelClickHandler);
    }
  })
  .catch(function(e) { _dbToast('Could not open card: ' + e.message, true); });
}

function _dbCloseDetail() {
  _dbDetailId = null;
  // Remove the click-outside listener
  var panelEl = document.getElementById('panel');
  if (panelEl && _dbPanelClickHandler) {
    panelEl.removeEventListener('click', _dbPanelClickHandler);
    _dbPanelClickHandler = null;
  }
  // Reuse the app’s panel close so all three view modes get cleaned up correctly
  if (typeof closePanel === 'function') { closePanel(); return; }
  // Fallback (should never happen)
  var dp = document.getElementById('detail-panel');
  if (dp) dp.innerHTML = '';
}

/* ── attribute helpers ───────────────────────────────────────────────── */

function _dbAttrTypeIcon(t) {
  var def = _DB_ATTR_TYPES.find(function(x) { return x.id === t; });
  return def ? def.icon : '\uD83D\uDCDD';
}

function _dbStatusColor(val) {
  var v = (val || '').toLowerCase();
  if (/done|complete|finished|closed|resolved/.test(v))  return '#2a8703'; // green
  if (/progress|doing|active|open|started/.test(v))      return '#0053e2'; // blue
  if (/block|stuck|problem|error|fail/.test(v))          return '#ea1100'; // red
  if (/review|pending|wait|hold/.test(v))                return '#995213'; // amber
  if (/cancel|skip|void|archive/.test(v))                return '#6b7280'; // gray
  return '#7c3aed'; // purple fallback
}

/** Render the value cell for one attribute row in the detail panel.
 *  Returns an HTML string. Inline styles used for colors — CDN Tailwind
 *  won't generate runtime arbitrary values. */

/* ── number formatting helpers ──────────────────────────────────────── */
function _dbParseNumOpts(optsStr) {
  try {
    var o = JSON.parse(optsStr || '{}');
    return {
      format:   o.format   || 'number',
      decimals: (o.decimals !== undefined) ? parseInt(o.decimals, 10) : 0,
    };
  } catch(e) { return { format: 'number', decimals: 0 }; }
}

function _dbFormatNumber(raw, numOpts) {
  var n = parseFloat(raw);
  if (isNaN(n)) return raw || '';
  var fmt = numOpts.format || 'number';
  var dec = parseInt(numOpts.decimals, 10);
  if (isNaN(dec) || dec < 0) dec = 0;
  if (dec > 5) dec = 5;

  if (fmt === 'btc')        return '\u20bf' + n.toFixed(dec);
  if (fmt === 'percent')    return n.toFixed(dec) + '%';
  if (fmt === 'number')     return n.toFixed(dec);
  if (fmt === 'number_sep') {
    return new Intl.NumberFormat('en-US', {
      style: 'decimal', useGrouping: true,
      minimumFractionDigits: dec, maximumFractionDigits: dec,
    }).format(n);
  }
  var def = _DB_NUM_FORMATS.find(function(f) { return f.id === fmt; });
  if (!def || !def.currency) return n.toFixed(dec);
  // narrowSymbol avoids disambiguation prefixes like "CN¥" or "CA$" — use
  // 'symbol' as fallback for older browsers that don't support narrowSymbol.
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: def.currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: dec, maximumFractionDigits: dec,
    }).format(n);
  } catch(e1) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: def.currency,
        minimumFractionDigits: dec, maximumFractionDigits: dec,
      }).format(n);
    } catch(e2) { return n.toFixed(dec); }
  }
}

/** Called from inline oninput on number inputs inside the detail panel. */
function _dbNumFmtPreview(inp, spanId) {
  var sp = document.getElementById(spanId);
  if (!sp) return;
  var numOpts = {
    format:   inp.getAttribute('data-numfmt') || 'number',
    decimals: parseInt(inp.getAttribute('data-numdec'), 10) || 0,
  };
  sp.textContent = _dbFormatNumber(inp.value, numOpts);
}

/** On focus: swap formatted display → raw number so the user can type. */
function _dbFormatDate(isoStr, fmtId) {
  // Render an ISO date (YYYY-MM-DD) for display using the chosen format.
  if (!isoStr) return '';
  var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoStr);
  if (!p) return isoStr;
  var y = p[1], m = p[2], d = p[3], mi = parseInt(m, 10);
  var MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var ML = ['January','February','March','April','May','June',
            'July','August','September','October','November','December'];
  switch (fmtId) {
    case 'mdy':   return m + '/' + d + '/' + y;
    case 'dmy':   return d + '/' + m + '/' + y;
    case 'ymd':   return isoStr;
    case 'short': return MS[mi - 1] + ' ' + parseInt(d, 10) + ', ' + y;
    case 'long':  return ML[mi - 1] + ' '  + parseInt(d, 10) + ', ' + y;
    default:      return m + '/' + d + '/' + y;
  }
}

function _dbParseUserDate(str) {
  // Parse a user-typed date into YYYY-MM-DD; returns '' if unparseable.
  str = (str || '').trim();
  if (!str) return '';
  var MMAP = {
    jan:1,feb:2,mar:3,apr:4,may:5,jun:6,
    jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
    january:1,february:2,march:3,april:4,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12
  };
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function norm(y, m, d) {
    y = parseInt(y,10); m = parseInt(m,10); d = parseInt(d,10);
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return '';
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  var x;
  // YYYY-MM-DD or YYYY/MM/DD
  x = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/.exec(str);
  if (x) return norm(x[1], x[2], x[3]);
  // M/D/YYYY, M-D-YYYY — if first part > 12 treat as day-first
  x = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/.exec(str);
  if (x) {
    var p1 = parseInt(x[1], 10), p2 = parseInt(x[2], 10);
    return p1 > 12 ? norm(x[3], p2, p1) : norm(x[3], p1, p2);
  }
  // "April 22, 2025" or "Apr 22 2025"
  x = /^([a-zA-Z]+)\s+(\d{1,2})[,\s]+(\d{2,4})$/.exec(str);
  if (x) { var mo = MMAP[x[1].toLowerCase()]; if (mo) return norm(x[3], mo, x[2]); }
  // "22 April 2025" or "22 Apr 2025"
  x = /^(\d{1,2})\s+([a-zA-Z]+)[,\s]+(\d{2,4})$/.exec(str);
  if (x) { var mo2 = MMAP[x[2].toLowerCase()]; if (mo2) return norm(x[3], mo2, x[1]); }
  // Last resort: native Date.parse
  var nd = new Date(str);
  if (!isNaN(nd.getTime())) return nd.toISOString().slice(0, 10);
  return '';
}

function _dbNativeWidgetFocus(el) {
  // Show a visible box when the user interacts with a select/date field.
  var isDark = document.documentElement.classList.contains('dark');
  el.style.background   = isDark ? '#27272a' : '#ffffff';
  el.style.color        = isDark ? '#f4f4f5' : '#111827';
  el.style.border       = '1px solid ' + (isDark ? '#52525b' : '#d1d5db');
  el.style.borderRadius = '0.375rem';
  el.style.padding      = '0.25rem 0.5rem';
}

function _dbNativeWidgetBlur(el) {
  // Revert to invisible resting state.
  el.style.background   = 'transparent';
  el.style.color        = 'inherit';
  el.style.border       = 'none';
  el.style.borderRadius = '';
  el.style.padding      = '';
}

function _dbNumFocus(inp) {
  inp.value = inp.getAttribute('data-rawval') || '';
}

/** On blur: save raw value to server, re-display formatted. */
function _dbNumBlurSave(inp, cardId, attrId, key) {
  var raw  = inp.value.trim();
  inp.setAttribute('data-rawval', raw);
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var meta = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var atype = meta ? (meta.attr_type    || 'number') : 'number';
  var aopts = meta ? (meta.attr_options || '')        : '';
  // immediately show formatted (optimistic)
  var numOpts = _dbParseNumOpts(aopts);
  inp.value = raw ? _dbFormatNumber(raw, numOpts) : '';
  // persist
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attr_key: key, attr_value: raw,
                           attr_type: atype, attr_options: aopts }),
  }).then(function(r) {
    if (!r.ok) throw new Error('save failed');
    if (meta) meta.attr_value = raw;
    _dbRenderGrid();
  }).catch(function(e) { console.warn('Number attr save failed', e); });
}

function _dbAttrValueHtml(cardId, a) {
  var k   = _esc(a.attr_key);   // HTML-safe, used in display contexts
  // kJ: key safe for use inside an HTML attribute that contains JS args.
  // JSON.stringify wraps in double-quotes; _esc turns those into &quot; so
  // the enclosing HTML attribute isn't truncated, then the browser decodes
  // &quot;→" before running the JS — giving a syntactically valid string.
  var kJ  = _esc(JSON.stringify(a.attr_key));
  var v   = a.attr_value || '';
  var t   = a.attr_type  || 'text';
  var cb  = '_dbSaveAttr(' + cardId + ',' + a.id + ',' + kJ + ',this)';

  // color-scheme hint resolved at render time so the OS date-picker
  // and select popup open in the right theme even in resting state.
  var isDark = document.documentElement.classList.contains('dark');
  var inputCs = isDark ? 'dark' : 'light';
  // Resting style: invisible — no border, no bg, just readable text.
  // _dbNativeWidgetFocus / _dbNativeWidgetBlur toggle the box on interaction.
  var restInputStyle =
    'border:none;background:transparent;font-size:0.875rem;color:inherit;'
    + 'outline:none;width:100%;box-sizing:border-box;cursor:pointer;'
    + 'color-scheme:' + inputCs + ';';

  if (t === 'checkbox') {
    var chk = (v === 'true' || v === '1' || v === 'yes') ? 'checked' : '';
    return '<input type="checkbox" ' + chk
      + ' style="width:1rem;height:1rem;cursor:pointer;accent-color:#0053e2;"'
      + ' onchange="_dbSaveAttrCheckbox(' + cardId + ',' + a.id + ',' + kJ + ',this)">';
  }
  if (t === 'date') {
    // attr_options stores the display format ID (e.g. 'mdy', 'long')
    var fmtId  = a.attr_options || 'mdy';
    var dv     = v.slice(0, 10);  // stored as YYYY-MM-DD
    var dShown = dv ? _dbFormatDate(dv, fmtId) : '';
    var pId    = 'dbt-p-' + a.id;
    var fmtJ   = _esc(JSON.stringify(fmtId));
    return (
      '<span style="display:inline-flex;align-items:center;gap:0.3rem;width:100%;">'
      // Typeable text input — accepts many formats, normalises on blur
      + '<input type="text" value="' + _esc(dShown) + '"'
      + ' placeholder="e.g. Apr 22 2025"'
      + ' style="border:none;background:transparent;font-size:0.875rem;color:inherit;'
      + 'outline:none;flex:1;min-width:0;cursor:text;"'
      + ' onblur="_dbDateTextBlur(' + cardId + ',' + a.id + ',' + kJ + ',this,' + fmtJ + ')">'
      // Hidden native date picker (zero-size, opened by button)
      + '<input type="date" id="' + _esc(pId) + '" value="' + _esc(dv) + '"'
      + ' style="position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;"'
      + ' onchange="_dbDatePickerChange(' + cardId + ',' + a.id + ',' + kJ + ',this,' + fmtJ + ')">'
      // Calendar icon button
      + '<button type="button"'
      + ' onclick="var p=document.getElementById(\'' + _esc(pId) + '\');'
      + 'p.showPicker?p.showPicker():p.click()"'
      + ' title="Pick a date"'
      + ' style="flex-shrink:0;background:none;border:none;cursor:pointer;'
      + 'padding:0.1rem 0.2rem;color:#9ca3af;font-size:0.875rem;line-height:1;'
      + 'border-radius:0.25rem;">&#128197;</button>'
      + '</span>'
    );
  }
  if (t === 'number') {
    var numOpts = _dbParseNumOpts(a.attr_options || '');
    var raw     = v;
    var shown   = raw !== '' ? _dbFormatNumber(raw, numOpts) : '';
    return '<input type="text" value="' + _esc(shown) + '"'
      + ' data-rawval="' + _esc(raw) + '"'
      + ' data-numfmt="' + _esc(numOpts.format) + '"'
      + ' data-numdec="' + numOpts.decimals + '"'
      + ' placeholder="Enter a number…"'
      + ' style="border:none;background:transparent;font-size:0.875rem;'
      + 'color:inherit;outline:none;width:100%;cursor:text;"'
      + ' onfocus="_dbNumFocus(this)"'
      + ' onblur="_dbNumBlurSave(this,' + cardId + ',' + a.id + ',' + kJ + ')">';
  }
  if (t === 'url') {
    var safeUrl = _esc(v);
    var link = v ? '<a href="' + safeUrl + '" target="_blank" rel="noopener"'
      + ' style="color:#0053e2;text-decoration:underline;font-size:0.875rem;'
      + 'word-break:break-all;cursor:pointer;">' + safeUrl + '</a> ' : '';
    return link
      + '<span contenteditable="true"'
      + ' style="font-size:0.75rem;color:#6b7280;cursor:text;outline:none;"'
      + ' onblur="' + cb + '">' + (v ? '(edit)' : 'Add URL…') + '</span>';
  }
  if (t === 'email') {
    var safeEmail = _esc(v);
    var ml = v ? '<a href="mailto:' + safeEmail + '"'
      + ' style="color:#0053e2;text-decoration:underline;font-size:0.875rem;">'
      + safeEmail + '</a> ' : '';
    return ml
      + '<span contenteditable="true" style="font-size:0.75rem;color:#6b7280;cursor:text;outline:none;"'
      + ' onblur="' + cb + '">' + (v ? '(edit)' : 'Add email…') + '</span>';
  }
  if (t === 'phone') {
    var safePhone = _esc(v);
    var tl = v ? '<a href="tel:' + safePhone + '"'
      + ' style="color:#0053e2;text-decoration:underline;font-size:0.875rem;">'
      + safePhone + '</a> ' : '';
    return tl
      + '<span contenteditable="true" style="font-size:0.75rem;color:#6b7280;cursor:text;outline:none;"'
      + ' onblur="' + cb + '">' + (v ? '(edit)' : 'Add phone…') + '</span>';
  }
  if (t === 'status') {
    var sc = _dbStatusColor(v);
    return '<span contenteditable="true"'
      + ' style="display:inline-block;padding:0.1rem 0.6rem;border-radius:9999px;'
      + 'background:' + sc + '22;color:' + sc + ';font-size:0.75rem;font-weight:600;'
      + 'border:1px solid ' + sc + '44;outline:none;cursor:text;"'
      + ' onblur="' + cb + '">' + _esc(v) + '</span>';
  }
  if (t === 'place') {
    var safePlace = encodeURIComponent(v);
    var mapsLink  = v
      ? '<a href="https://maps.google.com/?q=' + safePlace + '" target="_blank" rel="noopener"'
        + ' style="font-size:0.75rem;color:#0053e2;text-decoration:underline;margin-right:0.25rem;">🗺️ Map</a>'
        : '';
    return mapsLink
      + '<span contenteditable="true" class="flex-1 text-sm text-gray-800 dark:text-zinc-100 outline-none"'
      + ' onblur="' + cb + '">' + _esc(v) + '</span>';
  }

  // select — native dropdown constrained to defined options
  if (t === 'select') {
    var sopts = (a.attr_options || '').split(',').map(function(o) { return o.trim(); }).filter(Boolean);
    if (sopts.length > 0) {
      var optHtml = '<option value="">(none)</option>';
      sopts.forEach(function(o) {
        var sel = (o === v) ? ' selected' : '';
        optHtml += '<option value="' + _esc(o) + '"' + sel + '>' + _esc(o) + '</option>';
      });
      // kJ is already HTML-escaped JSON — safe to embed inside onchange="..."
      return '<select onchange="_dbSaveAttrSelect(' + cardId + ',' + a.id + ',' + kJ + ',this)"'
        + ' onfocus="_dbNativeWidgetFocus(this)"'
        + ' onblur="_dbNativeWidgetBlur(this)"'
        + ' style="' + restInputStyle + '">'
        + optHtml + '</select>';
    }
    // No options defined — fall through to plain contenteditable
  }

  // multi_select — toggleable chip grid constrained to defined options
  if (t === 'multi_select') {
    var mopts2 = (a.attr_options || '').split(',').map(function(o) { return o.trim(); }).filter(Boolean);
    if (mopts2.length > 0) {
      var mSelected = (v || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      // Chip border/text colours adapt to dark mode
      var chipBdrOff = isDark ? '#52525b' : '#d1d5db';
      var chipTxtOff = isDark ? '#a1a1aa' : '#9ca3af';
      var chipHtml   = '<div style="display:flex;flex-wrap:wrap;gap:0.25rem;padding:0.125rem 0;">';
      mopts2.forEach(function(o) {
        var isSel = mSelected.indexOf(o) !== -1;
        // oJ: option value HTML-escaped JSON, safe in onclick attribute
        var oJ = _esc(JSON.stringify(o));
        chipHtml += '<button type="button"'
          + ' onclick="_dbToggleMultiSelect(' + cardId + ',' + a.id + ',' + kJ + ',' + oJ + ')"'
          + ' style="font-size:0.7rem;padding:0.15rem 0.6rem;border-radius:9999px;cursor:pointer;'
          + 'border:1px solid ' + (isSel ? '#7c3aed44' : chipBdrOff) + ';'
          + 'background:' + (isSel ? '#7c3aed22' : 'transparent') + ';'
          + 'color:' + (isSel ? '#7c3aed' : chipTxtOff) + ';'
          + 'font-weight:' + (isSel ? '600' : '400') + ';transition:all 0.1s;">'
          + _esc(o) + '</button>';
      });
      chipHtml += '</div>';
      return chipHtml;
    }
    // No options defined — fall through to plain contenteditable
  }

  // text / person / files / select (no opts) / multi_select (no opts) — contenteditable
  return '<div contenteditable="true" class="flex-1 text-sm text-gray-800 dark:text-zinc-100 outline-none"'
    + ' onblur="' + cb + '">' + _esc(v) + '</div>';
}

function _dbRenderDetailPanel(card) {
  // Inject into the app’s shared #detail-panel (inside #panel aside).
  // openPanel() is called by the caller after this returns.
  var dp = document.getElementById('detail-panel');
  if (!dp) return;

  // Cover: bleed edge-to-edge past the p-6 padding of #detail-panel
  var coverHtml;
  if (card.cover_url) {
    var isVid = _dbCoverIsVideo(card.cover_url);
    var coverMedia = isVid
      ? '<video src="' + _esc(card.cover_url) + '" controls preload="metadata"'
        + ' style="width:100%;height:10rem;object-fit:cover;display:block;"></video>'
      : '<img src="' + _esc(card.cover_url) + '" alt="Cover"'
        + ' style="width:100%;height:10rem;object-fit:cover;display:block;"/>';
    coverHtml = '<div style="margin:-1.5rem -1.5rem 1rem -1.5rem;"'
      + ' class="relative overflow-hidden bg-gray-100 dark:bg-zinc-800">'
      + coverMedia
      + '<button type="button" onclick="_dbShowCoverModal(' + card.id + ')"'
      + ' style="position:absolute;top:0.75rem;right:0.75rem;background:rgba(0,0,0,0.45);"'
      + ' class="px-2 py-1 rounded text-xs text-white hover:opacity-90 transition">📷 Change cover</button></div>';
  } else {
    coverHtml = '<div style="margin:-1.5rem -1.5rem 1rem -1.5rem;"'
      + ' class="flex items-center justify-end px-4 py-5'
      + ' bg-gradient-to-r from-purple-500 to-purple-700">'
      + '<button type="button" onclick="_dbShowCoverModal(' + card.id + ')"'
      + ' class="px-2 py-1 rounded text-xs text-white hover:opacity-90 transition"'
      + ' style="background:rgba(255,255,255,0.2);">📷 Add cover</button></div>';
  }

  var created = card.created_at ? card.created_at.replace('T', ' ').slice(0, 16) : 'Unknown';
  var updated = card.updated_at ? card.updated_at.replace('T', ' ').slice(0, 16) : 'Unknown';

  var attrsHtml = (card.attrs || []).map(function(a) {
    var icon = _dbAttrTypeIcon(a.attr_type || 'text');
    return '<div class="flex items-center gap-2 py-1.5 border-b border-gray-100 dark:border-zinc-800">'
      + '<span class="text-xs font-semibold text-gray-500 dark:text-zinc-400 w-28 flex-shrink-0 truncate"'
      + ' title="' + _esc(a.attr_key) + ' (' + _esc(a.attr_type || 'text') + ')">'
      + icon + ' ' + _esc(a.attr_key) + '</span>'
      + '<div class="flex-1 min-w-0">'
      + _dbAttrValueHtml(card.id, a)
      + '</div>'
      + '<button type="button" onclick="_dbEditAttrRow(' + card.id + ',' + a.id + ')"'
      + ' class="text-gray-300 hover:text-blue-400 p-1 rounded transition flex-shrink-0" title="Edit attribute settings">'
      + '&#9998;</button>'
      + '<button type="button" onclick="_dbDeleteAttr(' + card.id + ',' + a.id + ')"'
      + ' class="text-gray-300 hover:text-red-400 p-1 rounded transition flex-shrink-0" title="Remove attribute">'
      + '&times;</button></div>';
  }).join('');

  dp.innerHTML = (
    coverHtml
    // Title + close row
    + '<div class="flex items-start gap-2 mb-1">'
    + '<div contenteditable="true"'
    + ' class="flex-1 text-3xl font-bold text-gray-900 dark:text-zinc-100 outline-none leading-snug"'
    + ' onblur="_dbDetailTitleBlur(' + card.id + ',this)"'
    + ' aria-label="Card title">' + _esc(card.title) + '</div>'
    + '<button type="button" onclick="_dbCloseDetail()"'
    + ' class="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700'
    + ' dark:hover:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition"'
    + ' aria-label="Close detail panel">'
    + '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'
    + '</button></div>'
    // Timestamps
    + '<p class="text-[11px] text-gray-400 dark:text-zinc-500 mb-3">'
    + 'Created ' + created + ' &nbsp;·&nbsp; Updated ' + updated + '</p>'
    // Attributes
    + '<div style="margin:0 -1.5rem;padding:0.5rem 1.5rem;" class="border-t border-b border-gray-100 dark:border-zinc-800 mb-4">'
    + attrsHtml
    + '<button type="button" onclick="_dbAddAttrRow(' + card.id + ')"'
    + ' class="mt-1.5 text-xs text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1">'
    + '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>'
    + 'Add attribute</button></div>'
    // Notes area
    + '<div id="db-detail-note-' + card.id + '" contenteditable="true" data-db-note="1"'
    + ' class="min-h-[200px] outline-none text-sm text-gray-800 dark:text-zinc-100"'
    + ' style="padding-left:1.6rem;margin-left:-1.6rem;overflow:visible;"'
    + ' oninput="_dbDetailNoteInput(' + card.id + ',this)"'
    + ' onblur="_dbDetailNoteBlur(' + card.id + ',this)"'
    + ' aria-label="Card notes">'
    + (card.note_content || '<p style="color:#d1d5db;font-style:italic;">Start writing… (type / for commands)</p>')
    + '</div>'
  );

  /* Attach slash palette + paste-as to the note CE after HTML is in the DOM */
  var noteEl = dp.querySelector('#db-detail-note-' + card.id);
  _dbAttachNoteTools(noteEl);
}

function _dbDetailTitleBlur(cardId, el) {
  var title = el.textContent.trim() || 'Untitled';
  var card  = _dbCards.find(function(c) { return c.id === cardId; });
  if (!card || card.title === title) return;
  card.title = title;
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title }),
  })
  .then(function() { _dbRenderGrid(); })
  .catch(function(e) { console.warn('Title save failed', e); });
}

function _dbDetailNoteInput(cardId, el) {
  if (_dbSaveTimers['detail_' + cardId]) clearTimeout(_dbSaveTimers['detail_' + cardId]);
  _dbSaveTimers['detail_' + cardId] = setTimeout(function() {
    _dbSaveNote(cardId, _dbNoteHtml(el));
  }, 800);
}

function _dbDetailNoteBlur(cardId, el) {
  if (_dbSaveTimers['detail_' + cardId]) {
    clearTimeout(_dbSaveTimers['detail_' + cardId]);
    delete _dbSaveTimers['detail_' + cardId];
  }
  _dbSaveNote(cardId, _dbNoteHtml(el));
}

/* ═══════════════════════════════════════════════════════════════════════════
   CUSTOM ATTRIBUTES (detail panel)
═══════════════════════════════════════════════════════════════════════════ */

function _dbShowCoverModal(cardId) {
  // Build-once overlay; destroy on close
  var existing = document.getElementById('db-cover-modal');
  if (existing) existing.remove();

  var isDark = document.documentElement.classList.contains('dark');
  var bg     = isDark ? '#18181b' : '#ffffff';
  var bdr    = isDark ? '#3f3f46' : '#e5e7eb';

  var modal = document.createElement('div');
  modal.id = 'db-cover-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Set card cover');
  modal.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;'
    + 'align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';

  modal.innerHTML = (
    '<div style="background:' + bg + ';border:1px solid ' + bdr + ';border-radius:1rem;'
    + 'width:min(28rem,95vw);padding:1.5rem;box-shadow:0 20px 60px rgba(0,0,0,0.3);">'
    // Header
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">'
    + '<h3 style="font-weight:700;font-size:1rem;margin:0;">🖼️ Card cover</h3>'
    + '<button type="button" onclick="_dbCloseCoverModal()" aria-label="Close"'
    + ' style="background:none;border:none;cursor:pointer;font-size:1.25rem;line-height:1;">'
    + '&times;</button></div>'
    // Tab bar
    + '<div style="display:flex;gap:0.5rem;margin-bottom:1rem;">'
    + '<button type="button" id="db-cover-tab-url"'
    + ' onclick="_dbCoverTab(\'url\')"'
    + ' style="flex:1;padding:0.4rem 0;border-radius:0.5rem;border:none;cursor:pointer;'
    + 'font-size:0.8rem;font-weight:600;background:#0053e2;color:#fff;">'
    + '🔗 URL</button>'
    + '<button type="button" id="db-cover-tab-upload"'
    + ' onclick="_dbCoverTab(\'upload\')"'
    + ' style="flex:1;padding:0.4rem 0;border-radius:0.5rem;border:1px solid ' + bdr + ';'
    + 'cursor:pointer;font-size:0.8rem;font-weight:600;background:transparent;">'
    + '⬆️ Upload</button>'
    + '</div>'
    // URL panel
    + '<div id="db-cover-panel-url">'
    + '<input id="db-cover-url-input" type="url" placeholder="https://..." autocomplete="off"'
    + ' style="width:100%;box-sizing:border-box;padding:0.5rem 0.75rem;border-radius:0.5rem;'
    + 'border:1px solid ' + bdr + ';background:transparent;font-size:0.875rem;margin-bottom:0.75rem;"/>'
    + '<div style="display:flex;gap:0.5rem;">'
    + '<button type="button" onclick="_dbApplyCoverUrl(' + cardId + ')"'
    + ' style="flex:1;padding:0.5rem;border-radius:0.5rem;border:none;cursor:pointer;'
    + 'background:#0053e2;color:#fff;font-size:0.875rem;font-weight:600;">Apply</button>'
    + '<button type="button" onclick="_dbRemoveCover(' + cardId + ')"'
    + ' style="flex:1;padding:0.5rem;border-radius:0.5rem;border:1px solid #ea1100;'
    + 'cursor:pointer;background:transparent;color:#ea1100;font-size:0.875rem;">Remove</button>'
    + '</div></div>'
    // Upload panel (hidden initially)
    + '<div id="db-cover-panel-upload" style="display:none;">'
    + '<label style="display:block;border:2px dashed ' + bdr + ';border-radius:0.75rem;'
    + 'padding:2rem;text-align:center;cursor:pointer;">'
    + '<span style="display:block;font-size:1.5rem;margin-bottom:0.5rem;">🖼️</span>'
    + '<span style="font-size:0.875rem;">Click to choose an image or video</span><br>'
    + '<span style="font-size:0.75rem;color:#9ca3af;">JPG PNG GIF WebP · MP4 MOV WebM · max 100 MB</span>'
    + '<input id="db-cover-file-input" type="file" accept="image/*,video/mp4,video/quicktime,video/webm,video/ogg"'
    + ' style="display:none;" onchange="_dbUploadCover(' + cardId + ',this)"/>'
    + '</label>'
    + '<div id="db-cover-upload-status" style="margin-top:0.75rem;font-size:0.8rem;'
    + 'text-align:center;min-height:1.2em;"></div>'
    + '</div>'
    + '</div>'
  );

  document.body.appendChild(modal);

  // Wire drag-and-drop on the upload zone now that it’s in the DOM
  var dropLabel = document.querySelector('#db-cover-panel-upload label');
  if (dropLabel) {
    dropLabel.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropLabel.style.background  = 'rgba(124,58,237,0.08)';
      dropLabel.style.borderColor = '#7c3aed';
    });
    dropLabel.addEventListener('dragleave', function() {
      dropLabel.style.background  = '';
      dropLabel.style.borderColor = '';
    });
    dropLabel.addEventListener('drop', function(e) {
      e.preventDefault();
      dropLabel.style.background  = '';
      dropLabel.style.borderColor = '';
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      var status = document.getElementById('db-cover-upload-status');
      if (status) status.textContent = 'Uploading…';
      _dbUploadCoverFile(cardId, file);
    });
  }

  modal.addEventListener('click', function(e) {
    if (e.target === modal) _dbCloseCoverModal();
  });
  // Focus the URL input
  setTimeout(function() {
    var inp = document.getElementById('db-cover-url-input');
    if (inp) inp.focus();
  }, 50);
}

function _dbCloseCoverModal() {
  var m = document.getElementById('db-cover-modal');
  if (m) m.remove();
}

function _dbCoverTab(tab) {
  var urlPanel    = document.getElementById('db-cover-panel-url');
  var uploadPanel = document.getElementById('db-cover-panel-upload');
  var urlBtn      = document.getElementById('db-cover-tab-url');
  var uplBtn      = document.getElementById('db-cover-tab-upload');
  if (!urlPanel) return;
  var isDark = document.documentElement.classList.contains('dark');
  var bdr = isDark ? '#3f3f46' : '#e5e7eb';
  if (tab === 'url') {
    urlPanel.style.display    = '';
    uploadPanel.style.display = 'none';
    urlBtn.style.background   = '#0053e2';
    urlBtn.style.color        = '#fff';
    urlBtn.style.border       = 'none';
    uplBtn.style.background   = 'transparent';
    uplBtn.style.color        = '';
    uplBtn.style.border       = '1px solid ' + bdr;
    setTimeout(function() {
      var inp = document.getElementById('db-cover-url-input');
      if (inp) inp.focus();
    }, 30);
  } else {
    urlPanel.style.display    = 'none';
    uploadPanel.style.display = '';
    uplBtn.style.background   = '#0053e2';
    uplBtn.style.color        = '#fff';
    uplBtn.style.border       = 'none';
    urlBtn.style.background   = 'transparent';
    urlBtn.style.color        = '';
    urlBtn.style.border       = '1px solid ' + bdr;
  }
}

function _dbApplyCoverUrl(cardId) {
  var inp = document.getElementById('db-cover-url-input');
  var url = inp ? inp.value.trim() : '';
  _dbCloseCoverModal();
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  if (card) card.cover_url = url;
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cover_url: url }),
  })
  .then(function() { _dbRenderGrid(); if (_dbDetailId === cardId) _dbOpenDetail(cardId); })
  .catch(function(e) { _dbToast('Could not update cover: ' + e.message, true); });
}

function _dbRemoveCover(cardId) {
  _dbCloseCoverModal();
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  if (card) card.cover_url = '';
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cover_url: '' }),
  })
  .then(function() { _dbRenderGrid(); if (_dbDetailId === cardId) _dbOpenDetail(cardId); })
  .catch(function(e) { _dbToast('Could not remove cover: ' + e.message, true); });
}

// Input-change handler (file picker)
function _dbUploadCover(cardId, input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var status = document.getElementById('db-cover-upload-status');
  if (status) status.textContent = 'Uploading…';
  _dbUploadCoverFile(cardId, file);
}

// Core upload — shared by file picker + drag-and-drop
function _dbUploadCoverFile(cardId, file) {
  var fd = new FormData();
  fd.append('file', file);
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/cover-upload', {
    method: 'POST',
    body: fd,
  })
  .then(function(r) {
    if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || 'Upload failed'); });
    return r.json();
  })
  .then(function(data) {
    _dbCloseCoverModal();
    var card = _dbCards.find(function(c) { return c.id === cardId; });
    if (card) card.cover_url = data.cover_url;
    _dbRenderGrid();
    if (_dbDetailId === cardId) _dbOpenDetail(cardId);
    _dbToast('Cover updated — also saved to your Uploads page 🎉');
  })
  .catch(function(e) {
    var statusEl = document.getElementById('db-cover-upload-status');
    if (statusEl) statusEl.textContent = '⚠️ ' + e.message;
    else _dbToast(e.message, true);
  });
}

function _dbAddAttrRow(cardId) {
  // ── theme tokens — same pattern as _dbShowCoverModal ──────────────────────
  var isDark = document.documentElement.classList.contains('dark');
  var bg     = isDark ? '#18181b' : '#ffffff';
  var bdr    = isDark ? '#3f3f46' : '#e5e7eb';
  var txt    = isDark ? '#f4f4f5' : '#111827';
  var sub    = isDark ? '#a1a1aa' : '#6b7280';
  var inpBg  = isDark ? '#27272a' : '#ffffff';
  var selBg  = isDark ? '#1e3a5f' : '#eff6ff';  // selected type btn bg
  var btnTxt = isDark ? '#d4d4d8' : '#374151';  // type label text

  var ov = document.createElement('div');
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', 'Add attribute');
  ov.className = 'fixed inset-0 flex items-center justify-center p-4';
  ov.style.zIndex = '9999';

  var bd = document.createElement('div');
  bd.className = 'absolute inset-0 bg-black/40 backdrop-blur-sm';
  ov.appendChild(bd);

  // ── type picker grid ─────────────────────────────────────────────
  var selectedType = 'text';

  var typeGrid = _DB_ATTR_TYPES.map(function(t) {
    var isSel = t.id === 'text';
    return '<button type="button" data-type="' + t.id + '"'
      + ' style="display:flex;flex-direction:column;align-items:center;gap:0.2rem;'
      + 'padding:0.5rem 0.25rem;border-radius:0.5rem;cursor:pointer;transition:all 0.12s;'
      + 'border:1px solid ' + (isSel ? '#0053e2' : bdr) + ';'
      + 'background:' + (isSel ? selBg : 'transparent') + ';">'
      + '<span style="font-size:1.1rem;line-height:1;">' + t.icon + '</span>'
      + '<span style="font-size:0.6rem;font-weight:600;color:' + btnTxt + ';">' + t.label + '</span>'
      + '</button>';
  }).join('');

  // ── shared input style (dark-aware) ────────────────────────────────
  var inputCss = 'width:100%;box-sizing:border-box;padding:0.5rem 0.75rem;'
    + 'border:1px solid ' + bdr + ';border-radius:0.5rem;font-size:0.875rem;'
    + 'background:' + inpBg + ';color:' + txt + ';outline:none;';

  // ── label style helper ─────────────────────────────────────────────
  var labelCss = 'font-size:0.7rem;font-weight:600;text-transform:uppercase;'
    + 'letter-spacing:0.05em;display:block;margin-bottom:0.25rem;color:' + sub + ';';

  // ── dialog panel ─────────────────────────────────────────────────
  var dlg = document.createElement('div');
  dlg.style.cssText = 'position:relative;background:' + bg + ';'
    + 'border-radius:1rem;box-shadow:0 20px 60px rgba(0,0,0,0.4);'
    + 'width:min(28rem,95vw);max-height:90vh;overflow-y:auto;padding:1.5rem;';

  dlg.innerHTML =
    '<h2 style="font-weight:700;font-size:1rem;margin:0 0 1rem;color:' + txt + ';">'
    + '+ Add Attribute</h2>'

    // ─ type label
    + '<p style="' + labelCss + 'margin-bottom:0.4rem;">Type</p>'
    + '<div id="_db-type-grid" style="display:grid;grid-template-columns:repeat(4,1fr);'
    + 'gap:0.35rem;margin-bottom:1rem;">'
    + typeGrid
    + '</div>'

    // ─ name
    + '<div style="margin-bottom:0.75rem;">'
    + '<label style="' + labelCss + '">Name</label>'
    + '<input id="_db-attr-key" type="text" placeholder="e.g. Status, Owner, Priority…"'
    + ' style="' + inputCss + '" /></div>'

    // ─ default value (swapped by type)
    + '<div id="_db-attr-val-wrap" style="margin-bottom:0.75rem;">'
    + '<label style="' + labelCss + '">Default value '
    + '<span style="font-weight:400;text-transform:none;">(optional)</span></label>'
    + '<input id="_db-attr-val" type="text" placeholder="Leave blank to fill later…"'
    + ' style="' + inputCss + '" /></div>'

    // ─ options (select / multi_select / status only)
    + '<div id="_db-attr-opts-wrap" style="display:none;margin-bottom:0.75rem;">'
    + '<label style="' + labelCss + '">Options '
    + '<span style="font-weight:400;text-transform:none;">(comma-separated)</span></label>'
    + '<input id="_db-attr-opts" type="text" placeholder="e.g. To Do, In Progress, Done"'
    + ' style="' + inputCss + '" /></div>'

    // ─ buttons
    + '<div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:0.5rem;">'
    + '<button id="_db-attr-cancel" type="button"'
    + ' style="padding:0.5rem 1rem;border-radius:0.5rem;'
    + 'border:1px solid ' + bdr + ';font-size:0.875rem;cursor:pointer;'
    + 'background:transparent;color:' + txt + ';">Done</button>'
    + '<button id="_db-attr-save" type="button"'
    + ' style="padding:0.5rem 1rem;border-radius:0.5rem;border:none;background:#0053e2;'
    + 'color:#fff;font-size:0.875rem;font-weight:600;cursor:pointer;">Add Attribute</button>'
    + '</div>';

  ov.appendChild(dlg);
  document.body.appendChild(ov);

  var keyInp    = document.getElementById('_db-attr-key');
  var valWrap   = document.getElementById('_db-attr-val-wrap');
  var optsWrap  = document.getElementById('_db-attr-opts-wrap');
  var cancelBtn = document.getElementById('_db-attr-cancel');
  var saveBtn   = document.getElementById('_db-attr-save');

  function _submit() {
    var key = keyInp.value.trim();
    if (!key) { keyInp.focus(); return; }
    var atype = selectedType || 'text';
    var aopts = _readOptions();
    var aval  = _readValue();

    // Disable button while saving
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    fetch('/workspaces/' + _dbWsId + '/db/attrs/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attr_key:          key,
        attr_type:         atype,
        attr_options:      aopts,
        source_card_id:    cardId,
        source_attr_value: aval,
      }),
    })
    .then(function(r) {
      if (!r.ok) throw new Error('Save failed (' + r.status + ')');
      return r.json();
    })
    .then(function(data) {
      // Update global card state + grid from the sync response
      _dbCards = data.cards;
      _dbRenderGrid();
      // Refresh the detail panel directly from the already-loaded card
      var fresh = _dbCards.find(function(c) { return c.id === cardId; });
      if (fresh) _dbRenderDetailPanel(fresh);

      // Flash ✓ then reset the form so the user can add another
      saveBtn.textContent = '\u2713 Saved!';
      saveBtn.style.background = '#2a8703';
      setTimeout(function() {
        saveBtn.disabled   = false;
        saveBtn.textContent = 'Add Attribute';
        saveBtn.style.background = '#0053e2';
      }, 1200);

      // Reset form fields for next attr
      keyInp.value = '';
      selectedType = 'text';
      document.getElementById('_db-type-grid')
        .querySelectorAll('button[data-type]')
        .forEach(function(b) {
          var isTxt = b.getAttribute('data-type') === 'text';
          b.style.border     = '1px solid ' + (isTxt ? '#0053e2' : bdr);
          b.style.background = isTxt ? selBg : 'transparent';
        });
      _buildValField('text');
      keyInp.focus();
    })
    .catch(function(e) {
      saveBtn.disabled   = false;
      saveBtn.textContent = 'Add Attribute';
      _dbToast('Could not save attribute: ' + e.message, true);
    });
  }

  function _close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }

  // ── swap value field based on selected type ────────────────────────────
  function _buildValField(t) {
    var TYPE_META = {
      text:         { tag:'input', inputType:'text',  ph:'e.g. Hello world' },
      number:       { tag:'input', inputType:'number',ph:'e.g. 42' },
      select:       { tag:'input', inputType:'text',  ph:'Choose from options…' },
      multi_select: { tag:'input', inputType:'text',  ph:'Choose multiple…' },
      status:       { tag:'input', inputType:'text',  ph:'e.g. In Progress' },
      date:         { tag:'input', inputType:'date',  ph:'' },
      person:       { tag:'input', inputType:'text',  ph:'e.g. Alice' },
      files:        { tag:'input', inputType:'text',  ph:'Filename or URL' },
      checkbox:     { tag:'checkbox' },
      url:          { tag:'input', inputType:'url',   ph:'https://…' },
      email:        { tag:'input', inputType:'email', ph:'e.g. name@example.com' },
      phone:        { tag:'input', inputType:'tel',   ph:'e.g. +1 555 000 0000' },
      place:        { tag:'input', inputType:'text',  ph:'e.g. 702 SW 8th St, Bentonville' },
    };

    // ── number: default value + format select + decimal input ────────────
    if (t === 'number') {
      valWrap.innerHTML = '';
      var numLbl = document.createElement('label');
      numLbl.style.cssText = labelCss;
      numLbl.innerHTML = 'Default value <span style="font-weight:400;text-transform:none;">(optional)</span>';
      valWrap.appendChild(numLbl);

      var prevSp = document.createElement('span');
      prevSp.style.cssText = 'display:block;font-size:0.95rem;font-weight:600;'
        + 'color:' + txt + ';min-height:1.4rem;margin-bottom:0.3rem;';
      prevSp.textContent = '0';
      valWrap.appendChild(prevSp);

      var rawInp = document.createElement('input');
      rawInp.type = 'number';
      rawInp.id   = '_db-attr-val';
      rawInp.placeholder = 'e.g. 1234';
      rawInp.style.cssText = inputCss;
      valWrap.appendChild(rawInp);

      // format + decimal grid
      var numRow = document.createElement('div');
      numRow.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:0.5rem;margin-top:0.6rem;';

      var fmtDiv = document.createElement('div');
      var fmtLbl = document.createElement('label');
      fmtLbl.style.cssText = labelCss;
      fmtLbl.textContent = 'Number format';
      var fmtSel = document.createElement('select');
      fmtSel.id = '_db-num-format';
      fmtSel.style.cssText = inputCss + 'cursor:pointer;';
      _DB_NUM_FORMATS.forEach(function(f) {
        var opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.label;
        fmtSel.appendChild(opt);
      });
      fmtDiv.appendChild(fmtLbl);
      fmtDiv.appendChild(fmtSel);

      var decDiv = document.createElement('div');
      var decLbl = document.createElement('label');
      decLbl.style.cssText = labelCss;
      decLbl.textContent = 'Decimals';
      var decInp = document.createElement('input');
      decInp.type  = 'number';
      decInp.id    = '_db-num-dec';
      decInp.min   = '0';
      decInp.max   = '5';
      decInp.value = '0';
      decInp.style.cssText = inputCss + 'width:4.5rem;';
      decDiv.appendChild(decLbl);
      decDiv.appendChild(decInp);

      numRow.appendChild(fmtDiv);
      numRow.appendChild(decDiv);
      valWrap.appendChild(numRow);

      function _updNumPrev() {
        prevSp.textContent = _dbFormatNumber(rawInp.value || '0', {
          format:   fmtSel.value,
          decimals: parseInt(decInp.value, 10) || 0,
        });
      }
      rawInp.addEventListener('input',  _updNumPrev);
      fmtSel.addEventListener('change', _updNumPrev);
      decInp.addEventListener('input',  _updNumPrev);
      optsWrap.style.display = 'none';
      return;
    }

    valWrap.innerHTML = '<label style="' + labelCss + '">Default value '
      + '<span style="font-weight:400;text-transform:none;">(optional)</span></label>';
    var meta = TYPE_META[t] || TYPE_META.text;
    if (meta.tag === 'checkbox') {
      var lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;'
        + 'cursor:pointer;color:' + txt + ';';
      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.id   = '_db-attr-val';
      chk.style.cssText = 'width:1rem;height:1rem;accent-color:#0053e2;cursor:pointer;';
      lbl.appendChild(chk);
      lbl.appendChild(document.createTextNode('Checked'));
      valWrap.appendChild(lbl);
    } else {
      var inp = document.createElement('input');
      inp.type        = meta.inputType;
      inp.id          = '_db-attr-val';
      inp.placeholder = meta.ph || '';
      inp.style.cssText = inputCss;
      // date inputs need color override for dark mode
      if (meta.inputType === 'date' && isDark) inp.style.colorScheme = 'dark';
      valWrap.appendChild(inp);
    }
    var needsOpts = (t === 'select' || t === 'multi_select' || t === 'status');
    optsWrap.style.display = needsOpts ? '' : 'none';
  }

  function _getValField() { return document.getElementById('_db-attr-val'); }

  function _readValue() {
    var el = _getValField();
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked ? 'true' : 'false';
    return el.value || '';
  }

  function _readOptions() {
    if (selectedType === 'number') {
      var fmtEl = document.getElementById('_db-num-format');
      var decEl = document.getElementById('_db-num-dec');
      return JSON.stringify({
        format:   fmtEl ? fmtEl.value : 'number',
        decimals: decEl ? (parseInt(decEl.value, 10) || 0) : 0,
      });
    }
    var el = document.getElementById('_db-attr-opts');
    return el ? el.value.trim() : '';
  }

  // type button click — re-style uses same dark-aware tokens
  document.getElementById('_db-type-grid').addEventListener('click', function(e) {
    var btn = e.target.closest('button[data-type]');
    if (!btn) return;
    selectedType = btn.getAttribute('data-type');
    this.querySelectorAll('button[data-type]').forEach(function(b) {
      var sel = b.getAttribute('data-type') === selectedType;
      b.style.border     = '1px solid ' + (sel ? '#0053e2' : bdr);
      b.style.background = sel ? selBg : 'transparent';
    });
    if (!keyInp.value.trim()) {
      var def = _DB_ATTR_TYPES.find(function(x) { return x.id === selectedType; });
      if (def) keyInp.value = def.label;
    }
    _buildValField(selectedType);
    var vf = _getValField();
    if (vf && vf.type !== 'checkbox') vf.focus();
  });

  bd.addEventListener('click', _close);
  cancelBtn.addEventListener('click', _close);
  saveBtn.addEventListener('click', _submit);
  ov.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { _close(); return; }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); _submit(); }
  });
  keyInp.focus();
}

/* ── Edit existing attribute (name / type / format) ─────────────────────── */
function _dbEditAttrRow(cardId, attrId) {
  var card    = _dbCards.find(function(c) { return c.id === cardId; });
  var attr    = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  if (!attr) return;

  var origKey  = attr.attr_key     || '';
  var origType = attr.attr_type    || 'text';
  var origOpts = attr.attr_options || '';
  var origVal  = attr.attr_value   || '';

  // ── dark-mode tokens (same pattern as _dbAddAttrRow) ────────────────
  var isDark = document.documentElement.classList.contains('dark');
  var bg     = isDark ? '#18181b' : '#ffffff';
  var bdr    = isDark ? '#3f3f46' : '#e5e7eb';
  var txt    = isDark ? '#f4f4f5' : '#111827';
  var sub    = isDark ? '#a1a1aa' : '#6b7280';
  var inpBg  = isDark ? '#27272a' : '#ffffff';
  var selBg  = isDark ? '#1e3a5f' : '#eff6ff';
  var btnTxt = isDark ? '#d4d4d8' : '#374151';

  var inputCss = 'width:100%;box-sizing:border-box;padding:0.5rem 0.75rem;'
    + 'border:1px solid ' + bdr + ';border-radius:0.5rem;font-size:0.875rem;'
    + 'background:' + inpBg + ';color:' + txt + ';outline:none;';
  var labelCss = 'font-size:0.7rem;font-weight:600;text-transform:uppercase;'
    + 'letter-spacing:0.05em;display:block;margin-bottom:0.25rem;color:' + sub + ';';

  var selectedType    = origType;
  var selectedDateFmt = (origType === 'date' && origOpts) ? origOpts : 'mdy';

  // ── type grid (pre-selected) ────────────────────────────────────
  var typeGrid = _DB_ATTR_TYPES.map(function(t) {
    var isSel = t.id === origType;
    return '<button type="button" data-type="' + t.id + '"'
      + ' style="display:flex;flex-direction:column;align-items:center;gap:0.2rem;'
      + 'padding:0.5rem 0.25rem;border-radius:0.5rem;cursor:pointer;transition:all 0.12s;'
      + 'border:1px solid ' + (isSel ? '#0053e2' : bdr) + ';'
      + 'background:' + (isSel ? selBg : 'transparent') + ';">'
      + '<span style="font-size:1.1rem;line-height:1;">' + t.icon + '</span>'
      + '<span style="font-size:0.6rem;font-weight:600;color:' + btnTxt + ';">' + t.label + '</span>'
      + '</button>';
  }).join('');

  // ── overlay + dialog ───────────────────────────────────────────
  var ov = document.createElement('div');
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', 'Edit attribute');
  ov.className = 'fixed inset-0 flex items-center justify-center p-4';
  ov.style.zIndex = '9999';

  var bd = document.createElement('div');
  bd.className = 'absolute inset-0 bg-black/40 backdrop-blur-sm';
  ov.appendChild(bd);

  var dlg = document.createElement('div');
  dlg.style.cssText = 'position:relative;background:' + bg + ';'
    + 'border-radius:1rem;box-shadow:0 20px 60px rgba(0,0,0,0.4);'
    + 'width:min(28rem,95vw);max-height:90vh;overflow-y:auto;padding:1.5rem;';

  dlg.innerHTML =
    '<h2 style="font-weight:700;font-size:1rem;margin:0 0 0.25rem;color:' + txt + ';">'
    + '\u270F\uFE0F Edit Attribute</h2>'
    + '<p style="font-size:0.75rem;margin:0 0 1rem;color:' + sub + ';">'
    + 'Changing the type keeps the stored value — re-format as needed.</p>'
    // type
    + '<p style="' + labelCss + 'margin-bottom:0.4rem;">Type</p>'
    + '<div id="_dbe-type-grid" style="display:grid;grid-template-columns:repeat(4,1fr);'
    + 'gap:0.35rem;margin-bottom:1rem;">'
    + typeGrid + '</div>'
    // name
    + '<div style="margin-bottom:0.75rem;">'
    + '<label style="' + labelCss + '">Name</label>'
    + '<input id="_dbe-key" type="text" value="' + _esc(origKey) + '"'
    + ' style="' + inputCss + '" /></div>'
    // dynamic extras (number format / options)
    + '<div id="_dbe-extras"></div>'
    // buttons
    + '<div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:0.5rem;">'
    + '<button id="_dbe-cancel" type="button"'
    + ' style="padding:0.5rem 1rem;border-radius:0.5rem;border:1px solid ' + bdr + ';'
    + 'font-size:0.875rem;cursor:pointer;background:transparent;color:' + txt + ';">Cancel</button>'
    + '<button id="_dbe-save" type="button"'
    + ' style="padding:0.5rem 1rem;border-radius:0.5rem;border:none;background:#0053e2;'
    + 'color:#fff;font-size:0.875rem;font-weight:600;cursor:pointer;">Save changes</button>'
    + '</div>';

  ov.appendChild(dlg);
  document.body.appendChild(ov);

  var keyInp    = document.getElementById('_dbe-key');
  var extrasDiv = document.getElementById('_dbe-extras');
  var cancelBtn = document.getElementById('_dbe-cancel');
  var saveBtn   = document.getElementById('_dbe-save');

  function _close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }

  // ── build extras section for current type ───────────────────────────
  function _buildExtras(t) {
    extrasDiv.innerHTML = '';
    if (t === 'number') {
      var parsed = _dbParseNumOpts(selectedType === origType ? origOpts : '{}');

      var row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:0.5rem;margin-bottom:0.75rem;';

      var fmtDiv = document.createElement('div');
      var fmtLbl = document.createElement('label');
      fmtLbl.style.cssText = labelCss;
      fmtLbl.textContent = 'Number format';
      var fmtSel = document.createElement('select');
      fmtSel.id = '_dbe-num-fmt';
      fmtSel.style.cssText = inputCss + 'cursor:pointer;';
      _DB_NUM_FORMATS.forEach(function(f) {
        var opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.label;
        if (f.id === parsed.format) opt.selected = true;
        fmtSel.appendChild(opt);
      });
      fmtDiv.appendChild(fmtLbl);
      fmtDiv.appendChild(fmtSel);

      var decDiv = document.createElement('div');
      var decLbl = document.createElement('label');
      decLbl.style.cssText = labelCss;
      decLbl.textContent = 'Decimals';
      var decInp = document.createElement('input');
      decInp.type  = 'number';
      decInp.id    = '_dbe-num-dec';
      decInp.min   = '0';
      decInp.max   = '5';
      decInp.value = String(parsed.decimals);
      decInp.style.cssText = inputCss + 'width:4.5rem;';
      decDiv.appendChild(decLbl);
      decDiv.appendChild(decInp);

      row.appendChild(fmtDiv);
      row.appendChild(decDiv);
      extrasDiv.appendChild(row);
    } else if (t === 'select' || t === 'multi_select' || t === 'status') {
      var optsDiv = document.createElement('div');
      optsDiv.style.cssText = 'margin-bottom:0.75rem;';
      var optsLbl = document.createElement('label');
      optsLbl.style.cssText = labelCss;
      optsLbl.innerHTML = 'Options <span style="font-weight:400;text-transform:none;">(comma-separated)</span>';
      var optsInp = document.createElement('input');
      optsInp.type = 'text';
      optsInp.id   = '_dbe-opts';
      optsInp.value = (selectedType === origType ? origOpts : '');
      optsInp.placeholder = 'e.g. To Do, In Progress, Done';
      optsInp.style.cssText = inputCss;
      optsDiv.appendChild(optsLbl);
      optsDiv.appendChild(optsInp);
      extrasDiv.appendChild(optsDiv);
    } else if (t === 'date') {
      var dateFmtDiv = document.createElement('div');
      dateFmtDiv.style.cssText = 'margin-bottom:0.75rem;';
      var dateFmtLbl = document.createElement('label');
      dateFmtLbl.style.cssText = labelCss;
      dateFmtLbl.textContent = 'Display format';
      dateFmtDiv.appendChild(dateFmtLbl);
      var fmtGrid = document.createElement('div');
      fmtGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;';
      // Reset selectedDateFmt when switching type; keep it when staying on date.
      if (selectedType !== origType) selectedDateFmt = 'mdy';
      _DB_DATE_FORMATS.forEach(function(f) {
        var isSel = f.id === selectedDateFmt;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-datefmt', f.id);
        btn.style.cssText =
          'text-align:left;padding:0.4rem 0.6rem;border-radius:0.5rem;cursor:pointer;'
          + 'border:1px solid ' + (isSel ? '#0053e2' : bdr) + ';'
          + 'background:' + (isSel ? selBg : 'transparent') + ';font-size:0.8rem;';
        btn.innerHTML =
          '<div style="font-weight:600;color:' + txt + ';">' + _esc(f.label) + '</div>'
          + '<div style="color:' + sub + ';font-size:0.7rem;">' + _esc(f.example) + '</div>';
        btn.addEventListener('click', function() {
          selectedDateFmt = f.id;
          fmtGrid.querySelectorAll('button[data-datefmt]').forEach(function(b) {
            var s = b.getAttribute('data-datefmt') === selectedDateFmt;
            b.style.border     = '1px solid ' + (s ? '#0053e2' : bdr);
            b.style.background = s ? selBg : 'transparent';
          });
        });
        fmtGrid.appendChild(btn); });
      dateFmtDiv.appendChild(fmtGrid);
      extrasDiv.appendChild(dateFmtDiv);
    }
  }

  // ── read options from extras ─────────────────────────────────────
  function _readExtras() {
    if (selectedType === 'number') {
      var fEl = document.getElementById('_dbe-num-fmt');
      var dEl = document.getElementById('_dbe-num-dec');
      return JSON.stringify({
        format:   fEl ? fEl.value : 'number',
        decimals: dEl ? (parseInt(dEl.value, 10) || 0) : 0,
      });
    }
    if (selectedType === 'date') {
      return selectedDateFmt || 'mdy';
    }
    var oEl = document.getElementById('_dbe-opts');
    return oEl ? oEl.value.trim() : '';
  }

  // type picker
  document.getElementById('_dbe-type-grid').addEventListener('click', function(e) {
    var btn = e.target.closest('button[data-type]');
    if (!btn) return;
    selectedType = btn.getAttribute('data-type');
    this.querySelectorAll('button[data-type]').forEach(function(b) {
      var sel = b.getAttribute('data-type') === selectedType;
      b.style.border     = '1px solid ' + (sel ? '#0053e2' : bdr);
      b.style.background = sel ? selBg : 'transparent';
    });
    _buildExtras(selectedType);
  });

  // ── save ────────────────────────────────────────────────────
  function _submit() {
    var newKey  = keyInp.value.trim();
    if (!newKey) { keyInp.focus(); return; }
    var newType = selectedType;
    var newOpts = _readExtras();

    if (newKey !== origKey) {
      // Rename across all cards — values are preserved
      fetch('/workspaces/' + _dbWsId + '/db/attrs/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_key:      origKey,
          new_key:      newKey,
          attr_type:    newType,
          attr_options: newOpts,
        }),
      })
      .then(function(r) { if (!r.ok) throw new Error('Rename failed'); return r.json(); })
      .then(function(data) {
        _dbCards = data.cards;
        _dbRenderGrid();
        _dbOpenDetail(cardId);
      })
      .catch(function(e) { _dbToast('Could not rename attribute: ' + e.message, true); });
    } else {
      // Key unchanged — sync type/options to all cards, preserve source value
      _dbSaveAttrByKey(cardId, newKey, origVal, newType, newOpts);
    }
    _close();
  }

  // init extras for current type
  _buildExtras(origType);

  bd.addEventListener('click', _close);
  cancelBtn.addEventListener('click', _close);
  saveBtn.addEventListener('click', _submit);
  ov.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { _close(); return; }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); _submit(); }
  });
  keyInp.focus();
  keyInp.select();
}

function _dbSaveAttrByKey(cardId, key, value, attrType, attrOptions) {
  var atype = attrType  || 'text';
  var aopts = attrOptions || '';
  // Broadcast to all cards in this workspace: source card gets the value;
  // every other card has the attr inserted (empty) or type/options updated.
  fetch('/workspaces/' + _dbWsId + '/db/attrs/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attr_key:          key,
      attr_type:         atype,
      attr_options:      aopts,
      source_card_id:    cardId,
      source_attr_value: value,
    }),
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Attr sync failed');
    return r.json();
  })
  .then(function(data) {
    _dbCards = data.cards;
    _dbRenderGrid();
    _dbOpenDetail(cardId);
  })
  .catch(function(e) { _dbToast('Could not save attribute: ' + e.message, true); });
}

function _dbSaveAttr(cardId, attrId, key, el) {
  var value = el.textContent.trim();
  var card  = _dbCards.find(function(c) { return c.id === cardId; });
  var meta  = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var atype = meta ? (meta.attr_type    || 'text') : 'text';
  var aopts = meta ? (meta.attr_options || '')      : '';
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attr_key: key, attr_value: value,
                           attr_type: atype, attr_options: aopts }),
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Attr save failed');
    if (card && card.attrs) {
      var attr = card.attrs.find(function(a) { return a.id === attrId; });
      if (attr) { attr.attr_value = value; }
    }
    _dbRenderGrid();
  })
  .catch(function(e) { console.warn('Attr save failed', e); });
}

function _dbSaveAttrSelect(cardId, attrId, key, el) {
  var value = el.value || '';
  var card  = _dbCards.find(function(c) { return c.id === cardId; });
  var meta  = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var aopts = meta ? (meta.attr_options || '') : '';
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attr_key: key, attr_value: value,
                           attr_type: 'select', attr_options: aopts }),
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Select save failed');
    if (meta) meta.attr_value = value;
    _dbRenderGrid();
  })
  .catch(function(e) { console.warn('Select attr save failed', e); });
}

function _dbToggleMultiSelect(cardId, attrId, key, option) {
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var meta = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  if (!meta) return;
  var aopts = meta.attr_options || '';
  var current = (meta.attr_value || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var idx = current.indexOf(option);
  if (idx === -1) { current.push(option); } else { current.splice(idx, 1); }
  var newVal = current.join(',');
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attr_key: key, attr_value: newVal,
                           attr_type: 'multi_select', attr_options: aopts }),
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Multi-select save failed');
    meta.attr_value = newVal;
    _dbRenderGrid();
    // Re-render detail panel in-place so chip states update instantly
    var fresh = _dbCards.find(function(c) { return c.id === cardId; });
    if (fresh) _dbRenderDetailPanel(fresh);
  })
  .catch(function(e) { console.warn('Multi-select attr save failed', e); });
}

function _dbSaveAttrInput(cardId, attrId, key, el) {
  // Generic handler for <input type="date|number"> elements
  var value = el.value || '';
  var card  = _dbCards.find(function(c) { return c.id === cardId; });
  var meta  = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var atype = meta ? (meta.attr_type    || 'text') : 'text';
  var aopts = meta ? (meta.attr_options || '')      : '';
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attr_key: key, attr_value: value,
                           attr_type: atype, attr_options: aopts }),
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Attr save failed');
    if (card && card.attrs) {
      var attr = card.attrs.find(function(a) { return a.id === attrId; });
      if (attr) { attr.attr_value = value; }
    }
    _dbRenderGrid();
  })
  .catch(function(e) { console.warn('Attr input save failed', e); });
}

// Shared atomic save used by date helpers (and open for reuse elsewhere).
function _dbSaveAttrVal(cardId, attrId, key, value) {
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var meta = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var atype = meta ? (meta.attr_type    || 'text') : 'text';
  var aopts = meta ? (meta.attr_options || '')      : '';
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attr_key: key, attr_value: value,
                           attr_type: atype, attr_options: aopts }),
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Save failed');
    if (meta) meta.attr_value = value;
    _dbRenderGrid();
  })
  .catch(function(e) { console.warn('Attr save failed', e); });
}

function _dbDateTextBlur(cardId, attrId, key, el, fmtId) {
  var raw = el.value.trim();
  if (!raw) { _dbSaveAttrVal(cardId, attrId, key, ''); return; }
  var iso = _dbParseUserDate(raw);
  if (iso) {
    el.value = _dbFormatDate(iso, fmtId); // normalise to canonical display
    var picker = document.getElementById('dbt-p-' + attrId);
    if (picker) picker.value = iso;
    _dbSaveAttrVal(cardId, attrId, key, iso);
  } else {
    el.style.color = '#ea1100'; // flash red — couldn't parse
    setTimeout(function() { el.style.color = ''; }, 1500);
  }
}

function _dbDatePickerChange(cardId, attrId, key, pickerEl, fmtId) {
  var iso   = pickerEl.value; // native picker always gives YYYY-MM-DD
  var wrap  = pickerEl.parentNode;
  var textEl = wrap ? wrap.querySelector('input[type=text]') : null;
  if (textEl) textEl.value = iso ? _dbFormatDate(iso, fmtId) : '';
  _dbSaveAttrVal(cardId, attrId, key, iso);
}
function _dbSaveAttrCheckbox(cardId, attrId, key, el) {
  var value = el.checked ? 'true' : 'false';
  var card  = _dbCards.find(function(c) { return c.id === cardId; });
  var meta  = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var aopts = meta ? (meta.attr_options || '') : '';
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attr_key: key, attr_value: value,
                           attr_type: 'checkbox', attr_options: aopts }),
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Checkbox save failed');
    if (card && card.attrs) {
      var attr = card.attrs.find(function(a) { return a.id === attrId; });
      if (attr) { attr.attr_value = value; }
    }
    _dbRenderGrid();
  })
  .catch(function(e) { console.warn('Checkbox save failed', e); });
}

function _dbDeleteAttr(cardId, attrId) {
  // Find attr name for the warning label
  var card     = _dbCards.find(function(c) { return c.id === cardId; });
  var attr     = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var attrName = attr ? attr.attr_key : 'this attribute';

  // ── dark-mode tokens (same pattern as every other modal in this file) ───
  var isDark = document.documentElement.classList.contains('dark');
  var bg     = isDark ? '#18181b' : '#ffffff';
  var bdr    = isDark ? '#3f3f46' : '#d1d5db';
  var txt    = isDark ? '#f4f4f5' : '#111827';
  var sub    = isDark ? '#a1a1aa' : '#6b7280';

  // ── overlay ─────────────────────────────────────────────────
  var ov = document.createElement('div');
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', 'Remove attribute');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;'
    + 'display:flex;align-items:center;justify-content:center;padding:1rem;';

  var bd = document.createElement('div');
  bd.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);';
  ov.appendChild(bd);

  // ── dialog (matches card-delete modal proportions exactly) ──────────
  var dlg = document.createElement('div');
  dlg.style.cssText = 'position:relative;background:' + bg + ';'
    + 'border-radius:1rem;box-shadow:0 20px 60px rgba(0,0,0,0.35);'
    + 'width:100%;max-width:20rem;padding:1.5rem;';

  // title
  var h2 = document.createElement('h2');
  h2.style.cssText = 'font-size:1rem;font-weight:700;color:' + txt + ';margin:0 0 0.5rem;';
  h2.textContent = 'Remove attribute?';
  dlg.appendChild(h2);

  // attribute name
  var p = document.createElement('p');
  p.style.cssText = 'font-size:0.875rem;color:' + sub + ';margin:0 0 1.25rem;line-height:1.5;';
  p.textContent = '\u201c' + attrName + '\u201d and its value will be permanently removed.';
  dlg.appendChild(p);

  // button row
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:0.5rem;justify-content:flex-end;';

  var cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'padding:0.5rem 1rem;font-size:0.875rem;border-radius:0.5rem;'
    + 'border:1px solid ' + bdr + ';color:' + txt + ';background:transparent;'
    + 'cursor:pointer;transition:background 0.15s;';

  var delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.textContent = 'Remove';
  delBtn.style.cssText = 'padding:0.5rem 1rem;font-size:0.875rem;font-weight:600;'
    + 'border-radius:0.5rem;border:none;background:#ea1100;color:#fff;'
    + 'cursor:pointer;transition:background 0.15s;';

  row.appendChild(cancelBtn);
  row.appendChild(delBtn);
  dlg.appendChild(row);
  ov.appendChild(dlg);
  document.body.appendChild(ov);

  function _close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }

  // hover effects
  cancelBtn.addEventListener('mouseenter', function() {
    cancelBtn.style.background = isDark ? '#27272a' : '#f9fafb';
  });
  cancelBtn.addEventListener('mouseleave', function() {
    cancelBtn.style.background = 'transparent';
  });
  delBtn.addEventListener('mouseenter', function() {
    delBtn.style.background = '#c70e00';
  });
  delBtn.addEventListener('mouseleave', function() {
    delBtn.style.background = '#ea1100';
  });

  // dismiss
  bd.addEventListener('click', _close);
  cancelBtn.addEventListener('click', _close);
  ov.addEventListener('keydown', function(e) { if (e.key === 'Escape') _close(); });

  // confirm → remove this attr key from ALL cards in the workspace
  delBtn.addEventListener('click', function() {
    _close();
    fetch('/workspaces/' + _dbWsId + '/db/attrs/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attr_key: attrName }),
    })
    .then(function(r) {
      if (!r.ok) throw new Error('Delete attr failed');
      return r.json();
    })
    .then(function(data) {
      _dbCards = data.cards;
      _dbRenderGrid();
      if (_dbDetailId === cardId) _dbOpenDetail(cardId);
    })
    .catch(function(e) { _dbToast('Could not delete attribute: ' + e.message, true); });
  });

  delBtn.focus();
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODAL BINDING
═══════════════════════════════════════════════════════════════════════════ */

var _dbModalsWired = false;

function _dbBindModals() {
  // Close add-card modal on Enter key in the title input
  var inp = document.getElementById('db-new-card-title');
  if (inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); _dbSubmitAddCard(); }
    });
  }
  // Document-level listeners are global — only wire once to avoid stacking
  if (_dbModalsWired) return;
  _dbModalsWired = true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════════════════ */

function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _dbToast(msg, isError) {
  // Reuse BookWorm's existing toast if available, else console fallback
  if (typeof _showErrToast === 'function' && isError) {
    _showErrToast(msg);
  } else if (typeof _showSuccessToast === 'function' && !isError) {
    _showSuccessToast(msg);
  } else {
    console.warn('[DB]', msg);
  }
}
