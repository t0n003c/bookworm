/**
 * BookWorm — Slash Command Palette
 * Works in both the markdown textarea (#note-content)
 * and the WYSIWYG contenteditable preview (#md-live-preview).
 *
 * Trigger: type `/` at the start of a line.
 * Navigate: ↑ / ↓  |  Confirm: Enter  |  Dismiss: Escape or click away.
 */


/* ─────────────────────────────────────────
   Command definitions
   Each command has:
     label / desc / icon  — palette display
     snippet / cursorOffset  — inserted into the textarea
     placeCursorMiddle       — for code blocks (cursor between fences)
     ceExec                  — optional { cmd, arg } passed to execCommand in CE mode
     ceInsert                — optional raw text inserted via insertText in CE mode
                               (falls back to snippet when both are absent)
   ───────────────────────────────────────── */
const SLASH_COMMANDS = [
  {
    id: 'h1', label: 'Heading 1', desc: 'Large section heading',
    icon: '<span class="font-black text-sm leading-none">H1</span>',
    snippet: '# ', cursorOffset: 2,
    ceExec: { cmd: 'formatBlock', arg: 'H1' },
  },
  {
    id: 'h2', label: 'Heading 2', desc: 'Medium section heading',
    icon: '<span class="font-black text-sm leading-none">H2</span>',
    snippet: '## ', cursorOffset: 3,
    ceExec: { cmd: 'formatBlock', arg: 'H2' },
  },
  {
    id: 'h3', label: 'Heading 3', desc: 'Small section heading',
    icon: '<span class="font-black text-sm leading-none">H3</span>',
    snippet: '### ', cursorOffset: 4,
    ceExec: { cmd: 'formatBlock', arg: 'H3' },
  },
  {
    id: 'bullet', label: 'Bullet List', desc: 'Unordered list item',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-4 h-4">
             <circle cx="4" cy="7" r="1.5" fill="currentColor"/>
             <line x1="8" y1="7" x2="20" y2="7"/>
             <circle cx="4" cy="13" r="1.5" fill="currentColor"/>
             <line x1="8" y1="13" x2="20" y2="13"/>
           </svg>`,
    snippet: '- ', cursorOffset: 2,
    ceExec: { cmd: 'insertUnorderedList' },
  },
  {
    id: 'numbered', label: 'Numbered List', desc: 'Ordered list item',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
             <text x="2" y="9" font-size="7" fill="currentColor" stroke="none">1.</text>
             <text x="2" y="16" font-size="7" fill="currentColor" stroke="none">2.</text>
             <line x1="10" y1="7" x2="20" y2="7"/>
             <line x1="10" y1="14" x2="20" y2="14"/>
           </svg>`,
    snippet: '1. ', cursorOffset: 3,
    ceExec: { cmd: 'insertOrderedList' },
  },
  {
    id: 'todo', label: 'To-do', desc: 'Checkbox list item',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
             <rect x="3" y="3" width="9" height="9" rx="1.5"/>
             <line x1="16" y1="7" x2="22" y2="7"/>
             <line x1="16" y1="13" x2="22" y2="13"/>
           </svg>`,
    snippet: '- [ ] ', cursorOffset: 6,
    ceInsert: '- [ ] ',
  },
  {
    id: 'link', label: 'Link', desc: 'Insert a hyperlink (Ctrl+K)',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
             <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101 m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                   stroke-linecap="round" stroke-linejoin="round"/>
           </svg>`,
    // action: erase the /query text, then open the link modal
    action: () => { if (typeof window.showLinkModal === 'function') window.showLinkModal(); },
  },
  {
    id: 'quote', label: 'Blockquote', desc: 'Indented quote block',
    icon: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
             <path d="M3 6h4v5H3zm0 7h4v5H3zm9-7h4v5h-4zm0 7h4v5h-4z" opacity=".6"/>
           </svg>`,
    snippet: '> ', cursorOffset: 2,
    ceExec: { cmd: 'formatBlock', arg: 'BLOCKQUOTE' },
  },
  {
    id: 'code', label: 'Code Block', desc: 'Fenced code block',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
             <polyline points="16 18 22 12 16 6"/>
             <polyline points="8 6 2 12 8 18"/>
           </svg>`,
    snippet: '```\n\n```', cursorOffset: 4, placeCursorMiddle: true,
    ceExec: { cmd: 'formatBlock', arg: 'PRE' },
  },
  {
    id: 'divider', label: 'Divider', desc: 'Horizontal rule',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-4 h-4">
             <line x1="3" y1="12" x2="21" y2="12"/>
           </svg>`,
    snippet: '---\n', cursorOffset: 4,
    ceExec: { cmd: 'insertHorizontalRule' },
  },

  // ── Toggle Headings ────────────────────────────────────────────────────
  {
    id: 'toggle-h1', label: 'Toggle Heading 1', desc: 'Collapsible H1 section',
    icon: `<svg viewBox="0 0 28 20" fill="none" stroke="currentColor" class="w-[18px] h-[14px]">
             <polyline points="4 6 8 10 4 14" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
             <text x="11" y="15" font-size="10" fill="currentColor" stroke="none" font-weight="900">H1</text>
           </svg>`,
    snippet: '<details class="bw-toggle bw-toggle-h1">\n<summary>Toggle Heading</summary>\n\nContent here\u2026\n\n</details>\n',
    cursorFromStart: 50,
    ceHtml: '<details class="bw-toggle bw-toggle-h1"><summary>Toggle Heading</summary><p>Content here…</p></details>',
  },
  {
    id: 'toggle-h2', label: 'Toggle Heading 2', desc: 'Collapsible H2 section',
    icon: `<svg viewBox="0 0 28 20" fill="none" stroke="currentColor" class="w-[18px] h-[14px]">
             <polyline points="4 6 8 10 4 14" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
             <text x="11" y="15" font-size="10" fill="currentColor" stroke="none" font-weight="900">H2</text>
           </svg>`,
    snippet: '<details class="bw-toggle bw-toggle-h2">\n<summary>Toggle Heading</summary>\n\nContent here\u2026\n\n</details>\n',
    cursorFromStart: 50,
    ceHtml: '<details class="bw-toggle bw-toggle-h2"><summary>Toggle Heading</summary><p>Content here…</p></details>',
  },
  {
    id: 'toggle-h3', label: 'Toggle Heading 3', desc: 'Collapsible H3 section',
    icon: `<svg viewBox="0 0 28 20" fill="none" stroke="currentColor" class="w-[18px] h-[14px]">
             <polyline points="4 6 8 10 4 14" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
             <text x="11" y="15" font-size="10" fill="currentColor" stroke="none" font-weight="900">H3</text>
           </svg>`,
    snippet: '<details class="bw-toggle bw-toggle-h3">\n<summary>Toggle Heading</summary>\n\nContent here\u2026\n\n</details>\n',
    cursorFromStart: 50,
    ceHtml: '<details class="bw-toggle bw-toggle-h3"><summary>Toggle Heading</summary><p>Content here…</p></details>',
  },

  // ── Column Layouts ─────────────────────────────────────────────────────
  {
    id: 'cols-1', label: 'Column 1', desc: 'Single-column callout box',
    icon: `<svg viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4">
             <rect x="1" y="1" width="22" height="16" rx="2"/>
           </svg>`,
    snippet: '<div class="bw-cols bw-cols-1">\n<div class="bw-col">Content here\u2026</div>\n</div>\n',
    cursorFromStart: 52,
    ceHtml: '<div class="bw-cols bw-cols-1"><div class="bw-col"><p>Content here…</p></div></div>',
  },
  {
    id: 'cols-2', label: 'Column 2', desc: 'Two-column layout',
    icon: `<svg viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4">
             <rect x="1"  y="1" width="10" height="16" rx="2"/>
             <rect x="13" y="1" width="10" height="16" rx="2"/>
           </svg>`,
    snippet: '<div class="bw-cols bw-cols-2">\n<div class="bw-col">Column 1</div>\n<div class="bw-col">Column 2</div>\n</div>\n',
    cursorFromStart: 52,
    ceHtml: '<div class="bw-cols bw-cols-2"><div class="bw-col"><p>Column 1</p></div><div class="bw-col"><p>Column 2</p></div></div>',
  },
  {
    id: 'cols-3', label: 'Column 3', desc: 'Three-column layout',
    icon: `<svg viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4">
             <rect x="1"  y="1" width="6.5" height="16" rx="2"/>
             <rect x="9"  y="1" width="6.5" height="16" rx="2"/>
             <rect x="17" y="1" width="6.5" height="16" rx="2"/>
           </svg>`,
    snippet: '<div class="bw-cols bw-cols-3">\n<div class="bw-col">Column 1</div>\n<div class="bw-col">Column 2</div>\n<div class="bw-col">Column 3</div>\n</div>\n',
    cursorFromStart: 52,
    ceHtml: '<div class="bw-cols bw-cols-3"><div class="bw-col"><p>Column 1</p></div><div class="bw-col"><p>Column 2</p></div><div class="bw-col"><p>Column 3</p></div></div>',
  },
  {
    id: 'cols-4', label: 'Column 4', desc: 'Four-column layout',
    icon: `<svg viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4">
             <rect x="1"    y="1" width="4.5" height="16" rx="1.5"/>
             <rect x="6.5"  y="1" width="4.5" height="16" rx="1.5"/>
             <rect x="12"   y="1" width="4.5" height="16" rx="1.5"/>
             <rect x="17.5" y="1" width="4.5" height="16" rx="1.5"/>
           </svg>`,
    snippet: '<div class="bw-cols bw-cols-4">\n<div class="bw-col">Col 1</div>\n<div class="bw-col">Col 2</div>\n<div class="bw-col">Col 3</div>\n<div class="bw-col">Col 4</div>\n</div>\n',
    cursorFromStart: 52,
    ceHtml: '<div class="bw-cols bw-cols-4"><div class="bw-col"><p>Col 1</p></div><div class="bw-col"><p>Col 2</p></div><div class="bw-col"><p>Col 3</p></div><div class="bw-col"><p>Col 4</p></div></div>',
  },
  {
    id: 'cols-5', label: 'Column 5', desc: 'Five-column layout',
    icon: `<svg viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4">
             <rect x="1"    y="1" width="3.4" height="16" rx="1.5"/>
             <rect x="5.4"  y="1" width="3.4" height="16" rx="1.5"/>
             <rect x="9.8"  y="1" width="3.4" height="16" rx="1.5"/>
             <rect x="14.2" y="1" width="3.4" height="16" rx="1.5"/>
             <rect x="18.6" y="1" width="3.4" height="16" rx="1.5"/>
           </svg>`,
    snippet: '<div class="bw-cols bw-cols-5">\n<div class="bw-col">Col 1</div>\n<div class="bw-col">Col 2</div>\n<div class="bw-col">Col 3</div>\n<div class="bw-col">Col 4</div>\n<div class="bw-col">Col 5</div>\n</div>\n',
    cursorFromStart: 52,
    ceHtml: '<div class="bw-cols bw-cols-5"><div class="bw-col"><p>Col 1</p></div><div class="bw-col"><p>Col 2</p></div><div class="bw-col"><p>Col 3</p></div><div class="bw-col"><p>Col 4</p></div><div class="bw-col"><p>Col 5</p></div></div>',
  },
];


/* ─────────────────────────────────────────
   Shared state
   ───────────────────────────────────────── */
const _sc = {
  open:      false,
  mode:      '',        // 'ta' | 'ce'
  query:     '',
  selected:  0,
  palette:   null,
  // textarea mode
  ta:        null,
  slashPos:  -1,
  // contenteditable mode
  ce:            null,
  savedCERange:  null,   // caret range snapshot, refreshed on every _render()
  ceSuppressed:  false,  // true after Escape — stops palette reopening until prefix resets
  // textarea mode
  caretEnd:      null,   // ta.selectionStart snapshot, refreshed on every _render()
};


/* ─────────────────────────────────────────
   Build / theme the floating palette (once)
   ───────────────────────────────────────── */
function _buildPalette() {
  const el = document.createElement('div');
  el.id = 'slash-palette';
  el.setAttribute('role', 'listbox');
  el.setAttribute('aria-label', 'Slash commands');
  Object.assign(el.style, {
    position: 'fixed', zIndex: '9999',
    minWidth: '260px', maxHeight: '320px',
    overflowY: 'auto', borderRadius: '10px',
    boxShadow: '0 8px 30px rgba(0,0,0,.18)',
    display: 'none', flexDirection: 'column',
    padding: '4px', gap: '1px',
  });
  document.body.appendChild(el);

  /* ── mousedown: ONLY prevents focus change + remembers which item ──
     On Windows/Chrome the browser can process the focus change before
     mousedown fires, so we must NOT try to capture selection state here
     — it may already be gone. State is captured earlier, in the editor's
     mouseleave handler (see _attachTextarea / _attachCE). */
  el.addEventListener('mousedown', (e) => {
    e.preventDefault(); // keep editor focused — that is the ONLY job here
    if (!_sc.open) return;
    const item = e.target.closest('[data-idx]');
    if (!item) return;
    el._clickIdx = parseInt(item.dataset.idx, 10); // remember for click
  });

  /* ── click: applies the command ────────────────────────────────────
     Fires after mousedown+mouseup. Because mousedown called preventDefault,
     the editor kept focus, and the caret state we captured at mouseleave
     is valid. Using click (not mousedown) means the browser has fully
     settled before we mutate the editor. */
  el.addEventListener('click', (e) => {
    if (!_sc.open) return;
    const idx = el._clickIdx ?? null;
    el._clickIdx = null;
    if (idx === null) return;
    _sc.selected = idx;
    _scApply();
  });

  /* ── mouseover: highlight hovered row without rebuilding HTML ───── */
  el.addEventListener('mouseover', (e) => {
    if (!_sc.open) return;
    const item = e.target.closest('[data-idx]');
    if (!item) return;
    const idx = parseInt(item.dataset.idx, 10);
    if (idx !== _sc.selected) {
      _sc.selected = idx;
      _updateHighlight();
    }
  });

  return el;
}

function _applyTheme() {
  const dark = document.documentElement.classList.contains('dark');
  Object.assign(_sc.palette.style, {
    background: dark ? '#18181b' : '#ffffff',
    border:     dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
    color:      dark ? '#f4f4f5' : '#111827',
  });
}


/* ─────────────────────────────────────────
   Caret coordinates
   ───────────────────────────────────────── */

/** For the textarea: mirror-div technique. */
const _MIRROR_PROPS = [
  'boxSizing','width','height','overflowX','overflowY',
  'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
  'paddingTop','paddingRight','paddingBottom','paddingLeft',
  'fontStyle','fontVariant','fontWeight','fontStretch','fontSize',
  'lineHeight','fontFamily','letterSpacing','wordSpacing',
  'tabSize','whiteSpace','wordBreak','wordWrap',
];

function _taCaretCoords(ta, pos) {
  let m = document.getElementById('_sc_mirror');
  if (!m) {
    m = document.createElement('div');
    m.id = '_sc_mirror';
    m.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;white-space:pre-wrap;word-wrap:break-word;';
    document.body.appendChild(m);
  }
  const cs = window.getComputedStyle(ta);
  _MIRROR_PROPS.forEach(p => { m.style[p] = cs[p]; });
  const r = ta.getBoundingClientRect();
  Object.assign(m.style, {
    top: r.top + window.scrollY + 'px', left: r.left + window.scrollX + 'px',
    width: r.width + 'px', height: r.height + 'px', overflow: 'hidden',
  });
  m.innerHTML = '';
  m.appendChild(document.createTextNode(ta.value.substring(0, pos)));
  const marker = document.createElement('span');
  marker.textContent = '|';
  m.appendChild(marker);
  m.scrollTop = ta.scrollTop;
  const mr = marker.getBoundingClientRect();
  return { x: mr.left, y: mr.bottom };
}

/** For the contenteditable: use the live selection range directly. */
function _ceCaretCoords() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return { x: 100, y: 100 };
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return { x: r.left, y: r.bottom };
}

function _caretCoords() {
  return _sc.mode === 'ce' ? _ceCaretCoords() : _taCaretCoords(_sc.ta, _sc.slashPos);
}


/* ─────────────────────────────────────────
   Render the palette
   ───────────────────────────────────────── */
function _render() {
  _applyTheme();
  const pal = _sc.palette;
  const q   = _sc.query.toLowerCase();
  const matches = SLASH_COMMANDS.filter(c =>
    c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
  );
  if (!matches.length) { _close(); return; }
  _sc.selected = Math.min(_sc.selected, matches.length - 1);

  // Snapshot caret position NOW (while the editor still has focus & selection)
  if (_sc.mode === 'ta' && _sc.ta) {
    _sc.caretEnd = _sc.ta.selectionStart;
  } else if (_sc.mode === 'ce') {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) _sc.savedCERange = sel.getRangeAt(0).cloneRange();
  }

  const dark      = document.documentElement.classList.contains('dark');
  const selBg     = dark ? '#1d4ed8' : '#eff6ff';
  const selColor  = dark ? '#fff'    : '#1d4ed8';
  const descColor = dark ? '#a1a1aa' : '#6b7280';
  const iconBg    = dark ? '#27272a' : '#f3f4f6';
  const iconColor = dark ? '#a1a1aa' : '#374151';

  pal.innerHTML = matches.map((cmd, i) => {
    const active = i === _sc.selected;
    return `
      <div role="option" aria-selected="${active}" data-idx="${i}"
           style="display:flex;align-items:center;gap:10px;padding:7px 10px;
                  border-radius:7px;cursor:pointer;user-select:none;
                  background:${active ? selBg : 'transparent'};
                  color:${active ? selColor : 'inherit'};
                  transition:background .1s;">
        <div style="width:30px;height:30px;border-radius:6px;flex-shrink:0;
                    display:flex;align-items:center;justify-content:center;
                    pointer-events:none;
                    background:${iconBg};color:${iconColor};">${cmd.icon}</div>
        <div style="pointer-events:none;">
          <div style="font-size:13px;font-weight:600;line-height:1.2">${cmd.label}</div>
          <div style="font-size:11px;color:${descColor};line-height:1.3">${cmd.desc}</div>
        </div>
      </div>`;
  }).join('');

  // Position near caret, kept inside viewport
  const { x, y } = _caretCoords();
  const PAD  = 6;
  const palH = Math.min(320, matches.length * 52 + 8);
  let top  = y + PAD;
  let left = x;
  if (top  + palH > window.innerHeight - PAD) top  = y - palH - PAD;
  if (left + 270  > window.innerWidth  - PAD) left = window.innerWidth - 270 - PAD;

  Object.assign(pal.style, { top: top + 'px', left: left + 'px', display: 'flex' });
  pal.querySelector(`[data-idx="${_sc.selected}"]`)?.scrollIntoView({ block: 'nearest' });
}


/* ─────────────────────────────────────────
   Highlight update — no DOM rebuild
   Called on hover; leaves the palette HTML intact so the browser's
   mousedown→mouseup→click tracking chain is never broken.
   ───────────────────────────────────────── */
function _updateHighlight() {
  const dark      = document.documentElement.classList.contains('dark');
  const selBg     = dark ? '#1d4ed8' : '#eff6ff';
  const selColor  = dark ? '#fff'    : '#1d4ed8';
  _sc.palette?.querySelectorAll('[data-idx]').forEach(el => {
    const on = parseInt(el.dataset.idx, 10) === _sc.selected;
    el.style.background = on ? selBg    : 'transparent';
    el.style.color      = on ? selColor : '';
    el.setAttribute('aria-selected', String(on));
  });
  _sc.palette?.querySelector(`[data-idx="${_sc.selected}"]`)?.scrollIntoView({ block: 'nearest' });
}


/* ─────────────────────────────────────────
   Open / close
   ───────────────────────────────────────── */
function _open(mode, opts) {
  Object.assign(_sc, { open: true, mode, query: '', selected: 0, ...opts });
  _render();
}

function _close() {
  _sc.open         = false;
  _sc.savedCERange = null;
  _sc.caretEnd     = null;
  if (_sc.palette) _sc.palette.style.display = 'none';
}


/* ─────────────────────────────────────────
   Apply — textarea path
   ───────────────────────────────────────── */
function _applyTextarea(cmd) {
  const ta = _sc.ta;
  ta.focus(); // restore focus before mutating selection
  const start = _sc.slashPos;
  // Use the saved position — ta.selectionStart is unreliable after a click
  // moves focus away from the textarea momentarily.
  const end = _sc.caretEnd ?? ta.selectionStart;
  const before = ta.value.slice(0, start);
  const after  = ta.value.slice(end);

  // action commands: erase the /query text then delegate to the callback
  if (cmd.action) {
    ta.value = before + after;
    ta.setSelectionRange(start, start);
    ta.focus();
    ta.dispatchEvent(new Event('input'));
    cmd.action();
    return;
  }

  ta.value = before + cmd.snippet + after;
  let cursor;
  if (cmd.cursorFromStart != null) {
    cursor = before.length + cmd.cursorFromStart;  // caller-specified offset
  } else if (cmd.placeCursorMiddle) {
    cursor = before.length + 4;                    // after '```\n'
  } else {
    cursor = before.length + cmd.snippet.length;   // after the whole snippet
  }
  ta.setSelectionRange(cursor, cursor);
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}


