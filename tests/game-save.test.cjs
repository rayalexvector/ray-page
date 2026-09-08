const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function context(files) {
  const values = new Map();
  const c = { console, Map, Set, Uint8Array, setTimeout, clearTimeout,
    localStorage: { getItem: k => values.get(k) || null, setItem: (k,v) => values.set(k,v) },
    crypto: require('node:crypto').webcrypto, navigator: {}, document: { addEventListener() {} },
    addEventListener() {}, dispatchEvent() {}, CustomEvent: class {} };
  c.window = c;
  vm.createContext(c);
  files.forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), c));
  return c;
}
test('board arrays are atomic, not sets', () => {
  const c = context(['arcade/js/cloud-save.js']);
  const board = [[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  assert.equal(JSON.stringify(c.RayCloudSave.mergeProgress(board, board)), JSON.stringify(board));
});
test('consecutive achievements survive storage reads', () => {
  const c = context(['arcade/js/save-schema.js', 'arcade/js/save-core.js', 'arcade/js/storage.js']);
  c.RayArcade.Storage.addAchievement('one');
  c.RayArcade.Storage.addAchievement('two');
  assert.equal(JSON.stringify(c.RayArcade.Storage.getAchievements()), '["one","two"]');
});
