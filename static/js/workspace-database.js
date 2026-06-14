/* workspace-database.js
 * Client-side logic for workspace Database nodes (Notion-inspired card grid).
 * Rules: ALL var — no let/const. All public funcs prefixed db, private _db.
 * Booted by initDatabaseView() — called from htmx:afterSettle AND DOMContentLoaded in index.html.
 */

/* ── module state ─────────────────────────────────────────────────────────── */
var _dbWsId              = null;   // current database workspace id (int)
var _dbCardPreview       = 'cover';// per-database card preview mode: 'cover' | 'content'
var _dbCards             = [];     // array of card objects from server
var _dbSaveTimers        = {};     // {cardId: timeoutId} — per-card note debounce
var _dbDetailId          = null;   // card id currently open in detail panel
var _dbDelTarget         = null;   // card id staged for deletion
var _dbDirtyNote         = null;   // {cardId, html} — latest unsaved note HTML captured on every input
var _dbPanelClickHandler = null;   // click-outside handler attached to #panel
var _dbSizeStep          = 3;      // card size slider step (1=small … 5=large)
var _dbFilterGroups      = []; // [[{key,op,val},…],…] — OR between groups, AND within each group
var _dbSortLevels        = []; // [{key,dir}] — ordered sort levels (first = highest priority)
var _dbGroupBy           = null; // null | {key} — attribute key to group cards by
var _dbColorRules        = []; // [{key,op,val,color}] — first match wins; color = _DB_OPT_COLORS id
var _dbCardVisibleAttrs  = null; // null = show all; array of attr_key strings = only those keys shown on card preview
var _dbCurrentView       = 'grid'; // 'grid' | 'board'

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
  { id: 'date_range',   label: 'Date Range',   icon: '\uD83D\uDCC5' },
  { id: 'progress',     label: 'Progress',     icon: '\uD83D\uDCCA' },
  { id: 'rating',       label: 'Rating',     icon: '\u2B50' },
];

// Icon maps for rating display — on/off chars and active colour.
var _DB_RT_ICON_MAP = {
  star:  { on: '\u2605', off: '\u2606', clr: '#f59e0b' }, // ★/☆ amber
  heart: { on: '\u2665', off: '\u2661', clr: '#ef4444' }, // ♥/♡ red
  thumb: { on: '\uD83D\uDC4D', off: '\u25CB', clr: '#0053e2' }, // 👍/○ walmart blue
  dot:   { on: '\u25CF', off: '\u25CB', clr: '#8b5cf6' }, // ●/○ purple
};

/* ── option colour palette ─────────────────────────────────────────────── */
var _DB_OPT_COLORS = [
  { id: 'gray',   dot: '#9ca3af', bg: '#f3f4f6', text: '#374151', darkBg: '#3f3f46', darkText: '#d4d4d8' },
  { id: 'red',    dot: '#ef4444', bg: '#fef2f2', text: '#dc2626', darkBg: '#450a0a', darkText: '#f87171' },
  { id: 'orange', dot: '#f97316', bg: '#fff7ed', text: '#ea580c', darkBg: '#431407', darkText: '#fb923c' },
  { id: 'yellow', dot: '#eab308', bg: '#fefce8', text: '#b45309', darkBg: '#422006', darkText: '#fbbf24' },
  { id: 'green',  dot: '#22c55e', bg: '#f0fdf4', text: '#16a34a', darkBg: '#052e16', darkText: '#4ade80' },
  { id: 'teal',   dot: '#14b8a6', bg: '#f0fdfa', text: '#0f766e', darkBg: '#042f2e', darkText: '#5eead4' },
  { id: 'blue',   dot: '#3b82f6', bg: '#eff6ff', text: '#2563eb', darkBg: '#172554', darkText: '#60a5fa' },
  { id: 'purple', dot: '#a855f7', bg: '#faf5ff', text: '#9333ea', darkBg: '#3b0764', darkText: '#c084fc' },
  { id: 'pink',   dot: '#ec4899', bg: '#fdf2f8', text: '#db2777', darkBg: '#500724', darkText: '#f472b6' },
];

// Parse "Label|colorId,Label2|colorId2" (or legacy "Label,Label2") → [{label,color}]
// ── files attribute helpers ─────────────────────────────────────────────────

// Parse the JSON-encoded file list stored in attr_value.
// Returns [{name, url}, ...] — empty array on any parse failure.
function _dbParseFiles(v) {
  if (!v) return [];
  try { var arr = JSON.parse(v); return Array.isArray(arr) ? arr : []; }
  catch (e) { return []; }
}

// Build the inner HTML for the files widget (list + action buttons).
// fmt: 'name' (default) | 'short' | 'full'  — controls how each link label is rendered.
function _dbFilesInnerHtml(cardId, attrId, key, files, fmt) {
  var kJ      = _esc(JSON.stringify(key));
  var isDark  = document.documentElement.classList.contains('dark');
  var subTxt  = isDark ? '#a1a1aa' : '#6b7280';
  var bdr     = isDark ? '#3f3f46' : '#e5e7eb';
  var pillBg  = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)';
  var pillClr = isDark ? '#d4d4d8' : '#374151';
  var pillBdr = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
  var linkClr = isDark ? '#93c5fd' : '#0053e2'; // blue-300 in dark, Walmart blue in light
  var dispFmt = fmt || 'name';

  // Outer column — chips row on top, link-input row below (hidden by default)
  var html = '<div style="display:flex;flex-direction:column;gap:0.25rem;">';

  // ── Chips + action buttons — all inline in one flex-wrap row ─────────────
  html += '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.3rem;">';

  for (var i = 0; i < files.length; i++) {
    var f        = files[i];
    var isExt    = /^https?:\/\//i.test(f.url);
    var icon     = isExt ? '\uD83D\uDD17' : '\uD83D\uDCCE';
    var rowId    = '_dbf-row-' + attrId + '-' + i;
    var renId    = '_dbf-ren-' + attrId + '-' + i;
    var renInpId = '_dbf-ren-inp-' + attrId + '-' + i;
    var kJ2      = _esc(JSON.stringify(key));

    var label;
    if (dispFmt === 'full') {
      label = f.url;
    } else if (dispFmt === 'short') {
      label = f.url.replace(/^https?:\/\//, '');
      if (label.length > 28) label = '\u2026' + label.slice(-26);
    } else {
      label = f.name || f.url;
    }
    if (label.length > 22) label = label.slice(0, 20) + '\u2026';

    // ── display chip ──────────────────────────────────────────────────────
    html += '<span id="' + rowId + '"'
      + ' style="display:inline-flex;align-items:center;'
      + 'background:' + pillBg + ';border:1px solid ' + pillBdr + ';color:' + pillClr + ';'
      + 'border-radius:0.375rem;font-size:0.72rem;white-space:nowrap;">';
    // clickable link
    html += '<a href="' + _esc(f.url) + '" target="_blank" rel="noopener"'
      + ' onclick="event.stopPropagation()"'
      + ' style="padding:0.15rem 0.35rem 0.15rem 0.4rem;color:' + linkClr + ';'
      + 'text-decoration:none;overflow:hidden;text-overflow:ellipsis;'
      + 'max-width:140px;white-space:nowrap;font-size:0.72rem;">'
      + icon + '\u00a0' + _esc(label) + '</a>';
    // ✏️ rename (name mode only)
    if (dispFmt === 'name') {
      html += '<button type="button" title="Rename"'
        + ' onclick="event.stopPropagation();_dbFilesStartRename(' + attrId + ',' + i + ')"'
        + ' style="background:none;border:none;cursor:pointer;color:inherit;'
        + 'font-size:0.68rem;line-height:1;padding:0 0.2rem;'
        + 'opacity:0.45;font-family:inherit;"'
        + ' onmouseenter="this.style.opacity=\'1\'" onmouseleave="this.style.opacity=\'0.45\'">'
        + '\u270F\uFE0F</button>';
    }
    // × remove
    html += '<button type="button" title="Remove"'
      + ' onclick="event.stopPropagation();_dbFilesRemove(' + cardId + ',' + attrId + ',' + kJ + ',' + i + ')"'
      + ' style="background:none;border:none;cursor:pointer;color:inherit;'
      + 'font-size:1rem;line-height:1;padding:0 0.3rem 0 0;'
      + 'opacity:0.45;font-family:inherit;"'
      + ' onmouseenter="this.style.opacity=\'1\'" onmouseleave="this.style.opacity=\'0.45\'">'
      + '\u00d7</button>';
    html += '</span>';

    // ── rename chip (inline-flex, hidden until ✏️ clicked) ───────────────
    if (dispFmt === 'name') {
      html += '<span id="' + renId + '"'
        + ' style="display:none;align-items:center;gap:0.2rem;'
        + 'background:' + pillBg + ';border:1px solid #0053e2;'
        + 'border-radius:0.375rem;padding:0.05rem 0.3rem;white-space:nowrap;">'
        + '<input id="' + renInpId + '" type="text" value="' + _esc(f.name || '') + '"'
        + ' placeholder="Display name\u2026"'
        + ' style="font-size:0.72rem;padding:0.05rem 0.2rem;border-radius:0.25rem;'
        + 'border:none;background:transparent;color:inherit;outline:none;width:9rem;"'
        + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();'
        + '_dbFilesRename(' + cardId + ',' + attrId + ',' + kJ2 + ',' + i + ',this.value);}'
        + 'if(event.key===\'Escape\'){_dbFilesCancelRename(' + attrId + ',' + i + ');}"'
        + ' onblur="_dbFilesRename(' + cardId + ',' + attrId + ',' + kJ2 + ',' + i + ',this.value)">'
        + '</span>';
    }
  }

  // ── Upload + Paste link — pushed to far right with margin-left:auto ────────
  html += '<div style="margin-left:auto;display:flex;gap:0.3rem;flex-shrink:0;">';
  html += '<input id="_dbf-inp-' + attrId + '" type="file" style="display:none;"'
    + ' onchange="_dbFilesUpload(' + cardId + ',' + attrId + ',' + kJ + ',this)">';
  html += '<button type="button"'
    + ' onclick="document.getElementById(\'_dbf-inp-' + attrId + '\').click()"'
    + ' style="font-size:0.7rem;padding:0.18rem 0.5rem;border-radius:0.375rem;cursor:pointer;'
    + 'border:1px solid ' + bdr + ';background:transparent;color:' + subTxt + ';white-space:nowrap;">'
    + '\uD83D\uDCCE Upload</button>';
  html += '<button type="button"'
    + ' onclick="_dbFilesAddLink(' + cardId + ',' + attrId + ',' + kJ + ')"'
    + ' style="font-size:0.7rem;padding:0.18rem 0.5rem;border-radius:0.375rem;cursor:pointer;'
    + 'border:1px solid ' + bdr + ';background:transparent;color:' + subTxt + ';white-space:nowrap;">'
    + '\uD83D\uDD17 Paste link</button>';
  html += '</div>'; // end button wrapper
  html += '</div>'; // end chips row

  // ── Link input row (hidden until Paste link clicked) ─────────────────────
  html += '<div id="_dbf-link-' + attrId + '" style="display:none;">';
  html += '<input id="_dbf-link-inp-' + attrId + '" type="url" placeholder="https://\u2026"'
    + ' style="font-size:0.75rem;width:100%;padding:0.25rem 0.4rem;border-radius:0.375rem;'
    + 'border:1px solid ' + bdr + ';box-sizing:border-box;background:transparent;color:inherit;outline:none;"'
    + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();_dbFilesConfirmLink(' + cardId + ',' + attrId + ',' + kJ + ');}'
    + 'if(event.key===\'Escape\'){document.getElementById(\'_dbf-link-' + attrId + '\').style.display=\'none\';}">';
  html += '</div>';

  html += '</div>'; // outer column
  return html;
}

// Public entry point for the detail panel (returns a container div with stable id).
function _dbFilesHtml(cardId, a) {
  var files = _dbParseFiles(a.attr_value || '');
  var fmt   = a.attr_options || 'name';
  return '<div id="_dbf-wrap-' + a.id + '">'
    + _dbFilesInnerHtml(cardId, a.id, a.attr_key, files, fmt)
    + '</div>';
}

// Re-render just the files widget in-place after any change.
function _dbFilesRerender(cardId, attrId, key) {
  var wrap = document.getElementById('_dbf-wrap-' + attrId);
  if (!wrap) return;
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var meta = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var files = _dbParseFiles(meta ? (meta.attr_value || '') : '');
  var fmt   = meta ? (meta.attr_options || 'name') : 'name';
  wrap.innerHTML = _dbFilesInnerHtml(cardId, attrId, key, files, fmt);
}

// Save a new JSON-encoded file list, update in-memory data, then re-render.
function _dbFilesSave(cardId, attrId, key, files) {
  var newVal = JSON.stringify(files);
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var meta = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  if (meta) meta.attr_value = newVal;
  _dbFilesRerender(cardId, attrId, key);
  _dbRenderGrid();
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attr_key: key, attr_value: newVal,
      attr_type: 'files', attr_options: meta ? (meta.attr_options || '') : '',
    }),
  }).catch(function(e) { console.warn('Files attr save failed', e); });
}

// Triggered by the hidden <input type="file">.
function _dbFilesUpload(cardId, attrId, key, inp) {
  var file = inp.files && inp.files[0];
  if (!file) return;
  inp.value = ''; // reset so same file can be re-added if needed
  var statusId = '_dbf-wrap-' + attrId;
  var wrap = document.getElementById(statusId);
  var statusSpan = document.createElement('span');
  statusSpan.style.cssText = 'font-size:0.7rem;color:#6b7280;margin-left:0.4rem;';
  statusSpan.textContent = 'Uploading\u2026';
  if (wrap) wrap.appendChild(statusSpan);

  var fd = new FormData();
  fd.append('file', file);
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs/' + attrId + '/upload-file', {
    method: 'POST',
    body: fd,
  })
  .then(function(r) {
    if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || 'Upload failed'); });
    return r.json();
  })
  .then(function(data) {
    var card = _dbCards.find(function(c) { return c.id === cardId; });
    var meta = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
    var files = _dbParseFiles(meta ? (meta.attr_value || '') : '');
    files.push({ name: data.name, url: data.url, upload_id: data.upload_id || null });
    _dbFilesSave(cardId, attrId, key, files);
  })
  .catch(function(e) {
    if (statusSpan.parentNode) statusSpan.textContent = '\u26a0\ufe0f ' + e.message;
    else _dbToast(e.message, true);
  });
}

// Show the inline link-paste input.
function _dbFilesAddLink(cardId, attrId, key) {
  var row = document.getElementById('_dbf-link-' + attrId);
  var inp = document.getElementById('_dbf-link-inp-' + attrId);
  if (!row) return;
  row.style.display = 'block';
  if (inp) { inp.value = ''; setTimeout(function() { inp.focus(); }, 30); }
}

// Confirm the pasted link and save.
function _dbFilesConfirmLink(cardId, attrId, key) {
  var inp = document.getElementById('_dbf-link-inp-' + attrId);
  if (!inp) return;
  var url = (inp.value || '').trim();
  if (!url) return;
  // derive a friendly display name from the URL
  var name = url.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '') || url;
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var meta = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var files = _dbParseFiles(meta ? (meta.attr_value || '') : '');
  files.push({ name: name, url: url });
  _dbFilesSave(cardId, attrId, key, files);
}

// Remove a file entry by index and save.
// If the entry has an upload_id, DELETE the server record first (synced with Uploads page).
function _dbFilesRemove(cardId, attrId, key, idx) {
  var card  = _dbCards.find(function(c) { return c.id === cardId; });
  var meta  = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var files = _dbParseFiles(meta ? (meta.attr_value || '') : '');
  var entry = files[idx];
  files.splice(idx, 1);

  if (entry && entry.upload_id) {
    fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId
          + '/attrs/' + attrId + '/files/' + entry.upload_id,
      { method: 'DELETE' })
    .then(function() { _dbFilesSave(cardId, attrId, key, files); })
    .catch(function(e) {
      console.warn('Attr file delete failed', e);
      _dbFilesSave(cardId, attrId, key, files); // still remove from UI
    });
  } else {
    _dbFilesSave(cardId, attrId, key, files);
  }
}

// Show the inline rename input for a file entry (name mode only).
function _dbFilesStartRename(attrId, idx) {
  var row = document.getElementById('_dbf-row-' + attrId + '-' + idx);
  var ren = document.getElementById('_dbf-ren-' + attrId + '-' + idx);
  var inp = document.getElementById('_dbf-ren-inp-' + attrId + '-' + idx);
  if (!row || !ren || !inp) return;
  row.style.display = 'none';
  ren.style.display = 'inline-flex'; // pill stays inline in the chip row
  inp.focus();
  inp.select();
}

// Cancel rename — restore the main row without saving.
function _dbFilesCancelRename(attrId, idx) {
  var row = document.getElementById('_dbf-row-' + attrId + '-' + idx);
  var ren = document.getElementById('_dbf-ren-' + attrId + '-' + idx);
  if (!row || !ren) return;
  ren.style.display = 'none';
  row.style.display = 'inline-flex'; // restore pill display
}

// Save a new display name for a file entry at index idx.
function _dbFilesRename(cardId, attrId, key, idx, newName) {
  var trimmed = (newName || '').trim();
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var meta = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var files = _dbParseFiles(meta ? (meta.attr_value || '') : '');
  if (!files[idx]) return;
  // Cancel rename UI first to avoid double-fire from blur + Enter.
  _dbFilesCancelRename(attrId, idx);
  if (!trimmed || trimmed === files[idx].name) return;  // nothing changed
  files[idx] = { name: trimmed, url: files[idx].url, upload_id: files[idx].upload_id || null };
  _dbFilesSave(cardId, attrId, key, files);
}

function _dbParseOptions(optsStr) {
  if (!optsStr) return [];
  return optsStr.split(',').map(function(part) {
    part = part.trim();
    if (!part) return null;
    var pipe = part.indexOf('|');
    if (pipe === -1) return { label: part, color: 'gray' };
    return { label: part.slice(0, pipe).trim(), color: part.slice(pipe + 1).trim() || 'gray' };
  }).filter(Boolean);
}

// Serialize [{label,color}] → "Label|colorId,…"
function _dbSerializeOptions(opts) {
  return opts.map(function(o) {
    var lbl = (o.label || '').trim();
    return lbl ? lbl + '|' + (o.color || 'gray') : '';
  }).filter(Boolean).join(',');
}

// Look up a palette entry by id (falls back to gray)
function _dbOptColorDef(colorId) {
  return _DB_OPT_COLORS.find(function(c) { return c.id === colorId; }) || _DB_OPT_COLORS[0];
}

// Resolve bg + text for current light/dark mode
function _dbOptColorStyle(colorId) {
  var dk  = document.documentElement.classList.contains('dark');
  var def = _dbOptColorDef(colorId);
  return { bg: dk ? def.darkBg : def.bg, text: dk ? def.darkText : def.text };
}

/* ── selection toolbar state ─────────────────────────────────────────────────────── */
var _dbSelBar       = null;  // floating toolbar DOM element
var _dbSelBarTimer  = null;  // hide-debounce timer

/* ── card multi-select state ─────────────────────────────────────────────────── */
var _dbMsActive   = false;   // multiselect mode on/off
var _dbMsSelected = {};      // cardId (string) → true

/* ═══════════════════════════════════════════════════════════════════════════
   ENTRY POINT
═══════════════════════════════════════════════════════════════════════════ */

function initDatabaseView(wsId) {
  // Guard: if this exact db-view-root element has already been initialised (e.g.
  // an HTMX sidebar OOB swap fired htmx:afterSettle while we are still on the
  // same database workspace), do nothing.  A genuine content swap always brings
  // a fresh DOM node without the sentinel attribute, so we will re-init then.
  var _root = document.getElementById('db-view-root');
  if (_root && _root.dataset.bwDbInit === '1') return;
  if (_root) _root.dataset.bwDbInit = '1';
  // Reset modal-wired flag so the new input element gets its listener.
  _dbModalsWired = false;

  _dbWsId = wsId;
  // Databases have their own Add Card flow — New Note doesn't apply here.
  var btnNN = document.getElementById('btn-new-note');
  if (btnNN) btnNN.classList.add('hidden');
  // Show the database view toggle in the top bar; hide the note-view group.
  var _noteGrp = document.getElementById('note-view-toggle-group');
  if (_noteGrp) _noteGrp.classList.add('hidden');
  var _dbGrp = document.getElementById('top-db-view-toggle');
  if (_dbGrp) _dbGrp.classList.remove('hidden');
  // Tighten breadcrumb bottom margin so it doesn't gap-stack with the DB header.
  // Then after layout, measure its rendered height and offset the DB header's
  // sticky top so both bars stack cleanly without overlapping.
  var crumbNav = document.querySelector('#ws-breadcrumb nav');
  if (crumbNav) { crumbNav._bwOldMb = crumbNav.className; crumbNav.classList.remove('mb-5'); crumbNav.classList.add('mb-1'); }
  requestAnimationFrame(function() {
    var crumbEl  = document.getElementById('ws-breadcrumb');
    var headerEl = document.getElementById('db-header-bar');
    if (headerEl) {
      var crumbH = crumbEl ? crumbEl.offsetHeight : 0;
      headerEl.style.top = crumbH ? crumbH + 'px' : '';
    }
  });
  // Card preview mode (per-database, server-persisted) — read from the root.
  _dbCardPreview = (_root && _root.dataset.cardPreview === 'content') ? 'content' : 'cover';
  var raw = document.getElementById('db-cards-data');
  _dbCards = raw ? JSON.parse(raw.textContent || '[]') : [];
  _dbFilterGroups = [];
  _dbSortLevels    = [];
  _dbGroupBy       = null;
  _dbCurrentView   = 'grid';
  _dbCardVisibleAttrs = null;
  _dbLoadFilterSort(_dbWsId);
  _dbUpdateViewButtons();
  _dbUpdateFilterBadge();   // restore badge count after page refresh
  // Close any stale filter/fields panel from a previous workspace
  var _stalePanel = document.getElementById('db-filter-panel');
  if (_stalePanel) _stalePanel.remove();
  var _staleFieldsPanel = document.getElementById('db-fields-panel');
  if (_staleFieldsPanel) _staleFieldsPanel.remove();
  _dbUpdateFieldsBadge();   // restore fields badge after page refresh
  // Restore saved size preference (stored per-workspace so each DB is independent)
  var saved = parseInt(localStorage.getItem('_dbSize_' + wsId), 10);
  _dbSizeStep = (saved >= 1 && saved <= 5) ? saved : 3;
  _dbApplySize(_dbSizeStep);
  _dbApplyCardPreviewUI();
  _dbRenderGrid();
  _dbBindModals();
  _dbInitStyles();
  _dbSelToolbarInit();
  _dbMsWireGrid();
  // Deep-link: ?open_card=N opens the card detail panel on page load.
  var _ocParam = new URLSearchParams(window.location.search).get('open_card');
  if (_ocParam) {
    setTimeout(function() { _dbOpenDetail(parseInt(_ocParam, 10)); }, 80);
  }
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
  var cols = 'repeat(auto-fill, minmax(' + cfg.minW + ', 1fr))';
  if (root) {
    root.style.setProperty('--db-cover-h', cfg.coverH);
  }
  if (grid) {
    if (_dbCurrentView !== 'board') {
      grid.style.gridTemplateColumns = cols;
    }
    // Also update any sub-grids rendered in group-by mode
    grid.querySelectorAll('.db-sub-grid').forEach(function(sg) {
      sg.style.gridTemplateColumns = cols;
    });
    // Re-render board columns if in board mode so column widths update live
    if (_dbCurrentView === 'board') {
      _dbRenderGrid();
    }
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
  // Exit multiselect before blowing away innerHTML so state is consistent.
  if (_dbMsActive) _dbMsExit();
  var grid    = document.getElementById('db-card-grid');
  var empty   = document.getElementById('db-empty-state');
  var noMatch = document.getElementById('db-no-matches');
  var count   = document.getElementById('db-card-count');
  if (!grid) return;

  var total     = _dbCards.length;
  var display   = _dbGetDisplayCards();
  var shown     = display.length;
  var hasFilter = _dbFilterGroups.some(function(g) { return g.length > 0; })
                  || _dbSortLevels.length > 0 || !!_dbGroupBy;

  if (count) {
    count.textContent = (hasFilter && shown !== total)
      ? shown + '\u202f/\u202f' + total + ' card' + (total !== 1 ? 's' : '')
      : total + ' card' + (total !== 1 ? 's' : '');
  }

  if (total === 0) {
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = '';
    if (empty)   empty.classList.remove('hidden');
    if (noMatch) noMatch.classList.add('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  if (shown === 0) {
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = '';
    if (noMatch) noMatch.classList.remove('hidden');
    return;
  }
  if (noMatch) noMatch.classList.add('hidden');

  // ── board mode ──
  if (_dbCurrentView === 'board') {
    _dbRenderBoard(grid, display);
    return;
  }

  // ── grouped mode ──
  if (_dbGroupBy && _dbGroupBy.key) {
    _dbRenderGrouped(grid, display);
    return;
  }

  // ── flat mode ──
  var cfg  = _dbSizeCfg[(_dbSizeStep - 1)] || _dbSizeCfg[2];
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(' + cfg.minW + ', 1fr))';
  grid.innerHTML = display.map(function(c) { return _dbCardHtml(c); }).join('');
}

function _dbRenderGrouped(grid, display) {
  var key     = _dbGroupBy.key;
  var cfg     = _dbSizeCfg[(_dbSizeStep - 1)] || _dbSizeCfg[2];
  var isDark  = document.documentElement.classList.contains('dark');
  var sub     = isDark ? '#71717a' : '#6b7280';
  var bdr     = isDark ? '#3f3f46' : '#e5e7eb';
  var hdrTxt  = isDark ? '#f4f4f5' : '#111827';
  var cols    = 'repeat(auto-fill, minmax(' + cfg.minW + ', 1fr))';

  // Detect attr type for group key (for colored pill rendering)
  var attrKeys = _dbGetAttrKeys();
  var keyMeta  = attrKeys.find(function(ak) { return ak.key === key; }) || { type: 'text' };
  var isPillType = keyMeta.type === 'select' || keyMeta.type === 'status' || keyMeta.type === 'multi_select';

  // Bucket cards: ordered map preserving first-seen order. Empty value goes last.
  var order   = [];
  var buckets = {};
  display.forEach(function(c) {
    var val = _dbCardAttrVal(c, key).trim();
    var bucket = val || '__empty__';
    if (!buckets[bucket]) {
      buckets[bucket] = [];
      if (val) order.push(val); else if (order.indexOf('__empty__') === -1) order.push('__empty__');
    }
    buckets[bucket].push(c);
  });
  // empty-value group always last
  if (buckets['__empty__'] && order[order.length - 1] !== '__empty__') {
    order = order.filter(function(v) { return v !== '__empty__'; });
    order.push('__empty__');
  }

  // Build HTML
  grid.style.gridTemplateColumns = '';
  var html = '';
  order.forEach(function(val) {
    var cards  = buckets[val] || [];
    var isEmpty = val === '__empty__';
    var label  = isEmpty ? ('No ' + _dbKeyLabel(key)) : val;

    // Group header
    html += '<div class="db-group-section" style="margin-bottom:1.5rem">';

    // Header row: colored pill (if select/status) or plain label
    html += '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;'
          + 'padding-bottom:0.4rem;border-bottom:1px solid ' + bdr + ';">';

    if (!isEmpty && isPillType) {
      // Find color from options
      var opts    = _dbGetAttrOptions(key);
      var optMeta = opts.find(function(o) { return o.label === val; });
      var cs      = _dbOptColorStyle(optMeta ? optMeta.color : 'gray');
      html += '<span style="display:inline-flex;align-items:center;padding:0.18rem 0.65rem;'
            + 'border-radius:9999px;font-size:0.72rem;font-weight:600;'
            + 'background:' + cs.bg + ';color:' + cs.text + ';">' + _esc(label) + '</span>';
    } else {
      html += '<span style="font-size:0.8rem;font-weight:700;color:'
            + (isEmpty ? sub : hdrTxt) + ';font-style:' + (isEmpty ? 'italic' : 'normal') + ';">' + _esc(label) + '</span>';
    }
    html += '<span style="font-size:0.7rem;color:' + sub + ';">' + cards.length + ' card' + (cards.length !== 1 ? 's' : '') + '</span>';
    html += '</div>';

    // Sub-grid
    html += '<div class="db-sub-grid" style="display:grid;gap:1rem;'
          + 'grid-template-columns:' + cols + ';">';
    html += cards.map(function(c) { return _dbCardHtml(c); }).join('');
    html += '</div>';

    html += '</div>'; // .db-group-section
  });

  grid.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOARD RENDERING
═══════════════════════════════════════════════════════════════════════════ */

// Board column widths per size step (1–5)
var _dbBoardColW = ['200px', '240px', '280px', '340px', '400px'];

function _dbRenderBoard(grid, display) {
  var scrollArea = document.getElementById('db-scroll-area');
  var isDark     = document.documentElement.classList.contains('dark');

  // Switch scroll area to horizontal flow
  if (scrollArea) {
    scrollArea.style.overflowY  = 'hidden';
    scrollArea.style.overflowX  = 'auto';
    scrollArea.style.padding    = '1rem 1.5rem';
  }
  // The grid becomes a horizontal flex container; disable the CSS grid column template
  grid.style.gridTemplateColumns = '';
  grid.style.display   = 'flex';
  grid.style.flexWrap  = 'nowrap';
  grid.style.gap       = '1rem';
  grid.style.height    = '100%';

  // ── resolve grouping key (prefer saved group-by if it's a pill type, else auto-pick) ──
  var PILL_TYPES = ['select', 'status', 'multi_select'];
  var allKeys    = _dbGetAttrKeys();
  var key        = null;
  if (_dbGroupBy && _dbGroupBy.key) {
    var meta = allKeys.find(function(k) { return k.key === _dbGroupBy.key; });
    if (meta && PILL_TYPES.indexOf(meta.type) !== -1) key = _dbGroupBy.key;
  }
  if (!key) {
    var firstPill = allKeys.find(function(k) { return PILL_TYPES.indexOf(k.type) !== -1; });
    if (firstPill) key = firstPill.key;
  }

  // No groupable attribute — show guidance
  if (!key) {
    var sub  = isDark ? '#71717a' : '#9ca3af';
    var main = isDark ? '#d4d4d8' : '#374151';
    grid.style.display  = 'flex';
    grid.style.flexWrap = 'wrap';
    grid.innerHTML = '<div style="width:100%;display:flex;flex-direction:column;align-items:center;'
      + 'justify-content:center;padding:4rem 1rem;text-align:center;">'
      + '<div style="font-size:2.5rem;margin-bottom:0.75rem">&#128203;</div>'
      + '<p style="color:' + main + ';font-size:0.875rem;font-weight:600;margin-bottom:0.25rem;">'
      + 'No Select or Status field found</p>'
      + '<p style="color:' + sub  + ';font-size:0.75rem;">'
      + 'Board view groups cards by a <strong>Select</strong> or <strong>Status</strong> attribute.<br>'
      + 'Open any card and add one to get started.</p></div>';
    return;
  }

  // ── bucket cards into ordered columns ──
  var opts    = _dbGetAttrOptions(key);           // [{label, color}] in user-defined order
  var keyMeta = allKeys.find(function(k) { return k.key === key; }) || { type: 'select' };
  var colW    = _dbBoardColW[(_dbSizeStep - 1)] || '280px';

  // Prime buckets in option order so empty columns still appear
  var order   = opts.map(function(o) { return o.label; });
  var buckets = {};
  order.forEach(function(lbl) { buckets[lbl] = []; });
  buckets['__empty__'] = [];

  display.forEach(function(c) {
    var val = _dbCardAttrVal(c, key).trim();
    if (!val || !buckets.hasOwnProperty(val)) {
      // Unknown / missing value goes into a column named after the value, or empty
      if (val) {
        if (!buckets[val]) { buckets[val] = []; order.push(val); }
      } else {
        buckets['__empty__'].push(c);
        return;
      }
    }
    buckets[val].push(c);
  });
  order.push('__empty__');

  // ── build HTML ──
  var sub2   = isDark ? '#71717a' : '#9ca3af';
  var html   = '';

  order.forEach(function(val) {
    var isEmpty = val === '__empty__';
    var cards   = buckets[val] || [];
    var label   = isEmpty ? ('No ' + _dbKeyLabel(key)) : val;
    var optMeta = opts.find(function(o) { return o.label === val; });
    var cs      = _dbOptColorStyle((optMeta || {}).color || 'gray');

    html += '<div class="db-board-col" style="'
          + 'flex:0 0 ' + colW + ';width:' + colW + ';'
          + 'display:flex;flex-direction:column;">';

    // Column header
    html += '<div style="'
          + 'display:flex;align-items:center;gap:0.5rem;'
          + 'padding:0.4rem 0.25rem 0.6rem;'
          + 'flex-shrink:0;">';

    if (!isEmpty && (keyMeta.type === 'select' || keyMeta.type === 'status' || keyMeta.type === 'multi_select')) {
      html += '<span style="display:inline-flex;align-items:center;padding:0.15rem 0.55rem;'
            + 'border-radius:9999px;font-size:0.7rem;font-weight:700;'
            + 'background:' + cs.bg + ';color:' + cs.text + ';">'
            + _esc(label) + '</span>';
    } else {
      html += '<span style="font-size:0.75rem;font-weight:700;color:' + sub2 + ';font-style:italic;">'
            + _esc(label) + '</span>';
    }
    html += '<span style="margin-left:auto;font-size:0.7rem;color:' + sub2 + ';font-weight:500;">'
          + cards.length + '</span>';
    html += '</div>';

    // Cards area — independently scrollable
    html += '<div style="flex:1;overflow-y:auto;padding:0.5rem;display:flex;flex-direction:column;gap:0.5rem;min-height:0;">';
    html += cards.map(function(c) { return _dbCardHtml(c); }).join('');
    html += '</div>';
    html += '</div>';
  });

  grid.innerHTML = html;
}

// Sync the single view-toggle button icon + state after any view change.
function _dbUpdateViewButtons() {
  var btn       = document.getElementById('db-view-toggle-btn');
  var iconBoard = document.getElementById('db-icon-board');
  var iconGrid  = document.getElementById('db-icon-grid');
  var tlBtn     = document.getElementById('db-tl-btn');
  var isBoard   = (_dbCurrentView === 'board');
  var isTl      = (_dbCurrentView === 'timeline');

  // Grid/Board icon: show the icon for what you’ll switch TO
  if (iconBoard) iconBoard.classList.toggle('hidden', isBoard);
  if (iconGrid)  iconGrid.classList.toggle('hidden',  !isBoard);

  // Grid/Board button: lit when board is active (timeline uses its own btn)
  if (btn) {
    btn.classList.toggle('bg-white/30',   isBoard);
    btn.classList.toggle('ring-2',        isBoard);
    btn.classList.toggle('ring-white/60', isBoard);
    btn.title = isBoard ? 'Switch to grid view' : 'Switch to board view';
    btn.setAttribute('aria-label',  btn.title);
    btn.setAttribute('aria-pressed', isBoard ? 'true' : 'false');
  }

  // Timeline button: lit when timeline is active
  if (tlBtn) {
    tlBtn.classList.toggle('bg-white/30',   isTl);
    tlBtn.classList.toggle('ring-2',        isTl);
    tlBtn.classList.toggle('ring-white/60', isTl);
    tlBtn.title = isTl ? 'Return to database view' : 'Timeline view';
    tlBtn.setAttribute('aria-label',  tlBtn.title);
    tlBtn.setAttribute('aria-pressed', isTl ? 'true' : 'false');
  }
}

// Public: cycle between grid and board (timeline has its own dedicated toggle).
window.dbToggleView = function() {
  // If timeline is active, pressing grid/board exits timeline first.
  if (_dbCurrentView === 'timeline') { window.dbTimelineToggle(); return; }
  window.dbSetView(_dbCurrentView === 'grid' ? 'board' : 'grid');
};

// Public: mount / unmount the timeline overlay for DB view.
// Remembers the prior grid/board view so toggling off restores it cleanly.
var _dbPreTimelineView = 'grid';   // last non-timeline view
window.dbTimelineToggle = function() {
  var _tl = typeof bwTimeline !== 'undefined' && bwTimeline;
  if (!_tl) return;
  if (_dbCurrentView === 'timeline') {
    // Exit timeline — unmount overlay, restore previous grid/board view
    _tl.unmount();
    _dbCurrentView = _dbPreTimelineView;
    _dbUpdateViewButtons();
  } else {
    // Enter timeline
    _dbPreTimelineView = _dbCurrentView;   // remember grid or board
    _dbCurrentView = 'timeline';
    _dbUpdateViewButtons();
    _tl.mount();
  }
};

// Public: switch view and re-render. Called from HTML onclick.
window.dbSetView = function(viewId) {
  if (_dbCurrentView === viewId) return;
  // If timeline is currently active, unmount it before switching to grid/board.
  var _tl = typeof bwTimeline !== 'undefined' && bwTimeline;
  if (_dbCurrentView === 'timeline' && _tl && _tl.isMounted()) _tl.unmount();
  _dbCurrentView = viewId;
  _dbSaveFilterSort();
  _dbUpdateViewButtons();

  // Reset scroll area styling when returning to grid mode
  if (viewId === 'grid') {
    var scrollArea = document.getElementById('db-scroll-area');
    if (scrollArea) {
      scrollArea.style.overflowY = '';
      scrollArea.style.overflowX = '';
      scrollArea.style.padding   = '';
    }
    var grid = document.getElementById('db-card-grid');
    if (grid) {
      grid.style.display  = '';
      grid.style.flexWrap = '';
      grid.style.gap      = '';
      grid.style.height   = '';
    }
    _dbApplySize(_dbSizeStep); // restore grid column template
  }
  _dbRenderGrid();
};

/* ═══════════════════════════════════════════════════════════════════════════
   FILTER · SORT ENGINE
═══════════════════════════════════════════════════════════════════════════ */

// Human-readable label for a built-in or custom attr key.
function _dbKeyLabel(key) {
  if (key === '__title')   return 'Title';
  if (key === '__created') return 'Created';
  if (key === '__updated') return 'Last Updated';
  return key;
}

// Collect all unique option objects {label,color} for a select/multi_select/status attr key.
function _dbGetAttrOptions(key) {
  var seen   = {};
  var opts   = [];
  _dbCards.forEach(function(c) {
    (c.attrs || []).forEach(function(a) {
      if (a.attr_key !== key) return;
      _dbParseOptions(a.attr_options || '').forEach(function(o) {
        if (o.label && !seen[o.label]) {
          seen[o.label] = true;
          opts.push({ label: o.label, color: o.color || 'gray' });
        }
      });
    });
  });
  return opts;
}

// Persist filter groups + sort levels to localStorage (keyed by workspace).
function _dbSaveFilterSort() {
  if (!_dbWsId) return;
  try {
    localStorage.setItem(
      '_dbFS_' + _dbWsId,
      JSON.stringify({
        groups:       _dbFilterGroups,
        sort:         _dbSortLevels,
        groupBy:      _dbGroupBy,
        colorRules:   _dbColorRules,
        visibleAttrs: _dbCardVisibleAttrs,
        view:         _dbCurrentView,
      })
    );
  } catch(e) {}
}

// Load persisted filter groups + sort levels from localStorage.
function _dbLoadFilterSort(wsId) {
  try {
    var raw = localStorage.getItem('_dbFS_' + wsId);
    if (!raw) return;
    var data = JSON.parse(raw);
    if (Array.isArray(data.groups))     _dbFilterGroups     = data.groups;
    if (Array.isArray(data.sort))       _dbSortLevels       = data.sort;
    if (data.groupBy !== undefined)     _dbGroupBy          = data.groupBy || null;
    if (Array.isArray(data.colorRules)) _dbColorRules       = data.colorRules;
    if (data.view === 'board' || data.view === 'grid') _dbCurrentView = data.view;
    // visibleAttrs: null means show-all; an array means only show those keys
    if (data.visibleAttrs === null || Array.isArray(data.visibleAttrs)) {
      _dbCardVisibleAttrs = data.visibleAttrs;
    }
  } catch(e) {}
}

// Returns all unique attr keys across all cards.
// Each entry: { key, type } where type is the most-common attr_type for that key.
// Prepends two built-ins: __title and __updated.
function _dbGetAttrKeys() {
  var map = {};  // key -> {type -> count}
  _dbCards.forEach(function(c) {
    (c.attrs || []).forEach(function(a) {
      var k = a.attr_key;
      if (!k) return;
      if (!map[k]) map[k] = {};
      var t = a.attr_type || 'text';
      map[k][t] = (map[k][t] || 0) + 1;
    });
  });
  var keys = Object.keys(map).map(function(k) {
    var counts = map[k];
    var best   = Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; })[0];
    return { key: k, type: best || 'text' };
  });
  return [
    { key: '__title',   type: 'text' },
    { key: '__created', type: 'date' },
    { key: '__updated', type: 'date' },
  ].concat(keys);
}

