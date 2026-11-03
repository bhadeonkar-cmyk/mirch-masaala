/* Gate-aware customer startup.
 *
 * With ?table=XX:
 *  - Do NOT fetch menu/config until table is active (visitId set by gate).
 *  - Clear stuck "Loading menu…" while gate shows wait/activate message.
 *  - After activation, menu+config load in parallel (supabase.js cache).
 *
 * Without table QR: optional menu prefetch for "View Menu".
 * Never prefetches order/payment/visit.
 */
(function () {
  'use strict';
  if (!window.MM) window.MM = {};

  function tableFromUrl() {
    var m = /[?&]table=(\d{1,2})/i.exec(location.search || '');
    return m ? m[1] : null;
  }

  function $(id) { return document.getElementById(id); }

  function tableIsActive() {
    return !!(MM.state && MM.state.visitId);
  }

  function gateVisible() {
    var gate = $('gate');
    return !!(gate && !gate.hidden);
  }

  function clearMenuShell() {
    var list = $('menu-list');
    if (list) list.innerHTML = '';
    var cats = $('categories');
    if (cats) cats.innerHTML = '';
  }

  /** Block network menu fetch until table is active when using a table QR. */
  function wrapLoadMenu() {
    var api = MM.api;
    if (!api || api._gateAwareLoad) return !!api;
    if (!api.loadMenu) return false;
    api._gateAwareLoad = true;
    var real = api.loadMenu.bind(api);
    api.loadMenu = function () {
      if (tableFromUrl() && !tableIsActive()) {
        return Promise.resolve({ categories: [], items: [] });
      }
      return real();
    };
    return true;
  }

  var menuFetchStarted = false;

  function fetchMenuWhenAllowed() {
    if (menuFetchStarted) return;
    if (!MM.api || !MM.api.ready || !MM.api.ready()) return;
    if (tableFromUrl() && !tableIsActive()) return;
    menuFetchStarted = true;
    Promise.all([
      MM.api.loadMenu().catch(function () { return null; }),
      MM.api.loadConfig().catch(function () { return null; })
    ]).then(function (pair) {
      var data = pair[0];
      if (!data || !MM.state) return;
      if (!MM.state.menu || !MM.state.menu.length) {
        MM.state.categories = (data.categories || []).filter(function (c) {
          return c.is_active !== false;
        });
        MM.state.menu = data.items || [];
      }
      if (pair[1] && !MM.state.config) MM.state.config = pair[1];
    });
  }

  function onGatePresentation() {
    wrapLoadMenu();
    if (!tableFromUrl()) return;
    if (gateVisible() && !tableIsActive()) {
      clearMenuShell();
      menuFetchStarted = false;
    }
    if (tableIsActive()) fetchMenuWhenAllowed();
  }

  function start() {
    var n = 0;
    var boot = setInterval(function () {
      n++;
      if (wrapLoadMenu() || n > 200) clearInterval(boot);
    }, 20);

    var gate = $('gate');
    if (gate) {
      new MutationObserver(onGatePresentation)
        .observe(gate, { attributes: true, attributeFilter: ['hidden', 'class'] });
    }

    var lastVisit = null;
    setInterval(function () {
      wrapLoadMenu();
      var v = MM.state && MM.state.visitId;
      if (v && v !== lastVisit) {
        lastVisit = v;
        menuFetchStarted = false;
        fetchMenuWhenAllowed();
      }
      if (tableFromUrl() && gateVisible() && !tableIsActive()) {
        clearMenuShell();
      }
    }, 120);

    if (!tableFromUrl()) {
      var p = 0;
      var t = setInterval(function () {
        p++;
        if ((MM.api && MM.api.ready && MM.api.ready() && (fetchMenuWhenAllowed(), true)) || p > 200) {
          clearInterval(t);
        }
      }, 25);
    } else {
      onGatePresentation();
      setTimeout(onGatePresentation, 50);
      setTimeout(onGatePresentation, 150);
      setTimeout(onGatePresentation, 400);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
