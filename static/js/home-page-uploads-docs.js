/* home-page-uploads-docs.js — Document Studio for the Uploads Homespace page.
   Loaded after home-page-uploads.js + home-page-uploads-tags.js (load order matters).
   Sign functions are in home-page-uploads-sign.js (loaded after this file).
   Shared globals from main file: _uplPid, _uplFiles, _uplMeta, _uplFilter, _uplTagFilter,
     _uplEsc, _uplJsStr, _uplShowToast, _uplFetch, _uplMimeGroup, _uplFmtSize.
*/
'use strict';

// ── Module state ─────────────────────────────────────────────────────────────
var _uplDocSelectMode  = false;   // multi-select active?
var _uplDocSelected    = {};      // key "src:id" → {src,id,mime_type,original_name}
var _uplDocBusy        = false;   // prevents double-submit
var _uplDocCurrentFile = null;    // f passed to _uplDocStudioInit — needed by edit/sign
var _uplDocEditMode    = false;   // textarea edit active?

// Convert-modal state
var _uplConvertPending = null;    // {src, id}
var _uplConvertSel     = '';      // currently selected format ('pdf'|'txt'|'docx')

// Viewer state (fullscreen modal)
var _uplViewerCurrentFile = null;  // file object open in the viewer
var _uplViewerEditMode    = null;  // 'docx' | 'text' | null
var _uplViewerDocxHtml    = null;  // cached docx HTML for restore on cancel
var _uplViewerRawText     = null;  // cached raw text for TXT edit/restore
var _uplWordZoom          = 1.0;   // current paper zoom (0.4 — 2.5)
// Initial class on #upl-viewer-html — restored on close / cancel
var _UPL_HTMLEL_CLASS = 'flex-1 w-full rounded-xl overflow-y-auto ' +
  'bg-white dark:bg-zinc-900 text-sm text-gray-800 dark:text-zinc-100 p-6 bw-doc-viewer';

var _DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ── Hook: called by _uplRenderDetail (main) after detail panel HTML is written ─

var _UPL_TEXT_EXTS = new Set([
  'txt','md','markdown','py','js','mjs','cjs','ts','tsx','jsx',
  'css','scss','less','html','htm','xml','json','yaml','yml',
  'sh','bash','zsh','ini','toml','r','sql','log','go','rs','rb',
  'php','java','c','cpp','h','cs','kt','swift','ps1',
]);
function _uplIsTextExt(f) {
  var ext = ((f && f.original_name) || '').split('.').pop().toLowerCase();
  return _UPL_TEXT_EXTS.has(ext);
}

var _STUDIO_BTN = 'px-3 py-1.5 text-[11px] rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2] transition focus:outline-none focus:ring-1 focus:ring-[#0053e2]';
var _STUDIO_BTN_DANGER = 'px-3 py-1.5 text-[11px] rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition focus:outline-none focus:ring-1 focus:ring-red-400';

async function _uplDocStudioInit(f) {
  _uplDocCurrentFile = f;
  _uplDocEditMode    = false;
  var el = document.getElementById('upl-doc-studio');
  if (!el) return;

  var canRead    = f.mime_type.startsWith('text/') || f.mime_type === 'application/json' || f.mime_type === _DOCX_MIME;
  var canView    = canRead || f.mime_type === 'application/pdf' || f.mime_type.startsWith('image/');
  var canEdit    = f.src === 'page' && (
    f.mime_type.startsWith('text/') ||
    f.mime_type === 'application/json' ||
    (f.mime_type === 'application/octet-stream' && _uplIsTextExt(f))
  );
  var canEditDocx = f.src === 'page' && f.mime_type === _DOCX_MIME;
  var canSign     = f.src === 'page' && f.mime_type === 'application/pdf';
  var canAnnotate = f.src === 'page' && f.mime_type === 'application/pdf'
    && typeof _uplAnnotOpen === 'function';
  var canToPdf   = f.src === 'page' && (f.mime_type.startsWith('text/') || f.mime_type === _DOCX_MIME);
  var canToTxt   = f.src === 'page' && (f.mime_type === 'application/pdf' || f.mime_type === _DOCX_MIME);
  var canToDocx  = f.src === 'page' && (
    f.mime_type === 'application/pdf' ||
    f.mime_type.startsWith('text/') ||
    (f.mime_type === 'application/octet-stream' && _uplIsTextExt(f))
  );
  // canWopi: Collabora is configured + file type is on the WOPI-eligible list
  var canWopi    = f.src === 'page'
    && (typeof _WOPI_MIMES !== 'undefined') && _WOPI_MIMES.indexOf(f.mime_type) !== -1
    && (typeof _uplWopiEnabled === 'function') && _uplWopiEnabled();
  // canSpreadsheet: pure-JS XLSX/CSV editor (no server needed)
  var _XLSXM_SS  = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var canSpreadsheet = f.src === 'page'
    && (f.mime_type === _XLSXM_SS || f.mime_type === 'text/csv')
    && typeof _uplSsOpen === 'function';

  if (!canView && !canRead && !canSign) { el.innerHTML = ''; return; }

  var srcF   = _uplJsStr(f.src);
  var idF    = f.id;
  var noteRO = f.src === 'note'
    ? '<p class="text-[10px] text-yellow-600 dark:text-yellow-400 italic mb-2">Note attachments are read-only on this page.</p>'
    : '';

  var btns = [];
  var hasBackup = f.has_backup || false;
  if (canSign) {
    try {
      var sr = await fetch('/home/uploads/' + _uplPid + '/files/page/' + f.id + '/sign');
      if (sr.ok) { var sd = await sr.json(); hasBackup = sd.has_backup; f.has_backup = sd.has_backup; }
    } catch(_) {}
  }
  if (canView)    btns.push('<button onclick="_uplFileViewerOpen(_uplDocCurrentFile)" class="' + _STUDIO_BTN + '">📄 View</button>');
  if (canEdit)    btns.push('<button onclick="_uplTxtEditorOpen(_uplDocCurrentFile)" class="' + _STUDIO_BTN + '">✏️ Edit</button>');
  if (canEditDocx) btns.push('<button onclick="_uplWordEditorOpen(_uplDocCurrentFile)" class="' + _STUDIO_BTN + '">✏️ Edit DOCX</button>');
  if (canWopi)        btns.push('<button onclick="_uplWopiOpen(_uplDocCurrentFile)" class="' + _STUDIO_BTN + '">🖊️ Edit in Collabora</button>');
  if (canSpreadsheet) btns.push('<button onclick="_uplSsOpen(_uplDocCurrentFile)" class="' + _STUDIO_BTN + '">📊 Edit Spreadsheet</button>');
  if (canSign)    btns.push('<button onclick="_uplDocOpenSignModal(_uplDocCurrentFile)" class="' + _STUDIO_BTN + '">&#9997;&#65039; Sign PDF</button>');
  if (canAnnotate) btns.push('<button onclick="_uplAnnotOpen(_uplDocCurrentFile)" class="' + _STUDIO_BTN + '">&#128221; Annotate PDF</button>');
  var convertFmts = [];
  if (canToPdf)  convertFmts.push('pdf');
  if (canToTxt)  convertFmts.push('txt');
  if (canToDocx) convertFmts.push('docx');
  if (convertFmts.length > 0) {
    btns.push('<button onclick="_uplOpenConvertModal()" class="' + _STUDIO_BTN + '">&#x21C4; Convert</button>');
  }
  if (canSign && hasBackup) btns.push('<button onclick="_uplDocRemoveStamp(_uplDocCurrentFile)" class="' + _STUDIO_BTN_DANGER + '">✕ Remove Stamp</button>');

  el.innerHTML = `<div class="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-700/60">
    <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Document Studio</p>
    ${noteRO}
    <div id="upl-doc-studio-body">
      <div class="flex flex-wrap gap-1.5">${btns.join('')}</div>
    </div>
  </div>`;
}

