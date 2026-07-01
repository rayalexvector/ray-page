(function () {
  "use strict";

  const UI = window.RayArcade.UI;
  const Storage = window.RayArcade.Storage;
  window.RayGames = window.RayGames || {};

  const TAU = Math.PI * 2;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  class RayHop {
    constructor(host, services) {
      this.host = host;
      this.services = services;
      this.canvas = null;
      this.ctx = null;
      this.w = 0;
      this.h = 0;
      this.raf = 0;
      this.resizeObs = null;
      this.running = false;
      this.paused = false;
      this.dead = false;
      this.state = "idle";
      this.last = 0;
      this.time = 0;
      this.score = 0;
      this.combo = 0;
      this.bestCombo = 0;
      this.perfects = 0;
      this.charge = 0;
      this.chargeTime = 0;
      this.jump = null;
      this.current = null;
      this.next = null;
      this.player = null;
      this.particles = [];
      this.floatTexts = [];
      this.stars = [];
    }

    mount() {
      this.host.innerHTML = `
        <canvas class="canvas-game" aria-label="Ray Hop 游戏画面"></canvas>
        <div class="game-hud">
          <span class="hud-pill" data-hud="score">⭐ 0</span>
          <span class="hud-pill" data-hud="combo">中心 0</span>
          <span class="hud-pill" data-hud="hint">按住蓄力</span>
        </div>
      `;
      this.canvas = this.host.querySelector("canvas");
      this.ctx = this.canvas.getContext("2d");
      UI.bindNoScroll(this.canvas);
      this.resize();
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(this.host);
      this.canvas.addEventListener("pointerdown", (ev) => this.onDown(ev));
      this.canvas.addEventListener("pointerup", (ev) => this.onUp(ev));
      this.canvas.addEventListener("pointercancel", (ev) => this.onUp(ev));
      this.canvas.addEventListener("pointerleave", (ev) => this.onUp(ev));
    }

    start() {
      Storage.notePlay("rayHop");
      this.reset();
      this.running = true;
      this.paused = false;
      this.last = performance.now();
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
      this.last = performance.now();
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
      this.makeStars();
      if (!this.player) this.reset();
      else this.draw();
    }

    clearResult() {
      const node = this.host.querySelector(".result-panel");
      if (node) node.remove();
    }

    makeStars() {
      const count = Math.floor((this.w * this.h) / 6800);
      this.stars = Array.from({ length: count }, (_, i) => ({
        x: (i * 67 + Math.random() * this.w) % Math.max(1, this.w),
        y: Math.random() * Math.max(1, this.h),
        r: rand(.55, 1.8),
        speed: rand(6, 18),
        hue: Math.random() < .5 ? "#9ef7ff" : "#ffd0f7",
        tw: Math.random() * TAU
      }));
    }

    reset() {
      const w = this.w || this.host.clientWidth || 390;
      const h = this.h || this.host.clientHeight || 720;
      this.running = false;
      this.dead = false;
      this.state = "idle";
      this.time = 0;
      this.score = 0;
      this.combo = 0;
      this.bestCombo = 0;
      this.perfects = 0;
      this.charge = 0;
      this.chargeTime = 0;
      this.jump = null;
      this.particles = [];
      this.floatTexts = [];
      this.current = { x: w * .34, y: h * .66, size: 66, type: "start", label: "Ray" };
      this.player = { x: this.current.x, y: this.current.y - 36, squash: 0, rot: 0 };
      this.next = this.makeNextPlatform(this.current);
      this.updateHud("按住蓄力");
      this.draw();
    }

    makeNextPlatform(from) {
      const progress = clamp(this.score / 80, 0, 1.4);
      const side = from.x > this.w * .58 ? -1 : from.x < this.w * .42 ? 1 : (Math.random() < .5 ? -1 : 1);
      const dist = rand(118 + progress * 8, 184 + progress * 18);
      const dx = side * dist * rand(.62, .94);
      const dy = -dist * rand(.38, .58);
      const size = clamp(66 - this.score * .55, 42, 66);
      const types = [
        { type: "normal", label: "R" },
        { type: "normal", label: "AI" },
        { type: "fish", label: "鱼" },
        { type: "mimo", label: "Mi" },
        { type: "tiny", label: "!" }
      ];
      let pick = types[Math.floor(Math.random() * (this.score < 5 ? 2 : types.length))];
      if (pick.type === "tiny" && Math.random() < .55) pick = types[0];
      const padSize = pick.type === "tiny" ? size * .76 : size;
      let x = from.x + dx;
      let y = from.y + dy;
      if (x < 58 || x > this.w - 58) x = from.x - dx * .86;
      if (y < 118) y = from.y + Math.abs(dy) * .72;
      return {
        x: clamp(x, 54, this.w - 54),
        y: clamp(y, 122, this.h - 150),
        size: padSize,
        type: pick.type,
        label: pick.label,
        pulse: Math.random() * TAU
      };
    }

    onDown(ev) {
      if (!this.running || this.paused || this.dead || this.state !== "idle") return;
      ev.preventDefault();
      this.state = "charging";
      this.charge = 0;
      this.chargeTime = 0;
      this.player.squash = 0;
      UI.beep("tap");
      try { this.canvas.setPointerCapture(ev.pointerId); } catch (err) { /* noop */ }
      this.updateHud("松手起跳");
    }

    onUp(ev) {
      if (this.state !== "charging") return;
      ev.preventDefault();
      try { this.canvas.releasePointerCapture(ev.pointerId); } catch (err) { /* noop */ }
      this.launch();
    }

    launch() {
      const dx = this.next.x - this.current.x;
      const dy = this.next.y - this.current.y;
      const d = Math.hypot(dx, dy) || 1;
      const maxDistance = 238;
      const travel = clamp(34 + this.charge * maxDistance, 42, maxDistance + 28);
      const endX = this.current.x + dx / d * travel;
      const endY = this.current.y + dy / d * travel;
      this.jump = {
        t: 0,
        dur: clamp(.46 + d / 620, .46, .74),
        sx: this.player.x,
        sy: this.player.y,
        ex: endX,
        ey: endY - 36,
        padX: endX,
        padY: endY,
        arc: clamp(68 + d * .28, 74, 138)
      };
      this.state = "jumping";
      this.player.squash = 0;
      UI.beep("ok");
      UI.vibrate(16);
      this.updateHud("空中");
    }

    kick() {
      if (!this.running || this.paused || this.raf) return;
      this.raf = requestAnimationFrame((now) => this.loop(now));
    }

    loop(now) {
      this.raf = 0;
      if (!this.running || this.paused) return;
      const dt = Math.min(.034, Math.max(.001, (now - (this.last || now)) / 1000));
      this.last = now;
      this.update(dt);
      this.draw();
      this.kick();
    }

    update(dt) {
      this.time += dt;
      for (const s of this.stars) {
        s.y += s.speed * dt;
        s.tw += dt * 1.4;
        if (s.y > this.h + 5) { s.y = -5; s.x = Math.random() * this.w; }
      }
      if (this.state === "charging") {
        this.chargeTime += dt;
        this.charge = clamp(this.charge + dt * .82, 0, 1.08);
        this.player.squash = clamp(this.charge * .34, 0, .32);
        if (this.charge >= 1.08) this.updateHud("过载");
      } else if (this.state === "jumping" && this.jump) {
        this.updateJump(dt);
      }
      this.updateParticles(dt);
      this.updateTexts(dt);
    }

    updateJump(dt) {
      const j = this.jump;
      j.t += dt / j.dur;
      const t = clamp(j.t, 0, 1);
      const ease = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.player.x = lerp(j.sx, j.ex, ease);
      this.player.y = lerp(j.sy, j.ey, ease) - Math.sin(t * Math.PI) * j.arc;
      this.player.rot = lerp(0, TAU, t);
      if (j.t >= 1) this.settleJump(j.padX, j.padY);
    }

    settleJump(x, y) {
      const dx = x - this.next.x;
      const dy = y - this.next.y;
      const off = Math.hypot(dx, dy);
      const hitRadius = this.next.size * (this.next.type === "tiny" ? .54 : .62);
      if (off <= hitRadius) {
        const perfect = off <= Math.max(12, this.next.size * .18);
        this.landSuccess(perfect, off);
      } else {
        this.player.x = x;
        this.player.y = y - 36;
        this.gameOver();
      }
    }

    landSuccess(perfect) {
      let gained = 1;
      let label = "+1";
      if (perfect) {
        this.combo += 1;
        this.perfects += 1;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        gained += this.combo * 2;
        label = `中心 +${this.combo * 2}`;
      } else {
        this.combo = 0;
      }
      if (this.next.type === "fish") { gained += 5; label += " 鱼+5"; }
      if (this.next.type === "mimo") { gained += 8; label += " MiMo+8"; }
      if (this.next.type === "tiny") { gained += 3; label += " 窄台+3"; }
      this.score += gained;
      this.addText(this.next.x, this.next.y - 58, label, perfect ? "#5dffb0" : "#25e4ff");
      this.burst(this.next.x, this.next.y - 8, perfect ? "#5dffb0" : "#25e4ff", perfect ? 28 : 14);
      UI.beep(perfect ? "score" : "tap");
      UI.vibrate(perfect ? [16, 24, 16] : 10);

      this.current = Object.assign({}, this.next);
      this.player.x = this.current.x;
      this.player.y = this.current.y - 36;
      this.player.rot = 0;
      this.recenterScene();
      this.next = this.makeNextPlatform(this.current);
      this.state = "idle";
      this.jump = null;
      this.charge = 0;
      this.player.squash = 0;
      this.updateHud("按住蓄力");
    }

    recenterScene() {
      const anchor = { x: this.w * .35, y: this.h * .66 };
      const dx = anchor.x - this.current.x;
      const dy = anchor.y - this.current.y;
      this.current.x += dx;
      this.current.y += dy;
      this.player.x += dx;
      this.player.y += dy;
      for (const p of this.particles) { p.x += dx; p.y += dy; }
      for (const t of this.floatTexts) { t.x += dx; t.y += dy; }
    }

    updateHud(hint) {
      const score = this.host.querySelector('[data-hud="score"]');
      const combo = this.host.querySelector('[data-hud="combo"]');
      const hintNode = this.host.querySelector('[data-hud="hint"]');
      if (score) score.textContent = `⭐ ${this.score}`;
      if (combo) combo.textContent = `中心 ${this.combo}`;
      if (hintNode && hint) hintNode.textContent = hint;
    }

    updateParticles(dt) {
      for (const p of this.particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        p.vx *= 1 - dt * 2;
        p.vy *= 1 - dt * 2;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
    }

    updateTexts(dt) {
      for (const t of this.floatTexts) {
        t.y -= dt * 42;
        t.life -= dt;
      }
      this.floatTexts = this.floatTexts.filter((t) => t.life > 0);
    }

    burst(x, y, color, count) {
      for (let i = 0; i < count; i += 1) {
        const a = Math.random() * TAU;
        const s = rand(40, 190);
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(1.4, 4.2), color, life: rand(.28, .72), ttl: .72 });
      }
    }

    addText(x, y, text, color) {
      this.floatTexts.push({ x, y, text, color, life: .9, ttl: .9 });
    }

    draw() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      this.drawBackground(ctx);
      this.drawGuide(ctx);
      this.drawPlatform(ctx, this.current, true);
      this.drawPlatform(ctx, this.next, false);
      this.drawPlayer(ctx);
      this.drawParticles(ctx);
      this.drawTexts(ctx);
      this.drawCharge(ctx);
    }

    drawBackground(ctx) {
      const w = this.w;
      const h = this.h;
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#070829");
      g.addColorStop(.46, "#101343");
      g.addColorStop(1, "#050611");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const n1 = ctx.createRadialGradient(w * .78, h * .12, 0, w * .78, h * .12, w * .72);
      n1.addColorStop(0, "rgba(255,79,216,.24)");
      n1.addColorStop(1, "rgba(255,79,216,0)");
      ctx.fillStyle = n1;
      ctx.fillRect(0, 0, w, h);
      const n2 = ctx.createRadialGradient(w * .2, h * .46, 0, w * .2, h * .46, w * .7);
      n2.addColorStop(0, "rgba(37,228,255,.22)");
      n2.addColorStop(1, "rgba(37,228,255,0)");
      ctx.fillStyle = n2;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = .16;
      ctx.strokeStyle = "#25e4ff";
      for (let y = (this.time * 18) % 44; y < h; y += 44) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();
      for (const s of this.stars) {
        ctx.globalAlpha = .22 + Math.sin(s.tw) * .15;
        ctx.fillStyle = s.hue;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    drawGuide(ctx) {
      if (!this.current || !this.next) return;
      ctx.save();
      ctx.globalAlpha = this.state === "idle" || this.state === "charging" ? .42 : .14;
      ctx.strokeStyle = "#bff8ff";
      ctx.setLineDash([6, 9]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.current.x, this.current.y - 10);
      ctx.lineTo(this.next.x, this.next.y - 10);
      ctx.stroke();
      ctx.restore();
    }

    drawPlatform(ctx, p, active) {
      const sx = p.size * .86;
      const sy = p.size * .42;
      const depth = p.size * .22;
      const colors = {
        start: ["#25e4ff", "#244b92", "#071a38"],
        normal: ["#62eaff", "#624bff", "#11164a"],
        fish: ["#5dffb0", "#148f85", "#072b35"],
        mimo: ["#8ee7ff", "#6f5dff", "#11124d"],
        tiny: ["#ff77d9", "#9b32ff", "#25104a"]
      }[p.type] || ["#62eaff", "#624bff", "#11164a"];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.shadowBlur = active ? 28 : 18;
      ctx.shadowColor = colors[0];
      ctx.fillStyle = "rgba(0,0,0,.25)";
      ctx.beginPath();
      ctx.ellipse(0, depth + 12, sx * .9, sy * .56, 0, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = colors[2];
      ctx.beginPath();
      ctx.moveTo(-sx, 0);
      ctx.lineTo(0, sy + depth);
      ctx.lineTo(sx, 0);
      ctx.lineTo(0, sy);
      ctx.closePath();
      ctx.fill();
      const top = ctx.createLinearGradient(-sx, -sy, sx, sy);
      top.addColorStop(0, colors[0]);
      top.addColorStop(.55, colors[1]);
      top.addColorStop(1, "#ff4fd8");
      ctx.fillStyle = top;
      ctx.beginPath();
      ctx.moveTo(0, -sy);
      ctx.lineTo(sx, 0);
      ctx.lineTo(0, sy);
      ctx.lineTo(-sx, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.62)";
      ctx.lineWidth = active ? 2 : 1.4;
      ctx.stroke();
      ctx.fillStyle = "rgba(5,6,17,.62)";
      ctx.font = `900 ${Math.max(12, p.size * .24)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.label, 0, 1);
      if (p.type !== "normal" && p.type !== "start") {
        ctx.strokeStyle = p.type === "tiny" ? "#ffe66d" : "#d8fff4";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(9, p.size * .24 + Math.sin(this.time * 6 + p.pulse) * 2), 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawPlayer(ctx) {
      if (!this.player) return;
      const p = this.player;
      const squash = p.squash || 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot || 0);
      ctx.scale(1 + squash * .36, 1 - squash);
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#25e4ff";
      const body = ctx.createRadialGradient(-5, -8, 2, 0, 0, 24);
      body.addColorStop(0, "#ffffff");
      body.addColorStop(.52, "#bff8ff");
      body.addColorStop(1, "#8b5cf6");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(0, 0, 21, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ff4fd8";
      ctx.beginPath();
      ctx.moveTo(-13, -12);
      ctx.lineTo(-23, -29);
      ctx.lineTo(-5, -19);
      ctx.moveTo(13, -12);
      ctx.lineTo(23, -29);
      ctx.lineTo(5, -19);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#050615";
      ctx.beginPath();
      ctx.arc(-7, -3, 2.6, 0, TAU);
      ctx.arc(7, -3, 2.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#050615";
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.arc(0, 4, 5, .15, Math.PI - .15);
      ctx.stroke();
      ctx.fillStyle = "#25e4ff";
      ctx.font = "900 8px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Ray", 0, 15);
      ctx.restore();
    }

    drawCharge(ctx) {
      if (this.state !== "charging") return;
      const x = 24;
      const y = this.h - 72;
      const w = this.w - 48;
      const h = 14;
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,.08)";
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w, h, 999) : ctx.rect(x, y, w, h);
      ctx.fill();
      const grad = ctx.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, "#25e4ff");
      grad.addColorStop(.72, "#5dffb0");
      grad.addColorStop(1, "#ff6b8a");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, w * clamp(this.charge, 0, 1), h, 999) : ctx.rect(x, y, w * clamp(this.charge, 0, 1), h);
      ctx.fill();
      ctx.fillStyle = "rgba(248,251,255,.84)";
      ctx.font = "900 11px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("蓄力", this.w / 2, y - 10);
      ctx.restore();
    }

    drawParticles(ctx) {
      ctx.save();
      for (const p of this.particles) {
        const a = clamp(p.life / p.ttl, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (.5 + a), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    drawTexts(ctx) {
      ctx.save();
      ctx.font = "900 14px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const t of this.floatTexts) {
        ctx.globalAlpha = clamp(t.life / t.ttl, 0, 1);
        ctx.fillStyle = t.color;
        ctx.shadowBlur = 14;
        ctx.shadowColor = t.color;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    gameOver() {
      if (this.dead) return;
      this.dead = true;
      this.running = false;
      this.state = "dead";
      this.pause();
      Storage.updateBest("rayHop", { bestScore: this.score, bestCombo: this.bestCombo });
      if (this.score >= 60) UI.achievement("rayhop-60", "Ray Hop 破 60 分");
      if (this.bestCombo >= 5) UI.achievement("rayhop-perfect5", "连续中心 5 连");
      UI.beep("end");
      UI.vibrate([28, 44, 22]);
      UI.resultOverlay(this.host, {
        title: "Ray Cat 掉下星台",
        message: `分数 ${this.score} · 最佳中心连击 ${this.bestCombo} · 中心命中 ${this.perfects} 次`,
        actions: [
          { label: "再跳一局", kind: "primary", beep: "ok", onClick: () => this.restart() },
          { label: "返回游戏厅", kind: "secondary", onClick: () => this.services.goHome() }
        ]
      });
    }
  }

  window.RayGames.RayHop = RayHop;
})();
