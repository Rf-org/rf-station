// Service worker: offline attract-only screen + zero-network-wait fixed lines.
// Runtime caching only (no build-time manifest): the kiosk is online at setup,
// so the first visit populates the cache; everything below then works offline.
const CACHE = 'rf-station-v1';

self.addEventListener('install', () => {
  // @ts-ignore — worker scope
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // @ts-ignore
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    })(),
  );
});

function isCacheFirst(url) {
  return url.pathname.startsWith('/audio/') || url.pathname.endsWith('.riv');
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    // Offline navigation fallback: the cached app shell boots to the attract screen.
    if (req.mode === 'navigate') {
      const shell = await cache.match('/index.html');
      if (shell) return shell;
    }
    throw new Error('offline and not cached');
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // never cache vendor/CDN traffic
  event.respondWith(isCacheFirst(url) ? cacheFirst(event.request) : networkFirst(event.request));
});
