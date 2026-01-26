// --- CRITICAL CHANGE: INCREMENT THE CACHE VERSION ---
const CACHE_NAME = 'smartfinance-cache-v29'; // Incremented for Phase 3
// --------------------------------------------------

const ASSETS = [
    'index.html',
    'style.css',
    'app.js',
    'db.js',
    'sync.js', // Added to assets list for reliability
    'manifest.json',
    'icon-192.png',
    'icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/material-design-lite/1.3.0/material.indigo-pink.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/material-design-lite/1.3.0/material.min.js',
    'https://fonts.googleapis.com/icon?family=Material+Icons'
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

// --- FETCH: PHASE 3 - NETWORK FIRST WITH TIMEOUT STRATEGY ---
self.addEventListener('fetch', evt => {
  // --- FIX: IGNORE NON-HTTP(S) REQUESTS (Chrome Extensions, etc.) ---
  if (!(evt.request.url.indexOf('http') === 0)) return;
  // -----------------------------------------------------------------

  // We only cache GET requests
  if (evt.request.method !== 'GET') return;

  evt.respondWith(
    // Create a timeout promise to prevent hanging on slow networks
    new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        caches.match(evt.request).then(res => {
          if (res) resolve(res);
        });
      }, 3000); // 3-second timeout

      fetch(evt.request).then(networkRes => {
        clearTimeout(timeoutId);
        if(networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(evt.request, resClone);
          });
        }
        resolve(networkRes);
      }).catch(() => {
        clearTimeout(timeoutId);
        resolve(caches.match(evt.request));
      });
    })
  );
});
