'use strict';
// Owner table management + QR system + customer table isolation + table lifecycle.
// Runs against the in-memory fake backend (contracts from supabase/*.sql); no real Supabase is contacted.
// Needs: npm i --no-save playwright @supabase/supabase-js@2.58.0 jsqr@1.4.0   (pdftotext/pdfinfo optional for the print-sheet check)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const L = require('./lib.cjs');
const { check } = L;
const { RID } = require('./fake-backend.cjs');

const calls = (be, name) => be.st.calls.filter((c) => c.name === name);
const have = (bin) => cp.spawnSync('which', [bin]).status === 0;

async function login(page, role) {
  await page.locator('#btn-staff').click();
  await page.locator('.role-tab[data-role="' + role + '"]').click();
  await page.fill('input[name=username]', role === 'admin' ? 'owner' : role);
  await page.fill('input[name=password]', 'pw');
  await page.locator('#btn-login').click();
}
async function ownerTab(page, tab) {
  await page.locator('#owner-nav [data-panel="' + tab + '"]').click();
}
async function ownerTables(page) {
  await ownerTab(page, 'tables');
  await page.waitForSelector('#owner-panel [data-owner-table]', { timeout: 8000 });
}
const card = (page, n) => page.locator('#owner-panel [data-owner-table="' + n + '"]');
const text = (page, sel) => page.locator(sel).first().innerText();
const decodeInPage = (page, jsqrPath) => page.addScriptTag({ path: jsqrPath });

