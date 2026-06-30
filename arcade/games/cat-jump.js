(function () {
  "use strict";

  const UI = window.RayArcade.UI;
  const Storage = window.RayArcade.Storage;
  window.RayGames = window.RayGames || {};

  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  class CatJump {
    constructor(host, services) {
      this.host = host;
      this.services = services;
      this.canvas = null;
      this.ctx = null;
      this.w = 0;
      this.h = 0;
      this.raf = 0;
      this.running = false;
      this.paused = false;
      this.dead = false;
      this.dragging = false;
      this.targetX = 0;
      this.height = 0;
      this.fishScore = 0;
      this.score = 0;
      this.player = null;
      this.platforms = [];
      this.fishes = [];
      this.resizeObs = null;
    }

    mount() {
      this.host.innerHTML = `
        <canvas class="canvas-game" aria-label="Ray Cat Jump 游戏画面"></canvas>
        <div class="game-hud">
          <span class="hud-pill" data-hud="score">⭐ 0</span>
          <span class="hud-pill" data-hud="height">↟ 0m</span>
        </div>
      `;
      this.canvas = this.host.querySelector("canvas");
      this.ctx = this.canvas.getContext("2d");
      UI.bindNoScroll(this.canvas);
      this.resize();
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(this.host);
      this.canvas.addEventListener("pointerdown", (ev) => this.onPointerDown(ev));
      this.canvas.addEventListener("pointermove", (ev) => this.onPointerMove(ev));
      this.canvas.addEventListener("pointerup", (ev) => this.onPointerUp(ev));
      this.canvas.addEventListener("pointercancel", (ev) => this.onPointerUp(ev));
    }

    start() {
      Storage.notePlay("catJump");
      this.reset();
      this.running = true;
      this.paused = false;
      this.kick();
    }

    restart() {
      this.clearResult();
      this.start();
    }

    pause() {
      this.paused = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    resume() {
      if (!this.running || this.dead) return;
      this.paused = false;
      this.kick();
    }

    destroy() {
      this.running = false;
      this.pause();
      if (this.resizeObs) this.resizeObs.disconnect();
      this.host.innerHTML = "";
    }

    resize() {
      if (!this.canvas) return;
      const fit = UI.fitCanvas(this.canvas);
      this.ctx = fit.ctx;
      this.w = fit.width;
      this.h = fit.height;
      if (!this.player) this.reset();
    }

    clearResult() {
      const node = this.host.querySelector(".result-panel");
      if (node) node.remove();
    }

    reset() {
      const w = this.w || this.host.clientWidth || 390;
      const h = this.h || this.host.clientHeight || 720;
      this.height = 0;
      this.fishScore = 0;
      this.score = 0;
      this.dead = false;
      this.dragging = false;
      this.player = {
        x: w * 0.5,
        y: h * 0.66,
        r: 18,
        vx: 0,
        vy: -10,
        face: 1
      };
      this.targetX = this.player.x;
      this.platforms = [];
      this.fishes = [];
      const baseY = h * 0.78;
      this.platforms.push({ x: w * 0.5 - 58, y: baseY, w: 116, h: 14, type: "normal", vx: 0 });
      for (let y = baseY - 82; y > -h * 0.8; y -= rand(62, 84)) this.addPlatform(y);
      this.draw();
      this.updateHud();
    }

    addPlatform(y) {
      const diff = this.height / 1200;
      const minW = clamp(88 - diff * 11, 56, 88);
      const maxW = clamp(122 - diff * 12, 78, 122);
      const width = rand(minW, maxW);
      const x = rand(10, Math.max(12, this.w - width - 10));
      const roll = Math.random();
      let type = "normal";
      if (this.height > 260 && roll < 0.15) type = "moving";
      if (this.height > 620 && roll >= 0.15 && roll < 0.27) type = "fragile";
      if (roll > 0.91) type = "spring";
      const p = { x, y, w: width, h: 14, type, vx: type === "moving" ? rand(0.55, 1.25) * (Math.random() < .5 ? -1 : 1) : 0, broken: false };
      this.platforms.push(p);
      if (Math.random() < 0.26) {
        this.fishes.push({ x: x + width / 2, y: y - 28, r: 11, taken: false, bob: Math.random() * 6.28 });
      }
    }

    onPointerDown(ev) {
      if (!this.running || this.paused || this.dead) return;
      ev.preventDefault();
      this.dragging = true;
      this.targetX = ev.clientX - this.canvas.getBoundingClientRect().left;
      try { this.canvas.setPointerCapture(ev.pointerId); } catch (err) { /* noop */ }
    }

    onPointerMove(ev) {
      if (!this.dragging) return;
      ev.preventDefault();
      this.targetX = clamp(ev.clientX - this.canvas.getBoundingClientRect().left, 12, this.w - 12);
    }

    onPointerUp(ev) {
      if (!this.dragging) return;
      ev.preventDefault();
      this.dragging = false;
      try { this.canvas.releasePointerCapture(ev.pointerId); } catch (err) { /* noop */ }
    }

    kick() {
      if (!this.running || this.paused || this.raf) return;
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }

    loop() {
      this.raf = 0;
      if (!this.running || this.paused) return;
      this.update();
      this.draw();
      this.kick();
    }

    update() {
      const p = this.player;
      const prevY = p.y;
      const prevX = p.x;
      if (this.dragging) {
        p.x += (this.targetX - p.x) * 0.34;
        p.vx = (p.x - prevX) * 0.58;
      } else {
        p.x += p.vx;
        p.vx *= 0.965;
      }
      p.face = p.vx >= 0 ? 1 : -1;
      p.vy += 0.34;
      p.vy = Math.min(12.5, p.vy);
      p.y += p.vy;

      if (p.x < -p.r) p.x = this.w + p.r;
      if (p.x > this.w + p.r) p.x = -p.r;

      this.platforms.forEach((pl) => {
        if (pl.type === "moving") {
          pl.x += pl.vx;
          if (pl.x < 8 || pl.x + pl.w > this.w - 8) pl.vx *= -1;
        }
      });

      if (p.vy > 0) {
        for (const pl of this.platforms) {
          if (pl.broken) continue;
          const prevBottom = prevY + p.r;
          const bottom = p.y + p.r;
          const withinX = p.x > pl.x - p.r * .7 && p.x < pl.x + pl.w + p.r * .7;
          if (withinX && prevBottom <= pl.y + 4 && bottom >= pl.y && p.y < pl.y + 22) {
            p.y = pl.y - p.r;
            p.vy = pl.type === "spring" ? -15.2 : -10.4;
            if (pl.type === "fragile") pl.broken = true;
            if (pl.type === "moving") p.x += pl.vx * 3;
            UI.beep(pl.type === "spring" ? "win" : "tap");
            UI.vibrate(pl.type === "spring" ? 22 : 8);
            break;
          }
        }
      }

      const line = this.h * 0.42;
      if (p.y < line) {
        const dy = line - p.y;
        p.y = line;
        this.height += dy;
        this.platforms.forEach((pl) => { pl.y += dy; });
        this.fishes.forEach((f) => { f.y += dy; });
      }

      this.fishes.forEach((f) => {
        if (f.taken) return;
        f.bob += 0.08;
        const dx = f.x - p.x;
        const dy = (f.y + Math.sin(f.bob) * 4) - p.y;
        if (dx * dx + dy * dy < (f.r + p.r) * (f.r + p.r)) {
          f.taken = true;
          this.fishScore += 1;
          UI.beep("score");
          UI.vibrate(10);
        }
      });

      this.platforms = this.platforms.filter((pl) => pl.y < this.h + 60 && !((pl.type === "fragile") && pl.broken && pl.y > this.player.y + 40));
      this.fishes = this.fishes.filter((f) => !f.taken && f.y < this.h + 40);
      let top = Math.min.apply(null, this.platforms.map((pl) => pl.y));
      while (top > -60) {
        const gap = clamp(84 - this.height / 80, 58, 84);
        top -= rand(gap - 14, gap + 16);
        this.addPlatform(top);
      }

      this.score = Math.floor(this.height / 9) + this.fishScore * 20;
      this.updateHud();
      if (p.y - p.r > this.h + 14) this.gameOver();
    }

    updateHud() {
      const score = this.host.querySelector('[data-hud="score"]');
      const height = this.host.querySelector('[data-hud="height"]');
      if (score) score.textContent = `⭐ ${this.score}`;
      if (height) height.textContent = `↟ ${Math.floor(this.height / 10)}m`;
    }

    drawBackground(ctx) {
      const w = this.w, h = this.h;
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#080a2a");
      g.addColorStop(.65, "#060719");
      g.addColorStop(1, "#040512");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.globalAlpha = .2;
      ctx.strokeStyle = "#25e4ff";
      ctx.lineWidth = 1;
      for (let y = (this.height * .18) % 44; y < h; y += 44) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let x = 18; x < w; x += 56) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = .8;
      ctx.fillStyle = "#ff4fd8";
      for (let i = 0; i < 14; i += 1) {
        const x = (i * 73 + this.height * .12) % (w + 40) - 20;
        const y = (i * 97 + this.height * .08) % (h + 80) - 40;
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.restore();
    }

    drawPlatform(ctx, pl) {
      ctx.save();
      if (pl.broken) ctx.globalAlpha = .45;
      const fill = pl.type === "spring" ? "#5dffb0" : pl.type === "moving" ? "#25e4ff" : pl.type === "fragile" ? "#ff6b8a" : "#ff4fd8";
      ctx.shadowColor = fill;
      ctx.shadowBlur = 14;
      ctx.fillStyle = fill;
      rr(ctx, pl.x, pl.y, pl.w, pl.h, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,.65)";
      ctx.fillRect(pl.x + 10, pl.y + 3, pl.w - 20, 2);
      if (pl.type === "spring") {
        ctx.font = "16px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("✦", pl.x + pl.w / 2, pl.y - 2);
      }
      ctx.restore();
    }

    drawCat(ctx) {
      const p = this.player;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(p.face, 1);
      ctx.shadowColor = "rgba(37,228,255,.65)";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "#f8fbff";
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-12, -11);
      ctx.lineTo(-18, -26);
      ctx.lineTo(-4, -16);
      ctx.moveTo(12, -11);
      ctx.lineTo(18, -26);
      ctx.lineTo(4, -16);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#07081f";
      ctx.beginPath(); ctx.arc(-7, -2, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(8, -2, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ff4fd8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 5, 6, .2, Math.PI - .2);
      ctx.stroke();
      ctx.fillStyle = "#25e4ff";
      ctx.font = "bold 9px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Ray", 0, 15);
      ctx.restore();
    }

    drawFish(ctx, f) {
      const y = f.y + Math.sin(f.bob) * 4;
      ctx.save();
      ctx.translate(f.x, y);
      ctx.shadowColor = "#ffe66d";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#ffe66d";
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(-17, -7);
      ctx.lineTo(-17, 7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#07081f";
      ctx.beginPath();
      ctx.arc(5, -1, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    draw() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      this.drawBackground(ctx);
      this.platforms.forEach((pl) => this.drawPlatform(ctx, pl));
      this.fishes.forEach((f) => this.drawFish(ctx, f));
      this.drawCat(ctx);
    }

    gameOver() {
      if (this.dead) return;
      this.dead = true;
      this.running = false;
      this.pause();
      const meters = Math.floor(this.height / 10);
      Storage.updateBest("catJump", { bestHeight: meters, bestScore: this.score });
      if (meters >= 100) UI.achievement("catjump-100m", "Ray Cat 跳过 100m");
      if (this.score >= 500) UI.achievement("catjump-500", "小鱼干富翁");
      UI.beep("end");
      UI.vibrate([30, 45, 20]);
      UI.resultOverlay(this.host, {
        title: "Ray Cat 落地啦",
        message: `高度 ${meters}m · 分数 ${this.score} · 小鱼干 ${this.fishScore} 条`,
        actions: [
          { label: "立即再跳", kind: "primary", beep: "ok", onClick: () => this.restart() },
          { label: "返回游戏厅", kind: "secondary", onClick: () => this.services.goHome() }
        ]
      });
    }
  }

  window.RayGames.CatJump = CatJump;
})();
