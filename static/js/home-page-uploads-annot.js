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

    // Fetch PDF bytes via the existing auth-gated download route (Quirk #18)
    var dlUrl = '/home/uploads/' + _uplPid + '/files/' + f.src + '/' + f.id + '/download';
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

  } else {
    // ── Text box: thin header toolbar + editable body ────────────────────
    var txBg = (a.color === 'transparent') ? 'transparent' : 'white';
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
  overlay.removeEventListener('click',     _uplAnnotHandleOverlayClick);
  overlay.removeEventListener('mousedown', _uplAnnotOverlayMd);

  _uplAnnotState.tool = (_uplAnnotState.tool === type) ? null : type;

  if (_uplAnnotState.tool) {
    // G10: flip overlay to auto only when tool is active
    overlay.style.pointerEvents = 'auto';
    overlay.style.cursor = 'crosshair';
    // G11: track mousedown origin so drag-release-outside-textarea
    // doesn't accidentally fire a new annotation
    overlay.addEventListener('mousedown', _uplAnnotOverlayMd);
    overlay.addEventListener('click',     _uplAnnotHandleOverlayClick);
  } else {
    overlay.style.pointerEvents = 'none';
    overlay.style.cursor = 'default';
  }

  _uplAnnotDeactivateTools();
  if (_uplAnnotState.tool) {
    var btn = _annotEl('upl-annot-tool-' + _uplAnnotState.tool);
    if (btn) {
      btn.classList.add('border-[#ffc220]', 'text-[#ffc220]');
      btn.setAttribute('aria-pressed', 'true');
    }
  }
}

function _uplAnnotDeactivateTools() {
  var types = ['highlight', 'sticky', 'textbox'];
  for (var i = 0; i < types.length; i++) {
    var b = _annotEl('upl-annot-tool-' + types[i]);
    if (!b) continue;
    b.classList.remove('border-[#ffc220]', 'text-[#ffc220]');
    b.setAttribute('aria-pressed', 'false');
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

/** Public — called by the "🗑 Clear All" toolbar button. */
async function _uplAnnotClearAll() {
  if (!_uplAnnotFile) return;
  var count = _uplAnnotState.annots.length;
  if (count === 0) { _uplShowToast('No annotations to clear.'); return; }
  if (!confirm('Delete all ' + count + ' annotation' + (count !== 1 ? 's' : '') +
               ' on this PDF? This cannot be undone.')) return;
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
    '    <span id="_av-zoom" style="font-size:11px;color:#6b7280">150%</span>' +
    '    <button onclick="_avZoom(0.25)"  style="' + _AV_BTN + '">&#43;</button>' +
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

  // Expose nav + zoom as globals so inline onclick works
  window._avNav  = function(d) { avRenderPage(curPage + d); };
  window._avZoom = function(d) {
    scale = Math.max(0.5, Math.min(3.0, scale + d));
    var zl = avEl('_av-zoom'); if (zl) zl.textContent = Math.round(scale*100) + '%';
    avRenderPage(curPage);
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
  return function() { stopped = true; pdfDoc = null; delete window._avNav; delete window._avZoom; };
}
