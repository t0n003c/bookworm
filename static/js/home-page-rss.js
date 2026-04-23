/* home-page-rss.js — RSS Reader page (BookWorm).
   Manages: feed list, item fetching, read state, preview panel.
   Server APIs:
     GET  /home/rss-reader/{pid}/feeds
     POST /home/rss-reader/{pid}/feeds/add
     POST /home/rss-reader/{pid}/feeds/{id}/update
     POST /home/rss-reader/{pid}/feeds/{id}/delete
     GET  /home/rss-reader/{pid}/read
     POST /home/rss-reader/{pid}/read
     GET  /home/rss?url=...            proxy → RSS/Atom JSON
     GET  /home/rss/article?url=...    full-article extractor
*/
'use strict';

// ── Module state ──────────────────────────────────────────────────────────────
let _pid         = 0;
let _feeds       = [];        // [{id,url,label,color,category,sort_order}]
let _selFeed     = null;      // selected feed id, or null = All
let _selCategory = null;      // selected category string, or null
let _selItemCat  = null;      // selected article-level topic tag, or null
let _rawItems    = [];        // fetched items before filter/sort
let _items       = [];        // currently displayed items
let _sortMode    = 'newest';  // 'newest' | 'oldest' | 'title_az' | 'title_za' | 'feed'
let _filterMode  = 'all';     // 'all' | 'unread' | 'read'
let _groupMode   = 'none';    // 'none' | 'category'
let _read        = new Set();
let _initEl      = null;

// ── Init ──────────────────────────────────────────────────────────────────────
async function initRssPage(pageId) {
  const root = document.getElementById('rss-page-root');
  if (!root || _initEl === root) return;
  _initEl = root;
  _pid = pageId;
  _read = new Set(); _feeds = []; _rawItems = []; _items = [];
  _selFeed = null; _selCategory = null; _selItemCat = null;
  _sortMode = 'newest'; _filterMode = 'all'; _groupMode = 'none';
  await _syncReadFromServer();
  await _loadFeeds();
  _initAddForm();
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;')
                        .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function _fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
  catch { return ''; }
}

// ── Read state ────────────────────────────────────────────────────────────────
async function _syncReadFromServer() {
  try {
    const r = await fetch(`/home/rss-reader/${_pid}/read`);
    if (!r.ok) return;
    (await r.json()).forEach(g => _read.add(g));
  } catch { /* network blip */ }
}

function _markRead(guid) {
  if (_read.has(guid)) return;
  _read.add(guid);
  const card = document.querySelector(`[data-guid="${CSS.escape(guid)}"]`);
  if (card) {
    card.classList.remove('bw-rss-unread');
    card.querySelector('.rss-dot')?.classList.add('invisible');
  }
  _updateUnreadBadge();
  fetch(`/home/rss-reader/${_pid}/read`, {
    method:'POST', credentials:'same-origin',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify([guid]),
  }).catch(()=>{});
}

function _updateUnreadBadge() {
  const total = _items.filter(it => !_read.has(it.guid)).length;
  const badge = document.getElementById('rss-unread-badge');
  if (!badge) return;
  badge.textContent = `${total} unread`;
  badge.classList.toggle('hidden', total === 0);
}

// ── Mark all read ─────────────────────────────────────────────────────────────
async function rssMarkAllRead() {
  const unread = _rawItems.filter(it => !_read.has(it.guid)).map(it => it.guid);
  if (!unread.length) return;
  unread.forEach(g => _read.add(g));
  _applyDisplay();
  await fetch(`/home/rss-reader/${_pid}/read`, {
    method:'POST', credentials:'same-origin',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(unread),
  }).catch(()=>{});
}

// ── Feeds list ────────────────────────────────────────────────────────────────
async function _loadFeeds() {
  try {
    const r = await fetch(`/home/rss-reader/${_pid}/feeds`);
    if (!r.ok) return;
    _feeds = await r.json();
  } catch { _feeds = []; }
  _renderFeedList();
  rssSelectAll();
}

