/* BookWorm Service Worker — v1
 *
 * Strategy: Network-first with cache fallback.
 * This is a team app with per-user data, so we never want stale content.
 * The SW exists primarily to satisfy PWA installability requirements and
 * to give a graceful offline page instead of Chrome's dinosaur.
 *
 * Cache names are versioned so old caches are cleaned up on activate.
 */

const CACHE_NAME    = 'bw-shell-v1';
const OFFLINE_URL   = '/offline';

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
  /* Activate immediately without waiting for old tabs to close */
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
  /* Take control of uncontrolled pages instantly */
  self.clients.claim();
});

/* ── Fetch ──────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;

  /* Only handle GET; pass everything else through */
  if (request.method !== 'GET') return;

  /* Skip cross-origin requests (CDN, analytics, etc.) */
  if (!request.url.startsWith(self.location.origin)) return;

  /* Skip API / HTMX endpoints — always fresh */
  const url = new URL(request.url);
  if (url.pathname.startsWith('/home/') ||
      url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/uploads/')) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        /* Clone before consuming body */
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached =>
          cached || caches.match(OFFLINE_URL)
        )
      )
  );
});
