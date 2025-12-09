const CACHE_NAME = 'smartfinance-cache-v1';
const ASSETS = ['index.html','style.css','app.js','db.js','manifest.json','icon-192.png','icon-512.png'];

self.addEventListener('install', evt=>{
  evt.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)));
});

self.addEventListener('fetch', evt=>{
  evt.respondWith(caches.match(evt.request).then(res=>res || fetch(evt.request)));
});

self.addEventListener('activate', evt=>{
  evt.waitUntil(self.clients.claim());
});