// Returns the operators valid for a given attr type.
function _dbOpsForType(type) {
  var text = [
    { op: 'contains',     label: 'contains'         },
    { op: 'not_contains', label: 'does not contain'  },
    { op: 'is',           label: 'is exactly'        },
    { op: 'is_not',       label: 'is not'            },
    { op: 'empty',        label: 'is empty'          },
    { op: 'not_empty',    label: 'is not empty'      },
  ];
  var num = [
    { op: 'eq',        label: '='       },
    { op: 'neq',       label: '≠'       },
    { op: 'gt',        label: '>'       },
    { op: 'gte',       label: '≥'       },
    { op: 'lt',        label: '<'       },
    { op: 'lte',       label: '≤'       },
    { op: 'empty',     label: 'is empty'      },
    { op: 'not_empty', label: 'is not empty'  },
  ];
  var check = [
    { op: 'checked',     label: 'is checked'    },
    { op: 'not_checked', label: 'is not checked' },
  ];
  var anyOf = [
    { op: 'is_any_of',  label: 'is any of'  },
    { op: 'is_none_of', label: 'is none of' },
    { op: 'empty',      label: 'is empty'   },
    { op: 'not_empty',  label: 'is not empty' },
  ];
  var hasOf = [
    { op: 'has_any_of', label: 'has any of' },
    { op: 'has_all_of', label: 'has all of' },
    { op: 'has_none_of',label: 'has none of'},
    { op: 'empty',      label: 'is empty'   },
    { op: 'not_empty',  label: 'is not empty' },
  ];
  if (type === 'checkbox')    return check;
  if (type === 'number')      return num;
  if (type === 'date')        return num.slice(2).concat(num.slice(6));
  if (type === 'multi_select') return hasOf;
  if (type === 'select' || type === 'status') return anyOf;
  return text;   // text, person, phone, place, url, email, files
}

// Returns the raw string value of a card attribute by key.
// Special keys __title and __updated map to card.title / card.updated_at.
function _dbCardAttrVal(card, key) {
  if (key === '__title')   return card.title   || '';
  if (key === '__created') return card.created_at  ? card.created_at.slice(0, 10)  : '';
  if (key === '__updated') return card.updated_at  ? card.updated_at.slice(0, 10)  : '';
  var a = (card.attrs || []).find(function(x) { return x.attr_key === key; });
  return a ? (a.attr_value || '') : '';
}

// Tests one card against one filter. Returns true if the card passes.
function _dbFilterMatch(card, f) {
  var raw  = _dbCardAttrVal(card, f.key);
  var val  = (raw  || '').toLowerCase().trim();
  var cmp  = (f.val || '').toLowerCase().trim();
  var op   = f.op;

  if (op === 'empty')       return val === '';
  if (op === 'not_empty')   return val !== '';
  if (op === 'checked')     return val === 'true' || val === '1' || val === 'yes';
  if (op === 'not_checked') return !(val === 'true' || val === '1' || val === 'yes');
  if (op === 'contains')    return val.indexOf(cmp) !== -1;
  if (op === 'not_contains') return val.indexOf(cmp) === -1;
  if (op === 'is')          return val === cmp;
  if (op === 'is_not')      return val !== cmp;

  // Multi-pick operators — f.val is a JSON array string ["A","B",...]
  var picked = [];
  try { picked = JSON.parse(f.val || '[]'); } catch(e) { picked = []; }
  var pickedLow = picked.map(function(s) { return (s || '').toLowerCase().trim(); });
  // Card value for multi_select is comma-split; for select/status it's a single token
  var cardVals = val.split(',').map(function(s) { return s.trim(); }).filter(Boolean);

  if (op === 'is_any_of')  return pickedLow.length === 0 || pickedLow.indexOf(val.trim()) !== -1;
  if (op === 'is_none_of') return pickedLow.length === 0 || pickedLow.indexOf(val.trim()) === -1;
  if (op === 'has_any_of') return pickedLow.length === 0 || cardVals.some(function(cv) { return pickedLow.indexOf(cv) !== -1; });
  if (op === 'has_all_of') return pickedLow.length === 0 || pickedLow.every(function(p)  { return cardVals.indexOf(p) !== -1; });
  if (op === 'has_none_of')return pickedLow.length === 0 || !cardVals.some(function(cv) { return pickedLow.indexOf(cv) !== -1; });

  // Numeric / date comparisons
  var n  = parseFloat(raw);
  var nc = parseFloat(f.val);
  if (isNaN(n) || isNaN(nc)) {
    // fall back to string compare for dates (ISO strings sort correctly)
    if (op === 'eq')  return raw === f.val;
    if (op === 'neq') return raw !== f.val;
    if (op === 'gt')  return raw >  f.val;
    if (op === 'gte') return raw >= f.val;
    if (op === 'lt')  return raw <  f.val;
    if (op === 'lte') return raw <= f.val;
  } else {
    if (op === 'eq')  return n === nc;
    if (op === 'neq') return n !== nc;
    if (op === 'gt')  return n >  nc;
    if (op === 'gte') return n >= nc;
    if (op === 'lt')  return n <  nc;
    if (op === 'lte') return n <= nc;
  }
  return true;
}

// Returns the filtered + sorted subset of _dbCards for display.
function _dbGetDisplayCards() {
  var cards = _dbCards.slice(); // shallow copy — do not mutate _dbCards

  // ── filter (OR between groups, AND within each group) ──
  var activeGroups = _dbFilterGroups.filter(function(g) { return g.length > 0; });
  if (activeGroups.length > 0) {
    cards = cards.filter(function(c) {
      return activeGroups.some(function(group) {
        return group.every(function(f) { return _dbFilterMatch(c, f); });
      });
    });
  }

  // ── sort (multi-level: first level is highest priority) ──
  if (_dbSortLevels.length > 0) {
    cards.sort(function(a, b) {
      for (var si = 0; si < _dbSortLevels.length; si++) {
        var sl  = _dbSortLevels[si];
        var dir = sl.dir === 'desc' ? -1 : 1;
        var av  = (_dbCardAttrVal(a, sl.key) || '').trim();
        var bv  = (_dbCardAttrVal(b, sl.key) || '').trim();
        var an  = parseFloat(av), bn = parseFloat(bv);
        var cmp = (!isNaN(an) && !isNaN(bn))
                  ? (an - bn) * dir
                  : (av < bv ? -dir : av > bv ? dir : 0);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }
  return cards;
}

// Update the small badge (active-filter count) on the filter icon button.
function _dbUpdateFilterBadge() {
  var btn   = document.getElementById('db-filter-btn');
  if (!btn) return;
  var old   = btn.querySelector('.db-filter-badge');
  var total = _dbFilterGroups.reduce(function(s, g) { return s + g.length; }, 0)
            + _dbSortLevels.length
            + (_dbGroupBy ? 1 : 0)
            + _dbColorRules.length;
  if (total === 0) {
    if (old) old.remove();
    btn.classList.remove('text-purple-600', 'dark:text-purple-400');
    btn.classList.add('text-gray-400');
    return;
  }
  btn.classList.remove('text-gray-400');
  btn.classList.add('text-purple-600', 'dark:text-purple-400');
  if (!old) {
    var badge = document.createElement('span');
    badge.className = 'db-filter-badge';
    badge.style.cssText =
      'position:absolute;top:-3px;right:-3px;min-width:14px;height:14px;'
      + 'border-radius:9999px;font-size:9px;font-weight:700;line-height:14px;'
      + 'text-align:center;padding:0 3px;'
      + 'background:#7c3aed;color:#fff;pointer-events:none;';
    btn.appendChild(badge);
    old = badge;
  }
  old.textContent = total;
}

// Clear all filters + sort state, close panel, refresh grid.
function _dbClearFilters() {
  _dbFilterGroups = [];
  _dbSortLevels    = [];
  _dbColorRules    = [];
  _dbSaveFilterSort();
  var panel = document.getElementById('db-filter-panel');
  if (panel) panel.remove();
  _dbUpdateFilterBadge();
  _dbRenderGrid();
}

/* ─── Card preview fields badge ────────────────────────────────────────── */
// Updates the dot on #db-fields-btn: purple when some attrs are hidden, grey otherwise.
function _dbUpdateFieldsBadge() {
  var btn = document.getElementById('db-fields-btn');
  if (!btn) return;
  var old = btn.querySelector('.db-fields-badge');
  // Count attrs that exist across all cards but are hidden
  var allKeys = _dbGetAttrKeys().filter(function(ak) {
    return ak.key !== '__title' && ak.key !== '__created' && ak.key !== '__updated';
  });
  var hiddenCount = (_dbCardVisibleAttrs === null)
    ? 0
    : allKeys.filter(function(ak) {
        return _dbCardVisibleAttrs.indexOf(ak.key) === -1;
      }).length;
  if (hiddenCount === 0) {
    if (old) old.remove();
    btn.classList.remove('text-purple-600', 'dark:text-purple-400');
    btn.classList.add('text-gray-400');
    return;
  }
  btn.classList.remove('text-gray-400');
  btn.classList.add('text-purple-600', 'dark:text-purple-400');
  if (!old) {
    var badge = document.createElement('span');
    badge.className = 'db-fields-badge';
    badge.style.cssText =
      'position:absolute;top:-3px;right:-3px;min-width:14px;height:14px;'
      + 'border-radius:9999px;font-size:9px;font-weight:700;line-height:14px;'
      + 'text-align:center;padding:0 3px;'
      + 'background:#7c3aed;color:#fff;pointer-events:none;';
    btn.appendChild(badge);
    old = badge;
  }
  old.textContent = hiddenCount;
}

/* ─── Card preview fields toggle panel ─────────────────────────────────── */
// Lists all user-defined attr keys with an eye-on/eye-off toggle for each one.
function _dbToggleFieldsPanel() {
  var existing = document.getElementById('db-fields-panel');
  if (existing) { existing.remove(); return; }

  // Also close filter panel if open
  var fp = document.getElementById('db-filter-panel');
  if (fp) fp.remove();

  var btn    = document.getElementById('db-fields-btn');
  var isDark = document.documentElement.classList.contains('dark');
  var panelBg = isDark ? '#1c1c1f' : '#ffffff';
  var bdr     = isDark ? '#3f3f46' : '#e5e7eb';
  var txt     = isDark ? '#f4f4f5' : '#111827';
  var sub     = isDark ? '#71717a' : '#6b7280';
  var rowHov  = isDark ? '#27272a' : '#f9fafb';

  var rect     = btn ? btn.getBoundingClientRect() : { bottom: 56, right: 300 };
  var isMobile  = window.innerWidth < 768;
  var rightPx   = isMobile ? 8 : (window.innerWidth - rect.right);

  var panel = document.createElement('div');
  panel.id  = 'db-fields-panel';
  panel.style.cssText =
    'position:fixed;top:' + (rect.bottom + 6) + 'px;'
    + 'right:' + rightPx + 'px;'
    + 'z-index:9500;width:280px;max-width:calc(100vw - 1rem);'
    + 'background:' + panelBg + ';border:1px solid ' + bdr + ';'
    + 'border-radius:0.75rem;padding:0.85rem;'
    + 'box-shadow:0 8px 32px rgba(0,0,0,0.18);'
    + 'display:flex;flex-direction:column;gap:0.5rem;';

  // Header
  var hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:0.65rem;font-weight:700;text-transform:uppercase;'
    + 'letter-spacing:0.06em;color:' + sub + ';margin-bottom:0.2rem;';
  hdr.textContent = 'Card preview fields';
  panel.appendChild(hdr);

  // Collect user-defined attr keys (skip built-ins — title/updated are always shown)
  var attrKeys = _dbGetAttrKeys().filter(function(ak) {
    return ak.key !== '__title' && ak.key !== '__created' && ak.key !== '__updated';
  });

  if (attrKeys.length === 0) {
    var empty = document.createElement('p');
    empty.style.cssText = 'font-size:0.75rem;color:' + sub + ';text-align:center;padding:0.5rem 0;';
    empty.textContent = 'No fields yet — add attributes to cards.';
    panel.appendChild(empty);
  } else {
    // Helper: is a key currently visible?
    function _isVisible(key) {
      return _dbCardVisibleAttrs === null ||
             _dbCardVisibleAttrs.indexOf(key) !== -1;
    }

    // SVG eye-on / eye-off icons
    var EYE_ON  = '<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">'
      + '<path stroke-linecap="round" stroke-linejoin="round"'
      + ' d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>'
      + '<path stroke-linecap="round" stroke-linejoin="round"'
      + ' d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7'
      + '-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>'
      + '</svg>';
    var EYE_OFF = '<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">'
      + '<path stroke-linecap="round" stroke-linejoin="round"'
      + ' d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7'
      + 'a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243'
      + 'M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29'
      + 'm7.532 7.532l3.29 3.29M3 3l3.59 3.59'
      + 'm0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7'
      + 'a10.025 10.025 0 01-4.132 5.411M3 3l18 18"/>'
      + '</svg>';

    // Icon for attr type
    function _typeIcon(type) {
      var m = _DB_ATTR_TYPES.find(function(t) { return t.id === type; });
      return m ? m.icon : '\uD83D\uDCDD';
    }

    // Render all rows into a scrollable list
    var list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:0.15rem;'
      + 'max-height:280px;overflow-y:auto;';

    attrKeys.forEach(function(ak) {
      var row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:center;gap:0.5rem;'
        + 'padding:0.3rem 0.4rem;border-radius:0.375rem;cursor:pointer;'
        + 'transition:background 0.1s;';
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.title = _isVisible(ak.key) ? 'Hide from card preview' : 'Show on card preview';

      row.onmouseenter = function() { row.style.background = rowHov; };
      row.onmouseleave = function() { row.style.background = ''; };

      var icon = document.createElement('span');
      icon.style.cssText = 'font-size:0.8rem;width:1.1rem;text-align:center;flex-shrink:0;';
      icon.textContent = _typeIcon(ak.type);

      var label = document.createElement('span');
      label.style.cssText = 'flex:1;font-size:0.8rem;color:' + txt
        + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      label.textContent = _dbKeyLabel(ak.key);

      var eyeBtn = document.createElement('span');
      eyeBtn.style.cssText = 'flex-shrink:0;color:'
        + (_isVisible(ak.key) ? '#7c3aed' : sub) + ';';
      eyeBtn.innerHTML = _isVisible(ak.key) ? EYE_ON : EYE_OFF;

      function _toggleRow(key, eyeEl, rowEl) {
        // Build new array from current state
        var wasShowAll = _dbCardVisibleAttrs === null;
        var currentKeys = wasShowAll
          ? attrKeys.map(function(x) { return x.key; })  // expand null to all
          : _dbCardVisibleAttrs.slice();

        var idx = currentKeys.indexOf(key);
        if (idx === -1) {
          currentKeys.push(key);  // show it
        } else {
          currentKeys.splice(idx, 1);  // hide it
        }
        // If all keys are now visible, collapse back to null (show-all)
        var allVisible = attrKeys.every(function(x) {
          return currentKeys.indexOf(x.key) !== -1;
        });
        _dbCardVisibleAttrs = allVisible ? null : currentKeys;
        _dbSaveFilterSort();
        _dbUpdateFieldsBadge();
        _dbRenderGrid();

        // Update this row’s eye icon + colour in place
        var nowVis = _isVisible(key);
        eyeEl.innerHTML    = nowVis ? EYE_ON : EYE_OFF;
        eyeEl.style.color  = nowVis ? '#7c3aed' : sub;
        rowEl.title = nowVis ? 'Hide from card preview' : 'Show on card preview';
      }

      row.onclick = function() { _toggleRow(ak.key, eyeBtn, row); };
      row.onkeydown = function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _toggleRow(ak.key, eyeBtn, row);
        }
      };

      row.appendChild(icon);
      row.appendChild(label);
      row.appendChild(eyeBtn);
      list.appendChild(row);
    });

    panel.appendChild(list);

    // Footer: Show all
    var footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;'
      + 'border-top:1px solid ' + bdr + ';padding-top:0.5rem;margin-top:0.15rem;';
    var showAllBtn = document.createElement('button');
    showAllBtn.type = 'button';
    showAllBtn.textContent = 'Show all fields';
    showAllBtn.style.cssText = 'font-size:0.73rem;padding:0.22rem 0.7rem;border-radius:0.375rem;'
      + 'cursor:pointer;border:1px solid ' + bdr + ';background:transparent;color:' + sub + ';';
    showAllBtn.addEventListener('click', function() {
      _dbCardVisibleAttrs = null;
      _dbSaveFilterSort();
      _dbUpdateFieldsBadge();
      _dbRenderGrid();
      panel.remove();
    });
    footer.appendChild(showAllBtn);
    panel.appendChild(footer);
  }

  document.body.appendChild(panel);

  // Close on outside click or Escape
  setTimeout(function() {
    function onOutside(e) {
      if (!panel.contains(e.target) && e.target !== btn) {
        panel.remove();
        document.removeEventListener('mousedown', onOutside, true);
      }
    }
    document.addEventListener('mousedown', onOutside, true);
    function onKey(e) {
      if (e.key === 'Escape') {
        panel.remove();
        document.removeEventListener('keydown', onKey, true);
      }
    }
    document.addEventListener('keydown', onKey, true);
  }, 50);
}

// Returns the card background/border override for the first matching color rule,
// or null if no rule matches. Reuses _dbFilterMatch so operator logic stays DRY.
function _dbColorRuleMatch(card) {
  var isDk = document.documentElement.classList.contains('dark');
  for (var i = 0; i < _dbColorRules.length; i++) {
    var rule = _dbColorRules[i];
    if (_dbFilterMatch(card, rule)) {
      var clr = _DB_OPT_COLORS.find(function(c) { return c.id === rule.color; }) || _DB_OPT_COLORS[0];
      return {
        bg:     isDk ? clr.darkBg  : clr.bg,
        border: isDk ? clr.dot + '66' : clr.dot + '55'
      };
    }
  }
  return null;
}

// Build a single filter row element inside the panel.
// Build one filter condition row.
// groupIdx  — index into _dbFilterGroups
// condIdx   — index within _dbFilterGroups[groupIdx]
// attrKeys  — from _dbGetAttrKeys()
// listEl    — the DOM container holding all condition rows for this group
function _dbBuildFilterRow(groupIdx, condIdx, attrKeys, listEl) {
  var f      = _dbFilterGroups[groupIdx][condIdx];
  var isDark = document.documentElement.classList.contains('dark');
  var bdr    = isDark ? '#3f3f46' : '#e5e7eb';
  var bg     = isDark ? '#27272a' : '#fff';
  var txt    = isDark ? '#f4f4f5' : '#111827';
  var sub    = isDark ? '#71717a' : '#6b7280';
  var inpSty = 'font-size:0.75rem;border:1px solid ' + bdr + ';border-radius:0.375rem;'
             + 'padding:0.25rem 0.5rem;background:' + bg + ';color:' + txt
             + ';outline:none;cursor:pointer;width:100%;box-sizing:border-box;';

  var row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;';

  // ── key select
  var keySel = document.createElement('select');
  keySel.style.cssText = inpSty + 'flex:1.4;min-width:80px;';
  attrKeys.forEach(function(ak) {
    var opt = document.createElement('option');
    opt.value = ak.key;
    opt.textContent = _dbKeyLabel(ak.key);
    if (ak.key === f.key) opt.selected = true;
    keySel.appendChild(opt);
  });

  // ── operator select (rebuilt when key changes)
  var opSel = document.createElement('select');
  opSel.style.cssText = inpSty + 'flex:1.6;min-width:100px;';

  function rebuildOps(type) {
    opSel.innerHTML = '';
    _dbOpsForType(type).forEach(function(o) {
      var opt = document.createElement('option');
      opt.value = o.op;
      opt.textContent = o.label;
      if (o.op === f.op) opt.selected = true;
      opSel.appendChild(opt);
    });
  }
  var currentType = (attrKeys.find(function(ak) { return ak.key === f.key; }) || {}).type || 'text';
  rebuildOps(currentType);

  // ── value control container — swapped when key/op changes
  var valWrap = document.createElement('div');
  valWrap.style.cssText = 'flex:1.5;min-width:70px;';

  // Build the appropriate value control for the current key type.
  // Returns element AND wires its change handler.
  function buildValControl(key, type, currentVal) {
    var op = opSel.value;
    // No value needed for these operators
    if (op === 'empty' || op === 'not_empty' || op === 'checked' || op === 'not_checked') {
      var dummy = document.createElement('span');
      dummy.style.display = 'none';
      return dummy;
    }
    // Multi-pick operators on select / multi_select / status — pill toggles
    var multiPickOps = ['is_any_of','is_none_of','has_any_of','has_all_of','has_none_of'];
    if (multiPickOps.indexOf(op) !== -1 &&
        (type === 'select' || type === 'multi_select' || type === 'status')) {
      var opts = _dbGetAttrOptions(key);
      var picked = [];
      try { picked = JSON.parse(currentVal || '[]'); } catch(e) { picked = []; }

      // Outer container — scrollable if many options
      var wrap = document.createElement('div');
      wrap.style.cssText =
        'display:flex;flex-wrap:wrap;gap:0.3rem;'
        + 'padding:0.3rem 0;max-height:112px;overflow-y:auto;';

      if (opts.length === 0) {
        var noOpts = document.createElement('span');
        noOpts.style.cssText = 'font-size:0.7rem;color:' + sub + ';font-style:italic;';
        noOpts.textContent = 'No options defined yet';
        wrap.appendChild(noOpts);
      } else {
        opts.forEach(function(opt) {
          var isOn = picked.indexOf(opt.label) !== -1;
          var cs   = _dbOptColorStyle(opt.color);
          // Ghost border bg (unselected) vs filled (selected)
          var pillBg   = isOn ? cs.bg   : 'transparent';
          var pillTxt  = isOn ? cs.text : (isDark ? '#a1a1aa' : '#6b7280');
          var pillBdr  = cs.bg;  // always use the option color for the border

          var pill = document.createElement('button');
          pill.type = 'button';
          pill.setAttribute('data-opt', opt.label);
          pill.setAttribute('data-on', isOn ? '1' : '0');
          pill.style.cssText =
            'display:inline-flex;align-items:center;gap:0.25rem;'
            + 'padding:0.18rem 0.55rem;border-radius:9999px;'
            + 'font-size:0.7rem;font-weight:500;cursor:pointer;'
            + 'border:1.5px solid ' + pillBdr + ';'
            + 'background:' + pillBg + ';color:' + pillTxt + ';'
            + 'transition:background 0.12s,color 0.12s;white-space:nowrap;';

          // Checkmark (visible when selected)
          var ck = document.createElement('span');
          ck.textContent = '\u2713';
          ck.style.cssText = 'font-size:0.65rem;font-weight:700;'
            + 'opacity:' + (isOn ? '1' : '0') + ';'
            + 'transition:opacity 0.1s;flex-shrink:0;';
          pill.appendChild(ck);

          var pillLbl = document.createElement('span');
          pillLbl.textContent = opt.label;
          pill.appendChild(pillLbl);

          pill.addEventListener('click', function() {
            var nowOn = pill.getAttribute('data-on') === '1';
            nowOn = !nowOn;
            pill.setAttribute('data-on', nowOn ? '1' : '0');
            // Animate fill
            pill.style.background = nowOn ? cs.bg   : 'transparent';
            pill.style.color      = nowOn ? cs.text : (isDark ? '#a1a1aa' : '#6b7280');
            ck.style.opacity      = nowOn ? '1' : '0';
            // Rebuild picked from all pills in wrap
            var newPicked = [];
            wrap.querySelectorAll('button[data-opt]').forEach(function(p) {
              if (p.getAttribute('data-on') === '1') newPicked.push(p.getAttribute('data-opt'));
            });
            _dbFilterGroups[groupIdx][condIdx].val = JSON.stringify(newPicked);
            _dbSaveFilterSort();
            _dbRenderGrid();
          });

          wrap.appendChild(pill);
        });
      }
      return wrap;
    }
    // Single-option pill selector for select/status with non-multi-pick operators
    if (type === 'select' || type === 'multi_select' || type === 'status') {
      var opts2 = _dbGetAttrOptions(key);
      if (opts2.length > 0) {
        // Pill group — only one can be active at a time (radio behaviour)
        var wrap2 = document.createElement('div');
        wrap2.style.cssText =
          'display:flex;flex-wrap:wrap;gap:0.3rem;padding:0.3rem 0;max-height:112px;overflow-y:auto;';
        opts2.forEach(function(opt) {
          var isOn = opt.label === currentVal;
          var cs   = _dbOptColorStyle(opt.color);
          var pill2 = document.createElement('button');
          pill2.type = 'button';
          pill2.setAttribute('data-opt', opt.label);
          pill2.setAttribute('data-on', isOn ? '1' : '0');
          pill2.style.cssText =
            'display:inline-flex;align-items:center;gap:0.25rem;'
            + 'padding:0.18rem 0.55rem;border-radius:9999px;'
            + 'font-size:0.7rem;font-weight:500;cursor:pointer;'
            + 'border:1.5px solid ' + cs.bg + ';'
            + 'background:' + (isOn ? cs.bg : 'transparent') + ';'
            + 'color:' + (isOn ? cs.text : (isDark ? '#a1a1aa' : '#6b7280')) + ';'
            + 'transition:background 0.12s,color 0.12s;white-space:nowrap;';
          var ck2 = document.createElement('span');
          ck2.textContent = '\u2713';
          ck2.style.cssText = 'font-size:0.65rem;font-weight:700;'
            + 'opacity:' + (isOn ? '1' : '0') + ';transition:opacity 0.1s;flex-shrink:0;';
          pill2.appendChild(ck2);
          var p2Lbl = document.createElement('span');
          p2Lbl.textContent = opt.label;
          pill2.appendChild(p2Lbl);
          pill2.addEventListener('click', function() {
            var alreadyOn = pill2.getAttribute('data-on') === '1';
            // Toggle off if clicking the already-selected option
            var newVal = alreadyOn ? '' : opt.label;
            wrap2.querySelectorAll('button[data-opt]').forEach(function(p) {
              var on = p.getAttribute('data-opt') === newVal;
              p.setAttribute('data-on', on ? '1' : '0');
              p.style.background = on ? cs.bg : 'transparent';
              // each pill needs its own color — resolve per pill
              var pOpt = opts2.find(function(o) { return o.label === p.getAttribute('data-opt'); });
              var pCs  = pOpt ? _dbOptColorStyle(pOpt.color) : cs;
              p.style.background = on ? pCs.bg   : 'transparent';
              p.style.color      = on ? pCs.text : (isDark ? '#a1a1aa' : '#6b7280');
              p.querySelector('span').style.opacity = on ? '1' : '0';
            });
            _dbFilterGroups[groupIdx][condIdx].val = newVal;
            _dbSaveFilterSort();
            _dbRenderGrid();
          });
          wrap2.appendChild(pill2);
        });
        return wrap2;
      }
    }
    // Date / number / text fallback
    var inp = document.createElement('input');
    inp.type = (type === 'date') ? 'date' : (type === 'number') ? 'number' : 'text';
    inp.placeholder = 'Value\u2026';
    inp.value = currentVal || '';
    inp.style.cssText = inpSty;
    inp.addEventListener('input', function() {
      _dbFilterGroups[groupIdx][condIdx].val = inp.value;
      _dbSaveFilterSort();
      _dbRenderGrid();
    });
    return inp;
  }

  function refreshValWrap() {
    var key  = keySel.value;
    var type = (attrKeys.find(function(ak) { return ak.key === key; }) || {}).type || 'text';
    valWrap.innerHTML = '';
    valWrap.appendChild(buildValControl(key, type, _dbFilterGroups[groupIdx][condIdx].val));
  }
  refreshValWrap();

  keySel.addEventListener('change', function() {
    _dbFilterGroups[groupIdx][condIdx].key = keySel.value;
    var newType = (attrKeys.find(function(ak) { return ak.key === keySel.value; }) || {}).type || 'text';
    rebuildOps(newType);
    _dbFilterGroups[groupIdx][condIdx].op  = opSel.value;
    _dbFilterGroups[groupIdx][condIdx].val = '';
    refreshValWrap();
    _dbSaveFilterSort();
    _dbUpdateFilterBadge();
    _dbRenderGrid();
  });
  opSel.addEventListener('change', function() {
    _dbFilterGroups[groupIdx][condIdx].op = opSel.value;
    refreshValWrap();
    _dbSaveFilterSort();
    _dbRenderGrid();
  });

  // ── remove button
  var rmBtn = document.createElement('button');
  rmBtn.type = 'button';
  rmBtn.textContent = '\u00d7';
  rmBtn.title = 'Remove condition';
  rmBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1rem;'
    + 'color:' + sub + ';padding:0 0.2rem;line-height:1;flex-shrink:0;';
  rmBtn.addEventListener('click', function() {
    _dbFilterGroups[groupIdx].splice(condIdx, 1);
    _dbSaveFilterSort();
    _dbUpdateFilterBadge();
    _dbRenderGrid();
    // Rebuild just this group\'s condition list
    if (listEl) {
      listEl.innerHTML = '';
      _dbFilterGroups[groupIdx].forEach(function(_, ci) {
        listEl.appendChild(_dbBuildFilterRow(groupIdx, ci, attrKeys, listEl));
      });
    }
  });

  row.appendChild(keySel);
  row.appendChild(opSel);
  row.appendChild(valWrap);
  row.appendChild(rmBtn);
  return row;
}

// Build and show (or remove) the filter/sort panel.
function _dbToggleFilterPanel() {
  var existing = document.getElementById('db-filter-panel');
  if (existing) { existing.remove(); return; }

  // Close fields panel if open
  var fp = document.getElementById('db-fields-panel');
  if (fp) fp.remove();

  var btn     = document.getElementById('db-filter-btn');
  var isDark  = document.documentElement.classList.contains('dark');
  var panelBg = isDark ? '#1c1c1f' : '#ffffff';
  var bdr     = isDark ? '#3f3f46' : '#e5e7eb';
  var txt     = isDark ? '#f4f4f5' : '#111827';
  var sub     = isDark ? '#71717a' : '#6b7280';
  var bg      = isDark ? '#27272a' : '#fff';
  var secBg   = isDark ? '#27272a' : '#f9fafb';

  // Position below the filter button
  var rect     = btn ? btn.getBoundingClientRect() : { bottom: 56, right: 300 };
  var isMobile  = window.innerWidth < 768;
  var rightPx   = isMobile ? 8 : (window.innerWidth - rect.right);

  var panel = document.createElement('div');
  panel.id  = 'db-filter-panel';
  panel.style.cssText =
    'position:fixed;top:' + (rect.bottom + 6) + 'px;'
    + 'right:' + rightPx + 'px;'
    + 'z-index:9500;width:360px;max-width:calc(100vw - 1rem);'
    + 'background:' + panelBg + ';border:1px solid ' + bdr + ';'
    + 'border-radius:0.75rem;padding:1rem;'
    + 'box-shadow:0 8px 32px rgba(0,0,0,0.18);'
    + 'display:flex;flex-direction:column;gap:0.85rem;';

  var attrKeys = _dbGetAttrKeys();
  var inpSty   = 'font-size:0.75rem;border:1px solid ' + bdr + ';border-radius:0.375rem;'
               + 'padding:0.25rem 0.5rem;background:' + bg + ';color:' + txt
               + ';outline:none;cursor:pointer;box-sizing:border-box;';
  var secHdr   = 'font-size:0.65rem;font-weight:700;text-transform:uppercase;'
               + 'letter-spacing:0.06em;color:' + sub + ';margin-bottom:0.4rem;';

  // ─────────── GROUP BY section ────────────────────────────
  var grpBySec = document.createElement('div');
  var grpByLbl = document.createElement('div');
  grpByLbl.style.cssText = secHdr;
  grpByLbl.textContent   = 'Group by';
  grpBySec.appendChild(grpByLbl);

  var grpByRow = document.createElement('div');
  grpByRow.style.cssText = 'display:flex;align-items:center;gap:0.4rem;';

  var grpBySel = document.createElement('select');
  grpBySel.style.cssText = inpSty + 'flex:1;';
  var grpByNone = document.createElement('option');
  grpByNone.value = '';
  grpByNone.textContent = '\u2014 None \u2014';
  if (!_dbGroupBy) grpByNone.selected = true;
  grpBySel.appendChild(grpByNone);
  // Select/multi_select/status attrs bubble to the top; everything else after
  var pillTypes = ['select', 'multi_select', 'status'];
  var grpByKeys = attrKeys.slice().sort(function(a, b) {
    var aP = pillTypes.indexOf(a.type) !== -1 ? 0 : 1;
    var bP = pillTypes.indexOf(b.type) !== -1 ? 0 : 1;
    return aP - bP;  // stable within each tier because .sort() preserves relative order in V8
  });
  grpByKeys.forEach(function(ak) {
    var o = document.createElement('option');
    o.value = ak.key;
    o.textContent = _dbKeyLabel(ak.key);
    if (_dbGroupBy && _dbGroupBy.key === ak.key) o.selected = true;
    grpBySel.appendChild(o);
  });
  grpBySel.addEventListener('change', function() {
    _dbGroupBy = grpBySel.value ? { key: grpBySel.value } : null;
    grpByClearBtn.style.display = _dbGroupBy ? '' : 'none';
    _dbSaveFilterSort();
    _dbUpdateFilterBadge();
    _dbRenderGrid();
  });
  grpByRow.appendChild(grpBySel);

  // Clear button — only shown when a group is active
  var grpByClearBtn = document.createElement('button');
  grpByClearBtn.type = 'button';
  grpByClearBtn.title = 'Clear grouping';
  grpByClearBtn.textContent = '\u00d7';
  grpByClearBtn.style.cssText = 'display:' + (_dbGroupBy ? '' : 'none') + ';'
    + 'font-size:0.9rem;padding:0 0.3rem;background:none;border:none;'
    + 'cursor:pointer;color:' + sub + ';transition:color 0.12s;line-height:1;';
  grpByClearBtn.addEventListener('mouseover', function() { grpByClearBtn.style.color = '#ef4444'; });
  grpByClearBtn.addEventListener('mouseout',  function() { grpByClearBtn.style.color = sub; });
  grpByClearBtn.addEventListener('click', function() {
    _dbGroupBy = null;
    grpBySel.value = '';
    grpByClearBtn.style.display = 'none';
    _dbSaveFilterSort();
    _dbUpdateFilterBadge();
    _dbRenderGrid();
  });
  grpByRow.appendChild(grpByClearBtn);

  grpBySec.appendChild(grpByRow);
  // grpBySec appended to panel AFTER filterSec — see below

  // ─────────── SORT section (multi-level) ──────────────────────────
  var sortSec = document.createElement('div');
  var sortLbl = document.createElement('div');
  sortLbl.style.cssText = secHdr;
  sortLbl.textContent   = 'Sort';
  sortSec.appendChild(sortLbl);

  var sortList = document.createElement('div');
  sortList.id = 'db-sort-list';
  sortList.style.cssText = 'display:flex;flex-direction:column;gap:0.4rem;';

  // Build one sort-level row (DOM)
  function buildSortRow(lvlIdx) {
    var sl   = _dbSortLevels[lvlIdx];
    var row  = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:0.35rem;';

    // Priority badge (1st, 2nd, …)
    var badge = document.createElement('span');
    badge.style.cssText = 'font-size:0.62rem;font-weight:700;min-width:1.2rem;'
      + 'text-align:center;color:' + sub + ';flex-shrink:0;';
    badge.textContent = (lvlIdx + 1) + '.';
    row.appendChild(badge);

    // Key dropdown
    var kSel = document.createElement('select');
    kSel.style.cssText = inpSty + 'flex:1;';
    attrKeys.forEach(function(ak) {
      var o = document.createElement('option');
      o.value = ak.key;
      o.textContent = _dbKeyLabel(ak.key);
      if (ak.key === sl.key) o.selected = true;
      kSel.appendChild(o);
    });
    kSel.addEventListener('change', function() {
      _dbSortLevels[lvlIdx].key = kSel.value;
      _dbSaveFilterSort();
      _dbUpdateFilterBadge();
      _dbRenderGrid();
    });
    row.appendChild(kSel);

    // Asc / Desc buttons
    function makeSortDirBtn(label, d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = d === 'asc' ? 'Ascending' : 'Descending';
      function rStyle() {
        var on = _dbSortLevels[lvlIdx] && _dbSortLevels[lvlIdx].dir === d;
        b.style.cssText = 'font-size:0.7rem;padding:0.2rem 0.45rem;border-radius:0.35rem;'
          + 'cursor:pointer;border:1px solid ' + bdr + ';white-space:nowrap;flex-shrink:0;'
          + 'background:' + (on ? '#7c3aed' : 'transparent') + ';'
          + 'color:' + (on ? '#fff' : txt) + ';transition:background 0.12s;';
      }
      rStyle();
      b.addEventListener('click', function() {
        _dbSortLevels[lvlIdx].dir = d;
        _dbSaveFilterSort();
        rStyle();
        // refresh sibling buttons in same row
        row.querySelectorAll('button[data-dir]').forEach(function(x) {
          var xd = x.getAttribute('data-dir');
          var on2 = _dbSortLevels[lvlIdx] && _dbSortLevels[lvlIdx].dir === xd;
          x.style.background = on2 ? '#7c3aed' : 'transparent';
          x.style.color      = on2 ? '#fff' : txt;
        });
        _dbRenderGrid();
      });
      b.setAttribute('data-dir', d);
      return b;
    }
    row.appendChild(makeSortDirBtn('A\u2192Z', 'asc'));
    row.appendChild(makeSortDirBtn('Z\u2192A', 'desc'));

    // × remove
    var rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.textContent = '\u00d7';
    rmBtn.title = 'Remove sort level';
    rmBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1rem;'
      + 'color:' + sub + ';padding:0 0.1rem;line-height:1;flex-shrink:0;';
    rmBtn.addEventListener('click', function() {
      _dbSortLevels.splice(lvlIdx, 1);
      _dbSaveFilterSort();
      _dbUpdateFilterBadge();
      _dbRenderGrid();
      // Rebuild sort list
      sortList.innerHTML = '';
      _dbSortLevels.forEach(function(_, i) { sortList.appendChild(buildSortRow(i)); });
    });
    row.appendChild(rmBtn);
    return row;
  }

  _dbSortLevels.forEach(function(_, i) { sortList.appendChild(buildSortRow(i)); });
  sortSec.appendChild(sortList);

  // + Add sort level
  var addSortBtn = document.createElement('button');
  addSortBtn.type = 'button';
  addSortBtn.textContent = '+ Add sort level';
  addSortBtn.style.cssText = 'margin-top:0.4rem;font-size:0.73rem;padding:0.22rem 0.6rem;'
    + 'border-radius:0.375rem;cursor:pointer;border:1px solid ' + bdr + ';'
    + 'background:transparent;color:#7c3aed;font-weight:600;text-align:left;';
  addSortBtn.addEventListener('click', function() {
    var firstKey = attrKeys[0] || { key: '__title' };
    _dbSortLevels.push({ key: firstKey.key, dir: 'asc' });
    sortList.appendChild(buildSortRow(_dbSortLevels.length - 1));
    _dbSaveFilterSort();
    _dbUpdateFilterBadge();
    _dbRenderGrid();
  });
  sortSec.appendChild(addSortBtn);
  panel.appendChild(sortSec);

  // ─────────── FILTER section (OR groups, AND conditions within each group) ──────
  var filterSec = document.createElement('div');
  var filterLbl = document.createElement('div');
  filterLbl.style.cssText = secHdr;
  filterLbl.textContent   = 'Filter';
  filterSec.appendChild(filterLbl);

  // Container for all groups
  var allGroupsEl = document.createElement('div');
  allGroupsEl.id = 'db-filter-groups';
  allGroupsEl.style.cssText = 'display:flex;flex-direction:column;gap:0.6rem;';

  // Build one group container (groupIdx into _dbFilterGroups)
  function buildGroupEl(groupIdx) {
    var grpWrap = document.createElement('div');
    grpWrap.style.cssText = 'border:1px solid ' + bdr + ';border-radius:0.5rem;'
      + 'padding:0.5rem;display:flex;flex-direction:column;gap:0.35rem;position:relative;';

    // ── group header: × delete icon top-right
    var grpHeader = document.createElement('div');
    grpHeader.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;margin-bottom:0.1rem;';

    var rmGrpBtn = document.createElement('button');
    rmGrpBtn.type = 'button';
    rmGrpBtn.title = 'Remove this group';
    rmGrpBtn.setAttribute('aria-label', 'Remove filter group');
    rmGrpBtn.style.cssText =
      'display:flex;align-items:center;justify-content:center;'
      + 'width:1.25rem;height:1.25rem;border-radius:0.25rem;'
      + 'border:none;background:transparent;cursor:pointer;'
      + 'color:' + sub + ';font-size:0.85rem;line-height:1;padding:0;'
      + 'transition:color 0.12s,background 0.12s;';
    rmGrpBtn.textContent = '\u00d7';
    rmGrpBtn.addEventListener('mouseover', function() {
      rmGrpBtn.style.color      = '#ef4444';
      rmGrpBtn.style.background = isDark ? '#3f1515' : '#fee2e2';
    });
    rmGrpBtn.addEventListener('mouseout', function() {
      rmGrpBtn.style.color      = sub;
      rmGrpBtn.style.background = 'transparent';
    });
    rmGrpBtn.addEventListener('click', function() {
      _dbFilterGroups.splice(groupIdx, 1);
      _dbSaveFilterSort();
      _dbUpdateFilterBadge();
      _dbRenderGrid();
      allGroupsEl.innerHTML = '';
      _dbFilterGroups.forEach(function(_, gi) {
        if (gi > 0) allGroupsEl.appendChild(makeOrSep());
        allGroupsEl.appendChild(buildGroupEl(gi));
      });
    });
    grpHeader.appendChild(rmGrpBtn);
    grpWrap.appendChild(grpHeader);

    // ── condition list
    var condList = document.createElement('div');
    condList.style.cssText = 'display:flex;flex-direction:column;gap:0.35rem;';
    _dbFilterGroups[groupIdx].forEach(function(_, ci) {
      condList.appendChild(_dbBuildFilterRow(groupIdx, ci, attrKeys, condList));
    });
    grpWrap.appendChild(condList);

    // ── footer: AND badge + add-condition button
    var grpFooter = document.createElement('div');
    grpFooter.style.cssText = 'display:flex;align-items:center;gap:0.4rem;margin-top:0.15rem;';

    var andLbl = document.createElement('span');
    andLbl.textContent = 'AND';
    andLbl.style.cssText = 'font-size:0.62rem;font-weight:700;color:' + sub + ';flex-shrink:0;';
    grpFooter.appendChild(andLbl);

    var addCondBtn = document.createElement('button');
    addCondBtn.type = 'button';
    addCondBtn.textContent = '+ condition';
    addCondBtn.style.cssText = 'font-size:0.7rem;padding:0.15rem 0.45rem;border-radius:0.3rem;'
      + 'cursor:pointer;border:1px solid ' + bdr + ';background:transparent;'
      + 'color:#7c3aed;font-weight:600;';
    addCondBtn.addEventListener('click', function() {
      var firstKey = attrKeys[0] || { key: '__title', type: 'text' };
      var firstOps = _dbOpsForType(firstKey.type);
      _dbFilterGroups[groupIdx].push({ key: firstKey.key, op: firstOps[0].op, val: '' });
      var ci = _dbFilterGroups[groupIdx].length - 1;
      condList.appendChild(_dbBuildFilterRow(groupIdx, ci, attrKeys, condList));
      _dbSaveFilterSort();
      _dbUpdateFilterBadge();
      _dbRenderGrid();
    });
    grpFooter.appendChild(addCondBtn);

    grpWrap.appendChild(grpFooter);
    return grpWrap;
  }

  // OR separator pill
  function makeOrSep() {
    var sep = document.createElement('div');
    sep.style.cssText = 'display:flex;align-items:center;gap:0.4rem;';
    var line1 = document.createElement('div');
    line1.style.cssText = 'flex:1;height:1px;background:' + bdr + ';';
    var pill = document.createElement('span');
    pill.textContent = 'OR';
    pill.style.cssText = 'font-size:0.62rem;font-weight:700;padding:0.1rem 0.45rem;'
      + 'border-radius:9999px;background:#7c3aed;color:#fff;flex-shrink:0;';
    var line2 = document.createElement('div');
    line2.style.cssText = 'flex:1;height:1px;background:' + bdr + ';';
    sep.appendChild(line1);
    sep.appendChild(pill);
    sep.appendChild(line2);
    return sep;
  }

  // Render existing groups
  _dbFilterGroups.forEach(function(_, gi) {
    if (gi > 0) allGroupsEl.appendChild(makeOrSep());
    allGroupsEl.appendChild(buildGroupEl(gi));
  });
  filterSec.appendChild(allGroupsEl);

  // + Or group button
  var addGrpBtn = document.createElement('button');
  addGrpBtn.type = 'button';
  addGrpBtn.textContent = '+ Or group';
  addGrpBtn.style.cssText = 'margin-top:0.5rem;font-size:0.73rem;padding:0.22rem 0.6rem;'
    + 'border-radius:0.375rem;cursor:pointer;border:1px solid ' + bdr + ';'
    + 'background:transparent;color:#7c3aed;font-weight:600;text-align:left;';
  addGrpBtn.addEventListener('click', function() {
    var firstKey = attrKeys[0] || { key: '__title', type: 'text' };
    var firstOps = _dbOpsForType(firstKey.type);
    var gi = _dbFilterGroups.length;
    _dbFilterGroups.push([{ key: firstKey.key, op: firstOps[0].op, val: '' }]);
    if (gi > 0) allGroupsEl.appendChild(makeOrSep());
    allGroupsEl.appendChild(buildGroupEl(gi));
    _dbSaveFilterSort();
    _dbUpdateFilterBadge();
    _dbRenderGrid();
  });
  filterSec.appendChild(addGrpBtn);
  panel.appendChild(filterSec);
  panel.appendChild(grpBySec);   // Group by sits after Filter

  // ─────────── COLOR RULES section ────────────────────
  // Each rule: { key, op, val, color } — first match wins. Reuses _dbFilterMatch
  // so all filter operators work identically for color conditions.
  var colorSec = document.createElement('div');
  var colorLbl = document.createElement('div');
  colorLbl.style.cssText = secHdr;
  colorLbl.textContent   = '\uD83C\uDFA8  Color rules';
  colorSec.appendChild(colorLbl);

  var colorHint = document.createElement('p');
  colorHint.textContent = 'Cards matching the first rule get its color.';
  colorHint.style.cssText = 'font-size:0.67rem;color:' + sub + ';margin:0 0 0.45rem;';
  colorSec.appendChild(colorHint);

  var colorRuleList = document.createElement('div');
  colorRuleList.id  = 'db-color-rule-list';
  colorRuleList.style.cssText = 'display:flex;flex-direction:column;gap:0.4rem;';

  function buildColorRuleRow(ruleIdx) {
    var rule  = _dbColorRules[ruleIdx];
    var rowEl = document.createElement('div');
    rowEl.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:0.3rem;';

    // — field select
    var keySel = document.createElement('select');
    keySel.style.cssText = inpSty + 'flex:1;min-width:0;';
    attrKeys.forEach(function(ak) {
      var o = document.createElement('option');
      o.value = ak.key;
      o.textContent = _dbKeyLabel(ak.key);
      if (ak.key === rule.key) o.selected = true;
      keySel.appendChild(o);
    });

    // — operator select (rebuilt when key changes)
    var opSel = document.createElement('select');
    opSel.style.cssText = inpSty + 'flex:1;min-width:0;';
    function rebuildOps(typeHint) {
      var ops = _dbOpsForType(typeHint || 'text');
      opSel.innerHTML = '';
      ops.forEach(function(op) {
        var o = document.createElement('option');
        o.value = op.op; o.textContent = op.label;
        if (op.op === rule.op) o.selected = true;
        opSel.appendChild(o);
      });
    }
    var initType = (attrKeys.find(function(ak) { return ak.key === rule.key; }) || { type: 'text' }).type;
    rebuildOps(initType);

    // — value control container; flex:0 0 100% pushes it onto its own row so
    //   pill options have the full panel width to wrap into.
    var valWrap = document.createElement('div');
    valWrap.style.cssText = 'flex:0 0 100%;min-width:0;';

    var noValOps     = ['empty','not_empty','checked','not_checked'];
    var pillTypes    = ['select','multi_select','status'];
    var multiPickOps = ['is_any_of','is_none_of','has_any_of','has_all_of','has_none_of'];

    // Build the right value control for the given key+type+op combination.
    // Mirrors buildValControl() in _dbBuildFilterRow but writes to _dbColorRules.
    function buildColorValControl(ri, key, type, op, currentVal) {
      // No value needed for these operators — nothing to show
      if (noValOps.indexOf(op) !== -1) {
        var dummy = document.createElement('span');
        dummy.style.display = 'none';
        return dummy;
      }

      // Pill-based control for select / multi_select / status
      if (pillTypes.indexOf(type) !== -1) {
        var opts = _dbGetAttrOptions(key);
        if (opts.length > 0) {
          var isMulti = multiPickOps.indexOf(op) !== -1;
          var picked = [];
          if (isMulti) { try { picked = JSON.parse(currentVal || '[]'); } catch(e) {} }

          var pillWrap = document.createElement('div');
          pillWrap.style.cssText =
            'display:flex;flex-wrap:wrap;gap:0.3rem;padding:0.3rem 0;max-height:112px;overflow-y:auto;';

          opts.forEach(function(opt) {
            var isOn = isMulti
              ? picked.indexOf(opt.label) !== -1
              : opt.label === currentVal;
            var cs = _dbOptColorStyle(opt.color);

            var pill = document.createElement('button');
            pill.type = 'button';
            pill.setAttribute('data-opt', opt.label);
            pill.setAttribute('data-on', isOn ? '1' : '0');
            pill.style.cssText =
              'display:inline-flex;align-items:center;gap:0.25rem;'
              + 'padding:0.18rem 0.55rem;border-radius:9999px;font-size:0.7rem;'
              + 'font-weight:500;cursor:pointer;white-space:nowrap;'
              + 'border:1.5px solid ' + cs.bg + ';'
              + 'background:' + (isOn ? cs.bg : 'transparent') + ';'
              + 'color:' + (isOn ? cs.text : (isDark ? '#a1a1aa' : '#6b7280')) + ';'
              + 'transition:background 0.12s,color 0.12s;';

            var ck = document.createElement('span');
            ck.textContent = '\u2713';
            ck.style.cssText = 'font-size:0.65rem;font-weight:700;flex-shrink:0;'
              + 'opacity:' + (isOn ? '1' : '0') + ';transition:opacity 0.1s;';
            pill.appendChild(ck);
            pill.appendChild(document.createTextNode(opt.label));

            pill.addEventListener('click', function() {
              if (isMulti) {
                var nowOn = pill.getAttribute('data-on') !== '1';
                pill.setAttribute('data-on', nowOn ? '1' : '0');
                pill.style.background = nowOn ? cs.bg : 'transparent';
                pill.style.color      = nowOn ? cs.text : (isDark ? '#a1a1aa' : '#6b7280');
                ck.style.opacity      = nowOn ? '1' : '0';
                var newPicked = [];
                pillWrap.querySelectorAll('button[data-opt]').forEach(function(p) {
                  if (p.getAttribute('data-on') === '1') newPicked.push(p.getAttribute('data-opt'));
                });
                _dbColorRules[ri].val = JSON.stringify(newPicked);
              } else {
                // Radio: deselect all, select this one (or toggle off if already on)
                var alreadyOn = pill.getAttribute('data-on') === '1';
                var newVal    = alreadyOn ? '' : opt.label;
                pillWrap.querySelectorAll('button[data-opt]').forEach(function(p) {
                  var on   = p.getAttribute('data-opt') === newVal;
                  var pOpt = opts.find(function(o) { return o.label === p.getAttribute('data-opt'); });
                  var pcs  = _dbOptColorStyle((pOpt || {}).color);
                  p.setAttribute('data-on', on ? '1' : '0');
                  p.style.background = on ? pcs.bg : 'transparent';
                  p.style.color      = on ? pcs.text : (isDark ? '#a1a1aa' : '#6b7280');
                  p.querySelector('span').style.opacity = on ? '1' : '0';
                });
                _dbColorRules[ri].val = newVal;
              }
              _dbSaveFilterSort();
              _dbRenderGrid();
            });
            pillWrap.appendChild(pill);
          });
          return pillWrap;
        }
        // No options defined yet — show a hint instead of a useless text box
        var noOptsHint = document.createElement('span');
        noOptsHint.textContent = 'No options defined for this attribute yet';
        noOptsHint.style.cssText = 'font-size:0.68rem;color:' + sub + ';font-style:italic;padding:0.25rem 0;display:block;';
        return noOptsHint;
      }

      // Plain text input for all other types
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.value = currentVal || '';
      inp.placeholder = 'value…';
      inp.style.cssText = inpSty + 'width:100%;box-sizing:border-box;';
      inp.addEventListener('input', function() {
        _dbColorRules[ri].val = inp.value;
        _dbSaveFilterSort();
        _dbRenderGrid();
      });
      return inp;
    }

    valWrap.appendChild(buildColorValControl(ruleIdx, rule.key, initType, rule.op, rule.val));

    // — color swatch button + popover palette
    var swatchWrap = document.createElement('div');
    swatchWrap.style.cssText = 'position:relative;flex-shrink:0;';
    var curClr = _DB_OPT_COLORS.find(function(c) { return c.id === rule.color; }) || _DB_OPT_COLORS[0];
    var swatchBtn = document.createElement('button');
    swatchBtn.type  = 'button';
    swatchBtn.title = 'Pick card color';
    swatchBtn.style.cssText =
      'width:1.4rem;height:1.4rem;border-radius:9999px;cursor:pointer;flex-shrink:0;'
      + 'background:' + curClr.dot + ';border:2px solid rgba(0,0,0,0.18);';
    swatchBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var existPal = swatchWrap.querySelector('.db-clr-palette');
      if (existPal) { existPal.remove(); return; }
      var pal = document.createElement('div');
      pal.className = 'db-clr-palette';
      pal.style.cssText =
        'position:absolute;top:calc(100% + 5px);right:0;z-index:9600;'
        + 'background:' + panelBg + ';border:1px solid ' + bdr + ';'
        + 'border-radius:0.5rem;padding:0.35rem;'
        + 'display:grid;grid-template-columns:repeat(3,1.5rem);gap:0.3rem;'
        + 'box-shadow:0 4px 16px rgba(0,0,0,0.18);';
      _DB_OPT_COLORS.forEach(function(clr) {
        var dot = document.createElement('button');
        dot.type = 'button'; dot.title = clr.id;
        var isActive = clr.id === _dbColorRules[ruleIdx].color;
        dot.style.cssText =
          'width:1.5rem;height:1.5rem;border-radius:9999px;cursor:pointer;'
          + 'background:' + clr.dot + ';'
          + 'border:2px solid ' + (isActive ? '#fff' : 'transparent') + ';'
          + 'outline:' + (isActive ? '2px solid ' + clr.dot : 'none') + ';';
        dot.addEventListener('click', function(e2) {
          e2.stopPropagation();
          _dbColorRules[ruleIdx].color = clr.id;
          swatchBtn.style.background = clr.dot;
          _dbSaveFilterSort();
          _dbRenderGrid();
          pal.remove();
        });
        pal.appendChild(dot);
      });
      swatchWrap.appendChild(pal);
      setTimeout(function() {
        function closePal(ev) {
          if (!pal.contains(ev.target) && ev.target !== swatchBtn) {
            pal.remove();
            document.removeEventListener('mousedown', closePal, true);
          }
        }
        document.addEventListener('mousedown', closePal, true);
      }, 0);
    });
    swatchWrap.appendChild(swatchBtn);

    // — delete rule button
    var rmBtn = document.createElement('button');
    rmBtn.type = 'button'; rmBtn.textContent = '\u00d7';
    rmBtn.style.cssText =
      'border:none;background:none;cursor:pointer;color:' + sub
      + ';font-size:1rem;padding:0 0.1rem;flex-shrink:0;line-height:1;';
    rmBtn.addEventListener('mouseover', function() { rmBtn.style.color = '#ef4444'; });
    rmBtn.addEventListener('mouseout',  function() { rmBtn.style.color = sub; });
    rmBtn.addEventListener('click', function() {
      _dbColorRules.splice(ruleIdx, 1);
      _dbSaveFilterSort();
      _dbUpdateFilterBadge();
      _dbRenderGrid();
      colorRuleList.innerHTML = '';
      _dbColorRules.forEach(function(_, i) { colorRuleList.appendChild(buildColorRuleRow(i)); });
    });

    // — wire up interdependencies
    keySel.addEventListener('change', function() {
      _dbColorRules[ruleIdx].key = keySel.value;
      var newType = (attrKeys.find(function(ak) { return ak.key === keySel.value; }) || { type: 'text' }).type;
      rebuildOps(newType);
      _dbColorRules[ruleIdx].op  = opSel.value;
      _dbColorRules[ruleIdx].val = '';
      valWrap.innerHTML = '';
      valWrap.appendChild(buildColorValControl(ruleIdx, keySel.value, newType, opSel.value, ''));
      _dbSaveFilterSort();
      _dbRenderGrid();
    });
    opSel.addEventListener('change', function() {
      _dbColorRules[ruleIdx].op  = opSel.value;
      _dbColorRules[ruleIdx].val = '';
      var curType = (attrKeys.find(function(ak) { return ak.key === keySel.value; }) || { type: 'text' }).type;
      valWrap.innerHTML = '';
      valWrap.appendChild(buildColorValControl(ruleIdx, keySel.value, curType, opSel.value, ''));
      _dbSaveFilterSort();
      _dbRenderGrid();
    });

    rowEl.appendChild(keySel);
    rowEl.appendChild(opSel);
    rowEl.appendChild(swatchWrap);
    rowEl.appendChild(rmBtn);
    rowEl.appendChild(valWrap);  // full-width second row via flex:0 0 100%
    return rowEl;
  }

  _dbColorRules.forEach(function(_, i) { colorRuleList.appendChild(buildColorRuleRow(i)); });
  colorSec.appendChild(colorRuleList);

  var addColorRuleBtn = document.createElement('button');
  addColorRuleBtn.type = 'button';
  addColorRuleBtn.textContent = '+ Color rule';
  addColorRuleBtn.style.cssText =
    'margin-top:0.45rem;font-size:0.73rem;padding:0.22rem 0.6rem;'
    + 'border-radius:0.375rem;cursor:pointer;border:1px solid ' + bdr + ';'
    + 'background:transparent;color:#0053e2;font-weight:600;text-align:left;';
  addColorRuleBtn.addEventListener('click', function() {
    var firstKey = attrKeys[0] || { key: '__title', type: 'text' };
    var firstOps = _dbOpsForType(firstKey.type);
    _dbColorRules.push({ key: firstKey.key, op: firstOps[0].op, val: '', color: 'blue' });
    colorRuleList.appendChild(buildColorRuleRow(_dbColorRules.length - 1));
    _dbSaveFilterSort();
    _dbUpdateFilterBadge();
    _dbRenderGrid();
  });
  colorSec.appendChild(addColorRuleBtn);
  panel.appendChild(colorSec);

  // ─────────── Footer: Clear all ───────────────────
  var footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;border-top:1px solid ' + bdr + ';padding-top:0.6rem;';
  var clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear all';
  clearBtn.style.cssText = 'font-size:0.73rem;padding:0.22rem 0.7rem;border-radius:0.375rem;'
    + 'cursor:pointer;border:1px solid ' + bdr + ';background:transparent;color:' + sub + ';';
  clearBtn.addEventListener('click', _dbClearFilters);
  footer.appendChild(clearBtn);
  panel.appendChild(footer);

  document.body.appendChild(panel);

  // Close on outside click (delayed so this click doesn\'t immediately close)
  setTimeout(function() {
    function onOutside(e) {
      if (!panel.contains(e.target) && e.target !== btn) {
        panel.remove();
        document.removeEventListener('mousedown', onOutside, true);
      }
    }
    document.addEventListener('mousedown', onOutside, true);
    // Close on Escape
    function onKey(e) {
      if (e.key === 'Escape') { panel.remove(); document.removeEventListener('keydown', onKey, true); }
    }
    document.addEventListener('keydown', onKey, true);
  }, 50);
}

