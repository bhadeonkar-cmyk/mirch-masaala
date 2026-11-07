#!/usr/bin/env node
'use strict';

// Party Booking frontend <-> Supabase contract test.
// Runs the REAL index.html + supabase-live.js in headless Chromium against a recording
// fake of the Supabase client. It proves what the app sends (RPC name and arguments),
// what it does with each kind of reply, and that a failed reply never shows a success
// confirmation. It does NOT talk to the production database; the SQL side of the same
// contract is exercised by scripts/check-party-bookings.sql in PostgreSQL.
//
// Usage: node scripts/check-party-booking-contract.cjs   (needs `playwright` + Chromium)
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Needs Playwright: npm i playwright && npx playwright install chromium'); process.exit(2); }

const indexUrl = 'file://' + path.resolve(process.cwd(), 'index.html');
let failures = 0;
function check(ok, name, detail) {
  if (!ok) failures++;
  console.log((ok ? '✓ ' : '✗ ') + name + (!ok && detail ? ' — ' + detail : ''));
}

// Same shape that supabase/party-bookings.sql returns from mm_submit_party_booking.
const REAL_SHAPED_SUCCESS = {
  id: '5b1c7c52-0d0b-4a07-8d57-1d3a8f1a0c11', booking_ref: 'PARTY-00042', name: 'Asha',
  phone: '+91 98765 43210', event_type: 'Birthday', event_date: '2030-01-15', event_time: '19:00',
  guest_count: 12, notes: '', status: 'NEW', created_at: '2030-01-01T10:00:00Z',
  notification_ids: [901], dispatch_tokens: [{ id: 901, token: 'one-time-token-for-test' }]
};

