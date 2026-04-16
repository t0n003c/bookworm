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
  } else {
    wrap.style.borderRadius = '6px';
    wrap.style.padding      = '4px';
    wrap.style.overflow     = 'hidden';
    if (a.type === 'sticky') {
      wrap.style.background = '#ffc220';
    } else {
      wrap.style.background = 'white';
      wrap.style.border     = '1.5px solid #0053e2';
      wrap.style.borderRadius = '4px';
    }
    wrap.appendChild(_uplAnnotMakeTextarea(a));
  }

  // Delete button — shown on hover
  var del = document.createElement('button');
  del.type = 'button';
  del.textContent = '\u2715';
  del.setAttribute('aria-label', 'Delete annotation');
  del.style.cssText =
    'position:absolute;top:2px;right:2px;font-size:9px;line-height:1;' +
    'padding:1px 4px;background:rgba(0,0,0,0.45);color:white;' +
    'border:none;border-radius:3px;cursor:pointer;opacity:0;transition:opacity .15s;';
  del.onclick = function(e) { e.stopPropagation(); _uplAnnotDelete(a.id); };
  wrap.appendChild(del);

  wrap.onmouseenter = function() { del.style.opacity = '1'; };
  wrap.onmouseleave = function() { del.style.opacity = '0'; };

  return wrap;
}

function _uplAnnotMakeTextarea(a) {
  var ta = document.createElement('textarea');
  ta.value = a.content || '';
  ta.setAttribute('aria-label', 'Annotation text');
  ta.style.cssText =
    'width:100%;height:100%;border:none;outline:none;resize:none;' +
    'background:transparent;font-size:11px;font-family:inherit;' +
    'line-height:1.4;padding:0;margin:0;overflow:hidden;';
  ta.onclick = function(e) { e.stopPropagation(); };
  ta.onblur  = function() { _uplAnnotSave(a.id, ta.value, a); };
  return ta;
}

// ── Tool mode ─────────────────────────────────────────────────────────────────

/** Toggle a tool on/off. Clicking the active tool deactivates it. */
function _uplAnnotAddMode(type) {
  var overlay = _annotEl('upl-annot-overlay');
  overlay.removeEventListener('click', _uplAnnotHandleOverlayClick);

  _uplAnnotState.tool = (_uplAnnotState.tool === type) ? null : type;

  if (_uplAnnotState.tool) {
    // G10: flip overlay to auto only when tool is active
    overlay.style.pointerEvents = 'auto';
    overlay.style.cursor = 'crosshair';
    overlay.addEventListener('click', _uplAnnotHandleOverlayClick);
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

async function _uplAnnotHandleOverlayClick(e) {
  var tool = _uplAnnotState.tool;
  if (!tool || _uplAnnotState.busy || !_uplAnnotFile) return;
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
      color: '#ffc220', content: '',
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
