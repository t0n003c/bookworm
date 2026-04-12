/* home-widget-rss.js — multi-feed RSS/Atom widget with thumbnails, categories, grouping.
   Fetches via /home/rss proxy (server-side, Walmart-proxy-aware).
   Called from initHomeWidgets() in home-widgets.js.
*/
'use strict';

// ── Palette & utilities ───────────────────────────────────────────────────────

const _RSS_PALETTE = ['#0053e2','#2a8703','#7c3aed','#0891b2','#be185d','#ea1100','#995213'];

function _rssEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;')
                        .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _rssStripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g,' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/\s+/g,' ').trim();
}

function _rssDate(raw) {
  if (!raw) return '';
  try {
    const d    = new Date(raw);
    if (isNaN(d)) return raw.slice(0,16);
    const diff = (Date.now() - d) / 1000;
    if (diff < 60)     return 'just now';
    if (diff < 3600)   return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400)  return `${Math.floor(diff/3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  } catch { return raw.slice(0,16); }
}

// ── Read / unread tracking ───────────────────────────────────────────────────
// Persisted in localStorage so state survives page reloads.
// Capped at 1 000 links (newest-first eviction) so storage never bloats.

function _rssKey(widgetId) { return `bw-rss-read-${widgetId}`; }

function _rssGetRead(widgetId) {
  try { return new Set(JSON.parse(localStorage.getItem(_rssKey(widgetId)) || '[]')); }
  catch { return new Set(); }
}

function _rssSetRead(widgetId, set) {
  try {
    let arr = [...set];
    if (arr.length > 1000) arr = arr.slice(arr.length - 1000); // evict oldest
    localStorage.setItem(_rssKey(widgetId), JSON.stringify(arr));
  } catch { /* quota — silently skip */ }
}

/** Update the count + mark-all button in the tabs row (no full re-render). */
/** Hide or show items that have .rss-is-read, based on el._rssHideRead. */
function _rssApplyReadFilter(el) {
  const hide = el._rssHideRead === true;
  el.querySelectorAll('[data-rss-link]').forEach(node => {
    if (node.classList.contains('rss-is-read')) {
      node.style.display = hide ? 'none' : '';
    }
  });
  // Keep the toggle button label in sync
  const toggleBtn = el.querySelector('.rss-toggle-read');
  if (toggleBtn) toggleBtn.textContent = hide ? 'Show read' : 'Hide read';
}

/** Called from the "Hide / Show read" button in the tabs row. */
function rssToggleRead(btn) {
  const el = btn.closest('.rss-widget');
  if (!el) return;
  el._rssHideRead = !el._rssHideRead;
  _rssApplyReadFilter(el);
}

/** No-op count refresh — buttons are static; just reapply the filter. */
function _rssUpdateCountBar(el) { _rssApplyReadFilter(el); }

/** Open the link for card-style items (whole card is a <div>, title <a> handles
 *  its own clicks; this handles clicks on the thumb / padding area). */
function _rssNav(e, el) {
  if (e.target.closest('a, [data-rss-unmark]')) return;
  window.open(el.dataset.rssLink, '_blank', 'noopener noreferrer');
}

/** Mark a single item as unread (↩ button onclick). */
function rssUnmarkItem(btn) {
  btn.style.display = 'none';
  const node = btn.closest('[data-rss-link]');
  if (!node) return;
  node.classList.remove('opacity-50', 'rss-is-read');
  const href     = node.dataset.rssLink;
  const el       = node.closest('.rss-widget');
  const widgetId = el?.closest('[data-widget-id]')?.dataset.widgetId;
  if (!widgetId) return;
  const s = _rssGetRead(widgetId);
  s.delete(href);
  _rssSetRead(widgetId, s);
  // Item is now unread — always show it regardless of the hide-read filter
  node.style.display = '';
  _rssUpdateCountBar(el);
}

/** Called from inline onclick on the tabs-row "Mark all read" button. */
function _rssMarkAllRead(btn) {
  const el = btn?.closest('.rss-widget');
  if (!el || !el._rssAllItems) return;
  const widgetId = el.closest('[data-widget-id]')?.dataset.widgetId;
  if (!widgetId) return;
  const set = _rssGetRead(widgetId);
  el._rssAllItems.forEach(it => { if (it.link) set.add(it.link); });
  _rssSetRead(widgetId, set);
  // Dim every item and reveal its ↩ button
  el.querySelectorAll('[data-rss-link]').forEach(node => {
    node.classList.add('opacity-50', 'rss-is-read');
    node.querySelector('[data-rss-unmark]')?.style.removeProperty('display');
  });
  _rssUpdateCountBar(el, 0);
}

// ── Source badge & feed container ────────────────────────────────────────────

/** Dot + colored text label shown on each compact row when compact_label='1'.
 * Uses a tinted pill so the badge is visible regardless of accent brightness.
 * Dark/light luminance check ensures text is always readable on any background.
 */
function _rssBadgeDot(label, color) {
  const c   = _rssEsc(color || '#6b7280');
  const tc  = _rssTextOnWhite(color);  // readable text color (dark if accent is light)
  return `<span class="inline-flex items-center gap-1 text-[10px] font-semibold leading-none flex-shrink-0"
               style="padding:1px 5px;border-radius:999px;background:${c}22;color:${tc}">
    <span style="width:5px;height:5px;border-radius:50%;background:${c};display:inline-block;flex-shrink:0;"></span>${_rssEsc(label)}
  </span>`;
}

/**
 * Returns a readable text color for content placed on a white/light background.
 * If the accent is very light (e.g. yellow #e4de1b), fall back to gray-700
 * so text is legible. The accent dot/border still uses the full color.
 */
function _rssTextOnWhite(hex) {
  const h = (hex || '#6b7280').replace('#', '');
  const r = parseInt(h.slice(0,2), 16) || 0;
  const g = parseInt(h.slice(2,4), 16) || 0;
  const b = parseInt(h.slice(4,6), 16) || 0;
  // Perceived luminance (0-255 scale); > 160 = too light for white background
  return (0.299*r + 0.587*g + 0.114*b) > 160 ? '#374151' : `#${h}`;
}

