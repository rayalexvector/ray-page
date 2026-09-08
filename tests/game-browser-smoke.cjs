const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync('/tmp/rayalex-game-browser-');
const launchOptions = require('../tools/playwright.cjs').browserLaunchOptions();
const results = [], saves = new Map(), receipts = new Map();
const metrics = { mockReads: 0, mockWrites: 0, legacyRejected: 0, externalBlocked: [], workerResources: [] };
let legacy = false;
const oldFiles = new Map();
const LEGACY_BASELINE = '20444af3c65e4fafd993fc2b89db8015148524e4';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.md': 'text/plain' };
function reply(response, data, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data));
}
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.startsWith('/__mock/api/')) {
    const owner = request.headers['x-smoke-owner'] || 'smoke-owner';
    if (url.pathname.endsWith('/auth/me')) {
      metrics.mockReads++;
      if (!legacy && !url.pathname.endsWith('/v2/auth/me')) return reply(response, { ok: false, error: 'client_upgrade_required' }, 409);
      return reply(response, { ok: true, user: { id: owner, email: owner + '@example.invalid', email_verified: true } });
    }
    const appId = url.pathname.split('/').pop(), key = owner + ':' + appId;
    if (request.method === 'GET') {
      metrics.mockReads++;
      if (url.searchParams.has('ownerId') && url.searchParams.get('ownerId') !== owner) return reply(response, { ok: false, error: 'owner_changed' }, 409);
      return reply(response, { ok: true, protocol: 2, save: saves.get(key) || null });
    }
    if (!url.pathname.includes('/v2/')) { metrics.legacyRejected++; return reply(response, { ok: false, error: 'client_upgrade_required' }, 409); }
    let raw = ''; for await (const chunk of request) raw += chunk;
    try {
      const body = JSON.parse(raw);
      if (body.ownerId !== owner) return reply(response, { ok: false, error: 'owner_changed' }, 409);
      assert.equal(body.protocol, 2); assert.equal(body.schema, 2);
      assert.ok(require('../arcade/js/save-schema.js').validate(body.payload, appId));
      const receiptKey = key + ':' + body.requestId;
      const hash = crypto.createHash('sha256').update(raw).digest('hex');
      if (receipts.has(receiptKey)) {
        const previous = receipts.get(receiptKey);
        if (previous.hash !== hash) return reply(response, { ok: false, error: 'request_id_reused' }, 409);
        return reply(response, previous.ack);
      }
      const revision = saves.get(key)?.revision || 0;
      if (body.baseRevision !== revision) return reply(response, { ok: false, error: 'revision_conflict', revision }, 409);
      const ack = { ok: true, protocol: 2, gameId: appId, slot: 'default', requestId: body.requestId, revision: revision + 1, checksum: body.checksum, updatedAt: Date.now() };
      saves.set(key, { ...ack, schema: 2, payload: body.payload, deviceId: body.deviceId });
      receipts.set(receiptKey, { hash, ack }); metrics.mockWrites++;
      return reply(response, ack);
    } catch (error) { return reply(response, { ok: false, error: String(error) }, 400); }
  }
  if (url.pathname === '/__blank') { response.writeHead(200, { 'content-type': 'text/html' }); return response.end('<!doctype html><title>Isolated game test</title>'); }
  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (relative.endsWith('/')) relative += 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !(relative.startsWith('arcade/') || relative === 'apple-touch-icon.png')) { response.writeHead(404); return response.end('not found'); }
  try {
    let data;
    if (legacy && relative.startsWith('arcade/')) {
      if (!oldFiles.has(relative)) oldFiles.set(relative, execFileSync('git', ['show', LEGACY_BASELINE + ':' + relative], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }));
      data = oldFiles.get(relative);
    } else data = fs.readFileSync(file);
    if (/\/sw[^/]*\.js$/.test(relative)) metrics.workerResources.push({ path: relative, legacy, sha256: crypto.createHash('sha256').update(data).digest('hex') });
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'service-worker-allowed': '/arcade/starfall/' });
    response.end(data);
  } catch (_) { response.writeHead(404); response.end('not found'); }
});

