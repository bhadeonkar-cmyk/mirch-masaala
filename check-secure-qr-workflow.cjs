#!/usr/bin/env node
'use strict';

// Secure Table QR workflow test (MOCKED backend).
// Runs the REAL index.html + supabase-live.js in headless Chromium against a recording fake of the
// Supabase client that emulates the documented RPC contracts of supabase/p0-security-hardening.sql
// (mm_admin_qr_status, mm_admin_generate_all_table_qr, mm_admin_generate_table_qr,
// mm_admin_confirm_table_qr, mm_admin_set_qr_enforcement, mm_place_order).
// It does NOT contact any Supabase project and does NOT test the SQL. The SQL side is covered by
// check-p0-security.sql / check-qr-ordering-consolidated.sql, which need a real PostgreSQL.
//
// If env-config.js, env-config-core.js, menu-images.js or app-language.js are not next to index.html
// (e.g. the partial repair ZIP) small STUBS are written into a temp copy and reported as such, so the
// run is only valid against the full project when no stub is reported.
//
// Usage: node check-secure-qr-workflow.cjs   (run from the folder holding index.html;
//        needs `playwright` + Chromium; set CHROME_PATH to use an installed Chrome)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Needs Playwright: npm i playwright && npx playwright install chromium'); process.exit(2); }

