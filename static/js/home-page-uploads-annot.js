/* home-page-uploads-annot.js — PDF Annotation overlay (Document Studio Phase 8 / B2).
   PDF.js renders the PDF to a <canvas>; annotations are absolutely-positioned <div>s.
   The PDF on disk is NEVER modified — overlays live only in the DB + DOM.
   Loaded after home-page-uploads-spreadsheet.js (base.html, defer).
   Shared globals: _uplPid, _uplEsc, _uplShowToast, _uplFetch (home-page-uploads.js).

   G1 : var only — no let/const (house style for all uploads companion files).
   G3 : PDF.js worker URL must match main script version exactly (3.11.174).
   G4 : Session expiry returns 302→HTML. Check Content-Type before .arrayBuffer().
   G9 : PDF.js getPage() is 1-indexed; DB stores 0-indexed page_num.
   G10: #upl-annot-overlay pointer-events:none by default; flipped to auto only
        when a tool is active so annotation divs inside stay clickable otherwise.
*/
'use strict';

// ── Module state ──────────────────────────────────────────────────────────────
var _uplAnnotFile        = null;  // current file object
var _uplAnnotPdfDoc      = null;  // pdfjsLib.PDFDocumentProxy
var _uplAnnotLibsPromise = null;  // cached CDN load promise (re-use across opens)
var _uplAnnotScale       = 1.5;  // render scale — changed by _uplAnnotZoom()

var _uplAnnotState = {
  page:   0,      // 0-indexed current page
  total:  1,      // total pages in PDF
  tool:   null,   // 'highlight' | 'sticky' | 'textbox' | null
  annots: [],     // annotation row objects from server
  busy:   false,  // prevent double-submit on click-to-add
};

// G11: Track whether the overlay mousedown started ON the overlay itself.
// Prevents drag-release-outside-textarea from firing a new annotation.
var _annotOverlayMdOnSelf = false;

// G12: Shared button style string for the read-only PDF viewer toolbar (_uplAnnotPdfViewer).
var _AV_BTN = 'font-size:13px;padding:2px 8px;border-radius:4px;border:1px solid #d1d5db;' +
  'background:white;color:#374151;cursor:pointer;';

// Pen tool state — tracks active drawing stroke
var _uplAnnotPenState = {
  color:   '#111111',  // active pen colour (matches first swatch)
  size:    3,          // stroke width in pixels at 100% zoom: S=1.5, M=3, L=6
  drawing: false,      // true while pointer is held
  points:  [],         // [{x,y}] normalised to [0,1] of the PDF canvas
};

// ── CDN URLs — pinned; update worker + main together ─────────────────────────
var _ANNOT_PDFJS_JS   = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var _ANNOT_PDFJS_WRKR = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Build an annotation endpoint URL for the currently open file. */
function _annotUrl(suffix) {
  return '/home/uploads/' + _uplPid + '/files/page/' + _uplAnnotFile.id + suffix;
}

/**
 * Annotation-specific fetch helper.
 * NOTE: _uplFetch() from home-page-uploads.js is a FILE-LIST loader (takes a
 * page number, hits /files?page=N) — do NOT use it here.
 * This wrapper handles session expiry + non-OK responses consistently.
 * Returns parsed JSON, or null for 204 No Content.
 */
async function _annotReq(url, opts) {
  var r = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts || {}));
  var ct = r.headers.get('content-type') || '';
  if (ct.startsWith('text/html')) throw new Error('Session expired — please reload');
  if (r.status === 204) return null;
  if (!r.ok) {
    var detail = '';
    try { detail = (await r.json()).detail || ''; } catch (_) {}
    throw new Error('HTTP ' + r.status + (detail ? ': ' + detail : ''));
  }
  return r.json();
}

function _annotEl(id) { return document.getElementById(id); }

function _uplAnnotShowLoading() {
  _annotEl('upl-annot-loading').classList.remove('hidden');
  _annotEl('upl-annot-body').classList.add('hidden');
  _annotEl('upl-annot-error').classList.add('hidden');
}

function _uplAnnotShowBody() {
  _annotEl('upl-annot-loading').classList.add('hidden');
  _annotEl('upl-annot-body').classList.remove('hidden');
  _annotEl('upl-annot-error').classList.add('hidden');
}

function _uplAnnotShowError(msg) {
  _annotEl('upl-annot-loading').classList.add('hidden');
  _annotEl('upl-annot-body').classList.add('hidden');
  var errEl = _annotEl('upl-annot-error');
  errEl.classList.remove('hidden');
  _annotEl('upl-annot-error-msg').textContent = msg;
}

// ── CDN loader ────────────────────────────────────────────────────────────────

/** Lazily inject PDF.js from CDN. Returns a promise; safe to call multiple times. */
function _uplAnnotLoadLibs() {
  if (_uplAnnotLibsPromise) return _uplAnnotLibsPromise;
  _uplAnnotLibsPromise = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = _ANNOT_PDFJS_JS;
    s.onload = function() {
      // G3: must set workerSrc before any getDocument() call
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = _ANNOT_PDFJS_WRKR;
      resolve();
    };
    s.onerror = function() {
      _uplAnnotLibsPromise = null;  // allow retry on next open
      reject(new Error('Failed to load PDF.js from CDN'));
    };
    document.head.appendChild(s);
  });
  return _uplAnnotLibsPromise;
}

