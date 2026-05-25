/* home-page-uploads-tags.js — Tag CRUD for the Uploads Homespace page.
   Companion to home-page-uploads.js (loaded after it via base.html).
   Shares state: _uplPid, _uplFiles, _uplAllTags (read/write), _uplRender,
                 _uplRenderFilterTabs, _uplEsc, _uplJsStr (all from main file).
*/
'use strict';

// ── Load + render tags for open detail panel ──────────────────────────────────

async function _uplLoadTags(src, id) {
  try {
    const r = await fetch(`/home/uploads/${_uplPid}/files/${src}/${id}/tags`);
    if (!r.ok) return;
    const data = await r.json();
    _uplRenderTags(src, id, data.tags || []);
  } catch { /* silent */ }
}

function _uplRenderTags(src, id, tags) {
  const el = document.getElementById('upl-tags-area');
  if (!el) return;

  const pills = tags.map(t => `
    <span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full
                 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300">
      ${_uplEsc(t)}
      <button onclick="_uplRemoveTag('${_uplJsStr(src)}',${id},'${_uplJsStr(t)}')"
              class="hover:text-red-500 transition leading-none">&times;</button>
    </span>`).join('');

  const listId = `upl-tags-list-${id}`;
  const opts   = _uplAllTags.filter(t => !tags.includes(t))
                             .map(t => `<option value="${_uplEsc(t)}">`).join('');

  el.innerHTML = `
    <div class="flex flex-wrap gap-1 mb-2">${pills ||
      '<span class="text-[10px] text-gray-400">No tags yet</span>'}</div>
    <div class="flex gap-1">
      <input id="upl-tag-input-${id}" list="${listId}" placeholder="Add tag\u2026"
             class="flex-1 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1
                    text-[10px] bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                    focus:outline-none focus:ring-1 focus:ring-[#0053e2]"
             onkeydown="if(event.key==='Enter'){event.preventDefault();_uplAddTag('${_uplJsStr(src)}',${id})}" />
      <datalist id="${listId}">${opts}</datalist>
      <button onclick="_uplAddTag('${_uplJsStr(src)}',${id})"
              class="px-2 py-1 text-[10px] rounded-lg bg-[#0053e2] text-white
                     hover:bg-[#003eb3] transition">+</button>
    </div>`;
}

// ── Add / remove tag ──────────────────────────────────────────────────────────

