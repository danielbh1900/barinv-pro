'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const barbackWorker = fs.readFileSync(path.join(root, 'barback_sw.js'));

function response(body, { ok = true, contentType = 'text/plain' } = {}) {
  return {
    body,
    ok,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
    clone() { return response(body, { ok, contentType }); },
  };
}

function harness({ cached = {}, network } = {}) {
  const listeners = new Map();
  const entries = new Map(Object.entries(cached));
  const operations = [];
  const deletedCaches = [];
  const shellAdds = [];
  let claimed = false;
  let skipped = false;

  const cache = {
    async addAll(urls) { shellAdds.push(...urls); },
    async match(request) {
      const key = typeof request === 'string' ? request : request.url;
      operations.push(`match:${key}`);
      return entries.get(key);
    },
    async put(request, value) {
      const key = typeof request === 'string' ? request : request.url;
      operations.push(`put:${key}`);
      entries.set(key, value);
    },
  };

  const context = {
    Response: class MockResponse {
      constructor(body, init = {}) { this.body = body; this.headers = init.headers || {}; this.ok = true; }
    },
    caches: {
      async open(name) { operations.push(`open:${name}`); return cache; },
      async keys() { return ['barinv-v72', 'unrelated-old-cache', 'barinv-v73']; },
      async delete(name) { deletedCaches.push(name); return true; },
    },
    fetch: async request => {
      operations.push(`fetch:${request.url}`);
      if (network instanceof Error) throw network;
      return typeof network === 'function' ? network(request) : network;
    },
    self: {
      addEventListener(type, handler) { listeners.set(type, handler); },
      skipWaiting() { skipped = true; return Promise.resolve(); },
      clients: { claim() { claimed = true; return Promise.resolve(); } },
    },
  };
  vm.createContext(context);
  vm.runInContext(workerSource, context);

  async function dispatchFetch(request) {
    let responsePromise;
    listeners.get('fetch')({
      request,
      respondWith(value) { responsePromise = Promise.resolve(value); },
    });
    return responsePromise ? responsePromise : null;
  }

  async function dispatchLifecycle(type) {
    let lifetime;
    listeners.get(type)({ waitUntil(value) { lifetime = Promise.resolve(value); } });
    await lifetime;
  }

  return {
    dispatchFetch,
    dispatchLifecycle,
    entries,
    operations,
    deletedCaches,
    shellAdds,
    get claimed() { return claimed; },
    get skipped() { return skipped; },
  };
}

const navigation = url => ({ method: 'GET', mode: 'navigate', destination: 'document', url });
const asset = url => ({ method: 'GET', mode: 'cors', destination: 'script', url });

test('1. navigation/document requests return the network response before cached HTML', async () => {
  const url = 'https://danielbh1900.github.io/barinv-pro/';
  const h = harness({ cached: { [url]: response('stale html') }, network: response('fresh html') });
  const result = await h.dispatchFetch(navigation(url));
  assert.equal(result.body, 'fresh html');
  assert.ok(h.operations.indexOf(`fetch:${url}`) < h.operations.indexOf(`put:${url}`));
  assert.doesNotMatch(h.operations.join('\n'), new RegExp(`match:${url}`));
});

test('2. cached document is used only after navigation network failure', async () => {
  const url = 'https://danielbh1900.github.io/barinv-pro/';
  const h = harness({ cached: { [url]: response('offline html') }, network: new Error('offline') });
  const result = await h.dispatchFetch(navigation(url));
  assert.equal(result.body, 'offline html');
  assert.ok(h.operations.indexOf(`fetch:${url}`) < h.operations.indexOf(`match:${url}`));
});

test('3. successful current navigation HTML updates its cache entry', async () => {
  const url = 'https://danielbh1900.github.io/barinv-pro/index.html';
  const h = harness({ cached: { [url]: response('old') }, network: response('new') });
  await h.dispatchFetch(navigation(url));
  assert.equal(h.entries.get(url).body, 'new');
});

test('4. uncached query navigation falls back to the offline app shell', async () => {
  const url = 'https://danielbh1900.github.io/barinv-pro/?v=offline';
  const h = harness({ cached: { './': response('shell html') }, network: new Error('offline') });
  const result = await h.dispatchFetch(navigation(url));
  assert.equal(result.body, 'shell html');
  assert.deepEqual(h.operations.filter(op => op.startsWith('match:')), [`match:${url}`, 'match:./']);
});

test('5. static assets retain stale-while-revalidate behavior', async () => {
  const url = 'https://danielbh1900.github.io/barinv-pro/manifest.json';
  const h = harness({ cached: { [url]: response('cached asset') }, network: response('fresh asset') });
  const result = await h.dispatchFetch(asset(url));
  assert.equal(result.body, 'cached asset');
  assert.ok(h.operations.includes(`fetch:${url}`), 'asset revalidation did not start');
});

test('6. Supabase requests retain network-first behavior and offline JSON fallback', async () => {
  const online = harness({ network: response('{"ok":true}') });
  const request = asset('https://example.supabase.co/rest/v1/events');
  assert.equal((await online.dispatchFetch(request)).body, '{"ok":true}');

  const offline = harness({ network: new Error('offline') });
  assert.equal((await offline.dispatchFetch(request)).body, '{"error":"offline"}');
  assert.equal(offline.operations.some(op => op.startsWith('match:')), false);
});

test('7. install still calls skipWaiting and precaches the offline shell', async () => {
  const h = harness({ network: response('unused') });
  await h.dispatchLifecycle('install');
  assert.equal(h.skipped, true);
  assert.deepEqual(h.shellAdds, ['./', './index.html', './manifest.json']);
});

test('8. activation still claims clients and removes old caches', async () => {
  const h = harness({ network: response('unused') });
  await h.dispatchLifecycle('activate');
  assert.equal(h.claimed, true);
  assert.deepEqual(h.deletedCaches, ['barinv-v72', 'unrelated-old-cache']);
});

test('9. Admin cache version is bumped exactly to barinv-v73', () => {
  assert.match(workerSource, /const CACHE = 'barinv-v73';/);
  assert.doesNotMatch(workerSource, /const CACHE = 'barinv-v72';/);
});

test('10. index.html remains in the offline shell', () => {
  assert.match(workerSource, /const SHELL = \['\.\/', '\.\/index\.html', '\.\/manifest\.json'\];/);
});

test('11. Barback kill-switch worker remains byte-identical', () => {
  assert.equal(
    crypto.createHash('sha256').update(barbackWorker).digest('hex'),
    '521834957e623b216b3173b56f357465a87738a0b6c73b6351954b5e3f33282b',
  );
});

test('12. Admin worker registration remains scoped and unchanged', () => {
  assert.match(adminSource, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.doesNotMatch(adminSource, /updateViaCache/);
});

test('13. Pending Event correction UI and RPC remain present', () => {
  assert.match(adminSource, /function openEventCorrection\(id\)/);
  assert.match(adminSource, /barinv_correct_pending_event/);
  assert.match(adminSource, /aria-label="Edit pending Event"/);
});

test('14. worker source contains no Supabase or database mutation code', () => {
  assert.doesNotMatch(workerSource, /barinv_correct_pending_event|\.rpc\(|INSERT\s+INTO|UPDATE\s+public\./i);
});
