'use strict';
// QA helpers for the redesigned (modular) app. Needs: npm i --no-save playwright @supabase/supabase-js@2.58.0
// Everything runs against a local static server and an in-memory fake backend; no real Supabase project
// is ever contacted (all requests to *.supabase.co are intercepted by Playwright).
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');
const { makeBackend, serve, SB_HOST } = require('./fake-backend.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
// The page loads supabase-js from a CDN; the tests serve the same pinned version from npm instead.
const SUPA = process.env.MM_SUPABASE_UMD || require.resolve('@supabase/supabase-js/dist/umd/supabase.js');

const results = [];
function check(ok, name, detail) {
  results.push({ ok: !!ok, name });
  console.log((ok ? '✓ ' : '✗ ') + name + (!ok && detail !== undefined ? '  — ' + String(detail).slice(0, 300) : ''));
}
function summary(label) {
  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  console.log('\n' + label + ': ' + pass + ' passed, ' + fail + ' failed (' + results.length + ' checks)');
  return fail;
}

async function launch() {
  return chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
}

// opts: {device:'Pixel 7'|null, viewport, init: string (script run before page code), backend}
async function open(browser, srvPort, backend, opts) {
  opts = opts || {};
  const ctxOpts = opts.device ? Object.assign({}, devices[opts.device]) : { viewport: opts.viewport || { width: 1280, height: 800 } };
  ctxOpts.permissions = opts.noCamera ? [] : ['camera'];
  const context = await browser.newContext(ctxOpts);
  await context.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(SUPA) }));
  await context.route('https://' + SB_HOST + '/**', (r) => backend.handle(r));
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|adbhxldsqwsyaqzdmxnf)/, (r) => r.abort('failed'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|\[MM (rpc|waiter|order|pay|party|login|startVisit|serve|p0|gate|kitchen)/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 200)); });
  if (opts.init) await page.addInitScript(opts.init);
  const url = (q) => 'http://127.0.0.1:' + srvPort + '/' + (q || '');
  return { context, page, errors, url };
}

// Scanner test double: BarcodeDetector fed from window.__qr (queue), getUserMedia tracking.
const SCANNER_INIT = `
  window.__qr = []; window.__gum = 0; window.__tracks = [];
  window.BarcodeDetector = class { constructor(o){ this.o=o } static async getSupportedFormats(){ return window.__formats || ['qr_code'] }
    async detect(){ return window.__qr.length ? [{ rawValue: window.__qr.shift() }] : [] } };
  const real = navigator.mediaDevices && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  if (real) navigator.mediaDevices.getUserMedia = async function (c) {
    window.__gum++;
    if (window.__gumDelay) await new Promise(r => setTimeout(r, window.__gumDelay));
    if (window.__gumFail) { const e = new Error('x'); e.name = window.__gumFail; throw e; }
    const s = await real(c); s.getTracks().forEach(t => window.__tracks.push(t)); return s; };
`;

module.exports = { ROOT, check, summary, launch, open, makeBackend, serve, SCANNER_INIT, devices, results };