/* ─────────────────────────────────────────
   Helper: text before caret inside the current block element
   Returns everything the user typed on the current "line" up to the cursor.
   ───────────────────────────────────────── */
function _cePrefixBeforeCaret(ce) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return '';
  const caretRange = sel.getRangeAt(0);

  // Find the NEAREST block-level ancestor, not just the direct CE child.
  // This is critical for list items: <ul><li>text</li></ul> — the direct
  // child of CE is <ul>, but we want <li> so the prefix is just the item
  // text, not all previous siblings in the list.
  const BLOCK_TAGS = new Set([
    'P','DIV','LI','H1','H2','H3','H4','H5','H6',
    'BLOCKQUOTE','PRE','DETAILS','SUMMARY','TD','TH',
  ]);
  let block = caretRange.startContainer;
  while (block && block !== ce) {
    if (block.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(block.nodeName)) break;
    block = block.parentNode;
  }

  // Fallback: can't find a block — read text node content directly
  if (!block || block === ce) {
    const n = caretRange.startContainer;
    if (n.nodeType === Node.TEXT_NODE) return n.textContent.slice(0, caretRange.startOffset);
    return '';
  }

  // Range: start of the nearest block → current caret position
  try {
    const r = document.createRange();
    r.setStart(block, 0);
    r.setEnd(caretRange.startContainer, caretRange.startOffset);
    return r.toString();
  } catch (_) {
    return '';
  }
}


