// Part E browser test: Stats and Log pages with seven seeded days (filled, sat out, breach, unfilled),
// nav TODAY · TRADE · LOG · STATS, screenshots light + dim.
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules [FONT_DIR=...] node tests/stats.browser.test.js [outDir]
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
const FONT_DIR = process.env.FONT_DIR || '';
fs.mkdirSync(OUT, { recursive: true });
const at = (d, h, m) => new Date(2026, 9, d, h, m, 0);

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

// Seed: Tue 6 → Wed 14 Oct. Each day: [trades as [outcome, early, r, clean, box, trigger]], sitout, filled?
const SEED = {
  '2026-10-06': { t: [['SL', true, -1, true, 'CL', true], ['TP', false, 2, true, 'CW', true]], filled: true },
  '2026-10-07': { t: [['TP', false, 1.8, true, 'CW', true]], filled: true },
  '2026-10-08': { t: [], sitout: true, filled: true },
  '2026-10-09': { t: [['TP', true, 1.5, false, 'BW', false], ['SL', false, -1, false, 'BL', false], ['SL', false, -1, true, 'CL', true]], filled: true, off: 1 },
  '2026-10-12': { t: [['SL', false, -1, true, 'CL', true], ['TP', false, 2, true, 'CW', true]], filled: true },
  '2026-10-13': { t: [['TP', false, 2, true, 'CW', true]], filled: false },
  '2026-10-14': { t: [], filled: false }
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block' });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.location().url || '')) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install({ time: at(14, 14, 0) });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#view .home');
  for (let i = 0; i < 3; i++) { try { await page.evaluate(() => Promise.all([document.fonts.load('30px Fraunces'), document.fonts.load('16px "IBM Plex Sans"')])); break; } catch (e) { await page.waitForTimeout(300); } }
  const st = (fn, a) => page.evaluate(fn, a);
  const setTheme = t => st(x => { App.state.settings.theme = x; document.documentElement.setAttribute('data-theme', x); }, t);
  const shot = (name, full) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full });

  await st(seed => {
    const S = App.state;
    Object.keys(seed).forEach(k => {
      const d = seed[k];
      const trades = d.t.map((t, i) => ({ id: k + '-' + i, n: i + 1, outcome: t[0], earlyWindow: t[1], at: k + 'T14:0' + i + ':00Z', enteredAt: k + 'T13:5' + i + ':00Z', closedAt: k + 'T14:0' + i + ':00Z' }));
      const ev = [{ t: k + 'T19:40:00+07:00', type: 'locks_ready' }, { t: k + 'T19:41:00+07:00', type: 'plan_ready' }];
      if (d.sitout) ev.push({ t: k + 'T20:50:00+07:00', type: 'sitout' });
      trades.forEach((t, i) => { ev.push({ t: k + 'T20:4' + i + ':00+07:00', type: 'enter' }); ev.push({ t: k + 'T20:5' + i + ':00+07:00', type: t.outcome === 'SL' ? 'stopped' : 'target' }); });
      S.days[k] = { premarket: { checked: {}, gateNo: {}, later: [], collapsed: {} }, tradeChecks: {}, entered: false, trades, cooldowns: [], urges: [{ id: 'u' + k, at: '' }], undone: [], checkins: [], dayClosed: null, sessionOver: { checked: {} }, events: ev,
        filled: d.filled ? { trades: d.t.map((t, i) => ({ id: k + '-' + i, r: t[2], clean: t[3], box: t[4], checks: { trigger: t[5] } })), offplanFills: Array(d.off || 0).fill({}) } : null };
    });
    App.go(App.ui.tab);
  }, SEED);

  // ---- Nav: four tabs
  assert.deepStrictEqual(await page.locator('.tab').allTextContents(), ['TODAY', 'TRADE', 'LOG', 'STATS']);
  await page.locator('.tab[data-tab="stats"]').click();
  assert.strictEqual(await st(() => App.ui.tab), 'stats');
  const m = await st(() => App.statsFor(App.state, new Date()));
  // 9 filled trades (6,7,9,12) · clean 7 → 78%; day 7 of 20
  assert.strictEqual(m.trades, 8);
  assert.strictEqual(m.clean, 6);
  assert.strictEqual(m.cleanRate, 75);
  assert.strictEqual(m.day, 7); assert.strictEqual(m.of, 20);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(m.grid)), { CW: 3, CL: 3, BW: 1, BL: 1 });
  assert.deepStrictEqual(m.calendar.slice(0, 7).map(c => c.cls), ['clean', 'clean', 'sat', 'breach', 'clean', 'unfilled', 'today']);
  assert.strictEqual(m.streak, 1, 'breach on 9 Oct resets; 12 Oct clean; 13 unfilled skipped');
  assert.strictEqual(m.best, 3);
  assert.strictEqual(m.edge.n, 6, 'confirmed-trigger trades only');
  assert.ok(Math.abs(m.passR - 3.3) < 1e-9, 'sum of filled R: (-1+2) + 1.8 + (1.5-1-1) + (-1+2) = 3.3');
  assert.strictEqual(m.targetR, 10);
  assert.strictEqual(m.earlyVs, null, 'fewer than 5 early trades');
  assert.strictEqual(await page.locator('[data-st="clean"]').textContent(), '75%');
  assert.strictEqual(await page.locator('.st-cal .st-day.breach').count(), 1);
  assert.strictEqual(await page.locator('.st-bar').count(), 7);
  assert.ok((await page.locator('.st-sec .bar').boundingBox()).height >= 5, 'pass bar visible');
  assert.ok((await page.locator('.st-sec .bar > i').boundingBox()).width > 0, 'pass bar filled');
  assert.ok(!(await page.locator('.stats').textContent()).includes('$'), 'no dollar anywhere on Stats');
  await setTheme('light'); await shot('stats-light', true);
  await setTheme('dim'); await shot('stats-dim', true);
  await setTheme('auto');

  // ---- Log: newest day first, times + labels
  await page.locator('.tab[data-tab="log"]').click();
  const heads = await page.locator('.stats .eyebrow').allTextContents();
  assert.ok(/14 OCT/i.test(heads[0]), 'newest first: ' + heads[0]);
  assert.ok(heads.some(h => /12 OCT · FILLED/i.test(h)));
  assert.ok((await page.locator('.lg').first().textContent()).includes('19:40Accounts locked'));
  await setTheme('light'); await shot('log-light');
  await setTheme('auto');

  // ---- In trade the nav hides; Stats isn't reachable
  await st(() => { const d = App.state.days['2026-10-14']; d.entered = true; d.enteredAt = new Date().toISOString(); App.go(App.ui.tab); });
  assert.strictEqual(await st(() => App.ui.tab), 'home');
  assert.strictEqual(await st(() => document.body.getAttribute('data-nav')), 'hidden');

  assert.deepStrictEqual(errors, [], 'no console errors');
  await browser.close();
  console.log('stats browser test passed · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
