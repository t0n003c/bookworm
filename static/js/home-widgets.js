/* home-widgets.js — BookWorm personal pages — core navigation & widget CRUD.
   Rendering engines are split across:
     home-widgets-clock.js    — clock engine
     home-widgets-render.js   — weather, calendar, countdown, timer, todo, reminder
     home-widgets-settings.js — widget settings modal, size picker, page layout
*/
'use strict';

// ── Utilities ────────────────────────────────────────────────────────────────
const _post = (url, body = {}) =>
  fetch(url, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

/**
 * _bwToast(msg, type, dur)
 * Shared BookWorm toast — lower-right corner, slide-up animation, auto-dismiss.
 * type: 'success' | 'error' | 'info'    dur: ms (default 6000)
 * Exposed globally so all page modules (RSS, Uploads, CRM …) share one impl.
 */
window._bwToast = function _bwToast(msg, type, dur) {
  const isErr  = type === 'error';
  const isInfo = type === 'info';
  dur = dur || 6000;

  const wrap = document.getElementById('rem-fun-popup-wrap');
  if (!wrap) return;

  const borderColor = isErr ? '#ea1100' : isInfo ? '#0053e2' : '#2a8703';
  const titleColor  = isErr
    ? 'text-red-600 dark:text-red-400'
    : isInfo ? 'text-[#0053e2]'
    : 'text-green-600 dark:text-green-400';
  const titleText   = isErr ? 'Error' : isInfo ? 'Info' : 'Saved';
  const icon        = isErr ? '⚠️' : isInfo ? 'ℹ️' : '✅';

  const card = document.createElement('div');
  card.className = 'pointer-events-auto w-72 overflow-hidden rounded-xl shadow-lg'
    + ' bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700'
    + ' animate-[bw-slideup_.3s_cubic-bezier(.17,.67,.38,1.3)_both]';
  card.style.cssText = 'border-left:3px solid ' + borderColor + ';';

  // Build structure; set message via textContent to avoid XSS
  card.innerHTML =
    '<div class="flex items-start gap-3 px-4 pt-3 pb-2">'
    + '<span class="flex-shrink-0 mt-0.5 text-xl" aria-hidden="true">' + icon + '</span>'
    + '<div class="flex-1 min-w-0">'
    + '<p class="text-[11px] font-bold uppercase tracking-wider mb-0.5 ' + titleColor + '">' + titleText + '</p>'
    + '<p class="text-sm text-gray-800 dark:text-zinc-100 leading-snug bw-toast-msg"></p>'
    + '</div>'
    + '<button data-bw-close aria-label="Dismiss" class="flex-shrink-0 -mt-0.5 -mr-1 p-1 rounded'
    + ' text-gray-300 hover:text-gray-600 dark:hover:text-zinc-300 transition">'
    + '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">'
    + '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'
    + '</button></div>'
    + '<div class="h-0.5 bg-gray-100 dark:bg-zinc-800 mx-4 mb-2 rounded-full overflow-hidden">'
    + '<div data-bw-bar class="h-full rounded-full" style="width:100%;background:' + borderColor + '"></div></div>';

  // Set message text safely (no XSS)
  card.querySelector('.bw-toast-msg').textContent = msg;

  const dismiss = function() {
    card.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    card.style.opacity    = '0';
    card.style.transform  = 'translateX(1rem)';
    setTimeout(function() { card.remove(); }, 350);
  };
  const tid = setTimeout(dismiss, dur);
  card.querySelector('[data-bw-close]').addEventListener('click', function() {
    clearTimeout(tid); dismiss();
  });
  wrap.appendChild(card);

  // Animate the progress bar shrinking (double-rAF so transition kicks in after paint)
  requestAnimationFrame(function() { requestAnimationFrame(function() {
    const bar = card.querySelector('[data-bw-bar]');
    bar.style.transition = 'width ' + dur + 'ms linear';
    bar.style.width = '0%';
  }); });
};

// ── Navigation ───────────────────────────────────────────────────────────────
function _showHomeCanvas() {
  console.log('[home] _showHomeCanvas start');
  // ① Unmount the timeline overlay if active — it sits at z-index:10 inside
  //    #main-content with position:absolute+inset:0 and would completely cover
  //    the home canvas. This is the #1 cause of "nothing visible" on home pages.
  try {
    if (typeof bwTimeline !== 'undefined' && bwTimeline.isMounted()) {
      bwTimeline.unmount();
      localStorage.setItem('bw-list-view', 'grid');
      // Sync the toggle icon so it correctly shows "switch to timeline"
      if (typeof syncListViewIcon === 'function') syncListViewIcon();
    }
  } catch (_) {}

  // ② Close the note detail panel if it is open (fullscreen, side, or center
  //    mode would all occlude the home canvas).
  try { if (typeof closePanel === 'function') closePanel(); } catch (_) {}

  const hc   = document.getElementById('home-content');
  const main = document.getElementById('main-content');
  const nl   = document.getElementById('note-list');
  const bc   = document.getElementById('ws-breadcrumb');
  if (nl)   nl.classList.add('hidden');
  if (bc)   bc.classList.add('hidden');
  // Zero the parent's padding so home-content fills edge-to-edge
  // (same technique the timeline overlay uses — no negative-margin hacks).
  if (main) {
    main.style.paddingTop    = '0';
    main.style.paddingBottom = '0';
    main.style.paddingLeft   = '0';
    main.style.paddingRight  = '0';
    // ② Reset scroll so the canvas is never below the viewport fold.
    main.scrollTop = 0;
  }
  if (hc) {
    hc.classList.remove('hidden');
    // Force display explicitly — belt + suspenders against any CSS specificity race
    // (e.g. Tailwind CDN JIT recalculation or the bw-hp-restore override lingering).
    hc.style.display    = 'block';
    hc.style.visibility = 'visible';
    hc.style.minHeight  = 'calc(100vh - 4rem)';
  }
  console.log('[home] _showHomeCanvas done. hc hidden?', hc?.classList.contains('hidden'), '| nl hidden?', nl?.classList.contains('hidden'));
}

function homeExit() {
  _setTopActionNewNote();  // restore nav button
  // Clear the home-page session so a subsequent F5 lands on the workspace.
  sessionStorage.removeItem('bw-hp');
  document.documentElement.classList.remove('bw-hp-restore');
  // Restore view-toggle buttons for normal workspace views.
  const _tl = document.getElementById('list-view-toggle');
  if (_tl) _tl.style.display = '';
  const _gl = document.getElementById('gallery-view-btn');
  if (_gl) _gl.style.display = '';
  const hc   = document.getElementById('home-content');
  const main = document.getElementById('main-content');
  const nl   = document.getElementById('note-list');
  const bc   = document.getElementById('ws-breadcrumb');
  if (hc) {
    hc.classList.add('hidden');
    hc.style.display    = '';
    hc.style.visibility = '';
    hc.style.minHeight  = '';
  }
  // Restore padding so the workspace note list looks right again.
  if (main) {
    main.style.paddingTop    = '';
    main.style.paddingBottom = '';
    main.style.paddingLeft   = '';
    main.style.paddingRight  = '';
  }
  if (nl) nl.classList.remove('hidden');
  if (bc) bc.classList.remove('hidden');
}

function _setHomePageActive(pageId) {
  // Update sidebar: remove active styles from all home page nav buttons,
  // then apply them to the clicked one.
  // ONLY target the first button (nav) in each li — not the edit/delete ones.
  const ACTIVE   = ['bg-wblue/10', 'dark:bg-wblue/20', 'text-wblue', 'font-semibold'];
  const INACTIVE = ['text-gray-700', 'dark:text-zinc-300', 'hover:bg-gray-100', 'dark:hover:bg-zinc-800'];
  document.querySelectorAll('#home-page-list li[data-page-id]').forEach(li => {
    // The nav button is the FIRST button in the li
    const btn = li.querySelector('button:first-of-type');
    if (!btn) return;
    const liId = parseInt(li.dataset.pageId, 10);
    if (liId === pageId) {
      btn.classList.remove(...INACTIVE);
      btn.classList.add(...ACTIVE);
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.classList.remove(...ACTIVE);
      btn.classList.add(...INACTIVE);
      btn.setAttribute('aria-current', 'false');
    }
  });
}

// ── Home-page in-memory cache (stale-while-revalidate) ──────────────────────────────
// Switching to a previously-visited page is now instant (cache hit);
// stale entries are silently revalidated in the background.
const _hpCache  = new Map();  // pageId → { html: string, ts: number }
const _hpFlight = new Set();  // pageIds currently being fetched
const _hpMutVer = new Map();  // pageId → mutation counter (incremented on invalidation)
const _HP_TTL   = 5 * 60_000; // 5 min stale threshold

function _hpFetch(pageId, { silent = false, onDone = null } = {}) {
  if (_hpFlight.has(pageId)) return;
  _hpFlight.add(pageId);
  // Snapshot mutation version so we can detect if a save happened mid-flight.
  const verAtStart = _hpMutVer.get(pageId) ?? 0;
  fetch(`/home/pages/${pageId}`, { credentials: 'same-origin' })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
    .then(html => {
      _hpFlight.delete(pageId);
      // ── Stale-flight guard ────────────────────────────────────────────────────
      // If the page was mutated (event/widget saved) while this fetch was in
      // flight, the response is stale.  Drop it and kick off a fresh fetch so
      // the user always sees up-to-date content.
      const verNow = _hpMutVer.get(pageId) ?? 0;
      if (verNow !== verAtStart) {
        console.log(`[home] stale flight for page ${pageId} (ver ${verAtStart}→${verNow}), refetching`);
        _hpFetch(pageId, { silent, onDone });
        return;
      }
      _hpCache.set(pageId, { html, ts: Date.now() });
      if (onDone) onDone(html);
      else if (silent) {
        // Background revalidation — patch DOM only if page is still open
        const cur = Number(sessionStorage.getItem('bw-hp'));
        if (cur === pageId) {
          const hc = document.getElementById('home-content');
          if (hc) { hc.innerHTML = html; _initSwappedPage(); }
        }
      }
    })
    .catch(err => { _hpFlight.delete(pageId); console.warn('[home] page fetch failed:', err); });
}

/** Pre-warm cache on sidebar tab hover — called from inline onmouseenter. */
window.prefetchHomePage = function (pageId) {
  if (!_hpCache.has(pageId) && !_hpFlight.has(pageId)) _hpFetch(pageId, { silent: true });
};

/** Drop a page from cache after a widget mutation so next visit is always fresh.
 *  Also bumps the mutation version counter so any in-flight background
 *  revalidation fetch knows its response is now stale and must be discarded.
 */
window.invalidateHomePageCache = function (pageId) {
  _hpCache.delete(pageId);
  _hpMutVer.set(pageId, (_hpMutVer.get(pageId) ?? 0) + 1);
  console.log(`[home] cache invalidated for page ${pageId}, mutVer=${_hpMutVer.get(pageId)}`);
};

function showHomePage(pageId) {
  console.log('[home] showHomePage', pageId);
  _setTopActionAddWidget(pageId);
  sessionStorage.setItem('bw-hp', String(pageId));
  _showHomeCanvas();
  document.documentElement.classList.remove('bw-hp-restore');
  const _tl = document.getElementById('list-view-toggle');
  if (_tl) _tl.style.display = 'none';
  const _gl = document.getElementById('gallery-view-btn');
  if (_gl) _gl.style.display = 'none';
  const hc = document.getElementById('home-content');
  if (!hc) return;
  _setHomePageActive(pageId);

  // ── Pre-switch sidebar tab BEFORE fetch starts so there's no visible flash ──
  // Read the target page type from the already-rendered sidebar list item.
  (function() {
    var li = document.querySelector('#home-page-list li[data-page-id="' + pageId + '"]');
    var pgType = li ? (li.dataset.pageType || 'dashboard') : 'dashboard';
    var tabFolders = document.getElementById('sb-tab-folders');
    var tabSearch  = document.getElementById('sb-tab-search');
    if (pgType === 'uploads') {
      // Show the Folders tab button immediately — enter handler will load data later
      if (tabFolders) { tabFolders.classList.remove('hidden'); tabFolders.classList.add('flex'); }
      if (tabSearch)  { tabSearch.classList.add('hidden'); }
      if (typeof switchSidebarTab === 'function') switchSidebarTab('folders');
    } else {
      // Non-uploads page: restore workspaces tab and hide folders button if visible
      if (tabFolders && !tabFolders.classList.contains('hidden')) {
        tabFolders.classList.add('hidden'); tabFolders.classList.remove('flex');
        if (tabSearch) tabSearch.classList.remove('hidden');
        if (typeof switchSidebarTab === 'function') switchSidebarTab('workspaces');
      }
    }
  })();

  const _applyHtml = html => {
    hc.innerHTML = html;
    _initSwappedPage();
    requestAnimationFrame(() => { hc.style.opacity = '1'; });
  };

  const cached = _hpCache.get(pageId);
  if (cached) {
    // ── Cache HIT: instant swap, no flicker ──────────────────────────────────────────
    hc.style.opacity = '1';
    _applyHtml(cached.html);
    // Silently revalidate if stale
    if (Date.now() - cached.ts > _HP_TTL) _hpFetch(pageId, { silent: true });
    return;
  }

  // ── Cache MISS: spinner → fetch → fade in ─────────────────────────────────────
  hc.style.opacity = '0';
  hc.innerHTML = '<div class="flex items-center justify-center h-64">'
    + '<div id="bw-page-spinner" class="animate-spin rounded-full h-8 w-8 border-b-2 border-wblue"></div></div>';
  requestAnimationFrame(() => { hc.style.opacity = '1'; });

  _hpFetch(pageId, {
    onDone: html => {
      if (Number(sessionStorage.getItem('bw-hp')) !== pageId) return; // navigated away
      hc.style.opacity = '0';
      requestAnimationFrame(() => _applyHtml(html));
    },
  });
  // Also handle the error case via try/catch inside _hpFetch — propagate to UI
  // by patching a reject handler:
  const _origFlight = _hpFlight; // already added by _hpFetch call above
  // Fallback: if fetch fails _hpFetch swallows silently—re-attach a true error UI
  const _errTimer = setTimeout(() => {
    // Only show if page is still loading (spinner still in DOM)
    if (Number(sessionStorage.getItem('bw-hp')) !== pageId) return;
    if (!hc.querySelector('#bw-page-spinner')) return;
    hc.style.opacity = '0';
    hc.innerHTML = `<div class="flex flex-col items-center justify-center h-64 gap-3">
      <span class="text-4xl">😵</span>
      <p class="text-sm font-semibold text-gray-700 dark:text-zinc-300">Taking too long…</p>
      <button onclick="showHomePage(${pageId})"
        class="mt-1 px-4 py-1.5 rounded-lg bg-wblue text-white text-xs font-semibold hover:bg-blue-700 transition">
        ↺ Retry
      </button></div>`;
    requestAnimationFrame(() => { hc.style.opacity = '1'; });
  }, 10_000);
  // Clear error timer once content arrives (monkey-patch via a one-shot observer)
  const _obs = new MutationObserver(() => {
    if (!hc.querySelector('#bw-page-spinner')) { clearTimeout(_errTimer); _obs.disconnect(); }
  });
  _obs.observe(hc, { childList: true });
}

/** Alias used in sidebar template — must be on window for inline onclick handlers. */
window.openHomePage = showHomePage;

// ── Home-Page sidebar CRUD ────────────────────────────────────────────────────

/** Default emoji per page type, used when the type is first selected. */
const HP_TYPE_DEFAULTS = {
  dashboard:   { emoji: '📊', placeholder: 'e.g. My Dashboard'  },
  crm:         { emoji: '👥', placeholder: 'e.g. My Contacts'   },
  media:       { emoji: '📅', placeholder: 'e.g. Content Calendar' },
  grid:        { emoji: '🎨', placeholder: 'e.g. Team Moodboard' },
  grid_builder:{ emoji: '🎨', placeholder: 'e.g. Feed Grid'     },
  uploads:     { emoji: '🖼️', placeholder: 'e.g. Media Library' },
  rss:         { emoji: '📡', placeholder: 'e.g. My Feeds'      },
};

/**
 * Highlights the chosen type card and syncs the hidden input + emoji/placeholder.
 * Called by each type button's onclick.
 */
function selectPageType(type) {
  document.getElementById('hp-page-type').value = type;
  document.querySelectorAll('.hp-type-btn').forEach(btn => {
    const isChosen = btn.dataset.type === type;
    btn.setAttribute('aria-pressed', String(isChosen));
    btn.style.borderColor  = isChosen ? '#0053e2'   : '';
    btn.style.background   = isChosen ? '#0053e21a' : '';
  });
  // Suggest a sensible emoji only when the field is still showing the
  // previous type's default (i.e. user hasn't picked their own yet)
  const defs    = HP_TYPE_DEFAULTS[type] || HP_TYPE_DEFAULTS.dashboard;
  const emojiI  = document.getElementById('hp-emoji');
  const emojiB  = document.getElementById('hp-emoji-btn');
  const nameEl  = document.getElementById('hp-name');
  const prevDef = Object.values(HP_TYPE_DEFAULTS).map(d => d.emoji);
  if (prevDef.includes(emojiI.value)) {
    emojiI.value       = defs.emoji;
    emojiB.textContent = defs.emoji;
  }
  nameEl.placeholder = defs.placeholder;
}

function openNewHomePage() {
  const modal  = document.getElementById('hp-modal');
  const title  = document.getElementById('hp-modal-title');
  const submit = document.getElementById('hp-modal-submit');
  const action = document.getElementById('hp-modal-action');
  const nameEl = document.getElementById('hp-name');

  title.textContent      = 'New Page';
  submit.textContent     = 'Create';
  action.value           = '/home/pages/create';
  nameEl.value           = '';

  // Reset type picker to Dashboard (also resets emoji + placeholder)
  selectPageType('dashboard');

  // Hide the emoji picker — the type card already chooses a sensible emoji.
  // Users can customise the icon later via Rename.
  document.getElementById('hp-emoji-section').style.display = 'none';

  // Show type picker (hidden during rename)
  document.getElementById('hp-type-picker').style.display = '';
  modal.classList.remove('hidden');
  setTimeout(() => nameEl.focus(), 60);
}

function openRenameHomePage(pageId, name, emoji) {
  const modal  = document.getElementById('hp-modal');
  const title  = document.getElementById('hp-modal-title');
  const submit = document.getElementById('hp-modal-submit');
  const action = document.getElementById('hp-modal-action');
  const nameEl = document.getElementById('hp-name');
  const emojiI = document.getElementById('hp-emoji');
  const emojiB = document.getElementById('hp-emoji-btn');

  title.textContent  = 'Rename Page';
  submit.textContent = 'Save';
  action.value       = `/home/pages/${pageId}/rename`;
  nameEl.value       = name;
  nameEl.placeholder = 'Page name';
  emojiI.value       = emoji || '🏠';
  emojiB.textContent = emoji || '🏠';

  // Show emoji picker for rename (was hidden on new-page open)
  document.getElementById('hp-emoji-section').style.display = '';
  // Hide type picker — changing a page’s type after creation is not supported
  document.getElementById('hp-type-picker').style.display = 'none';
  modal.classList.remove('hidden');
  setTimeout(() => { nameEl.focus(); nameEl.select(); }, 60);
}

function closeHpModal() {
  document.getElementById('hp-modal').classList.add('hidden');
}

async function submitHpModal() {
  const name   = document.getElementById('hp-name').value.trim();
  if (!name) { document.getElementById('hp-name').focus(); return; }
  const emoji     = document.getElementById('hp-emoji').value || '🏠';
  const action    = document.getElementById('hp-modal-action').value;
  const page_type = document.getElementById('hp-page-type').value || 'dashboard';

  closeHpModal();
  const res  = await _post(action, { name, emoji, page_type });
  const html = await res.text();
  const sb   = document.getElementById('sb-home-pages');
  if (sb) sb.innerHTML = html;
  const newPageId = res.headers.get('X-New-Page-Id');
  if (newPageId) showHomePage(parseInt(newPageId, 10));
}

var _delPagePending = null;

function deleteHomePage(pageId, name) {
  const modal = document.getElementById('del-page-modal');
  if (!modal) { _doDeletePage(pageId); return; } // safety fallback
  _delPagePending = { pageId, name };
  document.getElementById('del-page-name').textContent = name;
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('del-page-confirm-btn')?.focus(), 50);
}
function _closeDelPageModal() {
  document.getElementById('del-page-modal')?.classList.add('hidden');
  _delPagePending = null;
}
async function _confirmDelPage() {
  const pending = _delPagePending;
  _closeDelPageModal();
  if (!pending) return;
  await _doDeletePage(pending.pageId);
}
function _doDeletePage(pageId) {
  _post(`/home/pages/${pageId}/delete`)
    .then(r => r.text())
    .then(html => {
      const sb = document.getElementById('sb-home-pages');
      if (sb) sb.innerHTML = html;
      const canvas = document.getElementById('home-canvas');
      if (canvas && +canvas.dataset.pageId === pageId) homeExit();
      _bwToast('Page moved to trash.', 'info', 4000);
      _refreshSidebarTrash();
    });
}

