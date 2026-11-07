'use strict';
const L = require('./lib.cjs');
const { check } = L;

const calls = (be, name) => be.st.calls.filter((c) => c.name === name);
async function login(page, role, tab) {
  await page.locator('#btn-staff').click();
  if (tab) await page.locator('.role-tab[data-role="' + tab + '"]').click();
  else await page.locator('.role-tab[data-role="' + role + '"]').click();
  await page.fill('input[name=username]', role === 'admin' ? 'owner' : role);
  await page.fill('input[name=password]', 'pw');
  await page.locator('#btn-login').click();
}
const on = (page, id) => page.evaluate((x) => document.getElementById(x).classList.contains('on'), id);
const text = (page, sel) => page.locator(sel).first().innerText();

(async () => {
  const { srv, port } = await L.serve(L.ROOT);
  const browser = await L.launch();
  const be = L.makeBackend();
  const T5 = be.st.tables[4];

  // ============ CUSTOMER ============
  let c = await L.open(browser, port, be, { device: 'Pixel 7' });
  let p = c.page;
  await p.goto(c.url('?table=05'), { waitUntil: 'load' });
  await p.waitForSelector('#gate:not([hidden])');
  await p.waitForFunction(() => document.getElementById('gate-msg').textContent !== 'Checking table…');
  check(!(await p.locator('#gate').isHidden()) && /waiter|not open|ready/i.test(await text(p, '#gate-msg')), 'customer: table 05 not open -> gate blocks the menu with a message', await text(p, '#gate-msg'));
  check(await p.locator('#btn-gate-retry').isVisible(), 'customer: retry button offered while the table is not open');
  check(calls(be, 'mm_place_order').length === 0, 'customer: no order RPC fired while the table is closed');

  // waiter opens the visit (server side), customer taps retry
  const v5 = { id: require('node:crypto').randomUUID(), table_number: '05', status: 'OPEN', started_at: new Date().toISOString(), waiter: 'W01', code: '123456' };
  be.st.visits.push(v5);
  await p.locator('#btn-gate-retry').click();
  await p.waitForSelector('#menu-list [data-add]', { timeout: 8000 });
  check(await p.locator('#gate').isHidden(), 'customer: after waiter opens the visit, retry opens the menu');
  check(/05/.test(await text(p, '#menu-table-label')), 'customer: table label shows 05 (taken from QR)', await text(p, '#menu-table-label'));
  const hiddenDish = await p.locator('#menu-list').innerText();
  check(!/Hidden Dish/.test(hiddenDish) && /Paneer Tikka/.test(hiddenDish), 'customer: unavailable dish is hidden, available dishes shown');

  // no manual table selection in the customer UI
  const pickers = await p.evaluate(() => {
    const out = [];
    for (const id of ['screen-welcome', 'screen-menu', 'screen-cart', 'screen-placed', 'screen-order', 'screen-pay']) {
      const s = document.getElementById(id);
      s.querySelectorAll('select, input:not([type=hidden]):not(#search-food):not(#order-notes), textarea:not(#order-notes)').forEach((e) => out.push(id + ':' + e.tagName + '#' + (e.id || e.name)));
    }
    return out;
  });
  check(pickers.length === 0, 'customer: no table input/select anywhere in customer screens (table only comes from QR URL)', pickers.join(','));
  const tableWords = await p.evaluate(() => /choose (a )?table|select (a )?table|table number/i.test(document.body.innerText));
  check(!tableWords, 'customer: no "choose/select table" wording in the UI');

  // order
  await p.locator('[data-add]').nth(0).click();
  await p.locator('[data-add]').nth(1).click();
  await p.locator('#btn-open-cart').click();
  await p.waitForSelector('#cart-items .cart-row');
  await p.fill('#order-notes', 'less spicy');
  await p.locator('#btn-place-order').click();
  await p.waitForSelector('#screen-placed.on', { timeout: 8000 });
  const po = calls(be, 'mm_place_order')[0];
  check(!!po && po.args.p_table_number === '05' && po.args.p_table_visit_id === v5.id, 'customer: order sent with table 05 + server-issued visit id', JSON.stringify(po && po.args).slice(0, 200));
  check(po && /^[0-9a-f-]{36}$/.test(po.args.p_customer_session_id) && po.args.p_guest_order_code === null, 'customer: order carries a customer-session UUID and no guest PIN');
  check(po && po.args.p_items.length === 2 && po.args.p_items.every((i) => /^[0-9a-f-]{36}$/.test(i.menu_item_id) && i.quantity === 1), 'customer: order lines are menu ids + quantities only (prices decided by server)');
  check(be.st.orders.length === 1 && be.st.orders[0].total === 400 && be.st.orders[0].notes === 'less spicy', 'customer: server total 400 (220+180), notes kept');
  check(/101/.test(await text(p, '#placed-number')), 'customer: confirmation shows order number', await text(p, '#placed-number'));

  // order detail + pay
  await p.locator('#btn-placed-view').click();
  await p.waitForSelector('#order-detail .order-card');
  check(/Paneer Tikka/.test(await text(p, '#order-detail')) && /Veg Manchurian/.test(await text(p, '#order-detail')) && /₹400/.test(await text(p, '#order-detail')), 'customer: order detail shows items and ₹400 total from the server');
  check(/Received|New/i.test(await text(p, '#order-detail .badge')), 'customer: order status badge shows the NEW state ("Received")', await text(p, '#order-detail .badge'));
  await p.locator('#btn-pay-from-order').click();
  await p.waitForSelector('#screen-pay.on');
  await p.waitForFunction(() => document.getElementById('pay-total').textContent !== '0');
  check((await text(p, '#pay-total')) === '400', 'customer: payment screen shows balance ₹400 from mm_guest_get_visit_bill', await text(p, '#pay-total'));
  await p.locator('#btn-pay-cash').click();
  await p.waitForFunction(() => document.getElementById('pay-msg').textContent.length > 0);
  check(calls(be, 'mm_guest_cash_counter_release').length === 1 && be.st.notifs.some((n) => n.target_role === 'admin' && n.notification_type === 'CASH_AT_COUNTER'), 'customer: cash request reaches owner (and waiter) alerts');

  // table tampering via "View menu" (clears the table) -> cannot order
  await p.goto(c.url(''), { waitUntil: 'load' });
  await p.locator('#btn-view-menu').click();
  await p.waitForSelector('#menu-list [data-add]', { timeout: 8000 });
  await p.locator('[data-add]').first().click();
  const before = calls(be, 'mm_place_order').length;
  await p.locator('#btn-open-cart').click();
  await p.locator('#btn-place-order').click();
  await p.waitForTimeout(500);
  check(calls(be, 'mm_place_order').length === before, 'customer: "View menu" without a QR cannot place an order (no table)');
  await c.context.close();

  // URL tampering cases
  c = await L.open(browser, port, be, { device: 'Pixel 7' });
  p = c.page;
  await p.goto(c.url('?table=123'), { waitUntil: 'load' });
  await p.waitForTimeout(800);
  check(await on(p, 'screen-welcome'), '?table=123 is ignored (home shown) instead of silently becoming table 12', 'welcome on? ' + (await on(p, 'screen-welcome')));
  await p.goto(c.url('?table=99'), { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('gate-msg').textContent !== 'Checking table…');
  check(/could not find|not found/i.test(await text(p, '#gate-msg')) && calls(be, 'mm_place_order').length === before, '?table=99 (no such table) -> "table not found", ordering blocked', await text(p, '#gate-msg'));
  await p.goto(c.url('?table=06'), { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('gate-msg').textContent !== 'Checking table…');
  check(!(await p.locator('#gate').isHidden()), '?table=06 (not opened by waiter) -> blocked even though this phone has an open order on table 05');
  // party booking
  await p.goto(c.url(''), { waitUntil: 'load' });
  await p.locator('#btn-party').click();
  await p.fill('input[name=name]', 'Ravi'); await p.fill('input[name=phone]', '9876543210');
  await p.fill('input[name=date]', '2026-12-25'); await p.fill('input[name=time]', '19:30'); await p.fill('input[name=guests]', '12');
  await p.locator('#btn-party-send').click();
  await p.waitForSelector('#party-ok:not([hidden])', { timeout: 6000 }).catch(() => {});
  const pb = calls(be, 'mm_submit_party_booking')[0];
  check(!!pb && pb.args.p_guest_count === 12 && pb.args.p_phone === '9876543210' && pb.args.p_event_date === '2026-12-25', 'customer: party booking RPC receives correct fields', JSON.stringify(pb && pb.args));
  check(c.errors.length === 0, 'customer: no uncaught script errors during customer flows', c.errors.join(' | '));
  await c.context.close();

  // ============ WAITER ============
  let w = await L.open(browser, port, be, { device: 'Pixel 7' });
  p = w.page;
  await p.goto(w.url(''), { waitUntil: 'load' });
  await login(p, 'waiter', 'admin');       // waiter creds on Owner tab -> rejected
  await p.waitForSelector('#login-error:not([hidden])', { timeout: 6000 });
  check(/waiter/i.test(await text(p, '#login-error')) && !(await on(p, 'screen-owner')), 'waiter: waiter credentials on the Owner tab are rejected with a role message', await text(p, '#login-error'));
  await p.fill('input[name=password]', 'wrong'); await p.locator('#btn-login').click();
  await p.waitForTimeout(500);
  check(!(await on(p, 'screen-waiter')), 'waiter: bad password does not log in');
  await p.locator('.role-tab[data-role="waiter"]').click();
  await p.fill('input[name=password]', 'pw'); await p.locator('#btn-login').click();
  await p.waitForSelector('#screen-waiter.on #waiter-tables .table-card');
  check((await p.locator('#waiter-tables .table-card').count()) === 8, 'waiter: 8 tables listed');
  check(await p.locator('#waiter-tables .table-card[data-table="05"][data-open="1"]').count() === 1, 'waiter: table 05 shows as occupied');
  // start visit w/o name
  const sb = calls(be, 'mm_staff_set_table_visit_status').length;
  await p.locator('#waiter-tables .table-card[data-table="02"]').click();
  await p.waitForTimeout(400);
  check(calls(be, 'mm_staff_set_table_visit_status').length === sb, 'waiter: starting a visit without choosing a name is blocked client-side');
  await p.selectOption('#waiter-pick', 'W01');
  await p.locator('#waiter-tables .table-card[data-table="02"]').click();
  await p.waitForSelector('#waiter-tables .table-card[data-table="02"][data-open="1"]', { timeout: 6000 });
  check(be.rpcs && be.openVisit('02') && be.openVisit('02').waiter === 'W01', 'waiter: table 02 visit started with waiter code W01');
  // open-table panel
  await p.locator('#waiter-tables .table-card[data-table="05"]').click();
  await p.waitForTimeout(800);
  const panelVisible = await p.evaluate(() => { const e = document.getElementById('waiter-visit'); return !!e && !e.hidden && e.offsetParent !== null && /T05/.test(e.innerText); });
  check(panelVisible, 'waiter: tapping an occupied table opens its visit panel (visible)', await p.evaluate(() => document.getElementById('waiter-visit').outerHTML.slice(0, 120)));
  check(/400/.test(await text(p, '#waiter-visit')), 'waiter: visit panel shows amount due ₹400');
  check((await p.locator('#waiter-visit [data-pay-method]').count()) === 0 && /Owner\/Counter/i.test(await text(p, '#waiter-visit')), 'waiter: no payment buttons (server allows admin only); counter note shown');
  p.once('dialog', (d) => d.accept());
  await p.locator('#waiter-visit [data-finish]').click();
  await p.waitForTimeout(700);
  check(/food tickets in progress/i.test(await p.locator('#toast').innerText()), 'waiter: Finish visit with food still in progress shows the server\'s reason, not a generic retry', await p.locator('#toast').innerText());
  const fin = calls(be, 'mm_staff_set_table_visit_status').filter((x) => x.args.p_action === 'FINISH').length;
  check(fin >= 1 && !!be.openVisit('05'), 'waiter: server keeps visit 05 open while tickets are unserved/unpaid');
  await p.locator('#waiter-visit [data-visit-back]').click();
  await p.waitForSelector('#waiter-tables .table-card', { timeout: 6000 });
  check(await on(p, 'screen-waiter') && await p.locator('#waiter-visit').isHidden(), 'waiter: Back returns to the table list without reloading the page');
  check(w.errors.length === 0, 'waiter: no uncaught script errors', w.errors.join(' | '));

  // ============ KITCHEN ============
  let k = await L.open(browser, port, be, { device: 'Pixel 7' });
  let kp = k.page;
  await kp.goto(k.url(''), { waitUntil: 'load' });
  await login(kp, 'kitchen');
  await kp.waitForSelector('#screen-kitchen.on .k-card', { timeout: 8000 });
  const card = kp.locator('#kitchen-board .k-card').first();
  check(/Paneer Tikka/.test(await card.innerText()) && /less spicy/.test(await card.innerText()), 'kitchen: new ticket shows items and notes');
  check(/T?05/.test(await card.locator('.k-head').innerText()), 'kitchen: ticket shows which table it is for', await card.locator('.k-head').innerText());
  await card.locator('[data-next="PREPARING"]').click();
  await kp.waitForSelector('#kitchen-board .k-lane:nth-child(2) .k-card');
  check(be.st.orders[0].status === 'PREPARING', 'kitchen: Start -> PREPARING');
  await kp.locator('#kitchen-board [data-next="READY"]').click();
  await kp.waitForSelector('#kitchen-board .k-lane:nth-child(3) .k-card');
  check(be.st.orders[0].status === 'READY', 'kitchen: Ready -> READY');
  check((await kp.locator('#kitchen-board [data-next]').count()) === 0, 'kitchen: no action offered beyond READY (serving is the waiter\'s job)');
  // live refresh: a new guest order must appear without pressing reload
  const oc = await L.open(browser, port, be, { device: 'Pixel 7' });
  await oc.page.goto(oc.url('?table=05'), { waitUntil: 'load' });
  await oc.page.waitForSelector('#menu-list [data-add]');
  await oc.page.locator('[data-add]').nth(2).click();
  await oc.page.locator('#btn-open-cart').click();
  await oc.page.locator('#btn-place-order').click();
  await oc.page.waitForSelector('#screen-placed.on');
  await kp.waitForFunction(() => /Butter Chicken/.test(document.getElementById('kitchen-board').innerText), null, { timeout: 14000 }).catch(() => {});
  check(/Butter Chicken/.test(await kp.locator('#kitchen-board').innerText()), 'kitchen: a new guest order appears on the board by itself within ~10s (auto refresh)');
  const rpcAfterLogout = () => be.st.calls.length;
  await kp.locator('#btn-kitchen-logout').click();
  await kp.waitForSelector('#screen-welcome.on');
  const n0 = rpcAfterLogout(); await kp.waitForTimeout(11500);
  check(rpcAfterLogout() === n0, 'kitchen: polling stops after logout (no background requests)');
  check(k.errors.length === 0, 'kitchen: no uncaught script errors', k.errors.join(' | '));
  await oc.context.close(); await k.context.close();

  // waiter serves the READY ticket
  await p.locator('#btn-waiter-refresh').click();
  await p.waitForSelector('#waiter-ready [data-serve]', { timeout: 6000 });
  check(/T05/.test(await text(p, '#waiter-ready')), 'waiter: READY ticket listed with its table (T05)');
  await p.locator('#waiter-ready [data-serve]').first().click();
  await p.waitForFunction(() => !document.querySelector('#waiter-ready [data-serve]'), null, { timeout: 6000 }).catch(async () => { console.log('DEBUG serve calls:', JSON.stringify(be.st.calls.filter((x) => x.kind === 'rest' && x.method === 'PATCH')), 'toast=', await p.locator('#toast').innerText(), 'orders=', JSON.stringify(be.st.orders.map((o) => [o.ticket_id, o.status]))); });
  check(be.st.orders[0].status === 'SERVED', 'waiter: Mark served -> SERVED');
  await w.context.close();

  // ============ OWNER ============
  let o = await L.open(browser, port, be, { device: null });
  let op = o.page;
  await op.goto(o.url(''), { waitUntil: 'load' });
  await login(op, 'admin');
  await op.waitForSelector('#screen-owner.on #owner-panel .order-card', { timeout: 8000 });
  check((await op.locator('#owner-panel .order-card').count()) === 2, 'owner: Orders tab lists both tickets');
  await op.locator('#owner-nav [data-panel="tables"]').click();
  await op.waitForSelector('#owner-panel .table-card');
  check((await op.locator('#owner-panel .table-card.busy').count()) === 2, 'owner: Tables tab shows 2 occupied tables (02, 05)');
  await op.locator('#owner-nav [data-panel="payments"]').click();
  await op.waitForSelector('#owner-panel [data-pay-table]', { timeout: 6000 });
  await op.locator('#owner-panel [data-pay-table="05"]').click();
  await op.waitForSelector('#owner-panel [data-pay-method="cash"]', { timeout: 6000 });
  check(/₹720/.test(await text(op, '#owner-panel')), 'owner: payments tab opens visit 05 with ₹720 due (400 + 320) and cash/UPI buttons');
  op.on('dialog', (d) => d.accept());
  await op.locator('#owner-panel [data-pay-method="cash"]').click();
  await op.waitForTimeout(800);
  const rec = calls(be, 'mm_staff_record_visit_payment')[0];
  check(!!rec && rec.args.p_amount === 720 && rec.args.p_method === 'cash' && rec.role === 'admin', 'owner: cash payment recorded for exactly ₹720 by the admin role', JSON.stringify(rec && rec.args));
  // KNOWN: order 102 (Butter Chicken) is still READY -> finish must be refused with a clear reason
  await op.locator('#owner-panel [data-finish]').click();
  await op.waitForTimeout(600);
  check(!!be.openVisit('05'), 'owner: Finish refused while a ticket is still in progress');
  await op.locator('#owner-panel [data-visit-back]').click();
  await op.waitForSelector('#owner-panel [data-pay-table], #owner-panel .empty');
  check(await on(op, 'screen-owner'), 'owner: Back from visit returns to Payments tab (not the waiter screen)');
  // menu management
  await op.locator('#owner-nav [data-panel="menu"]').click();
  await op.waitForTimeout(600);
  const menuTxt = await text(op, '#owner-panel');
  check(/Paneer Tikka/.test(menuTxt) && /Hidden Dish/.test(menuTxt), 'owner: Menu tab lists ALL dishes incl. unavailable ones', JSON.stringify(menuTxt.slice(0, 60)));
  const row = op.locator('#owner-panel [data-item]', { hasText: 'Paneer Tikka' });
  await row.locator('[data-price]').fill('250');
  await row.locator('[data-save-price]').click();
  await op.waitForTimeout(500);
  check(be.st.menu.find((m) => m.name === 'Paneer Tikka').price === 250, 'owner: price change saved (220 -> 250)');
  await row.locator('[data-price]').fill('-5'); await row.locator('[data-save-price]').click(); await op.waitForTimeout(300);
  check(be.st.menu.find((m) => m.name === 'Paneer Tikka').price === 250, 'owner: negative price rejected client-side');
  await row.locator('[data-toggle]').click();
  await op.waitForTimeout(500);
  check(be.st.menu.find((m) => m.name === 'Paneer Tikka').is_available === false && /Unavailable/.test(await row.locator('[data-toggle]').innerText()), 'owner: availability toggle switches dish off and label updates in place');
  const hid = op.locator('#owner-panel [data-item]', { hasText: 'Hidden Dish' });
  await hid.locator('[data-toggle]').click(); await op.waitForTimeout(400);
  check(be.st.menu.find((m) => m.name === 'Hidden Dish').is_available === true, 'owner: unavailable dish can be switched back on');
  await op.locator('#owner-nav [data-panel="bookings"]').click();
  await op.waitForTimeout(600);
  const bkTxt = await text(op, '#owner-panel');
  check(/Ravi/.test(bkTxt) && /9876543210/.test(bkTxt) && /12 guests/.test(bkTxt) && /PARTY-00001/.test(bkTxt), 'owner: Bookings tab lists the party booking from the customer', JSON.stringify(bkTxt.slice(0, 80)));
  await op.selectOption('#owner-panel [data-bk-status]', 'CONFIRMED');
  await op.fill('#owner-panel [data-bk-notes]', 'advance paid');
  await op.locator('#owner-panel [data-bk-save]').click();
  await op.waitForTimeout(500);
  check(be.st.bookings[0].status === 'CONFIRMED' && be.st.bookings[0].owner_notes === 'advance paid' && /confirmed/i.test(await text(op, '#owner-panel .badge')), 'owner: booking status + notes saved via mm_admin_update_party_booking', JSON.stringify([be.st.bookings[0].status, be.st.bookings[0].owner_notes, await text(op, '#owner-panel .badge'), be.st.calls.filter(c=>c.name==='mm_admin_update_party_booking').map(c=>c.args)]));
  await op.locator('#owner-nav [data-panel="settings"]').click();
  await op.waitForSelector('#settings-form');
  await op.fill('input[name=upi_id]', 'new@upi');
  await op.locator('#settings-form button[type=submit]').click();
  await op.waitForTimeout(500);
  check(be.st.cfg.upi_id === 'new@upi', 'owner: Settings save writes mm_restaurant_config (admin only)');
  check(o.errors.length === 0, 'owner: no uncaught script errors', o.errors.join(' | '));
  await o.context.close();

  const fail = L.summary('Customer / waiter / kitchen / owner workflows');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH', e); process.exit(2); });
