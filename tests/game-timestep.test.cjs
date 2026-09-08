const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

for (const [file, name] of [['cat-jump', 'CatJump'], ['neon-balls', 'NeonBalls']]) {
  function game() {
    const c = { RayArcade: { UI: {}, Storage: {} }, document: { hidden: false }, requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
    c.window = c; vm.createContext(c);
    vm.runInContext(fs.readFileSync(`arcade/games/${file}.js`, 'utf8'), c);
    const g = new c.RayGames[name]({}, {});
    g.running = true; g.draw = () => {}; g.kick = () => {};
    return { c, g };
  }
  test(`${name}: 30/60/120/144 Hz produce the same number of fixed physics ticks`, () => {
    const counts = [30, 60, 120, 144].map(hz => {
      const { g } = game(); let ticks = 0; g.update = () => ticks++;
      for (let frame = 0; frame <= hz * 10; frame++) g.loop(frame * 1000 / hz);
      return ticks;
    });
    assert.deepEqual(counts, [600, 600, 600, 600]);
  });
  test(`${name}: background/resume and long stalls never cause an unbounded catch-up`, () => {
    const { c, g } = game(); let ticks = 0; g.update = () => ticks++;
    g.loop(0); g.loop(60000); assert.equal(ticks, 6);
    g.pause(); g.paused = false; g.loop(120000); assert.equal(ticks, 6);
    c.document.hidden = true; g.loop(180000);
    c.document.hidden = false; g.loop(240000); assert.equal(ticks, 6);
  });
}
