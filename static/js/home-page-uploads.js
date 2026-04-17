/* home-page-uploads.js — Uploads Homespace page (BookWorm).
   Manages file listing, filter tabs, pagination, upload, download, delete,
   detail panel (media/PDF/DOCX/text viewer), tags, and multi-select.
   Sign functions → home-page-uploads-sign.js | Studio → home-page-uploads-docs.js
*/
'use strict';

// ── Module state ─────────────────────────────────────────────────────────────────
let _uplPid           = 0;
let _uplFiles         = [];      // current page's file list (tags embedded)
let _uplMeta          = {};      // {total, page, pages}
let _uplCounts        = {};      // {all, image, video, audio, document, other}
let _uplFilter        = 'all';   // active MIME-type tab
let _uplTagFilter     = '';      // active group/tag tab ('' = none)
let _uplGrouped       = false;   // group-by-type display mode
let _uplCurrentDetail = null;    // file object currently shown in detail panel
let _uplAllTags       = [];      // all user tags (lazy-loaded once + after mutations)
let _uplBusy      = false;   // upload in progress
let _uplDelPending    = null;   // uploadId waiting for delete confirmation
let _uplRmAttPending  = null;   // note-attachment id waiting for remove confirmation
var _uplCacheBust     = {};     // fileId → timestamp; cache-busts embed after sign
var _DOCX_MIME     = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ── Entry point ───────────────────────────────────────────────────────────────
async function initUploadsPage(pid) {
  _uplPid           = pid;
  _uplFiles         = [];
  _uplMeta          = {};
  _uplCounts        = {};
  _uplFilter        = 'all';
  _uplTagFilter     = '';
  _uplGrouped       = false;
  _uplCurrentDetail = null;
  _uplAllTags       = [];
  _uplBusy          = false;
  _uplCacheBust     = {};
  // Wire hidden file input once
  const input = document.getElementById('uploads-file-input');
  if (input) {
    input.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) _uplProcessFiles(files);
    });
  }

  // ESC closes whichever overlay is open
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    _uplCloseModal();
    _uplCancelDelete();
  });

  // Load tags once upfront so filter pills are ready immediately
  _uplLoadAllTags();
  await _uplFetch(1);
}

// ── Fetch paginated file list ─────────────────────────────────────────────────
async function _uplFetch(page) {
  const main = document.getElementById('uploads-main');
  if (!main) return;

  main.innerHTML = '<div class="text-center mt-16 text-gray-300 dark:text-zinc-600 '
    + 'animate-pulse text-sm select-none">Loading files\u2026</div>';

  try {
    const r = await fetch(`/home/uploads/${_uplPid}/files?page=${page}`);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      main.innerHTML = '<div class="p-6 text-sm text-yellow-600 dark:text-yellow-400 '
        + 'text-center mt-8">\u23f0 Session expired \u2014 please refresh the page.</div>';
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data    = await r.json();
    _uplFiles     = data.files  || [];
    _uplMeta      = { total: data.total || 0, page: data.page || 1, pages: data.pages || 1 };
    _uplCounts    = data.counts || {};
  } catch (e) {
    main.innerHTML = '<div class="p-6 text-sm text-red-500 text-center mt-8">'
      + '\u26a0\ufe0f Could not load files. ' + _uplEsc(e.message) + '</div>';
    return;
  }

  // Sync detail panel: re-render if the open file is still in the new page
  if (_uplCurrentDetail) {
    const refreshed = _uplFiles.find(
      x => x.src === _uplCurrentDetail.src && x.id === _uplCurrentDetail.id
    );
    if (refreshed) {
      _uplCurrentDetail = refreshed;
      _uplRenderDetail(refreshed);
    } else {
      _uplCloseDetail();
    }
  }

  // Rebuild filter tabs + grid from current state
  _uplRenderFilterTabs();
  _uplRender();
}

// ── MIME group helper (mirrors _CASE SQL in get_uploads_page() in uploads_db.py) ─
function _uplMimeGroup(mimeType) {
  if (!mimeType) return 'other';
  if (mimeType.startsWith('image/'))  return 'image';
  if (mimeType.startsWith('video/'))  return 'video';
  if (mimeType.startsWith('audio/'))  return 'audio';
  if (mimeType.startsWith('text/') || mimeType.startsWith('application/')) return 'document';
  return 'other';
}

