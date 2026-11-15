/* global self, caches, fetch, URL */
// Service worker for offline FAQ support (T3-008-A).
// Caches the app shell (HTML + static assets) so the demo/FAQ mode works after
// preparation. Authenticated API responses are never cached: private data must
// not survive page closure or account switching.
//
// Cache strategy:
//   Static assets (/assets/*, /loader.js): cache-first (content-hashed filenames).
//   App shell (/): network-first, cache fallback.
//   API calls (/api/*): network-only — never cached.
//   Everything else: network-first, cache fallback.

const CACHE = 'track3-shell-v1';

// Assets that make up the offline shell. The index path is added at install
// time by fetching the page; asset files are added lazily on first fetch.
const SHELL_URLS = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Remove any old cache versions from previous SW installs.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GET requests.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API calls: never cache — private data must not persist.
  if (url.pathname.startsWith('/api/')) return;

  // Static assets (content-hashed): cache-first, then add to cache.
  if (url.pathname.startsWith('/assets/') || url.pathname === '/loader.js') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // App shell and everything else: network-first, fall back to cache.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.url === self.location.origin + '/') {
          caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