function _dbCardHtml(card) {
  var cover   = _dbCoverHtml(card);
  var pills   = _dbAttrPills(card.attrs || [], card.id);
  var updated = card.updated_at ? card.updated_at.replace('T', ' ').slice(0, 16) : '';
  var colorHit = _dbColorRuleMatch(card);
  var cardStyle = colorHit
    ? 'background:' + colorHit.bg + ';border-color:' + colorHit.border + ';'
    : '';

  return (
    '<div class="db-card bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700'
    + ' shadow-sm overflow-hidden flex flex-col group/card relative" data-card-id="' + card.id + '"'
    + (cardStyle ? ' style="' + cardStyle + '"' : '') + '>'
    + '<div class="db-ms-cb" aria-hidden="true">'
    + '<svg class="db-ms-cb-tick w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
    + '</div>'
    + cover
    + '<div class="p-3 flex flex-col flex-1 gap-2">'    + '<div class="flex items-start gap-2">'
    + '<div class="flex-1 min-w-0 flex items-start gap-1.5">'
    + '<div contenteditable="true" class="font-bold text-gray-900 dark:text-zinc-100'
    + ' text-2xl leading-snug outline-none empty:before:content-[\'Untitled\']'
    + ' empty:before:text-gray-300 dark:empty:before:text-zinc-600"'
    + ' onblur="_dbTitleBlur(' + card.id + ',this)"'
    + ' aria-label="Card title">' + _esc(card.title) + '</div>'
    + '<span id="db-card-grid-share-' + card.id + '"'
    + ' class="flex-shrink-0 flex items-center self-start mt-1'
    + ' text-[#0053e2] dark:text-blue-400'
    + (card.has_share_link ? '' : ' hidden') + '"'
    + ' title="Public link active" aria-label="Public link active">'
    + '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">'
    + '<path stroke-linecap="round" stroke-linejoin="round"'
    + ' d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101'
    + 'm-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>'
    + '</svg></span>'
    + '</div>'
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

// Returns a resized thumbnail URL for internal /uploads/ images, or the
// original URL unchanged for external images and videos.
function _dbThumbUrl(url, w) {
  if (!url || _dbCoverIsVideo(url)) return url;
  var prefix = '/uploads/';
  if (url.indexOf(prefix) === 0) {
    return '/uploads/thumb/' + url.slice(prefix.length).split('?')[0] + '?w=' + w;
  }
  return url;  // external URL — can’t proxy through our thumbnail endpoint
}

function _dbCoverHtml(card) {
  // Content-preview mode (per-database): show the card's own note content in the
  // preview region instead of the cover image/video. Cards with no content fall
  // through to the gradient/letter placeholder below.
  if (_dbCardPreview === 'content') {
    var _content = (card.note_content || '').trim();
    if (_content) {
      return (
        '<div class="db-card-content-preview relative w-full flex-shrink-0 overflow-hidden cursor-pointer'
        + ' bg-white dark:bg-zinc-900"'
        + ' style="height:var(--db-cover-h,9rem);"'
        + ' onclick="_dbOpenDetail(' + card.id + ')">'
        + '<div class="db-card-content-inner px-3 py-2 text-sm text-gray-700 dark:text-zinc-300">'
        + _content
        + '</div>'
        + '<div class="db-card-content-fade" aria-hidden="true"></div>'
        + '</div>'
      );
    }
    // no content → fall through to gradient placeholder (skip cover image)
  } else if (card.cover_url) {
    var isVid = _dbCoverIsVideo(card.cover_url);
    var media = isVid
      ? '<video src="' + _esc(card.cover_url) + '" muted playsinline preload="metadata" loop'
        + ' class="w-full h-full object-cover"'
        + ' onmouseenter="this.play()" onmouseleave="this.pause()"></video>'
      : '<img src="' + _esc(_dbThumbUrl(card.cover_url, 600)) + '" alt="Cover" loading="lazy"'
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

/* ── card preview mode (cover ↔ content) ─────────────────────────────────────── */
// Reflect _dbCardPreview on the toolbar toggle (icon + active accent + a11y state).
function _dbApplyCardPreviewUI() {
  var btn = document.getElementById('db-card-preview-toggle');
  if (!btn) return;
  var isContent = _dbCardPreview === 'content';
  btn.setAttribute('aria-pressed', isContent ? 'true' : 'false');
  btn.title = isContent
    ? 'Card preview: content — click to show cover image'
    : 'Card preview: cover image — click to show content';
  btn.classList.toggle('text-purple-600', isContent);
  btn.classList.toggle('dark:text-purple-400', isContent);
  btn.classList.toggle('bg-purple-50', isContent);
  // icon: lines-of-text (content) vs image-with-mountain (cover)
  btn.innerHTML = isContent
    ? '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">'
      + '<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h10"/></svg>'
    : '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">'
      + '<path stroke-linecap="round" stroke-linejoin="round" d="M4 5h16v14H4V5zm0 11l5-5 4 4 3-3 4 4"/></svg>';
}

// Toolbar button → flip the mode.
window._dbToggleCardPreview = function() {
  _dbSetCardPreview(_dbCardPreview === 'content' ? 'cover' : 'content');
};

// Set + persist the per-database preview mode, then re-render every card.
window._dbSetCardPreview = function(mode) {
  if (mode !== 'cover' && mode !== 'content') return;
  if (mode === _dbCardPreview) return;
  _dbCardPreview = mode;
  _dbApplyCardPreviewUI();
  _dbRenderGrid();   // applies to ALL cards in this database
  // Keep the root dataset in sync so an HTMX re-init preserves the new mode.
  var root = document.getElementById('db-view-root');
  if (root) root.dataset.cardPreview = mode;
  if (!_dbWsId) return;
  fetch('/workspaces/' + _dbWsId + '/db/preview-mode', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: mode }),
  }).catch(function() { /* non-fatal — UI already updated; server re-syncs on reload */ });
};

function _dbAttrPills(attrs, cardId) {
  // Renders a compact preview row for the card grid.
  // cardId is required so checkbox pills can toggle in-place.
  //
  // Three output buckets:
  //   chipParts     — select + multi_select (coloured pill chips)
  //   priorityParts — checkbox, phone, person, place, status, url, email
  //                   These always surface first so user-entered info
  //                   is never hidden behind date/number attrs.
  //   normalParts   — date, number, text (fill remaining slots)
  //   fileParts     — files (own row, no MAX cap)
  //
  // Merged plain row = priorityParts ++ normalParts, capped at MAX_PLAIN.
  if (!attrs || attrs.length === 0) return '';
  var isDark      = document.documentElement.classList.contains('dark');
  var pillLinkClr = isDark ? '#93c5fd' : '#0053e2'; // blue-300 dark / Walmart blue light

  var priorityParts = [];
  var normalParts   = [];
  var chipParts     = [];
  var fileParts     = [];

  for (var i = 0; i < attrs.length; i++) {
    var a = attrs[i];
    var t = a.attr_type  || 'text';
    var v = a.attr_value || '';

    // Skip attrs that the user has hidden from the card preview.
    if (_dbCardVisibleAttrs !== null &&
        _dbCardVisibleAttrs.indexOf(a.attr_key) === -1) continue;


    if (t === 'select') {
      if (v) {
        var sParsed = _dbParseOptions(a.attr_options || '');
        var sMatch  = sParsed.find(function(o) { return o.label === v; });
        var sDef    = _dbOptColorDef(sMatch ? sMatch.color : 'gray');
        chipParts.push(
          '<span style="background:' + sDef.bg + ';color:' + sDef.text + ';border:1px solid ' + sDef.dot + '33;"'
          + ' class="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded max-w-[120px] truncate font-medium">'
          + _esc(v) + '</span>'
        );
      }
    } else if (t === 'multi_select') {
      var mParsed = _dbParseOptions(a.attr_options || '');
      v.split(',').map(function(s) { return s.trim(); }).filter(function(s) {
        return s && (mParsed.length === 0 || mParsed.some(function(o) { return o.label === s; }));
      }).forEach(function(s) {
        var mMatch = mParsed.find(function(o) { return o.label === s; });
        var mDef   = _dbOptColorDef(mMatch ? mMatch.color : 'gray');
        chipParts.push(
          '<span style="background:' + mDef.bg + ';color:' + mDef.text + ';border:1px solid ' + mDef.dot + '33;"'
          + ' class="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded max-w-[120px] truncate font-medium">'
          + _esc(s) + '</span>'
        );
      });

    // ── PRIORITY attrs (always surface first) ────────────────────────────
    } else if (t === 'checkbox') {
      var cbChecked = (v === 'true' || v === '1' || v === 'yes');
      var cbKJ = _esc(JSON.stringify(a.attr_key)); // HTML-safe JSON string for inline JS
      priorityParts.push(
        '<button type="button"'
        + ' onclick="_dbToggleCheckbox(' + cardId + ',' + a.id + ',' + cbKJ + ');event.stopPropagation();"'
        + ' title="' + (cbChecked ? 'Uncheck' : 'Check') + ' ' + _esc(a.attr_key) + '"'
        + ' style="background:none;border:none;padding:0;cursor:pointer;'
        + 'font-family:inherit;font-size:0.75rem;font-weight:500;'
        + 'color:' + (cbChecked ? '#16a34a' : '#9ca3af') + ';'
        + 'display:inline-flex;align-items:center;gap:0.2rem;"'
        + '>'
        + (cbChecked ? '\u2611' : '\u2610') + '\u00a0' + _esc(a.attr_key)
        + '</button>'
      );
    } else if (t === 'status' && v) {
      var sc = _dbStatusColor(v);
      priorityParts.push(
        '<span style="color:' + sc + ';" class="text-xs font-semibold max-w-[140px] truncate inline-block">'
        + _esc(v) + '</span>'
      );
    } else if (t === 'person' && v) {
      // Render each name as a small indigo pill in the priority bucket
      var pePreviewBg  = isDark ? 'rgba(99,102,241,0.15)' : '#eef2ff';
      var pePreviewClr = isDark ? '#a5b4fc' : '#4338ca';
      var pePreviewBdr = isDark ? 'rgba(99,102,241,0.3)'  : '#c7d2fe';
      v.split(',').map(function(n) { return n.trim(); }).filter(Boolean).forEach(function(name) {
        priorityParts.push(
          '<span style="background:' + pePreviewBg + ';color:' + pePreviewClr + ';'
          + 'border:1px solid ' + pePreviewBdr + ';'
          + 'border-radius:9999px;font-size:0.68rem;font-weight:500;'
          + 'padding:0.08rem 0.45rem;white-space:nowrap;display:inline-flex;'
          + 'align-items:center;gap:0.15rem;">'
          + '\uD83D\uDC64\u00a0' + _esc(name)
          + '</span>'
        );
      });
    } else if (t === 'phone' && v) {
      var phNums  = v.split(',').map(function(n) { return n.trim(); }).filter(Boolean);
      var phFmtd  = phNums.slice(0, 2).map(function(n) { return _dbFmtPhone(n); });
      var phLabel = phFmtd.join(', ');
      if (phNums.length > 2) phLabel += ' +' + (phNums.length - 2);
      var phRawJ  = _esc(JSON.stringify(v)); // HTML-safe JSON string for inline JS
      priorityParts.push(
        '<button type="button"'
        + ' onclick="_dbPillPhoneClick(' + phRawJ + ');event.stopPropagation();"'
        + ' title="View phone number(s)"'
        + ' style="background:none;border:none;padding:0;cursor:pointer;'
        + 'font-family:inherit;font-size:0.75rem;'
        + 'color:inherit;display:inline-flex;align-items:center;gap:0.2rem;'
        + 'max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
        + '\uD83D\uDCDE\u00a0' + _esc(phLabel)
        + '</button>'
      );
    } else if (t === 'place' && v) {
      var plProv  = a.attr_options || 'google';
      var plEnc   = encodeURIComponent(v);
      var plUrl   = plProv === 'apple' ? 'https://maps.apple.com/?q=' + plEnc
                  : plProv === 'osm'   ? 'https://www.openstreetmap.org/search?query=' + plEnc
                  : 'https://maps.google.com/?q=' + plEnc;
      var plParts = v.split(',');
      var plShort = plParts.slice(0, 2).join(',').trim();
      if (plShort.length > 26) plShort = plShort.slice(0, 24) + '\u2026';
      priorityParts.push(
        '<a href="' + _esc(plUrl) + '" target="_blank" rel="noopener"'
        + ' onclick="event.stopPropagation()"'
        + ' style="font-size:0.7rem;color:' + pillLinkClr + ';text-decoration:underline;'
        + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
        + 'max-width:160px;display:inline-block;vertical-align:middle;">'
        + '\uD83D\uDDFA\uFE0F\u00a0' + _esc(plShort) + '</a>'
      );
    } else if ((t === 'url' || t === 'email') && v) {
      priorityParts.push(
        '<span style="font-size:0.75rem;color:' + pillLinkClr + ';'
        + 'max-width:160px;overflow:hidden;text-overflow:ellipsis;'
        + 'white-space:nowrap;display:inline-block;">'
        + _esc(v) + '</span>'
      );

    // ── NORMAL attrs (fill remaining slots) ──────────────────────────────
    } else if (t === 'date' && v) {
      var fmtId = a.attr_options || 'mdy';
      normalParts.push(
        '<span class="text-xs text-gray-500 dark:text-zinc-400">'
        + '\uD83D\uDCC5\u00a0' + _esc(_dbFormatDate(v.slice(0, 10), fmtId)) + '</span>'
      );
    } else if (t === 'number' && v) {
      var nOpts = _dbParseNumOpts(a.attr_options || '');
      var nVis  = _dbNumVisHtml(v, nOpts, true);
      if (nVis) {
        normalParts.push('<div style="width:104px;flex-shrink:0;">' + nVis + '</div>');
      } else {
        normalParts.push(
          '<span class="text-xs text-gray-500 dark:text-zinc-400 max-w-[140px] truncate inline-block">'
          + _esc(_dbFormatNumber(v, nOpts)) + '</span>'
        );
      }
    } else if (t === 'files') {
      var fList = _dbParseFiles(v);
      if (fList.length > 0) {
        var fileFmt   = a.attr_options || 'name';
        var MAX_PREV  = 3;
        var fileLinks = fList.slice(0, MAX_PREV).map(function(f) {
          var isExt = /^https?:\/\//i.test(f.url);
          var icon  = isExt ? '\uD83D\uDD17' : '\uD83D\uDCCE';
          var label;
          if (fileFmt === 'full') {
            var fl = f.url; if (fl.length > 28) fl = '\u2026' + fl.slice(-26);
            label = icon + '\u00a0' + _esc(fl);
          } else if (fileFmt === 'short') {
            var sl = f.url.replace(/^https?:\/\//, ''); if (sl.length > 28) sl = '\u2026' + sl.slice(-26);
            label = icon + '\u00a0' + _esc(sl);
          } else {
            var nl = f.name || f.url; if (nl.length > 22) nl = nl.slice(0, 20) + '\u2026';
            label = icon + '\u00a0' + _esc(nl);
          }
          return '<a href="' + _esc(f.url) + '" target="_blank" rel="noopener"'
            + ' onclick="event.stopPropagation()"'
            + ' style="font-size:0.7rem;color:' + pillLinkClr + ';text-decoration:underline;'
            + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;display:inline-block;vertical-align:middle;">'
            + label + '</a>';
        });
        var extra = fList.length - MAX_PREV;
        var fHtml = fileLinks.join('<span style="font-size:0.6rem;color:#d1d5db;margin:0 0.2rem;">\u00b7</span>');
        if (extra > 0) fHtml += '<span style="font-size:0.65rem;color:#9ca3af;">\u00a0+' + extra + '</span>';
        fileParts.push(fHtml);
      }
    } else if (t === 'date_range' && v) {
      var drFmtPill = a.attr_options || 'short';
      var drDisp = _dbFormatDateRange(v, drFmtPill);
      if (drDisp) {
        normalParts.push(
          '<span class="text-xs text-gray-500 dark:text-zinc-400 whitespace-nowrap">'
          + '\uD83D\uDCC5\u00a0' + _esc(drDisp) + '</span>'
        );
      }
    } else if (t === 'progress') {
      var pgOptsPill = _dbParsePgOpts(a.attr_options);
      var pgMaxPill  = pgOptsPill.max || 100;
      var pgValPill  = Math.min(pgMaxPill, Math.max(0, parseInt(v, 10) || 0));
      var pgFillPill = Math.min(100, Math.round((pgValPill / pgMaxPill) * 100));
      var pgBg   = isDark ? '#3f3f46' : '#e5e7eb';
      var pgLblPill = pgMaxPill === 100 ? pgValPill + '%' : pgValPill + '\u202F/\u202F' + pgMaxPill;
      normalParts.push(
        '<div style="display:inline-flex;align-items:center;gap:0.3rem;min-width:80px;">'
        + '<div style="flex:1;min-width:48px;height:5px;border-radius:3px;'
        + 'background:' + pgBg + ';overflow:hidden;">'
        + '<div style="height:100%;width:' + pgFillPill + '%;background:#0053e2;'
        + 'border-radius:3px;transition:width 0.2s;"></div>'
        + '</div>'
        + '<span style="font-size:0.65rem;color:' + (isDark ? '#a1a1aa' : '#6b7280') + ';'
        + 'font-variant-numeric:tabular-nums;white-space:nowrap;">' + pgLblPill + '</span>'
        + '</div>'
      );
    } else if (t === 'rating') {
      var rtOptsPill = _dbParseRtOpts(a.attr_options);
      var rtScalePill = rtOptsPill.scale || 5;
      var rtIcIdPill  = rtOptsPill.icon  || 'star';
      var rtIcPill    = _DB_RT_ICON_MAP[rtIcIdPill] || _DB_RT_ICON_MAP.star;
      var rtValPill   = Math.min(rtScalePill, Math.max(0, parseInt(v, 10) || 0));
      if (rtValPill > 0) {
        var rtEmpClr  = isDark ? '#52525b' : '#d1d5db';
        var rtStars   = '';
        for (var ri = 1; ri <= rtScalePill; ri++) {
          var riOn = ri <= rtValPill;
          rtStars += '<span style="color:' + (riOn ? rtIcPill.clr : rtEmpClr) + ';'
            + 'font-size:' + (rtScalePill > 5 ? '0.6rem' : '0.7rem') + ';">' + (riOn ? rtIcPill.on : rtIcPill.off) + '</span>';
        }
        normalParts.push('<span style="display:inline-flex;align-items:center;gap:0.05rem;">' + rtStars + '</span>');
      }
    } else if (v) {
      // text (person is handled above in priorityParts)
      normalParts.push(
        '<span class="text-xs text-gray-500 dark:text-zinc-400 max-w-[140px] truncate inline-block">'
        + _esc(v) + '</span>'
      );
    }
  }

  if (priorityParts.length === 0 && normalParts.length === 0 &&
      chipParts.length === 0 && fileParts.length === 0) return '';

  // Merge: priority attrs first, fill remainder with normal attrs, cap at 6.
  var MAX_CHIPS = 4;
  var MAX_PLAIN = 6;
  var plainParts = priorityParts.concat(normalParts);
  var html = '';

  if (chipParts.length > 0) {
    var extraC   = chipParts.length - MAX_CHIPS;
    var chipHtml = chipParts.slice(0, MAX_CHIPS).join('');
    if (extraC > 0) chipHtml += '<span class="text-[10px] text-gray-400 dark:text-zinc-500 px-1">+' + extraC + ' more</span>';
    html += '<div class="flex flex-wrap gap-1">' + chipHtml + '</div>';
  }

  if (plainParts.length > 0) {
    var extraP    = plainParts.length - MAX_PLAIN;
    var plainHtml = plainParts.slice(0, MAX_PLAIN).join(
      '<span class="text-[10px] text-gray-300 dark:text-zinc-600 mx-0.5">\u00b7</span>'
    );
    if (extraP > 0) plainHtml += '<span class="text-[10px] text-gray-400 dark:text-zinc-500">\u00a0+' + extraP + '</span>';
    html += '<div class="flex flex-wrap items-center gap-1">' + plainHtml + '</div>';
  }

  if (fileParts.length > 0) {
    html += '<div style="display:flex;flex-direction:column;gap:0.15rem;margin-top:0.1rem;">';
    for (var fi = 0; fi < fileParts.length; fi++) {
      html += '<div style="display:flex;align-items:center;gap:0.3rem;flex-wrap:wrap;">' + fileParts[fi] + '</div>';
    }
    html += '</div>';
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
    keepalive: true,   // survive a tab close (beforeunload flush)
  })
  .then(function(r) { if (!r.ok || r.redirected) throw new Error('save failed: ' + r.status); })
  .catch(function(e) {
    console.warn('Note save failed', e);
    if (typeof _bwToast === 'function') _bwToast("⚠️ Couldn't save card note — try again");
  });
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
    keepalive: true,
  })
  .then(function(r) { if (!r.ok || r.redirected) throw new Error('save failed: ' + r.status); })
  .catch(function(e) {
    console.warn('Title save failed', e);
    if (typeof _bwToast === 'function') _bwToast("⚠️ Couldn't save card title — try again");
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   NOTE AREA TOOLS  —  heading CSS + slash palette + selection toolbar + paste-as
═══════════════════════════════════════════════════════════════════════════ */

function _dbInitStyles() {
  if (document.getElementById('db-note-styles')) return;
  var s = document.createElement('style');
  s.id = 'db-note-styles';
  s.textContent = [
    /* ── Card multi-select ──────────────────────────────────── */
    '.db-ms-cb{position:absolute;top:8px;left:8px;z-index:2;width:20px;height:20px;',
    'border-radius:50%;border:2px solid #d1d5db;background:#fff;display:none;',
    'align-items:center;justify-content:center;pointer-events:none;transition:border-color .15s,background .15s;}',
    '.dark .db-ms-cb{background:#27272a;border-color:#52525b;}',
    '#db-card-grid.db-ms .db-card{cursor:pointer;user-select:none;}',
    '#db-card-grid.db-ms .db-ms-cb{display:flex;}',
    '#db-card-grid.db-ms .db-card.db-ms-sel{outline:2px solid #7c3aed;outline-offset:1px;}',
    '#db-card-grid.db-ms .db-card.db-ms-sel .db-ms-cb{background:#7c3aed;border-color:#7c3aed;}',
    '.db-ms-cb-tick{display:none;color:#fff;}',
    '.db-ms-sel .db-ms-cb-tick{display:block;}',
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
    /* ── YAML readability — keys/strings/numbers were too close in the GitHub
       palette (keys & numbers both blue). Scope distinct colours to YAML so
       keys=purple, strings=green, numbers/bools=blue, comments=gray.   ── */
    '[data-db-note] pre code.language-yaml .hljs-attr,',
    '[data-db-note] pre code.language-yml .hljs-attr{color:#6f42c1;font-weight:600;}',
    '[data-db-note] pre code.language-yaml .hljs-string,',
    '[data-db-note] pre code.language-yml .hljs-string{color:#1a7f37;}',
    '[data-db-note] pre code.language-yaml .hljs-number,',
    '[data-db-note] pre code.language-yaml .hljs-literal,',
    '[data-db-note] pre code.language-yml .hljs-number,',
    '[data-db-note] pre code.language-yml .hljs-literal{color:#0550ae;}',
    '.dark [data-db-note] pre code.language-yaml .hljs-attr,',
    '.dark [data-db-note] pre code.language-yml .hljs-attr{color:#d2a8ff;font-weight:600;}',
    '.dark [data-db-note] pre code.language-yaml .hljs-string,',
    '.dark [data-db-note] pre code.language-yml .hljs-string{color:#7ee787;}',
    '.dark [data-db-note] pre code.language-yaml .hljs-number,',
    '.dark [data-db-note] pre code.language-yaml .hljs-literal,',
    '.dark [data-db-note] pre code.language-yml .hljs-number,',
    '.dark [data-db-note] pre code.language-yml .hljs-literal{color:#79c0ff;}',
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
  // Touch devices use the mobile keyboard accessory bar (bw-mobile-toolbar.js)
  // for selection formatting — skip the floating toolbar so they don't overlap.
  if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) return;

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

  /* Saved selection range — captured before a flyout opens so that execCommand
     always has a valid target even if focus flickered during the click.       */
  var _savedRange = null;
  function _saveRange() {
    var sel = window.getSelection();
    _savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
  }
  function _restoreRange() {
    if (!_savedRange) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_savedRange);
  }

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
    _saveRange();  // snapshot selection before flyout opens
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
    _saveRange();  // snapshot selection before flyout opens
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
        _restoreRange();  // put selection back before execCommand
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
  /* Dismiss flyouts when clicking outside the toolbar */
  document.addEventListener('mousedown', function(e) {
    if (!_dbSelBar || _dbSelBar.contains(e.target)) return;
    hlFlyout.classList.remove('open');
    tcFlyout.classList.remove('open');
  });

  document.addEventListener('selectionchange', function() {
    if (_dbSelBarTimer) clearTimeout(_dbSelBarTimer);
    /* While a colour flyout is open the user is picking a swatch — don't
       let a stray selectionchange event yank the bar away mid-pick.        */
    if (hlFlyout.classList.contains('open') || tcFlyout.classList.contains('open')) return;
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
// True when a note CE has no meaningful content (placeholder should show).
// Ignores stray <br>/empty <p> the browser leaves behind after deleting text.
function _dbNoteIsEmpty(el) {
  if (!el) return true;
  if (el.querySelector('img,table,pre,hr,iframe,video,ul,ol,blockquote')) return false;
  return el.textContent.replace(/[​ ]/g, '').trim() === '';
}

// Toggle the empty-state class so CSS shows/hides the placeholder. The CSS
// also keys on :focus, so the placeholder vanishes the moment the line is
// focused and returns on blur when the note is empty.
function _dbNotePlaceholderSync(el) {
  if (el) el.classList.toggle('db-note-empty', _dbNoteIsEmpty(el));
}

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
  // Normalise an effectively-empty note to '' so it persists clean and the
  // :empty-based placeholder logic stays consistent across reloads.
  if (!clone.querySelector('img,table,pre,hr,iframe,video,ul,ol,blockquote') &&
      clone.textContent.replace(/[​ ]/g, '').trim() === '') {
    return '';
  }
  return clone.innerHTML;
}

/* ═══════════════════════════════════════════════════════════════════════════
   DB NOTE — BLOCK GRIP DnD + CLICK-FOR-MENU
═══════════════════════════════════════════════════════════════════════════ */

// Touch devices have no hover, so grips stay visible there (matches the note page).
var _DB_GRIP_TOUCH = !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);

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
    + 'color:' + (_DB_GRIP_TOUCH ? '#9ca3af' : '#d1d5db') + ';font-size:.9rem;line-height:1;user-select:none;'
    + 'opacity:' + (_DB_GRIP_TOUCH ? '0.55' : '0') + ';transition:opacity .12s,color .12s;border-radius:3px;';
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

// Lightweight pass for the input handler: add a grip only to blocks/list items
// that don't already have one, so lines typed after the panel opened still get
// a handle — without removing/re-adding existing grips (which could jostle the
// caret mid-typing).
function _dbEnsureGrips(noteEl) {
  if (!noteEl) return;
  var blocks = Array.prototype.slice.call(noteEl.children);
  Array.prototype.push.apply(blocks, Array.prototype.slice.call(noteEl.querySelectorAll('li')));
  blocks.forEach(function(el) {
    if (el.nodeType !== 1 || el.hasAttribute('data-db-grip')) return;   // skip stray grip spans
    if (el.querySelector(':scope > [data-db-grip]')) return;             // already gripped
    _dbAddGrip(el);
  });
}

function _dbGripEnter(e) {
  var grip = e.currentTarget.querySelector('[data-db-grip]');
  if (grip) { grip.style.opacity = '1'; grip.style.color = '#9ca3af'; }
}
function _dbGripLeave(e) {
  if (_dbGripDragging || _DB_GRIP_TOUCH) return;   /* keep visible while dragging / on touch */
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
/* Markdown shortcut for the db-card note: typing "- " or "* " at the start of
   an otherwise-empty block converts it to a bullet list (the note editor gets
   this for free via markdown; the card stores HTML, so we do it explicitly).
   Returns true when it handled the space (caller should preventDefault). */
function _dbMaybeAutoBullet(noteEl) {
  var sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.rangeCount) return false;

  /* Block = the direct child of noteEl holding the caret */
  var block = sel.getRangeAt(0).startContainer;
  while (block && block.parentNode !== noteEl) block = block.parentNode;
  if (!block || block.parentNode !== noteEl || block.nodeType !== 1) return false;
  if (block.nodeName === 'UL' || block.nodeName === 'OL' || block.nodeName === 'LI') return false;

  /* Block text minus the drag grip — must be exactly "-" or "*" */
  var clone = block.cloneNode(true);
  clone.querySelectorAll('[data-db-grip]').forEach(function(g) { g.remove(); });
  if (['-', '*'].indexOf((clone.textContent || '').trim()) === -1) return false;

  /* Swap the block for an empty <ul><li> */
  var ul = document.createElement('ul');
  var li = document.createElement('li');
  li.appendChild(document.createElement('br'));
  ul.appendChild(li);
  block.replaceWith(ul);
  _dbInjectGrips(noteEl);

  /* Caret into the editable part of the new <li> (after the grip span if any) */
  var grip = li.querySelector('[data-db-grip]');
  var r = document.createRange();
  r.setStart(li, grip ? 1 : 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);

  var cardId = parseInt((noteEl.id || '').replace('db-detail-note-', ''), 10);
  if (cardId) _dbSaveNote(cardId, _dbNoteHtml(noteEl));
  return true;
}

function _dbNoteTabIndent(e, noteEl) {
  if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return false;

  var sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;

  var range = sel.getRangeAt(0);
  var n     = range.startContainer;

  /* ── Empty-bullet fix ────────────────────────────────────────────────────
     When an <li> contains only the non-editable grip span, Chrome reports the
     caret at the PARENT element level (e.g. the <ul>) with startOffset pointing
     to the child <li> by index.  The while-loop below walks UP and never finds
     the <li>, so e.preventDefault() is skipped and the browser nukes the bullet.
     Fix: when cursor is at the element level (not inside a text node), peek at
     the adjacent child node at startOffset / startOffset-1 before walking up. */
  if (n.nodeType !== 3 /* TEXT_NODE */ && n.nodeName !== 'LI') {
    var peek = n.childNodes[range.startOffset - 1] || n.childNodes[range.startOffset];
    if (peek) n = peek;
  }
  if (n.nodeType === 3 /* TEXT_NODE */) n = n.parentElement;

  /* Walk up from cursor to find the <li> containing the caret */
  var li = n;
  while (li && li !== noteEl) {
    if (li.nodeName === 'LI') break;
    li = li.parentNode;
  }
  if (!li || li === noteEl) return false;   /* cursor not in a list item */

  e.preventDefault();

  /* Indent (Tab) / dedent (Shift+Tab) — applies to ALL highlighted rows, not
     just the caret's row. Falls back to the single caret <li> when nothing is
     selected. We preventDefault'd above, so Tab is swallowed either way (the
     browser never focus-jumps to the next form field). */
  var lis  = (typeof window._bwTopSelectedLis === 'function')
               ? window._bwTopSelectedLis(noteEl, range, li) : [li];
  var multi = lis.length > 1 || !range.collapsed;
  if (typeof window._bwApplyListIndent === 'function') {
    window._bwApplyListIndent(lis, e.shiftKey);
  }

  /* Re-inject grips (moved <li> loses its span) + persist */
  _dbInjectGrips(noteEl);
  var cardId = parseInt((noteEl.id || '').replace('db-detail-note-', ''), 10);
  if (cardId) _dbSaveNote(cardId, _dbNoteHtml(noteEl));

  /* Restore cursor: re-span the moved rows for a highlight, else caret in the row */
  setTimeout(function() {
    if (multi && lis.length) {
      var rr = document.createRange();
      rr.setStart(lis[0], 0);
      var lastLi = lis[lis.length - 1];
      rr.setEnd(lastLi, lastLi.childNodes.length);
      sel.removeAllRanges();
      sel.addRange(rr);
      noteEl.focus();
      return;
    }
    var grip     = li.querySelector('[data-db-grip]');
    var textNode = grip ? grip.nextSibling : li.firstChild;
    var r = document.createRange();
    if (textNode && textNode.nodeType === 3 /* TEXT_NODE */) {
      r.setStart(textNode, textNode.length);
      r.collapse(true);
    } else if (textNode) {
      r.selectNodeContents(textNode);
      r.collapse(false);
    } else {
      /* Empty <li> — place cursor at element end so it stays in the bullet */
      r.setStart(li, li.childNodes.length);
      r.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(r);
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
    /* File chip — show an Open / Download menu (checked BEFORE generic links) */
    var fchip = e.target.closest('a.bw-file-chip,[data-bw-file]');
    if (fchip) {
      e.preventDefault();
      _dbFileChipMenu(fchip, e);
      return;
    }
    /* Inline page-link chip — open the sub-page in the panel, NOT a new tab
       (a raw /notes/{id} nav would render the bare partial with no app shell) */
    var pl = e.target.closest('a.bw-page-link[data-note-id]');
    if (pl) {
      e.preventDefault();
      if (typeof window._bwOpenPage === 'function') {
        window._bwOpenPage(pl.getAttribute('data-note-id'), false);
      }
      return;
    }
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
  /* Markdown shortcut: "- " or "* " at the start of an empty block → bullet list
     (parity with the note editor). Use beforeinput, NOT keydown: mobile soft
     keyboards don't fire keydown with the real character key, so a keydown
     `e.key === ' '` check never matches on phones. beforeinput fires reliably
     for typed text on both mobile and desktop, and is cancelable. */
  noteEl.addEventListener('beforeinput', function(e) {
    if (e.inputType === 'insertText' && e.data === ' ' && _dbMaybeAutoBullet(noteEl)) {
      e.preventDefault();
    }
  });

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

/**
 * Flush any pending unsaved note to the server.
 * Called by closePanel() in index.html BEFORE the DOM is wiped,
 * so the note element is still live when we read its innerHTML.
 * Safe to call at any time — no-ops if no DB card is open.
 */
function _dbFlushNote() {
  // Prefer the in-memory dirty snapshot captured on every input event —
  // zero DOM dependency, works even after the element is removed.
  if (_dbDirtyNote) {
    var dirty = _dbDirtyNote;
    _dbDirtyNote = null;
    var timerKey = 'detail_' + dirty.cardId;
    if (_dbSaveTimers[timerKey]) {
      clearTimeout(_dbSaveTimers[timerKey]);
      delete _dbSaveTimers[timerKey];
    }
    _dbSaveNote(dirty.cardId, dirty.html);
    return;
  }
  // Fallback: DOM is still live (e.g. blur already cleared dirty flag).
  if (!_dbDetailId) return;
  var timerKey2 = 'detail_' + _dbDetailId;
  if (_dbSaveTimers[timerKey2]) {
    clearTimeout(_dbSaveTimers[timerKey2]);
    delete _dbSaveTimers[timerKey2];
  }
  var noteEl = document.getElementById('db-detail-note-' + _dbDetailId);
  if (noteEl) _dbSaveNote(_dbDetailId, _dbNoteHtml(noteEl));
}

function _dbCloseDetail() {
  _dbFlushNote();
  _dbDetailId = null;
  // Remove the click-outside listener
  var panelEl = document.getElementById('panel');
  if (panelEl && _dbPanelClickHandler) {
    panelEl.removeEventListener('click', _dbPanelClickHandler);
    _dbPanelClickHandler = null;
  }
  // Reuse the app's panel close so all three view modes get cleaned up correctly
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
      format:    o.format    || 'number',
      decimals:  (o.decimals  !== undefined) ? parseInt(o.decimals, 10) : 0,
      display:   o.display   || 'number',   // 'number' | 'bar' | 'ring'
      barColor:  o.barColor  || 'blue',
      divideBy:  (o.divideBy !== undefined && o.divideBy !== '') ? parseFloat(o.divideBy) : 100,
      showValue: (o.showValue !== undefined) ? !!o.showValue : true,
    };
  } catch(e) {
    return { format:'number', decimals:0, display:'number', barColor:'blue', divideBy:100, showValue:true };
  }
}

// Parse progress attr_options JSON — safe, always returns a full object.
function _dbParsePgOpts(s) {
  try {
    var o = JSON.parse(s || '{}');
    return {
      max:     (o.max && parseInt(o.max, 10) > 0) ? parseInt(o.max, 10) : 100,
      display: o.display || 'bar',   // 'bar' | 'number' | 'both'
    };
  } catch(e) {
    return { max: 100, display: 'bar' };
  }
}

// Parse rating attr_options JSON — safe, always returns a full object.
function _dbParseRtOpts(s) {
  try {
    var o = JSON.parse(s || '{}');
    return {
      scale: (o.scale && parseInt(o.scale, 10) > 0) ? parseInt(o.scale, 10) : 5,
      icon:  o.icon || 'star',   // 'star' | 'heart' | 'thumb' | 'dot'
    };
  } catch(e) {
    return { scale: 5, icon: 'star' };
  }
}

// Normalise raw value to a 0–1 fraction given number opts.
function _dbNumFraction(raw, numOpts) {
  var n = parseFloat(raw);
  if (isNaN(n)) return 0;
  var divBy = numOpts.format === 'percent' ? 100 : (numOpts.divideBy || 100);
  if (!divBy) return 0;
  return Math.min(1, Math.max(0, n / divBy));
}

// Return bar/ring HTML, or '' for plain 'number' display.
// compact=true → small card-preview size; false → full detail-panel size.
function _dbNumVisHtml(raw, numOpts, compact) {
  var display = numOpts.display || 'number';
  if (display === 'number') return '';

  var frac     = _dbNumFraction(raw, numOpts);
  var cDef     = _dbOptColorDef(numOpts.barColor || 'blue');
  var dk       = document.documentElement.classList.contains('dark');
  var fillClr  = cDef.dot;
  var trackClr = dk ? '#3f3f46' : '#e5e7eb';
  var shown    = (raw !== '') ? _dbFormatNumber(raw, numOpts) : '';
  var pctW     = (frac * 100).toFixed(1) + '%';

  if (display === 'bar') {
    var h  = compact ? '5px'  : '7px';
    var fs = compact ? '0.7rem' : '0.72rem';
    var cl = compact ? '#a1a1aa' : (dk ? '#a1a1aa' : '#6b7280');
    var html = '<div style="display:flex;align-items:center;gap:' + (compact ? '0.25rem' : '0.35rem') + ';width:100%;">'
      + '<div style="flex:1;height:' + h + ';background:' + trackClr + ';border-radius:9999px;overflow:hidden;">'
      + '<div style="width:' + pctW + ';height:100%;background:' + fillClr + ';border-radius:9999px;'
      + (compact ? '' : 'transition:width 0.25s;') + '"></div></div>';
    if (numOpts.showValue && shown) {
      html += '<span style="font-size:' + fs + ';color:' + cl + ';flex-shrink:0;white-space:nowrap;">'
        + _esc(shown) + '</span>';
    }
    return html + '</div>';
  }

  if (display === 'ring') {
    var r   = compact ? 11 : 15;
    var sw  = compact ? 2.5: 3;
    var sz  = compact ? 26 : 38;
    var cx  = sz / 2;
    var circ = +(2 * Math.PI * r).toFixed(2);
    var off  = +(circ * (1 - frac)).toFixed(2);
    var fs2  = compact ? '0.7rem' : '0.72rem';
    var cl2  = compact ? '#a1a1aa' : (dk ? '#a1a1aa' : '#6b7280');
    var html = '<div style="display:flex;align-items:center;gap:' + (compact ? '0.2rem' : '0.35rem') + ';">'
      + '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 ' + sz + ' ' + sz + '" style="flex-shrink:0;">'
      + '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '"'
      + ' fill="none" stroke="' + trackClr + '" stroke-width="' + sw + '"/>'
      + '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '"'
      + ' fill="none" stroke="' + fillClr + '" stroke-width="' + sw + '"'
      + ' stroke-dasharray="' + circ + '" stroke-dashoffset="' + off + '"'
      + ' stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cx + ')"/>'
      + '</svg>';
    if (numOpts.showValue && shown) {
      html += '<span style="font-size:' + fs2 + ';color:' + cl2 + ';white-space:nowrap;">'
        + _esc(shown) + '</span>';
    }
    return html + '</div>';
  }

  return '';
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

// Format a stored date_range value ("YYYY-MM-DD|YYYY-MM-DD") for display.
// fmtId matches _DB_DATE_FORMATS ids; defaults to 'short' (Apr 22, 2025).
function _dbFormatDateRange(v, fmtId) {
  var fmt    = fmtId || 'short';
  var parts  = (v || '').split('|');
  var start  = (parts[0] || '').trim().slice(0, 10);
  var end    = (parts[1] || '').trim().slice(0, 10);
  var sl     = start ? _dbFormatDate(start, fmt) : '';
  var el     = end   ? _dbFormatDate(end,   fmt) : '';
  if (sl && el) return sl + ' \u2192 ' + el;
  if (sl)       return sl + ' \u2192';
  if (el)       return '\u2192 ' + el;
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

/** On blur: save raw value to server, re-display formatted, update bar/ring in-place. */
function _dbNumBlurSave(inp, cardId, attrId, key) {
  var raw  = inp.value.trim();
  inp.setAttribute('data-rawval', raw);
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var meta = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  var atype = meta ? (meta.attr_type    || 'number') : 'number';
  var aopts = meta ? (meta.attr_options || '')        : '';
  var numOpts = _dbParseNumOpts(aopts);
  inp.value = raw ? _dbFormatNumber(raw, numOpts) : '';
  // surgical bar/ring update — no full rebuild
  var frac = _dbNumFraction(raw, numOpts);
  var fillEl = document.getElementById('_dbn-fill-' + attrId);
  if (fillEl) fillEl.style.width = (frac * 100).toFixed(1) + '%';
  var ringEl = document.getElementById('_dbn-ring-' + attrId);
  if (ringEl) {
    var r = 15, circ = +(2 * Math.PI * r).toFixed(2);
    ringEl.setAttribute('stroke-dashoffset', +(circ * (1 - frac)).toFixed(2));
  }
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

/* ─────────────────────────────────────────────────────────────────────────
   PLACE AUTOCOMPLETE  (Nominatim / OpenStreetMap — no API key needed)
───────────────────────────────────────────────────────────────────────── */

var _dbPlaceTimer = null; // debounce handle
var _dbPlaceDrop  = null; // active dropdown element reference

function _dbPlaceDropClose() {
  if (_dbPlaceDrop) { _dbPlaceDrop.remove(); _dbPlaceDrop = null; }
  clearTimeout(_dbPlaceTimer);
}

function _dbPlaceSearch(e, cardId, attrId, key) {
  var inp = e.target;
  clearTimeout(_dbPlaceTimer);
  _dbPlaceDropClose();
  var q = inp.value.trim();
  if (q.length < 3) return;

  _dbPlaceTimer = setTimeout(function() {
    var url = 'https://nominatim.openstreetmap.org/search'
      + '?format=json&addressdetails=1&limit=7&q=' + encodeURIComponent(q);

    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function(r) { return r.json(); })
      .then(function(results) {
        _dbPlaceDropClose();
        if (!results || !results.length) return;
        if (document.activeElement !== inp) return; // user already left

        var isDark  = document.documentElement.classList.contains('dark');
        var dropBg  = isDark ? '#27272a' : '#ffffff';
        var dropBdr = isDark ? '#3f3f46' : '#d1d5db';
        var dropTxt = isDark ? '#f4f4f5' : '#111827';
        var dropHov = isDark ? '#3f3f46' : '#f3f4f6';
        var dropSub = isDark ? '#a1a1aa' : '#6b7280';

        var drop = document.createElement('div');
        drop.id = 'db-place-drop';
        drop.setAttribute('role', 'listbox');

        var rect = inp.getBoundingClientRect();
        drop.style.cssText =
          'position:fixed;z-index:10600;'
          + 'background:' + dropBg + ';border:1px solid ' + dropBdr + ';'
          + 'border-radius:0.5rem;box-shadow:0 8px 28px rgba(0,0,0,0.18);'
          + 'max-height:16rem;overflow-y:auto;'
          + 'top:' + (rect.bottom + 5) + 'px;'
          + 'left:' + rect.left + 'px;'
          + 'width:' + Math.max(rect.width, 300) + 'px;'
          + 'font-size:0.75rem;';

        results.forEach(function(res, idx) {
          var displayName = res.display_name || '';
          var parts = displayName.split(',');
          // Short label: first 2-3 meaningful parts
          var shortLabel = parts.slice(0, 3).join(',').trim();
          var subLabel   = parts.slice(3).join(',').trim();

          var item = document.createElement('div');
          item.setAttribute('role', 'option');
          item.style.cssText =
            'padding:0.45rem 0.75rem;cursor:pointer;'
            + (idx < results.length - 1 ? 'border-bottom:1px solid ' + dropBdr + ';' : '');

          var mainDiv = document.createElement('div');
          mainDiv.style.cssText = 'font-weight:500;color:' + dropTxt + ';';
          mainDiv.textContent = shortLabel;

          var subDiv = document.createElement('div');
          subDiv.style.cssText =
            'font-size:0.67rem;color:' + dropSub + ';margin-top:0.1rem;'
            + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          subDiv.textContent = subLabel;

          item.appendChild(mainDiv);
          if (subLabel) item.appendChild(subDiv);

          item.addEventListener('mouseenter', function() {
            item.style.background = dropHov;
          });
          item.addEventListener('mouseleave', function() {
            item.style.background = '';
          });

          // mousedown + preventDefault keeps focus on inp so blur doesn't fire
          item.addEventListener('mousedown', function(ev) {
            ev.preventDefault();
            _dbPlaceDropClose();
            inp.value = displayName;
            // Update local card state immediately
            var card = _dbCards.find(function(c) { return c.id === cardId; });
            if (card && card.attrs) {
              var attr = card.attrs.find(function(a) { return a.id === attrId; });
              if (attr) attr.attr_value = displayName;
            }
            // Persist + re-render (map link updates after save)
            _dbSaveAttrVal(cardId, attrId, key, displayName);
            if (card) _dbRenderDetailPanel(card);
          });

          drop.appendChild(item);
        });

        // OSM attribution note (required by Nominatim usage policy)
        var attr = document.createElement('div');
        attr.style.cssText =
          'padding:0.3rem 0.75rem;font-size:0.6rem;color:' + dropSub
          + ';border-top:1px solid ' + dropBdr + ';text-align:right;';
        attr.textContent = '\u00a9 OpenStreetMap contributors';
        drop.appendChild(attr);

        document.body.appendChild(drop);
        _dbPlaceDrop = drop;

        // Dismiss on outside click or scroll
        function onOutside(ev) {
          if (!drop.contains(ev.target) && ev.target !== inp) {
            _dbPlaceDropClose();
            document.removeEventListener('mousedown', onOutside);
            document.removeEventListener('scroll', onOutside, true);
          }
        }
        // Tiny delay so the current mousedown that opened the input
        // doesn’t immediately re-trigger the listener.
        setTimeout(function() {
          document.addEventListener('mousedown', onOutside);
          document.addEventListener('scroll', onOutside, true);
        }, 0);
      })
      .catch(function() { /* network error or rate limit — silent fail */ });
  }, 500);
}

/* Strip non-digits, return US-formatted string.
   11-digit (1-prefixed) → +1(NXX)NXX-XXXX
   10-digit              → (NXX)NXX-XXXX
   7-digit               → NXX-XXXX
   anything else         → trimmed as-is */
function _dbFmtPhone(raw) {
  var d = raw.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') {
    return '+1(' + d.slice(1, 4) + ')' + d.slice(4, 7) + '-' + d.slice(7, 11);
  }
  if (d.length === 10) {
    return '(' + d.slice(0, 3) + ')' + d.slice(3, 6) + '-' + d.slice(6, 10);
  }
  if (d.length === 7) {
    return d.slice(0, 3) + '-' + d.slice(3, 7);
  }
  return raw.trim();
}

/* Phone number popup — big readable view, copy + call buttons.
   Clicking outside or pressing Escape closes it.
   Clicking the same pill again while popup is open also closes it. */
function _dbPhonePopup(formatted, telHref) {
  var existing = document.getElementById('db-phone-popup');
  if (existing) { existing.remove(); return; }

  var isDark = document.documentElement.classList.contains('dark');
  var bg     = isDark ? '#27272a' : '#ffffff';
  var bdr    = isDark ? '#3f3f46' : '#e5e7eb';
  var txt    = isDark ? '#f4f4f5' : '#111827';
  var sub    = isDark ? '#71717a' : '#9ca3af';
  var btnBg  = isDark ? '#3f3f46' : '#f3f4f6';
  var btnBdr = isDark ? '#52525b' : '#d1d5db';
  var btnTxt = isDark ? '#d4d4d8' : '#374151';

  // Overlay
  var ov = document.createElement('div');
  ov.id = 'db-phone-popup';
  ov.style.cssText =
    'position:fixed;inset:0;z-index:10500;display:flex;'
    + 'align-items:center;justify-content:center;padding:1rem;';

  // Backdrop
  var bd = document.createElement('div');
  bd.style.cssText =
    'position:absolute;inset:0;background:rgba(0,0,0,0.35);backdrop-filter:blur(3px);';
  bd.addEventListener('click', function() { ov.remove(); });
  ov.appendChild(bd);

  // Card
  var card = document.createElement('div');
  card.style.cssText =
    'position:relative;background:' + bg + ';border:1px solid ' + bdr + ';'
    + 'border-radius:1rem;padding:1.75rem 2rem 1.5rem;min-width:15rem;'
    + 'text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.28);';

  // × Close
  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '&times;';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.cssText =
    'position:absolute;top:0.6rem;right:0.75rem;background:none;border:none;'
    + 'cursor:pointer;font-size:1.3rem;line-height:1;color:' + sub + ';padding:0.15rem 0.3rem;';
  closeBtn.addEventListener('click', function() { ov.remove(); });
  card.appendChild(closeBtn);

  // Phone icon
  var iconEl = document.createElement('div');
  iconEl.textContent = '\uD83D\uDCDE';
  iconEl.style.cssText = 'font-size:2rem;margin-bottom:0.4rem;line-height:1;';
  card.appendChild(iconEl);

  // Big number — user-select:all so a single click selects the whole number
  var numEl = document.createElement('div');
  numEl.textContent = formatted;
  numEl.setAttribute('title', 'Click to select all');
  numEl.style.cssText =
    'font-size:1.65rem;font-weight:700;color:' + txt + ';'
    + 'letter-spacing:0.04em;font-variant-numeric:tabular-nums;'
    + 'user-select:all;cursor:text;margin-bottom:1.25rem;line-height:1.3;';
  card.appendChild(numEl);

  // Action row
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:0.6rem;justify-content:center;flex-wrap:wrap;';

  // Copy button
  var copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.innerHTML = '&#128203; Copy';
  copyBtn.style.cssText =
    'padding:0.45rem 1.1rem;border-radius:0.5rem;font-size:0.8rem;font-weight:500;'
    + 'cursor:pointer;background:' + btnBg + ';border:1px solid ' + btnBdr
    + ';color:' + btnTxt + ';transition:opacity 0.15s;';
  copyBtn.addEventListener('click', function() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(formatted).then(function() {
        copyBtn.innerHTML = '&#10003; Copied!';
        setTimeout(function() { copyBtn.innerHTML = '&#128203; Copy'; }, 1600);
      });
    } else {
      // Fallback: select the number text so the user can Ctrl+C
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(numEl);
      sel.removeAllRanges();
      sel.addRange(range);
      copyBtn.innerHTML = '&#10003; Selected!';
      setTimeout(function() { copyBtn.innerHTML = '&#128203; Copy'; }, 1600);
    }
  });
  row.appendChild(copyBtn);

  // Call button
  var callLink = document.createElement('a');
  callLink.href = 'tel:' + telHref;
  callLink.innerHTML = '&#128222; Call';
  callLink.style.cssText =
    'padding:0.45rem 1.1rem;border-radius:0.5rem;font-size:0.8rem;font-weight:500;'
    + 'cursor:pointer;background:#0053e2;color:#fff;text-decoration:none;'
    + 'display:inline-flex;align-items:center;gap:0.25rem;';
  row.appendChild(callLink);

  card.appendChild(row);
  ov.appendChild(card);
  document.body.appendChild(ov);

  // Escape to close
  function onKey(e) {
    if (e.key === 'Escape') {
      ov.remove();
      document.removeEventListener('keydown', onKey, true);
    }
  }
  document.addEventListener('keydown', onKey, true);
}

// Card-preview pill click handler for phone attributes.
// Single number  → reuses the existing _dbPhonePopup (large number + copy/call).
// Multiple numbers → shows a list popup with one row per number.
function _dbPillPhoneClick(rawValue) {
  // Close any open phone popup first (toggle behaviour)
  var existing = document.getElementById('db-phone-popup');
  if (existing) { existing.remove(); return; }

  var nums = (rawValue || '').split(',').map(function(n) { return n.trim(); }).filter(Boolean);
  if (!nums.length) return;

  // Single number: delegate to the existing detail-panel popup
  if (nums.length === 1) {
    var fmt    = _dbFmtPhone(nums[0]);
    var digits  = nums[0].replace(/\D/g, '');
    var href    = digits.length === 10 ? '+1' + digits
                : digits.length >= 11  ? '+' + digits
                : digits || nums[0];
    _dbPhonePopup(fmt, href);
    return;
  }

  // Multiple numbers: build a list popup
  var isDark  = document.documentElement.classList.contains('dark');
  var bg      = isDark ? '#27272a' : '#ffffff';
  var bdr     = isDark ? '#3f3f46' : '#e5e7eb';
  var txt     = isDark ? '#f4f4f5' : '#111827';
  var sub     = isDark ? '#71717a' : '#9ca3af';
  var rowHov  = isDark ? '#3f3f46' : '#f9fafb';
  var btnBg   = isDark ? '#3f3f46' : '#f3f4f6';
  var btnBdr  = isDark ? '#52525b' : '#d1d5db';
  var btnTxt  = isDark ? '#d4d4d8' : '#374151';

  var ov = document.createElement('div');
  ov.id = 'db-phone-popup';
  ov.style.cssText =
    'position:fixed;inset:0;z-index:10500;display:flex;'
    + 'align-items:center;justify-content:center;padding:1rem;';

  var bd = document.createElement('div');
  bd.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.35);backdrop-filter:blur(3px);';
  bd.addEventListener('click', function() { ov.remove(); });
  ov.appendChild(bd);

  var card = document.createElement('div');
  card.style.cssText =
    'position:relative;background:' + bg + ';border:1px solid ' + bdr + ';'
    + 'border-radius:1rem;padding:1.5rem 2rem 1.25rem;min-width:16rem;max-width:22rem;'
    + 'box-shadow:0 20px 60px rgba(0,0,0,0.28);';

  // × close
  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '&times;';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.cssText =
    'position:absolute;top:0.6rem;right:0.75rem;background:none;border:none;'
    + 'cursor:pointer;font-size:1.3rem;line-height:1;color:' + sub + ';padding:0.15rem 0.3rem;';
  closeBtn.addEventListener('click', function() { ov.remove(); });
  card.appendChild(closeBtn);

  // Header
  var hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:0.7rem;color:' + sub + ';margin-bottom:0.75rem;text-transform:uppercase;letter-spacing:0.05em;';
  hdr.textContent = nums.length + ' phone numbers';
  card.appendChild(hdr);

  // One row per number
  nums.forEach(function(raw, idx) {
    var formatted = _dbFmtPhone(raw);
    var digits    = raw.replace(/\D/g, '');
    var telHref   = digits.length === 10 ? '+1' + digits
                  : digits.length >= 11  ? '+' + digits
                  : digits || raw;

    var row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;gap:0.75rem;'
      + 'padding:0.5rem 0.5rem;border-radius:0.5rem;'
      + (idx < nums.length - 1 ? 'border-bottom:1px solid ' + bdr + ';' : '');

    row.addEventListener('mouseenter', function() { row.style.background = rowHov; });
    row.addEventListener('mouseleave', function() { row.style.background = ''; });

    // Number text — user-select:all for easy keyboard copy
    var numSpan = document.createElement('span');
    numSpan.textContent = formatted;
    numSpan.title = 'Click to select';
    numSpan.style.cssText =
      'font-size:1.1rem;font-weight:600;color:' + txt + ';'
      + 'font-variant-numeric:tabular-nums;user-select:all;cursor:text;flex:1;';
    row.appendChild(numSpan);

    // Action buttons
    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:0.4rem;flex-shrink:0;';

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.innerHTML = '&#128203;';
    copyBtn.title = 'Copy';
    copyBtn.style.cssText =
      'padding:0.3rem 0.5rem;border-radius:0.375rem;font-size:0.8rem;cursor:pointer;'
      + 'background:' + btnBg + ';border:1px solid ' + btnBdr + ';color:' + btnTxt + ';';
    copyBtn.addEventListener('click', function() {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(formatted).then(function() {
          copyBtn.innerHTML = '&#10003;';
          setTimeout(function() { copyBtn.innerHTML = '&#128203;'; }, 1500);
        });
      } else {
        var sel = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(numSpan);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    btns.appendChild(copyBtn);

    var callLink = document.createElement('a');
    callLink.href = 'tel:' + telHref;
    callLink.innerHTML = '&#128222;';
    callLink.title = 'Call';
    callLink.style.cssText =
      'padding:0.3rem 0.5rem;border-radius:0.375rem;font-size:0.8rem;cursor:pointer;'
      + 'background:#0053e2;color:#fff;text-decoration:none;display:inline-flex;align-items:center;';
    btns.appendChild(callLink);

    row.appendChild(btns);
    card.appendChild(row);
  });

  ov.appendChild(card);
  document.body.appendChild(ov);

  function onKey(e) {
    if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onKey, true); }
  }
  document.addEventListener('keydown', onKey, true);
}

/* ─────────────────────────────────────────────────────────────────────────────
   PHONE CHIP INPUT HELPERS
───────────────────────────────────────────────────────────────────────── */

// Collect chip data-raw values, join, persist.
function _dbPhoneChipSave(wrap, cardId, attrId, key) {
  var chips = wrap.querySelectorAll('.db-ph-chip');
  var raws  = [];
  chips.forEach(function(c) { raws.push(c.getAttribute('data-raw')); });
  _dbSaveAttrVal(cardId, attrId, key, raws.join(', '));
}

// Build and insert one chip before `beforeEl` in `wrap`.
function _dbPhoneChipInsert(wrap, beforeEl, raw) {
  var formatted = _dbFmtPhone(raw);
  var digits    = raw.replace(/\D/g, '');
  var telHref   = digits.length === 10 ? '+1' + digits
                : digits.length >= 11  ? '+' + digits
                : digits || raw;

  var isDark  = document.documentElement.classList.contains('dark');
  var pillBg  = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)';
  var pillClr = isDark ? '#d4d4d8' : '#374151';
  var pillBdr = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';

  var chip = document.createElement('span');
  chip.className = 'db-ph-chip';
  chip.setAttribute('data-raw', raw);
  chip.style.cssText =
    'display:inline-flex;align-items:center;background:' + pillBg + ';'
    + 'border:1px solid ' + pillBdr + ';color:' + pillClr + ';'
    + 'border-radius:0.375rem;font-size:0.72rem;'
    + 'font-variant-numeric:tabular-nums;white-space:nowrap;';

  // Number button → popup
  var numBtn = document.createElement('button');
  numBtn.type = 'button';
  numBtn.textContent = '\uD83D\uDCDE ' + formatted;
  numBtn.style.cssText =
    'background:none;border:none;cursor:pointer;color:inherit;'
    + 'font-size:0.72rem;font-variant-numeric:tabular-nums;'
    + 'padding:0.15rem 0.4rem;font-family:inherit;line-height:1.5;';
  numBtn.addEventListener('click', function() { _dbPhonePopup(formatted, telHref); });
  chip.appendChild(numBtn);

  // × remove button
  var delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.textContent = '\u00d7';
  delBtn.title = 'Remove';
  delBtn.style.cssText =
    'background:none;border:none;cursor:pointer;color:inherit;'
    + 'font-size:1rem;line-height:1;padding:0 0.35rem 0 0;'
    + 'opacity:0.45;font-family:inherit;';
  delBtn.addEventListener('mouseenter', function() { delBtn.style.opacity = '1'; });
  delBtn.addEventListener('mouseleave', function() { delBtn.style.opacity = '0.45'; });
  delBtn.addEventListener('click', function() {
    chip.remove();
    _dbPhoneChipSave(wrap, parseInt(wrap.dataset.cardId, 10),
                          parseInt(wrap.dataset.attrId,  10),
                          wrap.dataset.key);
  });
  chip.appendChild(delBtn);

  wrap.insertBefore(chip, beforeEl);
}

