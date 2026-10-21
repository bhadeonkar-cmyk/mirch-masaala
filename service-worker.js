/* Mirch Masaala install support.
 * Intentionally does not cache the HTML or API responses: updates stay fresh,
 * while the worker enables the standalone PWA lifecycle for supported browsers.
 */
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
