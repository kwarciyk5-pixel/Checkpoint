// Part C browser test: premarket roll-ups (Body · Plan · Accounts · Desk), the Today card editor, paste,
// the timed one-line reminder, Practising, and the card reaching Waiting / Looking / the next day.
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules [FONT_DIR=...] node tests/today.browser.test.js [outDir]
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
const FONT_DIR = process.env.FONT_DIR || '';
fs.mkdirSync(OUT, { recursive: true });
const at = (d, h, m, s) => new Date(2026, 9, d, h, m, s || 0); // Oct 2026 · 6 = Tue, 7 = Wed

async function routeFonts(ctx) {
  if (!FONT_DIR) return;
  const nm = path.join(FONT_DIR, 'node_modules');
  const fr = path.join(nm, '@fontsource-variable/fraunces/files/fraunces-latin-opsz-normal.woff2');
  const px = w => path.join(nm, '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-' + w + '-normal.woff2');
  const css = "@font-face{font-family:'Fraunces';font-weight:100 900;font-style:normal;src:url(https://fonts.gstatic.com/l/fraunces.woff2) format('woff2')}" +
    [400, 500, 600].map(w => "@font-face{font-family:'IBM Plex Sans';font-weight:" + w + ";src:url(https://fonts.gstatic.com/l/plex-" + w + ".woff2) format('woff2')}").join('');
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: css }));
  await ctx.route('https://fonts.gstatic.com/**', r => {
    const u = r.request().url();
    const f = u.includes('fraunces') ? fr : px((u.match(/plex-(\d+)/) || [0, 400])[1]);
    return r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(f) });
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.location().url || '')) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install({ time: at(6, 14, 0) });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#view .home');
  for (let i = 0; i < 3; i++) { try { await page.evaluate(() => Promise.all([document.fonts.load('30px Fraunces'), document.fonts.load('16px "IBM Plex Sans"')])); break; } catch (e) { await page.waitForTimeout(300); } }

  const st = (fn, a) => page.evaluate(fn, a);
  const hs = () => st(() => App.homeNow().state);
  const card = () => st(() => JSON.parse(JSON.stringify(App.state.days[App.homeNow().key].today)));
  const stat = k => page.locator('[data-ru-st="' + k + '"]').textContent();
  const setTheme = t => st(x => { App.state.settings.theme = x; document.documentElement.setAttribute('data-theme', x); }, t);
  const shot = name => page.screenshot({ path: path.join(OUT, name + '.png') });
  async function both(name, sel) {
    await st(q => { if (q) document.querySelector(q).scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0); }, sel);
    await setTheme('light'); await shot('today-' + name + '-light');
    await setTheme('dim'); await shot('today-' + name + '-dim');
    await setTheme('auto');
  }
  async function to(time) { await page.clock.setSystemTime(time); await page.clock.runFor(500); }
  const row = k => page.locator('.ru-row[data-k="' + k + '"]');

  // ---- Premarket, Tue 6 Oct 14:00: four roll-up rows, no long checklist, nothing due yet
  assert.strictEqual(await hs(), 'premarket');
  assert.ok((await page.locator('.home-head').textContent()).includes('DAY 1 OF 20'), 'series day 1');
  assert.deepStrictEqual((await page.locator('.ru-name').allTextContents()).map(t => t.trim()), ['Body', 'Plan', 'Accounts', 'Desk']);
  assert.strictEqual(await page.locator('.home .now-strip').count(), 0, 'v1 checklist no longer on home');
  assert.strictEqual(await page.locator('.ru-body').count(), 0, 'all rows closed');
  assert.strictEqual(await page.locator('.ru-now').count(), 0, 'nothing due at 14:00');
  assert.strictEqual(await stat('plan'), 'no setup yet');
  assert.strictEqual(await stat('accounts'), '0 / 3');
  assert.strictEqual(await stat('desk'), '0 / 7');
  assert.ok(await page.locator('.ru-practise-empty').isVisible());
  assert.strictEqual(await st(() => App.state.days[App.homeNow().key]), undefined, 'rendering premarket creates no day record');
  await both('premarket');

  // ---- Body: opens inline, gates answered → ✓; a tap outside closes it
  await row('body').click();
  assert.strictEqual(await page.locator('.ru-open[data-ru="body"] .item').count(), 5);
  for (const b of await page.locator('.ru-open .gate-btns .yes').all()) await b.click();
  assert.strictEqual(await stat('body'), '✓');
  await page.locator('[data-home-start]').click();
  assert.strictEqual(await page.locator('.ru-body').count(), 0, 'tap outside closes the row');
  // One open at a time
  await row('desk').click();
  await row('accounts').click();
  assert.deepStrictEqual(await page.locator('.ru-open').evaluateAll(e => e.map(x => x.getAttribute('data-ru'))), ['accounts']);
  // Accounts: only the three platform locks count
  for (const t of ['Copier on', 'Platform daily loss', 'Max order size']) await page.locator('.ru-open .item', { hasText: t }).click();
  assert.strictEqual(await stat('accounts'), '✓');
  await row('accounts').click();

  // ---- Plan: the Today card editor
  await row('plan').click();
  assert.ok(await page.locator('.card-ed').isVisible());
  assert.ok(await page.locator('.ru-open .item', { hasText: 'Trade plan for the day' }).isVisible(), 'the plan item shows under Plan');
  assert.strictEqual(await page.locator('.ru-open[data-ru="desk"]').count(), 0);
  await page.locator('[data-fk="su-0"]').fill('S1 long 30871-30900 · absorption + ES 7782 · SL 30845 TP 30952');
  // Tap a grade straight from the text field: the blur saves the line and the tap still lands.
  await page.locator('[data-act="card-grade"][data-i="0"][data-g="A"]').click();
  let c = await card();
  assert.strictEqual(c.setups[0].text, 'S1 long 30871-30900 · absorption + ES 7782 · SL 30845 TP 30952');
  assert.strictEqual(c.setups[0].grade, 'A', 'the grade tap was not lost');
  assert.strictEqual(await stat('plan'), '✓');
  assert.strictEqual((await page.locator('[data-ru-sum]').textContent()), '1 setup · 2 contracts');
  await page.locator('[data-act="card-grade"][data-i="0"][data-g="A"]').click();
  assert.strictEqual((await card()).setups[0].grade, null, 'tap again clears the grade');
  await page.locator('[data-act="card-grade"][data-i="0"][data-g="A+"]').click();
  await page.locator('[data-act="card-ct"][data-d="1"]').click();
  await page.locator('[data-act="card-band"][data-v="low"]').click();
  await page.locator('[data-fk="practising"]').fill('Footprint first, then the button.');
  await page.locator('[data-fk="su-1"]').click();
  c = await card();
  assert.deepStrictEqual([c.contracts, c.band, c.practising], [3, 'low', 'Footprint first, then the button.']);
  assert.strictEqual((await page.locator('[data-ru-sum]').textContent()), '1 setup · 3 contracts · low risk');
  assert.ok((await page.locator('.ru-practise').textContent()).includes('Footprint first'), 'Practising shows under the rows');
  await page.locator('[data-fk="su-1"]').fill('S2 short 30990 · rejection · SL 31010 TP 30950');
  await page.locator('[data-act="card-grade"][data-i="1"][data-g="B"]').click();
  await both('plan-open', '[data-ru="plan"]');

  // ---- Paste setups (clipboard blocked → the paste box)
  await st(() => { Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.reject(new Error('no')) }, configurable: true }); });
  await page.locator('[data-act="paste-setups"]').click();
  await page.waitForSelector('#paste-ta');
  await page.locator('#paste-ta').fill('S1 long 30880 · reclaim\n\nS2 short 31000 · fail\nS3 ignored');
  await page.locator('.modal button', { hasText: 'Use these' }).click();
  c = await card();
  assert.deepStrictEqual(c.setups.map(x => [x.text, x.grade]), [['S1 long 30880 · reclaim', null], ['S2 short 31000 · fail', null]]);
  assert.strictEqual(await page.locator('[data-fk="su-0"]').inputValue(), 'S1 long 30880 · reclaim');
  // Clipboard allowed → straight in, ids kept
  const id0 = c.setups[0].id;
  await st(() => { Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.resolve('S1 long 30871-30900 · absorption\nS2 short 30990 · rejection') }, configurable: true }); });
  await page.locator('[data-act="paste-setups"]').click();
  await page.waitForFunction(() => App.state.days[App.homeNow().key].today.setups[0].text === 'S1 long 30871-30900 · absorption');
  c = await card();
  assert.strictEqual(c.setups[0].id, id0, 'pasting keeps the setup ids');
  await page.locator('[data-act="card-grade"][data-i="0"][data-g="A"]').click();
  await page.locator('[data-home-start]').click();
  assert.strictEqual(await page.locator('.ru-body').count(), 0);

  // ---- 19:30: the timed item surfaces as one line with a tick
  await to(at(6, 19, 30));
  await page.waitForSelector('.ru-now');
  assert.ok((await page.locator('.ru-now').textContent()).includes('Prepare zones in chart'));
  await both('due-item');
  await page.locator('.ru-now .ru-tick').click();
  assert.ok((await page.locator('.ru-now').textContent()).includes('Rested'), 'next due item (18:50) comes up');
  await page.locator('.ru-now .ru-tick').click();
  assert.strictEqual(await page.locator('.ru-now').count(), 0);

  // ---- 20:31 Waiting shows the first setup; Looking lists both with grades
  await to(at(6, 20, 31));
  assert.strictEqual(await hs(), 'waiting');
  assert.ok(await page.locator('.home-sub', { hasText: 'S1 long 30871-30900 · absorption' }).isVisible());
  await page.locator('[data-act="home-look"]').click();
  assert.deepStrictEqual((await page.locator('.pick .txt').allTextContents()).map(t => t.trim()),
    ['S1 long 30871-30900 · absorption A', 'S2 short 30990 · rejection']);
  await page.locator('[data-act="home-back"]').click();

  // ---- Wed 7 Oct: contracts + practising carry over, setups start empty
  await to(at(7, 14, 0));
  assert.strictEqual(await hs(), 'premarket');
  assert.strictEqual(await stat('plan'), 'no setup yet');
  assert.ok((await page.locator('.ru-practise').textContent()).includes('Footprint first'));
  await row('plan').click();
  assert.strictEqual(await page.locator('.card-ed .stepper output').textContent(), '3');
  assert.strictEqual(await page.locator('[data-fk="su-0"]').inputValue(), '');
  assert.strictEqual(await page.locator('[data-act="card-band"][data-v="normal"]').getAttribute('aria-pressed'), 'true', 'band resets to normal');

  
  assert.deepStrictEqual(errors, [], 'no console errors');
  await browser.close();
  console.log('today browser test passed · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
