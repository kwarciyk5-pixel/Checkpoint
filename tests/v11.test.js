// v1.1 browser checks: floating window, check-ins, answers + undo, Red Day routing, sync-ready records.
// Same setup as browser.test.js:
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules node tests/v11.test.js [outDir]
// The floating window is Chrome's Document Picture-in-Picture. Headless test browsers can't show one,
// so the test attaches the same view to a small popup window (App.attachPip) and drives that.
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const at = (d, h, m, s) => new Date(2026, 9, d, h, m, s || 0); // Oct 2026 (1 = Thu, 2 = Fri)

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  ctx.on('page', p => {
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text() + ' @ ' + (m.location().url || '')); });
    p.on('pageerror', e => errors.push(String(e)));
  });
  await ctx.clock.install({ time: at(1, 20, 40) });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#view .wrap');
  await page.clock.runFor(1500);
  await page.waitForSelector('#view .wrap');
  const st = (fn, arg) => page.evaluate(fn, arg);
  const day = (k) => st((k) => App.state.days[k], k);
  // v2 (Part B): only TODAY and TRADE are in the nav; Settings opens from the home screen.
  const tab = (t) => (t === 'home' || t === 'trade') ? page.locator('.tab[data-tab="' + t + '"]').click() : st((x) => App.go(x), t);

  // ---- device + defaults
  const dev = await st(() => App.device);
  assert.strictEqual(dev.name, 'desktop');
  assert.strictEqual(dev.checkinsHere, true, 'check-ins on by default where the floating window works');
  assert.deepStrictEqual(await st(() => App.state.settings.checkins.times.map(t => t.time)), ['20:45', '21:10', '21:30']);

  // ---- open the floating window (popup stand-in)
  await tab('trade');
  assert.strictEqual(await page.locator('[data-act="pip-open"]').count(), 1, 'Trade tab offers OPEN FLOATING WINDOW');
  const [pw] = await Promise.all([
    ctx.waitForEvent('page'),
    st(() => { const w = window.open('', 'cp-float', 'width=340,height=460'); App.attachPip(w); })
  ]);
  await pw.setViewportSize({ width: 340, height: 460 });
  await page.clock.runFor(600);
  const pipText = () => pw.locator('#pip-root').innerText();
  let t = await pipText();
  assert.ok(/TRADE\s*01\/02/.test(t), 'pip shows trade count: ' + t);
  assert.ok(t.includes('Next check-in 20:45'), 'next check-in shown');
  assert.ok(t.includes('MIN LEFT'), 'session time left');
  assert.ok(await page.locator('button', { hasText: 'FLOATING WINDOW OPEN' }).isVisible());
  await pw.screenshot({ path: path.join(OUT, 'v11-pip-main.png') });

  // ---- 20:45 check-in: glows in the pip and on Trade, chimes once
  await page.clock.setSystemTime(at(1, 20, 45, 5));
  await page.clock.runFor(1000);
  assert.strictEqual(await pw.locator('.pw.lit').count(), 1, 'pip is lit');
  t = await pipText();
  assert.ok(t.includes('20:45 CHECK-IN') && t.includes('post-open fetch'), 'cue text shown');
  assert.strictEqual(await page.locator('.ci-card').count(), 1, 'Trade tab shows the check-in card');
  await pw.screenshot({ path: path.join(OUT, 'v11-pip-checkin.png') });
  await page.screenshot({ path: path.join(OUT, 'v11-main-checkin.png') });
  // other tabs (v2: the home screen) show a banner
  await tab('home');
  assert.strictEqual(await page.locator('.ci-banner').count(), 1, 'banner on other tabs');
  await tab('trade');

  // ---- Doing good: message, then back to normal; next check-in moves on
  await pw.locator('[data-act="ci-answer"][data-a="good"]').click();
  assert.ok((await pipText()).includes('Keep following your rules.'));
  let d1 = await day('2026-10-01');
  assert.strictEqual(d1.checkins.length, 1);
  assert.strictEqual(d1.checkins[0].answer, 'good');
  assert.strictEqual(d1.checkins[0].device, dev.id, 'record carries the device id');
  assert.ok(d1.checkins[0].id, 'record has an id');
  await page.clock.runFor(10500);
  t = await pipText();
  assert.ok(t.includes('Next check-in 21:10'), 'next check-in after answering: ' + t);

  // ---- 21:10 Not good -> Break cooldown in the pip; UNDO restores the check-in
  await page.clock.setSystemTime(at(1, 21, 10, 5));
  await page.clock.runFor(1000);
  await pw.locator('[data-act="ci-answer"][data-a="notGood"]').click();
  await page.clock.runFor(300);
  assert.strictEqual(await pw.locator('.pw.cool').count(), 1, 'pip in cooldown mode');
  assert.ok((await pipText()).toUpperCase().includes('NOT GOOD → BREAK'));
  assert.strictEqual(await st(() => App.state.activeCooldown.trigger), 'notGood');
  assert.ok(await page.locator('.lock-title', { hasText: 'Checklist locked' }).count() >= 0);
  await pw.locator('[data-act="cd-step"]').first().click();
  await pw.screenshot({ path: path.join(OUT, 'v11-pip-cooldown.png') });
  await pw.locator('[data-act="pip-undo"]').click();
  await page.clock.runFor(300);
  assert.strictEqual(await st(() => App.state.activeCooldown), null, 'undo cancels the Break');
  assert.strictEqual(await pw.locator('.pw.lit').count(), 1, 'check-in lit again after undo');
  d1 = await day('2026-10-01');
  assert.strictEqual(d1.undone.filter(u => u.kind === 'checkin').length, 1);
  // answer again and let the Break run out
  await pw.locator('[data-act="ci-answer"][data-a="notGood"]').click();
  await page.clock.runFor(301000);
  assert.ok((await pipText()).includes('DONE'), 'cooldown finished in pip');
  await pw.locator('[data-act="cd-done"]').click();
  await page.clock.runFor(300);
  assert.ok(/TRADE/.test(await pipText()), 'back to the main pip view');

  // ---- Urge hold inside the pip
  await pw.locator('[data-hold="urge"]').evaluate(el => el.scrollIntoView());
  const ub = await pw.locator('[data-hold="urge"]').boundingBox();
  await pw.mouse.move(ub.x + ub.width / 2, ub.y + ub.height / 2);
  await pw.mouse.down();
  await page.clock.runFor(3200);
  await pw.mouse.up();
  await page.clock.runFor(200);
  assert.strictEqual(await st(() => App.state.activeCooldown && App.state.activeCooldown.trigger), 'urge', 'urge hold works in the pip');
  d1 = await day('2026-10-01');
  assert.strictEqual(typeof d1.urges[0], 'object');
  assert.ok(d1.urges[0].id && d1.urges[0].device === dev.id);
  await page.clock.runFor(91000);
  await pw.locator('[data-act="cd-done"]').click();

  // ---- Manual check-in -> Done · Red Day -> Red Day cooldown -> session-over checklist
  await pw.locator('[data-act="ci-now"]').click();
  await page.clock.runFor(300);
  assert.ok((await pipText()).includes('CHECK-IN'));
  await pw.locator('[data-act="ci-answer"][data-a="redDay"]').click();
  await page.clock.runFor(300);
  assert.ok((await pipText()).toUpperCase().includes('RED DAY → RED DAY'));
  await page.clock.runFor(181000);
  await pw.locator('[data-act="cd-done"]').click();
  await page.clock.runFor(300);
  t = await pipText();
  assert.ok(t.includes('RED DAY · DONE') && t.includes('Session over.'), 'session-over checklist after Red Day: ' + t);
  await pw.locator('[data-act="so-toggle"]').first().click();
  assert.strictEqual(await st(() => App.state.days['2026-10-01'].dayClosed), 'red');
  // v2: the main window shows the home Done screen; the Trade tab still shows session over
  assert.strictEqual(await st(() => App.ui.tab), 'home');
  assert.ok(await page.locator('.home[data-hs="done"]', { hasText: 'Day closed.' }).isVisible(), 'home Done screen');
  await tab('trade');
  assert.ok(await page.locator('h1', { hasText: 'Session over.' }).isVisible(), 'main Trade tab shows session over');
  assert.ok(await page.locator('.mono.amber', { hasText: 'RED DAY · DONE' }).isVisible());
  // day closed: the 21:30 check-in does not fire
  await page.clock.setSystemTime(at(1, 21, 31));
  await page.clock.runFor(1000);
  assert.strictEqual(await pw.locator('.pw.lit').count(), 0, 'no check-ins after the day is closed');
  await pw.screenshot({ path: path.join(OUT, 'v11-pip-over.png') });

  // ---- Next day: trade records carry id + device; settings stamp
  await page.clock.setSystemTime(at(2, 20, 35));
  await page.clock.runFor(21000);
  t = await pipText();
  assert.ok(/TRADE\s*01\/02/.test(t), 'new day resets: ' + t);
  await page.locator('[data-act="log"][data-o="SCRATCH"]').click();
  const tr = (await day('2026-10-02')).trades[0];
  assert.ok(tr.id && tr.device === dev.id, 'trade has id + device');
  await tab('settings');
  await page.locator('[data-act="cap"][data-d="-1"]').click();
  await page.clock.runFor(400);
  assert.ok(await st(() => App.state.meta.updatedAt.settings), 'settings change is stamped');
  assert.strictEqual(await st(() => App.state.meta.updatedAt['checklists.trade']), undefined, 'untouched parts are not stamped');

  // ---- Settings: check-in editor
  await page.locator('.sec-title', { hasText: 'Check-ins' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, 'v11-settings-checkins.png') });
  await page.locator('[data-act="ci-add"]').click();
  assert.strictEqual(await st(() => App.state.settings.checkins.times.length), 4);
  const newId = await st(() => App.state.settings.checkins.times[3].id);
  await page.locator('input[data-change="ci-time"][data-id="' + newId + '"]').fill('20:50');
  await page.locator('textarea[data-change="ci-text"][data-id="' + newId + '"]').fill('Test cue');
  await page.locator('textarea[data-change="ci-text"][data-id="' + newId + '"]').blur();
  assert.strictEqual(await st((id) => App.state.settings.checkins.times.find(x => x.id === id).time, newId), '20:50');
  await page.clock.setSystemTime(at(2, 20, 50, 5));
  await page.clock.runFor(1000);
  assert.ok((await pipText()).includes('Test cue'), 'new check-in fires');
  await page.locator('[data-act="ci-del"][data-id="' + newId + '"]').click();
  assert.strictEqual(await st(() => App.state.settings.checkins.times.length), 3);
  await page.locator('[data-act="dev-checkins"]').click();
  await page.clock.runFor(400);
  assert.strictEqual(await st(() => App.device.checkinsHere), false);
  assert.ok((await pipText()).includes('Check-ins off'));

  // ---- Old data migrates: string urges become records
  const n = await st(() => { const d = { urges: ['2026-09-30T13:00:00.000Z'], trades: [{ n: 1, outcome: 'SL' }] }; App.migrateDayRecords(d); return d; });
  assert.strictEqual(n.urges[0].at, '2026-09-30T13:00:00.000Z');
  assert.ok(n.urges[0].id && n.trades[0].id);

  // ---- Real Document PiP: open via a click (reported, not required in headless)
  let realPip = 'not tried';
  try {
    await pw.close();
    await page.clock.runFor(300);
    await tab('trade');
    const [p2] = await Promise.all([ctx.waitForEvent('page', { timeout: 3000 }), page.locator('[data-act="pip-open"]').click()]);
    realPip = (await p2.locator('#pip-root').count()) ? 'opened' : 'opened (empty)';
  } catch (e) { realPip = 'not available headless'; }
  console.log('real Document PiP: ' + realPip);

  await ctx.close();
  await browser.close();
  const relevant = errors.filter(e => !/fonts\.(googleapis|gstatic)/.test(e));
  assert.deepStrictEqual(relevant, [], 'console errors: ' + relevant.join('\n'));
  console.log('v1.1 browser test passed · 0 console errors · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
