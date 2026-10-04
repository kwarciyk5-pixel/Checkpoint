// Part D browser test: a whole Tuesday through the app writes the event log; Done shows points + badges and
// exports the day file (a real download); Wednesday's Premarket asks for the fill; Import filled adds it
// without touching the events; Settings → Data has both buttons. Screenshots light + dim.
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules [FONT_DIR=...] node tests/log.browser.test.js [outDir]
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
const KEY = '2026-10-06';

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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true, serviceWorkers: 'block' });
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
  const types = () => st(k => (App.state.days[k].events || []).map(e => e.type), KEY);
  const setTheme = t => st(x => { App.state.settings.theme = x; document.documentElement.setAttribute('data-theme', x); }, t);
  const shot = name => page.screenshot({ path: path.join(OUT, name + '.png') });
  async function both(name) {
    await st(() => window.scrollTo(0, 0));
    await setTheme('light'); await shot('log-' + name + '-light');
    await setTheme('dim'); await shot('log-' + name + '-dim');
    await setTheme('auto');
  }
  const fits = async name => assert.ok(await st(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1), name + ' fits the phone screen');
  async function to(time) { await page.clock.setSystemTime(time); await page.clock.runFor(500); }
  async function hold(sel, ms) {
    await page.locator(sel).evaluate(el => el.scrollIntoView({ block: 'center' }));
    const b = await page.locator(sel).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.clock.runFor(ms);
    await page.mouse.up();
    await page.clock.runFor(100);
  }
  const row = k => page.locator('.ru-row[data-k="' + k + '"]');

  // ---- Premarket: gates, locks, a setup → gate_yes ×4, locks_ready, plan_ready (each once)
  await row('body').click();
  for (const b of await page.locator('.ru-open .gate-btns .yes').all()) await b.click();
  await row('accounts').click();
  for (const t of ['Copier on', 'Platform daily loss', 'Max order size']) await page.locator('.ru-open .item', { hasText: t }).click();
  await page.locator('.ru-open .item', { hasText: 'Copier on' }).click(); // untick + tick again: still one locks_ready
  await page.locator('.ru-open .item', { hasText: 'Copier on' }).click();
  await row('plan').click();
  await page.locator('[data-fk="su-0"]').fill('S1 long 30871-30900 · absorption · SL 30845 TP 30952');
  await page.locator('[data-act="card-grade"][data-i="0"][data-g="A"]').click();
  let t = await types();
  assert.deepStrictEqual(t.filter(x => x === 'gate_yes').length, 4);
  assert.deepStrictEqual(t.filter(x => x === 'locks_ready').length, 1, 'locks_ready once');
  assert.deepStrictEqual(t.filter(x => x === 'plan_ready').length, 1);
  const e0 = await st(k => App.state.days[k].events[0], KEY);
  assert.match(e0.t, /^2026-10-06T14:00:\d\d\+07:00$/, 'local ISO time with offset');
  assert.strictEqual(e0.detail, 'Slept enough');

  // ---- Session: urge, look (early), pick, ticks, enter, stopped, left desk, cooldown, look, enter, target
  await to(at(6, 20, 32));
  await hold('[data-hold="urgeNote"]', 3200);
  await page.locator('[data-act="home-look"]').click();
  await page.locator('.pick[data-act="setup-pick"]').first().click();
  for (let i = 0; i < 4; i++) await page.locator('[data-act="tr-toggle"]').nth(i).click();
  await hold('[data-hold="enter"]', 2300);
  await page.clock.runFor(60000);
  await page.locator('[data-act="log"][data-o="SL"]').click();
  await page.locator('[data-act="left-desk"]').click();
  await page.clock.runFor(301000);
  await page.locator('[data-act="cd-done"]').click();
  await to(at(6, 20, 50));
  await page.locator('[data-act="home-look"]').click();
  await page.locator('.pick[data-act="setup-pick"]').first().click();
  const n = await page.locator('[data-act="tr-toggle"]').count();
  for (let i = 0; i < n; i++) if (await page.locator('[data-act="tr-toggle"]').nth(i).getAttribute('aria-pressed') !== 'true') await page.locator('[data-act="tr-toggle"]').nth(i).click();
  await hold('[data-hold="enter"]', 2300);
  await page.clock.runFor(120000);
  await page.locator('[data-act="log"][data-o="TP"]').click();
  assert.strictEqual(await hs(), 'done');
  t = await types();
  const want = ['urge', 'start_looking', 'early_warning_shown', 'setup_pick:', 'check_tick:1', 'check_tick:4', 'enter', 'stopped', 'cooldown_start', 'left_desk', 'cooldown_end', 'start_looking', 'enter', 'target'];
  let i = 0;
  for (const x of t) if (i < want.length && x.startsWith(want[i])) i++;
  assert.strictEqual(i, want.length, 'events in order: ' + t.join(' '));
  assert.ok(!t.slice(t.lastIndexOf('start_looking')).includes('early_warning_shown'), 'no early warning at +20');
  const tr = await st(k => App.state.days[k].trades.map(x => x.id), KEY);

  // ---- Done: outcome per trade (no fill yet), urges, points, badge, Export today
  const sub = await page.locator('[data-done-sub]').textContent();
  assert.match(sub, /^stop · target · 1 urge resisted · \+\d+ pts$/);
  assert.ok(await page.locator('.badge', { hasText: 'walked away' }).isVisible());
  await fits('done');
  await page.clock.runFor(11000); // let the UNDO toast go before the screenshots
  await both('done');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act="export-today"]').click()]);
  assert.strictEqual(dl.suggestedFilename(), 'checkpoint-' + KEY + '.json');
  const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert.strictEqual(file.v, 2); assert.strictEqual(file.date, KEY); assert.strictEqual(file.filled, null);
  assert.strictEqual(file.tz, 'Asia/Bangkok');
  assert.deepStrictEqual(file.trades.map(x => x.outcome), ['sl', 'tp']);
  assert.strictEqual(file.trades[0].earlyWindow, true);
  assert.strictEqual(file.trades[1].earlyWindow, false);
  assert.strictEqual(file.trades[0].setup, 'S1 long 30871-30900 · absorption · SL 30845 TP 30952');
  assert.strictEqual(file.today.setups[0].grade, 'A');
  assert.strictEqual(file.gates['Slept enough'], 'yes');
  assert.strictEqual(file.locks['Copier on'], true);
  assert.strictEqual(file.urges, 1);
  assert.strictEqual(file.events[file.events.length - 1].type, 'export');
  assert.ok(await page.locator('[data-act="export-today"]', { hasText: 'Export again' }).isVisible());
  assert.ok(await page.locator('.done-acts [data-tab="stats"]').isVisible(), 'Stats link on Done (Part E)');
  fs.writeFileSync(path.join(OUT, 'checkpoint-' + KEY + '.json'), JSON.stringify(file, null, 2));

  // ---- Claude's fill comes back (written here); Wed 14:00 Premarket asks for it
  const evBefore = await st(k => JSON.stringify(App.state.days[k].events), KEY);
  file.filled = {
    trades: [
      { id: tr[0], contracts: 2, entry: 30872.5, stop: 30845, target: 30952, exit: 30845, r: -1, checks: { trigger: true, es: true, bracket: true, aloud: true, size: true, noadd: true, exitplan: true }, clean: true, box: 'CL', note: '' },
      { id: tr[1], contracts: 2, entry: 30880, stop: 30855, target: 30930, exit: 30930, r: 2, checks: { trigger: true, es: true, bracket: true, aloud: true, size: true, noadd: true, exitplan: true }, clean: true, box: 'CW', note: '' }
    ],
    offplanFills: [], dayClean: true, pointsAdj: 0, comment: ''
  };
  file.events.push({ t: 'x', type: 'injected' }); // the import must ignore this
  const filledPath = path.join(OUT, 'checkpoint-' + KEY + '-filled.json');
  fs.writeFileSync(filledPath, JSON.stringify(file, null, 2));
  await to(at(7, 14, 0));
  assert.strictEqual(await hs(), 'premarket');
  assert.ok(await page.locator('.ru-fill', { hasText: 'TUE 06 OCT isn\'t filled yet.' }).isVisible() ||
    await page.locator('.ru-fill', { hasText: 'Tue 06 Oct isn\'t filled yet.' }).isVisible());
  await both('premarket-unfilled');
  // An unfilled day file is refused
  const unfilledPath = path.join(OUT, 'checkpoint-' + KEY + '-unfilled.json');
  fs.writeFileSync(unfilledPath, JSON.stringify(Object.assign({}, file, { filled: null })));
  await page.locator('#import-filled').setInputFiles(unfilledPath);
  await page.waitForSelector('.modal');
  assert.ok((await page.locator('.modal').textContent()).includes('not filled yet'));
  await page.locator('.modal button', { hasText: 'OK' }).click();
  // The filled one goes in
  await page.locator('#import-filled').setInputFiles(filledPath);
  await page.waitForFunction(k => !!App.state.days[k].filled, KEY);
  assert.strictEqual(await st(k => JSON.stringify(App.state.days[k].events), KEY), evBefore, 'events untouched by the import');
  assert.strictEqual(await page.locator('.ru-fill').count(), 0, 'prompt gone once filled');
  const p = await st(k => App.pointsFor(App.state, k, new Date()), KEY);
  assert.strictEqual(p.clean, true);
  assert.strictEqual(p.items.find(x => x.k === 'clean').pts, 40, 'clean loss + clean win = +20 each');
  const ss = await st(() => App.seriesStatsFor(App.state, new Date()));
  assert.strictEqual(ss.streak, 1);
  assert.ok(ss.badges['clean loss'] && ss.badges['walked away']);
  assert.strictEqual(await st(() => App.state.days[App.homeNow().key] ? App.state.days[App.homeNow().key].events.map(e => e.type).join() : ''), 'import', 'import logged on the day it happened');

  // ---- Settings → Data: Export today / Import filled
  await page.locator('.home-head [data-tab="settings"]').click();
  await page.locator('[data-act="import-filled"]').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('[data-act="export-today"]', { hasText: 'EXPORT TODAY' }).isVisible());
  await setTheme('light'); await shot('log-settings-data-light');
  await setTheme('auto');

  assert.deepStrictEqual(errors, [], 'no console errors');
  await browser.close();
  console.log('log browser test passed · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
