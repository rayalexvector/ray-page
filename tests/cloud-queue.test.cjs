const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBrowser, loadStarfall, plain, IDBFactory } = require('./storage-harness.cjs');
const response = (data, status = 200) => {
  data = { protocol: 2, gameId: 'starfall', slot: 'default', ...data };
  if (data.save) data.save = { protocol: 2, gameId: 'starfall', slot: 'default', schema: data.save.payload.schema, ...data.save };
  return { ok: status >= 200 && status < 300, status, json: async () => data };
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const until = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise(r => setTimeout(r, 2)); assert.ok(predicate()); };

async function fixture(t, fetch, indexedDB) {
  const c = makeBrowser({ fetch, indexedDB });
  const storage = loadStarfall(c); await storage.store.ready;
  c.load('arcade/js/cloud-save.js');
  const client = c.RayCloudSave.createClient({ appId: 'starfall', store: storage.store, debounceMs: 60000 });
  await storage.store.setOwner('A'); client.owner = 'A'; client.initialized = true;
  t.after(() => { clearTimeout(client.timer); client.controllers.forEach(x => x.abort()); });
  return { c, storage, client };
}

test('old ACK confirms only its immutable snapshot, newer progress gets a new request', async t => {
  const first = deferred(), entered = deferred(), bodies = [];
  let c;
  const f = await fixture(t, async (url, options) => {
    if (url.endsWith('/v2/auth/me')) return response({ ok: true, user: { id: 'A' } });
    const body = JSON.parse(options.body); bodies.push(body);
    if (bodies.length === 1) { entered.resolve(); await first.promise; }
    return response({ ok: true, requestId: body.requestId, revision: body.baseRevision + 1, checksum: c.RayCloudSave.checksum(body.payload) });
  }); c = f.c;
  f.storage.addCoins(10); await f.storage.store.tail;
  const inFlight = f.client.flush(); await entered.promise;
  f.storage.addCoins(5); await f.storage.store.tail;
  first.resolve(); await inFlight;
  assert.equal(f.storage.store.record.dirty, true);
  assert.equal(f.storage.get().wallet.coins, 15);
  await f.client.flush();
  assert.equal(bodies.length, 2);
  assert.notEqual(bodies[0].requestId, bodies[1].requestId);
  assert.equal(bodies[0].payload.save.wallet.coins, 10);
  assert.equal(bodies[1].payload.save.wallet.coins, 15);
  assert.equal(bodies[1].baseRevision, 1);
  assert.equal(f.storage.store.record.dirty, false);
});

test('uncertain retry reuses exact request ID/body and rejects a mismatched ACK', async t => {
  const bodies = []; let rejectAck = true;
  const f = await fixture(t, async (url, options) => {
    if (url.endsWith('/v2/auth/me')) return response({ ok: true, user: { id: 'A' } });
    bodies.push(options.body); const body = JSON.parse(options.body);
    return response({ ok: true, requestId: rejectAck ? 'wrong-id' : body.requestId, revision: 1, checksum: body.checksum });
  });
  f.storage.addCoins(10); await f.storage.store.tail;
  assert.equal(await f.client.flush(), false);
  const requestId = f.storage.store.record.pending.request.requestId;
  f.storage.addCoins(20); await f.storage.store.tail;
  rejectAck = false; await f.client.flush();
  assert.equal(bodies[0], bodies[1]);
  assert.equal(JSON.parse(bodies[1]).requestId, requestId);
  assert.equal(f.storage.store.record.dirty, true);
});

test('two tabs serialize cloud writes using a transaction lease', async t => {
  const indexedDB = new IDBFactory(), hold = deferred(), entered = deferred(); let writes = 0;
  const fetch = async (url, options) => {
    if (url.endsWith('/v2/auth/me')) return response({ ok: true, user: { id: 'A' } });
    writes++; entered.resolve(); await hold.promise;
    const body = JSON.parse(options.body);
    return response({ ok: true, requestId: body.requestId, revision: 1, checksum: body.checksum });
  };
  const a = await fixture(t, fetch, indexedDB), b = await fixture(t, fetch, indexedDB);
  a.storage.addCoins(10); await a.storage.store.tail;
  const first = a.client.flush(); await entered.promise;
  await b.client.flush(); assert.equal(writes, 1);
  hold.resolve(); await first;
});

