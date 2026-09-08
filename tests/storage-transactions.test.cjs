const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBrowser, loadArcade, loadStarfall, plain, IDBFactory } = require('./storage-harness.cjs');

test('two tabs add coins and change only settings without losing economic state', async () => {
  const indexedDB = new IDBFactory();
  const a = loadStarfall(makeBrowser({ indexedDB }));
  const b = loadStarfall(makeBrowser({ indexedDB }));
  await Promise.all([a.store.ready, b.store.ready]);
  a.addCoins(200);
  await b.setSettings({ sound: false });
  await a.store.tail;
  await b.store.reload();
  assert.equal(b.get().wallet.coins, 200);
  assert.equal(b.getSettings().sound, false);
});

test('concurrent purchases deduct coins and increase upgrade in one transaction', async () => {
  const indexedDB = new IDBFactory();
  const a = loadStarfall(makeBrowser({ indexedDB }));
  const b = loadStarfall(makeBrowser({ indexedDB }));
  await Promise.all([a.store.ready, b.store.ready]);
  a.addCoins(100); await a.store.tail; await b.store.reload();
  const results = await Promise.all([a.buyUpgrade('hull'), b.buyUpgrade('hull')]);
  assert.equal(results.filter(r => r.ok).length, 1);
  await a.store.reload();
  assert.equal(a.get().wallet.coins, 30);
  assert.equal(a.get().upgrades.hull, 1);
});

test('concurrent play counters and achievements are transaction reducers', async () => {
  const indexedDB = new IDBFactory();
  const a = loadArcade(makeBrowser({ indexedDB }));
  const b = loadArcade(makeBrowser({ indexedDB }));
  await Promise.all([a.store.ready, b.store.ready]);
  a.notePlay('catJump'); b.notePlay('catJump');
  a.addAchievement('one'); b.addAchievement('two');
  await Promise.all([a.store.tail, b.store.tail]);
  await a.store.reload();
  assert.equal(a.getStats().catJump.plays, 2);
  assert.deepEqual(plain(a.getAchievements()).sort(), ['one', 'two']);
});

test('legacy unowned keys are preserved and never loaded into guest or an account', async () => {
  const local = new Map([['rayStarfall.save.v1', '{"wallet":{"coins":999}}']]);
  const a = loadStarfall(makeBrowser({ local }));
  await a.store.ready;
  assert.equal(a.get().wallet.coins, 0);
  a.addCoins(10); await a.store.tail;
  await a.store.setOwner('A');
  assert.equal(a.get().wallet.coins, 0);
  a.addCoins(20); await a.store.tail;
  await a.store.setOwner('B');
  assert.equal(a.get().wallet.coins, 0);
  await a.store.setOwner('A');
  assert.equal(a.get().wallet.coins, 20);
  assert.equal(local.get('rayStarfall.save.v1'), '{"wallet":{"coins":999}}');
});

test('stale generation writes preserve conflict copy without reviving reset coins', async () => {
  const indexedDB = new IDBFactory();
  const a = loadStarfall(makeBrowser({ indexedDB }));
  const b = loadStarfall(makeBrowser({ indexedDB }));
  await Promise.all([a.store.ready, b.store.ready]);
  a.addCoins(200); await a.store.tail; await b.store.reload();
  await a.reset();
  b.addCoins(10); await b.store.tail;
  await a.store.reload();
  assert.equal(a.get().wallet.coins, 0);
  assert.ok(a.store.record.conflicts.some(x => x.reason === 'reset_generation' && x.payload.save.wallet.coins === 210));
});

test('typed merge keeps economy and complete boards, and does not union across resets', async () => {
  const c = makeBrowser(), a = loadStarfall(c); await a.store.ready;
  const local = a.exportSave(), remote = plain(local);
  local.save.wallet.coins = 130; local.save.upgrades.hull = 1;
  remote.save.wallet.coins = 200;
  const merge = c.RaySaveCore.mergeTyped(local, remote);
  assert.equal(merge.conflict, true);
  assert.equal(merge.payload.save.wallet.coins, 130);
  assert.equal(merge.payload.save.upgrades.hull, 1);
  remote.resetGeneration = 'other';
  assert.equal(c.RaySaveCore.mergeTyped(local, remote).conflict, true);
});