// ── Hook: called by _uplRender (main) after grid is rebuilt ──────────────────

function _uplDocAfterRender() {
  _uplDocInjectSelectBtn();
  // If check mode is active (either from Select button or hold-to-select),
  // refresh the checkbox overlays so newly rendered cards get them too.
  if (typeof _uplCheckMode !== 'undefined' && _uplCheckMode) {
    if (typeof _uplCheckInjectBoxes === 'function') _uplCheckInjectBoxes();
  }
}

function _uplDocInjectSelectBtn() {
  var bar = document.getElementById('uploads-filter-tabs');
  if (!bar || bar.querySelector('#upl-doc-select-btn')) return;
  var hasDocs = _uplFiles.some(function(f) {
    return f.src === 'page' && (
      f.mime_type === 'application/pdf' ||
      f.mime_type.startsWith('text/') ||
      f.mime_type === _DOCX_MIME ||
      (f.mime_type === 'application/octet-stream' && _uplIsTextExt(f))
    );
  });
  if (!hasDocs) return;
  var btn = document.createElement('button');
  btn.id = 'upl-doc-select-btn';
  btn.className = 'ml-auto px-2.5 py-1 text-[11px] rounded-lg border border-gray-300 dark:border-zinc-600 '
    + 'text-gray-600 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2] transition';
  btn.innerHTML = _uplDocSelectMode
    ? '\u2612<span class="upl-rsp-label"> Done</span>'
    : '\u2610<span class="upl-rsp-label"> Select</span>';
  btn.onclick = _uplDocToggleSelectMode;
  bar.appendChild(btn);
}

function _uplDocInjectCheckboxes() {
  document.querySelectorAll('[data-upl-id][data-upl-src="page"]').forEach(function(card) {
    if (card.querySelector('.upl-doc-cb')) return;
    var src = card.dataset.uplSrc;
    var id  = parseInt(card.dataset.uplId, 10);
    var key = src + ':' + id;
    var cb  = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'upl-doc-cb absolute top-2 left-2 w-4 h-4 accent-[#0053e2] cursor-pointer z-10';
    cb.checked = !!_uplDocSelected[key];
    cb.addEventListener('click', function(e) { e.stopPropagation(); });
    cb.onchange = function() { _uplDocToggleItem(src, id); };
    card.style.position = 'relative';
    card.prepend(cb);
    _uplDocUpdateCardRing(card, !!_uplDocSelected[key]);
  });
}

// ── Multi-select ──────────────────────────────────────────────────────────────

function _uplDocToggleSelectMode() {
  // Delegate entirely to the unified check-mode system (defined in home-page-uploads-dnd.js)
  // so the toolbar Select button and click-and-hold both share the same badge bar.
  if (typeof _uplCheckMode !== 'undefined' && _uplCheckMode) {
    _dndSelClear();   // also calls _uplCheckModeExit() internally
  } else {
    if (typeof _uplCheckModeEnter === 'function') _uplCheckModeEnter();
  }
  // Keep the old doc-select mode flag in sync for any legacy code that still reads it
  _uplDocSelectMode = typeof _uplCheckMode !== 'undefined' ? _uplCheckMode : false;
}

