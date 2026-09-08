(function (root) {
  'use strict';
  class Scope {
    constructor() { this.generation = 0; this.resources = new Set(); }
    token() { const generation = this.generation; return () => generation === this.generation; }
    own(dispose) { this.resources.add(dispose); return () => this.resources.delete(dispose); }
    stop() {
      this.generation += 1;
      const resources = [...this.resources];
      this.resources.clear();
      for (const dispose of resources) { try { dispose(); } catch (_) {} }
    }
    async microphone(getMedia) {
      const valid = this.token();
      const stream = await getMedia();
      const stop = () => stream.getTracks().forEach(track => track.stop());
      if (!valid()) { stop(); return null; }
      this.own(stop);
      return stream;
    }
    async request(url, options = {}, timeout = 30000) {
      const valid = this.token();
      const controller = new AbortController();
      const release = this.own(() => controller.abort());
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const data = await response.json();
        if (!valid() || controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        return { response, data };
      } finally { clearTimeout(timer); release(); }
    }
  }
  // Includes completed out-of-order results in capacity, so a slow head cannot grow memory.
  class OrderedQueue {
    constructor({ work, commit, onError, onCapacity, concurrency = 2, capacity = 6, retries = 2, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
      Object.assign(this, { work, commit, onError, onCapacity, concurrency, capacity, retries, delay });
      this.items = []; this.running = 0; this.closed = false;
    }
    push(value) {
      if (this.closed || this.items.length >= this.capacity) return false;
      this.items.push({ value, state: 'waiting' }); this.pump(); return true;
    }
    stop() { this.closed = true; this.items = []; }
    pump() {
      if (this.closed) return;
      for (const item of this.items) {
        if (this.running >= this.concurrency) break;
        if (item.state !== 'waiting') continue;
        item.state = 'running'; this.running += 1; this.run(item);
      }
    }
    async run(item) {
      try {
        for (let attempt = 0; ; attempt++) {
          try { item.result = await this.work(item.value); break; }
          catch (error) {
            if (this.closed) return;
            if (!error.retryable || attempt >= this.retries) throw error;
            await this.delay(Math.min(30000, Math.max(error.retryAfter || 0, 1000 * 2 ** attempt)));
            if (this.closed) return;
          }
        }
        item.state = 'done';
      } catch (error) { item.error = error; item.state = 'done'; }
      finally {
        this.running -= 1;
        if (!this.closed) {
          while (this.items[0]?.state === 'done') {
            const head = this.items.shift();
            if (head.error) { this.onError(head.error, head.value); }
            else this.commit(head.result, head.value);
            if (this.closed) break;
          }
          if (!this.closed) { this.onCapacity?.(); this.pump(); }
        }
      }
    }
  }
  const chatKey = user => user?.id == null ? null : `ray:chat:v2:user:${encodeURIComponent(String(user.id))}`;
  const readChats = (storage, user) => {
    const key = chatKey(user);
    if (!key) return [];
    try {
      const items = JSON.parse(storage.getItem(key) || '[]');
      return Array.isArray(items) ? items.filter(item => item && typeof item.id === 'string' && Array.isArray(item.messages)) : [];
    } catch (_) { return []; }
  };
  async function buttonTask(button, work, onError) {
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try { return await work(); }
    catch (error) { onError(error); }
    finally { if (button) button.disabled = false; }
  }
  function manageModals(document, close) {
    const stack = [];
    const savedInert = new Map();
    let outsideFocus = document.activeElement;
    document.addEventListener('focusin', event => {
      if (!event.target.closest?.('[aria-modal="true"]')) outsideFocus = event.target;
    });
    const focusable = modal => [...modal.querySelectorAll('button, a[href], input, textarea, select, [tabindex]')]
      .filter(node => !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden]') && node.getClientRects().length);
    function sync() {
      for (const [node, inert] of savedInert) node.inert = inert;
      savedInert.clear();
      const visible = [...document.querySelectorAll('[aria-modal="true"]')].filter(node => !node.hidden);
      for (let i = stack.length - 1; i >= 0; i--) {
        if (!visible.includes(stack[i].modal)) {
          const [entry] = stack.splice(i, 1);
          entry.restore?.focus?.();
        }
      }
      for (const modal of visible) {
        if (stack.some(entry => entry.modal === modal)) continue;
        stack.push({ modal, restore: stack.at(-1)?.modal || outsideFocus });
        modal.tabIndex = -1;
        (focusable(modal)[0] || modal).focus();
      }
      const top = stack.at(-1)?.modal;
      if (top) for (const node of document.body.children) {
        if (node === top || node.contains(top) || node.tagName === 'SCRIPT') continue;
        savedInert.set(node, node.inert); node.inert = true;
      }
      document.body.classList.toggle('modal-open', Boolean(top));
    }
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    document.addEventListener('keydown', event => {
      const top = stack.at(-1)?.modal;
      if (!top) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); close(top); return;
      }
      if (event.key !== 'Tab') return;
      const nodes = focusable(top), first = nodes[0] || top, last = nodes.at(-1) || top;
      if (!top.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last) || !nodes.length) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }, true);
    sync();
  }
  const api = { Scope, OrderedQueue, chatKey, readChats, buttonTask, manageModals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HomeRuntime = api;
})(typeof window === 'undefined' ? globalThis : window);