async function configure(context, owner, origin, routeRequests = true) {
  if (routeRequests) await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    metrics.externalBlocked.push(url.origin + url.pathname); return route.abort();
  });
  await context.addInitScript(({ owner }) => {
    window.__smokeOwner = owner;
    const original = window.fetch;
    window.fetch = (input, options = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin === 'https://api.rayalex.cn') {
        const headers = new Headers(options.headers || {}); headers.set('x-smoke-owner', window.__smokeOwner);
        return original('/__mock/api' + url.pathname + url.search, { ...options, headers });
      }
      return original(input, options);
    };
    function capture(namespace) {
      let value;
      Object.defineProperty(window, namespace, {
        configurable: true, get: () => value,
        set(next) {
          if (value === next) return;
          value = new Proxy(next, { set(target, key, item) {
            target[key] = typeof item === 'function' && (namespace === 'RayGames' || key === 'Game')
              ? new Proxy(item, { construct(target, args, newTarget) { const game = Reflect.construct(target, args, newTarget); window.__activeGame = game; return game; } }) : item;
            return true;
          } });
        }
      });
    }
    capture('RayGames'); capture('RayStarfall');
  }, { owner });
}
async function snapshot(page, name) {
  // Freeze only the capture frame after testing motion, avoiding software-renderer
  // screenshot starvation on a busy VPS. Restore the same game's loop afterwards.
  await page.evaluate(() => {
    const game = window.__activeGame || window.RayFrontierApp;
    window.__captureGame = game && game.raf ? game : null;
    if (window.__captureGame) { cancelAnimationFrame(game.raf); game.raf = 0; }
  });
  try {
    const session = await page.context().newCDPSession(page);
    let timer;
    try {
      const screenshot = await Promise.race([
        session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('capture timeout: ' + name)), 20000); })
      ]);
      fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(screenshot.data, 'base64'));
    } finally { clearTimeout(timer); await session.detach(); }
  }
  finally { await page.evaluate(() => {
    const game = window.__captureGame;
    if (game && !game.raf) game.raf = requestAnimationFrame(time => game.loop(time));
    window.__captureGame = null;
  }).catch(() => {}); }
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.width + 1, name + ': horizontal overflow ' + JSON.stringify(size));
}
async function canvasPixels(page, selector) {
  return page.locator(selector).evaluate(canvas => {
    // WebGL's default framebuffer is cleared after compositing; sample a fresh frame.
    if (canvas.id === 'frontierCanvas') window.RayFrontierApp.render();
    const sample = document.createElement('canvas'); sample.width = 64; sample.height = 64;
    const ctx = sample.getContext('2d'); ctx.drawImage(canvas, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let opaque = 0; const colors = new Set();
    for (let i = 0; i < data.length; i += 4) { if (data[i + 3]) opaque++; colors.add([data[i], data[i + 1], data[i + 2]].join(',')); }
    return { opaque, colors: colors.size };
  });
}
async function ready(page, app) {
  await page.waitForFunction(app => {
    const storage = app === 'starfall' ? window.RayStarfall?.Store : window.RayArcade?.Storage;
    return storage?.store.owner === window.__smokeOwner && storage.store.persisted;
  }, app);
  await page.waitForTimeout(250);
}
async function enterArcade(page, origin, gameId) {
  await page.goto(origin + '/arcade/'); await ready(page, 'arcade');
  await page.locator(`[data-start="${gameId}"]`).click();
  if (await page.locator('.modal-backdrop').count()) await page.locator('.modal-actions button').first().click();
  await page.waitForFunction(() => !!window.__activeGame);
}
async function pauseArcade(page) {
  await page.locator('[data-pause]').click();
  assert.equal(await page.evaluate(() => window.__activeGame.paused), true);
  await page.locator('.modal-actions button').filter({ hasText: /^继续$/ }).click();
  assert.equal(await page.evaluate(() => window.__activeGame.paused), false);
  await page.locator('[data-restart]').click();
}
async function starfall(page, origin, label) {
  await page.goto(origin + '/arcade/starfall/'); await ready(page, 'starfall');
  await snapshot(page, label + '-starfall-menu');
  await page.locator('#startBtn').click();
  if (await page.locator('#helpScreen:not(.hidden)').count()) await page.locator('#startFromHelpBtn').click();
  await page.waitForFunction(() => window.__activeGame.state === 'playing' && window.__activeGame.time > .2);
  const before = await page.evaluate(() => ({ x: window.__activeGame.player.x, y: window.__activeGame.player.y }));
  const box = await page.locator('#gameCanvas').boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .7); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .5, { steps: 8 }); await page.waitForTimeout(300); await page.mouse.up();
  const after = await page.evaluate(() => ({ x: window.__activeGame.player.x, y: window.__activeGame.player.y }));
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y) > 10);
  await snapshot(page, label + '-starfall-playing');
  const pixels = await canvasPixels(page, '#gameCanvas'); assert.ok(pixels.opaque > 1000 && pixels.colors > 20);
  await page.locator('#pauseBtn').click();
  const time = await page.evaluate(() => window.__activeGame.time); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__activeGame.time), time);
  await page.locator('#restartFromPauseBtn').click(); await page.waitForFunction(() => window.__activeGame.state === 'playing' && window.__activeGame.time < 1);
  await page.waitForFunction(() => window.__activeGame.run.score > 0, { timeout: 12000 });
  const actualScore = await page.evaluate(() => window.__activeGame.run.score);
  // A synthetic terminal reward exercises the real settlement and purchase handlers.
  await page.evaluate(async () => { window.__activeGame.run.coins = 140; window.__activeGame.gameOver(); await window.RayStarfall.Store.store.tail; });
  await page.locator('#exitGameOverBtn').click(); await page.locator('#shopBtn').click();
  const wallet = await page.evaluate(() => window.RayStarfall.Store.get().wallet.coins);
  await page.locator('.buy-btn').first().click();
  await page.waitForFunction(() => window.RayStarfall.Store.get().upgrades.hull === 1);
  assert.equal(await page.evaluate(() => window.RayStarfall.Store.get().wallet.coins), wallet - 70);
  await snapshot(page, label + '-starfall-upgrade');
  await page.reload(); await ready(page, 'starfall');
  assert.equal(await page.evaluate(() => window.RayStarfall.Store.get().upgrades.hull), 1);
  assert.equal(await page.evaluate(() => window.RayStarfall.Store.get().wallet.coins), wallet - 70);
  return { pixels, actualScore, persistedCoins: wallet - 70, upgrade: 1 };
}
async function merge2048(page, origin, label) {
  await enterArcade(page, origin, 'merge2048');
  // A random opening can already be left-aligned, where a correct swipe is a no-op.
  // Restore a valid mergeable board so the real pointer gesture has a known result.
  await page.evaluate(() => window.__activeGame.restoreProgress({
    active: true,
    board: [[0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    score: 0,
    bestLevel: 1,
    celebrated: {}
  }));
  await snapshot(page, label + '-2048-start');
  const before = await page.evaluate(() => JSON.stringify(window.__activeGame.board));
  const box = await page.locator('.merge-board').boundingBox();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .5); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .15, box.y + box.height * .5, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(200);
  const moved = await page.evaluate(() => JSON.stringify(window.__activeGame.board));
  assert.notEqual(moved, before, '2048 mouse swipe must move board');
  const merged = await page.evaluate(() => ({
    leftTile: window.__activeGame.board[0][0], score: window.__activeGame.score
  }));
  assert.equal(merged.leftTile, 2, 'left swipe must merge the two level-one tiles');
  assert.equal(merged.score, 32, 'the pointer gesture must award the merge score');
  await page.evaluate(() => window.RayArcade.Storage.store.tail);
  const saved = await page.evaluate(() => window.RayArcade.Storage.loadSession('merge2048'));
  assert.equal(saved.board.length, 4);
  await page.reload(); await ready(page, 'arcade');
  await page.locator('[data-start="merge2048"]').click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.__activeGame.board)), JSON.stringify(saved.board));
  await snapshot(page, label + '-2048-restored');
  await pauseArcade(page);
  return { restored: true, boardRows: 4 };
}
async function frontier(page, origin, label) {
  await page.goto(origin + '/arcade/frontier/'); await ready(page, 'arcade');
  await page.locator('[data-start]').click(); await page.waitForFunction(() => window.RayFrontierApp.state === 'playing');
  const before = await page.evaluate(() => ({ x: window.RayFrontierApp.player.pos.x, z: window.RayFrontierApp.player.pos.z }));
  const size = page.viewportSize();
  await page.mouse.move(size.width * .25, size.height * .65); await page.mouse.down();
  await page.mouse.move(size.width * .4, size.height * .55, { steps: 6 }); await page.waitForTimeout(400); await page.mouse.up();
  const after = await page.evaluate(() => ({ x: window.RayFrontierApp.player.pos.x, z: window.RayFrontierApp.player.pos.z }));
  assert.ok(Math.hypot(before.x - after.x, before.z - after.z) > .1);
  await page.waitForFunction(() => window.RayFrontierApp.player.score > 0, null, { timeout: 15000 });
  await snapshot(page, label + '-frontier-playing');
  const pixels = await canvasPixels(page, '#frontierCanvas'); assert.ok(pixels.opaque > 1000 && pixels.colors > 20);
  await page.locator('[data-pause]').click(); assert.equal(await page.evaluate(() => window.RayFrontierApp.state), 'paused');
  await page.locator('[data-pause]').click(); assert.equal(await page.evaluate(() => window.RayFrontierApp.state), 'playing');
  const score = await page.evaluate(() => window.RayFrontierApp.player.score);
  await page.evaluate(async () => { window.RayFrontierApp.gameOver(); await window.RayArcade.Storage.store.tail; });
  await page.locator('[data-restart]').click(); assert.equal(await page.evaluate(() => window.RayFrontierApp.state), 'playing');
  await page.reload(); await ready(page, 'arcade');
  assert.ok(await page.evaluate(score => window.RayArcade.Storage.getStats().frontier.bestScore >= score, score));
  return { score, pixels, persisted: true };
}

