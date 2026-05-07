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
     action(ce, postDeleteRange) — custom CE handler; called after slash text deleted.
                               ce = the contenteditable el; postDeleteRange = collapsed
                               Range at the deletion point (restore before insertHTML
                               if focus is stolen, e.g., by a dialog).
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
    // Opens a styled dialog; restores cursor position on confirm before insertHTML.
    action: (ce, postDeleteRange) => { _ceLinkDialog(ce, postDeleteRange); },
  },
  {
    id: 'quote', label: 'Blockquote', desc: 'Indented quote block',
    icon: `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
             <path d="M3 6h4v5H3zm0 7h4v5H3zm9-7h4v5h-4zm0 7h4v5h-4z" opacity=".6"/>
           </svg>`,
    snippet: '> ', cursorOffset: 2,
    // CE mode: direct DOM insertion — execCommand('formatBlock') is unreliable in modal CEs
    // (Chrome's internal selection state is dirty after a prior execCommand('delete'))
    action: (ce) => { _ceInsertBlockquote(ce); },
  },
  {
    id: 'code', label: 'Code Block', desc: 'Fenced code block',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
             <polyline points="16 18 22 12 16 6"/>
             <polyline points="8 6 2 12 8 18"/>
           </svg>`,
    snippet: '```\n\n```', cursorOffset: 4, placeCursorMiddle: true,
    // CE mode: direct DOM insertion — execCommand('insertHTML') is unreliable after
    // execCommand('delete') in a modal CE; direct DOM avoids the compositing state issue
    action: (ce) => { _ceInsertCode(ce); },
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
    snippet: '<details class="bw-toggle bw-toggle-h1">\n<summary><span data-bw-ti></span>Toggle Heading</summary>\n\nContent here\u2026\n\n</details>\n',
    cursorFromStart: 50,
    ceHtml: '<details class="bw-toggle bw-toggle-h1" open><summary><span data-bw-ti></span>Toggle Heading</summary><p>Content here…</p></details><p><br></p>',
  },
  {
    id: 'toggle-h2', label: 'Toggle Heading 2', desc: 'Collapsible H2 section',
    icon: `<svg viewBox="0 0 28 20" fill="none" stroke="currentColor" class="w-[18px] h-[14px]">
             <polyline points="4 6 8 10 4 14" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
             <text x="11" y="15" font-size="10" fill="currentColor" stroke="none" font-weight="900">H2</text>
           </svg>`,
    snippet: '<details class="bw-toggle bw-toggle-h2">\n<summary><span data-bw-ti></span>Toggle Heading</summary>\n\nContent here\u2026\n\n</details>\n',
    cursorFromStart: 50,
    ceHtml: '<details class="bw-toggle bw-toggle-h2" open><summary><span data-bw-ti></span>Toggle Heading</summary><p>Content here…</p></details><p><br></p>',
  },
  {
    id: 'toggle-h3', label: 'Toggle Heading 3', desc: 'Collapsible H3 section',
    icon: `<svg viewBox="0 0 28 20" fill="none" stroke="currentColor" class="w-[18px] h-[14px]">
             <polyline points="4 6 8 10 4 14" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
             <text x="11" y="15" font-size="10" fill="currentColor" stroke="none" font-weight="900">H3</text>
           </svg>`,
    snippet: '<details class="bw-toggle bw-toggle-h3">\n<summary><span data-bw-ti></span>Toggle Heading</summary>\n\nContent here\u2026\n\n</details>\n',
    cursorFromStart: 50,
    ceHtml: '<details class="bw-toggle bw-toggle-h3" open><summary><span data-bw-ti></span>Toggle Heading</summary><p>Content here…</p></details><p><br></p>',
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

  // ── Callout Blocks ────────────────────────────────────────────────────
  {
    id: 'callout-info', label: 'Callout Info', desc: 'Blue informational callout block',
    icon: `<span style="font-size:1.15rem;line-height:1">💡</span>`,
    snippet: '<div class="bw-callout bw-callout-info">\n<div class="bw-callout-icon">💡</div>\n<div class="bw-callout-body">Your note here\u2026</div>\n</div>\n',
    ceHtml: '<div class="bw-callout bw-callout-info"><div class="bw-callout-icon">💡</div><div class="bw-callout-body"><p>Your note here…</p></div></div><p><br></p>',
  },
  {
    id: 'callout-warning', label: 'Callout Warning', desc: 'Amber warning callout block',
    icon: `<span style="font-size:1.15rem;line-height:1">⚠️</span>`,
    snippet: '<div class="bw-callout bw-callout-warning">\n<div class="bw-callout-icon">⚠️</div>\n<div class="bw-callout-body">Your note here\u2026</div>\n</div>\n',
    ceHtml: '<div class="bw-callout bw-callout-warning"><div class="bw-callout-icon">⚠️</div><div class="bw-callout-body"><p>Your note here…</p></div></div><p><br></p>',
  },
  {
    id: 'callout-tip', label: 'Callout Tip', desc: 'Green helpful tip callout block',
    icon: `<span style="font-size:1.15rem;line-height:1">✅</span>`,
    snippet: '<div class="bw-callout bw-callout-tip">\n<div class="bw-callout-icon">✅</div>\n<div class="bw-callout-body">Your note here\u2026</div>\n</div>\n',
    ceHtml: '<div class="bw-callout bw-callout-tip"><div class="bw-callout-icon">✅</div><div class="bw-callout-body"><p>Your note here…</p></div></div><p><br></p>',
  },
  {
    id: 'callout-danger', label: 'Callout Danger', desc: 'Red danger / critical callout block',
    icon: `<span style="font-size:1.15rem;line-height:1">🚨</span>`,
    snippet: '<div class="bw-callout bw-callout-danger">\n<div class="bw-callout-icon">🚨</div>\n<div class="bw-callout-body">Your note here\u2026</div>\n</div>\n',
    ceHtml: '<div class="bw-callout bw-callout-danger"><div class="bw-callout-icon">🚨</div><div class="bw-callout-body"><p>Your note here…</p></div></div><p><br></p>',
  },

  // ── Formatting / Actions ───────────────────────────────────────────────
  {
    id: 'tab', label: 'Tab Block', desc: 'Insert a navigable multi-tab content block',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
             <rect x="2" y="4" width="20" height="16" rx="2"/>
             <path stroke-linecap="round" d="M2 10h20"/>
             <path stroke-linecap="round" d="M8 4v6"/>
           </svg>`,
    action: (ce, actRange) => {
      if (!ce) return;  // CE mode only; TA mode: slash text already erased — no-op
      _insertTabBlock(ce, actRange);
    },
  },
  {
    id: 'reminder', label: 'Set Reminder', desc: 'Insert a dated reminder at the cursor',
    icon: `<span style="font-size:1.15rem;line-height:1">📅</span>`,
    // action receives (ce, actRange) in CE mode; called with () in TA mode.
    action: (ce, actRange) => {
      if (ce) {
        _reminderDialog(null, ce, actRange);
      } else {
        // TA mode: _sc.ta is still valid here (called synchronously before _close).
        _reminderDialog(_sc.ta, null, null);
      }
    },
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

  // Range: start of the nearest block → current caret position.
  // Skip the drag-grip span (data-preview-grip, contenteditable=false) that
  // sits as the FIRST child of every rendered block — its '⠿' text would
  // prefix the returned string and prevent prefix.startsWith('/') from
  // matching, so we start the range AFTER the grip if one is present.
  try {
    const r = document.createRange();
    const firstChild = block.firstChild;
    const hasGrip    = firstChild?.nodeType === Node.ELEMENT_NODE
                       && firstChild.hasAttribute('data-preview-grip');
    r.setStart(block, hasGrip ? 1 : 0);
    r.setEnd(caretRange.startContainer, caretRange.startOffset);
    return r.toString();
  } catch (_) {
    return '';
  }
}


