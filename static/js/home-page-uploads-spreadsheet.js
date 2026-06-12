/* home-page-uploads-spreadsheet.js — In-browser XLSX/CSV editor (BookWorm).
   Uses Jspreadsheet CE + SheetJS, both loaded lazily from CDN at first open.
   Depends on: _uplPid, _uplFiles, _uplDocCurrentFile, _uplEsc, _uplShowToast.
   Loaded AFTER home-page-uploads-wopi.js (see base.html).
*/
'use strict';

// ── Module state ──────────────────────────────────────────────────────────────
var _uplSsFile        = null;   // current file object
var _uplSsGridEl      = null;   // #upl-ss-grid DOM element (jspreadsheet instance attached)
var _uplSsLibsLoaded  = false;  // true once CDN scripts have resolved
var _uplSsLibsPromise = null;   // cached Promise — avoids re-injection on re-open
var _uplSsBusy        = false;  // save guard

var _XLSX_MIME_SS = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Jspreadsheet CE v5 renamed the element instance property jexcel → jspreadsheet.
// This helper returns whichever is defined, keeping destroy + getData working on both v4 and v5.
function _uplSsInstance() {
  return _uplSsGridEl && (_uplSsGridEl.jspreadsheet || _uplSsGridEl.jexcel || null);
}

// CDN URLs pinned to major versions (not 'latest') for stability
var _SS_JSUITES_JS  = 'https://cdn.jsdelivr.net/npm/jsuites@5/dist/jsuites.js';
var _SS_JSUITES_CSS = 'https://cdn.jsdelivr.net/npm/jsuites@5/dist/jsuites.css';
var _SS_JSP_JS      = 'https://cdn.jsdelivr.net/npm/jspreadsheet-ce@5/dist/index.js';
var _SS_JSP_CSS     = 'https://cdn.jsdelivr.net/npm/jspreadsheet-ce@5/dist/jspreadsheet.css';
var _SS_XLSX_JS     = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

// ── CDN loaders ───────────────────────────────────────────────────────────────

function _uplSsLoadScript(url) {
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = url;
    s.onload  = resolve;
    s.onerror = function() { reject(new Error('Failed to load: ' + url)); };
    document.head.appendChild(s);
  });
}

function _uplSsLoadStyle(url) {
  return new Promise(function(resolve) {
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = url;
    l.onload = resolve;
    l.onerror = resolve; // CSS failures are non-fatal (degraded styling only)
    document.head.appendChild(l);
  });
}

// Jspreadsheet CE has a hard runtime dep on Jsuites — order is critical.
function _uplSsLoadLibs() {
  if (_uplSsLibsPromise) return _uplSsLibsPromise;
  _uplSsLibsPromise = _uplSsLoadScript(_SS_JSUITES_JS)
    .then(function() { return _uplSsLoadStyle(_SS_JSUITES_CSS); })
    .then(function() { return _uplSsLoadScript(_SS_JSP_JS); })
    .then(function() { return _uplSsLoadStyle(_SS_JSP_CSS); })
    .then(function() { return _uplSsLoadScript(_SS_XLSX_JS); })
    .then(function() { _uplSsLibsLoaded = true; });
  return _uplSsLibsPromise;
}

// ── Open ──────────────────────────────────────────────────────────────────────

