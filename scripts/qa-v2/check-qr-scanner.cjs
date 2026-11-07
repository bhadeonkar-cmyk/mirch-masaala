'use strict';
const L = require('./lib.cjs');
const { check } = L;

(async () => {
  const { srv, port } = await L.serve(L.ROOT);
  const browser = await L.launch();
  const origin = 'http://127.0.0.1:' + port;
  const tracksEnded = (page) => page.evaluate(() => window.__tracks.length > 0 && window.__tracks.every((t) => t.readyState === 'ended'));
  const overlay = (page) => page.locator('.mm-qr-overlay').count();
  const statusText = (page) => page.locator('[data-qr-status]').textContent();

  for (const env of [
    { label: 'Android Chrome (Pixel 7 emulation)', device: 'Pixel 7' },
    { label: 'Desktop Chrome 1280x800', device: null }
  ]) {
    const L_ = env.label;
    const be = L.makeBackend();
    // --- valid scan
    let s = await L.open(browser, port, be, { device: env.device, init: L.SCANNER_INIT });
    await s.page.goto(s.url(''), { waitUntil: 'load' });
    await s.page.waitForSelector('#btn-scan-qr');
    if (env.device) check(/Android/.test(await s.page.evaluate(() => navigator.userAgent)), L_ + ': emulated UA is Android Chrome');
    await s.page.locator('#btn-scan-qr').click();
    await s.page.waitForSelector('.mm-qr-overlay');
    check((await overlay(s.page)) === 1, L_ + ': Scan button opens the scanner overlay');
    check(!(await s.page.locator('#toast').isVisible().catch(() => false)), L_ + ': app.js "scan hint" toast is suppressed (scanner click handler wins)');
    await s.page.waitForFunction(() => /Point your camera/.test(document.querySelector('[data-qr-status]').textContent), null, { timeout: 8000 }).catch(() => {});
    check(/Point your camera/.test(await statusText(s.page)), L_ + ': camera starts, status says to point at the QR', await statusText(s.page));
    check(await s.page.evaluate(() => window.__gum === 1 && window.__tracks.length === 1 && window.__tracks[0].readyState === 'live'), L_ + ': exactly one live camera track while scanning');
    // wrong QRs first: scanner must keep going
    await s.page.evaluate((o) => { window.__qr.push('https://evil.example/?table=03'); }, origin);
    await s.page.waitForFunction(() => /not a valid Mirch Masaala/.test(document.querySelector('[data-qr-status]').textContent), null, { timeout: 5000 }).catch(() => {});
    check(/not a valid Mirch Masaala/.test(await statusText(s.page)), L_ + ': foreign-origin QR is rejected with a clear message');
    check((await overlay(s.page)) === 1 && s.page.url() === s.url(''), L_ + ': rejected QR neither navigates nor closes scanner');
    for (const bad of ['hello world', '123', origin + '/?table=abc', origin + '/?table=', 'javascript:alert(1)', '00x']) {
      await s.page.evaluate((v) => { window.__qr.push(v); }, bad);
      await s.page.waitForTimeout(250);
    }
    check((await overlay(s.page)) === 1 && s.page.url() === s.url(''), L_ + ': junk / 3-digit / non-numeric / javascript: QRs never navigate');
    await s.page.evaluate((o) => { window.__qr.push(o + '/?table=5'); }, origin);
    await s.page.waitForURL('**/?table=05', { timeout: 8000 }).catch(() => {});
    check(s.page.url() === s.url('?table=05'), L_ + ': valid table QR (/?table=5) navigates to ?table=05 after earlier bad scans', s.page.url());
    await s.context.close();

    // --- bare digits QR payload
    s = await L.open(browser, port, be, { device: env.device, init: L.SCANNER_INIT });
    await s.page.goto(s.url(''), { waitUntil: 'load' });
    await s.page.locator('#btn-scan-qr').click();
    await s.page.waitForFunction(() => /Point your camera/.test(document.querySelector('[data-qr-status]').textContent), null, { timeout: 8000 });
    await s.page.evaluate(() => { window.__qr.push('7'); });
    await s.page.waitForURL('**/?table=07', { timeout: 8000 }).catch(() => {});
    check(s.page.url() === s.url('?table=07'), L_ + ': bare "7" QR payload is accepted as table 07', s.page.url());
    await s.context.close();

    // --- close button / Escape release camera
    s = await L.open(browser, port, be, { device: env.device, init: L.SCANNER_INIT });
    await s.page.goto(s.url(''), { waitUntil: 'load' });
    await s.page.locator('#btn-scan-qr').click();
    await s.page.waitForFunction(() => window.__tracks.length === 1 && window.__tracks[0].readyState === 'live');
    await s.page.locator('.mm-qr-close').click();
    check((await overlay(s.page)) === 0 && (await tracksEnded(s.page)), L_ + ': Close (×) removes overlay and stops the camera');
    await s.page.locator('#btn-scan-qr').click();
    await s.page.waitForFunction(() => window.__tracks.length === 2 && window.__tracks[1].readyState === 'live');
    await s.page.keyboard.press('Escape');
    check((await overlay(s.page)) === 0 && (await tracksEnded(s.page)), L_ + ': Escape closes scanner and stops the camera; reopen works');
    await s.context.close();

    // --- close while getUserMedia pending
    s = await L.open(browser, port, be, { device: env.device, init: L.SCANNER_INIT + 'window.__gumDelay = 600;' });
    await s.page.goto(s.url(''), { waitUntil: 'load' });
    await s.page.locator('#btn-scan-qr').click();
    await s.page.waitForTimeout(150);
    await s.page.locator('[data-qr-cancel]').click();
    await s.page.waitForTimeout(1200);
    check((await tracksEnded(s.page)), L_ + ': closing while the camera is still opening releases the late stream (no leaked camera)');
    check(s.errors.length === 0, L_ + ': no script errors in that race', s.errors.join(' | '));
    await s.context.close();

    // --- no native BarcodeDetector (Firefox / iOS Safari / desktop Windows-Linux Chrome): jsQR fallback decodes in JS
    s = await L.open(browser, port, be, { device: env.device, init: 'delete window.BarcodeDetector; window.__tracks = []; const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async (c) => { const m = await g(c); m.getTracks().forEach((x) => window.__tracks.push(x)); return m; };' });
    await s.page.goto(s.url(''), { waitUntil: 'load' });
    await s.page.locator('#btn-scan-qr').click();
    await s.page.waitForFunction(() => window.__tracks.length === 1 && window.__tracks[0].readyState === 'live', null, { timeout: 8000 }).catch(() => {});
    check(await s.page.evaluate(() => window.__tracks.length === 1 && window.__tracks[0].readyState === 'live') && await s.page.locator('.mm-qr-video-wrap').isVisible(), L_ + ': no BarcodeDetector -> jsQR decoder loads and the camera preview stays open', await statusText(s.page));
    check(!/Could not|not supported/.test(await statusText(s.page)), L_ + ': no error shown on the jsQR path', await statusText(s.page));
    await s.page.locator('.mm-qr-close').click();
    check(await tracksEnded(s.page), L_ + ': closing the jsQR scanner stops the camera');
    check(s.errors.length === 0, L_ + ': no script errors on the jsQR path', s.errors.join(' | '));
    await s.context.close();

    // --- decoder cannot be downloaded (offline) -> graceful fallback, camera not left on
    s = await L.open(browser, port, be, { device: env.device, blockJsQR: true, init: 'delete window.BarcodeDetector; window.__tracks = []; const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async (c) => { const m = await g(c); m.getTracks().forEach((x) => window.__tracks.push(x)); return m; };' });
    await s.page.goto(s.url(''), { waitUntil: 'load' });
    await s.page.locator('#btn-scan-qr').click();
    await s.page.waitForFunction(() => /decoder|camera/i.test(document.querySelector('[data-qr-status]').textContent) && !/Loading|Starting/.test(document.querySelector('[data-qr-status]').textContent), null, { timeout: 8000 }).catch(() => {});
    check(/QR decoder/.test(await statusText(s.page)) && await s.page.locator('[data-qr-manual]').isVisible() && await s.page.locator('.mm-qr-video-wrap').isHidden(), L_ + ': decoder download blocked -> clear message + "use your phone camera" hint, video hidden', await statusText(s.page));
    check(await s.page.evaluate(() => window.__tracks.every((x) => x.readyState === 'ended')), L_ + ': camera released when the decoder fails to load');
    await s.context.close();

    // --- BarcodeDetector exists but cannot read QR -> falls back to jsQR instead of dead-ending
    s = await L.open(browser, port, be, { device: env.device, init: L.SCANNER_INIT + 'window.__formats = ["ean_13"];' });
    await s.page.goto(s.url(''), { waitUntil: 'load' });
    await s.page.locator('#btn-scan-qr').click();
    await s.page.waitForFunction(() => window.__tracks.length >= 1 && window.__tracks.some((x) => x.readyState === 'live'), null, { timeout: 8000 }).catch(() => {});
    check(await s.page.evaluate(() => window.__tracks.some((x) => x.readyState === 'live')) && !/Could not|not supported/.test(await statusText(s.page)), L_ + ': BarcodeDetector without qr_code -> jsQR fallback keeps scanning', await statusText(s.page));
    await s.context.close();

    // --- permission denied
    s = await L.open(browser, port, be, { device: env.device, init: L.SCANNER_INIT + 'window.__gumFail = "NotAllowedError";' });
    await s.page.goto(s.url(''), { waitUntil: 'load' });
    await s.page.locator('#btn-scan-qr').click();
    await s.page.waitForTimeout(400);
    check(/permission was denied/.test(await statusText(s.page)) && await s.page.locator('[data-qr-manual]').isVisible(), L_ + ': camera permission denied -> clear fallback message', await statusText(s.page));
    await s.context.close();

    // --- play() rejects after the stream was acquired
    s = await L.open(browser, port, be, { device: env.device, init: L.SCANNER_INIT + 'HTMLVideoElement.prototype.play = () => Promise.reject(new Error("play blocked"));' });
    await s.page.goto(s.url(''), { waitUntil: 'load' });
    await s.page.locator('#btn-scan-qr').click();
    await s.page.waitForTimeout(500);
    const live = await s.page.evaluate(() => window.__tracks.filter((t) => t.readyState === 'live').length);
    check(live === 0, L_ + ': if video.play() fails the camera is released immediately (fallback shown)', live + ' camera track(s) still live while fallback message is displayed');
    await s.context.close();
  }

  const fail = L.summary('QR scanner');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH', e); process.exit(2); });
