'use strict';
/* ─────────────────────────────────────────────────────────────────────────────
   home-widget-text-fmt.js
   Floating selection toolbar for the text widget in edit mode.

   Appears above highlighted text inside a contenteditable tw-view.
   Actions: Bold · Italic · Strikethrough · Highlight color · Text color ·
            Font size ±2 px

   Public API (called by home-widget-text.js):
     window.bwFmtAttach(view)   ← call on openTextEdit()
     window.bwFmtDetach(view)   ← call on _exitEditMode()
   ───────────────────────────────────────────────────────────────────────────── */

// ── Color palettes ────────────────────────────────────────────────────────────
const _TC = [
  ['inherit',  'Default'],
  ['#1f2937',  'Near-black'], ['#6b7280', 'Gray'],
  ['#ef4444',  'Red'],        ['#f97316', 'Orange'], ['#eab308', 'Yellow'],
  ['#22c55e',  'Green'],      ['#3b82f6', 'Blue'],   ['#8b5cf6', 'Purple'],
  ['#ec4899',  'Pink'],
];
const _HC = [
  ['transparent', 'Clear'],
  ['#fef08a', 'Yellow'], ['#bbf7d0', 'Green'],  ['#bfdbfe', 'Blue'],
  ['#fecaca', 'Red'],    ['#fed7aa', 'Orange'],  ['#e9d5ff', 'Purple'],
  ['#fbcfe8', 'Pink'],
];

// ── Module state ──────────────────────────────────────────────────────────────
let _bar  = null;  // toolbar  <div>  — singleton, built once
let _pal  = null;  // palette  <div>  — singleton, built once
let _view = null;  // active tw-view element
let _palMode = '';

// Stored so we can cleanly remove them in bwFmtDetach
let _docMouseupHandler = null;
let _viewKeyupHandler  = null;
let _docMousedownHandler = null;

// ── Build toolbar + palette singletons ───────────────────────────────────────
function _buildBar() {
  if (_bar) return;

  /* ── Toolbar ─────────────────────────────────────────────────────────────── */
  _bar = document.createElement('div');
  _bar.id = 'tw-fmt-bar';
  Object.assign(_bar.style, { position: 'fixed', zIndex: '9999', display: 'none' });
  _bar.className = [
    'flex items-center gap-0.5 p-1',
    'bg-white dark:bg-zinc-800',
    'border border-gray-200 dark:border-zinc-600',
    'rounded-lg shadow-xl select-none pointer-events-auto',
  ].join(' ');

  const _btn = (html, title, action) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.innerHTML = html;
    b.className = [
      'w-7 h-7 flex items-center justify-center rounded transition',
      'text-gray-700 dark:text-zinc-200 text-sm font-medium',
      'hover:bg-gray-100 dark:hover:bg-zinc-700',
    ].join(' ');
    // preventDefault keeps contenteditable focus + selection intact
    b.addEventListener('mousedown', e => {
      e.preventDefault();
      action(b);
    });
    return b;
  };

  const _sep = () => {
    const d = document.createElement('div');
    d.className = 'w-px h-5 bg-gray-200 dark:bg-zinc-600 mx-0.5 flex-shrink-0';
    return d;
  };

  const _hlBtn = _btn(
    '<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">'
    + '<path d="M13.586 3.586a2 2 0 112.828 2.828l-1.06 1.06-2.829-2.828 1.061-1.06z"/>'
    + '<path d="M11.232 5.94L3 14.172V17h2.828l8.232-8.232-2.828-2.828z"/></svg>',
    'Highlight color',
    b => _openPal(b, 'back'),
  );
  _hlBtn.style.borderBottom = '3px solid #fef08a';

  const _tcBtn = _btn(
    '<span style="font-size:13px;font-weight:700;font-style:normal">A</span>',
    'Text color',
    b => _openPal(b, 'fore'),
  );
  _tcBtn.style.borderBottom = '3px solid #3b82f6';

  _bar.append(
    _btn('<b style="font-size:13px">B</b>',          'Bold',          () => document.execCommand('bold')),
    _btn('<i style="font-size:13px">I</i>',           'Italic',        () => document.execCommand('italic')),
    _btn('<s style="font-size:12px">S</s>',           'Strikethrough', () => document.execCommand('strikeThrough')),
    _sep(),
    _hlBtn,
    _tcBtn,
    _sep(),
    _btn('<span style="font-size:11px;font-weight:700">A<sup>+</sup></span>', 'Increase size', () => _changeSize(+2)),
    _btn('<span style="font-size:11px;font-weight:700">A<sub>-</sub></span>', 'Decrease size', () => _changeSize(-2)),
  );

  /* ── Palette popover ─────────────────────────────────────────────────────── */
  _pal = document.createElement('div');
  _pal.id = 'tw-fmt-pal';
  Object.assign(_pal.style, { position: 'fixed', zIndex: '10000', display: 'none', maxWidth: '168px' });
  _pal.className = [
    'flex flex-wrap gap-1.5 p-2',
    'bg-white dark:bg-zinc-800',
    'border border-gray-200 dark:border-zinc-600',
    'rounded-lg shadow-xl',
  ].join(' ');

  document.body.append(_bar, _pal);
}

