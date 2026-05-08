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

const CACHE_NAME  = 'bw-shell-v2';
const OFFLINE_URL = '/offline';

/* App-shell assets to pre-cache on install */
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

/** Broadcast a typed message to all controlled page clients. */
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
      || p.startsWith('/wopi/');
}

/* ── Fetch ──────────────────────────────────────────────────────────────── */
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
            /* Tell the page that fresh content is cached and ready */
            _broadcast({ type: 'BW_CACHE_UPDATED', url: request.url });
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