// ── Open ──────────────────────────────────────────────────────────────────────

async function _uplAnnotOpen(f) {
  _uplAnnotFile = f;
  _uplAnnotPdfDoc = null;
  _uplAnnotState.page = 0;
  _uplAnnotState.total = 1;
  _uplAnnotState.tool = null;
  _uplAnnotState.annots = [];
  _uplAnnotState.busy = false;

  _annotEl('upl-annot-filename').textContent = f.original_name || f.filename || '';
  _annotEl('upl-annot-page-label').textContent = 'Page 1 / 1';
  _annotEl('upl-annot-overlay').innerHTML = '';
  _uplAnnotDeactivateTools();

  var modal = _annotEl('upl-annot-modal');
  modal.classList.remove('hidden');
  modal.focus();
  _uplAnnotShowLoading();

  try {
    await _uplAnnotLoadLibs();

    // Fetch PDF bytes via the existing auth-gated download route (Quirk #18).
    // Append cache-bust timestamp so the browser never serves a stale copy after
    // a signature stamp (which physically replaces the file on disk).
    var dlUrl = '/home/uploads/' + _uplPid + '/files/' + f.src + '/' + f.id + '/download' +
                '?v=' + (_uplCacheBust && _uplCacheBust[f.id] ? _uplCacheBust[f.id] : Date.now());
    var dlRes = await fetch(dlUrl, { credentials: 'same-origin' });
    // G4: session expiry redirects to /login (HTML) — check Content-Type first
    if ((dlRes.headers.get('content-type') || '').startsWith('text/html')) {
      throw new Error('Session expired — please reload the page');
    }
    if (!dlRes.ok) throw new Error('Could not fetch PDF (' + dlRes.status + ')');
    var buf = await dlRes.arrayBuffer();

    _uplAnnotPdfDoc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    _uplAnnotState.total = _uplAnnotPdfDoc.numPages;

    // Load saved annotations (GET — no demo guard needed)
    var aRes = await _annotReq(_annotUrl('/annotations'));
    _uplAnnotState.annots = (aRes && aRes.annotations) ? aRes.annotations : [];

    await _uplAnnotRenderPage(0);
    _uplAnnotShowBody();
  } catch (err) {
    _uplAnnotShowError(err.message || 'Failed to open PDF');
  }
}

// ── Close ─────────────────────────────────────────────────────────────────────

function _uplAnnotClose() {
  _annotEl('upl-annot-modal').classList.add('hidden');
  // Cancel any active tool + restore overlay
  if (_uplAnnotState.tool) _uplAnnotAddMode(_uplAnnotState.tool);
  _uplAnnotPenStop();
  _uplAnnotPdfDoc = null;
  _uplAnnotFile = null;
  _uplAnnotState.page = 0;
  _uplAnnotState.total = 1;
  _uplAnnotState.tool = null;
  _uplAnnotState.annots = [];
  _uplAnnotState.busy = false;
  _annotEl('upl-annot-overlay').innerHTML = '';
  // PDF.js web worker intentionally kept alive for fast re-open
}

// ── Page rendering ────────────────────────────────────────────────────────────

async function _uplAnnotRenderPage(n) {
  if (!_uplAnnotPdfDoc) return;
  if (n < 0 || n >= _uplAnnotState.total) return;
  _uplAnnotState.page = n;

  // G9: getPage() is 1-indexed — always add 1
  var pdfPage = await _uplAnnotPdfDoc.getPage(n + 1);
  var viewport = pdfPage.getViewport({ scale: _uplAnnotScale });

  var canvas = _annotEl('upl-annot-canvas');
  canvas.width  = viewport.width;
  canvas.height = viewport.height;

  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;

  // Keep draw canvas perfectly in sync with PDF canvas so pen coords are accurate
  var dc = _annotEl('upl-annot-draw-canvas');
  if (dc) { dc.width = viewport.width; dc.height = viewport.height; }

  _annotEl('upl-annot-page-label').textContent =
    'Page ' + (n + 1) + ' / ' + _uplAnnotState.total;
  var zl = _annotEl('upl-annot-zoom-label');
  if (zl) zl.textContent = Math.round(_uplAnnotScale * 100) + '%';

  _uplAnnotDrawOverlay();
}

/** Public — called by page nav buttons in the toolbar. */
function _uplAnnotSetPage(n) {
  _uplAnnotRenderPage(Math.max(0, Math.min(n, _uplAnnotState.total - 1)));
}

/** Public — adjust zoom level by delta (e.g. +0.25 or -0.25) and re-render. */
function _uplAnnotZoom(delta) {
  _uplAnnotScale = Math.max(0.5, Math.min(3.0, _uplAnnotScale + delta));
  _uplAnnotRenderPage(_uplAnnotState.page);
}

