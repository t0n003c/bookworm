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

var _DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ── Hook: called by _uplRenderDetail (main) after detail panel HTML is written ─

var _STUDIO_BTN = 'px-3 py-1.5 text-[11px] rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2] transition focus:outline-none focus:ring-1 focus:ring-[#0053e2]';
var _STUDIO_BTN_DANGER = 'px-3 py-1.5 text-[11px] rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition focus:outline-none focus:ring-1 focus:ring-red-400';

async function _uplDocStudioInit(f) {
  _uplDocCurrentFile = f;
  _uplDocEditMode    = false;
  var el = document.getElementById('upl-doc-studio');
  if (!el) return;

  var canRead    = f.mime_type.startsWith('text/') || f.mime_type === 'application/json' || f.mime_type === _DOCX_MIME;
  var canView    = canRead || f.mime_type === 'application/pdf' || f.mime_type.startsWith('image/');
  var canEdit    = f.src === 'page' && (f.mime_type.startsWith('text/') || f.mime_type === 'application/json');
  var canSign    = f.src === 'page' && f.mime_type === 'application/pdf';
  var canToPdf   = f.src === 'page' && (f.mime_type.startsWith('text/') || f.mime_type === _DOCX_MIME);
  var canToTxt   = f.src === 'page' && (f.mime_type === 'application/pdf' || f.mime_type === _DOCX_MIME);

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
  if (canEdit)    btns.push('<button onclick="_uplDocEnterEditMode(_uplDocCurrentFile)" class="' + _STUDIO_BTN + '">✏️ Edit</button>');
  if (canSign)    btns.push('<button onclick="_uplDocOpenSignModal(_uplDocCurrentFile)" class="' + _STUDIO_BTN + '">✍️ Sign PDF</button>');
  if (canToPdf)   btns.push('<button onclick="_uplDocConvert(\'' + srcF + '\',' + idF + ',\'pdf\')" class="' + _STUDIO_BTN + '">→ PDF</button>');
  if (canToTxt)   btns.push('<button onclick="_uplDocConvert(\'' + srcF + '\',' + idF + ',\'txt\')" class="' + _STUDIO_BTN + '">→ TXT</button>');
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
  if (_uplDocSelectMode) {
    _uplDocInjectCheckboxes();
    _uplDocRenderToolbar();
  }
}

function _uplDocInjectSelectBtn() {
  var bar = document.getElementById('uploads-filter-tabs');
  if (!bar || bar.querySelector('#upl-doc-select-btn')) return;
  var hasDocs = _uplFiles.some(function(f) {
    return f.src === 'page' &&
      (f.mime_type === 'application/pdf' || f.mime_type.startsWith('text/') || f.mime_type === _DOCX_MIME);
  });
  if (!hasDocs) return;
  var btn = document.createElement('button');
  btn.id = 'upl-doc-select-btn';
  btn.className = 'ml-auto px-2.5 py-1 text-[11px] rounded-lg border border-gray-300 dark:border-zinc-600 '
    + 'text-gray-600 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2] transition';
  btn.textContent = _uplDocSelectMode ? '\u2612 Done' : '\u2610 Select';
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
    cb.onchange = function() { _uplDocToggleItem(src, id); };
    card.style.position = 'relative';
    card.prepend(cb);
  });
}

// ── Multi-select ──────────────────────────────────────────────────────────────

