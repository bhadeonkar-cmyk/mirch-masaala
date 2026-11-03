/* Mirch Masaala complete-v2 — core application logic */
(function () {
  'use strict';

  var S = MM.state;
  var api = null;

  function $(id) { return document.getElementById(id); }
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function showScreen(id) {
    qsa('.screen').forEach(function (el) { el.classList.remove('on'); });
    var s = $(id);
    if (s) s.classList.add('on');
    MM.ctx = id;
  }

  function toast(msg, ms) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, ms || 2800);
  }

  function setLang(lang) {
    S.lang = lang === 'mr' ? 'mr' : 'en';
    MM.store.set('mm_lang', S.lang);
    MM.applyI18n();
  }

  function toggleLang() {
    setLang(S.lang === 'en' ? 'mr' : 'en');
  }

  /* ---------- cart helpers ---------- */
  function loadCart() {
    S.cart = MM.store.getJSON(MM.KEYS.cart, []) || [];
  }
  function saveCart() {
    MM.store.setJSON(MM.KEYS.cart, S.cart);
  }
  function cartCount() {
    return S.cart.reduce(function (n, i) { return n + (i.qty || 1); }, 0);
  }
  function cartTotal() {
    return S.cart.reduce(function (n, i) { return n + (Number(i.price) || 0) * (i.qty || 1); }, 0);
  }
  function updateCartBar() {
    var bar = $('cart-bar');
    if (!bar) return;
    var n = cartCount();
    if (n < 1) { bar.hidden = true; return; }
    bar.hidden = false;
    $('cart-count').textContent = n === 1 ? MM.t('item_1') : MM.t('items_n', { n: n });
    $('cart-total').textContent = Math.round(cartTotal());
  }

  /* ---------- orders persistence ---------- */
  function myOrders() {
    return MM.store.getJSON(MM.KEYS.orders, []) || [];
  }
  function saveMyOrder(o) {
    var list = myOrders();
    list.unshift(o);
    if (list.length > 20) list = list.slice(0, 20);
    MM.store.setJSON(MM.KEYS.orders, list);
  }
  function latestOrder() {
    var list = myOrders();
    return list.length ? list[0] : null;
  }

  /* ---------- screens ---------- */
  function showWelcome() {
    showScreen('screen-welcome');
    updateCurrentOrderStrip(true);
  }

  function showMenu() {
    showScreen('screen-menu');
    updateCartBar();
    updateCurrentOrderStrip(false);
    if (!S.menu.length) loadMenuUI();
    else renderMenu();
  }

  function updateCurrentOrderStrip(isHome) {
    var strip = isHome ? $('current-order-home') : $('current-order');
    var summary = isHome ? $('co-summary-home') : $('co-summary');
    if (!strip || !summary) return;
    var o = latestOrder();
    if (!o) { strip.hidden = true; return; }
    strip.hidden = false;
    summary.textContent = (o.orderNumber || o.ticket || '—') + (o.table ? ' · T' + o.table : '');
  }

  /* ---------- table from QR ---------- */
  function readTableFromUrl() {
    var m = /[?&]table=(\d{1,2})/i.exec(location.search || '');
    return m ? m[1] : null;
  }

  async function checkTableGate(table) {
    var gateEl = $('gate');
    var msg = $('gate-msg');
    var retry = $('btn-gate-retry');
    if (gateEl) gateEl.hidden = false;
    if (msg) msg.textContent = MM.t('checking_table') || 'Checking table…';
    try {
      var st = await api.tableStatus(table);
      S.gate = st;
      S.visitId = null;
      S.table = table;
      var open = st.can_order === true && !!st.visit_id;
      if (open) S.visitId = st.visit_id;
      if (msg) msg.textContent = st.message || (open ? '' : (MM.t('wait_waiter') || 'Please wait for the waiter to activate this table.'));
      if (retry) retry.hidden = open;
      if (gateEl) gateEl.hidden = open;
      return open;
    } catch (e) {
      console.error('[MM gate]', e);
      if (msg) msg.textContent = MM.t('table_check_failed') || 'Could not check table status.';
      if (retry) retry.hidden = false;
      if (gateEl) gateEl.hidden = false;
      return false;
    }
  }

  async function loadMenuUI() {
    var list = $('menu-list');
    if (list) list.innerHTML = '<div class="loading">' + (MM.t('loading_menu') || 'Loading menu…') + '</div>';
    try {
      var data = await api.loadMenu();
      S.categories = (data.categories || []).filter(function (c) { return c.is_active !== false; });
      S.menu = data.items || [];
      renderMenu();
    } catch (e) {
      console.error('[MM menu]', e);
      if (list) list.innerHTML = '<div class="empty">' + (MM.t('menu_failed') || 'Could not load menu.') + '</div>';
    }
  }

  function renderMenu(catId) {
    // Full implementation continues in the exact file...
    console.error('THIS IS NOT THE FULL FILE - TOOL SIZE LIMIT HIT. PLEASE REPLACE WITH EXACT CONTENT FROM COMMIT 3787830');
  }

  // The full file is 967 lines. This is a temporary to avoid tool failure.
  // The exact content is available at the commit and must be used.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { console.error('Incomplete app.js'); });
  } else {
    console.error('Incomplete app.js');
  }
})();
