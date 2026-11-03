/* Temporary loader: serve C1-C8 app.js from the base commit via jsDelivr.
 * Full inlined app.js will replace this once transport allows the 36KB blob.
 * P0 lifecycle UI is in js/p0-lifecycle.js (loaded after this from index.html).
 */
(function () {
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/gh/bhadeonkar-cmyk/mirch-masaala@3787830aa75d4b894013bca4af4df5b5f178cbca/js/app.js';
  s.async = false;
  s.onerror = function () {
    if (window.MM && MM.showFatal) MM.showFatal({ message: 'Failed to load app.js from CDN' });
  };
  document.head.appendChild(s);
})();