function _uplSsOpen(f) {
  _uplSsFile = f;
  var modal = document.getElementById('upl-spreadsheet-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.focus();
  // Reset to loading state
  var load = document.getElementById('upl-ss-loading');
  var grid = document.getElementById('upl-ss-grid');
  var err  = document.getElementById('upl-ss-error');
  var btn  = document.getElementById('upl-ss-save-btn');
  var fn   = document.getElementById('upl-ss-filename');
  if (load) load.classList.remove('hidden');
  if (grid) grid.classList.add('hidden');
  if (err)  err.classList.add('hidden');
  if (btn)  btn.classList.add('hidden');
  if (fn)   fn.textContent = f.original_name || f.filename || '';

  _uplSsLoadLibs()
    .then(function() { return _uplSsRender(f); })
    .catch(function(e) { _uplSsShowError('Could not load spreadsheet libraries: ' + String(e)); });
}

// ── Render ────────────────────────────────────────────────────────────────────

function _uplSsRender(f) {
  return fetch('/uploads/' + encodeURIComponent(f.filename))
    .then(function(r) {
      if (!r.ok) throw new Error('Could not fetch file (' + r.status + ')');
      return r.arrayBuffer();
    })
    .then(function(ab) {
      var wb = XLSX.read(new Uint8Array(ab), { type: 'array' });
      if (wb.SheetNames.length > 1) {
        _uplShowToast('Showing sheet 1 of ' + wb.SheetNames.length + '. Save keeps only this sheet.');
      }
      var ws   = wb.Sheets[wb.SheetNames[0]];
      var data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      // Destroy old instance if any
      _uplSsGridEl = document.getElementById('upl-ss-grid');
      var _prevInst = _uplSsInstance();
      if (_prevInst) {
        try { _prevInst.destroy ? _prevInst.destroy() : jspreadsheet.destroy(_uplSsGridEl); } catch(_) {}
      }
      if (_uplSsGridEl) _uplSsGridEl.innerHTML = '';

      jspreadsheet(_uplSsGridEl, {
        data: data.length ? data : [[]],
        minDimensions: [26, 50],
        tableOverflow: true,
        tableWidth: '100%',
        tableHeight: '100%',
      });

      var load = document.getElementById('upl-ss-loading');
      var grid = document.getElementById('upl-ss-grid');
      var btn  = document.getElementById('upl-ss-save-btn');
      if (load) load.classList.add('hidden');
      if (grid) grid.classList.remove('hidden');
      if (btn)  btn.classList.remove('hidden');
    })
    .catch(function(e) { _uplSsShowError(String(e)); });
}

// ── Error helper ──────────────────────────────────────────────────────────────

function _uplSsShowError(msg) {
  var load = document.getElementById('upl-ss-loading');
  var grid = document.getElementById('upl-ss-grid');
  var err  = document.getElementById('upl-ss-error');
  var em   = document.getElementById('upl-ss-error-msg');
  if (load) load.classList.add('hidden');
  if (grid) grid.classList.add('hidden');
  if (em)   em.textContent = msg;
  if (err)  err.classList.remove('hidden');
}

// ── Close ─────────────────────────────────────────────────────────────────────

function _uplSsClose() {
  var _inst = _uplSsInstance();
  if (_inst) {
    try { _inst.destroy ? _inst.destroy() : jspreadsheet.destroy(_uplSsGridEl); } catch(_) {}
  }
  if (_uplSsGridEl) _uplSsGridEl.innerHTML = '';
  _uplSsGridEl = null;
  _uplSsFile   = null;
  // _uplSsBusy intentionally NOT reset here — .finally() in _uplSsSave is the sole owner.
  // Resetting here would race with an in-flight save.

  var modal = document.getElementById('upl-spreadsheet-modal');
  if (modal) modal.classList.add('hidden');

  // Reset to loading state for next open
  var load = document.getElementById('upl-ss-loading');
  var grid = document.getElementById('upl-ss-grid');
  var err  = document.getElementById('upl-ss-error');
  var btn  = document.getElementById('upl-ss-save-btn');
  if (load) load.classList.remove('hidden');
  if (grid) grid.classList.add('hidden');
  if (err)  err.classList.add('hidden');
  if (btn)  btn.classList.add('hidden');
}

// ── Save ──────────────────────────────────────────────────────────────────────

function _uplSsSave() {
  if (_uplSsBusy) return;
  var _inst = _uplSsInstance();
  if (!_inst || !_uplSsFile) return;

  _uplSsBusy = true;
  var btn = document.getElementById('upl-ss-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  var rows = _inst.getData(false);
  var bytes, fmt;

  try {
    if (_uplSsFile.mime_type === _XLSX_MIME_SS) {
      var ws  = XLSX.utils.aoa_to_sheet(rows);
      var wb  = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      var arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      bytes   = new Uint8Array(arr);
      fmt     = 'xlsx';
    } else {
      var ws2    = XLSX.utils.aoa_to_sheet(rows);
      var csvStr = XLSX.utils.sheet_to_csv(ws2);
      bytes      = new TextEncoder().encode(csvStr);
      fmt        = 'csv';
    }
  } catch(e) {
    _uplShowToast('Serialize failed: ' + _uplEsc(String(e)));
    _uplSsBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = '\ud83d\udcbe Save'; }
    return;
  }

  // Chunked base64 — avoids stack-overflow on large arrays
  var binary = '';
  var CHUNK  = 8192;
  for (var i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  var b64 = btoa(binary);

  var fileRef = _uplSsFile; // capture before async
  fetch('/home/uploads/' + _uplPid + '/files/page/' + fileRef.id + '/spreadsheet', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_b64: b64, format: fmt }),
  })
  .then(function(r) {
    var ct = r.headers.get('content-type') || '';
    if (ct.includes('text/html')) throw new Error('Session expired \u2014 please refresh.');
    if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || r.status); });
    return r.json();
  })
  .then(function(data) {
    var cached = _uplFiles.find(function(x) { return x.src === fileRef.src && x.id === fileRef.id; });
    if (cached) cached.size = data.size;
    if (_uplDocCurrentFile) _uplDocCurrentFile.size = data.size;
    _uplShowToast('Spreadsheet saved \u2713');
    _uplSsClose();
  })
  .catch(function(e) {
    _uplShowToast('Save failed: ' + _uplEsc(String(e)));
    if (btn) { btn.disabled = false; btn.textContent = '\ud83d\udcbe Save'; }
  })
  .finally(function() { _uplSsBusy = false; });
}