function _renderFeedList() {
  const list   = document.getElementById('rss-feed-list');
  if (!list) return;

  // Update datalist for category autocomplete
  const dl = document.getElementById('rss-category-list');
  if (dl) {
    const cats = [...new Set(_feeds.map(f => f.category).filter(Boolean))].sort();
    dl.innerHTML = cats.map(c => `<option value="${_esc(c)}">`).join('');
  }

  if (!_feeds.length) {
    list.innerHTML = '<p class="text-[11px] text-gray-400 dark:text-zinc-500 text-center py-3 px-2">No feeds yet</p>';
    // Hide top cat bar so it doesn't linger after all feeds are deleted
    var topBarEl = document.getElementById('rss-top-cat-bar');
    if (topBarEl) { topBarEl.classList.add('hidden'); topBarEl.innerHTML = ''; }
    return;
  }

  // Flat list — categories are filtered via the top cat bar, not sidebar folders
  list.innerHTML = _feeds.map(f => _feedRow(f)).join('');
  _renderTopCatBar();
}

// ── Top category filter bar (full-width strip below page title bar) ────────────
function _renderTopCatBar() {
  const el = document.getElementById('rss-top-cat-bar');
  if (!el) return;

  const cats = [...new Set(_feeds.map(f => f.category).filter(Boolean))].sort();

  // Always show bar (even no categories) — "All" pill lives here now.
  // Bar is hidden only when there are no feeds (_renderFeedList handles that).
  el.classList.remove('hidden');

  const baseBtn = 'flex-shrink-0 text-xs font-semibold px-3 py-1 rounded-full border transition';
  const active  = 'bg-[#0053e2] text-white border-[#0053e2]';
  const idle    = 'border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-300'
                + ' hover:border-[#0053e2] hover:text-[#0053e2] dark:hover:text-blue-300';

  // "All" pill is always first; category pills follow.
  // Clicking the active category pill toggles it off (back to All).
  const isAll = (_selFeed === null && _selCategory === null);
  let html = `<button onclick="rssSelectAll()" aria-pressed="${isAll}"
    class="${baseBtn} ${isAll ? active : idle}">All</button>`;
  cats.forEach(cat => {
    const on = (_selCategory === cat);
    html += `<button onclick="rssSelectCategory('${_esc(cat)}')" aria-pressed="${on}"
      class="${baseBtn} ${on ? active : idle}">${_esc(cat)}</button>`;
  });

  el.innerHTML = html;
}

