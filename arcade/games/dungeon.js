(function () {
  "use strict";

  const UI = window.RayArcade.UI;
  const Storage = window.RayArcade.Storage;
  window.RayGames = window.RayGames || {};

  function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  class Dungeon {
    constructor(host, services) {
      this.host = host;
      this.services = services;
      this.state = null;
      this.monster = null;
      this.paused = false;
    }

    mount() {
      this.host.innerHTML = `
        <div class="dungeon-wrap">
          <div class="dungeon-stats">
            <div class="dungeon-stat"><span class="stat-label">HP</span><strong class="stat-value" data-hp>30/30</strong></div>
            <div class="dungeon-stat"><span class="stat-label">层数</span><strong class="stat-value" data-floor>0</strong></div>
            <div class="dungeon-stat"><span class="stat-label">金币</span><strong class="stat-value" data-gold>0</strong></div>
          </div>
          <section class="dungeon-panel">
            <h2 class="dungeon-event-title" data-title>一分钟地牢</h2>
            <p class="dungeon-text" data-text>Ray Cat 正在入口伸懒腰。</p>
            <div class="dungeon-log" data-log>点击开始，看看今天能摸到第几层。</div>
            <div class="choice-list" data-choices></div>
          </section>
        </div>
      `;
    }

    start() {
      Storage.notePlay("dungeon");
      this.restart();
    }

    restart() {
      this.clearResult();
      this.state = {
        hp: 32,
        maxHp: 32,
        atk: 6,
        def: 2,
        gold: 0,
        floor: 0,
        potions: 1,
        dodgeBonus: 0,
        alive: true
      };
      this.monster = null;
      this.paused = false;
      this.setEvent("入口小憩", "Ray Cat 把小鱼干别在腰间，准备摸进地牢。", `攻击 ${this.state.atk} · 防御 ${this.state.def} · 药水 ${this.state.potions}`, [
        { label: "出发下楼", action: () => this.nextFloor() }
      ]);
      this.updateStats();
    }

    pause() { this.paused = true; }
    resume() { this.paused = false; }
    destroy() { this.host.innerHTML = ""; }

    clearResult() {
      const node = this.host.querySelector(".result-panel");
      if (node) node.remove();
    }

    updateStats() {
      if (!this.state) return;
      const s = this.state;
      this.host.querySelector("[data-hp]").textContent = `${Math.max(0, s.hp)}/${s.maxHp}`;
      this.host.querySelector("[data-floor]").textContent = String(s.floor);
      this.host.querySelector("[data-gold]").textContent = String(s.gold);
    }

    setEvent(title, text, log, choices) {
      this.host.querySelector("[data-title]").textContent = title;
      this.host.querySelector("[data-text]").textContent = text;
      this.host.querySelector("[data-log]").textContent = log || "";
      const list = this.host.querySelector("[data-choices]");
      list.innerHTML = "";
      choices.forEach((choice) => {
        const btn = UI.el("button", "", choice.label);
        btn.addEventListener("click", () => {
          if (this.paused || !this.state.alive) return;
          UI.beep("tap");
          UI.vibrate(12);
          choice.action();
        });
        list.appendChild(btn);
      });
      this.updateStats();
    }

    nextFloor() {
      if (!this.state.alive) return;
      this.state.floor += 1;
      this.updateStats();
      if (this.state.floor % 5 === 0) return this.startBattle(true);
      const roll = Math.random();
      if (roll < 0.34) this.startBattle(false);
      else if (roll < 0.53) this.chestEvent();
      else if (roll < 0.69) this.doorEvent();
      else if (roll < 0.82) this.merchantEvent();
      else this.restEvent();
    }

    startBattle(boss) {
      const f = this.state.floor;
      const names = boss ? ["加班 Boss", "巨型 Bug", "404 龙"] : ["拖延史莱姆", "报错蝙蝠", "摸鱼守卫", "咖啡骷髅"];
      this.monster = {
        name: pick(names),
        hp: boss ? 22 + f * 3 : 10 + f * 2,
        maxHp: boss ? 22 + f * 3 : 10 + f * 2,
        atk: boss ? 5 + Math.floor(f / 2) : 3 + Math.floor(f / 3),
        def: boss ? 2 + Math.floor(f / 7) : Math.floor(f / 6),
        boss
      };
      this.renderBattle(`${this.monster.name} 挡住楼梯。`);
    }

    renderBattle(log) {
      const m = this.monster;
      const s = this.state;
      this.setEvent(
        m.boss ? `Boss：${m.name}` : `遭遇 ${m.name}`,
        `${m.name} HP ${Math.max(0, m.hp)}/${m.maxHp} · 攻击 ${m.atk}。你有药水 ${s.potions} 瓶。`,
        log,
        [
          { label: "攻击：稳稳拍一爪", action: () => this.playerAttack() },
          { label: "防御：缩进纸箱减伤", action: () => this.monsterTurn("你缩进纸箱，下一击伤害降低。", true) },
          { label: "闪避：侧身摸过去", action: () => this.dodge() },
          { label: `喝药：回复 10 HP（${s.potions}）`, action: () => this.usePotion() }
        ]
      );
    }

    playerAttack() {
      const s = this.state;
      const m = this.monster;
      const damage = Math.max(1, s.atk + randInt(-1, 2) - m.def);
      m.hp -= damage;
      if (m.hp <= 0) return this.winBattle(`你拍出 ${damage} 点伤害，${m.name} 化成一串报错。`);
      this.monsterTurn(`你造成 ${damage} 点伤害，${m.name} 还在加班。`, false);
    }

    monsterTurn(prefix, defending) {
      const s = this.state;
      const m = this.monster;
      let damage = Math.max(1, m.atk + randInt(-1, 2) - s.def);
      if (defending) damage = Math.max(0, Math.floor(damage * 0.38));
      s.hp -= damage;
      if (s.hp <= 0) return this.gameOver(`${prefix} ${m.name} 回敬 ${damage} 点伤害。`);
      this.renderBattle(`${prefix} ${m.name} 造成 ${damage} 点伤害。`);
    }

    dodge() {
      const chance = 0.42 + this.state.dodgeBonus;
      if (Math.random() < chance) {
        UI.beep("ok");
        this.renderBattle("闪避成功！Ray Cat 从工位缝隙里滑过去。");
      } else {
        this.monsterTurn("闪避失败，摸鱼被抓包。", false);
      }
    }

    usePotion() {
      const s = this.state;
      if (s.potions <= 0) {
        UI.beep("bad");
        return this.renderBattle("药水瓶空空如也，只剩一点猫毛。 ");
      }
      s.potions -= 1;
      s.hp = clamp(s.hp + 10, 0, s.maxHp);
      this.monsterTurn("你喝下荧光猫薄荷，回复 10 HP。", true);
    }

    winBattle(log) {
      const s = this.state;
      const m = this.monster;
      const gold = randInt(5, 9) + Math.floor(s.floor * (m.boss ? 1.8 : 0.8));
      s.gold += gold;
      if (m.boss) {
        s.maxHp += 4;
        s.hp = clamp(s.hp + 8, 0, s.maxHp);
        s.atk += 1;
        UI.confetti(this.host, 18);
      }
      if (Math.random() < 0.18) s.potions += 1;
      this.monster = null;
      UI.beep(m.boss ? "win" : "ok");
      this.setEvent("战斗胜利", "楼梯口亮起霓虹箭头。", `${log} 获得 ${gold} 金币。${m.boss ? "Boss 掉落：攻击 +1，最大 HP +4。" : ""}`, [
        { label: "继续深入", action: () => this.nextFloor() }
      ]);
    }

    chestEvent() {
      const cursed = Math.random() < 0.2;
      this.setEvent("发现宝箱", "箱子上贴着：打开可能会变强，也可能会加班。", "你听见里面有小鱼干晃动。", [
        { label: "打开宝箱", action: () => {
          if (cursed) {
            this.state.hp -= randInt(3, 7);
            if (this.state.hp <= 0) return this.gameOver("宝箱里弹出一个紧急需求。 ");
            this.setEvent("宝箱有坑", "里面是一个会咬人的需求。", "HP 下降，但你顺手摸到 8 金币。", [
              { label: "忍住继续", action: () => { this.state.gold += 8; this.nextFloor(); } }
            ]);
          } else {
            const reward = pick(["gold", "atk", "def", "potion", "hp"]);
            let log = "";
            if (reward === "gold") { const g = randInt(10, 22); this.state.gold += g; log = `获得 ${g} 金币。`; }
            if (reward === "atk") { this.state.atk += 1; log = "获得霓虹爪套，攻击 +1。"; }
            if (reward === "def") { this.state.def += 1; log = "获得纸箱护甲，防御 +1。"; }
            if (reward === "potion") { this.state.potions += 1; log = "获得猫薄荷药水 +1。"; }
            if (reward === "hp") { this.state.maxHp += 3; this.state.hp += 6; log = "吃到热乎小鱼干，最大 HP +3，回复 6。"; }
            UI.beep("ok");
            this.setEvent("宝箱真香", "Ray Cat 摸到一点好东西。", log, [
              { label: "收好下楼", action: () => this.nextFloor() }
            ]);
          }
        } },
        { label: "不贪，直接下楼", action: () => this.nextFloor() }
      ]);
    }

    merchantEvent() {
      this.setEvent("遇到商人", "商人猫戴着墨镜：只收金币，不收 KPI。", `你有 ${this.state.gold} 金币。`, [
        { label: "买药水 12 金币", action: () => this.buy("potion", 12) },
        { label: "升级攻击 18 金币", action: () => this.buy("atk", 18) },
        { label: "休息回血 10 金币", action: () => this.buy("heal", 10) },
        { label: "挥爪告别", action: () => this.nextFloor() }
      ]);
    }

    buy(type, cost) {
      const s = this.state;
      if (s.gold < cost) {
        UI.beep("bad");
        return this.setEvent("金币不够", "商人猫摇摇尾巴：摸鱼也要预算。", `还差 ${cost - s.gold} 金币。`, [
          { label: "继续逛", action: () => this.merchantEvent() },
          { label: "直接下楼", action: () => this.nextFloor() }
        ]);
      }
      s.gold -= cost;
      let log = "";
      if (type === "potion") { s.potions += 1; log = "获得药水 +1。"; }
      if (type === "atk") { s.atk += 1; log = "攻击 +1，爪子更亮了。"; }
      if (type === "heal") { s.hp = clamp(s.hp + 14, 0, s.maxHp); log = "回复 14 HP。"; }
      UI.beep("ok");
      this.setEvent("交易完成", "商人猫给你盖了一个霓虹爪印。", log, [
        { label: "继续购物", action: () => this.merchantEvent() },
        { label: "下楼", action: () => this.nextFloor() }
      ]);
    }

    doorEvent() {
      this.setEvent("两扇门", "左边闻起来像宝箱，右边听起来像 Bug。也可能反过来。", "选一扇，别想太久。", [
        { label: "走左门", action: () => this.resolveDoor() },
        { label: "走右门", action: () => this.resolveDoor() }
      ]);
    }

    resolveDoor() {
      const roll = Math.random();
      if (roll < 0.44) return this.startBattle(false);
      if (roll < 0.73) return this.chestEvent();
      this.state.hp -= randInt(2, 6);
      if (this.state.hp <= 0) return this.gameOver("门后是一个压缩包炸弹。 ");
      this.setEvent("小陷阱", "脚下弹出一条 404 横幅。", "HP 小幅下降，但还没耽误摸鱼。", [
        { label: "拍拍灰继续", action: () => this.nextFloor() }
      ]);
    }

    restEvent() {
      const heal = randInt(5, 10);
      this.state.hp = clamp(this.state.hp + heal, 0, this.state.maxHp);
      if (Math.random() < 0.25) this.state.dodgeBonus = Math.min(0.12, this.state.dodgeBonus + 0.03);
      this.setEvent("安全角落", "这里有 Wi-Fi、纸箱和一条温热小鱼干。", `回复 ${heal} HP。偶尔会变得更会闪避。`, [
        { label: "继续下楼", action: () => this.nextFloor() }
      ]);
    }

    titleForFloor(floor) {
      if (floor >= 25) return "猫神代理人";
      if (floor >= 18) return "Ray Agent 见习生";
      if (floor >= 12) return "地牢打工猫";
      if (floor >= 7) return "厕所勇者";
      return "摸鱼新人";
    }

    gameOver(extra) {
      if (!this.state.alive) return;
      this.state.alive = false;
      const title = this.titleForFloor(this.state.floor);
      Storage.updateBest("dungeon", { bestFloor: this.state.floor, bestGold: this.state.gold, titles: [title] });
      if (this.state.floor >= 15) UI.achievement("dungeon-15", "摸到地牢 15 层");
      if (this.state.gold >= 120) UI.achievement("dungeon-rich", "地牢攒钱猫");
      UI.beep("end");
      UI.vibrate([30, 45, 20]);
      UI.resultOverlay(this.host, {
        title,
        message: `${extra || "HP 归零，Ray Cat 被迫回工位。"} 最终到达 ${this.state.floor} 层，带走 ${this.state.gold} 金币。`,
        actions: [
          { label: "再摸一局", kind: "primary", beep: "ok", onClick: () => this.restart() },
          { label: "返回游戏厅", kind: "secondary", onClick: () => this.services.goHome() }
        ]
      });
    }
  }

  window.RayGames.Dungeon = Dungeon;
})();
