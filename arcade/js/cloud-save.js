(function () {
  'use strict';
  const DEFAULT_API_ROOT = 'https://api.rayalex.cn';
  const DEVICE_KEY = 'rayGameCloud.deviceId.v2';
  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function removeKey(key) {
    try { localStorage.removeItem(key); } catch (_) { /* noop */ }
  }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function getDeviceId() {
    let id = "";
    try { id = localStorage.getItem(DEVICE_KEY) || ""; } catch (_) { id = ""; }
    if (!id) {
      id = "ray-device-" + randomId();
      try { localStorage.setItem(DEVICE_KEY, id); } catch (_) { /* noop */ }
    }
    return id;
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }

  function checksum(value) {
    const str = stableStringify(value);
    let hash = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }


  const labels = {
    local: '本机存档', anonymous: '游客本机存档', queued: '本机已保存 · 待同步',
    syncing: '本机已保存 · 同步中', synced: '云存档已确认',
    offline: '离线 · 本机已保存', error: '本机已保存 · 云同步失败',
    conflict: '存档冲突 · 副本已保留', upgrade: '云存档暂停 · 等待安全升级',
    storage_error: '未持久化 · 请勿关闭页面', locked: '身份未确认 · 云存档暂停'
  };
  function mergeProgress(local, remote) {
    return clone(remote === undefined || remote === null ? local : remote);
  }
  async function safeController() {
    const sw = navigator.serviceWorker;
    if (!sw || !sw.controller) return true;
    const controller = sw.controller;
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1000);
      channel.port1.onmessage = event => {
        clearTimeout(timer); channel.port1.close();
        resolve(sw.controller === controller && event.data && event.data.rayGameCacheProtocol === 2);
      };
      try { controller.postMessage({ type: 'RAY_GAME_CACHE_PROTOCOL' }, [channel.port2]); }
      catch (_) { clearTimeout(timer); channel.port1.close(); resolve(false); }
    });
  }
  class CloudSaveClient {
    constructor(options) {
      this.appId = options.appId;
      this.store = options.store;
      this.apiRoot = (options.apiRoot || DEFAULT_API_ROOT).replace(/\/$/, '');
      this.onStatus = options.onStatus;
      this.debounceMs = options.debounceMs || 1600;
      this.deviceId = getDeviceId();
      this.epoch = 0;
      this.timer = 0;
      this.attempts = 0;
      this.controllers = new Set();
      this.owner = null;
      this.initialized = false;
      this.inFlight = null;
      this.status = { state: 'local', label: labels.local };
    }
    emit(state, extra) {
      if (!this.store.persisted && state !== 'upgrade' && state !== 'locked') state = 'storage_error';
      this.status = Object.assign({ appId: this.appId, state, label: labels[state] || labels.local }, extra);
      if (this.onStatus) this.onStatus(this.status);
      window.dispatchEvent(new CustomEvent('ray-cloud-save-status', { detail: this.status }));
      if (document.querySelectorAll) document.querySelectorAll('[data-save-status], #saveStatusText').forEach(node => {
        node.setAttribute('role', 'button'); node.setAttribute('tabindex', '0'); node.setAttribute('title', '存档管理');
      });
    }
    start() {
      if (this.started) return;
      this.started = true;
      this.store.listeners.add(reason => {
        if (reason === 'storage_failed') this.emit('storage_error');
        else if (this.store.record.blocked) this.emit('conflict');
        else if (reason === 'loaded' && this.owner) this.schedule();
      });
      window.addEventListener('online', () => this.bootstrap());
      window.addEventListener('focus', () => this.bootstrap());
      window.addEventListener('pagehide', () => this.flush({ urgent: true }));
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.flush({ urgent: true });
        else this.bootstrap();
      });
      const recovery = event => {
        if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
        if (event.target.closest && event.target.closest('[data-save-status], #saveStatusText')) {
          event.preventDefault(); this.openRecovery();
        }
      };
      document.addEventListener('click', recovery);
      document.addEventListener('keydown', recovery);
      window.addEventListener('storage', event => { if (event.key === 'ray-auth-state-v2') this.authChanged(); });
      if (window.BroadcastChannel) {
        this.authChannel = new BroadcastChannel('ray-auth-state-v2');
        this.authChannel.onmessage = () => this.authChanged();
      }
      if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('controllerchange', () => this.bootstrap());
      this.bootstrap();
    }
    authChanged() {
      this.epoch += 1; this.owner = null; this.initialized = false;
      this.controllers.forEach(c => c.abort());
      clearTimeout(this.timer);
      this.store.setOwner(null);
      this.emit('locked');
      return this.bootstrap();
    }
    schedule(delay = this.debounceMs) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), delay);
    }
    markDirty() {
      if (!this.store.persisted) return this.emit('storage_error');
      if (this.store.record.blocked) return this.emit('conflict');
      this.emit(this.owner ? 'queued' : 'anonymous');
      this.schedule();
    }
    async request(path, options = {}) {
      if (!await safeController()) {
        this.emit('upgrade');
        if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
        throw new Error('unsafe_controller');
      }
      if (loadJson('ray-auth-local-lock-v2', false) === true) throw new Error('local_session_locked');
      const controller = new AbortController();
      this.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(this.apiRoot + path, Object.assign({}, options, {
          credentials: 'include', cache: 'no-store', signal: controller.signal,
          headers: Object.assign({ accept: 'application/json' }, options.headers)
        }));
        const data = await response.json();
        return { response, data };
      } finally { clearTimeout(timer); this.controllers.delete(controller); }
    }
    async authenticate(epoch) {
      if (loadJson('ray-auth-local-lock-v2', false) === true) {
        this.owner = null; this.initialized = false;
        await this.store.setOwner(null); this.emit('locked'); return null;
      }
      const { response, data } = await this.request('/v2/auth/me');
      if (epoch !== this.epoch) return null;
      if (response.status === 401 || response.status === 403) {
        if (this.owner) this.epoch += 1;
        this.owner = null; this.initialized = false;
        await this.store.setOwner(null); this.emit('anonymous'); return null;
      }
      if (!response.ok || !data.ok || !data.user || !['string', 'number'].includes(typeof data.user.id)) throw new Error('invalid_auth');
      const owner = String(data.user.id);
      if (this.owner !== owner) {
        this.owner = owner; this.initialized = false;
        await this.store.setOwner(owner);
      }
      return owner;
    }
    async bootstrap() {
      if (this.booting) return this.booting;
      const epoch = this.epoch;
      this.booting = (async () => {
        await this.store.ready;
        if (navigator.onLine === false) return this.emit('offline');
        const owner = await this.authenticate(epoch);
        if (!owner || epoch !== this.epoch) return;
        await this.store.tail;
        // Retry an uncertain immutable request before downloading a newer head.
        if (!this.store.record.pending) {
          if (!await this.pullRemote(epoch, owner)) return;
        } else this.pullAfterAck = true;
        this.initialized = true;
      })().catch(async error => {
        if (epoch !== this.epoch) return;
        if (error.message === 'local_session_locked') {
          this.owner = null; this.initialized = false; await this.store.setOwner(null);
        }
        if (error.message !== 'unsafe_controller') this.emit('locked');
      });
      await this.booting;
      this.booting = null;
      if (epoch === this.epoch && this.initialized) this.flush();
      else if (epoch !== this.epoch) this.schedule(100);
    }
    async pullRemote(epoch, owner, conflictedRequest) {
      const { response, data } = await this.request('/v2/game-saves/' + encodeURIComponent(this.appId) + '?ownerId=' + encodeURIComponent(owner));
      if (epoch !== this.epoch || owner !== this.owner) return false;
      if (response.status === 401 || response.status === 403 || data.error === 'owner_changed') { this.authChanged(); return false; }
      if (!response.ok || !data.ok || data.protocol !== 2 || !Object.hasOwn(data, 'save')) throw new Error('invalid_remote');
      const remote = data.save;
      if (remote !== null && (!Number.isSafeInteger(remote.revision) || remote.revision < 1 ||
          remote.protocol !== 2 || remote.gameId !== this.appId || remote.slot !== 'default' ||
          !remote.payload || remote.schema !== remote.payload.schema)) throw new Error('invalid_remote');
      await this.store.edit(record => {
        if (conflictedRequest && record.pending && record.pending.request.requestId === conflictedRequest) {
          window.RaySaveCore.archive(record, record.pending.request.payload, 'rejected_request', { request: record.pending.request });
          record.pending = null;
        }
        if (record.pending) return;
        if (!remote) {
          if (record.revision !== 0) { record.blocked = true; record.remote = null; return; }
          return;
        }
        const legacy = remote.payload && remote.payload.schema === 1;
        const payload = legacy ? window.RaySaveCore.upgradeLegacy(remote.payload, this.store.initial) : remote.payload;
        if (!window.RaySaveCore.validate(payload, this.appId)) {
          window.RaySaveCore.archive(record, remote.payload, 'invalid_remote', { revision: remote.revision });
          record.blocked = true; return;
        }
        if (legacy) window.RaySaveCore.archive(record, remote.payload, 'migrated_remote_schema1', { revision: remote.revision });
        if (record.invalidLocal) { record.remote = Object.assign({}, clone(remote), { payload: clone(payload) }); return; }
        if (record.revision === remote.revision) return;
        if (!record.dirty) {
          record.payload = clone(payload); record.revision = remote.revision;
          record.localRevision += 1; record.dirty = legacy; return;
        }
        const merged = window.RaySaveCore.mergeTyped(record.payload, payload);
        if (merged.conflict) {
          window.RaySaveCore.archive(record, record.payload, 'local_conflict');
          window.RaySaveCore.archive(record, payload, 'remote_conflict', { revision: remote.revision });
          record.blocked = true; record.remote = Object.assign({}, clone(remote), { payload: clone(payload) });
        } else {
          record.payload = merged.payload; record.revision = remote.revision;
          record.localRevision += 1;
        }
      }, 'pulled');
      if (epoch !== this.epoch || owner !== this.owner) return false;
      this.emit(this.store.record.blocked ? 'conflict' : this.store.record.dirty ? 'queued' : remote ? 'synced' : 'local');
      return !this.store.record.blocked;
    }
    async resolveConflict(choice) {
      if (!['local', 'remote'].includes(choice) || !this.owner) return false;
      const epoch = this.epoch;
      await this.store.edit(record => {
        if (!record.blocked || !record.remote || !window.RaySaveCore.validate(record.remote.payload, this.appId)) throw new Error('unresolved_remote');
        window.RaySaveCore.archive(record, record.payload, 'before_resolution');
        window.RaySaveCore.archive(record, record.remote.payload, 'unchosen_remote', { revision: record.remote.revision });
        if (choice === 'remote') record.payload = clone(record.remote.payload);
        record.revision = record.remote.revision; record.localRevision += 1;
        record.pending = null; record.blocked = false; record.dirty = choice === 'local';
        delete record.invalidLocal;
        delete record.remote;
      }, 'resolved');
      if (epoch !== this.epoch) return false;
      this.initialized = true; this.markDirty(); return this.flush();
    }
    async restorePayload(payload, reason, raw) {
      const epoch = this.epoch;
      if (!window.RaySaveCore.validate(payload, this.appId)) throw new Error('invalid_save');
      const next = clone(payload);
      next.resetGeneration = randomId();
      await this.store.edit(record => {
        window.RaySaveCore.archive(record, record.payload, 'before_restore');
        if (raw) window.RaySaveCore.archive(record, raw, reason);
        if (record.pending) window.RaySaveCore.archive(record, record.pending.request.payload, 'retired_request', { request: record.pending.request });
        if (record.remote) record.revision = record.remote.revision;
        record.payload = next; record.localRevision += 1;
        record.pending = null; record.dirty = true; record.blocked = false;
        delete record.invalidLocal;
        delete record.remote;
      }, 'resolved');
      if (epoch === this.epoch) this.markDirty();
    }
    async recoverLegacy(confirmed) {
      if (confirmed !== true || !this.owner) throw new Error('ownership_confirmation_required');
      const raw = {};
      let legacy;
      if (this.appId === 'starfall') {
        raw['rayStarfall.save.v1'] = localStorage.getItem('rayStarfall.save.v1');
        if (!raw['rayStarfall.save.v1']) throw new Error('no_legacy');
        legacy = { schema: 1, appId: 'starfall', save: JSON.parse(raw['rayStarfall.save.v1']) };
      } else {
        const buckets = {};
        Object.keys(this.store.initial.buckets).forEach(key => {
          const value = localStorage.getItem('rayArcade.' + key);
          if (value !== null) { raw['rayArcade.' + key] = value; buckets[key] = JSON.parse(value); }
        });
        if (!Object.keys(raw).length) throw new Error('no_legacy');
        legacy = { schema: 1, appId: 'arcade', buckets };
      }
      const migrated = window.RaySaveCore.upgradeLegacy(legacy, this.store.initial);
      if (!migrated) throw new Error('invalid_legacy');
      await this.restorePayload(migrated, 'claimed_legacy', raw);
    }
    async importGuest(confirmed) {
      if (confirmed !== true || !this.owner) throw new Error('ownership_confirmation_required');
      const epoch = this.epoch, owner = this.owner;
      const key = window.RaySaveCore.keyFor(null, this.appId);
      const { record } = await window.RaySaveCore.transaction(key,
        { payload: clone(this.store.initial), conflicts: [] }, () => {});
      if (epoch !== this.epoch || owner !== this.owner) throw new Error('owner_changed');
      await this.restorePayload(record.payload, 'imported_guest', record.payload);
    }
    downloadBackup() {
      const blob = new Blob([JSON.stringify({ protocol: 2, appId: this.appId, owner: this.store.owner,
        active: this.store.read(), persisted: this.store.persisted, record: this.store.record }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'ray-' + this.appId + '-backup.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async openRecovery() {
      if (this.dialog && this.dialog.open) return;
      await this.store.tail;
      window.dispatchEvent(new CustomEvent('ray-save-dialog-open', { detail: { appId: this.appId } }));
      const dialog = document.createElement('dialog');
      dialog.className = 'ray-save-dialog';
      this.dialog = dialog;
      const heading = document.createElement('h2'); heading.textContent = '存档管理'; dialog.appendChild(heading);
      const status = document.createElement('p'); status.textContent = this.status.label; status.setAttribute('role', 'status'); dialog.appendChild(status);
      const actions = document.createElement('div'); actions.className = 'ray-save-actions'; dialog.appendChild(actions);
      const button = (label, action, parent = actions) => {
        const node = document.createElement('button'); node.type = 'button'; node.textContent = label; parent.appendChild(node);
        node.addEventListener('click', async () => {
          node.disabled = true;
          try { await action(); }
          catch (_) { status.textContent = '操作未完成，原存档已保留'; }
          finally { node.disabled = false; }
        });
        return node;
      };
      button('导出备份', () => this.downloadBackup());
      if (!this.store.persisted) button('保存当前进度到本机', async () => {
        await this.restorePayload(this.store.read(), 'memory_recovery'); dialog.close();
      });
      button('重新同步', () => this.bootstrap());
      if (this.store.record.blocked && this.store.record.remote) {
        for (const [choice, label] of [['local', '使用本机进度'], ['remote', '使用云端进度']]) {
          button(label, async () => {
            if (!confirm(label + '？未选进度将保留为副本。')) return;
            await this.resolveConflict(choice); dialog.close();
          });
        }
      }
      if (this.owner) {
        button('导入游客进度', async () => {
          if (!confirm('确认游客进度属于你，并恢复到当前账号同步？当前进度将保留为副本。')) return;
          await this.importGuest(true); dialog.close();
        });
        button('恢复未归属旧存档', async () => {
          if (!confirm('确认旧存档属于你，并恢复到当前账号同步？旧原件和当前进度都会保留。')) return;
          await this.recoverLegacy(true); dialog.close();
        });
      }
      const copies = this.store.record.conflicts.slice().reverse();
      if (copies.length) {
        const title = document.createElement('h3'); title.textContent = '保留副本 (' + copies.length + ')'; dialog.appendChild(title);
        const list = document.createElement('div'); list.className = 'ray-save-copies'; dialog.appendChild(list);
        copies.forEach(item => {
          const row = document.createElement('div'); row.className = 'ray-save-copy';
          const names = { local_conflict: '本机冲突', remote_conflict: '云端冲突', reset_generation: '旧重置代次',
            before_reset: '重置前', before_restore: '恢复前', before_resolution: '选择前', local_revision_conflict: '标签页冲突',
            migrated_remote_schema1: '旧云存档', invalid_remote: '异常云存档', claimed_legacy: '旧本机原件' };
          const time = document.createElement('span');
          time.textContent = (names[item.reason] || '保留副本') + ' · ' + new Date(item.savedAt).toLocaleString();
          row.appendChild(time);
          if (window.RaySaveCore.validate(item.payload, this.appId)) button('恢复此副本', async () => {
            if (!confirm('恢复此副本？当前进度会另外保留。')) return;
            await this.restorePayload(item.payload, 'selected_copy'); dialog.close();
          }, row);
          list.appendChild(row);
        });
      }
      button('关闭', () => dialog.close(), dialog);
      dialog.addEventListener('close', () => {
        dialog.remove(); this.dialog = null;
        window.dispatchEvent(new CustomEvent('ray-save-dialog-close', { detail: { appId: this.appId } }));
      }, { once: true });
      const closeOnOwnerChange = () => { if (dialog.open) dialog.close(); };
      window.addEventListener('ray-save-owner-changing', closeOnOwnerChange);
      dialog.addEventListener('close', () => window.removeEventListener('ray-save-owner-changing', closeOnOwnerChange), { once: true });
      document.body.appendChild(dialog); dialog.showModal();
    }
    async flush(options = {}) {
      if (this.inFlight) return this.inFlight;
      clearTimeout(this.timer);
      if (!this.initialized) { await this.bootstrap(); return false; }
      const epoch = this.epoch;
      this.inFlight = this.send(options, epoch).catch(error => {
        if (epoch === this.epoch && error.message === 'local_session_locked') { this.authChanged(); return false; }
        if (epoch === this.epoch && error.message !== 'unsafe_controller') {
          this.emit('error');
          this.schedule(Math.min(60000, 1500 * 2 ** Math.min(++this.attempts, 5)) + Math.random() * 500);
        }
        return false;
      }).finally(() => { this.inFlight = null; });
      return this.inFlight;
    }
    async send(options, epoch) {
      const owner = await this.authenticate(epoch);
      if (!owner || epoch !== this.epoch || !this.initialized) return false;
      await this.store.tail;
      if (epoch !== this.epoch || owner !== this.owner || this.store.owner !== owner) return false;
      if (!this.store.persisted) { this.emit('storage_error'); return false; }
      if (navigator.onLine === false) { this.emit('offline'); return false; }
      const leaseId = randomId();
      const pending = await this.store.edit(record => {
        if (record.blocked) return null;
        if (record.lease && record.lease.expiresAt > Date.now()) return null;
        if (!record.pending && record.dirty) {
          if (!window.RaySaveCore.validate(record.payload, this.appId)) throw new Error('invalid_local');
          record.pending = { localRevision: record.localRevision, request: {
            protocol: 2, schema: 2, ownerId: owner, baseRevision: record.revision,
            requestId: randomId(), deviceId: this.deviceId, payload: clone(record.payload), checksum: checksum(record.payload)
          } };
        }
        if (!record.pending) return null;
        record.lease = { id: leaseId, expiresAt: Date.now() + 30000 };
        return clone(record.pending);
      }, 'queued');
      if (!pending) {
        this.emit(this.store.record.blocked ? 'conflict' : this.store.record.dirty ? 'queued' : this.store.record.revision ? 'synced' : 'local');
        if (this.store.record.dirty && !this.store.record.blocked) this.schedule(3000);
        return !this.store.record.dirty;
      }
      try {
        if (epoch !== this.epoch || owner !== this.owner) return false;
        const body = JSON.stringify(pending.request);
        if (new TextEncoder().encode(JSON.stringify(pending.request.payload)).length > 60 * 1024 ||
            new TextEncoder().encode(body).length > 64 * 1024) {
          this.emit('error', { reason: 'save_too_large' }); return false;
        }
        if (options.urgent && new TextEncoder().encode(body).length >= 60000) return false;
        this.emit('syncing');
        const { response, data } = await this.request('/v2/game-saves/' + encodeURIComponent(this.appId), {
          method: options.urgent ? 'POST' : 'PUT',
          keepalive: !!options.urgent,
          headers: { 'content-type': options.urgent ? 'text/plain;charset=UTF-8' : 'application/json' },
          body
        });
        if (epoch !== this.epoch || owner !== this.owner) return false;
        if (response.status === 401 || response.status === 403 || data.error === 'owner_changed') { this.authChanged(); return false; }
        if (response.status === 409 && data.error === 'revision_conflict') {
          if (await this.pullRemote(epoch, owner, pending.request.requestId)) this.schedule(10);
          return false;
        }
        if (data.error === 'client_upgrade_required') { this.initialized = false; this.emit('upgrade'); return false; }
        if (!response.ok || !data.ok || data.protocol !== 2 || data.gameId !== this.appId || data.slot !== 'default' || data.requestId !== pending.request.requestId ||
            !Number.isSafeInteger(data.revision) || data.revision !== pending.request.baseRevision + 1 ||
            data.checksum !== checksum(pending.request.payload)) throw new Error('invalid_ack');
        await this.store.edit(record => {
          if (!record.pending || record.pending.request.requestId !== data.requestId) return;
          record.revision = Math.max(record.revision, data.revision);
          record.pending = null;
          record.dirty = record.localRevision !== pending.localRevision;
        }, 'acknowledged');
        if (epoch !== this.epoch || owner !== this.owner) return false;
        if (this.pullAfterAck) {
          this.pullAfterAck = false;
          if (!await this.pullRemote(epoch, owner)) return false;
        }
        this.attempts = 0;
        this.emit(this.store.record.dirty ? 'queued' : 'synced');
        if (this.store.record.dirty) this.schedule(10);
        return true;
      } finally {
        // Captured key avoids touching a new owner's queue after authentication changes.
        const key = window.RaySaveCore.keyFor(owner, this.appId);
        await window.RaySaveCore.transaction(key, this.store.record, record => {
          if (record.lease && record.lease.id === leaseId) delete record.lease;
        }).catch(() => {});
      }
    }
  }
  window.RayCloudSave = {
    createClient(options) { return new CloudSaveClient(options); },
    mergeProgress, checksum, getDeviceId, safeController
  };
})();
