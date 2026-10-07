const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const pending = new Map();
  let next = 0, updates = 0, renders = 0;
  const c = { window: { RayArcade: { UI: { toast() {} } } },
    document: { hidden: false }, THREE: { Vector3: class {} },
    performance: { now: () => 100 },
    requestAnimationFrame: callback => { pending.set(++next, callback); return next; },
    cancelAnimationFrame: id => pending.delete(id) };
  vm.createContext(c);
  const source = fs.readFileSync('arcade/frontier/js/frontier.js', 'utf8')
    .replace(/^import[^\n]*\n/, '')
    .replace('const app = new RayFrontier();', 'window.Frontier = RayFrontier; return; const app = new RayFrontier();');
  vm.runInContext(source, c);
  const game = Object.create(c.window.Frontier.prototype);
  Object.assign(game, { state: 'playing', raf: 0, idleRaf: 0, last: 0,
    releaseStick() {}, update() { updates++; }, render() { renders++; },
    renderer: { render() { renders++; } }, scene: {},
    nodes: { player: { rotation: { y: 0 } } }, camera: { position: { lerp() {} }, lookAt() {} } });
  return { game, c, pending, get updates() { return updates; }, get renders() { return renders; }, frame(time = 116) {
    const callbacks = [...pending.values()]; pending.clear();
    callbacks.forEach(callback => callback(time));
  } };
}

test('rapid Frontier pause/resume retains exactly one animation chain', () => {
  const f = fixture();
  f.game.loop(100);
  const initial = f.updates;
  for (let i = 0; i < 20; i++) { f.game.pause(); f.game.resume(); }
  assert.equal(f.pending.size, 1);
  assert.equal(f.updates, initial, 'Resume defers work to the next animation frame');
  const before = f.updates;
  f.frame();
  assert.equal(f.updates - before, 1);
  assert.equal(f.pending.size, 1);
  f.game.pause();
  assert.equal(f.pending.size, 0);
});

test('Frontier does not schedule a new frame when update pauses or ends the game', () => {
  for (const state of ['paused', 'levelup', 'gameover']) {
    const f = fixture();
    f.game.update = () => { f.game.state = state; };
    f.game.loop(100);
    assert.equal(f.pending.size, 0, state);
  }
});

test('Frontier menu scheduling is idempotent and hidden pages do not render', () => {
  const f = fixture(); f.game.state = 'menu';
  f.game.drawIdle(); f.game.drawIdle();
  assert.equal(f.pending.size, 1);
  f.c.document.hidden = true;
  const before = f.renders;
  f.frame();
  assert.equal(f.renders, before);
  assert.equal(f.pending.size, 0);
});

test('a hidden Frontier frame pauses without advancing gameplay or silently resuming', () => {
  const f = fixture(); f.game.loop(100);
  const before = f.updates;
  f.c.document.hidden = true;
  f.frame();
  assert.equal(f.updates, before);
  assert.equal(f.game.state, 'paused');
  f.game.resume();
  assert.equal(f.game.state, 'paused');
  assert.equal(f.pending.size, 0);
});
