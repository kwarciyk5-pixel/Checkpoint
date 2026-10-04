// Part B unit checks: home state machine (spec §2, §10). Run: node tests/home.test.js
// Loads the inline <script> from index.html in a sandbox (no DOM), like unit.test.js.
// Times are Bangkok local (the build container and Iris's devices run Asia/Bangkok).
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
const at = (d, h, m, s) => new Date(2026, 9, d, h, m, s || 0); // Oct 2026 · 5 = Mon, 6 = Tue, 4 = Sun
const fresh = () => App.normalise(J(App.makeDefaults()));
const newDay = () => ({ premarket: { checked: {}, gateNo: {}, later: [], collapsed: {} }, tradeChecks: {}, entered: false, trades: [], cooldowns: [], urges: [], undone: [], checkins: [], dayClosed: null, sessionOver: { checked: {} } });
const state = (s, day, now, opts) => App.homeStateFor(s, day, now, opts);

test('session is stored in New York time and shows 20:30–21:40 in Bangkok (October)', () => {
  const s = fresh();
  assert.deepStrictEqual(J(s.settings.session), { start: '09:30', end: '10:40', tz: 'America/New_York', observeMin: 15 });
  assert.deepStrictEqual(J(App.sessionTimesFor('2026-10-06', s.settings)), { start: '20:30', end: '21:40' });
});

test('after US daylight saving ends (1 Nov) the session moves to 21:30–22:40 by itself', () => {
  const s = fresh();
  assert.deepStrictEqual(J(App.sessionTimesFor('2026-11-02', s.settings)), { start: '21:30', end: '22:40' });
});

test('a v1 session (20:30–21:40 Bangkok, no tz) migrates to 09:30–10:40 New York; a custom one stays local', () => {
  const v1 = J(App.makeDefaults());
  v1.settings.session = { start: '20:30', end: '21:40' };
  delete v1.meta;
  const a = App.normalise(J(v1));
  assert.strictEqual(a.settings.session.tz, 'America/New_York');
  assert.strictEqual(a.settings.session.start, '09:30');
  v1.settings.session = { start: '20:00', end: '22:00' };
  const b = App.normalise(J(v1));
  assert.strictEqual(b.settings.session.tz, 'local');
  assert.deepStrictEqual(J(App.sessionTimesFor('2026-10-06', b.settings)), { start: '20:00', end: '22:00' });
});

test('v1 prefilled texts migrate once; edited ones are left alone', () => {
  const v1 = J(App.makeDefaults());
  delete v1.meta;
  v1.settings.behaviour.dayDoneAfterTP = true;
  const items = v1.checklists.trade.categories[0].items;
  items[3].text = 'Reward to risk ≥ 1:3'; items[3].note = 'To a planned target';
  items[4].text = 'New trigger at a different level · cooldown done · why and how said to Pyae';
  items[0].text = 'My own wording';
  v1.checklists.sessionOver.categories[0].items = ['Platform closed', 'No other accounts', 'Left the room', 'Eyes off all charts'].map((t, i) => ({ id: 'so' + i, text: t, note: '' }));
  const sl = v1.presets.find(p => p.id === v1.settings.presetLinks.sl);
  sl.steps = ['Stand up', '3 physiological sighs', 'Leave the desk', 'Water'].map((t, i) => ({ id: 'st' + i, text: t }));
  const s = App.normalise(v1);
  const tr = s.checklists.trade.categories[0].items;
  assert.strictEqual(tr[3].text, 'Reward to risk ≥ 1:1.5');
  assert.strictEqual(tr[3].note, '1:2 preferred, to a planned target');
  assert.strictEqual(tr[4].text, 'New trigger at a different level · cooldown done · said out loud');
  assert.strictEqual(tr[0].text, 'My own wording');
  assert.deepStrictEqual(J(s.checklists.sessionOver.categories[0].items.map(i => i.text)), ['Accounts locked', 'Charts closed (Pyae\'s too)', 'Away from the desk']);
  assert.strictEqual(s.presets.find(p => p.id === s.settings.presetLinks.sl).steps[0].text, 'Two physiological sighs');
  assert.strictEqual(s.settings.behaviour.dayDoneAfterTP, false);
  assert.strictEqual(s.meta.v2b, true);
  // once only: a later edit back to a v1 text is not migrated again
  tr[3].text = 'Reward to risk ≥ 1:3';
  assert.strictEqual(App.normalise(s).checklists.trade.categories[0].items[3].text, 'Reward to risk ≥ 1:3');
});