// ── Unified sidebar trash helpers ─────────────────────────────────────────────────

/**
 * Fetch the server-rendered trash panel and swap #sidebar-trash innerHTML.
 * Call this after any home-page delete/restore/permanent-delete operation.
 */
function _refreshSidebarTrash() {
  fetch('/home/sidebar-trash', { credentials: 'same-origin' })
    .then(function(r) { return r.ok ? r.text() : Promise.reject(r.status); })
    .then(function(html) {
      var zone = document.getElementById('sidebar-trash');
      if (zone) zone.innerHTML = html;
      // Re-run HTMX discovery so the freshly-rendered workspace buttons work
      if (window.htmx) htmx.process(document.getElementById('sidebar-trash'));
    })
    .catch(function(e) { console.warn('sidebar-trash refresh failed:', e); });
}

// ── Page drag-to-trash (targets unified #sidebar-trash outer div) ────────────────

function _pgDragStart(event, pageId) {
  event.dataTransfer.setData('application/x-bw-page', String(pageId));
  event.dataTransfer.effectAllowed = 'move';
}

function _trashDragOver(event) {
  // Only handle home-page drops — ignore workspace DnD (different data type)
  if (Array.from(event.dataTransfer.types).indexOf('application/x-bw-page') === -1) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  var zone = document.getElementById('sidebar-trash');
  if (zone) zone.style.outline = '2px dashed #ea1100';
}

