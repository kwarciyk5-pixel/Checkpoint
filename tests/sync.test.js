// Part F unit checks: merging two versions of one day (spec §7: newest wins per day; here nothing logged is
// ever lost). Run: node tests/sync.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1], sandbox);
const App = sandbox.App;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }
const J = o => JSON.parse(JSON.stringify(o));
function day(over) {
  return Object.assign({
    premarket: { checked: {}, gateNo: {}, later: [], collapsed: {} }, tradeChecks: {}, entered: false, trades: [], cooldowns: [],
    urges: [], undone: [], checkins: [], dayClosed: null, sessionOver: { checked: {} }, events: [], filled: null, sitouts: [], leftDesk: []
  }, over || {});
}
const ev = (t, type, detail) => detail ? { t, type, detail } : { t, type };
const tr = (id, at, outcome) => ({ id, n: 1, outcome: outcome || 'SL', at, closedAt: at });

test('stamp: _m if set, else the latest logged time; empty day = 0', () => {
  assert.strictEqual(App.dayStampOf(day()), 0);
  assert.strictEqual(App.dayStampOf(day({ events: [ev('2026-10-06T20:31:00+07:00', 'urge')], trades: [tr('a', '2026-10-06T13:50:00Z')] })), Date.parse('2026-10-06T13:50:00Z'));
  assert.strictEqual(App.dayStampOf(day({ _m: '2026-10-06T15:00:00Z', trades: [tr('a', '2026-10-06T13:50:00Z')] })), Date.parse('2026-10-06T15:00:00Z'));
});

test('hash ignores _m and key order', () => {
  const a = day({ _m: '2026-10-06T10:00:00Z' }), b = day({ _m: '2026-10-06T11:00:00Z' });
  assert.strictEqual(App.dayHash(a), App.dayHash(b));
  const c = J(a); const d = {}; Object.keys(c).reverse().forEach(k => { d[k] = c[k]; });
  assert.strictEqual(App.dayHash(c), App.dayHash(d));
});

test('phone premarket + PC trading on the same day: both kept', () => {
  const phone = day({ _m: '2026-10-06T07:00:00Z', premarket: { checked: { g1: true, l1: true }, gateNo: {}, later: [], collapsed: {} },
    events: [ev('2026-10-06T14:00:00+07:00', 'gate_yes', 'Slept enough'), ev('2026-10-06T14:02:00+07:00', 'locks_ready')],
    today: { setups: [{ id: 's1', text: 'S1', grade: 'A' }], contracts: 2, practising: 'p', band: 'normal' } });
  const pc = day({ _m: '2026-10-06T13:55:00Z', premarket: { checked: { d1: true }, gateNo: {}, later: [], collapsed: {} },
    trades: [tr('t1', '2026-10-06T13:50:00Z')], urges: [{ id: 'u1', at: '2026-10-06T13:40:00Z' }],
    events: [ev('2026-10-06T20:40:00+07:00', 'enter'), ev('2026-10-06T20:50:00+07:00', 'stopped', 't1')] });
  const m = App.mergeDay(phone, pc);
  assert.deepStrictEqual(J(m.trades.map(t => t.id)), ['t1']);
  assert.deepStrictEqual(J(m.urges.map(u => u.id)), ['u1']);
  assert.deepStrictEqual(J(m.events.map(e => e.type)), ['gate_yes', 'locks_ready', 'enter', 'stopped'], 'events from both, in time order');
  assert.deepStrictEqual(Object.keys(m.premarket.checked).sort(), ['d1', 'g1', 'l1'], 'ticks from both');
  assert.strictEqual(m.today, undefined, 'the newer side (PC) is the base');
  assert.strictEqual(m._m, '2026-10-06T13:55:00.000Z');
  assert.deepStrictEqual(J(App.mergeDay(pc, phone).events), J(m.events), 'order of arguments does not matter for the log');
});

test('the same record on both sides is not doubled; same event not doubled', () => {
  const a = day({ _m: '2026-10-06T14:00:00Z', trades: [tr('t1', '2026-10-06T13:50:00Z')], events: [ev('2026-10-06T20:50:00+07:00', 'stopped', 't1')] });
  const b = J(a); b._m = '2026-10-06T14:05:00Z';
  const m = App.mergeDay(a, b);
  assert.strictEqual(m.trades.length, 1);
  assert.strictEqual(m.events.length, 1);
});

test('an undone trade stays undone after a merge with an older copy that still has it', () => {
  const older = day({ _m: '2026-10-06T13:51:00Z', trades: [tr('t1', '2026-10-06T13:50:00Z')] });
  const newer = day({ _m: '2026-10-06T13:52:00Z', trades: [], undone: [{ id: 'x', kind: 'trade', outcome: 'SL', n: 1, loggedAt: '2026-10-06T13:50:00Z', undoneAt: '2026-10-06T13:50:05Z' }] });
  assert.strictEqual(App.mergeDay(older, newer).trades.length, 0);
  assert.strictEqual(App.mergeDay(newer, older).trades.length, 0);
});

test('a gate answered differently: the newer answer wins', () => {
  const a = day({ _m: '2026-10-06T07:00:00Z', premarket: { checked: { g1: true }, gateNo: {}, later: [], collapsed: {} } });
  const b = day({ _m: '2026-10-06T08:00:00Z', premarket: { checked: {}, gateNo: { g1: true }, later: [], collapsed: {} } });
  const m = App.mergeDay(a, b);
  assert.strictEqual(m.premarket.gateNo.g1, true);
  assert.strictEqual(m.premarket.checked.g1, undefined);
});

test('filled: the later import wins whichever side is newer', () => {
  const a = day({ _m: '2026-10-07T10:00:00Z', filled: { trades: [{ id: 't1', clean: true }], offplanFills: [], importedAt: '2026-10-07T09:00:00Z' } });
  const b = day({ _m: '2026-10-06T14:00:00Z', filled: { trades: [{ id: 't1', clean: false }], offplanFills: [], importedAt: '2026-10-07T09:30:00Z' } });
  assert.strictEqual(App.mergeDay(a, b).filled.trades[0].clean, false);
  assert.strictEqual(App.mergeDay(day({ _m: '2026-10-07T10:00:00Z' }), a).filled.trades[0].clean, true, 'a fill is never dropped');
});

test('merging never mutates its inputs', () => {
  const a = day({ _m: '2026-10-06T07:00:00Z', events: [ev('2026-10-06T14:00:00+07:00', 'plan_ready')] });
  const b = day({ _m: '2026-10-06T08:00:00Z', events: [ev('2026-10-06T15:00:00+07:00', 'locks_ready')] });
  const a0 = J(a), b0 = J(b);
  App.mergeDay(a, b);
  assert.deepStrictEqual(J(a), a0); assert.deepStrictEqual(J(b), b0);
});

test('signed out by default; no tokens in the full backup', () => {
  assert.strictEqual(App.signedIn(), false);
  assert.ok(!/refresh|access_token/.test(JSON.stringify(App.makeDefaults())));
});

console.log('\n' + passed + ' sync tests passed');