function _feedRow(f) {
  const isActive = String(_selFeed) === String(f.id);
  const src      = (window._rssWidgetSources || {})[f.id];
  const favicon  = _rssFaviconUrl(f.url);
  const color    = f.color || '#0053e2';

  const iconHtml = favicon
    ? `<img src="${favicon}" width="16" height="16" alt=""
            style="border-radius:3px;flex-shrink:0;"
            onerror="this.style.display='none';this.nextSibling.style.display='inline-block';">
       <span style="display:none;width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${_esc(color)};"></span>`
    : `<span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:2px;background:${_esc(color)};"></span>`;

  const badge = src
    ? `<span class="block text-[9px] truncate leading-tight mt-0.5"
             style="color:${_esc(color)};opacity:.8;"
             title="Synced from ${_esc(src.page_name)} › ${_esc(src.widget_label)}">
        📌 ${_esc(src.page_emoji)} ${_esc(src.page_name)} › ${_esc(src.widget_label)}
      </span>`
    : '';

  return `
    <div data-feed-id="${f.id}" class="rounded-lg overflow-hidden">
      <div class="flex items-center gap-1.5 group px-1 py-0.5 rounded-lg transition
                  ${isActive
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-100 dark:hover:bg-zinc-800'}"
           style="${isActive ? 'border-left:3px solid ' + color + ';padding-left:6px;' : 'border-left:3px solid transparent;padding-left:6px;'}"
      >
        <button onclick="rssSelectFeed(${f.id})"
                class="flex-1 min-w-0 text-left flex items-center gap-2 py-1">
          ${iconHtml}
          <span class="flex-1 min-w-0">
            <span class="truncate block text-sm
                         ${isActive ? 'font-semibold' : 'text-gray-700 dark:text-zinc-200'}"
                  style="${isActive ? 'color:' + color + ';' : ''}">
              ${_esc(f.label || f.url)}
            </span>
            ${badge}
          </span>
        </button>
        <button onclick="rssEditFeed(${f.id})" title="Edit feed"
                class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-blue-500
                       transition text-xs px-0.5 flex-shrink-0" aria-label="Edit feed">✎</button>
        <button onclick="rssDeleteFeed(event,${f.id})" title="Remove feed"
                class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500
                       transition text-xs px-1 flex-shrink-0" aria-label="Remove feed">✕</button>
      </div>
      <div id="rss-edit-${f.id}"
           class="hidden px-2 pb-2 pt-1 bg-gray-50 dark:bg-zinc-900 border-b border-gray-100 dark:border-zinc-800">
        <form onsubmit="rssUpdateFeed(event,${f.id})" class="space-y-1">
          <input name="label" value="${_esc(f.label)}" placeholder="Label"
                 class="w-full text-xs px-2 py-1 border border-gray-300 dark:border-zinc-600
                        rounded bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                        focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
          <input name="category" value="${_esc(f.category || '')}" placeholder="Category (optional)"
                 list="rss-category-list"
                 class="w-full text-xs px-2 py-1 border border-gray-300 dark:border-zinc-600
                        rounded bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                        focus:outline-none focus:ring-1 focus:ring-[#0053e2]">
          <div class="flex items-center gap-2">
            <label class="text-[10px] text-gray-400">Colour</label>
            <input name="color" type="color" value="${_esc(f.color)}"
                   class="h-5 w-8 rounded border border-gray-300 dark:border-zinc-600 cursor-pointer">
            <button type="submit"
                    class="ml-auto text-[10px] px-2 py-0.5 bg-[#0053e2] text-white rounded
                           hover:bg-[#003eb3] transition font-semibold">Save</button>
            <button type="button" onclick="rssEditFeed(${f.id})"
                    class="text-[10px] px-2 py-0.5 border border-gray-300 dark:border-zinc-600
                           rounded text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800">Cancel</button>
          </div>
        </form>
      </div>
    </div>`;
}

// ── Favicon helper (Google S2) ──────────────────────────────────────────────
function _rssFaviconUrl(feedUrl) {
  if (!feedUrl) return null;
  try {
    let u = feedUrl.trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    const host = new URL(u).hostname;
    if (!host || host.indexOf('.') === -1) return null;
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=32';
  } catch { return null; }
}

// ── Toast — thin delegator to the shared window._bwToast (home-widgets.js) ──
function _rssToast(msg, isErr) {
  if (typeof window._bwToast === 'function') {
    window._bwToast(msg, isErr ? 'error' : 'success');
  }
}

// ── Feed selection ────────────────────────────────────────────────────────────
async function rssSelectAll() {
  _selFeed = null; _selCategory = null; _selItemCat = null;
  _renderFeedList();
  document.getElementById('rss-items-title').textContent = 'All Feeds';
  await _loadAllItems();
}

async function rssSelectFeed(feedId) {
  _selFeed = feedId; _selCategory = null; _selItemCat = null;
  _renderFeedList();
  const feed = _feeds.find(f => f.id === feedId);
  document.getElementById('rss-items-title').textContent = _esc(feed?.label || feed?.url || 'Feed');
  if (feed) await _loadFeedItems(feed.url);
}

async function rssSelectCategory(cat) {
  // Toggle off if clicking the already-active category pill
  if (_selCategory === cat) { await rssSelectAll(); return; }
  _selFeed = null; _selCategory = cat; _selItemCat = null;
  _renderFeedList();
  document.getElementById('rss-items-title').textContent = `📁 ${_esc(cat)}`;
  await _loadAllItems();  // loads all; _applyDisplay will filter to category
}

function rssSelectItemCat(cat) {
  // Toggle: clicking active pill deselects it
  _selItemCat = (_selItemCat === cat) ? null : cat;
  _applyDisplay();
}

// ── Display: filter + sort ────────────────────────────────────────────────────
function rssApplyDisplay() {
  const sortSel   = document.getElementById('rss-sort-sel');
  const filterSel = document.getElementById('rss-filter-sel');
  const groupSel  = document.getElementById('rss-group-sel');
  if (sortSel)   _sortMode   = sortSel.value;
  if (filterSel) _filterMode = filterSel.value;
  if (groupSel)  _groupMode  = groupSel.value;
  _applyDisplay();
}

