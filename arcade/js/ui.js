(function () {
  "use strict";

  const UI = {};
  let audioCtx = null;
  let toastTimer = 0;
  let iosSwitchHaptic = null;
  let modalId = 0;
  const modalStack = [];
  const inertState = new Map();
  let modalObserver = null;
  let lastPointerOpener = null;
  let pointerTime = 0;

  // iOS does not always focus a button on tap. Remember the actual opener.
  document.addEventListener("pointerdown", (event) => {
    lastPointerOpener = event.target.closest("button, a[href], [role='button'], [tabindex]");
    pointerTime = Date.now();
  }, true);

  function modalFocusables(card) {
    return $all("button, a[href], input, select, textarea, [tabindex]", card)
      .filter((node) => !node.disabled && node.tabIndex >= 0 && !node.closest("[inert]") && node.getClientRects().length);
  }

  function syncModalBackground() {
    const top = modalStack[modalStack.length - 1];
    for (const node of document.body.children) {
      if (!inertState.has(node)) inertState.set(node, node.inert);
      node.inert = top ? node !== top.backdrop : inertState.get(node);
    }
    if (!top) {
      for (const [node, inert] of inertState) node.inert = inert;
      inertState.clear();
    }
    document.body.classList.toggle("arcade-modal-open", Boolean(top));
    document.documentElement.classList.toggle("arcade-modal-open", Boolean(top));
  }

  function modalKeydown(event) {
    const top = modalStack[modalStack.length - 1];
    if (!top) return;
    // Keep keyboard controls in the dialog, away from game-level listeners.
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      top.dismiss();
    } else if (event.key === "Tab") {
      const nodes = modalFocusables(top.card);
      const first = nodes[0] || top.card;
      const last = nodes[nodes.length - 1] || top.card;
      if (!top.card.contains(document.activeElement) || document.activeElement === top.card ||
          (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    }
  }

  function modalFocusin(event) {
    const top = modalStack[modalStack.length - 1];
    if (top && !top.card.contains(event.target)) {
      (modalFocusables(top.card)[0] || top.card).focus({ preventScroll: true });
    }
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function settings() {
    return window.RayArcade.Storage.getSettings();
  }

  function vibrate(pattern) {
    if (!settings().vibrate && pattern !== 0) return false;
    if (navigator.vibrate) {
      try { return navigator.vibrate(pattern === undefined ? 20 : pattern); } catch (err) { /* unsupported */ }
    }
    return false;
  }

  function isIOSWebKit() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    return /iP(hone|ad|od)/.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function ensureIOSSwitchHaptic() {
    if (iosSwitchHaptic && document.body.contains(iosSwitchHaptic.input)) return iosSwitchHaptic;
    if (!isIOSWebKit() || !document.body) return null;
    const id = "ray-ios-haptic-" + Math.random().toString(36).slice(2);
    const input = el("input");
    input.type = "checkbox";
    input.id = id;
    input.tabIndex = -1;
    input.setAttribute("switch", "");
    input.setAttribute("aria-hidden", "true");
    input.style.cssText = [
      "position:fixed",
      "left:50%",
      "top:50%",
      "width:44px",
      "height:44px",
      "opacity:.001",
      "transform:translate(-50%,-50%)",
      "pointer-events:none",
      "z-index:2147483647"
    ].join(";");
    const label = el("label", "", " ");
    label.htmlFor = id;
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = input.style.cssText;
    document.body.appendChild(input);
    document.body.appendChild(label);
    iosSwitchHaptic = { input, label };
    return iosSwitchHaptic;
  }

  function switchHaptic() {
    const pair = ensureIOSSwitchHaptic();
    if (!pair) return false;
    try {
      pair.label.click();
      return true;
    } catch (err) {
      return false;
    }
  }

  function stopHaptic() {
    const webkit = window.webkit && window.webkit.messageHandlers;
    const handlers = [
      window.RayHaptics,
      webkit && webkit.rayHaptic,
      webkit && webkit.haptic
    ];
    for (const handler of handlers) {
      try {
        if (!handler) continue;
        if (typeof handler.stop === "function") handler.stop();
        else if (typeof handler.postMessage === "function") handler.postMessage({ type: "stop" });
      } catch (err) { /* unsupported */ }
    }
    vibrate(0);
  }

  function haptic(kind) {
    if (kind === "stop") { stopHaptic(); return; }
    if (!settings().vibrate) return;
    const type = kind || "light";
    const impactType = {
      chargePulse: "light",
      chargePulseStrong: "medium",
      warning: "medium"
    }[type] || type;
    const payload = { type, impact: impactType };
    const webkit = window.webkit && window.webkit.messageHandlers;
    const handlers = [
      window.RayHaptics,
      webkit && webkit.rayHaptic,
      webkit && webkit.haptic
    ];
    for (const handler of handlers) {
      try {
        if (!handler) continue;
        if (typeof handler === "function") { handler(payload); return; }
        if (typeof handler.impact === "function") { handler.impact(impactType); return; }
        if (type === "selection" && typeof handler.selection === "function") { handler.selection(); return; }
        if (typeof handler.postMessage === "function") { handler.postMessage(payload); return; }
      } catch (err) { /* unsupported */ }
    }
    const table = {
      selection: 4,
      light: 7,
      charge: 5,
      chargePulse: [12, 68],
      chargePulseStrong: [18, 54],
      release: 12,
      success: [9, 18, 9],
      warning: [6, 18, 6]
    };
    if (!vibrate(table[type] || table.light)) switchHaptic(type);
  }

  function beep(kind) {
    if (!settings().sound) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const table = {
        tap: [520, 0.045, "triangle", 0.035],
        ok: [760, 0.075, "sine", 0.045],
        score: [980, 0.06, "sine", 0.04],
        bad: [150, 0.1, "sawtooth", 0.035],
        end: [220, 0.18, "triangle", 0.05],
        win: [1180, 0.16, "sine", 0.055]
      };
      const cfg = table[kind] || table.tap;
      osc.type = cfg[2];
      osc.frequency.setValueAtTime(cfg[0], now);
      if (kind === "win") osc.frequency.exponentialRampToValueAtTime(620, now + cfg[1]);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(cfg[3], now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + cfg[1]);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + cfg[1] + 0.02);
    } catch (err) {
      console.warn("RayArcade beep failed", err);
    }
  }

  function toast(message) {
    clearTimeout(toastTimer);
    let node = $(".toast");
    if (!node) {
      node = el("div", "toast");
      document.body.appendChild(node);
    }
    node.textContent = message;
    requestAnimationFrame(() => node.classList.add("show"));
    toastTimer = window.setTimeout(() => node.classList.remove("show"), 1800);
  }

  function confetti(root, count) {
    const host = root || document.body;
    const rect = host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const n = count || 24;
    for (let i = 0; i < n; i += 1) {
      const c = el("i", "confetti");
      const x = rect.left + rect.width / 2 + (Math.random() - .5) * 60;
      const y = rect.top + rect.height * .35;
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
      c.style.background = ["#25e4ff", "#ff4fd8", "#ffe66d", "#5dffb0"][i % 4];
      c.style.setProperty("--dx", `${(Math.random() - .5) * 240}px`);
      c.style.setProperty("--dy", `${80 + Math.random() * 210}px`);
      document.body.appendChild(c);
      window.setTimeout(() => c.remove(), 820);
    }
  }

  function showModal(options) {
    const opts = options || {};
    const opener = Date.now() - pointerTime < 500 && lastPointerOpener && lastPointerOpener.isConnected ? lastPointerOpener : document.activeElement;
    lastPointerOpener = null;
    const backdrop = el("div", "modal-backdrop");
    const card = el("section", "modal-card" + (opts.className ? " " + opts.className : ""));
    const head = el("div", "modal-head");
    const title = el("h2", "modal-title", opts.title || "Ray Arcade");
    const body = el("div", "modal-body");
    const actions = el("div", "modal-actions");
    const closeButton = el("button", "modal-close", "\u00d7");
    const actionList = opts.actions || [{ label: "我知道了", kind: "primary", value: true }];
    let closed = false;
    title.id = "arcade-modal-title-" + (++modalId);
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", title.id);
    card.tabIndex = -1;
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "关闭");

    head.appendChild(title);
    head.appendChild(closeButton);
    if (opts.html) body.innerHTML = opts.html;
    else if (opts.content) body.appendChild(opts.content);
    else body.textContent = opts.message || "";

    function close(result) {
      if (closed) return;
      closed = true;
      const wasTop = modalStack[modalStack.length - 1] === entry;
      modalStack.splice(modalStack.indexOf(entry), 1);
      for (const modal of modalStack) {
        if (backdrop.contains(modal.opener)) modal.opener = entry.opener;
      }
      backdrop.remove();
      syncModalBackground();
      if (!modalStack.length) {
        modalObserver.disconnect();
        modalObserver = null;
        document.removeEventListener("keydown", modalKeydown, true);
        document.removeEventListener("focusin", modalFocusin, true);
      }
      if (wasTop) {
        const top = modalStack[modalStack.length - 1];
        const restore = entry.opener;
        const target = restore && restore.isConnected && !restore.closest("[inert]") &&
          (!top || top.card.contains(restore)) ? restore : top && top.card;
        if (target) target.focus({ preventScroll: true });
      }
      if (opts.onClose) opts.onClose(result);
    }

    function runAction(act) {
      if (closed) return;
      if (act && act.onClick) act.onClick(close);
      else close(act && act.value);
    }

    function dismiss() {
      if (closed) return;
      // Dismissal is cancellation, never implicit consent to a primary action.
      if (opts.onDismiss) opts.onDismiss(close);
      else close();
    }

    const entry = { backdrop, card, dismiss, opener };
    closeButton.addEventListener("click", dismiss);
    actionList.forEach((act) => {
      const btn = el("button", act.kind === "secondary" ? "secondary-btn" : act.kind === "danger" ? "danger-btn" : "primary-btn", act.label);
      btn.type = "button";
      btn.addEventListener("click", () => {
        if (closed) return;
        beep(act.beep || "tap");
        vibrate(12);
        runAction(act);
      });
      actions.appendChild(btn);
    });

    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    modalStack.push(entry);
    if (!modalObserver) {
      modalObserver = new MutationObserver(syncModalBackground);
      modalObserver.observe(document.body, { childList: true });
      document.addEventListener("keydown", modalKeydown, true);
      document.addEventListener("focusin", modalFocusin, true);
    }
    syncModalBackground();
    card.focus({ preventScroll: true });
    return close;
  }

  function showGuide(meta, first, onDone) {
    const lines = (meta.lines || []).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    return showModal({
      title: meta.title || "怎么玩",
      html: lines,
      actions: [{ label: first ? "开始游戏" : "我知道了", kind: "primary", beep: "ok", value: true }],
      onClose: () => { if (onDone) onDone(); }
    });
  }

  function resultOverlay(host, opts) {
    const overlay = el("div", "result-panel");
    const card = el("div", "result-card");
    card.innerHTML = `
      <h2>${escapeHtml(opts.title || "游戏结束")}</h2>
      <p>${escapeHtml(opts.message || "")}</p>
      <div class="result-actions"></div>
    `;
    const actions = $(".result-actions", card);
    (opts.actions || []).forEach((act) => {
      const btn = el("button", act.kind === "secondary" ? "secondary-btn" : act.kind === "danger" ? "danger-btn" : "primary-btn", act.label);
      btn.addEventListener("click", () => {
        beep(act.beep || "tap");
        vibrate(18);
        if (act.close !== false) overlay.remove();
        if (act.onClick) act.onClick();
      });
      actions.appendChild(btn);
    });
    overlay.appendChild(card);
    host.appendChild(overlay);
    return overlay;
  }

  function fitCanvas(canvas, rect) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const box = rect || canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(box.width));
    const h = Math.max(1, Math.floor(box.height));
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: w, height: h, dpr };
  }

  function bindNoScroll(target) {
    ["touchstart", "touchmove", "touchend", "gesturestart"].forEach((name) => {
      target.addEventListener(name, (ev) => ev.preventDefault(), { passive: false });
    });
  }

  function achievement(id, label) {
    if (window.RayArcade.Storage.addAchievement(id)) {
      toast(`🏆 成就解锁：${label}`);
      beep("win");
      vibrate([25, 40, 25]);
      return true;
    }
    return false;
  }

  UI.$ = $;
  UI.$all = $all;
  UI.el = el;
  UI.escapeHtml = escapeHtml;
  UI.vibrate = vibrate;
  UI.haptic = haptic;
  UI.stopHaptic = stopHaptic;
  UI.beep = beep;
  UI.toast = toast;
  UI.confetti = confetti;
  UI.showModal = showModal;
  UI.showGuide = showGuide;
  UI.resultOverlay = resultOverlay;
  UI.fitCanvas = fitCanvas;
  UI.bindNoScroll = bindNoScroll;
  UI.achievement = achievement;

  window.RayArcade = window.RayArcade || {};
  window.RayArcade.UI = UI;
})();
