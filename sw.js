const CACHE = 'brokkekassen-v3';
const FILES = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // never cache live data
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(CACHE).then(c => c.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => { c.put(e.request, res.clone()); return res; });
      }))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached)));
});
