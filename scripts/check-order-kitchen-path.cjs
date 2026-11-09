#!/usr/bin/env node
'use strict';

// Order-to-kitchen path regression test.
// Runs the REAL index.html + supabase-live.js in headless Chromium against a stateful fake of the
// Supabase client. It proves the full mocked path: customer QR order -> database confirmation ->
// kitchen queue -> PREPARING -> READY -> waiter SERVED -> owner dashboard -> customer history sync,
// plus waiter-created orders, network-failure behaviour and the absence of fake local tickets.
// It does NOT talk to the production database; the SQL contract is covered by the check-*.sql
// scripts (scripts/check-qr-ordering-consolidated.sql, check-direct-kitchen-orders.sql).
//
// Usage: node scripts/check-order-kitchen-path.cjs   (needs `playwright` + Chromium;
//        set CHROME_PATH to use an already-installed Chrome)
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Needs Playwright: npm i playwright && npx playwright install chromium'); process.exit(2); }

const indexUrl = 'file://' + path.resolve(process.cwd(), 'index.html');
const VISIT = '11111111-1111-4111-8111-111111111111';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let failures = 0, total = 0;
function check(ok, name, detail) {
  total++;
  if (!ok) failures++;
  console.log((ok ? '✓ ' : '✗ ') + name + (!ok && detail !== undefined ? ' — ' + detail : ''));
}

