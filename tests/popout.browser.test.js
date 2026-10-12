// v3.3 browser test: the whole app in the pop-out window (Today + Trade), modals and toasts inside it.
//   python3 -m http.server 8765 &   NODE_PATH=... node tests/popout.browser.test.js [outDir]
// Like float.browser.test.js, the window is a real popup handed to App.attachPip (headless has no PiP).
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const at = (d, h, m, s) => new Date(2026, 9, d, h, m, s || 0);
const SAMPLE = fs.readFileSync(path.join(__dirname, 'card-sample.txt'), 'utf8');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install({ time: at(12, 20, 20) });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#view .run');
  await page.evaluate(t => { const d = App.state.days['2026-10-12'] = App.state.days['2026-10-12'] || {}; }, SAMPLE);
  const [pw] = await Promise.all([ctx.waitForEvent('page'), page.evaluate(() => { const w = window.open('', 'cp-float', 'width=420,height=760'); App.attachPip(w); })]);
  await pw.setViewportSize({ width: 420, height: 760 });
  await page.clock.runFor(600);
  // Trade tab by default, with the tab switch; Today shows the run sheet
  assert.ok(await pw.locator('.pw-tabs').isVisible());
  assert.ok(await pw.locator('.run-trade').isVisible());
  await pw.locator('[data-act="pip-tab"][data-v="home"]').click();
  await page.clock.runFor(300);
  assert.ok(await pw.locator('.rs').isVisible());
  assert.strictEqual(await pw.locator('.pop-out:visible').count(), 0);
  await pw.screenshot({ path: path.join(OUT, 'popout-today.png') });
  // Paste the card from the window: the paste box opens in the window
  await pw.locator('.rs-row.cur [data-act="run-paste"], [data-act="run-paste"]').first().click().catch(() => {});
  await page.clock.runFor(1700);
  if (await pw.locator('#card-ta').count()) {
    await pw.locator('#card-ta').fill(SAMPLE);
    await pw.locator('#modal-root .modal button', { hasText: 'Use this card' }).click();
    await pw.locator('#modal-root .modal button', { hasText: 'Use it' }).click();
  }
  await page.clock.setSystemTime(at(12, 20, 50)); await page.clock.runFor(600);
  await pw.locator('[data-act="pip-tab"][data-v="trade"]').click();
  await page.clock.runFor(300);
  assert.ok(await pw.locator('.plan .su').first().isVisible());
  await pw.locator('.run-enter').first().click();
  await page.clock.runFor(400);
  assert.strictEqual(await page.evaluate(() => App.runNow().stage), 'intrade');
  assert.ok(await pw.locator('.toast', { hasText: 'In a trade' }).isVisible(), 'toast in the window');
  // Details modal opens in the window, not the main page
  await pw.locator('[data-act="run-details"][data-i="open"]').first().click();
  assert.strictEqual(await pw.locator('#modal-root .modal').count(), 1);
  assert.strictEqual(await page.locator('#modal-root .modal').count(), 0);
  await pw.locator('#d-setup').selectOption('S2');
  await pw.locator('#modal-root .modal button', { hasText: 'Save' }).click();
  await page.clock.runFor(400);
  assert.ok(/S2 short/.test(await pw.locator('.strip').first().innerText()));
  await pw.screenshot({ path: path.join(OUT, 'popout-intrade.png') });
  await pw.locator('[data-act="run-out"][data-o="SL"]').click();
  await page.clock.runFor(400);
  assert.strictEqual(await page.evaluate(() => App.runNow().stage), 'cool-red');
  assert.ok(await pw.locator('.ring-wrap').isVisible());
  await pw.screenshot({ path: path.join(OUT, 'popout-cool.png') });
  await browser.close();
  assert.deepStrictEqual(errors, [], errors.join(' | '));
  console.log('popout browser test passed · 0 page errors · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