const root = process.cwd();
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-qr-site-'));
const stubbed = [];
function findFile(name) {
  for (const dir of [root, __dirname, path.join(root, 'scripts')]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
for (const name of ['index.html', 'supabase-live.js', 'qr-matrices.js', 'test-env-override.js']) {
  const p = findFile(name);
  if (!p) { console.error('Missing required file: ' + name); process.exit(2); }
  fs.copyFileSync(p, path.join(site, name));
}
const STUBS = {
  'env-config.js': '',
  'env-config-core.js':
    "(function(){var o=window.MM_ENV_CONFIG_OVERRIDE;var e=o.environments.test;" +
    "window.MM_ENV={name:'test',projectRef:e.expectedProjectRef,supabaseUrl:e.supabaseUrl,publishableKey:e.publishableKey,restaurantId:e.restaurantId,qrBaseUrl:e.qrBaseUrl};" +
    "window.MM_CONFIG_OK=true;window.MM_TABLE_URL=function(n){return e.qrBaseUrl+encodeURIComponent(n);};})();",
  'menu-images.js': '',
  'app-language.js': ''
};
for (const name of Object.keys(STUBS)) {
  const p = findFile(name);
  if (p) fs.copyFileSync(p, path.join(site, name));
  else { fs.writeFileSync(path.join(site, name), STUBS[name]); stubbed.push(name); }
}
for (const name of ['ui-premium.css', 'manifest.webmanifest']) {
  const p = findFile(name);
  if (p) fs.copyFileSync(p, path.join(site, name)); else fs.writeFileSync(path.join(site, name), '');
}
const indexUrl = 'file://' + path.join(site, 'index.html');
const TEST_RESTAURANT = '99999999-9999-4999-8999-999999999999';
const BASE = 'https://test.invalid/?table=';

let failures = 0, total = 0;
function check(ok, name, detail) {
  total++;
  if (!ok) failures++;
  console.log((ok ? '✓ ' : '✗ ') + name + (!ok && detail !== undefined ? ' — ' + detail : ''));
}
const tok = (c) => String(c).repeat(64).slice(0, 64);           // valid 64-hex token made of one hex digit
const T2 = tok('a'), T8 = tok('b'), T1 = tok('c'), T3 = tok('d');
const url = (n, t) => BASE + n + '&qr=' + t;

// ---- page-side fakes (serialised into the page) -------------------------------------------------
function installFake(cfg) {
  const srv = window.__srv = {
    tables: cfg.tables, creds: {}, verified: {}, enforcement: !!cfg.enforcement, n: 0,
    rotations: 0, statusError: !!cfg.statusError
  };
  const hashOf = (s) => Array.from(s).map((c) => (parseInt(c, 16) ^ 5).toString(16)).join('');
  (cfg.provisioned || []).forEach((t) => { srv.creds[t] = 'hash-' + t; srv.verified[t] = (cfg.verified || []).indexOf(t) >= 0; });
  window.__rpc = [];
  const VISIT = '11111111-1111-4111-8111-111111111111';
  const newTok = () => { srv.n++; return cfg.badToken ? 'zz' : (srv.n.toString(16).padStart(2, '0')).repeat(32); };
  const issue = (t, rotate) => {
    const existed = !!srv.creds[t];
    const token = newTok();
    srv.creds[t] = 'hash-' + hashOf(token); srv.verified[t] = false;
    if (existed) srv.rotations++;
    return { table_number: t, already_provisioned: false, rotated: existed, token };
  };
  const rows = {
    categories: [{ id: 'c1', name: 'Probe', sort_order: 1, is_active: true }],
    menu_items: [
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', category_id: 'c1', name: 'Probe Paneer', description: '', price: 300, image_url: null, is_available: true, sort_order: 1, is_veg: true, is_bestseller: false, spicy_level: 1 },
      { id: 'aaaaaaaa-0000-4000-8000-000000000002', category_id: 'c1', name: 'Probe Biryani', description: '', price: 400, image_url: null, is_available: true, sort_order: 2, is_veg: false, is_bestseller: false, spicy_level: 2 }
    ],
    restaurant_tables: []
  };
  const chain = (n) => new Proxy(function () {}, {
    get: (_t, p) => (p === 'then' ? (res) => res({ data: rows[n] || [], error: null }) : chain(n)),
    apply: () => chain(n)
  });
  const ok = (data) => Promise.resolve({ data, error: null });
  const err = (message) => Promise.resolve({ data: null, error: { code: 'P0001', message } });
  const fake = {
    rpc(name, args) {
      window.__rpc.push({ name, args: JSON.parse(JSON.stringify(args || {})) });
      if (name === 'mm_admin_qr_status') {
        if (srv.statusError) return err('status unavailable');
        return ok({ restaurant_id: args.p_restaurant_id, qr_enforcement_enabled: srv.enforcement,
          tables: srv.tables.map((t) => ({ table_number: t, has_credential: !!srv.creds[t], verified: !!srv.verified[t] })) });
      }
      if (name === 'mm_admin_generate_all_table_qr') {
        const out = srv.tables.map((t) => (srv.creds[t] && !args.p_rotate
          ? { table_number: t, already_provisioned: true, token: null }
          : issue(t, args.p_rotate)));
        return ok({ restaurant_id: args.p_restaurant_id, tables: out });
      }
      if (name === 'mm_admin_generate_table_qr') {
        const t = String(args.p_table_number).padStart(2, '0');
        if (srv.tables.indexOf(t) < 0) return err('Active table not found');
        if (srv.creds[t] && !args.p_rotate) return ok({ table_number: t, already_provisioned: true, token: null });
        return ok(issue(t, args.p_rotate));
      }
      if (name === 'mm_admin_confirm_table_qr') {
        const missing = srv.tables.filter((t) => !srv.creds[t]);
        if (missing.length) return err('Generate credentials before confirming these tables: ' + missing.join(', '));
        srv.tables.forEach((t) => { srv.verified[t] = true; });
        return ok({ verified_count: srv.tables.length });
      }
      if (name === 'mm_admin_set_qr_enforcement') {
        if (args.p_enabled) {
          const missing = srv.tables.filter((t) => !srv.creds[t] || !srv.verified[t]);
          if (missing.length) return err('Every active table needs a printed and verified QR credential before enforcement. Missing tables: ' + missing.join(', '));
        }
        srv.enforcement = !!args.p_enabled;
        return ok({ qr_enforcement_enabled: srv.enforcement });
      }
      if (name === 'mm_public_table_visit_status') return ok({ table_number: args.p_table_number, status: 'OPEN', can_order: true, visit_id: VISIT, message: 'You are ready to order.' });
      if (name === 'mm_ensure_public_table_visit') return ok({ table_number: args.p_table_number, status: 'OPEN', visit_id: VISIT });
      if (name === 'mm_place_order') {
        const n = window.__rpc.filter((c) => c.name === 'mm_place_order').length;
        return ok({ id: 'MM-PROBE-' + n, publicToken: 'tok-' + n, visitId: VISIT, table: args.p_table_number, items: [], total: 700, status: 'NEW', orderNumber: n });
      }
      return ok(null);
    },
    functions: { invoke() { return Promise.resolve({ data: { sent: 0, failed: 0 }, error: null }); } },
    auth: new Proxy({}, { get: (_t, p) => (p === 'onAuthStateChange' ? () => ({ data: { subscription: { unsubscribe() {} } } }) : () => Promise.resolve({ data: { session: null, user: null }, error: null })) }),
    from: (n) => chain(n), channel: () => chain('x'), removeChannel: () => {}
  };
  window.supabase = { createClient: () => fake };
}
// Local QR "library": records every text it is asked to encode and returns an SVG that carries that text.
function installQrLib() {
  window.__qrTexts = [];
  window.QRCode = { toDataURL(text, _opts, cb) {
    window.__qrTexts.push(text);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><desc>' + text.replace(/&/g, '&amp;') + '</desc></svg>';
    cb(null, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  } };
}
function installOutputs() {
  window.__share = []; window.__clip = [];
  Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__share.push(d.url); return Promise.resolve(); } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__clip.push(t); return Promise.resolve(); } } });
  window.__dl = [];
  window.addEventListener('DOMContentLoaded', () => { window.downloadQRImage = (src, name) => { window.__dl.push({ src, name }); }; });
}
function installStorageFault(mode) {
  const proto = Storage.prototype, real = proto.setItem;
  proto.setItem = function (k, v) {
    if (this === window.localStorage) {
      if (mode === 'all' && (/^mm_table_qr_/.test(k) || k === 'mm_qr_storage_probe')) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      if (mode === 'throw' && /^mm_table_qr_/.test(k)) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      if (mode === 'silent' && /^mm_table_qr_/.test(k)) return;
    }
    return real.call(this, k, v);
  };
}

