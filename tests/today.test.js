// Part C unit checks: Today card + premarket roll-ups (spec §2.1, §3). Run: node tests/today.test.js
// Loads the inline <script> from index.html in a sandbox (no DOM), like unit.test.js.
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
const fresh = () => App.normalise(J(App.makeDefaults()));
const pmDay = () => ({ premarket: { checked: {}, gateNo: {}, later: [], collapsed: {} } });
const items = (s, row) => App.itemsOfRow(s, row);
const tick = (day, list) => list.forEach(it => { day.premarket.checked[it.id] = true; });

test('defaults: each premarket category has its roll-up row', () => {
  const s = fresh();
  assert.deepStrictEqual(s.checklists.premarket.categories.map(c => [c.name, App.rowOfCat(c)]),
    [['BODY', 'body'], ['DAYTIME', 'plan'], ['DESK', 'desk'], ['LOCKS', 'accounts'], ['DATA', 'desk']]);
});

test('defaults: the plan item and the three platform locks carry a role; "Pyae knows" is gone', () => {
  const s = fresh();
  const all = s.checklists.premarket.categories.flatMap(c => c.items);
  assert.deepStrictEqual(all.filter(i => i.role === 'plan').map(i => i.text), ['Trade plan for the day']);
  assert.deepStrictEqual(all.filter(i => i.role === 'lock').map(i => i.text),
    ['Copier on', 'Platform daily loss −$600, auto-flatten ON', 'Max order size = planned contracts']);
  assert.ok(!all.some(i => /Pyae knows/.test(i.text)));
});

test('a row without `row` goes by its name; an unknown category is Desk', () => {
  assert.strictEqual(App.rowOfCat({ name: 'locks' }), 'accounts');
  assert.strictEqual(App.rowOfCat({ name: 'MY EXTRAS' }), 'desk');
  assert.strictEqual(App.rowOfCat({ name: 'MY EXTRAS', row: 'body' }), 'body');
});

test('migration (v1 data): rows and roles added, unedited "Pyae knows" removed, edited items left alone', () => {
  const v = J(App.makeDefaults());
  delete v.meta.v2c;
  v.checklists.premarket.categories.forEach(c => { delete c.row; c.items.forEach(i => delete i.role); });
  const locks = v.checklists.premarket.categories[3];
  locks.items.splice(5, 0, { id: 'py', text: 'Pyae knows today\'s plan and cap', note: '', time: '', optional: false, gate: false });
  v.checklists.premarket.categories[2].items[1].text = 'My plan, written';
  const s = App.normalise(v);
  assert.strictEqual(s.meta.v2c, true);
  assert.deepStrictEqual(s.checklists.premarket.categories.map(c => c.row), ['body', 'plan', 'desk', 'accounts', 'desk']);
  assert.ok(!s.checklists.premarket.categories[3].items.some(i => i.id === 'py'), 'unedited line removed');
  assert.strictEqual(s.checklists.premarket.categories[3].items.filter(i => i.role === 'lock').length, 3);
  assert.strictEqual(s.checklists.premarket.categories[2].items[1].role, undefined, 'edited plan item gets no role');
  // Runs once: a later load doesn't touch an item she re-adds.
  s.checklists.premarket.categories[3].items.push({ id: 'py2', text: 'Pyae knows today\'s plan and cap', note: '', time: '', optional: false, gate: false });
  const again = App.normalise(J(s));
  assert.ok(again.checklists.premarket.categories[3].items.some(i => i.id === 'py2'));
});

test('migration keeps a "Pyae knows" line she gave a note', () => {
  const v = J(App.makeDefaults());
  delete v.meta.v2c;
  v.checklists.premarket.categories[3].items.push({ id: 'py', text: 'Pyae knows today\'s plan and cap', note: 'text him', time: '', optional: false, gate: false });
  assert.ok(App.normalise(v).checklists.premarket.categories[3].items.some(i => i.id === 'py'));
});

test('carry-over: contracts and practising from the last card; setups and band start fresh; default 2 contracts', () => {
  const s = fresh();
  assert.deepStrictEqual(J(App.carryToday(s, '2026-10-06')), { setups: [], contracts: 2, practising: '', band: 'normal' });
  s.days['2026-10-05'] = { today: { setups: [{ id: 'a', text: 'S1 long', grade: 'A' }], contracts: 3, practising: 'Footprint first.', band: 'low' } };
  s.days['2026-10-02'] = { today: { setups: [], contracts: 5, practising: 'old', band: 'normal' } };
  s.days['2026-10-07'] = { today: { setups: [], contracts: 9, practising: 'future', band: 'normal' } };
  assert.deepStrictEqual(J(App.carryToday(s, '2026-10-06')), { setups: [], contracts: 3, practising: 'Footprint first.', band: 'normal' });
});

