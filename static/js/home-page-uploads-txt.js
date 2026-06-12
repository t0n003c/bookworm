// ── home-page-uploads-txt.js — Notepad++-like text editor ─────────────────────
// Companion to home-page-uploads-docs.js.
// Provides a full-screen code editor with: line numbers, find bar, status bar,
// Tab/Enter smart handling, font-size zoom, word-wrap toggle, Ctrl+S / Ctrl+F.
// Always uses a VSCode-dark editor surface so syntax colours pop regardless of
// the app's light/dark theme. Toolbar + chrome follow the app theme.

/* ── State ── */
var _uplTxtFontSz  = 13;    // current editor font-size in px
var _uplTxtWrapOn  = false;  // word-wrap state
var _uplTxtMatches = [];     // [{start}] from find
var _uplTxtMatchI  = -1;     // current match index

/* ── Language detection (extension → hljs alias + display label) ── */
var _UPL_TXT_LANG = {
  js:'javascript', mjs:'javascript', cjs:'javascript',
  ts:'typescript', tsx:'typescript', jsx:'javascript',
  py:'python', rb:'ruby', php:'php', java:'java',
  cs:'csharp', cpp:'cpp', cc:'cpp', c:'c', h:'c',
  go:'go', rs:'rust', kt:'kotlin', swift:'swift',
  html:'html', htm:'html', xml:'xml', svg:'xml',
  css:'css', scss:'scss', less:'less',
  json:'json', yaml:'yaml', yml:'yaml',
  sh:'bash', bash:'bash', zsh:'bash', ps1:'powershell',
  sql:'sql', md:'markdown', markdown:'markdown',
  ini:'ini', toml:'toml', r:'r', m:'matlab',
  txt:'plaintext', log:'plaintext', csv:'plaintext',
};

function _uplTxtLabel(ext) {
  var l = _UPL_TXT_LANG[ext] || ext || 'text';
  return l.charAt(0).toUpperCase() + l.slice(1);
}

/* ── Entry points ── */

/** Called from Doc Studio "✏️ Edit" button — opens viewer modal + editor. */
async function _uplTxtEditorOpen(f) {
  await _uplFileViewerOpen(f);   // loads content, stores _uplViewerRawText
  _uplTxtEditorMount();
}

/** Mount the Notepad++ editor into #upl-viewer-html.
 *  Works whether called from Studio open or from the view-mode "Edit" footer. */
function _uplTxtEditorMount() {
  var htmlEl = document.getElementById('upl-viewer-html');
  var f = _uplViewerCurrentFile;
  if (!htmlEl || !f || _uplViewerRawText === null) return;

  var ext   = (f.original_name || '').split('.').pop().toLowerCase();
  var label = _uplTxtLabel(ext);

  // Reset editor-level state
  _uplTxtFontSz  = 13;
  _uplTxtWrapOn  = false;
  _uplTxtMatches = [];
  _uplTxtMatchI  = -1;

  htmlEl.className   = 'bw-txt-host';
  htmlEl.style.cssText = '';
  htmlEl.innerHTML =
    '<div class="bw-txt-toolbar">' + _uplTxtToolbarHtml(label) + '</div>' +
    '<div class="bw-txt-editor-wrap">' +
      '<div class="bw-txt-gutter" id="bw-txt-gutter" aria-hidden="true"></div>' +
      '<textarea class="bw-txt-area" id="bw-txt-area" ' +
        'spellcheck="false" autocorrect="off" autocapitalize="off" ' +
        'autocomplete="off" aria-label="File content"></textarea>' +
    '</div>' +
    '<div class="bw-txt-findbar" id="bw-txt-findbar" style="display:none" role="search">' +
      '<span class="bw-txt-findbar-label">Find:</span>' +
      '<input id="bw-txt-find-input" type="text" placeholder="Search\u2026" autocomplete="off">' +
      '<span id="bw-txt-find-count" class="bw-txt-findbar-count"></span>' +
      '<button class="bw-txt-btn" onclick="_uplTxtFindStep(-1)" title="Previous (Shift+Enter)">\u2191</button>' +
      '<button class="bw-txt-btn" onclick="_uplTxtFindStep(1)"  title="Next (Enter)">\u2193</button>' +
      '<button class="bw-txt-btn" onclick="_uplTxtFindToggle()" title="Close (Esc)">\u00d7</button>' +
    '</div>' +
    '<div class="bw-txt-status">' +
      '<span class="bw-txt-st-item" id="bw-txt-st-pos">Ln 1, Col 1</span>' +
      '<span class="bw-txt-st-item" id="bw-txt-st-chars">0 chars</span>' +
      '<span class="bw-txt-st-item" id="bw-txt-st-words">0 words</span>' +
      '<span class="bw-txt-st-item bw-txt-st-right">' + _uplEsc(label) + '</span>' +
    '</div>';

  /* populate + wire textarea */
  var ta = document.getElementById('bw-txt-area');
  if (ta) {
    ta.value = _uplViewerRawText;
    ta.addEventListener('input',   _uplTxtOnInput);
    ta.addEventListener('scroll',  _uplTxtSyncGutter);
    ta.addEventListener('click',   _uplTxtSyncStatus);
    ta.addEventListener('keyup',   _uplTxtSyncStatus);
    ta.addEventListener('keydown', _uplTxtKeydown);
    ta.focus();
  }

  /* find bar input */
  var fi = document.getElementById('bw-txt-find-input');
  if (fi) {
    fi.addEventListener('input', function() { _uplTxtFindStep(0); });
    fi.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { _uplTxtFindStep(e.shiftKey ? -1 : 1); e.preventDefault(); }
      if (e.key === 'Escape') _uplTxtFindToggle();
    });
  }

  _uplViewerEditMode = 'text';
  _uplTxtOnInput();   // initial gutter + status
}

