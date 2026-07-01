(function(){
  'use strict';
  const NS = window.RayStarfall = window.RayStarfall || {};
  const KEY = 'rayStarfall.save.v1';
  let cloudClient = null;
  let suppressCloudDirty = false;
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

  function clone(obj){ return JSON.parse(JSON.stringify(obj)); }

  function mergeDefaults(target, src){
    Object.keys(src).forEach(key => {
      if (target[key] === undefined) target[key] = clone(src[key]);
      else if (src[key] && typeof src[key] === 'object' && !Array.isArray(src[key])) mergeDefaults(target[key], src[key]);
    });
    return target;
  }

  function load(){
    let data;
    try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch(e){ data = null; }
    if (!data || typeof data !== 'object') {
      data = clone(defaultSave);
      data.createdAt = Date.now();
    }
    data = mergeDefaults(data, defaultSave);
    data.updatedAt = Date.now();
    return data;
  }

  let save = load();

  function persist(){
    save.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(save)); }
    catch(e){ /* Safari private mode may reject localStorage. Game still works for this session. */ }
    markCloudDirty('starfall:persist');
  }

  function markCloudDirty(reason){
    if (suppressCloudDirty || !cloudClient || typeof cloudClient.markDirty !== 'function') return;
    cloudClient.markDirty(reason || 'save');
  }

  function setCloudClient(client){ cloudClient = client || null; }

  function mergeProgress(localValue, remoteValue){
    if (window.RayCloudSave && typeof window.RayCloudSave.mergeProgress === 'function') return window.RayCloudSave.mergeProgress(localValue, remoteValue);
    if (remoteValue === undefined || remoteValue === null) return clone(localValue);
    if (localValue === undefined || localValue === null) return clone(remoteValue);
    if (typeof localValue === 'number' && typeof remoteValue === 'number') return Math.max(localValue, remoteValue);
    if (Array.isArray(localValue) || Array.isArray(remoteValue)) return [].concat(localValue || [], remoteValue || []);
    if (typeof localValue === 'object' && typeof remoteValue === 'object'){
      const out = {};
      const keys = new Set(Object.keys(localValue).concat(Object.keys(remoteValue)));
      keys.forEach(key => { out[key] = mergeProgress(localValue[key], remoteValue[key]); });
      return out;
    }
    return clone(remoteValue);
  }

  function get(){ return save; }
  function getSettings(){ return save.settings; }
  function setSettings(next){
    save.settings = Object.assign({}, save.settings, next || {});
    persist();
  }
  function setHelpSeen(value){ save.helpSeen = !!value; persist(); }

  function addCoins(amount){
    const n = Math.max(0, Math.floor(amount || 0));
    save.wallet.coins += n;
    save.stats.totalCoins += n;
    save.stats.totalCollected += n;
    persist();
    return save.wallet.coins;
  }

  function spendCoins(amount){
    const n = Math.max(0, Math.floor(amount || 0));
    if (save.wallet.coins < n) return false;
    save.wallet.coins -= n;
    persist();
    return true;
  }

  function priceForUpgrade(id){
    const lvl = save.upgrades[id] || 0;
    const base = { hull: 70, fireRate: 80, magnet: 65, dash: 75, coin: 90, nova: 120 }[id] || 80;
    return Math.round(base * Math.pow(1.65, lvl));
  }

  function buyUpgrade(id, maxLevel){
    if (!(id in save.upgrades)) return { ok:false, reason:'unknown' };
    const max = maxLevel || 5;
    if (save.upgrades[id] >= max) return { ok:false, reason:'max' };
    const cost = priceForUpgrade(id);
    if (!spendCoins(cost)) return { ok:false, reason:'coins', cost };
    save.upgrades[id] += 1;
    persist();
    return { ok:true, level: save.upgrades[id], cost };
  }

  function markAchievement(id){
    if (save.achievements[id]) return false;
    save.achievements[id] = Date.now();
    persist();
    return true;
  }

  function hasAchievement(id){ return !!save.achievements[id]; }

  function recordRun(run){
    run = run || {};
    const s = save.stats;
    s.totalRuns += 1;
    s.totalScore += Math.floor(run.score || 0);
    s.totalKills += Math.floor(run.kills || 0);
    s.totalTime += Math.floor(run.time || 0);
    s.bestScore = Math.max(s.bestScore, Math.floor(run.score || 0));
    s.bestWave = Math.max(s.bestWave, Math.floor(run.wave || 0));
    s.bestTime = Math.max(s.bestTime, Math.floor(run.time || 0));
    s.bestKills = Math.max(s.bestKills, Math.floor(run.kills || 0));
    s.bossKills += Math.floor(run.bossKills || 0);
    persist();
  }

  function reset(){
    save = clone(defaultSave);
    save.createdAt = Date.now();
    save.updatedAt = Date.now();
    persist();
  }

  function exportSave(){
    return {
      schema: 1,
      appId: 'starfall',
      exportedAt: Date.now(),
      save: clone(save)
    };
  }

  function importSave(payload){
    const incoming = payload && (payload.save || payload.payload || payload);
    if (!incoming || typeof incoming !== 'object') return exportSave();
    suppressCloudDirty = true;
    try {
      save = mergeProgress(save, mergeDefaults(clone(incoming), defaultSave));
      save.version = defaultSave.version;
      save.updatedAt = Date.now();
      try { localStorage.setItem(KEY, JSON.stringify(save)); } catch(e){ /* noop */ }
    } finally {
      suppressCloudDirty = false;
    }
    return exportSave();
  }

  function flushCloudSave(options){
    return cloudClient && typeof cloudClient.flush === 'function' ? cloudClient.flush(options || { force:true }) : Promise.resolve(false);
  }

  NS.Store = { get, getSettings, setSettings, setHelpSeen, addCoins, spendCoins, buyUpgrade, priceForUpgrade, markAchievement, hasAchievement, recordRun, reset, exportSave, importSave, setCloudClient, flushCloudSave, KEY };
})();
