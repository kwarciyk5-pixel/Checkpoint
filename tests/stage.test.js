// v3 unit checks: rules, stages, flags, migration (spec v3 §1, §2, §7). Run: node tests/stage.test.js
// Loads the inline <script> from index.html in a sandbox (no DOM). Run mode (the v3 default).
// Times are Bangkok local (the build container and Iris's devices run Asia/Bangkok). 12 Oct 2026 = Monday.
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

const eq = (a, b, m) => assert.deepStrictEqual(J(a), J(b), m); // results come from the sandbox realm
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }
const J = o => JSON.parse(JSON.stringify(o));
const at = (d, h, m, s) => new Date(2026, 9, d, h, m, s || 0);
const fresh = () => App.normalise(J(App.makeDefaults()));
const newDay = () => ({ premarket: { checked: {}, gateNo: {}, later: [], collapsed: {} }, tradeChecks: {}, entered: false, trades: [], cooldowns: [], urges: [], undone: [], checkins: [], dayClosed: null, sessionOver: { checked: {} }, events: [], cards: [], lockMoved: [], steps: {} });
const st = (s, day, now) => App.stageFor(s, day, now, {});
const trade = (outcome, h, m, r) => ({ id: 'T' + h + m, outcome, at: at(12, h, m).toISOString(), closedAt: at(12, h, m).toISOString(), enteredAt: at(12, h, m - 2).toISOString(), rTaken: r });
const SAMPLE = fs.readFileSync(path.join(__dirname, 'card-sample.txt'), 'utf8');

test('defaults: run sheet home, window 09:30–10:30 ET = 20:30–21:30 TH; 21:30–22:30 after 1 Nov', () => {
  const s = fresh();
  assert.strictEqual(s.settings.homeView, 'run');
  eq(J(App.sessionTimesFor('2026-10-12', s.settings)), { start: '20:30', end: '21:30' });
  eq(J(App.sessionTimesFor('2026-11-02', s.settings)), { start: '21:30', end: '22:30' });
  assert.strictEqual(s.settings.rules.doneR, 3);
  assert.strictEqual(s.settings.rules.hardCap, 3);
  assert.ok(s.presets.some(p => p.name === 'After target' && p.seconds === 300));
});

test('run sheet times are New York times: desk 19:30 now, 20:30 from 2 Nov; Journal sits after the window', () => {
  const s = fresh();
  const hm = t => new Date(t).toTimeString().slice(0, 5);
  const oct = App.runStepsFor('2026-10-12', s);
  assert.strictEqual(hm(oct[0].t), '19:30');
  assert.strictEqual(oct[0].step.title, 'At desk');
  assert.strictEqual(oct[oct.length - 1].step.kind, 'journal');
  assert.strictEqual(oct[oct.length - 1].timed, false);
  const nov = App.runStepsFor('2026-11-02', s);
  assert.strictEqual(hm(nov[0].t), '20:30');
});

test('stage before desk, at desk (with the step she is on), built', () => {
  const s = fresh(), d = newDay();
  let r = st(s, d, at(12, 18, 0));
  assert.strictEqual(r.stage, 'before');
  assert.strictEqual(r.why, 'Desk at 19:30');
  r = st(s, d, at(12, 19, 54));
  assert.strictEqual(r.stage, 'desk');
  assert.ok(/^At desk since 19:30 · now: 1BB Pack lands/.test(r.why), r.why);
  assert.ok(/^Your drops at 20:00/.test(r.next), r.next);
  d.builtAt = at(12, 20, 24).toISOString();
  r = st(s, d, at(12, 20, 25));
  assert.strictEqual(r.stage, 'built');
  assert.strictEqual(r.why, 'Built 20:24 · open in 5 min');
});

test('watching: early window named in the why until 20:45, then the window end', () => {
  const s = fresh(), d = newDay();
  d.builtAt = at(12, 20, 24).toISOString();
  let r = st(s, d, at(12, 20, 38));
  assert.strictEqual(r.stage, 'watching');
  assert.strictEqual(r.why, 'Built 20:24 · window open · early window until 20:45');
  r = st(s, d, at(12, 20, 50));
  assert.strictEqual(r.why, 'Built 20:24 · window open until 21:30');
});

test('in trade says when she tapped In a trade, and the setup once she adds it', () => {
  const s = fresh(), d = newDay();
  d.entered = true; d.enteredAt = at(12, 20, 52).toISOString();
  d.enteredCard = { id: 'S1', label: 'S1 long' };
  assert.strictEqual(st(s, d, at(12, 20, 55)).why, 'S1 long · entered 20:52 · you tapped In a trade');
  d.enteredCard = null;
  assert.strictEqual(st(s, d, at(12, 20, 55)).why, 'entered 20:52 · you tapped In a trade');
});

