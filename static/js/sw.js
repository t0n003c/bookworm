/* BookWorm Service Worker — v2
 *
 * Strategy: Network-first with cache fallback.
 * This is a multi-user team app — we never want stale notes.
 * The SW exists to: satisfy PWA installability, give an offline fallback
 * page, and broadcast cache-update events so the page can re-fetch data
 * when the network is restored.
 *
 * Cache names are versioned so stale caches are purged on activate.
 */

const CACHE_NAME  = 'bw-shell-v4';
const OFFLINE_URL = '/offline';

/* App-shell assets to pre-cache on install.
 * Auth-gated pages (e.g. /quick-ask) are intentionally omitted:
 * cache.addAll() throws if any request returns a non-OK response,
 * and a gated page returns 302→/login during SW install (no session yet).
 * Those pages are cached on first successful authenticated visit via
 * the network-first handler in the fetch listener. */
const PRECACHE = [
  '/',
  '/offline',
  '/static/img/icons/icon-192.png',
  '/static/img/icons/icon-512.png',
];

/* ── Install ────────────────────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

/* ── Activate ───────────────────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Broadcast a typed message to all controlled page clients.
 * Only used for navigation-level events (e.g. a full page was refreshed
 * from the network while the app was open).  Never call for static assets
 * or API partials — it would spam the UI. */
function _broadcast(msg) {
  self.clients.matchAll({ includeUncontrolled: false, type: 'window' })
    .then(clients => clients.forEach(c => c.postMessage(msg)));
}

/** True when a Request URL looks like an API/dynamic endpoint we must skip. */
function _isDynamic(url) {
  const p = url.pathname;
  return p.startsWith('/home/')
      || p.startsWith('/auth/')
      || p.startsWith('/uploads/')
      || p.startsWith('/wopi/')
      || p.startsWith('/qa/');   // SSE streams must never be cached
}

/* ── Push notifications ─────────────────────────────────────────────────────── */
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: '📚 BookWorm', body: event.data ? event.data.text() : '' };
  }

  const title   = data.title  || '📚 BookWorm';
  const options = {
    body:    data.body   || '',
    icon:    data.icon   || '/static/img/icons/icon-192.png',
    badge:   data.badge  || '/static/img/icons/badge-96.png',
    tag:     data.tag    || 'bw-push',
    data:    data.data   || {},
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const d      = event.notification.data || {};
  // Prefer an explicit url hint baked into the notification payload.
  // Fall back to note deep-link, then plain home.
  const noteId = d.note_id;
  const url    = d.url
               || (noteId ? `/?note=${noteId}` : '/');

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // Focus an existing window if one is open.
        const existing = clients.find(c => c.url.includes(self.location.origin));
        if (existing) {
          existing.focus();
          // Ask the page to navigate if it needs to go somewhere specific
          if (url && url !== '/') existing.navigate(url).catch(() => {});
          return;
        }
        return self.clients.openWindow(url);
      })
  );
});

/* ── Fetch ──────────────────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;

  /* Only intercept GET; let mutations pass through untouched */
  if (request.method !== 'GET') return;

  /* Skip cross-origin requests */
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* Skip dynamic / API endpoints — always need fresh data */
  if (_isDynamic(url)) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          /* Clone before consuming; update cache in background */
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, clone);
            /* Only broadcast for full-page navigations, not every static
             * asset — otherwise the page gets flooded with messages. */
            if (request.mode === 'navigate') {
              _broadcast({ type: 'BW_CACHE_UPDATED', url: request.url });
            }
          });
        }
        return response;
      })
      .catch(() =>
        /* Network failed — try cache, then offline page */
        caches.match(request).then(cached =>
          cached || caches.match(OFFLINE_URL)
        )
      )
  );
});
