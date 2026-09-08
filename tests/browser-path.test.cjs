const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { safeDirectory, browserLaunchOptions } = require('../tools/playwright.cjs');

test('browser directory guard rejects a redirected ancestor before creating children', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ray-browser-path-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  fs.mkdirSync(path.join(root, 'other'));
  fs.symlinkSync(path.join(root, 'other'), path.join(root, 'cache'));
  assert.throws(() => safeDirectory(path.join(root, 'cache', 'new-browser')), /redirected/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'other')), []);
  assert.equal(safeDirectory(path.join(root, 'isolated')), path.join(root, 'isolated'));
});

test('default headless selection requires an explicitly isolated cache', t => {
  const previous = { cache: process.env.PLAYWRIGHT_BROWSERS_PATH, executable: process.env.CHROMIUM_PATH };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ray-browser-launch-'));
  t.after(() => {
    for (const [key, value] of [['PLAYWRIGHT_BROWSERS_PATH', previous.cache], ['CHROMIUM_PATH', previous.executable]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true });
  });
  delete process.env.CHROMIUM_PATH;
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  assert.throws(browserLaunchOptions, /isolated browser cache/);
  process.env.PLAYWRIGHT_BROWSERS_PATH = root;
  assert.deepEqual(browserLaunchOptions(), {});
});
