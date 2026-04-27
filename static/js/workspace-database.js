/* workspace-database.js
 * Client-side logic for workspace Database nodes (Notion-inspired card grid).
 * Rules: ALL var — no let/const. All public funcs prefixed db, private _db.
 * Booted by initDatabaseView() called from index.html htmx:afterSettle.
 */

/* ── module state ─────────────────────────────────────────────────────────── */
var _dbWsId       = null;   // current database workspace id (int)
var _dbCards      = [];     // array of card objects from server
var _dbSaveTimers = {};     // {cardId: timeoutId} — per-card note debounce
var _dbDetailId   = null;   // card id currently open in detail panel
var _dbDelTarget  = null;   // card id staged for deletion

/* ── slash command palette state ─────────────────────────────────────────── */
var _dbSlashEl    = null;   // active contenteditable element
var _dbSlashPal   = null;   // palette DOM element (created once)
var _dbSlashIdx   = 0;      // keyboard selection index
var _dbSlashCmds  = [
  { cmd: 'heading1',  label: 'Heading 1',  tag: 'H1'          },
  { cmd: 'heading2',  label: 'Heading 2',  tag: 'H2'          },
  { cmd: 'heading3',  label: 'Heading 3',  tag: 'H3'          },
  { cmd: 'bullet',    label: 'Bullet List', tag: 'UL'         },
  { cmd: 'numbered',  label: 'Numbered List', tag: 'OL'       },
  { cmd: 'quote',     label: 'Quote',       tag: 'BLOCKQUOTE' },
  { cmd: 'divider',   label: 'Divider',     tag: 'HR'         },
  { cmd: 'bold',      label: 'Bold',        tag: 'STRONG'     },
  { cmd: 'italic',    label: 'Italic',      tag: 'EM'         },
  { cmd: 'code',      label: 'Code',        tag: 'CODE'       },
];

/* ═══════════════════════════════════════════════════════════════════════════
   ENTRY POINT
═══════════════════════════════════════════════════════════════════════════ */

function initDatabaseView(wsId) {
  _dbWsId = wsId;
  var raw = document.getElementById('db-cards-data');
  _dbCards = raw ? JSON.parse(raw.textContent || '[]') : [];
  _dbRenderGrid();
  _dbBindModals();
  _dbBuildSlashPalette();
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
   SLASH COMMANDS + AUTO-CONVERSION
═══════════════════════════════════════════════════════════════════════════ */

function _dbBuildSlashPalette() {
  if (_dbSlashPal) return;
  var pal = document.createElement('div');
  pal.id = 'db-slash-palette';
  pal.className = 'hidden fixed z-[200] w-52 bg-white dark:bg-zinc-900 border border-gray-200'
    + ' dark:border-zinc-700 rounded-xl shadow-xl py-1 overflow-hidden';
  pal.setAttribute('role', 'listbox');
  pal.setAttribute('aria-label', 'Insert block');
  pal.innerHTML = _dbSlashCmds.map(function(c, i) {
    return '<div class="db-slash-item px-3 py-1.5 text-sm cursor-pointer text-gray-700'
      + ' dark:text-zinc-300 hover:bg-purple-50 dark:hover:bg-purple-900/30"'
      + ' role="option" data-idx="' + i + '" onclick="_dbApplySlashCmd(\'' + c.cmd + '\')">'
      + c.label + '</div>';
  }).join('');
  document.body.appendChild(pal);
  _dbSlashPal = pal;
}

function _dbSlashKeydown(e, el, cardId) {
  // Auto-convert on Space
  if (e.key === ' ' || e.code === 'Space') {
    _dbAutoConvert(el);
  }

  // Slash palette navigation
  if (_dbSlashPal && !_dbSlashPal.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _dbSlashIdx = Math.min(_dbSlashIdx + 1, _dbSlashCmds.length - 1);
      _dbSlashHighlight();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      _dbSlashIdx = Math.max(_dbSlashIdx - 1, 0);
      _dbSlashHighlight();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      _dbApplySlashCmd(_dbSlashCmds[_dbSlashIdx].cmd);
      return;
    }
    if (e.key === 'Escape') {
      _dbHideSlashPalette();
      return;
    }
  }

  // Show palette on '/' in empty block
  if (e.key === '/') {
    // Short delay so '/' is in the DOM before checking
    setTimeout(function() {
      var sel   = window.getSelection();
      var range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!range) return;
      var text = range.startContainer.textContent || '';
      if (text.trim() === '/') {
        _dbSlashEl  = el;
        _dbSlashIdx = 0;
        _dbShowSlashPalette(el);
      }
    }, 10);
  } else if (_dbSlashPal && !_dbSlashPal.classList.contains('hidden')) {
    // Hide palette on most other keys
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') {
      _dbHideSlashPalette();
    }
  }
}

function _dbShowSlashPalette(el) {
  if (!_dbSlashPal) return;
  var rect = el.getBoundingClientRect();
  _dbSlashPal.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  _dbSlashPal.style.left = (rect.left + window.scrollX) + 'px';
  _dbSlashPal.classList.remove('hidden');
  _dbSlashHighlight();
}

function _dbHideSlashPalette() {
  if (_dbSlashPal) _dbSlashPal.classList.add('hidden');
  _dbSlashEl = null;
}