/**
 * Per-feed bubble container (compact_label='wrap').
 * Groups all items from one feed in a rounded card with a coloured header.
 * Per-item labels are hidden inside — the header already identifies the source.
 *
 * Visual design: thick 4px left accent border at FULL opacity so it's
 * unmistakably visible even for very light accent colors like yellow.
 * Text color falls back to dark gray when accent is too light for white bg.
 * URL fragment shown as subtitle to differentiate same-named feeds.
 */
function _rssFeedContainer(feed, items, showThumb, readSet) {
  const raw  = feed.color || '#6b7280';
  const c    = _rssEsc(raw);
  const tc   = _rssTextOnWhite(raw);   // dark gray for light accents, accent for dark
  const name = _rssEsc(feed.label || feed.url);

  // Extract URL path fragment as subtitle (e.g. '@StephanieSoo' from YouTube URL).
  // Only shown when it's meaningfully different from the label — helps users
  // distinguish feeds that share the same user-defined label (e.g. both 'Youtube').
  let subtitle = '';
  try {
    const fragment = new URL(feed.url).pathname.replace(/\/$/, '').split('/').pop();
    if (fragment && fragment.toLowerCase() !== (feed.label || '').toLowerCase()) {
      subtitle = `<span class="text-[9px] text-gray-400 dark:text-zinc-500 ml-1 font-normal">${_rssEsc(fragment)}</span>`;
    }
  } catch { /* non-URL feeds — skip subtitle */ }

  const rows = items.map(it => _rssItemCompact(it, showThumb, readSet, false)).join('');
  return `
  <div class="rounded-r-xl mb-2 last:mb-0 overflow-hidden"
       style="border:1px solid ${c}33; border-left:4px solid ${c}; background:transparent;">
    <div class="flex items-center gap-1.5 px-2.5 py-1.5" style="background:${c}18">
      <span style="width:7px;height:7px;border-radius:50%;background:${c};
                   flex-shrink:0;display:inline-block;"></span>
      <span class="text-[10px] font-bold leading-none" style="color:${tc}">${name}</span>
      ${subtitle}
    </div>
    <div class="px-2">${rows}</div>
  </div>`;
}