/* ── Toolbar HTML ── */

function _uplTxtToolbarHtml(label) {
  var S = 'bw-txt-btn';
  return (
    '<span class="bw-txt-lang-chip">' + _uplEsc(label) + '</span>' +
    '<span class="bw-txt-tsep"></span>' +
    '<button class="' + S + '" id="bw-txt-wrap-btn" onclick="_uplTxtToggleWrap()" title="Toggle word wrap">\u21c4 Wrap</button>' +
    '<span class="bw-txt-tsep"></span>' +
    '<button class="' + S + '" onclick="_uplTxtFontSize(-1)" title="Decrease font size">A\u2212</button>' +
    '<button class="' + S + '" onclick="_uplTxtFontSize(0)"  title="Reset font size (13 px)">A</button>' +
    '<button class="' + S + '" onclick="_uplTxtFontSize(1)"  title="Increase font size">A+</button>' +
    '<span class="bw-txt-tsep"></span>' +
    '<button class="' + S + '" onclick="_uplTxtFindToggle()" title="Find (Ctrl+F)">\ud83d\udd0d Find</button>' +
    '<span class="bw-txt-tspacer"></span>' +
    '<button class="' + S + ' bw-txt-btn-cancel" onclick="_uplTxtCancelEdit()">Cancel</button>' +
    '<button class="' + S + ' bw-txt-btn-save" onclick="_uplTxtSave()" id="bw-txt-save-btn">\ud83d\udcbe Save</button>'
  );
}

/* ── Gutter + status sync ── */

function _uplTxtOnInput() {
  _uplTxtSyncGutter();
  _uplTxtSyncStatus();
}

function _uplTxtSyncGutter() {
  var ta = document.getElementById('bw-txt-area');
  var g  = document.getElementById('bw-txt-gutter');
  if (!ta || !g) return;
  var n    = ta.value.split('\n').length;
  var html = '';
  for (var i = 1; i <= n; i++) html += i + '\n';
  g.textContent = html;
  g.scrollTop   = ta.scrollTop;
}

function _uplTxtSyncStatus() {
  var ta = document.getElementById('bw-txt-area');
  if (!ta) return;
  var val    = ta.value;
  var before = val.substring(0, ta.selectionStart || 0);
  var lines  = before.split('\n');
  var ln     = lines.length;
  var col    = lines[lines.length - 1].length + 1;

  var p = document.getElementById('bw-txt-st-pos');
  var c = document.getElementById('bw-txt-st-chars');
  var w = document.getElementById('bw-txt-st-words');
  if (p) p.textContent = 'Ln ' + ln + ', Col ' + col;
  if (c) c.textContent = val.length.toLocaleString() + ' chars';
  if (w) w.textContent = (val.match(/\S+/g) || []).length.toLocaleString() + ' words';
}

/* ── Font size zoom ── */

function _uplTxtFontSize(delta) {
  if (delta === 0) { _uplTxtFontSz = 13; }
  else { _uplTxtFontSz = Math.max(9, Math.min(28, _uplTxtFontSz + delta * 2)); }
  var sz = _uplTxtFontSz + 'px';
  var ta = document.getElementById('bw-txt-area');
  var g  = document.getElementById('bw-txt-gutter');
  if (ta) ta.style.fontSize = sz;
  if (g)  g.style.fontSize  = sz;
  _uplTxtSyncGutter();   // line heights may shift
}

/* ── Word wrap toggle ── */

function _uplTxtToggleWrap() {
  _uplTxtWrapOn = !_uplTxtWrapOn;
  var ta  = document.getElementById('bw-txt-area');
  var btn = document.getElementById('bw-txt-wrap-btn');
  if (ta)  ta.style.whiteSpace = _uplTxtWrapOn ? 'pre-wrap' : 'pre';
  if (ta)  ta.style.overflowX  = _uplTxtWrapOn ? 'hidden' : 'auto';
  if (btn) btn.classList.toggle('bw-txt-btn-active', _uplTxtWrapOn);
}

/* ── Find bar ── */

function _uplTxtFindToggle() {
  var bar = document.getElementById('bw-txt-findbar');
  var fi  = document.getElementById('bw-txt-find-input');
  if (!bar) return;
  var show = bar.style.display === 'none';
  bar.style.display = show ? 'flex' : 'none';
  if (show && fi) { fi.focus(); fi.select(); _uplTxtFindStep(0); }
  else { _uplTxtMatches = []; _uplTxtMatchI = -1; }
}

