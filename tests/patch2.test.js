// Patch 2 browser checks: trade checklist, hold to enter and outcome logging inside the floating window.
// Same setup as browser.test.js:
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules node tests/patch2.test.js [outDir]
// Like v11.test.js, the floating-window view is attached to a small popup (App.attachPip).
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const at = (h, m, s) => new Date(2026, 9, 1, h, m, s || 0); // Thu 1 Oct 2026

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  ctx.on('page', p => {
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text() + ' @ ' + (m.location().url || '')); });
    p.on('pageerror', e => errors.push(String(e)));
  });
  await ctx.clock.install({ time: at(20, 35) });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#view .wrap');
  await page.clock.runFor(1500);
  await page.waitForSelector('#view .wrap');
  const st = (fn) => page.evaluate(fn);
  const day = () => st(() => App.state.days['2026-10-01']);
  await page.locator('.tab[data-tab="trade"]').click();
  const [pw] = await Promise.all([
    ctx.waitForEvent('page'),
    st(() => { const w = window.open('', 'cp-float', 'width=340,height=600'); App.attachPip(w); })
  ]);
  await pw.setViewportSize({ width: 340, height: 600 });
  await page.clock.runFor(600);
  const pipText = () => pw.locator('#pip-root').innerText();
  async function holdIn(p, sel, ms) {
    await p.locator(sel).evaluate(el => el.scrollIntoView({ block: 'center' }));
    const b = await p.locator(sel).boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down();
    await page.clock.runFor(ms);
    await p.mouse.up();
    await page.clock.runFor(100);
  }

  // ---- main view offers the trade checklist
  assert.strictEqual(await pw.locator('[data-act="pip-trade"]').count(), 1, 'TRADE CHECKLIST button');
  await pw.screenshot({ path: path.join(OUT, 'p2-pip-main.png') });
  await pw.locator('[data-act="pip-trade"]').click();
  await page.clock.runFor(300);
  assert.strictEqual(await pw.locator('[data-act="tr-toggle"]').count(), 4, '4 checks before a stop');
  assert.strictEqual(await pw.locator('.enter.off').count(), 1, 'not armed yet: disabled');
  // arm all 4 in the floating window; the main window follows
  for (let i = 0; i < 4; i++) await pw.locator('[data-act="tr-toggle"]').nth(i).click();
  assert.ok((await pipText()).includes('4/4'));
  assert.strictEqual(await page.locator('.pip.on').count(), 4, 'main window shows the same checks');
  await pw.screenshot({ path: path.join(OUT, 'p2-pip-armed.png') });

  // ---- let go early: nothing happens
  await holdIn(pw, '[data-hold="enter"]', 800);
  assert.strictEqual((await day()).entered, false, 'early release does not enter');
  // ---- full hold: IN TRADE + outcomes on the main pip view
  await holdIn(pw, '[data-hold="enter"]', 2200);
  assert.strictEqual((await day()).entered, true, 'hold to enter works in the pip');
  let t = await pipText();
  assert.ok(t.includes('IN TRADE'), 'IN TRADE shown: ' + t);
  assert.strictEqual(await pw.locator('[data-act="log"]').count(), 4, 'outcome buttons in pip');
  await pw.screenshot({ path: path.join(OUT, 'p2-pip-intrade.png') });

  // ---- SL from the pip: After SL cooldown in the pip, UNDO in the bar
  await pw.locator('[data-act="log"][data-o="SL"]').click();
  await page.clock.runFor(300);
  assert.ok((await pipText()).toUpperCase().includes('SL → AFTER SL'), 'After SL runs in the pip');
  assert.strictEqual(await pw.locator('[data-act="pip-undo"]').count(), 1, 'UNDO bar in pip');
  let d = await day();
  assert.strictEqual(d.trades.length, 1);
  assert.strictEqual(d.trades[0].enteredViaHold, true);
  assert.strictEqual(d.trades[0].checklistComplete, true);
  await pw.locator('[data-act="pip-undo"]').click();
  await page.clock.runFor(300);
  d = await day();
  assert.strictEqual(d.trades.length, 0, 'undo removes the SL');
  assert.strictEqual(d.entered, true, 'back in the trade after undo');
  assert.strictEqual(await st(() => App.state.activeCooldown), null, 'undo cancels the After SL cooldown');
  assert.ok((await pipText()).includes('IN TRADE'));

  // ---- SL for real, cooldown runs out, then the after-stop item appears in the pip checklist
  await pw.locator('[data-act="log"][data-o="SL"]').click();
  await page.clock.runFor(301000);
  await pw.locator('[data-act="cd-done"]').click();
  await page.clock.runFor(300);
  await pw.locator('[data-act="pip-trade"]').click();
  await page.clock.runFor(300);
  assert.strictEqual(await pw.locator('[data-act="tr-toggle"]').count(), 5, 'after a stop: 5 checks');
  assert.ok((await pipText()).includes('AFTER A STOP'));
  await pw.screenshot({ path: path.join(OUT, 'p2-pip-afterstop.png') });
  const outBox = await pw.locator('[data-act="pip-trade-back"]').boundingBox();
  assert.ok(outBox && outBox.y + outBox.height <= 600, 'whole trade screen fits in the window (5 checks)');
  t = await pipText();
  assert.ok(t.includes('TRADE 02 / 02'), 'counter: ' + t);

  // ---- TP logged without entering (outcomes always available): Day done in the pip
  await pw.locator('[data-act="log"][data-o="TP"]').click();
  await page.clock.runFor(300);
  t = await pipText();
  assert.ok(t.includes('Day done'), 'day done in pip: ' + t);
  d = await day();
  assert.strictEqual(d.trades[1].checklistComplete, false, 'honest record: checklist not complete');
  await pw.screenshot({ path: path.join(OUT, 'p2-pip-daydone.png') });
  await pw.locator('[data-act="day-done-back"]').click();
  await page.clock.runFor(300);
  // cap reached: no trade checklist button, "Cap reached" shown
  t = await pipText();
  assert.ok(t.includes('Cap reached'), 'cap reached: ' + t);
  assert.strictEqual(await pw.locator('[data-act="pip-trade"]').count(), 0, 'no trade checklist at the cap');

  await ctx.close();
  await browser.close();
  const relevant = errors.filter(e => !/fonts\.(googleapis|gstatic)/.test(e));
  assert.deepStrictEqual(relevant, [], 'console errors: ' + relevant.join('\n'));
  console.log('patch 2 browser test passed · 0 console errors · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