test('account switch during PUT preserves A pending and cannot acknowledge B', async t => {
  const entered = deferred(), hold = deferred();
  const f = await fixture(t, async (url, options) => {
    if (url.endsWith('/v2/auth/me')) return response({ ok: true, user: { id: 'A' } });
    const body = JSON.parse(options.body); assert.equal(body.ownerId, 'A');
    entered.resolve(); await hold.promise;
    return response({ ok: true, requestId: body.requestId, revision: 1, checksum: body.checksum });
  });
  f.storage.addCoins(10); await f.storage.store.tail;
  const flight = f.client.flush(); await entered.promise;
  f.client.epoch++; f.client.owner = 'B';
  await f.storage.store.setOwner('B');
  hold.resolve(); await flight;
  assert.equal(f.storage.get().wallet.coins, 0);
  assert.equal(f.storage.store.record.revision, 0);
  await f.storage.store.setOwner('A');
  assert.ok(f.storage.store.record.pending);
  assert.equal(f.storage.store.record.pending.request.payload.save.wallet.coins, 10);
});

test('schema1 owned remote is backed up and migrated; GET checksum need not be client checksum', async t => {
  let remote, write;
  const f = await fixture(t, async (url, options) => {
    if (url.endsWith('/v2/auth/me')) return response({ ok: true, user: { id: 'A' } });
    if (!options.body) { assert.match(url, /ownerId=A/); return response({ ok: true, save: remote }); }
    write = JSON.parse(options.body);
    return response({ ok: true, requestId: write.requestId, revision: 9, checksum: write.checksum });
  });
  const old = f.storage.exportSave(); old.schema = 1; delete old.resetGeneration; old.save.wallet.coins = 90;
  remote = { revision: 8, checksum: 'server-sha256', payload: old };
  f.client.initialized = false;
  await f.client.bootstrap(); await until(() => !!write);
  if (f.client.inFlight) await f.client.inFlight;
  assert.equal(write.payload.schema, 2); assert.equal(write.payload.resetGeneration, 'initial');
  assert.equal(write.baseRevision, 8);
  assert.ok(f.storage.store.record.conflicts.some(x => x.reason === 'migrated_remote_schema1' && x.payload.schema === 1));
});

test('unsafe SW blocks even auth reads and requests an update', async t => {
  let requests = 0, updates = 0;
  const f = await fixture(t, async () => { requests++; throw new Error('must not fetch'); });
  f.c.navigator.serviceWorker = {
    controller: { postMessage(message, ports) { ports[0].postMessage({ rayGameCacheProtocol: 1 }); } },
    getRegistration: async () => ({ update: async () => { updates++; } })
  };
  await f.client.flush();
  assert.equal(requests, 0); assert.equal(updates, 1); assert.equal(f.client.status.state, 'upgrade');
});

test('generation conflict keeps both copies and requires an explicit selection', async t => {
  let remote;
  const f = await fixture(t, async () => response({ ok: true, save: remote }));
  f.storage.addCoins(10); await f.storage.store.tail;
  const other = f.storage.exportSave(); other.resetGeneration = 'reset-remote'; other.save.wallet.coins = 0;
  remote = { revision: 2, payload: other };
  assert.equal(await f.client.pullRemote(0, 'A'), false);
  assert.equal(f.storage.get().wallet.coins, 10);
  assert.equal(f.storage.store.record.blocked, true);
  assert.ok(f.storage.store.record.conflicts.some(x => x.reason === 'remote_conflict'));
  assert.ok(f.storage.store.record.conflicts.some(x => x.reason === 'local_conflict'));
});

test('a locally locked logout never reauthenticates using a still-valid cookie', async t => {
  let requests = 0;
  const f = await fixture(t, async () => { requests++; return response({ ok: true, user: { id: 'A' } }); });
  f.c.localStorage.setItem('ray-auth-local-lock-v2', 'true');
  await f.client.flush();
  assert.equal(requests, 0);
  assert.equal(f.client.owner, null);
  assert.equal(f.storage.store.owner, null);
  assert.equal(f.client.status.state, 'locked');
});
