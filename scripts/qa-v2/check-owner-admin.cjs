'use strict';
// Phase 3: Owner dashboard. Every panel, server-side permission denial, persistence, cross-device sync,
// backup / reset safety, layouts. Runs against the in-memory fake backend (mocked): see the README note.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.cjs');
const { check } = L;

const PANELS = ['dashboard', 'orders', 'tables', 'payments', 'menu', 'bookings', 'team', 'reviews', 'places', 'reports', 'alerts', 'backup', 'settings'];
const SHOTS = process.env.MM_SHOTS || '';
const text = (page, sel) => page.locator(sel).first().innerText();

async function login(page, role) {
  await page.locator('#btn-staff').click();
  await page.locator('.role-tab[data-role="' + (role === 'kitchen' ? 'kitchen' : role === 'waiter' ? 'waiter' : 'admin') + '"]').click();
  await page.fill('input[name=username]', role === 'admin' ? 'owner' : role);
  await page.fill('input[name=password]', 'pw');
  await page.locator('#btn-login').click();
}
async function openPanel(page, name) {
  await page.locator('#owner-nav [data-panel="' + name + '"]').click();
  await page.waitForFunction(() => { const b = document.getElementById('owner-panel'); return b && !b.querySelector('.loading') && b.innerText.trim().length > 0; }, null, { timeout: 8000 });
}

