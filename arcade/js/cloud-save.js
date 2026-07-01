(function () {
  "use strict";

  const DEFAULT_API_ROOT = "https://api.rayalex.cn";
  const DEVICE_KEY = "rayGameCloud.deviceId.v1";
  const META_PREFIX = "rayGameCloud.meta.";
  const PENDING_PREFIX = "rayGameCloud.pending.";
  const DISABLED_PREFIX = "rayGameCloud.disabledUntil.";
  const DISABLED_MS = 60 * 60 * 1000;

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

  function statusLabel(state) {
    const labels = {
      local: "💾 本机存档",
      anonymous: "💾 本机存档 · 登录后云同步",
      queued: "☁️ 待同步",
      syncing: "☁️ 正在同步",
      synced: "✅ 已自动云存档",
      offline: "📴 离线，本机已保存",
      error: "⚠️ 云同步稍后重试"
    };
    return labels[state] || labels.local;
  }

  function mergeProgress(localValue, remoteValue) {
    if (remoteValue === undefined || remoteValue === null) return clone(localValue);
    if (localValue === undefined || localValue === null) return clone(remoteValue);
    if (typeof localValue === "number" && typeof remoteValue === "number") return Math.max(localValue, remoteValue);
    if (Array.isArray(localValue) || Array.isArray(remoteValue)) {
      const out = [];
      [].concat(localValue || [], remoteValue || []).forEach((item) => {
        const key = typeof item === "object" ? stableStringify(item) : String(item);
        if (!out.some((existing) => (typeof existing === "object" ? stableStringify(existing) : String(existing)) === key)) out.push(clone(item));
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

  class CloudSaveClient {
    constructor(options) {
      this.appId = options.appId;
      this.apiRoot = (options.apiRoot || DEFAULT_API_ROOT).replace(/\/$/, "");
      this.exportSave = options.exportSave;
      this.importSave = options.importSave;
      this.mergeSave = options.mergeSave;
      this.onStatus = options.onStatus;
      this.debounceMs = options.debounceMs || 1800;
      this.deviceId = getDeviceId();
      this.timer = 0;
      this.started = false;
      this.status = { state: "local", label: statusLabel("local") };
      this.pendingKey = PENDING_PREFIX + this.appId;
      this.metaKey = META_PREFIX + this.appId;
      this.disabledKey = DISABLED_PREFIX + this.appId;
    }

    start() {
      if (this.started) return;
      this.started = true;
      this.emit(loadJson(this.pendingKey, null) ? "queued" : "local");
      window.addEventListener("online", () => this.flush({ reason: "online" }));
      window.addEventListener("pagehide", () => this.flush({ urgent: true, reason: "pagehide" }));
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.flush({ urgent: true, reason: "hidden" });
      });
      window.setTimeout(() => this.bootstrap(), 280);
    }

    emit(state, extra) {
      this.status = Object.assign({ appId: this.appId, state, label: statusLabel(state), updatedAt: Date.now() }, extra || {});
      try { window.dispatchEvent(new CustomEvent("ray-cloud-save-status", { detail: this.status })); } catch (_) { /* noop */ }
      if (typeof this.onStatus === "function") this.onStatus(this.status);
    }

    isDisabled() {
      const until = Number(loadJson(this.disabledKey, 0) || 0);
      return until && Date.now() < until;
    }

    disableTemporarily() {
      saveJson(this.disabledKey, Date.now() + DISABLED_MS);
      this.emit("local", { reason: "cloud_endpoint_unavailable" });
    }

    makePending(reason) {
      const payload = this.exportSave ? this.exportSave() : {};
      const meta = loadJson(this.metaKey, {}) || {};
      return {
        schema: 1,
        appId: this.appId,
        deviceId: this.deviceId,
        revision: Number(meta.revision || 0) + 1,
        updatedAt: Date.now(),
        reason: reason || "save",
        checksum: checksum(payload),
        payload
      };
    }

    markDirty(reason) {
      if (!this.exportSave) return;
      const pending = this.makePending(reason);
      saveJson(this.pendingKey, pending);
      if (navigator.onLine === false) {
        this.emit("offline");
        return;
      }
      this.emit("queued");
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.flush({ reason: reason || "debounced" }), this.debounceMs);
    }

    async authState() {
      try {
        const response = await fetch(this.apiRoot + "/auth/me", {
          method: "GET",
          credentials: "include",
          headers: { "accept": "application/json" }
        });
        const data = await response.json().catch(() => ({}));
        const user = response.ok && data && data.ok && data.user ? data.user : null;
        this.lastAuth = { signedIn: !!user, user, checkedAt: Date.now() };
        return { signedIn: !!user, user, raw: data, status: response.status };
      } catch (error) {
        this.lastAuth = { signedIn: false, user: null, checkedAt: Date.now(), error: String(error && error.message || error) };
        return { signedIn: false, user: null, error };
      }
    }

    async bootstrap() {
      if (this.isDisabled()) return;
      if (navigator.onLine === false) return this.emit("offline");
      const auth = await this.authState();
      if (!auth.signedIn) return this.emit("anonymous");
      await this.pullRemote();
      if (loadJson(this.pendingKey, null)) await this.flush({ reason: "bootstrap" });
      else if (this.status.state !== "synced") this.emit("synced", { user: auth.user });
    }

    async pullRemote() {
      if (!this.importSave) return false;
      try {
        const response = await fetch(this.apiRoot + "/game-saves/" + encodeURIComponent(this.appId), {
          method: "GET",
          credentials: "include",
          headers: { "accept": "application/json" }
        });
        if (response.status === 401 || response.status === 403) {
          this.emit("anonymous");
          return false;
        }
        if (response.status === 404) {
          this.disableTemporarily();
          return false;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) return false;
        const remotePayload = data.save && data.save.payload;
        if (remotePayload) {
          const localPayload = this.exportSave ? this.exportSave() : {};
          const merged = this.mergeSave ? this.mergeSave(localPayload, remotePayload) : mergeProgress(localPayload, remotePayload);
          this.importSave(merged, { source: "cloud", remote: data.save });
          const meta = loadJson(this.metaKey, {}) || {};
          saveJson(this.metaKey, Object.assign({}, meta, {
            revision: Number(data.save.revision || meta.revision || 0),
            remoteUpdatedAt: Number(data.save.updatedAt || data.save.updated_at || Date.now()),
            remoteChecksum: data.save.checksum || checksum(remotePayload)
          }));
          this.markDirty("merge-cloud");
        } else if (this.exportSave) {
          this.markDirty("first-cloud-copy");
        }
        return true;
      } catch (error) {
        this.emit("error", { error: String(error && error.message || error) });
        return false;
      }
    }

    async flushUrgent(pending) {
      const body = JSON.stringify(pending);
      if (body.length >= 60000) return false;
      try {
        const response = await fetch(this.apiRoot + "/game-saves/" + encodeURIComponent(this.appId), {
          method: "POST",
          credentials: "include",
          keepalive: true,
          headers: { "content-type": "text/plain;charset=UTF-8", "accept": "application/json" },
          body
        });
        if (response.status === 404) {
          this.disableTemporarily();
          return false;
        }
        if (response.status === 401 || response.status === 403) {
          this.emit("anonymous");
          return false;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) return false;
        const meta = loadJson(this.metaKey, {}) || {};
        saveJson(this.metaKey, Object.assign({}, meta, {
          revision: Number(data.revision || pending.revision),
          remoteUpdatedAt: Number(data.updatedAt || data.updated_at || Date.now()),
          remoteChecksum: data.checksum || pending.checksum,
          lastSyncedAt: Date.now()
        }));
        removeKey(this.pendingKey);
        this.emit("synced", { revision: Number(data.revision || pending.revision) });
        return true;
      } catch (_) {
        return false;
      }
    }

    async flush(options) {
      options = options || {};
      window.clearTimeout(this.timer);
      this.timer = 0;
      if (this.isDisabled()) return false;
      let pending = loadJson(this.pendingKey, null);
      if (!pending && this.exportSave && options.force) {
        pending = this.makePending(options.reason || "force");
        saveJson(this.pendingKey, pending);
      }
      if (!pending) return true;
      if (navigator.onLine === false) {
        this.emit("offline");
        return false;
      }
      if (options.urgent) return this.flushUrgent(pending);
      const auth = await this.authState();
      if (!auth.signedIn) {
        this.emit("anonymous");
        return false;
      }
      this.emit("syncing", { user: auth.user });
      const body = JSON.stringify(pending);
      try {
        const response = await fetch(this.apiRoot + "/game-saves/" + encodeURIComponent(this.appId), {
          method: "PUT",
          credentials: "include",
          keepalive: !!options.urgent && body.length < 60000,
          headers: { "content-type": "application/json", "accept": "application/json" },
          body
        });
        if (response.status === 401 || response.status === 403) {
          this.emit("anonymous");
          return false;
        }
        if (response.status === 404) {
          this.disableTemporarily();
          return false;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || "save_failed");
        const meta = loadJson(this.metaKey, {}) || {};
        saveJson(this.metaKey, Object.assign({}, meta, {
          revision: Number(data.revision || pending.revision),
          remoteUpdatedAt: Number(data.updatedAt || data.updated_at || Date.now()),
          remoteChecksum: data.checksum || pending.checksum,
          lastSyncedAt: Date.now()
        }));
        removeKey(this.pendingKey);
        this.emit("synced", { user: auth.user, revision: Number(data.revision || pending.revision) });
        return true;
      } catch (error) {
        this.emit("error", { error: String(error && error.message || error) });
        return false;
      }
    }
  }

  window.RayCloudSave = {
    createClient(options) { return new CloudSaveClient(options || {}); },
    mergeProgress,
    checksum,
    getDeviceId
  };
})();