const _UPL_TAB_META = {
  all:      { label: 'All',       emoji: '' },
  image:    { label: 'Photos',    emoji: '\uD83D\uDDBC\uFE0F' },
  video:    { label: 'Videos',    emoji: '\uD83C\uDFAC' },
  audio:    { label: 'Audio',     emoji: '\uD83C\uDFB5' },
  document: { label: 'Documents', emoji: '\uD83D\uDCC4' },
  other:    { label: 'Other',     emoji: '\uD83D\uDCCE' },
};

// ── Render filter tabs (MIME + group tags) ────────────────────────────────────
function _uplRenderFilterTabs() {
  const tabs  = document.getElementById('uploads-filter-tabs');
  const stats = document.getElementById('uploads-stats');
  if (!tabs) return;

  const base   = 'flex-shrink-0 text-xs font-semibold px-3 py-1 rounded-full '
               + 'border transition cursor-pointer select-none';
  const active = 'bg-[#0053e2] text-white border-[#0053e2]';
  const idle   = 'border-gray-300 dark:border-zinc-600 text-gray-600 '
               + 'dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2]';
  const tagActive = 'bg-[#ffc220] text-[#995213] border-[#ffc220]';
  const tagIdle   = 'border-yellow-300 dark:border-yellow-700 text-yellow-700 '
                  + 'dark:text-yellow-400 hover:border-[#ffc220]';

  // MIME type tabs (counts from full dataset via _uplCounts)
  const mimeTabs = Object.entries(_UPL_TAB_META)
    .filter(([key]) => key === 'all' || (_uplCounts[key] || 0) > 0)
    .map(([key, meta]) => {
      const cnt   = _uplCounts[key] || 0;
      const on    = (_uplFilter === key && !_uplTagFilter);
      const label = (meta.emoji ? meta.emoji + ' ' : '') + meta.label
                  + (key === 'all' ? '' : ` (${cnt})`);
      return `<button class="${base} ${on ? active : idle}"
                      onclick="_uplSetMimeFilter('${key}')">${label}</button>`;
    }).join('');

  // Group tag pills (from _uplAllTags loaded separately)
  let tagPills = '';
  if (_uplAllTags.length) {
    tagPills = '<span class="w-px h-4 bg-gray-200 dark:bg-zinc-700 mx-1 self-center"></span>'
      + _uplAllTags.map(tag => {
          const on = (_uplTagFilter === tag);
          return `<button class="${base} ${on ? tagActive : tagIdle}"
                          onclick="_uplSetTagFilter('${_uplJsStr(tag)}')"
                          title="Filter by tag">\uD83C\uDFF7\uFE0F ${_uplEsc(tag)}</button>`;
        }).join('');
  }

  tabs.innerHTML = mimeTabs + tagPills
    + '<span class="flex-1"></span>'
    + `<button onclick="_uplToggleGrouped()"
               title="Group by type"
               class="flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition
                      ${_uplGrouped
                        ? 'bg-gray-800 text-white border-gray-800 dark:bg-zinc-200 dark:text-zinc-900'
                        : 'border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 hover:border-gray-500'}">&#9783; Group</button>`;

  if (stats) {
    const { total, page, pages } = _uplMeta;
    stats.textContent = total
      ? `${total} file${total !== 1 ? 's' : ''} \u00b7 page ${page}/${pages}`
      : '';
  }
}