(async () => {
  const { srv, port } = await L.serve(L.ROOT);
  const browser = await L.launch();
  const be = L.makeBackend();
  const uuid = () => crypto.randomUUID();
  const cfgWrites = () => be.st.calls.filter((c) => c.kind === 'rest' && c.name === 'mm_restaurant_config' && c.method !== 'GET').length;
  const rpcCalls = (n) => be.st.calls.filter((c) => c.kind === 'rpc' && c.name === n);

  function seedVisit(num) { be.rpcs.mm_staff_set_table_visit_status({ p_table_number: num, p_action: 'START', p_waiter_code: 'W01' }, 'waiter'); return be.openVisit(num); }
  function addOrder(num, status, total, approval, name) {
    const v = be.openVisit(num), t = be.st.tables.find((x) => x.table_number === num);
    const o = { id: uuid(), restaurant_id: L.RID || 'a3702d10-6673-4c06-9783-1d61c945ecd5', ticket_id: 'T' + num + '-20261107-120000-' + String(be.st.orders.length + 10).padStart(5, 'A'), table_id: t.id, table_visit_id: v.id, status, approval_status: approval || 'APPROVED', notes: '', total, created_at: new Date().toISOString(), order_number: be.st.orders.length + 500, archived_at: null, public_token: uuid() };
    be.st.orders.push(o); be.st.items.push({ order_id: o.id, item_name: name || 'Paneer Tikka', quantity: 2, price: total / 2 });
    return o;
  }

  // ---------------------------------------------------------------- seed
  seedVisit('02'); seedVisit('05');
  const oNew = addOrder('02', 'NEW', 400, 'APPROVED');
  const oPrep = addOrder('02', 'PREPARING', 220, 'APPROVED');
  const oReady = addOrder('05', 'READY', 320, 'APPROVED');
  const oPend = addOrder('05', 'NEW', 180, 'PENDING', 'Veg Manchurian');
  const oPend2 = addOrder('02', 'NEW', 99, 'PENDING', 'Veg Manchurian');
  be.st.notifs.push({ id: 901, target_role: 'admin', notification_type: 'CASH_AT_COUNTER', table_number: '05', message: 'Cash at counter T05', created_at: new Date().toISOString(), resolved_at: null, target_staff_code: '' });
  be.st.notifs.push({ id: 902, target_role: 'waiter', notification_type: 'CASH_AT_COUNTER', table_number: '05', message: 'Waiter alert', created_at: new Date().toISOString(), resolved_at: null, target_staff_code: '' });

  // ================================================================ OWNER, desktop
  let o = await L.open(browser, port, be, { device: null });
  let p = o.page;
  await p.goto(o.url(''), { waitUntil: 'load' });
  await login(p, 'admin');
  await p.waitForSelector('#owner-panel .oa-stats', { timeout: 8000 });

  // -------- navigation: every panel renders and is reachable
  const navLabels = await p.locator('#owner-nav button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-panel')));
  check(JSON.stringify(navLabels) === JSON.stringify(PANELS), '[authority] Owner sees all 13 management panels in the navigation', JSON.stringify(navLabels));
  for (const name of PANELS) {
    await openPanel(p, name);
    const t = await text(p, '#owner-panel');
    check(!/Something went wrong|Offline|offline/.test(t.slice(0, 120)) && t.length > 10, '[' + name + '] panel renders without an error state', t.slice(0, 80));
  }

  // -------- Dashboard
  await openPanel(p, 'backup'); await openPanel(p, 'team'); await openPanel(p, 'reports');
  await openPanel(p, 'dashboard');
  check(await p.evaluate(() => { const b = document.getElementById('owner-panel'); return !b.onchange && !b.oninput && !b.onsubmit; }), '[dashboard] panel event handlers from earlier panels do not leak into the next panel');
  const dash = await text(p, '#owner-panel');
  const statOf = async (label) => (await p.locator('#owner-panel .oa-stat', { hasText: label }).first().innerText()).replace(/\s+/g, ' ');
  check(/New\s*3/.test(await statOf('New')), '[dashboard] shows 3 NEW tickets', await statOf('New'));
  check(/Preparing\s*1/.test(await statOf('Preparing')) && /Ready\s*1/.test(await statOf('Ready')), '[dashboard] shows 1 PREPARING and 1 READY');
  check(/Needs approval\s*2/.test(await statOf('Needs approval')), '[dashboard] shows 2 orders needing approval');
  check(/Open tables\s*2/.test(await statOf('Open tables')), '[dashboard] shows 2 open tables');
  check(/Alerts\s*1/.test(await statOf('Alerts')), '[dashboard] shows the owner’s 1 open alert only (waiter alert not counted)');
  check(/No backup has been downloaded/.test(dash), '[dashboard] warns that no backup exists yet');
  await p.locator('#owner-panel .oa-stat', { hasText: 'Alerts' }).click();
  await p.waitForSelector('#owner-panel [data-resolve]', { timeout: 5000 });
  check(true, '[dashboard] a stat card jumps to its panel (Alerts)');

  // -------- Orders
  await openPanel(p, 'orders');
  check((await p.locator('#owner-panel .order-card').count()) === 5, '[orders] Active filter lists the 5 unserved tickets', String(await p.locator('#owner-panel .order-card').count()));
  await p.locator('#owner-panel [data-oflt="approval"]').click();
  check((await p.locator('#owner-panel .order-card').count()) === 2, '[orders] Approval filter lists the 2 pending tickets');
  const pcard = p.locator('#owner-panel [data-ord="' + oPend.ticket_id + '"]');
  await pcard.locator('[data-detail]').click();
  await p.waitForSelector('#owner-panel .oa-lines li:has-text("Veg Manchurian")', { timeout: 4000 });
  check(/₹180/.test(await text(p, '#owner-panel .oa-lines')), '[orders] Details shows the ticket’s items and price');
  await pcard.locator('[data-approve]').click();
  await p.waitForFunction((t) => !document.querySelector('[data-ord="' + t + '"] [data-approve]'), oPend.ticket_id, { timeout: 5000 });
  check(oPend.approval_status === 'APPROVED', '[orders] Approve calls mm_admin_review_customer_order and the ticket becomes APPROVED');
  const rej = p.locator('#owner-panel [data-ord="' + oPend2.ticket_id + '"]');
  await rej.locator('[data-ask="reject"]').click();
  await rej.locator('[data-confirm]').click();
  await p.waitForFunction((t) => !document.querySelector('[data-ord="' + t + '"]'), oPend2.ticket_id, { timeout: 5000 });
  check(oPend2.approval_status === 'REJECTED' && oPend2.status === 'CANCELLED', '[orders] Reject cancels the ticket (inline confirm, no popup)');
  await p.locator('#owner-panel [data-oflt="active"]').click();
  const cc = p.locator('#owner-panel [data-ord="' + oNew.ticket_id + '"]');
  await cc.locator('[data-ask="cancel"]').click();
  await cc.locator('[data-reason]').fill('x');
  await cc.locator('[data-confirm]').click();
  check(oNew.status === 'NEW', '[orders] a cancel reason shorter than 3 characters is refused (nothing sent)');
  await cc.locator('[data-reason]').fill('Guest changed mind');
  await cc.locator('[data-confirm]').click();
  await p.waitForFunction((t) => !document.querySelector('[data-ord="' + t + '"]'), oNew.ticket_id, { timeout: 5000 });
  check(oNew.status === 'CANCELLED' && rpcCalls('mm_admin_cancel_order').pop().args.p_reason === 'Guest changed mind', '[orders] Owner cancel with a reason reaches mm_admin_cancel_order');
  // a ticket whose visit has a payment cannot be cancelled: the server message reaches the owner
  be.st.payments.push({ visit_id: oPrep.table_visit_id, amount: 50, method: 'cash', created_at: new Date().toISOString() });
  const pc = p.locator('#owner-panel [data-ord="' + oPrep.ticket_id + '"]');
  await pc.locator('[data-ask="cancel"]').click(); await pc.locator('[data-reason]').fill('Kitchen out of stock');
  await pc.locator('[data-confirm]').click();
  await p.waitForFunction(() => /recorded payments/.test((document.getElementById('toast') || {}).innerText || ''), null, { timeout: 4000 }).catch(() => {});
  check(oPrep.status === 'PREPARING' && /recorded payments/.test(await text(p, '#toast')), '[orders] server refusal (payment recorded) is shown and the order is untouched');
  be.st.payments.length = 0;

  // -------- Tables (full suite is check-tables-qr.cjs)
  await openPanel(p, 'tables');
  check((await p.locator('#owner-panel .table-card').count()) === 9 && /Print all QR/.test(await text(p, '#owner-panel')), '[tables] lists all 9 tables incl. the inactive one, with QR printing');
  check(/Create|Not available/i.test(await text(p, '#owner-panel')), '[tables] states what the database does not allow (create / rename / activate)');

  // -------- Menu
  await openPanel(p, 'menu');
  check(/not available yet/i.test(await text(p, '#owner-panel')) && (await p.locator('#owner-panel [data-item]').count()) === 4, '[menu] price + availability controls for all 4 dishes; missing add/edit/archive/category support is stated');

  // -------- Payments & Bookings (full flows in check-workflows.cjs)
  await openPanel(p, 'payments');
  check((await p.locator('#owner-panel [data-pay-table]').count()) === 2, '[payments] lists the 2 open visits');
  await openPanel(p, 'bookings');
  check(true, '[bookings] panel opens');

  // -------- Team
  await openPanel(p, 'team');
  await p.waitForSelector('#owner-panel [data-w]', { timeout: 5000 });
  check((await p.locator('#owner-panel [data-w]').count()) === 1 && /W01/.test(await text(p, '#oa-waiters')), '[team] lists existing waiter W01');
  await p.fill('[data-wadd] input[name=name]', 'Ravi Kumar'); await p.locator('[data-wadd] button').click();
  await p.waitForSelector('#owner-panel [data-w="W02"]', { timeout: 4000 });
  check(be.st.waiters.find((w) => w.waiter_code === 'W02').display_name === 'Ravi Kumar', '[team] add waiter → W02 created through mm_admin_save_waiter');
  await p.fill('[data-wadd] input[name=name]', 'ravi kumar'); await p.locator('[data-wadd] button').click();
  await p.waitForFunction(() => /already in the list/.test(document.getElementById('toast').innerText), null, { timeout: 4000 }).catch(() => {});
  check(be.st.waiters.length === 2 && /already in the list/.test(await text(p, '#toast')), '[team] duplicate name refused by the server and shown to the owner');
  const w2 = p.locator('#owner-panel [data-w="W02"]');
  await w2.locator('[data-wname]').fill('Ravi K'); await w2.locator('[data-wsave]').click();
  await p.waitForTimeout(500);
  check(be.st.waiters.find((w) => w.waiter_code === 'W02').display_name === 'Ravi K', '[team] rename waiter');
  await p.locator('#owner-panel [data-w="W01"] [data-wtoggle]').click();
  await p.waitForFunction(() => /open table visit/.test(document.getElementById('toast').innerText), null, { timeout: 4000 }).catch(() => {});
  check(be.st.waiters[0].active === true && /open table visit/.test(await text(p, '#toast')), '[team] waiter with an open visit cannot be deactivated (server rule shown)');
  await p.locator('#owner-panel [data-w="W02"] [data-wtoggle]').click();
  await p.waitForFunction(() => document.querySelector('[data-w="W02"] .chip.off'), null, { timeout: 4000 });
  check(be.st.waiters.find((w) => w.waiter_code === 'W02').active === false, '[team] deactivate waiter W02');
  check(be.rpcs.mm_list_waiters({}, 'waiter').every((w) => w.active), '[team] inactive waiters disappear from the waiter picker list');
  const teamTxt = await text(p, '#owner-panel');
  check(/Kitchen/.test(teamTxt) && /Sold out/.test(teamTxt), '[kitchen] kitchen section shows live lanes and sold-out dishes');
  check(/BLOCKED/.test(teamTxt) && (await p.locator('#owner-panel input[type=password]').count()) === 0, '[staff] logins section states account creation is blocked; no password field anywhere');

  // -------- Reviews
  await openPanel(p, 'reviews');
  await p.waitForSelector('#owner-panel [data-rv]', { timeout: 5000 });
  check((await p.locator('#owner-panel [data-rv]').count()) === 3 && /5\.0 from 1/.test(await text(p, '#owner-panel')), '[reviews] lists all 3 reviews (incl. pending/hidden) with the published average');
  const pending = be.st.reviews.find((r) => r.status === 'pending');
  await p.locator('#owner-panel [data-rv="' + pending.id + '"] [data-rvset="published"]').click();
  await p.waitForFunction((id) => /published/i.test(document.querySelector('[data-rv="' + id + '"] .badge').innerText), pending.id, { timeout: 4000 });
  check(pending.status === 'published', '[reviews] publish a pending review');
  await p.locator('#owner-panel [data-rv="' + pending.id + '"] [data-rvset="hidden"]').click();
  await p.waitForFunction((id) => /hidden/i.test(document.querySelector('[data-rv="' + id + '"] .badge').innerText), pending.id, { timeout: 4000 });
  check(pending.status === 'hidden', '[reviews] hide a review');
  await p.locator('#owner-panel [data-rv="' + pending.id + '"] [data-rvdel]').click();
  await p.locator('#owner-panel [data-rv="' + pending.id + '"] [data-back]').click();
  check(be.st.reviews.length === 3, '[reviews] delete needs an inline confirmation; Back keeps the review');
  await p.locator('#owner-panel [data-rv="' + pending.id + '"] [data-rvdel]').click();
  await p.locator('#owner-panel [data-rv="' + pending.id + '"] [data-rvdel-yes]').click();
  await p.waitForFunction(() => document.querySelectorAll('[data-rv]').length === 2, null, { timeout: 4000 });
  check(be.st.reviews.length === 2 && !be.st.reviews.some((r) => r.id === pending.id), '[reviews] confirmed delete removes it permanently');

  // -------- Places
  await openPanel(p, 'places');
  check(/not available yet/i.test(await text(p, '#owner-panel')) && (await p.locator('#owner-panel input, #owner-panel textarea').count()) === 0, '[places] reported as BLOCKED (no backend); no fake editor offered');

  // -------- Reports (payment recorded through the real owner flow first)
  const v02 = be.openVisit('02');
  be.rpcs.mm_staff_record_visit_payment({ p_visit_id: v02.id, p_amount: 300, p_method: 'cash' }, 'admin');
  await openPanel(p, 'reports');
  check(/₹300/.test(await text(p, '#owner-panel .oa-stats')) , '[reports] today’s sales = ₹300 received', await text(p, '#owner-panel .oa-stats'));
  check((await p.locator('#owner-panel tbody tr').count()) === 7, '[reports] 7-day table has 7 rows');
  await p.fill('[data-day]', '2026-01-01'); await p.locator('[data-day]').dispatchEvent('change');
  await p.waitForFunction(() => document.querySelector('.oa-stat strong').innerText.trim() === '₹0' && document.querySelector('[data-day]').value === '2026-01-01', null, { timeout: 5000 });
  check(rpcCalls('mm_admin_accounts_summary').some((c) => c.args.p_day === '2026-01-01'), '[reports] choosing a day queries that day');
  await p.fill('[data-day]', new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)); await p.locator('[data-day]').dispatchEvent('change');
  await p.waitForFunction(() => /₹300/.test(document.querySelector('.oa-stats').innerText), null, { timeout: 5000 });
  const [csv] = await Promise.all([p.waitForEvent('download'), p.locator('[data-csv]').click()]);
  const csvTxt = fs.readFileSync(await csv.path(), 'utf8');
  check(/^day,orders,paid_sales,cancelled/.test(csvTxt) && csvTxt.trim().split('\n').length === 8, '[reports] CSV export has a header and 7 days', csvTxt.slice(0, 60));

  // -------- Alerts
  await openPanel(p, 'alerts');
  check((await p.locator('#owner-panel [data-n]').count()) === 1 && /Cash at counter/.test(await text(p, '#owner-panel')), '[alerts] shows only the owner’s alerts');
  await p.locator('#owner-panel [data-resolve]').click();
  await p.waitForSelector('#owner-panel .empty', { timeout: 4000 });
  check(!!be.st.notifs.find((n) => n.id === 901).resolved_at && !be.st.notifs.find((n) => n.id === 902).resolved_at, '[alerts] resolve closes the owner alert and leaves the waiter alert alone');

  // -------- Backup, restore, reset
  await openPanel(p, 'backup');
  const lock = () => p.locator('[data-reset]').isDisabled();
  check(/Never/.test(await text(p, '#owner-panel')) && /No backup/.test(await text(p, '#owner-panel')), '[backup] status shows no backup yet, with a warning');
  check(/not available yet/i.test(await text(p, '#owner-panel')) && /restore/i.test(await text(p, '#owner-panel')), '[restore] reported as BLOCKED (database has no restore function)');
  await p.locator('details.oa-danger summary').click();
  check(await lock(), '[reset] locked at the start');
  await p.fill('[data-reset-phrase]', 'RESET MIRCH MASAALA'); await p.check('[data-reset-ack]');
  check(await lock(), '[reset] still locked: correct phrase + checkbox are not enough without a backup');
  const ordersBefore = be.st.orders.length, menuBefore = be.st.menu.length;
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-export]').click()]);
  const bk = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check(/^mirch-masaala-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()) && bk.application === 'Mirch Masaala' && Array.isArray(bk.data.orders) && bk.data.orders.length === ordersBefore, '[backup] downloads a JSON export (orders, menu, config…)', dl.suggestedFilename());
  const badKeys = []; (function walk(x, pth) { if (x && typeof x === 'object') for (const k of Object.keys(x)) { if (/pass(word)?|secret|service_role|api_?key|private_?key/i.test(k)) badKeys.push(pth + '.' + k); walk(x[k], pth + '.' + k); } })(bk.data, 'data');
  check(badKeys.length === 0, '[backup] export has no password / secret / key fields', badKeys.join(','));
  await p.waitForFunction(() => !/Never/.test(document.getElementById('owner-panel').innerText.split('Last reset')[0]), null, { timeout: 4000 });
  check(!!be.st.maint.last_backup_at && rpcCalls('mm_admin_record_backup_export').length === 1, '[backup] the download is recorded and the status updates');
  await p.locator('details.oa-danger summary').evaluate((s) => { s.parentElement.open = true; });
  await p.fill('[data-reset-phrase]', 'reset mirch masaala'); await p.check('[data-reset-ack]');
  check(await lock(), '[reset] wrong-case phrase keeps it locked');
  await p.fill('[data-reset-phrase]', 'RESET MIRCH MASAALA'); await p.check('[data-reset-ack]');
  check(!(await lock()), '[reset] unlocked only after backup + exact phrase + acknowledgement');
  await p.locator('[data-reset]').click();
  await p.waitForSelector('[data-reset-result]', { timeout: 5000 });
  check(be.st.orders.length === 0 && be.st.menu.length === menuBefore && be.st.menu.every((m) => m.is_available) && be.st.waiters.length === 2 && be.st.tables.length === 9, '[reset] clears service records; menu, tables and waiters are kept', JSON.stringify([be.st.orders.length, be.st.menu.length]));
  check(rpcCalls('mm_admin_reset_business_data').pop().args.p_backup_made === true && !!be.st.maint.last_reset_at, '[reset] reset call states a backup was made and is recorded');

  // -------- Settings
  await openPanel(p, 'settings');
  const val = (n) => p.inputValue('#settings-form [name=' + n + ']');
  check((await val('restaurant_name')) === 'MIRCH MASAALA' && (await val('upi_id')) === '' && (await val('whatsapp_number')) === '919657076450', '[settings] form shows the stored values');
  const writes0 = cfgWrites();
  const tryBad = async (field, value, label) => {
    await openPanel(p, 'settings');
    await p.fill('#settings-form [name=' + field + ']', value);
    await p.locator('#settings-form button[type=submit]').click();
    check(cfgWrites() === writes0 && !(await p.locator('#settings-error').isHidden()), '[settings] ' + label + ' is rejected before anything is saved', await p.locator('#settings-error').innerText());
  };
  await tryBad('restaurant_name', '   ', 'empty restaurant name');
  await tryBad('upi_id', 'not a upi', 'invalid UPI ID');
  await tryBad('whatsapp_number', '12ab', 'invalid WhatsApp number');
  await tryBad('google_reviews_url', 'http://evil.example/x', 'non-https review link');
  await openPanel(p, 'settings');
  await p.fill('#settings-form [name=upi_id]', ''); await p.uncheck('#settings-form [name=accept_cash]');
  await p.locator('#settings-form button[type=submit]').click();
  check(cfgWrites() === writes0 && /cash|UPI/i.test(await p.locator('#settings-error').innerText()), '[settings] cannot switch cash off while no UPI ID exists (guests would have no way to pay)');
  await openPanel(p, 'settings');
  await p.fill('#settings-form [name=restaurant_name]', 'Mirch Masaala Pune');
  await p.fill('#settings-form [name=tagline]', 'Spice with soul');
  await p.fill('#settings-form [name=admin_phone]', '+91 98765 43210');
  await p.fill('#settings-form [name=upi_id]', 'mirch@okbank'); await p.fill('#settings-form [name=upi_name]', 'Mirch Masaala Pune');
  await p.fill('#settings-form [name=google_reviews_url]', 'https://g.page/r/mirch/review');
  await p.uncheck('#settings-form [name=accept_cash]');
  await p.locator('#settings-form button[type=submit]').click();
  await p.waitForFunction(() => /Saved/.test(document.getElementById('toast').innerText), null, { timeout: 4000 });
  check(be.st.cfg.restaurant_name === 'Mirch Masaala Pune' && be.st.cfg.accept_cash === false && be.st.cfg.upi_id === 'mirch@okbank' && be.st.cfg.google_reviews_url === 'https://g.page/r/mirch/review', '[settings] valid save writes every field incl. the cash toggle');
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#owner-panel .oa-stats', { timeout: 8000 });
  check(true, '[persistence] after a refresh the owner is still signed in (back on the Dashboard)');
  await openPanel(p, 'settings');
  check((await val('restaurant_name')) === 'Mirch Masaala Pune' && (await val('upi_id')) === 'mirch@okbank' && !(await p.isChecked('#settings-form [name=accept_cash]')), '[persistence] saved settings are loaded again from the database after refresh');
  check(/BLOCKED/.test(await text(p, '#owner-panel')) && /opening hours/i.test(await text(p, '#owner-panel')), '[settings] logo, address, hours, tax/service and synced language are listed as BLOCKED');
  check(o.errors.length === 0, '[owner] no uncaught script errors on any panel', o.errors.join(' | '));

  // ---------------------------------------------------------------- second device: customer sees the settings
  const c = await L.open(browser, port, be, { device: 'Pixel 7' });
  await c.page.goto(c.url(''), { waitUntil: 'load' });
  await c.page.waitForFunction(() => /PUNE/i.test(document.querySelector('.home-logo').innerText), null, { timeout: 6000 }).catch(() => {});
  check(/MIRCH\s*MASAALA\s*PUNE/i.test((await text(c.page, '.home-logo')).replace(/\s+/g, ' ')) && /spice with soul/i.test(await text(c.page, '.home-logo-sub')), '[settings] another device (customer phone) shows the new name and tagline', await text(c.page, '.home-logo'));
  const anonCfg = await c.page.evaluate(() => MM.api.loadConfig());
  check(anonCfg.upi_id === 'mirch@okbank' && anonCfg.accept_cash === false, '[settings] customer devices read the new UPI ID and cash setting');
  check(await c.page.evaluate(() => { const n = document.getElementById('customer-nav'); return !n.hidden && getComputedStyle(n).display !== 'none'; }), '[layout] guest bottom bar is still shown on the customer home screen');
  await c.context.close();

  // ---------------------------------------------------------------- layouts: desktop + phone, every panel
  async function layout(ctx, label) {
    const pg = ctx.page;
    await pg.goto(ctx.url(''), { waitUntil: 'load' });
    await login(pg, 'admin'); await pg.waitForSelector('#owner-panel .oa-stats', { timeout: 8000 });
    const bad = [];
    check(await pg.evaluate(() => document.getElementById('customer-nav').hidden === true && getComputedStyle(document.getElementById('customer-nav')).display === 'none'), '[layout] ' + label + ': guest bottom bar (Home/Menu/Order/Cart) is hidden on the owner screen');
    for (const name of PANELS) {
      await openPanel(pg, name);
      const w = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (w.sw > w.iw + 1) bad.push(name + ' ' + w.sw + '>' + w.iw);
      if (SHOTS && ['dashboard', 'orders', 'team', 'backup', 'settings', 'reports'].includes(name)) await pg.screenshot({ path: path.join(SHOTS, label + '-' + name + '.png'), fullPage: false });
    }
    check(bad.length === 0, '[layout] ' + label + ': no panel overflows the screen width', bad.join(', '));
    const nav = await pg.evaluate(() => { const n = document.getElementById('owner-nav'); return { sw: n.scrollWidth, cw: n.clientWidth }; });
    check(label === 'mobile' ? nav.sw > nav.cw : true, '[layout] ' + label + ': navigation scrolls sideways instead of wrapping off-screen', JSON.stringify(nav));
    check(ctx.errors.length === 0, '[layout] ' + label + ': no script errors', ctx.errors.join(' | '));
    await ctx.context.close();
  }
  await layout(await L.open(browser, port, be, { device: 'Pixel 7' }), 'mobile');
  await layout(await L.open(browser, port, be, { viewport: { width: 1280, height: 800 } }), 'desktop');
  await o.context.close();

  // ================================================================ PERMISSIONS: waiter, kitchen, anonymous
  const be2 = L.makeBackend();                      // fresh state so denial is measured against known data
  const snap = () => JSON.stringify({ cfg: be2.st.cfg, w: be2.st.waiters, r: be2.st.reviews, ord: be2.st.orders.map((x) => x.status), m: be2.st.maint, menu: be2.st.menu.map((m) => [m.price, m.is_available]), tables: be2.st.tables.map((t) => t.seating_capacity) });
  be2.rpcs.mm_staff_set_table_visit_status({ p_table_number: '02', p_action: 'START', p_waiter_code: 'W01' }, 'waiter');
  const v2 = be2.openVisit('02'), t2 = be2.st.tables.find((x) => x.table_number === '02');
  const ord2 = { id: uuid(), restaurant_id: 'a3702d10-6673-4c06-9783-1d61c945ecd5', ticket_id: 'T02-20261107-120000-AAAAA', table_id: t2.id, table_visit_id: v2.id, status: 'NEW', approval_status: 'PENDING', total: 100, created_at: new Date().toISOString(), order_number: 1, archived_at: null };
  be2.st.orders.push(ord2);
  const ADMIN_CALLS = [
    ['accountsSummary', []], ['cancelOrder', [ord2.ticket_id, 'trying as staff']], ['reviewOrder', [ord2.ticket_id, 'APPROVE']], ['saveWaiter', ['Intruder', null]],
    ['setWaiterActive', ['W01', false]], ['setReviewStatus', [be2.st.reviews[1].id, 'published']], ['deleteReview', [be2.st.reviews[0].id]],
    ['maintenanceStatus', []], ['exportBackup', []], ['recordBackup', []], ['resetBusinessData', ['RESET MIRCH MASAALA', true]],
    ['setCapacity', ['02', 9]], ['recordPayment', [v2.id, 50, 'cash', '']], ['saveConfig', [{ upi_id: 'attacker@upi' }]]
  ];
  for (const role of ['waiter', 'kitchen']) {
    const s = await L.open(browser, port, be2, { device: null });
    await s.page.goto(s.url(''), { waitUntil: 'load' });
    // 1) the Owner login tab refuses a waiter / kitchen account
    await s.page.locator('#btn-staff').click(); await s.page.locator('.role-tab[data-role="admin"]').click();
    await s.page.fill('input[name=username]', role); await s.page.fill('input[name=password]', 'pw'); await s.page.locator('#btn-login').click();
    await s.page.waitForSelector('#login-error:not([hidden])', { timeout: 5000 });
    check(!(await s.page.evaluate(() => document.getElementById('screen-owner').classList.contains('on'))), '[authority] ' + role + ' account cannot enter the Owner screen', await text(s.page, '#login-error'));
    // 2) signed in with their own role, every owner-only call is refused by the DATABASE
    await s.page.locator('.role-tab[data-role="' + role + '"]').click();
    await s.page.fill('input[name=username]', role); await s.page.fill('input[name=password]', 'pw'); await s.page.locator('#btn-login').click();
    await s.page.waitForSelector('#screen-' + role + '.on', { timeout: 6000 });
    check((await s.page.locator('#owner-nav').isHidden()) && (await s.page.locator('#screen-owner.on').count()) === 0, '[authority] ' + role + ' screen has no Owner navigation');
    const before = snap();
    const out = await s.page.evaluate(async (calls) => {
      const res = {};
      for (const [fn, args] of calls) { try { await MM.api[fn].apply(null, args); res[fn] = 'ALLOWED'; } catch (e) { res[fn] = 'denied: ' + String(e && e.message || e).slice(0, 60); } }
      return res;
    }, ADMIN_CALLS);
    const allowed = Object.entries(out).filter(([, v]) => v === 'ALLOWED').map(([k]) => k);
    check(allowed.length === 0, '[authority] ' + role + ': all ' + ADMIN_CALLS.length + ' owner-only operations are refused by the backend', JSON.stringify(allowed) + ' ' + JSON.stringify(out));
    check(snap() === before, '[authority] ' + role + ': no data changed by those attempts');
    const revs = await s.page.evaluate(() => MM.api.ownerReviews());
    check(revs.length === 1 && revs[0].status === 'published', '[authority] ' + role + ' only sees published reviews (pending/hidden stay owner-only)');
    const px = await s.page.evaluate(async () => { try { await MM.api.updatePrice(MM.state.menu && MM.state.menu[0] ? MM.state.menu[0].id : '00000000-0000-4000-8000-000000000000', 1); return 'ALLOWED'; } catch (e) { return 'denied'; } });
    check(px === 'denied', '[authority] ' + role + ' cannot change a dish price');
    await s.context.close();
  }
  const k = await L.open(browser, port, be2, { device: null });
  await k.page.goto(k.url(''), { waitUntil: 'load' });
  const anon = await k.page.evaluate(async (calls) => {
    const res = {};
    for (const [fn, args] of calls.concat([['listWaiters', [true]], ['notifications', [5, '']], ['tableVisits', []]])) { try { await MM.api[fn].apply(null, args); res[fn] = 'ALLOWED'; } catch (e) { res[fn] = 'denied'; } }
    return res;
  }, ADMIN_CALLS);
  check(Object.values(anon).every((v) => v === 'denied'), '[authority] a signed-out visitor is refused on every owner and staff operation', JSON.stringify(anon));
  await k.context.close();

  // ---------------------------------------------------------------- static safety scans
  const src = ['js/app.js', 'js/supabase.js', 'js/owner-admin.js', 'js/config.js', 'js/p0-lifecycle.js', 'index.html'].map((f) => fs.readFileSync(path.join(L.ROOT, f), 'utf8')).join('\n');
  check(!/service_role|sb_secret_/i.test(src), '[security] no service-role / secret key in browser code');
  check(!/localStorage\.(set|get)Item\([^)]*pass/i.test(src) && !/MM\.store\.set\([^)]*pass/i.test(src), '[security] passwords are never written to browser storage');
  const en = (() => { global.window = global; global.MM = {}; delete require.cache[require.resolve('../../js/i18n.js')]; require('../../js/i18n.js'); return global.MM.I18N.en; })();
  const used = new Set([...fs.readFileSync(path.join(L.ROOT, 'js/owner-admin.js'), 'utf8').matchAll(/\bt\('((?:oa_|nav_)[a-z0-9_]+)'/g)].map((m) => m[1]).filter((x) => !/_$/.test(x)));
  ['oa_f_active', 'oa_f_approval', 'oa_f_all', 'oa_rv_pending', 'oa_rv_published', 'oa_rv_hidden'].forEach((x) => used.add(x));
  const missing = [...used].filter((x) => !(x in en));
  check(missing.length === 0, '[i18n] every text key used by the owner panels exists', missing.join(','));

  // ---------------------------------------------------------------- per-panel summary
  const groups = {};
  L.results.forEach((r) => { const m = /^\[([a-z0-9-]+)\]/.exec(r.name); const g = m ? m[1] : 'other'; (groups[g] = groups[g] || { p: 0, f: 0 })[r.ok ? 'p' : 'f']++; });
  console.log('\nPer-area results:'); Object.keys(groups).forEach((g) => console.log('  ' + g.padEnd(12) + (groups[g].f ? 'FAIL' : 'PASS') + '  (' + groups[g].p + '/' + (groups[g].p + groups[g].f) + ')'));
  const fail = L.summary('Owner Super Admin dashboard');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH', e); process.exit(2); });