/** AutoFit: scale so the PDF fits the scroll container in both dimensions. */
function _uplAnnotAutofit() {
  var body = _annotEl('upl-annot-body');
  if (!body || !_uplAnnotPdfDoc) return;
  // p-4 padding = 32px each axis
  var availW = body.clientWidth  - 32;
  var availH = body.clientHeight - 32;
  if (availW <= 0 || availH <= 0) return;
  _uplAnnotPdfDoc.getPage(_uplAnnotState.page + 1).then(function(pg) {
    var vp = pg.getViewport({ scale: 1 });
    _uplAnnotScale = Math.max(0.25, Math.min(availW / vp.width, availH / vp.height));
    _uplAnnotRenderPage(_uplAnnotState.page);
  });
}

// ── Overlay rendering ─────────────────────────────────────────────────────────

function _uplAnnotDrawOverlay() {
  var overlay = _annotEl('upl-annot-overlay');
  overlay.innerHTML = '';
  var cur = _uplAnnotState.page;
  var annots = _uplAnnotState.annots;
  for (var i = 0; i < annots.length; i++) {
    if (annots[i].page_num === cur) overlay.appendChild(_uplAnnotMakeDiv(annots[i]));
  }
}

/** Shared delete button factory.
 *  alwaysVisible=true  → permanently shown (used inside header strips).
 *  alwaysVisible=false → fade-in on hover (used on highlights). */
function _annotDelBtn(aid, alwaysVisible) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '\u2715';
  btn.setAttribute('aria-label', 'Delete annotation');
  btn.style.cssText =
    'font-size:13px;line-height:1;min-width:22px;min-height:22px;' +
    'padding:2px 6px;background:rgba(0,0,0,0.45);color:white;' +
    'border:none;border-radius:3px;cursor:pointer;transition:opacity .15s;flex-shrink:0;' +
    (alwaysVisible ? 'opacity:1;' : 'position:absolute;top:3px;right:3px;opacity:0;');
  btn.onclick = function(e) { e.stopPropagation(); _uplAnnotDelete(aid); };
  return btn;
}

function _uplAnnotMakeDiv(a) {
  var wrap = document.createElement('div');
  wrap.dataset.aid = String(a.id);
  wrap.style.position  = 'absolute';
  wrap.style.left      = (a.x_pct   * 100) + '%';
  wrap.style.top       = (a.y_pct   * 100) + '%';
  wrap.style.width     = (a.width_pct  * 100) + '%';
  wrap.style.height    = (a.height_pct * 100) + '%';
  wrap.style.pointerEvents = 'auto';
  wrap.style.boxSizing = 'border-box';

  if (a.type === 'highlight') {
    wrap.style.background = 'rgba(255,194,32,0.38)';
    wrap.style.cursor = 'default';
    // Highlights get a simple hover-to-delete button
    var hDel = _annotDelBtn(a.id, false);
    wrap.appendChild(hDel);
    wrap.onmouseenter = function() { hDel.style.opacity = '1'; };
    wrap.onmouseleave = function() { hDel.style.opacity = '0'; };

  } else if (a.type === 'sticky') {
    // ── Sticky note: header strip + body ────────────────────────────────
    wrap.style.display       = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.borderRadius  = '2px 8px 8px 8px';
    wrap.style.overflow      = 'hidden';
    wrap.style.boxShadow     = '3px 4px 10px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.2)';
    wrap.style.transform     = 'rotate(-1.2deg)';
    wrap.style.background    = '#fef3c7';   // warm cream-yellow body

    // Header strip (darker yellow, always-visible delete)
    var sHdr = document.createElement('div');
    sHdr.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'background:#f59e0b;padding:2px 4px;flex-shrink:0;cursor:move;' +
      'user-select:none;min-height:20px;';

    var sPin = document.createElement('span');
    sPin.textContent = '\uD83D\uDCCC';
    sPin.setAttribute('aria-hidden', 'true');
    sPin.style.cssText = 'font-size:11px;line-height:1;';
    sHdr.appendChild(sPin);

    sHdr.appendChild(_annotDelBtn(a.id, true));  // always visible in header
    wrap.appendChild(sHdr);

    // Body (scrollable note area)
    var sBody = document.createElement('div');
    sBody.style.cssText = 'flex:1;overflow:hidden;padding:3px 5px;';
    sBody.appendChild(_uplAnnotMakeTextarea(a, '#1a1a1a'));
    wrap.appendChild(sBody);

  } else if (a.type === 'pen') {
    // ── Pen stroke: full-page transparent wrapper holding an SVG polyline ──
    wrap.style.pointerEvents = 'none';  // SVG captures no clicks by default
    // Wrapper spans entire canvas (x=0 y=0 w=1 h=1)
    // We need to detect hover on the SVG to show the delete button,
    // so we make the wrapper clickable but only for the SVG hit region.
    wrap.style.pointerEvents = 'auto';
    wrap.style.overflow      = 'visible';
    try {
      var penData = JSON.parse(a.content || '[]');
      // Support both old [{x,y}] arrays and new {pts, size} objects
      var pts  = Array.isArray(penData) ? penData : (penData.pts || []);
      var swPx = Array.isArray(penData) ? 3 : (penData.size || 3);
      // stroke-width in viewBox [0,1] units: swPx points / canvas-pixel-height
      // 0.004 ≈ 3px on a 750-high canvas; scale proportionally
      var swNorm = swPx / 750;
      if (pts.length > 1) {
        var ns  = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 1 1');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
        var pl = document.createElementNS(ns, 'polyline');
        pl.setAttribute('points', pts.map(function(p) { return p.x + ',' + p.y; }).join(' '));
        pl.setAttribute('fill', 'none');
        pl.setAttribute('stroke', a.color || '#111111');
        pl.setAttribute('stroke-width', String(swNorm));
        pl.setAttribute('stroke-linecap', 'round');
        pl.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(pl);
        wrap.appendChild(svg);
      }
    } catch (_) {}
    // Hover to reveal delete
    var pDel = _annotDelBtn(a.id, false);
    pDel.style.position = 'absolute';
    pDel.style.top      = '2px';
    pDel.style.right    = '2px';
    wrap.appendChild(pDel);
    wrap.onmouseenter = function() { pDel.style.opacity = '1'; };
    wrap.onmouseleave = function() { pDel.style.opacity = '0'; };

  } else {
    // ── Text box
    wrap.style.display       = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.border        = '1.5px solid #0053e2';
    wrap.style.borderRadius  = '4px';
    wrap.style.overflow      = 'hidden';
    wrap.style.background    = txBg;
    wrap.style.boxShadow     = '0 1px 4px rgba(0,83,226,0.18)';

    // Toolbar strip
    var txHdr = document.createElement('div');
    txHdr.style.cssText =
      'display:flex;align-items:center;justify-content:flex-end;gap:3px;' +
      'background:rgba(0,83,226,0.08);padding:2px 3px;flex-shrink:0;' +
      'border-bottom:1px solid rgba(0,83,226,0.2);min-height:20px;';

    // BG toggle button
    var bgBtn = document.createElement('button');
    bgBtn.type = 'button';
    bgBtn.title = 'Toggle background (white / transparent)';
    bgBtn.setAttribute('aria-label', 'Toggle background');
    bgBtn.style.cssText =
      'font-size:11px;padding:1px 5px;border-radius:3px;cursor:pointer;' +
      'border:1px solid #0053e2;color:#0053e2;background:white;' +
      'line-height:1.4;white-space:nowrap;flex-shrink:0;';
    bgBtn.textContent = txBg === 'transparent' ? '\u25A1 BG' : '\u25A0 BG';
    bgBtn.onclick = function(e) { e.stopPropagation(); _uplAnnotToggleBg(a, wrap, bgBtn); };
    txHdr.appendChild(bgBtn);

    txHdr.appendChild(_annotDelBtn(a.id, true));  // always visible
    wrap.appendChild(txHdr);

    var txBody = document.createElement('div');
    txBody.style.cssText = 'flex:1;overflow:hidden;padding:3px 5px;';
    txBody.appendChild(_uplAnnotMakeTextarea(a, '#1a1a1a'));
    wrap.appendChild(txBody);
  }

  return wrap;
}