/* ─────────────────────────────────────────
   Apply — contenteditable path
   Captures query length + caret range NOW (before _close() wipes state),
   then defers all DOM work to requestAnimationFrame so focus has settled
   by the time we manipulate the selection (critical for the click path).
   ───────────────────────────────────────── */
function _applyCE(cmd) {
  const ce            = _sc.ce;
  const charsToDelete = 1 + _sc.query.length;                              // '/' + typed query
  const savedRange = _sc.savedCERange ? _sc.savedCERange.cloneRange() : null; // local copy before _close() wipes state

  // Defer via setTimeout so all pending mouse events (mouseup, click) finish
  // before we manipulate the selection. We also call ce.focus() *inside* the
  // callback — this is the critical fix: after a palette click the CE may have
  // lost its active selection even though document.activeElement is still CE,
  // because Windows/Chrome deactivates the selection on mouseup.
  setTimeout(() => {
    // Re-focus first so the selection is live (no-op if already focused).
    ce.focus();

    const sel = window.getSelection();
    if (!sel || !savedRange) return;

    // ── Build the delete range using the Range API directly ──────────────
    // sel.modify('extend','backward','character') is unreliable in Chrome
    // on Windows after a mouse event. Instead, create the range manually:
    // savedRange is a collapsed range sitting right AFTER the typed query,
    // so we just subtract charsToDelete from the end offset.
    const container = savedRange.endContainer;
    const offset    = savedRange.endOffset;
    let deleteRange = null;

    if (container.nodeType === Node.TEXT_NODE && offset >= charsToDelete) {
      // Common case: the entire '/query' lives in a single text node.
      deleteRange = document.createRange();
      deleteRange.setStart(container, offset - charsToDelete);
      deleteRange.setEnd(container, offset);
    }

    if (deleteRange) {
      sel.removeAllRanges();
      sel.addRange(deleteRange);
    } else {
      // Fallback for edge cases where chars span multiple nodes.
      sel.removeAllRanges();
      sel.addRange(savedRange);
      for (let i = 0; i < charsToDelete; i++) {
        sel.modify('extend', 'backward', 'character');
      }
    }
    document.execCommand('delete');

    // action commands: /query text is gone — fire the callback and done
    if (cmd.action) {
      ce.dispatchEvent(new Event('input'));
      cmd.action();
      return;
    }

    // Apply — priority: ceHtml > ceExec > ceInsert / snippet
    if (cmd.ceHtml) {
      document.execCommand('insertHTML', false, cmd.ceHtml);
    } else if (cmd.ceExec) {
      document.execCommand(cmd.ceExec.cmd, false, cmd.ceExec.arg ?? null);
    } else {
      document.execCommand('insertText', false, cmd.ceInsert ?? cmd.snippet);
    }

    ce.dispatchEvent(new Event('input')); // trigger syncPreviewToMd
  }, 0);
}


