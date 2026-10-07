const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync('/tmp/ray-save-hardening-');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/blank') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="host"></main>'); }
  const file = path.resolve(root, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(path.join(root, 'arcade') + path.sep)) { response.writeHead(404); return response.end(); }
  try { response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); response.end(fs.readFileSync(file)); }
  catch (_) { response.writeHead(404); response.end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ ...require('../tools/playwright.cjs').browserLaunchOptions(), headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-networking', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/blank');
      await page.addStyleTag({ url: origin + '/arcade/css/style.css' });
      for (const script of ['save-schema', 'save-core', 'storage', 'ui']) await page.addScriptTag({ url: origin + '/arcade/js/' + script + '.js' });
      await page.addScriptTag({ url: origin + '/arcade/games/merge-2048.js' });
      await page.evaluate(async () => {
        const storage = window.RayArcade.Storage; await storage.store.ready;
        const corrupt = { active: true, board: [[9, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 8]], score: 64, bestLevel: 8 };
        await storage.store.edit(record => { record.payload.buckets.sessions.merge2048 = corrupt; });
        await storage.store.reload();
        window.game = new window.RayGames.Merge2048(document.querySelector('#host'), { goHome() { window.wentHome = true; } });
        game.mount(); game.start();
      });
      await page.getByText('合成进度需要恢复', { exact: true }).waitFor();
      const box = await page.locator('.modal-card').boundingBox();
      assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1);
      await page.screenshot({ path: path.join(output, `${width}-recovery.png`) });
      await page.getByRole('button', { name: '恢复棋盘', exact: true }).tap();
      await page.waitForFunction(() => window.game.started);
      assert.deepEqual(await page.evaluate(async () => {
        const storage = window.RayArcade.Storage; await storage.store.tail;
        return { restored: game.board[0][0] === 0 && game.board[3][3] === 8,
          preserved: storage.store.record.conflicts.some(item => item.payload.buckets.sessions.merge2048.board[0][0] === 9),
          valid: window.RaySaveSchema.validate(storage.store.read(), 'arcade'), tiles: document.querySelectorAll('.tile').length };
      }), { restored: true, preserved: true, valid: true, tiles: 16 });
      await page.screenshot({ path: path.join(output, `${width}-restored.png`) });
      assert.deepEqual(errors, []);
      await context.close();
      console.log(JSON.stringify({ scenario: 'merge-recovery', width, height, ok: true }));
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new DOMException('blocked', 'SecurityError'); };
      Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/arcade/frontier/');
    await page.waitForFunction(() => window.RayFrontierApp && document.querySelector('[data-loading]').classList.contains('is-hidden'));
    const evidence = await page.evaluate(() => {
      const app = window.RayFrontierApp;
      app.cycleQuality();
      const storage = window.RayArcade.Storage;
      const original = storage.getStats;
      storage.getStats = () => ({ frontier: { bestScore: '<img src=x onerror="window.executed=true">', bestWave: 7 } });
      app.renderMenuStats(); storage.getStats = original;
      app.renderer.render(app.scene, app.camera);
      const gl = app.renderer.getContext();
      const bytes = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      let colored = 0; for (let i = 0; i < bytes.length; i += 4) if (bytes[i] || bytes[i + 1] || bytes[i + 2]) colored++;
      return { quality: app.quality.id, stats: [...document.querySelectorAll('[data-menu-stats] strong')].map(node => node.textContent),
        injected: !!document.querySelector('[data-menu-stats] img') || !!window.executed, colored };
    });
    assert.equal(evidence.quality, 'mid'); assert.deepEqual(evidence.stats, ['0', '7', '0']);
    assert.equal(evidence.injected, false); assert(evidence.colored > 1000); assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'frontier-storage-blocked.png') });
    console.log(JSON.stringify({ scenario: 'frontier-storage-xss', ...evidence, ok: true }));
    await context.close();
    console.log(JSON.stringify({ output, ok: true }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
