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
var _uplWidgetUsageMap = {};    // fileId → [{widget_id, widget_name, page_id, page_name, page_emoji}]
var _uplEscHandler    = null;   // ESC keydown ref — stored so we can remove before re-adding
var _DOCX_MIME     = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ── Entry point ───────────────────────────────────────────────────────────────
async function initUploadsPage(pid) {
  _uplPid           = pid;
  _uplFiles         = [];
  _uplMeta          = {};
  _uplCounts        = {};
  _uplFilter        = 'all';
  _uplTagFilter     = '';
  _uplGrouped       = localStorage.getItem('bw_upl_' + pid + '_grouped') === '1';
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

  // ESC closes whichever overlay is open.
  // Remove any previous listener before re-adding so navigation doesn't accumulate copies.
  if (_uplEscHandler) document.removeEventListener('keydown', _uplEscHandler);
  _uplEscHandler = function(e) {
    if (e.key !== 'Escape') return;
    _uplCloseModal();
    _uplCancelDelete();
    if (_uplCurrentDetail) _uplCloseDetail();
  };
  document.addEventListener('keydown', _uplEscHandler);

  // Load tags once upfront so filter pills are ready immediately
  _uplLoadAllTags();
  // Backfill grid: tags for ALL grid pages this user owns, so the "📸 Grid" badge
  // appears on files that were added before per-file tagging was introduced.
  // Fire-and-forget (not awaited) — idempotent; no need to block the initial render.
  fetch('/home/grid/backfill-all-tags', {method: 'POST'})
    .catch(function(_bfe) { console.warn('[uploads] backfill-all-tags failed:', _bfe); });
  await _uplFetch(1);
}