/** Toggle a textbox annotation between white and transparent background.
 *  Persists the change to the server via PUT using the `color` field. */
function _uplAnnotToggleBg(a, wrapEl, btnEl) {
  var next = (a.color === 'transparent') ? 'white' : 'transparent';
  a.color = next;
  wrapEl.style.background = next;
  btnEl.textContent = next === 'transparent' ? '\u25A1 BG' : '\u25A0 BG';
  // Persist — we reuse the PUT endpoint; color field carries the bg choice
  _annotReq(_annotUrl('/annotations/' + a.id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page_num: a.page_num, type: a.type,
      x_pct: a.x_pct, y_pct: a.y_pct,
      width_pct: a.width_pct, height_pct: a.height_pct,
      color: next, content: a.content,
    }),
  }).catch(function(err) { _uplShowToast('Could not save bg: ' + err.message, true); });
}

function _uplAnnotMakeTextarea(a, textColor) {
  var ta = document.createElement('textarea');
  ta.value = a.content || '';
  ta.setAttribute('aria-label', 'Annotation text');
  ta.setAttribute('placeholder', 'Type here\u2026');
  ta.style.cssText =
    'width:100%;height:100%;border:none;outline:none;resize:none;' +
    'background:transparent;font-size:12px;font-family:inherit;' +
    'color:' + (textColor || '#1a1a1a') + ';' +
    'line-height:1.5;padding:0;margin:0;overflow:auto;';
  // G11: stop click + mousedown from bubbling to the overlay
  ta.onclick    = function(e) { e.stopPropagation(); };
  ta.onmousedown = function(e) { e.stopPropagation(); };
  ta.onblur     = function() { _uplAnnotSave(a.id, ta.value, a); };
  return ta;
}

// ── Tool mode ─────────────────────────────────────────────────────────────────