/* ─────────────────────────────────────────
   Public: apply selected command
   ───────────────────────────────────────── */
function _scApply() {
  const q = _sc.query.toLowerCase();
  const matches = SLASH_COMMANDS.filter(c =>
    c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
  );
  const cmd = matches[_sc.selected];
  if (!cmd) { _close(); return; }

  if (_sc.mode === 'ce') _applyCE(cmd); else _applyTextarea(cmd);
  _close();
}




/* ─────────────────────────────────────────
   Shared keyboard handler (works for both)
   ───────────────────────────────────────── */
function _onKeydown(e) {
  if (!_sc.open) return;
  const q = _sc.query.toLowerCase();
  const matchCount = SLASH_COMMANDS.filter(c =>
    c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
  ).length;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _sc.selected = (_sc.selected + 1) % matchCount;
    _updateHighlight(); // no DOM rebuild — just toggle bg colors
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _sc.selected = (_sc.selected - 1 + matchCount) % matchCount;
    _updateHighlight(); // no DOM rebuild — just toggle bg colors
  } else if (e.key === 'Enter') {
    e.preventDefault();
    _scApply();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (_sc.mode === 'ce') _sc.ceSuppressed = true; // suppress re-open until prefix resets
    _close();
  } else if (e.key === 'Backspace') {
    // TA: if caret retreats to or before the slash, dismiss
    if (_sc.mode === 'ta' && _sc.ta.selectionStart - 1 <= _sc.slashPos) _close();
  }
}


