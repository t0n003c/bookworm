/* home-page-uploads.js — Uploads Homespace page (BookWorm).
   Manages: file listing, type filter tabs, pagination, standalone upload, download.
   Server APIs:
     GET  /home/uploads/{pid}/files?page=N    → {files, total, page, pages}
     POST /home/uploads/{pid}/upload          → {ok: true}
     GET  /home/uploads/{pid}/files/note/{id}/download
     GET  /home/uploads/{pid}/files/page/{id}/download
*/
'use strict';

// ── Module state ──────────────────────────────────────────────────────────────
let _uplPid    = 0;
let _uplFiles  = [];      // current page's file list
let _uplMeta   = {};      // {total, page, pages} from last fetch
let _uplFilter = 'all';   // 'all' | 'image' | 'video' | 'audio' | 'document' | 'other'
let _uplBusy   = false;   // upload in progress

// ── Entry point ───────────────────────────────────────────────────────────────
async function initUploadsPage(pid) {
  _uplPid    = pid;
  _uplFiles  = [];
  _uplMeta   = {};
  _uplFilter = 'all';
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

    // Session-expiry guard — auth middleware returns 302 → HTML, not JSON
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      main.innerHTML = '<div class="p-6 text-sm text-yellow-600 dark:text-yellow-400 '
        + 'text-center mt-8">⏰ Session expired — please refresh the page.</div>';
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const data = await r.json();
    _uplFiles  = data.files  || [];
    _uplMeta   = { total: data.total || 0, page: data.page || 1, pages: data.pages || 1 };
  } catch (e) {
    if (main) {
      main.innerHTML = '<div class="p-6 text-sm text-red-500 text-center mt-8">'
        + '\u26a0\ufe0f Could not load files. ' + _uplEsc(e.message) + '</div>';
    }
    return;
  }

  _uplRenderFilterTabs();
  _uplRender();
}

// ── MIME group helper ─────────────────────────────────────────────────────────
function _uplMimeGroup(mimeType) {
  if (!mimeType) return 'other';
  if (mimeType.startsWith('image/'))  return 'image';
  if (mimeType.startsWith('video/'))  return 'video';
  if (mimeType.startsWith('audio/'))  return 'audio';
  if (mimeType.startsWith('text/')
   || mimeType.startsWith('application/')) return 'document';
  return 'other';
}

const _UPL_TAB_META = {
  all:      { label: 'All',       emoji: '' },
  image:    { label: 'Photos',    emoji: '🖼️' },
  video:    { label: 'Videos',    emoji: '🎬' },
  audio:    { label: 'Audio',     emoji: '🎵' },
  document: { label: 'Documents', emoji: '📄' },
  other:    { label: 'Other',     emoji: '📎' },
};

// ── Render filter tabs ────────────────────────────────────────────────────────
function _uplRenderFilterTabs() {
  const tabs = document.getElementById('uploads-filter-tabs');
  const stats = document.getElementById('uploads-stats');
  if (!tabs) return;

  // Count files per group from current page
  const counts = { all: _uplFiles.length };
  _uplFiles.forEach(f => {
    const g = _uplMimeGroup(f.mime_type);
    counts[g] = (counts[g] || 0) + 1;
  });

  const base = 'flex-shrink-0 text-xs font-semibold px-3 py-1 rounded-full '
    + 'border transition cursor-pointer select-none';
  const active = 'bg-[#0053e2] text-white border-[#0053e2]';
  const idle   = 'border-gray-300 dark:border-zinc-600 text-gray-600 '
    + 'dark:text-zinc-300 hover:border-[#0053e2] hover:text-[#0053e2]';

  tabs.innerHTML = Object.entries(_UPL_TAB_META)
    .filter(([key]) => key === 'all' || (counts[key] || 0) > 0)
    .map(([key, meta]) => {
      const count = counts[key] || 0;
      const on    = (_uplFilter === key);
      const label = (meta.emoji ? meta.emoji + ' ' : '') + meta.label
        + (key === 'all' ? '' : ` (${count})`);
      return `<button class="${base} ${on ? active : idle}"
                      onclick="_uplSetFilter('${key}')">${label}</button>`;
    }).join('');

  // Stats bar
  if (stats) {
    const { total, page, pages } = _uplMeta;
    stats.textContent = total
      ? `${total} file${total !== 1 ? 's' : ''} \u00b7 page ${page}/${pages}`
      : '';
  }
}

