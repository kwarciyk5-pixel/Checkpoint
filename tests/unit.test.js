// Unit checks for Checkpoint. Run: node tests/unit.test.js
// Loads the inline <script> from index.html in a sandbox (no DOM), then asserts
// the default data, the trading-day key, isLoosening and mergeImport.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.strictEqual(scripts.length, 1, 'index.html must have exactly one inline <script>');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(scripts[0][1], sandbox);
const App = sandbox.App;
assert.ok(App, 'App namespace exists');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok  ' + name);
}

// JSON round-trip so objects from the sandbox realm compare cleanly with deepStrictEqual.
const d = JSON.parse(JSON.stringify(App.makeDefaults()));

test('premarket: 23 items in 5 categories, 4 gates, 1 optional', () => {
  const cats = d.checklists.premarket.categories;
  const items = cats.flatMap(c => c.items);
  assert.strictEqual(cats.length, 5);
  assert.deepStrictEqual(cats.map(c => c.name), ['BODY', 'DAYTIME', 'DESK', 'LOCKS', 'DATA']);
  assert.strictEqual(items.length, 23);
  assert.strictEqual(items.filter(i => i.gate).length, 4);
  assert.strictEqual(items.filter(i => i.optional).length, 1);
  assert.strictEqual(items.find(i => i.optional).text, 'Watch MQ videos');
});

test('trade: 5 items, 1 afterStopOnly', () => {
  const items = d.checklists.trade.categories.flatMap(c => c.items);
  assert.strictEqual(items.length, 5);
  assert.strictEqual(items.filter(i => i.afterStopOnly).length, 1);
});

test('session over: 4 items', () => {
  assert.strictEqual(d.checklists.sessionOver.categories.flatMap(c => c.items).length, 4);
});

test('5 presets and every presetLinks id exists', () => {
  assert.strictEqual(d.presets.length, 5);
  const ids = new Set(d.presets.map(p => p.id));
  const links = d.settings.presetLinks;
  assert.deepStrictEqual(Object.keys(links).sort(), ['greenDay', 'notGood', 'redDay', 'sl', 'urge']);
  Object.values(links).forEach(id => assert.ok(ids.has(id), 'link id ' + id + ' exists'));
  const byId = Object.fromEntries(d.presets.map(p => [p.id, p.name]));
  assert.strictEqual(byId[links.sl], 'After SL');
  assert.strictEqual(byId[links.urge], 'Urge');
  assert.strictEqual(byId[links.redDay], 'Red Day');
  assert.strictEqual(byId[links.greenDay], 'Green Day');
  assert.strictEqual(byId[links.notGood], 'Break');
});