test('state: offday on a weekend, unless shown anyway', () => {
  const s = fresh();
  assert.strictEqual(state(s, null, at(4, 20, 45)), 'offday');
  assert.strictEqual(state(s, null, at(4, 14, 0), { showAnyway: '2026-10-04' }), 'premarket');
});

test('state: premarket before 20:30, waiting while live, done after 21:40 (window closed)', () => {
  const s = fresh();
  assert.strictEqual(state(s, null, at(5, 19, 0)), 'premarket');
  assert.strictEqual(state(s, null, at(5, 20, 29, 59)), 'premarket');
  assert.strictEqual(state(s, null, at(5, 20, 30)), 'waiting');
  assert.strictEqual(state(s, null, at(5, 21, 39)), 'waiting');
  assert.strictEqual(state(s, null, at(5, 21, 40)), 'done');
  assert.strictEqual(App.doneReasonFor(s, null, at(5, 21, 40)), 'time');
  assert.strictEqual(state(s, null, at(6, 2, 0)), 'done', '02:00 still counts as Monday');
  assert.strictEqual(state(s, null, at(6, 6, 0)), 'premarket', 'reset at 06:00');
});

test('state: a gate answered no = observe from the open; premarket before it', () => {
  const s = fresh();
  const gate = s.checklists.premarket.categories[0].items.find(i => i.gate);
  const day = newDay();
  day.premarket.gateNo[gate.id] = true;
  assert.strictEqual(state(s, day, at(5, 20, 0)), 'premarket');
  assert.strictEqual(state(s, day, at(5, 20, 35)), 'observe');
});

test('state: looking, in trade, cooldown (in that priority)', () => {
  const s = fresh();
  const day = newDay();
  day.looking = { at: 'x', setupId: null };
  assert.strictEqual(state(s, day, at(5, 20, 40)), 'looking');
  day.entered = true;
  assert.strictEqual(state(s, day, at(5, 20, 40)), 'intrade');
  s.activeCooldown = { startedAt: at(5, 20, 41).getTime(), endsAt: at(5, 20, 46).getTime(), finished: false };
  assert.strictEqual(state(s, day, at(5, 20, 42)), 'cooldown');
  s.activeCooldown.finished = true;
  assert.strictEqual(state(s, day, at(5, 20, 47)), 'cooldown', 'finished cooldown still shows until DONE');
  assert.strictEqual(state(s, day, at(6, 20, 40)), 'intrade', 'yesterday\'s finished cooldown is ignored');
});

test('state: an open trade keeps In trade after 21:40 (Stopped / Target stay reachable)', () => {
  const s = fresh();
  const day = newDay();
  day.entered = true;
  assert.strictEqual(state(s, day, at(5, 21, 45)), 'intrade');
  day.entered = false;
  assert.strictEqual(state(s, day, at(5, 21, 45)), 'done');
});

test('done reasons: 2 TP · 2 SL · cap · DLL · green cap · closed', () => {
  const s = fresh();
  const t = o => ({ outcome: o });
  const r = (trades, extra) => App.doneReasonFor(s, Object.assign(newDay(), { trades: trades.map(t) }, extra || {}), at(5, 20, 50));
  assert.strictEqual(r([]), null);
  assert.strictEqual(r(['TP']), null, 'one TP is not done (v2: done at 2 TP)');
  assert.strictEqual(r(['SL']), null);
  assert.strictEqual(r(['TP', 'TP']), 'tp');
  assert.strictEqual(r(['SL', 'SL']), 'sl');
  assert.strictEqual(r(['TP', 'SL']), 'cap');
  assert.strictEqual(r(['SCRATCH', 'SL']), 'cap');
  assert.strictEqual(r([], { dllHit: 'x' }), 'dll');
  assert.strictEqual(r(['TP'], { greenCapHit: 'x' }), 'green');
  assert.strictEqual(r([], { dayClosed: 'red' }), 'closed');
  assert.strictEqual(state(s, Object.assign(newDay(), { trades: [t('TP'), t('TP')] }), at(5, 20, 50)), 'done');
});

