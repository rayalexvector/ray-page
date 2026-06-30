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
      this.boardEl.addEventListener("touchstart", (ev) => this.onTouchStart(ev), { passive: false });
      this.boardEl.addEventListener("touchmove", (ev) => ev.preventDefault(), { passive: false });
      this.boardEl.addEventListener("touchend", (ev) => this.onTouchEnd(ev), { passive: false });
      this.boardEl.addEventListener("pointerdown", (ev) => {
        if (ev.pointerType === "mouse") return;
        this.touchStart = { x: ev.clientX, y: ev.clientY };
      });
      this.updateStatsHud();
    }

    start() {
      Storage.notePlay("merge2048");
      this.restart();
    }

    restart() {
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
    destroy() { this.host.innerHTML = ""; }

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
        stats.merge2048.unlocked = Array.from(unlocked).sort((a, b) => a - b);
        Storage.saveStats(stats);
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