function _trashDragLeave(event) {
  // Only clear highlight if leaving the #sidebar-trash entirely
  var zone = document.getElementById('sidebar-trash');
  if (!zone) return;
  var related = event.relatedTarget;
  if (!related || !zone.contains(related)) zone.style.outline = '';
}

function _trashDrop(event) {
  var raw = event.dataTransfer.getData('application/x-bw-page');
  var pageId = parseInt(raw, 10);
  if (!pageId) return;     // not a home-page drag — let workspace DnD handle it
  event.preventDefault();
  var zone = document.getElementById('sidebar-trash');
  if (zone) zone.style.outline = '';
  _doDeletePage(pageId);
}

// ── Home-page restore / permanent-delete ────────────────────────────────────

function _restoreHpPage(pageId) {
  _post('/home/pages/' + pageId + '/restore')
    .then(function(r) {
      var restoredId = r.headers.get('X-Restored-Page-Id');
      return r.text().then(function(html) { return { html: html, restoredId: restoredId }; });
    })
    .then(function(result) {
      var sb = document.getElementById('sb-home-pages');
      if (sb) sb.innerHTML = result.html;
      _refreshSidebarTrash();
      if (result.restoredId) showHomePage(parseInt(result.restoredId, 10));
      _bwToast('Page restored.', 'success', 3000);
    })
    .catch(function() { _bwToast('Restore failed.', 'error'); });
}

function _permDeleteHpPage(pageId, name) {
  if (!confirm('Permanently delete \u201c' + name + '\u201d? This cannot be undone.')) return;
  _post('/home/pages/' + pageId + '/permanent-delete')
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var zone = document.getElementById('sidebar-trash');
      if (zone) {
        zone.innerHTML = html;
        if (window.htmx) htmx.process(zone);
      }
      _bwToast('Page permanently deleted.', 'success', 3000);
    })
    .catch(function() { _bwToast('Permanent delete failed.', 'error'); });
}

function duplicateHomePage(pageId, name) {
  if (!confirm(`Duplicate page "${name}"?\n\nA copy with all its widgets will be created.`)) return;
  _post(`/home/pages/${pageId}/duplicate`)
    .then(r => {
      const newId = r.headers.get('X-New-Page-Id');
      return r.text().then(html => ({ html, newId }));
    })
    .then(({ html, newId }) => {
      const sb = document.getElementById('sb-home-pages');
      if (sb) sb.innerHTML = html;
      if (newId) showHomePage(parseInt(newId, 10));
    });
}


// -- Shared sidebar row-action popover (injected by _inject_row_menu.py) --
// _bwRowMenu(event, items)  items: [{label, icon, action, danger?, sep?}]
var _bwRowMenuEl    = null;
var _bwRowMenuClean = null;

