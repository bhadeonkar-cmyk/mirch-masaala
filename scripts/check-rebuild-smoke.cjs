/* Mirch Masaala clean rebuild — browser smoke test against an in-process FAKE Supabase.
 *
 * Runs the real app files in headless Chromium (mobile viewport) with the real supabase-js,
 * while every network call to *.supabase.co is answered by a stateful fake that mirrors the
 * production RPC / table contracts in /supabase. This proves the front-end wiring end to end.
 * It does NOT prove the live database; that needs a run against the real project.
 *
 *   node scripts/check-rebuild-smoke.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SB_HOST = 'adbhxldsqwsyaqzdmxnf.supabase.co';
const RID = 'a3702d10-6673-4c06-9783-1d61c945ecd5';

/* ------------------------------------------------------------------ fake backend */
function makeBackend() {
  let seq = 0;
  const id = (p) => p + '-' + String(++seq).padStart(4, '0');
  const db = {
    failPlaceOrder: false,
    categories: [
      { id: 'c1', name: 'Starters', sort_order: 1, is_active: true },
      { id: 'c2', name: 'Drinks', sort_order: 2, is_active: true }
    ],
    menu: [
      { id: 'm1', category_id: 'c1', name: 'Paneer Tikka', description: 'Char-grilled', price: 180, is_available: true, sort_order: 1, is_veg: true },
      { id: 'm2', category_id: 'c1', name: 'Chicken 65', description: 'Spicy', price: 220, is_available: true, sort_order: 2, is_veg: false },
      { id: 'm3', category_id: 'c2', name: 'Masala Tea', description: '', price: 30, is_available: true, sort_order: 3, is_veg: true },
      { id: 'm4', category_id: 'c2', name: 'Cold Coffee', description: '', price: 90, is_available: false, sort_order: 4, is_veg: true }
    ],
    tables: [{ id: 't1', table_number: '01', is_active: true }, { id: 't2', table_number: '02', is_active: true }, { id: 't3', table_number: '03', is_active: true }],
    visits: [], orders: [], items: [], notifications: [], bookings: [],
    config: { restaurant_id: RID, restaurant_name: 'MIRCH MASAALA', upi_id: 'mirch@upi', upi_name: 'Mirch Masaala', whatsapp_number: '919657076450', google_reviews_url: '', pay_note: '', accept_cash: true, accept_card: true },
    users: { waiter1: 'waiter', kitchen1: 'kitchen', owner1: 'admin' },
    log: []
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (sub) => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 7200 }) + '.sig';
  const roleOf = (auth) => {
    try { const t = String(auth || '').replace(/^Bearer /, ''); const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); return db.users[p.sub] || null; } catch (e) { return null; }
  };
  const tableNo = (tid) => (db.tables.find((t) => t.id === tid) || {}).table_number;
  const openVisit = (num) => db.visits.find((v) => v.table_number === num && v.status === 'OPEN');
  const err = (message, code) => ({ __err: { code: code || 'P0001', message, details: null, hint: null } });
  const unpaid = (visitId) => db.orders.filter((o) => o.table_visit_id === visitId && !['PAID', 'CANCELLED'].includes(o.status)).reduce((s, o) => s + o.total, 0);
  const note = (type, num, message) => db.notifications.unshift({ id: seq++, notification_type: type, table_number: num, message, created_at: new Date().toISOString() });

  const rpc = {
    mm_public_table_visit_status: (a) => {
      const num = String(a.p_table_number).padStart(2, '0');
      if (!db.tables.find((t) => t.table_number === num)) return { table_number: num, status: 'UNKNOWN', can_order: false };
      const v = openVisit(num);
      return v ? { table_number: num, status: 'OPEN', can_order: true, visit_id: v.id } : { table_number: num, status: 'AVAILABLE', can_order: false, visit_id: null };
    },
    get_my_staff_role: (a, role) => role,
    mm_list_waiters: (a, role) => (role ? [{ waiter_code: 'W01', display_name: 'Waiter 01', active: true }] : err('Owner or waiter sign-in required')),
    mm_staff_get_table_visits: (a, role) => {
      if (!['admin', 'waiter'].includes(role)) return err('Owner/Admin or signed-in waiter access required');
      return db.tables.map((t) => { const v = openVisit(t.table_number); return { table_number: t.table_number, status: v ? 'OPEN' : 'AVAILABLE', started_at: v && v.started_at, visit_id: v && v.id, assigned_waiter_code: (v && v.assigned_waiter_code) || '', guest_order_code: '' }; });
    },
    mm_staff_set_table_visit_status: (a, role) => {
      if (!['admin', 'waiter'].includes(role)) return err('Owner/Admin or signed-in waiter access required');
      const num = String(a.p_table_number).padStart(2, '0');
      if (a.p_action === 'START') {
        if (!/^[A-Z0-9][A-Z0-9_-]{1,11}$/.test(a.p_waiter_code || '')) return err('Enter your waiter ID');
        const ex = openVisit(num);
        if (ex) return { table_number: num, status: 'OPEN', visit_id: ex.id, already_open: true };
        const v = { id: id('visit'), table_number: num, status: 'OPEN', started_at: new Date().toISOString(), assigned_waiter_code: a.p_waiter_code };
        db.visits.push(v); db.log.push('visit-started:' + num);
        return { table_number: num, status: 'OPEN', visit_id: v.id, already_open: false };
      }
      return err('not implemented in fake');
    },
    mm_staff_release_abandoned_visit: (a, role) => {
      if (!['admin', 'waiter'].includes(role)) return err('forbidden');
      const v = openVisit(String(a.p_table_number).padStart(2, '0'));
      if (!v) return err('no active visit'); v.status = 'CLOSED'; return { ok: true };
    },
    mm_place_order: (a, role) => {
      if (db.failPlaceOrder) return err('Simulated outage', 'XX000');
      const num = String(a.p_table_number);
      const v = openVisit(num);
      if (!v) return err('This table is not open for online orders yet. Please ask your waiter to start the visit.');
      if (a.p_table_visit_id !== v.id) return err('The table visit has changed. Refresh and ask your waiter for the current order code.');
      if (!role && !a.p_customer_session_id) return err('Customer session is missing.');
      if (!Array.isArray(a.p_items) || !a.p_items.length) return err('Add between 1 and 100 order lines');
      let total = 0; const lines = [];
      for (const l of a.p_items) {
        const m = db.menu.find((x) => x.id === l.menu_item_id && x.is_available);
        if (!m) return err('A selected dish is unavailable. Refresh the menu and try again.');
        if (!['normal', 'mild', 'medium', 'hot'].includes(l.spice_level)) return err('Choose a valid spice level for each dish');
        total += m.price * l.quantity; lines.push({ m, l });
      }
      if (db.orders.some((o) => o.ticket_id === a.p_ticket_id)) return err('duplicate key value violates unique constraint', '23505');
      const o = { id: id('order'), ticket_id: a.p_ticket_id, table_id: db.tables.find((t) => t.table_number === num).id, table_visit_id: v.id, status: 'NEW', approval_status: 'APPROVED', notes: a.p_notes, total, created_at: new Date().toISOString(), order_number: 1000 + db.orders.length + 1, archived_at: null, public_token: id('tok') };
      db.orders.push(o);
      lines.forEach(({ m, l }) => db.items.push({ order_id: o.id, item_name: m.name, quantity: l.quantity, price: m.price, spice_level: l.spice_level }));
      db.log.push('order:' + o.ticket_id + ':' + (role || 'guest') + ':args=' + JSON.stringify({ guest_code: a.p_guest_order_code, session: !!a.p_customer_session_id }));
      return { id: o.ticket_id, dbId: o.id, publicToken: o.public_token, table: num, visitId: v.id, total, status: 'NEW', orderNumber: o.order_number, items: lines.map(({ m, l }) => ({ name: m.name, price: m.price, qty: l.quantity })) };
    },
    mm_get_public_order: (a) => {
      const o = db.orders.find((x) => x.ticket_id === a.p_ticket_id && x.public_token === a.p_public_token);
      if (!o) return null;
      return { id: o.ticket_id, table: tableNo(o.table_id), total: o.total, status: o.status, items: db.items.filter((i) => i.order_id === o.id).map((i) => ({ name: i.item_name, price: i.price, qty: i.quantity })) };
    },
    mm_guest_get_visit_bill: (a) => ({ amount: unpaid(a.p_visit_id) }),
    mm_guest_cash_counter_release: (a) => { const v = openVisit(String(a.p_table_number)); note('CASH_AT_COUNTER', a.p_table_number, 'Guest will pay cash at the counter'); db.log.push('cash-request'); return { amount: unpaid(v.id) }; },
    mm_guest_request_visit_payment_check: (a) => { note('PAYMENT_CHECK', a.p_table_number, 'Guest says UPI paid'); db.log.push('upi-request'); return { ok: true }; },
    mm_staff_notifications: (a, role) => (role === 'admin' ? db.notifications : err('forbidden')),
    mm_staff_get_visit_bill: (a, role) => (role === 'admin' ? { amount: unpaid(a.p_visit_id) } : err('forbidden')),
    mm_staff_record_visit_payment: (a, role) => {
      if (role !== 'admin') return err('forbidden');
      db.orders.filter((o) => o.table_visit_id === a.p_visit_id).forEach((o) => { if (o.status !== 'CANCELLED') o.status = 'PAID'; });
      note('PAYMENT_RECEIVED', db.visits.find((v) => v.id === a.p_visit_id).table_number, 'Payment received'); db.log.push('paid:' + a.p_method);
      return { ok: true };
    },
    mm_submit_party_booking: (a) => {
      if (!a.p_name || !/^[0-9+]{10,15}$/.test(a.p_phone)) return err('Enter a valid name and phone number.');
      db.bookings.unshift({ id: id('bk'), booking_ref: 'PARTY-0000' + (db.bookings.length + 1), customer_name: a.p_name, customer_phone: a.p_phone, event_type: a.p_event_type, event_date: a.p_event_date, event_time: a.p_event_time, guest_count: a.p_guest_count, customer_notes: a.p_notes, status: 'NEW', owner_notes: '' });
      return { ok: true };
    },
    mm_admin_list_party_bookings: (a, role) => (role === 'admin' ? db.bookings : err('Owner/Admin access required.')),
    mm_admin_update_party_booking: (a, role) => { const b = db.bookings.find((x) => x.id === a.p_booking_id); if (role !== 'admin' || !b) return err('forbidden'); b.status = a.p_status; return { ok: true }; }
  };

  const qparam = (url, k) => url.searchParams.get(k);
  const inList = (v) => String(v || '').replace(/^in\.\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));

  /* Returns {status, body}. */
  function handle(method, url, headers, bodyText) {
    const role = roleOf(headers['authorization']);
    const p = url.pathname;
    let body = {}; try { body = bodyText ? JSON.parse(bodyText) : {}; } catch (e) { /* ignore */ }
    const wantObject = /pgrst\.object/.test(headers['accept'] || '');
    const pick = (rows) => (wantObject ? (rows[0] === undefined ? { status: 406, body: { code: 'PGRST116', message: 'no rows' } } : { status: 200, body: rows[0] }) : { status: 200, body: rows });

    if (p === '/auth/v1/token') {
      const email = String(body.email || ''); const user = email.split('@')[0];
      if (!db.users[user] || body.password !== 'pw') return { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials' } };
      return { status: 200, body: { access_token: jwt(user), token_type: 'bearer', expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, refresh_token: 'r-' + user, user: { id: user, aud: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } } };
    }
    if (p === '/auth/v1/logout') return { status: 204, body: null };
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.split('/').pop();
      if (!rpc[fn]) return { status: 404, body: { code: 'PGRST202', message: 'Could not find the function ' + fn } };
      const r = rpc[fn](body, role);
      if (r && r.__err) return { status: 400, body: r.__err };
      return { status: 200, body: r };
    }
    if (p.startsWith('/rest/v1/')) {
      const tbl = p.split('/').pop();
      if (tbl === 'categories') return pick(db.categories);
      if (tbl === 'restaurant_tables') return pick(db.tables);
      if (tbl === 'mm_restaurant_config') {
        if (method === 'POST') { if (role !== 'admin') return { status: 403, body: { code: '42501', message: 'rls' } }; Object.assign(db.config, body); db.log.push('config-saved'); return { status: 201, body: null }; }
        return pick([db.config]);
      }
      if (tbl === 'menu_items') {
        if (method === 'PATCH') {
          if (!['admin', 'kitchen'].includes(role)) return { status: 403, body: { code: '42501', message: 'rls' } };
          const m = db.menu.find((x) => x.id === String(qparam(url, 'id')).replace('eq.', '')); if (!m) return pick([]);
          Object.assign(m, body); return pick([m]);
        }
        return pick(db.menu);
      }
      if (tbl === 'orders') {
        if (!role) return { status: 200, body: [] };            /* RLS: guests see nothing */
        if (method === 'PATCH') {
          const o = db.orders.find((x) => x.ticket_id === String(qparam(url, 'ticket_id')).replace('eq.', '')); if (!o) return pick([]);
          Object.assign(o, body); db.log.push('status:' + o.ticket_id + ':' + o.status + ':' + role); return pick([o]);
        }
        let rows = db.orders.slice();
        if (qparam(url, 'status')) { const s = inList(qparam(url, 'status')); rows = rows.filter((o) => s.includes(o.status)); }
        if (qparam(url, 'archived_at')) rows = rows.filter((o) => !o.archived_at);
        return pick(rows.sort((a, c) => c.created_at.localeCompare(a.created_at)));
      }
      if (tbl === 'order_items') {
        if (!role) return { status: 200, body: [] };
        const ids = inList(qparam(url, 'order_id')); return pick(db.items.filter((i) => ids.includes(i.order_id)));
      }
    }
    return { status: 404, body: { message: 'fake backend: unhandled ' + method + ' ' + p } };
  }
  return { db, handle };
}