// ── Thumbnail helpers ─────────────────────────────────────────────────────
// External images go through our server proxy (/home/img) which routes them
// via the Walmart corporate proxy.  If the corporate filter still blocks the
// image (e.g. YouTube CDN), the server returns 415 and the browser fires
// onerror — we replace the broken img with a coloured placeholder instead of
// hiding the slot entirely, so the card layout stays consistent.
function _rssProxyImg(url) {
  return `/home/img?url=${encodeURIComponent(url)}`;
}

function _rssImgOnError(el, accent) {
  // Swap failed img for a colour-tinted placeholder inside the same wrapper
  const wrap = el.parentElement;
  if (!wrap) return;
  wrap.style.background = accent + '22';   // feed colour at ~13% opacity
  wrap.innerHTML = `<span style="display:flex;align-items:center;justify-content:center;
    width:100%;height:100%;font-size:1.4em;opacity:0.5;">&#128248;</span>`;
}

/** Card: full-width 16:9 banner at the top of the card box. */
function _rssThumbCard(url, accent) {
  if (!url) return '';
  const esc   = _rssEsc(accent || '#6b7280');
  const src   = _rssProxyImg(url);
  return `<div style="width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:8px 8px 0 0;background:#e5e7eb;">
    <img src="${src}" alt="" loading="lazy"
         style="width:100%;height:100%;object-fit:cover;display:block;"
         onerror="_rssImgOnError(this,'${esc}')">
  </div>`;
}

/** Compact: small square thumbnail on the left of each row. */
function _rssThumbCompact(url, accent) {
  if (!url) return '';
  const esc   = _rssEsc(accent || '#6b7280');
  const src   = _rssProxyImg(url);
  return `<div style="width:44px;height:44px;border-radius:6px;overflow:hidden;flex-shrink:0;background:#e5e7eb;">
    <img src="${src}" alt="" loading="lazy"
         style="width:100%;height:100%;object-fit:cover;display:block;"
         onerror="_rssImgOnError(this,'${esc}')">
  </div>`;
}

// ── Item renderers ────────────────────────────────────────────────────────────

/**
 * Card — framed box per item, 16:9 thumb at top, title + excerpt inside.
 * Deliberately boxed so it looks nothing like compact even with no thumbnail.
 */
function _rssItemCard(it, showThumb, readSet) {
  const title  = _rssStripHtml(it.title) || '(no title)';
  const desc   = _rssStripHtml(it.description).slice(0, 140);
  const date   = _rssDate(it.pub_date);
  const thumb  = (showThumb && it.thumbnail) ? _rssThumbCard(it.thumbnail, it._color) : '';
  const accent = _rssEsc(it._color);
  const isRead = readSet?.has(it.link);
  // ↩ button: hidden while unread, shown when marked read
  const unmarkBtn = readSet != null
    ? `<button type="button" data-rss-unmark="${_rssEsc(it.link)}"
               onclick="event.stopPropagation();rssUnmarkItem(this)"
               style="${isRead ? '' : 'display:none'}"
               class="ml-auto text-[9px] text-gray-400 dark:text-zinc-500
                      hover:text-wblue transition-colors flex-shrink-0"
               title="Mark as unread">↩ unread</button>`
    : '';
  return `
  <div data-rss-link="${_rssEsc(it.link)}"
       onclick="_rssNav(event,this)"
       class="block mb-2.5 rounded-xl border border-gray-200 dark:border-zinc-700
              bg-white dark:bg-zinc-800/60 overflow-hidden cursor-pointer
              hover:shadow-md hover:border-gray-300 dark:hover:border-zinc-500
              transition-shadow${isRead ? ' opacity-50 rss-is-read' : ''}">
    ${thumb}
    <div class="px-3 py-2.5">
      <a href="${_rssEsc(it.link)}" target="_blank" rel="noopener noreferrer"
         class="block text-[11px] font-bold leading-snug line-clamp-2 mb-1.5
                text-gray-800 dark:text-zinc-100 no-underline hover:underline">${_rssEsc(title)}</a>
      ${desc ? `<p class="text-[10px] text-gray-500 dark:text-zinc-400 leading-snug line-clamp-2 mb-1.5">${_rssEsc(desc)}</p>` : ''}
      <div class="flex items-center gap-2 flex-wrap">
        <span class="inline-flex items-center gap-1 text-[9px] font-bold leading-none" style="color:${accent}">
          <span style="width:4px;height:4px;border-radius:50%;background:${accent};display:inline-block;"></span>
          ${_rssEsc(it._label)}
        </span>
        ${date ? `<span class="text-[9px] text-gray-400 dark:text-zinc-500">${date}</span>` : ''}
        ${unmarkBtn}
      </div>
    </div>
  </div>`;
}

