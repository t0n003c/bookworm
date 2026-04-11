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

// ── Module state ───────────────────────────────────────────────────
let _pid      = 0;         // page_id
let _feeds    = [];        // [{id,url,label,color,sort_order}]
let _selFeed  = null;      // feed id or null = All
let _items    = [];        // currently displayed items
let _read     = new Set(); // guids marked read (client truth)
let _initEl   = null;      // DOM ref of the #rss-page-root that was last initialised

// ── Init ─────────────────────────────────────────────────────────────────────
async function initRssPage(pageId) {
  // Guard against double-init on the *same DOM element*.
  // Each innerHTML swap creates brand-new DOM nodes, so comparing element
  // references (not just pageId) correctly re-initialises after navigate-away
  // then navigate-back to the same page.
  const root = document.getElementById('rss-page-root');
  if (!root || _initEl === root) return;
  _initEl = root;

  _pid     = pageId;
  _read    = new Set();   // reset read state for new page context
  _feeds   = [];
  _items   = [];
  _selFeed = null;
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

// ── Map server JSON → client item format ─────────────────────────────────────
// The /home/rss proxy already parses RSS/Atom and returns:
//   { feed_title, items: [{title, link, description, pub_date, thumbnail}] }
// We map that to the shape _renderItems() expects.
function _mapServerItems(rawItems, color, source) {
  return (rawItems || []).map(it => {
    const raw = it.pub_date || '';
    const d   = raw ? new Date(raw) : null;
    const ts  = d && !isNaN(d) ? d.getTime() : 0;
    return {
      guid:      it.link || it.title || String(Math.random()),
      title:     it.title || '(No title)',
      link:      it.link  || '',
      desc:      it.description || '',
      thumbnail: it.thumbnail   || '',
      pubDate:   raw,
      _ts:       ts,
      _date:     d && !isNaN(d) ? _fmtDate(d.toISOString()) : '',
      _color:    color,
      _source:   source,
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
    const feed  = _feeds.find(f => f.url === url);
    const color = feed?.color || '#0053e2';
    const label = feed?.label || url;
    _items = _mapServerItems(data.items, color, label);
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
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(data => ({ data, feed: f }))
    )
  );
  const all = [];
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    const { data, feed } = res.value;
    if (data.error) continue;
    _mapServerItems(data.items, feed.color, feed.label || feed.url)
      .forEach(it => all.push(it));
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

// ── Open item (preview) ──────────────────────────────────────────────────────────────
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

  // Strip dangerous tags from feed description; keep safe HTML
  const safe = (it.desc || '')
    .replace(/<(script|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|form)(\s[^>]*)?\/>/gi, '')
    .trim();

  // Decide whether to offer "Load full article"
  // Strip all tags to get raw text length for the heuristic
  const textLen = safe.replace(/<[^>]+>/g, '').trim().length;
  const canLoad = it.link && textLen < 400;

  // Thumbnail — proxy through /home/img so Walmart firewall doesn't block it
  const thumbHtml = it.thumbnail
    ? `<img src="/home/img?url=${encodeURIComponent(it.thumbnail)}"
            alt=""
            class="w-full max-h-64 object-cover rounded-xl mb-5
                   bg-gray-100 dark:bg-zinc-800"
            onerror="this.style.display='none'">`
    : '';

  panel.innerHTML = `
    <div class="max-w-2xl mx-auto px-6 py-6">

      <div class="flex items-center gap-2 text-[11px] text-gray-400 dark:text-zinc-500 mb-3">
        <span class="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style="background:${_esc(it._color || '#0053e2')}"></span>
        ${it._source ? `<span class="font-medium text-gray-500 dark:text-zinc-400">${_esc(it._source)}</span><span>·</span>` : ''}
        <span>${it._date || ''}</span>
      </div>

      <h2 class="text-xl font-bold text-gray-900 dark:text-zinc-100 leading-snug mb-4">
        ${_esc(it.title)}
      </h2>

      ${thumbHtml}

      <div id="rss-preview-body"
           class="prose prose-sm dark:prose-invert max-w-none
                  text-gray-700 dark:text-zinc-300 leading-relaxed mb-5
                  [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-2
                  [&_a]:text-[#0053e2] [&_a:hover]:underline">
        ${safe || '<p class="text-gray-400 italic">No preview in feed — load the full article below.</p>'}
      </div>

      <div class="flex items-center gap-3 flex-wrap">
        ${it.link ? `
          <a href="${_esc(it.link)}" target="_blank" rel="noopener noreferrer"
             class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold
                    bg-[#0053e2] text-white rounded-lg hover:bg-[#003eb3] transition">
            Open Article <span aria-hidden="true">↗</span>
          </a>` : ''}
        ${canLoad ? `
          <button id="rss-load-full-btn"
                  onclick="_rssLoadFullArticle('${_esc(it.link)}')"
                  class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold
                         border border-gray-300 dark:border-zinc-600
                         text-gray-700 dark:text-zinc-200 rounded-lg
                         hover:bg-gray-50 dark:hover:bg-zinc-800 transition">
            📖 Load Full Article
          </button>` : ''}
      </div>
    </div>`;
}

async function _rssLoadFullArticle(url) {
  const btn  = document.getElementById('rss-load-full-btn');
  const body = document.getElementById('rss-preview-body');
  if (!btn || !body) return;

  btn.disabled    = true;
  btn.textContent = 'Loading…';

  try {
    const r    = await fetch(`/home/rss/article?url=${encodeURIComponent(url)}`);
    const data = await r.json();

    if (!r.ok || data.error) throw new Error(data.error || 'fetch failed');

    if (!data.paragraphs || !data.paragraphs.length) {
      body.innerHTML = '<p class="text-gray-400 italic">Could not extract article content. Try opening it directly.</p>';
      btn.remove();
      return;
    }

    body.innerHTML = data.paragraphs
      .map(p => `<p>${_esc(p)}</p>`)
      .join('');
    btn.remove();
  } catch {
    body.insertAdjacentHTML(
      'afterend',
      '<p class="text-red-400 text-sm mt-2">Could not load article. Try opening it directly.</p>'
    );
    btn.disabled    = false;
    btn.textContent = '📖 Load Full Article';
  }
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
