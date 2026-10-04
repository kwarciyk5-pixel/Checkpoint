// Part D unit checks: event log, Export today, Import filled, points (spec §4, §5, §10). Run: node tests/log.test.js
// Loads the inline <script> from index.html in a sandbox (no DOM), like unit.test.js.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sandbox = { console, Intl };
vm.createContext(sandbox);
vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1], sandbox);
const App = sandbox.App;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }
const J = o => JSON.parse(JSON.stringify(o));
const at = (d, h, m) => new Date(2026, 9, d, h, m, 0); // Oct 2026 · 6 = Tue, 7 = Wed
const fresh = () => App.normalise(J(App.makeDefaults()));
const KEY = '2026-10-06';
const ev = (type, detail) => detail ? { t: '2026-10-06T20:40:00+07:00', type, detail } : { t: '2026-10-06T20:40:00+07:00', type };
function day(extra) {
  return Object.assign({
    premarket: { checked: {}, gateNo: {}, later: [], collapsed: {} }, tradeChecks: {}, entered: false, trades: [], cooldowns: [],
    urges: [], undone: [], checkins: [], dayClosed: null, sessionOver: { checked: {} }, events: [], filled: null,
    today: { setups: [{ id: 's1', text: 'S1 long 30871', grade: 'A' }], contracts: 2, practising: 'Footprint first.', band: 'normal' }
  }, extra || {});
}
const trade = (id, outcome, enteredAt, closedAt) => ({ id, n: 1, outcome, at: closedAt, enteredAt, closedAt, setupId: 's1', grade: 'A', earlyWindow: false, openOffsetMin: 12, checklistComplete: true });
const pts = (s, now) => App.pointsFor(s, KEY, now || at(7, 14, 0));
const itemPts = (p, k) => (p.items.find(x => x.k === k) || { pts: 0 }).pts;

test('isoLocal: local time with offset', () => {
  assert.strictEqual(App.isoLocal(new Date(2026, 9, 6, 20, 41, 5)), '2026-10-06T20:41:05+07:00');
});

test('export shape (spec §4): v, date, tz, today, gates, locks, events, trades, urges, points, filled', () => {
  const s = fresh();
  const gate = s.checklists.premarket.categories[0].items.find(i => i.gate);
  const d = day({ events: [ev('start_looking'), ev('enter', 's1')], urges: [{ id: 'u', at: '' }] });
  d.premarket.checked[gate.id] = true;
  d.trades = [trade('t1', 'SL', '2026-10-06T13:42:00Z', '2026-10-06T13:50:00Z')];
  s.days[KEY] = d;
  const x = App.exportTodayFor(s, KEY);
  assert.deepStrictEqual(Object.keys(x), ['v', 'date', 'tz', 'today', 'gates', 'locks', 'events', 'trades', 'urges', 'points', 'filled']);
  assert.strictEqual(x.v, 2); assert.strictEqual(x.date, KEY); assert.strictEqual(x.filled, null); assert.strictEqual(x.urges, 1);
  assert.strictEqual(x.gates['Slept enough'], 'yes');
  assert.strictEqual(x.gates['Physically OK'], null);
  assert.strictEqual(x.locks['Copier on'], false);
  assert.strictEqual(x.events.length, 2);
  assert.deepStrictEqual(J(x.trades[0]), { id: 't1', setupId: 's1', setup: 'S1 long 30871', grade: 'A', enteredAt: '2026-10-06T13:42:00Z', closedAt: '2026-10-06T13:50:00Z', outcome: 'sl', earlyWindow: false, openOffsetMin: 12, checklistComplete: true });
  assert.strictEqual(x.today.practising, 'Footprint first.');
  assert.ok(typeof x.points.total === 'number');
});

test('validFilled: needs v 2, a date and a filled object', () => {
  assert.ok(App.validFilled({ v: 2, date: KEY, filled: { trades: [] } }));
  assert.ok(!App.validFilled({ v: 2, date: KEY, filled: null }), 'unfilled day file');
  assert.ok(!App.validFilled({ v: 1, date: KEY, filled: {} }));
  assert.ok(!App.validFilled({ v: 2, date: '6 Oct', filled: {} }));
  assert.ok(!App.validFilled({ schema: 1, checklists: {} }), 'a full backup is not a day file');
});

