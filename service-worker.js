/* Mirch Masaala PWA service worker.
 * Does not cache app HTML/API data; handles background web-push notifications.
 */
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  event.waitUntil((async function() {
    var data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch (e) { data = { body: event.data ? event.data.text() : '' }; }

    var title = String(data.title || 'Mirch Masaala');
    var body = String(data.body || 'A restaurant update needs your attention.');
    var role = String(data.role || 'waiter');
    var target = String(data.url || './?staff=' + encodeURIComponent(role));
    var options = {
      body: body,
      icon: './icons/mirch-masaala-garden-resto-192.png',
      badge: './icons/mirch-masaala-garden-resto-192.png',
      tag: String(data.tag || 'mirch-masaala-alert'),
      renotify: true,
      requireInteraction: data.requireInteraction !== false,
      data: { url: target, role: role }
    };

    await self.registration.showNotification(title, options);
    if ('setAppBadge' in self.navigator) {
      try { await self.navigator.setAppBadge(1); } catch (e) {}
    }
  })());
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil((async function() {
    var target = new URL(
      (event.notification.data && event.notification.data.url) || './?staff=waiter',
      self.location.href
    ).href;
    var windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < windows.length; i++) {
      var client = windows[i];
      if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
        if ('navigate' in client && client.url !== target) await client.navigate(target);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