/* ------------------------------------------------------------------ static server */
function serveStatic() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* ------------------------------------------------------------------ harness */
let pass = 0; const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); } else { fails.push(name); console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

(async () => {
  const srv = await serveStatic();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const be = makeBackend(); const db = be.db;
  const browser = await chromium.launch();
  const pageErrors = [];

  async function phone() {
    const ctx = await browser.newContext({ ...devices['Pixel 5'], serviceWorkers: 'block' });
    await ctx.route('https://' + SB_HOST + '/**', async (route) => {
      const req = route.request(); const url = new URL(req.url());
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const r = be.handle(req.method(), url, req.headers(), req.postData());
      await route.fulfill({ status: r.status, headers: { ...cors, 'content-type': 'application/json' }, body: r.body === null ? '' : JSON.stringify(r.body) });
    });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|adbhxldsqwsyaqzdmxnf)/, (route) => route.abort());   /* any other network call = test failure signal */
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e && e.message)));
    if (process.env.MM_DEBUG) page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('    [console.' + m.type() + ']', m.text().slice(0, 300)); });
    if (process.env.MM_DEBUG) page.on('request', (r) => { if (/orders/.test(r.url()) && r.method() === 'PATCH') console.log('    [PATCH]', r.url().slice(-80), JSON.stringify(r.headers()['accept']), r.postData()); });
    page.on('dialog', (d) => d.accept());
    return { ctx, page };
  }
  const txt = async (page, sel) => (await page.locator(sel).first().innerText().catch(() => '')).trim();
  const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
  const login = async (page, role, user) => {
    await page.click('#btn-staff');
    await page.click('#role-tabs [data-role="' + role + '"]');
    await page.fill('#login-form [name=username]', user);
    await page.fill('#login-form [name=password]', 'pw');
    await page.click('#btn-login');
  };

  try {
    console.log('\n== Boot / assets');
    const C = await phone(); const c = C.page;
    await c.goto(base + '?table=01'); await c.waitForSelector('#menu-list .item');
    check('app boots with real supabase-js (no CDN)', await c.evaluate(() => !!(window.MM && MM.api && MM.api.ready())));
    check('no fatal screen on normal boot', !(await visible(c, '#fatal')));
    check('menu loaded from backend (4 items, none hard-coded)', (await c.locator('#menu-list .item').count()) === 4);
    check('sold-out item is not orderable', (await c.locator('#menu-list .item.off').count()) === 1 && /Sold out/.test(await txt(c, '#menu-list .item.off')));
    check('categories render (All + 2)', (await c.locator('#categories .cat').count()) === 3);
    await c.fill('#search-food', 'paneer');
    check('search filters menu', (await c.locator('#menu-list .item').count()) === 1);
    await c.fill('#search-food', 'zzzz');
    check('search empty state message', /No items found/.test(await txt(c, '#menu-list')));
    await c.fill('#search-food', '');
    await c.locator('#categories .cat').nth(2).click();
    check('category filter works', (await c.locator('#menu-list .item').count()) === 2);
    await c.locator('#categories .cat').nth(0).click();

    console.log('\n== QR table identity');
    check('?table=01 resolved, gate says wait (no open visit)', /Table 01/.test(await txt(c, '#home-status')) && /wait for the waiter/i.test(await txt(c, '#gate-msg')));
    const c2 = (await phone()); await c2.page.goto(base + '?table=999'); await c2.page.waitForSelector('#gate:not([hidden])');
    check('?table=999 -> friendly "could not find this table"', /could not find this table/i.test(await txt(c2.page, '#gate-msg')));
    await c2.page.goto(base + '?table=abc'); await c2.page.waitForSelector('#gate:not([hidden])');
    check('?table=abc -> friendly error, no crash', /could not find this table/i.test(await txt(c2.page, '#gate-msg')) && !(await visible(c2.page, '#fatal')));
    await c2.page.goto(base); await c2.page.waitForSelector('#gate:not([hidden])');
    check('no ?table -> "scan the QR" (no table picker exists)', /Scan the QR/i.test(await txt(c2.page, '#gate-msg')) && (await c2.page.locator('select#table, #table-picker').count()) === 0);
    await c2.ctx.close();

    console.log('\n== Customer cannot order before waiter opens the table');
    await c.locator('#menu-list .item .plus').first().click();
    await c.click('#btn-open-cart'); await c.waitForSelector('#screen-cart.on');
    check('Place order disabled + explanation when table not open', (await c.locator('#btn-place-order').isDisabled()) && /wait for the waiter/i.test(await txt(c, '#order-error')));
    await c.click('#btn-cart-back');

    console.log('\n== Waiter');
    const W = await phone(); const w = W.page;
    await w.goto(base); await w.waitForSelector('#menu-list .item');
    await login(w, 'waiter', 'waiter1'); await w.waitForSelector('#screen-waiter.on');
    await w.waitForSelector('#waiter-tables button');
    check('waiter lands on tables grid (3 tables, Available)', (await w.locator('#waiter-tables button').count()) === 3 && /Available/.test(await txt(w, '#waiter-tables button')));
    await w.locator('#waiter-tables button').first().click(); await w.waitForSelector('#w-code');
    await w.selectOption('#w-code', 'W01'); await w.getByRole('button', { name: 'Start visit' }).click();
    await w.waitForSelector('#w-menu .item');
    check('visit started once; waiter sees menu', db.visits.length === 1 && db.visits[0].assigned_waiter_code === 'W01');
    await w.getByRole('button', { name: 'Change table' }).click();
    await w.locator('#waiter-tables button').first().click(); await w.waitForSelector('#w-menu .item');
    check('re-selecting an OPEN table continues it (NO duplicate visit)', db.visits.length === 1 && (await w.locator('#w-code').count()) === 0);
    await w.fill('#w-search', 'chicken'); check('waiter search filters', (await w.locator('#w-menu .item').count()) === 1);
    await w.fill('#w-search', '');
    await w.locator('#w-menu .item', { hasText: 'Paneer Tikka' }).locator('.plus').click();
    await w.locator('#w-menu .item', { hasText: 'Paneer Tikka' }).locator('.plus').click();
    await w.locator('#w-menu .item', { hasText: 'Masala Tea' }).locator('.plus').click();
    check('waiter order review shows lines and total ₹390', /₹390/.test(await txt(w, '#w-order')) && /Paneer Tikka × 2/.test(await txt(w, '#w-order')));
    await w.getByRole('button', { name: 'Send to kitchen' }).click();
    await w.waitForSelector('#waiter-visit .line .chip');
    check('waiter order reached backend as NEW via mm_place_order', db.orders.length === 1 && db.orders[0].status === 'NEW' && db.orders[0].total === 390);
    check('waiter order passes guest_code=null, no customer session (staff path)', /guest_code":null,"session":false/.test(db.log.find((l) => l.startsWith('order:')) || ''));

    console.log('\n== Customer ordering (same table, own phone)');
    await c.click('#btn-gate-retry'); await c.waitForFunction(() => document.getElementById('gate').hidden);
    await c.locator('#menu-list .item', { hasText: 'Masala Tea' }).locator('.plus').click();
    await c.click('#btn-open-cart'); await c.waitForSelector('#screen-cart.on');
    await c.locator('#cart-items select').first().selectOption('hot');
    check('cart total = Paneer 180 + Tea 30 = ₹210', (await txt(c, '#cart-page-total')) === '210', await txt(c, '#cart-page-total'));
    await c.locator('#cart-items .line').nth(1).locator('.plus').click();
    check('cart: increase quantity (Tea ×2 -> ₹240)', (await txt(c, '#cart-page-total')) === '240', await txt(c, '#cart-page-total'));
    await c.locator('#cart-items .line').nth(1).locator('.qty button').first().click();
    check('cart: decrease quantity (back to ₹210)', (await txt(c, '#cart-page-total')) === '210', await txt(c, '#cart-page-total'));
    await c.locator('#cart-items .line').nth(1).locator('.qty button').first().click();
    check('cart: removing last unit drops the line (1 line, ₹180)', (await c.locator('#cart-items .line').count()) === 1 && (await txt(c, '#cart-page-total')) === '180');
    await c.click('#btn-cart-back'); await c.locator('#menu-list .item', { hasText: 'Masala Tea' }).locator('.plus').click();
    await c.click('#btn-open-cart'); await c.waitForSelector('#screen-cart.on');
    check('cart survives navigating menu <-> cart (₹210)', (await txt(c, '#cart-page-total')) === '210');
    await c.reload(); await c.waitForSelector('#menu-list .item');
    check('cart persists across reload', (await txt(c, '#cart-count')).length > 0 && (await visible(c, '#cart-bar')));
    await c.click('#btn-open-cart'); await c.waitForSelector('#screen-cart.on');
    db.failPlaceOrder = true;
    await c.fill('#order-notes', 'less oil');
    await c.click('#btn-place-order');
    await c.waitForFunction(() => !document.getElementById('order-error').hidden);
    check('order failure: friendly message, retry button, NO blank/fatal', /Unable to place order|could not|try again/i.test(await txt(c, '#order-error')) && /Try again/i.test(await txt(c, '#btn-place-order')) && !(await visible(c, '#fatal')));
    check('order failure: no stack/technical text shown to customer', !/Simulated outage|XX000|Error:/.test(await txt(c, '#screen-cart')));
    db.failPlaceOrder = false;
    await c.click('#btn-place-order'); await c.waitForSelector('#screen-placed.on');
    const cust = db.orders.find((o) => o.notes === 'less oil');
    check('retry succeeds; exactly one customer order created', !!cust && db.orders.length === 2);
    check('customer order sent guest_code=null + customer_session_id (prod contract)', /guest_code":null,"session":true/.test(db.log.filter((l) => l.startsWith('order:')).pop()));
    check('confirmation: "Order placed", Order #, sent to kitchen', /Order placed/.test(await txt(c, '#screen-placed')) && /Order #\s*\d+/.test(await txt(c, '#placed-number')) && /sent to the kitchen/i.test(await txt(c, '#screen-placed')));
    await c.click('#btn-placed-view'); await c.waitForSelector('#screen-order.on');
    const od = await txt(c, '#order-detail');
    check('order detail: number, table, items, qty, total, status, payment status', /Order #/.test(od) && /Table 01/.test(od) && /Paneer Tikka/.test(od) && /× 1/.test(od) && /₹210/.test(od) && /Received/.test(od) && /Not paid yet/.test(od), od.replace(/\n/g, ' | '));
    await c.click('#btn-order-back'); await c.waitForSelector('#screen-home.on');
    check('home shows compact "Your current order" strip', (await visible(c, '#current-order')) && /Your current order/.test(await txt(c, '#current-order')));

    console.log('\n== Kitchen');
    const K = await phone(); const k = K.page;
    await k.goto(base); await login(k, 'kitchen', 'kitchen1'); await k.waitForSelector('#screen-kitchen.on'); await k.waitForSelector('.kcard');
    check('kitchen loads REAL orders in NEW (2)', (await k.locator('.kcol').first().locator('.kcard').count()) === 2);
    const kt = await txt(k, '#kitchen-board');
    check('kitchen card shows order #, table, items, quantities', /Order #/.test(kt) && /Table 01/.test(kt) && /Paneer Tikka/.test(kt) && /× 2/.test(kt));
    await k.locator('.kcard', { hasText: 'less oil' }).getByRole('button', { name: 'Start' }).click();
    await k.waitForFunction(() => /preparing \(1\)/i.test(document.getElementById('kitchen-board').innerText));
    check('Start -> backend PREPARING (not local-only)', cust.status === 'PREPARING');
    await k.locator('.kcard', { hasText: 'less oil' }).getByRole('button', { name: /Ready/ }).click();
    await k.waitForFunction(() => /ready \(1\)/i.test(document.getElementById('kitchen-board').innerText));
    check('Ready -> backend READY', cust.status === 'READY');
    await c.reload(); await c.waitForSelector('#current-order:not([hidden])');
    await c.waitForFunction(() => /Ready/i.test(document.getElementById('current-order').innerText), null, { timeout: 8000 });
    check('customer strip reflects kitchen status (Ready)', /Ready/i.test(await txt(c, '#current-order')));
    check('kitchen is NOT owner: no owner nav', (await k.locator('#screen-owner.on').count()) === 0);

    console.log('\n== Payment (customer -> counter -> owner)');
    await c.click('#btn-view-order'); await c.waitForSelector('#screen-order.on');
    await c.getByRole('button', { name: 'Pay bill' }).click(); await c.waitForSelector('#pay-choices:not([hidden])');
    check('payment screen shows amount due for the visit (₹600)', (await txt(c, '#pay-total')) === '600', await txt(c, '#pay-total'));
    await c.click('#btn-pay-cash'); await c.waitForFunction(() => /counter/i.test(document.getElementById('pay-msg').innerText));
    check('cash: request sent, order is NOT auto-paid', db.log.includes('cash-request') && cust.status === 'READY');
    const O = await phone(); const o = O.page;
    await o.goto(base); await login(o, 'admin', 'owner1'); await o.waitForSelector('#screen-owner.on'); await o.waitForSelector('#owner-panel .panel');
    const ot = await txt(o, '#owner-panel');
    check('owner Orders: number, table, waiter, items, total, status, payment status', /Order #/.test(ot) && /Table 01/.test(ot) && /W01/.test(ot) && /Paneer Tikka/.test(ot) && /₹/.test(ot) && /Not paid yet/.test(ot) && /Ready|New/i.test(ot));
    await o.click('#owner-nav [data-panel=tables]'); await o.waitForSelector('#owner-panel .table-grid');
    check('owner Tables: shows "Payment requested" for table 01', /Payment requested/i.test(await txt(o, '#owner-panel')), await txt(o, '#owner-panel'));
    await o.click('#owner-nav [data-panel=payments]'); await o.waitForSelector('#owner-panel .panel');
    check('owner Payments: request + open bill listed', /Table 01/.test(await txt(o, '#owner-panel')) && /₹600/.test(await txt(o, '#owner-panel')));
    await o.getByRole('button', { name: /Confirm cash/i }).first().click();
    await o.waitForTimeout(600);
    check('owner confirms cash -> backend orders become PAID', db.orders.every((x) => x.status === 'PAID') && db.log.includes('paid:cash'));
    await c.reload(); await c.waitForSelector('#menu-list .item'); await c.waitForTimeout(500);
    await c.click('#btn-view-order').catch(() => {});
    check('customer order detail now shows Paid', /Paid/.test(await txt(c, '#order-detail')) && !/Not paid yet/.test(await txt(c, '#order-detail')), await txt(c, '#order-detail'));
    await c.goto(base + '?table=01'); await c.waitForSelector('#menu-list .item');

    console.log('\n== Owner menu / bookings / settings');
    await o.click('#owner-nav [data-panel=menu]'); await o.waitForSelector('#om-rows .item');
    const row = o.locator('#om-rows .item', { hasText: 'Masala Tea' });
    await row.locator('input').fill('35'); await row.getByRole('button', { name: 'Save' }).click(); await o.waitForTimeout(400);
    check('owner edits price -> backend', db.menu.find((m) => m.id === 'm3').price === 35);
    await o.locator('#om-rows .item', { hasText: 'Masala Tea' }).getByRole('button', { name: 'Unavailable' }).click(); await o.waitForTimeout(400);
    check('owner toggles availability -> backend', db.menu.find((m) => m.id === 'm3').is_available === false);
    await c.goto(base + '?table=01'); await c.waitForSelector('#menu-list .item');
    check('customer sees updated availability', /Sold out/.test(await txt(c, '#menu-list .item:has-text("Masala Tea")')));

    await c.click('#btn-party'); await c.waitForSelector('#screen-party.on');
    check('party form: date label says "Choose a date", native date input', /Choose a date/.test(await txt(c, '#party-form')) && (await c.locator('#party-form input[type=date]').count()) === 1);
    await c.fill('#party-form [name=name]', 'Asha'); await c.fill('#party-form [name=phone]', '9876543210');
    await c.fill('#party-form [name=date]', '2099-01-05'); await c.fill('#party-form [name=time]', '19:30'); await c.fill('#party-form [name=guests]', '12');
    await c.fill('#party-form [name=message]', 'Need a cake table');
    await c.click('#btn-party-send'); await c.waitForSelector('#party-ok:not([hidden])');
    check('party booking submitted via mm_submit_party_booking', db.bookings.length === 1 && db.bookings[0].guest_count === 12);
    await c.click('#btn-party-back');
    await o.click('#owner-nav [data-panel=bookings]'); await o.waitForSelector('#owner-panel .panel');
    const bt = await txt(o, '#owner-panel');
    check('owner Bookings shows name, phone, and the customer\'s message', /Asha/.test(bt) && /9876543210/.test(bt) && /Need a cake table/.test(bt), bt.replace(/\n/g, ' | '));
    await o.getByRole('button', { name: /Confirmed/i }).first().click(); await o.waitForTimeout(400);
    check('owner confirms booking -> backend', db.bookings[0].status === 'CONFIRMED');
    await o.click('#owner-nav [data-panel=settings]'); await o.waitForSelector('#owner-panel form');
    await o.fill('#owner-panel [name=whatsapp_number]', '+91 98765 11111'); await o.fill('#owner-panel [name=google_reviews_url]', 'https://g.page/r/test');
    await o.getByRole('button', { name: 'Save' }).click(); await o.waitForTimeout(400);
    check('owner settings saved to Supabase (whatsapp digits only, review URL)', db.config.whatsapp_number === '919876511111' && db.config.google_reviews_url === 'https://g.page/r/test');

    console.log('\n== Owner release abandoned visit');
    await o.click('#owner-nav [data-panel=tables]'); await o.waitForSelector('#owner-panel .table-grid');
    await o.getByRole('button', { name: /Release/i }).first().click(); await o.waitForTimeout(500);
    check('owner can release an abandoned visit; order history kept', db.visits[0].status === 'CLOSED' && db.orders.length === 2);

    console.log('\n== Authentication / roles');
    const R = await phone(); const r = R.page;
    await r.goto(base); await login(r, 'admin', 'kitchen1');
    await r.waitForSelector('#login-error:not([hidden])');
    check('kitchen credentials on Owner tab -> rejected, stays on login', /Owner|Kitchen/i.test(await txt(r, '#login-error')) && (await visible(r, '#screen-login.on')) && !(await visible(r, '#screen-owner.on')));
    await r.click('#role-tabs [data-role="waiter"]'); await r.fill('#login-form [name=username]', 'waiter1'); await r.fill('#login-form [name=password]', 'pw'); await r.click('#btn-login');
    await r.waitForSelector('#screen-waiter.on');
    await r.reload(); await r.waitForSelector('#screen-waiter.on');
    check('waiter role survives refresh (and is never owner)', (await visible(r, '#screen-waiter.on')) && !(await visible(r, '#screen-owner.on')));
    await r.click('#btn-waiter-logout'); await r.waitForSelector('#screen-home.on');
    await r.reload(); await r.waitForSelector('#screen-home.on');
    check('logout persists across refresh (back on customer home)', await visible(r, '#screen-home.on'));
    await k.reload(); await k.waitForSelector('#screen-kitchen.on');
    check('kitchen role survives refresh', await visible(k, '#screen-kitchen.on'));
    await o.reload(); await o.waitForSelector('#screen-owner.on');
    check('owner role survives refresh', await visible(o, '#screen-owner.on'));
    await r.click('#btn-staff'); await r.fill('#login-form [name=username]', 'waiter1'); await r.fill('#login-form [name=password]', 'wrong'); await r.click('#btn-login');
    await r.waitForSelector('#login-error:not([hidden])');
    check('wrong password -> friendly error', /Wrong username or password/.test(await txt(r, '#login-error')));
    await R.ctx.close();

    console.log('\n== Marathi');
    await c.goto(base + '?table=01'); await c.waitForSelector('#menu-list .item');
    await c.click('#btn-lang');
    const dev = /[ऀ-ॿ]/;
    check('home nav/buttons/search placeholder translate', dev.test(await txt(c, '.home-links')) && dev.test(await c.getAttribute('#search-food', 'placeholder')));
    await c.locator('#menu-list .plus').first().click();
    await c.click('#btn-open-cart'); await c.waitForSelector('#screen-cart.on');
    check('cart screen translates (title, total, place order)', dev.test(await txt(c, '#screen-cart header')) && dev.test(await txt(c, '#btn-place-order')) && dev.test(await txt(c, '#cart-footer')));
    await c.click('#btn-cart-back'); await c.click('#btn-party'); await c.waitForSelector('#screen-party.on');
    check('party booking screen translates', dev.test(await txt(c, '#party-form')));
    await c.click('#btn-party-back');
    await k.locator('#screen-kitchen [data-action=lang]').click();
    check('kitchen board translates statuses/buttons', dev.test(await txt(k, '#kitchen-board')));
    await o.locator('#screen-owner [data-action=lang]').click();
    check('owner nav translates', dev.test(await txt(o, '#owner-nav')));
    await c.click('#btn-lang');
    check('language persists as English after toggle back', /Search/.test(await c.getAttribute('#search-food', 'placeholder')));

    console.log('\n== White-screen protection');
    await c.evaluate(() => setTimeout(() => { throw new Error('boom (test)'); }, 0));
    await c.waitForSelector('#fatal:not([hidden])');
    check('uncaught runtime error -> friendly fatal screen with Try Again', /Something went wrong/.test(await txt(c, '#fatal')) && /Try Again/.test(await txt(c, '#fatal')) && !/boom/.test(await txt(c, '#fatal')));
    const F = await phone(); await F.ctx.route('**/js/app.js*', (route) => route.abort());
    await F.page.goto(base); await F.page.waitForSelector('#fatal:not([hidden])');
    check('missing/failed app.js -> fatal screen, not blank', /Something went wrong/.test(await txt(F.page, '#fatal')));
    await F.ctx.close();
    const G = await phone(); await G.ctx.route('https://' + SB_HOST + '/**', (route) => route.abort('failed'));
    await G.page.goto(base + '?table=01'); await G.page.waitForSelector('#menu-list .empty');
    check('backend unreachable: friendly offline/menu error with retry, no fatal', /could not load the menu/i.test(await txt(G.page, '#menu-list')) && !(await visible(G.page, '#fatal')));
    await G.ctx.close();
    check('no uncaught page errors during the whole run (excluding the deliberate one)', pageErrors.filter((m) => !/boom \(test\)/.test(m)).length === 0, pageErrors.join(' | '));

    await C.ctx.close(); await W.ctx.close(); await K.ctx.close(); await O.ctx.close();
  } catch (e) {
    fails.push('HARNESS: ' + (e && e.message));
    console.log('\n  HARNESS ERROR: ' + (e && e.stack));
  }
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' failed' + (fails.length ? '\n - ' + fails.join('\n - ') : ''));
  process.exit(fails.length ? 1 : 0);
})();
