const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function safeDirectory(directory) {
  const absolute = path.resolve(directory);
  let parent = absolute;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  if (fs.realpathSync(parent) !== parent || /\/\.?hermes\//i.test(parent + '/')) {
    throw new Error('Refusing redirected/shared browser directory: ' + absolute);
  }
  fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(absolute) !== absolute) throw new Error('Browser directory is redirected');
  return absolute;
}

function browserLaunchOptions() {
  if (process.env.CHROMIUM_PATH) {
    const executablePath = fs.realpathSync(process.env.CHROMIUM_PATH);
    if (/\/\.?hermes\//i.test(executablePath)) throw new Error('Refusing Hermes browser executable');
    return { executablePath };
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!cache || cache === '0') throw new Error('Use npm run test:browser to select an isolated browser cache');
  safeDirectory(cache);
  // Leave executable selection to Playwright so headless uses its matching shell.
  return {};
}

function main() {
  const mode = process.argv[2];
  if (!['install', 'test'].includes(mode)) throw new Error('Expected install or test');
  const cache = safeDirectory(path.join(os.homedir(), '.codex/browser/raypage-playwright'));
  process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
  process.env.PLAYWRIGHT_SKIP_BROWSER_GC = '1';
  const root = path.resolve(__dirname, '..');
  const run = args => {
    const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  };
  console.log('Isolated browser directory:', cache);
  if (mode === 'install') {
    const args = [path.join(path.dirname(require.resolve('playwright')), 'cli.js'), 'install', 'chromium'];
    if (process.argv.includes('--with-deps')) args.push('--with-deps');
    run(args);
  } else {
    const stableChrome = '/opt/google/chrome/chrome';
    if (!process.env.CHROMIUM_PATH && fs.existsSync(stableChrome)) process.env.CHROMIUM_PATH = stableChrome;
    browserLaunchOptions();
    console.log('Browser:', process.env.CHROMIUM_PATH || 'bundled Chromium headless shell');
    process.env.PLAYWRIGHT_CORE = require.resolve('playwright-core');
    run(['tests/maintenance-browser.cjs']);
    run(['tests/home-browser.cjs']);
    run(['tests/game-browser-smoke.cjs']);
  }
}

module.exports = { safeDirectory, browserLaunchOptions };
if (require.main === module) main();