async function _uplAddTag(src, id) {
  const input = document.getElementById(`upl-tag-input-${id}`);
  const tag   = (input ? input.value : '').trim().toLowerCase();
  if (!tag || tag.length > 50) return;
  if (input) input.value = '';
  try {
    const r = await fetch(`/home/uploads/${_uplPid}/files/${src}/${id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag }),
    });
    if (!r.ok) return;
    const data = await r.json();
    const f = _uplFiles.find(x => x.src === src && x.id === id);
    if (f) f.tags = data.tags;
    _uplRenderTags(src, id, data.tags);
    _uplLoadAllTags();  // refresh autocomplete + filter pills
    _uplRender();       // update card tag pips
  } catch { /* silent */ }
}

async function _uplRemoveTag(src, id, tag) {
  try {
    const r = await fetch(
      `/home/uploads/${_uplPid}/files/${src}/${id}/tags/${encodeURIComponent(tag)}`,
      { method: 'DELETE' }
    );
    if (!r.ok) return;
    const data = await r.json();
    const f    = _uplFiles.find(x => x.src === src && x.id === id);
    if (f) f.tags = data.tags;
    _uplRenderTags(src, id, data.tags);
    _uplLoadAllTags();
    _uplRender();
  } catch { /* silent */ }
}

// ── Format helpers (moved from home-page-uploads.js) ────────────────────────
// Also consumed by home-page-uploads-docs.js via shared global scope.

function _uplFmtSize(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3)   return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function _uplFmtDate(s) {
  if (!s) return '';
  try {
    return new Date(s.replace(' ', 'T') + (s.includes('T') ? '' : 'Z'))
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s.slice(0, 10); }
}

// ── Text file preview (called from _uplRenderDetail in main file) ────────────

async function _uplFetchTextPreview(url) {
  const el = document.getElementById('upl-text-preview');
  if (!el) return;
  try {
    const r    = await fetch(url);
    const text = await r.text();
    const safe = _uplEsc(text.slice(0, 4_000));
    const more = text.length > 4_000
      ? '<p class="text-[9px] text-gray-400 mt-1">…truncated to 4 000 chars</p>' : '';
    el.innerHTML = `<pre class="text-[10px] text-gray-700 dark:text-zinc-300 whitespace-pre-wrap
                              break-words font-mono">${safe}</pre>${more}`;
  } catch {
    el.innerHTML = '<p class="text-[10px] text-gray-400 italic">Preview unavailable.</p>';
  }
}

// ── DOCX file preview (called from _uplRenderDetail in main file) ────────────
// Fetches rendered HTML from /content endpoint (same source as the full viewer)
// and injects a scaled-down read-only preview into #upl-docx-preview.

async function _uplFetchDocxPreview(f) {
  const el = document.getElementById('upl-docx-preview');
  if (!el) return;
  try {
    const r  = await fetch(`/home/uploads/${_uplPid}/files/${_uplEsc(f.src)}/${f.id}/content`);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('text/html')) throw new Error('session');
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    if (data.content_type === 'docx_html') {
      // Render HTML in a sandboxed, scaled-down container.
      // font-size:11px + overflow:hidden on the parent keeps it tidy.
      el.innerHTML =
        '<div style="font-size:11px;line-height:1.5;pointer-events:none;"'
        + ' class="text-gray-800 dark:text-zinc-100">'
        + data.content
        + '</div>';
    } else {
      // Fallback: plain text content (shouldn\'t happen for docx but be safe)
      el.innerHTML = `<pre style="font-size:10px;white-space:pre-wrap;word-break:break-word"
        class="text-gray-700 dark:text-zinc-300 font-mono">${_uplEsc(data.content || '')}</pre>`;
    }
  } catch(e) {
    el.innerHTML = '<p style="font-size:10px;color:#9ca3af;font-style:italic">Preview unavailable.</p>';
  }
}

// Smart PDF dark-mode pixel pass. Inverts only near-grayscale pixels
// (text, backgrounds) while leaving colourful pixels (photos, charts)
// completely untouched. Called once per canvas render in dark mode.
//
// Maths: saturation = (max-min)/max.  sat < 0.15 → treat as grey.
// Grey luma remapped linearly: white(255) → zinc-800(39), black(0) → zinc-100(244).
function _uplPdfDarkMode(canvas) {
  var ctx = canvas.getContext('2d');
  var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  var d   = img.data;
  for (var i = 0; i < d.length; i += 4) {
    var r  = d[i], g = d[i+1], b = d[i+2];
    var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    if (mx > 0 && (mx - mn) / mx >= 0.15) continue; // colourful pixel — skip
    var luma = 0.299*r + 0.587*g + 0.114*b;
    var out  = Math.round(244 - 205 * luma / 255);   // 255→39, 0→244
    d[i] = d[i+1] = d[i+2] = out;
  }
  ctx.putImageData(img, 0, 0);
}

// Renders PDF page 1 into a <canvas> via PDF.js (same engine as fullscreen
// viewer). This keeps the preview inside a normal DOM element so dark-mode
// background, scrollbar theming, and layout all work correctly.
var _PDFJS_LIB_CDN  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var _PDFJS_WRKR_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