function _applyDisplay() {
  let items = [..._rawItems];

  // Feed-category filter (when viewing a feed group, not a specific feed)
  if (_selCategory && _selFeed === null) {
    const inCat = new Set(_feeds.filter(f => f.category === _selCategory).map(f => f.id));
    items = items.filter(it => inCat.has(it._feedId));
  }

  // Article-level topic filter (per-item RSS <category> tags)
  if (_selItemCat) {
    const needle = _selItemCat.toLowerCase();
    items = items.filter(it =>
      (it.item_categories || []).some(c => c.toLowerCase() === needle)
    );
  }

  // Read/unread filter
  if (_filterMode === 'unread') items = items.filter(it => !_read.has(it.guid));
  if (_filterMode === 'read')   items = items.filter(it =>  _read.has(it.guid));

  // Sort
  items.sort((a, b) => {
    switch (_sortMode) {
      case 'oldest':   return (a._ts || 0) - (b._ts || 0);
      case 'title_az': return (a.title || '').localeCompare(b.title || '');
      case 'title_za': return (b.title || '').localeCompare(a.title || '');
      case 'feed':     return (a._source || '').localeCompare(b._source || '');
      default:         return (b._ts || 0) - (a._ts || 0);  // newest
    }
  });

  _items = items;
  _renderItems(_items);
  _updateUnreadBadge();
  _renderItemCatPills();

}

// ── Article-level topic pills ─────────────────────────────────────────────────
function _renderItemCatPills() {
  const el = document.getElementById('rss-item-cat-pills');
  if (!el) return;

  // Collect all unique categories from raw items (not filtered items, so pills
  // stay stable while a filter is active — UX parity with _renderTopCatBar)
  const seen = new Map();  // lowercase → display string (first-seen casing wins)
  _rawItems.forEach(it => {
    (it.item_categories || []).forEach(c => {
      const key = c.toLowerCase();
      if (c && !seen.has(key)) seen.set(key, c);
    });
  });

  if (!seen.size) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }

  el.classList.remove('hidden');
  const sorted = [...seen.values()].sort((a, b) => a.localeCompare(b));
  el.innerHTML = sorted.map(cat => {
    const active = _selItemCat !== null && _selItemCat.toLowerCase() === cat.toLowerCase();
    return '<button onclick="rssSelectItemCat(\'' + _esc(cat) + '\')"'
      + ' class="text-[10px] px-2 py-0.5 rounded-full border transition flex-shrink-0 '
      + (active
          ? 'bg-[#ffc220] text-[#5a3a00] border-[#ffc220] font-semibold'
          : 'border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400'
            + ' hover:border-[#ffc220] hover:text-[#995213]')
      + '" title="Filter by topic: ' + _esc(cat) + '">' + _esc(cat) + '</button>';
  }).join('');
}

// ── Map server JSON → client item format ──────────────────────────────────────
function _mapServerItems(rawItems, feed) {
  return (rawItems || []).map(it => {
    const raw = it.pub_date || '';
    const d   = raw ? new Date(raw) : null;
    const ts  = d && !isNaN(d) ? d.getTime() : 0;
    return {
      guid:           it.link || it.title || String(Math.random()),
      title:          it.title || '(No title)',
      link:           it.link  || '',
      desc:           it.description || '',
      thumbnail:      it.thumbnail   || '',
      pubDate:        raw,
      _ts:            ts,
      _date:          ts ? _fmtDate(new Date(ts).toISOString()) : '',
      _color:         feed.color,
      _source:        feed.label || feed.url,
      _feedId:        feed.id,
      _feedCategory:  feed.category || '',
      item_categories: it.categories || [],
    };
  });
}

