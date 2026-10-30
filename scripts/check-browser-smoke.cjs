#!/usr/bin/env node
'use strict';

// Headless-browser smoke test for the customer-facing home screen.
// Runs index.html from disk with all network requests stubbed, so it needs no
// Supabase project. It exists because a script error during page start-up left
// SETTINGS undefined and silently broke Party Booking; static checks cannot see that.
//
// Usage: node scripts/check-browser-smoke.cjs   (needs `playwright` + Chromium)
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('Browser smoke test needs Playwright: npm i playwright && npx playwright install chromium');
  process.exit(2);
}

const indexUrl = 'file://' + path.resolve(process.cwd(), 'index.html');
const results = [];
function check(ok, name, detail) {
  results.push({ ok, name });
  console.log((ok ? '✓ ' : '✗ ') + name + (!ok && detail ? ' — ' + detail : ''));
}
// Messages the app is EXPECTED to log in this offline harness. Anything else is a failure.
//  - the browser's own "Failed to load resource" line for each blocked external request
//  - the app's own warning when the Supabase library cannot be downloaded
//  - the app logging the failure that this test injects on purpose (checked separately)
const EXPECTED_OFFLINE = /^Failed to load resource: net::ERR_(FAILED|BLOCKED_BY_CLIENT|INTERNET_DISCONNECTED)|^\[Mirch Masaala Supabase\] Secure online library failed to load/;
const INJECTED_PARTY_FAILURE = /^\[Mirch Masaala party booking\] Error: We could not save your request just now\./;

