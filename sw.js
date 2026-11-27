// Keeps the unit models on the device, so a second visit downloads none of them again and the game's
// models work with no connection. Only /assets/game/ passes through here; everything else (the page, the
// code, the paintings) goes to the network as if this file did not exist, so a new version of the game is
// never held back by it.
//
// A model's file carries a hash of its contents in its name: once fetched it is good for ever, and is kept.
// The manifest, which names the files in use, is asked of the network each time and kept only as a fallback
// for when there is none; whenever a fresh one arrives, files it no longer names are dropped.
const CACHE = 'unit-models-v1', DIR = '/assets/game/', HASHED = /\.[0-9a-f]{10}\.(bin|webp)$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function prune(cache, manifest) {
  const keep = new Set();
  for (const u of Object.values(manifest.units || {})) { if (u.pack) keep.add(DIR + u.pack); if (u.texture) keep.add(DIR + u.texture); }
  for (const req of await cache.keys()) { const p = new URL(req.url).pathname; if (HASHED.test(p) && !keep.has(p)) await cache.delete(req); }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(DIR)) return;
  if (HASHED.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(url.pathname);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(url.pathname, res.clone());
      return res;
    }));
  } else if (url.pathname === DIR + 'manifest.json') {
    e.respondWith(caches.open(CACHE).then(async (cache) => {
      try {
        const res = await fetch(e.request);
        if (res.ok) { cache.put(url.pathname, res.clone()); res.clone().json().then((m) => prune(cache, m)).catch(() => {}); }
        return res;
      } catch (err) {
        const hit = await cache.match(url.pathname);
        if (hit) return hit;
        throw err;
      }
    }));
  }
});