/** dir: 0 = rebuild + jump to first, 1 = next, -1 = prev */
function _uplTxtFindStep(dir) {
  var ta  = document.getElementById('bw-txt-area');
  var fi  = document.getElementById('bw-txt-find-input');
  var cnt = document.getElementById('bw-txt-find-count');
  if (!ta || !fi) return;
  var needle = fi.value;
  if (!needle) { if (cnt) cnt.textContent = ''; _uplTxtMatches = []; return; }

  // Rebuild matches on any input (dir===0) or first search
  if (dir === 0 || _uplTxtMatches.length === 0) {
    _uplTxtMatches = [];
    var hay = ta.value.toLowerCase();
    var nl  = needle.toLowerCase();
    var idx = 0;
    while ((idx = hay.indexOf(nl, idx)) !== -1) {
      _uplTxtMatches.push(idx);
      idx += nl.length || 1;
    }
    _uplTxtMatchI = _uplTxtMatches.length > 0 ? 0 : -1;
  } else {
    _uplTxtMatchI = (_uplTxtMatchI + dir + _uplTxtMatches.length) % _uplTxtMatches.length;
  }

  if (_uplTxtMatches.length === 0) {
    if (cnt) cnt.textContent = 'No results';
    fi.style.background = '#5a1d1d';
    return;
  }
  fi.style.background = '';

  var start = _uplTxtMatches[_uplTxtMatchI];
  ta.focus();
  ta.setSelectionRange(start, start + needle.length);
  if (cnt) cnt.textContent = (_uplTxtMatchI + 1) + ' / ' + _uplTxtMatches.length;

  // Scroll textarea so the match is visible
  var linesAbove = ta.value.substring(0, start).split('\n').length - 1;
  ta.scrollTop = Math.max(0, linesAbove * _uplTxtFontSz * 1.5 - ta.clientHeight / 2);
  _uplTxtSyncGutter();
}

/* ── Keyboard shortcuts inside the textarea ── */

function _uplTxtKeydown(e) {
  var ta = e.target;

  // Ctrl/Cmd + S → save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault(); _uplTxtSave(); return;
  }
  // Ctrl/Cmd + F → find
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault(); _uplTxtFindToggle(); return;
  }
  // Escape → close find bar if open
  if (e.key === 'Escape') {
    var bar = document.getElementById('bw-txt-findbar');
    if (bar && bar.style.display !== 'none') { _uplTxtFindToggle(); e.preventDefault(); }
    return;
  }

  // Tab → 2 spaces (Shift+Tab → remove up to 2 leading spaces)
  if (e.key === 'Tab') {
    e.preventDefault();
    var s = ta.selectionStart, end = ta.selectionEnd;
    if (!e.shiftKey) {
      ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = s + 2;
    } else {
      var lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      var m = ta.value.substring(lineStart).match(/^ {1,2}/);
      if (m) {
        ta.value = ta.value.substring(0, lineStart) + ta.value.substring(lineStart + m[0].length);
        ta.selectionStart = ta.selectionEnd = Math.max(lineStart, s - m[0].length);
      }
    }
    _uplTxtOnInput(); return;
  }

  // Enter → preserve current-line indentation
  if (e.key === 'Enter') {
    e.preventDefault();
    var s2      = ta.selectionStart;
    var lineS   = ta.value.lastIndexOf('\n', s2 - 1) + 1;
    var indent  = ta.value.substring(lineS).match(/^(\s*)/)[1];
    ta.value    = ta.value.substring(0, s2) + '\n' + indent + ta.value.substring(s2);
    ta.selectionStart = ta.selectionEnd = s2 + 1 + indent.length;
    _uplTxtOnInput();
  }
}

/* ── Cancel / Save ── */

function _uplTxtCancelEdit() {
  var htmlEl = document.getElementById('upl-viewer-html');
  if (htmlEl) {
    htmlEl.className   = _UPL_HTMLEL_CLASS;
    htmlEl.style.cssText = '';
    htmlEl.innerHTML = _uplViewerHtmlForType(_uplViewerRawText || '', 'text');
    _uplViewerTxtRenderEditBar(htmlEl);
  }
  _uplViewerEditMode = null;
}

async function _uplTxtSave() {
  var ta      = document.getElementById('bw-txt-area');
  var saveBtn = document.getElementById('bw-txt-save-btn');
  var f       = _uplViewerCurrentFile;
  if (!ta || !f) return;
  var text = ta.value;
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving\u2026'; }
  try {
    var r = await fetch(
      '/home/uploads/' + _uplPid + '/files/page/' + f.id + '/content',
      { method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }) }
    );
    var ct = r.headers.get('content-type') || '';
    if (ct.includes('text/html')) throw new Error('Session expired \u2014 please refresh.');
    if (!r.ok) { var err = await r.json(); throw new Error(err.detail || r.status); }
    _uplViewerRawText = text;   // keep cancel restore up to date
    _uplShowToast('Saved \u2713');
  } catch(e) {
    _uplShowToast('Save failed: ' + _uplEsc(String(e)));
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '\ud83d\udcbe Save'; }
  }
}
