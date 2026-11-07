/* Mirch Masaala — table QR codes (owner tools).
 *
 * A table QR encodes exactly   <this site's origin + path>?table=NN   and nothing else.
 *  - NN is the table number as 2 digits (01-99), the same shape the customer page and the
 *    in-app scanner (js/qr-scanner.js: same-origin ?table=NN) accept.
 *  - There is no field to type a different address, so a sticker can never redirect to an
 *    external site: the origin is always the page the owner is using right now.
 * Encoding uses the vendored MIT-licensed qrcode-generator (js/vendor/qrcode-generator.js).
 * Everything here is client-side; nothing is stored and no backend call is made.
 */
(function () {
  'use strict';
  var MM = window.MM = window.MM || {};
  var escapeHtml = MM.escapeHtml || function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var t = function (k, v) { return MM.t ? MM.t(k, v) : k; };

  /** "5" -> "05"; anything that is not 1-2 digits -> null. */
  function tableId(n) {
    var s = String(n == null ? '' : n).trim();
    if (!/^\d{1,2}$/.test(s)) return null;
    return s.length === 1 ? '0' + s : s;
  }

  /** The site address guests will open: current origin + path (index.html stripped). */
  function baseUrl() {
    var path = String(location.pathname || '/').replace(/index\.html$/i, '');
    return location.origin + path;
  }

  function tableUrl(n) {
    var id = tableId(n);
    if (!id) throw new Error('Invalid table number');
    return baseUrl() + '?table=' + id;
  }

  /** True when the page is not served from a real public address (QR would be useless to guests). */
  function isTestHost() {
    var h = String(location.hostname || '');
    return location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' ||
      /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || /\.local$/i.test(h);
  }

  function matrix(url) {
    if (typeof window.qrcode !== 'function') throw new Error('QR encoder not loaded');
    var q = window.qrcode(0, 'M');           /* auto version, medium error correction */
    q.addData(String(url), 'Byte');
    q.make();
    return q;
  }

  var QUIET = 4;                              /* quiet zone in modules (QR spec minimum) */

  /** Crisp, scalable SVG of the QR for `url`. */
  function svg(url) {
    var q = matrix(url), n = q.getModuleCount(), d = [];
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (q.isDark(r, c)) d.push('M' + (c + QUIET) + ' ' + (r + QUIET) + 'h1v1h-1z');
      }
    }
    var size = n + QUIET * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" ' +
      'shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="' + size + '" height="' + size +
      '" fill="#fff"/><path d="' + d.join('') + '" fill="#000"/></svg>';
  }

  /** Printable / previewable sticker: brand, QR, big table number, call to action. */
  function stickerHtml(n) {
    var id = tableId(n), url = tableUrl(id);
    return '<div class="qr-sticker" data-qr-sticker="' + id + '">' +
      '<div class="qr-brand">MIRCH MASAALA</div>' +
      '<div class="qr-brand-sub">' + escapeHtml(t('indian_restaurant')) + '</div>' +
      '<div class="qr-code">' + svg(url) + '</div>' +
      '<div class="qr-table">' + escapeHtml(t('qr_table')) + ' ' + id + '</div>' +
      '<div class="qr-cta">' + escapeHtml(t('qr_scan_to_order')) + '</div>' +
      '<div class="qr-url">' + escapeHtml(url) + '</div></div>';
  }

  /** Draw the sticker on a canvas and hand back a PNG blob (for download / sharing). */
  function canvasFor(n) {
    var id = tableId(n), url = tableUrl(id), q = matrix(url), count = q.getModuleCount();
    var W = 900, H = 1200, pad = 60, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(18, 18, W - 36, H - 36);
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = '700 74px Georgia, "Times New Roman", serif'; g.fillText('MIRCH MASAALA', W / 2, 140);
    g.font = '400 34px Arial, sans-serif'; g.fillText(t('indian_restaurant'), W / 2, 196);
    /* QR: integer pixels per module keeps edges sharp; includes the quiet zone */
    var total = count + QUIET * 2, box = W - pad * 2 - 80, px = Math.floor(box / total), qs = px * total;
    var x0 = Math.round((W - qs) / 2), y0 = 250;
    g.fillStyle = '#fff'; g.fillRect(x0, y0, qs, qs);
    g.fillStyle = '#000';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (q.isDark(r, c)) g.fillRect(x0 + (c + QUIET) * px, y0 + (r + QUIET) * px, px, px);
      }
    }
    g.fillStyle = '#111';
    g.font = '800 120px Arial, sans-serif'; g.fillText(t('qr_table') + ' ' + id, W / 2, y0 + qs + 150);
    g.font = '600 46px Arial, sans-serif'; g.fillText(t('qr_scan_to_order'), W / 2, y0 + qs + 222);
    g.font = '400 28px Arial, sans-serif'; g.fillStyle = '#444'; g.fillText(url, W / 2, H - 70);
    return cv;
  }

  function download(n) {
    var id = tableId(n);
    if (!id) return Promise.reject(new Error('Invalid table number'));
    var cv = canvasFor(id);
    return new Promise(function (resolve, reject) {
      cv.toBlob(function (blob) {
        if (!blob) { reject(new Error('PNG export failed')); return; }
        var a = document.createElement('a'), href = URL.createObjectURL(blob);
        a.href = href; a.download = 'mirch-masaala-table-' + id + '-qr.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(href); }, 4000);
        resolve(a.download);
      }, 'image/png');
    });
  }

  /** Print one or many stickers using the browser's own print dialog (no popup window). */
  function print(numbers) {
    var ids = (numbers || []).map(tableId).filter(Boolean);
    if (!ids.length) return false;
    var old = document.getElementById('qr-print-root');
    if (old) old.remove();
    var root = document.createElement('div');
    root.id = 'qr-print-root';
    root.innerHTML = '<div class="qr-sheet">' + ids.map(stickerHtml).join('') + '</div>';
    document.body.appendChild(root);
    document.body.classList.add('mm-printing');
    var finished = false;
    function cleanup() {
      if (finished) return;
      finished = true;
      window.removeEventListener('afterprint', cleanup);
      document.body.classList.remove('mm-printing');
      root.remove();
    }
    window.addEventListener('afterprint', cleanup);
    setTimeout(function () { try { window.print(); } catch (e) { cleanup(); } }, 60);
    setTimeout(cleanup, 180000);              /* safety net if afterprint never fires */
    return true;
  }

  MM.qr = { tableId: tableId, baseUrl: baseUrl, tableUrl: tableUrl, isTestHost: isTestHost, svg: svg,
    stickerHtml: stickerHtml, canvasFor: canvasFor, download: download, print: print };
})();