/* ─────────────────────────────────────────
   CE action helpers
   Used by quote, code-block, and link slash commands.
   These bypass execCommand (unreliable after a prior execCommand('delete')
   in a modal CE) and manipulate the DOM directly.
   ───────────────────────────────────────── */

/** Find the nearest block-level direct child of `ce` that contains the cursor. */
function _ceFindBlock(ce) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const BLOCKS = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','PRE']);
  let el = sel.getRangeAt(0).startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  while (el && el !== ce) {
    if (BLOCKS.has(el.tagName) && el.parentElement === ce) return el;
    el = el.parentElement;
  }
  return null;
}

/** Insert a <blockquote> at the current cursor position via DOM APIs. */
function _ceInsertBlockquote(ce) {
  const block = _ceFindBlock(ce);
  const bq    = document.createElement('blockquote');
  bq.innerHTML = '<br>';
  const after = document.createElement('p');
  after.innerHTML = '<br>';

  if (block) {
    block.after(bq, after);
    if (!block.textContent.trim()) block.remove();
  } else {
    ce.appendChild(bq);
    ce.appendChild(after);
  }

  // Park cursor at the start of the new blockquote
  const r = document.createRange();
  r.setStart(bq, 0);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  ce.dispatchEvent(new Event('input'));
}

/** Insert a <pre><code> block at the current cursor position via DOM APIs. */
function _ceInsertCode(ce) {
  const block = _ceFindBlock(ce);
  const pre   = document.createElement('pre');
  const code  = document.createElement('code');
  code.contentEditable = 'plaintext-only';
  code.spellcheck      = false;
  /* contentEditable=false on the wrapper prevents the browser from placing
     the cursor inside <pre>'s padding area (outside <code>), which would
     let rich-text pastes land as sibling spans instead of plain text.   */
  pre.contentEditable  = 'false';
  pre.appendChild(code);
  const after = document.createElement('p');
  after.innerHTML = '<br>';

  if (block) {
    block.after(pre, after);
    if (!block.textContent.trim()) block.remove();
  } else {
    ce.appendChild(pre);
    ce.appendChild(after);
  }

  // Park cursor inside the code element
  const r = document.createRange();
  r.setStart(code, 0);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  ce.dispatchEvent(new Event('input'));
}

/**
 * Show a BookWorm-styled link dialog.
 * `postDeleteRange` is a collapsed Range at the spot where the slash text was;
 * we restore it into the CE before calling insertHTML so the anchor lands
 * exactly where the user typed `/link`.
 */
