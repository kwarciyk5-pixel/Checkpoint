// v3 browser test: a whole evening on the run sheet (spec v3 §2–§6), iPad portrait 820 × 1180, with the
// in-trade and cooldown screens also checked on a 390 × 844 phone (no scroll). Screenshots light + dim.
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules [FONT_DIR=...] node tests/runsheet.browser.test.js [outDir]
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
const FONT_DIR = process.env.FONT_DIR || '';
fs.mkdirSync(OUT, { recursive: true });
const at = (d, h, m, s) => new Date(2026, 9, d, h, m, s || 0); // Oct 2026 · 12 = Mon
const SAMPLE = fs.readFileSync(path.join(__dirname, 'card-sample.txt'), 'utf8');

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
  const IPAD = { width: 820, height: 1180 }, PHONE = { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport: IPAD, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block' });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.location().url || '')) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install({ time: at(12, 18, 0) });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#view .run');
  for (let i = 0; i < 3; i++) { try { await page.evaluate(() => Promise.all([document.fonts.load('30px Fraunces'), document.fonts.load('16px "IBM Plex Sans"')])); break; } catch (e) { await page.waitForTimeout(300); } }

  const ev = (fn, a) => page.evaluate(fn, a);
  const stage = () => ev(() => App.runNow().stage);
  const strip = () => page.locator('.run .strip').innerText();
  const setTheme = t => ev(x => { App.state.settings.theme = x; document.documentElement.setAttribute('data-theme', x); }, t);
  const shot = name => page.screenshot({ path: path.join(OUT, name + '.png') });
  async function both(name) {
    await ev(() => { window.scrollTo(0, 0); document.getElementById('toast-root').innerHTML = ''; });
    await page.waitForTimeout(1100); // let a calm-line crossfade finish (real time, the page clock stays put)
    await setTheme('light'); await shot('run-' + name + '-light');
    await setTheme('dim'); await shot('run-' + name + '-dim');
    await setTheme('auto');
  }
  async function to(time) { await page.clock.setSystemTime(time); await page.clock.runFor(600); }
  async function fitsPhone(name) {
    await page.setViewportSize(PHONE);
    await page.clock.runFor(300);
    await ev(() => { document.getElementById('toast-root').innerHTML = ''; });
    const fit = await ev(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1);
    await ev(() => window.scrollTo(0, 0));
    await shot('run-' + name + '-phone');
    await page.setViewportSize(IPAD);
    await page.clock.runFor(300);
    assert.ok(fit, name + ' fits a 390 × 844 phone with no scroll');
  }
  const modalBtn = label => page.locator('#modal-root .modal button', { hasText: label }).first();

  // 18:00 · before the desk
  assert.strictEqual(await stage(), 'before');
  assert.ok(/YOU ARE HERE · BEFORE DESK[\s\S]*Desk at 19:30/.test(await strip()));
  assert.strictEqual(await ev(() => document.body.getAttribute('data-nav')), 'show');

  // 19:54 · at desk: Today is the run sheet only (no trade buttons), current step boxed
  await to(at(12, 19, 54));
  assert.strictEqual(await stage(), 'desk');
  assert.ok(/AT DESK[\s\S]*At desk since 19:30 · now: 1BB Pack lands/.test(await strip()));
  assert.strictEqual(await page.locator('.rs-row.cur .rs-x > b').innerText(), '1BB Pack lands');
  assert.strictEqual(await page.locator('.run-enter').count(), 0, 'no trade button on Today');
  await both('desk');

  // 20:09 · inventory: the gate boxes sit in the current step
  await to(at(12, 20, 9));
  assert.ok(/Inventory/.test(await page.locator('.rs-row.cur .rs-x > b').innerText()));
  for (let i = 0; i < 4; i++) await page.locator('.rs-row.cur .gate-btns .yes').nth(i).click();
  assert.strictEqual(await page.locator('.rs-row.cur .gate-btns .yes[aria-pressed="true"]').count(), 4);

  // 20:14 · build: locks, paste the card (no clipboard here → the paste box), dated 9 Oct → confirm
  await to(at(12, 20, 14));
  assert.ok(/Build/.test(await page.locator('.rs-row.cur .rs-x > b').innerText()));
  for (let i = 0; i < 3; i++) await page.locator('.rs-row.cur .rs-build .item').nth(i).click();
  await page.locator('.rs-row.cur [data-act="run-paste"]').click();
  await page.clock.runFor(1600); // no clipboard answer here → the paste box
  await page.locator('#card-ta').fill(SAMPLE);
  await modalBtn('Use this card').click();
  assert.ok(/dated 2026-10-09/.test(await page.locator('#modal-root .modal h2').innerText()));
  await modalBtn('Use it').click();
  await page.clock.runFor(300);
  assert.strictEqual(await stage(), 'built');
  assert.ok(/BUILT[\s\S]*Built 20:14 · open in 16 min/.test(await strip()));
  await both('built');

  // 20:38 · Today offers the Trade tab; Trade = Ready: plan for reference, one-tap "In a trade" (early window written under it)
  await to(at(12, 20, 38));
  assert.strictEqual(await stage(), 'watching');
  await page.locator('[data-act="go-tab"][data-tab="trade"]').first().click();
  await page.clock.runFor(300);
  assert.ok(await page.locator('.run-amber', { hasText: 'Early window until 20:45' }).isVisible());
  assert.strictEqual(await page.locator('.plan .su').count(), 4);
  assert.ok(await page.locator('.run-flag', { hasText: 'early window' }).isVisible());
  await both('ready');
  await page.locator('.run-enter').click();
  await page.clock.runFor(300);
  assert.strictEqual(await page.locator('#modal-root .modal').count(), 0, 'no question on entry');

  // In trade: strip says what she tapped; nav stays; calm line every 10 s; details any time
  assert.strictEqual(await stage(), 'intrade');
  assert.ok(/IN TRADE[\s\S]*entered 20:38 · you tapped In a trade/.test(await strip()));
  assert.strictEqual(await ev(() => document.body.getAttribute('data-nav')), 'show');
  const line1 = await page.locator('.wl[data-calm] span.on').innerText();
  assert.ok(await ev(l => App.CALM_DEFAULT.intrade.indexOf(l) >= 0, line1));
  const n1 = await page.locator('.wl[data-calm]').getAttribute('data-calm');
  await page.clock.runFor(10500);
  assert.strictEqual(+(await page.locator('.wl[data-calm]').getAttribute('data-calm')), +n1 + 1, 'a new line after 10 s');
  await page.locator('[data-act="run-details"][data-i="open"]').first().click();
  await page.locator('#d-setup').selectOption('S1');
  await page.locator('#d-fit').selectOption('planned');
  await page.locator('.det-ck input').nth(0).check();
  await page.locator('.det-ck input').nth(1).check();
  await page.locator('#d-ct').fill('2');
  await modalBtn('Save').click();
  await page.clock.runFor(300);
  assert.ok(/S1 long · entered 20:38/.test(await strip()));
  assert.ok(await page.locator('.tile', { hasText: '31,090' }).isVisible());
  await both('intrade');
  await fitsPhone('intrade');
  assert.ok((await ev(() => App.state.days['2026-10-12'].events.map(e => e.type))).includes('flag:early_window'));

  // Target: one tap, R estimated from S1's R:R (1:1.4) → green cooldown
  await page.locator('[data-act="run-out"][data-o="TP"]').click();
  await page.clock.runFor(300);
  assert.strictEqual(await page.locator('#modal-root .modal').count(), 0, 'no question on exit');
  assert.strictEqual(await stage(), 'cool-green');
  assert.ok(/COOLDOWN · GREEN[\s\S]*You tapped Target \(\+1\.4R\) at 20:38/.test(await strip()));
  assert.ok(await ev(l => App.CALM_DEFAULT.green.indexOf(l) >= 0, await page.locator('.wl[data-calm] span.on').innerText()));
  assert.ok(await page.locator('.allowed', { hasText: '+1.6R more ends the day' }).isVisible());
  await both('cool-green');
  await fitsPhone('cool-green');

  // back to Ready by itself; tonight's trades shows the details
  await to(at(12, 20, 43, 30));
  assert.strictEqual(await stage(), 'watching');
  const row1 = await page.locator('.tr-row').first().innerText();
  assert.ok(/Target · \+1\.4R[\s\S]*est\.[\s\S]*S1 long · as planned · 2 checks · 2 ct/.test(row1), row1);

  // 20:50 · second trade: moved the stop (flag), Stopped → red cooldown; fix its R in details during the cooldown
  await to(at(12, 20, 50));
  await page.locator('.run-enter').click();
  await page.clock.runFor(300);
  await page.locator('[data-act="run-stopmoved"]').click();
  await page.locator('[data-act="run-out"][data-o="SL"]').click();
  await page.clock.runFor(300);
  assert.strictEqual(await stage(), 'cool-red');
  assert.ok(/You tapped Stopped at 20:50 · ends 20:55/.test(await strip()));
  assert.ok(await ev(l => App.CALM_DEFAULT.red.indexOf(l) >= 0, await page.locator('.wl[data-calm] span.on').innerText()));
  assert.ok(await page.locator('.run-flag', { hasText: 'cooldown' }).isVisible());
  await both('cool-red');
  await fitsPhone('cool-red');
  await ev(() => App.go('trade'));
  await page.clock.runFor(300);
  await ev(() => document.querySelector('[data-act="run-details"][data-i="1"]') || null);
  await page.locator('.tab[data-tab="trade"]').click();
  await to(at(12, 20, 56));
  await page.locator('[data-act="run-details"][data-i="1"]').click();
  await page.locator('#d-r').fill('-0.5');
  await modalBtn('Save').click();
  await page.clock.runFor(300);
  assert.strictEqual(Math.round(await ev(() => App.dayRFor(App.state, App.state.days['2026-10-12'])) * 10) / 10, 0.9);

  // 21:10 · third idea (flag written before the tap) → Out · other → green cooldown
  await to(at(12, 21, 10));
  assert.ok(await page.locator('.run-flag', { hasText: '3rd idea' }).isVisible());
  await page.locator('.run-enter').click();
  await page.clock.runFor(300);
  await page.locator('[data-act="run-out"][data-o="OUT"]').click();
  await page.clock.runFor(300);
  assert.strictEqual(await stage(), 'cool-green');
  assert.ok(/You tapped Out at 21:10/.test(await strip()));

  // 21:16 · fourth → Stopped = 2nd SL → cooldown, then Overtime
  await to(at(12, 21, 16));
  await page.locator('.run-enter').click();
  await page.clock.runFor(300);
  await page.locator('[data-act="run-out"][data-o="SL"]').click();
  await to(at(12, 21, 22));
  assert.strictEqual(await stage(), 'overtime');
  assert.ok(/OVERTIME[\s\S]*Day was done at 21:16 · because: 2nd SL · window closes 21:30/.test(await strip()));
  assert.strictEqual(await ev(() => document.documentElement.getAttribute('data-run')), 'overtime');

  // Overtime: still one tap, flagged after done
  await page.locator('.run-enter').click();
  await page.clock.runFor(300);
  assert.strictEqual(await stage(), 'intrade');
  await page.locator('[data-act="run-out"][data-o="SL"]').click();
  await to(at(12, 21, 28));
  assert.strictEqual(await stage(), 'overtime');
  const flagged = await page.locator('.flagged').innerText();
  assert.ok(/early window/.test(flagged) && /moved the stop/.test(flagged) && /3rd idea/.test(flagged) && /the day is done/.test(flagged), flagged);
  await both('overtime');

  // Close the night: summary + the quiet "without details" line
  await page.locator('[data-act="run-close"]').click();
  await page.clock.runFor(300);
  assert.strictEqual(await stage(), 'closed');
  assert.ok(/CLOSED[\s\S]*You closed the night at 21:28/.test(await strip()));
  assert.ok(await page.locator('.run-sub', { hasText: '5 ideas · 3 SL · 1 target' }).isVisible());
  assert.ok(await page.locator('[data-run-nod]', { hasText: '3 trades without details · fill now or let Claude do it at EOD' }).isVisible());
  await both('closed');

  // Today after closing: still just the run sheet
  await page.locator('.tab[data-tab="home"]').click();
  await page.clock.runFor(300);
  assert.strictEqual(await page.locator('.run-enter').count(), 0);
  await shot('run-today-closed');

  // Log shows the flags; every page carries the compact "you are here" strip
  await page.locator('.tab[data-tab="log"]').click();
  await page.clock.runFor(300);
  assert.ok(await page.locator('#view .strip', { hasText: 'CLOSED' }).isVisible());
  assert.ok(await page.locator('.lg', { hasText: 'Flagged · the day is done' }).first().isVisible());
  await shot('run-log');
  await page.locator('.tab[data-tab="stats"]').click();
  await page.clock.runFor(300);
  assert.ok(await page.locator('.st-flags', { hasText: 'the day is done' }).isVisible());
  await shot('run-stats');

  // Export today is v3 with cards, flags and day R
  const exp = await ev(() => App.exportTodayFor(App.state, '2026-10-12'));
  assert.strictEqual(exp.v, 3);
  assert.strictEqual(exp.cards.length, 1);
  assert.strictEqual(Math.round(exp.dayR * 10) / 10, -1.1);
  assert.ok(exp.flags.length >= 4);
  assert.strictEqual(exp.trades[0].details.setup, 'S1');

  // Settings: every section folded; open one, it stays open while she edits; no Home view (classic) switch
  await ev(() => App.go('settings'));
  await page.clock.runFor(300);
  assert.ok((await page.locator('details.sec').count()) >= 8);
  assert.strictEqual(await page.locator('details.sec[open]').count(), 0, 'all folded at first');
  assert.strictEqual(await page.locator('[data-act="home-view"]').count(), 0, 'classic switch gone');
  await shot('run-settings');
  await page.locator('details.sec[data-sec="Calm sound"] > summary').click();
  await page.locator('[data-act="audio-pick"][data-key="trade"][data-v="pad"]').click();
  await page.clock.runFor(300);
  assert.ok(await page.locator('details.sec[data-sec="Calm sound"]').evaluate(d => d.open), 'stays open after a change');
  assert.strictEqual(await ev(() => App.state.settings.audio.trade), 'pad');
  await shot('run-settings-sound');
  await page.locator('details.sec[data-sec="Run sheet & calm words"] > summary').click();
  await page.locator('[data-act="open-runsheet"]').click();
  assert.strictEqual(await page.locator('.rs-ed').count(), 11);
  await page.locator('[data-act="editor-back"]').click();
  await page.locator('[data-act="open-calm"]').click();
  assert.strictEqual(await page.locator('#calm-intrade').inputValue().then(v => v.split('\n').length), 20);
  await page.locator('[data-act="editor-back"]').click();

  // Next day: "Checklist first" — setup + ticks, then In a trade; they land in the trade's details
  await to(at(13, 20, 50));
  await ev(() => App.go('trade'));
  await page.clock.runFor(300);
  assert.strictEqual(await stage(), 'watching');
  await page.locator('[data-act="run-ck-open"]').click();
  await page.locator('[data-act="run-ck-setup"]', { hasText: 'My own read' }).click();
  await page.locator('.ckf .item').nth(0).click();
  await page.locator('.ckf .item').nth(2).click();
  await shot('run-checklist-first');
  await page.locator('.run-enter').click();
  await page.clock.runFor(300);
  assert.strictEqual(await stage(), 'intrade');
  const od = await ev(() => App.state.days['2026-10-13'].openDetails);
  assert.strictEqual(od.setup, 'own');
  assert.strictEqual(Object.keys(od.checks).length, 2);
  assert.strictEqual(await page.locator('.calm-note', { hasText: 'warm pad' }).count(), 1);
  await page.locator('[data-act="run-out"][data-o="OUT"]').click();
  await page.clock.runFor(300);

  // The lock-moved link on Ready records it and shows it in the flags
  await to(at(13, 21, 0));
  await page.locator('[data-act="run-lock"]').click();
  await modalBtn('Yes, I moved it').click();
  await page.clock.runFor(300);
  assert.ok(await page.locator('.run-flag', { hasText: 'the lock moved tonight' }).isVisible());

  await browser.close();
  assert.deepStrictEqual(errors, [], 'console errors: ' + errors.join(' | '));
  console.log('runsheet browser test passed · 0 console errors · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
