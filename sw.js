// BARINV Service Worker — network-first documents, stale-while-revalidate assets
const CACHE = 'barinv-v73';
const SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('supabase.co')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('{"error":"offline"}', {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  if (e.request.method !== 'GET') return;

  // Admin navigations must prefer the newest deployed HTML while online.
  // Preserve offline use by falling back to the exact cached document, then
  // the precached app-shell entry points when a network request cannot finish.
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(e.request, res.clone());
        }
        return res;
      } catch (_) {
        const cache = await caches.open(CACHE);
        return (await cache.match(e.request))
          || (await cache.match('./'))
          || cache.match('./index.html');
      }
    })());
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const networkFetch = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => cached);

        return cached || networkFetch;
      })
    )
  );
});
