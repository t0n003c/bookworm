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
  // Tags are snapshotted onto _dndSelected at selection time — no _uplFiles lookup needed.
  Object.values(_dndSelected).forEach(function(item) {
    (item.tags || []).forEach(function(t) {
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
// Fetches LIVE tag data from the server so stale JS state can never hide tags.
function _uplBulkTagPanel() {
  console.log('[BookWorm] _uplBulkTagPanel v3 – dynamic positioning build');
  const existing = document.getElementById('upl-bulk-tag-panel');
  if (existing) { existing.remove(); return; }   // second click = close

  const count = Object.keys(_dndSelected).length;
  if (!count) return;

  // ── Position panel just above the badge bar (never overlap it) ─────────
  var badgeEl  = document.getElementById('upl-sel-badge');
  var badgeH   = badgeEl ? badgeEl.getBoundingClientRect().height : 60;
  var bottomPx = Math.round(badgeH) + 12;   // 12px breathing gap

  // ── Build panel shell immediately with loading skeleton ────────────────
  const panel = document.createElement('div');
  panel.id        = 'upl-bulk-tag-panel';
  panel.className =
    'fixed left-1/2 -translate-x-1/2 z-50 w-80 ' +
    'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 ' +
    'rounded-2xl shadow-2xl p-4 select-none ' +
    'flex flex-col';
  panel.style.bottom  = bottomPx + 'px';
  panel.style.maxHeight = 'calc(100dvh - ' + (bottomPx + 16) + 'px)';

  // Datalist for tag autocomplete (all user tags minus grid: ones)
  const allOpts = (_uplAllTags || [])
    .filter(function(t) { return !t.startsWith('grid:'); })
    .map(function(t) { return '<option value="' + _uplEsc(t) + '">'; }).join('');

  // ── Static (non-scrolling) header ──────────────────────────────────────
  var header = document.createElement('div');
  header.innerHTML =
    // Title row
    '<div class="flex items-center justify-between mb-3">'
    + '<span class="text-sm font-semibold text-gray-800 dark:text-zinc-100">'
    + '\uD83C\uDFF7\uFE0F Tags \u2014 ' + count + ' file' + (count === 1 ? '' : 's') + '</span>'
    + '<button onclick="document.getElementById(\'upl-bulk-tag-panel\').remove()"'
    + ' class="text-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 transition text-lg leading-none">&times;</button>'
    + '</div>'
    // Add tag row
    + '<p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-zinc-500 mb-1">Add tag to all</p>'
    + '<div class="flex gap-1 mb-3">'
    + '<input id="upl-bulk-tag-input" list="upl-bulk-tag-opts" placeholder="Type or choose tag\u2026"'
    + ' class="flex-1 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5'
    + ' text-xs bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
    + ' focus:outline-none focus:ring-1 focus:ring-[#0053e2]"'
    + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();_uplBulkAddTag()}" />'
    + '<datalist id="upl-bulk-tag-opts">' + allOpts + '</datalist>'
    + '<button onclick="_uplBulkAddTag()"'
    + ' class="px-3 py-1.5 text-xs rounded-lg bg-[#0053e2] text-white hover:bg-[#003eb3] transition font-medium">+ Add</button>'
    + '</div>'
    + '<p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-zinc-500 mb-1">Current tags (click \u00d7 to remove)</p>';
  panel.appendChild(header);

  // ── Scrollable tag area ─────────────────────────────────────────────────
  var scrollArea = document.createElement('div');
  scrollArea.style.cssText = 'overflow-y:auto;min-height:1.5rem;flex:1;';

  var tagsEl = document.createElement('div');
  tagsEl.id        = 'upl-bulk-existing-tags';
  tagsEl.className = 'flex flex-wrap gap-1';
  tagsEl.innerHTML = '<span class="text-[10px] text-gray-300 dark:text-zinc-600 animate-pulse">Loading\u2026</span>';
  scrollArea.appendChild(tagsEl);
  panel.appendChild(scrollArea);

  // ── Delete button (always visible — outside the scroll area) ───────────
  var foot = document.createElement('div');
  foot.className = 'mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800 flex-shrink-0';
  foot.innerHTML =
    '<button onclick="_uplBulkDeleteSelected()"'
    + ' class="w-full px-3 py-1.5 text-xs rounded-lg bg-red-50 dark:bg-red-950/40'
    + ' text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900'
    + ' hover:bg-red-100 dark:hover:bg-red-900/60 transition font-medium">'
    + '\uD83D\uDDD1\uFE0F Delete ' + count + ' selected file' + (count === 1 ? '' : 's') + '</button>';
  panel.appendChild(foot);

  document.body.appendChild(panel);
  panel.querySelector('#upl-bulk-tag-input').focus();

  // ── Fetch live tags from server and fill in the panel ─────────────────
  _uplBulkLoadPanelTags();
}

// Fetch the live union of tags for all selected files from the server,
// then rebuild the current-tags section and the grid-connections section.
async function _uplBulkLoadPanelTags() {
  const panel = document.getElementById('upl-bulk-tag-panel');
  if (!panel) return;

  const ids    = _uplBulkGetSelIds();
  const tagsEl = panel.querySelector('#upl-bulk-existing-tags');

  try {
    const r = await fetch('/home/uploads/' + _uplPid + '/files/bulk/tags', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ids: ids }),
      credentials: 'same-origin',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    // data = { tags: ['food', 'recipe', ...], grid_pids: [79, ...] }

    if (!document.getElementById('upl-bulk-tag-panel')) return; // panel closed

    // ── Render regular tag pills ──
    // ── Build unified tag pill list (regular tags + grid connections together) ──
    var oldGrid = panel.querySelector('#upl-bulk-grid-block');
    if (oldGrid) oldGrid.remove();

    if (tagsEl) {
      var allTagPills = [];

      // Regular tags as yellow pills
      (data.tags || []).forEach(function(t) {
        allTagPills.push(
          '<button data-bulk-tag="' + _uplEsc(t) + '"'
          + ' onclick="_uplBulkRemoveTag(this.dataset.bulkTag)"'
          + ' title="Remove from all selected"'
          + ' class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full cursor-pointer'
          + ' bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300'
          + ' hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-700 transition">'
          + _uplEsc(t) + ' &times;</button>'
        );
      });

      // Grid connections as green pills — show raw tag (grid:XX) with × to remove + ↗ to navigate
      (data.grid_pids || []).forEach(function(pid) {
        var openFn = typeof openHomePage === 'function'
          ? 'openHomePage(' + pid + ')'
          : 'window.location.assign(\'/home/pages/' + pid + '\')';
        allTagPills.push(
          '<span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full'
          + ' bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300">'
          + '<button data-bulk-tag="grid:' + pid + '"'
          + ' onclick="_uplBulkRemoveTag(this.dataset.bulkTag)"'
          + ' title="Disconnect from grid page ' + pid + ' for all selected files"'
          + ' class="hover:text-red-600 transition leading-none font-bold">&times;</button>'
          + 'grid:' + pid
          + '<button onclick="' + openFn + '"'
          + ' title="Open grid page ' + pid + '"'
          + ' class="undline hover:text-green-600 transition">&nearr;</button>'
          + '</span>'
        );
      });

      tagsEl.innerHTML = allTagPills.length
        ? allTagPills.join('')
        : '<span class="text-[10px] text-gray-400 dark:text-zinc-500">No tags on selected files</span>';

      // (No async name resolution — grid pills show the raw tag value, e.g. grid:79)
    }

    // Update datalist to exclude already-applied tags
    var dl = panel.querySelector('#upl-bulk-tag-opts');
    if (dl) {
      dl.innerHTML = (_uplAllTags || [])
        .filter(function(t) { return !data.tags.includes(t) && !t.startsWith('grid:'); })
        .map(function(t) { return '<option value="' + _uplEsc(t) + '">'; }).join('');
    }

  } catch (e) {
    if (tagsEl) tagsEl.innerHTML =
      '<span class="text-[10px] text-red-400">\u26a0\ufe0f Could not load tags: ' + _uplEsc(String(e)) + '</span>';
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
    // Keep _uplFiles and card DOM in sync for quick re-render
    ids.forEach(function(ref) {
      var f = _uplFiles.find(function(x) { return x.src === ref.src && x.id === ref.id; });
      if (f) { f.tags = f.tags || []; if (!f.tags.includes(tag)) f.tags.push(tag); }
      var card = document.querySelector('[data-upl-file-key="' + ref.src + ':' + ref.id + '"]');
      if (card) {
        var cur = (card.dataset.uplTags || '').split(',').filter(Boolean);
        if (!cur.includes(tag)) { cur.push(tag); card.dataset.uplTags = cur.join(','); }
      }
    });
    await _uplLoadAllTags();
    _uplRender();
    // Refresh server-driven panel
    await _uplBulkLoadPanelTags();
    _uplShowToast('Tag \u201c' + _uplEsc(tag) + '\u201d added to ' + ids.length + ' file' + (ids.length === 1 ? '' : 's') + '.');
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
      var f = _uplFiles.find(function(x) { return x.src === ref.src && x.id === ref.id; });
      if (f && Array.isArray(f.tags)) f.tags = f.tags.filter(function(t) { return t !== tag; });
      var sel = _dndSelected[ref.src + ':' + ref.id];
      if (sel && Array.isArray(sel.tags)) sel.tags = sel.tags.filter(function(t) { return t !== tag; });
      var card = document.querySelector('[data-upl-file-key="' + ref.src + ':' + ref.id + '"]');
      if (card) {
        var cur = (card.dataset.uplTags || '').split(',').filter(function(t) { return t && t !== tag; });
        card.dataset.uplTags = cur.join(',');
      }
    });
    await _uplLoadAllTags();
    _uplRender();
    // Refresh the panel in-place via server fetch (no full panel rebuild needed)
    await _uplBulkLoadPanelTags();
    _uplShowToast('Tag \u201c' + _uplEsc(tag) + '\u201d removed from all selected files.');
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