function _ceLinkDialog(ce, postDeleteRange) {
  // One dialog at a time
  const prev = document.getElementById('bw-link-dialog');
  if (prev) prev.remove();

  const dark = document.documentElement.classList.contains('dark');

  /* ---- overlay ---- */
  const overlay = document.createElement('div');
  overlay.id = 'bw-link-dialog';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '10001',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
  });

  /* ---- card ---- */
  const card = document.createElement('div');
  Object.assign(card.style, {
    background:   dark ? '#18181b' : '#ffffff',
    border:       dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
    borderRadius: '16px',
    padding:      '24px',
    width:        '100%',
    maxWidth:     '380px',
    boxShadow:    '0 20px 60px rgba(0,0,0,0.25)',
    boxSizing:    'border-box',
    fontFamily:   'inherit',
  });
  card.addEventListener('mousedown', (e) => e.stopPropagation());

  /* ---- helpers ---- */
  function close() { overlay.remove(); }

  function insert() {
    const url  = (urlInput.value  || '').trim();
    if (!url) { urlInput.focus(); return; }
    const text = (textInput.value || '').trim() || url;
    close();
    // Use Range.insertNode() — pure DOM, no execCommand, no focus/selection dependency.
    // postDeleteRange is a collapsed Range pointing to the deletion site inside
    // the CE, captured before the dialog opened. The <p> is still there; just insert.
    if (postDeleteRange) {
      try {
        const a   = document.createElement('a');
        a.href        = url.replace(/"/g, '%22');
        a.textContent = text;
        const r = postDeleteRange.cloneRange();
        r.insertNode(a);          // inserts at the deletion site
        r.setStartAfter(a);       // move cursor to just after the link
        r.collapse(true);
        ce.focus();
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      } catch (err) {
        // Absolute fallback — log and carry on
        console.warn('[bw-link] insertNode failed:', err);
      }
    }
    ce.dispatchEvent(new Event('input'));
  }

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown',   (e) => { if (e.key === 'Escape') close(); });

  /* ---- header ---- */
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: '16px',
  });
  const titleEl = document.createElement('div');
  Object.assign(titleEl.style, {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontWeight: '600', fontSize: '15px',
    color: dark ? '#f4f4f5' : '#111827',
  });
  titleEl.innerHTML = '<span>&#128279;</span><span>Insert Link</span>';
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '20px', lineHeight: '1', padding: '0 2px',
    color: dark ? '#71717a' : '#9ca3af',
  });
  closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = dark ? '#d4d4d8' : '#374151');
  closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = dark ? '#71717a' : '#9ca3af');
  closeBtn.onclick = close;
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  /* ---- input factory ---- */
  function mkLabel(txt) {
    const lbl = document.createElement('label');
    lbl.innerHTML = txt;
    Object.assign(lbl.style, {
      display: 'block', fontSize: '12px', fontWeight: '500',
      marginBottom: '4px', color: dark ? '#a1a1aa' : '#6b7280',
    });
    return lbl;
  }
  function mkInput(type, placeholder, value) {
    const inp = document.createElement('input');
    inp.type        = type;
    inp.placeholder = placeholder;
    if (value) inp.value = value;
    Object.assign(inp.style, {
      display: 'block', width: '100%', boxSizing: 'border-box',
      padding: '8px 12px',
      border:  dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
      borderRadius: '8px', fontSize: '14px',
      background: dark ? '#27272a' : '#ffffff',
      color:      dark ? '#f4f4f5'  : '#111827',
      outline: 'none', marginBottom: '12px', fontFamily: 'inherit',
    });
    inp.addEventListener('focus',  () => inp.style.borderColor = '#0053e2');
    inp.addEventListener('blur',   () => inp.style.borderColor = dark ? '#3f3f46' : '#e5e7eb');
    return inp;
  }

  const urlLabel  = mkLabel('URL');
  const urlInput  = mkInput('url',  'https://…', 'https://');
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); textInput.focus(); } });

  const textLabel = mkLabel('Display text <span style="opacity:0.6">(leave blank to use URL)</span>');
  const textInput = mkInput('text', 'Link text…', '');
  textInput.style.marginBottom = '20px';
  textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); insert(); } });

  /* ---- buttons ---- */
  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px' });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, {
    padding: '8px 16px', cursor: 'pointer', fontSize: '14px',
    border:        dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
    borderRadius:  '8px',
    color:         dark ? '#e4e4e7' : '#374151',
    background:    'transparent', fontFamily: 'inherit',
  });
  cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = dark ? '#27272a' : '#f9fafb');
  cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = 'transparent');
  cancelBtn.onclick = close;

  const insertBtn = document.createElement('button');
  insertBtn.textContent = 'Insert ↵';
  Object.assign(insertBtn.style, {
    padding: '8px 16px', background: '#0053e2', color: 'white',
    border: 'none', borderRadius: '8px', fontSize: '14px',
    cursor: 'pointer', fontWeight: '500', fontFamily: 'inherit',
  });
  insertBtn.addEventListener('mouseenter', () => insertBtn.style.background = '#0046c0');
  insertBtn.addEventListener('mouseleave', () => insertBtn.style.background = '#0053e2');
  insertBtn.onclick = insert;

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(insertBtn);

  /* ---- assemble ---- */
  card.appendChild(header);
  card.appendChild(urlLabel);
  card.appendChild(urlInput);
  card.appendChild(textLabel);
  card.appendChild(textInput);
  card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Focus URL input, cursor at end of 'https://'
  requestAnimationFrame(() => {
    urlInput.focus();
    urlInput.setSelectionRange(urlInput.value.length, urlInput.value.length);
  });
}


/* ─────────────────────────────────────────
   Reminder dialog
   Opens a date+time picker and inserts a 📅 reminder chip at the cursor.
   Works in both textarea (ta != null) and contenteditable (ce != null) modes.
   actRange is the collapsed Range at the deletion site (CE mode only).
   ───────────────────────────────────────── */
/**
 * Build a reminder chip DOM element.
 * Stores all reminder data as data-* attributes so the edit dialog can
 * read them back. The chip is contenteditable="false" so it stays intact
 * inside the note's contenteditable preview.
 */
function _buildReminderChip(date, time, label, msg, rid, plain) {
  const chip = document.createElement('span');
  chip.className = 'bw-reminder-chip' + (plain ? ' bw-rc-plain' : '');
  chip.setAttribute('contenteditable', 'false');
  chip.dataset.bwDate  = date;
  chip.dataset.bwTime  = time;
  chip.dataset.bwLabel = label;
  chip.dataset.bwMsg   = msg || '';
  chip.dataset.bwStyle = plain ? 'plain' : '';
  if (rid) chip.dataset.bwRid = String(rid);

  const main = document.createElement('span');
  main.className   = 'bw-rc-main';
  main.textContent = label;
  chip.appendChild(main);

  if (msg) {
    const msgEl = document.createElement('span');
    msgEl.className   = 'bw-rc-msg';
    msgEl.textContent = msg;
    chip.appendChild(msgEl);
  }
  return chip;
}