test('owned schema1 remote upgrades after validation, malformed boards stay invalid', async () => {
  const c = makeBrowser(), a = loadArcade(c); await a.store.ready;
  const legacy = a.exportSave(); legacy.schema = 1; delete legacy.resetGeneration;
  const migrated = c.RaySaveCore.upgradeLegacy(legacy, a.store.initial);
  assert.equal(migrated.schema, 2); assert.equal(migrated.resetGeneration, 'initial');
  legacy.buckets.sessions.merge2048 = { active: true, score: 10, bestLevel: 2, board: [[1,0,0,0],[0,0,0,0]] };
  assert.equal(c.RaySaveCore.upgradeLegacy(legacy, a.store.initial), null);
});

test('two stale board writers keep the complete winning board and an intact conflict copy', async () => {
  const indexedDB = new IDBFactory();
  const a = loadArcade(makeBrowser({ indexedDB })), b = loadArcade(makeBrowser({ indexedDB }));
  await Promise.all([a.store.ready, b.store.ready]);
  a.loadSession('merge2048'); b.loadSession('merge2048');
  const left = { active: true, score: 1, bestLevel: 1, board: [[1,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]] };
  const right = { ...left, score: 2, board: [[0,1,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]] };
  a.saveSession('merge2048', left); b.saveSession('merge2048', right);
  await Promise.all([a.store.tail, b.store.tail]); await a.store.reload();
  assert.deepEqual(plain(a.loadSession('merge2048').board), left.board);
  assert.ok(a.store.record.conflicts.some(x => x.reason === 'local_revision_conflict' && x.payload.buckets.sessions.merge2048.score === 2));
});

test('daily card count, collection and totals commit together and enforce three draws across tabs', async () => {
  const indexedDB = new IDBFactory();
  const a = loadArcade(makeBrowser({ indexedDB })), b = loadArcade(makeBrowser({ indexedDB }));
  await Promise.all([a.store.ready, b.store.ready]);
  const card = { id: 'cat', rarity: 'N', title: 'Cat' };
  const results = await Promise.all([a.recordCardDraw(card), b.recordCardDraw(card), a.recordCardDraw(card), b.recordCardDraw(card)]);
  assert.equal(results.filter(x => x.ok).length, 3);
  await a.store.reload();
  assert.equal(a.getCards().draws, 3);
  assert.equal(a.getCards().collection.cat, 3);
  assert.equal(a.getStats().dailyCard.totalDraws, 3);
});

test('failed persistence keeps all subsequent memory changes until explicit recovery', async () => {
  const { IDBDatabase } = require('fake-indexeddb');
  const c = makeBrowser(), a = loadStarfall(c); await a.store.ready;
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function () { throw new Error('quota'); };
  try { a.addCoins(10); await a.store.tail; }
  finally { IDBDatabase.prototype.transaction = transaction; }
  assert.equal(a.store.persisted, false);
  a.addCoins(5); await Promise.resolve();
  assert.equal(a.get().wallet.coins, 15);
  await a.store.reload();
  assert.equal(a.get().wallet.coins, 15);
  assert.equal(a.store.persisted, false);
  await a.store.replace(a.exportSave());
  assert.equal(a.store.persisted, true);
  await a.store.reload();
  assert.equal(a.get().wallet.coins, 15);
});

test('failed A memory stays isolated and remains recoverable after visiting B', async () => {
  const { IDBDatabase } = require('fake-indexeddb');
  const a = loadStarfall(makeBrowser()); await a.store.ready; await a.store.setOwner('A');
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function () { throw new Error('quota'); };
  try { a.addCoins(10); await a.store.tail; }
  finally { IDBDatabase.prototype.transaction = transaction; }
  await a.store.setOwner('B'); assert.equal(a.get().wallet.coins, 0);
  await a.store.setOwner('A'); assert.equal(a.get().wallet.coins, 10); assert.equal(a.store.persisted, false);
});

test('schema validator has the same CommonJS and browser behavior', async () => {
  const { validate } = require('../arcade/js/save-schema.js');
  const c = makeBrowser(), a = loadStarfall(c); await a.store.ready;
  const payload = a.exportSave();
  assert.equal(validate(payload, 'starfall'), true);
  payload.save.upgrades.hull = 6;
  assert.equal(validate(payload, 'starfall'), false);
  assert.equal(c.RaySaveSchema.validate(payload, 'starfall'), false);
});
