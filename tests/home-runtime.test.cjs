const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Scope, OrderedQueue, chatKey, readChats, buttonTask } = require('../home-runtime.js');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('delayed microphone permission stops every track after cancellation', async () => {
  const scope = new Scope(), pending = deferred();
  let stopped = 0;
  const operation = scope.microphone(() => pending.promise);
  scope.stop(); scope.stop();
  pending.resolve({ getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }] });
  assert.equal(await operation, null); assert.equal(stopped, 2);
});
test('scope stops tracks, recorders, contexts, timers and invalidates old callbacks', async () => {
  const scope = new Scope(), disposed = [];
  const valid = scope.token();
  for (const kind of ['track', 'recorder', 'context', 'timer']) scope.own(() => disposed.push(kind));
  scope.stop(); scope.stop();
  assert.equal(valid(), false); assert.equal(disposed.length, 4);
});
test('aborted fetch that ignores AbortSignal cannot return an old owner response', async () => {
  const oldFetch = global.fetch, pending = deferred(), scope = new Scope();
  let signal;
  global.fetch = (_, options) => { signal = options.signal; return pending.promise; };
  try {
    const request = scope.request('/private');
    scope.stop(); assert.equal(signal.aborted, true);
    pending.resolve({ json: async () => ({ private: 'A' }) });
    await assert.rejects(request, { name: 'AbortError' });
  } finally { global.fetch = oldFetch; }
});
test('stable ID keys isolate accounts and never read or claim ownerless history', () => {
  const legacy = JSON.stringify([{ id: 'old', messages: ['private'] }]);
  const map = new Map([['ray-mimo-chat-history-v1', legacy]]);
  const storage = { getItem: key => map.get(key) };
  assert.deepEqual(readChats(storage, { id: 'B' }), []);
  assert.equal(map.get('ray-mimo-chat-history-v1'), legacy);
  assert.equal(chatKey({ id: 'A', email: 'old' }), chatKey({ id: 'A', email: 'new' }));
  assert.notEqual(chatKey({ id: 'A' }), chatKey({ id: 'B' }));
  assert.deepEqual(readChats(storage, null), []);
});
test('queue is bounded including reordered results and commits in recording order', async () => {
  const pending = [deferred(), deferred(), deferred()], committed = [];
  const queue = new OrderedQueue({ capacity: 3, concurrency: 2, work: n => pending[n].promise, commit: n => committed.push(n), onError: assert.fail });
  assert.equal(queue.push(0), true); queue.push(1); queue.push(2);
  assert.equal(queue.push(3), false); assert.equal(queue.running, 2);
  pending[1].resolve(1); await tick();
  assert.deepEqual(committed, []); assert.equal(queue.push(3), false);
  pending[2].resolve(2); pending[0].resolve(0); await tick();
  assert.deepEqual(committed, [0, 1, 2]);
});
test('429 retry is bounded and cancellation prevents retry and late commits', async () => {
  let attempts = 0, errors = 0;
  const delays = [];
  const queue = new OrderedQueue({ work: async () => { attempts++; throw Object.assign(new Error('429'), { retryable: true }); }, delay: async ms => delays.push(ms), commit: assert.fail, onError: () => errors++ });
  queue.push(1); await tick();
  assert.equal(attempts, 3); assert.equal(errors, 1); assert.deepEqual(delays, [1000, 2000]);
  const pending = deferred();
  const cancelled = new OrderedQueue({ work: () => pending.promise, commit: assert.fail, onError: assert.fail });
  cancelled.push(1); cancelled.stop(); pending.resolve(1); await tick();
  assert.equal(cancelled.items.length, 0);
});
test('button restores after rejected request', async () => {
  const button = { disabled: false }; let failure;
  await buttonTask(button, async () => { assert.equal(button.disabled, true); throw new Error('offline'); }, error => { failure = error; });
  assert.equal(button.disabled, false); assert.equal(failure.message, 'offline');
});
test('modal focus traps Tab, closes with Escape, restores opener and original inert state', () => {
  const { manageModals } = require('../home-runtime.js');
  const previous = global.MutationObserver;
  let sync;
  global.MutationObserver = class { constructor(fn) { sync = fn; } observe() {} };
  const events = {};
  const document = { activeElement: null, addEventListener: (type, fn) => { events[type] = fn; } };
  const node = () => ({ inert: false, tabIndex: 0, disabled: false, closest: () => null, getClientRects: () => [1], contains: () => false, focus() { document.activeElement = this; } });
  const opener = node(), first = node(), last = node(), background = node(), modal = node();
  background.inert = true; modal.hidden = true;
  modal.querySelectorAll = () => [first, last]; modal.contains = target => [modal, first, last].includes(target);
  document.activeElement = opener;
  document.querySelectorAll = () => [modal];
  document.body = { children: [opener, background, modal], classList: { toggle() {} } };
  try {
    manageModals(document, target => { target.hidden = true; });
    modal.hidden = false; sync();
    assert.equal(document.activeElement, first); assert.equal(opener.inert, true);
    last.focus(); events.keydown({ key: 'Tab', preventDefault() {} });
    assert.equal(document.activeElement, first);
    events.keydown({ key: 'Tab', shiftKey: true, preventDefault() {} });
    assert.equal(document.activeElement, last);
    events.keydown({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }); sync();
    assert.equal(document.activeElement, opener); assert.equal(opener.inert, false); assert.equal(background.inert, true);
  } finally { global.MutationObserver = previous; }
});