// ── Tag panel for docs multi-select toolbar ───────────────────────────────────
// Standalone panel: reads from _uplDocSelected (not _dndSelected) so it stays
// fully independent from the lasso-DND selection on the main grid.
function _uplDocTagPanel() {
  // Toggle: second click closes
  var existing = document.getElementById('upl-doc-tag-panel');
  if (existing) { existing.remove(); return; }

  var sel      = Object.values(_uplDocSelected);
  var count    = sel.length;

  // Gather union of regular tags AND grid connection tags separately
  var unionTags = new Set();
  var gridPids  = new Set();  // numeric page IDs connected to >=1 selected file
  sel.forEach(function(item) {
    var f = (_uplFiles || []).find(function(x) { return x.src === item.src && x.id === item.id; });
    if (!f || !Array.isArray(f.tags)) return;
    f.tags.forEach(function(t) {
      if (t.startsWith('grid:')) {
        var pid = parseInt(t.split(':')[1], 10);
        if (!isNaN(pid)) gridPids.add(pid);
      } else {
        unionTags.add(t);
      }
    });
  });
  unionTags = Array.from(unionTags).sort();

  var availOpts = (_uplAllTags || []).filter(function(t) { return !unionTags.includes(t) && !t.startsWith('grid:'); })
                                     .map(function(t) { return '<option value="' + _uplEsc(t) + '">'; }).join('');

  var pillsHtml = unionTags.length
    ? unionTags.map(function(t) {
        return '<button onclick="_uplDocTagRemove(\'' + _uplJsStr(t) + '\')"'
          + ' title="Remove from selected files"'
          + ' class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full cursor-pointer'
          + ' bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300'
          + ' hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-700 transition">'
          + _uplEsc(t) + ' &times;</button>';
      }).join('')
    : '<span class="text-[10px] text-gray-400 dark:text-zinc-500">No tags on selected files yet</span>';

  // Grid connections block (async resolves names after mount)
  var gridBlock = '';
  if (gridPids.size) {
    var gridPillsHtml = Array.from(gridPids).map(function(pid) {
      var openFn = 'typeof openHomePage===\'function\'?openHomePage(' + pid + '):window.location.assign(\'/home/pages/' + pid + '\')'
      return '<span id="upl-doc-tag-grid-' + pid + '"'
        + ' class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full'
        + ' bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300">'
        + '&#128248; Grid #' + pid
        + '<button onclick="' + openFn + '" title="Open grid page"'
        + ' class="underline hover:text-green-600 transition">&nearr;</button>'
        + '</span>';
    }).join('');
    gridBlock = '<p class="text-[10px] uppercase tracking-wide text-green-600 dark:text-green-400 mt-3 mb-1">Grid connections (&nearr; opens page)</p>'
      + '<div class="flex flex-wrap gap-1">' + gridPillsHtml + '</div>';
  }

  var panel = document.createElement('div');
  panel.id  = 'upl-doc-tag-panel';
  panel.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-80 '
    + 'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 '
    + 'rounded-2xl shadow-2xl p-4 select-none';
  panel.innerHTML =
    '<div class="flex items-center justify-between mb-3">'
    + '<span class="text-sm font-semibold text-gray-800 dark:text-zinc-100">'
    + '&#127991;&#65039; Tags &mdash; ' + count + ' file' + (count === 1 ? '' : 's') + '</span>'
    + '<button onclick="document.getElementById(\'upl-doc-tag-panel\').remove()"'
    + ' class="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 transition text-lg leading-none">&times;</button>'
    + '</div>'
    + '<p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-zinc-500 mb-1">Current tags (click to remove)</p>'
    + '<div class="flex flex-wrap gap-1 mb-1">' + pillsHtml + '</div>'
    + gridBlock
    + '<p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-zinc-500 mt-3 mb-1">Add tag to all</p>'
    + '<div class="flex gap-1">'
    + '<input id="upl-doc-tag-input" list="upl-doc-tag-opts"'
    + ' placeholder="Type or choose tag\u2026"'
    + ' class="flex-1 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5'
    + ' text-xs bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    + ' focus:outline-none focus:ring-1 focus:ring-[#0053e2]"'
    + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();_uplDocTagAdd()}" />'
    + '<datalist id="upl-doc-tag-opts">' + availOpts + '</datalist>'
    + '<button onclick="_uplDocTagAdd()"'
    + ' class="px-3 py-1.5 text-xs rounded-lg bg-[#0053e2] text-white hover:bg-[#003eb3] transition font-medium">+ Add</button>'
    + '</div>';

  document.body.appendChild(panel);
  var inp = document.getElementById('upl-doc-tag-input');
  if (inp) inp.focus();

  // Async: resolve grid page names and replace placeholder badges
  if (gridPids.size) {
    Array.from(gridPids).forEach(async function(pid) {
      try {
        var r = await fetch('/home/pages/' + pid + '/meta');
        if (!r.ok) return;
        var m = await r.json();
        var badge = document.getElementById('upl-doc-tag-grid-' + pid);
        if (badge) badge.innerHTML = '&#128248;\u00a0' + _uplEsc((m.emoji || '') + '\u00a0' + (m.name || ('Grid #' + pid)));
      } catch(_) { /* keep placeholder */ }
    });
  }
}

async function _uplDocTagAdd() {
  var inp = document.getElementById('upl-doc-tag-input');
  var tag = inp ? inp.value.trim() : '';
  if (!tag) return;
  var ids = Object.values(_uplDocSelected).map(function(x) { return x.id; });
  try {
    await Promise.all(ids.map(function(id) {
      return fetch('/home/uploads/' + _uplPid + '/files/page/' + id + '/tags', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({tag: tag}),
      });
    }));
    _uplShowToast('Tag "' + _uplEsc(tag) + '" added to ' + ids.length + ' file' + (ids.length === 1 ? '' : 's') + '.');
    if (inp) inp.value = '';
    if (typeof _uplFetch === 'function') await _uplFetch(_uplPage);
    if (typeof _uplFetchTags === 'function') await _uplFetchTags();
    // Reopen the panel so the new tag appears
    var p = document.getElementById('upl-doc-tag-panel');
    if (p) p.remove();
    _uplDocTagPanel();
  } catch(e) { _uplShowToast('Failed to add tag.'); }
}

async function _uplDocTagRemove(tag) {
  var ids = Object.values(_uplDocSelected).map(function(x) { return x.id; });
  try {
    await Promise.all(ids.map(function(id) {
      return fetch('/home/uploads/' + _uplPid + '/files/page/' + id + '/tags/' + encodeURIComponent(tag), {
        method: 'DELETE',
      });
    }));
    _uplShowToast('Tag "' + _uplEsc(tag) + '" removed from selected files.');
    if (typeof _uplFetch === 'function') await _uplFetch(_uplPage);
    if (typeof _uplFetchTags === 'function') await _uplFetchTags();
    var p = document.getElementById('upl-doc-tag-panel');
    if (p) p.remove();
    _uplDocTagPanel();
  } catch(e) { _uplShowToast('Failed to remove tag.'); }
}

function _uplDocUpdateCardRing(card, selected) {
  if (!card) return;
  if (selected) {
    card.style.outline      = '2px solid #0053e2';
    card.style.outlineOffset = '0px';
  } else {
    card.style.outline      = '';
    card.style.outlineOffset = '';
  }
}

function _uplDocToggleItem(src, id) {
  var key = src + ':' + id;
  var f   = _uplFiles.find(function(x) { return x.src === src && x.id === id; });
  if (!f) return;
  if (_uplDocSelected[key]) {
    delete _uplDocSelected[key];
  } else {
    _uplDocSelected[key] = { src: f.src, id: f.id, mime_type: f.mime_type, original_name: f.original_name };
  }
  // Sync checkbox + ring on the card
  var card = document.querySelector('[data-upl-id="'+id+'"][data-upl-src="'+src+'"]');
  var selected = !!_uplDocSelected[key];
  if (card) {
    var cb = card.querySelector('.upl-doc-cb');
    if (cb) cb.checked = selected;
    _uplDocUpdateCardRing(card, selected);
  }
  _uplDocRenderToolbar();
}

