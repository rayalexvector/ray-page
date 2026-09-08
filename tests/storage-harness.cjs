const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const { IDBFactory } = require('fake-indexeddb');

function makeBrowser({ indexedDB = new IDBFactory(), local = new Map(), fetch } = {}) {
  const events = new Map();
  const c = {
    console, indexedDB, crypto: webcrypto, TextEncoder, AbortController, MessageChannel,
    setTimeout, clearTimeout, Uint8Array, URL, structuredClone,
    navigator: { onLine: true }, document: { hidden: false, addEventListener() {} },
    localStorage: { getItem: k => local.get(k) || null, setItem: (k,v) => local.set(k,v), removeItem: k => local.delete(k) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
    dispatchEvent(event) { (events.get(event.type) || []).forEach(fn => fn(event)); },
    fetch: fetch || (async () => { throw new Error('unexpected network'); })
  };
  c.window = c;
  vm.createContext(c);
  c.load = path => vm.runInContext(fs.readFileSync(path, 'utf8'), c, { filename: path });
  c.load('arcade/js/save-schema.js');
  c.load('arcade/js/save-core.js');
  return c;
}
function loadArcade(c) { c.load('arcade/js/storage.js'); return c.RayArcade.Storage; }
function loadStarfall(c) { c.load('arcade/starfall/js/storage.js'); return c.RayStarfall.Store; }
const plain = value => JSON.parse(JSON.stringify(value));
module.exports = { makeBrowser, loadArcade, loadStarfall, plain, IDBFactory };