// Convert whatever is in `inp` to a chip, clear the input.
function _dbPhoneChipCommit(wrap, inp, cardId, attrId, key) {
  var raw = inp.value.replace(/,\s*$/, '').trim(); // strip trailing comma
  if (!raw) return;
  inp.value = '';
  // Update placeholder after first chip is added
  inp.placeholder = '';
  _dbPhoneChipInsert(wrap, inp, raw);
  _dbPhoneChipSave(wrap, cardId, attrId, key);
}

// keydown handler wired via inline onkeydown on the input element.
function _dbPhoneChipKey(e, cardId, attrId, key) {
  var inp  = e.target;
  var wrap = inp.closest('.db-ph-wrap');
  if (e.key === ',' || e.key === 'Enter') {
    e.preventDefault();
    _dbPhoneChipCommit(wrap, inp, cardId, attrId, key);
  } else if (e.key === 'Backspace' && inp.value === '') {
    var chips = wrap.querySelectorAll('.db-ph-chip');
    if (chips.length) {
      chips[chips.length - 1].remove();
      _dbPhoneChipSave(wrap, cardId, attrId, key);
    }
  }
}

// blur handler: commit any trailing text.
function _dbPhoneChipBlur(cardId, attrId, key, inp) {
  var wrap = inp.closest('.db-ph-wrap');
  if (inp.value.trim()) {
    _dbPhoneChipCommit(wrap, inp, cardId, attrId, key);
  } else if (wrap.querySelectorAll('.db-ph-chip').length === 0) {
    // Restore placeholder when no chips and nothing typed
    inp.placeholder = 'Add phone\u2026 type comma to add more';
    _dbPhoneChipSave(wrap, cardId, attrId, key); // save empty
  }
  var isDark = document.documentElement.classList.contains('dark');
  wrap.style.borderColor = isDark ? '#3f3f46' : '#e5e7eb';
}