// ── Render file grid (flat or grouped) ──────────────────────────────────────────────
function _uplRender() {
  const main = document.getElementById('uploads-main');
  if (!main) return;

  let visible = _uplFilter === 'all'
    ? [..._uplFiles]
    : _uplFiles.filter(f => _uplMimeGroup(f.mime_type) === _uplFilter);

  if (_uplTagFilter) {
    visible = visible.filter(f => Array.isArray(f.tags) && f.tags.includes(_uplTagFilter));
  }

  if (!_uplFiles.length) {
    main.innerHTML = `
      <div class="text-center mt-16 text-gray-400 dark:text-zinc-500 select-none">
        <p class="text-4xl mb-3">\uD83D\uDDBC\uFE0F</p>
        <p class="text-sm font-medium">No files yet</p>
        <p class="text-xs mt-1 max-w-xs mx-auto">
          Attachments you add to notes \u2014 or files you upload here \u2014 will appear here.
        </p>
      </div>`;
    return;
  }

  if (!visible.length) {
    main.innerHTML = '<div class="text-center mt-12 text-gray-400 dark:text-zinc-500 '
      + 'text-sm select-none">No files match this filter on this page.</div>';
    _uplRenderPager();
    return;
  }

  const grid = (items) =>
    `<div class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">`
    + items.map(f => _uplCard(f)).join('') + '</div>';

  if (_uplGrouped) {
    // Group by MIME type, emit section headers
    const order = ['image', 'video', 'audio', 'document', 'other'];
    const groups = {};
    for (const f of visible) {
      const g = _uplMimeGroup(f.mime_type);
      (groups[g] = groups[g] || []).push(f);
    }
    const sections = order
      .filter(g => groups[g]?.length)
      .map(g => {
        const meta = _UPL_TAB_META[g];
        const label = `${meta.emoji ? meta.emoji + ' ' : ''}${meta.label}`;
        return `<div class="mb-6">
          <h2 class="text-xs font-bold uppercase tracking-widest text-gray-400
                     dark:text-zinc-500 mb-3 px-0.5">${label}
            <span class="font-normal normal-case tracking-normal ml-1">
              (${groups[g].length})</span>
          </h2>${grid(groups[g])}
        </div>`;
      }).join('');
    main.innerHTML = sections;
  } else {
    main.innerHTML = grid(visible);
  }
  _uplRenderPager();
  if (typeof _uplDocAfterRender === 'function') _uplDocAfterRender();
}

// ── Single file card ──────────────────────────────────────────────────────────────────
function _uplCard(f) {
  const group   = _uplMimeGroup(f.mime_type);
  const emoji   = { image: '\uD83D\uDDBC\uFE0F', video: '\uD83C\uDFAC', audio: '\uD83C\uDFB5',
                    document: '\uD83D\uDCC4', other: '\uD83D\uDCCE' }[group] || '\uD83D\uDCCE';

  // Thumbnail area
  var thumb;
  if (group === 'image') {
    thumb = `<img src="/uploads/${_uplEsc(f.filename)}" alt="${_uplEsc(f.original_name)}"
             loading="lazy"
             class="w-full h-32 object-cover bg-gray-100 dark:bg-zinc-800"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
           + `<div class="w-full h-32 hidden items-center justify-center text-4xl
                         bg-gray-100 dark:bg-zinc-800">${emoji}</div>`;
  } else if (group === 'video') {
    thumb = `<div class="w-full h-32 flex items-center justify-center
                         bg-gray-900 dark:bg-zinc-950 relative">
               <span class="text-4xl opacity-60">${emoji}</span>
               <span class="absolute inset-0 flex items-center justify-center">
                 <span class="text-white/70 text-2xl">&#9654;</span></span>
             </div>`;
  } else {
    thumb = `<div class="w-full h-32 flex items-center justify-center text-5xl
                         bg-gray-100 dark:bg-zinc-800 text-gray-300">${emoji}</div>`;
  }

  // Source badge: note-attached = blue, standalone = gray
  const srcBadge = f.src === 'note'
    ? `<span class="inline-block px-1.5 py-0.5 text-[8px] rounded font-semibold
                    bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300
                    truncate max-w-full" title="${_uplEsc(f.note_title || 'Note')}">\uD83D\uDCDD ${_uplEsc((f.note_title || 'Note').substring(0,22))}</span>`
    : `<span class="inline-block px-1.5 py-0.5 text-[8px] rounded font-semibold
                    bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">Standalone</span>`;

  const tagPips = (f.tags || []).slice(0, 3).map(t =>
    `<span class="px-1.5 py-0.5 text-[8px] rounded-full bg-yellow-100
                  dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400">${_uplEsc(t)}</span>`
  ).join('');

  return `
    <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200
                dark:border-zinc-800 overflow-hidden shadow-sm cursor-pointer
                hover:shadow-md hover:border-[#0053e2] dark:hover:border-blue-500 transition group"
         data-upl-id="${f.id}" data-upl-src="${_uplEsc(f.src)}"
         onclick="if(_uplDocSelectMode&&'${f.src}'==='page'){_uplDocToggleItem('${_uplJsStr(f.src)}',${f.id})}else{_uplOpenDetail('${_uplJsStr(f.src)}',${f.id})}">
      <div class="overflow-hidden">${thumb}</div>
      <div class="p-2.5">
        <p class="text-xs font-semibold text-gray-800 dark:text-zinc-100
                  truncate group-hover:text-[#0053e2] transition"
           title="${_uplEsc(f.original_name)}">${_uplEsc(f.original_name)}</p>
        <p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">
          ${_uplFmtSize(f.size)} &middot; ${_uplFmtDate(f.created_at)}</p>
        <div class="flex flex-wrap gap-1 mt-1.5">${srcBadge}${tagPips ? tagPips : ''}</div>
      </div>
    </div>`;
}

