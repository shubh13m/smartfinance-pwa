import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const V2 = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const code = readFileSync(resolve(V2, 'sw.js'), 'utf8');
const CURRENT_CACHE = code.match(/const CACHE = '([^']+)'/)[1];

/** Loads the service worker in a sandbox with a fake `self`, `caches` and `fetch`. */
function loadWorker({ fetchImpl, cached = {} } = {}) {
  const handlers = {};
  const store = new Map();
  const cacheApi = {
    open: async (name) => ({
      addAll: async (urls) => { store.set(name, [...(store.get(name) || []), ...urls]); },
      put: async (request, response) => { store.set(`${name}:put`, [...(store.get(`${name}:put`) || []), request.url]); store.set('lastPut', response); },
      match: async (request) => cached[request.url],
    }),
    keys: async () => ['old-cache', CURRENT_CACHE],
    delete: async (key) => { store.set('deleted', [...(store.get('deleted') || []), key]); return true; },
  };
  const calls = [];
  const sandbox = {
    self: {
      location: { origin: 'https://app.example' },
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting: () => { store.set('skipWaiting', true); },
      clients: { claim: async () => { store.set('claimed', true); } },
    },
    caches: cacheApi,
    fetch: (request, options) => { calls.push({ url: request.url, options }); return (fetchImpl || (async () => ({ ok: true, clone() { return this; } })))(request, options); },
    URL,
    Promise,
  };
  vm.runInNewContext(code, sandbox);
  return { handlers, store, sandbox, calls };
}

const fetchEvent = (url, method = 'GET') => {
  const event = { request: { url, method }, responded: false, waited: null };
  event.respondWith = (promise) => { event.responded = true; event.promise = promise; };
  event.waitUntil = (promise) => { event.waited = promise; };
  return event;
};

test('service worker: precaches the app shell on install and activates immediately', async () => {
  const { handlers, store } = loadWorker();
  const event = fetchEvent('x');
  handlers.install(event);
  await event.waited;
  const [cacheName] = [...store.keys()].filter((k) => k.startsWith('smartfinance-v2-shell'));
  assert.ok(cacheName);
  const urls = store.get(cacheName);
  for (const required of ['index.html', 'src/main.js', 'styles/tokens.css', 'styles/base.css', 'styles/components.css', 'styles/layout.css']) {
    assert.ok(urls.includes(required), required);
  }
  assert.equal(store.get('skipWaiting'), true);
});

test('service worker: every precached file exists on disk', async () => {
  const { handlers, store } = loadWorker();
  const event = fetchEvent('x');
  handlers.install(event);
  await event.waited;
  const urls = [...store.values()].find(Array.isArray);
  for (const url of urls.filter((u) => u !== './')) assert.ok(existsSync(resolve(V2, url)), url);
});

test('service worker: precache covers every stylesheet linked from index.html', async () => {
  const html = readFileSync(resolve(V2, 'index.html'), 'utf8');
  const sheets = [...html.matchAll(/rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  const { handlers, store } = loadWorker();
  const event = fetchEvent('x');
  handlers.install(event);
  await event.waited;
  const urls = [...store.values()].find(Array.isArray);
  for (const sheet of sheets) assert.ok(urls.includes(sheet), `${sheet} should be precached`);
});

test('service worker: activation deletes old caches and takes control', async () => {
  const { handlers, store } = loadWorker();
  const event = fetchEvent('x');
  handlers.activate(event);
  await event.waited;
  assert.deepEqual(store.get('deleted'), ['old-cache'], 'only stale caches are removed');
  assert.equal(store.get('claimed'), true);
});

test('privacy: the database API and auth are never intercepted or cached', () => {
  const { handlers } = loadWorker();
  for (const url of ['https://abc.supabase.co/rest/v1/transactions', 'https://abc.supabase.co/auth/v1/token', 'https://abc.supabase.co/realtime/v1/websocket', 'https://example.com/anything']) {
    const event = fetchEvent(url);
    handlers.fetch(event);
    assert.equal(event.responded, false, url);
  }
});

test('service worker: only the public library path on jsDelivr is cached, not the rest of that host', () => {
  const { handlers } = loadWorker();
  const lib = fetchEvent('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  handlers.fetch(lib);
  assert.equal(lib.responded, true);
  const other = fetchEvent('https://cdn.jsdelivr.net/gh/someone/else.js');
  handlers.fetch(other);
  assert.equal(other.responded, false);
});

test('service worker: non-GET requests are never intercepted', () => {
  const { handlers } = loadWorker();
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const event = fetchEvent('https://app.example/v2/index.html', method);
    handlers.fetch(event);
    assert.equal(event.responded, false, method);
  }
});

test('speed: a cached file is served at once, without waiting for the network', async () => {
  const url = 'https://app.example/v2/src/main.js';
  let finishNetwork;
  const slowNetwork = new Promise((resolve) => { finishNetwork = resolve; });
  const { handlers, calls } = loadWorker({ cached: { [url]: 'from-cache' }, fetchImpl: () => slowNetwork });
  const event = fetchEvent(url);
  handlers.fetch(event);
  assert.equal(await event.promise, 'from-cache', 'answered while the network is still pending');
  assert.equal(calls.length, 1, 'it still checks for a newer version in the background');
  assert.equal(calls[0].options.cache, 'no-cache', 'the background check bypasses the browser\'s own stale copy');
  finishNetwork({ ok: true, clone() { return this; } });
  await event.waited;
});

test('service worker: the background refresh updates the cache for next time', async () => {
  const url = 'https://app.example/v2/src/main.js';
  const { handlers, store } = loadWorker({ cached: { [url]: 'old' }, fetchImpl: async () => ({ ok: true, clone() { return { fresh: true }; } }) });
  const event = fetchEvent(url);
  handlers.fetch(event);
  await event.promise;
  await event.waited;
  assert.deepEqual([...store.keys()].filter((k) => k.endsWith(':put')).length, 1);
  assert.deepEqual(store.get('lastPut'), { fresh: true });
});

test('service worker: a failing background refresh does not break serving the cached file', async () => {
  const url = 'https://app.example/v2/index.html';
  const { handlers } = loadWorker({ cached: { [url]: 'from-cache' }, fetchImpl: async () => { throw new TypeError('offline'); } });
  const event = fetchEvent(url);
  handlers.fetch(event);
  assert.equal(await event.promise, 'from-cache');
  await assert.doesNotReject(event.waited);
});

test('service worker: a file seen for the first time comes from the network and is cached', async () => {
  const response = { ok: true, clone() { return { copied: true }; } };
  const { handlers, store } = loadWorker({ fetchImpl: async () => response });
  const event = fetchEvent('https://app.example/v2/src/main.js');
  handlers.fetch(event);
  assert.equal(event.responded, true);
  assert.equal(await event.promise, response);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok([...store.keys()].some((k) => k.endsWith(':put')));
});

test('service worker: failed responses are not cached', async () => {
  const { handlers, store } = loadWorker({ fetchImpl: async () => ({ ok: false, clone() { return this; } }) });
  const event = fetchEvent('https://app.example/v2/missing.js');
  handlers.fetch(event);
  await event.promise;
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(![...store.keys()].some((k) => k.endsWith(':put')));
});

test('service worker: offline and never cached is an error, not a wrong answer', async () => {
  const { handlers } = loadWorker({ fetchImpl: async () => { throw new TypeError('offline'); } });
  const event = fetchEvent('https://app.example/v2/index.html');
  handlers.fetch(event);
  await assert.rejects(event.promise, TypeError);
});
