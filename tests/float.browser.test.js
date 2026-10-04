// Part G browser test: the floating window (spec §9) shows the home screen at 360 × 640 through the day:
// premarket roll-ups, Waiting, Looking, In trade (word loop + breathing run in the window), Stopped from the
// window → cooldown, Target → dark Done. A check-in never covers an open trade. Then the phone check:
// manifest, and Waiting / In trade / Done fit a 360 × 740 Android screen. Screenshots light + dim.
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules [FONT_DIR=...] node tests/float.browser.test.js [outDir]
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
const FONT_DIR = process.env.FONT_DIR || '';
fs.mkdirSync(OUT, { recursive: true });
const at = (d, h, m, s) => new Date(2026, 9, d, h, m, s || 0); // 6 = Tue

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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', deviceScaleFactor: 2 });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  const watch = p => {
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.location().url || '')) errors.push(m.text()); });
    p.on('pageerror', e => errors.push(String(e)));
  };
  watch(page);
  await page.clock.install({ time: at(6, 14, 0) });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#view .home');
  const st = (fn, a) => page.evaluate(fn, a);
  const [pw] = await Promise.all([ctx.waitForEvent('page'), st(() => { const w = window.open('', 'cp-float', 'width=360,height=640'); App.attachPip(w); })]);
  watch(pw);
  await pw.setViewportSize({ width: 360, height: 640 });
  await page.clock.runFor(600);
  for (let i = 0; i < 3; i++) { try { await pw.evaluate(() => Promise.all([document.fonts.load('30px Fraunces'), document.fonts.load('16px "IBM Plex Sans"')])); break; } catch (e) { await pw.waitForTimeout(300); } }
  const hs = () => pw.locator('.pw-home .home').getAttribute('data-hs');
  const theme = t => st(x => { App.state.settings.theme = x; document.documentElement.setAttribute('data-theme', x); }, t).then(() => pw.evaluate(x => document.documentElement.setAttribute('data-theme', x), t));
  const shot = name => pw.screenshot({ path: path.join(OUT, name + '.png') });
  async function both(name) { await theme('light'); await shot('float-' + name + '-light'); await theme('dim'); await shot('float-' + name + '-dim'); await theme('auto'); }
  const fits = async name => { const h = await pw.evaluate(() => [document.scrollingElement.scrollHeight, window.innerHeight]); if (h[0] > h[1] + 1) await shot('float-overflow-' + name.replace(/ /g, '-')); assert.ok(h[0] <= h[1] + 1, name + ' fits the 360 × 640 window: ' + h.join(' > ')); };
  async function to(t) { await page.clock.setSystemTime(t); await page.clock.runFor(600); }
  async function hold(sel, ms) {
    await pw.locator(sel).evaluate(el => el.scrollIntoView({ block: 'center' }));
    const b = await pw.locator(sel).boundingBox();
    await pw.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await pw.mouse.down();
    await page.clock.runFor(ms);
    await pw.mouse.up();
    await page.clock.runFor(150);
  }

  // ---- Premarket in the window: roll-ups, a row opens and a tap outside closes it; the card works here too
  assert.strictEqual(await hs(), 'premarket');
  assert.strictEqual(await pw.locator('.pw-home .ru-row').count(), 4);
  assert.strictEqual(await pw.locator('.pw-home [data-act="go-tab"]:visible').count(), 0, 'no page links in the window');
  await pw.locator('.ru-row[data-k="plan"]').click();
  await pw.locator('[data-fk="su-0"]').fill('S1 long 30871-30900 · absorption');
  await pw.locator('[data-act="card-grade"][data-i="0"][data-g="A"]').click();
  assert.strictEqual(await st(() => App.state.days[App.homeNow().key].today.setups[0].grade), 'A', 'card edits from the window');
  await pw.locator('[data-home-start]').click();
  assert.strictEqual(await pw.locator('.ru-body').count(), 0, 'tap outside closes the row in the window');
  await both('premarket');

  // ---- Waiting: home screen + check-in line
  await to(at(6, 20, 32));
  assert.strictEqual(await hs(), 'waiting');
  assert.ok((await pw.locator('.pw-ci').textContent()).includes('Next check-in 20:45'));
  assert.ok(await pw.locator('.big-n', { hasText: '+2' }).isVisible());
  await page.clock.runFor(60000);
  assert.ok(await pw.locator('.big-n', { hasText: '+3' }).isVisible(), '+N min ticks in the window without a re-render');
  await fits('waiting');
  await both('waiting');

  // ---- Looking → enter, all from the window
  await pw.locator('[data-act="home-look"]').click();
  assert.strictEqual(await hs(), 'looking');
  await pw.locator('.pick[data-act="setup-pick"]').first().click();
  for (let i = 0; i < 4; i++) await pw.locator('[data-act="tr-toggle"]').nth(i).click();
  await hold('[data-hold="enter"]', 2300);

  // ---- In trade: band live, word loop + breathing in the window; a due check-in does not cover it
  assert.strictEqual(await hs(), 'intrade');
  assert.strictEqual(await pw.locator('.pw-home').getAttribute('data-s'), 'live');
  assert.strictEqual(await pw.locator('.pw-ci').count(), 0, 'no check-in line in trade');
  assert.ok(await pw.evaluate(() => getComputedStyle(document.querySelector('.rings.breathe')).animationName === 'cp-breathe'), 'breathing keyframes in the window');
  const w0 = await pw.locator('.wl span.on').textContent();
  await page.clock.runFor(21000);
  assert.notStrictEqual(await pw.locator('.wl span.on').textContent(), w0, 'word loop moves on in the window');
  await to(at(6, 20, 45, 5)); // the 20:45 check-in falls due mid-trade
  assert.strictEqual(await pw.locator('.pw.lit').count(), 0, 'check-in waits while the trade is open');
  assert.ok(await pw.locator('[data-act="log"][data-o="SL"]').isVisible());
  await page.clock.runFor(1500);
  await fits('in trade');
  await both('intrade');

  // ---- Stopped in the window → cooldown view; left desk is on the main home; then the check-in shows
  await pw.locator('[data-act="log"][data-o="SL"]').click();
  await page.clock.runFor(300);
  assert.strictEqual(await hs(), 'cooldown', 'after a stop the window shows the home Cooldown');
  assert.strictEqual(await pw.locator('.pw-home').getAttribute('data-s'), 'cool');
  await page.clock.runFor(2000);
  assert.ok(/^4:5\d$/.test(await pw.locator('.home [data-cd-left]').first().textContent()), 'cooldown time ticks in the window');
  await pw.locator('[data-act="left-desk"]').click();
  assert.ok(await pw.locator('.home-note', { hasText: 'Left the desk' }).isVisible(), 'I left the desk from the window');
  await fits('cooldown');
  await both('cooldown');
  await page.clock.runFor(301000);
  await pw.locator('[data-act="cd-done"]').click();
  await page.clock.runFor(600);
  assert.ok((await st(() => App.state.days[App.homeNow().key].events.map(e => e.type))).includes('left_desk'));
  assert.strictEqual(await pw.locator('.pw.lit').count(), 1, 'the waiting check-in shows after the trade and cooldown');
  await pw.locator('[data-act="ci-answer"][data-a="good"]').click();
  await page.clock.runFor(11000);

  // ---- Second trade → Target → Done, dark
  await to(at(6, 20, 52));
  await pw.locator('[data-act="home-look"]').click();
  await pw.locator('.pick[data-act="setup-pick"]').first().click();
  const n = await pw.locator('[data-act="tr-toggle"]').count();
  for (let i = 0; i < n; i++) if (await pw.locator('[data-act="tr-toggle"]').nth(i).getAttribute('aria-pressed') !== 'true') await pw.locator('[data-act="tr-toggle"]').nth(i).click();
  await hold('[data-hold="enter"]', 2300);
  await page.clock.runFor(60000);
  await pw.locator('[data-act="log"][data-o="TP"]').click();
  await page.clock.runFor(11000);
  assert.strictEqual(await hs(), 'done');
  assert.strictEqual(await pw.evaluate(() => document.documentElement.getAttribute('data-home')), 'done');
  assert.ok(await pw.locator('[data-act="export-today"]').isVisible(), 'Export today from the window');
  await fits('done');
  await shot('float-done');
  const evs = await st(() => App.state.days[App.homeNow().key].events.map(e => e.type));
  assert.ok(evs.includes('stopped') && evs.includes('target') && evs.includes('enter'), 'window taps go into the event log');

  // ---- Phone check: manifest + a small Android screen
  const man = await (await page.request.get(BASE + 'manifest.webmanifest')).json();
  assert.strictEqual(man.display, 'standalone');
  assert.ok(man.icons.some(i => i.sizes === '512x512'), '512 icon');
  assert.ok(/^\.?\/?$|^\.\/index\.html$/.test(man.start_url) || man.start_url === './', 'relative start_url: ' + man.start_url);
  const phone = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await routeFonts(phone);
  const ph = await phone.newPage();
  watch(ph);
  await ph.clock.install({ time: at(6, 20, 33) });
  await ph.goto(BASE, { waitUntil: 'load' });
  await ph.waitForSelector('#view .home');
  const pfits = async name => assert.ok(await ph.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1), name + ' fits 360 × 740');
  await ph.evaluate(() => { const k = App.homeNow().key; App.state.days[k] = App.state.days[k] || {}; App.state.days[k].today = { setups: [{ id: 's1', text: 'S1 long 30871-30900 · absorption + ES 7782 · SL 30845 TP 30952', grade: 'A' }], contracts: 2, practising: '', band: 'normal' }; App.go('home'); });
  assert.strictEqual(await ph.evaluate(() => App.homeNow().state), 'waiting');
  await pfits('Waiting');
  await ph.screenshot({ path: path.join(OUT, 'phone360-waiting.png') });
  await ph.evaluate(() => { const d = App.state.days[App.homeNow().key]; d.entered = true; d.enteredAt = new Date().toISOString(); d.enteredSetup = 's1'; App.go('home'); });
  await ph.clock.runFor(1500);
  await pfits('In trade');
  await ph.screenshot({ path: path.join(OUT, 'phone360-intrade.png') });
  await ph.evaluate(() => { const d = App.state.days[App.homeNow().key]; d.entered = false; d.dllHit = new Date().toISOString(); App.go('home'); });
  assert.strictEqual(await ph.evaluate(() => App.homeNow().state), 'done');
  await pfits('Done');
  await ph.screenshot({ path: path.join(OUT, 'phone360-done.png') });
  await phone.close();

  assert.deepStrictEqual(errors, [], 'no console errors');
  await browser.close();
  console.log('float browser test passed · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
