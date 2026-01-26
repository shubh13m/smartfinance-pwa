// --- VERSION: v1.1.0.0 ---
const CACHE_NAME = 'smartfinance-cache-v32'; 

const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './db.js',
    './manifest.json',
    'https://cdnjs.cloudflare.com/ajax/libs/material-design-lite/1.3.0/material.indigo-pink.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/material-design-lite/1.3.0/material.min.js',
    'https://fonts.googleapis.com/icon?family=Material+Icons'
];

// --- INSTALL ---
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // We use map to catch individual file errors so one missing icon doesn't kill the SW
      return Promise.allSettled(
        ASSETS.map(url => cache.add(url))
      );
    })
  );
  self.skipWaiting();
});

// --- ACTIVATE ---
self.addEventListener('activate', evt => {
    evt.waitUntil(
      caches.keys().then(keys => {
        return Promise.all(keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
        );
      })
    );
    return self.clients.claim();
});

// --- FETCH (Network First with Cache Fallback) ---
self.addEventListener('fetch', evt => {
  if (evt.request.method !== 'GET' || !evt.request.url.startsWith('http')) return;

  evt.respondWith(
    fetch(evt.request)
      .then(networkRes => {
        // If network works, update the cache
        if(networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(evt.request, resClone));
        }
        return networkRes;
      })
      .catch(() => {
        // If network fails (Offline), check cache
        return caches.match(evt.request);
      })
  );
});
