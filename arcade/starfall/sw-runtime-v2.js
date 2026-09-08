// Shared by every historical registration URL; never cache private requests.
const CACHE_NAME = 'ray-cat-starfall-static-v2';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './assets/icon.svg',
  './css/style.css?v=heavy-1',
  '../css/save-ui.css?v=save-v2',
  '../js/save-core.js?v=save-v2',
  '../js/save-schema.js?v=save-v2',
  './js/storage.js?v=save-v2', '../js/cloud-save.js?v=save-v2',
  './js/audio.js', './js/game.js?v=save-v2', './js/app-cloudsave-3.js?v=save-v2'
];
const BASE = new URL('./', self.location.href);
const ALLOWED = new Set(ASSETS.map(path => new URL(path, BASE).href));
const HOME = new URL('./index.html', BASE).href;
function allowed(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === BASE.origin && ALLOWED.has(url.href);
}
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
async function cleanCaches() {
  for (const key of await caches.keys()) {
    if (!key.startsWith('ray-cat-starfall-')) continue;
    const cache = await caches.open(key);
    for (const request of await cache.keys()) {
      if (!allowed(request)) await cache.delete(request);
    }
    if (key !== CACHE_NAME) await caches.delete(key);
  }
}
self.addEventListener('activate', event => {
  event.waitUntil(cleanCaches().then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'RAY_GAME_CACHE_PROTOCOL' && event.ports[0]) {
    // The handshake is only answered after any old API cache entries are removed.
    event.waitUntil(cleanCaches().then(() => event.ports[0].postMessage({ rayGameCacheProtocol: 2 })));
  }
});
self.addEventListener('fetch', event => {
  if (!allowed(event.request)) return;
  const navigation = event.request.mode === 'navigate';
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (!navigation) {
      const hit = await cache.match(event.request);
      if (hit) return hit;
    }
    try {
      const response = await fetch(event.request);
      if (response.ok && !response.redirected && response.type !== 'opaque') {
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      if (navigation) {
        const home = await cache.match(HOME);
        if (home) return home;
      }
      throw error;
    }
  })());
});
