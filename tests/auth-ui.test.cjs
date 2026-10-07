const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const runtime = fs.readFileSync(require.resolve('../home-runtime.js'), 'utf8');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness({ maintenance = false } = {}) {
  const nodes = new Map(), events = new Map(), storage = new Map();
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const listeners = new Map(), classes = new Set();
    const element = { id, value: '', textContent: '', innerHTML: '', hidden: id.includes('modal'), disabled: false, dataset: {}, style: { setProperty() {} },
      classList: { add: (...args) => args.forEach(x => classes.add(x)), remove: (...args) => args.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle(x, on = !classes.has(x)) { on ? classes.add(x) : classes.delete(x); return on; } },
      addEventListener: (type, fn) => listeners.set(type, fn),
      emit: (type, args = {}) => listeners.get(type)?.({ preventDefault() {}, target: element, currentTarget: element, ...args }),
      querySelector: selector => node(id + selector), querySelectorAll: () => [], setAttribute() {}, focus() {}, scrollIntoView() {}, matches: () => false };
    nodes.set(id, element); return element;
  }
  const document = { getElementById: node, querySelectorAll: () => [], querySelector: () => null, body: node('body'), documentElement: node('html'), activeElement: null, hidden: false, addEventListener: (type, fn) => events.set(type, fn) };
  document.body.children = [];
  let user = { id: 'A', email: 'a@test.invalid', email_verified: true }, fail = false;
  const requests = [];
  const context = { document, console, performance, URLSearchParams, AbortController, DOMException, Blob, crypto: require('node:crypto').webcrypto,
    navigator: { mediaDevices: {} }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    MutationObserver: class { observe() {} }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame() {},
    location: { search: '', hash: '' }, innerHeight: 800, matchMedia: () => ({ matches: false }),
    addEventListener: (type, fn) => events.set(type, fn),
    fetch: async (url, options) => { requests.push({ url, options }); if (fail) throw new Error('offline'); return { ok: true, json: async () => ({ ok: true, user, daily: {} }) }; },
  };
  context.window = context; context.globalThis = context;
  // Keep dormant identity/media regressions, and exercise the shipped flag separately below.
  const source = maintenance ? script : script.replace('const AI_MAINTENANCE = true;', 'const AI_MAINTENANCE = false;');
  vm.createContext(context); vm.runInContext(runtime, context); vm.runInContext(source, context);
  return { context, node, events, storage, requests, run: code => vm.runInContext(code, context), setUser: value => { user = value; }, offline: () => { fail = true; } };
}
test('shipped maintenance mode blocks login, registration, AI and microphone work', async () => {
  const app = harness({ maintenance: true }); await tick();
  app.context.fetch = async () => assert.fail('maintenance action made a network request');
  app.context.navigator.mediaDevices.getUserMedia = async () => assert.fail('maintenance requested microphone');
  for (const action of ['openChatModal()', 'openCantoneseModal()', 'startVoiceRecording()', 'startCantoneseTranslator()']) {
    await app.run(action);
    assert.equal(app.node('maintenance-modal').hidden, false);
    assert.equal(app.node('chat-modal').hidden, true);
    assert.equal(app.node('cantonese-modal').hidden, true);
    app.run('closeMaintenanceModal()');
  }
  for (const id of ['login-form', 'register-form', 'chat-form']) {
    await app.node(id).emit('submit');
    assert.equal(app.node('maintenance-modal').hidden, false);
    app.run('closeMaintenanceModal()');
  }
  await app.run('sendRegisterCodeButton').emit('click');
  assert.equal(app.node('maintenance-modal').hidden, false);
  await assert.rejects(app.run('processCantoneseSegment({})'), error => error.retryable === false);
});
test('actual UI restores verification/login/register/logout controls offline and locks local identity', async () => {
  const app = harness(); await tick(); app.offline();
  app.node('register-invite').value = 'test'; app.node('register-email').value = 'a@test.invalid';
  await app.node('send-register-code').emit('click');
  // Check the actual bound button, independent of its HTML naming convention.
  await app.run('sendRegisterCodeButton').emit('click');
  assert.equal(app.run('sendRegisterCodeButton.disabled'), false);
  await app.node('login-form').emit('submit');
  assert.equal(app.node('login-formbutton[type="submit"]').disabled, false);
  await app.node('register-form').emit('submit');
  assert.equal(app.node('register-formbutton[type="submit"]').disabled, false);
  await app.run('logoutButton').emit('click');
  assert.equal(app.run('logoutButton.disabled'), false);
  assert.equal(app.run('authState.user'), null);
  assert.match(app.run('authMessage.textContent'), /服务器会话尚未确认失效/);
});
test('actual UI switches chat namespace without reading legacy or old account messages', async () => {
  const app = harness(); await tick();
  app.storage.set('ray-mimo-chat-history-v1', 'legacy-private');
  app.run("conversations[0].messages.push({role:'user',content:'A-private'}); saveConversations()");
  app.setUser({ id: 'B', email: 'b@test.invalid', email_verified: true });
  await app.run('refreshAuth()');
  assert.equal(app.run('JSON.stringify(conversations)').includes('A-private'), false);
  assert.equal(app.storage.get('ray-mimo-chat-history-v1'), 'legacy-private');
  assert.match(app.storage.get('ray:chat:v2:user:A'), /A-private/);
});
test('actual close path invalidates delayed microphone permission without creating recorder', async () => {
  const app = harness(); await tick(); let resolve, stopped = 0;
  app.context.MediaRecorder = class { constructor() { assert.fail('cancelled session started recorder'); } };
  app.context.navigator.mediaDevices.getUserMedia = () => new Promise(done => { resolve = done; });
  const recording = app.run('startVoiceRecording()');
  app.run('closeChatModal()');
  resolve({ getTracks: () => [{ stop: () => stopped++ }] }); await recording;
  assert.equal(stopped, 1); assert.equal(app.run('pendingMediaItems.length'), 0);
});
test('normal/no-JS homepage is not gated by intro and deep link scroll is preserved', () => {
  assert.match(html, /<body>/); assert.doesNotMatch(html, /<body class="intro-active"/);
  assert.match(script, /if \(!window.location.hash\) window.scrollTo/);
  assert.match(html, /if \(document.hidden \|\| !heroVisible\) return/);
});
test('subtitle close while authorization is pending stops all returned tracks', async () => {
  const app = harness(); await tick(); let resolve, stopped = 0;
  app.context.MediaRecorder = class { constructor() { assert.fail('stale subtitle session'); } };
  app.context.navigator.mediaDevices.getUserMedia = () => new Promise(done => { resolve = done; });
  const recording = app.run('startCantoneseTranslator()'); await tick();
  app.run('closeCantoneseModal()');
  resolve({ getTracks: () => [{ stop: () => stopped++ }] }); await recording;
  assert.equal(stopped, 1); assert.equal(app.run('cantoneseRunning'), false);
});
test('account switch aborts old chat fetch and ignores its late successful response', async () => {
  const app = harness(); await tick(); let resolve, signal;
  app.context.fetch = (url, options) => {
    signal = options.signal;
    assert.match(JSON.parse(options.body).requestId, /^[A-Za-z0-9_-]{8,128}$/);
    return new Promise(done => { resolve = done; });
  };
  app.node('chat-input').value = 'A-private';
  const sending = app.node('chat-form').emit('submit'); await tick();
  app.run("authState = { user: { id: 'B', email:'b@test.invalid', email_verified:true } }; renderAuthState()");
  assert.equal(signal.aborted, true);
  resolve({ ok: true, json: async () => ({ ok: true, reply: 'A-reply' }) }); await sending;
  assert.equal(app.run('JSON.stringify(conversations)').includes('A-reply'), false);
  assert.equal(app.run('chatBusy'), false);
  assert.doesNotMatch(app.storage.get('ray:chat:v2:user:B'), /A-private|A-reply/);
});
test('pagehide and hidden-page paths cancel pending microphone permission', async () => {
  for (const type of ['pagehide', 'visibilitychange']) {
    const app = harness(); await tick(); let resolve, stopped = 0;
    app.context.MediaRecorder = class { constructor() { assert.fail('background recording'); } };
    app.context.navigator.mediaDevices.getUserMedia = () => new Promise(done => { resolve = done; });
    const recording = app.run('startVoiceRecording()');
    app.context.document.hidden = true; app.events.get(type)();
    resolve({ getTracks: () => [{ stop: () => stopped++ }] }); await recording;
    assert.equal(stopped, 1);
  }
});
test('cross-tab unconfirmed logout remains locked instead of reloading a live server session', async () => {
  const app = harness(); await tick();
  app.storage.set('ray-auth-local-lock-v2', 'true');
  app.events.get('storage')({ key: 'ray-auth-state-v2' }); await tick();
  assert.equal(app.run('authState.user'), null);
  assert.equal(app.run('localSessionLocked'), true);
});
test('authentication uses safe v2 path and unknown upstream errors never enable retries', async () => {
  const app = harness(); await tick();
  assert.ok(app.requests.some(request => request.url.endsWith('/v2/auth/me')));
  assert.ok(!app.requests.some(request => request.url.endsWith('/auth/me') && !request.url.endsWith('/v2/auth/me')));
  for (const code of ['request_in_progress', 'request_already_completed', 'upstream_result_unknown']) {
    app.context.fetch = async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: code }) });
    await assert.rejects(app.run("processCantoneseSegment({audioDataUrl:'mock-audio',duration:1000,requestId:'fixed-request-123'})"), error => error.retryable === false);
  }
});
test('recorder construction failure releases an already authorized stream', async () => {
  const app = harness(); await tick(); let stopped = 0;
  app.context.MediaRecorder = class { constructor() { throw new Error('unsupported codec'); } };
  app.context.navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop: () => stopped++ }] });
  await assert.rejects(app.run('startVoiceRecording()'), /unsupported codec/);
  assert.equal(stopped, 1);
});
test('logout clears private message DOM even without a replacement conversation', async () => {
  const app = harness(); await tick();
  app.run("conversations[0].messages.push({role:'user',content:'A-private'}); renderChat()");
  app.run("authState = {user:null}; renderAuthState()");
  assert.equal(app.node('chat-messages').textContent, '');
});
test('storage failure keeps owner-scoped in-memory recovery across close and account changes', async () => {
  const app = harness(); await tick();
  app.context.localStorage.setItem = () => { throw new Error('quota'); };
  app.run("conversations[0].messages.push({role:'user',content:'unsaved-A'}); saveConversations(); closeChatModal(); loadConversations()");
  assert.match(app.run('JSON.stringify(conversations)'), /unsaved-A/);
  app.run("authState = {user:{id:'B'}}; renderAuthState()");
  assert.doesNotMatch(app.run('JSON.stringify(conversations)'), /unsaved-A/);
  app.run("authState = {user:{id:'A'}}; renderAuthState()");
  assert.match(app.run('JSON.stringify(conversations)'), /unsaved-A/);
  assert.equal(app.node('chat-storage-warning').hidden, false);
});
test('chat captures owner before UI work and locks on server owner_changed', async () => {
  const app = harness(); await tick(); let payload;
  app.node('chat-input').value = 'A-owned content';
  Object.defineProperty(app.node('chat-messages'), 'innerHTML', { configurable: true, set() {
    app.run("authState.user = {id:'B',email_verified:true}");
  } });
  app.context.fetch = async (_, options) => {
    payload = JSON.parse(options.body);
    return { ok: false, status: 409, json: async () => ({ error: 'owner_changed' }) };
  };
  await app.node('chat-form').emit('submit');
  assert.equal(payload.ownerId, 'A');
  assert.equal(app.run('authState.user'), null);
  assert.equal(app.run('localSessionLocked'), true);
  assert.equal(app.node('chat-messages').textContent, '');
  assert.equal(app.run('chatBusy'), false);
});
test('subtitle segment captures owner at recorder creation, not completion or fetch', async () => {
  const app = harness(); await tick(); const listeners = {};
  app.context.MediaRecorder = class {
    constructor() { this.state = 'inactive'; }
    addEventListener(type, fn) { listeners[type] = fn; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  };
  app.run("cantoneseRunning=true; cantoneseStream={}; subtitleQueue={items:[],capacity:6,push(segment){globalThis.capturedSegment=segment;cantoneseRunning=false;return true}}; startCantoneseSegment()");
  app.run("authState.user={id:'B',email_verified:true}"); listeners.stop();
  assert.equal(app.context.capturedSegment.ownerId, 'A');
  app.context.capturedSegment.audioDataUrl = 'mock-audio'; app.context.capturedSegment.duration = 1000;
  let payload;
  app.context.fetch = async (_, options) => {
    payload = JSON.parse(options.body);
    return { ok: false, status: 409, json: async () => ({ error: 'owner_changed' }) };
  };
  app.run('subtitleQueue=null');
  await assert.rejects(app.run('processCantoneseSegment(capturedSegment)'));
  assert.equal(payload.ownerId, 'A');
  assert.equal(app.run('authState.user'), null);
  assert.equal(app.run('localSessionLocked'), true);
});