(async () => {
  const launch = { args: ['--no-sandbox'] };
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch(launch);
  const unexpected = [];

  // Opens the app as the signed-in Owner (role set directly; the fake client has no real login).
  async function owner(cfg) {
    cfg = Object.assign({ tables: ['01', '02', '03'], tokens: {}, qrLib: true, dialog: 'accept' }, cfg);
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const external = [];
    await context.route(/^https?:/, (r) => { external.push(r.request().url()); r.abort('failed'); });
    const page = await context.newPage();
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); (cfg.dialog === 'dismiss' ? d.dismiss() : d.accept()); });
    page.on('pageerror', (e) => unexpected.push('uncaught: ' + e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (/^Failed to load resource/.test(text) || /^\[Mirch Masaala/.test(text)) return;
      unexpected.push('console.error: ' + text.slice(0, 160));
    });
    await page.addInitScript({ path: path.join(site, 'test-env-override.js') });
    await page.addInitScript((tokens) => { Object.keys(tokens).forEach((n) => localStorage.setItem('mm_table_qr_' + n, tokens[n])); }, cfg.tokens);
    if (cfg.storage) await page.addInitScript(installStorageFault, cfg.storage);
    await page.addInitScript(installFake, cfg);
    if (cfg.qrLib) await page.addInitScript(installQrLib);
    await page.addInitScript(installOutputs);
    await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1100);
    const ready = await page.evaluate((tables) => {
      role = 'admin';
      MENU.tables = tables.map((n, i) => ({ id: i + 1, number: n, name: 'Table ' + n, is_active: true, seating_capacity: 4 }));
      drawQR();
      return typeof window.MM_ADMIN_QR_STATUS === 'function' && typeof window.MM_ADMIN_GENERATE_TABLE_QR === 'function';
    }, cfg.tables);
    await page.waitForTimeout(300);
    const api = {
      page, context, dialogs, external, ready,
      rpc: (name) => page.evaluate((n) => window.__rpc.filter((c) => !n || c.name === n), name),
      srv: () => page.evaluate(() => JSON.parse(JSON.stringify(window.__srv))),
      ls: (n) => page.evaluate((k) => localStorage.getItem('mm_table_qr_' + k) || '', n),
      notice: () => page.evaluate(() => { const e = document.getElementById('secure-qr-notice'); return e && getComputedStyle(e).display !== 'none' ? e.textContent : ''; }),
      statusLine: () => page.evaluate(() => (document.getElementById('secure-qr-status') || {}).textContent || ''),
      tableStatus: () => page.evaluate(() => (document.getElementById('secure-qr-table-status') || {}).innerText || ''),
      rows: () => page.evaluate(() => Array.from(document.querySelectorAll('#secure-qr-table-status tbody tr')).map((r) => Array.from(r.children).map((c) => c.textContent.trim()))),
      call: (src, arg) => page.evaluate(src, arg),
      // Run the app's print-all, returning the popup page (or null when it was refused).
      async printAll() {
        const [popup] = await Promise.all([
          context.waitForEvent('page', { timeout: 1500 }).catch(() => null),
          page.evaluate(() => { downloadAllQRCodes(); })
        ]);
        if (popup) await popup.waitForTimeout(900);
        return popup;
      },
      close: () => context.close()
    };
    return api;
  }

  // ===== 1. Complete URL generation: Table 02 and Table 08 =========================================
  let o = await owner({ tables: ['02', '08'], tokens: { '02': T2, '08': T8 } });
  check(o.ready, 'harness: owner QR functions and the single-table RPC wrapper are installed');
  const ui0 = await o.call(() => ({
    fields: document.querySelectorAll('#qr-table-url').length,
    copyBtns: Array.from(document.querySelectorAll('#qr-modal button')).filter((b) => /Copy table link/.test(b.textContent)).length,
    shareBtns: Array.from(document.querySelectorAll('#qr-modal button')).filter((b) => /Share link/.test(b.textContent)).length,
    controls: !!document.getElementById('qr-table-link-controls'),
    copyIsSecure: /mmCurrentQrUrl/.test(window.copyCurrentTableLink.toString()),
    shareIsSecure: /mmCurrentQrUrl/.test(window.shareCurrentTableLink.toString()),
    printIsSecure: /mmQrPrintReadiness/.test(window.downloadAllQRCodes.toString()),
    showIsOriginal: /mmSecureTableURL/.test(window.showQR.toString())
  }));
  check(ui0.fields === 1 && ui0.copyBtns === 1 && ui0.shareBtns === 1 && !ui0.controls, 'QR dialog has exactly one link field and one Copy/Share pair (no duplicate link UI)', JSON.stringify(ui0));
  check(ui0.copyIsSecure && ui0.shareIsSecure && ui0.printIsSecure && ui0.showIsOriginal, 'the credential-checked copy, share, print and preview functions are the ones in effect (not overridden by qr-matrices.js)', JSON.stringify(ui0));
  let r = await o.call(() => ({ u2: mmSecureTableURL('02'), u8: mmSecureTableURL('08'), n2: mmSecureTableURL(2), legacy: tableURL('08') }));
  check(r.u2 === url('02', T2), 'Table 02: complete URL is ?table=02&qr=<64-hex token>', r.u2);
  check(r.u8 === url('08', T8), 'Table 08: complete URL is ?table=08&qr=<64-hex token>', r.u8);
  check(r.n2 === url('02', T2) && r.legacy === url('08', T8), 'numeric table input and the legacy tableURL() give the same complete URL');
  check(/^https:\/\/test\.invalid\/\?table=02&qr=[0-9a-f]{64}$/.test(r.u2) && r.u2 !== r.u8 && r.u2.indexOf(T8) < 0 && r.u8.indexOf(T2) < 0,
    'wrong table/token combination is impossible: each URL carries only its own token');
  await o.close();

  // ===== 2. Missing / invalid credentials never produce a URL =======================================
  o = await owner({ tables: ['02', '08'], tokens: { '02': T2 } });
  r = await o.call(() => ({
    noToken: mmSecureTableURL('08'), badTable: mmSecureTableURL('abc'), longTable: mmSecureTableURL('123'), legacy08: tableURL('08')
  }));
  check(r.noToken === '' && r.legacy08 === '', 'Table 08 without a token: no URL at all (never an insecure ?table=08 link)', JSON.stringify(r));
  check(r.badTable === '' && r.longTable === '', 'invalid table numbers produce no URL', JSON.stringify(r));
  const bads = { short: T2.slice(0, 63), long: T2 + 'a', nonHex: 'g'.repeat(64), empty: '', spaces: ' '.repeat(64) };
  for (const [label, bad] of Object.entries(bads)) {
    const out = await o.page.evaluate((b) => {
      const stored = mmRememberQrToken('08', b);
      localStorage.setItem('mm_table_qr_08', b);                      // tampered storage
      return { stored, url: mmSecureTableURL('08'), tok: mmQrTokenForTable('08') };
    }, bad);
    check(out.stored === false && out.url === '' && out.tok === '', 'invalid token (' + label + ') is rejected and yields no URL', JSON.stringify(out));
  }
  await o.close();

  // ===== 3. New credential generation + successful localStorage persistence ========================
  o = await owner({ tables: ['01', '02', '03'] });
  check((await o.statusLine()).indexOf('Server credentials: 0/3') >= 0 && (await o.statusLine()).indexOf('Printable on this device: 0/3') >= 0,
    'status before generation: 0/3 server credentials, 0/3 printable on this device', await o.statusLine());
  await o.page.locator('button:has-text("Generate missing secure QRs")').dispatchEvent('click'); // the Owner tab is not on screen in this harness; the real onclick still runs
  await o.page.waitForTimeout(500);
  let gen = await o.rpc('mm_admin_generate_all_table_qr');
  check(gen.length === 1 && gen[0].args.p_rotate === false && gen[0].args.p_restaurant_id === TEST_RESTAURANT,
    'Generate missing sends one request with p_rotate=false and the environment restaurant id', JSON.stringify(gen));
  const srvTok = (await o.srv());
  const stored = [await o.ls('01'), await o.ls('02'), await o.ls('03')];
  check(stored.every((s) => /^[0-9a-f]{64}$/.test(s)) && new Set(stored).size === 3, 'all three issued tokens are stored on this device (64-hex, distinct)', JSON.stringify(stored));
  check(Object.keys(srvTok.creds).length === 3 && JSON.stringify(srvTok).indexOf(stored[0]) < 0, 'server fake holds only hashes, never the plaintext token');
  check((await o.statusLine()).indexOf('Server credentials: 3/3') >= 0 && (await o.statusLine()).indexOf('Printable on this device: 3/3') >= 0 && (await o.statusLine()).indexOf('Printed and confirmed: 0/3') >= 0,
    'status after generation: 3/3 server, 3/3 printable, 0/3 confirmed', await o.statusLine());
  check((await o.notice()).indexOf('Secure QR saved on this device for Table 01, 02, 03') >= 0, 'owner is told which tables were saved', await o.notice());
  check(o.dialogs.length === 1 && /only for tables that do not have one yet/i.test(o.dialogs[0]), 'generating asks for confirmation and says existing codes are not changed', JSON.stringify(o.dialogs));
  await o.close();

  // ===== 4. Already-provisioned credentials with unavailable local tokens ==========================
  o = await owner({ tables: ['02', '08'], provisioned: ['02', '08'], verified: ['02', '08'] });
  let sl = await o.statusLine();
  check(/Server credentials: 2\/2/.test(sl) && /Printable on this device: 0\/2/.test(sl) && /Printed and confirmed: 2\/2/.test(sl),
    'dashboard separates server credentials (2/2) from tokens printable on this device (0/2)', sl);
  let rows = await o.rows();
  check(rows.length === 2 && rows.every((x) => x[1] === 'Issued' && x[2] === 'No printable token'), 'per-table status shows "Issued" but "No printable token" for Table 02 and 08', JSON.stringify(rows));
  check(/no printable token for Table 02, 08/.test(await o.tableStatus()), 'the exact affected tables (02, 08) are named in the dashboard');
  await o.call(() => generateSecureTableQRs(false));
  await o.page.waitForTimeout(400);
  let srv = await o.srv();
  check(srv.rotations === 0 && (await o.rpc('mm_admin_generate_all_table_qr'))[0].args.p_rotate === false, 'Generate missing never rotates already-provisioned credentials');
  check((await o.notice()).indexOf('Table 02, 08 already has a server credential but this device has no printable token') >= 0, 'generate reports tables that cannot be printed from this device', await o.notice());
  check(await o.ls('02') === '' && await o.ls('08') === '', 'no token appears locally for tables the server would not re-issue');
  await o.close();

  // ===== 5. Print-all blocking (missing tokens) and success ========================================
  o = await owner({ tables: ['01', '02', '03'], provisioned: ['01', '02', '03'], tokens: { '01': T1, '02': T2 } });
  let popup = await o.printAll();
  check(popup === null, 'print-all with Table 03 lacking a token opens no sheet');
  const n3 = await o.notice();
  check(/Table 03\b/.test(n3) && !/Table 03, /.test(n3) && !/\b01\b.*\b02\b.*Cannot/.test(n3) && /Cannot print the QR sheet/.test(n3), 'print-all names exactly the affected table (03)', n3);
  check((await o.call(() => window.__qrTexts.length)) === 0, 'no QR is rendered when print-all is blocked');
  await o.page.evaluate(() => localStorage.setItem('mm_table_qr_03', 'zz'));
  popup = await o.printAll();
  check(popup === null && /Table 03\b/.test(await o.notice()), 'an invalid stored token (not 64-hex) also blocks print-all for that table');
  await o.close();

  o = await owner({ tables: ['01', '02', '03'], provisioned: ['01', '02', '03'], tokens: { '01': T1, '02': T2, '03': T3 } });
  popup = await o.printAll();
  check(popup !== null, 'print-all opens the sheet when every active table has a valid token');
  if (popup) {
    const sheet = await popup.evaluate(() => Array.from(document.querySelectorAll('.item')).map((i) => ({
      label: i.querySelector('strong').textContent, shown: i.querySelector('.url').textContent,
      encoded: decodeURIComponent(i.querySelector('img').src.split(',')[1]).replace(/^.*<desc>|<\/desc>.*$/g, '').replace(/&amp;/g, '&')
    })));
    const expected = [['01', T1], ['02', T2], ['03', T3]].map(([n, t]) => url(n, t));
    check(sheet.length === 3 && sheet.every((s, i) => s.shown === expected[i] && s.encoded === expected[i] && s.label === 'TABLE ' + ['01', '02', '03'][i]),
      'every sticker encodes and prints its own complete secure URL', JSON.stringify(sheet));
  }
  check(!o.external.some((u) => /qrserver|quickchart/.test(u)), 'no secure URL was sent to a third-party QR service', o.external.join(' | '));
  await o.close();

  // ===== 6. localStorage failure ===================================================================
  o = await owner({ tables: ['01', '02'], storage: 'all' });
  await o.call(() => generateSecureTableQRs(false));
  await o.page.waitForTimeout(300);
  check((await o.rpc('mm_admin_generate_all_table_qr')).length === 0 && Object.keys((await o.srv()).creds).length === 0,
    'storage blocked up front: no credential is generated (so no token is lost)');
  check(/cannot save secure QR codes/i.test(await o.notice()), 'storage blocked: the owner is told why', await o.notice());
  await o.close();

  for (const mode of ['throw', 'silent']) {
    o = await owner({ tables: ['01', '02'], storage: mode });
    await o.call(() => generateSecureTableQRs(false));
    await o.page.waitForTimeout(400);
    const nt = await o.notice();
    check((await o.rpc('mm_admin_generate_all_table_qr')).length === 1 && /WARNING: Table 01, 02 got a new server credential but the code could not be saved/.test(nt),
      'storage failing after the probe (' + mode + '): the exact tables whose token was lost are reported', nt);
    check(await o.ls('01') === '' && await o.ls('02') === '' && !/Secure QR saved on this device/.test(nt), 'storage failure (' + mode + '): nothing is reported as saved');
    check((await o.srv()).rotations === 0, 'storage failure (' + mode + '): no credential is rotated automatically');
    popup = await o.printAll();
    check(popup === null, 'storage failure (' + mode + '): print-all stays blocked');
    await o.close();
  }

  o = await owner({ tables: ['01'], badToken: true });
  await o.call(() => generateSecureTableQRs(false));
  await o.page.waitForTimeout(300);
  check(/WARNING: Table 01/.test(await o.notice()) && await o.ls('01') === '', 'a malformed token returned by the server is refused and reported, never stored');
  await o.close();

  // ===== 7. Individual preview / download / copy / share ===========================================
  for (const [n, t] of [['02', T2], ['08', T8]]) {
    o = await owner({ tables: ['02', '08'], provisioned: ['02', '08'], tokens: { '02': T2, '08': T8 } });
    await o.call((num) => showQR(num), n);
    await o.page.waitForTimeout(400);
    const exp = url(n, t);
    const ui = await o.page.evaluate(() => ({
      link: document.getElementById('qr-table-url').value,
      img: (document.getElementById('qr-image') || {}).dataset && document.getElementById('qr-image').dataset.qrUrl,
      imgSrc: (document.getElementById('qr-image') || {}).src || '',
      open: document.getElementById('qr-open-link').href, openShown: getComputedStyle(document.getElementById('qr-open-link')).display,
      btn: document.getElementById('qr-download-btn').textContent, disabled: document.getElementById('qr-download-btn').disabled,
      texts: window.__qrTexts.slice()
    }));
    check(ui.link === exp && ui.img === exp && ui.texts.length === 1 && ui.texts[0] === exp, 'Table ' + n + ' preview: link field, image and encoded text are the same complete URL', JSON.stringify(ui));
    check(ui.openShown !== 'none' && ui.open === ui.imgSrc && ui.btn === 'Download QR' && !ui.disabled, 'Table ' + n + ' preview: Open and Download use the generated image');
    await o.call(() => { copyCurrentTableLink(); });
    await o.call(() => { shareCurrentTableLink(); });
    await o.call(() => { dlQR(); });
    const out = await o.page.evaluate(() => ({ clip: window.__clip, share: window.__share, dl: window.__dl }));
    check(out.clip.length === 1 && out.clip[0] === exp, 'Table ' + n + ' copy: clipboard receives the exact secure URL', JSON.stringify(out.clip));
    check(out.share.length === 1 && out.share[0] === exp, 'Table ' + n + ' share: share sheet receives the exact secure URL', JSON.stringify(out.share));
    check(out.dl.length === 1 && out.dl[0].name === 'mirch-masaala-table-' + n + '-qr.png' && out.dl[0].src === ui.imgSrc, 'Table ' + n + ' download: saves the validated image under the right file name', JSON.stringify(out.dl.map((d) => d.name)));
    await o.close();
  }

  // Token changes after the dialog was drawn (e.g. rotated on this device): every output is refused.
  o = await owner({ tables: ['02'], provisioned: ['02'], tokens: { '02': T2 } });
  await o.call(() => showQR('02'));
  await o.page.waitForTimeout(300);
  await o.page.evaluate((t) => localStorage.setItem('mm_table_qr_02', t), T8);
  await o.call(() => { copyCurrentTableLink(); shareCurrentTableLink(); dlQR(); });
  const stale = await o.page.evaluate(() => ({ clip: window.__clip.length, share: window.__share.length, dl: window.__dl.length }));
  check(stale.clip === 0 && stale.share === 0 && stale.dl === 0, 'a QR dialog that no longer matches the stored token refuses copy, share and download', JSON.stringify(stale));
  await o.close();

  // No token: the dialog refuses to draw anything and every output is refused.
  o = await owner({ tables: ['02'], provisioned: ['02'] });
  await o.call(() => showQR('02'));
  await o.page.waitForTimeout(300);
  await o.call(() => { copyCurrentTableLink(); shareCurrentTableLink(); dlQR(); });
  const none = await o.page.evaluate(() => ({
    link: document.getElementById('qr-table-url').value, img: !!document.getElementById('qr-image'),
    msg: document.getElementById('qr-code').textContent, btn: document.getElementById('qr-download-btn').textContent,
    disabled: document.getElementById('qr-download-btn').disabled, openShown: getComputedStyle(document.getElementById('qr-open-link')).display,
    clip: window.__clip.length, share: window.__share.length, dl: window.__dl.length, texts: window.__qrTexts.length
  }));
  check(none.link === '' && !none.img && /No secure QR is available for Table 02/.test(none.msg) && none.btn === 'No secure QR' && none.disabled && none.openShown === 'none',
    'no token: preview draws no QR, shows why, and disables Download/Open', JSON.stringify(none));
  check(none.clip === 0 && none.share === 0 && none.dl === 0 && none.texts === 0, 'no token: copy, share and download are refused and nothing is encoded');
  await o.close();

  // Secure URLs are never sent to a third-party QR service, even when the local library cannot load.
  o = await owner({ tables: ['02'], provisioned: ['02'], tokens: { '02': T2 }, qrLib: false });
  await o.call(() => showQR('02'));
  await o.page.waitForTimeout(2600);
  const noLib = await o.page.evaluate(() => ({ box: document.getElementById('qr-code').textContent, img: !!document.getElementById('qr-image'), btn: document.getElementById('qr-download-btn').textContent }));
  check(!noLib.img && /could not be generated/i.test(noLib.box) && noLib.btn === 'Retry QR', 'QR library unavailable: secure preview fails safely with a retry', JSON.stringify(noLib));
  check(!o.external.some((u) => /qrserver|quickchart/.test(u) || u.indexOf(T2) >= 0), 'QR library unavailable: the token URL is not sent to any external service', o.external.join(' | '));
  const plain = await o.page.evaluate(() => makeQRImage('https://test.invalid/?table=02', 240));
  check(/^https:\/\/api\.qrserver\.com\//.test(plain), 'non-secure text still uses the old online fallback (behaviour unchanged for other QR uses)');
  await o.close();

  // ===== 8. Rotation requires explicit confirmation, never automatic ================================
  o = await owner({ tables: ['02', '08'], provisioned: ['02', '08'], verified: ['02', '08'], tokens: { '02': T2, '08': T8 }, dialog: 'dismiss' });
  await o.call(() => generateSecureTableQRs(true));
  await o.call(() => rotateSecureTableQR('02'));
  check(o.dialogs.length === 2 && /Rotate EVERY table QR/.test(o.dialogs[0]) && /stop working immediately/.test(o.dialogs[0]) && /Rotate the QR for Table 02/.test(o.dialogs[1]),
    'rotate-all and rotate-one each ask a clear confirmation first', JSON.stringify(o.dialogs));
  check((await o.rpc('mm_admin_generate_all_table_qr')).length === 0 && (await o.rpc('mm_admin_generate_table_qr')).length === 0 && (await o.srv()).rotations === 0 && await o.ls('02') === T2,
    'declining the confirmation sends no request and keeps the existing token');
  await o.call(() => generateSecureTableQRs('true'));
  await o.call(() => generateSecureTableQRs(1));
  check((await o.srv()).rotations === 0, 'a truthy-but-not-true argument can never trigger rotation');
  await o.close();

  o = await owner({ tables: ['02', '08'], provisioned: ['02', '08'], verified: ['02', '08'], tokens: { '02': T2, '08': T8 } });
  await o.page.locator('tr[data-table="02"] button:has-text("Rotate")').dispatchEvent('click');
  await o.page.waitForTimeout(400);
  const one = await o.rpc('mm_admin_generate_table_qr');
  srv = await o.srv();
  check(one.length === 1 && one[0].args.p_table_number === '02' && one[0].args.p_rotate === true && one[0].args.p_restaurant_id === TEST_RESTAURANT, 'confirmed single-table rotation sends exactly that table with p_rotate=true');
  check(srv.rotations === 1 && srv.verified['08'] === true && srv.verified['02'] === false && (await o.ls('08')) === T8, 'only Table 02 changed: Table 08 keeps its token and its confirmed state');
  const newT2 = await o.ls('02');
  check(/^[0-9a-f]{64}$/.test(newT2) && newT2 !== T2, 'the new Table 02 token is stored on this device (replacing the old one)');
  await o.call(() => generateSecureTableQRs(true));
  check((await o.rpc('mm_admin_generate_all_table_qr')).slice(-1)[0].args.p_rotate === true && (await o.srv()).rotations === 3, 'confirmed rotate-all rotates every table (explicit, separate action)');
  await o.close();

  // ===== 9. Confirm and enforcement gating ===========================================================
  o = await owner({ tables: ['01', '02', '03'], provisioned: ['01'], tokens: { '01': T1 } });
  await o.call(() => confirmSecureTableQRs());
  check((await o.rpc('mm_admin_confirm_table_qr')).length === 0 && /Generate secure QRs first for Table 02, 03/.test(await o.notice()), 'confirming is refused while tables have no server credential (exact tables named)', await o.notice());
  await o.call(() => setSecureQREnforcement(true));
  check((await o.rpc('mm_admin_set_qr_enforcement')).length === 0 && /NOT enabled\. Table 01, 02, 03 still needs/.test(await o.notice()), 'enabling protection is refused client-side and lists every table that is not ready', await o.notice());
  await o.close();

  o = await owner({ tables: ['01', '02'], provisioned: ['01', '02'], verified: ['01'], tokens: { '01': T1, '02': T2 } });
  await o.call(() => setSecureQREnforcement(true));
  check((await o.rpc('mm_admin_set_qr_enforcement')).length === 0 && /Table 02 still needs/.test(await o.notice()) && (await o.srv()).enforcement === false, 'one unconfirmed table blocks enabling protection, naming Table 02');
  await o.call(() => confirmSecureTableQRs());
  check(o.dialogs.some((d) => /printed, placed on the correct table and scanned/.test(d)) && (await o.rpc('mm_admin_confirm_table_qr')).length === 1, 'owner confirms after a clear prompt');
  await o.call(() => setSecureQREnforcement(true));
  check((await o.rpc('mm_admin_set_qr_enforcement')).length === 1 && (await o.srv()).enforcement === true, 'once every table has a confirmed credential, protection can be enabled');
  await o.call(() => setSecureQREnforcement(false));
  check((await o.srv()).enforcement === false, 'protection can still be switched off');
  await o.close();

  o = await owner({ tables: ['01'], provisioned: ['01'], verified: ['01'], tokens: { '01': T1 }, statusError: true });
  await o.call(() => setSecureQREnforcement(true));
  check((await o.rpc('mm_admin_set_qr_enforcement')).length === 0 && /NOT enabled/.test(await o.notice()), 'if the status cannot be read, protection is not enabled');
  await o.close();

  o = await owner({ tables: ['01', '02'], provisioned: ['01', '02'], tokens: { '01': T1 } });
  await o.call(() => confirmSecureTableQRs());
  check(o.dialogs.some((d) => /no printable token for Table 02/.test(d)), 'confirm prompt warns about tables with no printable token on this device');
  await o.close();

  // ===== 10. Customer QR ordering passes p_qr_credential ============================================
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true });
    await context.route(/^https?:/, (r) => r.abort('failed'));
    const page = await context.newPage();
    page.on('pageerror', (e) => unexpected.push('uncaught: ' + e.message));
    await page.addInitScript({ path: path.join(site, 'test-env-override.js') });
    await page.addInitScript(installFake, { tables: ['02'] });
    await page.addInitScript(() => { ['02'].forEach((n) => sessionStorage.setItem('mm_sp_' + n, '1')); });
    await page.goto(indexUrl + '?table=02&qr=' + T2, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4300);
    await page.evaluate(() => {
      const items = window.MENU.menu_items.slice(0, 2);
      cart = items.map((i) => ({ id: i.id, name: i.name, price: i.price, qty: 1 })); window.cart = cart; updCart(); openCart();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => window.placeOrder());
    await page.waitForTimeout(900);
    const calls = await page.evaluate(() => window.__rpc.filter((c) => c.name === 'mm_place_order'));
    check(calls.length === 1 && calls[0].args.p_qr_credential === T2 && calls[0].args.p_table_number === '02',
      'customer QR order: mm_place_order carries p_qr_credential for the scanned table', JSON.stringify(calls.map((c) => ({ t: c.args.p_table_number, q: c.args.p_qr_credential }))));
    const visits = await page.evaluate(() => window.__rpc.filter((c) => /visit/.test(c.name)).map((c) => c.args.p_qr_credential));
    check(visits.length > 0 && visits.every((q) => q === T2), 'the table-visit checks also carry the credential');
    await context.close();
  }

  check(unexpected.length === 0, 'no unexpected script errors in any scenario', unexpected.join(' | '));
  await browser.close();
  console.log('\n' + (stubbed.length ? 'NOTE: stubbed missing files: ' + stubbed.join(', ') + ' (re-run in the full project)\n' : 'No stubs used: ran against the full project files.\n') +
    (failures ? failures + ' of ' + total + ' secure QR check(s) FAILED.' : 'Secure QR workflow test passed (' + total + ' checks, mocked backend).'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