/* ─────────────────────────────────────────
   Attach: textarea
   ───────────────────────────────────────── */
function _attachTextarea(ta) {
  if (ta._scAttached) return;
  ta._scAttached = true;

  ta.addEventListener('input', () => {
    const pos  = ta.selectionStart;
    const text = ta.value;

    if (_sc.open && _sc.mode === 'ta') {
      const typed = text.slice(_sc.slashPos + 1, pos);
      if (pos <= _sc.slashPos || /\s/.test(typed)) { _close(); return; }
      _sc.query = typed;
      _render();
      return;
    }

    if (text[pos - 1] !== '/') return;
    // Allow '/' at the real start of a line, OR after a list marker
    // e.g.  "/"  "- /"  "* /"  "+ /"  "1. /"  "  - /"  etc.
    const lineStart  = text.lastIndexOf('\n', pos - 2) + 1;
    const linePrefix = text.slice(lineStart, pos - 1);  // content before '/'
    if (!/^(\s*[-*+]\s+|\s*\d+\.\s+)?$/.test(linePrefix)) return;
    _open('ta', { ta, slashPos: pos - 1 });
  });

  ta.addEventListener('keydown', _onKeydown);

  /* Capture caret the instant the mouse leaves the textarea toward the
     palette — this is the LAST moment the editor is guaranteed to have
     focus and a valid selectionStart. */
  ta.addEventListener('mouseleave', () => {
    if (_sc.open && _sc.mode === 'ta') _sc.caretEnd = ta.selectionStart;
  });
}