// ── Item loading ──────────────────────────────────────────────────────────────
async function _loadFeedItems(url) {
  _showItemsLoading();
  try {
    const r    = await fetch(`/home/rss?url=${encodeURIComponent(url)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    const feed = _feeds.find(f => f.url === url) || { color:'#0053e2', label:url, id:0, category:'' };
    _rawItems = _mapServerItems(data.items, feed);
    _applyDisplay();
  } catch { _showItemsError('Could not load feed. Check the URL or try again.'); }
}

async function _loadAllItems() {
  if (!_feeds.length) {
    var _lip = document.getElementById('rss-items-panel');
    if (_lip) _lip.innerHTML =
      '<div class="p-4 text-center text-sm text-gray-400 mt-8">' +
      '<div class="text-3xl mb-2">📡</div>Add a feed to get started</div>';
    _rawItems = [];
    _applyDisplay();
    return;
  }
  _showItemsLoading();
  const results = await Promise.allSettled(
    _feeds.map(f =>
      fetch(`/home/rss?url=${encodeURIComponent(f.url)}`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(data => ({ data, feed: f }))
    )
  );
  const all = [];
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    const { data, feed } = res.value;
    if (data.error) continue;
    _mapServerItems(data.items, feed).forEach(it => all.push(it));
  }
  _rawItems = all;
  _applyDisplay();
}

function _showItemsLoading() {
  var _sil = document.getElementById('rss-items-panel');
  if (!_sil) return;
  const skel = Array.from({length: 5}, (_, i) => `
    <div class="px-3 py-2.5 border-b border-gray-100 dark:border-zinc-800 animate-pulse"
         style="animation-delay:${i * 80}ms">
      <div class="flex items-start gap-2.5">
        <div class="w-2 h-2 mt-1.5 rounded-full bg-gray-200 dark:bg-zinc-700 flex-shrink-0"></div>
        <div class="flex-1 space-y-1.5">
          <div class="h-3 bg-gray-200 dark:bg-zinc-700 rounded w-5/6"></div>
          <div class="h-3 bg-gray-100 dark:bg-zinc-800 rounded w-4/6"></div>
          <div class="h-2.5 bg-gray-100 dark:bg-zinc-800 rounded w-2/5 mt-0.5"></div>
        </div>
      </div>
    </div>`).join('');
  _sil.innerHTML = skel;
}
function _showItemsError(msg) {
  var _sie = document.getElementById('rss-items-panel');
  if (!_sie) return;                          // page navigated away
  _sie.innerHTML = `<div class="p-4 text-sm text-red-500 text-center mt-4">${_esc(msg)}</div>`;
}

// ── Single article card (shared by flat + grouped renders) ──────────────────
function _itemCard(it, idx) {
  const isRead  = _read.has(it.guid);
  const color   = it._color || '#0053e2';
  const dotGlow = isRead ? '' : `box-shadow:0 0 0 3px ${color}25;`;

  const thumbHtml = it.thumbnail
    ? `<img src="/home/img?url=${encodeURIComponent(it.thumbnail)}" alt=""
            style="width:44px;height:44px;object-fit:cover;border-radius:8px;flex-shrink:0;"
            onerror="this.style.display='none'">`
    : '';

  return `
    <button class="rss-item w-full text-left px-3 py-2.5
                   border-b border-gray-100 dark:border-zinc-800/80
                   hover:bg-blue-50/50 dark:hover:bg-zinc-800/60 transition-colors group
                   ${isRead ? 'opacity-80' : ''}"
            style="border-left:3px solid ${isRead ? 'transparent' : color};"
            data-guid="${_esc(it.guid)}" data-idx="${idx}"
            onclick="rssOpenItem(${idx})">
      <div class="flex items-start gap-2.5">
        <span class="rss-dot mt-1.5 rounded-full flex-shrink-0 transition-all
                     ${isRead ? 'w-1.5 h-1.5 bg-gray-200 dark:bg-zinc-700' : 'w-2 h-2'}"
              style="${isRead ? '' : 'background:' + color + ';' + dotGlow}"></span>
        <div class="flex-1 min-w-0">
          <p class="text-xs leading-snug line-clamp-2 transition-colors
                    group-hover:text-[#0053e2] dark:group-hover:text-blue-400
                    ${isRead
                      ? 'font-normal text-gray-500 dark:text-zinc-400'
                      : 'font-semibold text-gray-800 dark:text-zinc-100'}">
            ${_esc(it.title)}
          </p>
          <p class="mt-1 text-[10px] flex items-center gap-1 flex-wrap">
            ${it._source
              ? `<span class="font-medium px-1.5 py-0.5 rounded-full text-white text-[9px]"
                       style="background:${color};"
                 >${_esc(it._source)}</span>`
              : ''}
            ${it._date ? `<span class="text-gray-400 dark:text-zinc-500">${_esc(it._date)}</span>` : ''}
          </p>
        </div>
        ${thumbHtml}
      </div>
    </button>`;
}

// ── Render item cards (flat or grouped by category) ──────────────────────────
function _renderItems(items) {
  const panel = document.getElementById('rss-items-panel');
  if (!panel) return;                         // page navigated away mid-fetch
  if (!items.length) {
    panel.innerHTML = '<div class="p-4 text-sm text-gray-400 text-center mt-4">No articles found.</div>';
    return;
  }

  if (_groupMode === 'category') {
    // Bucket items into their feed category, preserving flat sort order within each group
    const groups = new Map();
    items.forEach((it, idx) => {
      const cat = it._feedCategory || '';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push({ it, idx });
    });
    // Sort groups alphabetically; empty string (“Uncategorized”) goes last
    const sorted = [...groups.entries()].sort(([a], [b]) => {
      if (!a && b)  return  1;
      if (a  && !b) return -1;
      return a.localeCompare(b);
    });
    panel.innerHTML = sorted.map(([cat, entries]) =>
      `<div class="px-3 py-2 text-[10px] font-bold uppercase tracking-widest
                   text-gray-500 dark:text-zinc-400
                   bg-gradient-to-r from-gray-100 to-transparent
                   dark:from-zinc-800/80 dark:to-transparent
                   border-b border-gray-200 dark:border-zinc-700
                   sticky top-0 z-10 flex items-center gap-2">
        <span class="w-4 h-px bg-gray-300 dark:bg-zinc-600 flex-shrink-0"></span>
        ${_esc(cat || 'Uncategorized')}
      </div>` +
      entries.map(({ it, idx }) => _itemCard(it, idx)).join('')
    ).join('');
    return;
  }

  // Flat render (default)
  panel.innerHTML = items.map((it, idx) => _itemCard(it, idx)).join('');
}

// ── Open item (preview) ───────────────────────────────────────────────────────
function rssOpenItem(idx) {
  const it = _items[idx];
  if (!it) return;
  _markRead(it.guid);
  document.querySelectorAll('.rss-item').forEach((el, i) => {
    el.classList.toggle('bg-blue-50', i === idx);
    el.classList.toggle('dark:bg-zinc-700/50', i === idx);
  });
  _showPreview(it);
}

function _showPreview(it) {
  const panel = document.getElementById('rss-preview-panel');
  if (!panel) return;                         // page navigated away
  const safe = (it.desc || '')
    .replace(/<(script|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|form)(\s[^>]*)?\/?>/gi, '')
    .trim();
  const textLen = safe.replace(/<[^>]+>/g, '').trim().length;
  const canLoad = it.link && textLen < 400;
  const thumbHtml = it.thumbnail
    ? `<img src="/home/img?url=${encodeURIComponent(it.thumbnail)}" alt=""
            class="w-full max-h-64 object-cover rounded-xl mb-5 bg-gray-100 dark:bg-zinc-800"
            onerror="this.style.display='none'">`
    : '';
  const favicon = _rssFaviconUrl(it.link || '');
  const sourceChip = it._source
    ? `<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full text-white"
             style="background:${_esc(it._color || '#0053e2')};">
        ${favicon ? `<img src="${_esc(favicon)}" width="12" height="12" alt="" style="border-radius:2px;"
             onerror="this.style.display='none'">` : ''}
        ${_esc(it._source)}
      </span>`
    : '';
  panel.innerHTML = `
    <div class="max-w-2xl mx-auto px-6 py-6">
      <div class="flex items-center gap-2 flex-wrap text-[11px] text-gray-400 dark:text-zinc-500 mb-4">
        ${sourceChip}
        ${it._date ? `<span class="text-gray-400 dark:text-zinc-500">${_esc(it._date)}</span>` : ''}
      </div>
      <h2 class="text-2xl font-bold text-gray-900 dark:text-zinc-100 leading-snug mb-5">${_esc(it.title)}</h2>
      ${thumbHtml}
      <div id="rss-preview-body"
           class="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-zinc-300
                  leading-relaxed mb-5 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-2
                  [&_a]:text-[#0053e2] [&_a:hover]:underline">
        ${safe || '<p class="text-gray-400 italic">No preview in feed — load the full article below.</p>'}
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        ${it.link ? `<a href="${_esc(it.link)}" target="_blank" rel="noopener noreferrer"
           class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold
                  bg-[#0053e2] text-white rounded-lg hover:bg-[#003eb3] transition">
          Open Article <span aria-hidden="true">↗</span></a>` : ''}
        ${canLoad ? `<button id="rss-load-full-btn" onclick="_rssLoadFullArticle('${_esc(it.link)}')"
                    class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold
                           border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-200
                           rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition">
          📖 Load Full Article</button>` : ''}
      </div>
    </div>`;
}

async function _rssLoadFullArticle(url) {
  const btn  = document.getElementById('rss-load-full-btn');
  const body = document.getElementById('rss-preview-body');
  if (!btn || !body) return;
  btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const r    = await fetch(`/home/rss/article?url=${encodeURIComponent(url)}`);
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'fetch failed');
    if (!data.paragraphs?.length) {
      body.innerHTML = '<p class="text-gray-400 italic">Could not extract article content. Try opening it directly.</p>';
      btn.remove(); return;
    }
    body.innerHTML = data.paragraphs.map(p => `<p>${_esc(p)}</p>`).join('');
    btn.remove();
  } catch {
    body.insertAdjacentHTML('afterend',
      '<p class="text-red-400 text-sm mt-2">Could not load article. Try opening it directly.</p>');
    btn.disabled = false; btn.textContent = '📖 Load Full Article';
  }
}

// ── Add / Delete / Edit feeds ─────────────────────────────────────────────────
function _initAddForm() {
  const form = document.getElementById('rss-add-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const urlIn = document.getElementById('rss-add-url');
    const lblIn = document.getElementById('rss-add-label');
    const catIn = document.getElementById('rss-add-category');
    const errEl = document.getElementById('rss-add-err');
    const btn   = document.getElementById('rss-add-btn');
    const url   = urlIn.value.trim();
    if (!url) return;
    if (!_pid) {
      errEl.textContent = 'Page not ready — please try again.';
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const r = await fetch(`/home/rss-reader/${_pid}/feeds/add`, {
        method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body: new URLSearchParams({ url, label: lblIn.value.trim(), category: catIn.value.trim() }),
      });
      if (r.redirected || !r.ok) {
        throw new Error(r.redirected ? 'Session expired — please refresh.' : await r.text());
      }
      _feeds = await r.json();
      urlIn.value = ''; lblIn.value = ''; catIn.value = '';
      _renderFeedList();
      const newest = _feeds[_feeds.length - 1];
      if (newest) rssSelectFeed(newest.id);
    } catch {
      errEl.textContent = 'Could not add feed — check the URL.';
      errEl.classList.remove('hidden');
    } finally { btn.disabled = false; btn.textContent = '+ Add Feed'; }
  });
}

async function rssDeleteFeed(e, feedId) {
  e.stopPropagation();
  const feed  = _feeds.find(f => f.id === feedId);
  const rowEl = document.querySelector(`[data-feed-id="${feedId}"]`);
  if (!rowEl) return;

  // Remove any existing confirm bar (prevents duplicates on double-click)
  rowEl.querySelector('.rss-del-confirm')?.remove();

  // Inject inline confirmation bar — no native confirm() dialog
  const bar = document.createElement('div');
  bar.className = 'rss-del-confirm flex items-center gap-2 px-2 py-1.5'
    + ' bg-red-50 dark:bg-red-900/20 border-t border-red-100 dark:border-red-800/40';
  bar.innerHTML = `
    <span class="flex-1 text-[10px] text-red-600 dark:text-red-400 truncate">
      Remove <strong>${_esc(feed?.label || feed?.url || 'this feed')}</strong>?
    </span>
    <button type="button" data-rss-del-yes
            class="text-[10px] px-2 py-0.5 bg-red-500 text-white rounded
                   hover:bg-red-600 transition font-semibold">Remove</button>
    <button type="button" data-rss-del-no
            class="text-[10px] px-2 py-0.5 border border-gray-300 dark:border-zinc-600
                   rounded text-gray-600 dark:text-zinc-300
                   hover:bg-gray-100 dark:hover:bg-zinc-800 transition">Keep</button>`;

  bar.querySelector('[data-rss-del-no]').addEventListener('click', () => bar.remove());
  bar.querySelector('[data-rss-del-yes]').addEventListener('click', async () => {
    bar.remove();
    if (!_pid) { _rssToast('Page not ready — please refresh.', true); return; }
    try {
      const r  = await fetch(`/home/rss-reader/${_pid}/feeds/${feedId}/delete`, {
        method: 'POST', credentials: 'same-origin',
      });
      const ct = r.headers.get('Content-Type') || '';
      // r.redirected catches auth-middleware 302→login (fetch follows → 200 HTML)
      if (r.redirected || !r.ok || !ct.includes('application/json')) {
        throw new Error((r.redirected || r.status === 401) ? 'session_expired' : 'server_error');
      }
      _feeds = await r.json();
      _renderFeedList();
      if (_selFeed === feedId) rssSelectAll();
    } catch (err) {
      console.error('[rss] rssDeleteFeed:', err);
      _renderFeedList();
      _rssToast(
        err.message === 'session_expired'
          ? 'Session expired — please refresh the page.'
          : 'Could not remove feed — please try again.',
        true
      );
    }
  });

  rowEl.appendChild(bar);
}

function rssEditFeed(feedId) {
  const el = document.getElementById(`rss-edit-${feedId}`);
  el?.classList.toggle('hidden');
}

async function rssUpdateFeed(e, feedId) {
  e.preventDefault();
  const form = e.target;
  const btn  = form.querySelector('[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  let saveOk = false;
  try {
    // Safely read form fields (guards against edge-case naming conflicts)
    const labelEl    = form.elements.namedItem('label');
    const categoryEl = form.elements.namedItem('category');
    const colorEl   = form.elements.namedItem('color');
    const label    = labelEl    ? labelEl.value.trim()    : '';
    const category = categoryEl ? categoryEl.value.trim() : '';
    const color    = colorEl   ? colorEl.value.trim()   : '#0053e2';

    const r = await fetch(`/home/rss-reader/${_pid}/feeds/${feedId}/update`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ label, category, color }),
    });
    const ct = r.headers.get('Content-Type') || '';

    if (r.redirected) {
      _rssToast('Session expired — please refresh the page.', true);
      return;
    }
    if (!r.ok || !ct.includes('application/json')) {
      let detail = `HTTP ${r.status}`;
      try { const j = await r.json(); detail = j.error || detail; } catch (_) {}
      console.error('[rss] rssUpdateFeed server error:', detail);
      _rssToast('Could not save changes — ' + detail, true);
      return;
    }

    // ✅ HTTP success — show toast immediately so the user gets feedback
    //    even if the re-render below throws
    _feeds = await r.json();
    saveOk = true;
    _rssToast('Feed name saved!', false);
    rssEditFeed(feedId); // collapse the edit form
  } catch (err) {
    // Only reaches here for network errors (fetch itself threw) or unexpected JS errors
    // before / during the HTTP call.
    console.error('[rss] rssUpdateFeed fetch error:', err);
    if (!saveOk) _rssToast('Could not save changes — check your connection.', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }

  // Post-save re-render — in its own try so a rendering bug doesn’t mask a
  // successful save (the toast above already confirmed success).
  try {
    _renderFeedList();
    _rawItems = _rawItems.map(it => {
      if (it._feedId !== feedId) return it;
      const f = _feeds.find(f => f.id === feedId);
      return f ? { ...it, _color: f.color, _source: f.label || f.url, _feedCategory: f.category || '' } : it;
    });
    _applyDisplay();
  } catch (renderErr) {
    console.error('[rss] rssUpdateFeed render error (save still succeeded):', renderErr);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('rss-page-root');
  if (root) initRssPage(parseInt(root.dataset.pageId, 10));
});