// ── Fetch paginated file list ─────────────────────────────────────────────────
async function _uplFetch(page) {
  const main = document.getElementById('uploads-main');
  if (!main) return;

  main.innerHTML = '<div class="text-center mt-16 text-gray-300 dark:text-zinc-600 '
    + 'animate-pulse text-sm select-none">Loading files\u2026</div>';

  try {
    var _fldQs = (typeof _uplFolderGetFilter === 'function') ? _uplFolderGetFilter() : '';
    var _catQs = (typeof _uplCatalogGetFilter === 'function') ? _uplCatalogGetFilter() : '';
    const r = await fetch('/home/uploads/' + _uplPid + '/files?page=' + page + _fldQs + _catQs);
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
  // Fire-and-forget: inject 🖼️ widget-usage badges onto page-source file cards
  _uplFetchWidgetUsage();
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
  // grid:XX entries are connection metadata — never show them as filter pills.
  const userTags = _uplAllTags.filter(t => !t.startsWith('grid:'));
  let tagPills = '';
  if (userTags.length) {
    tagPills = '<span class="w-px h-4 bg-gray-200 dark:bg-zinc-700 mx-1 self-center"></span>'
      + userTags.map(tag => {
          const on = (_uplTagFilter === tag);
          return `<button class="${base} ${on ? tagActive : tagIdle}"
                          onclick="_uplSetTagFilter('${_uplJsStr(tag)}')"
                          title="Filter by tag">\uD83C\uDFF7\uFE0F ${_uplEsc(tag)}</button>`;
        }).join('');
  }

  // Split the bar into two zones so Group + Select are always visible:
  //   Left  — scrollable pills (MIME tabs + tag filters, overflow-x:auto)
  //   Right  — pinned actions zone (Group button; Select injected after)
  // This means filter pills can scroll on mobile without pushing the
  // action buttons off-screen, which was the root cause of the missing
  // Group / Select buttons on real phones.
  var isDark      = document.documentElement.classList.contains('dark');
  var dividerClr  = isDark ? '#27272a' : '#f3f4f6'; // zinc-800 / gray-100
  var groupBtnCls = _uplGrouped
    ? 'bg-gray-800 text-white border-gray-800 dark:bg-zinc-200 dark:text-zinc-900'
    : 'border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 hover:border-gray-500';

  // Override the Tailwind overflow-x-auto + px-4 py-2 on the container
  tabs.style.overflowX = 'hidden';
  tabs.style.padding   = '0';

  tabs.innerHTML =
    // ── Scrollable pills zone ────────────────────────────────────────────
    '<div style="display:flex;flex:1;align-items:center;gap:4px;' +
    'overflow-x:auto;min-width:0;padding:8px 4px 8px 16px;">'
    + mimeTabs + tagPills
    + '</div>'
    // ── Pinned actions zone ──────────────────────────────────────────────
    // Select button injected here by _uplDocInjectSelectBtn() after render
    + '<div id="upl-filter-actions" style="display:flex;flex-shrink:0;' +
    'align-items:center;gap:6px;padding:8px 16px 8px 8px;' +
    'border-left:1px solid ' + dividerClr + ';">' +
    `<button onclick="_uplToggleGrouped()" title="Group by type"
             class="flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition
                    ${groupBtnCls}">&#9783;<span class="upl-rsp-label"> Group</span></button>` +
    '</div>';

  // Re-inject the Select button into the pinned actions zone after rebuilding
  if (typeof _uplDocInjectSelectBtn === 'function') _uplDocInjectSelectBtn();

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
  if (typeof _uplTsInit === 'function') _uplTsInit();
}

// ── Single file card ──────────────────────────────────────────────────────────────────
function _uplCard(f) {
  const group   = _uplMimeGroup(f.mime_type);
  const emoji   = { image: '\uD83D\uDDBC\uFE0F', video: '\uD83C\uDFAC', audio: '\uD83C\uDFB5',
                    document: '\uD83D\uDCC4', other: '\uD83D\uDCCE' }[group] || '\uD83D\uDCCE';

  // Thumbnail area
  var thumb;
  if (group === 'image') {
    // Use a width-capped thumbnail for the grid card — the lightbox loads the full file.
    const thumbSrc = `/uploads/thumb/${_uplEsc(f.filename)}?w=400`;
    thumb = `<img src="${thumbSrc}" alt="${_uplEsc(f.original_name)}"
             loading="lazy" decoding="async"
             style="-webkit-touch-callout:none"
             class="w-full h-32 object-cover bg-gray-100 dark:bg-zinc-800"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
           + `<div class="w-full h-32 hidden items-center justify-center text-4xl
                         bg-gray-100 dark:bg-zinc-800">${emoji}</div>`;
  } else if (group === 'video') {
    // #t=0.5 tells the browser to seek to 0.5 s so we get a real frame, not a black box.
    // preload="metadata" keeps it lightweight — only the first chunk is fetched.
    // onerror fallback shows the emoji play-button if the video can't load.
    const vSrc = `/uploads/${_uplEsc(f.filename)}`;
    const vType = _uplEsc(f.mime_type);
    thumb = `<div class="relative w-full h-32 bg-gray-900 dark:bg-zinc-950 overflow-hidden">`
           + `<video preload="metadata" muted playsinline
                    style="-webkit-touch-callout:none"
                    class="w-full h-full object-cover"
                    onerror="this.parentElement.querySelector('.upl-vid-fallback').style.display='flex';this.remove()">
                <source src="${vSrc}#t=0.5" type="${vType}">
              </video>`
           + `<div class="upl-vid-fallback absolute inset-0 hidden items-center justify-center">`
           + `  <span class="text-4xl opacity-60">${emoji}</span>`
           + `</div>`
           + `<div class="absolute inset-0 flex items-center justify-center pointer-events-none">`
           + `  <span class="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">`
           + `    <span class="text-white text-sm pl-0.5">&#9654;</span>`
           + `  </span>`
           + `</div>`
           + `</div>`;
  } else {
    thumb = `<div class="w-full h-32 flex items-center justify-center text-5xl
                         bg-gray-100 dark:bg-zinc-800 text-gray-300">${emoji}</div>`;
  }

  // Source badge: note-attached = blue, grid-linked = green (clickable),
  //   db-card cover = amber, standalone = gray
  const gridTag = Array.isArray(f.tags) && f.tags.find(function(t){ return t.startsWith('grid:'); });
  const gridPid = gridTag ? parseInt(gridTag.split(':')[1], 10) : null;
  const srcBadge = f.src === 'note'
    ? `<span class="inline-block px-1.5 py-0.5 text-[8px] rounded font-semibold
                    bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300
                    truncate max-w-full" title="${_uplEsc(f.note_title || 'Note')}">\uD83D\uDCDD ${_uplEsc((f.note_title || 'Note').substring(0,22))}</span>`
    : gridPid
    ? `<button onclick="event.stopPropagation();_uplGridBadgeClick(${gridPid},this)"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] rounded
                       font-semibold bg-green-50 text-green-700 dark:bg-green-900/40
                       dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/60
                       transition-colors cursor-pointer"
                title="Click to see which grid page this belongs to"
                aria-haspopup="true">&#128248; Grid &#9660;</button>`
    : f.db_card_id && f.db_card_attr_id
    ? `<button onclick="event.stopPropagation();_uplGotoDbCard(${f.db_card_ws_id},${f.db_card_id})"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] rounded
                       font-semibold bg-purple-50 text-purple-700 dark:bg-purple-900/40
                       dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/60
                       transition-colors cursor-pointer"
                title="File attribute on DB card: ${_uplEsc(f.db_card_title || 'Card')} in ${_uplEsc(f.db_card_ws_name || '')}"
                aria-label="Open card">
        &#128206;&nbsp;${_uplEsc((f.db_card_title || 'Card').substring(0,18))} &#9656;
      </button>`
    : f.db_card_id
    ? `<button onclick="event.stopPropagation();_uplGotoDbCard(${f.db_card_ws_id},${f.db_card_id})"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] rounded
                       font-semibold bg-amber-50 text-amber-700 dark:bg-amber-900/40
                       dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60
                       transition-colors cursor-pointer"
                title="Cover for DB card: ${_uplEsc(f.db_card_title || 'Card')} in ${_uplEsc(f.db_card_ws_name || '')}"
                aria-label="Open card">
        &#128247; ${_uplEsc((f.db_card_title || 'Card').substring(0,18))} &#9656;
      </button>`
    : `<span class="inline-block px-1.5 py-0.5 text-[8px] rounded font-semibold
                    bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">Standalone</span>`;

  // Exclude grid: tags from yellow pills — they're already shown via the badge
  const tagPips = (f.tags || []).filter(function(t){ return !t.startsWith('grid:'); }).slice(0, 3).map(t =>
    `<span class="px-1.5 py-0.5 text-[8px] rounded-full bg-yellow-100
                  dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400">${_uplEsc(t)}</span>`
  ).join('');

  return `
    <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200
                dark:border-zinc-800 overflow-hidden shadow-sm cursor-pointer
                hover:shadow-md hover:border-[#0053e2] dark:hover:border-blue-500 transition group"
         data-upl-id="${f.id}" data-upl-src="${f.src}"
         data-upl-file-key="${f.src}:${f.id}"
         data-upl-folder-id="${f.folder_id != null ? f.folder_id : ''}"
         data-upl-tags="${_uplEsc((f.tags || []).join(','))}"
         draggable="true"
         ondragstart="_dndOnFileDragStart(event,'${f.src}',${f.id},${f.folder_id != null ? f.folder_id : 'null'})"
         ondragend="_dndOnFileDragEnd(event)"
         onclick="if(event.ctrlKey||event.metaKey){event.stopPropagation();_dndSelToggle('${f.src}',${f.id},${f.folder_id != null ? f.folder_id : 'null'});return;}if(typeof _uplCheckMode!=='undefined'&&_uplCheckMode){event.stopPropagation();_dndSelToggle('${f.src}',${f.id},${f.folder_id != null ? f.folder_id : 'null'});return;}_uplOpenDetail('${_uplJsStr(f.src)}',${f.id})">
      <div class="overflow-hidden">${thumb}</div>
      <div class="p-2.5">
        <p class="text-xs font-semibold text-gray-800 dark:text-zinc-100
                  truncate group-hover:text-[#0053e2] transition"
           title="${_uplEsc(f.original_name)}">${_uplEsc(f.original_name)}</p>
        <p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">
          ${_uplFmtSize(f.size)} &middot; ${_uplFmtDate(f.created_at)}</p>
        <div class="flex flex-wrap gap-1 mt-1.5">${srcBadge}${tagPips ? tagPips : ''}${f.src === 'page' ? '<span data-upl-widget-badge="' + f.id + '"></span>' : ''}</div>
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
  localStorage.setItem('bw_upl_' + _uplPid + '_grouped', _uplGrouped ? '1' : '0');
  _uplRenderFilterTabs();
  _uplRender();
}

// ── Detail panel — view-mode-aware (mirrors notes openPanel / closePanel) ──────

function _uplOpenDetail(src, id) {
  const f = _uplFiles.find(x => x.src === src && x.id === id);
  if (!f) return;
  _uplCurrentDetail = f;
  _uplRenderDetail(f);
  _uplShowDetailPanel();
}

function _uplRemoveDetailBackdrop() {
  var bd = document.getElementById('_upl-detail-backdrop');
  if (bd) bd.remove();
}

function _uplShowDetailPanel() {
  const panel = document.getElementById('uploads-detail-panel');
  if (!panel) return;

  const mode   = localStorage.getItem('bw-view-mode') || 'panel';
  const isDark = document.documentElement.classList.contains('dark');

  panel.removeAttribute('style');
  panel.classList.remove('hidden');
  _uplRemoveDetailBackdrop();

  // All modes: panel is a column flex-container so header stays fixed and
  // the content div (flex:1) fills the rest without double-scrollbar issues.
  panel.style.display        = 'flex';
  panel.style.flexDirection  = 'column';
  panel.style.overflow       = 'hidden';

  if (mode === 'fullscreen') {
    // ── Full-screen: fills the entire viewport ──
    Object.assign(panel.style, {
      position: 'fixed', inset: '0', zIndex: '40',
    });

  } else if (mode === 'center') {
    // ── Center: floating card, blurred backdrop catches click-outside ──
    const bd = document.createElement('div');
    bd.id = '_upl-detail-backdrop';
    bd.setAttribute('aria-hidden', 'true');
    bd.style.cssText =
      'position:fixed;inset:0;z-index:38;background:rgba(0,0,0,0.45);' +
      'backdrop-filter:blur(2px);cursor:pointer;';
    bd.addEventListener('click', _uplCloseDetail);
    document.body.appendChild(bd);

    Object.assign(panel.style, {
      position:     'fixed',
      top:          '50%',
      left:         '50%',
      transform:    'translate(-50%, -50%)',
      zIndex:       '39',
      width:        'min(36rem, 95vw)',
      maxHeight:    '90vh',
      borderRadius: '1rem',
      boxShadow:    '0 24px 64px rgba(0,0,0,0.28)',
      background:   isDark ? '#18181b' : '#ffffff',
    });

  } else {
    // ── Side panel (default) ──
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      Object.assign(panel.style, {
        position: 'fixed', inset: '0', zIndex: '40',
      });
    } else {
      Object.assign(panel.style, {
        position:   'fixed',
        top:        '0', bottom: '0', right: '0',
        width:      '22rem',
        zIndex:     '40',
        borderLeft: isDark ? '1px solid #3f3f46' : '1px solid #e5e7eb',
        boxShadow:  '-4px 0 24px rgba(0,0,0,0.10)',
      });
    }
    // Transparent backdrop — sits below the panel (z:40) and catches clicks outside.
    const bd = document.createElement('div');
    bd.id = '_upl-detail-backdrop';
    bd.setAttribute('aria-hidden', 'true');
    bd.style.cssText = 'position:fixed;inset:0;z-index:39;background:transparent;';
    bd.addEventListener('click', _uplCloseDetail);
    document.body.appendChild(bd);
  }
}

function _uplCloseDetail() {
  _uplCurrentDetail = null;
  _uplRemoveDetailBackdrop();
  const panel = document.getElementById('uploads-detail-panel');
  if (!panel) return;
  panel.removeAttribute('style');
  panel.classList.add('hidden');
}

// Switch to wsId, wait for the note-list HTMX swap to finish, then open noteId
// in the detail panel — all without a page reload.
function _uplGotoNoteInWorkspace(wsId, noteId) {
  _uplCloseDetail();
  var nl = document.getElementById('note-list');
  if (nl) {
    nl.addEventListener('htmx:afterSwap', function _once() {
      nl.removeEventListener('htmx:afterSwap', _once);
      htmx.ajax('GET', '/notes/' + noteId, { target: '#detail-panel', swap: 'innerHTML' });
    });
  }
  wsSingleClick(wsId);
}

// Switch to wsId and then open the DB card detail panel.
function _uplGotoDbCard(wsId, cardId) {
  _uplCloseDetail();

  // "Already active" shortcut: only valid when the DB grid is actually rendered
  // and the home canvas is NOT showing.  _dbWsId is never reset when the user
  // navigates back to the home page, so we must check the DOM, not just the var.
  var dbRoot      = document.getElementById('db-view-root');
  var homeContent = document.getElementById('home-content');
  var homeVisible = homeContent && !homeContent.classList.contains('hidden');
  if (!homeVisible && dbRoot
      && typeof _dbWsId !== 'undefined' && _dbWsId === wsId
      && typeof _dbOpenDetail === 'function') {
    _dbOpenDetail(cardId);
    return;
  }

  // Navigate to the DB workspace, then open the card once it settles.
  // Listen on *document* (not #note-list) so our handler fires AFTER the
  // global initDatabaseView() handler has already run and set _dbWsId — no
  // arbitrary delay needed.
  var _handled = false;
  function _onSettle() {
    var root = document.getElementById('db-view-root');
    // Ignore afterSettle events that aren't for our target DB (e.g. OOB sidebar swap)
    if (!root || parseInt(root.dataset.wsId, 10) !== wsId) return;
    _handled = true;
    document.removeEventListener('htmx:afterSettle', _onSettle);
    if (typeof _dbOpenDetail === 'function') _dbOpenDetail(cardId);
  }
  document.addEventListener('htmx:afterSettle', _onSettle);
  // Safety cleanup — remove the listener after 6 s to prevent leaks if
  // navigation fails or the workspace turns out not to be a database.
  setTimeout(function() {
    if (!_handled) document.removeEventListener('htmx:afterSettle', _onSettle);
  }, 6000);

  wsSingleClick(wsId);
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
    // Detail panel preview uses an 800 px thumbnail; the lightbox opens the full file.
    const thumbSrc = `/uploads/thumb/${_uplEsc(f.filename)}?w=800`;
    preview = `<div class="mb-4 rounded-xl overflow-hidden bg-gray-100 dark:bg-zinc-800
                          relative group cursor-zoom-in"
                    onclick="_uplOpenLightbox('${fUrl}','${_uplEsc(f.original_name)}')">
      <img src="${thumbSrc}" alt="${_uplEsc(f.original_name)}"
           class="w-full object-contain max-h-52"
           onerror="this.parentElement.style.display='none'">
      <div class="absolute inset-0 flex items-end justify-center pb-2
                  opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <span class="text-[10px] bg-black/50 text-white rounded px-1.5 py-0.5 select-none">
          Click to expand
        </span>
      </div></div>`;
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
         ${f.workspace_id?`<button type="button" onclick="_uplGotoNoteInWorkspace(${f.workspace_id},${f.note_id})" class="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-lg font-medium bg-[#0053e2] hover:bg-[#0046c0] text-white transition">&#x1F4C2; Open workspace &amp; note</button>`:''}
         <button onclick="_uplDeleteNoteAttachment(${f.id})" class="mt-2 w-full py-1.5 text-xs rounded-lg
                 border border-red-200 dark:border-red-800 text-red-500
                 hover:bg-red-50 dark:hover:bg-red-900/20 transition">\uD83D\uDDD1\uFE0F Remove attachment</button></div>`
    : f.db_card_id && f.db_card_attr_id
    ? `<div class="p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 mb-3">
         <p class="text-[10px] uppercase tracking-wide text-purple-600 dark:text-purple-400 mb-1 font-bold">&#128206; DB Card File Attribute</p>
         <p class="text-xs text-gray-700 dark:text-zinc-200 font-medium truncate"
            title="${_uplEsc(f.db_card_title||'Card')}">${_uplEsc(f.db_card_title||'Untitled card')}</p>
         <p class="text-[10px] text-gray-500 dark:text-zinc-400 truncate">${_uplEsc(f.db_card_ws_name||'')}</p>
         <p class="text-[10px] text-purple-600/70 dark:text-purple-400/60 mt-1 italic">
           Deleting this file will also remove it from the card&#39;s files list.
         </p>
         <button type="button" onclick="_uplGotoDbCard(${f.db_card_ws_id},${f.db_card_id})"
                 class="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-xs
                        rounded-lg font-medium
                        bg-purple-600 hover:bg-purple-700
                        dark:bg-purple-500 dark:hover:bg-purple-400
                        text-white transition">
           &#128206; Open card
         </button>
         <button onclick="_uplConfirmDelete(${f.id})" class="mt-2 w-full py-1.5 text-xs rounded-lg
                 border border-red-200 dark:border-red-800 text-red-500
                 hover:bg-red-50 dark:hover:bg-red-900/20 transition">\uD83D\uDDD1\uFE0F Delete file</button></div>`
    : f.db_card_id
    ? `<div class="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 mb-3">
         <p class="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1 font-bold">&#128247; DB Card Cover</p>
         <p class="text-xs text-gray-700 dark:text-zinc-200 font-medium truncate"
            title="${_uplEsc(f.db_card_title||'Card')}">${_uplEsc(f.db_card_title||'Untitled card')}</p>
         <p class="text-[10px] text-gray-500 dark:text-zinc-400 truncate">${_uplEsc(f.db_card_ws_name||'')}</p>
         <p class="text-[10px] text-amber-600/70 dark:text-amber-400/60 mt-1 italic">
           Deleting this file will clear the cover on that card.
         </p>
         <button type="button" onclick="_uplGotoDbCard(${f.db_card_ws_id},${f.db_card_id})"
                 class="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-xs
                        rounded-lg font-medium
                        bg-amber-500 hover:bg-amber-600
                        dark:bg-amber-400 dark:hover:bg-amber-300 dark:text-amber-900
                        text-white transition">
           &#128247; Open card
         </button>
         <button onclick="_uplConfirmDelete(${f.id})" class="mt-2 w-full py-1.5 text-xs rounded-lg
                 border border-red-200 dark:border-red-800 text-red-500
                 hover:bg-red-50 dark:hover:bg-red-900/20 transition">\uD83D\uDDD1\uFE0F Delete file</button></div>`
    : `<div class="p-3 rounded-xl bg-gray-50 dark:bg-zinc-800 mb-3">
         <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-1 font-bold">Standalone Upload</p>
         ${f.folder_id != null ? '<button onclick="_uplRemoveFromFolder(' + f.id + ')" class="mt-2 w-full py-1.5 text-xs rounded-lg border border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-700 transition">' + "\uD83D\uDCC2" + ' Remove from folder</button>' : ''}
         <button onclick="_uplConfirmDelete(${f.id})" class="mt-1 w-full py-1.5 text-xs rounded-lg
                 border border-red-200 dark:border-red-800 text-red-500
                 hover:bg-red-50 dark:hover:bg-red-900/20 transition">\uD83D\uDDD1\uFE0F Delete file</button></div>`;

  // ── Meta + actions block (shared by all file types) ───────────────────────
  // Grid connections are rendered async into #upl-grid-connections after mount.
  var gridTags = (f.tags || []).filter(function(t) { return t.startsWith('grid:'); });
  var gridConnSlot = gridTags.length
    ? '<div id="upl-grid-connections" class="mt-3"><p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-zinc-500 mb-2">&#128248; Grid Connections</p>'
      + '<p class="text-[10px] text-gray-400 italic">Loading…</p></div>'
    : '';

  var metaBlock = `
    <p class="text-sm font-semibold text-gray-800 dark:text-zinc-100 break-words mb-0.5">${_uplEsc(f.original_name)}</p>
    <p class="text-[10px] text-gray-400 dark:text-zinc-500 mb-3">${_uplFriendlyType(mt)} &middot; ${_uplFmtSize(f.size)}${f.size >= 1024 ? ' <span title="' + Number(f.size).toLocaleString() + ' bytes" class="opacity-70">(' + Number(f.size).toLocaleString() + '&thinsp;B)</span>' : ''} &middot; ${_uplFmtDate(f.created_at)}</p>
    <a href="${dlUrl}" download="${_uplEsc(f.original_name)}"
       class="block w-full text-center py-1.5 text-xs rounded-lg bg-[#0053e2] text-white hover:bg-[#003eb3] transition mb-3">
      \u2193 Download</a>
    <div class="mt-4"><p class="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Tags</p>
      <div id="upl-tags-area"></div></div>
    ${f.src === 'page' ? '<div id="upl-detail-catalogs" class="mt-3"></div>' : ''}
    ${gridConnSlot}
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
      // PDF — render page 1 via PDF.js into a <canvas> (same engine as the
      // fullscreen viewer). Canvas is a normal DOM element so the container
      // dark background works, the scrollbar is CSS-styleable, and images/
      // layout render faithfully. _uplFetchPdfCanvas() does the async work.
      zone1 = '<div style="flex-shrink:0;height:13rem;overflow:hidden;position:relative;'
        + 'border-bottom:1px solid ' + previewBord + '">'
        + '<div id="upl-pdf-canvas-wrap"'
        + ' style="height:100%;overflow-y:auto;overscroll-behavior-y:contain;'
        + 'padding:.5rem;background:' + previewBg + '">'
        + '<p style="font-size:10px;color:#9ca3af;font-style:italic">Loading preview\u2026</p>'
        + '</div>'
        + expandBtn
        + '</div>';
    }

    el.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:0';
    el.innerHTML = zone1
      + '<div style="flex:1;min-height:0;overflow-y:auto;overscroll-behavior-y:contain;padding:1rem">'
      + metaBlock
      + '</div>';
  } else {
    // ── Single-zone layout (image / video / audio / unknown) ──
    // flex:1 fills the parent column; overflow-y:auto handles scroll.
    el.style.cssText = 'flex:1;min-height:0;overflow-y:auto;overscroll-behavior-y:contain;padding:1rem';
    el.innerHTML = (preview || '') + metaBlock;
  }

  if (isText) _uplFetchTextPreview(fUrl);
  if (isDocx) _uplFetchDocxPreview(f);
  if (isPdf)  _uplFetchPdfCanvas(fUrl);
  _uplLoadTags(f.src, f.id);
  if (typeof _uplDocStudioInit === 'function') _uplDocStudioInit(f);
  if (typeof _uplRenderDetailCatalogs === 'function' && f.src === 'page') {
    _uplRenderDetailCatalogs(f);
  }
  // Async: render grid connections panel if the file has any grid: tags
  if (f.src === 'page' && (f.tags || []).some(function(t) { return t.startsWith('grid:'); })) {
    _uplRenderGridConnections(f);
  }
}

// ── Grid connections section in file detail panel ────────────────────────────────
// Renders async so page names are fetched without blocking the detail paint.
async function _uplRenderGridConnections(f) {
  var slot = document.getElementById('upl-grid-connections');
  if (!slot) return;

  var gridTags = (f.tags || []).filter(function(t) { return t.startsWith('grid:'); });
  if (!gridTags.length) { slot.remove(); return; }

  // Fetch page names for each connection in parallel
  var pages = await Promise.all(gridTags.map(async function(tag) {
    var pid = parseInt(tag.split(':')[1], 10);
    try {
      var r = await fetch('/home/pages/' + pid + '/meta');
      if (!r.ok) return { pid: pid, name: 'Grid page #' + pid, emoji: '\uD83D\uDDBC\uFE0F' };
      var m = await r.json();
      return { pid: pid, name: m.name || ('Grid page #' + pid), emoji: m.emoji || '\uD83D\uDDBC\uFE0F' };
    } catch(_) {
      return { pid: pid, name: 'Grid page #' + pid, emoji: '\uD83D\uDDBC\uFE0F' };
    }
  }));

  var rows = pages.map(function(p) {
    // Open the grid page using the SPA router (avoids bare-HTML fragment response)
    var openFn = 'typeof openHomePage===\'function\'?openHomePage(' + p.pid + '):window.location.assign(\'/home/pages/' + p.pid + '\')';
    var gotoBtn = '<button onclick="' + openFn + '"'
      + ' class="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg'
      + ' bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
      + ' text-xs font-medium hover:bg-green-100 dark:hover:bg-green-900/40 transition">'
      + '&#128248;\u00a0' + _uplEsc(p.emoji) + '\u00a0' + _uplEsc(p.name) + ' \u2192</button>';
    var discBtn = '<button'
      + ' onclick="_uplGridDisconnect(' + f.id + ',' + p.pid + ')"'
      + ' title="Disconnect from ' + _uplEsc(p.name) + '"'
      + ' class="flex-shrink-0 px-2 py-1.5 rounded-lg text-xs'
      + ' border border-red-200 dark:border-red-900'
      + ' text-red-500 dark:text-red-400'
      + ' hover:bg-red-50 dark:hover:bg-red-950/40 transition"'
      + '>&#10006;</button>';
    return '<div class="flex items-center gap-1 mb-1.5">' + gotoBtn + discBtn + '</div>';
  }).join('');

  slot.innerHTML =
    '<p class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-zinc-500 mb-1">'
    + '&#128248; Grid Connections</p>'
    + rows;
}

// ── Disconnect an upload from a grid page (called from Grid Connections panel) ─
async function _uplGridDisconnect(uploadId, pageId) {
  try {
    const r = await fetch('/home/grid/' + pageId + '/disconnect/' + uploadId, { method: 'DELETE' });
    if (!r.ok) { _uplShowToast('Could not disconnect from grid.', true); return; }
    // Remove the grid:XX tag from the in-memory file record so the UI updates
    // immediately without needing a full re-fetch.
    const tagKey = 'grid:' + pageId;
    const f = _uplFiles.find(function(x) { return x.src === 'page' && x.id === uploadId; });
    if (f && Array.isArray(f.tags)) f.tags = f.tags.filter(function(t) { return t !== tagKey; });
    // Re-render detail panel and cards
    if (_uplCurrentDetail && _uplCurrentDetail.id === uploadId) {
      _uplCurrentDetail = f || _uplCurrentDetail;
      _uplRenderDetail(_uplCurrentDetail);
    }
    _uplRender();
    _uplShowToast('Disconnected from grid.');
  } catch (e) {
    _uplShowToast('Could not disconnect: ' + e.message, true);
  }
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
  // Mobile: now that the drop zone is visible, add the "Take photo" button.
  // Scan document (the file input lives just outside the backdrop).
  if (typeof window.bwCameraScan === 'function') window.bwCameraScan();
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

// ── Remove from folder ─────────────────────────────────────────────────────────────────
async function _uplRemoveFromFolder(uploadId) {
  if (!_uplPid) return;
  try {
    const r = await fetch(`/home/uploads/${_uplPid}/files/page/${uploadId}/folder`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: null }),
    });
    if (!r.ok) throw new Error(r.status);
    _uplShowToast('\u2713 Removed from folder.', false);
    _uplCloseDetail();
    _uplFetch(1);
  } catch (e) {
    _uplShowToast('Could not remove from folder.', true);
    console.error('[uploads] remove-from-folder error', e);
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────────────────────
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

/* ── Image lightbox (full-size overlay) ─────────────────────────────────────── */

function _uplOpenLightbox(src, altText) {
    // Reuse existing overlay if already mounted
    var overlay = document.getElementById('upl-lightbox');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'upl-lightbox';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Full size image');
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:9999',
            'background:rgba(0,0,0,.88)', 'display:flex',
            'align-items:center', 'justify-content:center',
            'cursor:zoom-out', 'padding:1rem'
        ].join(';');
        document.body.appendChild(overlay);
    }
    overlay.innerHTML =
        '<img src="' + src + '" alt="' + _uplEsc(altText) + '"'
        + ' style="max-width:100%;max-height:100%;object-fit:contain;'
        + 'border-radius:.5rem;box-shadow:0 8px 40px rgba(0,0,0,.6)">';
    overlay.style.display = 'flex';
    // Close on backdrop click or Escape
    overlay.onclick = function() {
        overlay.style.display = 'none';
        document.removeEventListener('keydown', overlay._kh);
    };
    if (overlay._kh) document.removeEventListener('keydown', overlay._kh);
    overlay._kh = function(e) {
        if (e.key === 'Escape') {
            overlay.style.display = 'none';
            document.removeEventListener('keydown', overlay._kh);
        }
    };
    document.addEventListener('keydown', overlay._kh);
}

/* ── Widget-usage badges: which File Review widgets pin each file ─────────────────── */

async function _uplFetchWidgetUsage() {
    // Collect all page-source file IDs currently visible (placeholders already in DOM)
    var spans = document.querySelectorAll('[data-upl-widget-badge]');
    if (!spans.length) return;

    var ids = [];
    spans.forEach(function(s) { if (s.dataset.uplWidgetBadge) ids.push(s.dataset.uplWidgetBadge); });
    if (!ids.length) return;

    try {
        var r = await fetch('/home/uploads/file-widget-usage?ids=' + ids.join(','),
            { credentials: 'same-origin' });
        if (!r.ok) return;
        _uplWidgetUsageMap = await r.json();
    } catch (_) { return; }

    // Inject badges into the placeholder spans now that we have the data
    _uplInjectWidgetBadges();
}

function _uplInjectWidgetBadges() {
    document.querySelectorAll('[data-upl-widget-badge]').forEach(function(span) {
        var fid  = span.dataset.uplWidgetBadge;
        var wgts = _uplWidgetUsageMap[fid];
        if (!wgts || !wgts.length) return;

        var label = wgts.length === 1
            ? wgts[0].widget_name
            : wgts.length + '\u00a0widgets';

        // Build with DOM — no string-in-string escaping at all
        var btn = document.createElement('button');
        btn.textContent = '\uD83D\uDDBC\uFE0F ' + label + ' \u25BE';
        btn.title = 'Pinned to a File Review widget';
        btn.setAttribute('aria-haspopup', 'true');
        btn.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] rounded'
            + ' font-semibold bg-purple-50 text-purple-700 dark:bg-purple-900/40'
            + ' dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/60'
            + ' transition-colors cursor-pointer';
        (function(fileId) {
            btn.onclick = function(e) {
                e.stopPropagation();
                _uplWidgetBadgeClick(_uplWidgetUsageMap[fileId], btn);
            };
        })(fid);

        span.innerHTML = '';
        span.appendChild(btn);
    });
}

async function _uplWidgetBadgeClick(widgets, btnEl) {
    // Close any existing popover (toggle if same button)
    var old = document.getElementById('upl-widget-popover');
    if (old) {
        var wasSame = old._btnEl === btnEl;
        old.remove();
        if (wasSame) return;
    }

    var pop = document.createElement('div');
    pop.id = 'upl-widget-popover';
    pop._btnEl = btnEl;
    pop.style.cssText = [
        'position:fixed', 'z-index:9999',
        'background:white', 'border:1px solid #e5e7eb',
        'border-radius:.5rem', 'box-shadow:0 4px 20px rgba(0,0,0,.15)',
        'padding:.75rem 1rem', 'min-width:200px', 'max-width:280px',
        'font-size:.75rem', 'color:#374151'
    ].join(';');

    // Position below the badge button (fixed coords, scroll-proof)
    var rect = btnEl.getBoundingClientRect();
    pop.style.top  = (rect.bottom + 4) + 'px';
    pop.style.left = Math.min(rect.left, window.innerWidth - 290) + 'px';
    document.body.appendChild(pop);

    // Build content directly from the already-fetched widget data
    if (widgets.length === 1) {
        var w = widgets[0];
        pop.innerHTML =
            '<p style="font-weight:600;margin-bottom:.25rem">\uD83D\uDDBC\uFE0F '
            + _uplEsc(w.widget_name) + '</p>'
            + '<p style="color:#6b7280;font-size:.65rem;margin-bottom:.55rem">'
            + _uplEsc((w.page_emoji ? w.page_emoji + '\u00a0' : '') + w.page_name)
            + '</p>'
            + '<button id="upl-widget-pop-goto" style="background:#0053e2;color:white;'
            + 'border:none;border-radius:.35rem;padding:.3rem .75rem;'
            + 'font-size:.72rem;cursor:pointer;width:100%">'
            + 'Go to page &rarr;</button>';
        var goBtn = pop.querySelector('#upl-widget-pop-goto');
        if (goBtn) {
            goBtn.onclick = function() {
                pop.remove();
                if (typeof showHomePage === 'function') showHomePage(w.page_id);
            };
        }
    } else {
        // Multiple widgets — build with DOM APIs to avoid innerHTML quote-escaping hell
        var hdr = document.createElement('p');
        hdr.style.cssText = 'font-weight:600;margin-bottom:.45rem';
        hdr.textContent = '\uD83D\uDDBC\uFE0F ' + widgets.length + ' File Review widgets';
        pop.appendChild(hdr);

        var ul = document.createElement('ul');
        ul.style.cssText = 'list-style:none;margin:0;padding:0';

        widgets.forEach(function(w) {
            var li = document.createElement('li');
            li.style.cssText = 'padding:.3rem 0;border-bottom:1px solid #f3f4f6;'
                + 'display:flex;align-items:center;justify-content:space-between';

            var lbl = document.createElement('span');
            lbl.innerHTML = _uplEsc((w.page_emoji ? w.page_emoji + '\u00a0' : '') + w.page_name)
                + '<br><span style="font-size:.65rem;color:#6b7280">'
                + _uplEsc(w.widget_name) + '</span>';

            var btn = document.createElement('button');
            btn.textContent = 'Go \u2192';
            btn.style.cssText = 'background:#0053e2;color:white;border:none;'
                + 'border-radius:.3rem;padding:.2rem .5rem;font-size:.65rem;'
                + 'cursor:pointer;flex-shrink:0;margin-left:.5rem';
            (function(pageId) {
                btn.onclick = function(e) {
                    e.stopPropagation();
                    var _p = document.getElementById('upl-widget-popover');
                    if (_p) _p.remove();
                    if (window.showHomePage) window.showHomePage(pageId);
                };
            })(w.page_id);

            li.appendChild(lbl);
            li.appendChild(btn);
            ul.appendChild(li);
        });

        pop.appendChild(ul);
    }

    // Close on outside click
    var outside = function(e) {
        if (!pop.contains(e.target) && e.target !== btnEl) {
            pop.remove();
            document.removeEventListener('click', outside);
        }
    };
    setTimeout(function() { document.addEventListener('click', outside); }, 0);
}

/* ── Grid-badge popover: click → show grid page name + Go-to link ─────────────────── */

async function _uplGridBadgeClick(gridPageId, btnEl) {
    // Close any existing popover
    var old = document.getElementById('upl-grid-popover');
    if (old) { old.remove(); if (old._pid === gridPageId) return; }  // toggle

    var pop = document.createElement('div');
    pop.id = 'upl-grid-popover';
    pop._pid = gridPageId;
    pop.style.cssText = [
        'position:absolute', 'z-index:200',
        'background:white', 'border:1px solid #e5e7eb',
        'border-radius:.5rem', 'box-shadow:0 4px 20px rgba(0,0,0,.12)',
        'padding:.75rem 1rem', 'min-width:180px', 'max-width:260px',
        'font-size:.75rem', 'color:#374151'
    ].join(';');
    pop.innerHTML = '<p style="color:#9ca3af;font-size:.65rem;margin-bottom:.35rem">Loading…</p>';

    // Position below the badge button
    var rect = btnEl.getBoundingClientRect();
    pop.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (rect.left  + window.scrollX)     + 'px';
    document.body.appendChild(pop);

    // Close on outside click
    var outside = function(e) {
        if (!pop.contains(e.target) && e.target !== btnEl) {
            pop.remove();
            document.removeEventListener('click', outside);
        }
    };
    setTimeout(function() { document.addEventListener('click', outside); }, 0);

    try {
        var r = await fetch('/home/pages/' + gridPageId + '/meta');
        if (!r.ok) {
            var detail = '';
            try { var body = await r.json(); detail = body.error || ''; } catch(_) {}
            throw new Error('HTTP ' + r.status + (detail ? ': ' + detail : ''));
        }
        var ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
            // Auth redirect returned HTML — session expired
            throw new Error('Not JSON (session may have expired — try refreshing)');
        }
        var meta = await r.json();
        pop.innerHTML =
            '<p style="font-weight:600;margin-bottom:.4rem">'
            + _uplEsc(meta.emoji) + '\u00a0' + _uplEsc(meta.name) + '</p>'
            + '<p style="color:#6b7280;font-size:.65rem;margin-bottom:.6rem">Grid page</p>'
            + '<button id="upl-grid-pop-goto"'
            + ' style="background:#0053e2;color:white;border:none;border-radius:.35rem;'
            + 'padding:.3rem .75rem;font-size:.72rem;cursor:pointer;width:100%">'
            + 'Go to Grid page &rarr;</button>';
        var goBtn = pop.querySelector('#upl-grid-pop-goto');
        if (goBtn) {
            goBtn.addEventListener('click', function() {
                pop.remove();
                if (typeof showHomePage === 'function') showHomePage(gridPageId);
            });
        }
    } catch(e) {
        pop.innerHTML = '<p style="color:#ef4444;font-size:.7rem">'
            + _uplEsc(e.message || 'Could not load page info.') + '</p>';
    }
}
