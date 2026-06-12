/* home-page-uploads-sign.js — PDF Signature Studio for Uploads page (BookWorm).
   Extracted from home-page-uploads-docs.js for line-limit hygiene.
   Depends on: _uplPid, _uplFiles, _uplCacheBust, _uplEsc, _uplJsStr,
               _uplShowToast, _uplRenderDetail, _uplDocCurrentFile, _uplDocBusy.
   Loaded AFTER home-page-uploads-docs.js (see base.html).
*/
'use strict';

// ── Sign-modal state ──────────────────────────────────────────────────────────
var _uplSigPlacements   = [];    // [{x_pct, y_pct, page_num}, …] — accumulated clicks
var _uplSigDrawn        = false; // has user drawn anything on the canvas?
var _uplSigStampCount   = 0;     // stamps submitted this session
var _uplRemoveStampFile = null;  // file pending stamp-removal confirmation
var _uplPdfJsPromise    = null;  // cached CDN load promise (load once)
var _uplSigGhostActive  = false; // is an uncommitted ghost currently shown?

var _PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var _PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── Open / close ─────────────────────────────────────────────────────────────

function _uplDocOpenSignModal(f) {
  _uplDocCurrentFile  = f;
  _uplSigPlacements   = [];
  _uplSigDrawn        = false;
  _uplSigStampCount   = 0;
  var modal = document.getElementById('upl-sig-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.focus();
  _uplDocShowSignStep1(f);
}

function _uplDocCloseSignModal() {
  _uplSigCancelGhost();
  var modal = document.getElementById('upl-sig-modal');
  if (modal) modal.classList.add('hidden');
  _uplSigPlacements = [];
  _uplSigDrawn      = false;
  _uplSigStampCount = 0;
}

function _uplDocSignDone(f) {
  var n = _uplSigStampCount;
  _uplDocCloseSignModal();
  _uplCacheBust[f.id] = Date.now();
  _uplShowToast(n + ' stamp' + (n !== 1 ? 's' : '') + ' added \u2713');
  _uplRenderDetail(f);
}

// ── Step 1: draw signature ────────────────────────────────────────────────────

function _uplDocShowSignStep1(f) {
  _uplSigCancelGhost();  // reset ghost state before re-entering step 1 (e.g. Back button)
  _uplSigPlacements = [];
  _uplSigDrawn      = false;
  var body = document.getElementById('upl-sig-modal-body');
  if (!body) return;
  var pn    = (document.getElementById('upl-sig-page-num-val') || {}).value || '0';
  var btCls = 'px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600 ' +
              'text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition';
  body.innerHTML =
    '<p class="text-xs text-gray-500 dark:text-zinc-400 mb-3">Draw your signature below, then click <strong>Next</strong> to place it on the PDF.</p>' +
    '<canvas id="upl-sig-canvas" width="480" height="160" ' +
    '  class="w-full rounded-xl border-2 border-dashed border-gray-300 dark:border-zinc-600 bg-white cursor-crosshair touch-none block" ' +
    '  aria-label="Signature drawing area" role="img"></canvas>' +
    '<div class="flex items-center gap-3 mt-3 mb-1">' +
    '  <label class="text-xs text-gray-600 dark:text-zinc-400 flex-shrink-0" for="upl-sig-page-num">Page (0 = first):</label>' +
    '  <input id="upl-sig-page-num" type="number" value="' + _uplEsc(pn) + '" min="0" ' +
    '    class="w-16 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1 text-xs ' +
    '           bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-[#0053e2]" />' +
    '  <button type="button" onclick="_uplDocClearCanvas()" class="ml-auto text-xs px-3 py-1 rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800 transition">Clear</button>' +
    '</div>' +
    '<div class="flex gap-3 justify-end mt-3">' +
    '  <button type="button" onclick="_uplDocCloseSignModal()" class="' + btCls + '">Cancel</button>' +
    '  <button type="button" onclick="_uplDocSignGoStep2()" class="px-4 py-2 text-sm rounded-lg bg-[#0053e2] text-white font-semibold hover:bg-[#003eb3] transition">Next: Place on PDF &rarr;</button>' +
    '</div>';
  _uplDocInitCanvas();
}

async function _uplDocSignGoStep2() {
  var canvas = document.getElementById('upl-sig-canvas');
  if (!canvas) return;
  var data   = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  var hasInk = false;
  for (var i = 3; i < data.length; i += 4) { if (data[i] > 20) { hasInk = true; break; } }
  if (!hasInk) { _uplShowToast('Please draw your signature first.'); return; }
  _uplSigDrawn = true;
  var sigUrl  = canvas.toDataURL('image/png');
  var pageInp = document.getElementById('upl-sig-page-num');
  var pageNum = pageInp ? (parseInt(pageInp.value, 10) || 0) : 0;
  await _uplDocShowSignStep2(sigUrl, pageNum);
}

function _uplDocInitCanvas() {
  var canvas = document.getElementById('upl-sig-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';    ctx.lineJoin  = 'round';
  var drawing = false;
  function pos(e) {
    var r = canvas.getBoundingClientRect();
    var src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * (canvas.width / r.width),
             y: (src.clientY - r.top)  * (canvas.height / r.height) };
  }
  canvas.onpointerdown  = function(e) { drawing = true; canvas.setPointerCapture(e.pointerId); var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  canvas.onpointermove  = function(e) { if (!drawing) return; var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  canvas.onpointerup    = function() { drawing = false; };
  canvas.onpointerleave = function() { drawing = false; };
}

function _uplDocClearCanvas() {
  var canvas = document.getElementById('upl-sig-canvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// ── Step 2: place signature on PDF page ──────────────────────────────────────

async function _uplDocShowSignStep2(sigDataUrl, pageNum) {
  var f = _uplDocCurrentFile;
  if (!f) return;
  var body = document.getElementById('upl-sig-modal-body');
  if (!body) return;
  _uplSigPlacements = [];

  var btCls = 'px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition';

  body.innerHTML =
    '<p class="text-xs text-gray-500 dark:text-zinc-400 mb-2">Click the page to drop a signature. <strong>Drag</strong> to reposition, drag the <strong>corner handle</strong> to resize, then click <strong>Confirm</strong>.</p>' +
    // canvas is in normal flow (width:100%; height:auto) so its aspect ratio
    // drives the container height — avoids the padding-top vs buffer mismatch
    '<div class="relative w-full rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-700 shadow-inner">' +
    '  <canvas id="upl-pdf-render-canvas" style="display:block;width:100%;height:auto" class="rounded-lg bg-gray-100 dark:bg-zinc-800"></canvas>' +
    '  <div id="upl-sig-place-wrap" onclick="_uplDocSigPlaceClick(event)"' +
    '       style="position:absolute;inset:0" class="cursor-crosshair z-10" aria-label="Click to place signature">' +
    '    <div id="upl-sig-markers-container" style="position:absolute;inset:0" class="pointer-events-none"></div>' +
    '  </div>' +
    '</div>' +
    '<p id="upl-sig-place-hint" class="text-[10px] text-gray-400 dark:text-zinc-500 mt-1.5" aria-live="polite">Click the page above to place your signature.</p>' +
    '<input type="hidden" id="upl-sig-data-store" value="' + _uplEsc(sigDataUrl) + '">' +
    '<input type="hidden" id="upl-sig-page-num-val" value="' + pageNum + '">' +
    '<div class="flex gap-2 justify-end mt-3 flex-wrap">' +
    '  <button type="button" onclick="_uplDocShowSignStep1(_uplDocCurrentFile)" class="' + btCls + '">&larr; Back</button>' +
    '  <button type="button" id="upl-sig-clear-btn" onclick="_uplDocClearPlacements()" class="' + btCls + ' hidden">&times; Clear All</button>' +
    '  <button type="button" id="upl-sig-undo-btn" onclick="_uplSigUndoLast()" class="' + btCls + ' hidden">↩ Undo</button>' +
    '  <button type="button" onclick="_uplDocCloseSignModal()" class="' + btCls + '">Cancel</button>' +
    '  <button id="upl-sig-ghost-cancel-btn" type="button" onclick="_uplSigCancelGhost()" class="' + btCls + ' hidden">✕ Discard</button>' +
    '  <button id="upl-sig-ghost-confirm-btn" type="button" onclick="_uplSigConfirmGhost()"' +
    '          class="px-4 py-2 text-sm rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition hidden">✓ Confirm</button>' +
    '  <button id="upl-sig-confirm-btn" type="button" onclick="_uplDocDoSign(_uplDocCurrentFile)"' +
    '          class="px-4 py-2 text-sm rounded-lg bg-[#0053e2] text-white font-semibold hover:bg-[#003eb3] transition" disabled>Place a signature first</button>' +
    '</div>';

  // Render PDF page asynchronously into the canvas — fail gracefully
  var pdfCanvas = document.getElementById('upl-pdf-render-canvas');
  if (pdfCanvas && f.filename) _uplDocRenderPdfPage(pdfCanvas, f.filename, pageNum).catch(function() {});
}

// ── pdf.js lazy loader + page renderer ───────────────────────────────────────

function _uplLoadPdfJs() {
  if (_uplPdfJsPromise) return _uplPdfJsPromise;
  _uplPdfJsPromise = new Promise(function(resolve, reject) {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    var s = document.createElement('script');
    s.src = _PDFJS_CDN;
    s.onload = function() {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = _PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return _uplPdfJsPromise;
}

async function _uplDocRenderPdfPage(canvasEl, filename, pageNum) {
  var pdfjsLib;
  try { pdfjsLib = await _uplLoadPdfJs(); }
  catch(_) {
    _uplDrawFallbackText(canvasEl, 'PDF preview unavailable (CDN unreachable)');
    return;
  }
  try {
    var url = '/uploads/' + encodeURIComponent(filename);
    var pdf = await pdfjsLib.getDocument({ url: url, withCredentials: false }).promise;
    var pg  = await pdf.getPage(Math.min(pageNum + 1, pdf.numPages));
    var vp  = pg.getViewport({ scale: 1 });
    // Wait up to 5 animation frames for CSS layout to give us a nonzero width.
    // No DPR scaling — canvas width=100%; height=auto drives the aspect ratio via
    // the buffer dimensions, so buffer and CSS display stay in sync automatically.
    var cssW = canvasEl.offsetWidth;
    for (var i = 0; i < 5 && cssW === 0; i++) {
      await new Promise(function(r) { requestAnimationFrame(r); });
      cssW = canvasEl.offsetWidth;
    }
    cssW = cssW || 640;
    var scale = cssW / vp.width;
    var vp2   = pg.getViewport({ scale: scale });
    canvasEl.width  = vp2.width;
    canvasEl.height = vp2.height;
    await pg.render({ canvasContext: canvasEl.getContext('2d'), viewport: vp2 }).promise;
  } catch(e) {
    _uplDrawFallbackText(canvasEl, 'Could not render page — click to place anyway');
  }
}

function _uplDrawFallbackText(canvasEl, msg) {
  // Use a fixed buffer size with A4 ratio; CSS width:100% height:auto scales it
  canvasEl.width  = 640;
  canvasEl.height = Math.round(640 * 1.414);
  var ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.fillStyle = '#9ca3af'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(msg, canvasEl.width / 2, canvasEl.height / 2);
}

// ── Placement markers ─────────────────────────────────────────────────────────

function _uplDocSigPlaceClick(e) {
  if (_uplSigGhostActive) return; // one ghost at a time — user must confirm or discard first
  var wrap  = document.getElementById('upl-sig-place-wrap');
  var store = document.getElementById('upl-sig-data-store');
  var pgVal = document.getElementById('upl-sig-page-num-val');
  if (!wrap || !store) return;
  var r       = wrap.getBoundingClientRect();
  var xPct    = (e.clientX - r.left) / r.width;
  var yPct    = (e.clientY - r.top)  / r.height;
  var pageNum = pgVal ? (parseInt(pgVal.value, 10) || 0) : 0;
  _uplSigSpawnGhost(wrap, store.value, xPct, yPct, pageNum);
}

function _uplDocRenderMarkers(sigSrc) {
  var container = document.getElementById('upl-sig-markers-container');
  var hint      = document.getElementById('upl-sig-place-hint');
  if (!container) return;
  var html = '';
  for (var i = 0; i < _uplSigPlacements.length; i++) {
    var p    = _uplSigPlacements[i];
    var left = (p.x_pct * 100).toFixed(2) + '%';
    var top  = (p.y_pct * 100).toFixed(2) + '%';
    html +=
      '<div style="position:absolute;left:' + left + ';top:' + top + ';' +
             'transform:translate(-50%,-50%);width:22%;pointer-events:none;z-index:20">' +
        '<img src="' + sigSrc + '" alt="sig ' + (i+1) + '" style="width:100%;drop-shadow:0 2px 4px rgba(0,0,0,.3)">' +
        '<span style="position:absolute;top:-8px;left:-8px;background:#0053e2;color:#fff;' +
               'border-radius:50%;width:18px;height:18px;font-size:10px;line-height:18px;' +
               'text-align:center;font-weight:700">' + (i+1) + '</span>' +
      '</div>';
  }
  container.innerHTML = html;
  if (hint) {
    var n = _uplSigPlacements.length;
    hint.textContent = n === 0
      ? 'Click the page above to place your signature.'
      : n + ' placement' + (n !== 1 ? 's' : '') + ' marked. Click to add more, or stamp now.';
  }
}

function _uplDocClearPlacements() {
  _uplSigCancelGhost();
  _uplSigPlacements = [];
  var c = document.getElementById('upl-sig-markers-container');
  if (c) c.innerHTML = '';
  _uplDocUpdateStampBtn();
}

// ── Ghost placement (drag-before-confirm UX) ──────────────────────────────────

function _uplSigSpawnGhost(wrap, sigSrc, xPct, yPct, pageNum) {
  _uplSigGhostActive = true;
  var container = document.getElementById('upl-sig-markers-container');
  if (!container) return;
  var old = document.getElementById('upl-sig-ghost');
  if (old) old.parentNode.removeChild(old);

  var ghost = document.createElement('div');
  ghost.id = 'upl-sig-ghost';
  ghost.dataset.pageNum = pageNum;
  // Use transform initially to centre on click — we collapse it right after
  // appending so all subsequent math uses plain left/top edge percentages.
  ghost.style.cssText =
    'position:absolute;left:' + (xPct * 100).toFixed(2) + '%;top:' + (yPct * 100).toFixed(2) + '%;' +
    'transform:translate(-50%,-50%);width:25%;cursor:move;user-select:none;pointer-events:all;' +
    'z-index:30;opacity:0.8;outline:2px dashed #0053e2;border-radius:4px;box-sizing:border-box;';

  var img = document.createElement('img');
  img.src = sigSrc; img.alt = 'Signature ghost';
  img.style.cssText = 'width:100%;display:block;border-radius:4px;pointer-events:none;';
  ghost.appendChild(img);

  var handle = document.createElement('div');
  handle.id = 'upl-sig-resize-handle';
  handle.title = 'Drag to resize';
  handle.style.cssText =
    'position:absolute;bottom:-6px;right:-6px;width:14px;height:14px;' +
    'background:#0053e2;border-radius:3px;cursor:se-resize;z-index:31;';
  ghost.appendChild(handle);
  container.appendChild(ghost);

  // Collapse transform → explicit left/top (left edge) immediately after mount.
  // getBoundingClientRect() forces a synchronous layout so the transform is applied.
  // After this, ALL positional state lives in ghost.style.left/top (left-edge %)
  // and ghost.dataset.xPct/yPct (centre %) — no getBoundingClientRect in confirm.
  var wR0 = wrap.getBoundingClientRect();
  var gR0 = ghost.getBoundingClientRect();
  ghost.style.transform = 'none';
  ghost.style.left = ((gR0.left - wR0.left) / wR0.width  * 100).toFixed(2) + '%';
  ghost.style.top  = ((gR0.top  - wR0.top)  / wR0.height * 100).toFixed(2) + '%';
  // Centre = click point (by design of translate(-50%,-50%)).
  ghost.dataset.xPct = xPct.toFixed(4);
  ghost.dataset.yPct = yPct.toFixed(4);

  _uplDocUpdateStampBtn();

  // ── Drag ghost body ───────────────────────────────────────────────────────
  ghost.onpointerdown = function(ev) {
    if (ev.target === handle) return;
    ev.stopPropagation();
    ghost.setPointerCapture(ev.pointerId);
    // Transform already collapsed — read left-edge position directly from style.
    var wR     = wrap.getBoundingClientRect();
    var startL = parseFloat(ghost.style.left) / 100 * wR.width;
    var startT = parseFloat(ghost.style.top)  / 100 * wR.height;
    var startPX = ev.clientX, startPY = ev.clientY;
    ghost.onpointermove = function(ev) {
      if (!ev.buttons) return;
      var wR2 = wrap.getBoundingClientRect();
      var gW  = ghost.offsetWidth, gH = ghost.offsetHeight;
      var newL = Math.max(0, Math.min(wR2.width  - gW, startL + (ev.clientX - startPX)));
      var newT = Math.max(0, Math.min(wR2.height - gH, startT + (ev.clientY - startPY)));
      ghost.style.left = (newL / wR2.width  * 100).toFixed(2) + '%';
      ghost.style.top  = (newT / wR2.height * 100).toFixed(2) + '%';
      // Keep centre dataset in sync — used by _uplSigConfirmGhost.
      ghost.dataset.xPct = ((newL + gW / 2) / wR2.width ).toFixed(4);
      ghost.dataset.yPct = ((newT + gH / 2) / wR2.height).toFixed(4);
    };
    ghost.onpointerup = function() { ghost.onpointermove = null; ghost.onpointerup = null; };
  };

  // ── Resize handle ─────────────────────────────────────────────────────────
  handle.onpointerdown = function(ev) {
    ev.stopPropagation();
    handle.setPointerCapture(ev.pointerId);
    var startPX = ev.clientX, startW = ghost.offsetWidth;
    handle.onpointermove = function(ev) {
      if (!ev.buttons) return;
      var wR  = wrap.getBoundingClientRect();
      var newW = Math.max(wR.width * 0.08, Math.min(wR.width * 0.60,
                          startW + (ev.clientX - startPX)));
      ghost.style.width = (newW / wR.width * 100).toFixed(2) + '%';
      // Left edge is fixed; right edge moved — centre X and Y both shift.
      var leftPx = parseFloat(ghost.style.left) / 100 * wR.width;
      var topPx  = parseFloat(ghost.style.top)  / 100 * wR.height;
      ghost.dataset.xPct = ((leftPx + newW              / 2) / wR.width ).toFixed(4);
      ghost.dataset.yPct = ((topPx  + ghost.offsetHeight / 2) / wR.height).toFixed(4);
    };
    handle.onpointerup = function() { handle.onpointermove = null; handle.onpointerup = null; };
  };
}

function _uplSigConfirmGhost() {
  _uplSigGhostActive = false;
  var ghost = document.getElementById('upl-sig-ghost');
  if (!ghost) { _uplDocUpdateStampBtn(); return; }
  // Coordinates are maintained in dataset throughout spawn/drag/resize.
  // Reading here avoids any getBoundingClientRect issues under CSS transforms.
  var x_pct   = parseFloat(ghost.dataset.xPct   || '0.5');
  var y_pct   = parseFloat(ghost.dataset.yPct   || '0.5');
  var pageNum = parseInt(ghost.dataset.pageNum   || '0', 10) || 0;
  _uplSigPlacements.push({ x_pct: x_pct, y_pct: y_pct, page_num: pageNum });
  ghost.parentNode.removeChild(ghost);
  var store = document.getElementById('upl-sig-data-store');
  _uplDocRenderMarkers(store ? store.value : '');
  _uplDocUpdateStampBtn();
}

function _uplSigCancelGhost() {
  var ghost = document.getElementById('upl-sig-ghost');
  if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
  _uplSigGhostActive = false;
  _uplDocUpdateStampBtn();
}

function _uplSigUndoLast() {
  if (_uplSigGhostActive) { _uplSigCancelGhost(); return; }
  if (_uplSigPlacements.length === 0) return;
  _uplSigPlacements.pop();
  var store = document.getElementById('upl-sig-data-store');
  _uplDocRenderMarkers(store ? store.value : '');
  _uplDocUpdateStampBtn();
}

function _uplDocUpdateStampBtn() {
  var n            = _uplSigPlacements.length;
  var btn          = document.getElementById('upl-sig-confirm-btn');
  var clr          = document.getElementById('upl-sig-clear-btn');
  var undoBtn      = document.getElementById('upl-sig-undo-btn');
  var ghostConfirm = document.getElementById('upl-sig-ghost-confirm-btn');
  var ghostCancel  = document.getElementById('upl-sig-ghost-cancel-btn');
  var hint         = document.getElementById('upl-sig-place-hint');

  if (btn) {
    btn.disabled    = (n === 0 || _uplSigGhostActive);
    btn.textContent = n <= 1 ? 'Stamp Signature' : 'Stamp ' + n + ' Signatures';
  }
  // Show Clear All only when there are committed placements and no ghost floating
  if (clr)  { n > 0 && !_uplSigGhostActive ? clr.classList.remove('hidden') : clr.classList.add('hidden'); }
  // Show Undo when there are committed placements and no ghost
  if (undoBtn) { n > 0 && !_uplSigGhostActive ? undoBtn.classList.remove('hidden') : undoBtn.classList.add('hidden'); }
  // Ghost buttons visible only while a ghost is floating
  if (ghostConfirm) { _uplSigGhostActive ? ghostConfirm.classList.remove('hidden') : ghostConfirm.classList.add('hidden'); }
  if (ghostCancel)  { _uplSigGhostActive ? ghostCancel.classList.remove('hidden')  : ghostCancel.classList.add('hidden'); }

  if (hint) {
    if (_uplSigGhostActive)
      hint.textContent = 'Drag to move — corner handle to resize — then click “Confirm”.';
    else if (n === 0)
      hint.textContent = 'Click the page above to place your signature.';
    else
      hint.textContent = n + ' placement' + (n !== 1 ? 's' : '') + ' confirmed. Click to add more.';
  }
}

// ── Submit signature(s) ───────────────────────────────────────────────────────

async function _uplDocDoSign(f) {
  if (_uplDocBusy) return;
  if (_uplSigPlacements.length === 0) { _uplShowToast('Click the PDF to place your signature first.'); return; }
  var sigData = (document.getElementById('upl-sig-data-store') || {}).value || '';
  if (!sigData) { _uplShowToast('Signature data missing \u2014 go back and redraw.'); return; }
  _uplDocBusy = true;
  var btn = document.getElementById('upl-sig-confirm-btn');
  if (btn) btn.disabled = true;
  try {
    var r = await fetch('/home/uploads/' + _uplPid + '/files/page/' + f.id + '/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature_data: sigData, placements: _uplSigPlacements }),
    });
    if (!r.ok) { var err = await r.json(); throw new Error(err.detail || r.status); }
    var data = await r.json();
    f.has_backup = true;
    f.size = data.size;
    var cached = _uplFiles.find(function(x) { return x.src === f.src && x.id === f.id; });
    if (cached) { cached.size = data.size; cached.has_backup = true; }
    _uplDocCurrentFile.size = data.size;
    _uplSigStampCount += (data.stamps || _uplSigPlacements.length);
    // Success step — offer to add more stamps or finish
    var body = document.getElementById('upl-sig-modal-body');
    var ac   = 'px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition';
    var n    = data.stamps || _uplSigPlacements.length;
    if (body) body.innerHTML =
      '<div class="flex flex-col items-center gap-4 py-6">' +
      '  <span class="text-4xl">\u2705</span>' +
      '  <p class="text-sm font-semibold text-gray-800 dark:text-zinc-100">' + n + ' stamp' + (n !== 1 ? 's' : '') + ' added!</p>' +
      '  <p class="text-xs text-gray-500 dark:text-zinc-400 text-center">Add more stamps, or click Done to finish.</p>' +
      '  <div class="flex gap-3 mt-1">' +
      '    <button type="button" onclick="_uplDocShowSignStep1(_uplDocCurrentFile)" class="' + ac + '">\u2795 Add More</button>' +
      '    <button type="button" onclick="_uplDocSignDone(_uplDocCurrentFile)" class="px-4 py-2 text-sm rounded-lg bg-[#2a8703] text-white font-semibold hover:bg-green-700 transition">Done \u2713</button>' +
      '  </div>' +
      '</div>';
  } catch(e) {
    _uplShowToast('Signing failed: ' + _uplEsc(String(e)));
  } finally {
    _uplDocBusy = false;
    if (btn) btn.disabled = false;
  }
}

// ── Remove stamp ──────────────────────────────────────────────────────────────

async function _uplDocRemoveStamp(f) {
  _uplRemoveStampFile = f;
  var m = document.getElementById('upl-remove-stamp-modal');
  if (m) m.classList.remove('hidden');
}

function _uplCancelRemoveStamp() {
  _uplRemoveStampFile = null;
  var m = document.getElementById('upl-remove-stamp-modal');
  if (m) m.classList.add('hidden');
}

async function _uplConfirmRemoveStamp() {
  var f = _uplRemoveStampFile;
  if (!f) return;
  var btn = document.getElementById('upl-remove-stamp-confirm-btn');
  if (btn) btn.disabled = true;
  try {
    var r = await fetch('/home/uploads/' + _uplPid + '/files/page/' + f.id + '/sign', { method: 'DELETE' });
    if (!r.ok) { var e = await r.json(); throw new Error(e.detail || r.status); }
    var d = await r.json();
    f.has_backup = false; f.size = d.size;
    var hit = _uplFiles.find(function(x) { return x.src === f.src && x.id === f.id; });
    if (hit) { hit.has_backup = false; hit.size = d.size; }
    _uplCacheBust[f.id] = Date.now();
    _uplCancelRemoveStamp();
    _uplShowToast('Stamp removed \u2713');
    _uplRenderDetail(f);
  } catch(e) {
    _uplShowToast('Remove failed: ' + String(e));
  } finally {
    if (btn) btn.disabled = false;
  }
}
