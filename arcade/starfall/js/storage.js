(function () {
  'use strict';
  const NS = window.RayStarfall = window.RayStarfall || {};
  const core = window.RaySaveCore;
  const defaultSave = {
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    stats: {
      bestScore: 0,
      bestWave: 0,
      bestTime: 0,
      bestKills: 0,
      bossKills: 0,
      totalRuns: 0,
      totalScore: 0,
      totalKills: 0,
      totalCoins: 0,
      totalCollected: 0,
      totalTime: 0
    },
    wallet: { coins: 0 },
    upgrades: {
      hull: 0,
      fireRate: 0,
      magnet: 0,
      dash: 0,
      coin: 0,
      nova: 0
    },
    achievements: {},
    settings: {
      sound: true,
      vibrate: true,
      calm: false
    },
    helpSeen: false
  };
  const store = new core.Store('starfall', { schema: 2, appId: 'starfall', resetGeneration: 'initial', save: defaultSave });
  let cloudClient;
  const get = () => store.read().save;
  function mutate(fn, options) {
    const result = store.mutate(payload => fn(payload.save, payload), options);
    result.done.then(() => { if (cloudClient) cloudClient.markDirty(); }).catch(() => {});
    return result;
  }
  function getSettings() { return get().settings; }
  function setSettings(next) {
    return mutate(save => {
      ['sound', 'vibrate', 'calm'].forEach(key => { if (typeof next[key] === 'boolean') save.settings[key] = next[key]; });
    }).done;
  }
  function setHelpSeen(value) { return mutate(save => { save.helpSeen = !!value; }).done; }
  const amount = n => Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  function addCoins(n) {
    n = amount(n);
    return mutate(save => { save.wallet.coins += n; save.stats.totalCoins += n; save.stats.totalCollected += n; return save.wallet.coins; }).value;
  }
  function spendCoins(n) {
    n = amount(n);
    return mutate(save => {
      if (save.wallet.coins < n) return false;
      save.wallet.coins -= n; return true;
    }).done;
  }
  function price(id, level) {
    const base = { hull: 70, fireRate: 80, magnet: 65, dash: 75, coin: 90, nova: 120 }[id] || 80;
    return Math.round(base * Math.pow(1.65, level));
  }
  function priceForUpgrade(id) { return price(id, get().upgrades[id] || 0); }
  function buyUpgrade(id, maxLevel = 5) {
    return mutate(save => {
      if (!Object.hasOwn(save.upgrades, id)) return { ok: false, reason: 'unknown' };
      const level = save.upgrades[id];
      if (level >= Math.min(5, maxLevel)) return { ok: false, reason: 'max' };
      const cost = price(id, level);
      if (save.wallet.coins < cost) return { ok: false, reason: 'coins', cost };
      save.wallet.coins -= cost;
      save.upgrades[id] += 1;
      return { ok: true, level: save.upgrades[id], cost };
    }).done;
  }
  function markAchievement(id) {
    const at = Date.now();
    return mutate(save => {
      if (save.achievements[id]) return false;
      save.achievements[id] = at; return true;
    }).value;
  }
  function hasAchievement(id) { return !!get().achievements[id]; }
  function recordRun(run = {}) {
    return mutate(save => {
      const s = save.stats;
      const coins = amount(run.coins);
      save.wallet.coins += coins; s.totalCoins += coins; s.totalCollected += coins;
      s.totalRuns += 1;
      s.totalScore += amount(run.score); s.totalKills += amount(run.kills); s.totalTime += amount(run.time);
      s.bestScore = Math.max(s.bestScore, amount(run.score));
      s.bestWave = Math.max(s.bestWave, amount(run.wave));
      s.bestTime = Math.max(s.bestTime, amount(run.time));
      s.bestKills = Math.max(s.bestKills, amount(run.kills));
      s.bossKills += amount(run.bossKills);
    }).done;
  }
  function reset() {
    const generation = core.id();
    return mutate((save, payload) => { payload.save = core.copy(defaultSave); payload.resetGeneration = generation; }, { reset: true }).done;
  }
  function exportSave() { return store.read(); }
  function importSave(payload) {
    if (!payload || payload.schema !== 2 || payload.appId !== 'starfall') return Promise.reject(new Error('invalid_save'));
    return store.replace(payload);
  }
  function setCloudClient(client) { cloudClient = client; }
  function flushCloudSave(options) { return cloudClient ? cloudClient.flush(options) : Promise.resolve(false); }
  NS.Store = { store, get, getSettings, setSettings, setHelpSeen, addCoins, spendCoins, buyUpgrade,
    priceForUpgrade, markAchievement, hasAchievement, recordRun, reset, exportSave, importSave, setCloudClient, flushCloudSave };
})();