test('all ids are unique', () => {
  const ids = [];
  Object.values(d.checklists).forEach(l => l.categories.forEach(c => { ids.push(c.id); c.items.forEach(i => ids.push(i.id)); }));
  d.presets.forEach(p => { ids.push(p.id); p.steps.forEach(s => ids.push(s.id)); });
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('trading-day key respects resetHour 06:00', () => {
  assert.strictEqual(App.tradingDayKey(new Date(2026, 9, 2, 1, 30), '06:00'), '2026-10-01');
  assert.strictEqual(App.tradingDayKey(new Date(2026, 9, 2, 6, 0), '06:00'), '2026-10-02');
  assert.strictEqual(App.tradingDayKey(new Date(2026, 9, 2, 5, 59), '06:00'), '2026-10-01');
  assert.strictEqual(App.tradingDayKey(new Date(2026, 0, 1, 2, 0), '06:00'), '2025-12-31');
});

test('session phase before / live / after', () => {
  const s = d.settings;
  assert.strictEqual(App.sessionPhase(new Date(2026, 9, 1, 19, 41), s), 'before');
  assert.strictEqual(App.sessionPhase(new Date(2026, 9, 1, 20, 30), s), 'live');
  assert.strictEqual(App.sessionPhase(new Date(2026, 9, 1, 21, 39), s), 'live');
  assert.strictEqual(App.sessionPhase(new Date(2026, 9, 1, 21, 40), s), 'after');
  assert.strictEqual(App.sessionPhase(new Date(2026, 9, 2, 1, 30), s), 'after');
  assert.strictEqual(App.sessionPhase(new Date(2026, 9, 2, 6, 0), s), 'before');
});

test('isLoosening', () => {
  const L = App.isLoosening;
  assert.strictEqual(L({ key: 'rules.tradeCap', from: 2, to: 3 }), true, 'cap 2 -> 3 loosens');
  assert.strictEqual(L({ key: 'rules.tradeCap', from: 2, to: 1 }), false, 'cap 2 -> 1 tightens');
  assert.strictEqual(L({ key: 'behaviour.lockAtCap', from: true, to: false }), true, 'lockAtCap off loosens');
  assert.strictEqual(L({ key: 'behaviour.lockAtCap', from: false, to: true }), false, 'lockAtCap on tightens');
  assert.strictEqual(L({ key: 'behaviour.holdToEnterSec', from: 2, to: 1 }), true, 'hold 2 -> 1 loosens');
  assert.strictEqual(L({ key: 'behaviour.holdToEnterSec', from: 2, to: 3 }), false, 'hold 2 -> 3 tightens');
  assert.strictEqual(L({ key: 'trade.itemAdd', from: null, to: {} }), false, 'adding a trade item does not loosen');
  assert.strictEqual(L({ key: 'rules.maxDailyLoss', from: 600, to: 800 }), true);
  assert.strictEqual(L({ key: 'rules.maxRiskPerTrade', from: 300, to: 250 }), false);
  assert.strictEqual(L({ key: 'preset.seconds', from: 300, to: 200 }), true);
  assert.strictEqual(L({ key: 'preset.stepDelete', from: 'x', to: null }), true);
  assert.strictEqual(L({ key: 'trade.itemDelete', from: 'x', to: null }), true);
  assert.strictEqual(L({ key: 'trade.afterStopOnly', from: false, to: true }), true);
  assert.strictEqual(L({ key: 'trade.afterStopOnly', from: true, to: false }), false);
  assert.strictEqual(L({ key: 'session', from: { start: '20:30', end: '21:40' }, to: { start: '20:30', end: '22:00' } }), true);
  assert.strictEqual(L({ key: 'activeDays', from: [1, 2], to: [1, 2, 3] }), true);
  assert.strictEqual(L({ key: 'presetLinks', from: 'a', to: 'b' }), true);
  assert.strictEqual(L({ key: 'accent', from: 'mint', to: 'blue' }), false);
});

test('mergeImport restores a deleted item in place and keeps local settings', () => {
  const local = JSON.parse(JSON.stringify(d));
  const backup = JSON.parse(JSON.stringify(d));
  backup.days['2026-09-30'] = { trades: [] };
  backup.settings.rules.tradeCap = 9;
  const cat = local.checklists.premarket.categories[2];
  const removed = cat.items.splice(1, 1)[0];
  const n = App.mergeImport(local, backup);
  assert.strictEqual(n.items, 1);
  assert.strictEqual(n.days, 1);
  assert.strictEqual(n.presets, 0);
  assert.strictEqual(cat.items[1].id, removed.id);
  assert.strictEqual(local.settings.rules.tradeCap, 2);
});

test('fillMissing adds new keys without overwriting', () => {
  const stored = { settings: { rules: { tradeCap: 5 } } };
  App.fillMissing(stored, JSON.parse(JSON.stringify(d)));
  assert.strictEqual(stored.settings.rules.tradeCap, 5);
  assert.strictEqual(stored.settings.rules.maxDailyLoss, 600);
  assert.strictEqual(stored.settings.resetHour, '06:00');
});

test('escapeHTML', () => {
  assert.strictEqual(App.escapeHTML('<b a="1">\'&'), '&lt;b a=&quot;1&quot;&gt;&#39;&amp;');
});

console.log('\n' + passed + ' tests passed');
