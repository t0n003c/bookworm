/* home-page-rss.js — RSS Reader page (BookWorm).
   Manages: feed list, item fetching, read state, preview panel.
   Server APIs:
     GET  /home/rss-reader/{pid}/feeds
     POST /home/rss-reader/{pid}/feeds/add
     POST /home/rss-reader/{pid}/feeds/{id}/delete
     GET  /home/rss-reader/{pid}/read
     POST /home/rss-reader/{pid}/read
     GET  /home/rss?url=...   (existing proxy — returns RSS/Atom XML)
*/
'use strict';

// ── Module state ──────────────────────────────────────────────────────────────
let _pid      = 0;         // page_id
let _feeds    = [];        // [{id,url,label,color,sort_order}]
let _selFeed  = null;      // feed id or null = All
let _items    = [];        // currently displayed items
let _read     = new Set(); // guids marked read (client truth)

// ── Init ──────────────────────────────────────────────────────────────────────
async function initRssPage(pageId) {
  _pid  = pageId;
  // Bootstrap read set from server (then localStorage as a fast local cache)
  await _syncReadFromServer();
  await _loadFeeds();
  _initAddForm();
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;')
                        .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _post(url, body = {}) {
  return fetch(url, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

function _fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

// ── Read state ────────────────────────────────────────────────────────────────
async function _syncReadFromServer() {
  try {
    const r = await fetch(`/home/rss-reader/${_pid}/read`);
    if (!r.ok) return;
    const guids = await r.json();
    guids.forEach(g => _read.add(g));
  } catch { /* network blip — use empty set */ }
}

function _markRead(guid) {
  if (_read.has(guid)) return;
  _read.add(guid);
  // Update item card immediately
  const card = document.querySelector(`[data-guid="${CSS.escape(guid)}"]`);
  if (card) {
    card.classList.remove('bw-rss-unread');
    card.querySelector('.rss-dot')?.classList.add('invisible');
  }
  _updateUnreadBadge();
  // Fire-and-forget server sync
  fetch(`/home/rss-reader/${_pid}/read`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([guid]),
  }).catch(() => {});
}

function _updateUnreadBadge() {
  const total  = _items.filter(it => !_read.has(it.guid)).length;
  const badge  = document.getElementById('rss-unread-badge');
  if (!badge) return;
  if (total > 0) {
    badge.textContent = `${total} unread`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ── Mark all read ─────────────────────────────────────────────────────────────
async function rssMarkAllRead() {
  const unread = _items.filter(it => !_read.has(it.guid)).map(it => it.guid);
  if (!unread.length) return;
  unread.forEach(g => _read.add(g));
  _renderItems(_items);
  _updateUnreadBadge();
  await fetch(`/home/rss-reader/${_pid}/read`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(unread),
  }).catch(() => {});
}

// ── Feeds list ────────────────────────────────────────────────────────────────
async function _loadFeeds() {
  try {
    const r = await fetch(`/home/rss-reader/${_pid}/feeds`);
    if (!r.ok) return;
    _feeds = await r.json();
  } catch { _feeds = []; }
  _renderFeedList();
  // Auto-load All Feeds on first open
  rssSelectAll();
}

function _renderFeedList() {
  const list = document.getElementById('rss-feed-list');
  if (!list) return;
  if (!_feeds.length) {
    list.innerHTML = '<p class="text-[11px] text-gray-400 dark:text-zinc-500 text-center py-3 px-2">No feeds yet</p>';
    return;
  }
  list.innerHTML = _feeds.map(f => `
    <div class="flex items-center gap-1 group rounded-lg px-1 py-0.5
                hover:bg-gray-100 dark:hover:bg-zinc-800 transition
                ${_selFeed === f.id ? 'bg-blue-50 dark:bg-zinc-700' : ''}"
         data-feed-id="${f.id}">
      <button onclick="rssSelectFeed(${f.id})"
              class="flex-1 text-left flex items-center gap-2 py-1 text-sm truncate
                     ${_selFeed === f.id ? 'font-semibold text-[#0053e2] dark:text-blue-300' : 'text-gray-700 dark:text-zinc-200'}">
        <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${_esc(f.color)}"></span>
        <span class="truncate">${_esc(f.label || f.url)}</span>
      </button>
      <button onclick="rssDeleteFeed(event,${f.id})"
              title="Remove feed"
              class="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500
                     transition text-xs px-1 flex-shrink-0" aria-label="Remove feed">✕</button>
    </div>
  `).join('');
}

// ── Feed selection ────────────────────────────────────────────────────────────
async function rssSelectAll() {
  _selFeed = null;
  _highlightFeedButtons();
  document.getElementById('rss-items-title').textContent = 'All Feeds';
  await _loadAllItems();
}

async function rssSelectFeed(feedId) {
  _selFeed = feedId;
  _highlightFeedButtons();
  const feed = _feeds.find(f => f.id === feedId);
  document.getElementById('rss-items-title').textContent =
    _esc(feed?.label || feed?.url || 'Feed');
  if (feed) await _loadFeedItems(feed.url);
}

function _highlightFeedButtons() {
  // All Feeds button
  const allBtn = document.getElementById('rss-all-btn');
  if (allBtn) {
    allBtn.classList.toggle('bg-gray-200',      _selFeed === null);
    allBtn.classList.toggle('dark:bg-zinc-700', _selFeed === null);
    allBtn.classList.toggle('font-semibold',    _selFeed === null);
  }
  // Individual feed rows
  document.querySelectorAll('[data-feed-id]').forEach(el => {
    const isActive = String(el.dataset.feedId) === String(_selFeed);
    el.classList.toggle('bg-blue-50',           isActive);
    el.classList.toggle('dark:bg-zinc-700',     isActive);
    const btn = el.querySelector('button:first-child');
    if (btn) {
      btn.classList.toggle('font-semibold',       isActive);
      btn.classList.toggle('text-[#0053e2]',      isActive);
      btn.classList.toggle('dark:text-blue-300',  isActive);
    }
  });
}

// ── Item loading ──────────────────────────────────────────────────────────────
async function _loadFeedItems(url) {
  _showItemsLoading();
  try {
    const r   = await fetch(`/home/rss?url=${encodeURIComponent(url)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const xml  = await r.text();
    const feed = _feeds.find(f => f.url === url);
    const color = feed?.color || '#0053e2';
    const label = feed?.label || url;
    _items = _parseRss(xml).map(it => ({ ...it, _color: color, _source: label }));
    _renderItems(_items);
    _updateUnreadBadge();
  } catch (e) {
    _showItemsError('Could not load feed. Check the URL or try again.');
  }
}

async function _loadAllItems() {
  if (!_feeds.length) {
    document.getElementById('rss-items-panel').innerHTML =
      '<div class="p-4 text-center text-sm text-gray-400 mt-8">' +
      '<div class="text-3xl mb-2">📡</div>Add a feed to get started</div>';
    _items = [];
    _updateUnreadBadge();
    return;
  }
  _showItemsLoading();
  const results = await Promise.allSettled(
    _feeds.map(f =>
      fetch(`/home/rss?url=${encodeURIComponent(f.url)}`)
        .then(r => r.ok ? r.text() : Promise.reject(r.status))
        .then(xml => ({ xml, feed: f }))
    )
  );
  const all = [];
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    const { xml, feed } = res.value;
    _parseRss(xml).forEach(it =>
      all.push({ ...it, _color: feed.color, _source: feed.label || feed.url })
    );
  }
  // Sort newest-first
  all.sort((a, b) => (b._ts || 0) - (a._ts || 0));
  _items = all;
  _renderItems(all);
  document.getElementById('rss-all-count').textContent =
    all.length > 0 ? String(all.length) : '';
  _updateUnreadBadge();
}

function _showItemsLoading() {
  document.getElementById('rss-items-panel').innerHTML =
    '<div class="p-4 text-sm text-gray-400 text-center mt-8 animate-pulse">Loading…</div>';
}
function _showItemsError(msg) {
  document.getElementById('rss-items-panel').innerHTML =
    `<div class="p-4 text-sm text-red-500 text-center mt-4">${_esc(msg)}</div>`;
}

// ── RSS / Atom parser ─────────────────────────────────────────────────────────
function _parseRss(xmlText) {
  let doc;
  try { doc = new DOMParser().parseFromString(xmlText, 'text/xml'); }
  catch { return []; }

  const rssItems = doc.querySelectorAll('item');
  if (rssItems.length) return [...rssItems].map(_parseRssItem);

  const atomEntries = doc.querySelectorAll('entry');
  return [...atomEntries].map(_parseAtomEntry);
}

function _parseRssItem(el) {
  const t = tag => el.querySelector(tag)?.textContent?.trim() ?? '';
  const raw  = t('pubDate') || t('dc\\:date') || t('date');
  const d    = raw ? new Date(raw) : null;
  return {
    guid:    t('guid') || t('link') || String(Math.random()),
    title:   t('title') || '(No title)',
    link:    t('link'),
    desc:    t('description') || t('summary'),
    pubDate: raw,
    _ts:     d?.getTime() ?? 0,
    _date:   d ? _fmtDate(d.toISOString()) : '',
  };
}

function _parseAtomEntry(el) {
  const t   = tag => el.querySelector(tag)?.textContent?.trim() ?? '';
  const lnk = el.querySelector('link[rel="alternate"]')?.getAttribute('href')
            || el.querySelector('link')?.getAttribute('href')
            || t('id');
  const raw = t('updated') || t('published');
  const d   = raw ? new Date(raw) : null;
  return {
    guid:    t('id') || lnk || String(Math.random()),
    title:   t('title') || '(No title)',
    link:    lnk,
    desc:    t('summary') || t('content'),
    pubDate: raw,
    _ts:     d?.getTime() ?? 0,
    _date:   d ? _fmtDate(d.toISOString()) : '',
  };
}

// ── Render item cards ─────────────────────────────────────────────────────────
function _renderItems(items) {
  const panel = document.getElementById('rss-items-panel');
  if (!items.length) {
    panel.innerHTML = '<div class="p-4 text-sm text-gray-400 text-center mt-4">No articles found.</div>';
    return;
  }
  panel.innerHTML = items.map((it, idx) => {
    const isRead = _read.has(it.guid);
    return `
      <button class="rss-item w-full text-left px-3 py-2.5
                     border-b border-gray-100 dark:border-zinc-800
                     hover:bg-gray-50 dark:hover:bg-zinc-800 transition group
                     ${isRead ? '' : 'bw-rss-unread'}"
              data-guid="${_esc(it.guid)}" data-idx="${idx}"
              onclick="rssOpenItem(${idx})">
        <div class="flex items-start gap-2">
          <span class="rss-dot w-1.5 h-1.5 mt-1.5 rounded-full flex-shrink-0 ${isRead ? 'invisible' : ''}"
                style="background:${_esc(it._color || '#0053e2')}"></span>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold leading-snug text-gray-800 dark:text-zinc-100
                      line-clamp-2 group-hover:text-[#0053e2] transition
                      ${isRead ? 'font-normal text-gray-500 dark:text-zinc-400' : ''}">
              ${_esc(it.title)}
            </p>
            <p class="mt-0.5 text-[10px] text-gray-400 dark:text-zinc-500 truncate">
              ${it._source ? _esc(it._source) + (it._date ? ' · ' : '') : ''}${it._date}
            </p>
          </div>
        </div>
      </button>`;
  }).join('');
}

// ── Open item (preview) ───────────────────────────────────────────────────────
function rssOpenItem(idx) {
  const it = _items[idx];
  if (!it) return;
  _markRead(it.guid);

  // Highlight active item
  document.querySelectorAll('.rss-item').forEach((el, i) => {
    el.classList.toggle('bg-blue-50', i === idx);
    el.classList.toggle('dark:bg-zinc-700/50', i === idx);
  });

  _showPreview(it);
}

function _showPreview(it) {
  const panel = document.getElementById('rss-preview-panel');
  // Strip script/iframe tags from description (basic sanitize)
  const safe  = (it.desc || '').replace(/<(script|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '');
  panel.innerHTML = `
    <div class="max-w-2xl mx-auto px-6 py-6">

      <div class="flex items-center gap-2 text-[11px] text-gray-400 dark:text-zinc-500 mb-3">
        ${it._source ? `<span class="font-medium text-gray-500 dark:text-zinc-400">${_esc(it._source)}</span><span>·</span>` : ''}
        <span>${it._date || ''}</span>
      </div>

      <h2 class="text-xl font-bold text-gray-900 dark:text-zinc-100 leading-snug mb-4">
        ${_esc(it.title)}
      </h2>

      ${it.link ? `
        <a href="${_esc(it.link)}" target="_blank" rel="noopener noreferrer"
           class="inline-flex items-center gap-1.5 px-4 py-2 mb-5 text-sm font-semibold
                  bg-[#0053e2] text-white rounded-lg hover:bg-[#003eb3] transition">
          Open Article <span aria-hidden="true">↗</span>
        </a>` : ''}

      <div class="prose prose-sm dark:prose-invert max-w-none
                  text-gray-700 dark:text-zinc-300 leading-relaxed
                  [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-2
                  [&_a]:text-[#0053e2] [&_a:hover]:underline">
        ${safe || '<p class="text-gray-400 italic">No preview available — click Open Article to read.</p>'}
      </div>
    </div>`;
}

// ── Add / Delete feeds ────────────────────────────────────────────────────────
function _initAddForm() {
  const form = document.getElementById('rss-add-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const urlIn = document.getElementById('rss-add-url');
    const lblIn = document.getElementById('rss-add-label');
    const errEl = document.getElementById('rss-add-err');
    const btn   = document.getElementById('rss-add-btn');
    const url   = urlIn.value.trim();
    if (!url) return;

    errEl.classList.add('hidden');
    btn.disabled    = true;
    btn.textContent = 'Adding…';
    try {
      const r = await fetch(`/home/rss-reader/${_pid}/feeds/add`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url, label: lblIn.value.trim() }),
      });
      if (!r.ok) throw new Error(await r.text());
      _feeds = await r.json();
      urlIn.value = '';
      lblIn.value = '';
      _renderFeedList();
      // Auto-select the newly added feed
      const newest = _feeds[_feeds.length - 1];
      if (newest) rssSelectFeed(newest.id);
    } catch (err) {
      errEl.textContent = 'Could not add feed — check the URL.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled    = false;
      btn.textContent = '+ Add Feed';
    }
  });
}

async function rssDeleteFeed(e, feedId) {
  e.stopPropagation();
  const feed = _feeds.find(f => f.id === feedId);
  if (!confirm(`Remove "${feed?.label || feed?.url || 'this feed'}"?`)) return;
  try {
    const r = await fetch(`/home/rss-reader/${_pid}/feeds/${feedId}/delete`, {
      method: 'POST', credentials: 'same-origin',
    });
    if (!r.ok) throw new Error();
    _feeds = await r.json();
    _renderFeedList();
    if (_selFeed === feedId) rssSelectAll();
  } catch {
    alert('Could not remove feed.');
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('rss-page-root');
  if (root) initRssPage(parseInt(root.dataset.pageId, 10));
});
