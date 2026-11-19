// Caches only this app's own files, plus the public supabase-js library from jsDelivr.
// Everything else cross-origin (the database API, auth) is never touched, so private
// financial data is never stored in Cache Storage.
const CACHE = 'smartfinance-v2-shell-4';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([
    './', 'index.html', 'src/theme-boot.js', 'src/main.js',
    'styles/tokens.css', 'styles/base.css', 'styles/components.css', 'styles/layout.css',
  ])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isLibrary = (url) => url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/npm/');

// Opens instantly from the cache and refreshes it in the background, so the app starts
// without waiting for ~60 network round trips. A new version appears on the next launch.
async function respond(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  // no-cache: always check with the server, never trust the browser's own 10-minute copy.
  const refresh = fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (!cached) return refresh;
  event.waitUntil(refresh.catch(() => {}));
  return cached;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin && !isLibrary(url)) return;
  event.respondWith(respond(event, request));
});
