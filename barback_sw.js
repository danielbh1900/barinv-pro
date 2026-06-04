// barback_sw.js — KILL-SWITCH service worker.
// PLAN-2026-06-04.
//
// Purpose: any browser that already has an OLD barback service worker
// installed will periodically check this URL for an update. When it
// does, it downloads THIS file, installs it as the new worker, and on
// activate the worker unregisters itself and purges all caches —
// leaving the page with no active SW. The page's main script
// (barback.html barbackKillStaleSW IIFE) is the belt-and-suspenders
// for clients that don't trigger an update check.
//
// SAFETY: this worker has no fetch handler beyond a no-op pass-through,
// so during the brief window between install and activate it never
// caches, redirects, or rewrites any request.

self.addEventListener('install', (event) => {
  // Replace any existing worker immediately, no waiting phase.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1. Unregister this very registration.
    try { await self.registration.unregister(); } catch (_) { /* best-effort */ }

    // 2. Delete every Cache Storage entry under this origin's SW scope.
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    } catch (_) { /* best-effort */ }

    // 3. Notify any controlled pages so they know a cleanup just ran
    //    (purely informational — the page doesn't reload automatically,
    //    the next user navigation will fetch fresh content).
    try {
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const c of clients) {
        try { c.postMessage({ type: 'sw-kill-done', at: Date.now() }); } catch (_) {}
      }
    } catch (_) { /* best-effort */ }
  })());
});

// No fetch handler beyond no-op — the browser falls through to the
// network for every request, which is the entire point.
self.addEventListener('fetch', () => { /* no-op pass-through */ });