function _reminderDialog(ta, ce, actRange, editChip) {
  const prev = document.getElementById('bw-reminder-dialog');
  if (prev) prev.remove();

  const dark    = document.documentElement.classList.contains('dark');
  const isEdit  = !!editChip;
  const today   = new Date();
  /* Use LOCAL calendar date, not UTC */
  const defDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  // Capture TA insertion point NOW — before the dialog steals focus.
  const taInsertPos = ta ? ta.selectionStart : null;

  /* ---- helpers (shared with link dialog) ---- */
  const mkLabel = (txt) => {
    const lbl = document.createElement('label');
    lbl.innerHTML = txt;
    Object.assign(lbl.style, {
      display: 'block', fontSize: '12px', fontWeight: '500',
      marginBottom: '4px', color: dark ? '#a1a1aa' : '#6b7280',
    });
    return lbl;
  };
  const mkInput = (type, value) => {
    const inp = document.createElement('input');
    inp.type  = type;
    inp.value = value;
    Object.assign(inp.style, {
      display: 'block', width: '100%', boxSizing: 'border-box',
      padding: '8px 12px',
      border:  dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
      borderRadius: '8px', fontSize: '14px',
      background: dark ? '#27272a' : '#ffffff',
      color:      dark ? '#f4f4f5'  : '#111827',
      outline: 'none', marginBottom: '12px', fontFamily: 'inherit',
    });
    inp.addEventListener('focus', () => inp.style.borderColor = '#0053e2');
    inp.addEventListener('blur',  () => inp.style.borderColor = dark ? '#3f3f46' : '#e5e7eb');
    return inp;
  };

  /* ---- overlay ---- */
  const overlay = document.createElement('div');
  overlay.id = 'bw-reminder-dialog';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '10001',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
  });

  /* ---- card ---- */
  const card = document.createElement('div');
  Object.assign(card.style, {
    background:   dark ? '#18181b' : '#ffffff',
    border:       dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
    borderRadius: '16px',
    padding:      '24px',
    width:        '100%',
    maxWidth:     '340px',
    boxShadow:    '0 20px 60px rgba(0,0,0,0.25)',
    boxSizing:    'border-box',
    fontFamily:   'inherit',
  });
  card.addEventListener('mousedown', (e) => e.stopPropagation());

  function close() { overlay.remove(); }

  async function insert() {
    const d     = dateInp.value;
    const t     = (hrSel.value || '09') + ':' + (minSel.value || '00');
    const msg   = msgInp.value.trim();
    const plain = !bubbleChk.checked;   // true = no background bubble
    if (!d) { dateInp.focus(); return; }

    // Human-readable date label: 'May 5, 2026'
    const [yr, mo, dy] = d.split('-').map(Number);
    const dateLabel = new Date(yr, mo - 1, dy).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    const chipLabel = `\ud83d\udcc5 ${dateLabel} \u00b7 ${t}`;

    // Disable the action button while we talk to the server
    insertBtn.disabled = true;
    insertBtn.textContent = isEdit ? 'Saving\u2026' : 'Saving\u2026';

    if (isEdit) {
      /* ── UPDATE existing chip ── */
      const rid = editChip.dataset.bwRid;
      close();

      // Patch data attributes and visible text on the chip in the preview
      editChip.dataset.bwDate  = d;
      editChip.dataset.bwTime  = t;
      editChip.dataset.bwMsg   = msg;
      editChip.dataset.bwLabel = chipLabel;
      editChip.dataset.bwStyle = plain ? 'plain' : '';
      editChip.classList.toggle('bw-rc-plain', plain);
      const mainEl = editChip.querySelector('.bw-rc-main');
      if (mainEl) mainEl.textContent = chipLabel;
      let msgEl = editChip.querySelector('.bw-rc-msg');
      if (msg) {
        if (!msgEl) {
          msgEl = document.createElement('span');
          msgEl.className = 'bw-rc-msg';
          editChip.appendChild(msgEl);
        }
        msgEl.textContent = msg;
      } else if (msgEl) {
        msgEl.remove();
      }

      // Sync preview → textarea → triggers autosave
      if (typeof window._bwSyncPreviewToMd === 'function') window._bwSyncPreviewToMd();
      const liveTA = document.getElementById('note-content');
      if (liveTA) liveTA.dispatchEvent(new Event('input'));

      // PATCH the DB record; reset fired=0 so it fires at the new time
      if (rid) {
        fetch(`/home/note-reminders/${rid}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            reminder_date: d, reminder_time: t,
            label: chipLabel, message: msg,
          }),
        }).catch(err => console.warn('[bw-reminder] PATCH failed:', err));
      }
    } else {
      /* ── INSERT new chip ── */
      const rid = await _saveNoteReminder(d, t, chipLabel, msg);
      close();

      const chipEl = _buildReminderChip(d, t, chipLabel, msg, rid, plain);

      if (ta) {
        /* Textarea mode: insert raw outerHTML at cursor */
        const pos    = taInsertPos !== null ? taInsertPos : ta.value.length;
        const html   = chipEl.outerHTML;
        ta.value = ta.value.slice(0, pos) + html + ta.value.slice(pos);
        ta.setSelectionRange(pos + html.length, pos + html.length);
        ta.focus();
        ta.dispatchEvent(new Event('input'));
      } else if (ce && actRange) {
        /* Contenteditable mode: insert the DOM node directly */
        try {
          const r = actRange.cloneRange();
          r.insertNode(chipEl);
          r.setStartAfter(chipEl);
          r.collapse(true);
          ce.focus();
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } catch (err) {
          console.warn('[bw-reminder] insertNode failed:', err);
        }
        ce.dispatchEvent(new Event('input'));
      }
    }
  }

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown',   (e) => { if (e.key === 'Escape') close(); });

  /* ---- header ---- */
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: '16px',
  });
  const titleEl = document.createElement('div');
  Object.assign(titleEl.style, {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontWeight: '600', fontSize: '15px',
    color: dark ? '#f4f4f5' : '#111827',
  });
  titleEl.innerHTML = `<span>\ud83d\udcc5</span><span>${isEdit ? 'Edit Reminder' : 'Set Reminder'}</span>`;
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '20px', lineHeight: '1', padding: '0 2px',
    color: dark ? '#71717a' : '#9ca3af',
  });
  closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = dark ? '#d4d4d8' : '#374151');
  closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = dark ? '#71717a' : '#9ca3af');
  closeBtn.onclick = close;
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  /* ---- inputs ---- */
  const dateLabel = mkLabel('Date');
  const dateInp   = mkInput('date', defDate);

  const timeLabel = mkLabel('Time <span style="opacity:0.6;font-weight:400">(optional)</span>');

  /* Hours + Minutes: native selects — 24 hrs / 60 min, fully scrollable */
  const hrSel = document.createElement('select');
  Object.assign(hrSel.style, {
    padding: '8px 10px', cursor: 'pointer', fontSize: '14px',
    border:       dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
    borderRadius: '8px',
    background:   dark ? '#27272a' : '#ffffff',
    color:        dark ? '#f4f4f5' : '#111827',
    fontFamily:   'inherit', outline: 'none', flexShrink: '0',
  });
  for (let h = 0; h < 24; h++) {
    const o = document.createElement('option');
    o.value = String(h).padStart(2, '0');
    o.textContent = String(h).padStart(2, '0');
    if (h === 9) o.selected = true;
    hrSel.appendChild(o);
  }
  hrSel.addEventListener('focus', () => hrSel.style.borderColor = '#0053e2');
  hrSel.addEventListener('blur',  () => hrSel.style.borderColor = dark ? '#3f3f46' : '#e5e7eb');

  /* Minutes: native select — all 60 values, scroll to any minute */
  const minSel = document.createElement('select');
  for (let m = 0; m < 60; m++) {
    const o = document.createElement('option');
    o.value = String(m).padStart(2, '0');
    o.textContent = String(m).padStart(2, '0');
    minSel.appendChild(o);
  }
  Object.assign(minSel.style, {
    padding: '8px 10px', cursor: 'pointer', fontSize: '14px',
    border:       dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
    borderRadius: '8px',
    background:   dark ? '#27272a' : '#ffffff',
    color:        dark ? '#f4f4f5' : '#111827',
    fontFamily:   'inherit', outline: 'none', flexShrink: '0',
  });
  minSel.addEventListener('focus', () => minSel.style.borderColor = '#0053e2');
  minSel.addEventListener('blur',  () => minSel.style.borderColor = dark ? '#3f3f46' : '#e5e7eb');
  minSel.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); insert(); } });

  const colon = document.createElement('span');
  colon.textContent = ':';
  Object.assign(colon.style, {
    fontWeight: '700', fontSize: '16px', lineHeight: '1',
    color: dark ? '#a1a1aa' : '#6b7280', alignSelf: 'center',
  });

  const timeRow = document.createElement('div');
  Object.assign(timeRow.style, {
    display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '20px',
  });
  timeRow.appendChild(hrSel);
  timeRow.appendChild(colon);
  timeRow.appendChild(minSel);

  /* Pre-fill all fields when editing an existing chip */
  if (isEdit) {
    if (editChip.dataset.bwDate) dateInp.value = editChip.dataset.bwDate;
    const [eh = '09', em = '00'] = (editChip.dataset.bwTime || '09:00').split(':');
    hrSel.value  = eh;
    minSel.value = em;
  }

  /* ---- message field ---- */
  const msgLabel = mkLabel('Message <span style="opacity:0.6;font-weight:400">(optional)</span>');
  const msgInp   = document.createElement('textarea');
  msgInp.placeholder = 'Add a note…';
  msgInp.rows = 2;
  Object.assign(msgInp.style, {
    width: '100%', boxSizing: 'border-box', resize: 'vertical',
    padding: '8px 10px', fontSize: '14px', fontFamily: 'inherit',
    border:       dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
    borderRadius: '8px',
    background:   dark ? '#27272a' : '#ffffff',
    color:        dark ? '#f4f4f5' : '#111827',
    outline: 'none', lineHeight: '1.45', marginBottom: '20px',
    transition: 'border-color .15s',
  });
  msgInp.addEventListener('focus', () => msgInp.style.borderColor = '#0053e2');
  msgInp.addEventListener('blur',  () => msgInp.style.borderColor = dark ? '#3f3f46' : '#e5e7eb');
  if (isEdit && editChip.dataset.bwMsg) msgInp.value = editChip.dataset.bwMsg;

  /* ---- "show as bubble" toggle ---- */
  const bubbleRow = document.createElement('label');
  Object.assign(bubbleRow.style, {
    display: 'flex', alignItems: 'center', gap: '8px',
    cursor: 'pointer', userSelect: 'none',
    fontSize: '.82rem', marginTop: '10px',
    color: dark ? '#a1a1aa' : '#6b7280',
  });
  const bubbleChk = document.createElement('input');
  bubbleChk.type    = 'checkbox';
  bubbleChk.checked = isEdit ? editChip.dataset.bwStyle !== 'plain' : true;
  Object.assign(bubbleChk.style, { width: '14px', height: '14px', cursor: 'pointer', accentColor: '#0053e2' });
  bubbleRow.appendChild(bubbleChk);
  bubbleRow.appendChild(document.createTextNode('Show as bubble'));

  /* ---- buttons ---- */
  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px' });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, {
    padding: '8px 16px', cursor: 'pointer', fontSize: '14px',
    border:       dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
    borderRadius: '8px',
    color:        dark ? '#e4e4e7' : '#374151',
    background:   'transparent', fontFamily: 'inherit',
  });
  cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = dark ? '#27272a' : '#f9fafb');
  cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = 'transparent');
  cancelBtn.onclick = close;

  const insertBtn = document.createElement('button');
  insertBtn.textContent = isEdit ? 'Update \u23ce' : 'Insert \u23ce';
  Object.assign(insertBtn.style, {
    padding: '8px 16px', background: '#0053e2', color: 'white',
    border: 'none', borderRadius: '8px', fontSize: '14px',
    cursor: 'pointer', fontWeight: '500', fontFamily: 'inherit',
  });
  insertBtn.addEventListener('mouseenter', () => insertBtn.style.background = '#0046c0');
  insertBtn.addEventListener('mouseleave', () => insertBtn.style.background = '#0053e2');
  insertBtn.onclick = insert;

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(insertBtn);

  /* ---- assemble ---- */
  card.appendChild(header);
  card.appendChild(dateLabel);
  card.appendChild(dateInp);
  card.appendChild(timeLabel);
  card.appendChild(timeRow);
  card.appendChild(msgLabel);
  card.appendChild(msgInp);
  card.appendChild(bubbleRow);
  card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => { dateInp.focus(); });
}


/* ─────────────────────────────────────────
   Tab block insertion
   Inserts a bw-tabs block at actRange then places caret in the first panel.
   ───────────────────────────────────────── */
function _insertTabBlock(ce, actRange) {
  const html =
    '<div class="bw-tabs" data-bw-tabs="">'
    + '<div class="bw-tabs-bar" contenteditable="false">'
    + '<span class="bw-tab-btn bw-tab-active" data-tab-idx="0">'
      + '<span class="bw-tab-label">Tab 1</span>'
      + '<span class="bw-tab-edit" title="Rename tab">✎</span>'
    + '</span>'
    + '<span class="bw-tab-add" title="Add tab">＋</span>'
    + '</div>'
    + '<div class="bw-tab-panels">'
    + '<div class="bw-tab-panel bw-tab-panel-active" data-tab-idx="0"><p><br></p></div>'
    + '</div></div><p><br></p>';

  const r   = actRange.cloneRange();
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  // Capture references BEFORE moving nodes into the fragment
  const firstPanel = tmp.querySelector('.bw-tab-panel');
  const frag = document.createDocumentFragment();
  while (tmp.firstChild) frag.appendChild(tmp.firstChild);
  r.insertNode(frag);

  // Place caret inside the first panel
  ce.focus();
  if (firstPanel) {
    const pr = document.createRange();
    pr.selectNodeContents(firstPanel);
    pr.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(pr);
  }
  ce.dispatchEvent(new Event('input'));
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

    // ── Action path: use Range.deleteContents() instead of execCommand ────
    // execCommand('delete') corrupts Chrome's internal selection state in
    // modal CEs — subsequent window.getSelection() returns a stale or empty
    // range that _ceFindBlock() cannot use to locate the enclosing block.
    // Range.deleteContents() is a pure DOM operation with no side-effects on
    // the selection API state, making it safe to use before DOM insertions.
    if (cmd.action) {
      let actRange = null;
      if (deleteRange) {
        deleteRange.deleteContents();       // collapses deleteRange in-place
        sel.removeAllRanges();
        sel.addRange(deleteRange);          // selection = collapsed point at deletion site
        actRange = deleteRange.cloneRange();
      } else {
        // Fallback: span across multiple text nodes — execCommand is acceptable
        // here because the action helpers fall back to actRange, not live selection
        sel.removeAllRanges();
        sel.addRange(savedRange);
        for (let i = 0; i < charsToDelete; i++) sel.modify('extend', 'backward', 'character');
        document.execCommand('delete');
        if (sel.rangeCount) actRange = sel.getRangeAt(0).cloneRange();
      }
      ce.dispatchEvent(new Event('input'));
      cmd.action(ce, actRange);
      return;
    }

    // ── Non-action path (ceHtml / ceExec / ceInsert) ──────────────────────
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

    // Apply — priority: ceHtml > ceExec > ceInsert / snippet
    if (cmd.ceHtml) {
      document.execCommand('insertHTML', false, cmd.ceHtml);
      // For code blocks: if a <code data-bwcc> marker was inserted,
      // move the cursor inside it so the user can type straight away.
      const marker = ce.querySelector('code[data-bwcc]');
      if (marker) {
        marker.removeAttribute('data-bwcc');
        marker.contentEditable = 'plaintext-only';
        marker.spellcheck = false;
        // Place cursor at start of the code element
        const r = document.createRange();
        r.selectNodeContents(marker);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
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
    // Allow '/' at the real start of a line, OR after a list marker.
    // Includes '•' — the visual bullet produced by the auto-bullet feature
    // (which converts '- ' → '• ' on spacebar press).
    // e.g.  "/"  "- /"  "* /"  "+ /"  "• /"  "1. /"  "  - /"  etc.
    const lineStart  = text.lastIndexOf('\n', pos - 2) + 1;
    const linePrefix = text.slice(lineStart, pos - 1);  // content before '/'
    if (!/^(\s*[-*+•]\s+|\s*\d+\.\s+)?$/.test(linePrefix)) return;
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

  // ── Enter key: heading/blockquote → fall back to plain paragraph ───────────
  // Also handles the two toggle-heading edge cases:
  //   A) Enter inside <summary>  → insert a <p> inside <details> instead of
  //      creating a second <summary> (which would inherit the heading style).
  //   B) Enter on the last empty block inside <details>  → escape to a new
  //      <p> after the <details> element (Notion-style "press Enter to exit").
  ce.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || _sc.open) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    // Walk up from caret — collect enclosing summary / details / heading nodes
    let node    = sel.anchorNode;
    let summary = null;
    let details = null;
    while (node && node !== ce) {
      if (node.nodeName === 'SUMMARY') summary = node;
      if (node.nodeName === 'DETAILS' && node.classList?.contains('bw-toggle')) {
        details = node; break;
      }
      if (/^H[1-6]$/.test(node.nodeName) || node.nodeName === 'BLOCKQUOTE') {
        // Plain heading / blockquote → revert to paragraph
        e.preventDefault();
        document.execCommand('insertParagraph');
        document.execCommand('formatBlock', false, 'div');
        ce.dispatchEvent(new Event('input'));
        return;
      }
      node = node.parentNode;
    }

    if (!details) return; // not inside a toggle — browser handles Enter normally

    // ── Case A: cursor is inside <summary> ───────────────────────────────────
    // Prevent the browser from cloning a second <summary> (which would look
    // like another heading-styled line). Instead, drop a fresh <p> right after
    // the <summary>, open the <details>, and place the caret inside it.
    if (summary) {
      e.preventDefault();
      details.open = true;
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      const ref = summary.nextSibling;
      if (ref) details.insertBefore(p, ref);
      else      details.appendChild(p);
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      ce.dispatchEvent(new Event('input'));
      return;
    }

    // ── Case B: Enter on the last empty content block → escape the toggle ────
    // Find the direct-child-of-details block that holds the caret.
    let block = sel.anchorNode;
    while (block && block.parentNode !== details) block = block.parentNode;
    if (!block || block === summary) return;

    const isLast  = block === details.lastChild;
    const isEmpty = block.textContent.trim() === '' ||
                    (block.childNodes.length === 1 && block.firstChild?.nodeName === 'BR');

    if (isLast && isEmpty) {
      e.preventDefault();
      // Remove the now-useless empty trailing block
      details.removeChild(block);
      // Insert a fresh paragraph after the <details> and move caret there
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      if (details.nextSibling) details.parentNode.insertBefore(p, details.nextSibling);
      else                     details.parentNode.appendChild(p);
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      ce.dispatchEvent(new Event('input'));
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


/* ───────────────────────────────────────────
   Toggle heading — icon-only click
   Intercepts ALL clicks on .bw-toggle > summary in capture phase (before
   the browser’s built-in <details> toggle fires). The toggle only opens/
   closes when the click lands on the [data-bw-ti] icon span.
   ─────────────────────────────────────────── */
document.addEventListener('click', (e) => {
  const summary = e.target.closest('.bw-toggle > summary');
  if (!summary) return;
  e.preventDefault(); // always block the browser’s built-in toggle
  if (e.target.closest('[data-bw-ti]')) {
    const details = summary.parentElement;
    if (details) details.open = !details.open;
  }
}, true); // capture phase — fires before the browser’s native <details> handler


/* ───────────────────────────────────────────
   Init — run on load and after every HTMX swap
   ─────────────────────────────────────────── */
function _scInit() {
  if (!_sc.palette) _sc.palette = _buildPalette();

  const ta = document.getElementById('note-content');
  const ce = document.getElementById('md-live-preview');
  if (ta) _attachTextarea(ta);
  if (ce) _attachCE(ce);

  // Inject [data-bw-ti] icon into any legacy toggle summaries that predate
  // this feature (i.e. summaries with no icon span yet).
  document.querySelectorAll('.bw-toggle > summary').forEach(summary => {
    if (!summary.querySelector('[data-bw-ti]')) {
      const icon = document.createElement('span');
      icon.dataset.bwTi = '';
      summary.prepend(icon);
    }
  });

  // Tell turndown to preserve our custom HTML blocks instead of stripping them.
  // We wait a tick so initEditor()'s IIFE has had time to assign window._bwTurndown.
  setTimeout(() => {
    const td = window._bwTurndown;
    if (!td || td._bwKeepConfigured) return;

    // Inline reminder chip — emit outerHTML verbatim so all data-* survive.
    // Must use addRule (not keep()) because keep() uses content-wrapping,
    // not outerHTML, so data attributes would be lost.
    td.addRule('bwReminderChip', {
      filter:      node => node.nodeName === 'SPAN' && node.classList?.contains('bw-reminder-chip'),
      replacement: (_c, node) => node.outerHTML,
    });

    // Block-level custom elements — keep() is appropriate here.
    td.keep(node =>
      node.nodeName === 'DETAILS' ||
      node.nodeName === 'SUMMARY' ||
      (node.nodeName === 'DIV' && (
        node.classList?.contains('bw-cols') ||
        node.classList?.contains('bw-col')  ||
        node.classList?.contains('bw-callout') ||
        node.classList?.contains('bw-callout-icon') ||
        node.classList?.contains('bw-callout-body') ||
        node.classList?.contains('bw-tabs')
      ))
    );
    td._bwKeepConfigured = true;
  }, 50);

  // Delegated click on reminder chips in the live preview — opens edit dialog.
  // Uses capture phase so it fires before contenteditable focus handling.
  // (ce is already declared at the top of _scInit)
  if (ce && !ce._bwReminderClickBound) {
    ce._bwReminderClickBound = true;
    ce.addEventListener('mousedown', (e) => {
      const chip = e.target.closest('.bw-reminder-chip');
      if (!chip) return;
      e.preventDefault();
      e.stopPropagation();
      _reminderDialog(null, ce, null, chip);
    }, true);
  }
}

document.addEventListener('DOMContentLoaded', _scInit);
document.addEventListener('htmx:afterSwap',   _scInit);

/** Public: returns true when the slash-command palette is currently open.
 *  Used by other scripts to guard against conflicting Enter-key handlers. */
function scIsOpen() { return !!_sc.open; }

/** Public: attach slash-command support to a contenteditable element.
 *  Call this whenever a CE editor is dynamically activated (e.g. text widget). */
window.bwSlashAttachCE = function (ce) { _attachCE(ce); };


/* ─────────────────────────────────────────
   Note reminder persistence + browser notifications
   ───────────────────────────────────────── */

/**
 * Fire-and-forget: saves the reminder to the DB and requests notification
 * permission on the first call. Called from _reminderDialog insert().
 */
/** Save reminder to DB. Returns the reminder id, or null on failure. */
async function _saveNoteReminder(date, time, label, message) {
  /* Request browser notification permission (only prompts once) */
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  const noteId = (typeof window._bwNoteId !== 'undefined') ? window._bwNoteId : null;
  try {
    const res = await fetch('/home/note-reminders/add', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        note_id:       noteId,
        label:         label,
        reminder_date: date,
        reminder_time: time,
        message:       message || '',
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('[bw-reminder] save failed', res.status, txt);
      return null;
    }
    const data = await res.json();
    return data.id ?? null;
  } catch (err) {
    console.warn('[bw-reminder] network error saving reminder:', err);
    return null;
  }
}

/**
 * Lightweight in-app toast used when _showReminderToast (home page) is absent.
 * Matches the same pill style so it looks consistent everywhere.
 */
function _bwReminderToast(text, durationMs = 8000) {
  if (typeof _showReminderToast === 'function') {
    _showReminderToast(text, durationMs);
    return;
  }
  /* Minimal fallback: a fixed toast pill at the bottom-right */
  const dark  = document.documentElement.classList.contains('dark');
  const toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999',
    padding: '12px 18px', borderRadius: '10px', maxWidth: '340px',
    background: dark ? '#27272a' : '#ffffff',
    color:      dark ? '#f4f4f5' : '#111827',
    boxShadow:  '0 4px 20px rgba(0,0,0,.18)',
    border:     dark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
    borderLeft: '3px solid #0053e2',
    fontSize: '14px', lineHeight: '1.45', whiteSpace: 'pre-line',
    transition: 'opacity .3s', opacity: '1',
  });
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 320);
  }, durationMs);
}

/** Key: `${id}-${date}` — prevents the same reminder firing twice in one session. */
const _bwFiredReminders = {};

/**
 * Write a fired reminder into the same localStorage queue that the home-page
 * bell uses, then refresh the badge count. Works on every page because the
 * bell is part of the main shell (index.html), not just the home widget.
 */
function _bwLogMissedReminder(text, time) {
  /* Delegate to home-page function when available (already manages storage) */
  if (typeof _remLogMissed === 'function') {
    _remLogMissed(text, time);
    return;
  }
  /* Fallback: write to localStorage directly with the same key format */
  try {
    const key   = 'bw-missed-' + new Date().toISOString().slice(0, 10);
    const queue = JSON.parse(localStorage.getItem(key) || '[]');
    queue.push({ text, time, ts: Date.now() });
    localStorage.setItem(key, JSON.stringify(queue));
    /* Update badge count if the bell is in the current DOM */
    const badge = document.getElementById('rem-bell-badge');
    if (badge) {
      const n = queue.length;
      badge.textContent = n > 9 ? '9+' : String(n);
      badge.classList.remove('hidden');
    }
  } catch (_) {}
}

/** Convert 'HH:MM' string to total minutes since midnight. */
function _bwToMins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

async function _checkNoteReminders() {
  try {
    const now = new Date();
    /* Always use LOCAL calendar date — toISOString() gives UTC which is wrong
       for US users in the evening where UTC is already the next calendar day. */
    const ymd  = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const hhmm    = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const nowMins = now.getHours() * 60 + now.getMinutes();

    const res = await fetch('/home/note-reminders/due?date=' + ymd,
                            { credentials: 'same-origin' });
    if (!res.ok) {
      console.warn('[bw-reminder] /due returned', res.status);
      return;
    }
    const items = await res.json();
    if (!Array.isArray(items)) return;

    for (const item of items) {
      const remMins = _bwToMins(item.reminder_time);
      /* Fire if reminder is within the past 3 minutes (handles throttled tabs
         and the up-to-60 s gap between polls). Skip anything older than that
         so we don't blast stale reminders when the browser wakes up. */
      if (remMins > nowMins || remMins < nowMins - 3) continue;

      const key = item.id + '-' + ymd;
      if (_bwFiredReminders[key]) continue;
      _bwFiredReminders[key] = true;

      const titleText = item.label || 'Reminder';
      const bodyText  = item.message || '';
      /* Pass title + optional message as newline-separated text.
         _showReminderToast renders \n as <br>, and supplies its own 🔔 icon. */
      const toastText = bodyText ? `${titleText}\n${bodyText}` : titleText;

      /* ── Browser notification ── */
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification('\ud83d\udcd6 BookWorm Reminder', {
            body: bodyText ? titleText + '\n' + bodyText : titleText,
          });
        } catch (_) {}
      }

      /* ── In-app toast ── */
      _bwReminderToast(toastText);

      /* ── Log to Missed Reminders bell (localStorage + badge) ── */
      _bwLogMissedReminder(toastText, hhmm);

      /* ── Dismiss on backend so it won’t re-fire ── */
      fetch(`/home/note-reminders/${item.id}/dismiss`, {
        method: 'POST', credentials: 'same-origin',
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('[bw-reminder] _checkNoteReminders error:', err);
  }
}

/* Start polling once the page is ready. Restarted on HTMX swaps via the
   _scInit path — but since we use a module-level _bwFiredReminders map
   (not on the element) the interval guard is a simple boolean on window. */
function _startNoteReminderPoller() {
  if (window._bwReminderPollerActive) return;
  window._bwReminderPollerActive = true;
  _checkNoteReminders();                           // immediate first check
  setInterval(_checkNoteReminders, 60_000);        // then every 60 s
}

document.addEventListener('DOMContentLoaded', _startNoteReminderPoller);