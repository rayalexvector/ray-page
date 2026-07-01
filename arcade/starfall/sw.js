const CACHE_NAME = 'ray-cat-starfall-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './css/style.css?v=cloudsave-2',
  './js/storage.js?v=cloudsave-2',
  '../js/cloud-save.js?v=cloudsave-2',
  './js/audio.js',
  './js/game.js',
  './js/app.js?v=cloudsave-2',
  './README.md',
  './DEPLOY_FOR_HERMES.md'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ray-cat-starfall-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
