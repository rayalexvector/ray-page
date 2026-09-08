const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function harness() {
  const base = 'https://rayalex.cn/arcade/starfall/';
  const caches = new Map(), handlers = new Map();
  let network = async () => new Response('asset');
  const key = r => new URL(typeof r === 'string' ? r : r.url, base).href;
  const c = {
    URL, Set, Response, console,
    self: { location: { href: base + 'sw-cloudsave-3.js?v=heavy-1' }, skipWaiting: async () => {}, clients: { claim: async () => {} },
      addEventListener: (type, fn) => handlers.set(type, fn) },
    fetch: request => network(request),
    caches: {
      keys: async () => [...caches.keys()], delete: async k => caches.delete(k),
      open: async name => {
        if (!caches.has(name)) caches.set(name, new Map());
        const values = caches.get(name);
        return {
          keys: async () => [...values.keys()].map(url => ({ url, method: 'GET' })),
          delete: async r => values.delete(key(r)), match: async r => values.get(key(r)),
          put: async (r,v) => values.set(key(r), v),
          addAll: async paths => paths.forEach(p => values.set(key(p), new Response(p.endsWith('html') ? '<html>shell</html>' : 'asset')))
        };
      }
    }
  };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('arcade/starfall/sw-runtime-v2.js', 'utf8'), c);
  return { c, caches, handlers, setNetwork(fn) { network = fn; }, async event(type, fields = {}) {
    let result;
    handlers.get(type)(Object.assign({ waitUntil: p => { result = p; }, respondWith: p => { result = p; } }, fields));
    return result;
  } };
}

test('all historical SW URLs load the safe runtime', () => {
  for (const name of ['sw.js', 'sw-cloudsave-2.js', 'sw-cloudsave-3.js']) {
    assert.equal(fs.readFileSync('arcade/starfall/' + name, 'utf8').trim(), "importScripts('./sw-runtime-v2.js');");
  }
});
test('upgrade clears known old API caches and leaves unrelated caches alone', async () => {
  const h = harness();
  h.caches.set('ray-cat-starfall-v6-heavy-1', new Map([['https://api.rayalex.cn/auth/me', new Response('private')]]));
  h.caches.set('other-app', new Map([['https://example.org/x', new Response('keep')]]));
  await h.event('install'); await h.event('activate');
  assert.equal(h.caches.has('ray-cat-starfall-v6-heavy-1'), false);
  assert.equal(h.caches.has('other-app'), true);
  for (const [name, values] of h.caches) {
    if (name.startsWith('ray-cat-starfall-')) assert.ok([...values.keys()].every(url => !url.includes('api.rayalex')));
  }
});
test('cross-origin auth, saves, same-origin API and non-GET requests are never intercepted', async () => {
  const h = harness(); await h.event('install');
  for (const url of ['https://api.rayalex.cn/auth/me', 'https://api.rayalex.cn/v2/auth/me', 'https://api.rayalex.cn/v2/game-saves/starfall', 'https://rayalex.cn/arcade/starfall/api/me']) {
    assert.equal(await h.event('fetch', { request: { method: 'GET', url, mode: 'cors' } }), undefined);
  }
  assert.equal(await h.event('fetch', { request: { method: 'POST', url: 'https://rayalex.cn/arcade/starfall/index.html' } }), undefined);
});
test('offline HTML fallback is navigation-only; failed JS never receives HTML', async () => {
  const h = harness(); await h.event('install');
  h.setNetwork(async () => { throw new Error('offline'); });
  const cache = h.caches.get('ray-cat-starfall-static-v2');
  cache.delete('https://rayalex.cn/arcade/starfall/');
  const nav = await h.event('fetch', { request: { method: 'GET', url: 'https://rayalex.cn/arcade/starfall/', mode: 'navigate' } });
  assert.match(await nav.text(), /html/);
  cache.delete('https://rayalex.cn/arcade/starfall/js/audio.js');
  await assert.rejects(h.event('fetch', { request: { method: 'GET', url: 'https://rayalex.cn/arcade/starfall/js/audio.js', mode: 'cors' } }), /offline/);
});
test('safe controller handshake follows cleanup', async () => {
  const h = harness(); await h.event('install');
  h.caches.get('ray-cat-starfall-static-v2').set('https://api.rayalex.cn/auth/me', new Response('old-private'));
  let ack;
  await h.event('message', { data: { type: 'RAY_GAME_CACHE_PROTOCOL' }, ports: [{ postMessage: data => { ack = data; } }] });
  assert.equal(ack.rayGameCacheProtocol, 2);
  assert.equal(h.caches.get('ray-cat-starfall-static-v2').has('https://api.rayalex.cn/auth/me'), false);
});
