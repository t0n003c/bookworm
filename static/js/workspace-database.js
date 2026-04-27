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

/* ── selection toolbar state ─────────────────────────────────────────────── */
var _dbSelBar       = null;  // floating toolbar DOM element
var _dbSelBarTimer  = null;  // hide-debounce timer

/* ═══════════════════════════════════════════════════════════════════════════
   ENTRY POINT
═══════════════════════════════════════════════════════════════════════════ */

function initDatabaseView(wsId) {
  _dbWsId = wsId;
  var raw = document.getElementById('db-cards-data');
  _dbCards = raw ? JSON.parse(raw.textContent || '[]') : [];
  _dbRenderGrid();
  _dbBindModals();
  _dbInitStyles();
  _dbSelToolbarInit();
}

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
    + (pills ? '<div class="flex flex-wrap gap-1">' + pills + '</div>' : '')
    + '<div class="text-[10px] text-gray-400 dark:text-zinc-500 tabular-nums">'
    + (updated ? 'Updated ' + updated : '') + '</div>'
    + '</div></div>'
  );
}

function _dbCoverHtml(card) {
  if (card.cover_url) {
    return (
      '<div class="relative h-36 w-full flex-shrink-0 bg-gray-100 dark:bg-zinc-800 cursor-pointer"'
      + ' onclick="_dbOpenDetail(' + card.id + ')">'
      + '<img src="' + _esc(card.cover_url) + '" alt="Cover" loading="lazy"'
      + ' class="w-full h-full object-cover" />'
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
    '<div class="h-20 w-full flex-shrink-0 flex items-center justify-center cursor-pointer'
    + ' bg-gradient-to-br ' + grad + ' opacity-70 dark:opacity-80"'
    + ' onclick="_dbOpenDetail(' + card.id + ')">'
    + '<span class="text-3xl font-bold text-white opacity-50 select-none">'
    + _esc((card.title || 'U')[0].toUpperCase()) + '</span>'
    + '</div>'
  );
}

function _dbAttrPills(attrs) {
  if (!attrs || attrs.length === 0) return '';
  var visible = attrs.slice(0, 3);
  var extra   = attrs.length - 3;
  var html = visible.map(function(a) {
    return (
      '<span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded'
      + ' bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 max-w-[120px]">'
      + '<span class="font-semibold truncate">' + _esc(a.attr_key) + ':</span>'
      + '<span class="truncate">' + _esc(a.attr_value) + '</span>'
      + '</span>'
    );
  }).join('');
  if (extra > 0) {
    html += '<span class="text-[10px] text-gray-400 dark:text-zinc-500 px-1">+' + extra + ' more</span>';
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
    /* code block */
    '[data-db-note] pre{background:#f3f4f6;border-radius:.5rem;padding:.75em 1em;overflow-x:auto;margin:.5em 0;}',
    '.dark [data-db-note] pre{background:#27272a;}',
    '[data-db-note] pre code{font-size:.875em;font-family:ui-monospace,"Cascadia Code",monospace;',
    'background:none;color:inherit;padding:0;}',
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
        return;
      }
      /* Only show inside a [data-db-note] element */
      var anchor = sel.anchorNode;
      var el = anchor && anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
      var insideNote = false;
      while (el) {
        if (el.dataset && el.dataset.dbNote) { insideNote = true; break; }
        el = el.parentElement;
      }
      if (!insideNote) { _dbSelBar.style.display = 'none'; return; }

      /* Apply theme and position */
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

/**
 * Wire the real slash-command palette + paste-as popup to a card note CE.
 * Idempotent — safe to call on every panel re-render.
 */
function _dbAttachNoteTools(noteEl) {
  if (!noteEl) return;
  /* Slash commands — full palette with headings / callouts / columns */
  if (typeof window.bwSlashAttachCE === 'function') window.bwSlashAttachCE(noteEl);
  /* URL paste-as popup */
  if (window.bwPasteAs && typeof window.bwPasteAs.initForCE === 'function') {
    window.bwPasteAs.initForCE(noteEl);
  }
  /* Click on empty space below content — append a new paragraph and focus it */
  if (!noteEl._dbNewLineWired) {
    noteEl._dbNewLineWired = true;
    noteEl.addEventListener('click', function(e) {
      if (e.target !== noteEl) return;  /* clicked a child element — let it be */
      var p = document.createElement('p');
      p.innerHTML = '<br>';
      noteEl.appendChild(p);
      var r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      noteEl.focus({ preventScroll: true });
    });
  }
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

function _dbRenderDetailPanel(card) {
  // Inject into the app’s shared #detail-panel (inside #panel aside).
  // openPanel() is called by the caller after this returns.
  var dp = document.getElementById('detail-panel');
  if (!dp) return;

  // Cover: bleed edge-to-edge past the p-6 padding of #detail-panel
  var coverHtml;
  if (card.cover_url) {
    coverHtml = '<div style="margin:-1.5rem -1.5rem 1rem -1.5rem;"'
      + ' class="relative overflow-hidden bg-gray-100 dark:bg-zinc-800">'
      + '<img src="' + _esc(card.cover_url) + '" alt="Cover"'
      + ' style="width:100%;height:10rem;object-fit:cover;display:block;"/>'
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
    return '<div class="flex items-center gap-2 py-1.5 border-b border-gray-100 dark:border-zinc-800">'
      + '<span class="text-xs font-semibold text-gray-500 dark:text-zinc-400 w-24 flex-shrink-0 truncate">'
      + _esc(a.attr_key) + '</span>'
      + '<div contenteditable="true" class="flex-1 text-sm text-gray-800 dark:text-zinc-100 outline-none"'
      + ' onblur="_dbSaveAttr(' + card.id + ',' + a.id + ',\'' + _esc(a.attr_key) + '\',this)">'
      + _esc(a.attr_value) + '</div>'
      + '<button type="button" onclick="_dbDeleteAttr(' + card.id + ',' + a.id + ')"'
      + ' class="text-gray-300 hover:text-red-400 p-1 rounded transition" title="Remove attribute">'
      + '&times;</button></div>';
  }).join('');

  dp.innerHTML = (
    coverHtml
    // Title + close row
    + '<div class="flex items-start gap-2 mb-1">'
    + '<div contenteditable="true"'
    + ' class="flex-1 text-xl font-bold text-gray-900 dark:text-zinc-100 outline-none leading-snug"'
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
    _dbSaveNote(cardId, el.innerHTML);
  }, 800);
}

function _dbDetailNoteBlur(cardId, el) {
  if (_dbSaveTimers['detail_' + cardId]) {
    clearTimeout(_dbSaveTimers['detail_' + cardId]);
    delete _dbSaveTimers['detail_' + cardId];
  }
  _dbSaveNote(cardId, el.innerHTML);
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
    + '<span style="font-size:0.875rem;">Click to choose an image</span><br>'
    + '<span style="font-size:0.75rem;color:#9ca3af;">JPG, PNG, GIF, WebP • max 20 MB</span>'
    + '<input id="db-cover-file-input" type="file" accept="image/*"'
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
  var key = prompt('Attribute name:');
  if (!key || !key.trim()) return;
  var val = prompt('Value for "' + key.trim() + '":') || '';
  _dbSaveAttrByKey(cardId, key.trim(), val);
}

function _dbSaveAttrByKey(cardId, key, value) {
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attr_key: key, attr_value: value }),
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Attr save failed');
    return r.json();
  })
  .then(function() {
    // Refresh the card from server to get updated attrs
    _dbOpenDetail(cardId);
    fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId)
    .then(function(r2) { return r2.json(); })
    .then(function(card) {
      var idx = _dbCards.findIndex(function(c) { return c.id === cardId; });
      if (idx >= 0) _dbCards[idx] = card;
      _dbRenderGrid();
    });
  })
  .catch(function(e) { _dbToast('Could not save attribute: ' + e.message, true); });
}

function _dbSaveAttr(cardId, attrId, key, el) {
  var value = el.textContent.trim();
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attr_key: key, attr_value: value }),
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Attr save failed');
    // Update local state
    var card = _dbCards.find(function(c) { return c.id === cardId; });
    if (card && card.attrs) {
      var attr = card.attrs.find(function(a) { return a.id === attrId; });
      if (attr) attr.attr_value = value;
    }
    _dbRenderGrid();
  })
  .catch(function(e) { console.warn('Attr save failed', e); });
}

function _dbDeleteAttr(cardId, attrId) {
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId + '/attrs/' + attrId, {
    method: 'DELETE',
  })
  .then(function(r) {
    if (!r.ok) throw new Error('Delete attr failed');
    var card = _dbCards.find(function(c) { return c.id === cardId; });
    if (card && card.attrs) {
      card.attrs = card.attrs.filter(function(a) { return a.id !== attrId; });
    }
    _dbRenderGrid();
    if (_dbDetailId === cardId) _dbOpenDetail(cardId);
  })
  .catch(function(e) { _dbToast('Could not delete attribute: ' + e.message, true); });
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