/* ───────────────────────────────────────────────────────────────────────────────
   PERSON CHIP INPUT HELPERS  (mirrors phone chip helpers above)
   Value storage: comma-separated names.  Display: indigo rounded-full pill.
   Auto-capitalises the first letter of every word on commit.
─────────────────────────────────────────────────────────────────────────────── */

// Capitalise the first letter of every word in a name.
function _dbPersonCap(name) {
  return name.split(' ').map(function(w) {
    return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
  }).join(' ');
}

// Collect every unique person name already entered for a given attr_key
// across all cards in the current database.  Returns sorted array of strings.
function _dbPersonKnownNames(attrKey) {
  var seen = {};
  _dbCards.forEach(function(card) {
    (card.attrs || []).forEach(function(a) {
      if (a.attr_type === 'person' && a.attr_key === attrKey && a.attr_value) {
        a.attr_value.split(',').forEach(function(n) {
          var name = n.trim();
          if (name) seen[name.toLowerCase()] = name; // dedupe case-insensitively, keep original casing
        });
      }
    });
  });
  return Object.values(seen).sort(function(a, b) { return a.localeCompare(b); });
}

// Collect chip data-raw values, join with ", ", persist.
function _dbPersonChipSave(wrap, cardId, attrId, key) {
  var chips = wrap.querySelectorAll('.db-pe-chip');
  var raws  = [];
  chips.forEach(function(c) { raws.push(c.getAttribute('data-raw')); });
  _dbSaveAttrVal(cardId, attrId, key, raws.join(', '));
}

// Build and insert one person chip before `beforeEl` inside `wrap`.
function _dbPersonChipInsert(wrap, beforeEl, raw) {
  var name    = _dbPersonCap(raw.trim());
  var isDark  = document.documentElement.classList.contains('dark');
  var pillBg  = isDark ? 'rgba(99,102,241,0.15)' : '#eef2ff';
  var pillClr = isDark ? '#a5b4fc'               : '#4338ca';
  var pillBdr = isDark ? 'rgba(99,102,241,0.3)'  : '#c7d2fe';

  var chip = document.createElement('span');
  chip.className = 'db-pe-chip';
  chip.setAttribute('data-raw', name);
  chip.style.cssText =
    'display:inline-flex;align-items:center;background:' + pillBg + ';'
    + 'border:1px solid ' + pillBdr + ';color:' + pillClr + ';'
    + 'border-radius:9999px;font-size:0.72rem;font-weight:500;'
    + 'padding:0.1rem 0.45rem 0.1rem 0.5rem;white-space:nowrap;gap:0.15rem;';

  var label = document.createElement('span');
  label.textContent = '\uD83D\uDC64\u00a0' + name;
  label.style.cssText = 'cursor:default;line-height:1.5;';
  chip.appendChild(label);

  var delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.textContent = '\u00d7';
  delBtn.title = 'Remove';
  delBtn.style.cssText =
    'background:none;border:none;cursor:pointer;color:inherit;'
    + 'font-size:1rem;line-height:1;padding:0 0.05rem 0 0.2rem;'
    + 'opacity:0.5;font-family:inherit;';
  delBtn.addEventListener('mouseenter', function() { delBtn.style.opacity = '1'; });
  delBtn.addEventListener('mouseleave', function() { delBtn.style.opacity = '0.5'; });
  delBtn.addEventListener('click', function() {
    chip.remove();
    // Use data-attr-key (plain string) — dataset.key is JSON-encoded with literal
    // quote chars and would create a duplicate attribute if sent to the server.
    _dbPersonChipSave(wrap, parseInt(wrap.dataset.cardId, 10),
                           parseInt(wrap.dataset.attrId,  10),
                           wrap.dataset.attrKey);
  });
  chip.appendChild(delBtn);

  wrap.insertBefore(chip, beforeEl);
}

// Convert whatever is in `inp` to a chip, clear the input.
function _dbPersonChipCommit(wrap, inp, cardId, attrId, key) {
  var raw = inp.value.replace(/,\s*$/, '').trim(); // strip trailing comma
  if (!raw) return;
  inp.value = '';
  inp.placeholder = '';
  _dbPersonChipInsert(wrap, inp, raw);
  _dbPersonChipSave(wrap, cardId, attrId, key);
}

// keydown handler — Enter or comma commits the current name.
function _dbPersonChipKey(e, cardId, attrId, key) {
  var inp  = e.target;
  var wrap = inp.closest('.db-pe-wrap');
  if (e.key === ',' || e.key === 'Enter') {
    e.preventDefault();
    _dbPersonChipCommit(wrap, inp, cardId, attrId, key);
  } else if (e.key === 'Backspace' && inp.value === '') {
    var chips = wrap.querySelectorAll('.db-pe-chip');
    if (chips.length) {
      chips[chips.length - 1].remove();
      _dbPersonChipSave(wrap, cardId, attrId, key);
    }
  }
}

// blur handler: commit any trailing text, then reset border.
function _dbPersonChipBlur(cardId, attrId, key, inp) {
  var wrap = inp.closest('.db-pe-wrap');
  if (inp.value.trim()) {
    _dbPersonChipCommit(wrap, inp, cardId, attrId, key);
  } else if (wrap.querySelectorAll('.db-pe-chip').length === 0) {
    inp.placeholder = 'Type a name\u2026 Enter or comma to add more';
    _dbPersonChipSave(wrap, cardId, attrId, key);
  }
}

