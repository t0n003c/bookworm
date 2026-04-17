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
    canvas.style.cssText = 'display:block;max-width:100%;border-radius:4px;'
      + (isDark ? 'filter:brightness(0.85) invert(1) hue-rotate(180deg);' : '');

    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

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
