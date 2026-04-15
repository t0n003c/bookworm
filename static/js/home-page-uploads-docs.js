/* home-page-uploads-docs.js — Document Studio for the Uploads Homespace page.
   Loaded after home-page-uploads.js + home-page-uploads-tags.js (load order matters).
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

// Sign-modal state
var _uplSigXPct   = 0.65;  // placement x fraction (0-1 from left)
var _uplSigYPct   = 0.80;  // placement y fraction (0-1 from top)
var _uplSigPlaced = false; // has user clicked to place yet?
var _uplSigDrawn  = false; // has user drawn anything on canvas?

var _DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ── Hook: called by _uplRenderDetail (main) after detail panel HTML is written ─

function _uplDocStudioInit(f) {
  _uplDocCurrentFile = f;
  _uplDocEditMode    = false;
  var el = document.getElementById('upl-doc-studio');
  if (!el) return;

  var canRead    = f.mime_type.startsWith('text/') || f.mime_type === 'application/json' || f.mime_type === _DOCX_MIME;
  var canEdit    = f.src === 'page' && (f.mime_type.startsWith('text/') || f.mime_type === 'application/json');
  var canSign    = f.src === 'page' && f.mime_type === 'application/pdf';
  var canToPdf   = f.src === 'page' && (f.mime_type.startsWith('text/') || f.mime_type === _DOCX_MIME);
  var canToTxt   = f.src === 'page' && (f.mime_type === 'application/pdf' || f.mime_type === _DOCX_MIME);

  if (!canRead && !canSign) { el.innerHTML = ''; return; }

  var srcF   = _uplJsStr(f.src);
  var idF    = f.id;
  var noteRO = f.src === 'note'
    ? '<p class="text-[10px] text-yellow-600 dark:text-yellow-400 italic mb-2">Note attachments are read-only on this page.</p>'
    : '';

  var btns = [];
  if (canRead)
    btns.push(`<button onclick="_uplDocShowFullContent(_uplDocCurrentFile)"
      class="px-3 py-1.5 text-[11px] rounded-lg border border-gray-300 dark:border-zinc-600
             text-gray-700 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2]
             transition focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
      \uD83D\uDCC4 View full content</button>`);
  if (canEdit)
    btns.push(`<button onclick="_uplDocEnterEditMode(_uplDocCurrentFile)"
      class="px-3 py-1.5 text-[11px] rounded-lg border border-gray-300 dark:border-zinc-600
             text-gray-700 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2]
             transition focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
      \u270F\uFE0F Edit</button>`);
  if (canSign)
    btns.push(`<button onclick="_uplDocOpenSignModal(_uplDocCurrentFile)"
      class="px-3 py-1.5 text-[11px] rounded-lg border border-gray-300 dark:border-zinc-600
             text-gray-700 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2]
             transition focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
      \u270D\uFE0F Sign PDF</button>`);
  if (canToPdf)
    btns.push(`<button onclick="_uplDocConvert('${srcF}',${idF},'pdf')"
      class="px-3 py-1.5 text-[11px] rounded-lg border border-gray-300 dark:border-zinc-600
             text-gray-700 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2]
             transition focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
      \u2192 PDF</button>`);
  if (canToTxt)
    btns.push(`<button onclick="_uplDocConvert('${srcF}',${idF},'txt')"
      class="px-3 py-1.5 text-[11px] rounded-lg border border-gray-300 dark:border-zinc-600
             text-gray-700 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2]
             transition focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
      \u2192 TXT</button>`);

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

// ── Full content view ─────────────────────────────────────────────────────────

async function _uplDocShowFullContent(f) {
  var body = document.getElementById('upl-doc-studio-body');
  if (!body) return;
  body.innerHTML = '<p class="text-[10px] text-gray-400 italic">Loading\u2026</p>';
  try {
    var r    = await fetch(`/home/uploads/${_uplPid}/files/${_uplEsc(f.src)}/${f.id}/content`);
    if (!r.ok) throw new Error(await r.text());
    var data = await r.json();
    var collapseBtn = `<button onclick="_uplDocStudioInit(_uplDocCurrentFile)"
      class="text-[10px] text-[#0053e2] hover:underline mt-2 block">Collapse \u25B4</button>`;
    if (data.content_type === 'text') {
      var charCount = data.content.length;
      var lines     = (data.content.match(/\n/g) || []).length + 1;
      body.innerHTML = `<p class="text-[9px] text-gray-400 mb-1">${lines} lines \u00B7 ${charCount.toLocaleString()} chars</p>
        <pre class="text-[10px] font-mono text-gray-700 dark:text-zinc-300 whitespace-pre-wrap break-words
                    bg-gray-50 dark:bg-zinc-800 rounded-xl p-3 max-h-72 overflow-y-auto">${_uplEsc(data.content)}</pre>
        ${collapseBtn}`;
    } else {
      body.innerHTML = `<div class="text-xs text-gray-700 dark:text-zinc-200 rounded-xl p-3
                           bg-gray-50 dark:bg-zinc-800 max-h-72 overflow-y-auto">${data.content}</div>
        ${collapseBtn}`;
    }
  } catch(e) {
    body.innerHTML = `<p class="text-[10px] text-red-500">Could not load: ${_uplEsc(String(e))}</p>`;
  }
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

// ── PDF fullscreen preview ────────────────────────────────────────────────────

function _uplPdfPreviewOpen(url, name) {
  var modal = document.getElementById('upl-pdf-popup-modal');
  if (!modal) return;
  var embed = document.getElementById('upl-pdf-popup-embed');
  var title = document.getElementById('upl-pdf-popup-title');
  if (embed) embed.src = url + '#navpanes=0';
  if (title) title.textContent = name || 'PDF Preview';
  modal.classList.remove('hidden');
  modal.focus();
}

function _uplPdfPreviewClose() {
  var modal = document.getElementById('upl-pdf-popup-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  var embed = document.getElementById('upl-pdf-popup-embed');
  if (embed) embed.src = '';
}

// ── Sign (PDF, page-src only) — tdraw then place ─────────────────────
function _uplDocOpenSignModal(f) {
  _uplDocCurrentFile = f;
  _uplSigPlaced = false;
  _uplSigDrawn  = false;
  _uplSigXPct   = 0.65;
  _uplSigYPct   = 0.80;
  var modal = document.getElementById('upl-sig-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.focus();  // allow Escape keydown to fire
  _uplDocShowSignStep1(f);
}

function _uplDocShowSignStep1(f) {
  var body = document.getElementById('upl-sig-modal-body');
  if (!body) return;
  var pageNum = (document.getElementById('upl-sig-page-num-val') || {}).value || '0';
  body.innerHTML = `
    <p class="text-xs text-gray-500 dark:text-zinc-400 mb-3">
      Draw your signature below, then click <strong>Next</strong> to place it on the PDF.
    </p>
    <canvas id="upl-sig-canvas" width="480" height="160"
            class="w-full rounded-xl border-2 border-dashed border-gray-300 dark:border-zinc-600
                   bg-white cursor-crosshair touch-none block"
            aria-label="Signature drawing area" role="img"></canvas>
    <div class="flex items-center gap-3 mt-3 mb-1">
      <label class="text-xs text-gray-600 dark:text-zinc-400 flex-shrink-0" for="upl-sig-page-num">
        Page (0 = first):
      </label>
      <input id="upl-sig-page-num" type="number" value="${_uplEsc(pageNum)}" min="0"
             class="w-16 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1 text-xs
                    bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                    focus:outline-none focus:ring-1 focus:ring-[#0053e2]" />
      <button type="button" onclick="_uplDocClearCanvas()"
              class="ml-auto text-xs px-3 py-1 rounded-lg border border-gray-300
                     dark:border-zinc-600 text-gray-500 dark:text-zinc-400
                     hover:bg-gray-50 dark:hover:bg-zinc-800 transition">Clear</button>
    </div>
    <div class="flex gap-3 justify-end mt-3">
      <button type="button" onclick="_uplDocCloseSignModal()"
              class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                     text-gray-600 dark:text-zinc-300 hover:bg-gray-50
                     dark:hover:bg-zinc-800 transition">Cancel</button>
      <button type="button" onclick="_uplDocSignGoStep2()"
              class="px-4 py-2 text-sm rounded-lg bg-[#0053e2] text-white font-semibold
                     hover:bg-[#003eb3] transition">
        Next: Place on PDF &rarr;
      </button>
    </div>`;
  _uplDocInitCanvas();
}

function _uplDocSignGoStep2() {
  var canvas = document.getElementById('upl-sig-canvas');
  if (!canvas) return;
  // Guard: require at least some drawing
  var ctx  = canvas.getContext('2d');
  var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  var hasInk = false;
  for (var i = 0; i < data.length; i += 4) {
    if (data[i] < 240 || data[i+1] < 240 || data[i+2] < 240) { hasInk = true; break; }
  }
  if (!hasInk) { _uplShowToast('Please draw your signature first.'); return; }
  _uplSigDrawn = true;
  var sigUrl  = canvas.toDataURL('image/png');
  var pageInp = document.getElementById('upl-sig-page-num');
  var pageNum = pageInp ? parseInt(pageInp.value, 10) || 0 : 0;
  _uplDocShowSignStep2(sigUrl, pageNum);
}

function _uplDocShowSignStep2(sigDataUrl, pageNum) {
  var f = _uplDocCurrentFile;
  if (!f) return;
  var body = document.getElementById('upl-sig-modal-body');
  if (!body) return;
  var pdfSrc = '/uploads/' + _uplEsc(f.filename);
  body.innerHTML = `
    <p class="text-xs text-gray-500 dark:text-zinc-400 mb-2">
      Click anywhere on the PDF to place your signature. You can click again to reposition it.
    </p>
    <div id="upl-sig-place-wrap" class="relative rounded-xl overflow-hidden
         border border-gray-200 dark:border-zinc-700" style="height:55vh">
      <embed id="upl-sig-place-embed" src="${pdfSrc}#page=${pageNum+1}&toolbar=0&navpanes=0"
             type="application/pdf" class="w-full h-full pointer-events-none"></embed>
      <div id="upl-sig-overlay"
           class="absolute inset-0 cursor-crosshair"
           title="Click to place your signature here"
           onclick="_uplDocSigPlaceClick(event)">
      </div>
      </div>
      <div id="upl-sig-marker" class="hidden absolute pointer-events-none"
           style="width:26%;transform:translateY(-50%);opacity:0.82">
        <img id="upl-sig-marker-img" src="" alt="Signature preview"
             class="w-full drop-shadow-md" draggable="false">
      </div>
    </div>
    <p id="upl-sig-place-hint" class="text-[10px] text-gray-400 dark:text-zinc-500 mt-1.5"
       aria-live="polite">No placement yet — click the PDF above.</p>
    <input type="hidden" id="upl-sig-data-store" value="${_uplJsStr(sigDataUrl)}">
    <input type="hidden" id="upl-sig-page-num-val" value="${pageNum}">
    <div class="flex gap-3 justify-end mt-3">
      <button type="button" onclick="_uplDocShowSignStep1(_uplDocCurrentFile)"
              class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                     text-gray-600 dark:text-zinc-300 hover:bg-gray-50
                     dark:hover:bg-zinc-800 transition">&larr; Back</button>
      <button type="button" onclick="_uplDocCloseSignModal()"
              class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                     text-gray-600 dark:text-zinc-300 hover:bg-gray-50
                     dark:hover:bg-zinc-800 transition">Cancel</button>
      <button id="upl-sig-confirm-btn" type="button"
              onclick="_uplDocDoSign(_uplDocCurrentFile)"
              class="px-4 py-2 text-sm rounded-lg bg-[#0053e2] text-white font-semibold
                     hover:bg-[#003eb3] transition">Stamp Signature</button>
    </div>`;
}

function _uplDocSigPlaceClick(e) {
  var wrap   = document.getElementById('upl-sig-place-wrap');
  var marker = document.getElementById('upl-sig-marker');
  var img    = document.getElementById('upl-sig-marker-img');
  var hint   = document.getElementById('upl-sig-place-hint');
  var store  = document.getElementById('upl-sig-data-store');
  if (!wrap || !marker || !store) return;
  var r = wrap.getBoundingClientRect();
  _uplSigXPct = (e.clientX - r.left)  / r.width;
  _uplSigYPct = (e.clientY - r.top)   / r.height;
  _uplSigPlaced = true;
  // Position marker: centred on click X, top edge at click Y
  marker.style.left = (_uplSigXPct * 100 - 13) + '%';
  marker.style.top  = (_uplSigYPct * 100)       + '%';
  if (img) img.src = store.value;
  marker.classList.remove('hidden');
  if (hint) hint.textContent =
    'Placed at ' + Math.round(_uplSigXPct * 100) + '% from left, '
    + Math.round(_uplSigYPct * 100) + '% from top. Click again to reposition.';
}

function _uplDocInitCanvas() {
  var canvas = document.getElementById('upl-sig-canvas');
  if (!canvas) return;
  var ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#111';
  ctx.lineWidth   = 2.5;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  var drawing = false;
  function pos(e) {
    var r = canvas.getBoundingClientRect();
    var scX = canvas.width  / r.width;
    var scY = canvas.height / r.height;
    var src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * scX, y: (src.clientY - r.top) * scY };
  }
  canvas.onpointerdown = function(e) {
    drawing = true; canvas.setPointerCapture(e.pointerId);
    var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  canvas.onpointermove = function(e) {
    if (!drawing) return;
    var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  canvas.onpointerup   = function() { drawing = false; };
  canvas.onpointerleave = function() { drawing = false; };
}

function _uplDocClearCanvas() {
  var canvas = document.getElementById('upl-sig-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

async function _uplDocDoSign(f) {
  if (_uplDocBusy) return;
  if (!_uplSigPlaced) { _uplShowToast('Please click the PDF to place your signature first.'); return; }
  var sigData  = (document.getElementById('upl-sig-data-store') || {}).value || '';
  var pageNum  = parseInt((document.getElementById('upl-sig-page-num-val') || {}).value || '0', 10) || 0;
  if (!sigData) { _uplShowToast('Signature data missing — go back and redraw.'); return; }
  _uplDocBusy = true;
  var btn = document.getElementById('upl-sig-confirm-btn');
  if (btn) btn.disabled = true;
  try {
    var r = await fetch(`/home/uploads/${_uplPid}/files/page/${f.id}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature_data: sigData,
        page_num: pageNum,
        x_pct: _uplSigXPct,
        y_pct: _uplSigYPct,
      }),
    });
    if (!r.ok) { var err = await r.json(); throw new Error(err.detail || r.status); }
    var data = await r.json();
    _uplCacheBust[f.id] = Date.now();  // force embed to reload the updated PDF
    var cached = _uplFiles.find(function(x) { return x.src === f.src && x.id === f.id; });
    if (cached) cached.size = data.size;
    _uplDocCurrentFile.size = data.size;
    _uplShowToast('Signature stamped \u2713');
    _uplDocCloseSignModal();
    _uplDocStudioInit(f);
  } catch(e) {
    _uplShowToast('Signing failed: ' + _uplEsc(String(e)));
  } finally {
    _uplDocBusy = false;
    if (btn) btn.disabled = false;
  }
}

function _uplDocCloseSignModal() {
  var modal = document.getElementById('upl-sig-modal');
  if (modal) modal.classList.add('hidden');
  // Reset state
  _uplSigPlaced = false;
  _uplSigDrawn  = false;
}