function _bwRowMenu(event, items) {
  event.stopPropagation();
  if (_bwRowMenuEl) { _bwRowMenuEl.remove(); _bwRowMenuEl = null; }
  _bwRowMenuClose();

  var menu = document.createElement('div');
  menu.id  = 'bw-row-menu';
  menu.setAttribute('role', 'menu');
  menu.className =
    'fixed z-[9999] min-w-[172px] rounded-xl shadow-xl border py-1 ' +
    'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-700 ' +
    'text-sm';

  items.forEach(function(item) {
    if (item.sep) {
      var hr = document.createElement('div');
      hr.className = 'my-1 border-t border-gray-100 dark:border-zinc-800';
      menu.appendChild(hr);
    }
    var btn = document.createElement('button');
    btn.setAttribute('role', 'menuitem');
    btn.type = 'button';
    btn.className =
      'w-full flex items-center gap-2 px-3 py-1.5 transition text-left ' +
      (item.danger
        ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
        : 'text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800');
    btn.innerHTML = (item.icon || '') + '<span>' + item.label + '</span>';
    btn.addEventListener('click', (function(it) {
      return function() { _bwRowMenuClose(); it.action(); };
    }(item)));
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  _bwRowMenuEl = menu;

  // Position: right-align to trigger, flip up when near bottom
  var rect = event.currentTarget.getBoundingClientRect();
  var mh   = menu.offsetHeight || 160;
  var mw   = menu.offsetWidth  || 176;
  var top  = rect.bottom + 4;
  var left = Math.max(4, rect.right - mw);
  if (top + mh > window.innerHeight - 8) top = Math.max(4, rect.top - mh - 4);
  menu.style.top  = top  + 'px';
  menu.style.left = left + 'px';

  setTimeout(function() {
    document.addEventListener('mousedown',  _bwRowMenuOutside);
    document.addEventListener('touchstart', _bwRowMenuOutside);
    document.addEventListener('keydown',    _bwRowMenuKey);
  }, 0);
}

function _bwRowMenuClose() {
  if (_bwRowMenuEl) { _bwRowMenuEl.remove(); _bwRowMenuEl = null; }
  document.removeEventListener('mousedown',  _bwRowMenuOutside);
  document.removeEventListener('touchstart', _bwRowMenuOutside);
  document.removeEventListener('keydown',    _bwRowMenuKey);
}
function _bwRowMenuOutside(e) {
  if (_bwRowMenuEl && !_bwRowMenuEl.contains(e.target)) _bwRowMenuClose();
}
function _bwRowMenuKey(e) { if (e.key === 'Escape') _bwRowMenuClose(); }

// -- Home-page sidebar row menu ------------------------------------------
var _IC_HPG_RENAME = (
  '<svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" ' +
  'stroke="currentColor" stroke-width="2.5">' +
  '<path stroke-linecap="round" stroke-linejoin="round" ' +
  'd="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828' +
  'L11.828 15.828A2 2 0 0110 16H8v-2a2 2 0 01.586-1.414z"/></svg>');
var _IC_HPG_LAYOUT = (
  '<svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" ' +
  'stroke="currentColor" stroke-width="2.5">' +
  '<rect x="3" y="3" width="7" height="7" rx="1"/>' +
  '<rect x="14" y="3" width="7" height="7" rx="1"/>' +
  '<rect x="3" y="14" width="7" height="7" rx="1"/>' +
  '<rect x="14" y="14" width="7" height="7" rx="1"/></svg>');
var _IC_HPG_DUP = (
  '<svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" ' +
  'stroke="currentColor" stroke-width="2.5">' +
  '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
  '<path stroke-linecap="round" stroke-linejoin="round" ' +
  'd="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>');
var _IC_HPG_DEL = (
  '<svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" ' +
  'stroke="currentColor" stroke-width="2.5">' +
  '<path stroke-linecap="round" stroke-linejoin="round" ' +
  'd="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 ' +
  '01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 ' +
  '0 00-1 1v3M4 7h16"/></svg>');

function _hpgMenuOpen(event, id, name, emoji, type) {
  var isDash = (!type || type === 'dashboard');
  var items  = [
    { label: 'Rename', icon: _IC_HPG_RENAME,
      action: function() { openRenameHomePage(id, name, emoji); } }
  ];
  if (isDash) {
    items.push({ label: 'Layout', icon: _IC_HPG_LAYOUT,
      action: function() {
        var needNav = !document.querySelector(
          '[data-page-id="' + id + '"] [data-col-count]');
        if (needNav) {
          openHomePage(id);
          setTimeout(function() { openPageLayout(id); }, 600);
        } else {
          openPageLayout(id);
        }
      }
    });
  }
  items.push(
    { label: 'Duplicate', icon: _IC_HPG_DUP,
      action: function() { duplicateHomePage(id, name); } },
    { sep: true, label: 'Delete', icon: _IC_HPG_DEL, danger: true,
      action: function() { deleteHomePage(id, name); } }
  );
  _bwRowMenu(event, items);
}

// ── Widget management ──────────────────────────────────────────────────
let _delWidgetPending = null;  // { widgetId, pageId }

function deleteWidget(widgetId, pageId) {
  const modal = document.getElementById('del-widget-modal');
  if (!modal) {
    if (confirm('Remove this widget?')) _doDeleteWidget(widgetId, pageId);
    return;
  }
  _delWidgetPending = { widgetId, pageId };
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('del-widget-confirm-btn')?.focus(), 50);
}
function closeDelWidgetModal() {
  document.getElementById('del-widget-modal')?.classList.add('hidden');
  _delWidgetPending = null;
}
async function _confirmDelWidget() {
  if (!_delWidgetPending) return;
  const { widgetId, pageId } = _delWidgetPending;
  closeDelWidgetModal();
  await _doDeleteWidget(widgetId, pageId);
}
async function _doDeleteWidget(widgetId, pageId) {
  const res = await _post(`/home/widgets/${widgetId}/delete`, { page_id: pageId });
  invalidateHomePageCache(pageId);
  const hc  = document.getElementById('home-content');
  if (hc) hc.innerHTML = await res.text();
  try { initHomeWidgets(); } catch(e) { console.error('[home] initHomeWidgets threw:', e); }
}

/** Persist widget config to the backend and drop the current page from cache
 *  so the next visit always gets fresh server-rendered HTML. */
async function _saveWidgetConfig(widgetId, config) {
  await _post(`/home/widgets/${widgetId}/update-config`,
    { config_json: JSON.stringify(config) });
  const pid = Number(sessionStorage.getItem('bw-hp'));
  if (pid) invalidateHomePageCache(pid);
}

// ── Add-Widget Modal ──────────────────────────────────────────────────────────
function openAddWidget(pageId) {
  document.getElementById('aw-page-id').value = pageId;
  document.getElementById('aw-selected-type').value = '';
  document.getElementById('aw-step2').classList.add('hidden');
  document.querySelectorAll('.aw-type-btn').forEach(b =>
    b.classList.remove('border-wblue', 'bg-wblue/5'));
  document.getElementById('add-widget-modal').classList.remove('hidden');
}
function closeAddWidget() {
  document.getElementById('add-widget-modal').classList.add('hidden');
}

const WIDGET_STYLES = {
  clock:      [['digital','🕐 Digital'],['minimal','◌ Minimal'],['analog','🔵 Analog']],
  weather:    [['full','☁️ Full Forecast'],['compact','🌡️ Compact'],['minimal','🌤️ Minimal']],
  calendar:   [['month','📅 Month View'],['mini','🗓️ Mini']],
  todo:       [['list','📋 Full List'],['compact','✅ Compact']],
  note_link:  [['card','🗒️ Card'],['minimal','📄 Minimal']],
  timer:      [['stopwatch','⏱️ Stopwatch'],['pomodoro','🍅 Pomodoro'],['interval','🔁 Interval']],
  countdown:  [['event','🍯 Event (D/H/M/S)'],['days','📆 Days Only']],
  reminder:   [['list','📋 List'],['agenda','📌 Agenda']],
  event:      [['card','📅 Cards']],
  banner: [
    ['cinema',    '🎞️ Cinema'],
    ['oversize',  '📐 Oversize'],
    ['slate',     '🧻 Slate'],
    ['infrared',  '🟥 Infrared'],
    ['studio',    '■ Studio'],
    ['editorial', '🗉️ Editorial'],
    ['dusk',      '🌌 Dusk'],
    ['amber',     '🌅 Amber'],
  ],
  title:      [
    ['plain',      '✏️ Plain'],
    ['ruled',      '〰️ Ruled'],
    ['badge',      '🏷️ Badge'],
    ['gradient',   '🌈 Gradient'],
    ['neon',       '💡 Neon Glow'],
    ['typewriter', '⌨️ Typewriter'],
    ['marquee',    '📢 Marquee'],
    ['sticky',     '📝 Sticky Note'],
    ['rainbow',    '🌈 Rainbow'],
  ],
  divider: [['single','─ Single'],['double','═ Double'],['dashed','╌ Dashed'],
            ['dotted','··· Dotted'],['fade','∼ Fade'],['stars','✦ Stars'],
            ['sparkle','✨ Sparkle'],['neon','💡 Neon'],['rainbow','🌈 Rainbow']],
  text:    [['default','📝 Default'],['compact','📋 Compact'],['bare','🪟 Bare']],
  sticky:  [['paper','📄 Paper'],['grid','📐 Grid'],
            ['kraft','📦 Kraft'],['chalk','🖊️ Chalk'],['memo','📋 Memo']],
  quote:   [['classic','〝 Classic'],['editorial','❝ Editorial'],['ruled','〰️ Ruled'],
            ['cinema','🋏️ Cinema'],['polaroid','📸 Polaroid'],['splash','🎨 Splash']],
  rss_feed:[['card','📰 Card'],['compact','📋 Compact'],['minimal','🔗 Minimal']],
  buds:    [['default','🌸 Full'],['compact','🌿 Compact']],
  upload_preview: [['grid', '🙌 Grid'], ['carousel', '🎠 Carousel']],
};

const WIDGET_CONFIG_FIELDS = {
  clock: (s) => [
    { id: 'cf-fmt', label: 'Time format', type: 'select', name: 'format',
      options: [['12h','12-hour (AM/PM)'],['24h','24-hour']] },
    { id: 'cf-tz', label: 'Timezone', type: 'select', name: 'timezone',
      options: [
        ['local',                  '🌐 Local (auto-detect)'],
        ['America/New_York',       '🗽  Eastern — ET'],
        ['America/Chicago',        '🌽 Central — CT'],
        ['America/Denver',         '⛰️  Mountain — MT'],
        ['America/Los_Angeles',    '🌉 Pacific — PT'],
        ['America/Anchorage',      '🦴 Alaska — AKT'],
        ['Pacific/Honolulu',       '🌺 Hawaii — HT'],
        ['America/Puerto_Rico',    '🇵🇷 Puerto Rico — AST'],
        ['America/Sao_Paulo',      '🇧🇷 Brasília — BRT'],
        ['Europe/London',          '🇬🇧 London — GMT/BST'],
        ['Europe/Paris',           '🇫🇷 Paris — CET'],
        ['Europe/Moscow',          '🇷🇺 Moscow — MSK'],
        ['Asia/Dubai',             '🇦🇪 Dubai — GST'],
        ['Asia/Kolkata',           '🇮🇳 India — IST'],
        ['Asia/Dhaka',             '🇧🇩 Dhaka — BST'],
        ['Asia/Bangkok',           '🇹🇭 Bangkok — ICT'],
        ['Asia/Ho_Chi_Minh',       '🇻🇳 Vietnam — ICT'],
        ['Asia/Shanghai',          '🇨🇳 China — CST'],
        ['Asia/Tokyo',             '🇯🇵 Japan — JST'],
        ['Australia/Sydney',       '🦸 Sydney — AEDT'],
        ['Pacific/Auckland',       '🇳🇿 Auckland — NZST'],
        ['UTC',                    '🌍 UTC'],
      ]
    },
  ],
  weather: () => [
    { id: 'cf-loc',  label: 'Location (city, state)', type: 'text',
      placeholder: 'Dallas, TX', name: 'location' },
    { id: 'cf-unit', label: 'Temperature unit', type: 'select',
      options: [['F','°F Fahrenheit'],['C','°C Celsius']], name: 'unit' },
  ],
  calendar: () => [],
  todo:     () => [],
  note_link: () => [
    { id: 'cf-note',      label: 'Note',      type: 'select-notes', name: 'note_id' },
    { id: 'cf-openmode', label: 'Open as',   type: 'select',       name: 'open_mode',
      options: [['popup','💬 Popup modal'],['sidebar','📌 Slide-in sidebar'],['workspace','🗂️ Workspace']] },
  ],
  timer: (s) => s === 'pomodoro' ? [
    { id: 'cf-pw', label: 'Work minutes',  type: 'number', placeholder: '25', name: 'pomo_work' },
    { id: 'cf-pb', label: 'Break minutes', type: 'number', placeholder: '5',  name: 'pomo_break' },
  ] : s === 'interval' ? [
    { id: 'cf-iv', label: 'Interval minutes', type: 'number', placeholder: '5', name: 'interval' },
  ] : [],
  countdown: () => [
    { id: 'cf-label', label: 'Event name',  type: 'text', placeholder: 'Launch Day!', name: 'label' },
    { id: 'cf-date',  label: 'Target date', type: 'date', name: 'target_date' },
  ],
  reminder: () => [],
  event:    () => [],
  title:    () => [
    { id: 'cf-txt',   label: 'Title text',  type: 'text',   placeholder: 'My Section', name: 'text' },
    { id: 'cf-sub',   label: 'Subtitle',    type: 'text',   placeholder: 'optional',   name: 'subtitle' },
    { id: 'cf-emoji', label: 'Emoji prefix', type: 'text', placeholder: '📂', name: 'emoji',
      suggestions: ['📌','📍','📎','🗂️','📁','📂','🗃️','⭐','🌟','💫','✨','🔥','💡','🎯','🏆','📚','📊','📝','✅','🔔','💬','🔑','🗓️','💰','📈','🌱','🌊','⚡','🎨','🎵','🎮','🍀','🦋'] },
    { id: 'cf-align', label: 'Alignment',   type: 'select', name: 'align',
      options: [['center','Center'],['left','Left'],['right','Right']] },
  ],
  banner: (s) => {
    const accentDefaults = {
      cinema:   '#555555', oversize: '#555555', slate:    '#0053e2',
      infrared: '#dc2626', studio:   '#555555', editorial:'#0053e2',
      dusk:     '#a78bfa', amber:    '#fbbf24',
    };
    const dflt = accentDefaults[s] || '#0053e2';
    return [
      { id: 'cf-txt',    label: 'Banner text',   type: 'text',   placeholder: 'Welcome!', name: 'text' },
      { id: 'cf-sub',    label: 'Subtitle',       type: 'text',   placeholder: 'optional', name: 'subtitle' },
      { id: 'cf-emoji',  label: 'Emoji prefix',   type: 'text',   placeholder: '🚀',       name: 'emoji',
        suggestions: ['🚀','🎯','🏆','💡','🌟','🔥','✨','💬','📢','🎉','🌊','⚡','🎨','🌱','💰','📊'] },
      { id: 'cf-align',  label: 'Alignment',      type: 'select', name: 'align',
        options: [['center','Center'],['left','Left'],['right','Right']] },
      { id: 'cf-accent', label: 'Accent color',  type: 'color',  name: 'accent_color', default: dflt, refresh: true },
      { id: 'cf-nobg',   label: 'Background',    type: 'select', name: 'transparent_bg',
        options: [['','With background (default)'],['1','No background']], refresh: true },
    ];
  },
  divider:  () => [],  // no configurable fields
  text: () => [
    { id: 'cf-content', label: 'Initial content (Markdown)', type: 'textarea',
      name: 'content', placeholder: '## Hello\n\nWrite some **markdown** here…' },
  ],
  sticky: () => [
    { id: 'cf-content', label: 'Note content (Markdown)', type: 'textarea',
      name: 'content', placeholder: '📌 Remember to…' },
  ],
  quote: () => [
    { id: 'cf-content', label: 'Quote / callout text (Markdown)', type: 'textarea',
      name: 'content', placeholder: 'The best way to predict the future is to create it.' },
    { id: 'cf-author', label: 'Attribution (optional)', type: 'text',
      name: 'author', placeholder: '— Peter Drucker' },
  ],
  rss_feed: (style) => [
    { id: 'cf-feeds',   label: 'Feed sources',       type: 'feeds-list', name: 'feeds' },
    { id: 'cf-max',     label: 'Items per feed',      type: 'number',
      placeholder: '5', name: 'max_items' },
    { id: 'cf-thumb',   label: 'Thumbnails',          type: 'select', name: 'show_thumbs',
      options: [['1','Show thumbnails'],['0','Hide thumbnails']] },
    { id: 'cf-card-bg', label: 'Card background',     type: 'select', name: 'card_bg',
      options: [['1','Show (framed)'],['0','Hide (clean / title-card style)']] },
    { id: 'cf-group',   label: 'Group by',            type: 'select', name: 'group_by',
      options: [['none','No grouping'],['source','Source feed'],['category','Category']] },
    { id: 'cf-ref',     label: 'Auto-refresh',        type: 'select', name: 'refresh_min',
      options: [['5','Every 5 min'],['15','Every 15 min'],['30','Every 30 min'],
                ['60','Every hour'],['0','Manual only']] },
    { id: 'cf-track',   label: 'Read tracking',       type: 'select', name: 'track_read',
      options: [['0','Off'],['1','Track read / unread']] },
    ...(style === 'compact' ? [
      { id: 'cf-label', label: 'Feed source label', type: 'select', name: 'compact_label',
        options: [['1','Show label (dot + text)'],['wrap','Bubble each feed'],['0','Hide label']] },
    ] : []),
  ],
  buds: () => [
    { id: 'cf-buds-title', label: 'Widget title', type: 'text',
      placeholder: 'My Buds', name: 'custom_name' },
    { id: 'cf-buds-crm', label: 'Show health badges on CRM page (optional)',
      type: 'select-crm-pages', name: 'linked_crm_page_id' },
  ],
  upload_preview: () => [
    // upload-picker is handled specially in aw_refreshConfig / _buildFieldsForType.
    // At add-widget time we just show an informational placeholder.
    { id: 'cf-upl-caption', label: 'Show filenames under thumbnails',
      type: 'select', name: 'caption',
      options: [['0','No'],['1','Yes']] },
    { id: 'cf-upl-ids', label: 'Pinned files', type: 'upload-picker',
      name: 'upload_ids' },
  ],
};

function selectWidgetType(wtype) {
  document.getElementById('aw-selected-type').value = wtype;
  document.querySelectorAll('.aw-type-btn').forEach(b => {
    const active = b.dataset.wtype === wtype;
    b.classList.toggle('border-wblue', active);
    b.classList.toggle('bg-wblue/5',  active);
  });

  const styles   = WIDGET_STYLES[wtype] || [];
  const styleDiv = document.getElementById('aw-style-options');
  styleDiv.innerHTML = `<p class="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-2">Style</p>
    <div class="flex flex-wrap gap-2 mb-1">
      ${styles.map(([val, lbl], i) =>
        `<label class="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name="aw-style" value="${val}" ${i===0?'checked':''}
                 class="accent-wblue" onchange="aw_refreshConfig('${wtype}', this.value)">
          <span class="text-sm text-gray-700 dark:text-zinc-300">${lbl}</span>
        </label>`
      ).join('')}
    </div>`;

  aw_refreshConfig(wtype, styles[0]?.[0] ?? 'default');
  document.getElementById('aw-step2').classList.remove('hidden');
}

function aw_refreshConfig(wtype, style) {
  const allNotes = JSON.parse(document.getElementById('all-notes-data')?.textContent || '[]');
  const fields   = (WIDGET_CONFIG_FIELDS[wtype] || (() => []))(style);
  const cfDiv    = document.getElementById('aw-config-fields');
  cfDiv.innerHTML = fields.map(f => {
    const lbl = `<label class="block text-xs font-semibold text-gray-500 mb-1">${f.label}</label>`;
    if (f.type === 'select-notes') {
      const opts = allNotes.map(n =>
        `<option value="${n.id}" data-title="${_esc(n.title)}"
                 data-snippet="${_esc((n.content||'').slice(0,100))}">${_esc(n.title)}</option>`
      ).join('');
      return `<div>${lbl}
        <select id="${f.id}" data-name="${f.name}"
          class="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2
                 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                 focus:outline-none focus:ring-2 focus:ring-wblue">
          <option value="">— pick a note —</option>${opts}
        </select></div>`;
    }
    if (f.type === 'textarea') {
      return `<div>${lbl}
        <textarea id="${f.id}" data-name="${f.name}" rows="5"
          placeholder="${f.placeholder||''}"
          class="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2
                 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 font-mono
                 focus:outline-none focus:ring-2 focus:ring-wblue resize-y"></textarea></div>`;
    }
    if (f.type === 'select') {
      const opts = (f.options||[]).map(([v,l]) =>
        `<option value="${v}">${l}</option>`).join('');
      return `<div>${lbl}
        <select id="${f.id}" data-name="${f.name}"
          class="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2
                 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                 focus:outline-none focus:ring-2 focus:ring-wblue">${opts}</select></div>`;
    }
    if (f.type === 'color') {
      const dflt  = f.default || '#0053e2';
      const hexId = `${f.id}-awhex`;
      const swnId = `${f.id}-awswn`;
      return `<div>${lbl}
        <div class="flex items-center gap-2">
          <span style="position:relative;display:inline-block;width:2rem;height:2rem;flex-shrink:0;">
            <span id="${swnId}"
                  style="position:absolute;inset:0;border-radius:6px;border:2px solid #e5e7eb;
                         background:${dflt};box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);"></span>
            <input id="${f.id}" data-name="${f.name}" type="color" value="${dflt}"
                   title="Click to pick a color"
                   style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:none;padding:0;"
                   oninput="(function(v){document.getElementById('${swnId}').style.background=v;document.getElementById('${hexId}').textContent=v;})(this.value)">
          </span>
          <code id="${hexId}" class="text-xs font-mono text-gray-400 select-all">${dflt}</code>
        </div></div>`;
    }
    if (f.type === 'feeds-list') {
      // _rssFeedsEditorHtml is defined in home-widget-rss.js (loaded before interaction)
      return `<div>${lbl}${_rssFeedsEditorHtml(f.id, [], f.name)}</div>`;
    }
    if (f.type === 'select-crm-pages') {
      // populated async after the div is inserted
      var selId = f.id;
      var selName = f.name;
      setTimeout(function() {
        fetch('/home/pages', {credentials: 'same-origin',
          headers: {'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}})
        .then(function(r) { return r.ok ? r.json() : {pages:[]}; })
        .then(function(data) {
          var pages = (data.pages || []).filter(function(p) { return p.page_type === 'crm'; });
          var sel = document.getElementById(selId);
          if (!sel) return;
          sel.innerHTML = '<option value="">— none —</option>'
            + pages.map(function(p) {
                return '<option value="'+p.id+'">'+p.name+'</option>';
              }).join('');
        }).catch(function() {});
      }, 50);
      return `<div>${lbl}
        <select id="${selId}" data-name="${selName}"
          class="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2
                 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                 focus:outline-none focus:ring-2 focus:ring-wblue">
          <option value="">Loading…</option>
        </select></div>`;
    }
    if (f.type === 'upload-picker') {
      // No widgetId exists yet (widget hasn’t been saved). Show a hint.
      return `<div>${lbl}
        <p class="text-xs text-gray-400 dark:text-zinc-500 py-2">
          ✅ Add the widget, then open its <strong>⚙️ Settings</strong> gear to pick files.
        </p>
        <input type="hidden" id="${f.id}" data-name="${f.name}"
               data-json="1" value="[]"></div>`;
    }
    return `<div>${lbl}
      <input id="${f.id}" data-name="${f.name}" type="${f.type}"
             placeholder="${f.placeholder||''}"
             class="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2
                    bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                    focus:outline-none focus:ring-2 focus:ring-wblue"></div>`;
  }).join('');
}

function aw_back() {
  document.getElementById('aw-step2').classList.add('hidden');
  document.getElementById('aw-selected-type').value = '';
  document.querySelectorAll('.aw-type-btn').forEach(b =>
    b.classList.remove('border-wblue','bg-wblue/5'));
}

async function aw_submit() {
  const pageId  = document.getElementById('aw-page-id').value;
  const wtype   = document.getElementById('aw-selected-type').value;
  if (!wtype) { alert('Pick a widget type first!'); return; }
  const styleEl = document.querySelector('input[name="aw-style"]:checked');
  const style   = styleEl ? styleEl.value : 'default';

  const config = {};
  document.querySelectorAll('#aw-config-fields [data-name]').forEach(el => {
    if (el.tagName === 'SELECT' && el.id === 'cf-note') {
      const opt = el.options[el.selectedIndex];
      if (opt && opt.value) {
        config.note_id      = +opt.value;
        config.note_title   = opt.dataset.title   || opt.text;
        config.note_snippet = opt.dataset.snippet || '';
      }
    } else if (el.dataset.json) {
      try { config[el.dataset.name] = JSON.parse(el.value || '[]'); }
      catch { config[el.dataset.name] = []; }
    } else {
      config[el.dataset.name] = el.value;
    }
  });

  const res = await _post(`/home/pages/${pageId}/widgets/add`, {
    widget_type: wtype, style, config_json: JSON.stringify(config),
  });
  closeAddWidget();
  const pid = Number(sessionStorage.getItem('bw-hp'));
  if (pid) invalidateHomePageCache(pid);
  const hc = document.getElementById('home-content');
  if (hc) hc.innerHTML = await res.text();
  try { initHomeWidgets(); } catch(e) { console.error('[home] initHomeWidgets (addWidget) threw:', e); }
}

// ── Top-action area: swap between New Note (workspace) and Add Widget (home) ─
const _NEW_NOTE_HTML = `<button
  id="btn-new-note"
  hx-get="/notes/form/new"
  hx-target="#detail-panel"
  hx-swap="innerHTML"
  hx-include="#active-workspace"
  class="flex items-center gap-2 bg-wspark text-gray-900 font-semibold px-4 py-2 rounded-lg
         hover:bg-yellow-300 transition text-sm focus:outline-none focus:ring-2
         focus:ring-wspark focus:ring-offset-2"
  aria-label="Create new note"
><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
     stroke="currentColor" aria-hidden="true">
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
</svg>New Note</button>`;

function _setTopActionAddWidget(pageId) {
  const area = document.getElementById('top-action-area');
  if (!area) return;
  area.innerHTML = `<div class="flex items-center gap-2">
    <button onclick="openAddWidget(${pageId})"
      class="flex items-center gap-2 bg-wblue text-white font-semibold px-4 py-2 rounded-lg
             hover:bg-blue-700 transition text-sm focus:outline-none focus:ring-2 focus:ring-wblue"
      aria-label="Add widget">
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/>
      </svg>
      Add Widget
    </button>
    <button onclick="openPageLayout(${pageId})"
      title="Page layout settings"
      class="p-2 rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-500
             hover:text-wblue hover:border-wblue dark:text-zinc-400 dark:hover:border-wblue
             transition focus:outline-none focus:ring-2 focus:ring-wblue"
      aria-label="Page layout settings">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
           stroke-width="2" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    </button>
  </div>`;
}

function _setTopActionNewNote() {
  const area = document.getElementById('top-action-area');
  if (!area) return;
  area.innerHTML = _NEW_NOTE_HTML;
  // Re-process HTMX so hx-* attrs on the freshly-injected button work.
  if (typeof htmx !== 'undefined') htmx.process(area);
}
// ── Drag & Drop reorder (with edge-scroll) ──────────────────────────────
let _dragSrc = null;

// ── Stack-mode helpers (needed by _initDnD below) ─────────────────────────────────────

function _clearStackDropHighlight() {
  document.querySelectorAll('.hw-card').forEach(function(c) { c.style.outline = ''; });
}

async function _stackDropOnCard(targetCard, srcCard, pageId) {
  var targetId = parseInt(targetCard.dataset.widgetId, 10);
  var srcId    = parseInt(srcCard.dataset.widgetId, 10);
  if (!targetId || !srcId) return;

  var targetType = targetCard.dataset.widgetType;
  var srcType    = srcCard.dataset.widgetType;
  if (['divider', 'stack'].includes(targetType) ||
      ['divider', 'stack'].includes(srcType)) {
    _bwToast('Dividers and stacks cannot be stacked.', 'error');
    return;
  }

  // If target is already a stack: add srcCard to it
  if (targetType === 'stack') {
    var fd1 = new FormData();
    fd1.append('widget_id', srcId);
    fd1.append('page_id', pageId);
    var r1 = await fetch('/home/widgets/' + targetId + '/stack-add',
                        { method: 'POST', body: fd1 });
    if (!r1.ok) { _bwToast('Stack add failed', 'error'); return; }
    var html1 = await r1.text();
    var hc1 = document.getElementById('home-content');
    if (hc1) { hc1.innerHTML = html1; _initSwappedPage(); }
    invalidateHomePageCache(pageId);
    _bwToast('Added to stack 📦', 'success');
    return;
  }

  // Otherwise: create a brand-new stack from the two cards
  var fd2 = new FormData();
  fd2.append('page_id', pageId);
  fd2.append('widget_ids', targetId + ',' + srcId);
  var r2 = await fetch('/home/widgets/stack', { method: 'POST', body: fd2 });
  if (!r2.ok) { _bwToast('Stack creation failed', 'error'); return; }
  var html2 = await r2.text();
  var hc2 = document.getElementById('home-content');
  if (hc2) { hc2.innerHTML = html2; _initSwappedPage(); }
  invalidateHomePageCache(pageId);
  _bwToast('Stacked into carousel 📦', 'success');
}

/**
 * _applyStackModeState — shared applier used by toggleStackMode AND
 * initStackCards (localStorage restore).  Keeps the two callers DRY.
 */
function _applyStackModeState(grid, on) {
  grid.dataset.stackMode = on ? 'true' : 'false';

  var knob   = document.getElementById('pg-stack-mode-knob');
  var toggle = document.getElementById('pg-stack-mode-toggle');
  if (toggle) toggle.setAttribute('aria-checked', on ? 'true' : 'false');
  if (toggle) toggle.style.backgroundColor = on ? '#0053e2' : '';
  if (knob)   knob.style.transform = on ? 'translateX(1.25rem)' : 'translateX(0.125rem)';

  document.querySelectorAll('.stack-unstack-btn').forEach(function(btn) {
    btn.classList.toggle('hidden', !on);
  });

  // Visual cue: slightly dim non-stack non-child cards when in stack mode
  document.querySelectorAll('.hw-card:not([data-widget-type="stack"])').forEach(function(c) {
    c.style.opacity = (on && !c.closest('.stack-slide')) ? '0.85' : '';
  });
}

/**
 * toggleStackMode — flips data-stack-mode on the widget grid, persists to
 * localStorage so the state survives re-renders (unstack, stack) and F5.
 */
function toggleStackMode() {
  var grid = document.querySelector('[id^="widget-grid-"]');
  if (!grid) return;
  var on      = grid.dataset.stackMode !== 'true';
  var pageId  = (grid.id || '').replace('widget-grid-', '');
  if (pageId) localStorage.setItem('bw_stack_' + pageId, on ? '1' : '0');
  _applyStackModeState(grid, on);
}

function _initDnD(grid, pageId) {
  // Edge-scroll: scroll #main-content when the user drags near the top/bottom.
  // We update _dragY on every dragover so the rAF loop always sees fresh coords.
  const EDGE_PX   = 90;   // px from viewport edge that activates scrolling
  const MAX_SPEED = 18;   // max px per animation frame
  let _dragY      = 0;
  let _scrollRaf  = null;

  function _cancelScroll() {
    if (_scrollRaf) { cancelAnimationFrame(_scrollRaf); _scrollRaf = null; }
  }

  function _edgeScroll() {
    const scroller = document.getElementById('main-content');
    if (!scroller) return;
    const rect    = scroller.getBoundingClientRect();
    const distTop = _dragY - rect.top;
    const distBot = rect.bottom - _dragY;

    let speed = 0;
    if (distTop < EDGE_PX)      speed = -Math.round(MAX_SPEED * (1 - distTop / EDGE_PX));
    else if (distBot < EDGE_PX) speed =  Math.round(MAX_SPEED * (1 - distBot / EDGE_PX));

    if (speed === 0) { _cancelScroll(); return; }

    function step() {
      // Re-read fresh position each frame
      const sc = document.getElementById('main-content');
      if (!sc || !_dragSrc) { _cancelScroll(); return; }
      const r  = sc.getBoundingClientRect();
      const dt = _dragY - r.top;
      const db = r.bottom - _dragY;
      let spd  = 0;
      if (dt < EDGE_PX)      spd = -Math.round(MAX_SPEED * (1 - dt / EDGE_PX));
      else if (db < EDGE_PX) spd =  Math.round(MAX_SPEED * (1 - db / EDGE_PX));
      if (spd === 0) { _cancelScroll(); return; }
      sc.scrollTop += spd;
      _scrollRaf = requestAnimationFrame(step);
    }

    _cancelScroll();
    _scrollRaf = requestAnimationFrame(step);
  }

  grid.addEventListener('dragstart', e => {
    const card = e.target.closest('.hw-card');
    // Don't allow dragging child cards from inside a stack slide
    if (card && card.closest('.stack-slide')) { e.preventDefault(); return; }
    _dragSrc = card;
    // Capture by value — _dragSrc may be nulled by dragend before the
    // 0ms callback fires (race condition between dragstart and dragend).
    const captured = _dragSrc;
    if (captured) { setTimeout(() => captured.classList.add('opacity-40'), 0); }
  });
  grid.addEventListener('dragend', () => {
    _dragSrc?.classList.remove('opacity-40');
    _dragSrc = null;
    _cancelScroll();
    _clearStackDropHighlight();
  });
  grid.addEventListener('dragover', e => {
    e.preventDefault();
    _dragY = e.clientY;
    _edgeScroll();
    // Stack-mode: highlight card if we're hovering over its centre
    if (grid.dataset.stackMode === 'true' && _dragSrc) {
      const hovCard = e.target.closest('.hw-card');
      if (hovCard && hovCard !== _dragSrc && !hovCard.closest('.stack-slide')) {
        const r    = hovCard.getBoundingClientRect();
        const relX = (e.clientX - r.left) / r.width;
        const relY = (e.clientY - r.top)  / r.height;
        const onCentre = relX > 0.15 && relX < 0.85 && relY > 0.15 && relY < 0.85;
        // Clear all, then highlight only the current target
        document.querySelectorAll('.hw-card').forEach(c => { c.style.outline = ''; });
        if (onCentre) hovCard.style.outline = '2px solid #0053e2';
      } else {
        _clearStackDropHighlight();
      }
    }
  });
  grid.addEventListener('drop', async e => {
    e.preventDefault();
    _cancelScroll();
    _clearStackDropHighlight();
    if (!_dragSrc) return;
    const target = e.target.closest('.hw-card');
    if (!target || target === _dragSrc) return;

    // Stack mode: drop on centre → combine; drop on edge → reorder
    if (grid.dataset.stackMode === 'true') {
      const r      = target.getBoundingClientRect();
      const relX   = (e.clientX - r.left) / r.width;
      const relY   = (e.clientY - r.top)  / r.height;
      const onCard = relX > 0.15 && relX < 0.85 && relY > 0.15 && relY < 0.85;
      if (onCard && !target.closest('.stack-slide')) {
        await _stackDropOnCard(target, _dragSrc, pageId);
        return;
      }
    }

    // Normal reorder
    const cards = [...grid.querySelectorAll(':scope > .hw-card')];
    const si = cards.indexOf(_dragSrc), ti = cards.indexOf(target);
    if (si < 0 || ti < 0) return;    // child cards not in grid directly
    if (si < ti) target.after(_dragSrc); else target.before(_dragSrc);
    const order = [...grid.querySelectorAll(':scope > .hw-card')]
      .map(c => c.dataset.widgetId).join(',');
    await _post(`/home/pages/${pageId}/widgets/reorder`, { order });
    invalidateHomePageCache(pageId);
  });
}

// ── Page-module dispatcher ───────────────────────────────────────────────────
// Called after every innerHTML swap so the right module boots for the
// current page type (dashboard → initHomeWidgets, rss → initRssPage, etc.).
function _initSwappedPage() {
  // Exit the uploads page only when the incoming page is NOT also an uploads page.
  // Calling exit then enter on the same page type causes a workspaces→folders flash.
  var nextIsUploads = !!document.getElementById('uploads-page-root');
  if (!nextIsUploads && typeof _uplFolderExitUploadsPage === 'function') {
    try { _uplFolderExitUploadsPage(); } catch(e) {}
  }
  // RSS Reader page
  const rssRoot = document.getElementById('rss-page-root');
  if (rssRoot) {
    const pid = parseInt(rssRoot.dataset.pageId, 10);
    if (pid && typeof initRssPage === 'function') {
      try { initRssPage(pid); } catch(e) { console.error('[home] initRssPage:', e); }
    }
    // Not a widget canvas — no Add Widget button needed
    var _ta = document.getElementById('top-action-area');
    if (_ta) _ta.innerHTML = '';
    return;
  }
  // CRM page
  const crmRoot = document.getElementById('crm-page-root');
  if (crmRoot) {
    const pid = parseInt(crmRoot.dataset.pageId, 10);
    if (pid && typeof initCrmPage === 'function') {
      try { initCrmPage(pid); } catch(e) { console.error('[home] initCrmPage:', e); }
    }
    // Not a widget canvas — no Add Widget button needed
    var _ta = document.getElementById('top-action-area');
    if (_ta) _ta.innerHTML = '';
    return;
  }
  // Grid page
  const gridRoot = document.getElementById('grid-page-root');
  if (gridRoot) {
    const pid = parseInt(gridRoot.dataset.pageId, 10);
    if (pid && typeof initGridPage === 'function') {
      try { initGridPage(pid); } catch(e) { console.error('[home] initGridPage:', e); }
    }
    var _ta = document.getElementById('top-action-area');
    if (_ta) _ta.innerHTML = '';
    return;
  }
  // Uploads page
  const uploadsRoot = document.getElementById('uploads-page-root');
  if (uploadsRoot) {
    var pid = parseInt(uploadsRoot.dataset.pageId, 10);
    if (pid && typeof initUploadsPage === 'function') {
      try { initUploadsPage(pid); } catch(e) { console.error('[home] initUploadsPage:', e); }
    }
    if (pid && typeof _uplFolderEnterUploadsPage === 'function') {
      try { _uplFolderEnterUploadsPage(pid); } catch(e) { console.error('[home] _uplFolderEnterUploadsPage:', e); }
    }
    var _ta = document.getElementById('top-action-area');
    if (_ta) _ta.innerHTML = '';
    return;
  }
  // Coming-soon page (media, grid_builder, …) — no widget canvas
  const comingSoonRoot = document.getElementById('coming-soon-page-root');
  if (comingSoonRoot) {
    var _ta = document.getElementById('top-action-area');
    if (_ta) _ta.innerHTML = '';
    return;
  }
  // Dashboard (widget canvas) — Add Widget button already set by showHomePage()
  try { initHomeWidgets(); } catch(e) { console.error('[home] initHomeWidgets:', e); }
}

// ── Init ──────────────────────────────────────────────────────────────────────
function initHomeWidgets() {
  // Reminder — browser notifications
  _initReminderNotifications();

  // Reminder date inputs — default to today
  const _todayISO = new Date().toISOString().slice(0, 10);
  document.querySelectorAll('input[data-rem-today]').forEach(el => {
    if (!el.value) el.value = _todayISO;
  });
  // Title — typewriter animation
  document.querySelectorAll('.bw-typewriter').forEach(el => {
    const full = el.dataset.text || '';
    let i = 0;
    el.textContent = '';
    const tick = setInterval(() => {
      if (i >= full.length) { clearInterval(tick); return; }
      el.textContent += full[i++];
    }, 60);
  });

  // Clock — match ONLY clock-{digits}, never clock-greet-*, clock-tz-*, etc.
  document.querySelectorAll('[id^="clock-"]')
    .forEach(el => { if (/^clock-\d+$/.test(el.id)) _startClock(el); });

  // Analog clock
  document.querySelectorAll('canvas[id^="analog-clock-"]').forEach(_startAnalogClock);

  // Weather
  document.querySelectorAll('.weather-widget').forEach(_loadWeather);

  // RSS Feed
  document.querySelectorAll('.rss-widget').forEach(el => {
    if (typeof _loadRss === 'function') _loadRss(el);
  });

  // Calendar
  document.querySelectorAll('.calendar-widget').forEach(_renderCalendar);

  // Events widget (must run after calendar init so _evtBuildStore can repaint)
  if (typeof window._evtInit === 'function') window._evtInit();

  // Countdown
  document.querySelectorAll('[id^="countdown-"]').forEach(_startCountdown);

  // Drag-and-drop per page grid
  const canvas = document.getElementById('home-canvas');
  if (canvas) {
    const pageId = canvas.dataset.pageId;
    const grid   = canvas.querySelector('[id^="widget-grid-"]');
    if (grid) _initDnD(grid, pageId);
  }
  // Text widgets — render markdown and attach editor
  if (typeof initTextWidgets === 'function') initTextWidgets();

  // Buds friendship-health-tracker widgets
  if (typeof initBudsWidgets === 'function') initBudsWidgets();

  // Upload Preview widgets
  document.querySelectorAll('[data-upload-ids]').forEach(function(el) {
    if (typeof _loadUploadPreview === 'function') _loadUploadPreview(el);
  });

  // Stack carousel cards
  if (typeof initStackCards === 'function') initStackCards();
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('home-canvas')) initHomeWidgets();

  // ── Restore HomeSpace page across browser F5 refresh ──────────────────
  // sessionStorage survives F5 but is cleared when the tab is closed.
  // showHomePage() writes it; homeExit() clears it.
  const _hpRaw = sessionStorage.getItem('bw-hp');
  const _hpId  = _hpRaw ? parseInt(_hpRaw, 10) : 0;
  console.log('[home-restore] DOMContentLoaded. sessionStorage bw-hp =', _hpRaw, '| parsed =', _hpId);
  if (_hpId) {
    // 0ms defer: the inline script in index.html already flipped visibility
    // synchronously (no flash). We just need to let other DOMContentLoaded
    // handlers register before we start the fetch.
    setTimeout(() => {
      console.log('[home-restore] calling showHomePage(', _hpId, ')');
      showHomePage(_hpId);
    }, 0);
  }
});

// ── Note Preview (popup / sidebar / workspace) ────────────────────────────────

/** Called from note-link widget buttons.  Fetches note content then shows
 *  it in a popup modal, a slide-in sidebar, or the full workspace. */
async function openNotePreview(widgetId, noteId, mode) {
  if (!noteId) return;
  if (mode === 'workspace') {
    if (typeof homeExit === 'function') homeExit();
    htmx.ajax('GET', `/notes/${noteId}`, { target: '#detail-panel', swap: 'innerHTML' });
    if (typeof openPanel === 'function') openPanel();
    return;
  }

  // Fetch note content from the embedded all-notes-data JSON (zero extra requests)
  const allNotes = JSON.parse(document.getElementById('all-notes-data')?.textContent || '[]');
  const note     = allNotes.find(n => String(n.id) === String(noteId));
  const title    = note?.title   || 'Note';
  const raw      = note?.content || '';

  // Render markdown → html using the already-loaded marked.js + DOMPurify
  let bodyHtml;
  try {
    if (typeof marked !== 'undefined') {
      marked.use({ gfm: true, breaks: true });
      const dirty = marked.parse(raw);
      bodyHtml = (typeof DOMPurify !== 'undefined')
        ? DOMPurify.sanitize(dirty, { ADD_TAGS: ['mark'], ADD_ATTR: ['style'] })
        : dirty;
    } else {
      bodyHtml = `<pre class="whitespace-pre-wrap text-xs">${_esc(raw)}</pre>`;
    }
  } catch { bodyHtml = `<pre class="whitespace-pre-wrap">${_esc(raw)}</pre>`; }

  const overlay = document.getElementById('note-preview-overlay');
  const sidebar = document.getElementById('note-preview-sidebar');
  const popup   = document.getElementById('note-preview-popup');
  if (!overlay) return;

  // Reset visibility
  sidebar.classList.add('hidden', 'translate-x-full');
  popup.classList.add('hidden');
  overlay.classList.remove('hidden');
  overlay.classList.add('flex');

  if (mode === 'sidebar') {
    document.getElementById('npp-sidebar-title').textContent = title;
    document.getElementById('npp-sidebar-body').innerHTML    = bodyHtml;
    if (typeof window._bwApplyCodeHighlighting === 'function')
      window._bwApplyCodeHighlighting(document.getElementById('npp-sidebar-body'));
    const btn = document.getElementById('npp-sidebar-open-btn');
    btn.onclick = () => {
      closeNotePreview();
      if (typeof homeExit === 'function') homeExit();
      htmx.ajax('GET', `/notes/${noteId}`, { target: '#detail-panel', swap: 'innerHTML' });
      if (typeof openPanel === 'function') openPanel();
    };
    sidebar.classList.remove('hidden');
    requestAnimationFrame(() => sidebar.classList.remove('translate-x-full'));
  } else { // popup
    document.getElementById('npp-popup-title').textContent = title;
    document.getElementById('npp-popup-body').innerHTML    = bodyHtml;
    if (typeof window._bwApplyCodeHighlighting === 'function')
      window._bwApplyCodeHighlighting(document.getElementById('npp-popup-body'));
    const btn = document.getElementById('npp-popup-open-btn');
    btn.onclick = () => {
      closeNotePreview();
      if (typeof homeExit === 'function') homeExit();
      htmx.ajax('GET', `/notes/${noteId}`, { target: '#detail-panel', swap: 'innerHTML' });
      if (typeof openPanel === 'function') openPanel();
    };
    popup.classList.remove('hidden');
  }
}

function closeNotePreview() {
  const overlay = document.getElementById('note-preview-overlay');
  const sidebar = document.getElementById('note-preview-sidebar');
  if (sidebar && !sidebar.classList.contains('hidden')) {
    sidebar.classList.add('translate-x-full');
    setTimeout(() => {
      overlay?.classList.add('hidden');
      overlay?.classList.remove('flex');
      sidebar.classList.add('hidden');
    }, 310);
  } else {
    overlay?.classList.add('hidden');
    overlay?.classList.remove('flex');
  }
  document.getElementById('note-preview-popup')?.classList.add('hidden');
}

// ── Scroll-jank suppressor ─────────────────────────────────────────────────────────
// While #main-content is scrolling, CSS class .bw-scrolling disables
// transition: on .hw-card (hover shadow paints would cause jank on every frame).
(function _initScrollSuppressor() {
  const main = document.getElementById('main-content');
  if (!main) return;
  let _scrollTimer = null;
  main.addEventListener('scroll', () => {
    if (!_scrollTimer) main.classList.add('bw-scrolling');
    clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(() => {
      main.classList.remove('bw-scrolling');
      _scrollTimer = null;
    }, 150);
  }, { passive: true });
})();
