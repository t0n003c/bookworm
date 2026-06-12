'use strict';
/* ──────────────────────────────────────────────────────────────────────────────
   home-widget-text.js — Text widget for HomeSpace.

   Editing is done entirely in Preview mode (contenteditable rendered HTML).
   Raw Markdown is never shown to the user.

   Pipeline:
     Load  : data-raw-md  → marked.parse → DOMPurify → innerHTML
     Save  : innerHTML    → Turndown (HTML→MD) → POST /home/widgets/N/update-config
     Reload: new markdown → marked.parse → DOMPurify → innerHTML (no page refresh)

   Editor flow:
     openTextEdit(id)        → make view div contenteditable, show Save/Cancel bar
     cancelTextEdit(id)      → restore original HTML, exit edit mode
     saveTextEdit(id,pageId) → HTML→MD → POST → re-render, exit edit mode
   ─────────────────────────────────────────────────────────────────────────── */

// ── Lazy Turndown instance (GFM tables + strikethrough if plugin available) ───
let _td = null;
function _getTurndown() {
  if (_td) return _td;
  if (typeof TurndownService === 'undefined') {
    console.warn('[text-widget] TurndownService not loaded — will store HTML as-is');
    return null;
  }
  _td = new TurndownService({
    headingStyle:   'atx',       // # H1 instead of underline style
    hr:             '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence:          '```',
    emDelimiter:    '_',
    strongDelimiter: '**',
    linkStyle:      'inlined',
  });
  // Wire up the GFM plugin (tables, strikethrough, task-lists) if loaded
  if (window.turndownPluginGfm) _td.use(turndownPluginGfm.gfm);
  // Keep <pre><code> blocks as fenced code fences
  _td.addRule('fenced-code', {
    filter: node => node.nodeName === 'PRE' && node.querySelector('code'),
    replacement(_, node) {
      const code = node.querySelector('code');
      const lang = (code.className.match(/language-(\S+)/) || [])[1] || '';
      return `\n\`\`\`${lang}\n${code.textContent.trim()}\n\`\`\`\n`;
    },
  });
  return _td;
}

// ── Markdown → sanitized HTML ─────────────────────────────────────────────────
function _renderMarkdown(raw) {
  if (!raw || !raw.trim()) {
    return '<span class="text-gray-400 dark:text-zinc-500 text-sm italic">'
         + 'Empty — click ✏️ to add content.</span>';
  }
  const dirty = (typeof marked !== 'undefined')
    ? marked.parse(raw)
    : raw.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(dirty) : dirty;
}

// ── Init: render every tw-view-N on the page ──────────────────────────────────
window.initTextWidgets = function () {
  document.querySelectorAll('[data-raw-md]').forEach(el => {
    const raw = el.getAttribute('data-raw-md') || '';
    el.innerHTML = _renderMarkdown(raw);
    if (typeof _bwApplyCodeHighlighting === 'function') _bwApplyCodeHighlighting(el);
  });
};

// ── Strip hljs decorations so code blocks are clean to edit ────────────────
// Called on enter-edit. The pre-edit snapshot is taken first so Cancel
// restores the fully-highlighted version without any extra work.
function _prepCodeBlocksForEdit(view) {
  view.querySelectorAll('.bw-code-block').forEach(wrapper => {
    const pre = wrapper.querySelector('pre');
    if (!pre) { wrapper.remove(); return; }

    // Collapse hljs spans → plain text so editing is clean
    const code = pre.querySelector('code');
    if (code) {
      const plain = code.textContent;
      const langMatch = (code.className || '').match(/language-(\S+)/);
      const lang = langMatch ? langMatch[1] : '';
      code.className   = lang ? `language-${lang}` : '';
      // Strip the trailing \n that marked.js always appends
      code.textContent = plain.replace(/\n$/, '');
      // Keep data-lang on <pre> so the CSS ::before badge still shows
      if (lang) pre.dataset.lang = lang;
      else       delete pre.dataset.lang;
      // plaintext-only gives the code element its own editing context:
      // Enter inserts a literal '\n' with correct cursor placement, no
      // <div>/<br> wrapping. Falls back gracefully in unsupported browsers.
      code.contentEditable = 'plaintext-only';
      code.spellcheck = false;
    }

    // Lift <pre> out of the wrapper (replaces it in the DOM)
    wrapper.parentNode.insertBefore(pre, wrapper);
    wrapper.remove();
  });

  // Guarantee every <pre> has a focusable non-code sibling immediately after
  // so the user always has a click target to escape the code block.
  view.querySelectorAll('pre').forEach(pre => {
    const next = pre.nextElementSibling;
    if (!next || next.tagName === 'PRE') {
      const p = Object.assign(document.createElement('p'), { innerHTML: '<br>' });
      pre.after(p);
    }
  });
}

