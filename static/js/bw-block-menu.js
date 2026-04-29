/**
 * bw-block-menu.js — shared block context menu for BookWorm note editors.
 *
 * Exposes:  window._bwBlockMenu(gripEl, blockEl, opts)
 *
 * opts = {
 *   reInjectGrips : fn()   — re-stamp grips after DOM mutation
 *   syncToBackend : fn()   — persist content after mutation
 *   gripAttr      : str    — e.g. 'data-db-grip' or 'data-preview-grip'
 * }
 *
 * Depends on: window._bwRowMenu  (home-widgets.js — loaded first via base.html)
 * Rules: ALL var — no let/const (global defer script).
 */

/* ── Turn-into target definitions ─────────────────────────────────────────── */
var _BMK_TYPES = [
  { key: 'p',       label: 'Paragraph',     icon: '¶' },
  { key: 'h1',      label: 'Heading 1',     icon: 'H1' },
  { key: 'h2',      label: 'Heading 2',     icon: 'H2' },
  { key: 'h3',      label: 'Heading 3',     icon: 'H3' },
  { key: 'ul',      label: 'Bullet list',   icon: '•' },
  { key: 'ol',      label: 'Numbered list', icon: '1.' },
  { key: 'todo',    label: 'To-do',         icon: '☐' },
  { key: 'quote',   label: 'Quote',         icon: '"' },
  { key: 'code',    label: 'Code',          icon: '</>' },
  { key: 'callout', label: 'Callout',       icon: '💡' },
];

/* ── Highlight colours ─────────────────────────────────────────────────────── */
var _BMK_HL_COLORS = [
  { label: 'None',   color: null },
  { label: 'Yellow', color: '#fef08a' },
  { label: 'Green',  color: '#bbf7d0' },
  { label: 'Blue',   color: '#bfdbfe' },
  { label: 'Pink',   color: '#fbcfe8' },
  { label: 'Orange', color: '#fed7aa' },
  { label: 'Spark',  color: '#fff0a0' },
  { label: 'Red',    color: '#fecaca' },
  { label: 'Purple', color: '#e9d5ff' },
];

/* ── Text colours ──────────────────────────────────────────────────────────── */
var _BMK_TC_COLORS = [
  { label: 'Default', color: null       },
  { label: 'Black',   color: '#111111'  },
  { label: 'Gray',    color: '#6b7280'  },
  { label: 'Red',     color: '#ea1100'  },
  { label: 'Orange',  color: '#f97316'  },
  { label: 'Yellow',  color: '#b87800'  },
  { label: 'Green',   color: '#2a8703'  },
  { label: 'Blue',    color: '#0053e2'  },
  { label: 'Purple',  color: '#7c3aed'  },
];

/* ── Active color palette element (custom dropdown) ──────────────────────── */
var _bmkColorPaletteEl = null;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/* Detect current block type (returns a _BMK_TYPES.key string) */
function _bwBlockCurrentType(el) {
  var tag = (el.tagName || '').toLowerCase();
  if (tag === 'h1') return 'h1';
  if (tag === 'h2') return 'h2';
  if (tag === 'h3') return 'h3';
  if (tag === 'ul') return 'ul';
  if (tag === 'ol') return 'ol';
  if (tag === 'blockquote') return 'quote';
  if (tag === 'pre') return 'code';
  if (el.classList && el.classList.contains('bw-callout')) return 'callout';
  if (el.dataset && el.dataset.todo) return 'todo';
  return 'p';
}

/* Extract readable text from a block, stripping grip spans first */
function _bwBlockGetText(el, gripAttr) {
  var clone = el.cloneNode(true);
  if (gripAttr) {
    clone.querySelectorAll('[' + gripAttr + ']').forEach(function(g) { g.remove(); });
  }
  return clone.textContent || '';
}

/* ── DOM mutator: Turn into ──────────────────────────────────────────────── */

