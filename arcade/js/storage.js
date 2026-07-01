(function () {
  "use strict";

  const NS = "rayArcade.";
  let cloudClient = null;
  let suppressCloudDirty = false;

  const defaults = {
    stats: {
      catJump: { bestHeight: 0, bestScore: 0, plays: 0 },
      rayHop: { bestScore: 0, bestCombo: 0, plays: 0 },
      merge2048: { bestScore: 0, bestLevel: 0, unlocked: [1], plays: 0 },
      dungeon: { bestFloor: 0, bestGold: 0, titles: [], plays: 0 },
      neonBalls: { bestRound: 0, bestScore: 0, plays: 0 },
      reaction: { bestScore: 0, bestCombo: 0, plays: 0 },
      dailyCard: { totalDraws: 0, rarest: "", plays: 0 },
      frontier: { bestScore: 0, bestWave: 0, bestLevel: 0, bestChips: 0, plays: 0 },
      totalPlays: 0
    },
    settings: {
      sound: true,
      vibrate: true
    },
    cards: {
      date: "",
      draws: 0,
      collection: {},
      history: []
    },
    sessions: {},
    helpSeen: {},
    achievements: []
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeDeep(base, incoming) {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return clone(base);
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(incoming).forEach((key) => {
      const src = incoming[key];
      if (src && typeof src === "object" && !Array.isArray(src) && base && typeof base[key] === "object" && !Array.isArray(base[key])) {
        out[key] = mergeDeep(base[key], src);
      } else {
        out[key] = src;
      }
    });
    return out;
  }

  function load(bucket) {
    const fallback = clone(defaults[bucket]);
    try {
      const raw = localStorage.getItem(NS + bucket);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return mergeDeep(fallback, parsed);
    } catch (err) {
      console.warn("RayArcade storage load failed", bucket, err);
      return fallback;
    }
  }

  function save(bucket, value) {
    try {
      localStorage.setItem(NS + bucket, JSON.stringify(value));
    } catch (err) {
      console.warn("RayArcade storage save failed", bucket, err);
    }
    markCloudDirty("bucket:" + bucket);
  }

  function markCloudDirty(reason) {
    if (suppressCloudDirty || !cloudClient || typeof cloudClient.markDirty !== "function") return;
    cloudClient.markDirty(reason || "save");
  }

  function setCloudClient(client) {
    cloudClient = client || null;
  }

  function mergeProgress(localValue, remoteValue) {
    if (window.RayCloudSave && typeof window.RayCloudSave.mergeProgress === "function") {
      return window.RayCloudSave.mergeProgress(localValue, remoteValue);
    }
    if (remoteValue === undefined || remoteValue === null) return clone(localValue);
    if (localValue === undefined || localValue === null) return clone(remoteValue);
    if (typeof localValue === "number" && typeof remoteValue === "number") return Math.max(localValue, remoteValue);
    if (Array.isArray(localValue) || Array.isArray(remoteValue)) {
      const out = [];
      [].concat(localValue || [], remoteValue || []).forEach((item) => {
        if (!out.some((existing) => JSON.stringify(existing) === JSON.stringify(item))) out.push(clone(item));
      });
      return out;
    }
    if (typeof localValue === "object" && typeof remoteValue === "object") {
      const out = {};
      const keys = new Set(Object.keys(localValue).concat(Object.keys(remoteValue)));
      keys.forEach((key) => { out[key] = mergeProgress(localValue[key], remoteValue[key]); });
      return out;
    }
    return clone(remoteValue);
  }

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function getStats() {
    return load("stats");
  }

  function saveStats(stats) {
    save("stats", stats);
  }

  function notePlay(gameId) {
    const stats = getStats();
    stats.totalPlays = (stats.totalPlays || 0) + 1;
    stats[gameId] = stats[gameId] || { plays: 0 };
    stats[gameId].plays = (stats[gameId].plays || 0) + 1;
    saveStats(stats);
    return stats;
  }

  function updateBest(gameId, patch) {
    const stats = getStats();
    stats[gameId] = stats[gameId] || {};
    Object.keys(patch || {}).forEach((key) => {
      const val = patch[key];
      if (typeof val === "number") {
        stats[gameId][key] = Math.max(Number(stats[gameId][key] || 0), val);
      } else if (Array.isArray(val)) {
        const set = new Set([].concat(stats[gameId][key] || [], val));
        stats[gameId][key] = Array.from(set);
      } else if (val !== undefined && val !== null) {
        stats[gameId][key] = val;
      }
    });
    saveStats(stats);
    return stats[gameId];
  }

  function getSettings() {
    return load("settings");
  }

  function setSetting(key, value) {
    const settings = getSettings();
    settings[key] = !!value;
    save("settings", settings);
    return settings;
  }

  function getHelpSeen() {
    return load("helpSeen");
  }

  function isHelpSeen(gameId) {
    return !!getHelpSeen()[gameId];
  }

  function markHelpSeen(gameId) {
    const seen = getHelpSeen();
    seen[gameId] = true;
    save("helpSeen", seen);
  }

  function getCards() {
    const cards = load("cards");
    const today = todayKey();
    if (cards.date !== today) {
      cards.date = today;
      cards.draws = 0;
      save("cards", cards);
    }
    return cards;
  }

  function saveCards(cards) {
    save("cards", cards);
  }

  function getSessions() {
    return load("sessions");
  }

  function loadSession(gameId) {
    const sessions = getSessions();
    return sessions[gameId] || null;
  }

  function saveSession(gameId, session) {
    const sessions = getSessions();
    sessions[gameId] = Object.assign({}, session || {}, { updatedAt: Date.now() });
    save("sessions", sessions);
    return sessions[gameId];
  }

  function clearSession(gameId) {
    const sessions = getSessions();
    if (sessions[gameId]) {
      delete sessions[gameId];
      save("sessions", sessions);
    }
  }

  function getAchievements() {
    return load("achievements");
  }

  function addAchievement(id) {
    const list = getAchievements();
    if (!list.includes(id)) {
      list.push(id);
      save("achievements", list);
      return true;
    }
    return false;
  }

  function resetAll() {
    Object.keys(defaults).forEach((bucket) => save(bucket, clone(defaults[bucket])));
  }

  function exportSave() {
    return {
      schema: 1,
      appId: "arcade",
      exportedAt: Date.now(),
      buckets: {
        stats: load("stats"),
        settings: load("settings"),
        cards: load("cards"),
        sessions: load("sessions"),
        helpSeen: load("helpSeen"),
        achievements: load("achievements")
      }
    };
  }

  function importSave(payload) {
    const source = payload && (payload.buckets || payload.payload || payload);
    if (!source || typeof source !== "object") return exportSave();
    suppressCloudDirty = true;
    try {
      Object.keys(defaults).forEach((bucket) => {
        if (source[bucket] === undefined) return;
        save(bucket, mergeProgress(load(bucket), source[bucket]));
      });
    } finally {
      suppressCloudDirty = false;
    }
    return exportSave();
  }

  function flushCloudSave(options) {
    return cloudClient && typeof cloudClient.flush === "function" ? cloudClient.flush(options || { force: true }) : Promise.resolve(false);
  }

  window.RayArcade = window.RayArcade || {};
  window.RayArcade.Storage = {
    NS,
    defaults,
    load,
    save,
    todayKey,
    getStats,
    saveStats,
    notePlay,
    updateBest,
    getSettings,
    setSetting,
    getHelpSeen,
    isHelpSeen,
    markHelpSeen,
    getCards,
    saveCards,
    getSessions,
    loadSession,
    saveSession,
    clearSession,
    getAchievements,
    addAchievement,
    resetAll,
    exportSave,
    importSave,
    setCloudClient,
    flushCloudSave
  };
})();