(async () => {
  const { srv, port } = await L.serve(L.ROOT);
  const browser = await L.launch();
  const be = L.makeBackend();
  const origin = 'http://127.0.0.1:' + port;
  const expectUrl = (n) => origin + '/?table=' + n;
  const ACTIVE = ['01', '02', '03', '04', '05', '06', '07', '08'];

  // ======================================================= OWNER: table list, status, capacity
  const o = await L.open(browser, port, be, { device: null });
  const op = o.page;
  await op.goto(o.url(''), { waitUntil: 'load' });
  await decodeInPage(op, L.JSQR);
  await login(op, 'admin');
  await op.waitForSelector('#screen-owner.on');
  await ownerTables(op);
  check((await op.locator('#owner-panel [data-owner-table]').count()) === 9, 'owner tables: all 9 tables listed (8 active + 1 inactive)');
  let freeCount = 0;
  for (const n of ACTIVE) if (/free/i.test(await card(op, n).innerText())) freeCount++;
  check(freeCount === 8, 'owner tables: a new table with no visit shows Free (8/8 active tables)', freeCount + '/8');
  check(/inactive/i.test(await card(op, '09').innerText()) && (await card(op, '09').getAttribute('class')).includes('off'), 'owner tables: table 09 shows Inactive');
  check(/4 seats/.test(await card(op, '05').innerText()), 'owner tables: seating capacity shown on the card');
  check(/\(8\)/.test(await text(op, '[data-qr-all]')), 'owner tables: "Print all QR" counts only active tables (8)');
  check((await text(op, '[data-qr-base]')).includes(origin + '/'), 'owner tables: shows the address the QR codes open', await text(op, '[data-qr-base]'));
  check(/test address/i.test(await text(op, '.tbl-warn')), 'owner tables: warns when run from a test address (127.0.0.1)');
  check(/database change/i.test(await text(op, '#owner-panel .muted.small:last-child')) || /database change/i.test(await op.locator('#owner-panel').innerText()), 'owner tables: create / rename / activate-deactivate shown as not available (blocked, no workaround)');
  check((await op.locator('#owner-panel input[type=text], #owner-panel input:not([type=number])').count()) === 0, 'owner tables: no free-text field that could change the QR address');

  // capacity (mm_admin_set_table_capacity)
  await card(op, '05').click();
  await op.waitForSelector('#tbl-cap');
  const capCalls0 = calls(be, 'mm_admin_set_table_capacity').length;
  for (const bad of ['0', '31', '2.5', '']) {
    await op.fill('#tbl-cap', bad); await op.locator('[data-cap-save]').click(); await op.waitForTimeout(150);
  }
  check(calls(be, 'mm_admin_set_table_capacity').length === capCalls0, 'capacity: 0 / 31 / 2.5 / empty rejected before any request');
  await op.fill('#tbl-cap', '6'); await op.locator('[data-cap-save]').click();
  await op.waitForFunction(() => /saved/i.test(document.getElementById('toast').innerText), null, { timeout: 4000 }).catch(() => {});
  const cc = calls(be, 'mm_admin_set_table_capacity')[0];
  check(!!cc && cc.args.p_table_number === '05' && cc.args.p_capacity === 6 && cc.role === 'admin' && be.st.tables.find((t) => t.table_number === '05').seating_capacity === 6, 'capacity: table 05 -> 6 via mm_admin_set_table_capacity (admin)', JSON.stringify(cc && cc.args));
  be.st.failNext.mm_admin_set_table_capacity = 'Active table 05 was not found';
  await op.fill('#tbl-cap', '7'); await op.locator('[data-cap-save]').click();
  await op.waitForTimeout(400);
  check(/not found/i.test(await text(op, '#toast')), 'capacity: server refusal is shown to the owner', await text(op, '#toast'));
  await op.locator('[data-tbl-back]').click();
  check(/6 seats/.test(await card(op, '05').innerText()), 'capacity: list shows the new capacity after Back');

  // ======================================================= QR generation
  await card(op, '05').click();
  await op.waitForSelector('[data-qr-preview] .qr-sticker');
  const stick = await op.locator('[data-qr-preview] .qr-sticker').innerText();
  check(/MIRCH MASAALA/.test(stick) && /TABLE 05/.test(stick) && stick.includes(expectUrl('05')), 'QR preview: sticker shows brand, "TABLE 05" and the table link', stick.replace(/\n/g, ' | '));
  check((await op.locator('[data-qr-preview] svg path').count()) === 1, 'QR preview: QR drawn as inline SVG');

  const decoded = await op.evaluate(async (tables) => {
    const out = {};
    for (const n of tables) {
      const cv = MM.qr.canvasFor(n), g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height);
      const r = window.jsQR(d.data, d.width, d.height);
      // same QR via the SVG sticker (what gets printed)
      const svg = MM.qr.svg(MM.qr.tableUrl(n));
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const c2 = document.createElement('canvas'); c2.width = c2.height = 600; const g2 = c2.getContext('2d');
      g2.imageSmoothingEnabled = false; g2.drawImage(img, 0, 0, 600, 600);
      const d2 = g2.getImageData(0, 0, 600, 600), r2 = window.jsQR(d2.data, 600, 600);
      out[n] = { png: r && r.data, svg: r2 && r2.data };
    }
    return out;
  }, ACTIVE);
  check(ACTIVE.every((n) => decoded[n].png === expectUrl(n)), 'QR decode (download image): every active table decodes to exactly <origin>/?table=NN', JSON.stringify(decoded).slice(0, 200));
  check(ACTIVE.every((n) => decoded[n].svg === expectUrl(n)), 'QR decode (printed SVG): every active table decodes to exactly <origin>/?table=NN');
  check(new Set(ACTIVE.map((n) => decoded[n].png)).size === 8, 'QR uniqueness: 8 tables -> 8 different QR payloads');
  check(ACTIVE.every((n) => decoded[n].png.startsWith(origin + '/?table=') && !/[&#@]|\/\/.*\/\//.test(decoded[n].png.slice(origin.length))), 'QR safety: every payload is this site + ?table=NN only (no external address, no extra params)');
  const bad = await op.evaluate(() => ['abc', '123', '', '1.5', '../x', '5;drop'].map((v) => { try { MM.qr.tableUrl(v); return 'ALLOWED'; } catch (e) { return 'rejected'; } }));
  check(bad.every((x) => x === 'rejected'), 'QR safety: non-table input is refused by the generator', bad.join(','));
  check(await op.evaluate(() => MM.qr.tableUrl('5') === location.origin + '/?table=05' && MM.qr.tableUrl(7) === location.origin + '/?table=07'), 'QR format: 5 -> 05, 7 -> 07 (matches scanner/customer 2-digit rule)');

  // download
  const [dl] = await Promise.all([op.waitForEvent('download'), op.locator('[data-qr-download]').click()]);
  const dlPath = path.join(os.tmpdir(), 'mm-qr-' + crypto.randomUUID() + '.png');
  await dl.saveAs(dlPath);
  const png = fs.readFileSync(dlPath);
  check(dl.suggestedFilename() === 'mirch-masaala-table-05-qr.png' && png.slice(0, 8).toString('hex') === '89504e470d0a1a0a', 'QR download: PNG file named mirch-masaala-table-05-qr.png');
  const dlDecoded = await op.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, cv.width, cv.height);
    const r = window.jsQR(d.data, d.width, d.height); return { w: img.width, h: img.height, v: r && r.data };
  }, png.toString('base64'));
  check(dlDecoded.v === expectUrl('05') && dlDecoded.w >= 600, 'QR download: the downloaded PNG itself decodes to table 05 link', JSON.stringify(dlDecoded));
  fs.unlinkSync(dlPath);

  // print individual / all (print dialog stubbed: we inspect the DOM the browser would print)
  await op.evaluate(() => {
    window.__print = [];
    window.print = () => window.__print.push({ stickers: [...document.querySelectorAll('#qr-print-root .qr-sticker')].map((e) => e.getAttribute('data-qr-sticker')), cls: document.body.classList.contains('mm-printing') });
  });
  await op.locator('[data-qr-print]').click();
  await op.waitForFunction(() => window.__print.length === 1);
  const p1 = await op.evaluate(() => window.__print[0]);
  check(JSON.stringify(p1.stickers) === '["05"]' && p1.cls, 'QR print (single): print sheet holds only table 05 and the page is in print mode');
  await op.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  check(await op.evaluate(() => !document.getElementById('qr-print-root') && !document.body.classList.contains('mm-printing')), 'QR print: print sheet removed after printing (dashboard restored)');
  await op.locator('[data-tbl-back]').click();
  await op.locator('[data-qr-all]').click();
  await op.waitForFunction(() => window.__print.length === 2);
  const p2 = await op.evaluate(() => window.__print[1]);
  check(JSON.stringify(p2.stickers) === JSON.stringify(ACTIVE), 'QR print (all): 8 stickers 01..08 in order, inactive table 09 excluded', JSON.stringify(p2.stickers));

  // real print layout: Chromium print media -> PDF (no physical printer involved)
  if (have('pdfinfo') && have('pdftotext')) {
    await op.emulateMedia({ media: 'print' });
    const visible = await op.evaluate(() => [...document.body.children].filter((e) => getComputedStyle(e).display !== 'none' && !['SCRIPT', 'LINK', 'STYLE'].includes(e.tagName)).map((e) => e.id || e.tagName));
    check(visible.length === 1 && visible[0] === 'qr-print-root', 'print layout: in print media only the sticker sheet is visible', visible.join(','));
    const pdf = path.join(os.tmpdir(), 'mm-qr-' + crypto.randomUUID() + '.pdf');
    await op.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    const pages = Number(/Pages:\s+(\d+)/.exec(cp.execSync('pdfinfo ' + pdf).toString())[1]);
    const txt = cp.execSync('pdftotext -layout ' + pdf + ' -').toString();
    check(pages === 2, 'print layout: 8 stickers fit on 2 A4 pages (4 per page)', 'pages=' + pages);
    check(ACTIVE.every((n) => txt.includes('TABLE ' + n)) && !/TABLE 09/.test(txt) && (txt.match(/MIRCH MASAALA/g) || []).length === 8, 'print layout: PDF has TABLE 01-08 each with the restaurant name, no table 09');
    fs.unlinkSync(pdf);
    await op.emulateMedia({ media: 'screen' });
    await op.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  } else {
    console.log('SKIP print-layout PDF checks: pdfinfo/pdftotext not installed');
  }

  // inactive table
  await card(op, '09').click();
  await op.waitForSelector('[data-tbl-back]');
  check((await op.locator('[data-qr-print], [data-qr-download], [data-qr-preview], #tbl-cap').count()) === 0 && /inactive/i.test(await text(op, '#owner-panel')), 'inactive table: no QR, print, download or capacity controls; explanation shown');
  await op.locator('[data-tbl-back]').click();

  // ======================================================= mobile layout (owner on a phone)
  const om = await L.open(browser, port, be, { device: 'Pixel 7' });
  await om.page.goto(om.url(''), { waitUntil: 'load' });
  await login(om.page, 'admin');
  await om.page.waitForSelector('#screen-owner.on');
  await ownerTables(om.page);
  const overflow = async () => om.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check((await overflow()) <= 1, 'mobile owner (Pixel 7): table list has no horizontal scroll', await overflow());
  await card(om.page, '03').click();
  await om.page.waitForSelector('[data-qr-preview] .qr-sticker');
  const box = await om.page.locator('[data-qr-preview] .qr-sticker').boundingBox();
  check((await overflow()) <= 1 && box.width >= 200 && box.width <= 400, 'mobile owner: QR preview fits the screen and stays scannable size (' + Math.round(box.width) + 'px wide)');
  const btns = await om.page.locator('[data-qr-download], [data-qr-print]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check(btns.every((h) => h >= 32), 'mobile owner: QR action buttons are tappable (>=32px)', btns.join(','));
  await om.context.close();

  // ======================================================= CUSTOMER: QR -> correct table
  be.st.visits = []; be.st.orders = []; be.st.items = []; be.st.notifs = []; be.st.payments = [];
  for (const n of ACTIVE) be.rpcs.mm_staff_set_table_visit_status({ p_table_number: n, p_action: 'START', p_waiter_code: 'W01' }, 'waiter');
  const seen = {};
  const cust = await L.open(browser, port, be, { device: 'Pixel 7', init: L.SCANNER_INIT });
  for (const n of ACTIVE) {
    await cust.page.goto(decoded[n].png, { waitUntil: 'load' });         // exactly what a phone camera opens
    await cust.page.waitForSelector('#menu-list [data-add]', { timeout: 8000 });
    seen[n] = (await text(cust.page, '#menu-table-label')).replace(/\D/g, '');
  }
  check(ACTIVE.every((n) => seen[n] === n) && new Set(Object.values(seen)).size === 8, 'customer: each of the 8 generated QR links opens its own table (01..08), none collide', JSON.stringify(seen));

  // scanner end-to-end with a generated QR payload
  await cust.page.goto(cust.url(''), { waitUntil: 'load' });
  await cust.page.locator('#btn-scan-qr').click();
  await cust.page.waitForFunction(() => /Point your camera/.test(document.querySelector('[data-qr-status]').textContent), null, { timeout: 8000 });
  await cust.page.evaluate((v) => window.__qr.push(v), decoded['03'].png);
  await cust.page.waitForURL('**/?table=03', { timeout: 8000 }).catch(() => {});
  await cust.page.waitForSelector('#menu-list [data-add]', { timeout: 8000 });
  check(cust.page.url() === expectUrl('03') && /03/.test(await text(cust.page, '#menu-table-label')), 'customer: scanning a generated QR in the app opens that table\'s menu');

  // invalid / foreign QRs rejected by the scanner
  await cust.page.goto(cust.url(''), { waitUntil: 'load' });
  await cust.page.locator('#btn-scan-qr').click();
  await cust.page.waitForFunction(() => /Point your camera/.test(document.querySelector('[data-qr-status]').textContent), null, { timeout: 8000 });
  for (const badQr of [decoded['05'].png.replace(origin, 'https://evil.example'), origin + '/?table=5x', origin + '/?table=123', 'table=05', origin + '/other?x=1']) {
    await cust.page.evaluate((v) => window.__qr.push(v), badQr); await cust.page.waitForTimeout(250);
  }
  check(cust.page.url() === cust.url('') && (await cust.page.locator('.mm-qr-overlay').count()) === 1, 'customer: external-host / malformed / 3-digit QR codes are rejected, scanner stays open');
  await cust.page.locator('.mm-qr-close').click();

  // inactive and unknown tables
  await cust.page.goto(expectUrl('09'), { waitUntil: 'load' });
  await cust.page.waitForFunction(() => document.getElementById('gate-msg').textContent !== 'Checking table…');
  check(!(await cust.page.locator('#gate').isHidden()) && /could not find/i.test(await text(cust.page, '#gate-msg')) && (await cust.page.locator('#menu-list [data-add]').count()) === 0, 'customer: inactive table 09 QR -> "table not found", no menu, no ordering');
  await cust.page.goto(expectUrl('00'), { waitUntil: 'load' });
  await cust.page.waitForFunction(() => document.getElementById('gate-msg').textContent !== 'Checking table…');
  check(/could not find/i.test(await text(cust.page, '#gate-msg')), 'customer: ?table=00 -> table not found');

  // refresh keeps table context
  await cust.page.goto(expectUrl('05'), { waitUntil: 'load' });
  await cust.page.waitForSelector('#menu-list [data-add]');
  await cust.page.locator('[data-add]').first().click();
  await cust.page.reload({ waitUntil: 'load' });
  await cust.page.waitForSelector('#menu-list .food-card', { timeout: 8000 });
  check(/05/.test(await text(cust.page, '#menu-table-label')) && cust.page.url() === expectUrl('05') && (await cust.page.locator('#menu-list .food-card').count()) >= 3, 'customer: refresh keeps table 05 and its menu (taken from the URL, not from editable UI)');
  await cust.page.locator('#btn-open-cart').click();
  await cust.page.reload({ waitUntil: 'load' });
  await cust.page.waitForSelector('#menu-list .food-card', { timeout: 8000 });
  check(/05/.test(await text(cust.page, '#menu-table-label')), 'customer: refresh while on the cart still keeps table 05');

  // privacy: order/bill of another phone / table
  const sessA = crypto.randomUUID(), v5 = be.openVisit('05'), item = be.st.menu[0];
  const placed = be.rpcs.mm_place_order({ p_restaurant_id: RID, p_table_number: '05', p_ticket_id: 'T05-PRIVACY-0001', p_notes: 'secret note', p_items: [{ menu_item_id: item.id, quantity: 1 }], p_table_visit_id: v5.id, p_customer_session_id: sessA, p_guest_order_code: null }, '');
  const b = await L.open(browser, port, be, { device: 'Pixel 7' });
  await b.page.goto(expectUrl('05'), { waitUntil: 'load' });
  await b.page.waitForSelector('#menu-list [data-add]');
  const priv = await b.page.evaluate(async (a) => {
    const out = {};
    try { out.wrongToken = await MM.api.getPublicOrder(a.ticket, 'not-the-token'); } catch (e) { out.wrongToken = 'error'; }
    try { out.otherSessionBill = await MM.api.guestBill('05', a.visit, a.other); } catch (e) { out.otherSessionBill = 'error'; }
    try { out.otherTableBill = await MM.api.guestBill('06', a.visit, a.sessA); } catch (e) { out.otherTableBill = 'error'; }
    try { out.rawOrders = await MM.api.staffOrders(false); } catch (e) { out.rawOrders = 'error'; }
    try { out.rightToken = await MM.api.getPublicOrder(a.ticket, a.token); } catch (e) { out.rightToken = 'error'; }
    return out;
  }, { ticket: placed.id, token: placed.publicToken, visit: v5.id, other: crypto.randomUUID(), sessA });
  check(!priv.wrongToken, 'privacy: order lookup with a wrong token returns nothing', JSON.stringify(priv.wrongToken));
  check(priv.otherSessionBill === 'error', 'privacy: another phone on the same table cannot read the visit bill');
  check(priv.otherTableBill === 'error', 'privacy: the bill of table 05 cannot be read through table 06');
  check(Array.isArray(priv.rawOrders) && priv.rawOrders.length === 0, 'privacy: a guest cannot list orders directly (RLS returns none)');
  check(priv.rightToken && priv.rightToken.id === placed.id, 'privacy: the ordering phone (ticket + token) can still read its own order');
  await b.context.close();
  check(cust.errors.length === 0, 'customer: no uncaught script errors', cust.errors.join(' | '));
  await cust.context.close();

  // ======================================================= TABLE LIFECYCLE (table 08)
  be.st.visits = []; be.st.orders = []; be.st.items = []; be.st.notifs = []; be.st.payments = [];
  await ownerTables(op);                                     // refresh the dashboard from clean state
  check(/free/i.test(await card(op, '08').innerText()), 'lifecycle 1: table 08 starts Free');
  const g = await L.open(browser, port, be, { device: 'Pixel 7' });
  await g.page.goto(expectUrl('08'), { waitUntil: 'load' });
  await g.page.waitForFunction(() => document.getElementById('gate-msg').textContent !== 'Checking table…');
  const gateBlocked = !(await g.page.locator('#gate').isHidden());
  await ownerTab(op, 'orders'); await ownerTables(op);
  check(gateBlocked && /free/i.test(await card(op, '08').innerText()) && !be.openVisit('08'), 'lifecycle 2: a guest scanning the QR does NOT make the table Busy and cannot order until the waiter opens it');
  const rejected = (() => { try { be.rpcs.mm_place_order({ p_restaurant_id: RID, p_table_number: '08', p_ticket_id: 'T08-NOVISIT-0001', p_items: [{ menu_item_id: item.id, quantity: 1 }], p_table_visit_id: crypto.randomUUID(), p_customer_session_id: crypto.randomUUID() }, ''); return false; } catch (e) { return /not open/i.test(e.message); } })();
  check(rejected, 'lifecycle 2b: the server also refuses an order for a table with no open visit');

  be.rpcs.mm_staff_set_table_visit_status({ p_table_number: '08', p_action: 'START', p_waiter_code: 'W01' }, 'waiter');
  await ownerTab(op, 'orders'); await ownerTables(op);
  check(/busy/i.test(await card(op, '08').innerText()), 'lifecycle 3: table becomes Busy when the waiter opens the visit');
  const visit8 = be.openVisit('08');

  // two orders in one visit through the real customer UI (second after a refresh)
  const placeOne = async (idx) => {
    await g.page.goto(expectUrl('08'), { waitUntil: 'load' });
    await g.page.waitForSelector('#menu-list [data-add]', { timeout: 8000 });
    await g.page.locator('[data-add]').nth(idx).click();
    await g.page.locator('#btn-open-cart').click();
    await g.page.locator('#btn-place-order').click();
    await g.page.waitForSelector('#screen-placed.on', { timeout: 8000 });
  };
  await placeOne(0); await placeOne(1);
  const po = calls(be, 'mm_place_order');
  check(po.length === 2 && po[0].args.p_table_visit_id === visit8.id && po[1].args.p_table_visit_id === visit8.id && po[0].args.p_customer_session_id === po[1].args.p_customer_session_id, 'lifecycle 4: two orders (second after a page refresh) join the same visit and the same guest session');
  await ownerTab(op, 'orders'); await ownerTables(op);
  check(/2 live/i.test(await card(op, '08').innerText()), 'lifecycle 4b: owner card shows 2 live orders');
  await card(op, '08').click();
  await op.waitForSelector('#owner-panel .order-card');
  check((await op.locator('#owner-panel .order-card').count()) === 2 && /T08-/.test(await text(op, '#owner-panel')), 'lifecycle 4c: owner detail lists both current orders of the visit');

  // can't finish / release while food is active
  op.removeAllListeners('dialog'); op.on('dialog', (d) => d.accept());
  await op.locator('[data-tbl-bill]').click();
  await op.waitForSelector('#owner-panel [data-finish]');
  await op.locator('#owner-panel [data-finish]').click();
  await op.waitForFunction(() => /in progress/i.test(document.getElementById('toast').innerText), null, { timeout: 4000 }).catch(() => {});
  check(/in progress/i.test(await text(op, '#toast')) && !!be.openVisit('08'), 'lifecycle 5: Finish refused while food is being prepared (reason shown)', await text(op, '#toast'));
  await op.locator('#owner-panel [data-release]').click();
  await op.waitForFunction(() => /active food tickets/i.test(document.getElementById('toast').innerText), null, { timeout: 4000 }).catch(() => {});
  check(/active food tickets/i.test(await text(op, '#toast')) && !!be.openVisit('08'), 'lifecycle 6: "release table" cannot discard active preparation (reason shown)', await text(op, '#toast'));
  check(be.st.orders.every((x) => x.status === 'NEW'), 'lifecycle 6b: tickets untouched by the refused actions');

  // kitchen + waiter complete the food (UI paths are covered in check-workflows); payment still pending
  be.st.orders.forEach((x) => { x.status = 'SERVED'; });
  const total = be.st.orders.reduce((s, x) => s + x.total, 0);
  const sess = po[0].args.p_customer_session_id;
  const bill = be.rpcs.mm_guest_get_visit_bill({ p_table_number: '08', p_visit_id: visit8.id, p_customer_session_id: sess }, '');
  check(bill.amount === total && total > 0, 'lifecycle 7: payment is pending after the food is served (guest bill = ₹' + total + ')');
  be.rpcs.mm_guest_cash_counter_release({ p_table_number: '08', p_visit_id: visit8.id, p_customer_session_id: sess }, '');
  check(be.rpcs.mm_guest_get_visit_bill({ p_table_number: '08', p_visit_id: visit8.id, p_customer_session_id: sess }, '').amount === total && be.st.payments.length === 0, 'lifecycle 8: a guest\'s "pay cash" request does not settle anything — still pending until the owner confirms');
  await op.locator('#owner-panel [data-visit-back]').click();
  await ownerTables(op); await card(op, '08').click(); await op.locator('[data-tbl-bill]').click();
  await op.waitForSelector('#owner-panel [data-finish]');
  check(new RegExp('₹' + total).test(await text(op, '#owner-panel')), 'lifecycle 8b: owner sees the same pending amount');
  await op.locator('#owner-panel [data-finish]').click();
  await op.waitForFunction(() => /unpaid/i.test(document.getElementById('toast').innerText), null, { timeout: 4000 }).catch(() => {});
  check(/unpaid/i.test(await text(op, '#toast')) && !!be.openVisit('08'), 'lifecycle 9: Finish refused while money is owed', await text(op, '#toast'));

  // "guest left unpaid" release: explicit warning first; cancelling keeps the table open
  let dialogMsg = '';
  op.removeAllListeners('dialog'); op.on('dialog', (d) => { dialogMsg = d.message(); d.dismiss(); });
  await op.locator('#owner-panel [data-release]').click();
  await op.waitForTimeout(300);
  check(/unpaid/i.test(dialogMsg) && dialogMsg.includes(String(total)) && !!be.openVisit('08'), 'lifecycle 10: releasing with a balance asks with an explicit unpaid warning; cancel keeps the visit open', dialogMsg.replace(/\n/g, ' '));
  op.removeAllListeners('dialog'); op.on('dialog', (d) => d.accept());

  // owner confirms payment, then closes
  await op.locator('#owner-panel [data-pay-method="cash"]').click();
  for (let i = 0; i < 40 && !be.st.payments.length; i++) await op.waitForTimeout(100);
  await op.waitForSelector('#owner-panel [data-pay-method="cash"][disabled]', { timeout: 5000 }).catch(() => {});   // panel re-rendered with ₹0 due
  check(be.st.payments.length === 1 && be.st.payments[0].amount === total && calls(be, 'mm_staff_record_visit_payment')[0].role === 'admin', 'lifecycle 11: payment recorded only by the owner login, for the exact balance', JSON.stringify({ pays: be.st.payments, total, rec: calls(be, 'mm_staff_record_visit_payment').map((c) => [c.args, c.role]), toast: await text(op, '#toast') }));
  await op.locator('#owner-panel [data-finish]').click();
  await op.waitForSelector('#owner-panel [data-owner-table]', { timeout: 6000 }).catch(() => {});
  check(!be.openVisit('08'), 'lifecycle 12: a fully served and paid visit closes');
  await ownerTables(op);
  check(/free/i.test(await card(op, '08').innerText()), 'lifecycle 13: table shows Free again after closure');
  await g.page.goto(expectUrl('08'), { waitUntil: 'load' });
  await g.page.waitForFunction(() => document.getElementById('gate-msg').textContent !== 'Checking table…');
  check(!(await g.page.locator('#gate').isHidden()), 'lifecycle 14: the old QR session cannot order again after closure');
  await g.context.close();

  // refresh / reopen dashboards repeatedly: statuses must not drift
  const snapshots = []; let relogins = 0;
  for (let i = 0; i < 3; i++) {
    await op.reload({ waitUntil: 'load' });
    await op.waitForSelector('#screen-owner.on', { timeout: 8000 }).catch(() => { relogins++; });
    if (relogins && !(await op.evaluate(() => document.getElementById('screen-owner').classList.contains('on')))) { await login(op, 'admin'); await op.waitForSelector('#screen-owner.on', { timeout: 8000 }); }
    await ownerTables(op);
    snapshots.push(await op.evaluate(() => [...document.querySelectorAll('#owner-panel [data-owner-table]')].map((e) => e.getAttribute('data-owner-table') + ':' + (e.className.match(/\b(free|busy|off)\b/) || [])[1]).join(',')));
  }
  const expected = '01:free,02:free,03:free,04:free,05:free,06:free,07:free,08:free,09:off';
  check(snapshots.every((s) => s === expected), 'lifecycle 15: reloading / reopening the Tables dashboard 3x gives identical, correct statuses', snapshots[0]);
  const writes = be.st.calls.filter((c) => c.kind === 'rest' && c.method && c.method !== 'GET' && c.name === 'restaurant_tables');
  check(relogins === 0, 'refresh: a signed-in owner stays on the dashboard after reloading the page (no sign-in again)', relogins + '/3 reloads dropped to the home screen');
  check(writes.length === 0, 'lifecycle 16: the dashboard never writes to restaurant_tables directly');
  for (const role of ['waiter', 'kitchen']) {
    const r = await L.open(browser, port, be, { device: 'Pixel 7' });
    await r.page.goto(r.url(''), { waitUntil: 'load' });
    await login(r.page, role);
    await r.page.waitForSelector('#screen-' + role + '.on');
    await r.page.reload({ waitUntil: 'load' });
    await r.page.waitForSelector('#screen-' + role + '.on', { timeout: 8000 }).catch(() => {});
    check(await r.page.evaluate((x) => document.getElementById('screen-' + x).classList.contains('on'), role), 'refresh: signed-in ' + role + ' stays on their screen after reloading the page');
    await r.page.goto(r.url('?table=04'), { waitUntil: 'load' });
    check(await r.page.evaluate(() => !document.getElementById('screen-waiter').classList.contains('on') && !document.getElementById('screen-kitchen').classList.contains('on')), 'refresh: a guest QR link opened on a staff phone still shows the customer menu, not the staff screen (' + role + ')');
    await r.context.close();
  }
  check(o.errors.length === 0, 'owner: no uncaught script errors during table/QR work', o.errors.join(' | '));
  await o.context.close();

  const fail = L.summary('Owner tables / QR / customer isolation / table lifecycle');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH', e); process.exit(2); });
