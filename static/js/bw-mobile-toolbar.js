/**
 * bw-mobile-toolbar.js — Notion-style mobile keyboard accessory bar.
 *
 * Shows a formatting bar pinned just above the on-screen keyboard whenever a
 * BookWorm editor is focused on a touch device:
 *   • workspace note  → contenteditable #md-live-preview
 *   • database card   → contenteditable [data-db-note="1"]  (#db-detail-note-<id>)
 *
 * Two button sets, swapped on selection state:
 *   • caret (collapsed):  +(slash) · Turn into · Indent · Outdent · Undo · Delete block
 *   • selection (text):   A− · A+ · Highlight · Text color · B · I · S · Link · Code
 *
 * Reuses bw-block-menu.js (_bwBlockTurnInto / _bwBlockCurrentType / colour
 * arrays) and document.execCommand (both surfaces are contenteditable).
 * Loaded once as a global defer script.
 */
(function () {
  'use strict';

  // Touch devices only — desktop has the existing toolbars + keyboard shortcuts.
  if (!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches)) return;

  // Reused from bw-block-menu.js (a defer script loaded just before this one).
  var BMK_TYPES = (typeof _BMK_TYPES !== 'undefined') ? _BMK_TYPES
    : [{ key: 'p', label: 'Text', icon: '¶' }];
  var BMK_HL = (typeof _BMK_HL_COLORS !== 'undefined') ? _BMK_HL_COLORS : [];
  var BMK_TC = (typeof _BMK_TC_COLORS !== 'undefined') ? _BMK_TC_COLORS : [];
  var bwTurnInto = (typeof _bwBlockTurnInto === 'function') ? _bwBlockTurnInto : null;
  var bwBlockType = (typeof _bwBlockCurrentType === 'function') ? _bwBlockCurrentType
    : function () { return 'p'; };

  var bar = null;        // the accessory bar element
  var caretRow = null;   // default (collapsed-selection) button row
  var selRow = null;     // selection (formatting) button row
  var turnBtn = null;    // "Turn into" button (label reflects current block)
  var activeCE = null;   // currently-focused editor contenteditable
  var savedRange = null; // last selection range inside activeCE
  var popup = null;      // open turn-into / colour popup, if any

  /* ───────────────────────── helpers ───────────────────────── */

  function isDb(ce) { return !!(ce && ce.dataset && ce.dataset.dbNote === '1'); }
  function isEditorCE(el) {
    return el && el.nodeType === 1 &&
      (el.id === 'md-live-preview' || (el.dataset && el.dataset.dbNote === '1'));
  }
  function findEditor(node) {
    while (node && node !== document.body) {
      if (isEditorCE(node)) return node;
      node = node.parentNode;
    }
    return null;
  }
  function saveSelection() {
    var sel = window.getSelection();
    if (sel && sel.rangeCount) {
      var r = sel.getRangeAt(0);
      if (activeCE && activeCE.contains(r.startContainer)) savedRange = r.cloneRange();
    }
  }
  function restoreSelection() {
    if (activeCE) activeCE.focus();
    if (savedRange) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }
  function afterMutate() {
    // Each surface persists + re-grips off its own 'input' handler:
    //   note form → syncPreviewToMd + autosave ; db card → _dbDetailNoteInput
    if (activeCE) activeCE.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Nearest direct child of the editor that holds the caret = the "block".
  function currentBlock() {
    if (!activeCE) return null;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var n = sel.getRangeAt(0).startContainer;
    while (n && n.parentNode !== activeCE) n = n.parentNode;
    return (n && n.parentNode === activeCE && n.nodeType === 1) ? n : null;
  }
  function ancestorOfType(names) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var n = sel.getRangeAt(0).startContainer;
    while (n && n !== activeCE) {
      if (n.nodeType === 1 && names.indexOf(n.nodeName) !== -1) return n;
      n = n.parentNode;
    }
    return null;
  }

  /* ───────────────────────── actions ───────────────────────── */

  function actSlash() {
    restoreSelection();
    // Open the palette directly — do NOT type a '/' into the note.
    if (activeCE && typeof window.bwSlashOpen === 'function') window.bwSlashOpen(activeCE);
  }
  // Route indent/outdent through each editor's OWN Tab handler (note form's
  // _bwCeTab via the document-level _bwEditorTabHandler, or the db card's
  // _dbNoteTabIndent on the note element) by dispatching a synthetic Tab.
  // execCommand('indent') would delete a freshly-created empty bullet; the
  // native handlers have the empty-bullet fix and manage their own save +
  // cursor-aware pruning, so we do NOT call afterMutate() here.
  function dispatchTab(shift) {
    restoreSelection();
    if (!activeCE) return;
    activeCE.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', code: 'Tab', keyCode: 9, which: 9,
      shiftKey: !!shift, bubbles: true, cancelable: true,
    }));
  }
  function actIndent()  { dispatchTab(false); }
  function actOutdent() { dispatchTab(true); }
  function actUndo()    { restoreSelection(); document.execCommand('undo'); afterMutate(); }

  function actDeleteBlock() {
    var b = currentBlock();
    if (!b) return;
    var sib = b.previousElementSibling || b.nextElementSibling;
    b.remove();
    // Drop the caret into a neighbouring block (or a fresh empty paragraph).
    if (!sib) {
      sib = document.createElement('p');
      sib.innerHTML = '<br>';
      activeCE.appendChild(sib);
    }
    var r = document.createRange();
    r.selectNodeContents(sib);
    r.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange = r.cloneRange();
    afterMutate();
  }

  function actBold()   { restoreSelection(); document.execCommand('bold');          afterMutate(); }
  function actItalic() { restoreSelection(); document.execCommand('italic');        afterMutate(); }
  function actStrike() { restoreSelection(); document.execCommand('strikeThrough'); afterMutate(); }

  function wrapSelection(el) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    var r = sel.getRangeAt(0);
    if (r.collapsed) return false;
    try { r.surroundContents(el); }
    catch (e) { var f = r.extractContents(); el.appendChild(f); r.insertNode(el); }
    var nr = document.createRange();
    nr.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(nr);
    savedRange = nr.cloneRange();
    return true;
  }

  function actFont(delta) {
    restoreSelection();
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    // Reuse an enclosing font-size span if the selection already sits in one.
    var n = sel.anchorNode, span = null;
    while (n && n !== activeCE) {
      if (n.nodeType === 1 && n.style && n.style.fontSize) { span = n; break; }
      n = n.parentNode;
    }
    var cur = span ? parseFloat(span.style.fontSize) : 16;
    var next = Math.max(10, Math.min(96, cur + delta));
    var s = document.createElement('span');
    s.style.fontSize = next + 'px';
    if (wrapSelection(s)) afterMutate();
  }

  function actCode() {
    restoreSelection();
    var code = ancestorOfType(['CODE']);
    if (code) {                         // toggle off — unwrap
      var p = code.parentNode;
      while (code.firstChild) p.insertBefore(code.firstChild, code);
      p.removeChild(code);
      afterMutate();
      return;
    }
    if (wrapSelection(document.createElement('code'))) afterMutate();
  }

  function actLink(btn) {
    restoreSelection();
    if (ancestorOfType(['A'])) { document.execCommand('unlink'); afterMutate(); return; }
    openLinkPopup(btn); // wrap the current selection in a link
  }
  function openLinkPopup(btn) {
    openPopup(btn, function (box, dark) {
      var wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:6px;align-items:center;padding:4px;';
      var inp = document.createElement('input');
      inp.type = 'url';
      inp.placeholder = 'https://…';
      inp.style.cssText =
        'width:200px;padding:8px 10px;border-radius:8px;font-size:15px;' +
        'border:1px solid ' + (dark ? '#3f3f46' : '#e5e7eb') + ';' +
        'background:' + (dark ? '#27272a' : '#fff') + ';' +
        'color:' + (dark ? '#f4f4f5' : '#111') + ';';
      var go = document.createElement('button');
      go.type = 'button';
      go.textContent = 'Link';
      go.style.cssText = 'padding:8px 12px;border-radius:8px;border:0;background:#0053e2;' +
        'color:#fff;font-weight:600;cursor:pointer;';
      function apply() {
        var url = (inp.value || '').trim();
        if (!url) { inp.focus(); return; }
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
        restoreSelection();
        document.execCommand('createLink', false, url);
        afterMutate();
        closePopup();
      }
      go.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      go.addEventListener('pointerup', apply);
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); apply(); }
      });
      wrap.appendChild(inp);
      wrap.appendChild(go);
      box.appendChild(wrap);
      setTimeout(function () { inp.focus(); }, 50);
    });
  }

  /* ── popups (turn-into + colour) ── */

  function closePopup() {
    if (popup) { popup.remove(); popup = null; }
    document.removeEventListener('pointerdown', onPopupOutside, true);
  }
  function onPopupOutside(e) {
    if (popup && !popup.contains(e.target)) closePopup();
  }
  function openPopup(anchorBtn, build) {
    closePopup();
    var dark = document.documentElement.classList.contains('dark');
    popup = document.createElement('div');
    popup.style.cssText =
      'position:fixed;z-index:2147483647;border-radius:12px;padding:6px;' +
      'box-shadow:0 -6px 24px rgba(0,0,0,.25);max-height:42vh;overflow:auto;' +
      'background:' + (dark ? '#18181b' : '#fff') + ';' +
      'border:1px solid ' + (dark ? '#3f3f46' : '#e5e7eb') + ';';
    build(popup, dark);
    document.body.appendChild(popup);
    // Sit the popup directly above the bar, left-aligned to the button.
    var br = bar.getBoundingClientRect();
    var ab = anchorBtn.getBoundingClientRect();
    popup.style.left = Math.max(6, Math.min(ab.left, window.innerWidth - popup.offsetWidth - 6)) + 'px';
    popup.style.bottom = (window.innerHeight - br.top + 6) + 'px';
    // Defer so this same tap doesn't immediately close it.
    setTimeout(function () { document.addEventListener('pointerdown', onPopupOutside, true); }, 0);
  }

  function openTurnInto(btn) {
    openPopup(btn, function (box, dark) {
      var cur = currentBlock();
      var curKey = cur ? bwBlockType(cur) : 'p';
      BMK_TYPES.forEach(function (t) {
        var b = document.createElement('button');
        b.type = 'button';
        b.style.cssText =
          'display:flex;align-items:center;gap:10px;width:100%;text-align:left;' +
          'padding:9px 12px;border:0;background:none;cursor:pointer;border-radius:8px;' +
          'font-size:15px;color:' + (dark ? '#f4f4f5' : '#111827') +
          (t.key === curKey ? ';font-weight:700' : '') + ';';
        b.innerHTML = '<span style="width:22px;display:inline-block;text-align:center;">' +
          t.icon + '</span><span>' + t.label + '</span>' +
          (t.key === curKey ? '<span style="margin-left:auto;color:#0053e2;">✓</span>' : '');
        b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
        b.addEventListener('pointerup', function () {
          var block = currentBlock();
          if (block && bwTurnInto) {
            bwTurnInto(block, t.key, {
              gripAttr: isDb(activeCE) ? 'data-db-grip' : 'data-preview-grip',
              reInjectGrips: function () {
                if (!isDb(activeCE) && typeof window._injectPreviewGrips === 'function') {
                  window._injectPreviewGrips(activeCE);
                }
              },
              syncToBackend: afterMutate,
            });
          }
          closePopup();
          updateMode();
        });
        box.appendChild(b);
      });
    });
  }

  function openColor(btn, isHighlight) {
    openPopup(btn, function (box, dark) {
      var pal = isHighlight ? BMK_HL : BMK_TC;
      var grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;max-width:240px;padding:4px;';
      pal.forEach(function (c) {
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.title = c.label;
        sw.style.cssText =
          'width:30px;height:30px;border-radius:50%;cursor:pointer;border:2px solid ' +
          (dark ? '#3f3f46' : '#d1d5db') + ';' +
          (c.color ? ('background:' + c.color + ';')
                   : 'background:linear-gradient(135deg,#fff 50%,#d1d5db 50%);');
        sw.addEventListener('pointerdown', function (e) { e.preventDefault(); });
        sw.addEventListener('pointerup', function () {
          restoreSelection();
          if (isHighlight) {
            document.execCommand('hiliteColor', false, c.color || 'transparent');
          } else if (c.color) {
            document.execCommand('foreColor', false, c.color);
          } else {
            document.execCommand('removeFormat');
          }
          afterMutate();
          closePopup();
        });
        grid.appendChild(sw);
      });
      box.appendChild(grid);
    });
  }

  /* ───────────────────────── bar UI ───────────────────────── */

  function mkBtn(html, label, handler, opts) {
    opts = opts || {};
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = html;
    b.style.cssText =
      'flex:0 0 auto;min-width:42px;height:38px;padding:0 10px;margin:0;border:0;' +
      'background:none;border-radius:9px;font-size:16px;line-height:1;cursor:pointer;' +
      'display:inline-flex;align-items:center;justify-content:center;gap:4px;' +
      'color:inherit;font-family:inherit;' + (opts.css || '');
    // pointerdown preventDefault keeps the editor focused + keyboard up. Fire on
    // pointerup, NOT click: iOS Safari suppresses the synthesized 'click' after a
    // pointerdown preventDefault, so a click handler never runs on iPhone.
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    b.addEventListener('pointerup', function (e) { e.preventDefault(); handler(b); });
    return b;
  }
  function divider() {
    var d = document.createElement('span');
    d.style.cssText = 'flex:0 0 auto;width:1px;height:22px;margin:0 4px;' +
      'background:currentColor;opacity:.18;';
    return d;
  }

  function buildBar() {
    var dark = document.documentElement.classList.contains('dark');
    bar = document.createElement('div');
    bar.id = 'bw-mobile-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;z-index:2147483646;display:none;' +
      'align-items:center;gap:2px;padding:5px 8px;overflow-x:auto;' +
      '-webkit-overflow-scrolling:touch;box-shadow:0 -2px 10px rgba(0,0,0,.12);' +
      'background:' + (dark ? '#27272a' : '#ffffff') + ';' +
      'color:' + (dark ? '#e4e4e7' : '#374151') + ';' +
      'border-top:1px solid ' + (dark ? '#3f3f46' : '#e5e7eb') + ';';

    // ── caret row ──
    caretRow = document.createElement('div');
    caretRow.style.cssText = 'display:flex;align-items:center;gap:2px;width:100%;';
    caretRow.appendChild(mkBtn('<span style="font-size:22px;font-weight:300;">+</span>',
      'Insert (slash menu)', actSlash));
    turnBtn = mkBtn('<span style="font-size:13px;font-weight:600;">¶ Text</span> ▾',
      'Turn into', function (b) { openTurnInto(b); });
    turnBtn.style.minWidth = '92px';
    caretRow.appendChild(turnBtn);
    caretRow.appendChild(divider());
    caretRow.appendChild(mkBtn('⇥', 'Indent', actIndent));
    caretRow.appendChild(mkBtn('⇤', 'Outdent (dedent)', actOutdent));
    caretRow.appendChild(divider());
    caretRow.appendChild(mkBtn('↺', 'Undo', actUndo));
    caretRow.appendChild(mkBtn('🗑', 'Delete block', actDeleteBlock));

    // ── selection row ──
    selRow = document.createElement('div');
    selRow.style.cssText = 'display:none;align-items:center;gap:2px;width:100%;';
    selRow.appendChild(mkBtn('<span style="font-size:12px;">A</span>−', 'Decrease font size', function () { actFont(-2); }));
    selRow.appendChild(mkBtn('<span style="font-size:17px;">A</span>+', 'Increase font size', function () { actFont(2); }));
    selRow.appendChild(divider());
    selRow.appendChild(mkBtn('<span style="background:#fef08a;color:#111;border-radius:3px;padding:1px 4px;">H</span>',
      'Highlight', function (b) { openColor(b, true); }));
    selRow.appendChild(mkBtn('<span style="color:#0053e2;font-weight:700;">A</span>',
      'Text color', function (b) { openColor(b, false); }));
    selRow.appendChild(divider());
    selRow.appendChild(mkBtn('<b>B</b>', 'Bold', actBold));
    selRow.appendChild(mkBtn('<i>I</i>', 'Italic', actItalic));
    selRow.appendChild(mkBtn('<s>S</s>', 'Strikethrough', actStrike));
    selRow.appendChild(mkBtn('🔗', 'Link', actLink));
    selRow.appendChild(mkBtn('<span style="font-family:monospace;">&lt;/&gt;</span>', 'Inline code', actCode));

    bar.appendChild(caretRow);
    bar.appendChild(selRow);
    bar.addEventListener('pointerdown', function (e) {
      // Keep focus in the editor when tapping bar chrome (not a button).
      if (e.target === bar || e.target === caretRow || e.target === selRow) e.preventDefault();
    });
    document.body.appendChild(bar);
  }

  /* ── mode (caret vs selection) + turn-into label ── */
  function updateMode() {
    if (!bar || !activeCE) return;
    var sel = window.getSelection();
    var hasSel = sel && sel.rangeCount && !sel.isCollapsed &&
                 activeCE.contains(sel.anchorNode);
    caretRow.style.display = hasSel ? 'none' : 'flex';
    selRow.style.display = hasSel ? 'flex' : 'none';
    if (!hasSel) {
      var b = currentBlock();
      var key = b ? bwBlockType(b) : 'p';
      var t = BMK_TYPES.filter(function (x) { return x.key === key; })[0] || BMK_TYPES[0];
      turnBtn.innerHTML = '<span style="font-size:13px;font-weight:600;">' +
        t.icon + ' ' + t.label + '</span> ▾';
    }
  }

  /* ── keyboard detection + positioning via visualViewport ──
     The on-screen keyboard shrinks the visual viewport; that gap below it is
     the keyboard height. We only show the bar when the keyboard is actually up,
     and hide it the moment the keyboard dismisses — even if the field keeps
     focus. */
  function kbGap() {
    var vv = window.visualViewport;
    if (!vv) return null;   // no API — caller decides the fallback
    return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  }
  function keyboardUp() {
    var g = kbGap();
    if (g === null) return true;   // no visualViewport: fall back to focus-based show
    return g > 150;                // > ~150px below the viewport ⇒ a keyboard, not browser chrome
  }
  function reposition() {
    if (!bar || bar.style.display === 'none') return;
    var g = kbGap();
    bar.style.bottom = (g === null ? 0 : g) + 'px';
  }

  function showBar() {
    if (!bar) buildBar();
    bar.style.display = 'flex';
    updateMode();
    reposition();
  }
  function hideBar() {
    if (bar) bar.style.display = 'none';
    closePopup();
  }
  // Single source of truth: bar is visible only while an editor is focused AND
  // the keyboard is up.
  function update() {
    if (activeCE && keyboardUp()) showBar();
    else hideBar();
  }

  /* ───────────────────────── wiring ───────────────────────── */

  document.addEventListener('focusin', function (e) {
    var ce = findEditor(e.target);
    if (ce) { activeCE = ce; saveSelection(); update(); }
  });
  document.addEventListener('focusout', function () {
    // Defer: a tap on a bar button briefly moves focus; re-check after.
    setTimeout(function () {
      var a = document.activeElement;
      if (isEditorCE(a)) return;                 // still editing
      if (bar && bar.contains(a)) return;        // focus is on the bar
      if (popup && popup.contains(a)) return;
      activeCE = null;
      update();
    }, 60);
  });
  document.addEventListener('selectionchange', function () {
    if (!activeCE) return;
    saveSelection();
    if (bar && bar.style.display !== 'none') updateMode();
  });

  if (window.visualViewport) {
    // resize fires as the keyboard animates up/down → re-evaluate show/hide.
    window.visualViewport.addEventListener('resize', update);
    window.visualViewport.addEventListener('scroll', reposition);
  }
  window.addEventListener('resize', update);
})();
