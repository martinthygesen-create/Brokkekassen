const CACHE = 'brokkekassen-v4';
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
  // App-skallen skal altid tjekke netværket først, så en ny deployment vises
  // med det samme — ellers sidder installerede PWA'er (hjemmeskærm-ikon) fast
  // på en gammel cachet version, indtil cachen tilfældigvis udløber.
  if (e.request.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname === '/') {
    e.respondWith(
      fetch(e.request)
        .then(res => { caches.open(CACHE).then(c => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached)));
});