async function workerUpgrade(browser, origin) {
  const context = await browser.newContext();
  // SW update-script requests cannot be routed reliably by Playwright. This
  // context uses the real loopback server; browser DNS blocks all other hosts.
  await configure(context, 'smoke-upgrade', origin, false);
  const page = await context.newPage();
  const failures = [];
  context.on('console', message => { if (['error', 'warning'].includes(message.type())) failures.push('context: ' + message.text()); });
  page.on('pageerror', error => failures.push(String(error)));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) failures.push(message.text()); });
  page.on('requestfailed', request => failures.push(request.url() + ': ' + request.failure()?.errorText));
  try {
    legacy = true;
    await page.goto(origin + '/arcade/starfall/');
    console.log('SW upgrade: legacy page loaded, waiting for initial controller');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    console.log('SW upgrade: original controller active');
    const originalURL = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
    assert.ok(originalURL.includes('/sw-cloudsave-3.js'));
    await page.evaluate(async () => {
      const cache = await caches.open('ray-cat-starfall-v6-heavy-1');
      await cache.put('https://api.rayalex.cn/auth/me', new Response('{"synthetic":true}'));
      await cache.put('/__mock/api/v2/auth/me', new Response('{"synthetic":true}'));
    });
    legacy = false;
    console.log('SW upgrade: requesting safe controller update');
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      window.__upgradeEvents = [];
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        window.__upgradeEvents.push('updatefound:' + worker?.state);
        worker?.addEventListener('statechange', () => window.__upgradeEvents.push('state:' + worker.state));
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('controller upgrade timeout')), 30000);
        navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
        registration.update().catch(error => { clearTimeout(timer); reject(error); });
      });
    });
    const evidence = await page.evaluate(async () => {
      const protocol = await new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => reject(new Error('protocol timeout')), 5000);
        channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data.rayGameCacheProtocol); };
        navigator.serviceWorker.controller.postMessage({ type: 'RAY_GAME_CACHE_PROTOCOL' }, [channel.port2]);
      });
      const entries = [];
      for (const name of await caches.keys()) {
        if (name.startsWith('ray-cat-starfall-')) {
          for (const request of await (await caches.open(name)).keys()) entries.push(request.url);
        }
      }
      return { protocol, scriptURL: navigator.serviceWorker.controller.scriptURL, entries };
    });
    assert.equal(evidence.protocol, 2);
    assert.equal(evidence.scriptURL, originalURL);
    assert.ok(evidence.entries.length > 5);
    assert.ok(evidence.entries.every(url => new URL(url).origin === origin && !url.includes('/api/')));
    await page.reload(); await ready(page, 'starfall');
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.RayStarfall?.Store);
    assert.equal(await page.evaluate(async () => {
      try { const result = await fetch('./missing-game-script.js'); return (await result.text()).includes('<!doctype'); }
      catch (_) { return false; }
    }), false);
    results.push({ name: 'old-sw-upgrade', ok: true, baseline: LEGACY_BASELINE, originalURL, protocol: 2, staticEntries: evidence.entries.length, apiCacheClean: true, offline: true });
    console.log(JSON.stringify(results.at(-1)));
  } catch (error) {
    const registration = await page.evaluate(async () => ({ registrations: (await navigator.serviceWorker.getRegistrations()).map(r => ({
      scope: r.scope, active: r.active?.state, waiting: r.waiting?.state, installing: r.installing?.state
    })), events: window.__upgradeEvents, caches: await caches.keys() })).catch(() => []);
    console.error(JSON.stringify({ stage: 'worker-upgrade', error: String(error), stack: error.stack, registration, failures }));
    throw error;
  } finally { legacy = false; await context.close(); }
}