async function _uplFetchPdfCanvas(fileUrl) {
  var wrap = document.getElementById('upl-pdf-canvas-wrap');
  if (!wrap) return;

  try {
    // Lazy-load PDF.js from CDN if not already present
    if (!window.pdfjsLib) {
      await new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = _PDFJS_LIB_CDN;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = _PDFJS_WRKR_CDN;

    var pdf  = await window.pdfjsLib.getDocument({ url: fileUrl, withCredentials: true }).promise;
    var page = await pdf.getPage(1);

    // Scale the page so it fills the wrap width
    var wrapW  = wrap.clientWidth || 260;
    var vpBase = page.getViewport({ scale: 1 });
    var scale  = (wrapW - 8) / vpBase.width;   // 8px breathing room
    var vp     = page.getViewport({ scale: scale });

    var canvas = document.createElement('canvas');
    canvas.width  = vp.width;
    canvas.height = vp.height;
    var isDark = document.documentElement.classList.contains('dark');
    canvas.style.cssText = 'display:block;max-width:100%;border-radius:4px;';

    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    if (isDark) _uplPdfDarkMode(canvas);

    wrap.innerHTML = '';
    wrap.appendChild(canvas);
  } catch(e) {
    if (wrap) {
      wrap.innerHTML = '<p style="font-size:10px;color:#9ca3af;font-style:italic">Preview unavailable.</p>';
    }
  }
}

async function _uplLoadAllTags() {
  try {
    const r = await fetch(`/home/uploads/${_uplPid}/tags`);
    if (!r.ok) return;
    const data  = await r.json();
    _uplAllTags = data.tags || [];
    _uplRenderFilterTabs();  // refresh tag filter pills in the tab bar
  } catch { /* silent */ }
}

// ── Bulk operations (multi-select) ───────────────────────────────────────────
// These functions work with _dndSelected (from home-page-uploads-dnd.js).
// Invoked from the floating badge buttons added by _dndSelBadgeUpdate().

function _uplBulkGetSelIds() {
  return Object.values(_dndSelected).map(function(x) {
    return { src: x.src, id: x.id };
  });
}

function _uplBulkGetUnionTags() {
  const union    = new Set();
  const gridPids = new Set();
  Object.values(_dndSelected).forEach(function(item) {
    const f = _uplFiles.find(function(x) { return x.src === item.src && x.id === item.id; });
    if (!f || !Array.isArray(f.tags)) return;
    f.tags.forEach(function(t) {
      if (t.startsWith('grid:')) {
        var pid = parseInt(t.split(':')[1], 10);
        if (!isNaN(pid)) gridPids.add(pid);
      } else {
        union.add(t);
      }
    });
  });
  return { tags: Array.from(union).sort(), gridPids: gridPids };
}

// Toggle the floating bulk-tag panel.
function _uplBulkTagPanel() {
  const existing = document.getElementById('upl-bulk-tag-panel');
  if (existing) { existing.remove(); return; }   // second click = close

  const count      = Object.keys(_dndSelected).length;
  const unionData  = _uplBulkGetUnionTags();
  const existing_tags = unionData.tags;
  const gridPids   = unionData.gridPids;

  // Prevent typing grid: tags into the add-tag input
  const opts = _uplAllTags
    .filter(function(t) { return !existing_tags.includes(t) && !t.startsWith('grid:'); })
    .map(function(t) { return '<option value="' + _uplEsc(t) + '">'; }).join('');

  const existPills = existing_tags.length
    ? existing_tags.map(function(t) {
        return '<button onclick="_uplBulkRemoveTag(\'' + _uplJsStr(t) + '\')" title="Remove from all selected"'
          + ' class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full cursor-pointer'
          + ' bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300'
          + ' hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-700 transition">'
          + _uplEsc(t) + ' &times;</button>';
      }).join('')
    : '<span class="text-[10px] text-gray-400 dark:text-zinc-500">No tags on selected files yet</span>';

  // Grid connections block — info-only, navigate to open the page
  var gridBlock = '';
  if (gridPids.size) {
    var gridPillsHtml = Array.from(gridPids).map(function(pid) {
      return '<span id="upl-bulk-grid-' + pid + '"'
        + ' class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full'
        + ' bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300">'
        + '&#128248; Grid #' + pid + '</span>';
    }).join('');
    gridBlock =
      '<p class="text-[10px] uppercase tracking-wide text-green-600 dark:text-green-400 mt-3 mb-1">Grid connections</p>'
      + '<div class="flex flex-wrap gap-1 mb-1">' + gridPillsHtml + '</div>'
      + '<p class="text-[10px] text-gray-400 dark:text-zinc-500 italic">'
      + 'To remove a grid connection, open the file detail and click \u201cOpen Grid\u201d, '
      + 'then delete the cell from the grid page.</p>';
  }

  const panel = document.createElement('div');
  panel.id    = 'upl-bulk-tag-panel';
  panel.className =
    'fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-80 ' +
    'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 ' +
    'rounded-2xl shadow-2xl p-4 select-none';

  panel.innerHTML =
    '<div class="flex items-center justify-between mb-3">'
    + '<span class="text-sm font-semibold text-gray-800 dark:text-zinc-100">'
    + '&#127991;&#65039; Tags &mdash; ' + count + ' file' + (count === 1 ? '' : 's') + '</span>'
    + '<button onclick="document.getElementById(\'upl-bulk-tag-panel\').remove()"'
    + ' class="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 transition text-lg leading-none">&times;</button>'
    + '</div>'
    + '<p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-zinc-500 mb-1">Add tag to all</p>'
    + '<div class="flex gap-1 mb-4">'
    + '<input id="upl-bulk-tag-input" list="upl-bulk-tag-opts" placeholder="Type or choose tag\u2026"'
    + ' class="flex-1 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5'
    + ' text-xs bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    + ' focus:outline-none focus:ring-1 focus:ring-[#0053e2]"'
    + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();_uplBulkAddTag()}" />'
    + '<datalist id="upl-bulk-tag-opts">' + opts + '</datalist>'
    + '<button onclick="_uplBulkAddTag()"'
    + ' class="px-3 py-1.5 text-xs rounded-lg bg-[#0053e2] text-white hover:bg-[#003eb3] transition font-medium">+ Add</button>'
    + '</div>'
    + '<p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-zinc-500 mb-1">Remove tag from all</p>'
    + '<div class="flex flex-wrap gap-1" id="upl-bulk-existing-tags">' + existPills + '</div>'
    + gridBlock;

  document.body.appendChild(panel);
  panel.querySelector('#upl-bulk-tag-input').focus();

  // Async: resolve grid page names and replace placeholder badges
  if (gridPids.size) {
    Array.from(gridPids).forEach(async function(pid) {
      try {
        var r = await fetch('/home/pages/' + pid + '/meta');
        if (!r.ok) return;
        var m = await r.json();
        var badge = document.getElementById('upl-bulk-grid-' + pid);
        if (badge) badge.innerHTML = '&#128248;\u00a0' + _uplEsc((m.emoji || '') + '\u00a0' + (m.name || ('Grid #' + pid)));
      } catch(_) { /* keep placeholder */ }
    });
  }
}

async function _uplBulkAddTag() {
  const input = document.getElementById('upl-bulk-tag-input');
  const tag   = (input ? input.value : '').trim().toLowerCase();
  if (!tag || tag.length > 50) return;
  if (tag.startsWith('grid:')) { _uplShowToast('Grid connections are managed from the Grid page, not tags.', true); return; }
  if (input) input.value = '';
  const ids   = _uplBulkGetSelIds();
  try {
    const r = await fetch(`/home/uploads/${_uplPid}/files/bulk/tag-add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, tag }),
    });
    if (!r.ok) { _uplShowToast('Failed to add tag.', true); return; }
    // Optimistically update _uplFiles so panel + cards reflect change immediately
    ids.forEach(function(ref) {
      const f = _uplFiles.find(function(x) { return x.src === ref.src && x.id === ref.id; });
      if (f) { f.tags = f.tags || []; if (!f.tags.includes(tag)) f.tags.push(tag); }
    });
    await _uplLoadAllTags();
    _uplRender();
    // Rebuild panel in place
    document.getElementById('upl-bulk-tag-panel')?.remove();
    _uplBulkTagPanel();
    _uplShowToast(`Tag "${_uplEsc(tag)}" added to ${ids.length} file${ids.length === 1 ? '' : 's'}.`);
  } catch (e) { _uplShowToast('Error: ' + e, true); }
}

async function _uplBulkRemoveTag(tag) {
  const ids = _uplBulkGetSelIds();
  try {
    const r = await fetch(`/home/uploads/${_uplPid}/files/bulk/tag-remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, tag }),
    });
    if (!r.ok) { _uplShowToast('Failed to remove tag.', true); return; }
    ids.forEach(function(ref) {
      const f = _uplFiles.find(function(x) { return x.src === ref.src && x.id === ref.id; });
      if (f && Array.isArray(f.tags)) f.tags = f.tags.filter(function(t) { return t !== tag; });
    });
    await _uplLoadAllTags();
    _uplRender();
    document.getElementById('upl-bulk-tag-panel')?.remove();
    _uplBulkTagPanel();
    _uplShowToast(`Tag "${_uplEsc(tag)}" removed from all selected files.`);
  } catch (e) { _uplShowToast('Error: ' + e, true); }
}