// ── Render file grid ──────────────────────────────────────────────────────────
function _uplRender() {
  const main = document.getElementById('uploads-main');
  if (!main) return;

  const visible = _uplFilter === 'all'
    ? _uplFiles
    : _uplFiles.filter(f => _uplMimeGroup(f.mime_type) === _uplFilter);

  if (!_uplFiles.length) {
    main.innerHTML = `
      <div class="text-center mt-16 text-gray-400 dark:text-zinc-500 select-none">
        <p class="text-4xl mb-3">🖼️</p>
        <p class="text-sm font-medium">No files yet</p>
        <p class="text-xs mt-1 max-w-xs mx-auto">
          Attachments you add to notes — or files you upload here directly — will appear here.
        </p>
      </div>`;
    return;
  }

  if (!visible.length) {
    main.innerHTML = '<div class="text-center mt-12 text-gray-400 dark:text-zinc-500 '
      + 'text-sm select-none">No files in this category on this page.</div>';
    _uplRenderPager();
    return;
  }

  const cards = visible.map(f => _uplCard(f)).join('');
  main.innerHTML = `
    <div class="grid gap-3"
         style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
      ${cards}
    </div>`;

  _uplRenderPager();
}

// ── Single file card ──────────────────────────────────────────────────────────
function _uplCard(f) {
  const group    = _uplMimeGroup(f.mime_type);
  const isImage  = group === 'image';
  const dlUrl    = `/home/uploads/${_uplPid}/files/${f.src}/${f.id}/download`;
  const srcBadge = f.src === 'note'
    ? `<span title="Attached to note: ${_uplEsc(f.note_title || '')}"
             class="truncate text-[9px] text-gray-400 dark:text-zinc-500">
         📝 ${_uplEsc(f.note_title || 'Note')}
       </span>`
    : `<span class="text-[9px] text-blue-400 dark:text-blue-500">📤 Standalone</span>`;

  const mimeEmoji = { image: '🖼️', video: '🎬', audio: '🎵', document: '📄', other: '📎' }[group] || '📎';

  const thumb = isImage
    ? `<img src="/uploads/${_uplEsc(f.filename)}" alt="${_uplEsc(f.original_name)}"
            loading="lazy"
            class="w-full h-32 object-cover bg-gray-100 dark:bg-zinc-800"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      + `<div class="w-full h-32 hidden items-center justify-center text-4xl
                     bg-gray-100 dark:bg-zinc-800 text-gray-300">${mimeEmoji}</div>`
    : `<div class="w-full h-32 flex items-center justify-center text-5xl
                   bg-gray-100 dark:bg-zinc-800 text-gray-300">${mimeEmoji}</div>`;

  return `
    <div class="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200
                dark:border-zinc-800 overflow-hidden shadow-sm
                hover:shadow-md hover:border-[#0053e2] dark:hover:border-blue-500 transition group">
      <div class="overflow-hidden">${thumb}</div>
      <div class="p-2.5">
        <p class="text-xs font-semibold text-gray-800 dark:text-zinc-100
                  truncate group-hover:text-[#0053e2] transition"
           title="${_uplEsc(f.original_name)}">${_uplEsc(f.original_name)}</p>
        <p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">
          ${_uplFmtSize(f.size)} &middot; ${_uplFmtDate(f.created_at)}
        </p>
        <div class="flex items-center justify-between mt-1.5 gap-1">
          ${srcBadge}
          <a href="${dlUrl}" download="${_uplEsc(f.original_name)}"
             class="text-[10px] px-2 py-0.5 rounded border border-gray-200
                    dark:border-zinc-700 text-gray-500 dark:text-zinc-400
                    hover:border-[#0053e2] hover:text-[#0053e2] transition flex-shrink-0"
             title="Download">↓</a>
        </div>
      </div>
    </div>`;
}