// Opens (or closes) the person picker dropdown anchored to `btn`.
// Lists all known person names for this attr column; ✓ marks already-chipped ones.
function _dbPersonPickerOpen(btn) {
  // Toggle: if popover already open from this button, close it.
  var existing = document.getElementById('db-pe-picker');
  if (existing) { existing.remove(); return; }

  var wrap    = btn.closest('.db-pe-wrap');
  var cardId  = parseInt(wrap.dataset.cardId, 10);
  var attrId  = parseInt(wrap.dataset.attrId,  10);
  var attrKey = wrap.dataset.attrKey; // plain attr_key string — safe to send to server

  var names = _dbPersonKnownNames(attrKey);
  if (!names.length) return; // nothing to show

  // Chips currently in the wrap
  var chipped = {};
  wrap.querySelectorAll('.db-pe-chip').forEach(function(c) {
    chipped[(c.getAttribute('data-raw') || '').toLowerCase()] = true;
  });

  var isDark  = document.documentElement.classList.contains('dark');
  var popBg   = isDark ? '#27272a' : '#ffffff';
  var popBdr  = isDark ? '#3f3f46' : '#e5e7eb';
  var popSh   = isDark ? '0 4px 16px rgba(0,0,0,0.5)' : '0 4px 16px rgba(0,0,0,0.12)';
  var rowHov  = isDark ? '#3f3f46' : '#f3f4f6';
  var txtClr  = isDark ? '#f4f4f5' : '#111827';
  var subClr  = isDark ? '#a1a1aa' : '#6b7280';
  var chkClr  = '#4338ca'; // indigo — matches person chip accent

  var pop = document.createElement('div');
  pop.id = 'db-pe-picker';
  pop.style.cssText =
    'position:fixed;z-index:9999;min-width:160px;max-width:240px;'
    + 'background:' + popBg + ';border:1px solid ' + popBdr + ';'
    + 'border-radius:0.5rem;box-shadow:' + popSh + ';'
    + 'padding:0.3rem 0;overflow-y:auto;max-height:220px;';

  names.forEach(function(name) {
    var isChipped = !!chipped[name.toLowerCase()];
    var row = document.createElement('div');
    row.style.cssText =
      'display:flex;align-items:center;gap:0.5rem;'
      + 'padding:0.32rem 0.75rem;cursor:pointer;font-size:0.78rem;'
      + 'color:' + txtClr + ';user-select:none;';
    row.innerHTML =
      '<span style="font-size:0.78rem;color:' + (isChipped ? chkClr : 'transparent') + ';flex-shrink:0;">&#10003;</span>'
      + '<span style="flex:1;">' + _esc(name) + '</span>';

    // mousedown prevents the input from blurring before we handle the pick
    row.addEventListener('mousedown', function(e) { e.preventDefault(); });
    row.addEventListener('click', function() {
      if (isChipped) {
        // Remove the matching chip
        wrap.querySelectorAll('.db-pe-chip').forEach(function(c) {
          if ((c.getAttribute('data-raw') || '').toLowerCase() === name.toLowerCase()) {
            c.remove();
          }
        });
      } else {
        // Insert a new chip before the input
        var inp = wrap.querySelector('.db-pe-inp');
        _dbPersonChipInsert(wrap, inp, name);
      }
      _dbPersonChipSave(wrap, cardId, attrId, attrKey); // attrKey = plain string, not JSON-encoded
      pop.remove();
    });
    row.addEventListener('mouseenter', function() { row.style.background = rowHov; });
    row.addEventListener('mouseleave', function() { row.style.background = 'transparent'; });
    pop.appendChild(row);
  });

  document.body.appendChild(pop);

  // Position: below the button (or above if near the bottom of the viewport)
  var br = btn.getBoundingClientRect();
  var popH = Math.min(220, names.length * 34 + 10);
  var top  = br.bottom + 4;
  if (top + popH > window.innerHeight - 8) top = Math.max(4, br.top - popH - 4);
  pop.style.top  = top + 'px';
  pop.style.left = Math.max(4, br.right - 240) + 'px';

  // Close on outside click
  var closer = function(e) {
    if (!pop.contains(e.target) && e.target !== btn) {
      pop.remove();
      document.removeEventListener('mousedown', closer);
    }
  };
  setTimeout(function() { document.addEventListener('mousedown', closer); }, 0);
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
    'border:none;background:transparent;font-size:0.72rem;color:inherit;'
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
      + ' style="border:none;background:transparent;font-size:0.72rem;color:inherit;'
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
      + 'padding:0.1rem 0.2rem;color:#9ca3af;font-size:0.72rem;line-height:1;'
      + 'border-radius:0.25rem;">&#128197;</button>'
      + '</span>'
    );
  }
  if (t === 'number') {
    var numOpts = _dbParseNumOpts(a.attr_options || '');
    var raw     = v;
    var shown   = raw !== '' ? _dbFormatNumber(raw, numOpts) : '';
    var display = numOpts.display || 'number';

    // Shared edit input — used as the clickable number label for bar/ring
    var _numInpStyle = 'border:none;background:transparent;outline:none;cursor:text;';
    var _numBlur = ' onfocus="_dbNumFocus(this)"'
      + ' onblur="_dbNumBlurSave(this,' + cardId + ',' + a.id + ',' + kJ + ')"';
    var _numData = ' data-rawval="' + _esc(raw) + '"'
      + ' data-numfmt="' + _esc(numOpts.format) + '"'
      + ' data-numdec="' + numOpts.decimals + '"';

    if (display === 'number') {
      return '<input type="text" value="' + _esc(shown) + '"' + _numData
        + ' placeholder="Enter a number…"'
        + ' style="' + _numInpStyle + 'font-size:0.72rem;color:inherit;width:100%;"'
        + _numBlur + '>'; 
    }

    // Bar / Ring — build visual with editable number label embedded
    var isDkN   = document.documentElement.classList.contains('dark');
    var cDef    = _dbOptColorDef(numOpts.barColor || 'blue');
    var fillClr = cDef.dot;
    var trkClr  = isDkN ? '#3f3f46' : '#e5e7eb';
    var lblClr  = isDkN ? '#a1a1aa' : '#6b7280';
    var frac    = _dbNumFraction(raw, numOpts);
    var pctW    = (frac * 100).toFixed(1) + '%';
    // The editable number label — always visible in the detail panel
    var editLbl = '<input type="text" id="_dbn-inp-' + a.id + '"'
      + ' value="' + _esc(shown || '') + '"' + _numData
      + ' placeholder="0" title="Click to edit"'
      + ' style="' + _numInpStyle + 'width:4.5rem;font-size:0.72rem;'
      + 'color:' + lblClr + ';text-align:right;flex-shrink:0;"'
      + _numBlur + '>';

    if (display === 'bar') {
      return '<div style="display:flex;align-items:center;gap:0.4rem;width:100%;">'
        + '<div style="flex:1;height:7px;background:' + trkClr + ';border-radius:9999px;overflow:hidden;">'
        + '<div id="_dbn-fill-' + a.id + '" style="width:' + pctW + ';height:100%;'
        + 'background:' + fillClr + ';border-radius:9999px;transition:width 0.25s;"></div>'
        + '</div>'
        + editLbl + '</div>';
    }

    if (display === 'ring') {
      var r = 15, sw = 3, sz = 38, cx = 19;
      var circ = +(2 * Math.PI * r).toFixed(2);
      var off  = +(circ * (1 - frac)).toFixed(2);
      // Ring uses left-aligned label so the number sits flush next to the ring,
      // not floating at the far-right of a wide input box.
      var ringLbl = '<input type="text" id="_dbn-inp-' + a.id + '"'
        + ' value="' + _esc(shown || '') + '"' + _numData
        + ' placeholder="0" title="Click to edit"'
        + ' style="' + _numInpStyle + 'width:3rem;font-size:0.72rem;'
        + 'color:' + lblClr + ';text-align:left;flex-shrink:0;"'
        + _numBlur + '>';
      return '<div style="display:flex;align-items:center;gap:0.35rem;">'
        + '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 ' + sz + ' ' + sz + '" style="flex-shrink:0;">'
        + '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '"'
        + ' fill="none" stroke="' + trkClr + '" stroke-width="' + sw + '"/>'
        + '<circle id="_dbn-ring-' + a.id + '" cx="' + cx + '" cy="' + cx + '" r="' + r + '"'
        + ' fill="none" stroke="' + fillClr + '" stroke-width="' + sw + '"'
        + ' stroke-dasharray="' + circ + '" stroke-dashoffset="' + off + '"'
        + ' stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cx + ')"/>'
        + '</svg>'
        + ringLbl + '</div>';
    }

    // fallback (shouldn't reach here)
    return '<input type="text" value="' + _esc(shown) + '"' + _numData
      + ' style="' + _numInpStyle + 'font-size:0.72rem;color:inherit;width:100%;"'
      + _numBlur + '>';
  }
  if (t === 'url') {
    var urlDispFmt = a.attr_options || 'text';  // 'text' | 'short' | 'button'
    var safeUrl    = _esc(v);
    var urlLink    = '';
    if (v) {
      if (urlDispFmt === 'button') {
        // Styled link button (blue, rounded)
        urlLink = '<a href="' + safeUrl + '" target="_blank" rel="noopener"'
          + ' style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.25rem 0.65rem;'
          + 'border-radius:0.375rem;background:#eff6ff;color:#0053e2;font-size:0.75rem;'
          + 'font-weight:600;text-decoration:none;border:1px solid #bfdbfe;white-space:nowrap;">';
        urlLink += '\uD83D\uDD17 Open</a> ';
      } else if (urlDispFmt === 'short') {
        // Domain-only label
        var shortLabel = v.replace(/^https?:\/\//, '').split('/')[0];
        urlLink = '<a href="' + safeUrl + '" target="_blank" rel="noopener"'
          + ' style="color:#0053e2;text-decoration:underline;font-size:0.72rem;cursor:pointer;">'
          + _esc(shortLabel) + '</a> ';
      } else {
        // Default: full URL as link text
        urlLink = '<a href="' + safeUrl + '" target="_blank" rel="noopener"'
          + ' style="color:#0053e2;text-decoration:underline;font-size:0.72rem;'
          + 'word-break:break-all;cursor:pointer;">' + safeUrl + '</a> ';
      }
    }
    return urlLink
      + '<span contenteditable="true"'
      + ' style="font-size:0.75rem;color:#6b7280;cursor:text;outline:none;"'
      + ' onblur="' + cb + '">' + (v ? '(edit)' : 'Add URL…') + '</span>';
  }
  if (t === 'email') {
    var safeEmail = _esc(v);
    var ml = v ? '<a href="mailto:' + safeEmail + '"'
      + ' style="color:#0053e2;text-decoration:underline;font-size:0.72rem;">'
      + safeEmail + '</a> ' : '';
    return ml
      + '<span contenteditable="true" style="font-size:0.75rem;color:#6b7280;cursor:text;outline:none;"'
      + ' onblur="' + cb + '">' + (v ? '(edit)' : 'Add email…') + '</span>';
  }
  // person — multi-name chip input (Enter or comma to commit; auto title-case)
  if (t === 'person') {
    var isDkPe  = document.documentElement.classList.contains('dark');
    var peClr   = isDkPe ? '#f4f4f5' : '#111827';
    var pillBgPe  = isDkPe ? 'rgba(99,102,241,0.15)' : '#eef2ff';
    var pillClrPe = isDkPe ? '#a5b4fc' : '#4338ca';
    var pillBdrPe = isDkPe ? 'rgba(99,102,241,0.3)'  : '#c7d2fe';

    var peNames = v
      ? v.split(',').map(function(n) { return n.trim(); }).filter(Boolean)
      : [];

    var peChipsHtml = peNames.map(function(raw) {
      var name  = _dbPersonCap(raw);
      var nameJ = _esc(JSON.stringify(name));
      return '<span class="db-pe-chip" data-raw="' + _esc(name) + '"'
        + ' style="display:inline-flex;align-items:center;'
        + 'background:' + pillBgPe + ';border:1px solid ' + pillBdrPe + ';'
        + 'color:' + pillClrPe + ';border-radius:9999px;font-size:0.72rem;'
        + 'font-weight:500;padding:0.1rem 0.45rem 0.1rem 0.5rem;'
        + 'white-space:nowrap;gap:0.15rem;">'
        + '<span style="cursor:default;line-height:1.5;">\uD83D\uDC64\u00a0' + _esc(name) + '</span>'
        + '<button type="button" title="Remove"'
        + ' onclick="var c=this.parentNode,w=c.closest(\'.db-pe-wrap\');'
        + 'c.remove();_dbPersonChipSave(w,' + cardId + ',' + a.id + ',' + kJ + ')"'
        + ' style="background:none;border:none;cursor:pointer;color:inherit;'
        + 'font-size:1rem;line-height:1;padding:0 0.05rem 0 0.2rem;opacity:0.5;'
        + 'font-family:inherit;"'
        + ' onmouseenter="this.style.opacity=\'1\'"'
        + ' onmouseleave="this.style.opacity=\'0.5\'">'
        + '&times;</button>'
        + '</span>';
    }).join('');

    var cbKeyPe  = '_dbPersonChipKey(event,' + cardId + ',' + a.id + ',' + kJ + ')';
    var cbBlurPe = '_dbPersonChipBlur(' + cardId + ',' + a.id + ',' + kJ + ',this)';
    var peholderPe = peNames.length ? '' : 'Type a name\u2026 Enter or comma to add more';

    // Picker button: scan the database for known names on this same column.
    var peKnown  = _dbPersonKnownNames(a.attr_key); // plain key — no encoding needed
    var pePickerBtn = '';
    if (peKnown.length) {
      var peBtnClr = isDkPe ? '#71717a' : '#9ca3af';
      pePickerBtn =
        '<button type="button" title="Pick from existing names"'
        + ' onclick="event.stopPropagation();_dbPersonPickerOpen(this)"'
        + ' style="margin-left:auto;flex-shrink:0;background:none;border:none;'
        + 'cursor:pointer;padding:0.1rem 0.2rem;line-height:1;'
        + 'color:' + peBtnClr + ';font-size:0.8rem;'
        + 'opacity:0.7;transition:opacity 0.1s;"'
        + ' onmouseenter="this.style.opacity=\'1\'"'
        + ' onmouseleave="this.style.opacity=\'0.7\'">'
        + '&#9660;</button>'; // ▼ chevron
    }

    return '<div class="db-pe-wrap"'
      + ' data-card-id="' + cardId + '" data-attr-id="' + a.id + '"'
      + ' data-key=' + kJ
      + ' data-attr-key="' + _esc(a.attr_key) + '"'
      + ' style="display:flex;flex-wrap:wrap;align-items:center;gap:0.25rem;'
      + 'padding:0.15rem 0;background:transparent;min-height:2rem;cursor:text;"'
      + ' onclick="var i=this.querySelector(\'.db-pe-inp\');if(i&&document.activeElement!==i)i.focus();">'
      + peChipsHtml
      + '<input class="db-pe-inp" type="text"'
      + ' placeholder="' + _esc(peholderPe) + '"'
      + ' style="flex:1;min-width:4rem;border:none;background:transparent;'
      + 'outline:none;font-size:0.72rem;color:' + peClr + ';'
      + 'font-family:inherit;padding:0.1rem 0;"'
      + ' onkeydown="' + cbKeyPe + '"'
      + ' onblur="' + cbBlurPe + '">'
      + pePickerBtn
      + '</div>';
  }

  if (t === 'phone') {
    var isDkPh  = document.documentElement.classList.contains('dark');
    var inpBg   = isDkPh ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
    var inpBdr  = isDkPh ? '#3f3f46' : '#e5e7eb';
    var pillBg  = isDkPh ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)';
    var pillClr = isDkPh ? '#d4d4d8' : '#374151';
    var pillBdr = isDkPh ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    var phClr   = isDkPh ? '#f4f4f5' : '#111827';

    var phones  = v
      ? v.split(',').map(function(p) { return p.trim(); }).filter(Boolean)
      : [];

    var chipsHtml = phones.map(function(raw) {
      var formatted = _dbFmtPhone(raw);
      var digits    = raw.replace(/\D/g, '');
      var telHref   = digits.length === 10 ? '+1' + digits
                    : digits.length >= 11  ? '+' + digits
                    : digits || raw;
      var fmtJ  = _esc(JSON.stringify(formatted));
      var hrefJ = _esc(JSON.stringify(telHref));
      return '<span class="db-ph-chip" data-raw="' + _esc(raw) + '"'
        + ' style="display:inline-flex;align-items:center;'
        + 'background:' + pillBg + ';border:1px solid ' + pillBdr + ';'
        + 'color:' + pillClr + ';border-radius:0.375rem;font-size:0.72rem;'
        + 'font-variant-numeric:tabular-nums;white-space:nowrap;">'
        // clickable number → popup
        + '<button type="button"'
        + ' onclick="_dbPhonePopup(' + fmtJ + ',' + hrefJ + ')"'
        + ' style="background:none;border:none;cursor:pointer;color:inherit;'
        + 'font-size:0.72rem;font-variant-numeric:tabular-nums;'
        + 'padding:0.15rem 0.4rem;font-family:inherit;line-height:1.5;">'
        + '&#128222; ' + _esc(formatted)
        + '</button>'
        // × remove chip
        + '<button type="button" title="Remove"'
        + ' onclick="var c=this.parentNode,w=c.closest(\'.db-ph-wrap\');'
        + 'c.remove();_dbPhoneChipSave(w,' + cardId + ',' + a.id + ',' + kJ + ')"'
        + ' style="background:none;border:none;cursor:pointer;color:inherit;'
        + 'font-size:1rem;line-height:1;padding:0 0.35rem 0 0;opacity:0.45;'
        + 'font-family:inherit;"'
        + ' onmouseenter="this.style.opacity=\'1\'"'
        + ' onmouseleave="this.style.opacity=\'0.45\'">'
        + '&times;</button>'
        + '</span>';
    }).join('');

    var cbKey  = '_dbPhoneChipKey(event,' + cardId + ',' + a.id + ',' + kJ + ')';
    var cbBlur = '_dbPhoneChipBlur(' + cardId + ',' + a.id + ',' + kJ + ',this)';
    var cbFocus = 'this.closest(\'.db-ph-wrap\').style.borderColor=\'#0053e2\'';
    var pholder = phones.length ? '' : 'Add phone… type comma to add more';

    return '<div class="db-ph-wrap"'
      + ' data-card-id="' + cardId + '" data-attr-id="' + a.id + '" data-key=' + kJ + ''
      + ' style="display:flex;flex-wrap:wrap;align-items:center;gap:0.25rem;'
      + 'padding:0.15rem 0;background:transparent;'
      + 'min-height:2rem;cursor:text;"'
      + ' onclick="var i=this.querySelector(\'.db-ph-inp\');if(i&&document.activeElement!==i)i.focus();">'
      + chipsHtml
      + '<input class="db-ph-inp" type="text"'
      + ' placeholder="' + _esc(pholder) + '"'
      + ' style="flex:1;min-width:5rem;border:none;background:transparent;'
      + 'outline:none;font-size:0.72rem;color:' + phClr + ';'
      + 'font-variant-numeric:tabular-nums;font-family:inherit;padding:0.1rem 0;"'
      + ' onfocus="' + cbFocus + '"'
      + ' onkeydown="' + cbKey + '"'
      + ' onblur="' + cbBlur + '">'
      + '</div>';
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
    var mapProv   = a.attr_options || 'google';
    var safePlace = encodeURIComponent(v);
    var mapUrl;
    if (mapProv === 'apple') {
      mapUrl = 'https://maps.apple.com/?q=' + safePlace;
    } else if (mapProv === 'osm') {
      mapUrl = 'https://www.openstreetmap.org/search?query=' + safePlace;
    } else {
      mapUrl = 'https://maps.google.com/?q=' + safePlace;
    }
    var mapsLink = v
      ? '<a href="' + mapUrl + '" target="_blank" rel="noopener"'
        + ' style="flex-shrink:0;font-size:0.72rem;color:inherit;'
        + 'text-decoration:none;opacity:0.7;white-space:nowrap;"'
        + ' title="Open in ' + _esc(mapProv.charAt(0).toUpperCase() + mapProv.slice(1)) + ' Maps">'
        + '\uD83D\uDDFA\uFE0F</a>'
      : '';
    var cbInp    = '_dbSaveAttrInput(' + cardId + ',' + a.id + ',' + kJ + ',this)';
    var cbSearch = '_dbPlaceSearch(event,' + cardId + ',' + a.id + ',' + kJ + ')';
    var cbBlur   = 'this.style.borderBottomColor=\'transparent\';'
                 + '_dbPlaceDropClose();' + cbInp;
    var cbKey    = 'if(event.key===\'Escape\'){_dbPlaceDropClose();}';
    return '<div style="display:flex;align-items:center;gap:0.35rem;width:100%;">'
      + '<input type="text"'
      + ' value="' + _esc(v) + '"'
      + ' placeholder="Add place or address\u2026"'
      + ' autocomplete="off" spellcheck="false"'
      + ' style="flex:1;min-width:0;font-size:0.72rem;color:inherit;'
      + 'background:transparent;border:none;border-bottom:1px solid transparent;'
      + 'outline:none;padding:0.1rem 0;transition:border-color 0.15s;"'
      + ' onfocus="this.style.borderBottomColor=\'#0053e2\'"'
      + ' oninput="' + cbSearch + '"'
      + ' onkeydown="' + cbKey + '"'
      + ' onblur="' + cbBlur + '">'
      + mapsLink
      + '</div>';
  }

  // select — pill chip display + invisible native <select> overlay for picking
  if (t === 'select') {
    var sopts = _dbParseOptions(a.attr_options || '');
    if (sopts.length > 0) {
      // Find the option object for the current value so we can colour the pill
      var selOpt = sopts.find(function(o) { return o.label === v; });

      // Build the visible pill (or muted placeholder when nothing is selected)
      var pillDisplay;
      if (selOpt) {
        var cDefS  = _dbOptColorDef(selOpt.color || 'gray');
        var sBg    = isDark ? cDefS.darkBg   : cDefS.bg;
        var sTxt   = isDark ? cDefS.darkText : cDefS.text;
        pillDisplay = '<span style="display:inline-flex;align-items:center;'
          + 'padding:0.18rem 0.7rem;border-radius:9999px;'
          + 'font-size:0.72rem;font-weight:600;pointer-events:none;'
          + 'background:' + sBg + ';color:' + sTxt + ';white-space:nowrap;">'
          + _esc(selOpt.label) + '</span>';
      } else {
        pillDisplay = '<span style="font-size:0.72rem;pointer-events:none;'
          + 'color:' + (isDark ? '#52525b' : '#d1d5db') + ';font-style:italic;">'
          + 'Pick…</span>';
      }

      // Build option list for the invisible native select
      var optHtml = '<option value="">(none)</option>';
      sopts.forEach(function(o) {
        var sel = (o.label === v) ? ' selected' : '';
        optHtml += '<option value="' + _esc(o.label) + '"' + sel + '>' + _esc(o.label) + '</option>';
      });

      // Container: pill on top; invisible <select> laid over it captures the click
      return '<div style="position:relative;display:inline-flex;'
        + 'align-items:center;cursor:pointer;">'
        + pillDisplay
        + '<select onchange="_dbSaveAttrSelect(' + cardId + ',' + a.id + ',' + kJ + ',this)"'
        + ' style="position:absolute;inset:0;width:100%;height:100%;'
        + 'opacity:0;cursor:pointer;border:none;padding:0;'
        + 'color-scheme:' + inputCs + ';">'
        + optHtml + '</select>'
        + '</div>';
    }
    // No options defined — fall through to plain contenteditable
  }

  // multi_select — toggleable chip grid constrained to defined options
  if (t === 'multi_select') {
    var mopts2 = _dbParseOptions(a.attr_options || '');
    if (mopts2.length > 0) {
      var mSelected = (v || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      var chipBdrOff = isDark ? '#52525b' : '#d1d5db';
      var chipTxtOff = isDark ? '#a1a1aa' : '#9ca3af';
      var chipHtml   = '<div style="display:flex;flex-wrap:wrap;gap:0.25rem;padding:0.125rem 0;">';
      mopts2.forEach(function(o) {
        var isSel = mSelected.indexOf(o.label) !== -1;
        var oJ    = _esc(JSON.stringify(o.label));
        var cDef  = _dbOptColorDef(o.color || 'gray');
        var selBg  = isDark ? cDef.darkBg  : cDef.bg;
        var selTxt = isDark ? cDef.darkText : cDef.text;
        chipHtml += '<button type="button"'
          + ' onclick="_dbToggleMultiSelect(' + cardId + ',' + a.id + ',' + kJ + ',' + oJ + ')"'
          + ' style="font-size:0.7rem;padding:0.15rem 0.6rem;border-radius:9999px;cursor:pointer;'
          + 'border:1px solid ' + (isSel ? cDef.dot + '55' : chipBdrOff) + ';'
          + 'background:' + (isSel ? selBg : 'transparent') + ';'
          + 'color:' + (isSel ? selTxt : chipTxtOff) + ';'
          + 'font-weight:' + (isSel ? '600' : '400') + ';transition:all 0.1s;">'
          + _esc(o.label) + '</button>';
      });
      chipHtml += '</div>';
      return chipHtml;
    }
    // No options defined — fall through to plain contenteditable
  }


  // files — dedicated upload/link widget
  if (t === 'files') {
    return _dbFilesHtml(cardId, a);
  }

  // date_range — two text fields (formatted) + hidden pickers + 📅 icons
  if (t === 'date_range') {
    var isDkDr  = document.documentElement.classList.contains('dark');
    var drFmtId = a.attr_options || 'short';
    var drParts = v.split('|');
    var drStart = (drParts[0] || '').trim().slice(0, 10);
    var drEnd   = (drParts[1] || '').trim().slice(0, 10);
    var drStartDisp = drStart ? _dbFormatDate(drStart, drFmtId) : '';
    var drEndDisp   = drEnd   ? _dbFormatDate(drEnd,   drFmtId) : '';
    var drTxtSty = 'border:none;background:transparent;font-size:0.8rem;'
      + 'font-family:inherit;color:' + (isDkDr ? '#f4f4f5' : '#111827') + ';'
      + 'outline:none;min-width:0;width:90px;cursor:text;padding:0.1rem 0;';
    var drIcoSty = 'background:none;border:none;cursor:pointer;font-size:0.8rem;'
      + 'padding:0 0.1rem;line-height:1;color:' + (isDkDr ? '#a1a1aa' : '#9ca3af') + ';'
      + 'transition:color 0.1s;';
    // Hidden date pickers
    var drPickSty = 'position:absolute;opacity:0;pointer-events:none;width:0;height:0;';
    var drSaveCb  = '_dbSaveAttrVal(' + cardId + ',' + a.id + ',' + kJ + ',';
    // Start side
    var drSBlurCb = '_dbDrTextBlur(' + cardId + ',' + a.id + ',' + kJ + ',this,\'' + drFmtId + '\',\'start\')';
    var drSPkCb   = '_dbDrPickerChange(' + cardId + ',' + a.id + ',' + kJ + ',this,\'' + drFmtId + '\',\'start\')';
    // End side
    var drEBlurCb = '_dbDrTextBlur(' + cardId + ',' + a.id + ',' + kJ + ',this,\'' + drFmtId + '\',\'end\')';
    var drEPkCb   = '_dbDrPickerChange(' + cardId + ',' + a.id + ',' + kJ + ',this,\'' + drFmtId + '\',\'end\')';
    return '<div style="display:flex;align-items:center;gap:0.2rem;flex-wrap:wrap;position:relative;">'
      // start text
      + '<input type="text" id="dtr-txt-start-' + a.id + '" value="' + _esc(drStartDisp) + '"'
      + ' placeholder="Start date" style="' + drTxtSty + '"'
      + ' onblur="' + drSBlurCb + '"'
      + ' onfocus="_dbNativeWidgetFocus(this)">'  
      // start calendar icon
      + '<button type="button" title="Pick start date" style="' + drIcoSty + '"'
      + ' onclick="document.getElementById(\'dtr-start-' + a.id + '\').showPicker&&document.getElementById(\'dtr-start-' + a.id + '\').showPicker()">&#128197;</button>'
      // start hidden picker
      + '<input type="date" id="dtr-start-' + a.id + '" value="' + _esc(drStart) + '"'
    + ' style="' + drPickSty + '" onchange="' + drSPkCb + '">'
      // arrow
      + '<span style="font-size:0.7rem;color:#9ca3af;flex-shrink:0;padding:0 0.1rem;">&#8594;</span>'
      // end text
      + '<input type="text" id="dtr-txt-end-' + a.id + '" value="' + _esc(drEndDisp) + '"'
      + ' placeholder="End date" style="' + drTxtSty + '"'
      + ' onblur="' + drEBlurCb + '"'
      + ' onfocus="_dbNativeWidgetFocus(this)">'
      // end calendar icon
      + '<button type="button" title="Pick end date" style="' + drIcoSty + '"'
      + ' onclick="document.getElementById(\'dtr-end-' + a.id + '\').showPicker&&document.getElementById(\'dtr-end-' + a.id + '\').showPicker()">&#128197;</button>'
      // end hidden picker
      + '<input type="date" id="dtr-end-' + a.id + '" value="' + _esc(drEnd) + '"'
      + ' style="' + drPickSty + '" onchange="' + drEPkCb + '">'
      + '</div>';
  }

  // progress — bar / number / both, respecting configured max
  if (t === 'progress') {
    var isDkPg  = document.documentElement.classList.contains('dark');
    var pgOpts  = _dbParsePgOpts(a.attr_options);
    var pgMax   = pgOpts.max     || 100;
    var pgMode  = pgOpts.display || 'bar';
    var pgVal   = Math.min(pgMax, Math.max(0, parseInt(v, 10) || 0));
    var pgFill  = Math.min(100, Math.round((pgVal / pgMax) * 100));
    var pgTrack = 'linear-gradient(to right,#0053e2 ' + pgFill + '%,'
      + (isDkPg ? '#3f3f46' : '#e5e7eb') + ' ' + pgFill + '%)';
    var pgLbl   = pgMax === 100 ? pgVal + '%' : pgVal + '\u202F/\u202F' + pgMax;
    var pgLblSty = 'font-size:0.75rem;color:' + (isDkPg ? '#a1a1aa' : '#6b7280') + ';'
      + 'min-width:2.8rem;text-align:right;font-variant-numeric:tabular-nums;flex-shrink:0;';
    var pgMaxJ  = pgMax; // number, safe to inline
    var pgCb    = '_dbProgressChange(' + cardId + ',' + a.id + ',' + kJ + ',this,' + pgMaxJ + ')';
    // Number input for 'number' and 'both' modes
    var pgNumCb = '_dbSaveAttrInput(' + cardId + ',' + a.id + ',' + kJ + ',this)';
    var pgNumSty = 'border:none;background:transparent;font-size:0.85rem;font-family:inherit;'
      + 'color:' + (isDkPg ? '#f4f4f5' : '#111827') + ';outline:none;'
      + 'width:5rem;text-align:right;cursor:text;padding:0.1rem 0;';
    var pgHtml = '<div style="display:flex;align-items:center;gap:0.5rem;width:100%;padding:0.1rem 0;">';
    if (pgMode === 'bar' || pgMode === 'both') {
      pgHtml += '<input type="range" min="0" max="' + pgMax + '" value="' + pgVal + '"'
        + ' style="flex:1;min-width:60px;height:6px;border-radius:3px;'
        + '-webkit-appearance:none;appearance:none;outline:none;cursor:pointer;'
        + 'background:' + pgTrack + ';"'
        + ' oninput="' + pgCb + '"'
        + ' title="' + pgLbl + '">';
    }
    if (pgMode === 'both') {
      pgHtml += '<span class="db-pg-label" style="' + pgLblSty + '">' + pgLbl + '</span>';
    } else if (pgMode === 'bar') {
      pgHtml += '<span class="db-pg-label" style="' + pgLblSty + '">' + pgLbl + '</span>';
    } else {
      // number-only: editable number input
      pgHtml += '<input type="number" id="_db-attr-val" min="0" max="' + pgMax + '" value="' + pgVal + '"'
        + ' style="' + pgNumSty + '"'
        + ' onblur="' + pgNumCb + '"'
        + ' onfocus="_dbNativeWidgetFocus(this)">';
      pgHtml += '<span style="' + pgLblSty + 'text-align:left;color:' + (isDkPg ? '#52525b' : '#9ca3af') + ';">/ ' + pgMax + '</span>';
    }
    pgHtml += '</div>';
    return pgHtml;
  }

  // rating — 1–N icons; scale and icon style from attr_options
  if (t === 'rating') {
    var isDkRt  = document.documentElement.classList.contains('dark');
    var rtOpts  = _dbParseRtOpts(a.attr_options);
    var rtScale = rtOpts.scale || 5;
    var rtIcId  = rtOpts.icon  || 'star';
    var rtIcDef = _DB_RT_ICON_MAP[rtIcId] || _DB_RT_ICON_MAP.star;
    var rtVal   = Math.min(rtScale, Math.max(0, parseInt(v, 10) || 0));
    var rtEmpty = isDkRt ? '#52525b' : '#d1d5db';
    var rtHtml  = '<div class="db-rating-wrap" data-rating="' + rtVal + '"'
      + ' data-scale="' + rtScale + '" data-icon="' + rtIcId + '"'
      + ' style="display:flex;align-items:center;gap:0.1rem;flex-wrap:wrap;">';
    for (var rs = 1; rs <= rtScale; rs++) {
      var rtOn    = rs <= rtVal;
      var rtChar  = rtOn ? rtIcDef.on  : rtIcDef.off;
      var rtColor = rtOn ? rtIcDef.clr : rtEmpty;
      var rtCb    = '_dbRatingSave(' + cardId + ',' + a.id + ',' + kJ + ',' + rs + ',this)';
      rtHtml += '<button type="button" class="db-rating-btn" data-val="' + rs + '"'
        + ' onclick="' + rtCb + '"'
        + ' title="' + rs + ' / ' + rtScale + '"'
        + ' style="background:none;border:none;cursor:pointer;padding:0 0.05rem;'
        + 'font-size:' + (rtScale > 5 ? '0.8rem' : '1rem') + ';color:' + rtColor + ';line-height:1;'
        + 'transition:transform 0.1s,color 0.1s;"'
        + ' onmouseenter="this.style.transform=\'scale(1.3)\'"'
        + ' onmouseleave="this.style.transform=\'\'">'
        + rtChar + '</button>';
    }
    rtHtml += '</div>';
    return rtHtml;
  }

  // text / person / select (no opts) / multi_select (no opts) — contenteditable
  return '<div contenteditable="true" class="flex-1 text-sm text-gray-800 dark:text-zinc-100 outline-none"'
    + ' onblur="' + cb + '">' + _esc(v) + '</div>';
}

/* ── Video embed helper ──────────────────────────────────────────────────────────────────
   Scans card.attrs for any attr named 'Video URL' (case-insensitive) whose
   value looks like a Vimeo / YouTube / Wistia embed URL, then returns a
   responsive 16:9 iframe block to inject above the note area.
   Vimeo iframes get a unique player_id + ?api=1 so _dbVimeoGuardSetup() can
   detect domain-restricted videos via the player postMessage 'ready' event.
   Returns empty string when no embeddable video is found.
────────────────────────────────────────────────────────────────────────── */
function _dbVideoEmbedHtml(card) {
  var attrs = card.attrs || [];
  var embedUrl = '';

  for (var i = 0; i < attrs.length; i++) {
    var a = attrs[i];
    var key = (a.attr_key || '').toLowerCase();
    var val = (a.attr_value || '').trim();
    if (!val) continue;
    // Match by field name OR by URL pattern — catches custom-named fields too
    var isVideoField = key === 'video url' || key === 'video' || key === 'lesson video';
    var isEmbedUrl = /player\.vimeo\.com\/video\/|youtube(?:-nocookie)?\.com\/embed\/|fast\.wistia\.com\/embed\/medias\//.test(val);
    if (isVideoField || isEmbedUrl) {
      if (isEmbedUrl) { embedUrl = val; break; }
    }
  }

  if (!embedUrl) return '';

  // Ensure protocol-relative URLs have https: so the iframe src is absolute
  var src = embedUrl.replace(/^\/\//, 'https://');
  var isVimeo = /player\.vimeo\.com\/video\//.test(src);

  // For Vimeo: attach a unique player_id + ?api=1 so the player fires a
  // postMessage 'ready' event — used by _dbVimeoGuardSetup to detect
  // domain-restricted videos (they never fire ready).
  var playerId = '';
  if (isVimeo) {
    playerId = 'bwv' + Date.now();
    src += (src.indexOf('?') >= 0 ? '&' : '?') + 'api=1&player_id=' + playerId;
  }

  return '<div data-bw-vid-wrapper="' + _esc(playerId) + '"'
    + ' style="margin:0 -1.5rem 1.25rem -1.5rem;"'
    + ' class="bg-black" aria-label="Lesson video">'
    // 16:9 aspect-ratio wrapper
    + '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;">'
    + '<iframe src="' + _esc(src) + '"'
    + ' frameborder="0"'
    + ' allow="autoplay; fullscreen; picture-in-picture"'
    + ' allowfullscreen'
    + ' style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"'
    + ' loading="lazy"'
    + ' title="Lesson video">'
    + '</iframe>'
    + '</div>'
    + '</div>';
}

/* ── Vimeo domain-restriction guard ─────────────────────────────────────────
   Call this after injecting _dbVideoEmbedHtml html into the DOM.
   Finds any [data-bw-vid-wrapper] with a non-empty player_id (= Vimeo).
   The Vimeo player fires a postMessage {event:'ready', player_id:'...'} when
   it successfully loads.  Domain-restricted videos never fire it.
   After 5 s with no ready signal we replace the iframe with a friendly
   'Video protected' message.
─────────────────────────────────────────────────────────────────────────── */
function _dbVimeoGuardSetup(dp) {
  var wrap = dp && dp.querySelector('[data-bw-vid-wrapper]');
  if (!wrap) return;
  var pid = wrap.getAttribute('data-bw-vid-wrapper');
  if (!pid) return;  // non-Vimeo (YouTube/Wistia) — no guard needed

  var iframe = wrap.querySelector('iframe');
  var _ready = false;

  function _onMsg(evt) {
    var d;
    try { d = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data; }
    catch (e) { return; }
    if (!d || d.event !== 'ready' || d.player_id !== pid) return;
    _ready = true;
    window.removeEventListener('message', _onMsg);
  }
  window.addEventListener('message', _onMsg);

  // 5 s timeout — domain-restricted videos silently show an error page and
  // never fire ready.  Replace the iframe with a friendly fallback.
  setTimeout(function() {
    window.removeEventListener('message', _onMsg);
    if (_ready) return;
    var src = iframe ? iframe.src : '';
    var vidId = (src.match(/\/video\/(\d+)/) || [])[1] || '';
    var vimeoLink = vidId ? 'https://vimeo.com/' + vidId : '';
    wrap.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;'
      + 'justify-content:center;min-height:180px;padding:2rem 1.5rem;text-align:center;'
      + 'background:#0f0f1a;">'
      + '<div style="font-size:2.25rem;margin-bottom:.6rem;">🔒</div>'
      + '<p style="font-size:.875rem;font-weight:600;color:#e2e8f0;margin:0 0 .35rem;">'
      + 'Video protected</p>'
      + '<p style="font-size:.75rem;color:#94a3b8;max-width:22rem;line-height:1.55;margin:0;">'
      + 'This video can only be played on the original course platform.</p>'
      + (vimeoLink
        ? '<a href="' + vimeoLink + '" target="_blank" rel="noopener noreferrer"'
          + ' style="margin-top:.85rem;font-size:.75rem;color:#a78bfa;text-decoration:underline;">'
          + 'Try opening on Vimeo \u2197</a>'
        : '')
      + '</div>';
  }, 5000);
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
        + ' style="width:100%;height:20rem;object-fit:cover;display:block;"></video>'
      : '<img src="' + _esc(_dbThumbUrl(card.cover_url, 1200)) + '" alt="Cover"'
        + ' style="width:100%;height:20rem;object-fit:cover;display:block;"/>';
    coverHtml = '<div style="margin:-1.5rem -1.5rem 1rem -1.5rem;"'
      + ' class="relative overflow-hidden bg-gray-100 dark:bg-zinc-800">'
      + coverMedia
      + '<button type="button" onclick="_dbShowCoverModal(' + card.id + ')"'
      + ' style="position:absolute;top:0.75rem;right:0.75rem;background:rgba(0,0,0,0.45);"'
      + ' class="px-2 py-1 rounded text-xs text-white hover:opacity-90 transition">📷 Change cover</button></div>';
  } else {
    coverHtml = '<div style="margin:-1.5rem -1.5rem 1rem -1.5rem;"'
      + ' class="flex items-center justify-end px-4'
      + ' bg-gradient-to-r from-purple-500 to-purple-700"'
      + ' style="min-height:10rem;">'
      + '<button type="button" onclick="_dbShowCoverModal(' + card.id + ')"'
      + ' class="px-2 py-1 rounded text-xs text-white hover:opacity-90 transition"'
      + ' style="background:rgba(255,255,255,0.2);">📷 Add cover</button></div>';
  }

  var created = card.created_at ? card.created_at.replace('T', ' ').slice(0, 16) : 'Unknown';
  var updated = card.updated_at ? card.updated_at.replace('T', ' ').slice(0, 16) : 'Unknown';

  _dbAttrHiddenShown = true; // reset: always_hide attrs start grayed-out but visible

  var hiddenCount = (card.attrs || []).filter(function(a) {
    return (a.visibility || 'always') === 'always_hide';
  }).length;

  var attrsHtml = (card.attrs || []).map(function(a) {
    var icon     = _dbAttrTypeIcon(a.attr_type || 'text');
    var vis      = a.visibility || 'always';
    var isHidden = vis === 'always_hide';
    // always_hide → 40% gray; hide_empty+blank → 60%; everything else → full
    var rowOpacity = isHidden ? '0.4'
      : (vis === 'hide_empty' && !a.attr_value) ? '0.6' : '1';
    return '<div class="db-attr-row flex items-center gap-4 py-2.5 border-b'
      + ' border-gray-100 dark:border-zinc-800"'
      + ' draggable="false"'
      + ' data-attr-id="' + a.id + '" data-card-id="' + card.id + '"'
      + (isHidden ? ' data-attr-hidden="1"' : '')
      + ' style="opacity:' + rowOpacity + ';transition:opacity 0.15s;"'
      // Reveal grip on hover, hide when mouse leaves
      + ' onmouseenter="var g=this.querySelector(\'.db-attr-grip\');if(g)g.style.opacity=\'1\';"'
      + ' onmouseleave="var g=this.querySelector(\'.db-attr-grip\');if(g)g.style.opacity=\'0\';"'
      + '>'
      // ⠿ grip — invisible until row is hovered
      + '<span class="db-attr-grip"'
      + ' title="Drag to reorder"'
      + ' onmousedown="_dbAttrGripDown(event,this.closest(\'.db-attr-row\'))"'
      + ' style="opacity:0;cursor:grab;color:#9ca3af;flex-shrink:0;padding:0 3px;'
      + 'user-select:none;font-size:0.8rem;line-height:1;transition:opacity 0.1s;">'  // subtle fade-in
      + '&#10247;&#10247;</span>'
      // Clickable label → context menu
      + '<button type="button" class="db-attr-label text-left font-semibold'
      + ' text-gray-500 dark:text-zinc-400 flex-shrink-0 truncate"'
      + ' style="width:9rem;font-size:0.82rem;background:none;border:none;cursor:pointer;padding:0 4px;'
      + 'border-radius:0.25rem;"'
      + ' title="' + _esc(a.attr_key) + ' \u2014 click for options"'
      + ' onclick="_dbAttrMenu(' + card.id + ',' + a.id + ',this)">'
      + icon + ' ' + _esc(a.attr_key)
      + '</button>'
      // Value area
      + '<div class="flex-1 min-w-0">'
      + _dbAttrValueHtml(card.id, a)
      + '</div>'
      + '</div>';
  }).join('');

  // Toggle line that appears below "+ Add attribute" when hidden attrs exist
  // eye-off icon = attrs currently visible, clicking will hide them
  var eyeOffPath = 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7'
    + 'a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878'
    + 'l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0'
    + 'A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7'
    + 'a10.025 10.025 0 01-4.132 5.411m0 0L21 21';
  var n = hiddenCount;
  var toggleHtml = n > 0
    ? '<button type="button" id="db-attr-hidden-toggle-' + card.id + '"'
      + ' onclick="_dbToggleHiddenAttrs(' + card.id + ',' + n + ')"'
      + ' style="display:flex;align-items:center;gap:0.3rem;margin-top:0.4rem;'
      + 'font-size:0.72rem;color:#9ca3af;background:none;border:none;cursor:pointer;'
      + 'padding:0;line-height:1.4;"'
      + ' class="hover:text-gray-500 dark:hover:text-zinc-400 transition-colors">'
      + '<svg style="width:0.75rem;height:0.75rem;flex-shrink:0;" fill="none" viewBox="0 0 24 24"'
      + ' stroke="currentColor" stroke-width="2">'
      + '<path stroke-linecap="round" stroke-linejoin="round" d="' + eyeOffPath + '"/></svg>'
      + 'Hide (' + n + ') Hidden Attribute' + (n === 1 ? '' : 's')
      + '</button>'
    : '';

  dp.innerHTML = (
    coverHtml
    // Content wrapper — extra horizontal breathing room below the cover
    + '<div style="padding:0 1.25rem">'
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
    + 'Add attribute</button>'
    + toggleHtml
    + '</div>'
    // Video embed — auto-rendered when a 'Video URL' attr holds a Vimeo/YouTube/Wistia URL
    + _dbVideoEmbedHtml(card)
    // Notes area
    + '<div id="db-detail-note-' + card.id + '" contenteditable="true" data-db-note="1"'
    + ' data-placeholder="Start writing\u2026 (type / for commands)"'
    + ' class="min-h-[200px] outline-none text-sm text-gray-800 dark:text-zinc-100"'
    + ' style="padding-left:1.6rem;margin-left:-1.6rem;overflow:visible;"'
    + ' oninput="_dbDetailNoteInput(' + card.id + ',this)"'
    + ' onblur="_dbDetailNoteBlur(' + card.id + ',this)"'
    + ' aria-label="Card notes">'
    + (card.note_content || '')
    + '</div>'
    // ── Share row ────────────────────────────────────────────────────────────
    + '<div class="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100 dark:border-zinc-800">'
    + '<button type="button" onclick="shareOpenModal(\'db_card\',' + card.id + ')"'
    + ' title="Share this card"'
    + ' aria-label="Share this card"'
    + ' class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-zinc-600'
    + ' text-xs text-gray-500 dark:text-zinc-400 hover:text-[#0053e2] hover:border-[#0053e2]'
    + ' dark:hover:text-blue-400 dark:hover:border-blue-400 transition focus:outline-none">'
    + '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342'
    + 'm0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316'
    + 'm0 0a3 3 0 105.368-2.684 3 3 0 00-5.368 2.684zm0 9.316a3 3 0 105.368 2.684'
    + '3 3 0 00-5.368-2.684z"/></svg>'
    + 'Share'
    + '</button>'
    + '<span id="share-badge-db-card-' + card.id + '"'
    + ' class="hidden"'
    + ' title="Public link active \u2014 anyone with the link can view this card">'
    + '\uD83D\uDD17 Shared'
    + '</span>'
    + '<div id="share-modal-container-card" class="contents"></div>'
    + '</div>'
    + '</div>'
    // ↑ end content wrapper
  );

  /* Attach slash palette + paste-as to the note CE after HTML is in the DOM */
  _dbVimeoGuardSetup(dp);
  var noteEl = dp.querySelector('#db-detail-note-' + card.id);
  _dbAttachNoteTools(noteEl);
  _dbNotePlaceholderSync(noteEl);   // show placeholder when the note starts empty
  // Refresh inline page-link chip labels (no click-nav inside the editor).
  if (typeof window.bwHydratePageLinks === 'function') {
    window.bwHydratePageLinks(noteEl, { wireClick: false });
  }
  if (window.bwTableTools) window.bwTableTools.attach(noteEl);  // table resize handle
  /* Attach drag-and-drop for attr row reordering */
  _dbAttachAttrDrag(card.id);
  _dbAttachAttrDragTouch(card.id);   // touch equivalent (mobile)
  /* Load the public-share badge asynchronously (non-blocking) */
  if (typeof shareLoadCardBadge === 'function') shareLoadCardBadge(card.id);
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
    keepalive: true,
  })
  .then(function() { _dbRenderGrid(); })
  .catch(function(e) { console.warn('Title save failed', e); });
}

function _dbDetailNoteInput(cardId, el) {
  _dbNotePlaceholderSync(el);   // keep empty-state in sync as the user types/deletes
  _dbEnsureGrips(el);           // give freshly typed lines their drag/menu handle
  // Snapshot the current HTML on every keystroke — no DOM dependency later.
  var html = _dbNoteHtml(el);
  _dbDirtyNote = { cardId: cardId, html: html };
  if (_dbSaveTimers['detail_' + cardId]) clearTimeout(_dbSaveTimers['detail_' + cardId]);
  _dbSaveTimers['detail_' + cardId] = setTimeout(function() {
    _dbSaveNote(cardId, html);
    _dbDirtyNote = null;   // debounce timer fired — note is being saved
  }, 800);
}

function _dbDetailNoteBlur(cardId, el) {
  if (_dbSaveTimers['detail_' + cardId]) {
    clearTimeout(_dbSaveTimers['detail_' + cardId]);
    delete _dbSaveTimers['detail_' + cardId];
  }
  _dbSaveNote(cardId, _dbNoteHtml(el));
  _dbNotePlaceholderSync(el);   // re-show placeholder if the user left it empty
  _dbDirtyNote = null;   // saved — clear dirty state
}

/* ═══════════════════════════════════════════════════════════════════════════
   NOTE FILE ATTACHMENTS  —  /file slash command + Open/Download chip menu
═══════════════════════════════════════════════════════════════════════════ */

// Called by the shared slash palette (slash_commands.js) for the /file command,
// which only shows inside database card notes. Uploads the picked file to the
// card-scoped endpoint, then inserts a clickable chip at the cursor.
function _dbNoteAttachFile(ce, postDeleteRange) {
  if (!ce) return;
  var m = (ce.id || '').match(/db-detail-note-(\d+)/);
  var cardId = m ? Number(m[1]) : null;
  if (!cardId) return;

  // Clone the insertion point now — opening the picker changes the selection.
  var insertRange = null;
  try { insertRange = postDeleteRange ? postDeleteRange.cloneRange() : null; } catch (e) {}

  var inp = document.createElement('input');
  inp.type = 'file';
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.addEventListener('change', function() {
    var file = inp.files && inp.files[0];
    if (inp.parentNode) inp.parentNode.removeChild(inp);
    if (!file) return;
    _dbToast('Uploading ' + file.name + '…');
    var fd = new FormData();
    fd.append('file', file);
    fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/upload-note-file', {
      method: 'POST', body: fd,
    })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || 'Upload failed'); });
      return r.json();
    })
    .then(function(data) { _dbInsertFileChip(ce, insertRange, data.url, data.name); })
    .catch(function(e) { _dbToast('Attach failed: ' + e.message, true); });
  });
  inp.click();
}

// Build + insert the file chip HTML, then fire input so the note autosaves.
function _dbInsertFileChip(ce, range, url, name) {
  var esc = function(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(ch) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch];
    });
  };
  var safeName = esc(name || 'file');
  var safeUrl  = esc(url || '#');
  var chip = '<a href="' + safeUrl + '" class="bw-file-chip" data-bw-file="1"'
           + ' data-name="' + safeName + '" contenteditable="false" title="' + safeName + '">'
           + '<span class="bw-file-chip-ico" aria-hidden="true">📎</span>'
           + '<span class="bw-file-chip-name">' + safeName + '</span></a>&nbsp;';

  ce.focus();
  var sel = window.getSelection();
  var inserted = false;
  if (range && ce.contains(range.startContainer)) {
    try {
      sel.removeAllRanges();
      sel.addRange(range);
      inserted = document.execCommand('insertHTML', false, chip);
    } catch (e) { inserted = false; }
  }
  if (!inserted) {
    // Fallback: append a fresh paragraph with the chip at the note's end.
    var p = document.createElement('p');
    p.innerHTML = chip;
    ce.appendChild(p);
  }
  ce.dispatchEvent(new Event('input'));  // → _dbDetailNoteInput: autosave + placeholder sync
}
window._dbNoteAttachFile = _dbNoteAttachFile;
// Exposed so an inline sub-page's "back to card" breadcrumb can reopen the
// parent card detail in #detail-panel.
window._dbOpenDetail = _dbOpenDetail;

