(function(){
  'use strict';
  const NS = window.RayStarfall = window.RayStarfall || {};
  const TAU = Math.PI * 2;

  const SHOP_ITEMS = [
    { id:'hull', icon:'♡', name:'猫舱装甲', desc:'开局最大 HP +1 / 级', max:5 },
    { id:'fireRate', icon:'✦', name:'猫爪超频', desc:'开局射速提升', max:5 },
    { id:'magnet', icon:'◎', name:'小鱼干磁场', desc:'芯片和金币吸附范围提升', max:5 },
    { id:'dash', icon:'↯', name:'闪避缓存', desc:'闪避冷却缩短', max:5 },
    { id:'coin', icon:'◇', name:'星屑合约', desc:'本局获得金币增加', max:5 },
    { id:'nova', icon:'✺', name:'NOVA 核心', desc:'NOVA 冷却缩短、伤害提升', max:5 }
  ];

  const ACHIEVEMENTS = [
    { id:'first_launch', icon:'🚀', title:'星港报到', desc:'开始第一局 Ray Cat Starfall。' },
    { id:'score_1500', icon:'⭐', title:'霓虹新星', desc:'单局分数达到 1500。' },
    { id:'score_6000', icon:'🌌', title:'星落传说', desc:'单局分数达到 6000。' },
    { id:'wave_5', icon:'🐾', title:'厕所勇者航线', desc:'抵达第 5 波。' },
    { id:'wave_10', icon:'👑', title:'Ray Agent 领航员', desc:'抵达第 10 波。' },
    { id:'boss_1', icon:'💥', title:'Boss 不是老板', desc:'击败任意一只 Boss。' },
    { id:'survive_180', icon:'⏱', title:'三分钟奇迹', desc:'单局存活 180 秒。' },
    { id:'coins_500', icon:'💎', title:'星屑小富猫', desc:'累计收集 500 金币。' },
    { id:'kills_500', icon:'🧹', title:'Bug 清理大师', desc:'累计清理 500 个敌人。' },
    { id:'max_upgrade', icon:'🔧', title:'星港毕业', desc:'任意永久强化升到满级。' }
  ];

  const UPGRADE_POOL = [
    { id:'twin_paw', rarity:'火力', name:'双子猫爪', desc:'每次射击额外发射一枚光弹。', apply:g=>{ g.run.bulletCount = Math.min(6, g.run.bulletCount + 1); } },
    { id:'fish_laser', rarity:'火力', name:'小鱼干激光', desc:'光弹伤害 +35%。', apply:g=>{ g.run.damage *= 1.35; } },
    { id:'codex_cache', rarity:'节奏', name:'Codex 缓存', desc:'射击间隔缩短 14%。', apply:g=>{ g.run.fireMultiplier *= 0.86; } },
    { id:'hermes_aegis', rarity:'防御', name:'Hermes 护盾', desc:'最大 HP +1，立刻回复 1 点 HP。', apply:g=>{ g.player.maxHp += 1; g.player.hp = Math.min(g.player.maxHp, g.player.hp + 1); } },
    { id:'catnip_engine', rarity:'机动', name:'猫薄荷尾焰', desc:'拖动跟随更灵敏，移动速度提升。', apply:g=>{ g.player.speed += 80; } },
    { id:'magnet_dream', rarity:'收集', name:'摸鱼磁场', desc:'芯片和金币吸附范围 +55。', apply:g=>{ g.run.magnetRange += 55; } },
    { id:'ai_drone', rarity:'AI', name:'AI 小助手', desc:'获得一个环绕射击的小型代理人。', apply:g=>{ g.run.drones = Math.min(3, g.run.drones + 1); g.spawnDrone(); } },
    { id:'piercing_paw', rarity:'火力', name:'穿透猫爪', desc:'光弹可额外穿透 1 个敌人。', apply:g=>{ g.run.pierce += 1; } },
    { id:'coin_rain', rarity:'经济', name:'星屑雨', desc:'本局金币收益 +25%。', apply:g=>{ g.run.coinMultiplier += .25; } },
    { id:'nova_core', rarity:'终端', name:'NOVA 核心', desc:'NOVA 冷却更短，爆发伤害提升。', apply:g=>{ g.run.novaDamage += 14; g.skill.novaMax = Math.max(8, g.skill.novaMax - 2); } },
    { id:'soft_reboot', rarity:'防御', name:'软重启协议', desc:'受到致命伤时可保留 1 HP，一局一次。', apply:g=>{ g.run.revive += 1; } },
    { id:'boss_contract', rarity:'挑战', name:'Boss 悬赏令', desc:'对 Boss 伤害 +30%，击败 Boss 金币更多。', apply:g=>{ g.run.bossDamage *= 1.3; g.run.bossCoinBonus += 12; } }
  ];

  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function rand(min,max){ return min + Math.random() * (max - min); }
  function chance(p){ return Math.random() < p; }
  function dist2(a,b,c,d){ const x=a-c, y=b-d; return x*x + y*y; }
  function circleHit(a,b){ const r = (a.r || 0) + (b.r || 0); return dist2(a.x,a.y,b.x,b.y) <= r*r; }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function formatTime(sec){ const m=Math.floor(sec/60); const s=Math.floor(sec%60); return `${m}:${String(s).padStart(2,'0')}`; }

  class Game {
    constructor(canvas, hooks, audio){
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha:true });
      this.hooks = hooks || {};
      this.audio = audio;
      this.state = 'menu';
      this.w = 390; this.h = 844; this.dpr = 1;
      this.last = 0;
      this.time = 0;
      this.bgTime = 0;
      this.bgStars = [];
      this.activePointer = null;
      this.touching = false;
      this.target = { x:this.w/2, y:this.h*.78 };
      this.player = null;
      this.run = null;
      this.skill = null;
      this.entities = this.emptyEntities();
      this.pendingChoices = [];
      this.bossWave = 0;
      this.shake = 0;
      this.flash = 0;
      this.raf = 0;
      this.handleResize = this.resize.bind(this);
      window.addEventListener('resize', this.handleResize, { passive:true });
      window.addEventListener('orientationchange', this.handleResize, { passive:true });
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(true); });
      this.bindCanvas();
      this.resize();
      this.loop = this.loop.bind(this);
      this.raf = requestAnimationFrame(this.loop);
    }

    emptyEntities(){
      return { bullets:[], enemyBullets:[], enemies:[], pickups:[], particles:[], texts:[], drones:[] };
    }

    bindCanvas(){
      const c = this.canvas;
      const pos = ev => {
        const rect = c.getBoundingClientRect();
        return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      };
      c.addEventListener('pointerdown', ev => {
        if (this.state !== 'playing') return;
        ev.preventDefault();
        this.activePointer = ev.pointerId;
        this.touching = true;
        c.setPointerCapture && c.setPointerCapture(ev.pointerId);
        const p = pos(ev);
        this.setTarget(p.x, p.y);
      }, { passive:false });
      c.addEventListener('pointermove', ev => {
        if (this.state !== 'playing' || this.activePointer !== ev.pointerId) return;
        ev.preventDefault();
        const p = pos(ev);
        this.setTarget(p.x, p.y);
      }, { passive:false });
      const end = ev => {
        if (this.activePointer !== ev.pointerId) return;
        ev.preventDefault();
        this.touching = false;
        this.activePointer = null;
      };
      c.addEventListener('pointerup', end, { passive:false });
      c.addEventListener('pointercancel', end, { passive:false });
    }

    setTarget(x,y){
      const p = this.player;
      const minY = this.h * .18;
      const maxY = this.h - 92 - this.safeBottom();
      this.target.x = clamp(x, 28, this.w - 28);
      this.target.y = clamp(y - 42, minY, maxY);
      if (p && this.time < .25) { p.x = this.target.x; p.y = this.target.y; }
    }

    safeBottom(){
      const v = getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom');
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    }

    resize(){
      const rect = this.canvas.getBoundingClientRect();
      this.w = Math.max(320, Math.round(rect.width || window.innerWidth || 390));
      this.h = Math.max(560, Math.round(rect.height || window.innerHeight || 844));
      this.dpr = Math.min(3, window.devicePixelRatio || 1);
      this.canvas.width = Math.floor(this.w * this.dpr);
      this.canvas.height = Math.floor(this.h * this.dpr);
      this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
      this.target.x = clamp(this.target.x || this.w/2, 28, this.w-28);
      this.target.y = clamp(this.target.y || this.h*.78, this.h*.18, this.h-110);
      if (this.player) {
        this.player.x = clamp(this.player.x, 28, this.w - 28);
        this.player.y = clamp(this.player.y, this.h*.18, this.h - 110);
      }
      this.createStars();
    }

    createStars(){
      const count = Math.floor((this.w * this.h) / 5200);
      this.bgStars = Array.from({ length: count }, (_,i)=>({
        x: Math.random()*this.w,
        y: Math.random()*this.h,
        z: Math.random()*1.8 + .25,
        r: Math.random()*1.8 + .4,
        tw: Math.random()*TAU,
        hue: chance(.5) ? 190 : 310
      }));
    }

    start(){
      this.audio && this.audio.resume();
      this.audio && this.audio.startAmbient();
      const save = NS.Store.get();
      const u = save.upgrades;
      this.state = 'playing';
      this.time = 0;
      this.shake = 0;
      this.flash = 0;
      this.bossWave = 0;
      this.entities = this.emptyEntities();
      this.pendingChoices = [];
      this.player = {
        x:this.w/2, y:this.h*.76, r:17,
        hp: 6 + (u.hull || 0), maxHp: 6 + (u.hull || 0),
        speed: 620, invul: 1.0, shield: 0,
        fireTimer: .2, heat: 0, tilt: 0,
        lastX: this.w/2, dashGhost: 0
      };
      this.target = { x:this.player.x, y:this.player.y };
      this.run = {
        score:0, wave:1, kills:0, coins:0, bossKills:0,
        xp:0, level:1, nextXp: 9,
        bulletCount:1, damage:1, pierce:0,
        fireMultiplier: 1 - (u.fireRate || 0) * .07,
        magnetRange: 76 + (u.magnet || 0) * 22,
        coinMultiplier: 1 + (u.coin || 0) * .12,
        drones:0, revive:0,
        bossDamage:1, bossCoinBonus:0,
        novaDamage: 30 + (u.nova || 0) * 8,
        seenBossIntro:false,
        spawnTimer:.3,
        pickupPulse:0
      };
      this.skill = {
        dash:0, dashMax: Math.max(2.8, 5.6 - (u.dash || 0) * .42),
        aegis:2.5, aegisMax: 13.5,
        nova:7, novaMax: Math.max(10, 23 - (u.nova || 0) * 1.65)
      };
      this.checkAchievement('first_launch');
      this.spawnWaveIntro();
      this.hooks.onState && this.hooks.onState('playing');
      this.updateHUD();
    }

    spawnWaveIntro(){
      for (let i=0;i<18;i++) this.addParticle(rand(30,this.w-30), rand(50,this.h*.45), rand(-18,18), rand(16,80), rand(.5,1.1), '#39e7ff', rand(1,3));
      this.toast('拖动 Ray Cat，自动开火，收集芯片升级');
    }

    pause(auto){
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.audio && this.audio.stopAmbient();
      this.hooks.onState && this.hooks.onState('paused', { auto:!!auto });
    }

    resume(){
      if (this.state !== 'paused') return;
      this.state = 'playing';
      this.last = performance.now();
      this.audio && this.audio.startAmbient();
      this.hooks.onState && this.hooks.onState('playing');
    }

    returnToMenu(){
      this.state = 'menu';
      this.audio && this.audio.stopAmbient();
      this.hooks.onState && this.hooks.onState('menu');
    }

    loop(now){
      const dt = Math.min(.034, Math.max(.001, (now - (this.last || now)) / 1000));
      this.last = now;
      this.bgTime += dt;
      if (this.state === 'playing') this.update(dt);
      else this.updateAmbient(dt);
      this.render();
      this.raf = requestAnimationFrame(this.loop);
    }

    updateAmbient(dt){
      for (const s of this.bgStars){
        s.y += dt * (10 + s.z * 18);
        s.tw += dt * (.8 + s.z * .2);
        if (s.y > this.h + 5) { s.y = -5; s.x = Math.random() * this.w; }
      }
      this.updateParticles(dt);
    }

    update(dt){
      this.time += dt;
      this.run.wave = Math.max(1, Math.floor(this.time / 18) + 1);
      this.run.score += dt * (8 + this.run.wave * 2);
      this.flash = Math.max(0, this.flash - dt);
      this.shake = Math.max(0, this.shake - dt * 22);
      this.updateAmbient(dt);
      this.updateSkills(dt);
      this.updatePlayer(dt);
      this.updateDrones(dt);
      this.director(dt);
      this.updateBullets(dt);
      this.updateEnemies(dt);
      this.updatePickups(dt);
      this.resolveCollisions();
      this.updateTexts(dt);
      this.cleanup();
      this.updateHUD();
      this.checkRunAchievements();
    }

    updateSkills(dt){
      for (const k of ['dash','aegis','nova']) this.skill[k] = Math.max(0, this.skill[k] - dt);
      if (this.player.invul > 0) this.player.invul = Math.max(0, this.player.invul - dt);
      if (this.player.shield > 0) this.player.shield = Math.max(0, this.player.shield - dt * .035);
      if (this.player.dashGhost > 0) this.player.dashGhost = Math.max(0, this.player.dashGhost - dt);
    }

    updatePlayer(dt){
      const p = this.player;
      p.lastX = p.x;
      const maxStep = p.speed * dt;
      const dx = this.target.x - p.x;
      const dy = this.target.y - p.y;
      const d = Math.hypot(dx,dy) || 1;
      const step = Math.min(maxStep, d);
      p.x += dx / d * step;
      p.y += dy / d * step;
      p.x = clamp(p.x, 22, this.w - 22);
      p.y = clamp(p.y, this.h*.16, this.h - 100 - this.safeBottom());
      p.tilt = lerp(p.tilt, clamp((p.x - p.lastX) * .08, -0.45, .45), .18);
      const interval = Math.max(.075, .29 * this.run.fireMultiplier);
      p.fireTimer -= dt;
      if (p.fireTimer <= 0) {
        p.fireTimer += interval;
        this.firePlayer();
      }
    }

    firePlayer(){
      const count = this.run.bulletCount;
      const spread = Math.min(.54, .12 * (count - 1));
      for (let i=0;i<count;i++){
        const t = count === 1 ? 0 : (i/(count-1)-.5);
        const angle = -Math.PI/2 + t * spread;
        const speed = 760;
        this.entities.bullets.push({
          x:this.player.x + t * 12,
          y:this.player.y - 22,
          vx:Math.cos(angle) * speed,
          vy:Math.sin(angle) * speed,
          r:4.5,
          damage:this.run.damage,
          pierce:this.run.pierce,
          life:1.25,
          color: i % 2 ? '#ff4fd8' : '#39e7ff'
        });
      }
      this.audio && this.audio.sfx('shoot');
      this.addParticle(this.player.x, this.player.y+20, rand(-20,20), rand(80,130), .22, '#39e7ff', 1.6);
    }

    spawnDrone(){
      const idx = this.entities.drones.length;
      this.entities.drones.push({ angle: idx * TAU / 3, fire: .35 + idx*.15 });
    }

    updateDrones(dt){
      const drones = this.entities.drones;
      for (let i=0;i<drones.length;i++){
        const d = drones[i];
        d.angle += dt * (1.6 + i*.12);
        d.x = this.player.x + Math.cos(d.angle) * 32;
        d.y = this.player.y + Math.sin(d.angle) * 24;
        d.fire -= dt;
        if (d.fire <= 0){
          d.fire += .58;
          this.entities.bullets.push({ x:d.x, y:d.y-8, vx:0, vy:-660, r:3.5, damage:this.run.damage*.45, pierce:0, life:1.15, color:'#ffd166', drone:true });
        }
      }
    }

    director(dt){
      const wave = this.run.wave;
      if (wave % 5 === 0 && this.bossWave !== wave && !this.entities.enemies.some(e=>e.type==='boss')) {
        this.spawnBoss(wave);
        this.bossWave = wave;
        return;
      }
      this.run.spawnTimer -= dt;
      if (this.run.spawnTimer > 0) return;
      const density = clamp(1.25 - wave * .045, .42, 1.1);
      this.run.spawnTimer = rand(.42, .95) * density;
      const roll = Math.random();
      if (roll < .42) this.spawnEnemy('bug');
      else if (roll < .64) this.spawnEnemy('shooter');
      else if (roll < .80) this.spawnEnemy('mine');
      else if (roll < .93) this.spawnEnemy('crawler');
      else this.spawnFormation();
    }

    spawnFormation(){
      const n = 3 + Math.floor(Math.random()*3);
      const start = rand(44, this.w - 44 - n*34);
      for (let i=0;i<n;i++) setTimeout(()=>{ if(this.state==='playing') this.spawnEnemy('bug', start + i*34, -30 - i*10); }, i*70);
    }

    enemyBase(type){
      const wave = this.run ? this.run.wave : 1;
      const base = {
        bug: { r:16, hp:2.2 + wave*.42, speed:70 + wave*6, score:70, coins:2 },
        shooter: { r:19, hp:4.4 + wave*.58, speed:45 + wave*3, score:110, coins:3 },
        mine: { r:14, hp:1.8 + wave*.25, speed:115 + wave*10, score:80, coins:2 },
        crawler: { r:18, hp:3.5 + wave*.52, speed:78 + wave*5, score:95, coins:2 }
      }[type];
      return Object.assign({}, base);
    }

    spawnEnemy(type, x, y){
      const b = this.enemyBase(type);
      const elite = chance(Math.min(.22, this.run.wave*.018));
      const e = {
        type,
        x: x == null ? rand(30, this.w-30) : x,
        y: y == null ? -30 : y,
        vx: rand(-28,28), vy: b.speed,
        r: b.r * (elite ? 1.16 : 1),
        hp: b.hp * (elite ? 1.85 : 1), maxHp: b.hp * (elite ? 1.85 : 1),
        score: b.score * (elite ? 1.8 : 1), coins: b.coins + (elite ? 2 : 0),
        t: rand(0,TAU), shoot: rand(.65,2.2), elite,
        hit:0
      };
      if (type === 'shooter') e.vy *= .55;
      if (type === 'mine') e.vx = rand(-8,8);
      this.entities.enemies.push(e);
    }

    spawnBoss(wave){
      this.audio && this.audio.sfx('boss');
      this.toast(`第 ${wave} 波：老板级 Bug 入侵！`);
      NS.vibrate && NS.vibrate([60,40,60]);
      const hp = 95 + wave * 24;
      this.entities.enemies.push({
        type:'boss', x:this.w/2, y:-86, targetY:110, vx:0, vy:36,
        r:54, hp, maxHp:hp, score:1200 + wave*110,
        coins: 24 + wave*2, t:0, shoot:.8, phase:0, hit:0, elite:true
      });
      this.shake = 12;
    }

    updateBullets(dt){
      for (const b of this.entities.bullets){
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        this.addParticle(b.x, b.y, -b.vx*.012 + rand(-8,8), -b.vy*.012 + rand(-8,8), .16, b.color, b.r*.35);
      }
      for (const b of this.entities.enemyBullets){
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        if (b.wiggle) { b.x += Math.sin(this.time*8 + b.wiggle) * 18 * dt; }
      }
    }

    updateEnemies(dt){
      for (const e of this.entities.enemies){
        e.t += dt;
        e.hit = Math.max(0, e.hit - dt*5);
        if (e.type === 'boss'){
          e.y = lerp(e.y, e.targetY, .018);
          e.x = this.w/2 + Math.sin(e.t*.75) * (this.w*.26);
          e.phase = e.hp < e.maxHp*.46 ? 2 : e.hp < e.maxHp*.72 ? 1 : 0;
          e.shoot -= dt;
          if (e.shoot <= 0){
            e.shoot = e.phase === 2 ? .42 : e.phase === 1 ? .58 : .78;
            if (e.phase === 0) this.enemyAimShot(e, 170, 7, '#ff4fd8');
            else if (e.phase === 1) this.enemyRadial(e, 8, 148, '#8f69ff', e.t);
            else { this.enemyRadial(e, 12, 176, '#ff4fd8', e.t); this.enemyAimShot(e, 210, 6, '#ffd166'); }
          }
          continue;
        }
        if (e.type === 'bug'){
          e.x += (e.vx + Math.sin(e.t*3.1)*44) * dt;
          e.y += e.vy * dt;
        } else if (e.type === 'shooter'){
          e.x += Math.sin(e.t*1.8) * 58 * dt + e.vx * dt;
          e.y += e.vy * dt;
          e.shoot -= dt;
          if (e.shoot <= 0 && e.y > 40){ e.shoot = rand(1.1,2.0); this.enemyAimShot(e, 190 + this.run.wave*4, 6, '#ff4fd8'); }
        } else if (e.type === 'mine'){
          e.y += e.vy * dt;
          e.x += Math.sin(e.t*5) * 22 * dt;
        } else if (e.type === 'crawler'){
          const dx = this.player.x - e.x;
          e.x += clamp(dx, -1, 1) * (30 + this.run.wave*3) * dt;
          e.y += e.vy * dt;
        }
        if (e.x < 18 || e.x > this.w - 18) e.vx *= -1;
      }
    }

    enemyAimShot(e, speed, r, color){
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const d = Math.hypot(dx,dy) || 1;
      this.entities.enemyBullets.push({ x:e.x, y:e.y+e.r*.55, vx:dx/d*speed, vy:dy/d*speed, r:r || 5, life:4, damage:1, color:color || '#ff4fd8' });
    }

    enemyRadial(e, count, speed, color, offset){
      for (let i=0;i<count;i++){
        const a = offset + i * TAU / count;
        this.entities.enemyBullets.push({ x:e.x, y:e.y, vx:Math.cos(a)*speed, vy:Math.sin(a)*speed, r:5.5, life:4, damage:1, color:color || '#8f69ff', wiggle: i });
      }
    }

    updatePickups(dt){
      this.run.pickupPulse += dt;
      for (const p of this.entities.pickups){
        p.t += dt;
        const dx = this.player.x - p.x;
        const dy = this.player.y - p.y;
        const d = Math.hypot(dx,dy) || 1;
        const range = this.run.magnetRange * (p.type === 'heal' ? .7 : 1);
        if (d < range){
          const pull = (1 - d/range) * (260 + range*2);
          p.vx += dx/d * pull * dt;
          p.vy += dy/d * pull * dt;
        }
        p.vy += 24 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
      }
    }

    resolveCollisions(){
      const bullets = this.entities.bullets;
      const enemies = this.entities.enemies;
      for (const b of bullets){
        if (b.dead) continue;
        for (const e of enemies){
          if (e.dead) continue;
          if (!circleHit(b,e)) continue;
          const dmg = b.damage * (e.type === 'boss' ? this.run.bossDamage : 1);
          e.hp -= dmg;
          e.hit = 1;
          this.addText(e.x, e.y-e.r, Math.ceil(dmg), b.color);
          this.addParticle(e.x, e.y, rand(-80,80), rand(-80,20), .35, b.color, rand(2,4));
          this.audio && this.audio.sfx('hit');
          if (e.hp <= 0) this.killEnemy(e);
          if (b.pierce > 0) b.pierce -= 1; else { b.dead = true; break; }
        }
      }
      for (const e of enemies){
        if (!e.dead && circleHit(this.player,e)){
          if (e.type === 'mine') { this.mineBurst(e); e.dead = true; }
          this.damagePlayer(e.type === 'boss' ? 2 : 1);
        }
      }
      for (const eb of this.entities.enemyBullets){
        if (!eb.dead && circleHit(this.player, eb)){
          eb.dead = true;
          this.damagePlayer(eb.damage || 1);
          this.addParticle(eb.x, eb.y, rand(-80,80), rand(-80,80), .36, eb.color, 3);
        }
      }
      for (const p of this.entities.pickups){
        if (!p.dead && circleHit(this.player, p)) this.collectPickup(p);
      }
    }

    mineBurst(e){
      this.enemyRadial(e, 7, 150, '#ffd166', e.t);
      this.addExplosion(e.x,e.y,'#ffd166',18);
    }

    killEnemy(e){
      if (e.dead) return;
      e.dead = true;
      this.run.kills += 1;
      this.run.score += e.score;
      this.addExplosion(e.x, e.y, e.type === 'boss' ? '#ff4fd8' : '#39e7ff', e.type === 'boss' ? 46 : 18);
      if (e.type === 'mine') this.mineBurst(e);
      if (e.type === 'boss'){
        this.run.bossKills += 1;
        this.flash = .35;
        this.shake = 20;
        this.checkAchievement('boss_1');
        for (let i=0;i<12;i++) this.spawnPickup('coin', e.x + rand(-44,44), e.y + rand(-28,36), 2 + this.run.bossCoinBonus/12);
        for (let i=0;i<6;i++) this.spawnPickup('xp', e.x + rand(-46,46), e.y + rand(-36,48), 4);
        if (chance(.55)) this.spawnPickup('heal', e.x, e.y, 1);
      } else {
        if (chance(.72)) this.spawnPickup('xp', e.x, e.y, e.elite ? 3 : 1);
        if (chance(.40)) this.spawnPickup('coin', e.x, e.y, e.coins);
        if (chance(.025)) this.spawnPickup('heal', e.x, e.y, 1);
      }
    }

    spawnPickup(type,x,y,value){
      this.entities.pickups.push({ type, x, y, vx:rand(-50,50), vy:rand(-70,-20), r:type==='heal'?10:8, value:value || 1, life:8, t:0 });
    }

    collectPickup(p){
      p.dead = true;
      if (p.type === 'xp'){
        this.run.xp += p.value;
        this.run.score += 16 * p.value;
        this.audio && this.audio.sfx('pickup');
        this.addText(p.x,p.y,'芯片+', '#39e7ff');
        if (this.run.xp >= this.run.nextXp) this.levelUp();
      } else if (p.type === 'coin'){
        const gained = Math.max(1, Math.round(p.value * this.run.coinMultiplier));
        this.run.coins += gained;
        this.run.score += 8 * gained;
        this.audio && this.audio.sfx('coin');
        this.addText(p.x,p.y,'+'+gained, '#ffd166');
      } else if (p.type === 'heal'){
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
        this.audio && this.audio.sfx('aegis');
        this.addText(p.x,p.y,'HP+', '#67ffb7');
      }
      NS.vibrate && NS.vibrate(8);
    }

    levelUp(){
      this.run.level += 1;
      this.run.xp -= this.run.nextXp;
      this.run.nextXp = Math.ceil(this.run.nextXp * 1.28 + 4);
      this.state = 'levelUp';
      this.audio && this.audio.sfx('upgrade');
      NS.vibrate && NS.vibrate([25,20,25]);
      this.pendingChoices = this.randomUpgrades(3);
      this.hooks.onLevelUp && this.hooks.onLevelUp(this.pendingChoices);
      this.hooks.onState && this.hooks.onState('levelUp');
    }

    randomUpgrades(n){
      const pool = UPGRADE_POOL.slice();
      const out = [];
      while (out.length < n && pool.length){
        const idx = Math.floor(Math.random() * pool.length);
        out.push(pool.splice(idx,1)[0]);
      }
      return out;
    }

    chooseUpgrade(id){
      const choice = this.pendingChoices.find(c=>c.id === id);
      if (!choice) return;
      choice.apply(this);
      this.toast(`获得：${choice.name}`);
      this.pendingChoices = [];
      this.state = 'playing';
      this.last = performance.now();
      this.hooks.onState && this.hooks.onState('playing');
      this.updateHUD();
    }

    damagePlayer(amount){
      const p = this.player;
      if (p.invul > 0) return;
      if (p.shield > 0){
        p.shield = Math.max(0, p.shield - amount);
        p.invul = .35;
        this.audio && this.audio.sfx('hit');
        NS.vibrate && NS.vibrate(20);
        this.addText(p.x,p.y-24,'护盾', '#67ffb7');
        return;
      }
      p.hp -= amount;
      p.invul = .88;
      this.flash = .22;
      this.shake = 14;
      this.audio && this.audio.sfx('damage');
      NS.vibrate && NS.vibrate([50,30,40]);
      this.addText(p.x,p.y-26,'-'+amount, '#ff5f7e');
      this.addExplosion(p.x,p.y,'#ff5f7e',18);
      if (p.hp <= 0){
        if (this.run.revive > 0){
          this.run.revive -= 1;
          p.hp = 1;
          p.invul = 2.5;
          this.useNova(true);
          this.toast('软重启协议触发：保留 1 HP');
        } else this.gameOver();
      }
    }

    useDash(){
      if (this.state !== 'playing' || this.skill.dash > 0) return false;
      this.skill.dash = this.skill.dashMax;
      this.player.invul = Math.max(this.player.invul, .72);
      this.player.dashGhost = .34;
      let cleared = 0;
      for (const b of this.entities.enemyBullets){
        if (dist2(b.x,b.y,this.player.x,this.player.y) < 140*140) { b.dead = true; cleared++; }
      }
      this.run.score += cleared * 12;
      this.addExplosion(this.player.x,this.player.y,'#39e7ff',22);
      this.audio && this.audio.sfx('dash');
      NS.vibrate && NS.vibrate(18);
      this.updateHUD();
      return true;
    }

    useAegis(){
      if (this.state !== 'playing' || this.skill.aegis > 0) return false;
      this.skill.aegis = this.skill.aegisMax;
      this.player.shield = Math.max(this.player.shield, 2.35);
      this.player.invul = Math.max(this.player.invul, .3);
      this.addExplosion(this.player.x,this.player.y,'#67ffb7',28);
      this.audio && this.audio.sfx('aegis');
      NS.vibrate && NS.vibrate(22);
      this.updateHUD();
      return true;
    }

    useNova(free){
      if (this.state !== 'playing' && !free) return false;
      if (!free && this.skill.nova > 0) return false;
      if (!free) this.skill.nova = this.skill.novaMax;
      const dmg = this.run.novaDamage;
      let hit = 0;
      for (const e of this.entities.enemies){
        e.hp -= dmg;
        e.hit = 1;
        hit++;
        if (e.hp <= 0) this.killEnemy(e);
      }
      for (const b of this.entities.enemyBullets) b.dead = true;
      this.flash = .48;
      this.shake = 26;
      this.run.score += hit * 35;
      this.addExplosion(this.player.x,this.player.y,'#ff4fd8',64);
      for (let i=0;i<42;i++) this.addParticle(this.player.x,this.player.y,Math.cos(i/42*TAU)*rand(80,340),Math.sin(i/42*TAU)*rand(80,340),rand(.36,.82),i%2?'#ff4fd8':'#39e7ff',rand(2,5));
      this.audio && this.audio.sfx('nova');
      NS.vibrate && NS.vibrate([30,30,70]);
      this.updateHUD();
      return true;
    }

    gameOver(){
      if (this.state === 'gameover') return;
      this.state = 'gameover';
      this.audio && this.audio.sfx('gameover');
      this.audio && this.audio.stopAmbient();
      this.flash = .55;
      this.shake = 24;
      const coins = Math.max(0, Math.round(this.run.coins));
      NS.Store.addCoins(coins);
      const result = {
        score: Math.floor(this.run.score),
        wave: this.run.wave,
        time: Math.floor(this.time),
        kills: this.run.kills,
        coins,
        bossKills: this.run.bossKills,
        title: this.titleForRun()
      };
      NS.Store.recordRun(result);
      this.checkPostRunAchievements(result);
      this.hooks.onGameOver && this.hooks.onGameOver(result);
      this.hooks.onState && this.hooks.onState('gameover');
    }

    titleForRun(){
      if (this.run.wave >= 12 || this.run.score >= 10000) return '猫神代理人已上线';
      if (this.run.wave >= 9 || this.run.score >= 6000) return 'Ray 级星港高手';
      if (this.run.wave >= 5 || this.run.score >= 2500) return '厕所勇者突围成功';
      if (this.time >= 80) return '摸鱼航线稳定';
      return '刚坐下就遇到 Boss';
    }

    checkAchievement(id){
      if (NS.Store.markAchievement(id)){
        const a = ACHIEVEMENTS.find(x=>x.id===id);
        this.hooks.onAchievement && this.hooks.onAchievement(a || { title:id, icon:'🏆' });
      }
    }

    checkRunAchievements(){
      if (this.run.score >= 1500) this.checkAchievement('score_1500');
      if (this.run.score >= 6000) this.checkAchievement('score_6000');
      if (this.run.wave >= 5) this.checkAchievement('wave_5');
      if (this.run.wave >= 10) this.checkAchievement('wave_10');
      if (this.time >= 180) this.checkAchievement('survive_180');
    }

    checkPostRunAchievements(result){
      const save = NS.Store.get();
      if (save.stats.totalCoins >= 500) this.checkAchievement('coins_500');
      if (save.stats.totalKills >= 500) this.checkAchievement('kills_500');
    }

    cleanup(){
      const far = 120;
      this.entities.bullets = this.entities.bullets.filter(b=>!b.dead && b.life>0 && b.x>-far && b.x<this.w+far && b.y>-far && b.y<this.h+far);
      this.entities.enemyBullets = this.entities.enemyBullets.filter(b=>!b.dead && b.life>0 && b.x>-far && b.x<this.w+far && b.y>-far && b.y<this.h+far);
      this.entities.enemies = this.entities.enemies.filter(e=>!e.dead && e.y < this.h + 90 && e.hp > 0);
      this.entities.pickups = this.entities.pickups.filter(p=>!p.dead && p.life>0 && p.y < this.h + 60);
      this.entities.particles = this.entities.particles.filter(p=>p.life>0);
      this.entities.texts = this.entities.texts.filter(t=>t.life>0);
    }

    updateParticles(dt){
      for (const p of this.entities.particles){
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.vx *= 1 - dt*1.8; p.vy *= 1 - dt*1.8;
      }
    }

    updateTexts(dt){
      for (const t of this.entities.texts){
        t.y -= dt * 38; t.life -= dt;
      }
    }

    addParticle(x,y,vx,vy,life,color,r){
      this.entities.particles.push({ x,y,vx,vy,life,ttl:life,color,r });
    }

    addExplosion(x,y,color,count){
      for (let i=0;i<count;i++){
        const a = Math.random()*TAU;
        const s = rand(50,260);
        this.addParticle(x,y,Math.cos(a)*s,Math.sin(a)*s,rand(.28,.78),color,rand(1.5,4.8));
      }
    }

    addText(x,y,text,color){
      this.entities.texts.push({ x,y,text:String(text),color,life:.78,ttl:.78 });
    }

    toast(msg){ this.hooks.toast && this.hooks.toast(msg); }

    updateHUD(){
      if (!this.hooks.updateHUD || !this.player || !this.run || !this.skill) return;
      this.hooks.updateHUD({
        hp:this.player.hp,
        maxHp:this.player.maxHp,
        shield:this.player.shield,
        score:Math.floor(this.run.score),
        wave:this.run.wave,
        level:this.run.level,
        xp:this.run.xp,
        nextXp:this.run.nextXp,
        time:this.time,
        coins:this.run.coins,
        skill:{
          dash:this.skill.dash, dashMax:this.skill.dashMax,
          aegis:this.skill.aegis, aegisMax:this.skill.aegisMax,
          nova:this.skill.nova, novaMax:this.skill.novaMax
        }
      });
    }

    render(){
      const ctx = this.ctx;
      ctx.save();
      ctx.clearRect(0,0,this.w,this.h);
      if (this.shake > 0) ctx.translate(rand(-this.shake,this.shake)*.18, rand(-this.shake,this.shake)*.18);
      this.drawBackground(ctx);
      if (this.state !== 'menu'){
        this.drawPickups(ctx);
        this.drawBullets(ctx);
        this.drawEnemies(ctx);
        this.drawDrones(ctx);
        this.drawPlayer(ctx);
        this.drawParticles(ctx);
        this.drawTexts(ctx);
        this.drawRunOverlay(ctx);
      } else {
        this.drawMenuAmbience(ctx);
        this.drawParticles(ctx);
      }
      if (this.flash > 0){
        ctx.globalAlpha = clamp(this.flash*1.6,0,.55);
        const grd = ctx.createRadialGradient(this.w/2,this.h*.46,0,this.w/2,this.h*.46,this.h*.75);
        grd.addColorStop(0,'rgba(255,79,216,.55)');
        grd.addColorStop(.48,'rgba(57,231,255,.22)');
        grd.addColorStop(1,'rgba(255,255,255,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(0,0,this.w,this.h);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    drawBackground(ctx){
      const g = ctx.createLinearGradient(0,0,0,this.h);
      g.addColorStop(0,'#060713'); g.addColorStop(.42,'#10143a'); g.addColorStop(1,'#05060e');
      ctx.fillStyle = g; ctx.fillRect(0,0,this.w,this.h);
      const n1 = ctx.createRadialGradient(this.w*.72, this.h*.18, 0, this.w*.72, this.h*.18, this.w*.86);
      n1.addColorStop(0,'rgba(255,79,216,.22)'); n1.addColorStop(1,'rgba(255,79,216,0)');
      ctx.fillStyle = n1; ctx.fillRect(0,0,this.w,this.h);
      const n2 = ctx.createRadialGradient(this.w*.18, this.h*.42, 0, this.w*.18, this.h*.42, this.w*.72);
      n2.addColorStop(0,'rgba(57,231,255,.20)'); n2.addColorStop(1,'rgba(57,231,255,0)');
      ctx.fillStyle = n2; ctx.fillRect(0,0,this.w,this.h);
      ctx.save();
      ctx.globalAlpha = .18;
      ctx.strokeStyle = '#39e7ff';
      ctx.lineWidth = 1;
      const gap = 34;
      const horizon = this.h*.58;
      for (let y=horizon + ((this.bgTime*24)%gap); y<this.h+gap; y+=gap){
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(this.w,y); ctx.stroke();
      }
      for (let x=-this.w; x<this.w*2; x+=gap){
        ctx.beginPath(); ctx.moveTo(this.w/2, horizon); ctx.lineTo(x, this.h); ctx.stroke();
      }
      ctx.restore();
      for (const s of this.bgStars){
        const a = .38 + Math.sin(s.tw)*.22;
        ctx.globalAlpha = clamp(a, .12, .72);
        ctx.fillStyle = s.hue === 190 ? '#bff8ff' : '#ffd0f6';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r*s.z*.55, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    drawMenuAmbience(ctx){
      const cx = this.w/2, cy = this.h*.5;
      ctx.save();
      ctx.translate(cx,cy);
      ctx.rotate(Math.sin(this.bgTime*.5)*.05);
      ctx.globalAlpha = .17;
      for (let i=0;i<7;i++){
        ctx.strokeStyle = i%2 ? '#ff4fd8' : '#39e7ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0,0,70+i*24, this.bgTime*.2+i, this.bgTime*.2+i+Math.PI*1.2);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawPlayer(ctx){
      if (!this.player) return;
      const p = this.player;
      ctx.save();
      if (p.invul > 0 && Math.floor(this.time*18)%2===0) ctx.globalAlpha = .68;
      if (p.dashGhost > 0){
        ctx.globalAlpha = .18;
        this.drawCatShip(ctx, p.x - p.tilt*44, p.y + 20, p.tilt, '#39e7ff');
        ctx.globalAlpha = 1;
      }
      if (p.shield > 0 || p.invul > 0){
        const radius = p.r + 12 + Math.sin(this.time*8)*2;
        ctx.strokeStyle = p.shield > 0 ? 'rgba(103,255,183,.75)' : 'rgba(57,231,255,.55)';
        ctx.lineWidth = 3;
        ctx.shadowBlur = 22; ctx.shadowColor = ctx.strokeStyle;
        ctx.beginPath(); ctx.arc(p.x,p.y,radius,0,TAU); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      this.drawCatShip(ctx, p.x, p.y, p.tilt, '#ffffff');
      ctx.restore();
    }

    drawCatShip(ctx,x,y,tilt,color){
      ctx.save();
      ctx.translate(x,y); ctx.rotate(tilt);
      ctx.shadowBlur = 18; ctx.shadowColor = '#39e7ff';
      const flame = 12 + Math.sin(this.time*22)*6;
      const fg = ctx.createLinearGradient(0,12,0,34+flame);
      fg.addColorStop(0,'rgba(57,231,255,.75)'); fg.addColorStop(1,'rgba(255,79,216,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(-8,13); ctx.lineTo(0,34+flame); ctx.lineTo(8,13); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(57,231,255,.22)';
      ctx.beginPath(); ctx.moveTo(-26,5); ctx.lineTo(-12,-4); ctx.lineTo(-10,12); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(26,5); ctx.lineTo(12,-4); ctx.lineTo(10,12); ctx.closePath(); ctx.fill();
      const body = ctx.createLinearGradient(0,-25,0,20);
      body.addColorStop(0,'#ffffff'); body.addColorStop(.52,'#baf8ff'); body.addColorStop(1,'#8f69ff');
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.moveTo(0,-27); ctx.quadraticCurveTo(18,-12,17,4); ctx.quadraticCurveTo(0,25,-17,4); ctx.quadraticCurveTo(-18,-12,0,-27); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff4fd8';
      ctx.beginPath(); ctx.moveTo(-12,-16); ctx.lineTo(-22,-28); ctx.lineTo(-6,-22); ctx.fill();
      ctx.beginPath(); ctx.moveTo(12,-16); ctx.lineTo(22,-28); ctx.lineTo(6,-22); ctx.fill();
      ctx.fillStyle = '#071121';
      ctx.beginPath(); ctx.arc(-6,-6,2.2,0,TAU); ctx.arc(6,-6,2.2,0,TAU); ctx.fill();
      ctx.strokeStyle = '#071121'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0,0,4,0,Math.PI); ctx.stroke();
      ctx.restore();
    }

    drawDrones(ctx){
      for (const d of this.entities.drones){
        ctx.save();
        ctx.shadowBlur = 16; ctx.shadowColor = '#ffd166';
        ctx.fillStyle = '#ffd166';
        ctx.beginPath(); ctx.arc(d.x,d.y,6,0,TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,209,102,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(d.x,d.y,10,0,TAU); ctx.stroke();
        ctx.restore();
      }
    }

    drawBullets(ctx){
      ctx.save();
      for (const b of this.entities.bullets){
        ctx.shadowBlur = 12; ctx.shadowColor = b.color;
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,TAU); ctx.fill();
        ctx.globalAlpha = .32; ctx.fillRect(b.x-1.2,b.y,2.4,18); ctx.globalAlpha = 1;
      }
      for (const b of this.entities.enemyBullets){
        ctx.shadowBlur = 14; ctx.shadowColor = b.color;
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.restore();
    }

    drawEnemies(ctx){
      for (const e of this.entities.enemies){
        ctx.save();
        ctx.translate(e.x,e.y);
        ctx.globalAlpha = e.hit > 0 ? .82 : 1;
        ctx.shadowBlur = e.type === 'boss' ? 24 : 14;
        ctx.shadowColor = e.type === 'mine' ? '#ffd166' : e.type === 'shooter' ? '#ff4fd8' : '#39e7ff';
        if (e.type === 'boss') this.drawBoss(ctx,e);
        else if (e.type === 'shooter') this.drawShooter(ctx,e);
        else if (e.type === 'mine') this.drawMine(ctx,e);
        else if (e.type === 'crawler') this.drawCrawler(ctx,e);
        else this.drawBug(ctx,e);
        ctx.restore();
        this.drawEnemyBar(ctx,e);
      }
    }

    drawBug(ctx,e){
      ctx.rotate(e.t*.8);
      ctx.fillStyle = e.elite ? '#ff4fd8' : '#39e7ff';
      ctx.beginPath();
      for (let i=0;i<6;i++){
        const a = i*TAU/6;
        const r = e.r * (i%2 ? .82 : 1.05);
        const x = Math.cos(a)*r, y = Math.sin(a)*r;
        if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#071121'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-6,-5); ctx.lineTo(6,5); ctx.moveTo(6,-5); ctx.lineTo(-6,5); ctx.stroke();
    }

    drawShooter(ctx,e){
      ctx.fillStyle = '#ff4fd8';
      ctx.beginPath(); ctx.ellipse(0,0,e.r*1.25,e.r*.86,0,0,TAU); ctx.fill();
      ctx.fillStyle = '#071121'; ctx.beginPath(); ctx.arc(0,0,e.r*.42,0,TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-2,-2,e.r*.14,0,TAU); ctx.fill();
    }

    drawMine(ctx,e){
      ctx.rotate(e.t*4);
      ctx.fillStyle = '#ffd166';
      for(let i=0;i<8;i++){
        ctx.rotate(TAU/8); ctx.beginPath(); ctx.moveTo(0,-e.r*1.35); ctx.lineTo(4,-e.r*.6); ctx.lineTo(-4,-e.r*.6); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#ff5f7e'; ctx.beginPath(); ctx.arc(0,0,e.r*.72,0,TAU); ctx.fill();
    }

    drawCrawler(ctx,e){
      ctx.fillStyle = e.elite ? '#8f69ff' : '#67ffb7';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-e.r,-e.r,e.r*2,e.r*2,8) : ctx.rect(-e.r,-e.r,e.r*2,e.r*2); ctx.fill();
      ctx.strokeStyle = '#071121'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-8,0); ctx.lineTo(8,0); ctx.moveTo(0,-8); ctx.lineTo(0,8); ctx.stroke();
    }

    drawBoss(ctx,e){
      ctx.rotate(Math.sin(e.t)*.08);
      const grd = ctx.createRadialGradient(0,-12,5,0,0,e.r*1.25);
      grd.addColorStop(0,'#fff'); grd.addColorStop(.22,'#ff4fd8'); grd.addColorStop(1,'#37105b');
      ctx.fillStyle = grd;
      ctx.beginPath();
      for(let i=0;i<10;i++){
        const a = i*TAU/10;
        const r = e.r * (i%2 ? .82 : 1.15);
        const x = Math.cos(a)*r, y = Math.sin(a)*r;
        if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#071121'; ctx.beginPath(); ctx.arc(0,0,e.r*.46,0,TAU); ctx.fill();
      ctx.strokeStyle = '#39e7ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0,0,e.r*.31,0,TAU); ctx.stroke();
      ctx.fillStyle = '#ffd166'; ctx.font = '900 20px ui-rounded, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline='middle'; ctx.fillText('404',0,1);
    }

    drawEnemyBar(ctx,e){
      if (e.hp >= e.maxHp || e.y < 0) return;
      const w = e.type === 'boss' ? Math.min(this.w*.74, 220) : e.r*2.2;
      const h = e.type === 'boss' ? 7 : 4;
      const x = e.x - w/2, y = e.y - e.r - 12;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x,y,w,h);
      ctx.fillStyle = e.type === 'boss' ? '#ff4fd8' : '#39e7ff'; ctx.fillRect(x,y,w*clamp(e.hp/e.maxHp,0,1),h);
      ctx.restore();
    }

    drawPickups(ctx){
      for (const p of this.entities.pickups){
        ctx.save();
        ctx.translate(p.x,p.y);
        const bob = Math.sin(p.t*7)*2;
        ctx.shadowBlur = 16;
        if (p.type === 'xp'){
          ctx.shadowColor = '#39e7ff'; ctx.fillStyle = '#39e7ff';
          ctx.beginPath(); ctx.moveTo(0,-8+bob); ctx.lineTo(8,0+bob); ctx.lineTo(0,8+bob); ctx.lineTo(-8,0+bob); ctx.closePath(); ctx.fill();
        } else if (p.type === 'coin'){
          ctx.shadowColor = '#ffd166'; ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0,bob,8,0,TAU); ctx.stroke();
          ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(0,bob,3,0,TAU); ctx.fill();
        } else {
          ctx.shadowColor = '#67ffb7'; ctx.fillStyle = '#67ffb7';
          ctx.beginPath(); ctx.arc(0,bob,9,0,TAU); ctx.fill();
          ctx.fillStyle = '#071121'; ctx.fillRect(-2,bob-6,4,12); ctx.fillRect(-6,bob-2,12,4);
        }
        ctx.restore();
      }
    }

    drawParticles(ctx){
      ctx.save();
      for (const p of this.entities.particles){
        const a = clamp(p.life / p.ttl, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 10; ctx.shadowColor = p.color;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r*(.55+a),0,TAU); ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    drawTexts(ctx){
      ctx.save();
      ctx.font = '900 13px ui-rounded, -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const t of this.entities.texts){
        ctx.globalAlpha = clamp(t.life/t.ttl,0,1);
        ctx.fillStyle = t.color;
        ctx.shadowBlur = 12; ctx.shadowColor = t.color;
        ctx.fillText(t.text,t.x,t.y);
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }

    drawRunOverlay(ctx){
      if (!this.run || this.state === 'gameover') return;
      const xpPct = clamp(this.run.xp / this.run.nextXp, 0, 1);
      ctx.save();
      ctx.globalAlpha = .82;
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(16, 64 + this.safeTop(), this.w - 32, 3);
      const grd = ctx.createLinearGradient(16,0,this.w-16,0);
      grd.addColorStop(0,'#39e7ff'); grd.addColorStop(1,'#ff4fd8');
      ctx.fillStyle = grd;
      ctx.fillRect(16, 64 + this.safeTop(), (this.w - 32) * xpPct, 3);
      ctx.restore();
    }

    safeTop(){
      const v = getComputedStyle(document.documentElement).getPropertyValue('--safe-top');
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    }
  }

  NS.Game = Game;
  NS.SHOP_ITEMS = SHOP_ITEMS;
  NS.ACHIEVEMENTS = ACHIEVEMENTS;
  NS.formatTime = formatTime;
})();