function _dbSlashHighlight() {
  if (!_dbSlashPal) return;
  var items = _dbSlashPal.querySelectorAll('.db-slash-item');
  items.forEach(function(item, i) {
    if (i === _dbSlashIdx) {
      item.classList.add('bg-purple-50', 'dark:bg-purple-900/30');
    } else {
      item.classList.remove('bg-purple-50', 'dark:bg-purple-900/30');
    }
  });
}

function _dbApplySlashCmd(cmd) {
  _dbHideSlashPalette();
  if (!_dbSlashEl) return;
  // Clear the '/' that triggered the palette
  var sel = window.getSelection();
  if (sel && sel.rangeCount) {
    var range = sel.getRangeAt(0);
    // Try to clear the current block's text
    var node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent = '';
    }
  }
  var html = '';
  var tagMap = {
    heading1:  '<h1>&#8203;</h1>',
    heading2:  '<h2>&#8203;</h2>',
    heading3:  '<h3>&#8203;</h3>',
    bullet:    '<ul><li>&#8203;</li></ul>',
    numbered:  '<ol><li>&#8203;</li></ol>',
    quote:     '<blockquote>&#8203;</blockquote>',
    divider:   '<hr/>',
    bold:      '<strong>&#8203;</strong>',
    italic:    '<em>&#8203;</em>',
    code:      '<code>&#8203;</code>',
  };
  html = tagMap[cmd] || '';
  if (html) document.execCommand('insertHTML', false, html);
}

function _dbAutoConvert(el) {
  var sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  var range = sel.getRangeAt(0);
  var node  = range.startContainer;
  if (!node) return;
  var text  = (node.textContent || '').trimEnd();

  var conversions = [
    { pattern: /^#+$/, fn: function(t) {
      var level = t.length;
      document.execCommand('insertHTML', false, '<h' + level + '>&#8203;</h' + level + '>');
    }},
    { pattern: /^-$/, fn: function() {
      document.execCommand('insertHTML', false, '<ul><li>&#8203;</li></ul>');
    }},
    { pattern: /^\d+\.$/, fn: function() {
      document.execCommand('insertHTML', false, '<ol><li>&#8203;</li></ol>');
    }},
    { pattern: /^>$/, fn: function() {
      document.execCommand('insertHTML', false, '<blockquote>&#8203;</blockquote>');
    }},
    { pattern: /^---$/, fn: function() {
      document.execCommand('insertHTML', false, '<hr/>');
    }},
  ];

  for (var i = 0; i < conversions.length; i++) {
    if (conversions[i].pattern.test(text)) {
      // Clear the trigger text
      if (node.nodeType === Node.TEXT_NODE) node.textContent = '';
      conversions[i].fn(text);
      break;
    }
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
  })
  .catch(function(e) { _dbToast('Could not open card: ' + e.message, true); });
}

function _dbCloseDetail() {
  _dbDetailId = null;
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
      + '<button type="button" onclick="_dbChangeCover(' + card.id + ')"'
      + ' style="position:absolute;top:0.75rem;right:0.75rem;background:rgba(0,0,0,0.45);"'
      + ' class="px-2 py-1 rounded text-xs text-white hover:opacity-90 transition">Change cover</button></div>';
  } else {
    coverHtml = '<div style="margin:-1.5rem -1.5rem 1rem -1.5rem;"'
      + ' class="flex items-center justify-between px-4 py-5'
      + ' bg-gradient-to-r from-purple-500 to-purple-700">'
      + '<span class="text-white font-bold text-base truncate">' + _esc(card.title) + '</span>'
      + '<button type="button" onclick="_dbChangeCover(' + card.id + ')"'
      + ' class="px-2 py-1 rounded text-xs text-white hover:opacity-90 transition"'
      + ' style="background:rgba(255,255,255,0.2);">Add cover</button></div>';
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
    + '<div id="db-detail-note-' + card.id + '" contenteditable="true"'
    + ' class="min-h-[200px] outline-none text-sm text-gray-800 dark:text-zinc-100"'
    + ' oninput="_dbDetailNoteInput(' + card.id + ',this)"'
    + ' onblur="_dbDetailNoteBlur(' + card.id + ',this)"'
    + ' onkeydown="_dbSlashKeydown(event,this,' + card.id + ')"'
    + ' aria-label="Card notes">'
    + (card.note_content || '<p style="color:#d1d5db;font-style:italic;">Start writing…</p>')
    + '</div>'
  );
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

function _dbChangeCover(cardId) {
  var url = prompt('Enter image URL for cover (leave blank to remove):');
  if (url === null) return; // cancelled
  url = url.trim();
  var card = _dbCards.find(function(c) { return c.id === cardId; });
  if (card) card.cover_url = url;
  fetch('/workspaces/' + _dbWsId + '/db/cards/' + cardId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cover_url: url }),
  })
  .then(function() {
    _dbRenderGrid();
    if (_dbDetailId === cardId) _dbOpenDetail(cardId);
  })
  .catch(function(e) { _dbToast('Could not update cover: ' + e.message, true); });
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

function _dbBindModals() {
  // Close add-card modal on Enter key in the title input
  var inp = document.getElementById('db-new-card-title');
  if (inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); _dbSubmitAddCard(); }
    });
  }
  // Hide slash palette on outside click
  document.addEventListener('click', function(e) {
    if (_dbSlashPal && !_dbSlashPal.classList.contains('hidden')) {
      if (!_dbSlashPal.contains(e.target)) _dbHideSlashPalette();
    }
  });
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
