const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright');
const { browserLaunchOptions } = require('../tools/playwright.cjs');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'ray-arcade-modal-'));
const fixture = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/arcade/css/style.css"></head><body>
<main id="app"><button id="open">Open guide</button><button id="background">Background</button></main>
<script>window.RayArcade={Storage:{getSettings:()=>({sound:false,vibrate:false})}};</script>
<script src="/arcade/js/ui.js"></script><script>
window.resumes=0;window.backgroundClicks=0;
document.getElementById('background').onclick=()=>window.backgroundClicks++;
document.getElementById('open').onclick=()=>RayArcade.UI.showModal({title:'Game instructions',
onDismiss:close=>{close();window.resumes++;},
html:Array.from({length:60},(_,i)=>'<p>Instruction '+i+' with enough text to exercise mobile scrolling.</p>').join(''),
actions:[{label:'Continue',kind:'primary',onClick:close=>{close();window.resumes++;}},
{label:'Restart',kind:'secondary'},{label:'Back to lobby',kind:'secondary'}]});
</script></body></html>`;
const assets = new Map([
  ['/arcade/css/style.css', 'text/css'], ['/arcade/js/ui.js', 'text/javascript']
]);
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') return response.writeHead(200, { 'content-type': 'text/html' }).end(fixture);
  if (!pathname.startsWith('/arcade/') || pathname.split('/').some(part => part.startsWith('.'))) return response.writeHead(404).end();
  const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(root + path.sep)) return response.writeHead(404).end();
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
  fs.readFile(file, (error, data) => error ? response.writeHead(404).end() :
    response.writeHead(200, { 'content-type': assets.get(pathname) || types[path.extname(file)] || 'application/octet-stream' }).end(data));
});

(async () => {
  let browser;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ ...browserLaunchOptions(), headless: true, args: ['--no-sandbox'] });
    for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        if (url.hostname === 'api.rayalex.cn') return route.fulfill({ status: 401,
          contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'not_authenticated' }) });
        return route.abort();
      });
      await context.addInitScript(() => {
        let games;
        Object.defineProperty(window, 'RayGames', {
          get: () => games, set: value => { games = new Proxy(value, { set(target, key, entry) {
            target[key] = typeof entry === 'function' ? new Proxy(entry, { construct(ctor, args) {
              const game = Reflect.construct(ctor, args); window.__modalTestGame = game; return game;
            } }) : entry;
            return true;
          } }); }
        });
      });
      const page = await context.newPage(), errors = [];
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.evaluate(() => {
        window.inputEvents = [];
        for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchend', 'click']) {
          document.addEventListener(type, event => window.inputEvents.push({ type,
            target: event.target.outerHTML.slice(0, 100), prevented: event.defaultPrevented }), true);
        }
      });
      await page.locator('#open').tap();
      const dialog = page.getByRole('dialog', { name: 'Game instructions' });
      await dialog.waitFor();
      assert.equal(await page.locator('#app').evaluate(node => node.inert), true);
      assert.equal(await dialog.evaluate(node => node === document.activeElement), true);
      const rect = await dialog.boundingBox();
      assert(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height);
      for (const button of await dialog.locator('button').all()) {
        const box = await button.boundingBox();
        assert(box.width >= 44 && box.height >= 44, 'All modal targets are at least 44px');
      }
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab');
        assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
      }
      const body = page.locator('.modal-body'), box = await body.boundingBox();
      assert(box.height > 30, 'Short landscape keeps a usable scrolling body');
      const session = await context.newCDPSession(page);
      const x = box.x + box.width / 2, bottom = box.y + box.height - 5;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: bottom }] });
      for (let step = 1; step <= 8; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: bottom - (box.height - 15) * step / 8 }] });
        await page.waitForTimeout(25);
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => document.querySelector('.modal-body').scrollTop > 0);
      // A tap during native inertial scrolling stops scrolling instead of clicking.
      await body.evaluate(node => new Promise(resolve => {
        let last = node.scrollTop, changed = performance.now();
        const poll = () => {
          if (node.scrollTop !== last) { last = node.scrollTop; changed = performance.now(); }
          if (performance.now() - changed >= 200) resolve();
          else requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      }));
      assert.equal(await page.evaluate(() => window.backgroundClicks), 0);
      await page.screenshot({ path: path.join(output, `${width}x${height}.png`) });
      await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
      await dialog.waitFor({ state: 'hidden' }).catch(async error => {
        console.error(await page.evaluate(() => ({ events: window.inputEvents, active: document.activeElement.outerHTML.slice(0, 150) })));
        throw error;
      });
      assert.equal(await page.locator('#open').evaluate(node => node === document.activeElement), true);
      assert.equal(await page.evaluate(() => window.resumes), 1);
      assert.equal(await page.locator('#app').evaluate(node => node.inert), false);
      await page.locator('#open').tap(); await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.resumes), 2);

      const landscape = width > height;
      if (landscape) await page.setViewportSize({ width: height, height: width });
      await page.goto(base + '/arcade/');
      await page.waitForFunction(() => window.RayArcade?.Storage.store.persisted);
      await page.locator('[data-start="merge2048"]').tap();
      await page.locator('.modal-actions button').first().tap();
      await page.waitForFunction(() => window.__modalTestGame?.started);
      await page.locator('[data-pause]').tap();
      await page.getByRole('dialog', { name: '暂停中' }).waitFor();
      assert.equal(await page.evaluate(() => window.__modalTestGame.paused), true);
      await page.getByRole('dialog', { name: '暂停中' }).getByRole('button', { name: '关闭', exact: true }).tap();
      await page.getByRole('dialog', { name: '暂停中' }).waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.__modalTestGame.paused), false);
      assert.equal(await page.locator('[data-pause]').evaluate(node => node === document.activeElement), true);
      await page.locator('[data-help]').tap();
      await page.getByRole('dialog').waitFor();
      assert.equal(await page.evaluate(() => window.__modalTestGame.paused), true);
      if (landscape) {
        await page.setViewportSize({ width, height });
        assert.equal(await page.locator('.orientation-lock').isVisible(), false);
        const helpBox = await page.getByRole('dialog').boundingBox();
        assert(helpBox.x >= 0 && helpBox.y >= 0 && helpBox.x + helpBox.width <= width && helpBox.y + helpBox.height <= height);
        await page.screenshot({ path: path.join(output, 'actual-help-landscape.png') });
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.__modalTestGame.paused), false);
      if (landscape) {
        assert.equal(await page.locator('.orientation-lock').isVisible(), true);
        await page.setViewportSize({ width: height, height: width });
      }
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal(await page.evaluate(() => window.__modalTestGame.paused), true);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.getByRole('dialog', { name: '暂停中' }).waitFor();
      assert.equal(await page.evaluate(() => window.__modalTestGame.paused), true);
      await page.getByRole('button', { name: '继续', exact: true }).tap();
      assert.equal(await page.evaluate(() => window.__modalTestGame.paused), false);
      await page.locator('[data-back]').tap();
      await page.locator('[data-achievements]').tap();
      await page.getByRole('dialog', { name: 'Ray 成就墙' }).getByRole('button', { name: '关闭', exact: true }).first().tap();
      assert.equal(await page.locator('#app').evaluate(node => node.inert), false);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS arcade modal ${width}x${height}: touch scroll, targets, focus and resume`);
    }
    console.log(`Screenshots: ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
