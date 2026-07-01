(function () {
  "use strict";

  const Storage = window.RayArcade.Storage;
  const UI = window.RayArcade.UI;
  const app = document.getElementById("app");

  const MERGE_NAMES = ["", "小鱼干", "猫爪", "Ray Cat", "摸鱼智能体", "Hermes", "Codex", "Ray Agent", "终极猫神代理人"];

  const ACHIEVEMENTS = {
    "catjump-100m": "Ray Cat 跳过 100m",
    "catjump-500": "小鱼干富翁",
    "rayhop-60": "Ray Hop 破 60 分",
    "rayhop-perfect5": "连续中心 5 连",
    "merge-agent": "合成 Ray Agent",
    "merge-catgod": "终极猫神代理人",
    "dungeon-15": "摸到地牢 15 层",
    "dungeon-rich": "地牢攒钱猫",
    "balls-20": "霓虹弹珠 20 回合",
    "balls-swarm": "一屏小球军团",
    "reaction-80": "Ray 级反应力",
    "reaction-combo-30": "连续摸鱼 30 连",
    "cards-six": "收集 6 张卡",
    "cards-full": "Ray Cat 全图鉴",
    "cards-agent-set": "Ray Agent 套装",
    "cards-cat-god": "隐藏猫神现身"
  };

  const GAMES = [
    {
      id: "catJump",
      title: "Ray Cat Jump",
      icon: "😺",
      subtitle: "拖动 Ray Cat，一路跳上霓虹云端。",
      cls: window.RayGames.CatJump,
      help: {
        title: "Ray Cat Jump 怎么玩",
        lines: [
          "按住屏幕左右拖动，控制 Ray Cat 落到平台上。",
          "越跳越高，吃小鱼干加分；弹簧平台会把你送更高。",
          "掉出屏幕下方就结束，失败后可马上重开。"
        ]
      }
    },
    {
      id: "rayHop",
      title: "Ray Hop",
      icon: "🧊",
      subtitle: "长按蓄力，松手跳到下一个发光星台。",
      cls: window.RayGames.RayHop,
      help: {
        title: "Ray Hop 星台跳怎么玩",
        lines: [
          "按住屏幕蓄力，松手后 Ray Cat 会沿虚线跳向下一个星台。",
          "蓄力越久跳得越远；落在星台中心会连续加分。",
          "鱼、MiMo、窄台有额外分，跳空就结束。"
        ]
      }
    },
    {
      id: "merge2048",
      title: "Ray Cat 合成器",
      icon: "🐾",
      subtitle: "滑动合成，从小鱼干升级到 Ray Agent。",
      cls: window.RayGames.Merge2048,
      help: {
        title: "Ray Cat 合成器怎么玩",
        lines: [
          "上下左右滑动棋盘，相同元素会合成升级。",
          "一路从小鱼干合成到 Ray Agent，解锁图鉴和彩蛋。",
          "棋盘满了且不能移动就结束。"
        ]
      }
    },
    {
      id: "dungeon",
      title: "一分钟地牢",
      icon: "🗝️",
      subtitle: "大按钮选择路线、战斗和道具，越摸越深。",
      cls: window.RayGames.Dungeon,
      help: {
        title: "一分钟地牢怎么玩",
        lines: [
          "点击按钮选择路线、战斗或道具，不用移动角色。",
          "尽量活得更久、走到更深层，顺手攒金币。",
          "HP 归零就结束，并获得本局摸鱼称号。"
        ]
      }
    },
    {
      id: "neonBalls",
      title: "霓虹弹珠",
      icon: "🟣",
      subtitle: "拖动瞄准线发射霓虹球，击碎数字方块。",
      cls: window.RayGames.NeonBalls,
      help: {
        title: "霓虹弹珠怎么玩",
        lines: [
          "拖动瞄准线，松手发射霓虹球。",
          "击碎数字方块，收集加球、穿透、爆炸和分裂道具。",
          "每回合方块下降一行，碰到底部就失败。"
        ]
      }
    },
    {
      id: "reaction",
      title: "摸鱼反应挑战",
      icon: "⭐",
      subtitle: "45 秒内点对目标，避开老板和 Bug。",
      cls: window.RayGames.Reaction,
      help: {
        title: "摸鱼反应挑战怎么玩",
        lines: [
          "看到猫爪、小鱼干、Ray 星星、AI 芯片和摸鱼气泡就点。",
          "避开老板、Bug、404、黑洞和闹钟。",
          "点对加分并叠连击，点错会扣时间、清空连击。"
        ]
      }
    },
    {
      id: "dailyCard",
      title: "今日抽卡",
      icon: "🔮",
      subtitle: "每天 3 抽，收集 Ray Cat 稀有卡和彩蛋。",
      cls: window.RayGames.DailyCard,
      help: {
        title: "今日抽卡怎么玩",
        lines: [
          "每天可以抽 3 次 Ray Cat 卡，点击抽卡并翻开卡片。",
          "收集 N、R、SR、SSR、UR 稀有卡和隐藏彩蛋。",
          "图鉴会永久保存在本机，不需要登录。"
        ]
      }
    },
    {
      id: "starfall",
      title: "Ray Cat 星港突围",
      icon: "🚀",
      subtitle: "霓虹弹幕、猫爪闪避、AI 芯片升级的竖屏动作 Roguelite。",
      externalUrl: "starfall/",
      help: {
        title: "Ray Cat 星港突围怎么玩",
        lines: [
          "这是完整独立动作游戏，会打开单独页面。",
          "按住屏幕拖动 Ray Cat 闪避弹幕，猫爪光弹会自动射击。",
          "收集芯片升级，使用闪避、护盾和 NOVA 挑战 Boss。"
        ]
      }
    }
  ];

  let currentGame = null;
  let currentMeta = null;
  let pauseModalOpen = false;
  let autoPaused = false;
  let cloudSave = null;
  let saveStatus = { state: "local", label: "💾 本机存档" };

  function updateSaveStatus(status) {
    saveStatus = Object.assign({}, saveStatus, status || {});
    const node = app.querySelector("[data-save-status]");
    if (node) {
      node.textContent = saveStatus.label || "💾 本机存档";
      node.dataset.state = saveStatus.state || "local";
    }
  }

  function initCloudSave() {
    if (cloudSave || !window.RayCloudSave || !Storage.exportSave || !Storage.importSave) return;
    cloudSave = window.RayCloudSave.createClient({
      appId: "arcade",
      exportSave: Storage.exportSave,
      importSave: Storage.importSave,
      onStatus: updateSaveStatus,
      debounceMs: 1600
    });
    Storage.setCloudClient(cloudSave);
    cloudSave.start();
  }

  function statText(game) {
    const stats = Storage.getStats();
    if (game.id === "catJump") {
      const s = stats.catJump;
      return `最高 ${s.bestHeight || 0}m · ${s.bestScore || 0} 分`;
    }
    if (game.id === "rayHop") {
      const s = stats.rayHop;
      return `最高 ${s.bestScore || 0} 分 · 中心 ${s.bestCombo || 0} 连`;
    }
    if (game.id === "merge2048") {
      const s = stats.merge2048;
      return `最高 ${s.bestScore || 0} 分 · ${MERGE_NAMES[s.bestLevel || 1] || "小鱼干"}`;
    }
    if (game.id === "dungeon") {
      const s = stats.dungeon;
      const title = (s.titles && s.titles[s.titles.length - 1]) || "未探索";
      return `最深 ${s.bestFloor || 0} 层 · ${title}`;
    }
    if (game.id === "neonBalls") {
      const s = stats.neonBalls;
      return `最高 ${s.bestRound || 0} 回合 · ${s.bestScore || 0} 分`;
    }
    if (game.id === "reaction") {
      const s = stats.reaction;
      return `最高 ${s.bestScore || 0} 分 · ${s.bestCombo || 0} 连击`;
    }
    if (game.id === "dailyCard") {
      const cards = Storage.getCards();
      return `今日剩 ${Math.max(0, 3 - cards.draws)} 抽 · 图鉴 ${Object.keys(cards.collection || {}).length}/12`;
    }
    if (game.id === "starfall") {
      return "独立动作 Roguelite · 本地存档";
    }
    return "准备开始";
  }

  function renderLobby() {
    if (currentGame) {
      currentGame.destroy();
      currentGame = null;
      currentMeta = null;
    }
    pauseModalOpen = false;
    autoPaused = false;
    const settings = Storage.getSettings();
    const achievements = Storage.getAchievements();
    const stats = Storage.getStats();
    app.innerHTML = `
      <section class="app-shell">
        <header class="lobby-hero">
          <div class="brand-row">
            <span class="brand-chip">🐾 Ray Toilet Arcade</span>
            <div class="hero-actions">
              <button class="icon-btn" data-sound aria-label="音效开关">${settings.sound ? "🔊" : "🔇"}</button>
              <button class="icon-btn" data-vibrate aria-label="振动开关">${settings.vibrate ? "📳" : "📴"}</button>
              <button class="icon-btn help-btn" data-achievements aria-label="成就">🏆</button>
            </div>
          </div>
          <h1 class="hero-title"><span class="neon-text">Ray Toilet Arcade</span></h1>
          <p class="hero-subtitle">8 个适合摸鱼时玩的手机小游戏。排队、休息、碎片时间，Ray Cat 陪你从轻量挑战一路突围到星港弹幕。</p>
          <div class="lobby-stats">
            <span class="stat-pill">🎮 ${stats.totalPlays || 0} 局</span>
            <span class="stat-pill">🏆 ${achievements.length}/${Object.keys(ACHIEVEMENTS).length} 成就</span>
            <span class="stat-pill save-pill" data-save-status data-state="${UI.escapeHtml(saveStatus.state || "local")}">${UI.escapeHtml(saveStatus.label || "💾 本机存档")}</span>
          </div>
        </header>
        <div class="lobby-list">
          <div class="game-grid" data-grid></div>
        </div>
      </section>
    `;

    const grid = app.querySelector("[data-grid]");
    GAMES.forEach((game) => {
      const card = UI.el("article", "game-card");
      card.innerHTML = `
        <div class="game-icon">${game.icon}</div>
        <div>
          <h2>${UI.escapeHtml(game.title)}</h2>
          <p class="card-desc">${UI.escapeHtml(game.subtitle)}</p>
          <div class="card-meta">${UI.escapeHtml(statText(game))}</div>
        </div>
        <div class="card-actions">
          <button class="primary-btn" data-start="${game.id}">${game.externalUrl ? "进入游戏" : "开始游戏"}</button>
        </div>
      `;
      grid.appendChild(card);
    });

    app.querySelectorAll("[data-start]").forEach((btn) => {
      btn.addEventListener("click", () => launchGame(btn.dataset.start));
    });
    app.querySelector("[data-sound]").addEventListener("click", () => {
      const now = !Storage.getSettings().sound;
      Storage.setSetting("sound", now);
      UI.beep("tap");
      renderLobby();
    });
    app.querySelector("[data-vibrate]").addEventListener("click", () => {
      const now = !Storage.getSettings().vibrate;
      Storage.setSetting("vibrate", now);
      UI.vibrate(20);
      renderLobby();
    });
    app.querySelector("[data-achievements]").addEventListener("click", showAchievements);
  }

  function showAchievements() {
    const unlocked = new Set(Storage.getAchievements());
    const content = UI.el("div");
    content.innerHTML = Object.keys(ACHIEVEMENTS).map((id) => {
      const ok = unlocked.has(id);
      return `
        <p style="display:flex;gap:10px;align-items:center;margin:0 0 9px">
          <span style="width:28px;height:28px;display:inline-grid;place-items:center;border-radius:999px;background:rgba(255,255,255,.08)">${ok ? "🏆" : "🔒"}</span>
          <span style="opacity:${ok ? "1" : ".55"}">${UI.escapeHtml(ACHIEVEMENTS[id])}</span>
        </p>
      `;
    }).join("");
    UI.showModal({
      title: "Ray 成就墙",
      content,
      actions: [
        { label: "关闭", kind: "primary" }
      ]
    });
  }

  function launchGame(id) {
    const meta = GAMES.find((game) => game.id === id);
    if (meta && meta.externalUrl) {
      UI.beep("ok");
      UI.vibrate(16);
      window.location.href = meta.externalUrl;
      return;
    }
    if (!meta || !meta.cls) {
      UI.toast("这个游戏暂时没有加载成功");
      return;
    }
    if (currentGame) currentGame.destroy();
    currentMeta = meta;
    app.innerHTML = `
      <section class="game-screen">
        <header class="game-topbar">
          <button class="back-btn" data-back>返回游戏厅</button>
          <div class="game-title-wrap">
            <h1 class="game-title">${UI.escapeHtml(meta.title)}</h1>
            <div class="game-mini">${UI.escapeHtml(meta.subtitle)}</div>
          </div>
          <button class="icon-btn restart-top" data-restart aria-label="重新开始">↻</button>
          <button class="icon-btn" data-pause aria-label="暂停">Ⅱ</button>
          <button class="icon-btn help-btn" data-help aria-label="帮助">?</button>
        </header>
        <div class="game-body" data-body></div>
      </section>
    `;
    const body = app.querySelector("[data-body]");
    currentGame = new meta.cls(body, {
      goHome: renderLobby,
      app,
      meta
    });
    currentGame.mount();

    app.querySelector("[data-back]").addEventListener("click", () => {
      UI.beep("tap");
      UI.vibrate(12);
      renderLobby();
    });
    app.querySelector("[data-restart]").addEventListener("click", () => {
      if (!currentGame) return;
      UI.beep("tap");
      UI.vibrate(14);
      currentGame.restart();
    });
    app.querySelector("[data-pause]").addEventListener("click", () => openPauseModal("Ray Cat 已暂停，手指休息一下。"));
    app.querySelector("[data-help]").addEventListener("click", () => {
      if (!currentGame || !currentMeta) return;
      currentGame.pause();
      UI.showGuide(currentMeta.help, false, () => currentGame && currentGame.resume());
    });

    const first = !Storage.isHelpSeen(meta.id);
    if (first) {
      UI.showGuide(meta.help, true, () => {
        Storage.markHelpSeen(meta.id);
        if (currentGame && currentMeta && currentMeta.id === meta.id) currentGame.start();
      });
    } else {
      currentGame.start();
    }
  }

  function openPauseModal(message) {
    if (!currentGame || pauseModalOpen) return;
    currentGame.pause();
    pauseModalOpen = true;
    UI.showModal({
      title: "暂停中",
      html: `<p>${UI.escapeHtml(message || "游戏已暂停。")}</p>`,
      actions: [
        { label: "继续", kind: "primary", onClick: (close) => { close(); pauseModalOpen = false; currentGame && currentGame.resume(); } },
        { label: "重开", kind: "secondary", onClick: (close) => { close(); pauseModalOpen = false; currentGame && currentGame.restart(); } },
        { label: "返回游戏厅", kind: "secondary", onClick: (close) => { close(); pauseModalOpen = false; renderLobby(); } }
      ],
      onClose: () => { pauseModalOpen = false; }
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (!currentGame) return;
    if (document.hidden) {
      autoPaused = true;
      currentGame.pause();
    } else if (autoPaused) {
      autoPaused = false;
      openPauseModal("刚刚已自动暂停，避免后台耗电。 ");
    }
  });

  window.addEventListener("pagehide", () => currentGame && currentGame.pause());
  window.addEventListener("blur", () => currentGame && currentGame.pause());

  document.addEventListener("gesturestart", (ev) => ev.preventDefault(), { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener("touchend", (ev) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 320) ev.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  initCloudSave();
  renderLobby();
})();
