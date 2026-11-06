/* In-app QR scanner — customer table QR only. Uses the browser's native BarcodeDetector. */
(function () {
  'use strict';
  var stream = null, video = null, frame = 0, scanning = false, overlay = null;
  /* Bumped on every open and close so an async camera start that finishes after the scanner was
   * closed can tell it is stale and release its own camera stream instead of leaking it. */
  var runId = 0;
  var styleId = 'mm-qr-scanner-style';

  function addStyles() {
    if (document.getElementById(styleId)) return;
    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      '.mm-qr-overlay{position:fixed;inset:0;z-index:9999;background:rgba(10,8,6,.94);display:flex;align-items:center;justify-content:center;padding:18px}',
      '.mm-qr-panel{width:min(100%,480px);background:#1c1713;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:22px;padding:18px;box-shadow:0 24px 80px rgba(0,0,0,.5)}',
      '.mm-qr-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}',
      '.mm-qr-head h2{font-size:19px;margin:0}.mm-qr-close{border:0;background:#342b24;color:#fff;border-radius:50%;width:40px;height:40px;font-size:24px}',
      '.mm-qr-video-wrap{position:relative;overflow:hidden;border-radius:16px;background:#080706;aspect-ratio:4/3}',
      '.mm-qr-video{width:100%;height:100%;object-fit:cover}',
      '.mm-qr-frame{position:absolute;inset:15%;border:2px solid #e8bd77;border-radius:18px;box-shadow:0 0 0 999px rgba(0,0,0,.18);pointer-events:none}',
      '.mm-qr-status{font-size:14px;color:#d6c9bb;min-height:42px;padding:12px 2px 4px}',
      '.mm-qr-actions{display:flex;gap:10px;margin-top:8px}.mm-qr-actions button{flex:1}',
      '.mm-qr-manual{font-size:13px;color:#c9b9a7;line-height:1.5;margin:8px 0 0}'
    ].join('');
    document.head.appendChild(style);
  }

  function closeScanner() {
    runId++;
    scanning = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    stream = null;
    if (video) { video.pause(); video.srcObject = null; }
    video = null;
    if (overlay) overlay.remove();
    overlay = null;
  }

  function status(message) {
    var el = overlay && overlay.querySelector('[data-qr-status]');
    if (el) el.textContent = message;
  }

  function useScannedValue(value) {
    var raw = String(value || '').trim();
    var table = '';
    try {
      var parsed = new URL(raw, location.href);
      if (parsed.origin === location.origin) table = parsed.searchParams.get('table') || '';
    } catch (e) {}
    if (!table && /^\d{1,2}$/.test(raw)) table = raw;
    if (!/^\d{1,2}$/.test(table)) {
      status('This QR code is not a valid Mirch Masaala table QR. Please scan the QR sticker on your table.');
      return false;
    }
    closeScanner();
    var target = new URL(location.href);
    target.searchParams.set('table', String(Number(table)).padStart(2, '0'));
    location.assign(target.toString());
    return true;
  }

  async function scanLoop(detector) {
    if (!scanning || !video || video.readyState < 2) {
      if (scanning) frame = requestAnimationFrame(function () { scanLoop(detector); });
      return;
    }
    try {
      var codes = await detector.detect(video);
      /* The guest may have closed the scanner while this frame was being analysed. */
      if (!scanning) return;
      if (codes && codes.length && codes[0].rawValue) {
        /* Stop only when the code was accepted. A wrong QR keeps the scanner running so the
         * guest can simply point the camera at the right sticker. */
        if (useScannedValue(codes[0].rawValue)) return;
      }
    } catch (e) {
      status('Camera scan paused. Please keep the QR code inside the frame.');
    }
    if (scanning) frame = requestAnimationFrame(function () { scanLoop(detector); });
  }

  function showFallback(message) {
    if (!overlay) return; /* scanner was closed while the camera was starting */
    status(message + ' You can also open your phone camera, scan the table sticker, and open its link.');
    var wrap = overlay.querySelector('.mm-qr-video-wrap');
    if (wrap) wrap.hidden = true;
    var manual = overlay.querySelector('[data-qr-manual]');
    if (manual) manual.hidden = false;
  }

  async function openScanner() {
    if (overlay) return;
    var myRun = ++runId;
    addStyles();
    overlay = document.createElement('div');
    overlay.className = 'mm-qr-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Scan table QR code');
    overlay.innerHTML = '<section class="mm-qr-panel">' +
      '<div class="mm-qr-head"><h2>Scan your table QR</h2><button class="mm-qr-close" type="button" aria-label="Close scanner">×</button></div>' +
      '<div class="mm-qr-video-wrap"><video class="mm-qr-video" playsinline muted></video><div class="mm-qr-frame"></div></div>' +
      '<div class="mm-qr-status" data-qr-status>Starting camera…</div>' +
      '<p class="mm-qr-manual" data-qr-manual hidden>Allow camera access and use the rear camera. If scanning is unavailable, use your phone camera to scan the table sticker.</p>' +
      '<div class="mm-qr-actions"><button class="btn btn-soft" type="button" data-qr-cancel>Close</button></div>' +
      '</section>';
    document.body.appendChild(overlay);
    overlay.querySelector('.mm-qr-close').addEventListener('click', closeScanner);
    overlay.querySelector('[data-qr-cancel]').addEventListener('click', closeScanner);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) closeScanner(); });

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showFallback('Camera access is not available in this browser.');
      return;
    }
    if (!('BarcodeDetector' in window)) {
      showFallback('In-app QR scanning is not supported by this browser.');
      return;
    }
    try {
      var supported = await window.BarcodeDetector.getSupportedFormats();
      if (myRun !== runId) return;
      if (supported.indexOf('qr_code') < 0) {
        showFallback('QR scanning is not supported by this browser.');
        return;
      }
      var detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      var media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      if (myRun !== runId) {
        /* Closed while the browser was still opening the camera: release it right away. */
        media.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      stream = media;
      video = overlay.querySelector('video');
      video.srcObject = stream;
      await video.play();
      if (myRun !== runId) return; /* closeScanner() already stopped the tracks */
      scanning = true;
      status('Point your camera at the QR sticker on your table.');
      frame = requestAnimationFrame(function () { scanLoop(detector); });
    } catch (e) {
      if (myRun !== runId) return; /* a close interrupted the start; nothing to report */
      showFallback(e && e.name === 'NotAllowedError'
        ? 'Camera permission was denied.'
        : 'Could not start the camera.');
    }
  }

  document.addEventListener('click', function (ev) {
    var button = ev.target && ev.target.closest ? ev.target.closest('#btn-scan-qr') : null;
    if (!button) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    openScanner();
  }, true);

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && overlay) closeScanner();
  });
  window.addEventListener('pagehide', closeScanner);
})();