// Small popover anchored at the click: Open (new tab) or Download.
function _closeDbFileMenu() {
  var m = document.getElementById('_db-file-menu');
  if (m) m.remove();
}
function _dbFileChipMenu(chip, evt) {
  _closeDbFileMenu();
  var url  = chip.getAttribute('href') || '#';
  var name = chip.getAttribute('data-name') || 'file';
  var dark = document.documentElement.classList.contains('dark');

  var menu = document.createElement('div');
  menu.id = '_db-file-menu';
  menu.style.cssText = 'position:fixed;z-index:10002;min-width:170px;'
    + 'background:' + (dark ? '#27272a' : '#fff') + ';'
    + 'border:1px solid ' + (dark ? '#3f3f46' : '#e5e7eb') + ';'
    + 'border-radius:0.6rem;box-shadow:0 10px 30px rgba(0,0,0,.22);'
    + 'padding:0.35rem;font-size:0.85rem;';
  var x = (evt && evt.clientX != null) ? evt.clientX : 120;
  var y = (evt && evt.clientY != null) ? evt.clientY : 120;
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth  - 190)) + 'px';
  menu.style.top  = Math.max(8, Math.min(y, window.innerHeight - 130)) + 'px';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'padding:0.3rem 0.6rem 0.45rem;font-weight:600;font-size:0.72rem;'
    + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;'
    + 'color:' + (dark ? '#a1a1aa' : '#6b7280') + ';';
  hdr.textContent = name;
  menu.appendChild(hdr);

  function row(label, icon, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = 'display:flex;align-items:center;gap:0.55rem;width:100%;text-align:left;'
      + 'padding:0.45rem 0.6rem;border:none;background:none;cursor:pointer;border-radius:0.4rem;'
      + 'color:' + (dark ? '#e4e4e7' : '#27272a') + ';font-size:0.85rem;';
    b.innerHTML = '<span aria-hidden="true">' + icon + '</span><span>' + label + '</span>';
    b.onmouseenter = function() { b.style.background = dark ? '#3f3f46' : '#f3f4f6'; };
    b.onmouseleave = function() { b.style.background = 'none'; };
    b.onclick = function(ev) { ev.stopPropagation(); fn(); _closeDbFileMenu(); };
    menu.appendChild(b);
  }
  row('Open', '🔍', function() { window.open(url, '_blank', 'noopener,noreferrer'); });
  row('Download', '⬇️', function() {
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  });

  document.body.appendChild(menu);
  // Close on the next outside click / Escape.
  setTimeout(function() {
    document.addEventListener('click', _closeDbFileMenu, { once: true });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { _closeDbFileMenu(); document.removeEventListener('keydown', onEsc); }
    });
  }, 0);
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

    // ─ options (select / multi_select / status only — filled dynamically by _dbBuildOptEditor)
    + '<div id="_db-attr-opts-wrap" style="display:none;margin-bottom:0.75rem;"></div>'

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

    // ── date_range: two date pickers side by side ─────────────────────────
    if (t === 'date_range') {
      valWrap.innerHTML = '<label style="' + labelCss + '">Default date range '
        + '<span style="font-weight:400;text-transform:none;">(optional)</span></label>';
      var drRow = document.createElement('div');
      drRow.style.cssText = 'display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;';
      var drS = document.createElement('input');
      drS.type = 'date'; drS.id = '_db-attr-val-start';
      drS.style.cssText = inputCss + (isDark ? 'color-scheme:dark;' : '');
      var drArrow = document.createElement('span');
      drArrow.textContent = '\u2192';
      drArrow.style.cssText = 'color:#9ca3af;font-size:0.9rem;flex-shrink:0;';
      var drE = document.createElement('input');
      drE.type = 'date'; drE.id = '_db-attr-val-end';
      drE.style.cssText = inputCss + (isDark ? 'color-scheme:dark;' : '');
      drRow.appendChild(drS); drRow.appendChild(drArrow); drRow.appendChild(drE);
      valWrap.appendChild(drRow);
      optsWrap.style.display = 'none';
      return;
    }

    // ── progress: range slider 0-100 with live label ───────────────────────
    if (t === 'progress') {
      valWrap.innerHTML = '<label style="' + labelCss + '">Default progress '
        + '<span style="font-weight:400;text-transform:none;">(optional)</span></label>';
      var pgRow = document.createElement('div');
      pgRow.style.cssText = 'display:flex;align-items:center;gap:0.75rem;';
      var pgSlider = document.createElement('input');
      pgSlider.type = 'range'; pgSlider.min = '0'; pgSlider.max = '100';
      pgSlider.value = '0'; pgSlider.id = '_db-attr-val';
      pgSlider.style.cssText = 'flex:1;accent-color:#0053e2;cursor:pointer;';
      var pgLabel = document.createElement('span');
      pgLabel.textContent = '0%';
      pgLabel.style.cssText = 'font-size:0.85rem;font-variant-numeric:tabular-nums;'
        + 'color:' + txt + ';min-width:2.5rem;text-align:right;';
      pgSlider.addEventListener('input', function() {
        pgLabel.textContent = pgSlider.value + '%';
      });
      pgRow.appendChild(pgSlider); pgRow.appendChild(pgLabel);
      valWrap.appendChild(pgRow);
      optsWrap.style.display = 'none';
      return;
    }

    // ── rating: 5 star buttons with hidden value input ─────────────────────
    if (t === 'rating') {
      valWrap.innerHTML = '<label style="' + labelCss + '">Default rating '
        + '<span style="font-weight:400;text-transform:none;">(optional — leave at 0 for no default)</span></label>';
      var rtWrap = document.createElement('div');
      rtWrap.style.cssText = 'display:flex;align-items:center;gap:0.15rem;';
      var rtHidden = document.createElement('input');
      rtHidden.type = 'hidden'; rtHidden.id = '_db-attr-val'; rtHidden.value = '';
      rtWrap.appendChild(rtHidden);
      for (var ri = 1; ri <= 5; ri++) {
        (function(v) {
          var btn = document.createElement('button');
          btn.type = 'button'; btn.setAttribute('data-rv', String(v));
          btn.textContent = '\u2606'; // empty star
          btn.title = v + ' star' + (v > 1 ? 's' : '');
          btn.style.cssText = 'background:none;border:none;cursor:pointer;'
            + 'font-size:1.4rem;color:#d1d5db;line-height:1;padding:0 0.05rem;'
            + 'transition:transform 0.1s,color 0.1s;';
          btn.addEventListener('mouseenter', function() { btn.style.transform = 'scale(1.2)'; });
          btn.addEventListener('mouseleave', function() { btn.style.transform = ''; });
          btn.addEventListener('click', function() {
            var cur = parseInt(rtHidden.value, 10) || 0;
            var next = (v === cur) ? 0 : v; // click active star → deselect
            rtHidden.value = next > 0 ? String(next) : '';
            rtWrap.querySelectorAll('button[data-rv]').forEach(function(b) {
              var bv = parseInt(b.getAttribute('data-rv'), 10);
              b.textContent = bv <= next ? '\u2605' : '\u2606';
              b.style.color = bv <= next ? '#f59e0b' : '#d1d5db';
            });
          });
          rtWrap.appendChild(btn);
        })(ri);
      }
      valWrap.appendChild(rtWrap);
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
    if (needsOpts) {
      optsWrap.style.display = '';
      _dbBuildOptEditor(optsWrap, []);
    } else {
      optsWrap.style.display = 'none';
    }
  }

  function _getValField() { return document.getElementById('_db-attr-val'); }

  function _readValue() {
    // date_range uses two separate date inputs instead of a single #_db-attr-val
    if (selectedType === 'date_range') {
      var sEl = document.getElementById('_db-attr-val-start');
      var eEl = document.getElementById('_db-attr-val-end');
      return (sEl ? sEl.value : '') + '|' + (eEl ? eEl.value : '');
    }
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
    return _dbReadOptEditor(optsWrap);
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

/* ── Option colour editor (shared by Add + Edit modals) ──────────────── */

// Build an interactive option list with per-option color pickers.
// container : DOM element to build into
// initOpts  : [{label, color}] from _dbParseOptions()
function _dbBuildOptEditor(container, initOpts) {
  container.innerHTML = '';
  var dk = document.documentElement.classList.contains('dark');

  // Section label
  var lbl = document.createElement('div');
  lbl.style.cssText = 'font-size:0.7rem;font-weight:600;text-transform:uppercase;'
    + 'letter-spacing:0.05em;color:' + (dk ? '#71717a' : '#9ca3af') + ';margin-bottom:0.4rem;';
  lbl.textContent = 'Options';
  container.appendChild(lbl);

  var listEl = document.createElement('div');
  listEl.className = '_dbe-opt-list';
  listEl.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-bottom:0.4rem;';
  container.appendChild(listEl);

  function _makeRow(label, color) {
    var rowEl = document.createElement('div');
    rowEl.className = '_dbe-opt-row';
    rowEl.setAttribute('data-color', color || 'gray');

    var def = _dbOptColorDef(color || 'gray');
    var accentBdr = (color && color !== 'gray') ? def.dot + '55' : (dk ? '#3f3f46' : '#e5e7eb');

    rowEl.style.cssText = 'display:flex;flex-direction:column;border-radius:0.5rem;'
      + 'border:1px solid ' + accentBdr + ';overflow:hidden;transition:border-color 0.15s;';

    // Main row line
    var mainLine = document.createElement('div');
    mainLine.style.cssText = 'display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.5rem;'
      + 'background:' + (dk ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)') + ';';

    // Color dot — acts as picker trigger
    var colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.title = 'Change colour';
    colorBtn.style.cssText = 'flex-shrink:0;width:1rem;height:1rem;border-radius:9999px;border:none;'
      + 'cursor:pointer;background:' + def.dot + ';'
      + 'box-shadow:0 0 0 2px ' + (dk ? '#27272a' : '#fff') + ',0 0 0 3px ' + def.dot + '88;'
      + 'transition:transform 0.15s,box-shadow 0.15s;';
    colorBtn.addEventListener('mouseenter', function() { this.style.transform = 'scale(1.2)'; });
    colorBtn.addEventListener('mouseleave', function() { this.style.transform = ''; });

    // Label — borderless input, styled like a chip preview
    var labelInp = document.createElement('input');
    labelInp.type = 'text';
    labelInp.className = '_dbe-opt-label';
    labelInp.value = label || '';
    labelInp.placeholder = 'Label…';
    labelInp.style.cssText = 'flex:1;border:none;background:transparent;outline:none;'
      + 'font-size:0.82rem;font-weight:500;color:' + (dk ? '#f4f4f5' : '#111827') + ';'
      + 'min-width:0;padding:0;';

    // Delete — SVG × icon, appears on hover
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.title = 'Remove';
    delBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2.5" stroke-linecap="round">'
      + '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    delBtn.style.cssText = 'flex-shrink:0;width:1.2rem;height:1.2rem;border:none;background:transparent;'
      + 'cursor:pointer;color:#d1d5db;display:flex;align-items:center;justify-content:center;'
      + 'border-radius:0.25rem;padding:0;transition:color 0.1s,background 0.1s;';
    delBtn.addEventListener('mouseenter', function() {
      this.style.color = '#ef4444';
      this.style.background = dk ? '#450a0a55' : '#fef2f2';
    });
    delBtn.addEventListener('mouseleave', function() {
      this.style.color = '#d1d5db';
      this.style.background = 'transparent';
    });
    delBtn.addEventListener('click', function() { listEl.removeChild(rowEl); });

    // Palette panel — revealed below the row
    var palEl = document.createElement('div');
    palEl.className = '_dbe-palette';
    palEl.style.cssText = 'display:none;padding:0.45rem 0.6rem;'
      + 'border-top:1px solid ' + (dk ? '#3f3f46' : '#f3f4f6') + ';'
      + 'background:' + (dk ? '#1c1c1f' : '#f9fafb') + ';';

    var palLbl = document.createElement('div');
    palLbl.style.cssText = 'font-size:0.62rem;font-weight:600;text-transform:uppercase;'
      + 'letter-spacing:0.06em;color:' + (dk ? '#52525b' : '#d1d5db') + ';margin-bottom:0.4rem;';
    palLbl.textContent = 'Pick a colour';
    palEl.appendChild(palLbl);

    var swatchRow = document.createElement('div');
    swatchRow.style.cssText = 'display:flex;gap:0.4rem;flex-wrap:wrap;';
    _DB_OPT_COLORS.forEach(function(c) {
      var sw = document.createElement('button');
      sw.type = 'button';
      sw.title = c.id.charAt(0).toUpperCase() + c.id.slice(1);
      var isActive = c.id === (rowEl.getAttribute('data-color') || 'gray');
      sw.style.cssText = 'width:1.1rem;height:1.1rem;border-radius:9999px;border:none;cursor:pointer;'
        + 'background:' + c.dot + ';transition:transform 0.12s,box-shadow 0.12s;'
        + (isActive ? 'box-shadow:0 0 0 2px ' + (dk ? '#1c1c1f' : '#f9fafb') + ',0 0 0 3.5px ' + c.dot + ';' : '');
      sw.addEventListener('mouseenter', function() { this.style.transform = 'scale(1.25)'; });
      sw.addEventListener('mouseleave', function() { this.style.transform = ''; });
      sw.addEventListener('click', function() {
        var newDef = _dbOptColorDef(c.id);
        rowEl.setAttribute('data-color', c.id);
        // update the trigger dot
        colorBtn.style.background  = newDef.dot;
        colorBtn.style.boxShadow   = '0 0 0 2px ' + (dk ? '#27272a' : '#fff') + ',0 0 0 3px ' + newDef.dot + '88';
        // update row border accent
        rowEl.style.borderColor = c.id === 'gray' ? (dk ? '#3f3f46' : '#e5e7eb') : newDef.dot + '55';
        // update swatch ring
        swatchRow.querySelectorAll('button').forEach(function(b) { b.style.boxShadow = ''; });
        sw.style.boxShadow = '0 0 0 2px ' + (dk ? '#1c1c1f' : '#f9fafb') + ',0 0 0 3.5px ' + c.dot;
        palEl.style.display = 'none';
      });
      swatchRow.appendChild(sw);
    });
    palEl.appendChild(swatchRow);

    colorBtn.addEventListener('click', function() {
      var isOpen = palEl.style.display !== 'none';
      listEl.querySelectorAll('._dbe-palette').forEach(function(p) { p.style.display = 'none'; });
      palEl.style.display = isOpen ? 'none' : 'block';
    });

    mainLine.appendChild(colorBtn);
    mainLine.appendChild(labelInp);
    mainLine.appendChild(delBtn);
    rowEl.appendChild(mainLine);
    rowEl.appendChild(palEl);
    listEl.appendChild(rowEl);
    return rowEl;
  }

  initOpts.forEach(function(o) { _makeRow(o.label, o.color); });

  // Full-width dashed “Add option” button
  var addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.innerHTML =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="2.5" stroke-linecap="round" style="flex-shrink:0;">'
    + '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    + '<span>Add option</span>';
  addBtn.style.cssText = 'width:100%;display:flex;align-items:center;justify-content:center;gap:0.35rem;'
    + 'padding:0.35rem;border-radius:0.5rem;font-size:0.8rem;font-weight:500;'
    + 'border:1.5px dashed ' + (dk ? '#3f3f46' : '#e5e7eb') + ';background:transparent;'
    + 'color:' + (dk ? '#71717a' : '#9ca3af') + ';cursor:pointer;transition:all 0.15s;';
  addBtn.addEventListener('mouseenter', function() {
    this.style.borderColor = '#0053e2';
    this.style.color = '#0053e2';
    this.style.background = dk ? 'rgba(0,83,226,0.08)' : 'rgba(0,83,226,0.04)';
  });
  addBtn.addEventListener('mouseleave', function() {
    this.style.borderColor = dk ? '#3f3f46' : '#e5e7eb';
    this.style.color = dk ? '#71717a' : '#9ca3af';
    this.style.background = 'transparent';
  });
  addBtn.addEventListener('click', function() {
    var row = _makeRow('', 'gray');
    var inp = row.querySelector('._dbe-opt-label');
    if (inp) setTimeout(function() { inp.focus(); }, 30);
  });
  container.appendChild(addBtn);
}

// Read serialized options from a container built by _dbBuildOptEditor
function _dbReadOptEditor(container) {
  var opts = [];
  container.querySelectorAll('._dbe-opt-row').forEach(function(row) {
    var inp = row.querySelector('._dbe-opt-label');
    var lbl = inp ? inp.value.trim() : '';
    if (lbl) opts.push({ label: lbl, color: row.getAttribute('data-color') || 'gray' });
  });
  return _dbSerializeOptions(opts);
}

/* ── Edit existing attribute (name / type / format) ──────────────────── */
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
  var selectedDateFmt = (origType === 'date'  && origOpts) ? origOpts : 'mdy';
  var selectedDrFmt   = (origType === 'date_range' && origOpts) ? origOpts : 'short';
  var selectedFileFmt = (origType === 'files' && origOpts) ? origOpts : 'name';
  var selectedUrlFmt  = (origType === 'url'   && origOpts) ? origOpts : 'text';
  var selectedMapProv = (origType === 'place' && origOpts) ? origOpts : 'google';
  var _parsedNum      = (origType === 'number')   ? _dbParseNumOpts(origOpts) : null;
  var _parsedPg       = (origType === 'progress') ? _dbParsePgOpts(origOpts)  : null;
  var _parsedRt       = (origType === 'rating')   ? _dbParseRtOpts(origOpts)  : null;
  var selectedDisplay = _parsedNum ? (_parsedNum.display  || 'number') : 'number';
  var selectedBarClr  = _parsedNum ? (_parsedNum.barColor || 'blue')   : 'blue';
  var selectedPgMax   = _parsedPg  ? (_parsedPg.max       || 100)      : 100;
  var selectedPgDisp  = _parsedPg  ? (_parsedPg.display   || 'bar')    : 'bar';
  var selectedRtScale = _parsedRt  ? (_parsedRt.scale     || 5)        : 5;
  var selectedRtIcon  = _parsedRt  ? (_parsedRt.icon      || 'star')   : 'star';

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
      if (selectedType === origType) {
        selectedDisplay = parsed.display  || 'number';
        selectedBarClr  = parsed.barColor || 'blue';
      }

      // ── Format + Decimals row ───────────────────────────────────
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

      // ── Show As — only for plain / sep / percent formats ──────────
      var showAsFormats = ['number', 'number_sep', 'percent'];
      var curFmt = parsed.format;
      var showAsDiv = document.createElement('div');
      showAsDiv.id  = '_dbe-show-as-wrap';
      showAsDiv.style.cssText = 'margin-bottom:0.75rem;';

      function _rebuildShowAs(fmt) {
        showAsDiv.innerHTML = '';
        if (showAsFormats.indexOf(fmt) === -1) return;

        var saLbl = document.createElement('label');
        saLbl.style.cssText = labelCss;
        saLbl.textContent = 'Show as';
        showAsDiv.appendChild(saLbl);

        // Segmented 3-button control
        var seg = document.createElement('div');
        seg.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;'
          + 'border:1px solid ' + bdr + ';border-radius:0.5rem;overflow:hidden;margin-bottom:0.6rem;';

        var DISPLAY_OPTS = [
          { id:'number', label:'Number' },
          { id:'bar',    label:'Bar' },
          { id:'ring',   label:'Ring' },
        ];

        var barExtraDiv = document.createElement('div');
        barExtraDiv.id = '_dbe-bar-extras';

        function _applySegSel() {
          seg.querySelectorAll('button[data-disp]').forEach(function(b) {
            var sel = b.getAttribute('data-disp') === selectedDisplay;
            b.style.background = sel ? '#0053e2' : 'transparent';
            b.style.color      = sel ? '#fff'    : txt;
            b.style.fontWeight = sel ? '600' : '400';
          });
          _rebuildBarExtras(selectedDisplay, fmt);
        }

        DISPLAY_OPTS.forEach(function(d, i) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.setAttribute('data-disp', d.id);
          btn.textContent = d.label;
          var isSel = d.id === selectedDisplay;
          btn.style.cssText = 'padding:0.4rem 0;font-size:0.8rem;border:none;cursor:pointer;'
            + 'background:' + (isSel ? '#0053e2' : 'transparent') + ';'
            + 'color:' + (isSel ? '#fff' : txt) + ';'
            + 'font-weight:' + (isSel ? '600' : '400') + ';'
            + (i < 2 ? 'border-right:1px solid ' + bdr + ';' : '') + 'transition:all 0.12s;';
          btn.addEventListener('click', function() {
            selectedDisplay = d.id;
            _applySegSel();
          });
          seg.appendChild(btn);
        });
        showAsDiv.appendChild(seg);

        function _rebuildBarExtras(disp, fmt2) {
          barExtraDiv.innerHTML = '';
          if (disp === 'number') return;

          // Color
          var clrLbl = document.createElement('label');
          clrLbl.style.cssText = labelCss;
          clrLbl.textContent = 'Color';
          barExtraDiv.appendChild(clrLbl);

          var swRow = document.createElement('div');
          swRow.style.cssText = 'display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.6rem;';
          _DB_OPT_COLORS.forEach(function(c) {
            var sw = document.createElement('button');
            sw.type = 'button';
            sw.title = c.id.charAt(0).toUpperCase() + c.id.slice(1);
            var isAct = c.id === selectedBarClr;
            sw.style.cssText = 'width:1.1rem;height:1.1rem;border-radius:9999px;border:none;cursor:pointer;'
              + 'background:' + c.dot + ';transition:transform 0.1s,box-shadow 0.1s;'
              + (isAct ? 'box-shadow:0 0 0 2px ' + (isDark ? '#27272a' : '#fff') + ',0 0 0 3.5px ' + c.dot + ';' : '');
            sw.addEventListener('mouseenter', function() { this.style.transform = 'scale(1.25)'; });
            sw.addEventListener('mouseleave', function() { this.style.transform = ''; });
            sw.addEventListener('click', function() {
              selectedBarClr = c.id;
              swRow.querySelectorAll('button').forEach(function(b) { b.style.boxShadow = ''; });
              sw.style.boxShadow = '0 0 0 2px ' + (isDark ? '#27272a' : '#fff') + ',0 0 0 3.5px ' + c.dot;
            });
            swRow.appendChild(sw);
          });
          barExtraDiv.appendChild(swRow);

          // Divide By (hidden for percent)
          if (fmt2 !== 'percent') {
            var divRow = document.createElement('div');
            divRow.style.cssText = 'margin-bottom:0.6rem;';
            var divLbl = document.createElement('label');
            divLbl.style.cssText = labelCss;
            divLbl.textContent = 'Divide by';
            var divInp = document.createElement('input');
            divInp.type        = 'number';
            divInp.id          = '_dbe-num-divby';
            divInp.min         = '0.001';
            divInp.step        = 'any';
            divInp.placeholder = 'e.g. 100';
            divInp.value       = (selectedType === origType && parsed.divideBy) ? String(parsed.divideBy) : '100';
            divInp.style.cssText = inputCss;
            divRow.appendChild(divLbl);
            divRow.appendChild(divInp);
            barExtraDiv.appendChild(divRow);
          }

          // Show value toggle
          var svRow = document.createElement('label');
          svRow.style.cssText = 'display:flex;align-items:center;gap:0.5rem;cursor:pointer;'
            + 'font-size:0.82rem;color:' + txt + ';margin-bottom:0.5rem;';
          var svChk = document.createElement('input');
          svChk.type    = 'checkbox';
          svChk.id      = '_dbe-num-showval';
          svChk.checked = (selectedType === origType) ? parsed.showValue : true;
          svChk.style.cssText = 'width:1rem;height:1rem;accent-color:#0053e2;cursor:pointer;';
          svRow.appendChild(svChk);
          svRow.appendChild(document.createTextNode('Show number value'));
          barExtraDiv.appendChild(svRow);
        }

        showAsDiv.appendChild(barExtraDiv);
        _rebuildBarExtras(selectedDisplay, fmt);
      }

      // Rebuild Show As when format changes
      fmtSel.addEventListener('change', function() {
        _rebuildShowAs(this.value);
      });

      _rebuildShowAs(curFmt);
      extrasDiv.appendChild(showAsDiv);
    } else if (t === 'select' || t === 'multi_select' || t === 'status') {
      var initStr  = selectedType === origType ? origOpts : '';
      var initOpts = _dbParseOptions(initStr);
      _dbBuildOptEditor(extrasDiv, initOpts);
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
    } else if (t === 'files') {
      // Reset to default when switching TO files from a different type
      if (selectedType !== origType) selectedFileFmt = 'name';
      var FILE_FMTS = [
        { id: 'name',  icon: '\uD83D\uDCCE', label: 'Name link',
          desc: 'Show file name as a hyperlink' },
        { id: 'short', icon: '\uD83D\uDD17', label: 'Short URL',
          desc: 'Show trimmed URL as a hyperlink' },
        { id: 'full',  icon: '\uD83D\uDD17', label: 'Full URL',
          desc: 'Show the full URL string' },
      ];
      var fileFmtDiv = document.createElement('div');
      fileFmtDiv.style.cssText = 'margin-bottom:0.75rem;';
      var fileFmtLbl = document.createElement('label');
      fileFmtLbl.style.cssText = labelCss;
      fileFmtLbl.textContent = 'Link display';
      fileFmtDiv.appendChild(fileFmtLbl);
      var fileFmtGrid = document.createElement('div');
      fileFmtGrid.id = '_dbe-file-fmt-grid';
      fileFmtGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.35rem;';
      FILE_FMTS.forEach(function(ff) {
        var isSel = ff.id === selectedFileFmt;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-filefmt', ff.id);
        btn.style.cssText =
          'text-align:left;padding:0.4rem 0.6rem;border-radius:0.5rem;cursor:pointer;'
          + 'border:1px solid ' + (isSel ? '#0053e2' : bdr) + ';'
          + 'background:' + (isSel ? selBg : 'transparent') + ';font-size:0.8rem;'
          + 'transition:border-color 0.12s,background 0.12s;';
        btn.innerHTML =
          '<div style="font-size:1rem;margin-bottom:0.15rem;">' + ff.icon + '</div>'
          + '<div style="font-weight:600;color:' + txt + ';font-size:0.78rem;">' + _esc(ff.label) + '</div>'
          + '<div style="color:' + sub + ';font-size:0.68rem;line-height:1.3;margin-top:0.1rem;">'
          + _esc(ff.desc) + '</div>';
        btn.addEventListener('click', function() {
          selectedFileFmt = ff.id;
          fileFmtGrid.querySelectorAll('button[data-filefmt]').forEach(function(b) {
            var s = b.getAttribute('data-filefmt') === selectedFileFmt;
            b.style.border     = '1px solid ' + (s ? '#0053e2' : bdr);
            b.style.background = s ? selBg : 'transparent';
          });
        });
        fileFmtGrid.appendChild(btn);
      });
      fileFmtDiv.appendChild(fileFmtGrid);
      extrasDiv.appendChild(fileFmtDiv);

    } else if (t === 'url') {
      // Reset when switching TO url from a different type
      if (selectedType !== origType) selectedUrlFmt = 'text';
      var urlFmtDiv = document.createElement('div');
      urlFmtDiv.style.cssText = 'margin-bottom:0.75rem;';
      var urlFmtLbl = document.createElement('label');
      urlFmtLbl.style.cssText = labelCss;
      urlFmtLbl.textContent = 'Link display';
      urlFmtDiv.appendChild(urlFmtLbl);
      var urlFmtGrid = document.createElement('div');
      urlFmtGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.35rem;';
      [
        { id: 'text',   icon: '\uD83D\uDD17', label: 'Link text', desc: 'Full URL as label' },
        { id: 'short',  icon: '\u2702\uFE0F', label: 'Short URL',  desc: 'Domain only' },
        { id: 'button', icon: '\uD83D\uDD18', label: 'Button',     desc: 'Styled link button' },
      ].forEach(function(f) {
        var isSel = f.id === selectedUrlFmt;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-urlfmt', f.id);
        btn.style.cssText = 'text-align:left;padding:0.4rem 0.6rem;border-radius:0.5rem;cursor:pointer;'
          + 'border:1px solid ' + (isSel ? '#0053e2' : bdr) + ';'
          + 'background:' + (isSel ? selBg : 'transparent') + ';font-size:0.8rem;';
        btn.innerHTML = '<div style="font-weight:600;color:' + txt + ';">' + f.icon + ' ' + _esc(f.label) + '</div>'
          + '<div style="color:' + sub + ';font-size:0.7rem;">' + _esc(f.desc) + '</div>';
        btn.addEventListener('click', function() {
          selectedUrlFmt = f.id;
          urlFmtGrid.querySelectorAll('button[data-urlfmt]').forEach(function(b) {
            var s = b.getAttribute('data-urlfmt') === selectedUrlFmt;
            b.style.border     = '1px solid ' + (s ? '#0053e2' : bdr);
            b.style.background = s ? selBg : 'transparent';
          });
        });
        urlFmtGrid.appendChild(btn);
      });
      urlFmtDiv.appendChild(urlFmtGrid);
      extrasDiv.appendChild(urlFmtDiv);

    } else if (t === 'place') {
      // Reset when switching TO place from a different type
      if (selectedType !== origType) selectedMapProv = 'google';
      var placeFmtDiv = document.createElement('div');
      placeFmtDiv.style.cssText = 'margin-bottom:0.75rem;';
      var placeFmtLbl = document.createElement('label');
      placeFmtLbl.style.cssText = labelCss;
      placeFmtLbl.textContent = 'Map provider';
      placeFmtDiv.appendChild(placeFmtLbl);
      var placeFmtGrid = document.createElement('div');
      placeFmtGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.35rem;';
      [
        { id: 'google', icon: '\uD83D\uDDFA\uFE0F', label: 'Google',        desc: 'maps.google.com' },
        { id: 'apple',  icon: '\uD83C\uDF4E', label: 'Apple Maps',   desc: 'maps.apple.com' },
        { id: 'osm',    icon: '\uD83C\uDF0D', label: 'OpenStreetMap', desc: 'openstreetmap.org' },
      ].forEach(function(f) {
        var isSel = f.id === selectedMapProv;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-mapprov', f.id);
        btn.style.cssText = 'text-align:left;padding:0.4rem 0.6rem;border-radius:0.5rem;cursor:pointer;'
          + 'border:1px solid ' + (isSel ? '#0053e2' : bdr) + ';'
          + 'background:' + (isSel ? selBg : 'transparent') + ';font-size:0.8rem;';
        btn.innerHTML = '<div style="font-weight:600;color:' + txt + ';">' + f.icon + ' ' + _esc(f.label) + '</div>'
          + '<div style="color:' + sub + ';font-size:0.7rem;">' + _esc(f.desc) + '</div>';
        btn.addEventListener('click', function() {
          selectedMapProv = f.id;
          placeFmtGrid.querySelectorAll('button[data-mapprov]').forEach(function(b) {
            var s = b.getAttribute('data-mapprov') === selectedMapProv;
            b.style.border     = '1px solid ' + (s ? '#0053e2' : bdr);
            b.style.background = s ? selBg : 'transparent';
          });
        });
        placeFmtGrid.appendChild(btn);
      });
      placeFmtDiv.appendChild(placeFmtGrid);
      extrasDiv.appendChild(placeFmtDiv);

    } else if (t === 'date_range') {
      // Same date-format grid as the regular Date type
      if (selectedType !== origType) selectedDrFmt = 'short';
      var drFmtDiv = document.createElement('div');
      drFmtDiv.style.cssText = 'margin-bottom:0.75rem;';
      var drFmtLbl = document.createElement('label');
      drFmtLbl.style.cssText = labelCss;
      drFmtLbl.textContent = 'Display format';
      drFmtDiv.appendChild(drFmtLbl);
      var drFmtGrid = document.createElement('div');
      drFmtGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;';
      _DB_DATE_FORMATS.forEach(function(f) {
        var isSel = f.id === selectedDrFmt;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-drfmt', f.id);
        btn.style.cssText = 'text-align:left;padding:0.4rem 0.6rem;border-radius:0.5rem;cursor:pointer;'
          + 'border:1px solid ' + (isSel ? '#0053e2' : bdr) + ';'
          + 'background:' + (isSel ? selBg : 'transparent') + ';font-size:0.8rem;';
        btn.innerHTML = '<div style="font-weight:600;color:' + txt + ';">' + _esc(f.label) + '</div>'
          + '<div style="color:' + sub + ';font-size:0.7rem;">' + _esc(f.example) + '</div>';
        btn.addEventListener('click', function() {
          selectedDrFmt = f.id;
          drFmtGrid.querySelectorAll('button[data-drfmt]').forEach(function(b) {
            var s = b.getAttribute('data-drfmt') === selectedDrFmt;
            b.style.border     = '1px solid ' + (s ? '#0053e2' : bdr);
            b.style.background = s ? selBg : 'transparent';
          });
        });
        drFmtGrid.appendChild(btn);
      });
      drFmtDiv.appendChild(drFmtGrid);
      extrasDiv.appendChild(drFmtDiv);

    } else if (t === 'progress') {
      if (selectedType !== origType) { selectedPgMax = 100; selectedPgDisp = 'bar'; }
      // ─ Max value
      var pgMaxDiv = document.createElement('div');
      pgMaxDiv.style.cssText = 'margin-bottom:0.75rem;';
      var pgMaxLbl = document.createElement('label');
      pgMaxLbl.style.cssText = labelCss;
      pgMaxLbl.textContent = 'Maximum value';
      pgMaxDiv.appendChild(pgMaxLbl);
      var pgMaxInp = document.createElement('input');
      pgMaxInp.type  = 'number'; pgMaxInp.min = '1'; pgMaxInp.id = '_dbe-pg-max';
      pgMaxInp.value = String(selectedPgMax);
      pgMaxInp.placeholder = '100';
      pgMaxInp.style.cssText = inputCss;
      pgMaxInp.addEventListener('input', function() {
        selectedPgMax = parseInt(this.value, 10) || 100;
      });
      pgMaxDiv.appendChild(pgMaxInp);
      extrasDiv.appendChild(pgMaxDiv);
      // ─ Display style (3-button segmented)
      var pgDispDiv = document.createElement('div');
      pgDispDiv.style.cssText = 'margin-bottom:0.35rem;';
      var pgDispLbl = document.createElement('label');
      pgDispLbl.style.cssText = labelCss;
      pgDispLbl.textContent = 'Display as';
      pgDispDiv.appendChild(pgDispLbl);
      var pgSeg = document.createElement('div');
      pgSeg.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;'
        + 'border:1px solid ' + bdr + ';border-radius:0.5rem;overflow:hidden;';
      [{ id:'bar', lbl:'Bar' }, { id:'number', lbl:'Number' }, { id:'both', lbl:'Both' }]
        .forEach(function(d, i) {
          var btn = document.createElement('button');
          btn.type = 'button'; btn.setAttribute('data-pgdisp', d.id);
          btn.textContent = d.lbl;
          var isSel = d.id === selectedPgDisp;
          btn.style.cssText = 'padding:0.4rem 0;font-size:0.8rem;border:none;cursor:pointer;'
            + 'background:' + (isSel ? '#0053e2' : 'transparent') + ';'
            + 'color:' + (isSel ? '#fff' : txt) + ';'
            + 'font-weight:' + (isSel ? '600' : '400') + ';'
            + (i < 2 ? 'border-right:1px solid ' + bdr + ';' : '');
          btn.addEventListener('click', function() {
            selectedPgDisp = d.id;
            pgSeg.querySelectorAll('button[data-pgdisp]').forEach(function(b) {
              var s = b.getAttribute('data-pgdisp') === selectedPgDisp;
              b.style.background = s ? '#0053e2' : 'transparent';
              b.style.color      = s ? '#fff'    : txt;
              b.style.fontWeight = s ? '600'     : '400';
            });
          });
          pgSeg.appendChild(btn);
        });
      pgDispDiv.appendChild(pgSeg);
      extrasDiv.appendChild(pgDispDiv);

    } else if (t === 'rating') {
      if (selectedType !== origType) { selectedRtScale = 5; selectedRtIcon = 'star'; }
      // ─ Scale
      var rtScaleDiv = document.createElement('div');
      rtScaleDiv.style.cssText = 'margin-bottom:0.75rem;';
      var rtScaleLbl = document.createElement('label');
      rtScaleLbl.style.cssText = labelCss;
      rtScaleLbl.textContent = 'Scale';
      rtScaleDiv.appendChild(rtScaleLbl);
      var rtScaleSeg = document.createElement('div');
      rtScaleSeg.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;'
        + 'border:1px solid ' + bdr + ';border-radius:0.5rem;overflow:hidden;';
      [{ v:5, lbl:'1 – 5' }, { v:10, lbl:'1 – 10' }].forEach(function(s, i) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.setAttribute('data-rtscale', String(s.v));
        btn.textContent = s.lbl;
        var isSel = s.v === selectedRtScale;
        btn.style.cssText = 'padding:0.4rem 0;font-size:0.8rem;border:none;cursor:pointer;'
          + 'background:' + (isSel ? '#0053e2' : 'transparent') + ';'
          + 'color:' + (isSel ? '#fff' : txt) + ';'
          + 'font-weight:' + (isSel ? '600' : '400') + ';'
          + (i === 0 ? 'border-right:1px solid ' + bdr + ';' : '');
        btn.addEventListener('click', function() {
          selectedRtScale = s.v;
          rtScaleSeg.querySelectorAll('button[data-rtscale]').forEach(function(b) {
            var sel = parseInt(b.getAttribute('data-rtscale'), 10) === selectedRtScale;
            b.style.background = sel ? '#0053e2' : 'transparent';
            b.style.color      = sel ? '#fff'    : txt;
            b.style.fontWeight = sel ? '600'     : '400';
          });
        });
        rtScaleSeg.appendChild(btn);
      });
      rtScaleDiv.appendChild(rtScaleSeg);
      extrasDiv.appendChild(rtScaleDiv);
      // ─ Icon style (4 cards in a 2x2 grid)
      var rtIconDiv = document.createElement('div');
      rtIconDiv.style.cssText = 'margin-bottom:0.35rem;';
      var rtIconLbl = document.createElement('label');
      rtIconLbl.style.cssText = labelCss;
      rtIconLbl.textContent = 'Icon style';
      rtIconDiv.appendChild(rtIconLbl);
      var rtIconGrid = document.createElement('div');
      rtIconGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;';
      [
        { id:'star',  label:'Stars',  preview:'\u2605\u2605\u2605\u2606\u2606' },
        { id:'heart', label:'Hearts', preview:'\u2665\u2665\u2665\u2661\u2661' },
        { id:'thumb', label:'Thumbs', preview:'\uD83D\uDC4D\uD83D\uDC4D\uD83D\uDC4D\u25CB\u25CB' },
        { id:'dot',   label:'Dots',   preview:'\u25CF\u25CF\u25CF\u25CB\u25CB' },
      ].forEach(function(ic) {
        var isSel = ic.id === selectedRtIcon;
        var btn = document.createElement('button');
        btn.type = 'button'; btn.setAttribute('data-rticon', ic.id);
        btn.style.cssText = 'text-align:left;padding:0.4rem 0.6rem;border-radius:0.5rem;cursor:pointer;'
          + 'border:1px solid ' + (isSel ? '#0053e2' : bdr) + ';'
          + 'background:' + (isSel ? selBg : 'transparent') + ';font-size:0.8rem;';
        btn.innerHTML = '<div style="font-size:0.85rem;letter-spacing:0.05em;margin-bottom:0.1rem;">'
          + ic.preview + '</div>'
          + '<div style="font-weight:600;color:' + txt + ';font-size:0.75rem;">'
          + _esc(ic.label) + '</div>';
        btn.addEventListener('click', function() {
          selectedRtIcon = ic.id;
          rtIconGrid.querySelectorAll('button[data-rticon]').forEach(function(b) {
            var s = b.getAttribute('data-rticon') === selectedRtIcon;
            b.style.border     = '1px solid ' + (s ? '#0053e2' : bdr);
            b.style.background = s ? selBg : 'transparent';
          });
        });
        rtIconGrid.appendChild(btn);
      });
      rtIconDiv.appendChild(rtIconGrid);
      extrasDiv.appendChild(rtIconDiv);

    } else if (t === 'phone' || t === 'email' || t === 'checkbox'
              || t === 'person' || t === 'text') {
      // No configurable settings for these types — show a small hint so
      // the user knows the section is working, just intentionally empty.
      var noSetDiv = document.createElement('div');
      noSetDiv.style.cssText = 'font-size:0.72rem;padding:0.2rem 0 0.35rem;color:' + sub + ';';
      noSetDiv.textContent = 'No additional settings for this type.';
      extrasDiv.appendChild(noSetDiv);
    }
  }  // end _buildExtras

  // ── read options from extras ─────────────────────────────────────
  function _readExtras() {
    if (selectedType === 'number') {
      var fEl  = document.getElementById('_dbe-num-fmt');
      var dEl  = document.getElementById('_dbe-num-dec');
      var dbEl = document.getElementById('_dbe-num-divby');
      var svEl = document.getElementById('_dbe-num-showval');
      var fmt  = fEl ? fEl.value : 'number';
      var obj  = {
        format:   fmt,
        decimals: dEl ? (parseInt(dEl.value, 10) || 0) : 0,
        display:  selectedDisplay || 'number',
        barColor: selectedBarClr  || 'blue',
        showValue: svEl ? svEl.checked : true,
      };
      if (selectedDisplay !== 'number' && fmt !== 'percent') {
        obj.divideBy = dbEl ? (parseFloat(dbEl.value) || 100) : 100;
      }
      return JSON.stringify(obj);
    }
    if (selectedType === 'date')       return selectedDateFmt || 'mdy';
    if (selectedType === 'date_range')  return selectedDrFmt   || 'short';
    if (selectedType === 'files')       return selectedFileFmt || 'name';
    if (selectedType === 'url')         return selectedUrlFmt  || 'text';
    if (selectedType === 'place')       return selectedMapProv || 'google';
    if (selectedType === 'progress')    return JSON.stringify({ max: selectedPgMax || 100, display: selectedPgDisp || 'bar' });
    if (selectedType === 'rating')      return JSON.stringify({ scale: selectedRtScale || 5, icon: selectedRtIcon || 'star' });
    return _dbReadOptEditor(extrasDiv);
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
    // Refresh the detail panel so the pill chip updates immediately
    var fresh = _dbCards.find(function(c) { return c.id === cardId; });
    if (fresh) _dbRenderDetailPanel(fresh);
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

// Toggle a checkbox attr from the card preview pill.
// Optimistically flips local state + re-renders grid immediately,
// then persists. A second re-render happens on save success.
function _dbToggleCheckbox(cardId, attrId, key) {
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  if (!card) return;
  var attr = card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  if (!attr) return;
  var wasChecked = (attr.attr_value === 'true' || attr.attr_value === '1' || attr.attr_value === 'yes');
  var newVal = wasChecked ? 'false' : 'true';
  attr.attr_value = newVal;   // optimistic local flip
  _dbRenderGrid();             // instant visual feedback
  _dbSaveAttrVal(cardId, attrId, key, newVal);
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

// date_range: blur on a typed text field — parse the user's text, sync
// to the corresponding hidden date picker, then save both sides.
function _dbDrTextBlur(cardId, attrId, key, textEl, fmtId, side) {
  var raw = textEl.value.trim();
  var iso = raw ? _dbParseUserDate(raw) : '';
  if (raw && !iso) {
    textEl.style.color = '#ea1100';
    setTimeout(function() { textEl.style.color = ''; }, 1500);
    return; // don't save garbage
  }
  textEl.value = iso ? _dbFormatDate(iso, fmtId) : '';
  // sync hidden picker
  var pickerId = 'dtr-' + side + '-' + attrId;
  var picker = document.getElementById(pickerId);
  if (picker) picker.value = iso;
  // save both sides
  var startPicker = document.getElementById('dtr-start-' + attrId);
  var endPicker   = document.getElementById('dtr-end-'   + attrId);
  var startVal = startPicker ? startPicker.value : '';
  var endVal   = endPicker   ? endPicker.value   : '';
  _dbSaveAttrVal(cardId, attrId, key, startVal + '|' + endVal);
}

// date_range: calendar picker changed — format text field, save both.
function _dbDrPickerChange(cardId, attrId, key, pickerEl, fmtId, side) {
  var iso = pickerEl.value;
  var textId = 'dtr-txt-' + side + '-' + attrId;
  var textEl = document.getElementById(textId);
  if (textEl) textEl.value = iso ? _dbFormatDate(iso, fmtId) : '';
  var startPicker = document.getElementById('dtr-start-' + attrId);
  var endPicker   = document.getElementById('dtr-end-'   + attrId);
  var startVal = startPicker ? startPicker.value : '';
  var endVal   = endPicker   ? endPicker.value   : '';
  _dbSaveAttrVal(cardId, attrId, key, startVal + '|' + endVal);
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

// date_range — called by onchange on either the start or end picker.
// Reads both pickers from the parent .db-dr-wrap, saves as "start|end".
function _dbDateRangeSave(cardId, attrId, key, wrapEl) {
  var startEl = wrapEl.querySelector('.db-dr-start');
  var endEl   = wrapEl.querySelector('.db-dr-end');
  var start   = startEl ? startEl.value : '';
  var end     = endEl   ? endEl.value   : '';
  _dbSaveAttrVal(cardId, attrId, key, start + '|' + end);
}

// progress — called by oninput on the range slider.  Debounced 400 ms.
// Updates the live label immediately; defers the server save.
function _dbProgressChange(cardId, attrId, key, el, max) {
  var val    = parseInt(el.value, 10) || 0;
  var mx     = (max && max > 0) ? max : 100;
  var fillPct = Math.min(100, Math.round((val / mx) * 100));
  var labelEl = el.parentNode ? el.parentNode.querySelector('.db-pg-label') : null;
  if (labelEl) labelEl.textContent = mx === 100 ? val + '%' : val + '\u202F/\u202F' + mx;
  el.style.background = 'linear-gradient(to right,#0053e2 ' + fillPct + '%,'
    + (document.documentElement.classList.contains('dark') ? '#3f3f46' : '#e5e7eb')
    + ' ' + fillPct + '%)';
  var timerKey = 'prog-' + cardId + '-' + attrId;
  clearTimeout(_dbSaveTimers[timerKey]);
  _dbSaveTimers[timerKey] = setTimeout(function() {
    _dbSaveAttrVal(cardId, attrId, key, String(val));
  }, 400);
}

// rating — called onclick on a star button.
// Clicking the already-active star resets to 0 (no rating).
function _dbRatingSave(cardId, attrId, key, val, btnEl) {
  var wrap    = btnEl.closest('.db-rating-wrap');
  var current = parseInt(wrap ? wrap.getAttribute('data-rating') : '0', 10) || 0;
  var newVal  = (val === current) ? 0 : val;
  if (wrap) wrap.setAttribute('data-rating', String(newVal));
  // Optimistic repaint using stored icon/scale
  if (wrap) {
    var icId  = wrap.getAttribute('data-icon') || 'star';
    var icDef = _DB_RT_ICON_MAP[icId] || _DB_RT_ICON_MAP.star;
    var isDkR = document.documentElement.classList.contains('dark');
    var offClr = isDkR ? '#52525b' : '#d1d5db';
    wrap.querySelectorAll('.db-rating-btn').forEach(function(b) {
      var bv = parseInt(b.getAttribute('data-val'), 10);
      var on = bv <= newVal;
      b.textContent = on ? icDef.on : icDef.off;
      b.style.color = on ? icDef.clr : offClr;
    });
  }
  _dbSaveAttrVal(cardId, attrId, key, newVal > 0 ? String(newVal) : '');
}

var _dbAttrMenuEl = null;   // currently open menu DOM node
var _dbAttrMenuOff = null;  // listener to remove on close
var _dbAttrMenuKey = null;

function _dbAttrMenuClose() {
  if (_dbAttrMenuEl) {
    _dbAttrMenuEl.remove();
    _dbAttrMenuEl = null;
  }
  if (_dbAttrMenuOff) {
    document.removeEventListener('mousedown', _dbAttrMenuOff, true);
    document.removeEventListener('keydown',   _dbAttrMenuKey,  true);
    _dbAttrMenuOff = null;
    _dbAttrMenuKey = null;
  }
}

function _dbAttrMenu(cardId, attrId, triggerEl) {
  _dbAttrMenuClose(); // close any existing menu

  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var attr = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  if (!attr) return;

  var isDark = document.documentElement.classList.contains('dark');
  var bg     = isDark ? '#27272a' : '#ffffff';
  var bdr    = isDark ? '#3f3f46' : '#e5e7eb';
  var txt    = isDark ? '#f4f4f5' : '#111827';
  var sub    = isDark ? '#a1a1aa' : '#6b7280';
  var hov    = isDark ? '#3f3f46' : '#f3f4f6';
  var vis    = attr.visibility || 'always';

  var menu = document.createElement('div');
  menu.id  = 'db-attr-ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.style.cssText =
    'position:fixed;z-index:10000;min-width:14rem;padding:0.4rem 0;'
    + 'background:' + bg + ';border:1px solid ' + bdr + ';'
    + 'border-radius:0.625rem;box-shadow:0 8px 32px rgba(0,0,0,0.18);';

  // ── helpers ────────────────────────────────────────────────────────────
  function makeItem(icon, label, action, danger) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.style.cssText =
      'display:flex;align-items:center;gap:0.6rem;width:100%;padding:0.45rem 0.9rem;'
      + 'background:none;border:none;cursor:pointer;font-size:0.8rem;text-align:left;'
      + 'color:' + (danger ? '#ef4444' : txt) + ';';
    btn.innerHTML = '<span style="width:1rem;text-align:center;flex-shrink:0;">' + icon + '</span>'
      + '<span>' + label + '</span>';
    btn.addEventListener('mouseenter', function() { btn.style.background = hov; });
    btn.addEventListener('mouseleave', function() { btn.style.background = 'none'; });
    btn.addEventListener('click', function() { _dbAttrMenuClose(); action(); });
    return btn;
  }

  function makeDivider() {
    var hr = document.createElement('div');
    hr.style.cssText = 'border-top:1px solid ' + bdr + ';margin:0.35rem 0;';
    return hr;
  }

  function makeVisRadio(label, icon, value) {
    var row = document.createElement('button');
    row.type = 'button';
    row.setAttribute('role', 'menuitemradio');
    row.setAttribute('aria-checked', vis === value ? 'true' : 'false');
    var checked = vis === value;
    row.style.cssText =
      'display:flex;align-items:center;gap:0.6rem;width:100%;padding:0.4rem 0.9rem 0.4rem 2.2rem;'
      + 'background:none;border:none;cursor:pointer;font-size:0.78rem;text-align:left;'
      + 'color:' + (checked ? '#0053e2' : sub) + ';';
    row.innerHTML =
      '<span style="width:0.9rem;text-align:center;flex-shrink:0;font-size:0.75rem;">'
      + (checked ? '\u25CF' : '\u25CB') + '</span>'
      + '<span>' + icon + ' ' + label + '</span>';
    row.addEventListener('mouseenter', function() { row.style.background = hov; });
    row.addEventListener('mouseleave', function() { row.style.background = 'none'; });
    row.addEventListener('click', function() {
      _dbAttrMenuClose();
      _dbAttrSetVisibility(cardId, attrId, value);
    });
    return row;
  }

  // ── menu items ─────────────────────────────────────────────────────────
  menu.appendChild(makeItem('\u270F\uFE0F', 'Rename', function() {
    var labelEl = document.querySelector(
      '.db-attr-row[data-attr-id="' + attrId + '"] .db-attr-label'
    );
    if (labelEl) _dbAttrInlineRename(cardId, attrId, labelEl);
  }, false));

  menu.appendChild(makeItem('\u2699\uFE0F', 'Edit attribute', function() {
    _dbEditAttrRow(cardId, attrId);
  }, false));

  // Visibility section header
  var visHdr = document.createElement('div');
  visHdr.style.cssText =
    'padding:0.35rem 0.9rem 0.1rem;font-size:0.7rem;font-weight:600;'
    + 'text-transform:uppercase;letter-spacing:0.06em;color:' + sub + ';';
  visHdr.textContent = 'Visibility';
  menu.appendChild(visHdr);
  menu.appendChild(makeVisRadio('Always show',    '\uD83D\uDC41\uFE0F', 'always'));
  menu.appendChild(makeVisRadio('Hide when empty','\uD83D\uDEAB', 'hide_empty'));
  menu.appendChild(makeVisRadio('Always hide',    '\uD83D\uDE48', 'always_hide'));

  menu.appendChild(makeDivider());

  menu.appendChild(makeItem('\u29C9', 'Duplicate attribute', function() {
    _dbAttrDuplicate(cardId, attrId);
  }, false));

  menu.appendChild(makeDivider());

  menu.appendChild(makeItem('\uD83D\uDDD1\uFE0F', 'Delete attribute', function() {
    _dbDeleteAttr(cardId, attrId);
  }, true));

  // ── position near trigger ──────────────────────────────────────────────
  document.body.appendChild(menu);
  _dbAttrMenuEl = menu;

  var rect = triggerEl.getBoundingClientRect();
  var mh   = menu.offsetHeight || 280;
  var top  = rect.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = rect.top - mh - 4;
  menu.style.top  = Math.max(4, top) + 'px';
  menu.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 230)) + 'px';

  // ── close on outside click or Escape ──────────────────────────────────
  _dbAttrMenuOff = function(e) {
    if (!menu.contains(e.target)) _dbAttrMenuClose();
  };
  _dbAttrMenuKey = function(e) {
    if (e.key === 'Escape') _dbAttrMenuClose();
  };
  setTimeout(function() {
    document.addEventListener('mousedown', _dbAttrMenuOff, true);
    document.addEventListener('keydown',   _dbAttrMenuKey,  true);
  }, 0);
}