function _bwBlockTurnInto(blockEl, typeKey, opts) {
  var text = _bwBlockGetText(blockEl, opts.gripAttr);
  var safeText = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  var newEl = null;

  if (typeKey === 'p') {
    newEl = document.createElement('p');
    newEl.innerHTML = safeText;
  } else if (typeKey === 'h1') {
    newEl = document.createElement('h1');
    newEl.innerHTML = safeText;
  } else if (typeKey === 'h2') {
    newEl = document.createElement('h2');
    newEl.innerHTML = safeText;
  } else if (typeKey === 'h3') {
    newEl = document.createElement('h3');
    newEl.innerHTML = safeText;
  } else if (typeKey === 'ul') {
    newEl = document.createElement('ul');
    var li = document.createElement('li');
    li.innerHTML = safeText;
    newEl.appendChild(li);
  } else if (typeKey === 'ol') {
    newEl = document.createElement('ol');
    var li2 = document.createElement('li');
    li2.innerHTML = safeText;
    newEl.appendChild(li2);
  } else if (typeKey === 'todo') {
    newEl = document.createElement('p');
    newEl.setAttribute('data-todo', '1');
    newEl.innerHTML = '☐ ' + safeText;
  } else if (typeKey === 'quote') {
    newEl = document.createElement('blockquote');
    newEl.innerHTML = safeText;
  } else if (typeKey === 'code') {
    newEl = document.createElement('pre');
    var code = document.createElement('code');
    code.textContent = text;   // raw text, no HTML escaping needed
    newEl.appendChild(code);
  } else if (typeKey === 'callout') {
    newEl = document.createElement('div');
    newEl.className = 'bw-callout bw-callout-info';
    var inner = document.createElement('p');
    inner.innerHTML = safeText;
    newEl.appendChild(inner);
  } else {
    return null;   // unknown type — no-op
  }

  /* Preserve existing inline color/bg if present */
  if (blockEl.style.color)      newEl.style.color      = blockEl.style.color;
  if (blockEl.style.background) newEl.style.background = blockEl.style.background;

  blockEl.parentElement.replaceChild(newEl, blockEl);
  opts.reInjectGrips();
  opts.syncToBackend();
  return newEl;
}

/* ── Apply / clear inline colour to a block ──────────────────────────────── */

function _bwBlockApplyColor(blockEl, colorHex, isHighlight) {
  if (isHighlight) {
    blockEl.style.background = colorHex || '';
  } else {
    blockEl.style.color = colorHex || '';
  }
}

/* ── Color palette (custom dropdown — not _bwRowMenu) ────────────────────── */

function _bmkCloseColorPalette() {
  if (_bmkColorPaletteEl) {
    _bmkColorPaletteEl.remove();
    _bmkColorPaletteEl = null;
  }
  document.removeEventListener('mousedown', _bmkColorPaletteOutside);
  document.removeEventListener('keydown',   _bmkColorPaletteKey);
}
function _bmkColorPaletteOutside(e) {
  if (_bmkColorPaletteEl && !_bmkColorPaletteEl.contains(e.target)) {
    _bmkCloseColorPalette();
  }
}
function _bmkColorPaletteKey(e) {
  if (e.key === 'Escape') _bmkCloseColorPalette();
}

function _bwBlockMenuColor(gripEl, blockEl, opts) {
  _bmkCloseColorPalette();   // close any existing

  var pal = document.createElement('div');
  pal.className =
    'fixed z-[9999] rounded-xl shadow-xl border py-2 px-2 ' +
    'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-700';
  pal.style.minWidth = '210px';

  function makeSection(title, colors, isHighlight) {
    var sec = document.createElement('div');
    sec.className = 'mb-2';
    var hdr = document.createElement('p');
    hdr.className = 'text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-1 px-1';
    hdr.textContent = title;
    sec.appendChild(hdr);
    var row = document.createElement('div');
    row.className = 'flex flex-wrap gap-1 px-1';
    colors.forEach(function(c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.title = c.label;
      btn.setAttribute('aria-label', (isHighlight ? 'Highlight ' : 'Text color ') + c.label);
      btn.className = 'w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-blue-500';
      if (c.color) {
        btn.style.background = c.color;
        btn.style.borderColor = '#d1d5db';
      } else {
        /* "None" — half-and-half pattern */
        btn.style.background = 'linear-gradient(135deg, white 50%, #d1d5db 50%)';
        btn.style.borderColor = '#d1d5db';
      }
      /* Highlight current selection with a check */
      var curColor = isHighlight ? blockEl.style.background : blockEl.style.color;
      if ((c.color === null && !curColor) || (c.color && curColor === c.color)) {
        btn.style.borderColor = '#0053e2';
        btn.style.borderWidth = '2.5px';
      }
      btn.addEventListener('click', function() {
        _bwBlockApplyColor(blockEl, c.color, isHighlight);
        opts.syncToBackend();
        _bmkCloseColorPalette();
      });
      row.appendChild(btn);
    });
    sec.appendChild(row);
    return sec;
  }

  pal.appendChild(makeSection('Text color', _BMK_TC_COLORS, false));
  pal.appendChild(makeSection('Highlight', _BMK_HL_COLORS, true));

  document.body.appendChild(pal);
  _bmkColorPaletteEl = pal;

  /* Position near the grip */
  var gr = gripEl.getBoundingClientRect();
  var pw = pal.offsetWidth  || 210;
  var ph = pal.offsetHeight || 140;
  var top  = gr.bottom + 4;
  var left = Math.max(4, gr.right - pw);
  if (top + ph > window.innerHeight - 8) top = Math.max(4, gr.top - ph - 4);
  pal.style.top  = top  + 'px';
  pal.style.left = left + 'px';

  setTimeout(function() {
    document.addEventListener('mousedown', _bmkColorPaletteOutside);
    document.addEventListener('keydown',   _bmkColorPaletteKey);
  }, 0);
}

