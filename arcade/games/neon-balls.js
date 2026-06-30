(function () {
  "use strict";

  const UI = window.RayArcade.UI;
  const Storage = window.RayArcade.Storage;
  window.RayGames = window.RayGames || {};

  const COLS = 7;
  const TOP = 58;
  const GAP = 5;

  function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function dist2(ax, ay, bx, by) { const dx = ax - bx; const dy = ay - by; return dx * dx + dy * dy; }

  class NeonBalls {
    constructor(host, services) {
      this.host = host;
      this.services = services;
      this.canvas = null;
      this.ctx = null;
      this.w = 0;
      this.h = 0;
      this.raf = 0;
      this.resizeObs = null;
      this.paused = false;
      this.running = false;
      this.dead = false;
      this.aiming = false;
      this.aim = { x: 0, y: 0, dx: 0, dy: -1 };
      this.baseX = 0;
      this.baseY = 0;
      this.round = 1;
      this.score = 0;
      this.ballCount = 1;
      this.blocks = [];
      this.items = [];
      this.balls = [];
      this.shooting = false;
      this.launchDir = { x: 0, y: -1 };
      this.launchTick = 0;
      this.launched = 0;
      this.pendingAdds = 0;
      this.nextPower = null;
      this.activePower = null;
      this.firstLanding = null;
    }

    mount() {
      this.host.innerHTML = `
        <canvas class="canvas-game" aria-label="霓虹弹珠游戏画面"></canvas>
        <div class="game-hud">
          <span class="hud-pill" data-hud="round">回合 1</span>
          <span class="hud-pill" data-hud="balls">球 ×1</span>
          <span class="hud-pill" data-hud="score">⭐ 0</span>
        </div>
      `;
      this.canvas = this.host.querySelector("canvas");
      UI.bindNoScroll(this.canvas);
      this.resize();
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(this.host);
      this.canvas.addEventListener("pointerdown", (ev) => this.onDown(ev));
      this.canvas.addEventListener("pointermove", (ev) => this.onMove(ev));
      this.canvas.addEventListener("pointerup", (ev) => this.onUp(ev));
      this.canvas.addEventListener("pointercancel", (ev) => this.onUp(ev));
    }

    start() {
      Storage.notePlay("neonBalls");
      this.restart();
    }

    restart() {
      this.clearResult();
      this.round = 1;
      this.score = 0;
      this.ballCount = 1;
      this.blocks = [];
      this.items = [];
      this.balls = [];
      this.pendingAdds = 0;
      this.nextPower = null;
      this.activePower = null;
      this.shooting = false;
      this.dead = false;
      this.running = true;
      this.paused = false;
      this.baseX = this.w * 0.5;
      this.baseY = this.h - 34;
      this.addRow();
      this.updateHud();
      this.kick();
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

    clearResult() {
      const node = this.host.querySelector(".result-panel");
      if (node) node.remove();
    }

    resize() {
      if (!this.canvas) return;
      const fit = UI.fitCanvas(this.canvas);
      this.ctx = fit.ctx;
      this.w = fit.width;
      this.h = fit.height;
      this.baseY = this.h - 34;
      if (!this.baseX) this.baseX = this.w * 0.5;
      this.baseX = clamp(this.baseX, 22, this.w - 22);
      this.draw();
    }

    cellW() {
      return (this.w - 20 - GAP * (COLS - 1)) / COLS;
    }

    cellH() { return 42; }
    rowY(row) { return TOP + row * (this.cellH() + GAP); }
    colX(col) { return 10 + col * (this.cellW() + GAP); }
    bottomLimit() { return this.h - 84; }

    onDown(ev) {
      if (!this.running || this.paused || this.dead || this.shooting) return;
      ev.preventDefault();
      this.aiming = true;
      try { this.canvas.setPointerCapture(ev.pointerId); } catch (err) { /* noop */ }
      this.setAim(ev);
    }

    onMove(ev) {
      if (!this.aiming) return;
      ev.preventDefault();
      this.setAim(ev);
    }

    onUp(ev) {
      if (!this.aiming) return;
      ev.preventDefault();
      this.aiming = false;
      try { this.canvas.releasePointerCapture(ev.pointerId); } catch (err) { /* noop */ }
      this.fire();
    }

    setAim(ev) {
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let dx = x - this.baseX;
      let dy = y - this.baseY;
      if (dy > -30) dy = -90;
      const len = Math.max(1, Math.hypot(dx, dy));
      dx /= len;
      dy /= len;
      dy = Math.min(dy, -0.18);
      dx = clamp(dx, -0.96, 0.96);
      const len2 = Math.max(1, Math.hypot(dx, dy));
      this.aim = { x, y, dx: dx / len2, dy: dy / len2 };
      this.draw();
    }

    fire() {
      if (this.shooting) return;
      this.shooting = true;
      this.launchDir = { x: this.aim.dx || 0, y: this.aim.dy || -1 };
      this.launchTick = 0;
      this.launched = 0;
      this.pendingAdds = 0;
      this.firstLanding = null;
      this.activePower = this.nextPower;
      this.nextPower = null;
      UI.beep("ok");
      UI.vibrate(18);
      this.updateHud();
    }

    launchBall() {
      const speed = 7.4;
      const power = this.activePower;
      this.balls.push({
        x: this.baseX,
        y: this.baseY,
        px: this.baseX,
        py: this.baseY,
        vx: this.launchDir.x * speed,
        vy: this.launchDir.y * speed,
        r: 5.2,
        done: false,
        pierce: power === "pierce" ? 3 : 0,
        explosive: power === "explode",
        split: power === "split",
        splitDone: false
      });
    }

    kick() {
      if (!this.running || this.paused || this.raf) return;
      this.raf = requestAnimationFrame(() => this.loop());
    }

    loop() {
      this.raf = 0;
      if (!this.running || this.paused) return;
      this.update();
      this.draw();
      this.kick();
    }

    update() {
      if (this.shooting) {
        this.launchTick += 1;
        const delay = this.ballCount > 14 ? 2 : 4;
        if (this.launched < this.ballCount && this.launchTick % delay === 1) {
          this.launchBall();
          this.launched += 1;
        }
      }
      this.balls.forEach((ball) => this.updateBall(ball));
      this.balls = this.balls.filter((b) => !b.done);
      if (this.shooting && this.launched >= this.ballCount && this.balls.length === 0) this.endRound();
    }

    updateBall(ball) {
      ball.px = ball.x;
      ball.py = ball.y;
      ball.x += ball.vx;
      ball.y += ball.vy;

      if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
      if (ball.x > this.w - ball.r) { ball.x = this.w - ball.r; ball.vx = -Math.abs(ball.vx); }
      if (ball.y < TOP - 20) { ball.y = TOP - 20; ball.vy = Math.abs(ball.vy); }
      if (ball.y > this.baseY) {
        if (this.firstLanding === null) this.firstLanding = clamp(ball.x, 20, this.w - 20);
        ball.done = true;
        return;
      }

      for (let i = 0; i < this.items.length; i += 1) {
        const item = this.items[i];
        const cx = this.colX(item.col) + this.cellW() / 2;
        const cy = this.rowY(item.row) + this.cellH() / 2;
        if (dist2(ball.x, ball.y, cx, cy) < 22 * 22) {
          this.collectItem(item);
          this.items.splice(i, 1);
          i -= 1;
        }
      }

      for (let i = 0; i < this.blocks.length; i += 1) {
        const block = this.blocks[i];
        const rect = { x: this.colX(block.col), y: this.rowY(block.row), w: this.cellW(), h: this.cellH() };
        if (this.circleRect(ball, rect)) {
          this.hitBlock(ball, block, rect);
          if (block.hp <= 0) {
            this.blocks.splice(i, 1);
            i -= 1;
          }
          break;
        }
      }
    }

    circleRect(ball, rect) {
      const nx = clamp(ball.x, rect.x, rect.x + rect.w);
      const ny = clamp(ball.y, rect.y, rect.y + rect.h);
      return dist2(ball.x, ball.y, nx, ny) <= ball.r * ball.r;
    }

    hitBlock(ball, block, rect) {
      block.hp -= 1;
      this.score += 1;
      UI.beep("score");
      if (ball.explosive) {
        this.blocks.forEach((b) => {
          if (b !== block && Math.abs(b.col - block.col) + Math.abs(b.row - block.row) <= 1) b.hp -= 1;
        });
      }
      if (ball.split && !ball.splitDone && this.balls.length < 60) {
        ball.splitDone = true;
        this.balls.push(Object.assign({}, ball, { vx: -ball.vx, vy: ball.vy, split: false, splitDone: true }));
      }
      if (ball.pierce > 0) {
        ball.pierce -= 1;
        return;
      }
      const fromSide = ball.px < rect.x || ball.px > rect.x + rect.w;
      if (fromSide) ball.vx *= -1;
      else ball.vy *= -1;
      ball.x += ball.vx * 0.8;
      ball.y += ball.vy * 0.8;
    }

    collectItem(item) {
      const label = { plus: "+1 球", pierce: "穿透球", explode: "爆炸球", split: "分裂球" }[item.type];
      if (item.type === "plus") this.pendingAdds += 1;
      else this.nextPower = item.type;
      UI.toast(`拿到 ${label}`);
      UI.vibrate(16);
      UI.beep("ok");
    }

    endRound() {
      this.shooting = false;
      this.activePower = null;
      this.baseX = this.firstLanding || this.baseX;
      this.ballCount = clamp(this.ballCount + this.pendingAdds, 1, 32);
      this.round += 1;
      this.blocks.forEach((b) => { b.row += 1; });
      this.items.forEach((i) => { i.row += 1; });
      this.items = this.items.filter((item) => this.rowY(item.row) < this.bottomLimit() - 4);
      this.blocks = this.blocks.filter((b) => b.hp > 0);
      this.addRow();
      this.updateHud();
      if (this.blocks.some((b) => this.rowY(b.row) + this.cellH() >= this.bottomLimit())) this.gameOver();
    }

    addRow() {
      const used = new Set();
      const count = clamp(2 + Math.floor(this.round / 6) + randInt(-1, 1), 1, 5);
      for (let i = 0; i < count; i += 1) {
        let col = randInt(0, COLS - 1);
        let guard = 0;
        while (used.has(col) && guard < 20) { col = randInt(0, COLS - 1); guard += 1; }
        used.add(col);
        this.blocks.push({ col, row: 0, hp: randInt(this.round, this.round + Math.max(1, Math.floor(this.round * .55))) });
      }
      if (Math.random() < 0.46) {
        let col = randInt(0, COLS - 1);
        let guard = 0;
        while (used.has(col) && guard < 20) { col = randInt(0, COLS - 1); guard += 1; }
        const roll = Math.random();
        const type = roll < .58 ? "plus" : roll < .73 ? "pierce" : roll < .88 ? "explode" : "split";
        this.items.push({ col, row: 0, type });
      }
    }

    updateHud() {
      const round = this.host.querySelector('[data-hud="round"]');
      const balls = this.host.querySelector('[data-hud="balls"]');
      const score = this.host.querySelector('[data-hud="score"]');
      if (round) round.textContent = `回合 ${this.round}`;
      if (balls) balls.textContent = `球 ×${this.ballCount}${this.nextPower ? " · " + this.powerName(this.nextPower) : ""}`;
      if (score) score.textContent = `⭐ ${this.score}`;
    }

    powerName(type) {
      return { pierce: "穿透", explode: "爆炸", split: "分裂" }[type] || "+1";
    }

    draw() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      const g = ctx.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, "#070a29");
      g.addColorStop(1, "#040512");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.save();
      ctx.globalAlpha = .18;
      ctx.strokeStyle = "#25e4ff";
      ctx.lineWidth = 1;
      for (let y = TOP; y < this.h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.w, y); ctx.stroke(); }
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = "rgba(255,107,138,.8)";
      ctx.setLineDash([7, 8]);
      ctx.beginPath();
      ctx.moveTo(8, this.bottomLimit());
      ctx.lineTo(this.w - 8, this.bottomLimit());
      ctx.stroke();
      ctx.restore();

      this.blocks.forEach((b) => this.drawBlock(ctx, b));
      this.items.forEach((i) => this.drawItem(ctx, i));
      this.balls.forEach((b) => this.drawBall(ctx, b));
      this.drawLauncher(ctx);
      if (this.aiming && !this.shooting) this.drawAim(ctx);
    }

    drawBlock(ctx, b) {
      const x = this.colX(b.col);
      const y = this.rowY(b.row);
      const w = this.cellW();
      const h = this.cellH();
      const hueHot = b.hp > this.round * 1.3;
      ctx.save();
      ctx.shadowColor = hueHot ? "#ff4fd8" : "#25e4ff";
      ctx.shadowBlur = 14;
      ctx.fillStyle = hueHot ? "rgba(255,79,216,.34)" : "rgba(37,228,255,.24)";
      ctx.strokeStyle = hueHot ? "rgba(255,79,216,.9)" : "rgba(37,228,255,.9)";
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, x, y, w, h, 9);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#f8fbff";
      ctx.font = "900 17px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(Math.max(0, b.hp)), x + w / 2, y + h / 2 + 1);
      ctx.restore();
    }

    drawItem(ctx, item) {
      const x = this.colX(item.col) + this.cellW() / 2;
      const y = this.rowY(item.row) + this.cellH() / 2;
      const emoji = { plus: "+", pierce: "⚡", explode: "💥", split: "✦" }[item.type];
      ctx.save();
      ctx.shadowColor = "#ffe66d";
      ctx.shadowBlur = 15;
      ctx.fillStyle = item.type === "plus" ? "rgba(93,255,176,.8)" : "rgba(255,230,109,.86)";
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#07081f";
      ctx.font = "900 16px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(emoji, x, y + 1);
      ctx.restore();
    }

    drawBall(ctx, b) {
      ctx.save();
      ctx.shadowColor = b.explosive ? "#ff4fd8" : b.pierce ? "#ffe66d" : "#25e4ff";
      ctx.shadowBlur = 15;
      ctx.fillStyle = "#f8fbff";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawLauncher(ctx) {
      ctx.save();
      ctx.fillStyle = "rgba(6,8,28,.75)";
      ctx.strokeStyle = "rgba(103,232,249,.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.baseX, this.baseY, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#25e4ff";
      ctx.beginPath();
      ctx.arc(this.baseX, this.baseY, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawAim(ctx) {
      ctx.save();
      ctx.strokeStyle = "rgba(37,228,255,.95)";
      ctx.fillStyle = "rgba(37,228,255,.95)";
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 8]);
      ctx.beginPath();
      ctx.moveTo(this.baseX, this.baseY);
      ctx.lineTo(this.baseX + this.aim.dx * 155, this.baseY + this.aim.dy * 155);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(this.baseX + this.aim.dx * 155, this.baseY + this.aim.dy * 155, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    roundRect(ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    gameOver() {
      if (this.dead) return;
      this.dead = true;
      this.running = false;
      this.pause();
      Storage.updateBest("neonBalls", { bestRound: this.round, bestScore: this.score });
      if (this.round >= 20) UI.achievement("balls-20", "霓虹弹珠 20 回合");
      if (this.ballCount >= 16) UI.achievement("balls-swarm", "一屏小球军团");
      UI.beep("end");
      UI.vibrate([30, 45, 20]);
      UI.resultOverlay(this.host, {
        title: "方块压到底啦",
        message: `坚持到第 ${this.round} 回合 · 分数 ${this.score} · 最多 ${this.ballCount} 颗球`,
        actions: [
          { label: "再来一发", kind: "primary", beep: "ok", onClick: () => this.restart() },
          { label: "返回游戏厅", kind: "secondary", onClick: () => this.services.goHome() }
        ]
      });
    }
  }

  window.RayGames.NeonBalls = NeonBalls;
})();