// ── Pagination ────────────────────────────────────────────────────────────────
function _uplRenderPager() {
  const { page, pages } = _uplMeta;
  if (pages <= 1) return;
  const main = document.getElementById('uploads-main');
  if (!main) return;
  const pager = document.createElement('div');
  pager.className = 'flex items-center justify-center gap-3 mt-6 pb-4';
  const btnCls = 'px-3 py-1.5 text-xs border rounded-lg border-gray-300 dark:border-zinc-600 '
               + 'text-gray-600 dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2] '
               + 'disabled:opacity-40 disabled:cursor-not-allowed transition';
  pager.innerHTML =
    `<button onclick="_uplLoadPage(${page-1})" ${page<=1?'disabled':''} class="${btnCls}">\u2190 Prev</button>`
    + `<span class="text-xs text-gray-400 dark:text-zinc-500">Page ${page} of ${pages}</span>`
    + `<button onclick="_uplLoadPage(${page+1})" ${page>=pages?'disabled':''} class="${btnCls}">Next \u2192</button>`;
  main.appendChild(pager);
}

async function _uplLoadPage(p) {
  if (p < 1 || p > (_uplMeta.pages || 1)) return;
  await _uplFetch(p);
}

// ── Filter controls ───────────────────────────────────────────────────────────
function _uplSetMimeFilter(f) {
  _uplFilter    = f;
  _uplTagFilter = '';
  _uplRenderFilterTabs();
  _uplRender();
}

function _uplSetTagFilter(tag) {
  _uplTagFilter = (_uplTagFilter === tag) ? '' : tag;  // toggle
  _uplFilter    = 'all';
  _uplRenderFilterTabs();
  _uplRender();
}

function _uplToggleGrouped() {
  _uplGrouped = !_uplGrouped;
  _uplRenderFilterTabs();
  _uplRender();
}

// ── Detail panel ─────────────────────────────────────────────────────────────
function _uplOpenDetail(src, id) {
  const f = _uplFiles.find(x => x.src === src && x.id === id);
  if (!f) return;
  _uplCurrentDetail = f;
  _uplRenderDetail(f);
  const panel = document.getElementById('uploads-detail-panel');
  if (panel) panel.classList.remove('translate-x-full');
}
function _uplCloseDetail() {
  _uplCurrentDetail = null;
  const panel = document.getElementById('uploads-detail-panel');
  if (panel) panel.classList.add('translate-x-full');
}