/**
 * Compact — single dense row: small thumb + title + badge, no box/card frame.
 * Clearly different from card at a glance.
 */
function _rssItemCompact(it, showThumb, readSet, showLabel = true) {
  const title  = _rssStripHtml(it.title) || '(no title)';
  const date   = _rssDate(it.pub_date);
  const thumb  = (showThumb && it.thumbnail) ? _rssThumbCompact(it.thumbnail, it._color) : '';
  const isRead = readSet?.has(it.link);
  const badge  = showLabel ? _rssBadgeDot(it._label, it._color) : '';
  const unmarkBtn = readSet != null
    ? `<button type="button" data-rss-unmark="${_rssEsc(it.link)}"
               onclick="event.stopPropagation();rssUnmarkItem(this)"
               style="${isRead ? '' : 'display:none'}"
               class="text-[9px] text-gray-400 dark:text-zinc-500
                      hover:text-wblue transition-colors flex-shrink-0"
               title="Mark as unread">↩ unread</button>`
    : '';
  return `
  <div class="flex items-center gap-2 py-1.5
              border-b border-gray-100 dark:border-zinc-800/70 last:border-0
              ${isRead ? 'opacity-50 rss-is-read' : ''}"
       data-rss-link="${_rssEsc(it.link)}">
    ${thumb}
    <div class="flex-1 min-w-0">
      <a href="${_rssEsc(it.link)}" target="_blank" rel="noopener noreferrer"
         class="text-[11px] font-semibold text-gray-800 dark:text-zinc-200 hover:text-wblue
                transition-colors leading-snug block line-clamp-1">${_rssEsc(title)}</a>
      <div class="flex items-center gap-1.5 mt-px">
        ${badge}
        ${date ? `<span class="text-[9px] text-gray-400 dark:text-zinc-500">${date}</span>` : ''}
      </div>
    </div>
    ${unmarkBtn}
  </div>`;
}

/** Minimal — coloured dot + title link. No thumb, no chrome. */
function _rssItemMinimal(it, readSet) {
  const title  = _rssStripHtml(it.title) || '(no title)';
  const c      = _rssEsc(it._color);
  const isRead = readSet?.has(it.link);
  const unmarkBtn = readSet != null
    ? `<button type="button" data-rss-unmark="${_rssEsc(it.link)}"
               onclick="event.stopPropagation();rssUnmarkItem(this)"
               style="${isRead ? '' : 'display:none'}"
               class="text-[9px] text-gray-400 dark:text-zinc-500
                      hover:text-wblue transition-colors flex-shrink-0"
               title="Mark as unread">↩</button>`
    : '';
  return `<li class="flex items-center gap-1.5 py-0.5
                    ${isRead ? 'opacity-50 rss-is-read' : ''}"
               data-rss-link="${_rssEsc(it.link)}">
    <span style="width:5px;height:5px;border-radius:50%;background:${c};
                 display:inline-block;flex-shrink:0;"></span>
    <a href="${_rssEsc(it.link)}" target="_blank" rel="noopener noreferrer"
       class="flex-1 text-xs hover:underline leading-snug line-clamp-1 min-w-0
              ${isRead ? 'text-gray-400 dark:text-zinc-500' : 'text-wblue'}">${_rssEsc(title)}</a>
    ${unmarkBtn}
  </li>`;
}

// ── Category tabs ─────────────────────────────────────────────────────────────

