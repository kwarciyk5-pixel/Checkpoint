// v3 unit checks: the Checkpoint card parser (spec v3 §4) and the calm words / sound (§6).
// Run: node tests/card.test.js. The sample is the Trading project's 9-Oct card (tests/card-sample.txt).
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
const J = o => JSON.parse(JSON.stringify(o));
const eq = (a, b, m) => assert.deepStrictEqual(J(a), J(b), m); // results come from the sandbox realm
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }
const SAMPLE = fs.readFileSync(path.join(__dirname, 'card-sample.txt'), 'utf8');

test('the 9-Oct sample parses: header, bias, four setups (two S4), S3 do-nothing', () => {
  const c = App.parseCard(SAMPLE);
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.date, '2026-10-09');
  assert.strictEqual(c.kind, 'built');
  assert.strictEqual(c.at, '20:19');
  assert.ok(/^Balance day, neutral-to-long/.test(c.bias));
  eq(c.setups.map(x => x.id), ['S1', 'S2', 'S4-long', 'S4-short']);
  eq(c.setups.map(x => x.label), ['S1 long', 'S2 short', 'S4 long', 'S4 short']);
  assert.strictEqual(c.doNothing, 'S3');
});

test('setup fields as printed; "—" stays "—"; RR as a number when it is one', () => {
  const c = App.parseCard(SAMPLE);
  const s1 = c.setups[0];
  eq([s1.zone, s1.sl, s1.t1, s1.t2, s1.rr, s1.rrNum], ['31,128–31,150', '31,090', '31,207', '31,250', '1:1.4', 1.4]);
  assert.strictEqual(s1.trigger, 'defenders + absorption, ES holds 7,838–7,844');
  assert.strictEqual(s1.invalid, 'acceptance below 31,090');
  assert.strictEqual(c.setups[1].rrNum, 1);
  const s4s = c.setups[3];
  eq([s4s.zone, s4s.sl, s4s.rr, s4s.rrNum], ['—', '—', '—', null]);
});

test('box, guard, events, size, done, walls', () => {
  const c = App.parseCard(SAMPLE);
  eq(J(c.box), { floor: '31,150', ceiling: '31,172', coil: '31,150–31,172', posture: '+γ neutral, fade extremes toward the flip after the print, structure-only' });
  assert.strictEqual(c.guard.flip, '7,813.96');
  assert.ok(/^no new orders below/.test(c.guard.cond));
  eq(J(c.events), [{ at: '21:00', name: 'Michigan sentiment / inflation expectations' }]);
  eq(J(c.size), { risk: '$150', contracts: '—', band: 'low' });
  assert.strictEqual(c.done, '2 SL or +3R · cap 2 (hard 3)');
  assert.strictEqual(c.walls, 'provisional (pre-open)');
});

test('a fenced block and a re-cut header both work; several events split on ";"', () => {
  const t = '```\nCHECKPOINT CARD\nCP1 | date 2026-10-12 | recut 20:52\nBIAS | Short below the flip\nS1 | short | zone 1–2 | trigger x | SL 3 | T1 0 | T2 — | invalid y | RR 1:2\nEVENTS | 21:00 TH Print A; 21:30 TH Print B\n```';
  const c = App.parseCard(t);
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.kind, 'recut');
  assert.strictEqual(c.at, '20:52');
  eq(J(c.events).map(e => e.at), ['21:00', '21:30']);
});

test('not a card → refused with a plain message; nothing guessed', () => {
  assert.strictEqual(App.parseCard('hello').ok, false);
  assert.ok(/CP1/.test(App.parseCard('S1 | long').err));
  assert.strictEqual(App.parseCard('CP1 | date 2026-10-12').ok, false);
  const c = App.parseCard('CP1 | date 2026-10-12 | built 20:20\nS1 | long | zone 1–2 | colour blue');
  assert.strictEqual(c.setups[0].colour, undefined);
});

test('addCard keeps every paste; the newest is the one shown', () => {
  const d = { cards: [] };
  App.addCard(d, SAMPLE, new Date(2026, 9, 9, 20, 20));
  App.addCard(d, SAMPLE.replace('built 20:19', 'recut 20:52'), new Date(2026, 9, 9, 20, 53));
  assert.strictEqual(d.cards.length, 2);
  assert.strictEqual(d.cards[1].kind, 'recut');
  assert.strictEqual(App.addCard(d, 'nonsense').ok, false);
  assert.strictEqual(d.cards.length, 2);
});

test('calm words: 20 in trade, 18 red, 18 green; shuffle bag has every line once and never repeats across bags', () => {
  eq([App.CALM_DEFAULT.intrade.length, App.CALM_DEFAULT.red.length, App.CALM_DEFAULT.green.length], [20, 18, 18]);
  let last = -1, seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let k = 0; k < 300; k++) {
    const bag = App.shuffleBag(18, last, rnd);
    eq([...bag].sort((a, b) => a - b), [...Array(18).keys()]);
    assert.notStrictEqual(bag[0], last, 'no back-to-back across bags');
    last = bag[bag.length - 1];
  }
  eq(J(App.shuffleBag(1, 0)), [0]);
});

test('sound: soft noise in trade, breath tone in both cooldowns, nothing elsewhere or when switched off', () => {
  const a = { noise: true, breath: true };
  assert.strictEqual(App.soundFor('intrade', a), 'noise');
  assert.strictEqual(App.soundFor('cool-red', a), 'breath');
  assert.strictEqual(App.soundFor('cool-green', a), 'breath');
  assert.strictEqual(App.soundFor('watching', a), '');
  assert.strictEqual(App.soundFor('intrade', { noise: false }), '');
  assert.strictEqual(App.soundFor('cool-red', { breath: false }), '');
});

console.log(passed + ' card + calm tests passed');
