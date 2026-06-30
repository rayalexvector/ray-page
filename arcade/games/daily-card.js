(function () {
  "use strict";

  const UI = window.RayArcade.UI;
  const Storage = window.RayArcade.Storage;
  window.RayGames = window.RayGames || {};

  const RARITY_ORDER = { N: 1, R: 2, SR: 3, SSR: 4, UR: 5 };
  const CARDS = [
    { id: "fish-index", rarity: "N", emoji: "🐟", title: "今日摸鱼指数", text: () => `摸鱼指数 ${60 + Math.floor(Math.random() * 39)}%。适合把任务切成三口小鱼干。` },
    { id: "paw-break", rarity: "N", emoji: "🐾", title: "猫爪短休", text: "伸个懒腰，喝口水，Ray Cat 允许你慢一点。" },
    { id: "bubble", rarity: "N", emoji: "💬", title: "摸鱼气泡", text: "今日关键词：轻轻处理，不要硬刚。" },
    { id: "ai-energy", rarity: "R", emoji: "▣", title: "今日 AI 能量", text: () => `AI 能量 ${40 + Math.floor(Math.random() * 60)} 点。适合让 Agent 帮你整理思路。` },
    { id: "toilet-oracle", rarity: "R", emoji: "🔮", title: "今日厕所神谕", text: "灵感会在你不盯着屏幕时出现。记得洗手，也记得保存。" },
    { id: "ray-cat", rarity: "R", emoji: "😺", title: "Ray Cat 卡", text: "一只会在碎片时间跳上云端的霓虹猫。" },
    { id: "hermes", rarity: "SR", emoji: "🪽", title: "Hermes 卡", text: "消息传得很快，摸鱼撤退更快。" },
    { id: "codex", rarity: "SR", emoji: "⌘", title: "Codex 卡", text: "它把 TODO 写成了已完成的样子，但你最好再检查一遍。" },
    { id: "ray-agent", rarity: "SSR", emoji: "🤖", title: "Ray Agent 卡", text: "自动规划摸鱼路线，顺便把正事排进日程。" },
    { id: "neon-ball", rarity: "SSR", emoji: "🟣", title: "霓虹球核心", text: "弹一下，烦恼少一格；多弹几下，方块自己碎。" },
    { id: "cat-god", rarity: "UR", emoji: "👑", title: "隐藏猫神卡", text: "猫神代理人已上线：今日所有碎片时间都值得被温柔对待。" },
    { id: "secret-ray", rarity: "UR", emoji: "✨", title: "Ray 隐藏彩蛋", text: "你抽到了一个只属于本地浏览器的好运气。" }
  ];

  function pickByWeight() {
    const roll = Math.random() * 100;
    let rarity = "N";
    if (roll >= 99) rarity = "UR";
    else if (roll >= 94) rarity = "SSR";
    else if (roll >= 82) rarity = "SR";
    else if (roll >= 55) rarity = "R";
    const pool = CARDS.filter((c) => c.rarity === rarity);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function cardText(card) {
    return typeof card.text === "function" ? card.text() : card.text;
  }

  class DailyCard {
    constructor(host, services) {
      this.host = host;
      this.services = services;
      this.current = null;
      this.currentText = "";
      this.paused = false;
    }

    mount() {
      this.host.innerHTML = `
        <div class="daily-wrap">
          <section class="daily-hero">
            <h2>今日抽卡</h2>
            <p class="card-desc">每天 3 抽，收集 Ray Cat、Hermes、Codex 和隐藏猫神卡。</p>
          </section>
          <div class="daily-stats">
            <div class="daily-stat"><span class="stat-label">今日剩余</span><strong class="stat-value" data-left>3</strong></div>
            <div class="daily-stat"><span class="stat-label">图鉴</span><strong class="stat-value" data-collected>0/12</strong></div>
            <div class="daily-stat"><span class="stat-label">最稀有</span><strong class="stat-value" data-rarest>-</strong></div>
          </div>
          <div class="card-stage">
            <div class="gacha-card" data-card>
              <div class="gacha-face gacha-front">
                <div class="gacha-emoji">😺</div>
                <div class="gacha-title">Ray Cat</div>
                <p class="gacha-text">点击抽卡，翻开今天的摸鱼能量。</p>
              </div>
              <div class="gacha-face gacha-back" data-back>
                <span class="gacha-rarity">?</span>
                <div class="gacha-emoji">✨</div>
                <div class="gacha-title">等待翻开</div>
                <p class="gacha-text">好运正在加载。</p>
              </div>
            </div>
          </div>
          <div class="gacha-actions">
            <button class="primary-btn" data-draw>抽一张 Ray Cat 卡</button>
            <button class="secondary-btn" data-gallery>查看图鉴</button>
          </div>
        </div>
      `;
      this.host.querySelector("[data-draw]").addEventListener("click", () => this.drawCard());
      this.host.querySelector("[data-gallery]").addEventListener("click", () => this.showGallery());
      this.renderStats();
    }

    start() {
      Storage.notePlay("dailyCard");
      this.renderStats();
    }

    restart() {
      this.current = null;
      this.currentText = "";
      this.resetCardFace();
      this.renderStats();
      UI.toast("卡面已收起，今日次数不会重置");
    }

    pause() { this.paused = true; }
    resume() { this.paused = false; }
    destroy() { this.host.innerHTML = ""; }

    resetCardFace() {
      const cardEl = this.host.querySelector("[data-card]");
      if (cardEl) cardEl.classList.remove("flipped");
      const back = this.host.querySelector("[data-back]");
      if (back) {
        back.innerHTML = `
          <span class="gacha-rarity">?</span>
          <div class="gacha-emoji">✨</div>
          <div class="gacha-title">等待翻开</div>
          <p class="gacha-text">好运正在加载。</p>
        `;
      }
    }

    drawCard() {
      const cards = Storage.getCards();
      if (cards.draws >= 3) {
        UI.beep("bad");
        UI.vibrate([20, 30, 20]);
        UI.toast("今天 3 抽用完啦，明天再来摸");
        return;
      }
      const card = pickByWeight();
      const text = cardText(card);
      this.current = card;
      this.currentText = text;
      cards.draws += 1;
      cards.collection[card.id] = (cards.collection[card.id] || 0) + 1;
      cards.history.unshift({ id: card.id, rarity: card.rarity, title: card.title, date: Storage.todayKey(), ts: Date.now() });
      cards.history = cards.history.slice(0, 60);
      Storage.saveCards(cards);
      const stats = Storage.getStats();
      stats.dailyCard.totalDraws = (stats.dailyCard.totalDraws || 0) + 1;
      const currentRarest = stats.dailyCard.rarest || "";
      if (!currentRarest || RARITY_ORDER[card.rarity] > (RARITY_ORDER[currentRarest] || 0)) stats.dailyCard.rarest = card.rarity;
      Storage.saveStats(stats);
      this.reveal(card, text);
      this.renderStats();
      this.checkAchievements(cards);
      UI.beep(card.rarity === "UR" || card.rarity === "SSR" ? "win" : "ok");
      UI.vibrate(card.rarity === "UR" ? [30, 40, 30, 40, 30] : 22);
      if (card.rarity === "SSR" || card.rarity === "UR") UI.confetti(this.host, card.rarity === "UR" ? 36 : 22);
    }

    reveal(card, text) {
      const cardEl = this.host.querySelector("[data-card]");
      const back = this.host.querySelector("[data-back]");
      cardEl.classList.remove("flipped");
      back.innerHTML = `
        <span class="gacha-rarity">${card.rarity}</span>
        <div class="gacha-emoji">${card.emoji}</div>
        <div class="gacha-title">${UI.escapeHtml(card.title)}</div>
        <p class="gacha-text">${UI.escapeHtml(text)}</p>
      `;
      window.setTimeout(() => cardEl.classList.add("flipped"), 80);
    }

    renderStats() {
      const cards = Storage.getCards();
      const left = Math.max(0, 3 - cards.draws);
      const collected = Object.keys(cards.collection || {}).length;
      const rarities = Object.keys(cards.collection || {}).map((id) => {
        const c = CARDS.find((card) => card.id === id);
        return c ? c.rarity : "N";
      });
      const rarest = rarities.sort((a, b) => RARITY_ORDER[b] - RARITY_ORDER[a])[0] || "-";
      this.host.querySelector("[data-left]").textContent = String(left);
      this.host.querySelector("[data-collected]").textContent = `${collected}/${CARDS.length}`;
      this.host.querySelector("[data-rarest]").textContent = rarest;
      const drawBtn = this.host.querySelector("[data-draw]");
      if (drawBtn) drawBtn.textContent = left > 0 ? `抽一张 Ray Cat 卡（剩 ${left}）` : "今日已抽完";
    }

    showGallery() {
      const cards = Storage.getCards();
      const content = UI.el("div", "gallery-grid");
      CARDS.forEach((card) => {
        const count = cards.collection[card.id] || 0;
        const node = UI.el("div", `gallery-card${count ? "" : " locked"}`);
        node.innerHTML = `
          <div class="rarity">${card.rarity}${count ? ` ×${count}` : ""}</div>
          <div style="font-size:34px;line-height:1">${count ? card.emoji : "❔"}</div>
          <strong>${count ? UI.escapeHtml(card.title) : "未解锁"}</strong>
          <small>${count ? UI.escapeHtml(typeof card.text === "function" ? "每天文字会变化" : card.text) : "继续抽卡收集"}</small>
        `;
        content.appendChild(node);
      });
      UI.showModal({
        title: "Ray Cat 图鉴",
        content,
        actions: [{ label: "收起图鉴", kind: "primary" }]
      });
    }

    checkAchievements(cards) {
      const collection = cards.collection || {};
      if (Object.keys(collection).length >= 6) UI.achievement("cards-six", "收集 6 张卡");
      if (Object.keys(collection).length >= CARDS.length) UI.achievement("cards-full", "Ray Cat 全图鉴");
      if (collection["ray-cat"] && collection.hermes && collection.codex && collection["ray-agent"]) {
        UI.achievement("cards-agent-set", "Ray Agent 套装");
      }
      if (collection["cat-god"]) UI.achievement("cards-cat-god", "隐藏猫神现身");
    }
  }

  window.RayGames.DailyCard = DailyCard;
})();