function _rssCategoryTabs(cats, active, elId, rightSlot = '') {
  if (!cats.length && !rightSlot) return '';
  const tabsHtml = cats.length
    ? ['All', ...cats].map(cat => {
        const on = cat === active;
        return `<button type="button" role="tab" aria-selected="${on}"
                   onclick="rssSetCat(document.getElementById('${elId}'),'${_rssEsc(cat)}')"
                   class="text-[10px] font-semibold px-2 py-0.5 rounded-full transition whitespace-nowrap
                          ${on ? 'bg-wblue text-white' : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'}"
                   >${_rssEsc(cat)}</button>`;
      }).join('')
    : '';
  return `<div class="flex items-center gap-1 mb-2" role="tablist">
    <div class="flex flex-wrap gap-1 flex-1 min-w-0">${tabsHtml}</div>
    ${rightSlot ? `<div class="flex items-center gap-1 flex-shrink-0 text-[10px] rss-unread-count">${rightSlot}</div>` : ''}
  </div>`;
}

// ── Render dispatcher ─────────────────────────────────────────────────────────

function _rssRender(el, allItems, feeds, config) {
  const style        = el.dataset.style || 'card';
  const showThumb    = config.show_thumbs   !== '0';
  const groupBy      = config.group_by      || 'none';
  const trackRead    = config.track_read    === '1';
  // compact_label: '1' = dot+text per row | 'wrap' = bubble per feed | '0' = hidden
  const labelMode    = config.compact_label || '1';
  const showLabel    = labelMode === '1';
  const feedWrap     = labelMode === 'wrap';
  const activeCat  = (el._rssState || {}).cat || 'All';

  // ── Read set (null when tracking off — signals renderers to skip all read styling)
  const widgetId = el.closest('[data-widget-id]')?.dataset.widgetId;
  const readSet  = (trackRead && widgetId) ? _rssGetRead(widgetId) : null;

  const cats  = [...new Set(feeds.filter(f => f.category).map(f => f.category))];
  const items = activeCat === 'All' ? allItems : allItems.filter(it => it._category === activeCat);

  // ── Right slot: toggle + mark-all live in the tabs row (no count text)
  const rightSlot = (trackRead && readSet)
    ? `<button type="button" onclick="rssToggleRead(this)"
               class="rss-toggle-read font-semibold text-gray-400 dark:text-zinc-500
                      hover:text-wblue transition-colors whitespace-nowrap"
               >Hide read</button>
       <span class="text-gray-300 dark:text-zinc-600">&middot;</span>
       <button type="button" onclick="_rssMarkAllRead(this)"
               class="rss-mark-all-btn font-semibold text-gray-400 dark:text-zinc-500
                      hover:text-wblue transition-colors whitespace-nowrap">Mark all read</button>`
    : '';

  const tabs = _rssCategoryTabs(cats, activeCat, el.id, rightSlot);

  if (!items.length) {
    el.innerHTML = tabs + `<p class="text-xs text-gray-400 dark:text-zinc-500 py-2">No items${activeCat !== 'All' ? ` in "${activeCat}"` : ''}.</p>`;
    return;
  }

  let body;
  // compact + feedWrap: group by feed index (stable key) so that same-domain
  // feeds (e.g. two YouTube channels) stay in separate labelled bubbles.
  // Prior implementation grouped by label which caused same-domain feeds to
  // collapse into a single container.
  if (style === 'compact' && feedWrap) {
    const groups = {};
    items.forEach(it => {
      const k = it._feedIdx ?? it._label ?? 'other';
      if (!groups[k]) groups[k] = [];
      groups[k].push(it);
    });
    // Render in original feed order; skip feeds with no items
    body = feeds
      .filter(f => groups[f._feedIdx] !== undefined)
      .map(f => _rssFeedContainer(f, groups[f._feedIdx], showThumb, readSet))
      .join('');
    // Edge-case: items that escaped index-based grouping
    if (groups['other']) {
      body += _rssFeedContainer(
        { label: 'Other', color: '#6b7280', url: '' },
        groups['other'], showThumb, readSet
      );
    }
  } else if (groupBy !== 'none') {
    const getKey = it => (groupBy === 'category' ? it._category : it._label) || 'Other';
    const order = [], groups = {};
    items.forEach(it => {
      const k = getKey(it);
      if (!groups[k]) { order.push(k); groups[k] = []; }
      groups[k].push(it);
    });
    body = order.map(k => {
      const feed  = feeds.find(f => (groupBy === 'category' ? f.category : f.label) === k);
      const color = _rssEsc(feed?.color || '#6b7280');
      const hdr   = `<p class="text-[10px] font-bold uppercase tracking-wide mt-2 mb-1 first:mt-0" style="color:${color}">${_rssEsc(k)}</p>`;
      const rows  = style === 'minimal'
        ? `<ul class="space-y-0.5">${groups[k].map(it => _rssItemMinimal(it, readSet)).join('')}</ul>`
        : style === 'compact'
        ? groups[k].map(it => _rssItemCompact(it, showThumb, readSet, showLabel)).join('')
        : groups[k].map(it => _rssItemCard(it, showThumb, readSet)).join('');
      return hdr + rows;
    }).join('');
  } else {
    body = style === 'minimal'
      ? `<ul class="space-y-0.5">${items.map(it => _rssItemMinimal(it, readSet)).join('')}</ul>`
      : style === 'compact'
      ? items.map(it => _rssItemCompact(it, showThumb, readSet, showLabel)).join('')
      : items.map(it => _rssItemCard(it, showThumb, readSet)).join('');
  }

  el.innerHTML = tabs + body;
  // Restore hide-read filter if it was active before this render
  if (trackRead) _rssApplyReadFilter(el);

  if (trackRead && widgetId) {
    if (el._rssClickHandler) el.removeEventListener('click', el._rssClickHandler);
    el._rssClickHandler = e => {
      // Unmark buttons handle themselves (stopPropagation) — ignore here
      if (e.target.closest('[data-rss-unmark]')) return;
      const node = e.target.closest('[data-rss-link]');
      if (!node || node.classList.contains('rss-is-read')) return;
      const href = node.dataset.rssLink;
      if (!href) return;
      const s = _rssGetRead(widgetId);
      s.add(href);
      _rssSetRead(widgetId, s);
      node.classList.add('opacity-50', 'rss-is-read');
      node.querySelector('[data-rss-unmark]')?.style.removeProperty('display');
      _rssUpdateCountBar(el);
    };
    el.addEventListener('click', el._rssClickHandler);
  }
}

