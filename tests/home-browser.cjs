const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'ray-home-browser-'));
const results = [];
const record = result => { results.push(result); console.log(result); };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + '/') || pathname.split('/').some(part => part.startsWith('.'))) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); response.end(data);
  });
});
const mocks = () => {
  localStorage.setItem('ray-mimo-chat-history-v1', 'ownerless-private-history');
  window.__tracks = []; window.__draws = 0; window.__contexts = 0;
  for (const klass of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const originalDraw = klass.prototype.drawArrays;
    klass.prototype.drawArrays = function (...args) { window.__draws++; return originalDraw.apply(this, args); };
  }
  const makeStream = () => {
    const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
    window.__tracks.push(track); return { getTracks: () => [track] };
  };
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
    if (window.__delayPermission) await new Promise(resolve => { window.__resolveMedia = resolve; });
    return makeStream();
  } });
  window.MediaRecorder = class extends EventTarget {
    constructor(stream) { super(); this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        const event = new Event('dataavailable'); event.data = new Blob([new Uint8Array(2048)], { type: this.mimeType });
        this.dispatchEvent(event); this.dispatchEvent(new Event('stop'));
      });
    }
  };
  window.AudioContext = class {
    constructor() { window.__contexts++; this.closed = false; }
    async decodeAudioData() { return { length: 16000, sampleRate: 16000, numberOfChannels: 1, getChannelData: () => new Float32Array(16000) }; }
    async close() { if (!this.closed) { this.closed = true; window.__contexts--; } }
  };
};
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, base = `http://127.0.0.1:${port}`;
  console.log(JSON.stringify({ output, port, pid: process.pid }));
  let browser;
  try {
    const executablePath = fs.realpathSync(process.env.CHROMIUM_PATH || chromium.executablePath());
    if (executablePath.includes('/hermes/') || executablePath.includes('/.hermes/')) throw new Error('Browser executable is not isolated');
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(10000);
    await context.addInitScript(mocks);
    let user = { id: 'A', email: 'a@mock.invalid', email_verified: true, role: 'member' }, offline = false, delayChat = false, chatRelease, cookieOwnerOverride = null;
    const apiRequests = [], paidBodies = [], pageErrors = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === base) return route.continue();
      if (url.hostname !== 'api.rayalex.cn') return route.abort();
      apiRequests.push(url.pathname);
      if (offline) return route.abort('internetdisconnected');
      if (['/chat', '/cantonese-transcribe'].includes(url.pathname)) {
        const body = route.request().postDataJSON();
        assert.match(body.requestId, /^[A-Za-z0-9_-]{8,128}$/);
        paidBodies.push({ path: url.pathname, ownerId: body.ownerId, requestId: body.requestId });
        if (body.ownerId !== (cookieOwnerOverride || user.id)) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'owner_changed' }) });
      }
      if (delayChat && url.pathname === '/chat') await new Promise(resolve => { chatRelease = resolve; });
      const data = { ok: true, user, daily: { used: 0, limit: 10 }, cantonese_daily: { used: 0, limit: 30 }, reply: 'Mock response', cantonese: 'mock subtitle', mandarin: 'mock subtitle' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {});
    });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(base); await page.waitForFunction(() => document.body.classList.contains('member-signed-in'));
    await page.screenshot({ path: path.join(output, 'desktop-home.png') });
    assert.equal(await page.locator('#intro').isVisible(), false);
    await page.waitForFunction(() => window.__draws > 2);
    const before = await page.evaluate(() => window.__draws);
    await page.waitForFunction(count => window.__draws > count, before);
    await page.locator('#contact').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    const paused = await page.evaluate(() => window.__draws); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__draws), paused);
    record('hero animation moves onscreen and stops offscreen');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload(); await page.waitForFunction(() => document.body.classList.contains('member-signed-in'));
    const openChat = async () => {
      await page.locator('[data-open-chat]').first().click();
      await page.locator('#chat-modal').waitFor({ state: 'visible' });
    };
    const ended = async () => {
      await page.waitForFunction(() => window.__tracks.every(track => track.readyState === 'ended') && window.__contexts === 0);
      assert.equal(await page.locator('#chat-media-preview').isVisible(), false);
    };
    for (const close of ['button', 'backdrop', 'Escape', 'hidden', 'pagehide', 'owner']) {
      await openChat(); await page.locator('#chat-voice-button').click();
      await page.waitForFunction(() => window.__tracks.at(-1)?.readyState === 'live');
      if (close === 'button') await page.locator('.chat-close').click();
      if (close === 'backdrop') await page.locator('.chat-backdrop').dispatchEvent('click');
      if (close === 'Escape') await page.keyboard.press('Escape');
      if (close === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      if (close === 'pagehide') await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      if (close === 'owner') {
        user = { ...user, id: user.id === 'A' ? 'B' : 'A' };
        await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'ray-auth-state-v2' })));
      }
      await ended();
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      if (await page.locator('#chat-modal').isVisible()) await page.locator('.chat-close').click();
      record(`voice stop: ${close}`);
    }
    await openChat(); await page.evaluate(() => { window.__delayPermission = true; });
    await page.locator('#chat-voice-button').click(); await page.locator('.chat-close').click();
    await page.evaluate(() => { window.__resolveMedia(); window.__delayPermission = false; }); await ended();
    record('delayed voice permission is stopped after modal close');
    await openChat();
    const chatCallsBeforeFinish = apiRequests.filter(route => route === '/chat').length;
    await page.locator('#chat-voice-button').click();
    await page.waitForFunction(() => window.__tracks.at(-1)?.readyState === 'live');
    await page.locator('#chat-voice-button').click();
    await page.locator('#chat-media-preview').waitFor({ state: 'visible' });
    assert.equal(apiRequests.filter(route => route === '/chat').length, chatCallsBeforeFinish);
    await page.locator('.chat-close').click(); await ended();
    record('explicit recording finish creates unsent attachment; close cancels it without upload');
    for (const close of ['button', 'backdrop', 'Escape', 'hidden', 'pagehide', 'owner']) {
      await page.locator('[data-open-translator]').first().click(); await page.locator('#cantonese-start').click();
      await page.waitForFunction(() => window.__tracks.at(-1)?.readyState === 'live');
      if (close === 'button') await page.locator('.cantonese-close').click();
      if (close === 'backdrop') await page.locator('.cantonese-backdrop').dispatchEvent('click');
      if (close === 'Escape') await page.keyboard.press('Escape');
      if (close === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      if (close === 'pagehide') await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      if (close === 'owner') {
        user = { ...user, id: user.id === 'A' ? 'B' : 'A' };
        await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'ray-auth-state-v2' })));
      }
      await ended();
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      if (await page.locator('#cantonese-modal').isVisible()) await page.locator('.cantonese-close').click();
      record(`subtitle stop: ${close}`);
    }
    await page.locator('[data-open-translator]').first().click();
    await page.evaluate(() => { window.__delayPermission = true; window.__resolveMedia = null; });
    await page.locator('#cantonese-start').click();
    await page.waitForFunction(() => typeof window.__resolveMedia === 'function');
    await page.locator('.cantonese-close').click();
    await page.evaluate(() => { window.__resolveMedia(); window.__delayPermission = false; }); await ended();
    record('delayed subtitle permission stops on close');
    await openChat(); await page.locator('#chat-input').fill('private A text');
    delayChat = true; await page.locator('#chat-form button[type=submit]').click();
    await page.waitForTimeout(100); user = { ...user, id: 'private-B' };
    await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'ray-auth-state-v2' })));
    await page.waitForTimeout(100); chatRelease(); delayChat = false;
    await openChat(); assert.doesNotMatch(await page.locator('#chat-messages').innerText(), /private A text|Mock response/);
    await page.locator('.chat-close').click(); record('account switch aborts pending chat and keeps A history out of B');
    await openChat();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      window.__restoreStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function (key, value) { if (key.startsWith('ray:chat:v2:')) throw new DOMException('Full', 'QuotaExceededError'); return original.call(this, key, value); };
    });
    await page.locator('#chat-input').fill('unsaved browser regression');
    await page.locator('#chat-form button[type=submit]').click(); await page.waitForFunction(() => !document.querySelector('#chat-form button[type=submit]').disabled);
    assert.equal(await page.locator('#chat-storage-warning').isVisible(), true);
    await page.locator('.chat-close').click(); await openChat();
    assert.match(await page.locator('#chat-messages').innerText(), /unsaved browser regression/);
    assert.equal(await page.evaluate(() => localStorage.getItem('ray-mimo-chat-history-v1')), 'ownerless-private-history');
    await page.evaluate(() => window.__restoreStorage());
    record('failed local storage survives close/reopen; ownerless history untouched');
    await page.locator('#chat-voice-button').click();
    await page.waitForFunction(() => window.__tracks.at(-1)?.readyState === 'live');
    offline = true;
    await page.evaluate(() => logoutButton.click());
    await page.waitForFunction(() => !logoutButton.disabled);
    await ended();
    assert.equal(await page.locator('#chat-messages').textContent(), '');
    assert.match(await page.locator('#auth-message').innerText(), /服务器会话尚未确认失效/);
    await page.locator('#login-email').fill('a@mock.invalid'); await page.locator('#login-password').fill('mock-password');
    await page.locator('#login-form button[type=submit]').click();
    await page.waitForFunction(() => !document.querySelector('#login-form button[type=submit]').disabled);
    await page.locator('#member-tab-register').click();
    await page.locator('#register-invite').fill('mock-invite'); await page.locator('#register-email').fill('a@mock.invalid');
    await page.evaluate(() => sendRegisterCodeButton.click()); await page.waitForFunction(() => !sendRegisterCodeButton.disabled);
    await page.locator('#register-password').fill('mock-password'); await page.locator('#register-password-confirm').fill('mock-password');
    await page.locator('#register-verification-code').fill('123456');
    await page.locator('#register-form button[type=submit]').click();
    await page.waitForFunction(() => !document.querySelector('#register-form button[type=submit]').disabled);
    record('logout, login, registration and verification buttons recover offline');
    offline = false; await page.locator('#member-tab-login').click(); await page.locator('#login-form button[type=submit]').click();
    await page.waitForFunction(() => document.body.classList.contains('member-signed-in'));
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width > 400 ? 1000 : 844 }); await page.goto(base);
      await page.waitForFunction(() => document.body.classList.contains('member-signed-in'));
      await page.screenshot({ path: path.join(output, `home-${width}.png`) });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `home overflow ${width}`);
      await openChat();
      if (width < 400) {
        await page.locator('#chat-input').fill(`mobile history ${width}`);
        await page.locator('#chat-form button[type=submit]').click();
        await page.waitForFunction(() => !document.querySelector('#chat-form button[type=submit]').disabled);
        const oldId = await page.locator('.chat-history-item.is-active').getAttribute('data-chat-id');
        await page.locator('#chat-new').click();
        await page.locator('#chat-history-toggle').click(); assert.equal(await page.locator('#chat-history').isVisible(), true);
        await page.locator(`[data-chat-id="${oldId}"]`).click();
        assert.match(await page.locator('#chat-messages').innerText(), new RegExp(`mobile history ${width}`));
        const bubble = await page.locator('.chat-message.is-assistant .chat-bubble').last().boundingBox();
        assert.ok(bubble.height < 90, `template whitespace expanded bubble at ${width}`);
        await page.locator('#chat-history-toggle').click();
        await page.screenshot({ path: path.join(output, `history-${width}.png`) });
        await page.locator('.chat-history-item').first().focus();
        await page.keyboard.press('Escape'); assert.equal(await page.locator('#chat-modal').isVisible(), true);
        assert.equal(await page.locator('#chat-history').isVisible(), false);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'chat-history-toggle');
      }
      await page.screenshot({ path: path.join(output, `chat-${width}.png`) });
      assert.ok(await page.locator('#chat-input').evaluate(node => node.scrollHeight <= node.clientHeight + 1), `input placeholder clipped ${width}`);
      for (let n = 0; n < 16; n++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => !!document.activeElement.closest('#chat-modal')), true); }
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.matches('[data-open-chat]')), true, `focus restoration ${width}`);
      record(`viewport ${width}: chat/history, keyboard trap, focus restoration, no page overflow`);
    }
    await page.setViewportSize({ width: 390, height: 844 }); await openChat(); await page.locator('#chat-input').focus();
    await page.setViewportSize({ width: 390, height: 480 }); await page.waitForTimeout(350);
    const composer = await page.locator('#chat-form').boundingBox();
    assert.ok(composer.y >= 0 && composer.y + composer.height <= 480);
    await page.screenshot({ path: path.join(output, 'keyboard-390.png') }); await page.locator('.chat-close').click();
    record('reduced visual viewport keeps focused composer onscreen');
    await page.goto(base + '/?intro=liquid#contact');
    assert.equal(await page.locator('#intro').isVisible(), false);
    await page.waitForFunction(() => window.scrollY > 0);
    record('intro query plus deep link skips opening and keeps anchor navigation');
    for (const feature of ['chat', 'subtitle']) {
      await page.setViewportSize({ width: 390, height: 844 });
      if (feature === 'chat') {
        await openChat();
        cookieOwnerOverride = 'cookie-only-B';
        await page.locator('#chat-input').fill('A content under changed server cookie');
        await page.locator('#chat-form button[type=submit]').click();
      } else {
        await page.locator('[data-open-translator]').first().click();
        await page.locator('#cantonese-start').click();
        await page.waitForFunction(() => window.__tracks.at(-1)?.readyState === 'live');
        cookieOwnerOverride = 'cookie-only-B';
      }
      await page.waitForFunction(() => !document.body.classList.contains('member-signed-in'));
      await ended();
      assert.equal(paidBodies.at(-1).ownerId, user.id);
      assert.equal(await page.locator('#chat-messages').textContent(), '');
      assert.match(await page.locator('#auth-message').innerText(), /已锁定私人界面/);
      cookieOwnerOverride = null;
      await page.locator('#login-email').fill('a@mock.invalid'); await page.locator('#login-password').fill('mock-password');
      await page.locator('#login-form button[type=submit]').click();
      await page.waitForFunction(() => document.body.classList.contains('member-signed-in'));
      record(`${feature}: ownerId retains A when cookie changes to B; 409 locks and clears UI`);
    }
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await nojs.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const staticPage = await nojs.newPage(); await staticPage.goto(base + '/#contact');
    assert.equal(await staticPage.locator('#intro').isVisible(), false); assert.equal(await staticPage.locator('main').isVisible(), true);
    await staticPage.screenshot({ path: path.join(output, 'nojs-deeplink-390.png') });
    await nojs.close(); record('no-JS main and contact deep link remain reachable');
    assert.deepEqual(pageErrors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, apiRequests, paidBodies, pageErrors }, null, 2));
    console.log(JSON.stringify({ passed: results.length, results, output }));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failure.txt'), error.stack);
    for (const context of browser?.contexts() || []) for (const page of context.pages()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    console.error(error); process.exitCode = 1;
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    console.log(JSON.stringify({ cleanup: 'browser closed and server stopped', output }));
  }
})();
