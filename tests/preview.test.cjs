const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('preview serves public files and rejects private paths and traversal', async t => {
  const server = spawn(process.execPath, ['tools/preview.cjs'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped;
  });
  const [chunk] = await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Preview exited before listening'); })]);
  const base = chunk.toString().trim();
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(base + '/arcade/')).status, 200);
  for (const path of ['/.local-secrets/', '/.git/config', '/node_modules/playwright/package.json', '/arcade/%2e%2e/.local-secrets/']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
});