test('import filled merges `filled` and never touches events (or anything else)', () => {
  const s = fresh();
  const d = day({ events: [ev('enter', 's1'), ev('stopped', 't1')] });
  d.trades = [trade('t1', 'SL', '2026-10-06T13:42:00Z', '2026-10-06T13:50:00Z')];
  s.days[KEY] = d;
  const before = J(d);
  const file = { v: 2, date: KEY, events: [ev('injected')], trades: [], filled: { trades: [{ id: 't1', clean: true, box: 'CL' }], offplanFills: [], dayClean: true, pointsAdj: 0, comment: '' } };
  App.mergeFilled(s, file);
  const after = J(s.days[KEY]);
  assert.deepStrictEqual(after.events, before.events, 'events unchanged');
  delete after.filled; delete before.filled;
  assert.deepStrictEqual(after, before, 'nothing else changed');
  assert.strictEqual(s.days[KEY].filled.trades[0].clean, true);
  assert.ok(s.days[KEY].filled.importedAt);
});

test('import filled for a day this device never saw creates that day with only the fill', () => {
  const s = fresh();
  App.mergeFilled(s, { v: 2, date: KEY, filled: { trades: [] } });
  assert.deepStrictEqual(J(s.days[KEY].events), []);
  assert.deepStrictEqual(J(s.days[KEY].filled.offplanFills), []);
});

test('points: locks_ready +10, plan_ready +10, urges +5 each (max 2), left_desk +10, charts closed +10', () => {
  const s = fresh();
  const charts = s.checklists.sessionOver.categories[0].items.find(i => /chart/i.test(i.text));
  const d = day({ events: [ev('locks_ready'), ev('plan_ready'), ev('left_desk')], urges: [{}, {}, {}] });
  d.sessionOver.checked[charts.id] = true;
  s.days[KEY] = d;
  const p = pts(s);
  assert.strictEqual(itemPts(p, 'locks'), 10);
  assert.strictEqual(itemPts(p, 'plan'), 10);
  assert.strictEqual(itemPts(p, 'urge'), 10, 'max 2 urges count');
  assert.strictEqual(itemPts(p, 'leftDesk'), 10);
  assert.strictEqual(itemPts(p, 'charts'), 10);
});

test('points: sit out +25 in series week 1, +15 after', () => {
  const s = fresh();
  s.days[KEY] = day({ events: [ev('sitout')] });
  assert.strictEqual(itemPts(pts(s), 'sitout'), 25, 'Tue 6 Oct = series day 1');
  const k2 = '2026-10-13';
  s.days[k2] = day({ events: [ev('sitout')] });
  assert.strictEqual(itemPts(App.pointsFor(s, k2, at(14, 14, 0)), 'sitout'), 15, 'day 6');
});

test('points: a clean loss scores the same as a clean win (+20 each, from filled only)', () => {
  const s = fresh();
  const d = day();
  d.trades = [trade('a', 'SL', '2026-10-06T13:40:00Z', '2026-10-06T13:45:00Z'), trade('b', 'TP', '2026-10-06T13:55:00Z', '2026-10-06T14:05:00Z')];
  s.days[KEY] = d;
  assert.strictEqual(itemPts(pts(s), 'clean'), 0, 'nothing before the fill');
  d.filled = { trades: [{ id: 'a', clean: true, box: 'CL' }, { id: 'b', clean: true, box: 'CW' }], offplanFills: [] };
  assert.strictEqual(itemPts(pts(s), 'clean'), 40);
});

test('points: off-plan fill −30, broken win −30 + dangerous green, DLL −50', () => {
  const s = fresh();
  const d = day({ dllHit: '2026-10-06T14:00:00Z' });
  d.trades = [trade('a', 'TP', '2026-10-06T13:40:00Z', '2026-10-06T13:45:00Z')];
  d.filled = { trades: [{ id: 'a', clean: false, box: 'BW' }], offplanFills: [{ t: '20:52' }, { t: '20:55' }] };
  s.days[KEY] = d;
  const p = pts(s);
  assert.strictEqual(itemPts(p, 'offplan'), -60);
  assert.strictEqual(itemPts(p, 'brokenWin'), -30);
  assert.strictEqual(p.dangerousGreen, true);
  assert.strictEqual(itemPts(p, 'dll'), -50);
  assert.strictEqual(p.clean, false);
});

test('points: done rule kept +25; a trade after done −50 and no +25', () => {
  const s = fresh();
  const d = day();
  d.trades = [trade('a', 'SL', '2026-10-06T13:35:00Z', '2026-10-06T13:40:00Z'), trade('b', 'SL', '2026-10-06T13:50:00Z', '2026-10-06T13:55:00Z')];
  s.days[KEY] = d;
  let p = pts(s);
  assert.strictEqual(p.reason, 'sl'); assert.strictEqual(itemPts(p, 'doneKept'), 25);
  d.trades.push(trade('c', 'TP', '2026-10-06T14:00:00Z', '2026-10-06T14:10:00Z'));
  p = pts(s);
  assert.strictEqual(itemPts(p, 'doneKept'), 0);
  assert.strictEqual(itemPts(p, 'afterDone'), -50);
});