/** Toggle a tool on/off. Clicking the active tool deactivates it. */
function _uplAnnotAddMode(type) {
  var overlay = _annotEl('upl-annot-overlay');
  var dc      = _annotEl('upl-annot-draw-canvas');
  overlay.removeEventListener('click',       _uplAnnotHandleOverlayClick);
  overlay.removeEventListener('mousedown',   _uplAnnotOverlayMd);
  _uplAnnotPenStop();  // finish any in-progress stroke

  _uplAnnotState.tool = (_uplAnnotState.tool === type) ? null : type;
  _uplAnnotDeactivateTools();

  if (_uplAnnotState.tool === 'pen') {
    // Pen mode: draw canvas captures all input; overlay is pass-through
    overlay.style.pointerEvents = 'none';
    overlay.style.cursor = 'default';
    if (dc) {
      dc.style.pointerEvents = 'all';
      dc.style.cursor = 'crosshair';
      dc.addEventListener('pointerdown',  _uplAnnotPenDown);
      dc.addEventListener('pointermove',  _uplAnnotPenMove);
      dc.addEventListener('pointerup',    _uplAnnotPenUp);
      dc.addEventListener('pointerleave', _uplAnnotPenUp);
    }
    // Show colour swatches
    var swatches = _annotEl('upl-annot-pen-colors');
    if (swatches) swatches.classList.replace('hidden', 'flex');
  } else if (_uplAnnotState.tool) {
    // Click-to-place tools: overlay captures clicks; draw canvas is inert
    overlay.style.pointerEvents = 'auto';
    overlay.style.cursor = 'crosshair';
    overlay.addEventListener('mousedown', _uplAnnotOverlayMd);
    overlay.addEventListener('click',     _uplAnnotHandleOverlayClick);
    if (dc) { dc.style.pointerEvents = 'none'; dc.style.cursor = 'default'; }
    var swatches2 = _annotEl('upl-annot-pen-colors');
    if (swatches2) swatches2.classList.replace('flex', 'hidden');
  } else {
    // No tool active
    overlay.style.pointerEvents = 'none';
    overlay.style.cursor = 'default';
    if (dc) { dc.style.pointerEvents = 'none'; dc.style.cursor = 'default'; }
    var swatches3 = _annotEl('upl-annot-pen-colors');
    if (swatches3) swatches3.classList.replace('flex', 'hidden');
  }
}

function _uplAnnotDeactivateTools() {
  var types = ['highlight', 'sticky', 'textbox', 'pen'];
  for (var i = 0; i < types.length; i++) {
    var b = _annotEl('upl-annot-tool-' + types[i]);
    if (!b) continue;
    b.classList.remove('border-[#ffc220]', 'text-[#ffc220]');
    b.setAttribute('aria-pressed', 'false');
  }
  // Highlight active tool
  if (_uplAnnotState.tool) {
    var active = _annotEl('upl-annot-tool-' + _uplAnnotState.tool);
    if (active) {
      active.classList.add('border-[#ffc220]', 'text-[#ffc220]');
      active.setAttribute('aria-pressed', 'true');
    }
  }
}

// ── Click-to-add ──────────────────────────────────────────────────────────────

/** G11 — record whether the mousedown started directly on the overlay. */
function _uplAnnotOverlayMd(e) {
  _annotOverlayMdOnSelf = (e.target === _annotEl('upl-annot-overlay'));
}

async function _uplAnnotHandleOverlayClick(e) {
  var tool = _uplAnnotState.tool;
  if (!tool || _uplAnnotState.busy || !_uplAnnotFile) return;
  // G11: ignore clicks whose mousedown originated inside a child (e.g. textarea
  // text-drag released outside the textarea but still over the overlay)
  if (!_annotOverlayMdOnSelf) return;
  _annotOverlayMdOnSelf = false;
  e.stopPropagation();

  var rect = e.currentTarget.getBoundingClientRect();
  var xPct = (e.clientX - rect.left) / rect.width;
  var yPct = (e.clientY - rect.top)  / rect.height;
  var wPct = (tool === 'highlight') ? 0.25 : 0.22;
  var hPct = (tool === 'highlight') ? 0.04 : 0.13;

  _uplAnnotState.busy = true;
  try {
    var body = {
      page_num: _uplAnnotState.page, type: tool,
      x_pct: xPct, y_pct: yPct,
      width_pct: wPct, height_pct: hPct,
      color: tool === 'textbox' ? 'white' : '#ffc220', content: '',
    };
    var result = await _annotReq(_annotUrl('/annotations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (result && result.id != null) {
      body.id = result.id;
      _uplAnnotState.annots.push(body);
      _uplAnnotDrawOverlay();
    }
  } catch (err) {
    _uplShowToast('Could not add annotation: ' + err.message, true);
  } finally {
    _uplAnnotState.busy = false;
  }
}

// ── Save annotation content (on textarea blur) ────────────────────────────────

async function _uplAnnotSave(aid, content, a) {
  if (!_uplAnnotFile) return;
  try {
    await _annotReq(_annotUrl('/annotations/' + aid), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page_num: a.page_num, type: a.type,
        x_pct: a.x_pct, y_pct: a.y_pct,
        width_pct: a.width_pct, height_pct: a.height_pct,
        color: a.color, content: content,
      }),
    });
    // Mirror update in local cache
    var annots = _uplAnnotState.annots;
    for (var i = 0; i < annots.length; i++) {
      if (annots[i].id === aid) { annots[i].content = content; break; }
    }
  } catch (err) {
    _uplShowToast('Save failed: ' + err.message, true);
  }
}

// ── Delete annotation ─────────────────────────────────────────────────────────