// Installed before any page script runs. A small stateful database that mirrors the contracts of
// supabase/qr-ordering-consolidated.sql (mm_place_order, mm_get_public_order) and the staff reads.
function installFakeSupabase(scenario) {
  const VISIT = '11111111-1111-4111-8111-111111111111';
  window.__rpc = [];
  window.__updates = [];
  window.__sc = Object.assign({ status: 'open', place: 'success', placeDelay: 0, staffFail: false }, scenario || {});
  window.__db = { orders: [], items: [], seq: 0 };
  const rows = {
    categories: [{ id: 'c1', name: 'Probe', sort_order: 1, is_active: true }],
    menu_items: [
      { id: 'aaaaaaaa-0000-4000-8800-000000000001', category_id: 'c1', name: 'Probe Paneer', description: '', price: 300, image_url: null, is_available: true, sort_order: 1, is_veg: true, is_bestseller: false, spicy_level: 1 },
      { id: 'aaaaaaaa-0000-4000-8800-000000000002', category_id: 'c1', name: 'Probe Biryani', description: '', price: 400, image_url: null, is_available: true, sort_order: 2, is_veg: false, is_bestseller: false, spicy_level: 2 }
    ],
    restaurant_tables: [{ id: 'tbl-05', table_number: '05' }]
  };
  const menuById = {};
  rows.menu_items.forEach((m) => { menuById[m.id] = m; });
  const validTable = (t) => /^[0-9]{1,2}$/.test(String(t || '').trim());

  function applyFilters(list, filters) {
    return list.filter((row) => filters.every((f) => {
      const v = row ? row[f.col] : undefined;
      if (f.op === 'eq') return String(v) === String(f.val);
      if (f.op === 'in') return f.val.map(String).includes(String(v));
      if (f.op === 'is') return f.val === null ? v == null : String(v) === String(f.val);
      return true;
    }));
  }
  function project(row, cols) {
    if (!cols || cols === '*') return Object.assign({}, row);
    const out = {};
    cols.split(',').forEach((c) => { out[c.trim()] = row ? row[c.trim()] : undefined; });
    return out;
  }
  function from(name) {
    const q = { filters: [], cols: '*', mode: 'select', patch: null, single: false };
    const run = () => {
      const s = window.__sc;
      if (name === 'orders' || name === 'order_items') {
        if (s.staffFail) return { data: null, error: { message: 'Failed to fetch' } };
        let list = name === 'orders' ? window.__db.orders : window.__db.items;
        if (q.mode === 'update') {
          const matched = applyFilters(list, q.filters);
          if (name === 'orders' && q.patch && Object.prototype.hasOwnProperty.call(q.patch, 'status')) {
            matched.forEach((row) => {
              window.__updates.push({ ticket_id: row.ticket_id, status: q.patch.status });
              row.status = q.patch.status;
              row.updated_at = new Date().toISOString();
            });
          }
          const data = matched.map((r) => project(r, q.cols));
          return { data: q.single ? (data[0] || null) : data, error: null };
        }
        let data = applyFilters(list, q.filters).map((r) => project(r, q.cols));
        if (q.orderCol) data = data.slice().sort((a, b) => String(a[q.orderCol] || '').localeCompare(String(b[q.orderCol] || '')) * (q.orderAsc ? 1 : -1));
        if (q.limitCount != null) data = data.slice(0, q.limitCount);
        return { data: q.single ? (data[0] || null) : data, error: null };
      }
      return { data: rows[name] || [], error: null };
    };
    const builder = {
      select(cols) { q.cols = cols || '*'; return builder; },
      update(patch) { q.mode = 'update'; q.patch = patch; return builder; },
      eq(col, val) { q.filters.push({ op: 'eq', col, val }); return builder; },
      in(col, val) { q.filters.push({ op: 'in', col, val }); return builder; },
      is(col, val) { q.filters.push({ op: 'is', col, val }); return builder; },
      order(col, opts) { q.orderCol = col; q.orderAsc = !!(opts && opts.ascending); return builder; },
      limit(n) { q.limitCount = n; return builder; },
      maybeSingle() { q.single = true; return Promise.resolve(run()); },
      single() { q.single = true; return Promise.resolve(run()); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    return builder;
  }

  const fake = {
    rpc(name, args) {
      window.__rpc.push({ name, args });
      const s = window.__sc;
      const tn = String((args && args.p_table_number) || '');
      if (name === 'mm_public_table_visit_status') {
        if (!validTable(tn)) return Promise.resolve({ data: null, error: { code: 'P0001', message: 'Choose a valid table number' } });
        if (s.status === 'open') return Promise.resolve({ data: { table_number: tn, status: 'OPEN', can_order: true, visit_id: VISIT, message: 'You are ready to order.' }, error: null });
        if (s.status === 'available') return Promise.resolve({ data: { table_number: tn, status: 'AVAILABLE', can_order: false, visit_id: null, message: 'Please wait for the waiter to activate this table.' }, error: null });
        return Promise.resolve({ data: { table_number: tn, status: 'UNKNOWN', can_order: false, message: 'Table not found' }, error: null });
      }
      if (name === 'mm_ensure_public_table_visit') {
        if (!validTable(tn)) return Promise.resolve({ data: null, error: { code: 'P0001', message: 'Choose a valid table number' } });
        if (s.status === 'open') return Promise.resolve({ data: { table_number: tn, status: 'OPEN', visit_id: VISIT }, error: null });
        return Promise.resolve({ data: null, error: { code: 'P0001', message: 'This table is not open for online orders yet. Please ask your waiter to start the visit.' } });
      }
      if (name === 'mm_place_order') {
        return new Promise((res, rej) => setTimeout(() => {
          if (s.place === 'network') return rej(new Error('Failed to fetch'));
          if (s.place !== 'success') return res({ data: null, error: { code: 'P0001', message: s.placeMsg || 'Menu item unavailable' } });
          const a = args || {};
          if (s.status !== 'open') return res({ data: null, error: { code: 'P0001', message: 'This table is not open for online orders yet. Please ask your waiter to start the visit.' } });
          if (!a.p_customer_session_id && !window.role) return res({ data: null, error: { code: 'P0001', message: 'Customer session is missing. Refresh this page and try again.' } });
          if (a.p_table_visit_id !== VISIT) return res({ data: null, error: { code: 'P0001', message: 'The table visit has changed. Refresh and ask your waiter for the current order code.' } });
          if (window.__db.orders.some((o) => o.ticket_id === a.p_ticket_id)) return res({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
          const items = Array.isArray(a.p_items) ? a.p_items : [];
          let total = 0;
          const lineRows = items.map((line) => {
            const menu = menuById[line.menu_item_id];
            if (!menu || !menu.is_available) return null;
            const qty = Number(line.quantity) || 1;
            total += menu.price * qty;
            return { name: menu.name, price: menu.price, qty, spiceLevel: line.spice_level || 'normal', notes: line.notes || '' };
          });
          if (lineRows.some((l) => !l)) return res({ data: null, error: { code: 'P0001', message: 'A selected dish is unavailable. Refresh the menu and try again.' } });
          window.__db.seq++;
          const n = window.__db.seq;
          const row = {
            id: 'db-order-' + n, restaurant_id: 'a3702d10-6673-4c06-9783-1d61c945ecd5',
            ticket_id: a.p_ticket_id, table_id: 'tbl-05', status: 'NEW',
            approval_status: 'APPROVED', notes: a.p_notes || '', total,
            public_token: 'cccccccc-0000-4000-8000-' + String(n).padStart(12, '0'),
            order_number: n, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            is_test_order: false, is_complimentary: false, complimentary_reason: '', cancel_reason: '', archived_at: null,
            table_visit_id: a.p_table_visit_id, customer_session_id: a.p_customer_session_id || null
          };
          window.__db.orders.push(row);
          lineRows.forEach((l) => {
            window.__db.items.push({ order_id: row.id, item_name: l.name, quantity: l.qty, price: l.price, notes: l.notes, spice_level: l.spiceLevel });
          });
          res({ data: {
            id: row.ticket_id, dbId: row.id, publicToken: row.public_token, table: String(a.p_table_number).padStart(2, '0'),
            visitId: VISIT, customerSessionId: a.p_customer_session_id || null, total: row.total, status: 'NEW',
            approvalStatus: 'APPROVED', notes: row.notes, createdAt: row.created_at, orderNumber: n,
            items: lineRows, notification_ids: [], dispatch_tokens: []
          }, error: null });
        }, s.placeDelay || 0));
      }
      if (name === 'mm_get_public_order') {
        const row = window.__db.orders.find((o) => o.ticket_id === args.p_ticket_id && o.public_token === args.p_public_token);
        if (!row) return Promise.resolve({ data: null, error: null });
        const items = window.__db.items.filter((i) => i.order_id === row.id)
          .map((i) => ({ name: i.item_name, price: i.price, qty: i.quantity, spiceLevel: i.spice_level, notes: i.notes || '' }));
        return Promise.resolve({ data: { id: row.ticket_id, table: '05', total: row.total, status: row.status, approvalStatus: row.approval_status, notes: row.notes, createdAt: row.created_at, items }, error: null });
      }
      if (name === 'mm_admin_get_order_details') {
        if (window.role !== 'admin') return Promise.resolve({ data: null, error: { message: 'Owner/Admin access required' } });
        const row = window.__db.orders.find((o) => o.ticket_id === String(args.p_ticket_id || '').trim().toUpperCase());
        if (!row) return Promise.resolve({ data: null, error: { message: 'Ticket not found. Check the ticket number and try again.' } });
        const items = window.__db.items.filter((i) => i.order_id === row.id)
          .map((i) => ({ name: i.item_name, quantity: i.quantity, unit_price: i.price, line_total: i.price * i.quantity, notes: i.notes, spice_level: i.spice_level }));
        return Promise.resolve({ data: {
          ticket_id: row.ticket_id, order_number: row.order_number, table: '05', status: row.status,
          total: row.total, paid_total: 0, balance_due: row.total, notes: row.notes,
          created_at: row.created_at, updated_at: row.updated_at,
          is_test_order: row.is_test_order, is_complimentary: false, complimentary_reason: '',
          cancel_reason: '', archived_at: row.archived_at, items, payments: []
        }, error: null });
      }
      if (name === 'mm_public_order_board') {
        return Promise.resolve({ data: window.__db.orders.filter((o) => !o.archived_at && ['NEW', 'PREPARING', 'READY'].includes(o.status)).map((o) => ({ ticket_id: o.ticket_id, table_number: '05', status: o.status })), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    functions: { invoke() { return Promise.resolve({ data: { sent: 0, failed: 0 }, error: null }); } },
    auth: new Proxy({}, { get: (_t, p) => (p === 'onAuthStateChange' ? () => ({ data: { subscription: { unsubscribe() {} } } }) : () => Promise.resolve({ data: { session: null, user: null }, error: null })) }),
    from, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {}
  };
  window.supabase = { createClient: () => fake };
}

(async () => {
  const launch = { args: ['--no-sandbox'] };
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch(launch);
  const unexpected = [];

  async function session(scenario, opts) {
    opts = opts || {};
    const context = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true });
    await context.route(/^https?:/, (r) => r.abort('failed'));
    const page = await context.newPage();
    page.on('pageerror', (e) => unexpected.push('uncaught: ' + e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/^Failed to load resource/.test(t) || /^\[Mirch Masaala/.test(t)) return;
      unexpected.push('console.error: ' + t.slice(0, 160));
    });
    await page.addInitScript(installFakeSupabase, scenario);
    await page.addInitScript(() => { ['05', '99'].forEach((n) => sessionStorage.setItem('mm_sp_' + n, '1')); });
    await page.goto(indexUrl + (opts.query === undefined ? '?table=05' : opts.query), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4300);
    if (!opts.noCart) {
      await page.evaluate(() => {
        const items = window.MENU.menu_items.slice(0, 2);
        cart = items.map((i, idx) => ({ id: i.id, name: i.name, price: i.price, qty: idx === 0 ? 2 : 1, spiceLevel: idx === 0 ? 'hot' : 'normal', notes: idx === 0 ? 'No onion please' : '' }));
        window.cart = cart; updCart(); openCart();
      });
      await page.waitForTimeout(150);
    }
    const api = {
      page, context,
      async tap() {
        const box = await page.locator('#place-order-button').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      },
      placeCalls: () => page.evaluate(() => window.__rpc.filter((c) => c.name === 'mm_place_order')),
      dbOrders: () => page.evaluate(() => window.__db.orders.map((o) => ({ ticket_id: o.ticket_id, status: o.status, approval_status: o.approval_status, total: o.total, visit: o.table_visit_id, session: o.customer_session_id }))),
      updates: () => page.evaluate(() => window.__updates.slice()),
      toast: () => page.evaluate(() => { const t = document.getElementById('toast'); return t && t.classList.contains('on') ? t.textContent.trim() : ''; }),
      async asRole(role) {
        await page.evaluate((r) => { role = r; window.role = r; }, role);
      },
      close: () => context.close()
    };
    return api;
  }

  // 1. Full happy path: customer QR order -> kitchen NEW -> PREPARING -> READY -> waiter SERVED -> owner view.
  let s = await session({ status: 'open', place: 'success' });
  await s.tap(); await s.page.waitForTimeout(800);
  let calls = await s.placeCalls();
  check(calls.length === 1, 'customer tap sends exactly one mm_place_order', 'sent ' + calls.length);
  const a = (calls[0] && calls[0].args) || {};
  check(a.p_table_number === '05' && a.p_table_visit_id === VISIT && UUID_V4.test(String(a.p_customer_session_id)) && a.p_guest_order_code === null,
    'order carries table, open visit, a customer session and no manual six-digit code', JSON.stringify(a));
  check(Array.isArray(a.p_items) && a.p_items.length === 2 && a.p_items[0].spice_level === 'hot' && a.p_items[0].notes === 'No onion please',
    'per-dish spice level and special instructions are sent to the server', JSON.stringify(a.p_items));
  let db = await s.dbOrders();
  check(db.length === 1 && db[0].status === 'NEW' && db[0].approval_status === 'APPROVED' && db[0].total === 1000,
    'database confirms one NEW, auto-approved ticket with the server-priced total (2x300 + 400)', JSON.stringify(db));
  check(db[0].visit === VISIT && UUID_V4.test(String(db[0].session)), 'the stored ticket is bound to the open visit and customer session', JSON.stringify(db[0]));
  let ui = await s.page.evaluate(() => ({
    success: document.getElementById('success').classList.contains('on'),
    ticket: document.getElementById('sid').textContent,
    confirmed: /confirmed/i.test(document.getElementById('success-progress-host').textContent),
    savedCart: localStorage.getItem('mm_c_05'),
    tokenSaved: (JSON.parse(localStorage.getItem('mm_live_order_tokens') || '[]')).length === 1
  }));
  check(ui.success && ui.ticket === db[0].ticket_id, 'customer sees the success screen with the confirmed ticket number', JSON.stringify(ui));
  check(ui.confirmed, 'success message says the order is confirmed and sent to the kitchen');
  check(ui.savedCart === '[]' && ui.tokenSaved, 'cart is cleared and the public tracking token is saved after confirmation');

  await s.asRole('kitchen');
  await s.page.evaluate(() => window.MM_REFRESH_STAFF_ORDERS());
  await s.page.waitForTimeout(400);
  await s.page.evaluate(() => { go('kitchen'); drawK(); });
  let k = await s.page.evaluate(() => ({
    newHasTicket: document.getElementById('k-new').textContent.includes(window.__db.orders[0].order_number + '') || document.getElementById('k-new').textContent.includes(window.__db.orders[0].ticket_id),
    newCards: document.querySelectorAll('#k-new .kcard').length,
    showsDish: /Probe Paneer/.test(document.getElementById('k-new').textContent),
    showsSpice: /No onion please/.test(document.getElementById('k-new').textContent),
    queueTitle: (document.querySelector('.k-queue-title') || {}).textContent || ''
  }));
  check(k.newCards === 1 && k.newHasTicket, 'the customer order appears in the kitchen NEW column', JSON.stringify(k));
  check(k.showsDish && k.showsSpice, 'kitchen ticket shows the dish and the special instruction');
  check(/1 active/.test(k.queueTitle), 'kitchen live queue counts the new ticket', k.queueTitle);

  await s.page.evaluate(() => { const b = document.querySelector('#k-new .kitchen-status-btn'); b.click(); });
  await s.page.waitForTimeout(500);
  db = await s.dbOrders();
  let ups = await s.updates();
  check(db[0].status === 'PREPARING' && ups.length === 1 && ups[0].status === 'PREPARING', 'START COOKING updates the database row to PREPARING', JSON.stringify({ db, ups }));
  k = await s.page.evaluate(() => ({ prep: document.querySelectorAll('#k-prep .kcard').length, fresh: document.querySelectorAll('#k-new .kcard').length }));
  check(k.prep === 1 && k.fresh === 0, 'the ticket moves from NEW to the COOKING column');

  await s.page.evaluate(() => { const b = document.querySelector('#k-prep .kitchen-status-btn'); b.click(); });
  await s.page.waitForTimeout(500);
  db = await s.dbOrders();
  check(db[0].status === 'READY', 'MARK READY updates the database row to READY', JSON.stringify(db));
  k = await s.page.evaluate(() => ({ ready: document.querySelectorAll('#k-ready .kcard').length, prep: document.querySelectorAll('#k-prep .kcard').length }));
  check(k.ready === 1 && k.prep === 0, 'the ticket moves into the READY column');

  await s.asRole('waiter');
  await s.page.evaluate(() => window.setStatus(window.__db.orders[0].ticket_id, 'SERVED'));
  await s.page.waitForTimeout(500);
  db = await s.dbOrders();
  check(db[0].status === 'SERVED', 'waiter marks the ready order SERVED in the database', JSON.stringify(db));

  await s.asRole('admin');
  await s.page.evaluate(() => window.MM_REFRESH_STAFF_ORDERS());
  await s.page.waitForTimeout(400);
  await s.page.evaluate(() => { go('admin'); drawAdminOrders(); });
  const admin = await s.page.evaluate(() => ({
    servedStat: /<b>1<\/b>Served/.test(document.getElementById('a-orders').innerHTML),
    text: document.getElementById('a-orders').textContent.slice(0, 120)
  }));
  check(admin.servedStat, 'owner dashboard stats receive the served state from the shared database', admin.text);
  await s.page.evaluate(() => {
    document.getElementById('admin-ticket-lookup').value = window.__db.orders[0].ticket_id;
    return lookupAdminTicket();
  });
  await s.page.waitForTimeout(400);
  const lookup = await s.page.evaluate(() => document.getElementById('admin-ticket-lookup-result').textContent);
  check(lookup.includes(db[0].ticket_id) && /SERVED/i.test(lookup) && /Probe Paneer/.test(lookup),
    'owner ticket lookup returns the exact history (status, dishes) from the database', lookup.slice(0, 160));
  await s.asRole('waiter');
  const waiterLookup = await s.page.evaluate(async () => {
    try { await window.MM_ADMIN_GET_ORDER_DETAILS(window.__db.orders[0].ticket_id); return 'accepted'; }
    catch (e) { return e.message; }
  });
  check(/Owner\/Admin access required/.test(waiterLookup), 'owner ticket lookup stays admin-only', waiterLookup);
  await s.close();

  // 2. Customer order history stays consistent with the kitchen's status changes.
  s = await session({ status: 'open', place: 'success' });
  await s.tap(); await s.page.waitForTimeout(700);
  await s.page.evaluate(() => { window.__db.orders[0].status = 'READY'; });
  await s.page.evaluate(() => window.MM_REFRESH_CUSTOMER_ORDERS());
  await s.page.waitForTimeout(500);
  const hist = await s.page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('mm_o') || '[]');
    return { status: saved[0] && saved[0].status, spice: saved[0] && saved[0].items && saved[0].items[0] && saved[0].items[0].spiceLevel, count: saved.length };
  });
  check(hist.count === 1 && hist.status === 'READY', 'customer saved order refreshes to the kitchen status via the token-verified lookup', JSON.stringify(hist));
  check(hist.spice === 'hot', 'saved customer ticket keeps the chosen spice level');
  await s.close();

  // 3. Waiter-created orders reach the same kitchen queue.
  s = await session({ status: 'open', place: 'success' }, { noCart: true });
  await s.asRole('waiter');
  await s.page.evaluate(() => {
    go('waiter');
    wTable = '05'; window.wTable = '05';
    const items = window.MENU.menu_items.slice(0, 1);
    wCart = items.map((i) => ({ id: i.id, name: i.name, price: i.price, qty: 1 }));
    window.wCart = wCart;
    window.MM_WAITER_CONFIRMATION_APPROVED = true;
    window.wSend();
  });
  await s.page.waitForTimeout(800);
  db = await s.dbOrders();
  calls = await s.placeCalls();
  check(calls.length === 1 && calls[0].args.p_customer_session_id === null,
    'waiter order is submitted through the same RPC without a customer session', JSON.stringify(calls.map((c) => c.args && { session: c.args.p_customer_session_id, notes: c.args.p_notes })));
  check(db.length === 1 && db[0].status === 'NEW' && db[0].approval_status === 'APPROVED', 'waiter order is confirmed NEW and auto-approved in the database', JSON.stringify(db));
  await s.asRole('kitchen');
  await s.page.evaluate(() => window.MM_REFRESH_STAFF_ORDERS());
  await s.page.waitForTimeout(400);
  await s.page.evaluate(() => { go('kitchen'); drawK(); });
  k = await s.page.evaluate(() => ({ newCards: document.querySelectorAll('#k-new .kcard').length, text: document.getElementById('k-new').textContent }));
  check(k.newCards === 1 && /Probe Paneer/.test(k.text), 'the waiter order appears in the kitchen NEW column', JSON.stringify(k));
  await s.close();

  // 4. Network failure while placing: visible error, no fake local ticket, cart kept, retry works.
  s = await session({ status: 'open', place: 'network' });
  await s.tap(); await s.page.waitForTimeout(800);
  db = await s.dbOrders();
  const failState = await s.page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('mm_o') || '[]').length,
    cartLeft: (window.cart || []).length,
    success: document.getElementById('success').classList.contains('on'),
    button: (() => { const b = document.getElementById('place-order-button'); return { disabled: b.disabled, text: b.textContent.trim() }; })()
  }));
  check(db.length === 0 && failState.saved === 0, 'a failed submission creates no database row and no fake local ticket', JSON.stringify({ db, failState }));
  check(/connection|network|try again|waiter|send/i.test(await s.toast()), 'the network failure shows a visible message', 'toast="' + await s.toast() + '"');
  check(!failState.success && failState.cartLeft === 2 && !failState.button.disabled && /Place order/i.test(failState.button.text),
    'after a network failure the cart is kept, no success is shown and the button is usable again', JSON.stringify(failState));
  await s.page.evaluate(() => { window.__sc.place = 'success'; });
  await s.tap(); await s.page.waitForTimeout(800);
  db = await s.dbOrders();
  check(db.length === 1 && (await s.placeCalls()).length === 2, 'retrying after the network recovers creates exactly one order', JSON.stringify(db));
  await s.close();

  // 5. Staff sync failure is reported accurately and never invents tickets.
  s = await session({ status: 'open', place: 'success', staffFail: true }, { noCart: true });
  await s.asRole('kitchen');
  await s.page.evaluate(() => window.MM_REFRESH_STAFF_ORDERS());
  await s.page.waitForTimeout(500);
  const syncFail = await s.page.evaluate(() => ({
    orders: (window.orders || []).length,
    saved: JSON.parse(localStorage.getItem('mm_o') || '[]').length
  }));
  check(/sync failed|permissions/i.test(await s.toast()), 'a failed staff order sync shows an accurate error message', 'toast="' + await s.toast() + '"');
  check(syncFail.orders === 0 && syncFail.saved === 0, 'a failed sync does not invent local kitchen tickets', JSON.stringify(syncFail));
  await s.page.evaluate(() => { window.__sc.staffFail = false; });
  await s.page.evaluate(() => window.MM_REFRESH_STAFF_ORDERS());
  await s.page.waitForTimeout(400);
  check((await s.page.evaluate(() => window.MM_ORDER_APPROVAL_SCHEMA_READY)) === true, 'staff sync recovers cleanly once the connection returns');
  await s.close();

  // 6. Unseated table: the kitchen receives nothing until the waiter opens the visit.
  s = await session({ status: 'available', place: 'success' });
  await s.tap(); await s.page.waitForTimeout(600);
  db = await s.dbOrders();
  check(db.length === 0 && (await s.placeCalls()).length === 0, 'an unseated table never submits an order to the database', JSON.stringify(db));
  check(/waiter/i.test(await s.toast()), 'the customer is told to wait for the waiter', 'toast="' + await s.toast() + '"');
  await s.page.evaluate(() => { window.__sc.status = 'open'; });
  await s.page.waitForFunction(() => { const b = document.getElementById('place-order-button'); return !b.disabled && b.getAttribute('aria-disabled') !== 'true'; }, null, { timeout: 7500 }).catch(() => {});
  await s.tap(); await s.page.waitForTimeout(800);
  db = await s.dbOrders();
  check(db.length === 1, 'after the waiter seats the table, the next tap creates one kitchen order', JSON.stringify(db));
  await s.close();

  // 7. Rapid double taps while the server is slow still produce a single kitchen ticket.
  s = await session({ status: 'open', place: 'success', placeDelay: 700 });
  await s.tap(); await s.tap(); await s.tap();
  await s.page.waitForTimeout(1500);
  db = await s.dbOrders();
  check((await s.placeCalls()).length === 1 && db.length === 1, 'three rapid taps create exactly one database ticket', JSON.stringify(db));
  await s.close();

  // 8. Archived/test tickets never appear in the live kitchen queue.
  s = await session({ status: 'open', place: 'success' });
  await s.tap(); await s.page.waitForTimeout(700);
  await s.page.evaluate(() => {
    const first = window.__db.orders[0];
    window.__db.orders.push(Object.assign({}, first, {
      id: 'db-order-arch', ticket_id: 'MM-ARCHIVED-TEST-001', order_number: 900,
      is_test_order: true, archived_at: new Date().toISOString()
    }));
  });
  await s.asRole('kitchen');
  await s.page.evaluate(() => window.MM_REFRESH_STAFF_ORDERS());
  await s.page.waitForTimeout(400);
  await s.page.evaluate(() => { go('kitchen'); drawK(); });
  k = await s.page.evaluate(() => ({ cards: document.querySelectorAll('.kcard').length, text: document.getElementById('k-new').textContent }));
  check(k.cards === 1 && !/900/.test(k.text), 'archived test tickets are excluded from the live kitchen queue', JSON.stringify(k));
  await s.close();

  check(unexpected.length === 0, 'no uncaught script errors during any scenario', unexpected.join(' | ').slice(0, 400));
  await browser.close();
  console.log(failures ? '\n' + failures + ' of ' + total + ' order/kitchen check(s) failed.' : '\nOrder-to-kitchen path test passed (' + total + ' checks).');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('Order-to-kitchen path test crashed:', e.message); process.exit(1); });