function _uplDocRenderToolbar() {
  var main = document.getElementById('uploads-main');
  if (!main) return;
  var existing = document.getElementById('upl-doc-toolbar');
  if (existing) existing.remove();

  var sel   = Object.values(_uplDocSelected);
  var count = sel.length;
  if (!count) return;

  var allPdf  = count >= 2 && sel.every(function(x) { return x.mime_type === 'application/pdf'; });
  var allDocx = count >= 2 && sel.every(function(x) { return x.mime_type === _DOCX_MIME; });
  var allText = count >= 2 && sel.every(function(x) {
    return x.mime_type.startsWith('text/') ||
           x.mime_type === 'application/json' ||
           (x.mime_type === 'application/octet-stream' && _uplIsTextExt(x));
  });
  var btnCls  = 'px-3 py-1.5 text-[11px] rounded-lg transition font-medium ';
  var onCls   = btnCls + 'bg-[#0053e2] text-white hover:bg-[#003eb3]';
  var tagCls  = btnCls + 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                       + ' border border-yellow-300 dark:border-yellow-700 hover:bg-yellow-100';

  // Only show merge/join buttons when ALL selected files are the matching type.
  // Grayed-out disabled buttons are confusing when you selected images — just hide them.
  var mergeBtns = '';
  if (allPdf)  mergeBtns += `<button onclick="_uplDocOpenCombineModal('pdf')"  class="${onCls}">Merge PDFs</button>`;
  if (allDocx) mergeBtns += `<button onclick="_uplDocOpenCombineModal('docx')" class="${onCls}">Merge DOCX</button>`;
  if (allText) mergeBtns += `<button onclick="_uplDocOpenCombineModal('text')" class="${onCls}">Join Text</button>`;

  var tb = document.createElement('div');
  tb.id = 'upl-doc-toolbar';
  tb.className = 'sticky bottom-0 mt-4 p-3 rounded-xl bg-white dark:bg-zinc-900 '
    + 'border border-gray-200 dark:border-zinc-700 shadow-lg flex items-center gap-2 flex-wrap';
  tb.innerHTML = `<span class="text-[11px] text-gray-600 dark:text-zinc-300 font-medium mr-1">
      \uD83D\uDCC4 ${count} file${count > 1 ? 's' : ''} selected</span>
    ${mergeBtns}
    <button onclick="_uplDocTagPanel()" class="${tagCls}">\uD83C\uDFF7\uFE0F Tags</button>
    <button onclick="_uplDocToggleSelectMode()"
      class="${btnCls} border border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400
             hover:text-[#ea1100] hover:border-[#ea1100]">\u2715 Clear</button>`;
  main.appendChild(tb);
}

// ── Text edit ─────────────────────────────────────────────────────────────────

async function _uplDocEnterEditMode(f) {
  var body = document.getElementById('upl-doc-studio-body');
  if (!body) return;
  body.innerHTML = '<p class="text-[10px] text-gray-400 italic">Loading\u2026</p>';
  var text = '';
  try {
    var r    = await fetch(`/home/uploads/${_uplPid}/files/${_uplEsc(f.src)}/${f.id}/content`);
    var data = await r.json();
    text = data.content_type === 'text' ? data.content : '';
  } catch(e) { /* start blank if fetch fails */ }

  _uplDocEditMode = true;
  body.innerHTML = `<textarea id="upl-doc-textarea"
    class="w-full h-56 text-[11px] font-mono border border-gray-200 dark:border-zinc-700
           rounded-xl p-3 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
           focus:outline-none focus:ring-2 focus:ring-[#0053e2] resize-y"
    spellcheck="false"></textarea>
    <div class="flex gap-2 mt-2">
      <button onclick="_uplDocSaveEdit(_uplDocCurrentFile)"
        class="px-3 py-1.5 text-[11px] rounded-lg bg-[#0053e2] text-white font-semibold
               hover:bg-[#003eb3] transition">Save</button>
      <button onclick="_uplDocCancelEdit()"
        class="px-3 py-1.5 text-[11px] rounded-lg border border-gray-300 dark:border-zinc-600
               text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">
        Cancel</button>
    </div>`;
  var ta = document.getElementById('upl-doc-textarea');
  if (ta) { ta.value = text; ta.focus(); }
}

async function _uplDocSaveEdit(f) {
  if (_uplDocBusy) return;
  var ta = document.getElementById('upl-doc-textarea');
  if (!ta) return;
  _uplDocBusy = true;
  try {
    var r = await fetch(`/home/uploads/${_uplPid}/files/page/${f.id}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ta.value }),
    });
    if (!r.ok) { var err = await r.json(); throw new Error(err.detail || r.status); }
    var data = await r.json();
    // Update cached size on the file object
    var cached = _uplFiles.find(function(x) { return x.src === f.src && x.id === f.id; });
    if (cached) cached.size = data.size;
    _uplDocCurrentFile.size = data.size;
    _uplShowToast('File saved \u2713');
    _uplDocCancelEdit();
  } catch(e) {
    _uplShowToast('Save failed: ' + _uplEsc(String(e)));
  } finally { _uplDocBusy = false; }
}

function _uplDocCancelEdit() {
  _uplDocEditMode = false;
  _uplDocStudioInit(_uplDocCurrentFile);
}

// ── Convert modal ───────────────────────────────────────────────────────────

var _FMT_LABELS = { pdf: 'PDF', txt: 'TXT', docx: 'DOCX' };

function _uplOpenConvertModal() {
  var f = _uplDocCurrentFile;
  if (!f) return;

  // Recompute available formats from the current file's mime type
  var mt = f.mime_type || '';
  var fmts = [];
  if (mt.startsWith('text/') || mt === _DOCX_MIME)            fmts.push('pdf');
  if (mt === 'application/pdf' || mt === _DOCX_MIME)           fmts.push('txt');
  if (mt === 'application/pdf' || mt.startsWith('text/') ||
      (mt === 'application/octet-stream' && _uplIsTextExt(f))) fmts.push('docx');
  if (!fmts.length) return;

  _uplConvertPending = { src: f.src, id: f.id };
  _uplConvertSel = '';

  var nameEl = document.getElementById('upl-convert-filename');
  if (nameEl) nameEl.textContent = f.original_name || '';

  var wrap = document.getElementById('upl-convert-formats');
  if (wrap) {
    wrap.innerHTML = fmts.map(function(fmt) {
      return '<button type="button" data-fmt="' + fmt + '"'
        + ' onclick="_uplSelectConvertFmt(this,\'' + fmt + '\')"'
        + ' class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600'
        + ' text-gray-700 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2]'
        + ' transition focus:outline-none focus:ring-2 focus:ring-[#0053e2]">'
        + _FMT_LABELS[fmt]
        + '</button>';
    }).join('');
  }

  var confirmBtn = document.getElementById('upl-convert-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = true;

  var modal = document.getElementById('upl-convert-modal');
  if (modal) {
    modal.classList.remove('hidden');
    setTimeout(function() {
      var first = modal.querySelector('[data-fmt]');
      if (first) first.focus();
    }, 50);
  }
}

function _uplSelectConvertFmt(btn, fmt) {
  _uplConvertSel = fmt;
  // Highlight selected pill, reset others
  var wrap = document.getElementById('upl-convert-formats');
  if (wrap) {
    wrap.querySelectorAll('[data-fmt]').forEach(function(b) {
      var sel = b === btn;
      b.className = 'px-4 py-2 text-sm rounded-lg border transition focus:outline-none focus:ring-2 '
        + (sel
          ? 'border-[#0053e2] bg-blue-50 dark:bg-blue-900/20 text-[#0053e2] font-semibold focus:ring-[#0053e2]'
          : 'border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2] focus:ring-[#0053e2]');
    });
  }
  var confirmBtn = document.getElementById('upl-convert-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = false;
}

function _uplCancelConvert() {
  document.getElementById('upl-convert-modal')?.classList.add('hidden');
  _uplConvertPending = null;
  _uplConvertSel = '';
}

function _uplDoConvert() {
  if (!_uplConvertPending || !_uplConvertSel) return;
  var p = _uplConvertPending;
  _uplCancelConvert();
  _uplDocConvert(p.src, p.id, _uplConvertSel);
}

// ── Convert (execute) ─────────────────────────────────────────────────────────

async function _uplDocConvert(src, id, toFmt) {
  if (_uplDocBusy) return;
  _uplDocBusy = true;
  var body = document.getElementById('upl-doc-studio-body');
  if (body) body.innerHTML = '<p class="text-[10px] text-gray-400 italic">Converting\u2026</p>';
  try {
    var r = await fetch(`/home/uploads/${_uplPid}/files/page/${id}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_format: toFmt }),
    });
    if (!r.ok) {
      var detail = r.status + '';
      try { var errJson = await r.json(); detail = errJson.detail || detail; } catch(_) {}
      throw new Error(detail);
    }
    var data = await r.json();
    _uplShowToast(`Converted \u2192 ${_uplEsc(data.file.original_name)}`);
    await _uplFetch(_uplMeta.page || 1);
  } catch(e) {
    _uplShowToast('Conversion failed: ' + _uplEsc(String(e)));
    if (_uplDocCurrentFile) _uplDocStudioInit(_uplDocCurrentFile);
  } finally { _uplDocBusy = false; }
}

