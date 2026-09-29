// Browser smoke test + screenshots. Needs playwright-core and a local server:
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules node tests/browser.test.js [outDir]
// Uses the preinstalled Chromium at /opt/pw-browsers/chromium unless CHROMIUM is set.
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

// Thursday 1 Oct 2026, local time
const at = (h, m) => new Date(2026, 9, 1, h, m, 0);

async function newPage(browser, viewport, time, errors) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: viewport.width < 900 });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text() + ' @ ' + (m.location().url || '')); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install({ time });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#view .wrap');
  return { ctx, page };
}
async function hold(page, selector, ms) {
  await page.locator(selector).evaluate(el => el.scrollIntoView({ block: 'center' }));
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(ms);
  await page.mouse.up();
  await page.clock.runFor(50);
}
async function shot(page, name, full) {
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const errors = [];
  const phone = { width: 390, height: 844 };
  let { ctx, page } = await newPage(browser, phone, at(19, 41), errors);

  // ---- Premarket
  const count = () => page.locator('.page-head .progress .mono').textContent();
  assert.strictEqual(await count(), '0 / 22');
  await page.locator('.item', { hasText: 'Watch MQ videos' }).click();
  assert.strictEqual(await count(), '0 / 22', 'optional item does not count');
  await page.locator('.item', { hasText: 'Read 1BB brief' }).click();
  assert.strictEqual(await count(), '1 / 22');
  await page.locator('[aria-label="Slept enough: no"]').first().click();
  assert.ok(await page.locator('.banner', { hasText: 'Observation day' }).isVisible());
  await page.locator('[aria-label="Slept enough: yes"]').first().click();
  assert.strictEqual(await page.locator('.banner', { hasText: 'Observation day' }).count(), 0);
  // the now strip at 19:41 shows the latest timed item <= now: "Prepare zones in chart" (19:30)
  assert.ok((await page.locator('.now-strip .now-text').textContent()).includes('Prepare zones'));
  await shot(page, 'phone-premarket');
  // finish DATA category -> auto-folds
  for (const t of ['Premarket fetches in', 'Drink water', 'Post-open fetch']) await page.locator('.item', { hasText: t }).click();
  const dataHead = page.locator('.cat-head', { hasText: 'DATA' });
  assert.strictEqual(await dataHead.getAttribute('aria-expanded'), 'false');
  assert.ok((await dataHead.textContent()).includes('3/3 DONE'));
  // focus mode + later
  await page.locator('[data-act="focus"]').click();
  const cur1 = await page.locator('.focus-item').textContent();
  await shot(page, 'phone-premarket-focus');
  await page.locator('[data-act="pm-later"]').click();
  const cur2 = await page.locator('.focus-item').textContent();
  assert.notStrictEqual(cur1, cur2, 'Later moves on to another item');
  await page.locator('[data-act="focus"]').click();

  // ---- Trade
  await page.locator('.tab[data-tab="trade"]').click();
  assert.ok((await page.locator('.session-bar').textContent()).includes('STARTS IN 49 MIN'));
  assert.ok(await page.locator('.enter.off').isDisabled());
  const items = page.locator('[data-act="tr-toggle"]');
  assert.strictEqual(await items.count(), 4, 'after-stop item hidden before any SL');
  for (let i = 0; i < 4; i++) await items.nth(i).click();
  await shot(page, 'phone-trade');
  await hold(page, '[data-hold="enter"]', 900); // let go early
  assert.strictEqual(await page.locator('.enter.live[role="status"]').count(), 0);
  await hold(page, '[data-hold="enter"]', 2200);
  assert.strictEqual(await page.locator('.enter.live[role="status"]').textContent(), 'IN TRADE');
  await page.locator('[data-act="log"][data-o="SL"]').click();
  // SL -> After SL cooldown on the Cooldown tab
  assert.strictEqual(await page.locator('.tab[aria-selected="true"]').textContent(), 'COOLDOWN');
  assert.ok((await page.locator('.card', { hasText: 'One more SL closes the day' }).count()) === 1);
  await page.clock.runFor(18000);
  assert.match(await page.locator('.ring-wrap .big').textContent(), /^4:4[23]$/);
  await page.locator('[data-act="cd-step"]').first().click();
  await shot(page, 'phone-cooldown-running');
  // trade tab locked while cooldown runs
  await page.locator('.tab[data-tab="trade"]').click();
  assert.ok(await page.locator('.lock-card', { hasText: 'Checklist locked' }).isVisible());
  await shot(page, 'phone-trade-locked');
  // end early with the 5s hold
  await page.locator('.tab[data-tab="cooldown"]').click();
  await hold(page, '[data-hold="endEarly"]', 5200);
  assert.ok(await page.locator('[data-act="cd-start"]').isVisible());
  // trade tab now shows the after-stop item
  await page.locator('.tab[data-tab="trade"]').click();
  assert.strictEqual(await page.locator('[data-act="tr-toggle"]').count(), 5);
  assert.ok(await page.locator('.tag.amber', { hasText: 'AFTER A STOP' }).isVisible());
  // second trade -> cap reached
  await page.locator('[data-act="log"][data-o="SCRATCH"]').click();
  assert.ok(await page.locator('.lock-card', { hasText: 'Cap reached' }).isVisible());

  // ---- Cooldown: Urge preset runs to the end
  await page.locator('.tab[data-tab="cooldown"]').click();
  await page.locator('.chip', { hasText: 'Urge' }).click();
  await shot(page, 'phone-cooldown-idle');
  await page.locator('[data-act="cd-start"]').click();
  await page.clock.runFor(91000);
  assert.ok(await page.locator('.card', { hasText: 'Still out? Good.' }).isVisible());
  await page.locator('[data-act="cd-done"]').click();
  const cds = await page.evaluate(() => { const s = App.state; return s.days[Object.keys(s.days)[0]].cooldowns; });
  assert.strictEqual(cds.length, 2);
  assert.strictEqual(cds[0].endedEarly, true);
  assert.strictEqual(cds[1].endedEarly, false);

  // ---- Settings + editor
  await page.locator('.tab[data-tab="settings"]').click();
  await shot(page, 'phone-settings');
  await shot(page, 'phone-settings-full', true);
  await page.locator('[data-act="open-list"][data-list="premarket"]').click();
  // drag "ATAS ready" (DESK) into LOCKS, above "Copier on"
  const handle = page.locator('.dnd-row', { hasText: 'ATAS ready' }).locator('.handle');
  const target = page.locator('.dnd-row', { hasText: 'Copier on' });
  await handle.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  const tb = await target.boundingBox();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + (tb.y + 4 - hb.y) * i / 12);
    await page.clock.runFor(16);
  }
  await shot(page, 'phone-editor-dragging');
  await page.mouse.up();
  await page.clock.runFor(50);
  const locks = await page.evaluate(() => App.state.checklists.premarket.categories[3].items.map(i => i.text));
  // (layout shifts while dragging, so only assert it landed in LOCKS near the top)
  assert.ok(locks.indexOf('ATAS ready') >= 0 && locks.indexOf('ATAS ready') <= 2, 'dragged across categories: ' + locks.join(' | '));
  const desk = await page.evaluate(() => App.state.checklists.premarket.categories[2].items.map(i => i.text));
  assert.ok(desk.indexOf('ATAS ready') < 0);
  await page.locator('.etext', { hasText: 'Copier on' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'phone-editor');
  await page.locator('[data-act="editor-back"]').click();

  // ---- Session rule: during the session, raising the cap is pending
  await page.clock.setSystemTime(at(20, 45));
  await page.locator('.tab[data-tab="settings"]').click();
  assert.ok(await page.locator('.banner', { hasText: 'Session is live (20:30–21:40)' }).isVisible());
  await page.locator('[data-act="cap"][data-d="1"]').click();
  assert.strictEqual(await page.locator('.stepper output').textContent(), '2');
  assert.ok((await page.locator('.pending').first().textContent()).includes('PENDING · 2 → 3 · from tomorrow 06:00'));
  await shot(page, 'phone-settings-pending');
  await page.locator('[data-act="cap"][data-d="-1"]').click(); // 3 -> 2 cancels, then tighten
  await page.locator('[data-act="cap"][data-d="-1"]').click();
  assert.strictEqual(await page.locator('.stepper output').textContent(), '1', 'tightening applies instantly');
  await page.locator('[data-act="cap"][data-d="1"]').click();
  assert.strictEqual(await page.locator('.stepper output').textContent(), '1');
  // pending applies after the next reset
  await page.clock.setSystemTime(new Date(2026, 9, 2, 6, 1));
  await page.clock.runFor(21000);
  assert.strictEqual(await page.evaluate(() => App.state.settings.rules.tradeCap), 2);
  assert.strictEqual(await page.evaluate(() => App.state.pending.length), 0);

  // ---- Session over screen
  await page.clock.setSystemTime(new Date(2026, 9, 2, 21, 45));
  await page.locator('.tab[data-tab="trade"]').click();
  assert.ok(await page.locator('h1', { hasText: 'Session over.' }).isVisible());
  await page.locator('[data-act="so-toggle"]').first().click();
  await shot(page, 'phone-session-over');
  await ctx.close();

  // ---- Desktop
  ({ ctx, page } = await newPage(browser, { width: 1280, height: 800 }, at(19, 41), errors));
  for (const tab of ['premarket', 'trade', 'cooldown', 'settings']) {
    await page.locator('.tab[data-tab="' + tab + '"]').click();
    await shot(page, 'desktop-' + tab);
  }
  await page.locator('[data-act="open-list"][data-list="trade"]').click();
  await page.locator('.etext').first().click();
  await shot(page, 'desktop-editor');
  // keyboard fallback: move first trade item down
  const firstId = await page.evaluate(() => App.state.checklists.trade.categories[0].items[0].id);
  await page.locator('.handle[data-id="' + firstId + '"]').focus();
  await page.keyboard.press('ArrowDown');
  assert.strictEqual(await page.evaluate(() => App.state.checklists.trade.categories[0].items[1].id), firstId);
  await ctx.close();

  await browser.close();
  const relevant = errors.filter(e => !/fonts\.(googleapis|gstatic)/.test(e));
  if (errors.length !== relevant.length) console.log('(ignored ' + (errors.length - relevant.length) + ' Google Fonts network errors: no internet in sandbox)');
  assert.deepStrictEqual(relevant, [], 'console errors: ' + relevant.join('\n'));
  console.log('browser test passed · 0 console errors · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