/* ─────────────────────────────────────────────────────────────────────────
   ATTRIBUTE INLINE RENAME
───────────────────────────────────────────────────────────────────────── */

function _dbAttrInlineRename(cardId, attrId, labelEl) {
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var attr = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  if (!attr) return;

  var origKey  = attr.attr_key;
  var origText = labelEl.textContent.trim();

  // Swap label button → editable input, same visual footprint
  var inp = document.createElement('input');
  inp.type  = 'text';
  inp.value = origKey;
  inp.style.cssText =
    'font-size:0.75rem;font-weight:600;color:inherit;background:transparent;'
    + 'border:none;border-bottom:1px solid #0053e2;outline:none;width:7rem;'
    + 'padding:0;margin:0;';
  labelEl.style.display = 'none';
  labelEl.parentNode.insertBefore(inp, labelEl);
  inp.focus();
  inp.select();

  function commit() {
    var newKey = inp.value.trim();
    inp.remove();
    labelEl.style.display = '';
    if (!newKey || newKey === origKey) return;
    // Rename across all cards — values preserved
    fetch('/workspaces/' + _dbWsId + '/db/attrs/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_key:      origKey,
        new_key:      newKey,
        attr_type:    attr.attr_type    || 'text',
        attr_options: attr.attr_options || '',
      }),
    })
    .then(function(r) { if (!r.ok) throw new Error('Rename failed'); return r.json(); })
    .then(function(data) {
      _dbCards = data.cards;
      _dbRenderGrid();
      _dbOpenDetail(cardId);
    })
    .catch(function(e) { _dbToast('Rename failed: ' + e.message, true); });
  }

  inp.addEventListener('blur',    commit);
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') {
      inp.removeEventListener('blur', commit);
      inp.remove();
      labelEl.style.display = '';
    }
  });
}

/* ─────────────────────────────────────────────────────────────────────────
   ATTRIBUTE VISIBILITY PATCH
───────────────────────────────────────────────────────────────────────── */

function _dbAttrSetVisibility(cardId, attrId, visibility) {
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var attr = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  if (!attr) return;

  var prevVisibility = attr.visibility || 'always';
  attr.visibility = visibility; // optimistic local update

  // Full re-render so toggle button + data-attr-hidden reflect new state
  _dbRenderDetailPanel(card);

  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs/' + attrId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility: visibility }),
  })
  .then(function(r) { if (!r.ok) throw new Error('Patch failed'); })
  .catch(function(e) {
    // Revert local state and re-render again on failure
    attr.visibility = prevVisibility;
    _dbRenderDetailPanel(card);
    _dbToast('Could not update visibility', true);
  });
}

/* ─────────────────────────────────────────────────────────────────────────
   ATTRIBUTE DUPLICATE
───────────────────────────────────────────────────────────────────────── */

function _dbAttrDuplicate(cardId, attrId) {
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  var attr = card && card.attrs ? card.attrs.find(function(a) { return a.id === attrId; }) : null;
  if (!attr) return;

  var newKey = attr.attr_key + ' (copy)';
  _dbSaveAttrByKey(cardId, newKey, attr.attr_value || '',
                   attr.attr_type || 'text', attr.attr_options || '');
}

/* ═══════════════════════════════════════════════════════════════════════════
   ATTRIBUTE DRAG-AND-DROP REORDER
═══════════════════════════════════════════════════════════════════════════ */

var _dbAttrHiddenShown = false; // tracks whether always_hide rows are revealed

var _dbDragAttrRow     = null;  // row element being dragged
var _dbDragAttrCardId  = null;  // card it belongs to
var _dbDragOverRow     = null;  // row currently dragged over
var _dbDragOverPos     = null;  // 'before' | 'after'

function _dbAttrGripDown(e, rowEl) {
  // Arm this row for drag only while the mouse is held down.
  // On mouseup (or dragend) we disarm it again.
  rowEl.setAttribute('draggable', 'true');
  function disarm() {
    rowEl.setAttribute('draggable', 'false');
    document.removeEventListener('mouseup', disarm);
  }
  document.addEventListener('mouseup', disarm);
}

function _dbAttachAttrDrag(cardId) {
  var rows = document.querySelectorAll('.db-attr-row[data-card-id="' + cardId + '"]');
  if (!rows.length) return;

  rows.forEach(function(row) {
    row.addEventListener('dragstart', function(e) {
      _dbDragAttrRow    = row;
      _dbDragAttrCardId = cardId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.getAttribute('data-attr-id'));
      row.style.opacity = '0.4';
    });

    row.addEventListener('dragend', function() {
      row.style.opacity = '';
      _dbAttrClearDropIndicator();
      // Persist the new order
      if (_dbDragAttrCardId) {
        var finalRows = document.querySelectorAll(
          '.db-attr-row[data-card-id="' + _dbDragAttrCardId + '"]'
        );
        var ids = [];
        finalRows.forEach(function(r) { ids.push(parseInt(r.getAttribute('data-attr-id'), 10)); });
        _dbAttrSaveOrder(_dbDragAttrCardId, ids);
      }
      _dbDragAttrRow    = null;
      _dbDragAttrCardId = null;
    });

    row.addEventListener('dragover', function(e) {
      if (!_dbDragAttrRow || _dbDragAttrRow === row) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var rect = row.getBoundingClientRect();
      var mid  = rect.top + rect.height / 2;
      var pos  = e.clientY < mid ? 'before' : 'after';
      if (_dbDragOverRow !== row || _dbDragOverPos !== pos) {
        _dbDragOverRow = row;
        _dbDragOverPos = pos;
        _dbAttrClearDropIndicator();
        row.style.borderTop    = pos === 'before' ? '2px solid #0053e2' : '';
        row.style.borderBottom = pos === 'after'  ? '2px solid #0053e2' : '';
      }
    });

    row.addEventListener('dragleave', function() {
      if (_dbDragOverRow === row) {
        _dbAttrClearDropIndicator();
        _dbDragOverRow = null;
        _dbDragOverPos = null;
      }
    });

    row.addEventListener('drop', function(e) {
      e.preventDefault();
      if (!_dbDragAttrRow || _dbDragAttrRow === row) return;
      _dbAttrClearDropIndicator();
      var parent = row.parentNode;
      if (_dbDragOverPos === 'before') {
        parent.insertBefore(_dbDragAttrRow, row);
      } else {
        parent.insertBefore(_dbDragAttrRow, row.nextSibling);
      }
      _dbDragOverRow = null;
      _dbDragOverPos = null;
    });
  });
}

function _dbAttrClearDropIndicator() {
  document.querySelectorAll('.db-attr-row').forEach(function(r) {
    r.style.borderTop    = '';
    r.style.borderBottom = '';
  });
}

// ── Attr-row touch drag-to-reorder (mobile) ──────────────────────────────────
// HTML5 drag API never fires on touch.  The grips start at opacity:0
// (inline style) and only appear on mouseenter — also dead on touch.

function _dbAttachAttrDragTouch(cardId) {
  var grips = document.querySelectorAll(
    '.db-attr-row[data-card-id="' + cardId + '"] .db-attr-grip'
  );
  if (!grips.length) return;

  // Force grips visible on touch devices, overriding the inline opacity:0.
  // setProperty with 'important' beats inline styles without !important.
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    grips.forEach(function(g) { g.style.setProperty('opacity', '1', 'important'); });
  }

  var _touchRow    = null;  // row being dragged
  var _touchOverRow = null; // drop-target row
  var _touchPos    = null;  // 'before' | 'after'
  var _startX      = 0;
  var _startY      = 0;
  var _active      = false;
  var THRESHOLD    = 8;     // px before drag commits

  function _finish() {
    if (_touchRow) _touchRow.style.opacity = '';
    _dbAttrClearDropIndicator();
    if (_active && _touchOverRow && _touchRow && _touchOverRow !== _touchRow) {
      var parent = _touchOverRow.parentNode;
      if (_touchPos === 'before') {
        parent.insertBefore(_touchRow, _touchOverRow);
      } else {
        parent.insertBefore(_touchRow, _touchOverRow.nextSibling);
      }
      var rows = document.querySelectorAll('.db-attr-row[data-card-id="' + cardId + '"]');
      var ids  = [];
      rows.forEach(function(r) { ids.push(parseInt(r.getAttribute('data-attr-id'), 10)); });
      _dbAttrSaveOrder(cardId, ids);
    }
    _touchRow = _touchOverRow = _touchPos = null;
    _active   = false;
  }

  grips.forEach(function(grip) {
    grip.addEventListener('touchstart', function(e) {
      var row = e.currentTarget.closest('.db-attr-row');
      if (!row) return;
      var t    = e.touches[0];
      _startX  = t.clientX;
      _startY  = t.clientY;
      _touchRow = row;
      _active   = false;
      _dbDragAttrCardId = cardId;
    }, { passive: true });

    grip.addEventListener('touchmove', function(e) {
      if (!_touchRow) return;
      var t = e.touches[0];
      if (!_active) {
        if (Math.hypot(t.clientX - _startX, t.clientY - _startY) < THRESHOLD) return;
        _active = true;
        _touchRow.style.opacity = '0.4';
      }
      e.preventDefault();   // stop page scroll while dragging
      // Find which row is under the finger
      _touchRow.style.display = 'none';  // hide source row so elementFromPoint skips it
      var el = document.elementFromPoint(t.clientX, t.clientY);
      _touchRow.style.display = '';
      var targetRow = el && el.closest('.db-attr-row[data-card-id="' + cardId + '"]');
      if (targetRow && targetRow !== _touchRow) {
        var rect = targetRow.getBoundingClientRect();
        var pos  = t.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        if (targetRow !== _touchOverRow || pos !== _touchPos) {
          _dbAttrClearDropIndicator();
          targetRow.style.borderTop    = pos === 'before' ? '2px solid #0053e2' : '';
          targetRow.style.borderBottom = pos === 'after'  ? '2px solid #0053e2' : '';
          _touchOverRow = targetRow;
          _touchPos     = pos;
        }
      } else if (!targetRow) {
        _dbAttrClearDropIndicator();
        _touchOverRow = null;
        _touchPos     = null;
      }
    }, { passive: false });

    grip.addEventListener('touchend',    _finish, { passive: true });
    grip.addEventListener('touchcancel', _finish, { passive: true });
  });
}

function _dbAttrSaveOrder(cardId, attrIds) {
  // Update local _dbCards so subsequent detail-panel opens reflect the new order
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  if (card && card.attrs) {
    var reordered = [];
    attrIds.forEach(function(id) {
      var a = card.attrs.find(function(x) { return x.id === id; });
      if (a) reordered.push(a);
    });
    // Preserve any attrs not in the list (shouldn't happen, but safety net)
    card.attrs.forEach(function(a) {
      if (attrIds.indexOf(a.id) === -1) reordered.push(a);
    });
    card.attrs = reordered;
  }
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attr_ids: attrIds }),
  })
  .catch(function(e) { console.warn('Attr reorder failed', e); });
}


function _dbToggleHiddenAttrs(cardId, n) {
  _dbAttrHiddenShown = !_dbAttrHiddenShown;
  var show = _dbAttrHiddenShown; // true = attrs are now visible (grayed)

  // Flip every always_hide row for this card
  var rows = document.querySelectorAll(
    '.db-attr-row[data-card-id="' + cardId + '"][data-attr-hidden="1"]'
  );
  rows.forEach(function(r) {
    r.style.display = show ? 'flex' : 'none';
  });

  // Swap button label + icon.
  // show=true  (now visible)  → label "Hide",  icon = eye-off (next click hides)
  // show=false (now hidden)   → label "Show",  icon = eye     (next click shows)
  var btn = document.getElementById('db-attr-hidden-toggle-' + cardId);
  if (!btn) return;

  var label = (show ? 'Hide' : 'Show') + ' (' + n + ') Hidden Attribute' + (n === 1 ? '' : 's');

  var iconPath = show
    // eye-off: attrs are visible, clicking will hide them
    ? 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7'
      + 'a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878'
      + 'l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0'
      + 'A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7'
      + 'a10.025 10.025 0 01-4.132 5.411m0 0L21 21'
    // eye: attrs are hidden, clicking will show them
    : 'M15 12a3 3 0 11-6 0 3 3 0 016 0zm-9.446.568C6.638 9.768 9.178 8 12 8'
      + 'c2.822 0 5.362 1.768 6.446 4.568a.5.5 0 010 .864C17.362 16.232 14.822 18'
      + ' 12 18c-2.822 0-5.362-1.768-6.446-4.568a.5.5 0 010-.864z';

  btn.innerHTML =
    '<svg style="width:0.75rem;height:0.75rem;flex-shrink:0;" fill="none" viewBox="0 0 24 24"'
    + ' stroke="currentColor" stroke-width="2">'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="' + iconPath + '"/></svg>'
    + label;
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
  // Guard at the very top — protects BOTH the input keydown listener and any
  // future document-level listeners from stacking across multiple calls.
  if (_dbModalsWired) return;
  _dbModalsWired = true;

  // Close add-card modal on Enter key in the title input.
  var inp = document.getElementById('db-new-card-title');
  if (inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); _dbSubmitAddCard(); }
    });
  }
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

/* ═══════════════════════════════════════════════════════════════════════════
   CARD MULTI-SELECT
   Long-press (500 ms) any grid card → enters multiselect mode.
   In multiselect mode clicks toggle selection; toolbar shows count + Delete.
   Exit via Cancel button or Escape key.
═══════════════════════════════════════════════════════════════════════════ */

var _dbMsToolbar    = null;
var _dbMsLongTimer  = null;
var _dbMsStartX     = 0;
var _dbMsStartY     = 0;
var _dbMsGridWired  = false;   // prevent duplicate listeners after re-render

/* ── Enter multiselect, optionally pre-selecting one card ────────────────── */
function _dbMsEnter(firstCardId) {
  _dbMsActive   = true;
  _dbMsSelected = {};
  var grid = document.getElementById('db-card-grid');
  if (grid) grid.classList.add('db-ms');
  if (firstCardId != null) _dbMsToggleCard(String(firstCardId), true);
  _dbMsShowToolbar();
  // Escape to exit
  document.addEventListener('keydown', _dbMsEscKey);
}

/* ── Exit multiselect cleanly ─────────────────────────────────────────────── */
function _dbMsExit() {
  _dbMsActive   = false;
  _dbMsSelected = {};
  var grid = document.getElementById('db-card-grid');
  if (grid) {
    grid.classList.remove('db-ms');
    grid.querySelectorAll('.db-card.db-ms-sel').forEach(function(el) {
      el.classList.remove('db-ms-sel');
    });
  }
  if (_dbMsToolbar) { _dbMsToolbar.remove(); _dbMsToolbar = null; }
  document.removeEventListener('keydown', _dbMsEscKey);
}

function _dbMsEscKey(e) {
  if (e.key === 'Escape') _dbMsExit();
}

/* ── Toggle a single card selected/deselected ─────────────────────────────── */
function _dbMsToggleCard(cardId, forceOn) {
  var el = document.querySelector('#db-card-grid [data-card-id="' + cardId + '"]');
  var isOn = forceOn !== undefined ? forceOn : !_dbMsSelected[cardId];
  if (isOn) {
    _dbMsSelected[cardId] = true;
    if (el) el.classList.add('db-ms-sel');
  } else {
    delete _dbMsSelected[cardId];
    if (el) el.classList.remove('db-ms-sel');
  }
  _dbMsUpdateToolbar();
}

/* ── Floating bottom toolbar ──────────══════════════════════════════════════ */
function _dbMsShowToolbar() {
  if (_dbMsToolbar) return;
  var dark = document.documentElement.classList.contains('dark');
  var bar  = document.createElement('div');
  bar.id   = 'db-ms-toolbar';
  Object.assign(bar.style, {
    position:      'fixed',
    bottom:        '24px',
    left:          '50%',
    transform:     'translateX(-50%)',
    zIndex:        '9999',
    display:       'flex',
    alignItems:    'center',
    gap:           '10px',
    padding:       '10px 18px',
    borderRadius:  '999px',
    background:    dark ? '#18181b' : '#ffffff',
    border:        '1px solid ' + (dark ? '#3f3f46' : '#e5e7eb'),
    boxShadow:     '0 8px 32px rgba(0,0,0,.22)',
    fontSize:      '14px',
    fontWeight:    '500',
    color:         dark ? '#f4f4f5' : '#111827',
    whiteSpace:    'nowrap',
  });

  var countEl = document.createElement('span');
  countEl.id  = 'db-ms-count';
  countEl.textContent = '0 selected';

  var sep = document.createElement('div');
  Object.assign(sep.style, { width: '1px', height: '20px', background: dark ? '#3f3f46' : '#e5e7eb' });

  var delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.textContent = '🗑️ Delete selected';
  Object.assign(delBtn.style, {
    padding: '5px 14px', borderRadius: '999px', border: 'none',
    background: '#ea1100', color: '#fff', fontWeight: '600',
    fontSize: '13px', cursor: 'pointer',
  });
  delBtn.addEventListener('click', _dbMsDeleteSelected);

  var cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, {
    padding: '5px 14px', borderRadius: '999px', border: '1px solid ' + (dark ? '#52525b' : '#d1d5db'),
    background: 'transparent', color: dark ? '#a1a1aa' : '#6b7280',
    fontSize: '13px', cursor: 'pointer',
  });
  cancelBtn.addEventListener('click', _dbMsExit);

  bar.appendChild(countEl);
  bar.appendChild(sep);
  bar.appendChild(delBtn);
  bar.appendChild(cancelBtn);
  document.body.appendChild(bar);
  _dbMsToolbar = bar;
  _dbMsUpdateToolbar();
}

function _dbMsUpdateToolbar() {
  var n = Object.keys(_dbMsSelected).length;
  var countEl = document.getElementById('db-ms-count');
  if (countEl) countEl.textContent = n + (n === 1 ? ' card selected' : ' cards selected');
}

/* ── Delete all selected cards ─────────────────────────────────────────────── */
function _dbMsDeleteSelected() {
  var ids = Object.keys(_dbMsSelected).map(Number);
  if (!ids.length) { _dbMsExit(); return; }
  var n = ids.length;
  if (!confirm('Delete ' + n + (n === 1 ? ' card' : ' cards') + '? This cannot be undone.')) return;

  // Fire all deletes in parallel, remove from local list, re-render
  Promise.all(ids.map(function(id) {
    return fetch('/workspaces/' + _dbWsId + '/db/cards/' + id, { method: 'DELETE' })
      .then(function(r) { if (!r.ok) throw new Error(id); });
  })).then(function() {
    _dbCards = _dbCards.filter(function(c) { return !_dbMsSelected[String(c.id)]; });
    _dbMsExit();
    _dbRenderGrid();
    _dbMsWireGrid();  // re-attach listeners after re-render
    _dbToast('Deleted ' + n + (n === 1 ? ' card.' : ' cards.'), false);
  }).catch(function(e) {
    _dbToast('Some cards could not be deleted: ' + e.message, true);
    _dbMsExit();
    _dbRenderGrid();
    _dbMsWireGrid();
  });
}

/* ── Wire long-press + click delegation on the card grid ─────────────────── */
function _dbMsWireGrid() {
  var grid = document.getElementById('db-card-grid');
  if (!grid || grid._dbMsWired) return;
  grid._dbMsWired = true;

  // ── Long-press detection ─────────────────────────────────────────────
  grid.addEventListener('pointerdown', function(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;  // left only for mouse
    var card = e.target.closest('.db-card');
    if (!card) return;
    _dbMsStartX = e.clientX;
    _dbMsStartY = e.clientY;
    _dbMsLongTimer = setTimeout(function() {
      _dbMsLongTimer = null;
      var id = card.dataset.cardId;
      if (!_dbMsActive) {
        _dbMsEnter(id);
      } else {
        _dbMsToggleCard(id);
      }
    }, 500);
  });

  function _cancelLong() {
    if (_dbMsLongTimer) { clearTimeout(_dbMsLongTimer); _dbMsLongTimer = null; }
  }
  grid.addEventListener('pointermove', function(e) {
    if (!_dbMsLongTimer) return;
    var dx = e.clientX - _dbMsStartX;
    var dy = e.clientY - _dbMsStartY;
    if (dx * dx + dy * dy > 64) _cancelLong();  // > 8px
  });
  grid.addEventListener('pointerup',     _cancelLong);
  grid.addEventListener('pointercancel', _cancelLong);

  // ── Click: toggle selection in MS mode, else normal behaviour ─────────
  grid.addEventListener('click', function(e) {
    if (!_dbMsActive) return;
    var card = e.target.closest('.db-card');
    if (!card) return;
    e.stopPropagation();
    _dbMsToggleCard(card.dataset.cardId);
  }, true);  // capture so we beat the open-detail button's own handler
}
