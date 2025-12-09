// --- CRITICAL CHANGE: INCREMENT THE CACHE VERSION ---
const CACHE_NAME = 'smartfinance-cache-v3';
// --------------------------------------------------

const ASSETS = [
    'index.html',
    'style.css',
    'app.js',
    'db.js',
    'manifest.json',
    'icon-192.png',
    'icon-512.png',
    // Add the Material Design Lite files if you want the app to be fully offline
    'https://code.getmdl.io/1.3.0/material.indigo-pink.min.css',
    'https://code.getmdl.io/1.3.0/material.min.js'
];

// --- INSTALL: Opens the new cache and adds all assets ---
self.addEventListener('install', evt => {
  console.log('Service Worker: Installing new cache ' + CACHE_NAME);
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Ensure all necessary files are added
      return cache.addAll(ASSETS).catch(error => {
        console.error('Failed to pre-cache some assets:', error);
      });
    })
  );
  // Forces the waiting service worker to become the active service worker
  self.skipWaiting();
});

// --- ACTIVATE: Clears out any old caches (e.g., 'v2') ---
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
    // Takes control of the current page immediately
    return self.clients.claim();
});

// --- FETCH: Serves cached content or fetches new content ---
self.addEventListener('fetch', evt => {
  evt.respondWith(
    caches.match(evt.request).then(res => {
      // Return cached response if found, otherwise fetch from network
      return res || fetch(evt.request);
    })
  );
});