function _uplRenderDetail(f) {
  const el = document.getElementById('uploads-detail-content');
  if (!el) return;

  const group  = _uplMimeGroup(f.mime_type);
  const dlUrl  = `/home/uploads/${_uplPid}/files/${f.src}/${f.id}/download`;
  const fUrl   = `/uploads/${_uplEsc(f.filename)}` + (_uplCacheBust[f.id] ? '?v=' + _uplCacheBust[f.id] : '');
  const mt     = f.mime_type;
  const isText = mt.startsWith('text/') || mt === 'application/json' ||
    (mt === 'application/octet-stream' && _uplIsTextExt(f));

  // Preview block — native players where possible
  var preview = '';
  if (group === 'image') {
    preview = `<div class="mb-4 rounded-xl overflow-hidden bg-gray-100 dark:bg-zinc-800">
      <img src="${fUrl}" alt="${_uplEsc(f.original_name)}" class="w-full object-contain max-h-52"
           onerror="this.parentElement.style.display='none'"></div>`;
  } else if (group === 'video') {
    preview = `<div class="mb-4 rounded-xl overflow-hidden bg-black">
      <video controls preload="metadata" class="w-full max-h-52">
        <source src="${fUrl}" type="${_uplEsc(mt)}">Your browser doesn\'t support HTML5 video.
      </video></div>`;
  } else if (group === 'audio') {
    preview = `<div class="mb-4 p-3 rounded-xl bg-gray-50 dark:bg-zinc-800">
      <p class="text-2xl text-center mb-2">\uD83C\uDFB5</p>
      <audio controls preload="metadata" class="w-full">
        <source src="${fUrl}" type="${_uplEsc(mt)}">Your browser doesn\'t support HTML5 audio.
      </audio></div>`;
  } else if (mt === 'application/pdf') {
    // Handled in two-zone layout below — pointer-events restored so scroll works.
    preview = null;
  } else if (mt === _DOCX_MIME) {
    // Handled in two-zone layout below — content fetched from /content endpoint.
    preview = null;
  } else if (mt === 'text/csv') {
    preview = _uplDocCsvCard(f, fUrl);
  } else if (isText) {
    // No wrapper — text preview becomes its own top-level flex zone (see layout below)
    preview = null;
  }

  // Source section
  const srcSection = f.src === 'note'
    ? `<div class="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 mb-3">
         <p class="text-[10px] uppercase tracking-wide text-blue-400 mb-1 font-bold">\uD83D\uDCDD Attached to Note</p>
         <p class="text-xs text-gray-700 dark:text-zinc-200 font-medium truncate">${_uplEsc(f.note_title||'Untitled')}</p>
         <p class="text-[10px] text-gray-500 dark:text-zinc-400 truncate">${_uplEsc(f.workspace_name||'')}</p>
         ${f.workspace_id?`<a href="/?ws=${f.workspace_id}" class="inline-block mt-1.5 text-[10px] text-[#0053e2] hover:underline">Open workspace</a>`:''}
         <button onclick="_uplDeleteNoteAttachment(${f.id})" class="mt-2 w-full py-1.5 text-xs rounded-lg
                 border border-red-200 dark:border-red-800 text-red-500
                 hover:bg-red-50 dark:hover:bg-red-900/20 transition">\uD83D\uDDD1\uFE0F Remove attachment</button></div>`
    : `<div class="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800 mb-3">
         <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-1 font-bold">Standalone Upload</p>
         <button onclick="_uplConfirmDelete(${f.id})" class="mt-1 w-full py-1.5 text-xs rounded-lg
                 border border-red-200 dark:border-red-800 text-red-500
                 hover:bg-red-50 dark:hover:bg-red-900/20 transition">\uD83D\uDDD1\uFE0F Delete file</button></div>`;

  // ── Meta + actions block (shared by all file types) ───────────────────────
  var metaBlock = `
    <p class="text-sm font-semibold text-gray-800 dark:text-zinc-100 break-words mb-0.5">${_uplEsc(f.original_name)}</p>
    <p class="text-[10px] text-gray-400 dark:text-zinc-500 mb-3">${_uplFmtSize(f.size)} &middot; ${_uplEsc(mt)} &middot; ${_uplFmtDate(f.created_at)}</p>
    <a href="${dlUrl}" download="${_uplEsc(f.original_name)}"
       class="block w-full text-center py-1.5 text-xs rounded-lg bg-[#0053e2] text-white hover:bg-[#003eb3] transition mb-3">
      \u2193 Download</a>
    <div class="mt-4"><p class="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Tags</p>
      <div id="upl-tags-area"></div></div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(156,163,175,0.2)">
      ${srcSection}
    </div>
    <div id="upl-doc-studio" class="mt-2"></div>`;

  var isPdf  = mt === 'application/pdf';
  var isDocx = mt === _DOCX_MIME;

  if (isText || isPdf || isDocx) {
    // ── Two-zone layout ────────────────────────────────────────────────────────
    // Zone 1: preview      — fixed height, scrolls its own content only.
    // Zone 2: meta/actions — fills remaining height, scrolls independently.
    // Outer container is overflow:hidden — it NEVER shows its own scrollbar,
    // eliminating the "two scrollbars competing on the same edge" problem.
    var isDark      = document.documentElement.classList.contains('dark');
    var previewBg   = isDark ? '#27272a' : '#f9fafb';          // zinc-800 / gray-50
    var previewBord = isDark ? 'rgba(63,63,70,0.6)' : 'rgba(156,163,175,0.25)';

    var expandBtn = '<div style="position:absolute;inset:0;pointer-events:none">'
      + '<button onclick="_uplFileViewerOpen(_uplCurrentDetail)"'
      + ' style="position:absolute;bottom:8px;right:8px;pointer-events:auto;'
      + 'border:0;border-radius:8px;padding:4px 10px;cursor:pointer;'
      + 'font-size:11px;font-weight:600;'
      + 'background:rgba(255,255,255,.92);color:#1f2937;'
      + 'box-shadow:0 1px 4px rgba(0,0,0,.18)">'
      + '&#128269; Expand'
      + '</button></div>';

    var zone1;
    if (isText) {
      // Outer wrapper holds the fixed height + positions the Expand button.
      // Inner #upl-text-preview is the actual scroll container so the button
      // stays pinned while text scrolls underneath it.
      zone1 = '<div style="flex-shrink:0;height:13rem;overflow:hidden;position:relative;'
        + 'border-bottom:1px solid ' + previewBord + '">'
        + '<div id="upl-text-preview"'
        + ' style="height:100%;overflow-y:scroll;overscroll-behavior-y:contain;'
        + 'padding:.75rem;background:' + previewBg + '">'
        + '<p style="font-size:10px;color:#9ca3af;font-style:italic">Loading preview\u2026</p>'
        + '</div>'
        + expandBtn
        + '</div>';
    } else if (isDocx) {
      // DOCX — content comes from the /content endpoint (mammoth-rendered HTML).
      // Same structure as text: scrollable inner div + pinned Expand button.
      zone1 = '<div style="flex-shrink:0;height:13rem;overflow:hidden;position:relative;'
        + 'border-bottom:1px solid ' + previewBord + '">'
        + '<div id="upl-docx-preview"'
        + ' style="height:100%;overflow-y:scroll;overscroll-behavior-y:contain;'
        + 'padding:.75rem;background:' + previewBg + '">'
        + '<p style="font-size:10px;color:#9ca3af;font-style:italic">Loading preview\u2026</p>'
        + '</div>'
        + expandBtn
        + '</div>';
    } else {
      // PDF — use browser embed for the mini-preview.
      // The browser's native viewer ignores CSS dark mode, so we apply the
      // classic invert+hue-rotate trick when the app is in dark mode.
      var pdfFilter = isDark ? 'filter:invert(1) hue-rotate(180deg);' : '';
      zone1 = '<div style="flex-shrink:0;height:16rem;overflow:hidden;position:relative;'
        + 'border-bottom:1px solid ' + previewBord + '">'
        + '<embed src="' + fUrl + '" type="application/pdf"'
        + ' style="width:100%;height:100%;border:0;' + pdfFilter + '" tabindex="-1">'
        + expandBtn
        + '</div>';
    }

    el.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;height:calc(100% - 3rem);padding:0';
    el.innerHTML = zone1
      + '<div style="flex:1;min-height:0;overflow-y:auto;overscroll-behavior-y:contain;padding:1rem">'
      + metaBlock
      + '</div>';
  } else {
    // ── Single-zone layout (image / video / audio / PDF / DOCX / unknown) ─────
    // Outer container scrolls the whole thing — no inner scroll box conflicts.
    // Restore height; clear any flex state left from a prior text-file open.
    el.style.cssText = 'height:calc(100% - 3rem)';
    el.innerHTML = (preview || '') + metaBlock;
  }

  if (isText) _uplFetchTextPreview(fUrl);
  if (isDocx) _uplFetchDocxPreview(f);
  _uplLoadTags(f.src, f.id);
  if (typeof _uplDocStudioInit === 'function') _uplDocStudioInit(f);
}


