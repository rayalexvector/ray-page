const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const events = new Map();
  const document = {
    addEventListener(type, fn) { events.set(type, fn); },
    removeEventListener(type, fn) { if (events.get(type) === fn) events.delete(type); }
  };
  class Node {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attrs = {}; this.inert = false;
      this.tabIndex = tag === 'button' ? 0 : -1; this.handlers = {};
      this.classList = { toggle() {} };
    }
    appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
    setAttribute(name, value) { this.attrs[name] = value; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    get isConnected() { return document.body.contains(this); }
    getClientRects() { return this.hidden ? [] : [1]; }
    closest(selector) {
      if (selector === '[inert]') return this.inert ? this : this.parentNode?.closest(selector);
      return this.tagName === 'button' || this.tabIndex >= 0 ? this : this.parentNode?.closest(selector);
    }
    querySelectorAll() {
      return this.children.flatMap(node => [node, ...node.querySelectorAll()]).filter(node => node.tagName === 'button' || node.tabIndex >= 0);
    }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    click() { this.handlers.click?.({}); }
    focus() { document.activeElement = this; events.get('focusin')?.({ target: this }); }
    remove() { this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  }
  document.createElement = tag => new Node(tag);
  document.body = new Node('body'); document.documentElement = new Node('html');
  document.activeElement = document.body;
  let observe;
  const window = { RayArcade: { Storage: { getSettings: () => ({ sound: false, vibrate: false }) } } };
  vm.runInNewContext(fs.readFileSync('arcade/js/ui.js', 'utf8'), {
    window, document, navigator: {}, Date, Map, console,
    MutationObserver: class { constructor(fn) { observe = fn; } observe() {} disconnect() {} }
  });
  const background = document.body.appendChild(new Node('main'));
  const opener = background.appendChild(new Node('button')); opener.focus();
  const top = () => document.body.children.at(-1).children[0];
  const key = (key, shiftKey = false) => {
    let prevented = false, stopped = false;
    events.get('keydown')?.({ key, shiftKey, preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
    return { prevented, stopped };
  };
  return { UI: window.RayArcade.UI, document, Node, events, background, opener, top, key, sync: () => observe() };
}

test('modal labels, focuses, isolates background and restores prior inert state', () => {
  const h = harness();
  const preserved = h.document.body.appendChild(new h.Node('aside')); preserved.inert = true;
  let closed = 0;
  const close = h.UI.showModal({ title: 'Help', onClose: () => closed++ });
  const card = h.top();
  assert.equal(card.attrs.role, 'dialog'); assert.equal(card.attrs['aria-modal'], 'true');
  assert.equal(card.attrs['aria-labelledby'], card.children[0].children[0].id);
  assert.equal(h.document.activeElement, card); assert.equal(h.background.inert, true);
  const added = h.document.body.appendChild(new h.Node('button')); h.sync();
  assert.equal(added.inert, true);
  h.opener.focus(); assert.equal(card.contains(h.document.activeElement), true);
  close(); close();
  assert.equal(closed, 1); assert.equal(h.document.activeElement, h.opener);
  assert.equal(h.background.inert, false); assert.equal(preserved.inert, true); assert.equal(added.inert, false);
  assert.equal(h.events.has('keydown'), false);
});

test('Tab loops visible controls and Escape invokes the existing resume action once', () => {
  const h = harness(); let resumed = 0;
  const resume = close => { close(); resumed++; };
  h.UI.showModal({ onDismiss: resume, actions: [{ label: 'Resume', kind: 'primary', onClick: resume }] });
  const card = h.top(), first = card.children[0].children[1], last = card.children[2].children[0];
  assert.equal(h.key('Tab').prevented, true); assert.equal(h.document.activeElement, first);
  h.key('Tab', true); assert.equal(h.document.activeElement, last);
  h.key('Tab'); assert.equal(h.document.activeElement, first);
  assert.equal(h.key('ArrowLeft').stopped, true);
  h.key('Escape'); first.click();
  assert.equal(resumed, 1); assert.equal(h.document.activeElement, h.opener);
});

test('close icon completes guide callback and never implies consent to primary or danger actions', () => {
  const h = harness(); let completed = 0, destroyed = 0;
  h.UI.showGuide({ title: 'Guide', lines: [] }, false, () => completed++);
  h.top().children[0].children[1].click(); assert.equal(completed, 1);
  h.UI.showModal({ actions: [{ label: 'Delete', kind: 'danger', onClick: () => destroyed++ }] });
  h.key('Escape'); assert.equal(destroyed, 0); assert.equal(h.background.inert, false);
  h.UI.showModal({ actions: [{ label: 'Repair', kind: 'primary', onClick: () => destroyed++ }] });
  h.top().children[0].children[1].click(); assert.equal(destroyed, 0);
});

test('nested modal restores underlying focus and supports out-of-order closure', () => {
  const h = harness();
  const closeFirst = h.UI.showModal(); const first = h.top();
  const firstButton = first.children[2].children[0]; firstButton.focus();
  const closeSecond = h.UI.showModal();
  assert.equal(first.parentNode.inert, true);
  closeSecond(); assert.equal(first.parentNode.inert, false); assert.equal(h.document.activeElement, firstButton);
  const closeThird = h.UI.showModal(); closeFirst();
  assert.equal(h.background.inert, true); closeThird(); assert.equal(h.background.inert, false);
  assert.equal(h.document.activeElement, h.opener);
});

test('tap opener is restored when mobile Safari leaves focus on body', () => {
  const h = harness(); h.document.activeElement = h.document.body;
  h.events.get('pointerdown')({ target: h.opener });
  const close = h.UI.showModal(); close(); assert.equal(h.document.activeElement, h.opener);
});