// ── Pagination controls ───────────────────────────────────────────────────────
function _uplRenderPager() {
  const { page, pages } = _uplMeta;
  if (pages <= 1) return;

  const main = document.getElementById('uploads-main');
  if (!main) return;

  const pager = document.createElement('div');
  pager.className = 'flex items-center justify-center gap-3 mt-6 pb-4';
  pager.innerHTML = `
    <button onclick="_uplLoadPage(${page - 1})"
            ${page <= 1 ? 'disabled' : ''}
            class="px-3 py-1.5 text-xs border rounded-lg
                   border-gray-300 dark:border-zinc-600
                   text-gray-600 dark:text-zinc-300
                   hover:border-[#0053e2] hover:text-[#0053e2]
                   disabled:opacity-40 disabled:cursor-not-allowed transition">
      ← Prev
    </button>
    <span class="text-xs text-gray-400 dark:text-zinc-500">
      Page ${page} of ${pages}
    </span>
    <button onclick="_uplLoadPage(${page + 1})"
            ${page >= pages ? 'disabled' : ''}
            class="px-3 py-1.5 text-xs border rounded-lg
                   border-gray-300 dark:border-zinc-600
                   text-gray-600 dark:text-zinc-300
                   hover:border-[#0053e2] hover:text-[#0053e2]
                   disabled:opacity-40 disabled:cursor-not-allowed transition">
      Next →
    </button>`;
  main.appendChild(pager);
}

async function _uplLoadPage(p) {
  const { pages } = _uplMeta;
  if (p < 1 || p > pages) return;
  await _uplFetch(p);
}

// ── Filter tab click ──────────────────────────────────────────────────────────
function _uplSetFilter(f) {
  _uplFilter = f;
  _uplRenderFilterTabs();
  _uplRender();
}

// ── File upload ───────────────────────────────────────────────────────────────
async function uplHandleFileInput(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  // Reset input so same file can be re-selected
  event.target.value = '';

  const label = document.getElementById('uploads-drop-label');
  if (_uplBusy) return;
  _uplBusy = true;
  if (label) label.textContent = `Uploading ${files.length} file${files.length !== 1 ? 's' : ''}…`;

  let failed = 0;
  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch(`/home/uploads/${_uplPid}/upload`, { method: 'POST', body: fd });
      if (!r.ok) failed++;
    } catch { failed++; }
  }

  _uplBusy = false;
  if (label) {
    label.innerHTML = `
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"
           stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1 M16 10l-4-4m0 0L8 10m4-4v12"/>
      </svg>
      Upload
      <input id="uploads-file-input" type="file" multiple class="sr-only"
             onchange="uplHandleFileInput(event)" />`;
  }

  if (failed) {
    _uplShowToast(`${failed} file${failed !== 1 ? 's' : ''} failed to upload.`, true);
  }
  // Reload first page to show newly uploaded files
  await _uplFetch(1);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function _uplShowToast(msg, isErr) {
  const wrap = document.getElementById('rem-fun-popup-wrap');
  if (!wrap) return;
  const card = document.createElement('div');
  card.className = 'pointer-events-auto w-72 overflow-hidden rounded-xl shadow-lg '
    + 'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700';
  card.style.cssText = 'border-left:3px solid ' + (isErr ? '#ea1100' : '#2a8703') + ';';
  card.innerHTML = `<div class="px-4 py-3 text-sm text-gray-700 dark:text-zinc-200">${_uplEsc(msg)}</div>`;
  wrap.appendChild(card);
  setTimeout(() => card.remove(), 4000);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function _uplEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _uplFmtSize(bytes) {
  if (bytes < 1024)           return `${bytes} B`;
  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3)      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function _uplFmtDate(s) {
  if (!s) return '';
  try {
    return new Date(s.replace(' ', 'T') + (s.includes('T') ? '' : 'Z'))
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s.slice(0, 10); }
}