test('cooldowns: red after Stopped, green after Target, each with its end time', () => {
  const s = fresh(), d = newDay();
  const t0 = at(12, 20, 58).getTime();
  s.activeCooldown = { trigger: 'sl', name: 'After SL', startedAt: t0, endsAt: t0 + 300000, seconds: 300, finished: false, steps: [], stepsDone: {} };
  let r = st(s, d, at(12, 20, 59));
  assert.strictEqual(r.stage, 'cool-red');
  assert.strictEqual(r.why, 'You tapped Stopped at 20:58 · ends 21:03 · then back to Watching');
  s.activeCooldown.trigger = 'tp';
  r = App.stageFor(s, d, at(12, 20, 59), { lastR: '+2R' });
  assert.strictEqual(r.stage, 'cool-green');
  assert.strictEqual(r.why, 'You tapped Target (+2R) at 20:58 · ends 21:03 · then back to Watching');
  assert.strictEqual(st(s, d, at(12, 21, 4)).stage, 'watching');
});

test('done = 2 SL or +3R, whichever first → overtime with when and why', () => {
  const s = fresh(), d = newDay();
  d.trades = [trade('SL', 20, 41), trade('SL', 21, 14)];
  let r = st(s, d, at(12, 21, 25));
  assert.strictEqual(r.stage, 'overtime');
  assert.strictEqual(r.why, 'Day was done at 21:14 · because: 2nd SL · window closes 21:30');
  d.trades = [trade('TP', 20, 50, 2), trade('TP', 21, 5, 1)];
  r = st(s, d, at(12, 21, 10));
  assert.strictEqual(r.why, 'Day was done at 21:05 · because: +3R reached · window closes 21:30');
  d.trades = [trade('TP', 20, 50, 2), trade('SL', 21, 5)];
  assert.strictEqual(App.runDoneFor(s, d), null);
  assert.strictEqual(App.dayRFor(s, d), 1);
});

test('window closed → overtime; closing the night → closed', () => {
  const s = fresh(), d = newDay();
  let r = st(s, d, at(12, 21, 31));
  assert.strictEqual(r.stage, 'overtime');
  assert.strictEqual(r.why, 'Window closed at 21:30 · the session is over');
  d.closedAt = at(12, 21, 36).toISOString();
  r = st(s, d, at(12, 21, 40));
  assert.strictEqual(r.stage, 'closed');
  assert.strictEqual(r.why, 'You closed the night at 21:36 · say "journal"');
});

test('weekend is a day off', () => {
  assert.strictEqual(st(fresh(), newDay(), at(11, 20, 40)).stage, 'offday');
});

test('flags: before window + not built; early window; never a block', () => {
  const s = fresh(), d = newDay();
  const k = now => App.flagReasonsFor(s, d, now).map(f => f.k);
  eq(k(at(12, 20, 10)), ['before_window', 'not_built']);
  d.builtAt = at(12, 20, 20).toISOString();
  eq(k(at(12, 20, 35)), ['early_window']);
  eq(k(at(12, 20, 50)), []);
});

test('flags: event window ±5 min around a card event; cooldown; 3rd idea; over the hard cap; after done; after window; lock moved', () => {
  const s = fresh(), d = newDay();
  d.builtAt = at(12, 20, 20).toISOString();
  App.addCard(d, SAMPLE, at(12, 20, 21));
  const k = now => App.flagReasonsFor(s, d, now).map(f => f.k);
  eq(k(at(12, 20, 56)), ['event_window']);
  eq(k(at(12, 21, 5)), ['event_window']);
  eq(k(at(12, 21, 6)), []);
  const t0 = at(12, 20, 58).getTime();
  s.activeCooldown = { trigger: 'sl', name: 'After SL', startedAt: t0, endsAt: t0 + 300000, seconds: 300, finished: false };
  assert.ok(App.flagReasonsFor(s, d, at(12, 20, 59)).some(f => f.k === 'cooldown' && /4:00 left/.test(f.text)));
  s.activeCooldown = null;
  d.trades = [trade('TP', 20, 50, 1), trade('SL', 21, 8)];
  eq(k(at(12, 21, 10)), ['third_idea']);
  d.trades.push(trade('SL', 21, 12));
  eq(k(at(12, 21, 20)), ['over_cap', 'after_done']);
  d.trades = [];
  eq(k(at(12, 21, 35)), ['after_window']);
  d.lockMoved = [{ at: at(12, 21, 0).toISOString() }];
  eq(k(at(12, 21, 35)), ['after_window', 'lock_moved']);
});

