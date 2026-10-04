// Part B browser test: the home state machine end to end, with a screenshot of each state in light and dim.
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules [FONT_DIR=...] node tests/home.browser.test.js [outDir]
// FONT_DIR works as in paper.test.js. The Today card (Part C) is filled in directly here.
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
const FONT_DIR = process.env.FONT_DIR || '';
fs.mkdirSync(OUT, { recursive: true });
const at = (d, h, m, s) => new Date(2026, 9, d, h, m, s || 0); // Oct 2026 · 4 = Sun, 5 = Mon, 6 = Tue

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
  await page.clock.install({ time: at(5, 14, 0) });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#view .home');
  for (let i = 0; i < 3; i++) { try { await page.evaluate(() => Promise.all([document.fonts.load('30px Fraunces'), document.fonts.load('16px "IBM Plex Sans"')])); break; } catch (e) { await page.waitForTimeout(300); } }

  const st = (fn, a) => page.evaluate(fn, a);
  const hs = () => st(() => App.homeNow().state);
  const nav = () => st(() => document.body.getAttribute('data-nav'));
  const band = () => page.locator('#band').getAttribute('data-s');
  const setTheme = t => st(x => { App.state.settings.theme = x; document.documentElement.setAttribute('data-theme', x); }, t);
  const shot = name => page.screenshot({ path: path.join(OUT, name + '.png') });
  // Fits a 390 x 844 phone with no page scroll.
  const fits = async (name) => assert.ok(await st(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1), name + ' fits the phone screen');
  async function both(name) {
    await st(() => window.scrollTo(0, 0));
    await setTheme('light'); await shot('home-' + name + '-light');
    await setTheme('dim'); await shot('home-' + name + '-dim');
    await setTheme('auto');
  }
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

  // ---- Premarket (Mon 14:00): home is the default, nav shown, Settings reachable from the header
  assert.strictEqual(await hs(), 'premarket');
  assert.strictEqual(await st(() => App.ui.tab), 'home');
  assert.strictEqual(await nav(), 'show');
  assert.deepStrictEqual(await page.locator('.tab').allTextContents(), ['TODAY', 'TRADE']);
  assert.ok((await page.locator('.home-head').textContent()).includes('MON 05 OCT'));
  assert.ok(await page.locator('[data-home-start]', { hasText: 'Starts in 6h 30m' }).isVisible());
  assert.ok(await page.locator('.home-sub', { hasText: 'Session 20:30–21:40 · 09:30 ET' }).isVisible());
  assert.strictEqual(await page.locator('.home .ru-row').count(), 4, 'premarket roll-ups on home (Part C)');
  await both('premarket');
  await page.locator('.home-head [data-tab="settings"]').click();
  assert.strictEqual(await st(() => App.ui.tab), 'settings');
  assert.ok(await page.locator('.lbl', { hasText: 'Session window (New York time)' }).isVisible());
  assert.ok(await page.locator('.hint', { hasText: 'Here today: 20:30–21:40' }).isVisible());
  await page.locator('#f-gc').scrollIntoViewIfNeeded();
  await shot('home-settings-rules');
  await page.locator('.tab[data-tab="home"]').click();

  // Today card (Part C will edit it; set directly here): S1 ungraded, S2 grade B, S3 grade A
  await st(() => {
    const k = App.homeNow().key; // Part C: rendering premarket no longer creates the day record
    App.state.days[k] = App.state.days[k] || {};
    App.state.days[k].today = { setups: [
      { id: 's1', text: 'S1 long 30871-30900 · absorption + ES 7782 · SL 30845 TP 30952', grade: null },
      { id: 's2', text: 'S2 short 30990 · failed auction', grade: 'B' },
      { id: 's3', text: 'S3 long 30800 · reclaim', grade: 'A' }], contracts: 2 };
  });

  // ---- Waiting (+2 min, early window), 20:32 is after 19:00 so auto = dim
  await to(at(5, 20, 32));
  assert.strictEqual(await hs(), 'waiting');
  assert.strictEqual(await band(), 'wait');
  assert.ok(await page.locator('.big-n', { hasText: '+2' }).isVisible(), 'large +N min in the first 15 minutes');
  assert.ok(await page.locator('.home-line', { hasText: 'Early window.' }).isVisible());
  assert.ok(await page.locator('.home-sub', { hasText: 'S1 long 30871-30900' }).isVisible(), 'first setup under the rings');
  assert.ok(await page.locator('.home-count', { hasText: 'trade 0 of 2 · 0 urges resisted' }).isVisible());
  await fits('waiting');
  await both('waiting-early');
  // felt the urge, didn't act: 3 s hold logs it, no cooldown
  await hold('[data-hold="urgeNote"]', 3200);
  assert.strictEqual(await st(() => App.state.activeCooldown), null, 'urge note starts no cooldown');
  assert.ok(await page.locator('.home-count', { hasText: '1 urge resisted' }).isVisible());

  // ---- Looking (+10, still early): amber line, setups, checks, hold to enter
  await to(at(5, 20, 40));
  await page.locator('[data-act="home-look"]').click();
  assert.strictEqual(await hs(), 'looking');
  assert.ok(await page.locator('.home-amber', { hasText: 'Early. If this stops out' }).isVisible());
  assert.strictEqual(await page.locator('.pick[data-act="setup-pick"]').count(), 3);
  assert.strictEqual(await page.locator('[data-act="tr-toggle"]').count(), 4, 'after-stop check hidden before a stop');
  assert.ok(await page.locator('.enter.off').isDisabled());
  for (let i = 0; i < 4; i++) await page.locator('[data-act="tr-toggle"]').nth(i).click();
  assert.ok((await page.locator('.enter.off').textContent()).includes('Pick the setup first.'));
  await page.locator('.pick[data-id="s1"]').click();
  assert.strictEqual(await page.locator('.pick[data-id="s1"]').getAttribute('aria-checked'), 'true');
  await both('looking-early');
  // Back to waiting keeps the ticks
  await page.locator('[data-act="home-back"]').click();
  assert.strictEqual(await hs(), 'waiting');
  await page.locator('[data-act="home-look"]').click();
  assert.strictEqual(await page.locator('[data-act="tr-toggle"][aria-pressed="true"]').count(), 4, 'ticks kept within 10 min');
  await page.locator('.pick[data-id="s1"]').click();
  await hold('[data-hold="enter"]', 2300);

  // ---- In trade: band live, nav hidden, word loop, elapsed, only Stopped / Target
  assert.strictEqual(await hs(), 'intrade');
  assert.strictEqual(await band(), 'live');
  assert.strictEqual(await nav(), 'hidden');
  assert.ok((await page.locator('.home-head').textContent()).includes('S1 long 30871-30900 · 2 contracts'));
  assert.strictEqual(await page.locator('.wl span.on').textContent(), 'The bracket is on. Nothing to decide.');
  await page.clock.runFor(21000);
  assert.strictEqual(await page.locator('.wl span.on').textContent(), 'Both exits were named before the open. The trade is already managed.');
  assert.match(await page.locator('[data-home-el]').textContent(), /^0:2[12]$/);
  assert.ok(await page.locator('.home-count', { hasText: 'trade 1 of 2' }).isVisible());
  await page.locator('.tab[data-tab="trade"]').evaluate(el => el.click()); // hidden nav: still forced home
  assert.strictEqual(await hs(), 'intrade');
  assert.strictEqual(await st(() => App.ui.tab), 'home');
  await page.clock.runFor(1500); // let the crossfade settle
  await fits('in trade');
  await both('intrade');

  // ---- Stopped -> After SL cooldown on home; undo is offered
  await page.locator('[data-act="log"][data-o="SL"]').click();
  assert.strictEqual(await hs(), 'cooldown');
  assert.strictEqual(await band(), 'cool');
  assert.ok(await page.locator('.toast button', { hasText: 'UNDO' }).isVisible());
  assert.ok(await page.locator('.home-line', { hasText: 'A clean loss.' }).isVisible());
  assert.ok(await page.locator('.home-sub', { hasText: 'one of the expected ones' }).isVisible());
  assert.deepStrictEqual(await page.locator('.home .step .txt b').allTextContents(),
    ['Two physiological sighs', 'Stand up, leave the desk', 'One minute: in 4, out 8, looking far away', 'Cold water on the face (optional — try it once on a calm day first)']);
  assert.ok(await page.locator('.home-foot .btn[disabled]', { hasText: 'Entry locked' }).isVisible());
  const tr = await st(() => App.state.days['2026-10-05'].trades[0]);
  assert.strictEqual(tr.setupId, 's1');
  assert.strictEqual(tr.earlyWindow, true, 'entered at +10');
  assert.strictEqual(tr.openOffsetMin, 10);
  await fits('cooldown');
  await page.locator('[data-act="left-desk"]').click();
  assert.ok(await page.locator('.home-note', { hasText: 'Left the desk · logged' }).isVisible());
  await page.clock.runFor(10500);
  await both('cooldown');
  await page.clock.runFor(300000);
  assert.ok(await page.locator('[data-act="cd-done"]', { hasText: 'Back to waiting' }).isVisible());
  await shot('home-cooldown-finished-dim');
  await page.locator('[data-act="cd-done"]').click();

  // ---- Waiting after the early window: the line changes, header shrinks
  await to(at(5, 20, 50));
  assert.strictEqual(await hs(), 'waiting');
  assert.strictEqual(await page.locator('.big-n').count(), 0);
  assert.ok(await page.locator('.home-line', { hasText: 'A zone is not a trigger.' }).isVisible());
  assert.ok(await page.locator('.home-count', { hasText: 'trade 1 of 2 · 1 urge resisted' }).isVisible());
  await both('waiting');

  // ---- Looking after an early stop: A only (S2 = B greyed, S1 = the setup that stopped greyed)
  await page.locator('[data-act="home-look"]').click();
  assert.strictEqual(await page.locator('.home-amber').count(), 0, 'no early warning at +20');
  assert.ok(await page.locator('.pick[data-id="s1"]').isDisabled());
  assert.ok(await page.locator('.pick[data-id="s2"]').isDisabled());
  assert.ok(!(await page.locator('.pick[data-id="s3"]').isDisabled()));
  assert.ok(await page.locator('.pick[data-id="s2"] small', { hasText: 'not after an early stop' }).isVisible());
  assert.strictEqual(await page.locator('[data-act="tr-toggle"]').count(), 5, 'after-stop check shows');
  assert.ok(await page.locator('[data-act="tr-toggle"]', { hasText: 'said out loud' }).isVisible());
  await page.locator('.pick[data-id="s3"]').click();
  for (let i = 0; i < 5; i++) await page.locator('[data-act="tr-toggle"]').nth(i).click();
  await both('looking-after-early-stop');
  await hold('[data-hold="enter"]', 2300);
  assert.strictEqual(await hs(), 'intrade');

  // ---- Target -> 2 trades = cap -> Done (dark, inverted)
  await page.locator('[data-act="log"][data-o="TP"]').click();
  assert.strictEqual(await hs(), 'done');
  assert.strictEqual(await band(), 'done');
  assert.strictEqual(await nav(), 'show');
  assert.strictEqual(await st(() => document.documentElement.getAttribute('data-home')), 'done');
  assert.strictEqual(await st(() => getComputedStyle(document.body).backgroundColor), 'rgb(28, 26, 23)', 'Done is the inverted screen');
  assert.ok(await page.locator('.home-line', { hasText: 'Two trades.' }).isVisible());
  assert.strictEqual(await page.locator('.done-circle').textContent(), 'cap');
  assert.ok(await page.locator('.home-sub', { hasText: 'stop · target · 1 urge resisted' }).isVisible());
  assert.deepStrictEqual(await page.locator('.so-row span:first-child').allTextContents(), ['Accounts locked', 'Charts closed (Pyae\'s too)', 'Away from the desk']);
  await fits('done');
  await page.locator('.so-row').first().click();
  assert.strictEqual(await page.locator('.so-row[aria-pressed="true"]').count(), 1);
  await page.clock.runFor(10500);
  await both('done');
  const tr2 = await st(() => App.state.days['2026-10-05'].trades[1]);
  assert.strictEqual(tr2.setupId, 's3');
  assert.strictEqual(tr2.grade, 'A');
  assert.strictEqual(tr2.earlyWindow, false);

  // ---- Done by time with nothing traded: "Window closed."
  await to(at(6, 21, 45));
  assert.strictEqual(await hs(), 'done');
  assert.ok(await page.locator('.home-line', { hasText: 'Window closed.' }).isVisible());
  assert.strictEqual(await page.locator('.done-circle').textContent(), '21:40');

  // ---- DLL tap ends the day
  await to(at(7, 20, 35));
  assert.strictEqual(await hs(), 'waiting');
  await page.locator('[data-act="limit-hit"][data-k="dll"]').click();
  await page.locator('.modal button', { hasText: 'Yes, the day is done' }).click();
  assert.strictEqual(await hs(), 'done');
  assert.ok(await page.locator('.home-line', { hasText: 'The lock fired.' }).isVisible());
  assert.ok(await page.locator('.done-msg', { hasText: 'hands off the mouse' }).isVisible(), 'Red Day message on Done');

  // ---- Observation day (gate answered no): no start button
  await to(at(8, 14, 0));
  assert.strictEqual(await hs(), 'premarket');
  await page.locator('.ru-row[data-k="body"]').click(); // Part C: the gates live in the Body roll-up
  await page.locator('.home [aria-label="Slept enough: no"]').first().click();
  assert.strictEqual(await page.locator('[data-ru-st="body"]').textContent(), 'observation day');
  await to(at(8, 20, 35));
  assert.strictEqual(await hs(), 'observe');
  assert.ok(await page.locator('.home-line', { hasText: 'Observation day.' }).isVisible());
  assert.strictEqual(await page.locator('[data-act="home-look"]').count(), 0);
  await both('observe');

  // ---- Off day (Sat 10 Oct): quiet screen, Show anyway
  await to(at(10, 14, 0));
  assert.strictEqual(await hs(), 'offday');
  await both('offday');
  await page.locator('[data-act="home-show-anyway"]').click();
  assert.strictEqual(await hs(), 'premarket');

  // ---- Desktop: same single column
  await page.setViewportSize({ width: 1280, height: 800 });
  await to(at(12, 20, 33));
  assert.strictEqual(await hs(), 'waiting');
  await setTheme('dim');
  await shot('home-desktop-waiting-dim');

  assert.deepStrictEqual(errors, [], 'no console errors');
  await browser.close();
  console.log('home (Part B) browser test passed · 0 console errors · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
