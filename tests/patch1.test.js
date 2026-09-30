// Patch 1 browser checks: undo toast, session guards, reset-hour pending, clear history, erase all.
// Same setup as browser.test.js:
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules node tests/patch1.test.js [outDir]
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const at = (h, m) => new Date(2026, 9, 1, h, m, 0); // Thursday 1 Oct 2026

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text() + ' @ ' + (m.location().url || '')); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install({ time: at(13, 40) });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#view .wrap');
  const st = (fn) => page.evaluate(fn);
  const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') });
  const day = () => st(() => { const k = Object.keys(App.state.days).sort().pop(); return k ? App.state.days[k] : null; });
  const tab = (t) => page.locator('.tab[data-tab="' + t + '"]').click();
  const typed = async (word) => { await page.fill('#typed', word); await page.locator('#typed-ok').click(); };

  // ---- 1. Undo SL: trade removed, cooldown cancelled, back on Trade, recorded
  await tab('trade');
  await page.locator('[data-act="log"][data-o="SL"]').click();
  assert.strictEqual(await st(() => App.ui.tab), 'cooldown');
  assert.strictEqual(await st(() => App.state.activeCooldown && App.state.activeCooldown.trigger), 'sl');
  const undoBtn = page.locator('.toast button', { hasText: 'UNDO' });
  assert.ok(await undoBtn.isVisible(), 'undo toast visible');
  await shot('patch1-undo-toast');
  await page.clock.runFor(5000);
  await undoBtn.click();
  let d = await day();
  assert.strictEqual(d.trades.length, 0, 'SL removed');
  assert.strictEqual(await st(() => App.state.activeCooldown), null, 'cooldown cancelled');
  assert.strictEqual(await st(() => App.ui.tab), 'trade');
  assert.strictEqual(d.undone.length, 1);
  assert.strictEqual(d.undone[0].outcome, 'SL');
  assert.strictEqual(d.undone[0].cooldownCancelled, true);
  assert.strictEqual(await page.locator('.tag', { hasText: 'AFTER A STOP' }).count(), 0, 'after-stop item hidden again');

  // ---- 2. Undo TP: day-done screen goes away
  await page.locator('[data-act="log"][data-o="TP"]').click();
  assert.ok(await page.locator('h1', { hasText: 'Day done' }).isVisible());
  await page.locator('.toast button', { hasText: 'UNDO' }).click();
  assert.strictEqual((await day()).trades.length, 0);
  assert.strictEqual(await page.locator('h1', { hasText: 'Day done' }).count(), 0);

  // ---- 3. After 10s the undo is gone and the trade stays
  await page.locator('[data-act="log"][data-o="SCRATCH"]').click();
  await page.clock.runFor(10500);
  assert.strictEqual(await page.locator('.toast button', { hasText: 'UNDO' }).count(), 0, 'toast gone after 10s');
  assert.strictEqual((await day()).trades.length, 1);

  // ---- 4. Session live: guards + reset-hour pending
  await page.clock.setSystemTime(at(20, 45));
  await tab('settings');
  for (const act of ['reset', 'clear-history', 'erase-all']) {
    assert.ok(await page.locator('[data-act="' + act + '"]').isDisabled(), act + ' disabled during session');
  }
  assert.ok(await page.locator('text=available after the session').isVisible());
  await page.locator('#f-reset').fill('05:00');
  assert.strictEqual(await st(() => App.state.settings.resetHour), '06:00', 'reset hour not applied live');
  assert.ok((await page.locator('.pending', { hasText: '06:00 → 05:00' }).count()) === 1, 'reset hour pending row');
  await page.locator('[data-act="export"]').scrollIntoViewIfNeeded();
  await shot('patch1-settings-data-live');
  const backup = await st(() => JSON.stringify(App.state));
  await page.setInputFiles('#import-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  const replaceBtn = page.locator('.modal button', { hasText: 'Replace everything' });
  assert.ok(await replaceBtn.isDisabled(), 'Replace disabled during session');
  assert.ok(!(await page.locator('.modal button', { hasText: 'Merge' }).isDisabled()), 'Merge still allowed');
  await page.locator('.modal button', { hasText: 'Cancel' }).click();

  // ---- 5. Undo works during the session too
  await tab('trade');
  await page.locator('[data-act="log"][data-o="SL"]').click();
  await page.locator('.toast button', { hasText: 'UNDO' }).click();
  assert.strictEqual((await day()).trades.length, 1, 'only the SCRATCH remains');

  // ---- 6. Next reset: pending reset hour applies
  await page.clock.setSystemTime(new Date(2026, 9, 2, 6, 1));
  await page.clock.runFor(21000);
  assert.strictEqual(await st(() => App.state.settings.resetHour), '05:00', 'reset hour applied after the reset');

  // ---- 7. Outside the session: Clear history keeps settings
  await page.clock.setSystemTime(new Date(2026, 9, 2, 13, 0));
  await tab('settings');
  await page.locator('[data-act="cap"][data-d="-1"]').click();
  assert.strictEqual(await st(() => App.state.settings.rules.tradeCap), 1);
  await page.locator('[data-act="export"]').scrollIntoViewIfNeeded();
  await shot('patch1-settings-data');
  await page.locator('[data-act="clear-history"]').click();
  await typed('CLEAR');
  assert.strictEqual(await st(() => Object.keys(App.state.days).length), 0, 'history cleared');
  assert.strictEqual(await st(() => App.state.settings.rules.tradeCap), 1, 'settings kept');

  // ---- 8. Erase all data: only Checkpoint keys go
  await st(() => { localStorage.setItem('sanctuary-test', 'keep'); localStorage.setItem('checkpoint.v1.corrupt-1', 'x'); });
  await page.locator('[data-act="erase-all"]').click();
  await typed('ERASE');
  await page.clock.runFor(400);
  assert.strictEqual(await st(() => localStorage.getItem('sanctuary-test')), 'keep', 'other app data untouched');
  assert.strictEqual(await st(() => localStorage.getItem('checkpoint.v1.corrupt-1')), null);
  assert.strictEqual(await st(() => App.state.settings.rules.tradeCap), 2, 'defaults back');
  assert.strictEqual(await st(() => App.state.settings.resetHour), '06:00');
  assert.strictEqual(await st(() => JSON.parse(localStorage.getItem('checkpoint.v1')).settings.rules.tradeCap), 2, 'fresh data saved');
  assert.strictEqual(await st(() => App.ui.tab), 'premarket');

  await ctx.close();
  await browser.close();
  const relevant = errors.filter(e => !/fonts\.(googleapis|gstatic)/.test(e));
  assert.deepStrictEqual(relevant, [], 'console errors: ' + relevant.join('\n'));
  console.log('patch 1 browser test passed · 0 console errors · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