async function _uplAnnotDelete(aid) {
  if (!_uplAnnotFile) return;
  try {
    var r = await fetch(_annotUrl('/annotations/' + aid), {
      method: 'DELETE', credentials: 'same-origin',
    });
    if (!r.ok) throw new Error('Server returned ' + r.status);
    _uplAnnotState.annots = _uplAnnotState.annots.filter(function(a) {
      return a.id !== aid;
    });
    var div = _annotEl('upl-annot-overlay').querySelector('[data-aid="' + aid + '"]');
    if (div) div.remove();
  } catch (err) {
    _uplShowToast('Delete failed: ' + err.message, true);
  }
}

// ── Clear all annotations ─────────────────────────────────────────────────────

/** Show the BookWorm-styled clear-all confirm modal. */
function _uplAnnotShowClearModal() {
  if (!_uplAnnotFile) return;
  var n = _uplAnnotState.annots.length;
  if (n === 0) { _uplShowToast('No annotations to clear.'); return; }
  var countEl = _annotEl('upl-annot-clear-count');
  if (countEl) countEl.textContent = n + ' annotation' + (n !== 1 ? 's' : '') + ' will be deleted.';
  var m = _annotEl('upl-annot-clear-modal');
  if (m) m.classList.remove('hidden');
}

function _uplAnnotCancelClearModal() {
  var m = _annotEl('upl-annot-clear-modal');
  if (m) m.classList.add('hidden');
}

async function _uplAnnotDoClearAll() {
  _uplAnnotCancelClearModal();
  if (!_uplAnnotFile) return;
  try {
    var r = await fetch(_annotUrl('/annotations'), {
      method: 'DELETE', credentials: 'same-origin',
    });
    if (!r.ok) throw new Error('Server returned ' + r.status);
    _uplAnnotState.annots = [];
    _annotEl('upl-annot-overlay').innerHTML = '';
    _uplShowToast('All annotations cleared.');
  } catch (err) {
    _uplShowToast('Clear failed: ' + err.message, true);
  }
}

// ── Pen colour picker ────────────────────────────────────────────────────

function _uplAnnotPenColor(hex) {
  _uplAnnotPenState.color = hex;
  // Update swatch ring: highlight selected
  var swatches = document.querySelectorAll('.upl-annot-pen-swatch');
  for (var i = 0; i < swatches.length; i++) {
    var s = swatches[i];
    if (s.dataset.color === hex) {
      s.style.borderColor = '#fff';
      s.style.outline = '2px solid ' + hex;
      s.style.outlineOffset = '2px';
    } else {
      s.style.borderColor = 'transparent';
      s.style.outline = 'none';
    }
  }
}

/** Set pen stroke size (px at scale=1). Updates active size-button highlight. */
function _uplAnnotPenSize(px) {
  _uplAnnotPenState.size = px;
  var btns = document.querySelectorAll('.upl-annot-pen-size-btn');
  for (var i = 0; i < btns.length; i++) {
    var b = btns[i];
    if (parseFloat(b.dataset.size) === px) {
      b.style.borderColor = '#ffc220';
      b.style.color = '#ffc220';
    } else {
      b.style.borderColor = '';
      b.style.color = '';
    }
  }
}

// ── Pen drawing engine ────────────────────────────────────────────────────

function _uplAnnotPenPt(e) {
  var dc = _annotEl('upl-annot-draw-canvas');
  var r  = dc.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width,
    y: (e.clientY - r.top)  / r.height,
  };
}

function _uplAnnotPenDown(e) {
  e.preventDefault();
  var dc = _annotEl('upl-annot-draw-canvas');
  if (!dc) return;
  dc.setPointerCapture(e.pointerId);
  _uplAnnotPenState.drawing = true;
  _uplAnnotPenState.points  = [_uplAnnotPenPt(e)];
  _uplAnnotPenRedraw();
}

function _uplAnnotPenMove(e) {
  if (!_uplAnnotPenState.drawing) return;
  e.preventDefault();
  _uplAnnotPenState.points.push(_uplAnnotPenPt(e));
  _uplAnnotPenRedraw();
}

async function _uplAnnotPenUp(e) {
  if (!_uplAnnotPenState.drawing) return;
  _uplAnnotPenState.drawing = false;
  var pts = _uplAnnotPenState.points;
  _uplAnnotPenState.points = [];
  // Clear draw canvas preview
  var dc = _annotEl('upl-annot-draw-canvas');
  if (dc) dc.getContext('2d').clearRect(0, 0, dc.width, dc.height);
  if (pts.length < 2 || !_uplAnnotFile) return;
  // Serialise as JSON {pts, size} — full-page bounding box (x,y,w,h all 0/1)
  try {
    var body = {
      page_num:   _uplAnnotState.page,
      type:       'pen',
      x_pct:      0, y_pct:     0,
      width_pct:  1, height_pct: 1,
      color:      _uplAnnotPenState.color,
      content:    JSON.stringify({ pts: pts, size: _uplAnnotPenState.size }),
    };
    var res = await _annotReq(_annotUrl('/annotations'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (res && res.id) {
      body.id = res.id;
      _uplAnnotState.annots.push(body);
      _uplAnnotDrawOverlay();
    }
  } catch (err) {
    _uplShowToast('Pen save failed: ' + err.message, true);
  }
}

function _uplAnnotPenStop() {
  _uplAnnotPenState.drawing = false;
  _uplAnnotPenState.points  = [];
  var dc = _annotEl('upl-annot-draw-canvas');
  if (dc) {
    var ctx = dc.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, dc.width, dc.height);
    dc.removeEventListener('pointerdown',  _uplAnnotPenDown);
    dc.removeEventListener('pointermove',  _uplAnnotPenMove);
    dc.removeEventListener('pointerup',    _uplAnnotPenUp);
    dc.removeEventListener('pointerleave', _uplAnnotPenUp);
    dc.style.pointerEvents = 'none';
  }
}

function _uplAnnotPenRedraw() {
  var dc = _annotEl('upl-annot-draw-canvas');
  if (!dc) return;
  var ctx = dc.getContext('2d');
  ctx.clearRect(0, 0, dc.width, dc.height);
  var pts = _uplAnnotPenState.points;
  if (pts.length < 2) return;
  // Scale stroke width to match current zoom (size is in points at scale=1)
  ctx.strokeStyle = _uplAnnotPenState.color;
  ctx.lineWidth   = _uplAnnotPenState.size * (_uplAnnotScale || 1);
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x * dc.width, pts[0].y * dc.height);
  for (var i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x * dc.width, pts[i].y * dc.height);
  }
  ctx.stroke();
}