/* ─────────────────────────────────────────
   Attach: contenteditable
   ───────────────────────────────────────── */
function _attachCE(ce) {
  if (ce._scAttached) return;
  ce._scAttached = true;

  ce.addEventListener('input', () => {
    const prefix = _cePrefixBeforeCaret(ce); // text on this line up to caret
    const inSlashCtx = prefix.startsWith('/') && !prefix.includes('\n');

    if (_sc.open && _sc.mode === 'ce') {
      // ── Palette is open ──────────────────────────────────────────────
      if (!inSlashCtx) { _close(); return; }
      _sc.query = prefix.slice(1); // strip leading '/'
      _render();
      return;
    }

    // ── Palette is closed ────────────────────────────────────────────
    if (inSlashCtx) {
      // If prefix shrank back to just '/', user backspaced past where they
      // hit Escape — let them trigger the palette again.
      if (_sc.ceSuppressed && prefix === '/') _sc.ceSuppressed = false;

      if (!_sc.ceSuppressed) {
        // Open (or re-open) palette, inferring query from current prefix
        _open('ce', { ce, query: prefix.slice(1) });
      }
    } else {
      // Not in slash context at all — clear suppression so a fresh '/' works
      _sc.ceSuppressed = false;
    }
  });

  ce.addEventListener('keydown', _onKeydown);

  // After applying a heading / blockquote, pressing Enter should fall back
  // to a normal paragraph so the format doesn't bleed onto the next line.
  ce.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || _sc.open) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let node = sel.anchorNode;
    while (node && node !== ce) {
      if (/^H[1-6]$/.test(node.nodeName) || node.nodeName === 'BLOCKQUOTE') {
        e.preventDefault();
        document.execCommand('insertParagraph');
        document.execCommand('formatBlock', false, 'div');
        ce.dispatchEvent(new Event('input'));
        return;
      }
      node = node.parentNode;
    }
  });

  /* Capture CE selection the instant the mouse leaves the editor toward
     the palette — last guaranteed moment the selection is still live. */
  ce.addEventListener('mouseleave', () => {
    if (_sc.open && _sc.mode === 'ce') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) _sc.savedCERange = sel.getRangeAt(0).cloneRange();
    }
  });
}


