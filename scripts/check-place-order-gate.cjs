#!/usr/bin/env node
'use strict';

// Customer "Place order" button regression test.
// Runs the REAL index.html + supabase-live.js in headless Chromium against a recording fake of the
// Supabase client. It proves, for valid and invalid/missing table sessions, whether the button can
// be used, that a tap creates exactly one order, and that every failure is visible to the guest.
// It does NOT talk to the production database; the SQL side is covered by the check-*.sql scripts.
//
// Usage: node scripts/check-place-order-gate.cjs   (needs `playwright` + Chromium;
//        set CHROME_PATH to use an already-installed Chrome)
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Needs Playwright: npm i playwright && npx playwright install chromium'); process.exit(2); }

const indexUrl = 'file://' + path.resolve(process.cwd(), 'index.html');
let failures = 0, total = 0;
function check(ok, name, detail) {
  total++;
  if (!ok) failures++;
  console.log((ok ? '✓ ' : '✗ ') + name + (!ok && detail !== undefined ? ' — ' + detail : ''));
}

// Installed before any page script runs. Mirrors the replies of the real RPCs
// (supabase/public-table-visit-gate.sql and supabase/direct-kitchen-qr-orders.sql).
function installFakeSupabase(scenario) {
  window.__rpc = [];
  window.__sc = scenario;
  const VISIT = '11111111-1111-4111-8111-111111111111';
  const rows = {
    categories: [{ id: 'c1', name: 'Probe', sort_order: 1, is_active: true }],
    menu_items: [
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', category_id: 'c1', name: 'Probe Paneer', description: '', price: 300, image_url: null, is_available: true, sort_order: 1, is_veg: true, is_bestseller: false, spicy_level: 1 },
      { id: 'aaaaaaaa-0000-4000-8000-000000000002', category_id: 'c1', name: 'Probe Biryani', description: '', price: 400, image_url: null, is_available: true, sort_order: 2, is_veg: false, is_bestseller: false, spicy_level: 2 },
      { id: 'aaaaaaaa-0000-4000-8000-000000000003', category_id: 'c1', name: 'Probe Naan', description: '', price: 300, image_url: null, is_available: true, sort_order: 3, is_veg: true, is_bestseller: false, spicy_level: 0 }
    ],
    restaurant_tables: []
  };
  const chain = (n) => new Proxy(function () {}, {
    get: (_t, p) => (p === 'then' ? (res) => res({ data: rows[n] || [], error: null }) : chain(n)),
    apply: () => chain(n)
  });
  const validTable = (t) => /^[0-9]{1,2}$/.test(String(t || '').trim());
  const fake = {
    rpc(name, args) {
      window.__rpc.push({ name, args });
      const s = window.__sc;
      const tn = String((args && args.p_table_number) || '');
      if (name === 'mm_public_table_visit_status') {
        return new Promise((res, rej) => setTimeout(() => {
          if (!validTable(tn)) return res({ data: null, error: { code: 'P0001', message: 'Choose a valid table number' } });
          if (s.status === 'throw') return rej(new Error('Failed to fetch'));
          if (s.status === 'open') return res({ data: { table_number: tn, status: 'OPEN', can_order: true, visit_id: VISIT, message: 'You are ready to order.' }, error: null });
          if (s.status === 'available') return res({ data: { table_number: tn, status: 'AVAILABLE', can_order: false, visit_id: null, message: 'Please wait for the waiter to activate this table.' }, error: null });
          return res({ data: { table_number: tn, status: 'UNKNOWN', can_order: false, message: 'Table not found' }, error: null });
        }, 0));
      }
      if (name === 'mm_ensure_public_table_visit') {
        if (!validTable(tn)) return Promise.resolve({ data: null, error: { code: 'P0001', message: 'Choose a valid table number' } });
        if (s.status === 'open') return Promise.resolve({ data: { table_number: tn, status: 'OPEN', visit_id: VISIT }, error: null });
        if (s.status === 'unknown') return Promise.resolve({ data: null, error: { code: 'P0001', message: 'Active table not found' } });
        return Promise.resolve({ data: null, error: { code: 'P0001', message: 'This table is not open for online orders yet. Please ask your waiter to start the visit.' } });
      }
      if (name === 'mm_place_order') {
        return new Promise((res) => setTimeout(() => {
          if (s.place === 'success') {
            const n = window.__rpc.filter((c) => c.name === 'mm_place_order').length;
            return res({ data: { id: 'MM-PROBE-' + n, publicToken: 'tok-' + n, visitId: VISIT, table: tn, items: [], total: 1000, status: 'NEW', orderNumber: n }, error: null });
          }
          return res({ data: null, error: { code: 'P0001', message: s.placeMsg || 'Menu item unavailable' } });
        }, s.placeDelay || 0));
      }
      return Promise.resolve({ data: null, error: null });
    },
    functions: { invoke() { return Promise.resolve({ data: { sent: 0, failed: 0 }, error: null }); } },
    auth: new Proxy({}, { get: (_t, p) => (p === 'onAuthStateChange' ? () => ({ data: { subscription: { unsubscribe() {} } } }) : () => Promise.resolve({ data: { session: null, user: null }, error: null })) }),
    from: (n) => chain(n), channel: () => chain('x'), removeChannel: () => {}
  };
  window.supabase = { createClient: () => fake };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

(async () => {
  const launch = { args: ['--no-sandbox'] };
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch(launch);
  const unexpected = [];

  // Opens the page the way a guest does (scanning the table QR = ?table=NN), waits for the table
  // check, then fills the cart with three dishes (qty 1, total 1000) and opens it.
  async function session(scenario, opts) {
    opts = opts || {};
    const context = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true });
    await context.route(/^https?:/, (r) => r.abort('failed'));
    const page = await context.newPage();
    page.on('pageerror', (e) => unexpected.push('uncaught: ' + e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/^Failed to load resource/.test(t) || /^\[Mirch Masaala/.test(t)) return; // blocked CDN + the app's own logged failures
      unexpected.push('console.error: ' + t.slice(0, 160));
    });
    await page.addInitScript(installFakeSupabase, scenario);
    // The once-per-session chef's-special popup is covered by its own test below; silence it elsewhere.
    if (!opts.allowSpecial) await page.addInitScript(() => { ['05', '99', 'abc'].forEach((n) => sessionStorage.setItem('mm_sp_' + n, '1')); });
    await page.goto(indexUrl + (opts.query === undefined ? '?table=05' : opts.query), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4300); // startTable fires 2.9s after a QR scan, then the table check runs
    if (!opts.noCart) {
      await page.evaluate(() => {
        const items = window.MENU.menu_items.slice(0, 3);
        cart = items.map((i) => ({ id: i.id, name: i.name, price: i.price, qty: 1 }));
        window.cart = cart; updCart(); openCart();
      });
      await page.waitForTimeout(150);
    }
    const api = {
      page, context,
      // A real tap at the button's centre: honours disabled, pointer-events and any overlay on top.
      async tap() {
        const box = await page.locator('#place-order-button').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      },
      state: () => page.evaluate(() => {
        const b = document.getElementById('place-order-button');
        const note = document.getElementById('cart-gate-note');
        const noteVisible = !!(note && !note.hidden && note.textContent.trim() && note.closest('#cart') && getComputedStyle(note).display !== 'none');
        return {
          usable: !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !b.classList.contains('is-blocked'),
          disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled') === 'true', text: b.textContent.trim(),
          noteVisible, noteText: note ? note.textContent.trim() : '',
          special: document.getElementById('special-modal').classList.contains('on'),
          success: document.getElementById('success').classList.contains('on'),
          total: document.getElementById('total').textContent
        };
      }),
      placeCalls: () => page.evaluate(() => window.__rpc.filter((c) => c.name === 'mm_place_order')),
      toast: () => page.evaluate(() => { const t = document.getElementById('toast'); return t && t.classList.contains('on') ? t.textContent.trim() : ''; }),
      close: () => context.close()
    };
    return api;
  }

  // 1. Valid QR + seated table: usable, and one tap creates exactly one correct order.
  let s = await session({ status: 'open', place: 'success' });
  let st = await s.state();
  check(st.usable && !st.noteVisible, 'valid QR + open table: Place order is usable and shows no warning', JSON.stringify(st));
  check(st.total === '₹1000', 'cart shows three dishes totalling ₹1000', st.total);
  await s.tap(); await s.page.waitForTimeout(700);
  let calls = await s.placeCalls();
  check(calls.length === 1, 'one tap sends exactly one mm_place_order', 'sent ' + calls.length);
  const a = (calls[0] && calls[0].args) || {};
  check(a.p_table_number === '05' && a.p_table_visit_id === '11111111-1111-4111-8111-111111111111' && UUID_V4.test(String(a.p_customer_session_id)) &&
    Array.isArray(a.p_items) && a.p_items.length === 3 && a.p_items.every((i) => /^aaaaaaaa-/.test(i.menu_item_id) && i.quantity === 1),
    'the order carries the table, the open visit, a customer session id and the three dishes', JSON.stringify(a));
  st = await s.state();
  check(st.success, 'success screen is shown after the order is accepted');
  check(await s.page.evaluate(() => localStorage.getItem('mm_c_05') === '[]'), 'the saved cart is cleared after a successful order');
  await s.close();

  // 2. Repeated taps while the server is slow still create one order.
  s = await session({ status: 'open', place: 'success', placeDelay: 600 });
  await s.tap(); await s.tap(); await s.tap();
  st = await s.state();
  check(st.disabled && /Sending/i.test(st.text), 'while sending, the button is locked and says "Sending order…"', JSON.stringify(st));
  await s.page.waitForTimeout(1200);
  check((await s.placeCalls()).length === 1, 'three rapid taps on a slow connection create exactly one order');
  await s.close();

  // 3. The 5-second table re-check must not unlock the button while an order is in flight.
  s = await session({ status: 'open', place: 'success', placeDelay: 6500 });
  await s.tap(); await s.page.waitForTimeout(5900);
  st = await s.state();
  check(st.disabled && /Sending/i.test(st.text), 'a table re-check during a slow order does not unlock the button', JSON.stringify(st));
  await s.tap();
  await s.page.waitForTimeout(1200);
  check((await s.placeCalls()).length === 1 && (await s.state()).success, 'the slow order still completes once');
  await s.close();

  // 4. Server rejects the order: visible error, button usable, retry creates one order.
  s = await session({ status: 'open', place: 'error', placeMsg: 'Menu item unavailable' });
  await s.tap(); await s.page.waitForTimeout(700);
  const rejectToast = await s.toast();
  // The app rewords raw database errors for guests (mmFriendlyError), so match the friendly text.
  check(/menu/i.test(rejectToast), 'a rejected order shows a visible, guest-friendly error message', 'toast="' + rejectToast + '"');
  st = await s.state();
  check(st.usable && /Place order/i.test(st.text) && !st.success, 'after a rejected order the button is usable again and no success is shown', JSON.stringify(st));
  await s.page.evaluate(() => { window.__sc.place = 'success'; });
  await s.tap(); await s.page.waitForTimeout(700);
  check((await s.placeCalls()).length === 2 && (await s.state()).success, 'retrying after a rejection creates one more order (2 attempts, 1 accepted)');
  await s.close();

  // 5. Table not seated yet: looks inactive, says why inside the cart, never submits, unlocks by itself.
  s = await session({ status: 'available', place: 'success' });
  st = await s.state();
  check(!st.usable && (st.disabled || st.ariaDisabled), 'unseated table: Place order looks inactive', JSON.stringify(st));
  check(st.noteVisible && /waiter/i.test(st.noteText), 'unseated table: the reason is shown inside the cart, next to the button', JSON.stringify({ noteVisible: st.noteVisible, noteText: st.noteText }));
  await s.tap(); await s.page.waitForTimeout(500);
  const waitToast = await s.toast();
  check(/waiter/i.test(waitToast), 'unseated table: tapping the button gives a visible explanation', 'toast="' + waitToast + '"');
  check((await s.placeCalls()).length === 0, 'unseated table: tapping never submits an order');
  await s.page.evaluate(() => { window.__sc.status = 'open'; });
  await s.page.waitForFunction(() => { const b = document.getElementById('place-order-button'); return !b.disabled && b.getAttribute('aria-disabled') !== 'true'; }, null, { timeout: 7500 }).catch(() => {});
  st = await s.state();
  check(st.usable && !st.noteVisible, 'once the waiter seats the table the button unlocks by itself and the warning disappears', JSON.stringify(st));
  await s.tap(); await s.page.waitForTimeout(700);
  check((await s.placeCalls()).length === 1, 'after being seated, one tap creates exactly one order');
  await s.close();

  // 6. The table check itself fails (network blip): must not lock ordering; failure is visible.
  s = await session({ status: 'throw', place: 'success' });
  st = await s.state();
  check(st.usable, 'a failed table check does not lock the button', JSON.stringify(st));
  await s.tap(); await s.page.waitForTimeout(600);
  check(/waiter|table/i.test(await s.toast()) && (await s.state()).usable, 'tap after a failed table check shows a visible message and leaves the button usable');
  await s.close();

  // 7. Invalid / unknown table numbers: visible error, nothing submitted, button not stuck.
  for (const [query, label] of [['?table=abc', 'invalid table in the QR (abc)'], ['?table=99', 'table that does not exist (99)']]) {
    s = await session({ status: label.includes('99') ? 'unknown' : 'open', place: 'success' }, { query });
    await s.tap(); await s.page.waitForTimeout(700);
    const t = await s.toast();
    check(t.length > 0 && (await s.placeCalls()).length === 0, label + ': shows a visible error and submits nothing', 'toast="' + t + '"');
    st = await s.state();
    check(!st.disabled && /Place order/i.test(st.text), label + ': the button is not left stuck on "Sending order…"', JSON.stringify(st));
    await s.close();
  }

  // 8. Missing session: no table at all.
  s = await session({ status: 'open', place: 'success' }, { query: '', noCart: true });
  await s.page.evaluate(() => {
    table = ''; window.table = '';
    const items = window.MENU.menu_items.slice(0, 3);
    cart = items.map((i) => ({ id: i.id, name: i.name, price: i.price, qty: 1 })); window.cart = cart;
    window.placeOrder();
  });
  await s.page.waitForTimeout(300);
  check(/table is missing/i.test(await s.toast()) && (await s.placeCalls()).length === 0, 'no table session: shows "Table is missing" and submits nothing');
  await s.close();

  // 9. Empty cart is never silent.
  s = await session({ status: 'open', place: 'success' }, { noCart: true });
  await s.page.evaluate(() => { cart = []; window.cart = cart; updCart(); openCart(); window.placeOrder(); });
  await s.page.waitForTimeout(300);
  check(/cart is empty/i.test(await s.toast()) && (await s.placeCalls()).length === 0, 'empty cart: shows a visible message and submits nothing');
  await s.close();

  // 10. The chef's-special popup must not cover the cart and swallow taps on Place order.
  s = await session({ status: 'open', place: 'success' }, { allowSpecial: true }); // cart is opened ~1.4s before the popup timer fires
  await s.page.waitForTimeout(3600);
  st = await s.state();
  check(!st.special, 'the chef\'s-special popup does not open on top of the cart', JSON.stringify(st));
  await s.tap(); await s.page.waitForTimeout(700);
  check((await s.placeCalls()).length === 1, 'with the cart open, a tap on Place order reaches the button and creates one order');
  await s.close();

  check(unexpected.length === 0, 'no uncaught script errors during any scenario', unexpected.join(' | ').slice(0, 400));
  await browser.close();
  console.log(failures ? '\n' + failures + ' of ' + total + ' place-order check(s) failed.' : '\nPlace order gate test passed (' + total + ' checks).');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('Place order gate test crashed:', e.message); process.exit(1); });