function _uplDocCsvCard(f, fUrl) {
  var icon  = f.mime_type === _DOCX_MIME ? '\uD83D\uDCC4' : '\uD83D\uDCCA';
  var label = f.mime_type === _DOCX_MIME ? 'Word Document' : 'CSV Spreadsheet';
  return '<div class="mb-4 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden cursor-pointer group hover:border-[#0053e2] transition-colors" onclick="_uplFileViewerOpen(_uplCurrentDetail)"><div class="flex items-center gap-3 p-4 bg-gray-50 dark:bg-zinc-800"><span class="text-3xl">' + icon + '</span><div class="min-w-0"><p class="text-sm font-semibold text-gray-800 dark:text-zinc-100 truncate">' + _uplEsc(f.original_name) + '</p><p class="text-[10px] text-gray-400">' + label + ' &middot; click to view</p></div><span class="ml-auto text-[11px] font-semibold text-[#0053e2] group-hover:underline flex-shrink-0">View &#8594;</span></div></div>';
}

// ── Delete confirmation modal ───────────────────────────────────────────────────
function _uplConfirmDelete(uploadId) {
  const f = _uplFiles.find(x => x.src === 'page' && x.id === uploadId);
  _uplDelPending = uploadId;
  const modal    = document.getElementById('upl-del-modal');
  const nameEl   = document.getElementById('upl-del-filename');
  if (nameEl) nameEl.textContent = f?.original_name || 'this file';
  if (modal)  modal.classList.remove('hidden');
  // Focus the confirm button for keyboard users
  setTimeout(() => document.getElementById('upl-del-confirm-btn')?.focus(), 50);
}

