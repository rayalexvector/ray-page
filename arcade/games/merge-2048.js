(function () {
  "use strict";

  const UI = window.RayArcade.UI;
  const Storage = window.RayArcade.Storage;
  window.RayGames = window.RayGames || {};

  const CHAIN = [
    null,
    { emoji: "🐟", name: "小鱼干" },
    { emoji: "🐾", name: "猫爪" },
    { emoji: "😺", name: "Ray Cat" },
    { emoji: "💬", name: "摸鱼智能体" },
    { emoji: "🪽", name: "Hermes" },
    { emoji: "⌘", name: "Codex" },
    { emoji: "🤖", name: "Ray Agent" },
    { emoji: "👑", name: "终极猫神代理人" }
  ];

  function cloneBoard(board) { return board.map((row) => row.slice()); }
  function boardsEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  const safeNumber = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
  const validCell = value => Number.isSafeInteger(value) && value >= 0 && value < CHAIN.length;
  function validProgress(saved) {
    return saved && typeof saved.active === "boolean" && Array.isArray(saved.board) && saved.board.length === 4 &&
      saved.board.every(row => Array.isArray(row) && row.length === 4 && row.every(validCell)) &&
      safeNumber(saved.score) && validCell(saved.bestLevel);
  }

  class Merge2048 {
    constructor(host, services) {
      this.host = host;
      this.services = services;
      this.board = [];
      this.score = 0;
      this.bestLevel = 1;
      this.started = false;
      this.paused = false;
      this.touchStart = null;
      this.dragPointer = null;
      this.celebrated = {};
    }

    mount() {
      this.host.innerHTML = `
        <div class="merge-wrap">
          <div class="merge-score-row">
            <div class="score-box"><span class="score-label">本局分数</span><strong class="score-value" data-score>0</strong></div>
            <div class="score-box"><span class="score-label">最高分</span><strong class="score-value" data-best>0</strong></div>
            <div class="score-box"><span class="score-label">最高合成</span><strong class="score-value" data-level>小鱼干</strong></div>
          </div>
          <div class="merge-board" role="application" aria-label="Ray Cat 合成器 4x4 棋盘"></div>
          <p class="merge-tip">上下左右滑动，给 Ray Cat 升级摸鱼生产力。</p>
        </div>
      `;
      this.boardEl = this.host.querySelector(".merge-board");
      for (let i = 0; i < 16; i += 1) this.boardEl.appendChild(UI.el("div", "tile"));
      UI.bindNoScroll(this.boardEl);
      this.boardEl.tabIndex = 0;
      this.boardEl.addEventListener("pointerdown", (ev) => {
        if (!this.started || this.paused) return;
        ev.preventDefault();
        this.boardEl.focus({ preventScroll: true });
        this.dragPointer = ev.pointerId;
        this.touchStart = { x: ev.clientX, y: ev.clientY };
        this.boardEl.setPointerCapture(ev.pointerId);
      });
      this.boardEl.addEventListener('pointerup', ev => {
        if (ev.pointerId !== this.dragPointer || !this.touchStart) return;
        ev.preventDefault();
        this.handleSwipe(ev.clientX - this.touchStart.x, ev.clientY - this.touchStart.y);
        this.touchStart = null; this.dragPointer = null;
      });
      this.boardEl.addEventListener('pointercancel', () => { this.touchStart = null; this.dragPointer = null; });
      this.boardEl.addEventListener('keydown', ev => {
        const direction = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[ev.key];
        if (!direction || !this.started || this.paused) return;
        ev.preventDefault(); this.move(direction);
      });
      this.updateStatsHud();
    }

    start() {
      const saved = Storage.loadSession("merge2048");
      const archived = Storage.store && Storage.store.record.invalidLocal &&
        Storage.store.record.conflicts.slice().reverse().find(item => item.reason === "invalid_local" &&
          item.payload.buckets && item.payload.buckets.sessions && item.payload.buckets.sessions.merge2048);
      if (saved && !validProgress(saved)) return this.offerRecovery(saved);
      if (!saved && archived) return this.offerRecovery(archived.payload.buckets.sessions.merge2048, archived);
      if (saved && saved.active) {
        this.restoreProgress(saved);
        UI.toast("已恢复上次合成进度");
        return;
      }
      Storage.notePlay("merge2048");
      this.restart();
    }

    restart() {
      if (this.recoveryPending) return;
      Storage.clearSession("merge2048");
      this.clearResult();
      this.score = 0;
      this.bestLevel = 1;
      this.started = true;
      this.paused = false;
      this.board = Array.from({ length: 4 }, () => Array(4).fill(0));
      this.spawn();
      this.spawn();
      this.render();
    }

    pause() { this.paused = true; }
    resume() { this.paused = false; }
    destroy() { this.destroyed = true; this.host.innerHTML = ""; }

    restoreProgress(saved) {
      if (!validProgress(saved)) return this.offerRecovery(saved);
      this.clearResult();
      this.board = saved.board.map((row) => row.slice(0, 4).map((value) => Number(value) || 0));
      this.score = Number(saved.score || 0);
      this.bestLevel = Number(saved.bestLevel || Math.max(1, ...this.board.flat())) || 1;
      this.celebrated = Object.assign({}, saved.celebrated || {});
      this.started = true;
      this.paused = false;
      this.render();
    }

    offerRecovery(saved, archived = null) {
      if (this.recoveryPending) return;
      this.started = false;
      this.recoveryPending = true;
      const original = JSON.parse(JSON.stringify(saved));
      const store = Storage.store;
      const owner = store && store.owner;
      const epoch = store && store.epoch;
      const recover = async (repair, close) => {
        if (this.recovering) return;
        this.recovering = true;
        try {
          if (this.destroyed || !store || store.owner !== owner || store.epoch !== epoch) throw new Error("owner_changed");
          const board = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => {
              const value = original && original.board && original.board[r] && original.board[r][c];
              return repair && validCell(value) ? value : 0;
            }));
          if (!board.flat().some(Boolean)) {
            this.board = board; this.spawn(); this.spawn();
          }
          const restored = { active: true, board, score: repair && safeNumber(original.score) ? original.score : 0,
            bestLevel: Math.max(1, ...board.flat()), celebrated: {} };
          await store.edit(record => {
            if (this.destroyed || store.owner !== owner || store.epoch !== epoch) throw new Error("owner_changed");
            const core = window.RaySaveCore;
            let candidate = core.copy(record.payload);
            if (archived) {
              const copy = record.conflicts.find(item => item.id === archived.id);
              if (!record.invalidLocal || !copy || candidate.buckets.sessions.merge2048) throw new Error("session_changed");
              if (!core.equal(record.payload, store.initial)) throw new Error("other_progress_changed");
              candidate = core.copy(copy.payload);
            } else if (JSON.stringify(candidate.buckets.sessions.merge2048) !== JSON.stringify(original)) throw new Error("session_changed");
            candidate.buckets.sessions.merge2048 = core.copy(restored);
            if (!core.validate(candidate, "arcade")) throw new Error("other_invalid_fields");
            core.archive(record, record.payload, "before_merge_recovery");
            if (record.pending) core.archive(record, record.pending.request.payload, "rejected_request", { request: record.pending.request });
            record.pending = null;
            record.payload = candidate;
            record.localRevision += 1;
            record.dirty = true;
            if (record.invalidLocal) {
              delete record.invalidLocal;
              record.blocked = !!record.remote || record.conflicts.some(item => item.reason === "invalid_remote");
            }
          }, 'saved');
          if (this.destroyed || store.owner !== owner || store.epoch !== epoch) throw new Error("owner_changed");
          Storage.loadSession("merge2048");
          this.recoveryPending = false;
          close();
          this.restoreProgress(restored);
          this.saveProgress();
        } catch (_) {
          UI.toast("无法恢复，原存档已保留。请在存档管理中导出备份。");
        } finally { this.recovering = false; }
      };
      UI.showModal({
        title: "合成进度需要恢复",
        message: "原存档将保留为副本。恢复可用棋盘会将异常格子置空；也可以重新开始。",
        onClose: () => { if (this.recoveryPending) this.services.goHome(); },
        actions: [
          { label: "恢复棋盘", kind: "primary", onClick: close => recover(true, close) },
          { label: "重新开始", kind: "secondary", onClick: close => recover(false, close) },
          { label: "暂不处理", kind: "secondary" }
        ]
      });
    }

    saveProgress() {
      if (!this.started) return;
      Storage.saveSession("merge2048", {
        active: true,
        board: cloneBoard(this.board),
        score: this.score,
        bestLevel: this.bestLevel,
        celebrated: this.celebrated
      });
    }

    clearResult() {
      const node = this.host.querySelector(".result-panel");
      if (node) node.remove();
    }

    onTouchStart(ev) {
      if (ev.touches.length !== 1) return;
      ev.preventDefault();
      this.touchStart = { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    }

    onTouchEnd(ev) {
      ev.preventDefault();
      if (!this.touchStart || !ev.changedTouches[0]) return;
      const dx = ev.changedTouches[0].clientX - this.touchStart.x;
      const dy = ev.changedTouches[0].clientY - this.touchStart.y;
      this.handleSwipe(dx, dy);
      this.touchStart = null;
    }

    handleSwipe(dx, dy) {
      if (!this.started || this.paused) return;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (Math.max(absX, absY) < 24) return;
      let dir;
      if (absX > absY) dir = dx > 0 ? "right" : "left";
      else dir = dy > 0 ? "down" : "up";
      this.move(dir);
    }

    spawn() {
      const empty = [];
      for (let r = 0; r < 4; r += 1) {
        for (let c = 0; c < 4; c += 1) if (!this.board[r][c]) empty.push([r, c]);
      }
      if (!empty.length) return;
      const [r, c] = empty[Math.floor(Math.random() * empty.length)];
      this.board[r][c] = Math.random() < 0.88 ? 1 : 2;
    }

    mergeLine(line) {
      const src = line.filter(Boolean);
      const out = [];
      for (let i = 0; i < src.length; i += 1) {
        if (src[i] && src[i] === src[i + 1]) {
          const next = Math.min(src[i] + 1, CHAIN.length - 1);
          out.push(next);
          this.score += next * next * 8;
          this.bestLevel = Math.max(this.bestLevel, next);
          i += 1;
        } else {
          out.push(src[i]);
        }
      }
      while (out.length < 4) out.push(0);
      return out;
    }

    move(dir) {
      const before = cloneBoard(this.board);
      if (dir === "left" || dir === "right") {
        for (let r = 0; r < 4; r += 1) {
          const line = dir === "left" ? this.board[r].slice() : this.board[r].slice().reverse();
          const merged = this.mergeLine(line);
          this.board[r] = dir === "left" ? merged : merged.reverse();
        }
      } else {
        for (let c = 0; c < 4; c += 1) {
          const line = [];
          for (let r = 0; r < 4; r += 1) line.push(this.board[r][c]);
          if (dir === "down") line.reverse();
          const merged = this.mergeLine(line);
          if (dir === "down") merged.reverse();
          for (let r = 0; r < 4; r += 1) this.board[r][c] = merged[r];
        }
      }
      if (boardsEqual(before, this.board)) {
        UI.vibrate(8);
        return;
      }
      this.spawn();
      this.render();
      UI.beep("tap");
      UI.vibrate(10);
      this.checkMilestones();
      if (!this.canMove()) this.gameOver();
      else this.saveProgress();
    }

    canMove() {
      for (let r = 0; r < 4; r += 1) {
        for (let c = 0; c < 4; c += 1) {
          const v = this.board[r][c];
          if (!v) return true;
          if (this.board[r + 1] && this.board[r + 1][c] === v) return true;
          if (this.board[r][c + 1] === v) return true;
        }
      }
      return false;
    }

    checkMilestones() {
      const stats = Storage.getStats();
      const unlocked = new Set((stats.merge2048 && stats.merge2048.unlocked) || [1]);
      let newUnlock = false;
      this.board.flat().forEach((v) => {
        if (v && !unlocked.has(v)) {
          unlocked.add(v);
          newUnlock = true;
        }
      });
      if (newUnlock) {
        Storage.updateBest('merge2048', { unlocked: Array.from(unlocked).sort((a, b) => a - b) });
      }
      const top = Math.max.apply(null, this.board.flat());
      if (top >= 5 && !this.celebrated.hermes) {
        this.celebrated.hermes = true;
        UI.toast("✨ Hermes 已上线，摸鱼速度 +1");
      }
      if (top >= 7 && !this.celebrated.agent) {
        this.celebrated.agent = true;
        UI.confetti(this.host, 24);
        UI.achievement("merge-agent", "合成 Ray Agent");
        UI.showModal({
          title: "Ray Agent 诞生！",
          html: "<p>这只猫已经会自己安排摸鱼日程了。</p><p>继续合成，也许能摸到猫神代理人。</p>",
          actions: [{ label: "继续合成", kind: "primary" }]
        });
      }
    }

    render() {
      const tiles = Array.from(this.boardEl.children);
      this.board.flat().forEach((v, i) => {
        const tile = tiles[i];
        tile.className = "tile" + (v ? ` filled l${v}` : "");
        if (!v) {
          tile.innerHTML = "";
          return;
        }
        const item = CHAIN[v];
        tile.innerHTML = `<span class="tile-emoji">${item.emoji}</span><span class="tile-name">${item.name}</span>`;
      });
      this.updateStatsHud();
    }

    updateStatsHud() {
      const stats = Storage.getStats().merge2048;
      const best = Math.max(stats.bestScore || 0, this.score || 0);
      const knownLevel = Math.max(stats.bestLevel || 1, this.bestLevel || 1);
      const scoreEl = this.host.querySelector("[data-score]");
      const bestEl = this.host.querySelector("[data-best]");
      const levelEl = this.host.querySelector("[data-level]");
      if (scoreEl) scoreEl.textContent = String(this.score || 0);
      if (bestEl) bestEl.textContent = String(best);
      if (levelEl) levelEl.textContent = CHAIN[knownLevel] ? CHAIN[knownLevel].name : "小鱼干";
    }

    gameOver() {
      this.started = false;
      const top = Math.max.apply(null, this.board.flat());
      const unlocked = [];
      for (let i = 1; i <= top; i += 1) unlocked.push(i);
      Storage.updateBest("merge2048", { bestScore: this.score, bestLevel: top, unlocked });
      Storage.clearSession("merge2048");
      if (top >= 8) UI.achievement("merge-catgod", "终极猫神代理人");
      UI.beep("end");
      UI.vibrate([28, 40, 20]);
      UI.resultOverlay(this.host, {
        title: "棋盘被摸满了",
        message: `分数 ${this.score} · 最高合成：${CHAIN[top] ? CHAIN[top].name : "小鱼干"}`,
        actions: [
          { label: "重新合成", kind: "primary", beep: "ok", onClick: () => this.restart() },
          { label: "返回游戏厅", kind: "secondary", onClick: () => this.services.goHome() }
        ]
      });
    }
  }

  window.RayGames.Merge2048 = Merge2048;
})();