// ── Read-only PDF+annotation viewer (used by file viewer modal) ───────────────

/**
 * Render a PDF into `containerEl` using PDF.js with read-only annotation overlays.
 * Called by _uplFileViewerOpen when opening a PDF in the viewer modal.
 * Returns a cleanup function to call when the viewer closes.
 *
 * G12: We never use <embed> for PDFs — browser rotation state persists across
 * opens and annotations can’t overlay an <embed>. Canvas via PDF.js solves both.
 */
function _uplAnnotPdfViewer(f, containerEl, pid) {
  var pdfDoc  = null;
  var curPage = 0;
  var annots  = [];
  var scale   = 1.5;
  var stopped = false;

  containerEl.innerHTML =
    '<div style="display:flex;flex-direction:column;height:100%;">' +
    '  <div id="_av-toolbar" style="display:flex;align-items:center;gap:6px;' +
    '       padding:6px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;flex-shrink:0;">' +
    '    <button id="_av-prev" onclick="_avNav(-1)" style="' + _AV_BTN + '">&#8249;</button>' +
    '    <span id="_av-label" style="font-size:11px;color:#6b7280;white-space:nowrap">Page 1</span>' +
    '    <button id="_av-next" onclick="_avNav(1)"  style="' + _AV_BTN + '">&#8250;</button>' +
    '    <span style="flex:1"></span>' +
    '    <button onclick="_avZoom(-0.25)" style="' + _AV_BTN + '">&#8722;</button>' +
    '    <span id="_av-zoom" style="font-size:11px;color:#6b7280;min-width:36px;text-align:center;">150%</span>' +
    '    <button onclick="_avZoom(0.25)"  style="' + _AV_BTN + '">&#43;</button>' +
    '    <button onclick="_avFit()"        style="' + _AV_BTN + '" title="AutoFit to window">&#8633; AutoFit</button>' +
    '  </div>' +
    '  <div id="_av-scroll" style="flex:1;overflow:auto;background:#525659;display:flex;' +
    '       justify-content:center;align-items:flex-start;padding:12px;">' +
    '    <div id="_av-wrap" style="position:relative;display:inline-block;">' +
    '      <canvas id="_av-canvas" style="display:block;"></canvas>' +
    '      <div id="_av-overlay" style="position:absolute;inset:0;pointer-events:none;"></div>' +
    '    </div>' +
    '  </div>' +
    '  <div id="_av-err" style="display:none;color:#ef4444;font-size:12px;padding:12px;"></div>' +
    '</div>';

  function avEl(id) { return document.getElementById(id); }

  function avErr(msg) {
    var e = avEl('_av-err'); if (e) { e.style.display='block'; e.textContent = msg; }
  }

  function avRenderPage(n) {
    if (!pdfDoc || stopped) return;
    curPage = Math.max(0, Math.min(n, pdfDoc.numPages - 1));
    pdfDoc.getPage(curPage + 1).then(function(pg) {
      var vp = pg.getViewport({ scale: scale });
      var cv = avEl('_av-canvas');
      if (!cv || stopped) return;
      cv.width  = vp.width;
      cv.height = vp.height;
      pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(function() {
        var lbl = avEl('_av-label');
        if (lbl) lbl.textContent = 'Page ' + (curPage + 1) + ' / ' + pdfDoc.numPages;
        avDrawOverlay();
      });
    });
  }

  function avDrawOverlay() {
    var ov = avEl('_av-overlay');
    if (!ov) return;
    ov.innerHTML = '';
    for (var i = 0; i < annots.length; i++) {
      if (annots[i].page_num === curPage) ov.appendChild(avMakeDiv(annots[i]));
    }
  }

  function avMakeDiv(a) {
    var d = document.createElement('div');
    d.style.cssText =
      'position:absolute;left:' + (a.x_pct*100) + '%;top:' + (a.y_pct*100) + '%;' +
      'width:' + (a.width_pct*100) + '%;height:' + (a.height_pct*100) + '%;' +
      'box-sizing:border-box;pointer-events:none;';
    if (a.type === 'highlight') {
      d.style.background = 'rgba(255,194,32,0.38)';
    } else if (a.type === 'sticky') {
      d.style.cssText += 'display:flex;flex-direction:column;border-radius:2px 8px 8px 8px;' +
        'overflow:hidden;box-shadow:3px 4px 10px rgba(0,0,0,0.25);transform:rotate(-1.2deg);' +
        'background:#fef3c7;';
      var hdr = document.createElement('div');
      hdr.style.cssText='background:#f59e0b;padding:2px 4px;font-size:11px;flex-shrink:0;';
      hdr.textContent = '\uD83D\uDCCC';
      d.appendChild(hdr);
      var body = document.createElement('div');
      body.style.cssText='flex:1;overflow:hidden;padding:3px 5px;font-size:12px;color:#1a1a1a;white-space:pre-wrap;word-break:break-word;';
      body.textContent = a.content || '';
      d.appendChild(body);
    } else if (a.type === 'pen') {
      d.style.pointerEvents = 'none';
      d.style.overflow = 'visible';
      try {
        var penData2 = JSON.parse(a.content || '[]');
        var pts2  = Array.isArray(penData2) ? penData2 : (penData2.pts || []);
        var sw2   = Array.isArray(penData2) ? 3 : (penData2.size || 3);
        var swN2  = sw2 / 750;
        if (pts2.length > 1) {
          var ns2 = 'http://www.w3.org/2000/svg';
          var svg2 = document.createElementNS(ns2, 'svg');
          svg2.setAttribute('viewBox', '0 0 1 1');
          svg2.setAttribute('preserveAspectRatio', 'none');
          svg2.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;';
          var pl2 = document.createElementNS(ns2, 'polyline');
          pl2.setAttribute('points', pts2.map(function(p) { return p.x + ',' + p.y; }).join(' '));
          pl2.setAttribute('fill', 'none');
          pl2.setAttribute('stroke', a.color || '#111111');
          pl2.setAttribute('stroke-width', String(swN2));
          pl2.setAttribute('stroke-linecap', 'round');
          pl2.setAttribute('stroke-linejoin', 'round');
          svg2.appendChild(pl2);
          d.appendChild(svg2);
        }
      } catch (_) {}
    } else {
      var txBg = (a.color === 'transparent') ? 'transparent' : 'white';
      d.style.cssText += 'border:1.5px solid #0053e2;border-radius:4px;background:' + txBg + ';' +
        'display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,83,226,0.18);';
      var txHdr = document.createElement('div');
      txHdr.style.cssText='background:rgba(0,83,226,0.08);border-bottom:1px solid rgba(0,83,226,0.2);padding:2px 4px;flex-shrink:0;min-height:20px;';
      d.appendChild(txHdr);
      var txBody = document.createElement('div');
      txBody.style.cssText='flex:1;overflow:hidden;padding:3px 5px;font-size:12px;color:#1a1a1a;white-space:pre-wrap;word-break:break-word;';
      txBody.textContent = a.content || '';
      d.appendChild(txBody);
    }
    return d;
  }

  // Expose nav + zoom + fit as globals so inline onclick works
  window._avNav  = function(d) { avRenderPage(curPage + d); };
  window._avZoom = function(d) {
    scale = Math.max(0.5, Math.min(3.0, scale + d));
    var zl = avEl('_av-zoom'); if (zl) zl.textContent = Math.round(scale*100) + '%';
    avRenderPage(curPage);
  };
  window._avFit  = function() {
    if (!pdfDoc) return;
    pdfDoc.getPage(curPage + 1).then(function(pg) {
      var vp   = pg.getViewport({ scale: 1 });
      var scrl = avEl('_av-scroll');
      // 2×12px padding each axis
      var aw = scrl ? (scrl.clientWidth  - 24) : 600;
      var ah = scrl ? (scrl.clientHeight - 24) : 800;
      scale  = Math.max(0.25, Math.min(aw / vp.width, ah / vp.height));
      var zl = avEl('_av-zoom'); if (zl) zl.textContent = Math.round(scale*100) + '%';
      avRenderPage(curPage);
    });
  };

  // Bootstrap: load PDF.js, fetch PDF bytes, load annotations
  var fUrl = '/uploads/' + encodeURIComponent(f.filename) + '?v=' + Date.now();
  var annotUrl = '/home/uploads/' + pid + '/files/page/' + f.id + '/annotations';

  _uplAnnotLoadLibs().then(function() {
    var opts = { url: fUrl, withCredentials: false };
    return window.pdfjsLib.getDocument(opts).promise;
  }).then(function(doc) {
    if (stopped) return;
    pdfDoc = doc;
    return avRenderPage(0);
  }).catch(function(err) {
    avErr('Could not load PDF: ' + err.message);
  });

  // Fetch annotations (best-effort, don’t block PDF render)
  fetch(annotUrl, { credentials: 'same-origin' }).then(function(r) {
    if (!r.ok || stopped) return;
    return r.json().then(function(d) {
      annots = (d && d.annotations) ? d.annotations : [];
      avDrawOverlay();
    });
  }).catch(function() {});

  // Return cleanup function — called by _uplFileViewerClose
  return function() { stopped = true; pdfDoc = null; delete window._avNav; delete window._avZoom; delete window._avFit; };
}