// ── Public: switch category tab (called from inline onclick) ──────────────────

function rssSetCat(el, cat) {
  if (!el || !el._rssAllItems) return;
  el._rssState = { ...(el._rssState || {}), cat };
  _rssRender(el, el._rssAllItems, el._rssFeeds, el._rssConfig);
}

// ── Fast re-render (no network) ─────────────────────────────────────────────
// Used by settings changes that only affect rendering (compact_label,
// show_thumbs, track_read). Falls back to _loadRss if cached data is absent.

function _rssRerender(el) {
  if (!el || !el._rssAllItems || !el._rssFeeds || !el._rssConfig) {
    // Nothing cached yet — fall back to a full load
    if (typeof _loadRss === 'function') _loadRss(el);
    return;
  }
  // Rebuild config from current dataset (settings handler already updated them)
  el._rssConfig = {
    show_thumbs:     el.dataset.showThumbs     ?? '1',
    group_by:        el.dataset.groupBy        || 'none',
    card_bg:         el.dataset.cardBg         ?? '1',
    track_read:      el.dataset.trackRead      ?? '0',
    compact_label:    el.dataset.compactLabel ?? '1',
  };
  _rssRender(el, el._rssAllItems, el._rssFeeds, el._rssConfig);
}

// ── Main loader ───────────────────────────────────────────────────────────────