async function run(browser, viewport) {
  const label = viewport.label;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: !!viewport.touch
  });
  const requested = [];
  await context.route(/^https?:/, (route) => {
    const req = route.request();
    requested.push(req.resourceType() + ' ' + req.url());
    // Behave like an offline device. The only exception is a top-level page load of the
    // business-enquiries destination, which gets a tiny HTML page so the click can be verified.
    // Never answer scripts or fetches with HTML: that would make the browser run HTML as code.
    if (req.resourceType() === 'document' && /^https:\/\/onkarfx\.in\/?$/.test(req.url())) {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Onkar FX</title>' });
    } else {
      route.abort('failed');
    }
  });
  const page = await context.newPage();
  const pageErrors = [];      // uncaught exceptions and unexpected console errors
  const injectedFailureLogs = [];
  page.on('pageerror', (e) => pageErrors.push('uncaught: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (EXPECTED_OFFLINE.test(text)) return;
    if (INJECTED_PARTY_FAILURE.test(text)) { injectedFailureLogs.push(text); return; }
    pageErrors.push('console.error: ' + text.slice(0, 200));
  });

  await page.goto(indexUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const press = (sel) => (viewport.touch ? page.locator(sel).tap() : page.locator(sel).click());
  const on = (id) => page.evaluate((x) => document.getElementById(x).classList.contains('on'), id);
  const toast = () => page.locator('#toast').textContent();

  check(pageErrors.length === 0, label + ': page starts without script errors', pageErrors.join(' | ').slice(0, 300));
  check(await page.evaluate(() => typeof SETTINGS === 'object' && SETTINGS !== null), label + ': SETTINGS initialised during start-up');

  // A. Places to visit — from Home and from the ordering screen, state preserved.
  await press('#home-explore-link');
  check(await on('explore'), label + ': Places to visit opens from Home');
  check((await page.locator('#places .place').count()) === 6, label + ': six places are listed');
  await press('#explore-back-button');
  check(await on('home'), label + ': back from Places returns Home');
  await page.evaluate(() => {
    table = '05';
    cart = [{ id: 15, name: 'Test dish', price: 100, qty: 2 }];
    go('customer');
    openExploreFromCustomer();
  });
  check(await on('explore'), label + ': Places opens from the ordering screen');
  await press('#explore-back-button');
  check((await on('customer')) && (await page.evaluate(() => cart.length === 1 && cart[0].qty === 2 && table === '05')),
    label + ': back from Places keeps table and cart');
  await page.evaluate(() => { cart = []; go('home'); });

  // B. Party Booking — validation, failure, duplicate taps, success.
  await press('#home-party-link');
  check(await on('party-modal'), label + ': Party Booking form opens');
  await press('#party-submit-btn');
  check(/name/i.test(await toast()), label + ': empty form is rejected (name)');
  await page.fill('#p-name', 'Asha');
  await page.fill('#p-phone', '12345');
  await press('#party-submit-btn');
  check(/10-digit/i.test(await toast()), label + ': invalid phone number is rejected');
  const tomorrow = await page.evaluate(() => new Date(Date.now() + 864e5).toISOString().slice(0, 10));
  await page.fill('#p-phone', '98765 43210');
  await page.fill('#p-date', tomorrow);
  await page.selectOption('#p-time', '19:00');
  await page.fill('#p-guests', '12');

  await page.evaluate(() => { window.MM_SUBMIT_PARTY_BOOKING = () => Promise.reject(new Error('We could not save your request just now.')); });
  await press('#party-submit-btn');
  await page.waitForTimeout(250);
  check(/could not save/i.test(await toast()) &&
    (await page.evaluate(() => getComputedStyle(document.getElementById('party-confirmation')).display === 'none')),
    label + ': a failed submission shows an error and no confirmation');
  check(await page.evaluate(() => !document.getElementById('party-submit-btn').disabled), label + ': submit button is usable again after a failure');

  await page.evaluate(() => {
    window.__partyCalls = 0;
    window.MM_SUBMIT_PARTY_BOOKING = () => { window.__partyCalls++; return new Promise((r) => setTimeout(() => r({ id: 'id-1', booking_ref: 'PB-SMOKE-1' }), 250)); };
    const b = document.getElementById('party-submit-btn'); b.click(); b.click(); b.click();
  });
  await page.waitForTimeout(600);
  check((await page.evaluate(() => window.__partyCalls)) === 1, label + ': repeated taps create one booking request');
  check(await page.evaluate(() => getComputedStyle(document.getElementById('party-confirmation')).display !== 'none' &&
    document.getElementById('party-confirm-ref').textContent === 'PB-SMOKE-1'), label + ': success shows the booking reference');
  await page.evaluate(() => closeParty());

  // C. Business enquiries — the canonical Onkar FX destination opens in a new tab.
  const link = page.locator('a[aria-label="Business enquiries at Onkar FX"]');
  const attrs = await link.evaluate((a) => ({ href: a.href, target: a.target, rel: a.rel }));
  check(attrs.href === 'https://onkarfx.in/' && attrs.target === '_blank' && /noopener/.test(attrs.rel),
    label + ': Business enquiries link has the right destination and safe new-tab attributes', JSON.stringify(attrs));
  const popupPromise = context.waitForEvent('page', { timeout: 4000 }).catch(() => null);
  await (viewport.touch ? link.tap() : link.click());
  const popup = await popupPromise;
  if (popup) await popup.waitForLoadState('domcontentloaded').catch(() => {});
  check(!!popup && requested.some((r) => /^document https:\/\/onkarfx\.in\/?$/.test(r)), label + ': Business enquiries opens https://onkarfx.in/ in a new tab');

  // Language switch keeps these controls working.
  await page.evaluate(() => toggleHomeLanguage());
  await page.waitForTimeout(300);
  check(/भेट/.test(await page.locator('#home-places-to-visit').textContent()), label + ': Marathi label is shown for Places to visit');
  await press('#home-explore-link');
  check(await on('explore'), label + ': Places to visit still opens in Marathi');
  check(pageErrors.length === 0, label + ': no unexpected script errors during the whole flow', pageErrors.join(' | ').slice(0, 300));
  check(injectedFailureLogs.length === 1, label + ': the app logged the injected booking failure exactly once', 'logged ' + injectedFailureLogs.length);
  check(requested.every((r) => /^(script|document|stylesheet|font|image|fetch|xhr|other) https?:/.test(r)) &&
    requested.filter((r) => /supabase-js/.test(r)).length === 1, label + ': the only external script requested is the Supabase library');

  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, { label: 'mobile', width: 390, height: 800, touch: true });
    await run(browser, { label: 'desktop', width: 1280, height: 800 });
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? '\n' + failed.length + ' browser smoke check(s) failed.' : '\nBrowser smoke test passed (' + results.length + ' checks).');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('Browser smoke test crashed:', e.message); process.exit(1); });
