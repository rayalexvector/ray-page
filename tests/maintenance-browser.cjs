const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'ray-home-browser-maintenance-'));
// Frozen pre-retirement revision verifies the user's unchanged-homepage constraint in CI too.
const baselineRevision = 'ea436819497756277f10b4acce29406de8fe30f0';
const baseline = Object.fromEntries(['index.html', 'styles.css'].map(file => [file,
  execFileSync('git', ['show', `${baselineRevision}:${file}`], { cwd: root })]));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname); }
  catch { response.writeHead(400).end(); return; }
  const original = pathname.startsWith('/__baseline/');
  if (original) pathname = pathname.slice('/__baseline'.length);
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (relative.split('/').some(part => part.startsWith('.')) ||
      !(['index.html', 'styles.css', 'home-runtime.js', 'favicon.svg', 'site.webmanifest'].includes(relative) || relative.startsWith('assets/'))) {
    response.writeHead(404).end(); return;
  }
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  const send = data => response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(data);
  if (original && baseline[relative]) return send(baseline[relative]);
  fs.readFile(file, (error, data) => error ? response.writeHead(404).end() : send(data));
});

(async () => {
  let browser;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ ...require('../tools/playwright.cjs').browserLaunchOptions(), headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
    for (const [width, height, mobile] of [[1440, 900, false], [390, 844, true], [320, 568, true], [844, 390, true]]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: mobile, hasTouch: mobile });
      context.setDefaultTimeout(10000);
      const requests = [], errors = [];
      let signedIn = false, offline = false;
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        if (url.hostname !== 'api.rayalex.cn') return route.abort();
        requests.push({ path: url.pathname, method: route.request().method() });
        if (offline) return route.abort();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true,
          user: signedIn ? { id: 'synthetic-maintenance-user', email: 'test@example.invalid', email_verified: true, role: 'member' } : null,
          daily: { used: 0, limit: 10 } }) });
      });
      await context.addInitScript(() => {
        window.__mediaRequests = 0;
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
          window.__mediaRequests++; throw new Error('Maintenance must not ask for microphone');
        } });
        localStorage.setItem('ray-mimo-chat-history-v1', 'preserved-history');
      });
      const page = await context.newPage();
      const activate = locator => mobile ? locator.tap() : locator.click();
      page.on('pageerror', error => errors.push(error.message));
      const layout = () => page.evaluate(() => [...document.querySelectorAll('header, main > section, footer')].map(node => {
        const box = node.getBoundingClientRect();
        return { tag: node.tagName, id: node.id, text: node.innerText, x: box.x, y: box.y, width: box.width, height: box.height };
      }));
      await page.goto(base + '/__baseline/');
      await page.waitForFunction(() => document.getElementById('member-status').hidden);
      const before = await layout();
      await page.goto(base);
      await page.waitForFunction(() => document.getElementById('member-status').hidden);
      assert.deepEqual(await layout(), before, 'Homepage text and geometry must remain unchanged');
      await page.screenshot({ path: path.join(output, `home-${width}.png`), animations: 'disabled', timeout: 30000 });
      const selectors = ['[data-open-chat]', '[data-open-translator]', '#member-tab-login', '#login-form button[type="submit"]'];
      for (const selector of selectors) {
        const count = await page.locator(selector).count();
        for (let index = 0; index < count; index++) {
          const opener = page.locator(selector).nth(index);
          const beforeRequests = requests.length;
          await activate(opener);
          await page.locator('#maintenance-modal').waitFor({ state: 'visible' });
          assert.equal(await page.locator('#maintenance-title').textContent(), '维护中');
          for (let n = 0; n < 4; n++) {
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.getElementById('maintenance-modal').contains(document.activeElement)), true);
          }
          await page.keyboard.press('Shift+Tab');
          assert.equal(await page.evaluate(() => document.getElementById('maintenance-modal').contains(document.activeElement)), true);
          await page.keyboard.press('Escape');
          await page.locator('#maintenance-modal').waitFor({ state: 'hidden' });
          assert.equal(await opener.evaluate(node => node === document.activeElement), true);
          assert.equal(requests.length, beforeRequests);
        }
      }
      await activate(page.locator('#login-form button[type="submit"]'));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const overlay = await page.locator('#maintenance-modal').boundingBox();
      assert.equal(overlay.x, 0); assert.equal(overlay.y, 0);
      assert.equal(overlay.width, width); assert.equal(overlay.height, height);
      await page.screenshot({ path: path.join(output, `maintenance-${width}.png`), animations: 'disabled', timeout: 30000 });
      const box = await page.locator('.maintenance-panel').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width);
      assert.equal(await page.locator('.maintenance-panel').evaluate(node => node.scrollWidth <= node.clientWidth), true);
      await activate(page.locator('.maintenance-panel [data-close-maintenance]').last());
      await page.locator('#login-email').fill('synthetic@example.invalid');
      await page.locator('#login-password').fill('synthetic-password');
      await page.locator('#login-password').press('Enter');
      await page.locator('#maintenance-modal').waitFor({ state: 'visible' });
      await page.locator('.maintenance-backdrop').click({ position: { x: 2, y: 2 } });
      await page.locator('#maintenance-modal').waitFor({ state: 'hidden' });
      for (const state of ['signed-in', 'offline']) {
        signedIn = state === 'signed-in'; offline = state === 'offline';
        await page.reload();
        if (signedIn) await page.waitForFunction(() => document.body.classList.contains('member-signed-in'));
        await activate(page.locator('[data-open-chat]').first());
        await page.locator('#maintenance-modal').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
      }
      assert.ok(requests.every(request => request.method === 'GET' && request.path === '/v2/auth/me'));
      assert.equal(await page.evaluate(() => window.__mediaRequests), 0);
      assert.equal(await page.evaluate(() => localStorage.getItem('ray-mimo-chat-history-v1')), 'preserved-history');
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ width, height, mobile, homepageUnchanged: true, maintenance: true, focus: true, noMutationsOrModelCalls: true }));
      await context.close();
    }
    console.log(JSON.stringify({ output, browser: browser.version() }));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
