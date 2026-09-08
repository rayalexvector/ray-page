(function () {
  'use strict';
  const copy = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const id = () => crypto.randomUUID();
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const keyFor = (owner, appId) => JSON.stringify([owner === null ? 'guest' : 'user', owner, appId, 2]);
  let database;
  function db() {
    if (!database) database = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('storage_unavailable'));
      const request = indexedDB.open('ray-game-saves-v2', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saves');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    return database.catch(error => { database = null; throw error; });
  }
  async function transaction(key, initial, edit) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('saves', 'readwrite');
      const store = tx.objectStore('saves');
      const request = store.get(key);
      let result, failure;
      request.onsuccess = () => {
        try {
          const record = request.result || copy(initial);
          const value = edit(record);
          store.put(record, key);
          result = { record, value };
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('storage_failed'));
    });
  }
  function fresh(payload) {
    return { payload: copy(payload), localRevision: 0, revision: 0, dirty: false, pending: null, conflicts: [] };
  }
  function archive(record, payload, reason, extra) {
    if (record.conflicts.some(item => item.reason === reason && equal(item.payload, payload) &&
        (!extra || item.revision === extra.revision))) return;
    record.conflicts.push(Object.assign({ id: id(), reason, payload: copy(payload), savedAt: Date.now() }, extra));
  }
  const validate = window.RaySaveSchema.validate;
  function upgradeLegacy(payload, initial) {
    if (!payload || payload.schema !== 1 || payload.appId !== initial.appId) return null;
    const result = copy(payload);
    function fill(target, defaults) {
      if (!target || typeof target !== 'object' || Array.isArray(target)) return;
      Object.keys(defaults).forEach(key => {
        if (!Object.hasOwn(target, key)) target[key] = copy(defaults[key]);
        else if (defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) fill(target[key], defaults[key]);
      });
    }
    fill(result, initial);
    result.schema = 2;
    result.resetGeneration = 'initial';
    return validate(result, initial.appId) ? result : null;
  }
  // Unknown arrays, boards, sessions and economy are atomic. Only named monotonic fields combine.
  function mergeTyped(local, remote) {
    if (!local || !remote || local.appId !== remote.appId || local.schema !== remote.schema ||
        local.resetGeneration !== remote.resetGeneration) return { payload: copy(local), conflict: true };
    const out = copy(remote);
    let conflict = false;
    function walk(a, b, path) {
      const key = path[path.length - 1];
      if (equal(a, b)) return copy(b);
      if (/^best[A-Z]/.test(key) && Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0) return Math.max(a, b);
      if (['unlocked', 'titles', 'achievements'].includes(key) && Array.isArray(a) && Array.isArray(b) &&
          a.concat(b).every(x => typeof x === 'string' || Number.isSafeInteger(x))) return [...new Set(a.concat(b))];
      if (key === 'achievements' && a && b && !Array.isArray(a) && !Array.isArray(b)) return Object.assign({}, a, b);
      if (['exportedAt', 'updatedAt', 'createdAt', 'settings'].includes(key)) return copy(b);
      if (key === 'helpSeen' && typeof a === 'boolean' && typeof b === 'boolean') return a || b;
      if (['sessions', 'cards', 'wallet', 'upgrades'].includes(key) || Array.isArray(a) || Array.isArray(b) ||
          !a || !b || typeof a !== 'object' || typeof b !== 'object') { conflict = true; return copy(b); }
      const result = {};
      new Set(Object.keys(a).concat(Object.keys(b))).forEach(k => { result[k] = walk(a[k], b[k], path.concat(k)); });
      return result;
    }
    Object.assign(out, walk(local, remote, []));
    // A conflict never publishes a partially combined economic or game snapshot.
    return { payload: conflict ? copy(local) : out, conflict };
  }
  class Store {
    constructor(appId, initial) {
      this.appId = appId;
      this.initial = copy(initial);
      this.owner = null;
      this.epoch = 0;
      this.optimisticVersion = 0;
      this.record = fresh(initial);
      this.memory = copy(initial);
      this.persisted = false;
      this.failed = false;
      this.volatile = new Map();
      this.tail = Promise.resolve();
      this.listeners = new Set();
      this.channel = window.BroadcastChannel ? new BroadcastChannel('ray-game-saves-v2') : null;
      if (this.channel) this.channel.onmessage = event => {
        if (event.data === this.key()) this.reload();
      };
      this.ready = this.reload();
    }
    key() { return keyFor(this.owner, this.appId); }
    read() { return copy(this.memory); }
    notify(reason) {
      this.listeners.forEach(fn => fn(reason));
      window.dispatchEvent(new CustomEvent('ray-local-save', { detail: { appId: this.appId, owner: this.owner, persisted: this.persisted, reason } }));
    }
    async reload() {
      if (this.failed) { this.notify('storage_failed'); return; }
      const key = this.key(), epoch = this.epoch;
      try {
        await this.tail;
        const { record } = await transaction(key, fresh(this.initial), record => {
          if (!validate(record.payload, this.appId)) {
            archive(record, record.payload, 'invalid_local');
            record.payload = copy(this.initial); record.blocked = true; record.invalidLocal = true;
          }
        });
        if (epoch !== this.epoch) return;
        if (record.payload.resetGeneration !== this.memory.resetGeneration) {
          window.dispatchEvent(new CustomEvent('ray-save-owner-changing', { detail: { appId: this.appId, reason: 'generation_changed' } }));
        }
        this.record = record; this.memory = copy(record.payload); this.persisted = true;
        this.notify('loaded');
      } catch (_) { if (epoch === this.epoch) { this.persisted = false; this.failed = true; this.notify('storage_failed'); } }
    }
    async setOwner(owner) {
      owner = owner === undefined || owner === null ? null : String(owner);
      if (owner === this.owner) return this.ready;
      // Stop the old run while its writes still belong to the old owner.
      window.dispatchEvent(new CustomEvent('ray-save-owner-changing', { detail: { appId: this.appId } }));
      this.volatile.set(this.key(), { payload: copy(this.memory), failed: this.failed });
      this.owner = owner; this.epoch += 1;
      this.memory = copy(this.initial); this.record = fresh(this.initial); this.persisted = false;
      const retained = this.volatile.get(this.key());
      this.failed = !!(retained && retained.failed);
      if (this.failed) this.memory = copy(retained.payload);
      this.notify('owner_changed');
      this.ready = this.reload();
      return this.ready;
    }
    edit(edit, reason = 'saved') {
      const key = this.key(), epoch = this.epoch;
      const version = this.optimisticVersion;
      const work = async () => {
        const result = await transaction(key, fresh(this.initial), edit);
        if (epoch === this.epoch) {
          if (['pulled', 'resolved', 'imported'].includes(reason) && !equal(this.memory, result.record.payload)) {
            window.dispatchEvent(new CustomEvent('ray-save-owner-changing', { detail: { appId: this.appId, reason } }));
          }
          this.record = result.record;
          if (['resolved', 'imported'].includes(reason)) { this.failed = false; this.volatile.delete(key); }
          if (!this.failed && version === this.optimisticVersion) this.memory = copy(result.record.payload);
          this.persisted = !this.failed;
          this.notify(reason);
        }
        if (this.channel) this.channel.postMessage(key);
        return result.value;
      };
      const result = this.tail.then(work);
      this.tail = result.catch(() => {
        if (epoch === this.epoch) { this.persisted = false; this.failed = true; this.notify('storage_failed'); }
        else if (this.volatile.has(key)) this.volatile.get(key).failed = true;
      });
      return result;
    }
    mutate(reducer, { reset = false } = {}) {
      const generation = this.memory.resetGeneration;
      const preview = copy(this.memory);
      const value = reducer(preview, true);
      this.optimisticVersion += 1;
      this.memory = preview;
      if (this.failed) return { value, done: Promise.reject(new Error('storage_recovery_required')) };
      const done = this.edit(record => {
        if (!reset && record.payload.resetGeneration !== generation) {
          archive(record, preview, 'reset_generation');
          return { ok: false, reason: 'reset_generation_conflict' };
        }
        const candidate = copy(record.payload);
        let result;
        try { result = reducer(candidate, false); }
        catch (_) { archive(record, preview, 'local_revision_conflict'); return { ok: false, reason: 'local_revision_conflict' }; }
        if (reset) archive(record, record.payload, 'before_reset');
        record.payload = candidate;
        record.localRevision += 1; record.dirty = true;
        return result;
      });
      return { value, done };
    }
    replace(payload) {
      if (!validate(payload, this.appId)) return Promise.reject(new Error('invalid_save'));
      return this.edit(record => {
        archive(record, record.payload, 'before_import');
        record.payload = copy(payload); record.localRevision += 1; record.dirty = true;
      }, 'imported');
    }
  }
  window.RaySaveCore = { Store, transaction, copy, equal, id, archive, mergeTyped, validate, upgradeLegacy, keyFor };
})();