// Installed before any page script runs. Provides window.supabase.createClient so that the
// real supabase-live.js start-up succeeds. Unknown calls resolve harmlessly.
function installFakeSupabase() {
  window.__rpc = []; window.__invoke = []; window.__mode = 'success'; window.__delay = 0;
  const empty = { data: null, error: null };
  const chain = () => new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? (res) => res({ data: [], error: null }) : chain()),
    apply: () => chain()
  });
  const modes = {
    success: () => ({ data: window.__SUCCESS, error: null }),
    array: () => ({ data: [window.__SUCCESS], error: null }),
    empty: () => ({ data: null, error: null }),
    noref: () => ({ data: { id: 'x' }, error: null }),
    missing: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.mm_submit_party_booking in the schema cache' } }),
    denied: () => ({ data: null, error: { code: '42501', message: 'permission denied for function mm_submit_party_booking' } }),
    sqlerror: () => ({ data: null, error: { code: 'P0001', message: 'Please choose a valid occasion.' } })
  };
  const fake = {
    rpc(name, args) {
      window.__rpc.push({ name, args });
      if (name !== 'mm_submit_party_booking') return Promise.resolve(empty);
      return new Promise((resolve) => setTimeout(() => resolve(modes[window.__mode]()), window.__delay));
    },
    functions: { invoke(name, opts) { window.__invoke.push({ name, body: opts && opts.body }); return Promise.resolve({ data: { sent: 1, failed: 0 }, error: null }); } },
    auth: new Proxy({}, { get: (_t, p) => (p === 'onAuthStateChange' ? () => ({ data: { subscription: { unsubscribe() {} } } }) : () => Promise.resolve({ data: { session: null, user: null }, error: null })) }),
    from: () => chain(), channel: () => chain(), removeChannel: () => {}
  };
  window.supabase = { createClient: () => fake };
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true });
  await context.route(/^https?:/, (r) => r.abort('failed')); // fully offline
  const page = await context.newPage();
  const unexpected = [];
  page.on('pageerror', (e) => unexpected.push('uncaught: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/^Failed to load resource: net::ERR_FAILED/.test(t)) return;                  // blocked external request
    if (/^\[Mirch Masaala party booking( RPC)?\]/.test(t)) return;                    // the app logging the failures injected below
    if (/^\[Mirch Masaala menu sync\] Error: No menu items were returned/.test(t)) return; // the fake database holds no menu rows
    if (/^\[Mirch Masaala Supabase\] Could not load shared menu\./.test(t)) return;           // same cause: the fake database holds no menu rows
    unexpected.push('console.error: ' + t.slice(0, 200));
  });
  await page.addInitScript(installFakeSupabase);
  await page.addInitScript((s) => { window.__SUCCESS = s; }, REAL_SHAPED_SUCCESS);
  await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  check(await page.evaluate(() => window.MM_SUPABASE_ENABLED === true && typeof window.MM_SUBMIT_PARTY_BOOKING === 'function'),
    'live client initialised and exposes the party booking submit function');

  const tomorrow = await page.evaluate(() => new Date(Date.now() + 864e5).toISOString().slice(0, 10));
  async function openAndFill() {
    await page.evaluate(() => { openParty(); resetPartyModal(); });
    await page.fill('#p-name', '  Asha  ');
    await page.fill('#p-phone', '98765 43210');
    await page.selectOption('#p-type', 'Birthday');
    await page.fill('#p-date', tomorrow);
    await page.selectOption('#p-time', '19:00');
    await page.fill('#p-guests', '12');
    await page.fill('#p-notes', '');
    await page.evaluate(() => { window.__rpc.length = 0; window.__invoke.length = 0; });
  }
  const confirmationShown = () => page.evaluate(() => getComputedStyle(document.getElementById('party-confirmation')).display !== 'none');
  const buttonUsable = () => page.evaluate(() => !document.getElementById('party-submit-btn').disabled);
  const rpcCalls = () => page.evaluate(() => window.__rpc.filter((c) => c.name === 'mm_submit_party_booking'));
  async function submit(mode, delay) {
    await page.evaluate(([m, d]) => { window.__mode = m; window.__delay = d || 0; }, [mode, delay]);
    await page.locator('#party-submit-btn').tap();
    await page.waitForTimeout((delay || 0) + 300);
  }

  // 1. Success: exact RPC name + arguments, push dispatch, confirmation from the real reply.
  await openAndFill();
  await submit('success');
  const calls = await rpcCalls();
  check(calls.length === 1, 'a valid request calls the database once');
  check(JSON.stringify(calls[0] && calls[0].args) === JSON.stringify({
    p_name: 'Asha', p_phone: '+91 98765 43210', p_event_type: 'Birthday', p_event_date: tomorrow,
    p_event_time: '19:00', p_guest_count: 12, p_notes: ''
  }), 'mm_submit_party_booking is called with exactly the seven expected arguments', JSON.stringify(calls[0] && calls[0].args));
  check((await confirmationShown()) && (await page.locator('#party-confirm-ref').textContent()) === 'PARTY-00042',
    'success confirmation shows the reference returned by the database');
  const invokes = await page.evaluate(() => window.__invoke);
  check(invokes.length === 1 && invokes[0].name === 'send-staff-push' &&
    JSON.stringify(invokes[0].body) === JSON.stringify({ notification_ids: [901], dispatch_tokens: [{ id: 901, token: 'one-time-token-for-test' }] }),
    'the returned notification id and one-time token are passed to send-staff-push', JSON.stringify(invokes));

  // 2. PostgREST may wrap a single object in an array: still a genuine success.
  await openAndFill();
  await submit('array');
  check((await confirmationShown()) && (await page.locator('#party-confirm-ref').textContent()) === 'PARTY-00042', 'array-wrapped reply is accepted as a success');

  // 3. Every failure shape: no confirmation, helpful message, button usable again.
  const failures3 = [
    ['empty', /did not confirm/i, 'empty reply'],
    ['noref', /did not confirm/i, 'reply without a booking reference'],
    ['missing', /not connected to the shared database/i, 'function missing (migration not applied)'],
    ['denied', /temporarily unavailable/i, 'permission denied'],
    ['sqlerror', /could not save your request/i, 'database validation error']
  ];
  for (const [mode, pattern, label] of failures3) {
    await openAndFill();
    await submit(mode);
    const toastText = await page.locator('#toast').textContent();
    check(!(await confirmationShown()) && pattern.test(toastText) && (await buttonUsable()),
      'failure (' + label + '): no false confirmation, clear message, button usable again', 'toast="' + toastText + '"');
    check((await page.evaluate(() => window.__invoke.length)) === 0, 'failure (' + label + '): no push dispatch for a request that was not saved');
  }

  // 4. Repeated taps while the request is in flight create exactly one database call.
  await openAndFill();
  await page.evaluate(() => { window.__mode = 'success'; window.__delay = 400; const b = document.getElementById('party-submit-btn'); b.click(); b.click(); b.click(); });
  await page.waitForTimeout(800);
  check((await rpcCalls()).length === 1, 'three rapid taps send one database request');

  // 5. Client-side validation stops bad input before any database call.
  await openAndFill();
  await page.fill('#p-phone', '12345');
  await page.locator('#party-submit-btn').tap();
  check((await rpcCalls()).length === 0, 'an invalid phone number never reaches the database');

  check(unexpected.length === 0, 'no unexpected script errors', unexpected.join(' | ').slice(0, 400));
  await browser.close();
  console.log(failures ? '\n' + failures + ' party booking contract check(s) failed.' : '\nParty booking contract test passed.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('Contract test crashed:', e.message); process.exit(1); });