function _uplCancelDelete() {
  document.getElementById('upl-del-modal')?.classList.add('hidden');
  _uplDelPending = null;
}

async function _uplDeleteNoteAttachment(attachmentId) {
  var f     = _uplFiles.find(function(x) { return x.src === 'note' && x.id === attachmentId; });
  var modal = document.getElementById('upl-rm-att-modal');
  var nameEl= document.getElementById('upl-rm-att-filename');
  if (nameEl) nameEl.textContent = f ? f.original_name : 'this file';
  _uplRmAttPending = attachmentId;
  if (modal) modal.classList.remove('hidden');
  setTimeout(function() {
    var btn = document.getElementById('upl-rm-att-confirm-btn');
    if (btn) btn.focus();
  }, 50);
}

function _uplCancelRemoveAttachment() {
  document.getElementById('upl-rm-att-modal')?.classList.add('hidden');
  _uplRmAttPending = null;
}

async function _uplDoRemoveAttachment() {
  var attachmentId = _uplRmAttPending;
  _uplCancelRemoveAttachment();
  if (!attachmentId) return;
  try {
    var r = await fetch('/notes/attachments/' + attachmentId, { method: 'DELETE' });
    if (!r.ok) throw new Error(r.status);
    _uplCloseDetail();
    await _uplFetch(_uplMeta.page || 1);
    _uplShowToast('Attachment removed.');
  } catch(e) {
    _uplShowToast('Remove failed: ' + _uplEsc(String(e)), true);
  }
}

async function _uplDoDelete() {
  const uploadId = _uplDelPending;
  _uplCancelDelete();          // close modal + clear pending
  if (!uploadId) return;

  const r  = await fetch(`/home/uploads/${_uplPid}/files/page/${uploadId}`,
                         { method: 'DELETE' });
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    _uplShowToast('Session expired \u2014 please refresh.', true); return;
  }
  if (!r.ok) { _uplShowToast('Delete failed.', true); return; }

  _uplShowToast('File deleted.');
  _uplCloseDetail();
  await _uplFetch(_uplMeta.page || 1);
}

// Tags CRUD lives in home-page-uploads-tags.js (loaded after this file)
// ── Upload modal open / close ───────────────────────────────────────────────────────────────
function uplOpenUploadModal() {
  if (_uplBusy) return;
  const backdrop = document.getElementById('uploads-modal-backdrop');
  if (!backdrop) return;
  backdrop.classList.remove('hidden');
  // Focus the drop zone for keyboard users
  const zone = document.getElementById('upl-drop-zone');
  if (zone) setTimeout(() => zone.focus(), 50);
}