async function remainingGame(page, origin, label, id) {
  await enterArcade(page, origin, id);
  if (id === 'reaction') await page.locator('.reaction-ready [data-start]').click();
  await pauseArcade(page);
  if (id === 'dailyCard') {
    await page.locator('[data-draw]').click();
    await page.waitForFunction(() => window.RayArcade.Storage.getCards().draws === 1);
  } else if (id === 'dungeon') {
    const before = await page.locator('[data-log]').innerText();
    await page.locator('[data-choices] button').first().click();
    assert.notEqual(await page.locator('[data-log]').innerText(), before);
  } else if (id === 'reaction') {
    const target = page.locator('.reaction-target:not(.bad)').first();
    await target.waitFor();
    const box = await target.boundingBox();
    if (label === 'mobile') await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => window.__activeGame.score > 0);
  } else {
    const box = await page.locator('canvas').boundingBox();
    const start = { x: box.x + box.width * .5, y: box.y + box.height * .65 };
    const end = { x: box.x + box.width * .25, y: box.y + box.height * .4 };
    if (label === 'mobile') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      await page.waitForTimeout(200);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.waitForTimeout(200);
      await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
    }
    if (id === 'neonBalls') assert.equal(await page.evaluate(() => window.__activeGame.shooting), true);
    if (id === 'rayHop') assert.ok(await page.evaluate(() => !!window.__activeGame.jump || window.__activeGame.jumping || window.__activeGame.state === 'jumping'));
    const pixels = await canvasPixels(page, 'canvas'); assert.ok(pixels.opaque > 1000 && pixels.colors > 20);
  }
  await snapshot(page, label + '-' + id);
  // Terminal values are synthetic; input above and the actual persistence handlers are real.
  await page.evaluate(async id => {
    const game = window.__activeGame;
    if (id === 'dungeon') { game.state.floor = 7; game.gameOver('smoke'); }
    else if (id === 'reaction') game.endRound();
    else if (id !== 'dailyCard') { game.dead = false; game.score = 37; game.gameOver(); }
    await window.RayArcade.Storage.store.tail;
  }, id);
  const saved = await page.evaluate(id => window.RayArcade.Storage.getStats()[id], id);
  await page.reload(); await ready(page, 'arcade');
  assert.deepEqual(await page.evaluate(id => window.RayArcade.Storage.getStats()[id], id), saved);
  if (id === 'dailyCard') assert.equal(await page.evaluate(() => window.RayArcade.Storage.getCards().draws), 1);
  return { input: label === 'mobile' ? 'touch' : 'mouse', pausedRestarted: true, persisted: true };
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  console.log(JSON.stringify({ origin, output, playwright: require.resolve('playwright-core'), browser: launchOptions.executablePath || 'Playwright headless shell', cache: process.env.PLAYWRIGHT_BROWSERS_PATH }));
  let browser;
  try {
    browser = await chromium.launch({ ...launchOptions, headless: true, args: [
      '--no-sandbox', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', '--no-first-run', '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'
    ] });
    console.log(JSON.stringify({ browserVersion: browser.version(), launchOptions }));
    if (!process.env.GAME_ONLY || process.env.GAME_ONLY === 'sw') await workerUpgrade(browser, origin);
    for (const [label, viewport] of (process.env.GAME_ONLY === 'sw' ? [] : [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]])) {
      const context = await browser.newContext({ viewport, hasTouch: label === 'mobile', deviceScaleFactor: 1 });
      await configure(context, 'smoke-' + label, origin);
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const errors = []; page.on('pageerror', error => errors.push(String(error)));
      try {
        if (process.argv.includes('--probe')) {
          for (const app of ['', 'starfall/', 'frontier/']) {
            console.log(JSON.stringify({ probe: label + '/' + app }));
            await page.goto(origin + '/arcade/' + app); await ready(page, app === 'starfall/' ? 'starfall' : 'arcade');
            await snapshot(page, label + '-' + (app || 'arcade').replace('/', '') + '-probe');
          }
        } else {
          const remaining = ['catJump', 'rayHop', 'neonBalls', 'reaction', 'dungeon', 'dailyCard'];
          for (const [name, run] of [['starfall', starfall], ['merge2048', merge2048], ['frontier', frontier], ...remaining.map(id => [id, (page, origin, label) => remainingGame(page, origin, label, id)])]) {
            if (process.env.GAME_ONLY && process.env.GAME_ONLY !== name && !(process.env.GAME_ONLY === 'remaining' && remaining.includes(name))) continue;
            console.log(JSON.stringify({ starting: name, viewport: label }));
            const details = await run(page, origin, label); results.push({ viewport: label, name, ok: true, ...details });
            console.log(JSON.stringify(results.at(-1)));
          }
        }
        assert.deepEqual(errors, [], label + ' runtime errors');
      } catch (error) {
        await page.screenshot({ path: path.join(output, label + '-failure.png'), fullPage: false, timeout: 3000 }).catch(() => {});
        console.error(JSON.stringify({ viewport: label, error: String(error), stack: error.stack, errors })); throw error;
      } finally { await context.close(); }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ origin, results, metrics, closed: true }, null, 2));
    console.log(JSON.stringify({ closed: true, origin, output, results: results.length, metrics }));
  }
}
main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