async function _loadRss(el) {
  let feeds = [];
  try { feeds = JSON.parse(el.dataset.feeds || '[]'); } catch { /* ignore */ }
  if (!feeds.length && el.dataset.url) {
    feeds = [{ url: el.dataset.url, label: '', category: '', color: '' }];
  }

  const max     = Math.max(1, parseInt(el.dataset.max || '5', 10));
  const refresh = parseInt(el.dataset.refresh || '30', 10);
  const config  = {
    show_thumbs:     el.dataset.showThumbs     ?? '1',
    group_by:        el.dataset.groupBy        || 'none',
    card_bg:         el.dataset.cardBg         ?? '1',
    track_read:      el.dataset.trackRead      ?? '0',
    compact_label:    el.dataset.compactLabel ?? '1',
  };
  el._rssConfig = config;
  // Assign palette colours now; labels are resolved after fetch so we can
  // use the actual RSS feed_title (e.g. YouTube channel name) as fallback
  // instead of just the bare domain (www.youtube.com).
  feeds = feeds.map((f, i) => ({
    ...f,
    _feedIdx: i,                              // stable per-item group key
    color: f.color || _RSS_PALETTE[i % _RSS_PALETTE.length],
    // label: intentionally NOT normalised here — resolved in results loop below
  }));

  if (!feeds.length) {
    el.innerHTML = `<p class="text-xs text-gray-400 dark:text-zinc-500">No feeds — open <span class="font-semibold">⚙️ settings</span> to add one.</p>`;
    return;
  }

  if (!el.id) el.id = `rss-${Math.random().toString(36).slice(2,8)}`;

  el.innerHTML = `<div class="flex items-center gap-2 text-gray-400 dark:text-zinc-500 text-xs py-2">
    <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-wblue flex-shrink-0"></div>
    <span>Loading ${feeds.length} feed${feeds.length > 1 ? 's' : ''}…</span>
  </div>`;

  const results = await Promise.allSettled(
    feeds.map(f => fetch(`/home/rss?url=${encodeURIComponent(f.url)}`, { credentials:'same-origin' }).then(r => r.json()))
  );

  let allItems = [];
  const errors = [];

  results.forEach((r, i) => {
    const feed = feeds[i];
    // Resolve display label now that we have the RSS feed_title available.
    // Priority: user-set label > actual RSS title (e.g. "StephanieSoo") > URL fragment
    if (!feed.label) {
      feed.label = (r.status === 'fulfilled' && r.value.feed_title)
        ? r.value.feed_title
        : feed.url.replace(/https?:\/\/(www\.)?/, '').split('/')[0];
    }
    if (r.status === 'fulfilled' && !r.value.error) {
      const items = (r.value.items || []).slice(0, max).map(it => ({
        ...it,
        _label:    feed.label,
        _feedIdx:  feed._feedIdx,   // stable wrap-mode group key
        _color:    feed.color,
        _category: feed.category || '',
      }));
      allItems.push(...items);
    } else {
      errors.push({ feed, msg: r.value?.error || r.reason?.message || 'Failed' });
    }
  });

  // Newest-first
  allItems.sort((a, b) => new Date(b.pub_date || 0) - new Date(a.pub_date || 0));

  el._rssAllItems = allItems;
  el._rssFeeds    = feeds;
  el._rssConfig   = config;
  if (!el._rssState) el._rssState = { cat: 'All' };

  if (!allItems.length && errors.length) {
    el.innerHTML = `<div class="text-xs space-y-1.5">
      <p class="text-red-500 font-semibold">⚠️ All feeds failed</p>
      ${errors.map(e => `<p class="text-gray-400 dark:text-zinc-500 leading-snug">
        <span class="font-medium">${_rssEsc(e.feed.label||e.feed.url)}</span>: ${_rssEsc(e.msg)}</p>`).join('')}
      <button onclick="_loadRss(this.closest('.rss-widget'))"
              class="underline text-wblue text-[11px]">↺ Retry</button>
    </div>`;
    return;
  }

  _rssRender(el, allItems, feeds, config);

  if (errors.length) {
    const p = document.createElement('p');
    p.className = 'text-[10px] text-gray-400 dark:text-zinc-600 mt-1.5';
    p.textContent = `⚠️ ${errors.length} feed${errors.length > 1 ? 's' : ''} failed — check settings`;
    el.appendChild(p);
  }

  if (refresh > 0) {
    clearTimeout(el._rssTimer);
    el._rssTimer = setTimeout(() => _loadRss(el), refresh * 60_000);
  }
}

// ── Feeds-list editor (shared by add-widget & settings modals) ────────────────

/**
 * Build the feeds-list editor HTML.
 * The hidden <input> carries both data-name (add-widget modal) and
 * data-cfg-key (settings modal) so a single element satisfies both paths.
 */
function _rssFeedsEditorHtml(fieldId, feeds, nameAttr) {
  const rows = (feeds || []).map((f, i) => _rssFeedRowHtml(fieldId, f, i)).join('');
  return `
  <div id="${fieldId}-rows" class="space-y-2 mb-2">${rows}</div>
  <button type="button" onclick="rssAddFeedRow('${fieldId}')"
          class="flex items-center gap-1 text-[11px] font-semibold text-wblue hover:text-blue-700 transition">
    <svg class="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
    </svg>Add Feed
  </button>
  <input type="hidden" id="${fieldId}" data-name="${nameAttr}" data-cfg-key="${nameAttr}" data-json="true"
         value="${_rssEsc(JSON.stringify(feeds || []))}">`;
}

