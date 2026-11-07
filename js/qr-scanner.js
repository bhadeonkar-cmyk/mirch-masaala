/* In-app QR scanner — customer table QR only.
 * Prefers native BarcodeDetector when available; falls back to jsQR (pure JS)
 * for iOS Safari / in-app browsers where BarcodeDetector is missing.
 * Keeps existing table/URL validation and camera lifecycle safeguards.
 */
(function () {
  'use strict';
  var stream = null, video = null, frame = 0, scanning = false, overlay = null;
  /* Bumped on every open and close so an async camera start that finishes after the scanner was
   * closed can tell it is stale and release its own camera stream instead of leaking it. */
  var runId = 0;
  var styleId = 'mm-qr-scanner-style';
  var jsQrLoading = null;
  var canvas = null;
  var ctx = null;

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

  /* Stop the camera and detach it from the preview. Safe to call when nothing is open. */
  function releaseStream() {
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    stream = null;
    if (video) { try { video.pause(); } catch (err) {} video.srcObject = null; }
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

  /* Existing security rules: only accept same-origin ?table=NN or bare 1–2 digit table id. */
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

  function ensureJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (jsQrLoading) return jsQrLoading;
    jsQrLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
      s.async = true;
      s.onload = function () {
        if (window.jsQR) resolve(window.jsQR);
        else reject(new Error('jsQR failed to load'));
      };
      s.onerror = function () { reject(new Error('jsQR network error')); };
      document.head.appendChild(s);
    });
    return jsQrLoading;
  }

  function getCanvas() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    return canvas;
  }

  async function scanLoopBarcode(detector) {
    if (!scanning || !video || video.readyState < 2) {
      if (scanning) frame = requestAnimationFrame(function () { scanLoopBarcode(detector); });
      return;
    }
    try {
      var codes = await detector.detect(video);
      if (!scanning) return;
      if (codes && codes.length && codes[0].rawValue) {
        if (useScannedValue(codes[0].rawValue)) return;
      }
    } catch (e) {
      status('Camera scan paused. Please keep the QR code inside the frame.');
    }
    if (scanning) frame = requestAnimationFrame(function () { scanLoopBarcode(detector); });
  }

  function scanLoopJsQR(jsQR) {
    if (!scanning || !video || video.readyState < 2) {
      if (scanning) frame = requestAnimationFrame(function () { scanLoopJsQR(jsQR); });
      return;
    }
    try {
      var w = video.videoWidth;
      var h = video.videoHeight;
      if (w && h) {
        var c = getCanvas();
        /* Downscale for performance on older phones while keeping enough detail for QR. */
        var maxSide = 640;
        var scale = Math.min(1, maxSide / Math.max(w, h));
        var cw = Math.max(1, Math.floor(w * scale));
        var ch = Math.max(1, Math.floor(h * scale));
        if (c.width !== cw || c.height !== ch) {
          c.width = cw;
          c.height = ch;
        }
        ctx.drawImage(video, 0, 0, cw, ch);
        var imageData = ctx.getImageData(0, 0, cw, ch);
        var code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        if (!scanning) return;
        if (code && code.data) {
          if (useScannedValue(code.data)) return;
        }
      }
    } catch (e) {
      status('Camera scan paused. Please keep the QR code inside the frame.');
    }
    if (scanning) frame = requestAnimationFrame(function () { scanLoopJsQR(jsQR); });
  }

  function showFallback(message) {
    if (!overlay) return;
    status(message + ' You can also open your phone camera, scan the table sticker, and open its link.');
    var wrap = overlay.querySelector('.mm-qr-video-wrap');
    if (wrap) wrap.hidden = true;
    var manual = overlay.querySelector('[data-qr-manual]');
    if (manual) manual.hidden = false;
  }

  async function startWithBarcodeDetector(myRun) {
    var supported = await window.BarcodeDetector.getSupportedFormats();
    if (myRun !== runId) return false;
    if (supported.indexOf('qr_code') < 0) return false;
    var detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    var media = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    if (myRun !== runId) {
      media.getTracks().forEach(function (track) { track.stop(); });
      return true;
    }
    stream = media;
    video = overlay.querySelector('video');
    video.srcObject = stream;
    await video.play();
    if (myRun !== runId) return true;
    scanning = true;
    status('Point your camera at the QR sticker on your table.');
    frame = requestAnimationFrame(function () { scanLoopBarcode(detector); });
    return true;
  }

  async function startWithJsQR(myRun) {
    var jsQR = await ensureJsQR();
    if (myRun !== runId) return;
    var media = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    if (myRun !== runId) {
      media.getTracks().forEach(function (track) { track.stop(); });
      return;
    }
    stream = media;
    video = overlay.querySelector('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    if (myRun !== runId) return;
    scanning = true;
    status('Point your camera at the QR sticker on your table.');
    frame = requestAnimationFrame(function () { scanLoopJsQR(jsQR); });
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
      '<div class="mm-qr-video-wrap"><video class="mm-qr-video" playsinline muted webkit-playsinline></video><div class="mm-qr-frame"></div></div>' +
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

    try {
      var usedNative = false;
      if ('BarcodeDetector' in window) {
        try {
          usedNative = await startWithBarcodeDetector(myRun);
        } catch (nativeErr) {
          usedNative = false;
          /* The native attempt may already have opened the camera (e.g. video.play() was rejected).
           * Release it before the jsQR fallback opens its own stream, or the first one stays on. */
          releaseStream();
        }
      }
      if (myRun !== runId) return;
      if (!usedNative) {
        status('Loading scanner…');
        await startWithJsQR(myRun);
      }
    } catch (e) {
      if (myRun !== runId) return;
      releaseStream();
      showFallback(e && e.name === 'NotAllowedError'
        ? 'Camera permission was denied.'
        : (e && e.message && /jsQR/.test(e.message)
          ? 'Could not load the QR decoder.'
          : 'Could not start the camera.'));
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
