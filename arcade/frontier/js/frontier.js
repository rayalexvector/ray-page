import * as THREE from "../vendor/three.module.js";

(function () {
  "use strict";

  const Storage = window.RayArcade && window.RayArcade.Storage;
  const UI = window.RayArcade && window.RayArcade.UI;

  const TAU = Math.PI * 2;
  const ARENA_RADIUS = 46;
  const WORLD_LIMIT = 42;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function dist2(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
  }
  function pulse(kind) {
    if (!UI) return;
    if (typeof UI.haptic === "function") UI.haptic(kind || "light");
    else if (typeof UI.vibrate === "function") UI.vibrate(10);
  }

  const ENEMY_TABLE = {
    drone: { hp: 32, speed: 5.1, radius: 1.05, damage: 10, score: 10, color: 0xff4f78 },
    striker: { hp: 48, speed: 6.3, radius: 1.0, damage: 14, score: 15, color: 0xff7a3d },
    tank: { hp: 130, speed: 2.4, radius: 1.45, damage: 18, score: 28, color: 0xd640ff },
    caster: { hp: 62, speed: 2.9, radius: 1.08, damage: 12, score: 24, color: 0x9b5cff },
    boss: { hp: 780, speed: 1.85, radius: 2.65, damage: 28, score: 240, color: 0xff2d78 }
  };

  const UPGRADES = [
    {
      id: "damage",
      name: "离子枪管",
      text: "主武器伤害 +5，所有弹体亮度提升。",
      apply: (g) => { g.player.damage += 5; g.player.weaponLevel += 1; }
    },
    {
      id: "rate",
      name: "量子节拍",
      text: "射击间隔缩短 13%，自动锁定更密集。",
      apply: (g) => { g.player.fireDelay = Math.max(.105, g.player.fireDelay * .87); g.player.weaponLevel += 1; }
    },
    {
      id: "split",
      name: "三重光束",
      text: "额外增加 1 条副弹道，最多 5 条。",
      apply: (g) => { g.player.multishot = Math.min(5, g.player.multishot + 1); g.player.weaponLevel += 1; }
    },
    {
      id: "pierce",
      name: "穿透弹芯",
      text: "子弹额外穿透 1 个目标。",
      apply: (g) => { g.player.pierce += 1; g.player.weaponLevel += 1; }
    },
    {
      id: "speed",
      name: "兔跃推进器",
      text: "移动速度 +10%，闪避冷却缩短。",
      apply: (g) => { g.player.speed += .55; g.player.dashDelay = Math.max(1.1, g.player.dashDelay - .22); }
    },
    {
      id: "magnet",
      name: "吸附磁场",
      text: "拾取范围扩大，芯片会更早飞向你。",
      apply: (g) => { g.player.pickupRange += 1.8; }
    },
    {
      id: "shield",
      name: "绿洲护盾",
      text: "最大护盾 +24，并立即回复 24。",
      apply: (g) => { g.player.maxHp += 24; g.player.hp = Math.min(g.player.maxHp, g.player.hp + 24); }
    },
    {
      id: "nova",
      name: "NOVA 电容",
      text: "NOVA 充能和爆发伤害提升。",
      apply: (g) => { g.player.novaGain += .22; g.player.novaDamage += 35; }
    },
    {
      id: "crit",
      name: "棱镜暴击",
      text: "暴击率 +12%，暴击会释放额外火花。",
      apply: (g) => { g.player.crit = Math.min(.55, g.player.crit + .12); }
    },
    {
      id: "repair",
      name: "维修纳米云",
      text: "立即回复 38 护盾，受击无敌时间略增。",
      apply: (g) => { g.player.hp = Math.min(g.player.maxHp, g.player.hp + 38); g.player.iframesBonus += .06; }
    }
  ];

  class RayFrontier {
    constructor() {
      this.root = document.getElementById("frontier");
      this.canvas = document.getElementById("frontierCanvas");
      this.menu = this.root.querySelector("[data-menu]");
      this.loading = this.root.querySelector("[data-loading]");
      this.result = this.root.querySelector("[data-result]");
      this.upgrades = this.root.querySelector("[data-upgrades]");
      this.upgradeGrid = this.root.querySelector("[data-upgrade-grid]");
      this.stick = this.root.querySelector("[data-stick]");
      this.stickKnob = this.root.querySelector("[data-stick-knob]");
      this.hud = {
        hp: this.root.querySelector("[data-hp]"),
        hpBar: this.root.querySelector("[data-hp-bar]"),
        level: this.root.querySelector("[data-level]"),
        xpBar: this.root.querySelector("[data-xp-bar]"),
        wave: this.root.querySelector("[data-wave]"),
        novaBar: this.root.querySelector("[data-nova-bar]"),
        score: this.root.querySelector("[data-score]"),
        weapon: this.root.querySelector("[data-weapon]"),
        save: this.root.querySelector("[data-save-status]")
      };
      this.quality = this.loadQuality();
      this.state = "menu";
      this.last = 0;
      this.raf = 0;
      this.time = 0;
      this.cloudSave = null;
      this.activePointer = null;
      this.input = { x: 0, z: 0, active: false };
      this.tmp = {
        v1: new THREE.Vector3(),
        v2: new THREE.Vector3(),
        q: new THREE.Quaternion(),
        m: new THREE.Matrix4()
      };
      this.nodes = {};
      this.enemies = [];
      this.bullets = [];
      this.enemyBullets = [];
      this.pickups = [];
      this.effects = [];
      this.buffs = [];
    }

    boot() {
      this.bindUI();
      this.initCloudSave();
      this.renderMenuStats();
      if (!this.hasWebGL()) {
        this.loading.classList.add("is-hidden");
        this.menu.classList.add("is-open");
        this.menu.querySelector(".menu-copy").textContent = "当前浏览器无法创建 WebGL 场景，请使用 iPhone 15+ Safari 或现代桌面浏览器。";
        return;
      }
      this.initThree();
      this.createWorld();
      this.resize();
      window.addEventListener("resize", () => this.resize());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && this.state === "playing") this.pause();
      });
      window.addEventListener("pagehide", () => this.pause());
      this.loading.classList.add("is-hidden");
      this.drawIdle();
    }

    hasWebGL() {
      try {
        const canvas = document.createElement("canvas");
        return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
      } catch (err) {
        return false;
      }
    }

    loadQuality() {
      const saved = localStorage.getItem("rayFrontier.quality") || "high";
      const modes = {
        low: { id: "low", label: "低", pixel: 1.2, particles: .65, maxEnemies: 32, shadows: false },
        mid: { id: "mid", label: "中", pixel: 1.7, particles: .9, maxEnemies: 44, shadows: false },
        high: { id: "high", label: "高", pixel: 2.45, particles: 1.25, maxEnemies: 60, shadows: false }
      };
      return modes[saved] || modes.high;
    }

    cycleQuality() {
      const next = this.quality.id === "high" ? "mid" : this.quality.id === "mid" ? "low" : "high";
      localStorage.setItem("rayFrontier.quality", next);
      this.quality = this.loadQuality();
      this.resize();
      UI && UI.toast && UI.toast(`画质：${this.quality.label}`);
    }

    initCloudSave() {
      if (!window.RayCloudSave || !Storage || !Storage.exportSave || !Storage.importSave) return;
      this.cloudSave = window.RayCloudSave.createClient({
        appId: "arcade",
        exportSave: Storage.exportSave,
        importSave: Storage.importSave,
        onStatus: (status) => {
          if (this.hud.save) this.hud.save.textContent = status.label || "本机存档";
        },
        debounceMs: 1600
      });
      Storage.setCloudClient(this.cloudSave);
      this.cloudSave.start();
    }

    bindUI() {
      this.root.querySelector("[data-start]").addEventListener("click", () => this.start());
      this.root.querySelector("[data-restart]").addEventListener("click", () => this.start());
      this.root.querySelector("[data-pause]").addEventListener("click", () => {
        if (this.state === "playing") this.pause();
        else if (this.state === "paused") this.resume();
      });
      this.root.querySelector("[data-quality]").addEventListener("click", () => this.cycleQuality());
      this.root.querySelector("[data-dash]").addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.tryDash();
      });
      this.root.querySelector("[data-nova]").addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.tryNova();
      });
      this.root.querySelector("[data-burst]").addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.tryBurst();
      });
      this.canvas.addEventListener("pointerdown", (ev) => this.onPointerDown(ev));
      window.addEventListener("pointermove", (ev) => this.onPointerMove(ev));
      window.addEventListener("pointerup", (ev) => this.onPointerUp(ev));
      window.addEventListener("pointercancel", (ev) => this.onPointerUp(ev));
      window.addEventListener("mouseup", () => this.releaseStick());
      window.addEventListener("touchend", (ev) => { if (!ev.touches || ev.touches.length === 0) this.releaseStick(); }, { passive: true });
      window.addEventListener("touchcancel", (ev) => { if (!ev.touches || ev.touches.length === 0) this.releaseStick(); }, { passive: true });
      document.addEventListener("gesturestart", (ev) => ev.preventDefault(), { passive: false });
      document.addEventListener("touchmove", (ev) => ev.preventDefault(), { passive: false });
    }

    initThree() {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x050611);
      this.scene.fog = new THREE.FogExp2(0x050611, .026);
      this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, .1, 180);
      this.camera.position.set(0, 19.4, 22.4);
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        stencil: false,
        depth: true
      });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.22;
      this.renderer.shadowMap.enabled = false;
      this.materials = this.createMaterials();
      this.geometries = this.createGeometries();
    }

    createMaterials() {
      return {
        floor: new THREE.MeshStandardMaterial({
          color: 0x0a1230,
          emissive: 0x07142d,
          emissiveIntensity: .42,
          metalness: .2,
          roughness: .58,
          map: this.createFloorTexture()
        }),
        rail: new THREE.MeshBasicMaterial({ color: 0x35e5ff, transparent: true, opacity: .42 }),
        player: new THREE.MeshStandardMaterial({ color: 0xdffbff, emissive: 0x1daeff, emissiveIntensity: .55, metalness: .35, roughness: .24 }),
        playerAccent: new THREE.MeshStandardMaterial({ color: 0xff9be4, emissive: 0xff5fb7, emissiveIntensity: .52, metalness: .2, roughness: .28 }),
        weapon: new THREE.MeshStandardMaterial({ color: 0x65ffb4, emissive: 0x32ff9d, emissiveIntensity: .95, metalness: .4, roughness: .2 }),
        cyan: new THREE.MeshBasicMaterial({ color: 0x35e5ff, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        green: new THREE.MeshBasicMaterial({ color: 0x65ffb4, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        pink: new THREE.MeshBasicMaterial({ color: 0xff5fb7, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        amber: new THREE.MeshBasicMaterial({ color: 0xffd86b, transparent: true, opacity: .94, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        red: new THREE.MeshBasicMaterial({ color: 0xff345f, transparent: true, opacity: .96, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        purple: new THREE.MeshBasicMaterial({ color: 0xb34cff, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        pickupXp: new THREE.MeshBasicMaterial({ color: 0xffd86b, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        pickupWeapon: new THREE.MeshBasicMaterial({ color: 0x35e5ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        pickupHeal: new THREE.MeshBasicMaterial({ color: 0x65ffb4, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        enemyDrone: new THREE.MeshStandardMaterial({ color: 0xff4f78, emissive: 0x8c1235, emissiveIntensity: .62, metalness: .42, roughness: .27 }),
        enemyCaster: new THREE.MeshStandardMaterial({ color: 0x9b5cff, emissive: 0x4d1db5, emissiveIntensity: .74, metalness: .35, roughness: .25 }),
        enemyTank: new THREE.MeshStandardMaterial({ color: 0xd640ff, emissive: 0x5c126e, emissiveIntensity: .55, metalness: .45, roughness: .3 }),
        boss: new THREE.MeshStandardMaterial({ color: 0xff2d78, emissive: 0xaa063a, emissiveIntensity: .95, metalness: .5, roughness: .2 }),
        building: new THREE.MeshStandardMaterial({ color: 0x101a38, emissive: 0x07142d, emissiveIntensity: .3, metalness: .5, roughness: .55 }),
        crystal: new THREE.MeshStandardMaterial({ color: 0x2af5ff, emissive: 0x24e1ff, emissiveIntensity: 1.05, metalness: .1, roughness: .18, transparent: true, opacity: .78 })
      };
    }

    createGeometries() {
      return {
        sphere: new THREE.SphereGeometry(1, 18, 14),
        smallSphere: new THREE.SphereGeometry(.32, 12, 10),
        bullet: new THREE.SphereGeometry(.18, 10, 8),
        bulletGlow: new THREE.SphereGeometry(.42, 14, 10),
        pickupCore: new THREE.OctahedronGeometry(.48, 1),
        pickupGlow: new THREE.SphereGeometry(.78, 16, 12),
        beam: new THREE.CylinderGeometry(.035, .035, 2.8, 8),
        box: new THREE.BoxGeometry(1, 1, 1),
        cone: new THREE.ConeGeometry(1, 2, 6),
        cylinder: new THREE.CylinderGeometry(.55, .55, 1, 12),
        ring: new THREE.RingGeometry(.75, 1.05, 32),
        torus: new THREE.TorusGeometry(.74, .08, 8, 28),
        capsule: new THREE.CapsuleGeometry(.22, 1.05, 4, 8)
      };
    }

    createFloorTexture() {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 512;
      const x = c.getContext("2d");
      x.fillStyle = "#071027";
      x.fillRect(0, 0, 512, 512);
      x.strokeStyle = "rgba(53,229,255,.22)";
      x.lineWidth = 1;
      for (let i = 0; i <= 512; i += 32) {
        x.beginPath();
        x.moveTo(i, 0);
        x.lineTo(i, 512);
        x.moveTo(0, i);
        x.lineTo(512, i);
        x.stroke();
      }
      x.strokeStyle = "rgba(255,95,183,.18)";
      x.lineWidth = 2;
      for (let i = 0; i < 16; i += 1) {
        const y = 24 + i * 31;
        x.beginPath();
        x.moveTo(40, y);
        x.lineTo(170, y);
        x.lineTo(210, y + 18);
        x.lineTo(350, y + 18);
        x.stroke();
      }
      const texture = new THREE.CanvasTexture(c);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(10, 10);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    createWorld() {
      const hemi = new THREE.HemisphereLight(0xdffbff, 0x11132d, 2.4);
      this.scene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(-8, 18, 8);
      this.scene.add(key);
      const rim = new THREE.PointLight(0xff5fb7, 80, 48);
      rim.position.set(12, 11, -12);
      this.scene.add(rim);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140, 1, 1), this.materials.floor);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -.04;
      this.scene.add(floor);
      const grid = new THREE.GridHelper(92, 46, 0x35e5ff, 0x24385d);
      grid.position.y = .035;
      grid.material.transparent = true;
      grid.material.opacity = .46;
      this.scene.add(grid);
      this.createArenaLines();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(ARENA_RADIUS, .12, 8, 180), this.materials.rail);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = .08;
      this.scene.add(ring);
      this.createEnergyRails();
      this.createSkyfield();
      this.createStructures();
      this.nodes.player = this.createPlayerMesh();
      this.scene.add(this.nodes.player);
    }

    createArenaLines() {
      const positions = [];
      for (let i = 0; i < 18; i += 1) {
        const a = (i / 18) * TAU;
        positions.push(Math.cos(a) * 8, .07, Math.sin(a) * 8);
        positions.push(Math.cos(a) * 46, .07, Math.sin(a) * 46);
      }
      for (let r = 12; r <= 42; r += 10) {
        const steps = 72;
        for (let i = 0; i < steps; i += 1) {
          const a1 = (i / steps) * TAU;
          const a2 = ((i + .55) / steps) * TAU;
          positions.push(Math.cos(a1) * r, .075, Math.sin(a1) * r);
          positions.push(Math.cos(a2) * r, .075, Math.sin(a2) * r);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0x35e5ff,
        transparent: true,
        opacity: .32,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      this.nodes.arenaLines = new THREE.LineSegments(geo, mat);
      this.scene.add(this.nodes.arenaLines);
    }

    createEnergyRails() {
      const group = new THREE.Group();
      const rails = [
        { r: 10, c: this.materials.cyan, o: .24 },
        { r: 18, c: this.materials.green, o: .18 },
        { r: 29, c: this.materials.pink, o: .2 },
        { r: 38, c: this.materials.cyan, o: .18 }
      ];
      for (const rail of rails) {
        const mesh = new THREE.Mesh(new THREE.TorusGeometry(rail.r, .035, 6, 144), this.effectMaterial(rail.c, rail.o));
        mesh.rotation.x = Math.PI / 2;
        mesh.position.y = .12;
        mesh.renderOrder = 6;
        group.add(mesh);
      }
      const core = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, .08, 54), new THREE.MeshStandardMaterial({
        color: 0x091a31,
        emissive: 0x052844,
        emissiveIntensity: .62,
        metalness: .45,
        roughness: .42
      }));
      core.position.y = .02;
      group.add(core);
      this.nodes.energyRails = group;
      this.scene.add(group);
    }

    createSkyfield() {
      const count = 380;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        const r = rand(52, 88);
        const a = rand(0, TAU);
        positions[i * 3] = Math.cos(a) * r;
        positions[i * 3 + 1] = rand(8, 48);
        positions[i * 3 + 2] = Math.sin(a) * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({ color: 0xbff8ff, size: .18, transparent: true, opacity: .72, blending: THREE.AdditiveBlending });
      this.nodes.stars = new THREE.Points(geo, mat);
      this.scene.add(this.nodes.stars);
    }

    createStructures() {
      const count = 54;
      const inst = new THREE.InstancedMesh(this.geometries.box, this.materials.building, count);
      const mat = new THREE.Matrix4();
      for (let i = 0; i < count; i += 1) {
        const a = (i / count) * TAU + rand(-.08, .08);
        const r = rand(50, 67);
        const h = rand(4, 20);
        const sx = rand(1.4, 4.5);
        const sz = rand(1.4, 4.5);
        mat.compose(
          new THREE.Vector3(Math.cos(a) * r, h * .5 - .04, Math.sin(a) * r),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand(0, TAU), 0)),
          new THREE.Vector3(sx, h, sz)
        );
        inst.setMatrixAt(i, mat);
      }
      this.scene.add(inst);

      for (let i = 0; i < 18; i += 1) {
        const a = rand(0, TAU);
        const r = rand(18, 39);
        const crystal = new THREE.Mesh(this.geometries.cone, this.materials.crystal);
        crystal.position.set(Math.cos(a) * r, 1, Math.sin(a) * r);
        crystal.scale.setScalar(rand(.25, .62));
        crystal.rotation.y = rand(0, TAU);
        this.scene.add(crystal);
      }
    }

    createPlayerMesh() {
      const group = new THREE.Group();
      const body = new THREE.Mesh(this.geometries.sphere, this.materials.player);
      body.scale.set(.9, 1.05, .82);
      body.position.y = .9;
      group.add(body);
      const head = new THREE.Mesh(this.geometries.sphere, this.materials.player);
      head.scale.set(.62, .54, .58);
      head.position.set(0, 1.72, .06);
      group.add(head);
      const earL = new THREE.Mesh(this.geometries.capsule, this.materials.playerAccent);
      earL.position.set(-.32, 2.35, .02);
      earL.rotation.z = -.22;
      group.add(earL);
      const earR = earL.clone();
      earR.position.x = .32;
      earR.rotation.z = .22;
      group.add(earR);
      const core = new THREE.Mesh(this.geometries.torus, this.materials.weapon);
      core.rotation.x = Math.PI / 2;
      core.position.set(0, .94, -.08);
      group.add(core);
      const light = new THREE.PointLight(0x35e5ff, 7, 8);
      light.position.set(0, 1.5, 0);
      group.add(light);
      return group;
    }

    effectMaterial(base, opacity) {
      const mat = base.clone();
      mat.transparent = true;
      mat.opacity = opacity === undefined ? (base.opacity === undefined ? 1 : base.opacity) : opacity;
      mat.depthWrite = false;
      mat.toneMapped = false;
      return mat;
    }

    createProjectileMesh(kind, dir, crit) {
      const group = new THREE.Group();
      const hostile = kind === "enemy";
      const coreMat = hostile ? this.materials.red : crit ? this.materials.amber : this.materials.cyan;
      const glowMat = this.effectMaterial(hostile ? this.materials.purple : crit ? this.materials.amber : this.materials.cyan, hostile ? .34 : .24);
      const trailMat = this.effectMaterial(hostile ? this.materials.red : this.materials.cyan, hostile ? .52 : .36);
      const core = new THREE.Mesh(this.geometries.bullet, coreMat);
      core.scale.setScalar(hostile ? 2.25 : crit ? 1.9 : 1.55);
      const glow = new THREE.Mesh(this.geometries.bulletGlow, glowMat);
      glow.scale.setScalar(hostile ? 1.55 : 1.25);
      const trail = new THREE.Mesh(this.geometries.box, trailMat);
      trail.scale.set(hostile ? .22 : .14, hostile ? .22 : .14, hostile ? 2.35 : 1.45);
      trail.position.z = hostile ? -.9 : -.62;
      const ring = new THREE.Mesh(this.geometries.torus, this.effectMaterial(hostile ? this.materials.purple : this.materials.cyan, hostile ? .62 : .42));
      ring.scale.setScalar(hostile ? .52 : .34);
      ring.rotation.x = Math.PI / 2;
      group.add(trail, glow, core, ring);
      group.position.y = hostile ? 1.22 : 1.05;
      group.rotation.y = Math.atan2(dir.x, dir.z);
      group.renderOrder = hostile ? 30 : 24;
      group.userData = { core, glow, trail, ring, hostile };
      return group;
    }

    createPickupMesh(type) {
      const mat = type === "weapon" ? this.materials.pickupWeapon : type === "heal" ? this.materials.pickupHeal : this.materials.pickupXp;
      const group = new THREE.Group();
      const core = new THREE.Mesh(type === "heal" ? this.geometries.sphere : this.geometries.pickupCore, mat);
      core.scale.setScalar(type === "xp" ? .72 : .92);
      const glow = new THREE.Mesh(this.geometries.pickupGlow, this.effectMaterial(mat, type === "xp" ? .18 : .24));
      glow.scale.setScalar(type === "xp" ? .92 : 1.22);
      const ring = new THREE.Mesh(this.geometries.torus, this.effectMaterial(mat, .72));
      ring.scale.setScalar(type === "xp" ? .58 : .78);
      ring.rotation.x = Math.PI / 2;
      const beam = new THREE.Mesh(this.geometries.beam, this.effectMaterial(mat, type === "xp" ? .28 : .42));
      beam.position.y = 1.15;
      beam.scale.set(type === "xp" ? .65 : 1, type === "xp" ? .7 : 1.1, type === "xp" ? .65 : 1);
      const crown = new THREE.Mesh(this.geometries.ring, this.effectMaterial(mat, type === "xp" ? .38 : .54));
      crown.position.y = type === "xp" ? 1.3 : 1.72;
      crown.scale.setScalar(type === "xp" ? .44 : .62);
      crown.rotation.x = -Math.PI / 2;
      group.add(beam, glow, core, ring, crown);
      group.position.y = type === "xp" ? .74 : .92;
      group.renderOrder = 28;
      group.userData = { core, glow, ring, beam, crown, pickupType: type };
      return group;
    }

    resetGame() {
      this.clearRuntimeObjects();
      this.player = {
        hp: 120,
        maxHp: 120,
        level: 1,
        xp: 0,
        xpNext: 24,
        score: 0,
        chips: 0,
        speed: 7.2,
        damage: 18,
        fireDelay: .32,
        effectiveFireDelay: .32,
        fireTimer: .08,
        weaponLevel: 1,
        multishot: 1,
        pierce: 0,
        pickupRange: 4.2,
        crit: .06,
        nova: 18,
        novaGain: 1,
        novaDamage: 120,
        dashDelay: 1.8,
        dashTimer: 0,
        dashTime: 0,
        dashDir: new THREE.Vector3(0, 0, -1),
        iframe: 0,
        iframesBonus: 0,
        burstTimer: 0,
        pos: new THREE.Vector3(0, 0, 0),
        aim: new THREE.Vector3(0, 0, -1)
      };
      this.wave = 1;
      this.waveSpawnLeft = 0;
      this.waveSpawnTimer = .35;
      this.waveRest = 0;
      this.comboTimer = 0;
      this.kills = 0;
      this.time = 0;
      this.input.x = 0;
      this.input.z = 0;
      this.setStick(0, 0);
      this.nodes.player.position.set(0, 0, 0);
      this.nodes.player.rotation.set(0, 0, 0);
      this.beginWave(1);
      this.updateHud();
    }

    clearRuntimeObjects() {
      for (const list of [this.enemies, this.bullets, this.enemyBullets, this.pickups, this.effects]) {
        for (const item of list) {
          if (item.mesh) this.scene.remove(item.mesh);
        }
        list.length = 0;
      }
      this.buffs.length = 0;
    }

    start() {
      if (!this.scene) return;
      this.result.hidden = true;
      this.result.classList.remove("is-open");
      this.menu.classList.remove("is-open");
      this.upgrades.hidden = true;
      this.resetGame();
      Storage && Storage.notePlay && Storage.notePlay("frontier");
      pulse("light");
      this.state = "playing";
      this.last = performance.now();
      this.loop(this.last);
    }

    pause() {
      if (this.state !== "playing") return;
      this.state = "paused";
      this.releaseStick();
      UI && UI.toast && UI.toast("Ray Frontier 已暂停");
    }

    resume() {
      if (this.state !== "paused") return;
      this.state = "playing";
      this.last = performance.now();
      this.loop(this.last);
    }

    drawIdle() {
      this.nodes.player.rotation.y += .01;
      this.camera.position.lerp(new THREE.Vector3(0, 19.4, 22.4), .05);
      this.camera.lookAt(0, 1.05, -5.8);
      this.renderer.render(this.scene, this.camera);
      if (this.state === "menu") requestAnimationFrame(() => this.drawIdle());
    }

    loop(now) {
      if (this.state !== "playing") return;
      const dt = Math.min(.033, Math.max(.001, (now - this.last) / 1000));
      this.last = now;
      this.update(dt);
      this.render();
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }

    resize() {
      if (!this.renderer) return;
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixel));
      this.renderer.setSize(w, h, false);
    }

    beginWave(wave) {
      this.wave = wave;
      this.waveSpawnLeft = 12 + wave * 5 + (wave % 5 === 0 ? 1 : 0);
      this.waveSpawnTimer = wave === 1 ? .05 : .4;
      this.waveRest = 0;
      UI && UI.toast && UI.toast(`第 ${wave} 波敌潮接近`);
      if (wave > 1) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 10);
        this.player.nova = Math.min(100, this.player.nova + 12);
      }
    }

    update(dt) {
      this.time += dt;
      this.updatePlayer(dt);
      this.updateSpawns(dt);
      this.updateEnemies(dt);
      this.updateBullets(dt);
      this.updatePickups(dt);
      this.updateEffects(dt);
      this.updateBuffs(dt);
      this.updateCamera(dt);
      this.updateHud();
      if (this.nodes.stars) this.nodes.stars.rotation.y += dt * .018;
      if (this.nodes.arenaLines) this.nodes.arenaLines.rotation.y += dt * .012;
      if (this.nodes.energyRails) this.nodes.energyRails.rotation.y -= dt * .01;
    }

    updatePlayer(dt) {
      const p = this.player;
      p.fireTimer -= dt;
      p.dashTimer = Math.max(0, p.dashTimer - dt);
      p.burstTimer = Math.max(0, p.burstTimer - dt);
      p.iframe = Math.max(0, p.iframe - dt);
      let speed = p.speed;
      const move = this.tmp.v1.set(this.input.x, 0, this.input.z);
      if (p.dashTime > 0) {
        p.dashTime -= dt;
        move.copy(p.dashDir);
        speed = 22;
      } else if (move.lengthSq() > 1) {
        move.normalize();
      }
      if (move.lengthSq() > .0001) {
        p.pos.addScaledVector(move, speed * dt);
        p.aim.lerp(move, .14).normalize();
      }
      const len = Math.hypot(p.pos.x, p.pos.z);
      if (len > WORLD_LIMIT) {
        p.pos.x = p.pos.x / len * WORLD_LIMIT;
        p.pos.z = p.pos.z / len * WORLD_LIMIT;
      }
      this.nodes.player.position.copy(p.pos);
      const target = this.nearestEnemy();
      if (target) {
        p.aim.set(target.mesh.position.x - p.pos.x, 0, target.mesh.position.z - p.pos.z).normalize();
      }
      const yaw = Math.atan2(p.aim.x, p.aim.z);
      this.nodes.player.rotation.y = THREE.MathUtils.lerp(this.nodes.player.rotation.y, yaw, .18);
      this.nodes.player.position.y = Math.sin(this.time * 6) * .08;
      this.nodes.player.children[2].rotation.y = Math.sin(this.time * 8) * .1;
      this.nodes.player.children[3].rotation.y = -Math.sin(this.time * 8) * .1;
      if (p.fireTimer <= 0) {
        this.fireWeapon(false);
        p.fireTimer = p.effectiveFireDelay || p.fireDelay;
      }
    }

    updateSpawns(dt) {
      const maxActive = Math.min(this.quality.maxEnemies, 8 + this.wave * 3);
      if (this.waveSpawnLeft > 0) {
        this.waveSpawnTimer -= dt;
        if (this.waveSpawnTimer <= 0 && this.enemies.length < maxActive) {
          const batch = this.wave % 5 === 0 && this.waveSpawnLeft === 1 ? 1 : clamp(Math.floor(this.wave / 3) + 2, 2, 5);
          for (let i = 0; i < batch && this.waveSpawnLeft > 0; i += 1) {
            const type = this.nextEnemyType();
            this.spawnEnemy(type);
            this.waveSpawnLeft -= 1;
          }
          this.waveSpawnTimer = clamp(.95 - this.wave * .035, .22, .95);
        }
      } else if (this.enemies.length === 0) {
        this.waveRest += dt;
        if (this.waveRest > 1.3) this.beginWave(this.wave + 1);
      }
    }

    nextEnemyType() {
      if (this.wave % 5 === 0 && this.waveSpawnLeft === 1) return "boss";
      const bag = ["drone", "drone", "striker"];
      if (this.wave >= 2) bag.push("caster");
      if (this.wave >= 3) bag.push("tank");
      if (this.wave >= 6) bag.push("caster", "striker", "tank");
      return pick(bag);
    }

    spawnEnemy(type) {
      const cfg = ENEMY_TABLE[type];
      const a = rand(0, TAU);
      const r = rand(this.wave === 1 ? 12 : 22, this.wave === 1 ? 24 : 39);
      const mesh = this.createEnemyMesh(type);
      mesh.position.set(this.player.pos.x + Math.cos(a) * r, 0, this.player.pos.z + Math.sin(a) * r);
      this.scene.add(mesh);
      this.enemies.push({
        type,
        mesh,
        hp: cfg.hp + this.wave * (type === "boss" ? 120 : 8),
        maxHp: cfg.hp + this.wave * (type === "boss" ? 120 : 8),
        speed: cfg.speed + Math.min(1.6, this.wave * .08),
        radius: cfg.radius,
        damage: cfg.damage,
        score: cfg.score,
        shoot: rand(.8, 2.2),
        hitFlash: 0,
        contact: 0
      });
    }

    createEnemyMesh(type) {
      const group = new THREE.Group();
      const mat = type === "boss" ? this.materials.boss : type === "caster" ? this.materials.enemyCaster : type === "tank" ? this.materials.enemyTank : this.materials.enemyDrone;
      const body = new THREE.Mesh(this.geometries.sphere, mat);
      body.scale.setScalar(type === "boss" ? 2.35 : type === "tank" ? 1.28 : .86);
      body.position.y = type === "boss" ? 1.65 : .84;
      group.add(body);
      const core = new THREE.Mesh(this.geometries.torus, type === "caster" ? this.materials.pink : this.materials.red);
      core.rotation.x = Math.PI / 2;
      core.position.y = body.position.y;
      core.scale.setScalar(type === "boss" ? 1.8 : .82);
      group.add(core);
      if (type === "boss") {
        for (let i = 0; i < 6; i += 1) {
          const spike = new THREE.Mesh(this.geometries.cone, this.materials.red);
          const a = (i / 6) * TAU;
          spike.position.set(Math.cos(a) * 1.9, 1.5, Math.sin(a) * 1.9);
          spike.rotation.z = Math.PI / 2;
          spike.rotation.y = -a;
          spike.scale.set(.38, .75, .38);
          group.add(spike);
        }
        const light = new THREE.PointLight(0xff2d78, 16, 12);
        light.position.y = 2;
        group.add(light);
      }
      return group;
    }

    updateEnemies(dt) {
      const p = this.player;
      for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
        const e = this.enemies[i];
        const pos = e.mesh.position;
        const toPlayer = this.tmp.v1.set(p.pos.x - pos.x, 0, p.pos.z - pos.z);
        const d = Math.max(.001, toPlayer.length());
        toPlayer.multiplyScalar(1 / d);
        const orbit = this.tmp.v2.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(e.type === "caster" ? Math.sin(this.time + i) * .35 : 0);
        pos.addScaledVector(toPlayer.add(orbit).normalize(), e.speed * dt);
        e.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
        e.mesh.position.y = Math.sin(this.time * (e.type === "boss" ? 2 : 4) + i) * .08;
        e.mesh.children[1].rotation.z += dt * (e.type === "boss" ? 3.5 : 6);
        e.hitFlash = Math.max(0, e.hitFlash - dt);
        e.contact = Math.max(0, e.contact - dt);

        if ((e.type === "caster" || e.type === "boss") && d < 26) {
          e.shoot -= dt;
          if (e.shoot <= 0) {
            this.enemyShoot(e, toPlayer);
            e.shoot = e.type === "boss" ? rand(.95, 1.45) : rand(1.35, 2.3);
          }
        }
        if (d < e.radius + .82 && e.contact <= 0) {
          this.damagePlayer(e.damage);
          e.contact = .65;
        }
      }
    }

    enemyShoot(enemy, dir) {
      if (enemy.type === "boss") {
        for (let i = 0; i < 10; i += 1) {
          const a = (i / 10) * TAU + this.time * .25;
          this.spawnEnemyBullet(enemy.mesh.position, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 9.2, 12);
        }
      } else {
        this.spawnEnemyBullet(enemy.mesh.position, dir, 10.5, 11);
      }
      pulse("warning");
    }

    spawnEnemyBullet(from, dir, speed, damage) {
      const aim = dir.clone().normalize();
      const mesh = this.createProjectileMesh("enemy", aim, false);
      mesh.position.set(from.x, mesh.position.y, from.z);
      this.scene.add(mesh);
      this.enemyBullets.push({
        mesh,
        vel: aim.multiplyScalar(speed),
        damage,
        life: 4
      });
    }

    nearestEnemy() {
      let best = null;
      let bestD = Infinity;
      for (const e of this.enemies) {
        const d = dist2(e.mesh.position, this.player.pos);
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      return best;
    }

    fireWeapon(force) {
      const p = this.player;
      const target = this.nearestEnemy();
      if (!target && !force) return;
      const base = target
        ? new THREE.Vector3(target.mesh.position.x - p.pos.x, 0, target.mesh.position.z - p.pos.z).normalize()
        : p.aim.clone().normalize();
      const count = force ? Math.max(3, p.multishot + 2) : p.multishot;
      const spread = count === 1 ? 0 : .13;
      for (let i = 0; i < count; i += 1) {
        const offset = (i - (count - 1) / 2) * spread;
        const dir = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), offset);
        const crit = Math.random() < p.crit;
        const mesh = this.createProjectileMesh("player", dir, crit);
        mesh.position.set(p.pos.x + dir.x * .7, mesh.position.y, p.pos.z + dir.z * .7);
        this.scene.add(mesh);
        this.bullets.push({
          mesh,
          vel: dir.multiplyScalar(force ? 24 : 21),
          damage: (p.damage + (force ? 10 : 0)) * (crit ? 1.9 : 1),
          pierce: p.pierce + (force ? 1 : 0),
          life: force ? 1.2 : 1.05,
          crit
        });
      }
    }

    updateBullets(dt) {
      for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
        const b = this.bullets[i];
        b.life -= dt;
        b.mesh.position.addScaledVector(b.vel, dt);
        if (b.mesh.userData.ring) b.mesh.userData.ring.rotation.z += dt * 10;
        if (b.mesh.userData.glow) {
          const s = 1 + Math.sin(this.time * 20 + i) * .12;
          b.mesh.userData.glow.scale.setScalar(b.crit ? 1.42 * s : 1.18 * s);
        }
        let remove = b.life <= 0;
        for (let j = this.enemies.length - 1; j >= 0 && !remove; j -= 1) {
          const e = this.enemies[j];
          const rr = e.radius + .42;
          if (dist2(b.mesh.position, e.mesh.position) <= rr * rr) {
            this.damageEnemy(e, b.damage, b.crit);
            b.pierce -= 1;
            remove = b.pierce < 0;
          }
        }
        if (remove) this.removeItem(this.bullets, i);
      }
      for (let i = this.enemyBullets.length - 1; i >= 0; i -= 1) {
        const b = this.enemyBullets[i];
        b.life -= dt;
        b.mesh.position.addScaledVector(b.vel, dt);
        if (b.mesh.userData.ring) b.mesh.userData.ring.rotation.z -= dt * 12;
        if (b.mesh.userData.glow) {
          const s = 1.52 + Math.sin(this.time * 18 + i) * .18;
          b.mesh.userData.glow.scale.setScalar(s);
        }
        let remove = b.life <= 0;
        if (!remove && dist2(b.mesh.position, this.player.pos) < 1.15) {
          this.damagePlayer(b.damage);
          remove = true;
        }
        if (remove) this.removeItem(this.enemyBullets, i);
      }
    }

    damageEnemy(enemy, amount, crit) {
      enemy.hp -= amount;
      enemy.hitFlash = .08;
      this.addSpark(enemy.mesh.position, crit ? this.materials.amber : this.materials.cyan, crit ? 12 : 6);
      if (crit) this.addRing(enemy.mesh.position, this.materials.amber, 1.8);
      if (enemy.hp <= 0) this.killEnemy(enemy);
    }

    killEnemy(enemy) {
      const idx = this.enemies.indexOf(enemy);
      if (idx >= 0) this.enemies.splice(idx, 1);
      this.scene.remove(enemy.mesh);
      this.player.score += enemy.score + this.wave * 2;
      this.player.nova = Math.min(100, this.player.nova + (enemy.type === "boss" ? 28 : 4.5) * this.player.novaGain);
      this.kills += 1;
      this.dropLoot(enemy.mesh.position, enemy.type);
      this.addExplosion(enemy.mesh.position, enemy.type === "boss" ? 22 : 9, enemy.type === "boss" ? this.materials.pink : this.materials.green);
      if (enemy.type === "boss") {
        this.player.score += this.wave * 60;
        this.dropLoot(enemy.mesh.position, "boss");
        UI && UI.toast && UI.toast("Boss 核心已击碎");
      }
    }

    damagePlayer(amount) {
      const p = this.player;
      if (p.iframe > 0 || p.dashTime > 0) return;
      p.hp = Math.max(0, p.hp - amount);
      p.iframe = .55 + p.iframesBonus;
      this.addRing(p.pos, this.materials.red, 2.3);
      pulse("warning");
      if (p.hp <= 0) this.gameOver();
    }

    dropLoot(pos, type) {
      const base = type === "boss" ? 10 : type === "tank" ? 3 : 1;
      for (let i = 0; i < base; i += 1) {
        this.spawnPickup("xp", pos, type === "boss" ? 16 : 7);
      }
      if (type === "boss" || Math.random() < .16) this.spawnPickup("weapon", pos, 1);
      if (Math.random() < .12) this.spawnPickup("heal", pos, 1);
    }

    spawnPickup(type, pos, value) {
      const mesh = this.createPickupMesh(type);
      mesh.position.set(pos.x + rand(-1.35, 1.35), mesh.position.y, pos.z + rand(-1.35, 1.35));
      this.scene.add(mesh);
      this.pickups.push({ type, mesh, value, life: 18, bob: rand(0, TAU) });
    }

    updatePickups(dt) {
      const p = this.player;
      for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
        const item = this.pickups[i];
        item.life -= dt;
        item.bob += dt * 5;
        item.mesh.rotation.y += dt * (item.type === "xp" ? 3.5 : 4.8);
        item.mesh.position.y = (item.type === "xp" ? .82 : 1.02) + Math.sin(item.bob) * .18;
        if (item.mesh.userData.ring) item.mesh.userData.ring.rotation.z += dt * 4.2;
        if (item.mesh.userData.crown) item.mesh.userData.crown.rotation.z -= dt * 3.4;
        if (item.mesh.userData.glow) {
          const s = (item.type === "xp" ? .92 : 1.24) + Math.sin(item.bob * 1.5) * .12;
          item.mesh.userData.glow.scale.setScalar(s);
        }
        const dSq = dist2(item.mesh.position, p.pos);
        const range = p.pickupRange;
        if (dSq < range * range) {
          const dir = this.tmp.v1.set(p.pos.x - item.mesh.position.x, 0, p.pos.z - item.mesh.position.z);
          const d = Math.max(.001, dir.length());
          item.mesh.position.addScaledVector(dir.multiplyScalar(1 / d), dt * (12 + (range - d) * 3));
        }
        if (dSq < 1.15 || item.life <= 0) {
          if (item.life > 0) this.collectPickup(item);
          this.removeItem(this.pickups, i);
        }
      }
    }

    collectPickup(item) {
      const p = this.player;
      if (item.type === "xp") {
        p.xp += item.value;
        p.chips += 1;
        p.score += 3;
        if (p.xp >= p.xpNext) this.levelUp();
      } else if (item.type === "heal") {
        p.hp = Math.min(p.maxHp, p.hp + 18);
        this.addRing(p.pos, this.materials.green, 1.7);
      } else {
        this.applyTempWeapon();
      }
      pulse("selection");
    }

    applyTempWeapon() {
      const p = this.player;
      const type = pick(["overdrive", "nova", "repair", "surge"]);
      if (type === "overdrive") {
        this.buffs.push({ type, life: 8, fireScale: .68 });
        UI && UI.toast && UI.toast("超频弹幕 8 秒");
      } else if (type === "nova") {
        p.nova = Math.min(100, p.nova + 32);
        UI && UI.toast && UI.toast("NOVA 充能 +32");
      } else if (type === "repair") {
        p.hp = Math.min(p.maxHp, p.hp + 30);
        UI && UI.toast && UI.toast("护盾修复 +30");
      } else {
        this.buffs.push({ type, life: 7, damage: 9 });
        p.damage += 9;
        UI && UI.toast && UI.toast("武器增幅 7 秒");
      }
    }

    updateBuffs(dt) {
      let fireScale = 1;
      for (let i = this.buffs.length - 1; i >= 0; i -= 1) {
        const buff = this.buffs[i];
        buff.life -= dt;
        if (buff.type === "overdrive") fireScale = Math.min(fireScale, buff.fireScale);
        if (buff.life <= 0) {
          if (buff.damage) this.player.damage -= buff.damage;
          this.buffs.splice(i, 1);
        }
      }
      this.player.effectiveFireDelay = this.player.fireDelay * fireScale;
      if (fireScale < 1 && this.player.fireTimer > this.player.effectiveFireDelay) this.player.fireTimer = this.player.effectiveFireDelay;
    }

    levelUp() {
      const p = this.player;
      p.xp -= p.xpNext;
      p.level += 1;
      p.xpNext = Math.floor(p.xpNext * 1.26 + 12);
      p.hp = Math.min(p.maxHp, p.hp + 18);
      this.state = "levelup";
      cancelAnimationFrame(this.raf);
      this.showUpgrades();
      pulse("success");
    }

    showUpgrades() {
      const choices = [];
      const bag = UPGRADES.slice();
      while (choices.length < 3 && bag.length) {
        const i = Math.floor(Math.random() * bag.length);
        choices.push(bag.splice(i, 1)[0]);
      }
      this.upgradeGrid.innerHTML = "";
      for (const up of choices) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "upgrade-card";
        button.innerHTML = `<strong>${up.name}</strong><span>${up.text}</span>`;
        button.addEventListener("click", () => {
          up.apply(this);
          this.upgrades.hidden = true;
          this.state = "playing";
          this.last = performance.now();
          this.loop(this.last);
          UI && UI.toast && UI.toast(up.name);
        });
        this.upgradeGrid.appendChild(button);
      }
      this.upgrades.hidden = false;
    }

    tryDash() {
      if (this.state !== "playing") return;
      const p = this.player;
      if (p.dashTimer > 0) return;
      const dir = this.tmp.v1.set(this.input.x, 0, this.input.z);
      if (dir.lengthSq() < .05) dir.copy(p.aim);
      else dir.normalize();
      p.dashDir.copy(dir);
      p.dashTime = .18;
      p.dashTimer = p.dashDelay;
      p.iframe = .24;
      this.addRing(p.pos, this.materials.cyan, 2.8);
      pulse("light");
    }

    tryNova() {
      if (this.state !== "playing" || this.player.nova < 100) return;
      this.player.nova = 0;
      const damage = this.player.novaDamage + this.wave * 10;
      for (const e of this.enemies.slice()) {
        const d = Math.sqrt(dist2(e.mesh.position, this.player.pos));
        if (d < 20) this.damageEnemy(e, damage * (1 - d / 28), true);
      }
      for (let i = this.enemyBullets.length - 1; i >= 0; i -= 1) this.removeItem(this.enemyBullets, i);
      this.addRing(this.player.pos, this.materials.pink, 7);
      this.addExplosion(this.player.pos, 36, this.materials.cyan);
      pulse("success");
    }

    tryBurst() {
      if (this.state !== "playing" || this.player.burstTimer > 0) return;
      this.player.burstTimer = 3.5;
      for (let i = 0; i < 6; i += 1) {
        this.player.aim.applyAxisAngle(new THREE.Vector3(0, 1, 0), TAU / 6);
        this.fireWeapon(true);
      }
      pulse("release");
    }

    updateCamera(dt) {
      const p = this.player.pos;
      const desired = this.tmp.v1.set(p.x, 19.4, p.z + 22.4);
      this.camera.position.lerp(desired, 1 - Math.pow(.001, dt));
      this.camera.lookAt(p.x, 1.05, p.z - 5.8);
    }

    render() {
      this.renderer.render(this.scene, this.camera);
    }

    updateHud() {
      if (!this.player) return;
      const p = this.player;
      this.hud.hp.textContent = Math.ceil(p.hp);
      this.hud.hpBar.style.width = `${clamp(p.hp / p.maxHp * 100, 0, 100)}%`;
      this.hud.level.textContent = p.level;
      this.hud.xpBar.style.width = `${clamp(p.xp / p.xpNext * 100, 0, 100)}%`;
      this.hud.wave.textContent = this.wave;
      this.hud.novaBar.style.width = `${clamp(p.nova, 0, 100)}%`;
      this.hud.score.textContent = `${Math.floor(p.score)} 分`;
      this.hud.weapon.textContent = `离子枪 Lv.${p.weaponLevel} · ${this.enemies.length} 敌`;
    }

    addSpark(pos, mat, count) {
      const n = Math.floor(count * this.quality.particles);
      for (let i = 0; i < n; i += 1) {
        const mesh = new THREE.Mesh(this.geometries.smallSphere, this.effectMaterial(mat, mat.opacity === undefined ? .9 : mat.opacity));
        mesh.position.set(pos.x, rand(.65, 1.4), pos.z);
        const a = rand(0, TAU);
        const speed = rand(4, 13);
        this.scene.add(mesh);
        this.effects.push({
          mesh,
          vel: new THREE.Vector3(Math.cos(a) * speed, rand(2, 7), Math.sin(a) * speed),
          life: rand(.28, .62),
          ttl: .62,
          spin: rand(-4, 4)
        });
      }
    }

    addExplosion(pos, count, mat) {
      this.addSpark(pos, mat, count);
      this.addRing(pos, mat, count > 20 ? 4.5 : 2.2);
    }

    addRing(pos, mat, scale) {
      const mesh = new THREE.Mesh(this.geometries.ring, this.effectMaterial(mat, mat.opacity === undefined ? .78 : mat.opacity));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(pos.x, .09, pos.z);
      mesh.scale.setScalar(.2);
      this.scene.add(mesh);
      this.effects.push({ mesh, ring: true, life: .38, ttl: .38, targetScale: scale });
    }

    updateEffects(dt) {
      for (let i = this.effects.length - 1; i >= 0; i -= 1) {
        const e = this.effects[i];
        e.life -= dt;
        const a = clamp(e.life / e.ttl, 0, 1);
        if (e.ring) {
          const s = e.targetScale * (1 - a);
          e.mesh.scale.setScalar(Math.max(.1, s));
          e.mesh.material.opacity = a * .76;
        } else {
          e.mesh.position.addScaledVector(e.vel, dt);
          e.vel.y -= dt * 9;
          e.mesh.scale.setScalar(.55 + a);
          e.mesh.material.opacity = a;
          e.mesh.rotation.y += e.spin * dt;
        }
        if (e.life <= 0) this.removeItem(this.effects, i);
      }
    }

    removeItem(list, index) {
      const item = list[index];
      if (item && item.mesh) this.scene.remove(item.mesh);
      list.splice(index, 1);
    }

    onPointerDown(ev) {
      if (this.state !== "playing" || this.activePointer !== null || ev.target.closest(".action-btn")) return;
      if (ev.clientX > window.innerWidth * .58) return;
      ev.preventDefault();
      this.activePointer = ev.pointerId;
      this.stickOrigin = { x: ev.clientX, y: ev.clientY };
      this.stick.style.left = `${ev.clientX - 63}px`;
      this.stick.style.bottom = `${window.innerHeight - ev.clientY - 63}px`;
      this.onPointerMove(ev);
    }

    onPointerMove(ev) {
      if (ev.pointerId !== this.activePointer || !this.stickOrigin) return;
      const dx = ev.clientX - this.stickOrigin.x;
      const dy = ev.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      const max = 48;
      const nx = len > max ? dx / len * max : dx;
      const ny = len > max ? dy / len * max : dy;
      this.input.x = clamp(nx / max, -1, 1);
      this.input.z = clamp(ny / max, -1, 1);
      this.setStick(nx, ny);
    }

    onPointerUp(ev) {
      if (ev.pointerId !== this.activePointer) return;
      this.releaseStick();
    }

    releaseStick() {
      this.activePointer = null;
      this.stickOrigin = null;
      this.input.x = 0;
      this.input.z = 0;
      this.setStick(0, 0);
    }

    setStick(x, y) {
      this.stickKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    }

    gameOver() {
      if (this.state === "gameover") return;
      this.state = "gameover";
      cancelAnimationFrame(this.raf);
      this.releaseStick();
      const p = this.player;
      Storage && Storage.updateBest && Storage.updateBest("frontier", {
        bestScore: Math.floor(p.score),
        bestWave: this.wave,
        bestLevel: p.level,
        bestChips: p.chips
      });
      if (UI && UI.achievement) {
        if (this.wave >= 5) UI.achievement("frontier-wave5", "Ray Frontier 击退 5 波");
        if (p.level >= 8) UI.achievement("frontier-level8", "边境武器同步 Lv.8");
        if (Math.floor(p.score) >= 5000) UI.achievement("frontier-5000", "边境积分 5000");
      }
      if (Storage && Storage.flushCloudSave) Storage.flushCloudSave({ force: true });
      this.renderResult();
      pulse("warning");
    }

    renderResult() {
      const p = this.player;
      this.result.querySelector("[data-result-title]").textContent = "突围结束";
      this.result.querySelector("[data-result-copy]").textContent = `你撑到第 ${this.wave} 波，武器同步到 Lv.${p.level}，回收 ${p.chips} 枚芯片。`;
      this.result.querySelector("[data-result-stats]").innerHTML = `
        <div class="menu-stat"><span>分数</span><strong>${Math.floor(p.score)}</strong></div>
        <div class="menu-stat"><span>波次</span><strong>${this.wave}</strong></div>
        <div class="menu-stat"><span>击破</span><strong>${this.kills}</strong></div>
      `;
      this.result.hidden = false;
      this.result.classList.add("is-open");
      this.renderMenuStats();
    }

    renderMenuStats() {
      const stats = Storage && Storage.getStats ? Storage.getStats().frontier || {} : {};
      const node = this.root.querySelector("[data-menu-stats]");
      node.innerHTML = `
        <div class="menu-stat"><span>最高分</span><strong>${stats.bestScore || 0}</strong></div>
        <div class="menu-stat"><span>最远波次</span><strong>${stats.bestWave || 0}</strong></div>
        <div class="menu-stat"><span>最高等级</span><strong>${stats.bestLevel || 0}</strong></div>
      `;
    }
  }

  const app = new RayFrontier();
  window.RayFrontierApp = app;
  app.boot();
})();
