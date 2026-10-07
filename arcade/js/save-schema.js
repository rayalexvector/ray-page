(function (root, factory) {
  'use strict';
  const schema = factory();
  if (typeof module === 'object' && module.exports) module.exports = schema;
  else root.RaySaveSchema = schema;
})(globalThis, function () {
  'use strict';
  function validate(payload, appId) {
    const object = x => x && typeof x === 'object' && !Array.isArray(x);
    const number = x => Number.isFinite(x) && x >= 0 && x <= Number.MAX_SAFE_INTEGER;
    const booleans = x => object(x) && Object.values(x).every(v => typeof v === 'boolean');
    function json(value, depth = 0) {
      if (depth > 16) return false;
      if (typeof value === 'number') return number(value);
      if (typeof value === 'string') return value.length <= 4096;
      if (value === null || typeof value === 'boolean') return true;
      if (!value || typeof value !== 'object') return false;
      return Object.keys(value).length <= 4096 && Object.entries(value).every(([k, v]) =>
        !['__proto__', 'constructor', 'prototype'].includes(k) && json(v, depth + 1));
    }
    if (!object(payload) || payload.schema !== 2 || payload.appId !== appId ||
        typeof payload.resetGeneration !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.resetGeneration) || !json(payload)) return false;
    if (appId === 'starfall') {
      const save = payload.save;
      return object(save) && object(save.wallet) && Number.isSafeInteger(save.wallet.coins) && number(save.wallet.coins) &&
        object(save.upgrades) && ['hull', 'fireRate', 'magnet', 'dash', 'coin', 'nova'].every(k =>
          Number.isSafeInteger(save.upgrades[k]) && save.upgrades[k] >= 0 && save.upgrades[k] <= 5) &&
        object(save.stats) && ['bestScore', 'bestWave', 'bestTime', 'bestKills', 'bossKills', 'totalRuns', 'totalScore', 'totalKills', 'totalCoins', 'totalCollected', 'totalTime'].every(k => number(save.stats[k])) &&
        object(save.achievements) && Object.values(save.achievements).every(number) && booleans(save.settings) && typeof save.helpSeen === 'boolean';
    }
    if (appId !== 'arcade') return false;
    const b = payload.buckets;
    if (!object(b) || !object(b.stats) || !number(b.stats.totalPlays) || !booleans(b.settings) || !booleans(b.helpSeen) ||
        !object(b.sessions) || !Array.isArray(b.achievements) || !b.achievements.every(x => typeof x === 'string') ||
        !object(b.cards) || typeof b.cards.date !== 'string' || !number(b.cards.draws) || !object(b.cards.collection) ||
        !Object.values(b.cards.collection).every(number) || !Array.isArray(b.cards.history)) return false;
    for (const key of ['catJump', 'rayHop', 'merge2048', 'dungeon', 'neonBalls', 'reaction', 'dailyCard', 'frontier']) {
      if (!object(b.stats[key]) || !number(b.stats[key].plays)) return false;
    }
    if (!Number.isSafeInteger(b.stats.frontier.plays) ||
      !['bestScore', 'bestWave', 'bestLevel', 'bestChips'].every(key =>
        !Object.hasOwn(b.stats.frontier, key) ||
        (Number.isSafeInteger(b.stats.frontier[key]) && number(b.stats.frontier[key])))) return false;
    const game = b.sessions.merge2048;
    if (game !== undefined && game !== null && (!object(game) || !Array.isArray(game.board) || game.board.length !== 4 ||
        !game.board.every(row => Array.isArray(row) && row.length === 4 && row.every(cell => Number.isSafeInteger(cell) && cell >= 0 && cell <= 8)) ||
        !number(game.score) || !Number.isSafeInteger(game.bestLevel) || game.bestLevel < 0 || game.bestLevel > 8 || typeof game.active !== 'boolean')) return false;
    return true;
  }
  return { validate };
});