// ── Keydown handler for the text-widget contenteditable ──────────────────────
// Code blocks use contentEditable="plaintext-only" so the browser natively
// inserts a literal '\n' on Enter with correct cursor placement — no handler
// needed for Chrome/Safari. The Enter branch below is a Firefox fallback only.
// Tab / Shift+Tab in <li> → indent / dedent list items.
// Tab in <pre>            → insert 2 spaces (browser would move focus otherwise).
function _handleCodeBlockKeys(e) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  let n = sel.getRangeAt(0).startContainer;
  if (n.nodeType === Node.TEXT_NODE) n = n.parentElement;
  const pre = n?.closest('pre');

  // ── Tab inside a code block → 2-space indent ─────────────────────────────
  if (e.key === 'Tab' && pre) {
    e.preventDefault();
    document.execCommand('insertText', false, '  ');
    return;
  }

  // ── Enter inside a code block (Firefox fallback) ──────────────────────────
  // Chrome/Safari handle Enter natively via plaintext-only; skip if supported.
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && pre) {
    const code = pre.querySelector('code') || pre;
    if (code.contentEditable === 'plaintext-only') return; // browser owns this
    e.preventDefault();
    document.execCommand('insertText', false, '\n');
    return;
  }


  if (e.key !== 'Tab') return;

  // Walk up from the caret to find the nearest <li> ancestor
  const li = n ? n.closest('li') : null;
  if (!li) return;                     // not in a list — let browser handle Tab

  e.preventDefault();

  const parentList = li.parentElement; // the <ul> or <ol> containing this <li>

  if (!e.shiftKey) {
    // ── Indent: nest this <li> inside the previous sibling's sub-list ──────
    const prevLi = li.previousElementSibling;
    if (!prevLi) return;               // first item — can't indent further

    const tag = parentList.tagName;    // preserve UL vs OL
    let nested = prevLi.querySelector(`:scope > ${tag}`);
    if (!nested) {
      nested = document.createElement(tag);
      prevLi.appendChild(nested);
    }
    nested.appendChild(li);

  } else {
    // ── Dedent: lift this <li> up one level ──────────────────────────────────
    const grandLi = parentList.parentElement; // should be a <li>
    if (!grandLi || grandLi.tagName !== 'LI') return; // already top-level

    const outerList = grandLi.parentElement;

    // Siblings that follow li inside the nested list travel with it as a new
    // nested sub-list so the document structure stays valid.
    const trailing = [];
    let sib = li.nextElementSibling;
    while (sib) { trailing.push(sib); sib = sib.nextElementSibling; }
    if (trailing.length) {
      const carry = document.createElement(parentList.tagName);
      trailing.forEach(s => carry.appendChild(s));
      li.appendChild(carry);
    }

    // Place li right after its former grandparent
    outerList.insertBefore(li, grandLi.nextSibling);

    // Remove now-empty nested list
    if (!parentList.children.length) grandLi.removeChild(parentList);
  }

  // Put the caret at the start of the moved <li> so the user can keep typing
  const r = document.createRange();
  r.setStart(li, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// ── Shared Tab-indent helper (exposed globally for CE editors across the app) ────────────
// Handles Tab (indent) and Shift+Tab (dedent) when the caret is inside a <li>.
// Returns without preventDefault() when the caret is NOT in a list, so the
// browser's normal Tab focus-move fires as expected in every other context.
window._bwCeTabIndent = function(e) {
  if (e.key !== 'Tab') return;
  var sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  var n = sel.getRangeAt(0).startContainer;
  if (n.nodeType === Node.TEXT_NODE) n = n.parentElement;
  var li = n ? n.closest('li') : null;
  if (!li) return;                          // not in a list — let Tab move focus normally
  e.preventDefault();
  var parentList = li.parentElement;
  if (!e.shiftKey) {
    // Indent: move li into a nested sub-list under the previous sibling
    var prevLi = li.previousElementSibling;
    if (!prevLi) return;                    // already the first item — can't indent further
    var tag    = parentList.tagName;
    var nested = prevLi.querySelector(':scope > ' + tag);
    if (!nested) { nested = document.createElement(tag); prevLi.appendChild(nested); }
    nested.appendChild(li);
  } else {
    // Dedent: lift li up one level; trailing siblings travel with it as a new sub-list
    var grandLi = parentList.parentElement;
    if (!grandLi || grandLi.tagName !== 'LI') return; // already top-level
    var outerList = grandLi.parentElement;
    var trailing = [];
    var sib = li.nextElementSibling;
    while (sib) { trailing.push(sib); sib = sib.nextElementSibling; }
    if (trailing.length) {
      var carry = document.createElement(parentList.tagName);
      trailing.forEach(function(s) { carry.appendChild(s); });
      li.appendChild(carry);
    }
    outerList.insertBefore(li, grandLi.nextSibling);
    if (!parentList.children.length) grandLi.removeChild(parentList);
  }
  var r = document.createRange();
  r.setStart(li, 0); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
};

// ── Enter edit mode ───────────────────────────────────────────────────────────────────────
window.openTextEdit = function (widgetId) {
  const view = document.getElementById(`tw-view-${widgetId}`);
  const btns = document.getElementById(`tw-btns-${widgetId}`);
  const eb   = document.getElementById(`tw-edit-btn-${widgetId}`);
  if (!view || !btns) return;

  // Snapshot the current HTML so Cancel can restore it exactly (incl. highlights)
  view._bwSnapshot = view.innerHTML;

  // If content is the "empty" placeholder, clear it before editing
  if (view.querySelector('span.italic')) view.innerHTML = '';

  // Strip hljs decorations → plain <pre><code> so editing is clean & consistent
  _prepCodeBlocksForEdit(view);

  // Make the view div editable — user types directly into rendered content
  view.contentEditable = 'true';
  view.spellcheck      = true;
  view.classList.add(
    'ring-2', 'ring-wblue', 'rounded', 'px-2', 'py-1',
    'min-h-[6rem]', 'cursor-text',
  );
  // Expand max-height so the box grows while editing
  view.classList.remove('max-h-40', 'max-h-96', 'overflow-y-auto');
  view.classList.add('overflow-y-auto', 'max-h-[32rem]');

  // Show Save/Cancel bar, hide the pencil button (avoids double-click noise)
  btns.classList.remove('hidden');
  if (eb) eb.style.display = 'none';

  // Move cursor to end of content
  view.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(view);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  // Disable widget drag-and-drop while editing so click-drag text selection
  // is not hijacked by the card's draggable="true" attribute.
  const card = view.closest('.hw-card');
  if (card) card.draggable = false;

  // Attach Enter-in-code-block + Tab-indent handler (stored for removal on exit)
  view._bwTabHandler = _handleCodeBlockKeys;
  view.addEventListener('keydown', view._bwTabHandler);

  // Attach slash-command palette (idempotent — guarded by _scAttached flag)
  if (typeof window.bwSlashAttachCE === 'function') window.bwSlashAttachCE(view);

  // Attach floating selection-formatting toolbar
  if (typeof window.bwFmtAttach === 'function') window.bwFmtAttach(view);

  /* ── Click below last content line → auto empty-line ──────────────────
     When e.target === view the click landed in empty padding below all
     blocks, not on a child element.  If the last real block has text,
     append a fresh <p>; if it is already empty, just move the cursor.
     Handler is stored on view so _exitEditMode can remove it cleanly.   */
  function _clickBelow(e) {
    if (e.target !== view) return;
    const blocks = Array.from(view.children);
    const last   = blocks[blocks.length - 1];

    function _placeCursorAtEnd(el) {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }

    if (!last) {
      const p = Object.assign(document.createElement('p'), { innerHTML: '<br>' });
      view.appendChild(p);
      _placeCursorAtEnd(p);
    } else if (!last.textContent.trim()) {
      _placeCursorAtEnd(last);
    } else {
      const p = Object.assign(document.createElement('p'), { innerHTML: '<br>' });
      view.appendChild(p);
      _placeCursorAtEnd(p);
    }
  }
  view._bwClickBelowHandler = _clickBelow;
  view.addEventListener('click', _clickBelow);
};

// ── Cancel: restore snapshot, exit edit mode ──────────────────────────────────
window.cancelTextEdit = function (widgetId) {
  const view = document.getElementById(`tw-view-${widgetId}`);
  const btns = document.getElementById(`tw-btns-${widgetId}`);
  const eb   = document.getElementById(`tw-edit-btn-${widgetId}`);
  if (!view || !btns) return;

  // Restore the pre-edit HTML exactly
  view.innerHTML        = view._bwSnapshot || view.innerHTML;
  view._bwSnapshot      = undefined;

  _exitEditMode(view, btns, eb);

  // Re-apply code highlighting in case blocks need copy buttons back
  if (typeof _bwApplyCodeHighlighting === 'function') _bwApplyCodeHighlighting(view);
};

// ── Save: HTML → Markdown → POST → re-render ─────────────────────────────────
window.saveTextEdit = async function (widgetId, pageId) {
  const view = document.getElementById(`tw-view-${widgetId}`);
  const btns = document.getElementById(`tw-btns-${widgetId}`);
  const eb   = document.getElementById(`tw-edit-btn-${widgetId}`);
  if (!view || !btns) return;

  const btn = btns.querySelector('[data-save-btn]');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  // Merge any text-node fragments and strip the plaintext-only
  // contentEditable attribute before converting to markdown.
  view.querySelectorAll('pre code, pre').forEach(el => {
    el.normalize();
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
  });
  // Convert rendered HTML → Markdown (Turndown), fall back to innerHTML
  const td = _getTurndown();
  const newMd = td ? td.turndown(view.innerHTML) : view.innerHTML;

  // Merge with the widget's existing config so fields set via the settings
  // panel (e.g. quote 'author') are not silently clobbered by an inline save.
  const card = view.closest('[data-widget-config]');
  const prevCfg = card ? JSON.parse(card.dataset.widgetConfig || '{}') : {};
  const newCfg  = { ...prevCfg, content: newMd };

  try {
    const res = await fetch(`/home/widgets/${widgetId}/update-config`, {
      method:      'POST',
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:        new URLSearchParams({ config_json: JSON.stringify(newCfg) }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Store the canonical markdown & re-render cleanly
    view.setAttribute('data-raw-md', newMd);
    if (card) card.dataset.widgetConfig = JSON.stringify(newCfg);
    view.innerHTML = _renderMarkdown(newMd);
    view._bwSnapshot = undefined;

    _exitEditMode(view, btns, eb);

    if (typeof _bwApplyCodeHighlighting === 'function') _bwApplyCodeHighlighting(view);
  } catch (err) {
    console.error('[text-widget] save failed', err);
    alert('Save failed — please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
};

// ── Shared: strip edit-mode styling ──────────────────────────────────────────
function _exitEditMode(view, btns, eb) {
  // Detach floating selection-formatting toolbar
  if (typeof window.bwFmtDetach === 'function') window.bwFmtDetach(view);

  // Re-enable widget drag-and-drop now that we are leaving edit mode
  const card = view.closest('.hw-card');
  if (card) card.draggable = true;

  // Remove Tab indent handler
  if (view._bwTabHandler) {
    view.removeEventListener('keydown', view._bwTabHandler);
    view._bwTabHandler = null;
  }

  // Remove click-below-last-line handler
  if (view._bwClickBelowHandler) {
    view.removeEventListener('click', view._bwClickBelowHandler);
    view._bwClickBelowHandler = null;
  }

  view.contentEditable = 'false';
  view.spellcheck      = false;
  view.classList.remove(
    'ring-2', 'ring-wblue', 'rounded', 'px-2', 'py-1',
    'min-h-[6rem]', 'cursor-text', 'max-h-[32rem]',
  );
  const compact = view.dataset.compact === 'true';
  view.classList.add(compact ? 'max-h-40' : 'max-h-96', 'overflow-y-auto');

  btns.classList.add('hidden');
  if (eb) eb.style.display = '';
}