/* ─────────────────────────────────────────
   Global click-away handler (shared)
   ───────────────────────────────────────── */
document.addEventListener('click', (e) => {
  if (_sc.open && !_sc.palette?.contains(e.target)) _close();
});


/* ─────────────────────────────────────────
   Init — run on load and after every HTMX swap
   ───────────────────────────────────────── */
function _scInit() {
  if (!_sc.palette) _sc.palette = _buildPalette();

  const ta = document.getElementById('note-content');
  const ce = document.getElementById('md-live-preview');
  if (ta) _attachTextarea(ta);
  if (ce) _attachCE(ce);

  // Tell turndown to preserve our custom HTML blocks instead of stripping them.
  // We wait a tick so initEditor()'s IIFE has had time to assign window._bwTurndown.
  setTimeout(() => {
    const td = window._bwTurndown;
    if (!td || td._bwKeepConfigured) return;
    td.keep(node =>
      node.nodeName === 'DETAILS' ||
      node.nodeName === 'SUMMARY' ||
      (node.nodeName === 'DIV' && (
        node.classList?.contains('bw-cols') ||
        node.classList?.contains('bw-col')
      ))
    );
    td._bwKeepConfigured = true;
  }, 50);
}

document.addEventListener('DOMContentLoaded', _scInit);
document.addEventListener('htmx:afterSwap',   _scInit);

/** Public: returns true when the slash-command palette is currently open.
 *  Used by other scripts to guard against conflicting Enter-key handlers. */
function scIsOpen() { return !!_sc.open; }