/**
 * Single feed row — fully vertical layout to avoid horizontal overflow
 * inside the narrow settings modal (max-w-xs ≈ 280px content area).
 * Row: [colour swatch · domain label · ✕]
 *      [URL input                        ]
 *      [Label input]  [Category input    ]
 */
function _rssFeedRowHtml(fieldId, feed, idx) {
  const f     = feed || {};
  const color = f.color || _RSS_PALETTE[idx % _RSS_PALETTE.length];
  const rowId = `${fieldId}-r${idx}-${Date.now()}`;
  const inp   = 'w-full text-xs border border-gray-200 dark:border-zinc-700 rounded px-2 py-1 ' +
                'bg-white dark:bg-zinc-900 text-gray-800 dark:text-zinc-100 min-w-0 ' +
                'focus:outline-none focus:ring-1 focus:ring-wblue';
  return `
  <div id="${rowId}" class="p-2 rounded-lg bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700 space-y-1.5">

    <!-- Row 1: colour swatch + delete button -->
    <div class="flex items-center gap-1.5">
      <input type="color" value="${_rssEsc(color)}" title="Feed colour"
             style="width:22px;height:22px;padding:1px;border:none;background:none;cursor:pointer;flex-shrink:0;border-radius:4px;"
             oninput="rssSyncFeeds('${fieldId}')">
      <span class="flex-1 text-[10px] text-gray-400 dark:text-zinc-500 truncate">
        ${_rssEsc(f.url ? f.url.replace(/https?:\/\/(www\.)?/,'').split('/')[0] : 'New feed')}
      </span>
      <button type="button" title="Remove" onclick="rssRemoveFeedRow('${rowId}','${fieldId}')"
              class="p-0.5 text-gray-400 hover:text-red-500 transition flex-shrink-0">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>

    <!-- Row 2: URL -->
    <input type="text" placeholder="Feed URL" value="${_rssEsc(f.url || '')}"
           class="${inp}" oninput="rssSyncFeeds('${fieldId}')">

    <!-- Row 3: Label + Category side by side (each is 50% via CSS, min-w-0 prevents blow-out) -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
      <input type="text" placeholder="Label" value="${_rssEsc(f.label || '')}"
             class="${inp}" oninput="rssSyncFeeds('${fieldId}')">
      <input type="text" placeholder="Category" value="${_rssEsc(f.category || '')}"
             class="${inp}" oninput="rssSyncFeeds('${fieldId}')">
    </div>

  </div>`;
}

/** Re-serialise all feed rows → hidden JSON input, then debounce-save. */
function rssSyncFeeds(fieldId) {
  const container = document.getElementById(`${fieldId}-rows`);
  const hidden    = document.getElementById(fieldId);
  if (!container || !hidden) return;
  const feeds = [...container.children].map(row => {
    const inputs = row.querySelectorAll('input');
    return { color: inputs[0]?.value||'', url: (inputs[1]?.value||'').trim(),
             label: (inputs[2]?.value||'').trim(), category: (inputs[3]?.value||'').trim() };
  }).filter(f => f.url);
  hidden.value = JSON.stringify(feeds);
  // Auto-save: don't rely solely on the Done button — debounce to avoid
  // hammering the server while the user is still typing the URL.
  clearTimeout(hidden._saveTimer);
  hidden._saveTimer = setTimeout(() => {
    const wid = document.getElementById('ws-settings-modal')?.dataset.widgetId;
    if (wid) saveWidgetSettings(Number(wid));
  }, 800);
}

/** Append a new empty feed row. */
function rssAddFeedRow(fieldId) {
  const container = document.getElementById(`${fieldId}-rows`);
  if (!container) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = _rssFeedRowHtml(fieldId, null, container.children.length);
  container.appendChild(tmp.firstElementChild);
}

/** Remove a row and re-sync the hidden input. */
function rssRemoveFeedRow(rowId, fieldId) {
  document.getElementById(rowId)?.remove();
  rssSyncFeeds(fieldId);
}