function _uplCloseModal() {
  const backdrop = document.getElementById('uploads-modal-backdrop');
  if (!backdrop) return;
  backdrop.classList.add('hidden');
  // Reset progress area
  const prog = document.getElementById('upl-progress-area');
  const bar  = document.getElementById('upl-progress-bar');
  const lbl  = document.getElementById('upl-progress-label');
  if (prog) prog.classList.add('hidden');
  if (bar)  bar.style.width = '0%';
  if (lbl)  lbl.textContent = 'Uploading\u2026';
  // Re-enable the Upload button
  const btn = document.getElementById('uploads-upload-btn');
  if (btn) btn.disabled = false;
}

// ── Drop zone drag-over / drag-leave ──────────────────────────────────────────────────────────────────
function _uplDropZoneActive(event, active) {
  event.preventDefault(); event.stopPropagation();
  const zone = document.getElementById('upl-drop-zone');
  const icon = document.getElementById('upl-drop-icon');
  if (!zone) return;
  const zOn  = ['!border-[#0053e2]', '!bg-blue-50/80', 'dark:!bg-blue-900/20', 'scale-[1.01]'];
  const iOn  = ['ring-4', 'ring-blue-200', 'dark:ring-blue-800', 'scale-110'];
  if (active) {
    zone.classList.add(...zOn);
    if (icon) icon.classList.add(...iOn);
  } else {
    zone.classList.remove(...zOn);
    if (icon) icon.classList.remove(...iOn);
  }
}

// ── Files dropped on the zone ─────────────────────────────────────────────────────
function _uplDropped(event) {
  event.preventDefault();
  event.stopPropagation();
  _uplDropZoneActive(event, false);
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length) _uplProcessFiles(files);
}

// ── Core upload logic (fed by file picker ORdrop) ────────────────────
async function _uplProcessFiles(files) {
  if (_uplBusy || !files.length) return;
  _uplBusy = true;

  // Read WebP toggle state at upload time
  const webp = document.getElementById('upl-webp-toggle')?.checked !== false ? 1 : 0;

  // Show progress area, dim drop zone
  const prog  = document.getElementById('upl-progress-area');
  const bar   = document.getElementById('upl-progress-bar');
  const lbl   = document.getElementById('upl-progress-label');
  const zone  = document.getElementById('upl-drop-zone');
  const btn   = document.getElementById('uploads-upload-btn');
  if (prog) prog.classList.remove('hidden');
  if (zone) zone.classList.add('opacity-30', 'pointer-events-none');
  if (btn)  btn.disabled = true;

  var done = 0, failed = 0;
  const total = files.length;

  for (const file of files) {
    if (lbl) lbl.textContent =
      `Uploading ${done + 1} of ${total} \u2014 ${_uplEsc(file.name)}`;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch(`/home/uploads/${_uplPid}/upload?webp=${webp}`,
                            { method: 'POST', body: fd });
      if (!r.ok) failed++;
    } catch { failed++; }
    done++;
    if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
  }

  _uplBusy = false;
  if (zone) zone.classList.remove('opacity-30', 'pointer-events-none');

  if (lbl) lbl.textContent = failed
    ? `Done \u2014 ${failed} file${failed !== 1 ? 's' : ''} failed.`
    : `Done! ${total} file${total !== 1 ? 's' : ''} uploaded.`;

  setTimeout(() => {
    _uplCloseModal();
    if (failed) _uplShowToast(`${failed} file${failed !== 1 ? 's' : ''} failed to upload.`, true);
    _uplFetch(1);
  }, 900);
}

// ── Toast ───────────────────────────────────────────────────────────────────────────────────
function _uplShowToast(msg, isErr) {
  if (typeof window._bwToast === 'function') {
    window._bwToast(msg, isErr ? 'error' : 'success');
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
// _uplEsc  — HTML attribute / content context (& < > " ')
// _uplJsStr — JS string literal context inside onclick='...' (backslash-escape \ and ')
function _uplEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _uplJsStr(s) { // Escape for single-quoted onclick='...' attrs.
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
} // Note: _uplFmtSize + _uplFmtDate live in home-page-uploads-tags.js
