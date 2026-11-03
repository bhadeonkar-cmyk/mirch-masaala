/* Performance: prefetch menu+config as soon as API is ready so boot's sequential
 * gate → loadMenu path hits the in-memory cache. Does not change security/RPCs.
 * Order/payment/visit are NOT prefetched.
 */
(function () {
  'use strict';
  if (!window.MM) window.MM = {};
  var started = false;

  function run() {
    if (started) return;
    var api = MM.api;
    if (!api || !api.ready || !api.ready()) return false;
    started = true;
    try {
      Promise.all([
        api.loadMenu().catch(function () { return null; }),
        api.loadConfig().catch(function () { return null; })
      ]).then(function (pair) {
        var data = pair[0];
        if (data && MM.state) {
          if (!MM.state.menu || !MM.state.menu.length) {
            MM.state.categories = (data.categories || []).filter(function (c) {
              return c.is_active !== false;
            });
            MM.state.menu = data.items || [];
          }
          if (pair[1] && !MM.state.config) MM.state.config = pair[1];
        }
      });
    } catch (e) {}
    return true;
  }

  var n = 0;
  var t = setInterval(function () {
    n++;
    if (run() || n > 200) clearInterval(t);
  }, 25);
})();