test('flags tonight leave out an entry she undid', () => {
  const d = newDay();
  d.events = [
    { t: '2026-10-12T20:41:00+07:00', type: 'flag:early_window', detail: 'e1' },
    { t: '2026-10-12T21:22:00+07:00', type: 'flag:after_done', detail: 'e2' },
    { t: '2026-10-12T21:22:00+07:00', type: 'flag:over_cap', detail: 'e2' },
    { t: '2026-10-12T21:23:00+07:00', type: 'flag:after_done', detail: 'e3' },
    { t: '2026-10-12T21:23:05+07:00', type: 'undo', detail: 'enter:e3' }
  ];
  eq(App.flagsTonight(d).map(f => f.k), ['early_window', 'after_done', 'over_cap']);
});

test('migration: v2 data becomes run mode; window end 10:40 → 10:30; After target added and linked; nothing deleted', () => {
  sandbox.__CP_HOME_VIEW = 'classic';
  const v2 = J(App.makeDefaults());
  delete sandbox.__CP_HOME_VIEW;
  delete v2.settings.homeView; delete v2.settings.runSheet; delete v2.settings.calm; delete v2.settings.audio; delete v2.settings.run;
  v2.presets = v2.presets.filter(p => p.name !== 'After target');
  delete v2.settings.presetLinks.tp;
  v2.meta.v2b = true; v2.meta.v2c = true;
  v2.days['2026-10-09'] = Object.assign(newDay(), { trades: [trade('SL', 20, 41)] });
  const items = v2.checklists.premarket.categories.reduce((n, c) => n + c.items.length, 0);
  const s = App.normalise(J(v2));
  assert.strictEqual(s.settings.homeView, 'run');
  assert.strictEqual(s.settings.session.end, '10:30');
  const tp = s.presets.filter(p => p.name === 'After target');
  assert.strictEqual(tp.length, 1);
  assert.strictEqual(s.settings.presetLinks.tp, tp[0].id);
  assert.strictEqual(s.presets.length, 6);
  assert.strictEqual(s.checklists.premarket.categories.reduce((n, c) => n + c.items.length, 0), items);
  assert.strictEqual(s.days['2026-10-09'].trades.length, 1);
  assert.strictEqual(s.settings.runSheet.length, 11);
  assert.strictEqual(s.settings.calm.intrade.length, 20);
  const again = App.normalise(J(s));
  assert.strictEqual(again.presets.length, 6, 'runs once');
});

test('migration keeps an edited window end, and classic stays classic', () => {
  const v2 = J(App.makeDefaults());
  delete v2.settings.homeView; delete v2.meta.v3;
  v2.settings.session.end = '10:15';
  assert.strictEqual(App.normalise(J(v2)).settings.session.end, '10:15');
  const c = J(App.makeDefaults());
  c.settings.homeView = 'classic'; c.settings.session.end = '10:40'; delete c.meta.v3;
  const s = App.normalise(c);
  assert.strictEqual(s.settings.homeView, 'classic');
  assert.strictEqual(s.settings.session.end, '10:40');
});

test('points in run mode: an entry after done −50, a moved lock −50, a 3rd idea before done is not penalised', () => {
  const s = fresh(), key = '2026-10-12';
  s.days[key] = Object.assign(newDay(), { trades: [trade('SL', 20, 41), trade('TP', 20, 55, 2), trade('SL', 21, 10)] });
  let p = App.pointsFor(s, key, at(12, 22, 0));
  assert.ok(!p.items.some(x => x.k === 'afterDone'), 'third idea is not "after done"');
  s.days[key].trades.push(trade('TP', 21, 20, 2));
  p = App.pointsFor(s, key, at(12, 22, 0));
  eq(J(p.items.filter(x => x.k === 'afterDone')), [{ k: 'afterDone', n: 1, pts: -50 }]);
  s.days[key].lockMoved = [{ at: at(12, 21, 0).toISOString() }];
  p = App.pointsFor(s, key, at(12, 22, 0));
  eq(J(p.items.filter(x => x.k === 'lockMoved')), [{ k: 'lockMoved', n: 1, pts: -50 }]);
});

test('export today is v3 in run mode: cards, flags, lock moves, day R; Import filled accepts v2 and v3', () => {
  const s = fresh(), key = '2026-10-12';
  s.days[key] = Object.assign(newDay(), { trades: [trade('TP', 20, 55, 2)] });
  App.addCard(s.days[key], SAMPLE, at(12, 20, 20));
  const o = App.exportTodayFor(s, key);
  assert.strictEqual(o.v, 3);
  assert.strictEqual(o.cards.length, 1);
  eq(J(o.flags), []);
  assert.strictEqual(o.dayR, 2);
  assert.strictEqual(o.trades[0].rTaken, 2);
  assert.ok(App.validFilled({ v: 3, date: key, filled: { trades: [] } }));
  assert.ok(App.validFilled({ v: 2, date: key, filled: { trades: [] } }));
});

console.log(passed + ' stage tests passed');
