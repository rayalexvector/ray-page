const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeBrowser, loadArcade, plain } = require('./storage-harness.cjs');
const schema = require('../arcade/js/save-schema.js');

function session() {
  return { active: true, board: [[1, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 8]], score: 64, bestLevel: 8 };
}
async function fixture() {
  const c = makeBrowser();
  const storage = loadArcade(c);
  await storage.store.ready;
  return { c, storage, payload: storage.store.read() };
}

test('Frontier stats reject HTML, strings, fractions, negative and unsafe numbers', async () => {
  const { payload } = await fixture();
  assert.equal(schema.validate(payload, 'arcade'), true);
  for (const key of ['plays', 'bestScore', 'bestWave', 'bestLevel', 'bestChips']) {
    for (const value of ['<img src=x onerror=alert(1)>', '1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null]) {
      const invalid = plain(payload);
      invalid.buckets.stats.frontier[key] = value;
      assert.equal(schema.validate(invalid, 'arcade'), false, key + ':' + value);
    }
    payload.buckets.stats.frontier[key] = Number.MAX_SAFE_INTEGER;
    assert.equal(schema.validate(payload, 'arcade'), true);
  }
});

test('merge schema permits only actual tile levels and valid empty cells', async () => {
  const { payload } = await fixture();
  payload.buckets.sessions.merge2048 = session();
  for (let value = 0; value <= 8; value++) {
    payload.buckets.sessions.merge2048.board[0][0] = value;
    assert.equal(schema.validate(payload, 'arcade'), true);
  }
  for (const value of [9, 64, -1, 1.5, '1', null]) {
    payload.buckets.sessions.merge2048.board[0][0] = value;
    assert.equal(schema.validate(payload, 'arcade'), false);
  }
  payload.buckets.sessions.merge2048 = session();
  payload.buckets.sessions.merge2048.bestLevel = 9;
  assert.equal(schema.validate(payload, 'arcade'), false);
  for (const invalid of [false, 0, '']) {
    payload.buckets.sessions.merge2048 = invalid;
    assert.equal(schema.validate(payload, 'arcade'), false);
  }
});

test('minimal historical Frontier stats remain valid and read with zero defaults', async () => {
  const { storage, payload } = await fixture();
  payload.buckets.stats.frontier = { plays: 0 };
  assert.equal(schema.validate(payload, 'arcade'), true);
  await storage.store.replace(payload);
  assert.deepEqual(plain(storage.getStats().frontier), { plays: 0, bestScore: 0, bestWave: 0, bestLevel: 0, bestChips: 0 });
  assert.deepEqual(plain(storage.store.read().buckets.stats.frontier), { plays: 0 });
});

for (const invalid of [false, true]) {
  test(`cloud read ${invalid ? 'quarantines malformed stats intact without replacing local data' : 'accepts absent historical best fields'}`, async t => {
    const { c, storage, payload } = await fixture();
    const remote = plain(payload);
    remote.buckets.stats.frontier = invalid ? { plays: 0, bestScore: '<img src=x onerror=alert(1)>' } : { plays: 7 };
    const writes = [];
    c.fetch = async (url, options = {}) => {
      if (options.method && options.method !== 'GET') writes.push(url);
      return { ok: true, status: 200, json: async () => ({ ok: true, protocol: 2,
        save: { revision: 1, protocol: 2, gameId: 'arcade', slot: 'default', schema: 2, payload: remote } }) };
    };
    c.load('arcade/js/cloud-save.js');
    const client = c.RayCloudSave.createClient({ appId: 'arcade', store: storage.store, debounceMs: 60000 });
    t.after(() => { clearTimeout(client.timer); client.controllers.forEach(controller => controller.abort()); });
    await storage.store.setOwner('synthetic'); client.owner = 'synthetic'; client.initialized = true;
    await client.pullRemote(client.epoch, client.owner);
    if (invalid) {
      assert.deepEqual(plain(storage.store.read()), plain(payload));
      assert.equal(storage.store.record.blocked, true);
      assert(storage.store.record.conflicts.some(item => item.reason === 'invalid_remote' && JSON.stringify(item.payload) === JSON.stringify(remote)));
    } else {
      assert.equal(storage.getStats().frontier.plays, 7);
      assert.equal(storage.getStats().frontier.bestScore, 0);
      assert.equal(storage.store.record.blocked, undefined);
    }
    assert.equal(writes.length, 0);
  });
}

async function gameFixture(saved, { quarantine = false, owner = null } = {}) {
  const { c, storage } = await fixture();
  if (owner !== null) await storage.store.setOwner(owner);
  await storage.store.edit(record => { record.payload.buckets.sessions.merge2048 = saved; });
  if (quarantine) await storage.store.reload();
  const state = { modals: [], toasts: [], home: 0, renders: 0 };
  c.RayArcade.UI = {
    showModal: opts => state.modals.push(opts), toast: text => state.toasts.push(text)
  };
  c.load('arcade/games/merge-2048.js');
  const host = { innerHTML: '', querySelector: () => null };
  const game = new c.RayGames.Merge2048(host, { goHome: () => state.home++ });
  game.render = () => state.renders++;
  return { c, storage, game, state };
}

test('legal historical merge session restores unchanged', async () => {
  const saved = session();
  const { game, state } = await gameFixture(saved);
  game.start();
  assert.deepEqual(plain(game.board), saved.board);
  assert.equal(game.score, 64);
  assert.equal(state.modals.length, 0);
});

for (const quarantine of [false, true]) {
  test(`invalid merge ${quarantine ? 'quarantined' : 'live'} session needs consent and preserves original on repair`, async () => {
    const saved = session(); saved.board[0][0] = 9;
    const { storage, game, state } = await gameFixture(saved, { quarantine });
    const before = plain(storage.store.read());
    game.start();
    game.restart();
    assert.equal(game.started, false);
    assert.equal(state.modals.length, 1);
    assert.deepEqual(plain(storage.store.read()), before);
    await state.modals[0].actions[0].onClick(() => {});
    await storage.store.tail;
    assert.equal(game.started, true);
    assert.equal(game.board[0][0], 0);
    assert.equal(game.board[0][1], 2);
    assert.equal(game.board[3][3], 8);
    assert.equal(game.score, 64);
    assert(storage.store.record.conflicts.some(copy => JSON.stringify(copy.payload.buckets.sessions.merge2048) === JSON.stringify(saved)));
    assert.equal(schema.validate(storage.store.read(), 'arcade'), true);
    assert.equal(storage.store.record.invalidLocal, undefined);
    assert.equal(!!storage.store.record.blocked, false);
    assert.equal(storage.store.record.dirty, true);
  });
}

test('restart is explicit, archives malformed rows and persists a playable new board', async () => {
  const saved = session(); saved.board = [null];
  const { game, storage, state } = await gameFixture(saved);
  game.start();
  await state.modals[0].actions[1].onClick(() => {});
  await storage.store.tail;
  assert.equal(game.started, true);
  assert.equal(game.score, 0);
  assert.equal(game.board.flat().filter(Boolean).length, 2);
  assert(storage.store.record.conflicts.some(copy => JSON.stringify(copy.payload.buckets.sessions.merge2048) === JSON.stringify(saved)));
  assert.equal(schema.validate(storage.store.read(), 'arcade'), true);
});

test('confirmed local repair preserves other games and resumes cloud writes with exact ACK', async t => {
  const saved = session(); saved.board[0][0] = 9;
  const { c, game, storage, state } = await gameFixture(saved, { quarantine: true, owner: 'A' });
  const archived = storage.store.record.conflicts.find(item => item.reason === 'invalid_local');
  await storage.store.edit(record => { record.conflicts.find(item => item.id === archived.id).payload.buckets.stats.catJump.bestScore = 789; });
  game.start();
  await state.modals[0].actions[0].onClick(() => {});
  await storage.store.tail;
  assert.equal(storage.getStats().catJump.bestScore, 789);
  let writes = 0;
  c.fetch = async (url, options = {}) => {
    if (url.endsWith('/v2/auth/me')) return { ok: true, status: 200, json: async () => ({ ok: true, user: { id: 'A' } }) };
    assert.equal(options.method, 'PUT');
    const body = JSON.parse(options.body);
    assert.equal(schema.validate(body.payload, 'arcade'), true);
    writes++;
    return { ok: true, status: 200, json: async () => ({ ok: true, protocol: 2, gameId: 'arcade', slot: 'default', requestId: body.requestId,
      revision: body.baseRevision + 1, checksum: body.checksum }) };
  };
  c.load('arcade/js/cloud-save.js');
  const client = c.RayCloudSave.createClient({ appId: 'arcade', store: storage.store, debounceMs: 60000 });
  client.owner = 'A'; client.initialized = true;
  t.after(() => { clearTimeout(client.timer); client.controllers.forEach(controller => controller.abort()); });
  await client.flush();
  assert.equal(writes, 1);
  assert.equal(storage.store.record.dirty, false);
  assert.equal(storage.store.record.invalidLocal, undefined);
  assert(storage.store.record.conflicts.some(item => item.payload.buckets.sessions.merge2048?.board[0][0] === 9));
});

test('cancel and owner changes never overwrite the original save', async () => {
  const saved = session(); saved.board[0][0] = 64;
  const { game, storage, state } = await gameFixture(saved);
  game.start();
  state.modals[0].onClose();
  assert.equal(state.home, 1);
  assert.deepEqual(plain(storage.loadSession('merge2048')), saved);
  await storage.store.setOwner('different-owner');
  await state.modals[0].actions[0].onClick(() => {});
  assert.equal(game.started, false);
  assert.equal(storage.loadSession('merge2048'), null);
  await storage.store.setOwner(null);
  assert(storage.store.record.conflicts.some(copy => JSON.stringify(copy.payload.buckets.sessions.merge2048) === JSON.stringify(saved)));
});

test('failed preservation and a destroyed game cannot replace a corrupt save', async () => {
  for (const destroyed of [false, true]) {
    const saved = session(); saved.board[0][0] = 9;
    const { game, storage, state } = await gameFixture(saved);
    game.start();
    if (destroyed) game.destroy();
    else storage.store.edit = async () => { throw new Error('storage_unavailable'); };
    await state.modals[0].actions[1].onClick(() => assert.fail('must not close before preservation'));
    assert.deepEqual(plain(storage.loadSession('merge2048')), saved);
    assert.equal(game.started, false);
    assert.equal(game.recoveryPending, true);
  }
});

test('recovery handles malformed rows and metadata without numeric coercion', async () => {
  const saved = { active: true, board: [null, ['2', -1, 3, 100], [false], []], score: '900', bestLevel: 64 };
  const { game, storage, state } = await gameFixture(saved);
  game.start();
  await state.modals[0].actions[0].onClick(() => {});
  await storage.store.tail;
  assert.equal(game.score, 0);
  assert.equal(game.bestLevel, 3);
  assert.deepEqual(plain(game.board[1]), [0, 0, 3, 0]);
  assert.equal(schema.validate(storage.store.read(), 'arcade'), true);
});

function frontierFixture(localStorage, stats = {}) {
  function node() {
    return { children: [], textContent: '', append(...nodes) { this.children.push(...nodes); },
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
      set innerHTML(_) { throw new Error('HTML interpolation is forbidden'); } };
  }
  const root = node();
  const c = { document: { createElement: node }, localStorage, window: {
    RayArcade: { Storage: { getStats: () => ({ frontier: stats }) }, UI: {} }
  } };
  vm.createContext(c);
  const source = fs.readFileSync('arcade/frontier/js/frontier.js', 'utf8')
    .replace(/^import[^\n]*\n/, '')
    .replace('const app = new RayFrontier();', 'window.Frontier = RayFrontier; return; const app = new RayFrontier();');
  vm.runInContext(source, c);
  const game = Object.create(c.window.Frontier.prototype);
  game.root = { querySelector: () => root };
  game.resize = () => {};
  return { game, root };
}

test('Frontier quality stays usable when reads or writes throw', () => {
  const { game } = frontierFixture({ getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } });
  game.quality = game.loadQuality();
  assert.equal(game.quality.id, 'high');
  for (const mode of ['mid', 'low', 'high']) {
    game.cycleQuality();
    assert.equal(game.quality.id, mode);
  }
  const { game: writeFailure } = frontierFixture({ getItem() { return 'low'; }, setItem() { throw new Error('quota'); } });
  writeFailure.quality = writeFailure.loadQuality();
  writeFailure.cycleQuality();
  assert.equal(writeFailure.quality.id, 'high');
  const { game: inheritedKey } = frontierFixture({ getItem() { return 'constructor'; } });
  assert.equal(inheritedKey.loadQuality().id, 'high');
});

test('Frontier renders untrusted statistics only as validated text', () => {
  const { game, root } = frontierFixture({}, { bestScore: '<img src=x onerror=alert(1)>', bestWave: 8, bestLevel: '9' });
  game.renderMenuStats();
  assert.deepEqual(root.children.map(row => row.children[1].textContent), ['0', '8', '0']);
});