test('early window: +14 min is early, +16 is not', () => {
  const s = fresh();
  assert.strictEqual(App.isEarlyFor(s, at(5, 20, 29)), false, 'before the open');
  assert.strictEqual(App.isEarlyFor(s, at(5, 20, 30)), true);
  assert.strictEqual(App.isEarlyFor(s, at(5, 20, 44)), true, '+14');
  assert.strictEqual(App.isEarlyFor(s, at(5, 20, 46)), false, '+16');
});

test('after an early stop the next entry is an A setup only', () => {
  const day = newDay();
  day.today = { setups: [{ id: 's1', text: 'S1 long', grade: null }, { id: 's2', text: 'S2 short', grade: 'B' }, { id: 's3', text: 'S3', grade: 'A' }, { id: 's4', text: 'S4', grade: null }] };
  const off = () => App.setupRowsFor(day).map(r => r.off ? r.setup.id : '').filter(Boolean);
  assert.deepStrictEqual(J(off()), [], 'no stops: everything allowed');
  day.trades = [{ outcome: 'SL', setupId: 's1', earlyWindow: false }];
  assert.deepStrictEqual(J(off()), [], 'a stop outside the early window does not filter');
  day.trades = [{ outcome: 'SL', setupId: 's1', earlyWindow: true }];
  assert.deepStrictEqual(J(off()), ['s1', 's2'], 'B greyed; the ungraded setup that stopped greyed; A and other ungraded allowed');
  assert.ok(App.setupRowsFor(day).find(r => r.setup.id === 's2').off.includes('not after an early stop'));
});

test('word loop: 20 s per line, 1 → 9, then round again from 3', () => {
  assert.strictEqual(App.WORD_LOOP.length, 9);
  assert.strictEqual(App.wordIndex(0), 0);
  assert.strictEqual(App.wordIndex(19.9), 0);
  assert.strictEqual(App.wordIndex(20), 1);
  assert.strictEqual(App.wordIndex(8 * 20), 8);
  assert.strictEqual(App.wordIndex(9 * 20), 2);
  assert.strictEqual(App.wordIndex(15 * 20), 8);
  assert.strictEqual(App.wordIndex(16 * 20), 2);
});

test('series day N counts trading days from settings.series.start (Tue 6 Oct)', () => {
  const s = fresh();
  assert.strictEqual(App.seriesDayFor('2026-10-05', s.settings).n, 0);
  assert.strictEqual(App.seriesDayFor('2026-10-06', s.settings).n, 1);
  assert.strictEqual(App.seriesDayFor('2026-10-12', s.settings).n, 5, 'Mon 12 Oct = day 5 (weekend skipped)');
  assert.strictEqual(App.seriesDayFor('2026-10-30', s.settings).n, 19, '6 Oct is a Tuesday: Fri 30 Oct is day 19');
  s.settings.series.start = '2026-10-05';
  assert.strictEqual(App.seriesDayFor('2026-10-30', s.settings).n, 20, 'from Mon 5 Oct, Fri 30 Oct is day 20');
});

test('v2 rules defaults and loosening', () => {
  const r = fresh().settings.rules;
  assert.deepStrictEqual([r.doneTp, r.doneSl, r.tradeCap, r.rrFloor, r.rrPreferred, r.greenCap, r.maxDailyLoss, r.maxRiskPerTrade], [2, 2, 2, 1.5, 2, null, 600, 300]);
  const L = App.isLoosening;
  assert.strictEqual(L({ key: 'rules.doneTp', from: 2, to: 3 }), true);
  assert.strictEqual(L({ key: 'rules.rrFloor', from: 1.5, to: 1.2 }), true);
  assert.strictEqual(L({ key: 'rules.rrFloor', from: 1.5, to: 2 }), false);
  assert.strictEqual(L({ key: 'rules.greenCap', from: null, to: 1100 }), false, 'setting a cap tightens');
  assert.strictEqual(L({ key: 'rules.greenCap', from: 1100, to: null }), true, 'removing it loosens');
  assert.strictEqual(L({ key: 'rules.greenCap', from: 1100, to: 1400 }), true);
});

console.log('\n' + passed + ' home tests passed');