// ── Combine (multi-select workflow) ──────────────────────────────────────────

function _uplDocOpenCombineModal(combineType) {
  // Use the unified _dndSelected state (works for both click-hold and Select button).
  var sel = Object.values(typeof _dndSelected !== 'undefined' ? _dndSelected : {})
                  .filter(function(x) { return x.src === 'page'; });
  if (sel.length < 2) { _uplShowToast('Select at least 2 files to combine'); return; }
  var label = combineType === 'pdf' ? 'PDF merge' : combineType === 'docx' ? 'DOCX merge' : 'text join';
  var desc  = document.getElementById('upl-combine-desc');
  if (desc) desc.textContent = `${label} of ${sel.length} files`;
  var inp   = document.getElementById('upl-combine-name');
  if (inp) { inp.value = ''; inp.placeholder = 'combined'; }
  var modal = document.getElementById('upl-combine-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.dataset.combineType = combineType;
    if (inp) setTimeout(function() { inp.focus(); }, 50);
  }
}

async function _uplDocDoCombine() {
  if (_uplDocBusy) return;
  var modal = document.getElementById('upl-combine-modal');
  var type  = modal ? modal.dataset.combineType : 'pdf';
  var name  = (document.getElementById('upl-combine-name') || {}).value || '';
  // Read IDs from unified _dndSelected (page-src files only).
  var ids = Object.values(typeof _dndSelected !== 'undefined' ? _dndSelected : {})
                  .filter(function(x) { return x.src === 'page'; })
                  .map(function(x) { return x.id; });
  if (ids.length < 2) return;
  _uplDocBusy = true;
  var btn = document.getElementById('upl-combine-confirm-btn');
  if (btn) btn.disabled = true;
  try {
    var r = await fetch(`/home/uploads/${_uplPid}/files/page/combine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids, output_name: name.trim(), combine_type: type }),
    });
    if (!r.ok) { var err = await r.json(); throw new Error(err.detail || r.status); }
    var data = await r.json();
    _uplDocCloseCombineModal();
    _dndSelClear();             // exit check-mode + clear selection
    await _uplFetch(_uplMeta.page || 1);
    _uplShowToast(`Combined \u2192 ${_uplEsc(data.file.original_name)}`);
  } catch(e) {
    _uplShowToast('Combine failed: ' + _uplEsc(String(e)));
  } finally {
    _uplDocBusy = false;
    if (btn) btn.disabled = false;
  }
}

function _uplDocCloseCombineModal() {
  var modal = document.getElementById('upl-combine-modal');
  if (modal) modal.classList.add('hidden');
}

// ── Universal file viewer ────────────────────────────────────────────────────────────────

// PDF viewer cleanup function — set when _uplAnnotPdfViewer is active, called on close.
var _uplViewerPdfCleanup = null;

async function _uplFileViewerOpen(f) {
  var modal    = document.getElementById('upl-file-viewer-modal');
  var embedEl  = document.getElementById('upl-viewer-embed');
  var htmlEl   = document.getElementById('upl-viewer-html');
  var titleEl  = document.getElementById('upl-viewer-title');
  if (!modal) return;

  _uplViewerCurrentFile = f;

  if (titleEl) titleEl.textContent = f.original_name || 'File Viewer';
  modal.classList.remove('hidden');
  modal.focus();

  var fUrl = '/uploads/' + _uplEsc(f.filename)
    + (_uplCacheBust[f.id] ? '?v=' + _uplCacheBust[f.id] : '');
  var mt   = f.mime_type || '';

  if (mt === 'application/pdf') {
    // G12: Never use <embed> for PDFs — use PDF.js canvas via annot module.
    // This (a) renders fresh each time (no cached rotation state from browser)
    // and (b) draws annotation overlays so they’re visible in View mode.
    if (embedEl) { embedEl.src = ''; embedEl.classList.add('hidden'); }
    if (htmlEl)  {
      htmlEl.style.cssText = 'padding:0;overflow:hidden;';
      htmlEl.classList.remove('hidden');
      if (typeof _uplAnnotPdfViewer === 'function') {
        _uplViewerPdfCleanup = _uplAnnotPdfViewer(f, htmlEl, _uplPid);
      } else {
        // Annot module not loaded — fall back to embed
        htmlEl.classList.add('hidden');
        if (embedEl) { embedEl.src = fUrl + '#navpanes=0'; embedEl.classList.remove('hidden'); }
      }
    }
    return;
  }

  if (mt.startsWith('image/')) {
    if (embedEl) { embedEl.src = ''; embedEl.classList.add('hidden'); }
    if (htmlEl)  {
      htmlEl.innerHTML = '<div class="flex items-center justify-center h-full min-h-0">' +
        '<img src="' + _uplEsc(fUrl) + '" alt="' + _uplEsc(f.original_name) + '"' +
        '     class="max-w-full max-h-full object-contain rounded-lg shadow-lg">' +
        '</div>';
      htmlEl.classList.remove('hidden');
    }
    return;
  }

  // DOCX / text / CSV — fetch from /content endpoint
  if (embedEl) { embedEl.src = ''; embedEl.classList.add('hidden'); }
  if (htmlEl)  {
    htmlEl.innerHTML = '<p class="text-gray-400 dark:text-zinc-500 text-xs text-center mt-8">…</p>';
    htmlEl.classList.remove('hidden');
  }
  try {
    var r    = await fetch('/home/uploads/' + _uplPid + '/files/' + _uplEsc(f.src) + '/' + f.id + '/content');
    var ct   = r.headers.get('content-type') || '';
    if (ct.includes('text/html')) throw new Error('Session expired — please refresh.');
    if (!r.ok) { var e = await r.json(); throw new Error(e.detail || r.status); }
    var data = await r.json();

    var isTextEditable = (data.content_type === 'text') && (f.src === 'page');
    var isDocxEditable = (data.content_type === 'docx_html') && (f.src === 'page');

    if (htmlEl) {
      if (data.content_type === 'docx_html') {
        _uplViewerDocxSetup(htmlEl, data.content);  // paper canvas for both view + edit
        setTimeout(_uplWZoomFit, 60);               // fit width once DOM has rendered
      } else {
        htmlEl.innerHTML = _uplViewerHtmlForType(data.content, data.content_type);
      }
    }

    if (isTextEditable) {
      _uplViewerRawText = data.content;
      _uplViewerTxtRenderEditBar(htmlEl);  // sticky “Edit” bar at bottom
    } else if (isDocxEditable) {
      _uplViewerDocxHtml = data.content;
      _uplViewerDocxRenderEditBar(htmlEl);  // inject sticky "Edit in Preview" bar
    } else if (f.src === 'note' && (data.content_type === 'text' || data.content_type === 'docx_html')) {
      if (htmlEl) htmlEl.innerHTML += '<p style="font-size:.7rem;color:#9ca3af;margin-top:2rem;padding-top:1rem;border-top:1px solid #f3f4f6">🔒 Note attachments are read-only.</p>';
    }
  } catch(err) {
    if (htmlEl) htmlEl.innerHTML = '<p class="text-red-500 text-xs text-center mt-8">' + _uplEsc(String(err)) + '</p>';
  }
}

function _uplViewerHtmlForType(content, contentType) {
  // Note: docx_html is handled separately via _uplViewerDocxSetup()
  if (contentType === 'csv_html') {
    return '<div style="overflow-x:auto">' + content + '</div>';
  }
  // Plain text / JSON — monospace pre block
  var escaped = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return '<pre style="font-size:.8em;white-space:pre-wrap;word-break:break-word;line-height:1.6">' + escaped + '</pre>';
}

/** Set up the paper-canvas view for a DOCX file (read-only OR as base for editor).
 *  Both the viewer and the editor cancel path run through here so they look identical. */
function _uplViewerDocxSetup(htmlEl, html) {
  htmlEl.className   = 'bw-word-host';
  htmlEl.style.cssText = '';
  htmlEl.innerHTML =
    '<div class="bw-word-scroll" id="bw-word-scroll">' +
      '<div class="bw-word-paper bw-doc-viewer">' + html + '</div>' +
    '</div>';
}

function _uplFileViewerClose() {
  var modal   = document.getElementById('upl-file-viewer-modal');
  var embedEl = document.getElementById('upl-viewer-embed');
  var htmlEl  = document.getElementById('upl-viewer-html');
  if (!modal) return;
  modal.classList.add('hidden');
  if (embedEl) embedEl.src = '';
  // G12: run PDF.js cleanup if a canvas viewer was active
  if (_uplViewerPdfCleanup) { _uplViewerPdfCleanup(); _uplViewerPdfCleanup = null; }
  if (htmlEl) { htmlEl.className = _UPL_HTMLEL_CLASS; htmlEl.style.cssText = ''; htmlEl.innerHTML = ''; }
  _uplViewerCurrentFile = null;
  _uplViewerEditMode    = null;
  _uplViewerDocxHtml    = null;
  _uplViewerRawText     = null;
  _uplWordZoom          = 1.0;
}

// ── DRY helper: render docx preview + inject sticky “Edit in Preview” bar ─────────

function _uplViewerDocxRenderEditBar(htmlEl) {
  if (!htmlEl) return;
  var bar = document.createElement('div');
  bar.dataset.uplRole = 'docx-edit-bar';
  bar.className = 'bw-word-footer';
  var S = 'bw-word-btn';
  bar.innerHTML =
    '<span class="bw-word-footer-label">Word-like editor. ' +
    'Saves directly back to the <strong>.docx</strong> file.</span>' +
    '<button class="'+S+'" onclick="_uplWZoom(-0.1)" title="Zoom out">−</button>' +
    '<span class="bw-wzoom-label bw-word-zoom-label" onclick="_uplWZoomSet(1)" title="Reset zoom">100%</span>' +
    '<button class="'+S+'" onclick="_uplWZoom(0.1)" title="Zoom in">+</button>' +
    '<button class="'+S+'" onclick="_uplWZoomFit()" title="Fit to width">⊡ Fit</button>' +
    '<button type="button" onclick="_uplWordEditorMount()" ' +
    '  style="font-size:.75rem;padding:.35rem .9rem;border-radius:.4rem;' +
    '  background:#0053e2;color:#fff;font-weight:600;cursor:pointer;border:none">' +
    '  ✏️ Edit DOCX</button>';
  htmlEl.appendChild(bar);
}

// ── Paper zoom (shared by viewer + editor) ────────────────────────────────

/** Apply zoom z (0.4–2.5) to the paper and refresh all zoom labels. */
function _uplWZoomSet(z) {
  _uplWordZoom = Math.max(0.4, Math.min(2.5, z));
  var paper = document.getElementById('bw-word-paper');
  if (paper) paper.style.zoom = _uplWordZoom;
  var pct = Math.round(_uplWordZoom * 100) + '%';
  document.querySelectorAll('.bw-wzoom-label').forEach(function(el) {
    el.textContent = pct;
  });
}

/** Change zoom by delta (e.g. –0.1 to zoom out). */
function _uplWZoom(delta) { _uplWZoomSet(_uplWordZoom + delta); }

/** Scale paper so its width fills the visible scroll area. */
function _uplWZoomFit() {
  var scroll = document.getElementById('bw-word-scroll');
  if (!scroll) return;
  var fit = (scroll.clientWidth - 40) / 816;   // 40 = breathing-room margin
  _uplWZoomSet(Math.max(0.4, Math.min(2.5, fit)));
}

// ── Word-like DOCX editor ────────────────────────────────────────
// Called from Doc Studio „✏️ Edit DOCX“ button — opens viewer + immediately
// mounts the editor so the user never sees the read-only interstitial.
async function _uplWordEditorOpen(f) {
  await _uplFileViewerOpen(f);      // load content, build read-only view
  _uplWordEditorMount();            // swap to editor immediately
}

// Mount the Word-like editor inside the existing viewer modal.
// Works whether called from the read-only bar or from Doc Studio directly.
function _uplWordEditorMount() {
  var htmlEl = document.getElementById('upl-viewer-html');
  var f      = _uplViewerCurrentFile;
  if (!htmlEl || !f || !_uplViewerDocxHtml) return;

  // Repurpose the viewer container as a flex column host (shared with read-only view)
  htmlEl.className   = 'bw-word-host';
  htmlEl.style.cssText = '';

  htmlEl.innerHTML =
    // ─ Toolbar (editor only) ─
    '<div id="bw-word-toolbar" class="bw-word-toolbar">' + _uplWordToolbarHtml() + '</div>' +
    // ─ Scrollable paper area ─
    '<div id="bw-word-scroll" class="bw-word-scroll">' +
      '<div id="bw-word-paper" class="bw-word-paper bw-doc-viewer" contenteditable="true" ' +
           'spellcheck="true" aria-label="Document content" role="textbox" aria-multiline="true">' +
        _uplViewerDocxHtml +
      '</div>' +
    '</div>' +
    // ─ Footer bar ─
    '<div class="bw-word-footer">' +
      '<span class="bw-word-footer-label">Saves to the original <strong>.docx</strong>. ' +
        'Images &amp; advanced formatting may simplify on save.</span>' +
      '<button type="button" onclick="_uplViewerDocxCancelEdit()"' +
        ' style="font-size:.75rem;padding:.35rem .85rem;border-radius:.4rem;' +
        'border:1px solid #d1d5db;background:transparent;color:inherit;cursor:pointer">Cancel</button>' +
      '<button id="bw-word-save-btn" type="button" onclick="_uplWordSave()"' +
        ' style="font-size:.75rem;padding:.35rem .9rem;border-radius:.4rem;' +
        'background:#0053e2;color:#fff;font-weight:700;cursor:pointer;border:none">' +
        '💾 Save DOCX</button>' +
    '</div>';

  // Wire toolbar buttons — update active states on every selection change
  var paper = document.getElementById('bw-word-paper');
  if (paper) {
    paper.focus();
    // Tab / Shift+Tab in a <li> → indent / dedent (otherwise Tab escapes to Cancel).
    if (paper._bwTabHandler) paper.removeEventListener('keydown', paper._bwTabHandler);
    paper._bwTabHandler = function(e) { if (typeof window._bwCeTabIndent === 'function') window._bwCeTabIndent(e); };
    paper.addEventListener('keydown', paper._bwTabHandler);
  }
  document.addEventListener('selectionchange', _uplWordUpdateBar);
  _uplViewerEditMode = 'docx';
  // Re-apply zoom so editing starts at same level as view mode (or auto-fit on first open)
  setTimeout(function() { _uplWZoomSet(_uplWordZoom || 1); }, 60);
}

function _uplWordToolbarHtml() {
  var S = 'bw-word-btn'; // class shorthand
  var SEP = '<span class="bw-word-sep"></span>';
  var styleOpts = ['<option value="p">Paragraph</option>',
    '<option value="h1">Heading 1</option>', '<option value="h2">Heading 2</option>',
    '<option value="h3">Heading 3</option>', '<option value="h4">Heading 4</option>'].join('');
  var sizeOpts  = [8,9,10,11,12,14,16,18,20,24,28,36].map(function(n) {
    return '<option value="' + n + '">' + n + '</option>'; }).join('');
  return [
    '<select id="bw-wstyle" class="bw-word-sel" title="Paragraph style"' +
      ' onchange="_uplWStyle(this.value)">' + styleOpts + '</select>',
    '<select id="bw-wsize" class="bw-word-sel bw-wsize" title="Font size"' +
      ' onchange="_uplWFontSize(this.value)"><option value="">pt</option>' + sizeOpts + '</select>',
    SEP,
    '<button class="'+S+'" onclick="_uplWCmd(\'undo\')" title="Undo (Ctrl+Z)">↩</button>',
    '<button class="'+S+'" onclick="_uplWCmd(\'redo\')" title="Redo (Ctrl+Y)">↪</button>',
    SEP,
    '<button class="'+S+'" id="bw-wb" onclick="_uplWCmd(\'bold\')" title="Bold (Ctrl+B)"><b>B</b></button>',
    '<button class="'+S+'" id="bw-wi" onclick="_uplWCmd(\'italic\')" title="Italic (Ctrl+I)"><i>I</i></button>',
    '<button class="'+S+'" id="bw-wu" onclick="_uplWCmd(\'underline\')" title="Underline (Ctrl+U)"><u>U</u></button>',
    '<button class="'+S+'" id="bw-ws" onclick="_uplWCmd(\'strikeThrough\')" title="Strikethrough"><s>S</s></button>',
    SEP,
    '<label class="bw-word-color" title="Text color">A' +
      '<input type="color" value="#000000" oninput="_uplWColor(\'foreColor\',this.value)">' +
    '</label>',
    '<label class="bw-word-color bw-word-hl" title="Highlight">█' +
      '<input type="color" value="#ffff00" oninput="_uplWColor(\'backColor\',this.value)">' +
    '</label>',
    SEP,
    '<button class="'+S+'" onclick="_uplWCmd(\'justifyLeft\')" title="Align left">≡L</button>',
    '<button class="'+S+'" onclick="_uplWCmd(\'justifyCenter\')" title="Center">≡C</button>',
    '<button class="'+S+'" onclick="_uplWCmd(\'justifyRight\')" title="Align right">≡R</button>',
    '<button class="'+S+'" onclick="_uplWCmd(\'justifyFull\')" title="Justify">≡J</button>',
    SEP,
    '<button class="'+S+'" onclick="_uplWCmd(\'insertUnorderedList\')" title="Bullet list">• List</button>',
    '<button class="'+S+'" onclick="_uplWCmd(\'insertOrderedList\')" title="Numbered list">1. List</button>',
    '<button class="'+S+'" onclick="_uplWCmd(\'indent\')" title="Increase indent">→ In</button>',
    '<button class="'+S+'" onclick="_uplWCmd(\'outdent\')" title="Decrease indent">← Out</button>',
    SEP,
    '<button class="'+S+'" onclick="_uplWCmd(\'removeFormat\')" title="Clear formatting">× Clear</button>',
    SEP,
    '<button class="'+S+'" onclick="_uplWZoom(-0.1)" title="Zoom out">−</button>',
    '<span class="bw-wzoom-label bw-word-zoom-label" onclick="_uplWZoomSet(1)" title="Reset zoom">100%</span>',
    '<button class="'+S+'" onclick="_uplWZoom(0.1)" title="Zoom in">+</button>',
    '<button class="'+S+'" onclick="_uplWZoomFit()" title="Fit to width">⊡ Fit</button>',
  ].join('');
}

/** Execute a contenteditable command inside the paper div. */
function _uplWCmd(cmd, val) {
  var paper = document.getElementById('bw-word-paper');
  if (paper) paper.focus();
  document.execCommand(cmd, false, val || null);
  _uplWordUpdateBar();
}

/** Apply a paragraph/heading block style. */
function _uplWStyle(val) {
  _uplWCmd('formatBlock', val === 'p' ? 'p' : val);
}

/** Apply exact pt font size using fontSize + CSS override. */
function _uplWFontSize(pt) {
  if (!pt) return;
  // execCommand fontSize only accepts 1-7; use a span workaround
  document.execCommand('fontSize', false, '7');  // marks selection
  var paper = document.getElementById('bw-word-paper');
  if (!paper) return;
  // Replace all font size=7 elements with proper pt spans
  paper.querySelectorAll('font[size="7"]').forEach(function(el) {
    var span = document.createElement('span');
    span.style.fontSize = pt + 'pt';
    span.innerHTML = el.innerHTML;
    el.parentNode.replaceChild(span, el);
  });
  _uplWordUpdateBar();
}

/** Apply foreground or background colour. */
function _uplWColor(cmd, hex) {
  _uplWCmd(cmd, hex);
}

/** Sync toolbar button active states to current selection. */
function _uplWordUpdateBar() {
  var map = { 'bw-wb': 'bold', 'bw-wi': 'italic', 'bw-wu': 'underline', 'bw-ws': 'strikeThrough' };
  for (var id in map) {
    var el = document.getElementById(id);
    if (!el) continue;
    try {
      if (document.queryCommandState(map[id])) {
        el.style.background = '#dbeafe'; el.style.color = '#0053e2';
      } else {
        el.style.background = ''; el.style.color = '';
      }
    } catch(e) {}
  }
  // Update style dropdown
  try {
    var tag = document.queryCommandValue('formatBlock').toLowerCase().replace(/<|>/g, '');
    var sel = document.getElementById('bw-wstyle');
    if (sel) sel.value = (['h1','h2','h3','h4'].indexOf(tag) !== -1) ? tag : 'p';
  } catch(e) {}
}

/** Cancel edit — restore read-only paper view (same structure as view mode). */
function _uplViewerDocxCancelEdit() {
  document.removeEventListener('selectionchange', _uplWordUpdateBar);
  var htmlEl = document.getElementById('upl-viewer-html');
  if (htmlEl && _uplViewerDocxHtml) {
    _uplViewerDocxSetup(htmlEl, _uplViewerDocxHtml);  // same as initial view
    _uplViewerDocxRenderEditBar(htmlEl);
  }
  _uplViewerEditMode = null;
}

/** Save the editor HTML back to the .docx file on the server. */
async function _uplWordSave() {
  var paper   = document.getElementById('bw-word-paper');
  var saveBtn = document.getElementById('bw-word-save-btn');
  var f       = _uplViewerCurrentFile;
  if (!paper || !f) return;
  var html = paper.innerHTML;
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  try {
    var r = await fetch(
      '/home/uploads/' + _uplPid + '/files/page/' + f.id + '/docx-content',
      { method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: html }) }
    );
    var ct = r.headers.get('content-type') || '';
    if (ct.includes('text/html')) throw new Error('Session expired — please refresh.');
    if (!r.ok) { var e = await r.json(); throw new Error(e.detail || r.status); }
    document.removeEventListener('selectionchange', _uplWordUpdateBar);
    _uplShowToast('Saved to ' + _uplEsc(f.original_name) + ' ✓');
    await _uplFetch(_uplMeta.page || 1);
    _uplFileViewerClose();
  } catch(err) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save DOCX'; }
    _uplShowToast('Save failed: ' + _uplEsc(String(err)));
  }
}

// ── DRY helper: render TXT preview + inject sticky „Edit“ footer ─────────────────

function _uplViewerTxtRenderEditBar(htmlEl) {
  if (!htmlEl) return;
  var bar = document.createElement('div');
  bar.dataset.uplRole = 'txt-edit-bar';
  bar.className = 'bw-word-footer';
  bar.innerHTML =
    '<span class="bw-word-footer-label">Click <strong>Edit</strong> to open the Notepad++ editor.</span>' +
    '<button type="button" onclick="_uplTxtEditorMount()"' +
    '  style="font-size:.75rem;padding:.35rem .9rem;border-radius:.4rem;' +
    '  background:#0053e2;color:#fff;font-weight:600;cursor:pointer;border:none">' +
    '  ✏️ Edit</button>';
  htmlEl.appendChild(bar);
}

// ── Viewer: TXT inline editing (textarea) ────────────────────────────────

// Inline text editor functions removed — replaced by home-page-uploads-txt.js
// (_uplTxtEditorMount, _uplTxtCancelEdit, _uplTxtSave)