test('cardFor reads without creating a day record', () => {
  const s = fresh();
  const c = App.cardFor(s, '2026-10-06');
  assert.strictEqual(c.contracts, 2);
  assert.strictEqual(s.days['2026-10-06'], undefined);
});

test('Body: ✓ when every gate is yes, observation day if any is no, open otherwise', () => {
  const s = fresh(), day = pmDay(), key = '2026-10-06';
  const gates = items(s, 'body').filter(i => i.gate);
  assert.strictEqual(gates.length, 4);
  assert.strictEqual(App.rollupsFor(s, day, key).body.st, 'open');
  tick(day, gates);
  assert.strictEqual(App.rollupsFor(s, day, key).body.st, 'ok', 'Rested (not a gate) does not block');
  day.premarket.gateNo[gates[1].id] = true;
  delete day.premarket.checked[gates[1].id];
  assert.strictEqual(App.rollupsFor(s, day, key).body.st, 'no');
});

test('Plan: ✓ with one setup line OR the plan item ticked; DAYTIME items do not block', () => {
  const s = fresh(), key = '2026-10-06';
  let day = pmDay();
  assert.strictEqual(App.rollupsFor(s, day, key).plan.st, 'open');
  day.today = { setups: [{ id: 'a', text: '   ', grade: null }], contracts: 2, practising: '', band: 'normal' };
  s.days[key] = day;
  assert.strictEqual(App.rollupsFor(s, day, key).plan.st, 'open', 'a blank line is no setup');
  day.today.setups[0].text = 'S1 long 30871-30900';
  assert.strictEqual(App.rollupsFor(s, day, key).plan.st, 'ok');
  assert.strictEqual(App.rollupsFor(s, day, key).plan.setups, 1);
  day = pmDay(); s.days[key] = day;
  tick(day, items(s, 'plan').filter(i => i.role === 'plan'));
  assert.strictEqual(App.rollupsFor(s, day, key).plan.st, 'ok');
});

test('Accounts: ✓ on the three platform locks; the other LOCKS items do not block', () => {
  const s = fresh(), day = pmDay(), key = '2026-10-06';
  const acc = items(s, 'accounts');
  assert.strictEqual(acc.length, 6);
  tick(day, acc.filter(i => i.role !== 'lock'));
  assert.strictEqual(App.rollupsFor(s, day, key).accounts.st, 'open');
  tick(day, acc.filter(i => i.role === 'lock'));
  const r = App.rollupsFor(s, day, key).accounts;
  assert.deepStrictEqual([r.st, r.done, r.req], ['ok', 3, 3]);
});

test('Accounts falls back to every LOCKS item when none carries the lock role', () => {
  const s = fresh(), day = pmDay(), key = '2026-10-06';
  s.checklists.premarket.categories[3].items.forEach(i => delete i.role);
  const acc = items(s, 'accounts');
  tick(day, acc.slice(0, 3));
  assert.strictEqual(App.rollupsFor(s, day, key).accounts.st, 'open');
  tick(day, acc);
  assert.strictEqual(App.rollupsFor(s, day, key).accounts.st, 'ok');
});

test('Desk: ✓ on every non-optional DESK + DATA item; the plan item counts under Plan instead', () => {
  const s = fresh(), day = pmDay(), key = '2026-10-06';
  const desk = items(s, 'desk');
  assert.ok(!desk.some(i => i.role === 'plan'));
  assert.strictEqual(desk.length, 7); // DESK 4 (without the plan item) + DATA 3
  tick(day, desk.slice(0, 6));
  assert.strictEqual(App.rollupsFor(s, day, key).desk.st, 'open');
  tick(day, desk);
  assert.strictEqual(App.rollupsFor(s, day, key).desk.st, 'ok');
});

test('paste: one setup per line, blanks dropped, first two kept', () => {
  assert.deepStrictEqual(J(App.pasteSplit('S1 long 30871\r\n\n  S2 short 30990  \nS3 extra')), ['S1 long 30871', 'S2 short 30990']);
  assert.deepStrictEqual(J(App.pasteSplit('')), []);
});

test('a card setup feeds the Looking rows (Part B reads day.today)', () => {
  const s = fresh();
  const day = { today: { setups: [{ id: 'a', text: 'S1 long', grade: 'A' }, { id: 'b', text: '', grade: null }], contracts: 2, practising: '', band: 'normal' }, trades: [] };
  assert.deepStrictEqual(J(App.setupRowsFor(day).map(r => r.setup.id)), ['a']);
});

console.log('\n' + passed + ' today tests passed');