// ── Palette ───────────────────────────────────────────────────────────────────
function _openPal(anchor, mode) {
  _palMode = mode;
  _pal.innerHTML = '';
  const swatches = mode === 'fore' ? _TC : _HC;

  swatches.forEach(([val, label]) => {
    const sw = document.createElement('button');
    sw.type  = 'button';
    sw.title = label;
    sw.addEventListener('mousedown', e => {
      e.preventDefault();
      _applyColor(val, mode);
      _closePal();
    });
    if (val === 'transparent' || val === 'inherit') {
      sw.className = 'w-6 h-6 rounded border border-gray-300 dark:border-zinc-500 overflow-hidden relative flex-shrink-0';
      sw.innerHTML =
        '<span class="absolute inset-0" style="background:repeating-linear-gradient(45deg,#ddd 0,#ddd 2px,#fff 0,#fff 6px)"></span>'
        + '<span class="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-gray-500">✕</span>';
    } else {
      sw.className = 'w-6 h-6 rounded border border-gray-200 dark:border-zinc-600 hover:scale-110 transition-transform flex-shrink-0';
      sw.style.backgroundColor = val;
    }
    _pal.appendChild(sw);
  });

  _pal.style.display = 'flex';
  const ab  = anchor.getBoundingClientRect();
  let  left = ab.left;
  if (left + 168 > window.innerWidth - 8) left = window.innerWidth - 176;
  _pal.style.left = `${Math.max(8, left)}px`;
  _pal.style.top  = `${ab.bottom + 6}px`;
}

function _closePal() {
  if (_pal) _pal.style.display = 'none';
}

// ── Format helpers ────────────────────────────────────────────────────────────
function _applyColor(val, mode) {
  if (!_view) return;
  _view.focus();
  document.execCommand('styleWithCSS', false, true);
  if (mode === 'fore') {
    document.execCommand('foreColor', false, val === 'inherit' ? '#111827' : val);
  } else {
    document.execCommand('backColor', false, val === 'transparent' ? 'transparent' : val);
  }
  document.execCommand('styleWithCSS', false, false);
}

function _changeSize(deltaPx) {
  if (!_view) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return;
  let node = sel.anchorNode;
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;

  // Walk up to find an existing size span — update in-place to avoid nesting.
  // Nested spans leave the outer (larger) font-size controlling the line-box,
  // so the block stays tall after text shrinks back, causing grip drift.
  let sizeSpan = null;
  for (let cur = node; cur && cur !== _view; cur = cur.parentElement) {
    if (cur.nodeName === 'SPAN' && cur.style?.fontSize) { sizeSpan = cur; break; }
  }

  const currentPx = parseFloat(getComputedStyle(node).fontSize) || 14;
  const newPx     = Math.max(10, Math.min(48, currentPx + deltaPx));

  let targetSpan;
  if (sizeSpan) {
    sizeSpan.style.fontSize = `${newPx}px`;
    targetSpan = sizeSpan;
  } else {
    const range = sel.getRangeAt(0);
    targetSpan  = document.createElement('span');
    targetSpan.style.fontSize = `${newPx}px`;
    try {
      range.surroundContents(targetSpan);
    } catch {
      targetSpan.appendChild(range.extractContents());
      range.insertNode(targetSpan);
    }
  }

  sel.removeAllRanges();
  const nr = document.createRange();
  nr.selectNodeContents(targetSpan);
  sel.addRange(nr);
}

// ── Show / hide toolbar ───────────────────────────────────────────────────────
function _tryShow() {
  if (!_bar || !_view) return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) {
    _hideBar();
    return;
  }

  const range = sel.getRangeAt(0);
  // Only show when the selection is actually inside our view
  if (!_view.contains(range.commonAncestorContainer)) {
    _hideBar();
    return;
  }

  const rect = range.getBoundingClientRect();
  // getBoundingClientRect returns zeros for collapsed / invisible ranges
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    _hideBar();
    return;
  }

  const barW  = 280;  // conservative estimate before layout
  const barH  = 36;
  let   left  = rect.left + rect.width / 2 - barW / 2;
  left        = Math.max(8, Math.min(left, window.innerWidth - barW - 8));
  const top   = Math.max(8, rect.top - barH - 8);

  _bar.style.left    = `${left}px`;
  _bar.style.top     = `${top}px`;
  _bar.style.display = 'flex';
}

function _hideBar() {
  if (_bar) _bar.style.display = 'none';
  _closePal();
}

// ── Public API ────────────────────────────────────────────────────────────────
window.bwFmtAttach = function (view) {
  _buildBar();
  _view = view;

  // mouseup on document catches drag-releases that end outside the view element
  _docMouseupHandler = () => requestAnimationFrame(_tryShow);
  document.addEventListener('mouseup', _docMouseupHandler);

  // keyup on view catches Shift+arrow keyboard selections
  _viewKeyupHandler = e => {
    if (e.shiftKey || e.key === 'End' || e.key === 'Home') {
      requestAnimationFrame(_tryShow);
    }
  };
  view.addEventListener('keyup', _viewKeyupHandler);

  // Hide when the user clicks somewhere that isn't the toolbar or palette
  _docMousedownHandler = e => {
    if (!_bar || _bar.style.display === 'none') return;
    if (_bar.contains(e.target) || _pal?.contains(e.target)) return;
    _hideBar();
  };
  document.addEventListener('mousedown', _docMousedownHandler);
};

window.bwFmtDetach = function (view) {
  _hideBar();
  _view = null;
  if (_docMouseupHandler)   document.removeEventListener('mouseup',    _docMouseupHandler);
  if (_viewKeyupHandler && view) view.removeEventListener('keyup', _viewKeyupHandler);
  if (_docMousedownHandler) document.removeEventListener('mousedown',  _docMousedownHandler);
  _docMouseupHandler   = null;
  _viewKeyupHandler    = null;
  _docMousedownHandler = null;
};
