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
function loadWorker({ fetchImpl } = {}) {
  const handlers = {};
  const store = new Map();
  const cacheApi = {
    open: async (name) => ({
      addAll: async (urls) => { store.set(name, [...(store.get(name) || []), ...urls]); },
      put: async (request, response) => { store.set(`${name}:put`, [...(store.get(`${name}:put`) || []), request.url]); store.set('lastPut', response); },
    }),
    keys: async () => ['old-cache', CURRENT_CACHE],
    delete: async (key) => { store.set('deleted', [...(store.get('deleted') || []), key]); return true; },
    match: async (request) => `cached:${request.url}`,
  };
  const sandbox = {
    self: {
      location: { origin: 'https://app.example' },
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting: () => { store.set('skipWaiting', true); },
      clients: { claim: async () => { store.set('claimed', true); } },
    },
    caches: cacheApi,
    fetch: fetchImpl || (async () => ({ ok: true, clone() { return this; } })),
    URL,
    Promise,
  };
  vm.runInNewContext(code, sandbox);
  return { handlers, store, sandbox };
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

test('privacy: cross-origin requests (database API, auth, CDN) are never intercepted or cached', () => {
  const { handlers } = loadWorker();
  for (const url of ['https://abc.supabase.co/rest/v1/transactions', 'https://abc.supabase.co/auth/v1/token', 'https://cdn.jsdelivr.net/npm/x']) {
    const event = fetchEvent(url);
    handlers.fetch(event);
    assert.equal(event.responded, false, url);
  }
});

test('service worker: non-GET requests are never intercepted', () => {
  const { handlers } = loadWorker();
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const event = fetchEvent('https://app.example/v2/index.html', method);
    handlers.fetch(event);
    assert.equal(event.responded, false, method);
  }
});

test('service worker: same-origin GET is network-first and refreshes the cache', async () => {
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

test('service worker: falls back to the cache when offline', async () => {
  const { handlers } = loadWorker({ fetchImpl: async () => { throw new TypeError('offline'); } });
  const event = fetchEvent('https://app.example/v2/index.html');
  handlers.fetch(event);
  assert.equal(await event.promise, 'cached:https://app.example/v2/index.html');
});
