// Part A smoke test: Paper theme tokens, auto/light/dim theme, state band, bottom nav shell.
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules node tests/paper.test.js [outDir]
// Optional FONT_DIR=/path/with/node_modules/@fontsource... serves Fraunces + IBM Plex Sans locally
// (the sandbox has no internet, so screenshots otherwise fall back to system fonts).
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
const FONT_DIR = process.env.FONT_DIR || '';
fs.mkdirSync(OUT, { recursive: true });
const at = (d, h, m) => new Date(2026, 9, d, h, m, 0); // Oct 2026, local (TH) time

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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, colorScheme: 'light' });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.location().url || '')) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install({ time: at(5, 14, 0) }); // Mon 5 Oct, 14:00 TH
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#view .wrap');
  const loadFonts = () => page.evaluate(() => Promise.all([document.fonts.load('30px Fraunces'), document.fonts.load('16px "IBM Plex Sans"')]));
  for (let i = 0; i < 3; i++) { try { await loadFonts(); break; } catch (e) { await page.waitForTimeout(300); } }
  if (FONT_DIR) assert.ok(await page.evaluate(() => document.fonts.check('30px Fraunces')), 'Fraunces loaded');
  const st = fn => page.evaluate(fn);
  const shot = name => page.screenshot({ path: path.join(OUT, name + '.png') });
  const theme = () => st(() => document.documentElement.getAttribute('data-theme'));
  const band = () => page.locator('#band').getAttribute('data-s');
  const bg = () => st(() => getComputedStyle(document.body).backgroundColor);
  const go = t => page.evaluate(x => App.go(x), t); // v2 (Part B): Settings and Cooldown open from the home screen

  // ---- tokens + defaults
  assert.strictEqual(await st(() => App.state.settings.theme), 'auto');
  assert.strictEqual(await st(() => 'accent' in App.state.settings), false, 'accent setting removed');
  assert.strictEqual(await theme(), 'light', '14:00 TH = light');
  assert.strictEqual(await bg(), 'rgb(244, 239, 230)', 'paper #F4EFE6');
  assert.strictEqual(await band(), 'wait');
  assert.strictEqual(await st(() => document.body.getAttribute('data-nav')), 'show');
  await shot('paper-premarket-light');

  // ---- themeFor rules
  assert.strictEqual(await st(() => App.themeFor('auto', new Date(2026, 9, 5, 19, 0), false)), 'dim');
  assert.strictEqual(await st(() => App.themeFor('auto', new Date(2026, 9, 6, 5, 59), false)), 'dim');
  assert.strictEqual(await st(() => App.themeFor('auto', new Date(2026, 9, 6, 6, 0), false)), 'light');
  assert.strictEqual(await st(() => App.themeFor('auto', new Date(2026, 9, 6, 12, 0), true)), 'dim', 'OS dark wins');
  assert.strictEqual(await st(() => App.themeFor('light', new Date(2026, 9, 5, 21, 0), true)), 'light');

  // ---- auto flips to dim at 19:00 on the slow tick
  await page.clock.setSystemTime(at(5, 19, 1));
  await page.clock.runFor(21000);
  assert.strictEqual(await theme(), 'dim', 'auto dims after 19:00 TH');
  assert.strictEqual(await bg(), 'rgb(42, 39, 36)', 'dim #2A2724');
  await shot('paper-premarket-dim');

  // ---- trade tab, both themes
  await page.locator('.tab[data-tab="trade"]').click();
  await shot('paper-trade-dim');

  // ---- settings: theme override
  await go('settings');
  await page.locator('[data-act="theme"][data-v="light"]').click();
  assert.strictEqual(await theme(), 'light');
  assert.strictEqual(await st(() => App.state.settings.theme), 'light');
  await page.locator('[data-act="theme"]').first().scrollIntoViewIfNeeded();
  await shot('paper-settings-theme');
  await page.locator('[data-act="theme"][data-v="auto"]').click();
  assert.strictEqual(await theme(), 'dim');
  await page.locator('[data-act="theme"][data-v="light"]').click();

  // ---- band follows the day: cooldown = amber
  await go('cooldown');
  await page.locator('[data-act="cd-start"]').click();
  assert.strictEqual(await band(), 'cool', 'band amber during cooldown');
  await shot('paper-cooldown-light');

  assert.deepStrictEqual(errors, [], 'no console errors');
  await browser.close();
  console.log('paper (Part A) test passed · 0 console errors · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