/* ── Turn-into sub-menu ──────────────────────────────────────────────────── */

function _bwBlockMenuTurnInto(gripEl, blockEl, opts) {
  var cur = _bwBlockCurrentType(blockEl);
  var fakeEvt = { currentTarget: gripEl, stopPropagation: function() {} };
  var items = _BMK_TYPES.map(function(t) {
    var isActive = t.key === cur;
    return {
      label: (isActive ? '✓ ' : '') + t.label,
      icon: '<span style="display:inline-block;width:1.4em;text-align:center;font-size:.75rem;opacity:.65;">'
            + t.icon + '</span>',
      action: (function(typeKey) {
        return function() {
          if (typeKey === cur) return;
          _bwBlockTurnInto(blockEl, typeKey, opts);
        };
      })(t.key),
    };
  });
  window._bwRowMenu(fakeEvt, items);
}

/* ── Top-level block context menu ────────────────────────────────────────── */

window._bwBlockMenu = function(gripEl, blockEl, opts) {
  if (typeof window._bwRowMenu !== 'function') {
    console.warn('[bw-block-menu] _bwRowMenu not available — home-widgets.js not loaded yet?');
    return;
  }
  var fakeEvt = { currentTarget: gripEl, stopPropagation: function() {} };

  var items = [
    {
      label: 'Turn into',
      icon: _bmkIconTurnInto(),
      action: function() { _bwBlockMenuTurnInto(gripEl, blockEl, opts); },
    },
    {
      label: 'Color',
      icon: _bmkIconColor(),
      action: function() { _bwBlockMenuColor(gripEl, blockEl, opts); },
    },
    { sep: true },
    {
      label: 'Duplicate',
      icon: _bmkIconDuplicate(),
      action: function() {
        var clone = blockEl.cloneNode(true);
        /* Strip grips from the clone so they get re-injected fresh */
        if (opts.gripAttr) {
          clone.querySelectorAll('[' + opts.gripAttr + ']').forEach(function(g) { g.remove(); });
        }
        /* Reset internal wiring flags */
        clone._bwGripListened = false;
        clone._dbGripListened = false;
        blockEl.parentElement.insertBefore(clone, blockEl.nextSibling);
        opts.reInjectGrips();
        opts.syncToBackend();
      },
    },
    {
      label: 'Delete',
      icon: _bmkIconDelete(),
      danger: true,
      action: function() {
        blockEl.remove();
        opts.reInjectGrips();
        opts.syncToBackend();
      },
    },
  ];

  window._bwRowMenu(fakeEvt, items);
};

/* ── Icon helpers (inline SVG / text) ───────────────────────────────────── */

function _bmkIconTurnInto() {
  return '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h10M4 18h7"/>'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="M18 15l3 3-3 3"/>'
    + '</svg>';
}
function _bmkIconColor() {
  return '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/>'
    + '</svg>';
}
function _bmkIconDuplicate() {
  return '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">'
    + '<rect x="9" y="9" width="13" height="13" rx="2"/>'
    + '<path stroke-linecap="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>'
    + '</svg>';
}
function _bmkIconDelete() {
  return '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>'
    + '</svg>';
}
