// --- CRITICAL CHANGE: INCREMENT THE CACHE VERSION ---
const CACHE_NAME = 'smartfinance-cache-v18'; // Incremented for Phase 3
// --------------------------------------------------

const ASSETS = [
    'index.html',
    'style.css',
    'app.js',
    'db.js',
    'manifest.json',
    'icon-192.png',
    'icon-512.png',
    'https://code.getmdl.io/1.3.0/material.indigo-pink.min.css',
    'https://code.getmdl.io/1.3.0/material.min.js'
];

// --- INSTALL: Opens the new cache and adds all assets ---
self.addEventListener('install', evt => {
  console.log('Service Worker: Installing new cache ' + CACHE_NAME);
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(error => {
        console.error('Failed to pre-cache some assets:', error);
      });
    })
  );
  self.skipWaiting();
});

// --- ACTIVATE: Clears out any old caches ---
self.addEventListener('activate', evt => {
    console.log('Service Worker: Activating and clearing old caches.');
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

// --- FETCH: PHASE 3 - NETWORK FIRST STRATEGY ---
// This ensures that bug fixes reach the user immediately if they have a connection.
self.addEventListener('fetch', evt => {
  evt.respondWith(
    fetch(evt.request).then(networkRes => {
      // Check if we received a valid response
      if(networkRes && networkRes.status === 200) {
        const resClone = networkRes.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(evt.request, resClone);
        });
      }
      return networkRes;
    }).catch(() => {
      // If network fails (offline), fall back to cache
      return caches.match(evt.request);
    })
  );
});