test('points: a fill can flag an off-plan fill after done (−30 −50)', () => {
  const s = fresh();
  const d = day();
  d.filled = { trades: [], offplanFills: [{ afterDone: true }] };
  s.days[KEY] = d;
  const p = pts(s);
  assert.strictEqual(itemPts(p, 'offplan'), -30);
  assert.strictEqual(itemPts(p, 'afterDone'), -50);
  assert.strictEqual(itemPts(p, 'doneKept'), 0);
});

test('points: a past day with no trades counts as done by time (window closed) the next day', () => {
  const s = fresh();
  s.days[KEY] = day();
  assert.strictEqual(App.pointsFor(s, KEY, at(6, 19, 0)).reason, null, 'before the session that day');
  assert.strictEqual(App.pointsFor(s, KEY, at(7, 14, 0)).reason, 'time');
  assert.strictEqual(itemPts(App.pointsFor(s, KEY, at(7, 14, 0)), 'doneKept'), 25);
});

test('points: pointsAdj from the fill is added', () => {
  const s = fresh();
  s.days[KEY] = day({ filled: { trades: [], offplanFills: [], pointsAdj: -5 } });
  const p = pts(s);
  assert.strictEqual(itemPts(p, 'adj'), -5);
  assert.strictEqual(p.total, p.items.reduce((a, x) => a + x.pts, 0));
});

test('clean day: all trades clean, no off-plan fills, done rule kept; unfilled = unknown', () => {
  const s = fresh();
  const d = day();
  d.trades = [trade('a', 'SL', '2026-10-06T13:40:00Z', '2026-10-06T13:45:00Z')];
  s.days[KEY] = d;
  assert.strictEqual(pts(s).clean, null);
  d.filled = { trades: [{ id: 'a', clean: true, box: 'CL' }], offplanFills: [] };
  assert.strictEqual(pts(s).clean, true);
  d.filled.dayClean = false;
  assert.strictEqual(pts(s).clean, false, 'Claude can mark the day not clean');
});

test('series: total never resets; a breach resets the streak; unfilled days are skipped; levels', () => {
  const s = fresh();
  const mk = (k, clean) => { s.days[k] = day({ events: [ev('locks_ready')], filled: clean === null ? null : { trades: [], offplanFills: clean ? [] : [{}] } }); };
  mk('2026-10-06', true); mk('2026-10-07', true); mk('2026-10-08', false); mk('2026-10-09', null); mk('2026-10-12', true);
  const st = App.seriesStatsFor(s, at(13, 14, 0));
  assert.strictEqual(st.streak, 1);
  assert.strictEqual(st.best, 2);
  assert.strictEqual(st.cleanDays, 3);
  const sum = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12'].reduce((a, k) => a + App.pointsFor(s, k, at(13, 14, 0)).total, 0);
  assert.strictEqual(st.total, sum);
  assert.strictEqual(App.levelFor(0), 'Observer'); assert.strictEqual(App.levelFor(299), 'Observer');
  assert.strictEqual(App.levelFor(300), 'Gatekeeper'); assert.strictEqual(App.levelFor(800), 'Custodian'); assert.strictEqual(App.levelFor(1500), 'Operator');
});

test('badges: clean loss, two and done, walked away, sat out right, 5 clean days', () => {
  const s = fresh();
  const d = day({ events: [ev('left_desk'), ev('sitout')] });
  d.trades = [trade('a', 'SL', '2026-10-06T13:35:00Z', '2026-10-06T13:40:00Z')];
  d.filled = { trades: [{ id: 'a', clean: true, box: 'CL' }], offplanFills: [] };
  s.days[KEY] = d;
  assert.deepStrictEqual(J(App.dayBadgesFor(s, KEY, at(7, 14, 0))), ['clean loss', 'walked away', 'sat out right']);
  const k2 = '2026-10-07';
  const d2 = day();
  d2.trades = [trade('x', 'TP', '2026-10-07T13:35:00Z', '2026-10-07T13:40:00Z'), trade('y', 'TP', '2026-10-07T13:50:00Z', '2026-10-07T13:55:00Z')];
  s.days[k2] = d2;
  assert.ok(App.dayBadgesFor(s, k2, at(8, 14, 0)).includes('two and done'));
  ['2026-10-08', '2026-10-09', '2026-10-12'].forEach(k => { s.days[k] = day({ filled: { trades: [], offplanFills: [] } }); });
  s.days[k2].filled = { trades: [{ id: 'x', clean: true }, { id: 'y', clean: true }], offplanFills: [] };
  const st = App.seriesStatsFor(s, at(13, 14, 0));
  assert.strictEqual(st.best, 5);
  assert.strictEqual(st.badges['5 clean days'], '2026-10-12');
  assert.strictEqual(st.badges['clean loss'], KEY);
});

console.log('\n' + passed + ' log tests passed');
