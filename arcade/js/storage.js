(function () {
  "use strict";

  const NS = "rayArcade.";
  let cloudClient = null;

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

  const core = window.RaySaveCore;
  const store = new core.Store('arcade', { schema: 2, appId: 'arcade', resetGeneration: 'initial', buckets: defaults });
  let sessionBaselines = {};
  store.listeners.add(reason => { if (reason === 'owner_changed') sessionBaselines = {}; });
  function mutate(fn, options) {
    const result = store.mutate(fn, options);
    result.done.then(() => markCloudDirty('transaction')).catch(() => {});
    return result.value;
  }
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeDeep(base, incoming) {
    if (Array.isArray(base)) return Array.isArray(incoming) ? incoming.filter(x => typeof x === "string") : clone(base);
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
    return mergeDeep(clone(defaults[bucket]), store.read().buckets[bucket]);
  }

  function save(bucket, value) {
    const before = load(bucket), next = clone(value);
    return mutate((payload, preview) => {
      if (!preview && !core.equal(payload.buckets[bucket], before) && !core.equal(payload.buckets[bucket], next)) {
        // Opaque snapshots (cards and boards) cannot be repaired by arithmetic.
        throw new Error('local_revision_conflict');
      }
      payload.buckets[bucket] = clone(next);
    });
  }

  function markCloudDirty(reason) {
    if (!cloudClient || typeof cloudClient.markDirty !== "function") return;
    cloudClient.markDirty(reason || "save");
  }

  function setCloudClient(client) {
    cloudClient = client || null;
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
    return mutate(payload => {
      const stats = payload.buckets.stats;
      stats.totalPlays += 1;
      stats[gameId] = stats[gameId] || { plays: 0 };
      stats[gameId].plays = (stats[gameId].plays || 0) + 1;
      return clone(stats);
    });
  }

  function updateBest(gameId, patch) {
    return mutate(payload => {
    const stats = payload.buckets.stats;
    stats[gameId] = stats[gameId] || {};
    Object.keys(patch || {}).forEach((key) => {
      const val = patch[key];
      if (Number.isFinite(val) && val >= 0 && /^best[A-Z]/.test(key)) {
        stats[gameId][key] = Math.max(Number(stats[gameId][key] || 0), val);
      } else if (Array.isArray(val)) {
        const set = new Set([].concat(stats[gameId][key] || [], val));
        stats[gameId][key] = Array.from(set);
      } else if (val !== undefined && val !== null) {
        stats[gameId][key] = val;
      }
    });
    return clone(stats[gameId]);
    });
  }

  function getSettings() {
    return load("settings");
  }

  function setSetting(key, value) {
    return mutate(payload => { payload.buckets.settings[key] = !!value; return clone(payload.buckets.settings); });
  }

  function getHelpSeen() {
    return load("helpSeen");
  }

  function isHelpSeen(gameId) {
    return !!getHelpSeen()[gameId];
  }

  function markHelpSeen(gameId) {
    mutate(payload => { payload.buckets.helpSeen[gameId] = true; });
  }

  function getCards() {
    const cards = load("cards");
    const today = todayKey();
    if (cards.date !== today) {
      cards.date = today;
      cards.draws = 0;
      mutate(payload => {
        if (payload.buckets.cards.date !== today) {
          payload.buckets.cards.date = today; payload.buckets.cards.draws = 0;
        }
      });
    }
    return cards;
  }

  function saveCards(cards) {
    save("cards", cards);
  }
  function recordCardDraw(card) {
    const date = todayKey(), ts = Date.now();
    const result = store.mutate(payload => {
      const cards = payload.buckets.cards;
      if (cards.date !== date) { cards.date = date; cards.draws = 0; }
      if (cards.draws >= 3) return { ok: false, reason: 'limit' };
      cards.draws += 1;
      cards.collection[card.id] = (cards.collection[card.id] || 0) + 1;
      cards.history.unshift({ id: card.id, rarity: card.rarity, title: card.title, date, ts });
      cards.history = cards.history.slice(0, 60);
      const stats = payload.buckets.stats.dailyCard;
      stats.totalDraws += 1;
      const rarity = ['N', 'R', 'SR', 'SSR', 'UR'];
      if (rarity.indexOf(card.rarity) > rarity.indexOf(stats.rarest)) stats.rarest = card.rarity;
      return { ok: true, cards: clone(cards) };
    });
    result.done.then(() => markCloudDirty('draw')).catch(() => {});
    return result.done;
  }

  function getSessions() {
    return load("sessions");
  }

  function loadSession(gameId) {
    const sessions = getSessions();
    sessionBaselines[gameId] = core.copy(sessions[gameId]);
    return sessions[gameId] || null;
  }

  function saveSession(gameId, session) {
    const next = Object.assign({}, session || {}, { updatedAt: Date.now() });
    const before = core.copy(sessionBaselines[gameId]);
    sessionBaselines[gameId] = clone(next);
    return mutate((payload, preview) => {
      if (!preview && !core.equal(payload.buckets.sessions[gameId], before)) throw new Error('session_conflict');
      payload.buckets.sessions[gameId] = clone(next); return clone(next);
    });
  }

  function clearSession(gameId) {
    const before = core.copy(Object.hasOwn(sessionBaselines, gameId) ? sessionBaselines[gameId] : getSessions()[gameId]);
    sessionBaselines[gameId] = undefined;
    mutate((payload, preview) => {
      if (!preview && !core.equal(payload.buckets.sessions[gameId], before)) throw new Error('session_conflict');
      delete payload.buckets.sessions[gameId];
    });
  }

  function getAchievements() {
    return load("achievements");
  }

  function addAchievement(id) {
    if (typeof id !== 'string' || !id) return false;
    return mutate(payload => {
      const list = payload.buckets.achievements;
      if (list.includes(id)) return false;
      list.push(id); return true;
    });
  }

  function resetAll() {
    const generation = core.id();
    mutate(payload => { payload.buckets = clone(defaults); payload.resetGeneration = generation; }, { reset: true });
  }

  function exportSave() {
    return store.read();
  }

  function importSave(payload) {
    if (!payload || payload.appId !== 'arcade' || payload.schema !== 2) return Promise.reject(new Error('invalid_save'));
    return store.replace(payload);
  }

  function flushCloudSave(options) {
    return cloudClient && typeof cloudClient.flush === "function" ? cloudClient.flush(options || { force: true }) : Promise.resolve(false);
  }

  window.RayArcade = window.RayArcade || {};
  window.RayArcade.Storage = {
    store,
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
    recordCardDraw,
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
