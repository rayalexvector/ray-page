(function () {
  "use strict";

  const UI = window.RayArcade.UI;
  const Storage = window.RayArcade.Storage;
  window.RayGames = window.RayGames || {};

  const GOOD = [
    { icon: "🐾", label: "猫爪" },
    { icon: "🐟", label: "小鱼干" },
    { icon: "⭐", label: "Ray 星星" },
    { icon: "▣", label: "AI" },
    { icon: "💬", label: "摸鱼" }
  ];
  const BAD = [
    { icon: "👔", label: "老板" },
    { icon: "Bug", label: "Bug", small: true },
    { icon: "404", label: "404", small: true },
    { icon: "🕳️", label: "黑洞" },
    { icon: "⏰", label: "闹钟" }
  ];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  class Reaction {
    constructor(host, services) {
      this.host = host;
      this.services = services;
      this.running = false;
      this.paused = false;
      this.raf = 0;
      this.score = 0;
      this.combo = 0;
      this.bestCombo = 0;
      this.timeLeft = 45;
      this.lastTime = 0;
      this.spawnAcc = 0;
      this.targets = new Map();
      this.nextId = 1;
    }

    mount() {
      this.host.innerHTML = `
        <div class="reaction-wrap">
          <div class="reaction-stats">
            <div class="score-box"><span class="score-label">时间</span><strong class="score-value" data-time>45.0</strong></div>
            <div class="score-box"><span class="score-label">分数</span><strong class="score-value" data-score>0</strong></div>
            <div class="score-box"><span class="score-label">连击</span><strong class="score-value" data-combo>0</strong></div>
          </div>
          <div class="reaction-arena" aria-label="摸鱼反应挑战区域">
            <div class="reaction-ready" data-ready>
              <div>
                <h2>准备摸鱼</h2>
                <p>点猫爪、小鱼干、Ray 星星、AI 芯片和摸鱼气泡。看到老板、Bug、404、黑洞、闹钟就忍住。</p>
                <button class="primary-btn" data-start>开始 45 秒挑战</button>
              </div>
            </div>
          </div>
        </div>
      `;
      this.arena = this.host.querySelector(".reaction-arena");
      UI.bindNoScroll(this.arena);
      this.host.querySelector("[data-start]").addEventListener("click", () => this.beginRound());
    }

    start() {
      Storage.notePlay("reaction");
      this.reset(false);
    }

    restart() {
      this.reset(true);
      this.beginRound();
    }

    reset(hideReady) {
      this.clearResult();
      this.targets.forEach((t) => t.node.remove());
      this.targets.clear();
      this.score = 0;
      this.combo = 0;
      this.bestCombo = 0;
      this.timeLeft = 45;
      this.spawnAcc = 0;
      this.running = false;
      this.paused = false;
      this.lastTime = 0;
      const ready = this.host.querySelector("[data-ready]");
      if (ready) ready.style.display = hideReady ? "none" : "grid";
      this.updateHud();
    }

    beginRound() {
      this.clearResult();
      const ready = this.host.querySelector("[data-ready]");
      if (ready) ready.style.display = "none";
      this.running = true;
      this.paused = false;
      this.lastTime = 0;
      UI.beep("ok");
      UI.vibrate(18);
      this.kick();
    }

    pause() {
      this.paused = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    resume() {
      if (!this.running) return;
      this.paused = false;
      this.lastTime = 0;
      this.kick();
    }

    destroy() {
      this.running = false;
      this.pause();
      this.host.innerHTML = "";
    }

    clearResult() {
      const node = this.host.querySelector(".result-panel");
      if (node) node.remove();
    }

    kick() {
      if (!this.running || this.paused || this.raf) return;
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }

    loop(t) {
      this.raf = 0;
      if (!this.running || this.paused) return;
      if (!this.lastTime) this.lastTime = t;
      const dt = Math.min(0.05, (t - this.lastTime) / 1000);
      this.lastTime = t;
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) return this.endRound();
      const speedFactor = 1 + (45 - this.timeLeft) / 45;
      this.spawnAcc += dt * speedFactor;
      const interval = clamp(0.78 - (45 - this.timeLeft) * 0.007, 0.36, 0.78);
      if (this.spawnAcc >= interval) {
        this.spawnAcc = 0;
        this.spawnTarget();
      }
      this.updateTargets(dt);
      this.updateHud();
      this.kick();
    }

    spawnTarget() {
      const rect = this.arena.getBoundingClientRect();
      const isGood = Math.random() > 0.28;
      const item = isGood ? pick(GOOD) : pick(BAD);
      const size = Math.floor(58 + Math.random() * 16);
      const margin = 42;
      const x = margin + Math.random() * Math.max(1, rect.width - margin * 2);
      const y = margin + Math.random() * Math.max(1, rect.height - margin * 2);
      const node = UI.el("button", `reaction-target${isGood ? "" : " bad"}`);
      node.style.width = `${size}px`;
      node.style.height = `${size}px`;
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.innerHTML = item.small ? `<span class="small-text">${UI.escapeHtml(item.icon)}</span>` : UI.escapeHtml(item.icon);
      const id = this.nextId += 1;
      node.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        this.hit(id);
      });
      this.arena.appendChild(node);
      this.targets.set(id, { id, node, good: isGood, age: 0, ttl: isGood ? 1.18 : 1.05 });
    }

    updateTargets(dt) {
      this.targets.forEach((target, id) => {
        target.age += dt;
        const left = Math.max(0, target.ttl - target.age);
        const scale = 1 + Math.sin(target.age * 8) * 0.035;
        target.node.style.opacity = String(clamp(left / 0.28, 0, 1));
        target.node.style.transform = `translate(-50%, -50%) scale(${scale})`;
        if (target.age >= target.ttl) {
          target.node.remove();
          this.targets.delete(id);
          if (target.good) this.combo = 0;
        }
      });
    }

    hit(id) {
      if (!this.running || this.paused) return;
      const target = this.targets.get(id);
      if (!target) return;
      target.node.classList.add("hit");
      window.setTimeout(() => target.node.remove(), 150);
      this.targets.delete(id);
      if (target.good) {
        this.combo += 1;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        const add = 1 + Math.floor(this.combo / 8);
        this.score += add;
        UI.beep("score");
        UI.vibrate(9);
      } else {
        this.timeLeft = Math.max(0, this.timeLeft - 3);
        this.combo = 0;
        UI.beep("bad");
        UI.vibrate([18, 32, 18]);
        UI.toast("抓包！-3 秒");
      }
      this.updateHud();
    }

    updateHud() {
      const t = this.host.querySelector("[data-time]");
      const s = this.host.querySelector("[data-score]");
      const c = this.host.querySelector("[data-combo]");
      if (t) t.textContent = Math.max(0, this.timeLeft).toFixed(1);
      if (s) s.textContent = String(this.score);
      if (c) c.textContent = String(this.combo);
    }

    titleForScore(score) {
      if (score >= 90) return "Ray 级手速";
      if (score >= 60) return "厕所传说";
      if (score >= 32) return "摸鱼合格";
      return "刚坐下就结束";
    }

    endRound() {
      this.running = false;
      this.pause();
      this.targets.forEach((t) => t.node.remove());
      this.targets.clear();
      const title = this.titleForScore(this.score);
      Storage.updateBest("reaction", { bestScore: this.score, bestCombo: this.bestCombo });
      if (this.score >= 80) UI.achievement("reaction-80", "Ray 级反应力");
      if (this.bestCombo >= 30) UI.achievement("reaction-combo-30", "连续摸鱼 30 连");
      UI.beep("end");
      UI.vibrate([30, 45, 20]);
      UI.resultOverlay(this.host, {
        title,
        message: `分数 ${this.score} · 最高连击 ${this.bestCombo}。老板没看见，Bug 也没追上。`,
        actions: [
          { label: "再摸 45 秒", kind: "primary", beep: "ok", onClick: () => this.restart() },
          { label: "返回游戏厅", kind: "secondary", onClick: () => this.services.goHome() }
        ]
      });
    }
  }

  window.RayGames.Reaction = Reaction;
})();