// ── Bulk delete ───────────────────────────────────────────────────────────────

function _uplBulkDeleteSelected() {
  const count = Object.keys(_dndSelected).length;
  if (!count) return;

  // Reuse / create confirm modal
  let modal = document.getElementById('upl-bulk-del-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id        = 'upl-bulk-del-modal';
    modal.className =
      'fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm';
    modal.innerHTML = `
      <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl p-6 w-80 max-w-full">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-zinc-100 mb-1">Delete files?</h3>
        <p id="upl-bulk-del-msg" class="text-xs text-gray-500 dark:text-zinc-400 mb-5"></p>
        <div class="flex gap-2 justify-end">
          <button onclick="document.getElementById('upl-bulk-del-modal').classList.add('hidden')"
                  class="px-4 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-zinc-700
                         text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition"
          >Cancel</button>
          <button id="upl-bulk-del-confirm-btn" onclick="_uplBulkDoDelete()"
                  class="px-4 py-1.5 text-xs rounded-lg bg-red-600 text-white
                         hover:bg-red-700 transition font-semibold"
          >Delete</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  const msg = modal.querySelector('#upl-bulk-del-msg');
  if (msg) msg.textContent =
    `Permanently delete ${count} file${count === 1 ? '' : 's'}? This cannot be undone.`;
  modal.classList.remove('hidden');
  setTimeout(function() { modal.querySelector('#upl-bulk-del-confirm-btn')?.focus(); }, 50);
}

async function _uplBulkDoDelete() {
  const modal = document.getElementById('upl-bulk-del-modal');
  if (modal) modal.classList.add('hidden');

  const ids = _uplBulkGetSelIds();
  if (!ids.length) return;

  try {
    const r = await fetch(`/home/uploads/${_uplPid}/files/bulk/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!r.ok) { _uplShowToast('Bulk delete failed. Please refresh and try again.', true); return; }
    const data = await r.json().catch(function() { return {}; });
    _dndSelClear();
    await _uplFetch(_uplMeta?.page || 1);
    const del = data.deleted ?? ids.length;
    const err = data.errors ?? 0;
    const msg = err
      ? `Deleted ${del} file${del === 1 ? '' : 's'} (${err} error${err === 1 ? '' : 's'}).`
      : `Deleted ${del} file${del === 1 ? '' : 's'}.`;
    _uplShowToast(msg, err > 0);
  } catch (e) {
    _uplShowToast('Bulk delete failed: ' + e, true);
  }
}
