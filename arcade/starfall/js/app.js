(function(){
  'use strict';
  const NS = window.RayStarfall;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const canvas = $('#gameCanvas');
  const audio = new NS.AudioEngine();
  let game;
  let helpContext = { startAfter:false, resumeAfter:false };
  let cloudSave = null;
  let saveStatus = { state:'local', label:'💾 本机存档' };

  function updateSaveStatus(status){
    saveStatus = Object.assign({}, saveStatus, status || {});
    const node = $('#saveStatusText');
    if (node){
      node.textContent = saveStatus.label || '💾 本机存档';
      node.dataset.state = saveStatus.state || 'local';
    }
  }

  function initCloudSave(){
    if (cloudSave || !window.RayCloudSave || !NS.Store.exportSave || !NS.Store.importSave) return;
    cloudSave = window.RayCloudSave.createClient({
      appId: 'starfall',
      exportSave: NS.Store.exportSave,
      importSave: NS.Store.importSave,
      onStatus: updateSaveStatus,
      debounceMs: 1600
    });
    NS.Store.setCloudClient(cloudSave);
    cloudSave.start();
  }

  const screens = {
    home: $('#homeScreen'),
    pause: $('#pauseScreen'),
    gameOver: $('#gameOverScreen'),
    levelUp: $('#levelUpScreen'),
    shop: $('#shopScreen'),
    codex: $('#codexScreen'),
    settings: $('#settingsScreen'),
    help: $('#helpScreen')
  };
  const hudTop = $('#topHud');
  const hudBottom = $('#bottomHud');

  function hideAllOverlays(){
    [screens.pause, screens.gameOver, screens.levelUp, screens.shop, screens.codex, screens.settings, screens.help].forEach(el=>el.classList.add('hidden'));
  }

  function show(el){ el.classList.remove('hidden'); el.setAttribute && el.setAttribute('aria-hidden','false'); }
  function hide(el){ el.classList.add('hidden'); el.setAttribute && el.setAttribute('aria-hidden','true'); }

  function toast(message, type){
    const layer = $('#toastLayer');
    const div = document.createElement('div');
    div.className = 'toast' + (type ? ' '+type : '');
    div.textContent = message;
    layer.appendChild(div);
    setTimeout(()=>{ div.style.opacity = '0'; div.style.transform = 'translateY(-8px) scale(.97)'; }, 2600);
    setTimeout(()=> div.remove(), 3100);
  }

  function fmt(n){
    n = Math.floor(Number(n) || 0);
    if (n >= 1000000) return (n/1000000).toFixed(1)+'M';
    if (n >= 10000) return (n/10000).toFixed(1)+'万';
    return String(n);
  }

  function showHome(){
    hideAllOverlays();
    show(screens.home);
    hudTop.classList.add('hidden');
    hudBottom.classList.add('hidden');
    renderHomeStats();
  }

  function beginRun(){
    hideAllOverlays();
    hide(screens.home);
    hudTop.classList.remove('hidden');
    hudBottom.classList.remove('hidden');
    audio.resume();
    game.start();
  }

  function renderHomeStats(){
    const save = NS.Store.get();
    const unlocked = Object.keys(save.achievements || {}).length;
    $('#homeStats').innerHTML = `
      <div class="home-stat"><span>最高分</span><b>${fmt(save.stats.bestScore)}</b></div>
      <div class="home-stat"><span>最远波次</span><b>${save.stats.bestWave || 0}</b></div>
      <div class="home-stat"><span>星屑金币</span><b>${fmt(save.wallet.coins)}</b></div>
      <div class="home-stat"><span>成就解锁</span><b>${unlocked}/${NS.ACHIEVEMENTS.length}</b></div>
    `;
  }

  function showHelp(options){
    options = options || {};
    helpContext = { startAfter:!!options.startAfter, resumeAfter:!!options.resumeAfter };
    $('#startFromHelpBtn').textContent = helpContext.startAfter ? '开始游戏' : helpContext.resumeAfter ? '继续突围' : '我知道了';
    show(screens.help);
  }

  function finishHelp(){
    hide(screens.help);
    NS.Store.setHelpSeen(true);
    if (helpContext.startAfter) beginRun();
    else if (helpContext.resumeAfter) game.resume();
    helpContext = { startAfter:false, resumeAfter:false };
  }

  function renderLevelUp(choices){
    const box = $('#upgradeChoices');
    box.innerHTML = '';
    choices.forEach(c=>{
      const btn = document.createElement('button');
      btn.className = 'upgrade-card';
      btn.type = 'button';
      btn.innerHTML = `<span class="tag">${c.rarity}</span><strong>${c.name}</strong><p>${c.desc}</p>`;
      btn.addEventListener('pointerdown', ev => ev.stopPropagation());
      btn.addEventListener('click', () => {
        audio.sfx('upgrade');
        game.chooseUpgrade(c.id);
        hide(screens.levelUp);
      });
      box.appendChild(btn);
    });
    show(screens.levelUp);
  }

  function updateHud(s){
    $('#hpText').textContent = `${Math.max(0, Math.ceil(s.hp))}/${s.maxHp}`;
    $('#hpBar').style.transform = `scaleX(${Math.max(0, Math.min(1, s.hp / s.maxHp))})`;
    $('#waveText').textContent = s.wave;
    $('#scoreText').textContent = fmt(s.score);
    setSkill($('#dashBtn'), $('#dashCd'), s.skill.dash, s.skill.dashMax);
    setSkill($('#aegisBtn'), $('#aegisCd'), s.skill.aegis, s.skill.aegisMax);
    setSkill($('#novaBtn'), $('#novaCd'), s.skill.nova, s.skill.novaMax);
  }

  function setSkill(btn, label, cd, max){
    if (cd <= .05){
      btn.classList.add('ready'); btn.classList.remove('cooling'); label.textContent = '就绪';
    } else {
      btn.classList.remove('ready'); btn.classList.add('cooling'); label.textContent = Math.ceil(cd) + 's';
    }
  }

  function renderGameOver(result){
    $('#resultTitle').textContent = result.title;
    const best = NS.Store.get().stats;
    $('#resultStats').innerHTML = `
      <div class="result-card"><span>本局分数</span><b>${fmt(result.score)}</b></div>
      <div class="result-card"><span>抵达波次</span><b>${result.wave}</b></div>
      <div class="result-card"><span>存活时间</span><b>${NS.formatTime(result.time)}</b></div>
      <div class="result-card"><span>清理 Bug</span><b>${result.kills}</b></div>
      <div class="result-card"><span>带回金币</span><b>${result.coins}</b></div>
      <div class="result-card"><span>历史最高</span><b>${fmt(best.bestScore)}</b></div>
    `;
    show(screens.gameOver);
    renderHomeStats();
  }

  function renderShop(){
    const save = NS.Store.get();
    $('#walletText').textContent = `当前星屑金币：${fmt(save.wallet.coins)}`;
    const list = $('#shopItems');
    list.innerHTML = '';
    NS.SHOP_ITEMS.forEach(item=>{
      const lvl = save.upgrades[item.id] || 0;
      const max = item.max || 5;
      const cost = NS.Store.priceForUpgrade(item.id);
      const row = document.createElement('div');
      row.className = 'shop-item';
      const maxed = lvl >= max;
      row.innerHTML = `
        <div class="shop-icon">${item.icon}</div>
        <div class="shop-info"><strong>${item.name} Lv.${lvl}/${max}</strong><small>${item.desc}</small></div>
        <button class="buy-btn" type="button" ${maxed || save.wallet.coins < cost ? 'disabled' : ''}>${maxed ? '满级' : cost}</button>
      `;
      row.querySelector('.buy-btn').addEventListener('click', () => {
        const res = NS.Store.buyUpgrade(item.id, max);
        if (res.ok){
          audio.sfx('coin');
          toast(`${item.name} 升到 Lv.${res.level}`);
          if (res.level >= max) markMaxUpgrade();
        } else if (res.reason === 'coins') toast('星屑金币不够，再摸一局');
        renderShop(); renderHomeStats(); renderCodex();
      });
      list.appendChild(row);
    });
  }

  function markMaxUpgrade(){
    if (NS.Store.markAchievement('max_upgrade')){
      const a = NS.ACHIEVEMENTS.find(x=>x.id==='max_upgrade');
      onAchievement(a);
    }
  }

  function renderCodex(){
    const save = NS.Store.get();
    const unlocked = Object.keys(save.achievements || {}).length;
    $('#codexSummary').innerHTML = `
      <div class="codex-tile"><span>最高分</span><b>${fmt(save.stats.bestScore)}</b></div>
      <div class="codex-tile"><span>最长存活</span><b>${NS.formatTime(save.stats.bestTime || 0)}</b></div>
      <div class="codex-tile"><span>总清理 Bug</span><b>${fmt(save.stats.totalKills)}</b></div>
      <div class="codex-tile"><span>成就</span><b>${unlocked}/${NS.ACHIEVEMENTS.length}</b></div>
    `;
    const list = $('#achievementList');
    list.innerHTML = '';
    NS.ACHIEVEMENTS.forEach(a=>{
      const ok = !!save.achievements[a.id];
      const row = document.createElement('div');
      row.className = 'achievement-item' + (ok ? '' : ' locked');
      const when = ok ? new Date(save.achievements[a.id]).toLocaleDateString('zh-CN') : '未解锁';
      row.innerHTML = `<div class="ach-icon">${ok ? a.icon : '？'}</div><div class="achievement-info"><strong>${a.title}</strong><small>${a.desc}</small></div><small>${when}</small>`;
      list.appendChild(row);
    });
  }

  function syncSettings(){
    const s = NS.Store.getSettings();
    $('#soundToggle').checked = !!s.sound;
    $('#vibrateToggle').checked = !!s.vibrate;
    $('#calmToggle').checked = !!s.calm;
    document.body.classList.toggle('calm', !!s.calm);
    audio.setEnabled(!!s.sound);
  }

  function onAchievement(a){
    if (!a) return;
    audio.sfx('upgrade');
    toast(`${a.icon || '🏆'} 成就解锁：${a.title}`, 'achievement');
    renderHomeStats();
    renderCodex();
  }

  function handleState(state){
    if (state === 'playing'){
      hide(screens.pause); hide(screens.gameOver); hide(screens.levelUp); hide(screens.help);
      hide(screens.home);
      hudTop.classList.remove('hidden'); hudBottom.classList.remove('hidden');
    } else if (state === 'paused'){
      show(screens.pause);
    } else if (state === 'menu'){
      showHome();
    } else if (state === 'gameover'){
      hudTop.classList.add('hidden'); hudBottom.classList.add('hidden');
    } else if (state === 'levelUp'){
      show(screens.levelUp);
    }
  }

  function bindUI(){
    const tap = () => { audio.resume(); audio.sfx('tap'); };
    $$('button').forEach(btn => {
      btn.addEventListener('pointerdown', ev => { ev.stopPropagation(); tap(); }, { passive:true });
    });

    $('#startBtn').addEventListener('click', () => {
      if (!NS.Store.get().helpSeen) showHelp({ startAfter:true });
      else beginRun();
    });
    $('#homeHelpBtn').addEventListener('click', () => showHelp({ startAfter:false }));
    $('#startFromHelpBtn').addEventListener('click', finishHelp);
    $('#closeHelpBtn').addEventListener('click', finishHelp);

    $('#helpBtn').addEventListener('click', () => {
      if (game.state === 'playing'){
        game.pause();
        hide(screens.pause);
        showHelp({ resumeAfter:true });
      } else showHelp({ startAfter:false });
    });

    $('#pauseBtn').addEventListener('click', () => game.pause());
    $('#resumeBtn').addEventListener('click', () => game.resume());
    $('#restartFromPauseBtn').addEventListener('click', beginRun);
    $('#exitFromPauseBtn').addEventListener('click', () => game.returnToMenu());
    $('#quickRestartBtn').addEventListener('click', beginRun);
    $('#exitGameOverBtn').addEventListener('click', () => game.returnToMenu());

    $('#dashBtn').addEventListener('click', () => game.useDash());
    $('#aegisBtn').addEventListener('click', () => game.useAegis());
    $('#novaBtn').addEventListener('click', () => game.useNova());

    $('#shopBtn').addEventListener('click', () => { renderShop(); show(screens.shop); });
    $('#closeShopBtn').addEventListener('click', () => hide(screens.shop));
    $('#codexBtn').addEventListener('click', () => { renderCodex(); show(screens.codex); });
    $('#closeCodexBtn').addEventListener('click', () => hide(screens.codex));
    $('#settingsBtn').addEventListener('click', () => { syncSettings(); show(screens.settings); });
    $('#closeSettingsBtn').addEventListener('click', () => hide(screens.settings));

    $('#soundToggle').addEventListener('change', ev => { NS.Store.setSettings({ sound: ev.target.checked }); syncSettings(); });
    $('#vibrateToggle').addEventListener('change', ev => { NS.Store.setSettings({ vibrate: ev.target.checked }); syncSettings(); });
    $('#calmToggle').addEventListener('change', ev => { NS.Store.setSettings({ calm: ev.target.checked }); syncSettings(); });
    $('#resetSaveBtn').addEventListener('click', () => {
      if (!confirm('确定清空 Ray Cat Starfall 的本地存档吗？')) return;
      NS.Store.reset();
      syncSettings(); renderHomeStats(); renderCodex(); renderShop();
      toast('本地存档已清空');
      showHome();
    });

    document.addEventListener('gesturestart', ev => ev.preventDefault(), { passive:false });
    document.addEventListener('dblclick', ev => ev.preventDefault(), { passive:false });
  }

  function registerServiceWorker(){
    if (!('serviceWorker' in navigator)) return;
    const okOrigin = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!okOrigin) return;
    navigator.serviceWorker.register('./sw.js?v=cloudsave-2').catch(() => {});
  }

  function boot(){
    registerServiceWorker();
    syncSettings();
    bindUI();
    initCloudSave();
    game = new NS.Game(canvas, {
      updateHUD: updateHud,
      onLevelUp: renderLevelUp,
      onGameOver: renderGameOver,
      onAchievement: onAchievement,
      onState: handleState,
      toast
    }, audio);
    showHome();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
