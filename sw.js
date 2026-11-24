// BARINV service worker. Root and Staff each own a separate cache namespace.
const SCOPE = new URL(self.registration.scope);
const SHELL = new URL('index.html', SCOPE);
const MANIFEST = new URL('manifest.json', SCOPE);
const STAFF = new URL('staff/', SCOPE);
const CACHE_PREFIX = 'barinv:' + SCOPE.pathname + ':shell:';
const CACHE = CACHE_PREFIX + 'night-operational-edit-20261124-r1';
const SHELL_SHA256 = '490c3e0d7f74480ea59a8e733e8301dd13435fae5b62d0f8e89cc8184a25fc12';

async function verifiedShell() {
  const response = await fetch(SHELL.href, { cache: 'no-store' });
  if (!response.ok) throw new Error('BARINV application shell is unavailable');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer()));
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (hex !== SHELL_SHA256) throw new Error('BARINV application shell release mismatch');
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Stay on the active worker if publishing has not reached this CDN edge.
    const shell = await verifiedShell();
    const cache = await caches.open(CACHE);
    await cache.add(MANIFEST.href);
    await cache.put(SHELL.href, shell);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function serveShell() {
  const cache = await caches.open(CACHE);
  try {
    const response = await verifiedShell();
    await cache.put(SHELL.href, response.clone());
    return response;
  } catch (_) {
    // Both URL spellings and their query strings share this revision, while
    // the browser retains its original navigation URL and its Staff mode.
    return (await cache.match(SHELL.href)) || new Response(
      'BARINV is waiting for the application update. Reconnect and reopen this page.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Root must never handle Staff navigation or cache Staff assets.
  if (!SCOPE.pathname.endsWith('/staff/') && url.origin === SCOPE.origin &&
      url.pathname.startsWith(STAFF.pathname)) return;

  if (request.url.includes('supabase.co')) {
    event.respondWith(fetch(request).catch(() => new Response('{"error":"offline"}', {
      headers: { 'Content-Type': 'application/json' }
    })));
    return;
  }

  if (request.method !== 'GET') return;
  if (url.origin === SCOPE.origin && (url.pathname === SCOPE.pathname || url.pathname === SHELL.pathname)) {
    // Non-navigation fetches must also avoid writing unverified HTML over the
    // pinned entry in the generic asset cache.
    event.respondWith(serveShell());
    return;
  }
  if (request.mode === 'navigate' || request.destination === 'document') return;

  event.respondWith(caches.open(CACHE).then(cache => cache.match(request).then(cached => {
    const networkFetch = fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => cached);
    return cached || networkFetch;
  })));
});
