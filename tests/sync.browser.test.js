// Part F browser test: sync through a fake Supabase (same endpoints, in memory) shared by two devices.
// Sign-in by code (PC) and by magic link (phone), push + pull, a same-day edit on both devices merges with
// nothing lost, offline then back, settings travel, sign out, no tokens in saved data. Screenshots.
//   python3 -m http.server 8765 &   (from the repo root)
//   NODE_PATH=/path/to/node_modules [FONT_DIR=...] node tests/sync.browser.test.js [outDir]
'use strict';
const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
const FONT_DIR = process.env.FONT_DIR || '';
fs.mkdirSync(OUT, { recursive: true });
const SB = 'https://xljsiznknzrepvbwuiax.supabase.co';
const KEY = 'sb_publishable__bBgcqi4VfhIryjgI5w0VQ_hUHsambk';
const at = (d, h, m) => new Date(2026, 9, d, h, m, 0);
const DAY = '2026-10-06';

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

// ---- the fake Supabase: auth (otp, verify, user, token, logout) and PostgREST upserts with RLS by token
const db = { otp: [], profiles: {}, days: {}, filled: {}, events: {}, offline: false, n: 0, calls: [] };
const stamp = () => new Date(Date.UTC(2026, 9, 6, 0, 0, 0) + (++db.n) * 1000).toISOString();
async function fakeSupabase(ctx) {
  await ctx.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (db.offline) return route.abort('internetdisconnected');
    db.calls.push(req.method() + ' ' + p);
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
    const hdr = req.headers();
    if (hdr.apikey !== KEY) return json(401, { message: 'bad apikey' });
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const session = email => ({ access_token: 'tok-' + email, refresh_token: 'ref-' + (++db.n), expires_in: 3600, token_type: 'bearer', user: { id: 'u1', email } });
    if (p === '/auth/v1/otp') { db.otp.push({ email: body.email, redirect: u.searchParams.get('redirect_to') }); return json(200, {}); }
    if (p === '/auth/v1/verify') return body.token === '123456' ? json(200, session(body.email)) : json(403, { msg: 'Token has expired or is invalid' });
    if (p === '/auth/v1/token') return json(200, session('iris@example.com'));
    if (p === '/auth/v1/logout') return json(204);
    const auth = (hdr.authorization || '').replace('Bearer ', '');
    if (!/^tok-/.test(auth)) return json(401, { message: 'JWT required' });
    if (p === '/auth/v1/user') return json(200, { id: 'u1', email: auth.slice(4) });
    const table = p.replace('/rest/v1/', '');
    if (req.method() === 'GET') {
      const since = (u.searchParams.get('updated_at') || 'gt.').slice(3);
      const src = table === 'cp_days' ? db.days : db.filled;
      return json(200, Object.values(src).filter(r => r.updated_at > since).sort((a, b) => a.updated_at < b.updated_at ? -1 : 1));
    }
    if (table === 'cp_profiles') { body.forEach(r => { db.profiles[r.id] = r; }); return json(201); }
    if (table === 'cp_events') { body.forEach(r => { db.events[r.date + '|' + r.t + '|' + r.type + '|' + r.detail] = r; }); return json(201); }
    const dst = table === 'cp_days' ? db.days : db.filled;
    body.forEach(r => { dst[r.date] = { date: r.date, json: r.json, device: r.device, updated_at: stamp() }; });
    return json(201);
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const errors = [];
  async function device(name, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: viewport.width < 900 });
    await routeFonts(ctx);
    await fakeSupabase(ctx);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|supabase\.co/.test(m.location().url || '') && !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(m.text())) errors.push(name + ': ' + m.text()); });
    page.on('pageerror', e => errors.push(name + ': ' + String(e)));
    await page.clock.install({ time: at(6, 14, 0) });
    return { ctx, page };
  }
  const st = (pg, fn, a) => pg.evaluate(fn, a);
  const sync = pg => pg.evaluate(() => App.syncNow());
  const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, name + '.png') });
  const toSync = async pg => { await st(pg, () => App.go('settings')); await pg.locator('[data-sync]').scrollIntoViewIfNeeded(); };

  // ---- PC: Settings → Sync, signed out; send the email; wrong code refused; right code signs in
  const pc = await device('pc', { width: 390, height: 844 });
  await pc.page.goto(BASE, { waitUntil: 'load' });
  await pc.page.waitForSelector('#view .home');
  await toSync(pc.page);
  assert.ok((await pc.page.locator('[data-sync]').textContent()).includes('Everything stays on this device'));
  assert.strictEqual(await st(pc.page, () => App.signedIn()), false);
  await pc.page.locator('#sync-email').fill('iris@example.com');
  await pc.page.locator('[data-act="sync-link"]').click();
  await pc.page.waitForSelector('#sync-code');
  assert.deepStrictEqual(db.otp[0], { email: 'iris@example.com', redirect: BASE });
  await pc.page.locator('[data-sync]').scrollIntoViewIfNeeded();
  await shot(pc.page, 'sync-signin-code');
  await pc.page.locator('#sync-code').fill('000000');
  await pc.page.locator('[data-act="sync-code"]').click();
  await pc.page.waitForSelector('.toast', { hasText: 'Code not accepted' });
  assert.strictEqual(await st(pc.page, () => App.signedIn()), false);
  await pc.page.locator('#sync-code').fill('123456');
  await pc.page.locator('[data-act="sync-code"]').click();
  await pc.page.waitForFunction(() => App.signedIn());
  await pc.page.waitForFunction(() => !!JSON.parse(localStorage.getItem('checkpoint.v1.device')).sync.lastSyncAt);
  assert.ok(db.profiles.u1 && db.profiles.u1.email === 'iris@example.com', 'profile row');
  assert.ok(db.days._settings, 'settings row pushed on the first sync');
  await toSync(pc.page);
  assert.ok((await pc.page.locator('[data-sync]').textContent()).includes('Signed in as iris@example.com'));
  await shot(pc.page, 'sync-signed-in');

  // ---- PC: premarket + a setup → pushed by itself a few seconds after the save
  await st(pc.page, () => App.go('home'));
  await pc.page.locator('.ru-row[data-k="body"]').click();
  for (const b of await pc.page.locator('.ru-open .gate-btns .yes').all()) await b.click();
  await pc.page.locator('.ru-row[data-k="plan"]').click();
  await pc.page.locator('[data-fk="su-0"]').fill('S1 long 30871-30900 · absorption');
  await pc.page.locator('[data-act="card-grade"][data-i="0"][data-g="A"]').click();
  await pc.page.clock.runFor(5000);
  await pc.page.waitForFunction(() => true);
  for (let i = 0; i < 40 && !(db.days[DAY] && (db.days[DAY].json.events || []).some(e => e.type === 'plan_ready') && Object.keys(db.events).some(k => k.includes('|plan_ready|'))); i++) { await pc.page.clock.runFor(500); await pc.page.waitForTimeout(50); }
  assert.ok(db.days[DAY], 'day pushed automatically');
  assert.strictEqual(db.days[DAY].json.today.setups[0].grade, 'A');
  assert.ok(Object.keys(db.events).some(k => k.includes('|gate_yes|')), 'events go to cp_events too');

  // ---- Phone: signs in by the magic link (the redirect lands with #access_token) → pulls the day
  const ph = await device('phone', { width: 390, height: 844 });
  await ph.page.goto(BASE + '#access_token=tok-iris@example.com&refresh_token=ref-x&expires_in=3600&token_type=bearer&type=magiclink', { waitUntil: 'load' });
  await ph.page.waitForFunction(() => App.signedIn());
  await ph.page.waitForFunction(d => !!(App.state.days[d] && App.state.days[d].today && App.state.days[d].today.setups.length), DAY);
  assert.strictEqual(await ph.page.evaluate(() => location.hash), '', 'the address bar is cleaned');
  await st(ph.page, () => App.go('home'));
  assert.strictEqual(await ph.page.locator('[data-ru-st="body"]').textContent(), '✓', 'phone shows the PC premarket');
  assert.strictEqual(await ph.page.locator('[data-ru-st="plan"]').textContent(), '✓');

  // ---- Same day on both devices: phone ticks the locks; PC (not pulled yet) logs an urge at 20:32
  await ph.page.locator('.ru-row[data-k="accounts"]').click();
  for (const t of ['Copier on', 'Platform daily loss', 'Max order size']) await ph.page.locator('.ru-open .item', { hasText: t }).click();
  await sync(ph.page);
  await pc.page.clock.setSystemTime(at(6, 20, 32));
  await pc.page.clock.runFor(500);
  const hold = async (pg, sel, ms) => { const b = await pg.locator(sel).boundingBox(); await pg.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await pg.mouse.down(); await pg.clock.runFor(ms); await pg.mouse.up(); await pg.clock.runFor(100); };
  await hold(pc.page, '[data-hold="urgeNote"]', 3200);
  await sync(pc.page);
  await sync(ph.page);
  for (const [name, d] of [['pc', pc], ['phone', ph]]) {
    const day = await st(d.page, k => App.state.days[k], DAY);
    const types = day.events.map(e => e.type);
    assert.ok(types.includes('locks_ready') && types.includes('urge') && types.includes('plan_ready'), name + ' has every event: ' + types.join(' '));
    assert.strictEqual(day.urges.length, 1, name + ' urge kept');
    assert.ok(Object.keys(day.premarket.checked).length >= 7, name + ' ticks from both devices');
  }

  // ---- Offline: the PC logs while offline; nothing breaks; it catches up when back
  db.offline = true;
  await hold(pc.page, '[data-hold="urgeNote"]', 3200);
  assert.strictEqual(await sync(pc.page), false);
  assert.ok(await st(pc.page, () => JSON.parse(localStorage.getItem('checkpoint.v1.device')).sync.error), 'error noted');
  await toSync(pc.page);
  assert.ok((await pc.page.locator('[data-sync]').textContent()).includes('It retries by itself'));
  await shot(pc.page, 'sync-offline');
  db.offline = false;
  await sync(pc.page);
  assert.strictEqual(db.days[DAY].json.urges.length, 2, 'offline urge pushed when back online');
  assert.strictEqual(await st(pc.page, () => JSON.parse(localStorage.getItem('checkpoint.v1.device')).sync.error), null);

  // ---- Settings travel: theme on the PC → the phone
  await pc.page.locator('[data-act="theme"][data-v="dim"]').click();
  await pc.page.clock.runFor(1000);
  await sync(pc.page);
  await sync(ph.page);
  assert.strictEqual(await st(ph.page, () => App.state.settings.theme), 'dim', 'settings synced');

  // ---- Tokens never in the saved data or the full backup; sign out keeps the data
  const saved = await st(ph.page, () => localStorage.getItem('checkpoint.v1'));
  assert.ok(!/tok-|ref-/.test(saved), 'no token in checkpoint.v1');
  await toSync(ph.page);
  await ph.page.locator('[data-act="sync-out"]').click();
  await ph.page.locator('.modal button', { hasText: 'Sign out' }).click();
  assert.strictEqual(await st(ph.page, () => App.signedIn()), false);
  assert.ok(await st(ph.page, d => !!App.state.days[d], DAY), 'data stays after sign out');
  assert.ok(db.calls.includes('POST /auth/v1/logout'));

  // ---- Signed out: the app makes no calls at all
  const before = db.calls.length;
  await hold(ph.page, '.tab[data-tab="home"]', 10);
  await ph.page.clock.runFor(130000);
  assert.strictEqual(db.calls.length, before, 'no network calls when signed out');

  assert.deepStrictEqual(errors, [], 'no console errors');
  await browser.close();
  console.log('sync browser test passed · screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
