/**
 * tutorial-importer.js
 * Handles the Tutorial Import modal — open/close, file preview,
 * workspace picker, submit, and result handling.
 *
 * Rules: all var (no let/const), HTMX-safe globals on window.
 * Loaded via <script src> in index.html with ?v={{ static_v }}.
 */

/* ── Open / Close ──────────────────────────────────────────────────────────── */

function openTutorialImportModal() {
  var modal = document.getElementById('tutorial-import-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  _tutLoadWorkspacePicker();
  // Focus first focusable element (WCAG 2.2)
  var first = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (first) { setTimeout(function() { first.focus(); }, 50); }
}

function closeTutorialImportModal() {
  var modal = document.getElementById('tutorial-import-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  // Reset all fields
  var paste = document.getElementById('tut-html-paste');
  if (paste) paste.value = '';
  var fileInput = document.getElementById('tut-html-file');
  if (fileInput) fileInput.value = '';
  var fileName = document.getElementById('tut-file-name');
  if (fileName) fileName.textContent = 'No file chosen';
  var titleInput = document.getElementById('tut-course-title');
  if (titleInput) titleInput.value = '';
  var status = document.getElementById('tut-import-status');
  if (status) { status.classList.add('hidden'); status.textContent = ''; }
  var btn = document.getElementById('tut-import-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Import Course'; }
  // Reset to paste mode
  _tutToggleInput('paste');
}

/* ── Input mode toggle ─────────────────────────────────────────────────────── */

function _tutToggleInput(mode) {
  var pasteArea = document.getElementById('tut-paste-area');
  var fileArea  = document.getElementById('tut-file-area');
  var btnPaste  = document.getElementById('tut-btn-paste');
  var btnFile   = document.getElementById('tut-btn-file');
  if (!pasteArea || !fileArea) return;

  var activeClass   = 'bg-[#0053e2] text-white border-[#0053e2]';
  var inactiveClass = 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800';

  if (mode === 'paste') {
    pasteArea.classList.remove('hidden');
    fileArea.classList.add('hidden');
    _tutSwapClasses(btnPaste, inactiveClass, activeClass);
    _tutSwapClasses(btnFile,  activeClass,   inactiveClass);
  } else {
    pasteArea.classList.add('hidden');
    fileArea.classList.remove('hidden');
    _tutSwapClasses(btnFile,  inactiveClass, activeClass);
    _tutSwapClasses(btnPaste, activeClass,   inactiveClass);
  }
}

function _tutSwapClasses(el, remove, add) {
  if (!el) return;
  remove.split(' ').forEach(function(c) { if (c) el.classList.remove(c); });
  add.split(' ').forEach(function(c) { if (c) el.classList.add(c); });
}

function _tutOnFileChange(input) {
  var label = document.getElementById('tut-file-name');
  if (!label) return;
  label.textContent = (input.files && input.files[0]) ? input.files[0].name : 'No file chosen';
}

/* ── Workspace picker ──────────────────────────────────────────────────────── */

function _tutLoadWorkspacePicker() {
  var sel = document.getElementById('tut-parent-ws');
  if (!sel) return;
  // Only fetch once per modal open (reset happens in close)
  if (sel.dataset.loaded === '1') return;

  fetch('/home/workspaces-for-picker', { credentials: 'same-origin' })
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(items) {
      // Remove existing dynamic options, keep the first "Root level" option
      while (sel.options.length > 1) sel.remove(1);
      (items || []).forEach(function(ws) {
        var opt = document.createElement('option');
        opt.value = ws.id;
        opt.textContent = (ws.emoji ? ws.emoji + ' ' : '') + ws.name;
        sel.appendChild(opt);
      });
      sel.dataset.loaded = '1';
    })
    .catch(function() { /* silently ignore — Root level option is still usable */ });
}

/* ── Submit ────────────────────────────────────────────────────────────────── */

function _tutImport() {
  var btn      = document.getElementById('tut-import-btn');
  var pasteEl  = document.getElementById('tut-html-paste');
  var fileEl   = document.getElementById('tut-html-file');
  var titleEl  = document.getElementById('tut-course-title');
  var parentEl = document.getElementById('tut-parent-ws');
  var fileArea = document.getElementById('tut-file-area');
  if (!btn) return;

  // Disable button + show spinner
  btn.disabled = true;
  btn.textContent = 'Importing\u2026';
  _tutShowStatus('', false);

  var fd = new FormData();

  // Decide mode by which area is visible
  var isFileMode = fileArea && !fileArea.classList.contains('hidden');
  if (isFileMode && fileEl && fileEl.files && fileEl.files[0]) {
    fd.append('html_file', fileEl.files[0]);
  } else {
    fd.append('html_content', pasteEl ? pasteEl.value : '');
  }

  fd.append('course_title', titleEl ? titleEl.value.trim() : '');
  fd.append('parent_ws_id', parentEl ? parentEl.value : '0');

  fetch('/tutorials/import-html', {
    method: 'POST',
    body: fd,
    credentials: 'same-origin',
  })
  .then(function(response) {
    // Session-expiry guard: a 302 redirect returns HTML, not JSON.
    if (response.redirected || !response.headers.get('content-type') || response.headers.get('content-type').indexOf('application/json') === -1) {
      // Likely session expired
      btn.disabled = false;
      btn.textContent = 'Import Course';
      _tutShowStatus('Session expired \u2014 please refresh the page and log in again.', true);
      return null;
    }
    return response.json().then(function(data) {
      return { ok: response.ok, status: response.status, data: data };
    });
  })
  .then(function(result) {
    if (!result) return;
    if (!result.ok) {
      // Error (422, 413, 401, etc.)
      btn.disabled = false;
      btn.textContent = 'Import Course';
      var msg = (result.data && result.data.detail) ? result.data.detail : 'Import failed (HTTP ' + result.status + ')';
      _tutShowStatus(msg, true);
      return;
    }
    // Success!
    var d = result.data;
    closeTutorialImportModal();

    // Navigate to the new workspace
    if (typeof wsSingleClick === 'function' && d.workspace_id) {
      wsSingleClick(d.workspace_id);
    }

    // Show toast
    var toastMsg = '\u2705 Imported ' + d.cards_created + ' lesson' + (d.cards_created !== 1 ? 's' : '') + ' from \u201c' + d.course_name + '\u201d';
    if (typeof _showBwToast === 'function') {
      _showBwToast(toastMsg, 4000);
    } else if (typeof _showReminderToast === 'function') {
      _showReminderToast(toastMsg);
    }

    // Show warnings in a temporary banner if any
    if (d.warnings && d.warnings.length > 0) {
      setTimeout(function() {
        var warn = d.warnings.join('\n\u2022 ');
        console.warn('[Tutorial Importer] warnings:\n\u2022 ' + warn);
      }, 500);
    }
  })
  .catch(function(err) {
    btn.disabled = false;
    btn.textContent = 'Import Course';
    _tutShowStatus('Network error: ' + (err.message || 'unknown'), true);
  });
}

/* ── Status display ────────────────────────────────────────────────────────── */

function _tutShowStatus(msg, isError) {
  var el = document.getElementById('tut-import-status');
  if (!el) return;
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
  // Colour
  el.classList.remove('text-[#ea1100]', 'text-[#2a8703]', 'text-gray-600', 'dark:text-zinc-300');
  if (isError) {
    el.classList.add('text-[#ea1100]');
  } else {
    el.classList.add('text-[#2a8703]');
  }
}