function _uplDocToggleSelectMode() {
  _uplDocSelectMode = !_uplDocSelectMode;
  if (!_uplDocSelectMode) {
    _uplDocSelected = {};
    var tb = document.getElementById('upl-doc-toolbar');
    if (tb) tb.remove();
  }
  // re-render just the select state (avoid full fetch)
  _uplDocAfterRender();
  var btn = document.getElementById('upl-doc-select-btn');
  if (btn) btn.textContent = _uplDocSelectMode ? '\u2612 Done' : '\u2610 Select';
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

  var allPdf  = sel.every(function(x) { return x.mime_type === 'application/pdf'; });
  var allText = sel.every(function(x) { return x.mime_type.startsWith('text/'); });
  var btnCls  = 'px-3 py-1.5 text-[11px] rounded-lg transition font-medium ';
  var onCls   = btnCls + 'bg-[#0053e2] text-white hover:bg-[#003eb3]';
  var offCls  = btnCls + 'bg-gray-100 dark:bg-zinc-800 text-gray-400 cursor-not-allowed';

  var tb = document.createElement('div');
  tb.id = 'upl-doc-toolbar';
  tb.className = 'sticky bottom-0 mt-4 p-3 rounded-xl bg-white dark:bg-zinc-900 '
    + 'border border-gray-200 dark:border-zinc-700 shadow-lg flex items-center gap-2 flex-wrap';
  tb.innerHTML = `<span class="text-[11px] text-gray-600 dark:text-zinc-300 font-medium mr-1">
      \uD83D\uDCC4 ${count} file${count > 1 ? 's' : ''} selected</span>
    <button onclick="_uplDocOpenCombineModal('pdf')" ${allPdf ? '' : 'disabled'}
      class="${allPdf ? onCls : offCls}" title="${allPdf ? '' : 'Select only PDFs to merge'}">
      Merge PDFs</button>
    <button onclick="_uplDocOpenCombineModal('text')" ${allText ? '' : 'disabled'}
      class="${allText ? onCls : offCls}" title="${allText ? '' : 'Select only text files to join'}">
      Join Text</button>
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

// ── Convert ───────────────────────────────────────────────────────────────────

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
    if (!r.ok) { var err = await r.json(); throw new Error(err.detail || r.status); }
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
  var sel = Object.values(_uplDocSelected);
  if (sel.length < 2) { _uplShowToast('Select at least 2 files to combine'); return; }
  var label = combineType === 'pdf' ? 'PDF merge' : 'text join';
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
  var ids   = Object.values(_uplDocSelected).map(function(x) { return x.id; });
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
    _uplDocToggleSelectMode();   // exit select mode + clear selection
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

async function _uplFileViewerOpen(f) {
  var modal    = document.getElementById('upl-file-viewer-modal');
  var embedEl  = document.getElementById('upl-viewer-embed');
  var htmlEl   = document.getElementById('upl-viewer-html');
  var titleEl  = document.getElementById('upl-viewer-title');
  if (!modal) return;

  if (titleEl) titleEl.textContent = f.original_name || 'File Viewer';
  modal.classList.remove('hidden');
  modal.focus();

  var fUrl = '/uploads/' + _uplEsc(f.filename)
    + (_uplCacheBust[f.id] ? '?v=' + _uplCacheBust[f.id] : '');
  var mt   = f.mime_type || '';

  if (mt === 'application/pdf') {
    // PDF — use embed (browser built-in viewer)
    if (embedEl) { embedEl.src = fUrl + '#navpanes=0'; embedEl.classList.remove('hidden'); }
    if (htmlEl)  htmlEl.classList.add('hidden');
    return;
  }

  if (mt.startsWith('image/')) {
    // Image — show at full res in the content pane
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
    htmlEl.innerHTML = '<p class="text-gray-400 dark:text-zinc-500 text-xs text-center mt-8">Loading…</p>';
    htmlEl.classList.remove('hidden');
  }
  try {
    var r    = await fetch('/home/uploads/' + _uplPid + '/files/' + _uplEsc(f.src) + '/' + f.id + '/content');
    var ct   = r.headers.get('content-type') || '';
    if (ct.includes('text/html')) throw new Error('Session expired — please refresh.');
    if (!r.ok) { var e = await r.json(); throw new Error(e.detail || r.status); }
    var data = await r.json();
    if (htmlEl) htmlEl.innerHTML = _uplViewerHtmlForType(data.content, data.content_type);
  } catch(err) {
    if (htmlEl) htmlEl.innerHTML = '<p class="text-red-500 text-xs text-center mt-8">' + _uplEsc(String(err)) + '</p>';
  }
}

function _uplViewerHtmlForType(content, contentType) {
  if (contentType === 'docx_html') {
    // Already structured HTML from _docx_body_to_html
    return '<div class="bw-doc-viewer">' + content + '</div>';
  }
  if (contentType === 'csv_html') {
    // HTML table from _csv_to_html — wrap with overflow-x for wide tables
    return '<div style="overflow-x:auto">' + content + '</div>';
  }
  // Plain text / JSON — monospace pre block
  var escaped = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return '<pre style="font-size:.8em;white-space:pre-wrap;word-break:break-word;line-height:1.6">' + escaped + '</pre>';
}

function _uplFileViewerClose() {
  var modal   = document.getElementById('upl-file-viewer-modal');
  var embedEl = document.getElementById('upl-viewer-embed');
  if (!modal) return;
  modal.classList.add('hidden');
  if (embedEl) embedEl.src = '';
}
