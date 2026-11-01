/* Mirch Masaala — application controller.
 * Plain JS, no framework. All database text is inserted with textContent (never innerHTML).
 * Staff role always comes from the server (get_my_staff_role); storage is never trusted for role.
 */
(function () {
  'use strict';

  var S = MM.state;
  var api = MM.api;
  var t = MM.t;

  /* ------------------------------------------------------------------ helpers */
  function $(id) { return document.getElementById(id); }

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function mount(el, kids) { clear(el); kids.forEach(function (k) { if (k) el.appendChild(k); }); }
  function rs(n) {
    n = Number(n) || 0;
    return '₹' + (Math.round(n) === n ? String(n) : n.toFixed(2));
  }
  function up(v) { return String(v || '').toUpperCase(); }
  function pad2(n) { return api.pad2(n); }

  var toastTimer = null;
  function toast(msg, bad) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (bad ? ' bad' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  function isNetworkError(err) {
    var m = String((err && err.message) || '');
    return !!((err && err.userCode === 'offline') || /Failed to fetch|NetworkError|Load failed|network/i.test(m));
  }
  function friendly(err) {
    return isNetworkError(err) ? t('offline') : t('something_wrong');
  }

  /* Wrap every async handler: log technical detail with context, show a friendly toast, never crash. */
  function guard(ctx, fn) {
    return function () {
      var args = arguments;
      MM.ctx = ctx;
      var p;
      try { p = fn.apply(null, args); } catch (e) { logErr(ctx, e); toast(friendly(e), true); return; }
      if (p && typeof p.catch === 'function') p.catch(function (e) { logErr(ctx, e); toast(friendly(e), true); });
    };
  }
  function logErr(ctx, e) {
    try { console.error('[MM ' + ctx + ']', e && e.message, e && e.stack, 'route:', currentScreen); } catch (x) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ routing */
  var SCREENS = ['home', 'cart', 'placed', 'order', 'pay', 'party', 'login', 'waiter', 'kitchen', 'owner'];
  var STAFF_SCREENS = ['waiter', 'kitchen', 'owner'];
  var currentScreen = 'home';

  function show(name) {
    SCREENS.forEach(function (s) {
      var el = $('screen-' + s);
      if (el) el.classList.toggle('on', s === name);
    });
    currentScreen = name;
    MM.ctx = 'screen:' + name;
    window.scrollTo(0, 0);
    updateCartBar();
    startPollingFor(name);
  }

  function go(name, replace) {
    if (STAFF_SCREENS.indexOf(name) >= 0 && !S.role) name = 'home';
    show(name);
    try {
      var st = { screen: name };
      if (replace || STAFF_SCREENS.indexOf(name) >= 0) history.replaceState(st, '');
      else history.pushState(st, '');
    } catch (e) { /* history unavailable: navigation still works */ }
  }

  window.addEventListener('popstate', function (ev) {
    var name = (ev.state && ev.state.screen) || 'home';
    if (STAFF_SCREENS.indexOf(name) >= 0 && !S.role) name = 'home';
    if (name === 'login' && S.role) name = roleScreen(S.role);
    show(name);
    renderScreen(name);
  });

  function roleScreen(role) { return role === 'admin' ? 'owner' : role; }

  /* ------------------------------------------------------------------ polling (light) */
  var pollTimer = null;
  var pollFn = null;
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; pollFn = null; }
  function startPollingFor(name) {
    stopPolling();
    var fn = null; var ms = 15000;
    if (name === 'kitchen') { fn = loadKitchen; ms = 8000; }
    else if (name === 'waiter') { fn = function () { return refreshWaiter(true); }; }
    else if (name === 'owner') { fn = function () { return refreshOwnerPanel(true); }; }
    else if (name === 'home' || name === 'order') { fn = function () { return refreshMyOrders(); }; }
    if (!fn) return;
    pollFn = guard('poll:' + name, fn);
    pollTimer = setInterval(function () { if (!document.hidden) pollFn(); }, ms);
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && pollFn) pollFn();
  });

  /* ------------------------------------------------------------------ language */
  function setLang(lang) {
    S.lang = lang === 'mr' ? 'mr' : 'en';
    MM.store.set('mm_lang', S.lang);
    MM.applyI18n();
    document.querySelectorAll('[data-action="lang"]').forEach(function (b) { b.textContent = t('language'); });
    renderScreen(currentScreen);
  }
  function toggleLang() { setLang(S.lang === 'en' ? 'mr' : 'en'); }

  function renderScreen(name) {
    if (name === 'home') { renderGate(); renderCategories(); renderMenu(); renderStrip(); updateCartBar(); }
    else if (name === 'cart') renderCart();
    else if (name === 'placed') renderPlaced();
    else if (name === 'order') renderOrderDetail();
    else if (name === 'pay') renderPay();
    else if (name === 'waiter') renderWaiter();
    else if (name === 'kitchen') renderKitchen();
    else if (name === 'owner') renderOwnerPanel();
  }

  /* =================================================================== CUSTOMER */

  /* ---- table identity comes ONLY from the QR (?table=NN). There is no table picker. ---- */
  function parseTableParam() {
    var raw = new URLSearchParams(location.search).get('table');
    if (raw === null) return { table: null, invalid: false };
    raw = raw.trim();
    if (!/^[0-9]{1,2}$/.test(raw)) return { table: null, invalid: true };
    return { table: pad2(raw), invalid: false };
  }

  var tableInvalid = false;
  var gateLoading = false;

  async function loadGate() {
    if (!S.table) { S.gate = null; renderGate(); return; }
    gateLoading = true; renderGate();
    try {
      S.gate = await api.tableStatus(S.table);
      S.visitId = (S.gate && S.gate.can_order && S.gate.visit_id) || null;
    } catch (e) {
      logErr('gate', e);
      S.gate = { status: 'ERROR' };
      S.visitId = null;
    }
    gateLoading = false;
    renderGate();
    renderStrip();
  }

  function renderGate() {
    var box = $('gate'); var msg = $('gate-msg'); var retry = $('btn-gate-retry'); var status = $('home-status');
    if (!box) return;
    var text = ''; var cls = 'gate'; var showRetry = false;
    if (tableInvalid) { text = t('table_not_found'); cls += ' bad'; }
    else if (!S.table) { text = t('scan_qr'); }
    else if (gateLoading) { text = t('checking_table'); }
    else if (!S.gate) { text = t('checking_table'); }
    else {
      var st = up(S.gate.status);
      if (st === 'OPEN' && S.gate.can_order) { text = ''; }
      else if (st === 'AVAILABLE') { text = t('table_not_open'); showRetry = true; }
      else if (st === 'UNKNOWN') { text = t('table_not_found'); cls += ' bad'; }
      else { text = t('offline'); cls += ' bad'; showRetry = true; }
    }
    status.textContent = S.table ? t('table_n', { n: S.table }) : '';
    box.className = cls;
    box.hidden = !text;
    msg.textContent = text;
    retry.hidden = !showRetry;
  }

  /* ---- menu ---- */
  var menuStatus = 'loading';
  var activeCat = 'all';
  var searchTerm = '';

  async function loadMenu() {
    menuStatus = 'loading'; renderMenu();
    try {
      var d = await api.loadMenu();
      var activeCats = d.categories.filter(function (c) { return c.is_active !== false; });
      var activeIds = {};
      activeCats.forEach(function (c) { activeIds[c.id] = true; });
      S.categories = activeCats;
      S.menu = d.items.filter(function (i) { return !i.category_id || activeIds[i.category_id]; });
      menuStatus = 'ok';
      reconcileCart();
    } catch (e) {
      logErr('menu', e);
      menuStatus = 'error';
    }
    renderCategories(); renderMenu(); updateCartBar();
  }

  function renderCategories() {
    var box = $('categories');
    if (!box) return;
    var used = {};
    S.menu.forEach(function (i) { used[i.category_id] = true; });
    var cats = S.categories.filter(function (c) { return used[c.id]; });
    var kids = [h('button', { type: 'button', class: 'cat' + (activeCat === 'all' ? ' on' : ''), text: t('all'), onclick: function () { activeCat = 'all'; renderCategories(); renderMenu(); } })];
    cats.forEach(function (c) {
      kids.push(h('button', { type: 'button', class: 'cat' + (activeCat === c.id ? ' on' : ''), text: c.name, onclick: function () { activeCat = c.id; renderCategories(); renderMenu(); } }));
    });
    mount(box, kids);
  }

  function filteredMenu() {
    var q = searchTerm.trim().toLowerCase();
    return S.menu.filter(function (i) {
      if (activeCat !== 'all' && i.category_id !== activeCat) return false;
      if (!q) return true;
      return String(i.name || '').toLowerCase().indexOf(q) >= 0 || String(i.description || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function cartQty(id) {
    var l = S.cart.filter(function (c) { return c.id === id; })[0];
    return l ? l.qty : 0;
  }

  function itemRow(item, onAdd, onSub, qtyOf) {
    var available = item.is_available !== false;
    var q = qtyOf(item.id);
    var right;
    if (!available) right = h('span', { class: 'chip plain', text: t('sold_out') });
    else if (q > 0) right = h('div', { class: 'qty' }, [
      h('button', { type: 'button', 'aria-label': '-', text: '−', onclick: function () { onSub(item); } }),
      h('span', { text: String(q) }),
      h('button', { type: 'button', class: 'plus', 'aria-label': '+', text: '+', onclick: function () { onAdd(item); } })
    ]);
    else right = h('div', { class: 'qty' }, [h('button', { type: 'button', class: 'plus', 'aria-label': t('add'), text: '+', onclick: function () { onAdd(item); } })]);
    return h('div', { class: 'item' + (available ? '' : ' off') }, [
      h('div', { class: 'item-body' }, [
        h('div', { class: 'item-name' }, [h('span', { class: 'veg-dot' + (item.is_veg === false ? ' nv' : '') }), item.name || '']),
        item.description ? h('div', { class: 'item-desc', text: item.description }) : null,
        h('div', { class: 'item-price', text: rs(item.price) })
      ]),
      right
    ]);
  }

  function renderMenu() {
    var list = $('menu-list');
    if (!list) return;
    if (menuStatus === 'loading') { mount(list, [h('div', { class: 'loading', text: t('loading_menu') })]); return; }
    if (menuStatus === 'error') {
      mount(list, [h('div', { class: 'empty' }, [
        h('p', { text: t('menu_error') }),
        h('button', { type: 'button', class: 'btn', text: t('try_again'), onclick: guard('menu', loadMenu) })
      ])]);
      return;
    }
    var rows = filteredMenu();
    if (!rows.length) { mount(list, [h('div', { class: 'empty', text: S.menu.length ? t('no_items') : t('menu_empty') })]); return; }
    mount(list, rows.map(function (i) { return itemRow(i, cartAdd, cartSub, cartQty); }));
  }

  /* ---- cart ---- */
  function saveCart() { MM.store.setJSON(MM.KEYS.cart, { table: S.table, items: S.cart }); }
  function loadCart() {
    var d = MM.store.getJSON(MM.KEYS.cart, null);
    if (d && Array.isArray(d.items) && d.table === S.table) {
      S.cart = d.items.filter(function (l) { return l && l.id && Number(l.qty) > 0; });
    } else S.cart = [];
  }
  /* After a menu refresh, drop dishes that vanished or sold out and refresh prices. */
  function reconcileCart() {
    var byId = {};
    S.menu.forEach(function (i) { byId[i.id] = i; });
    var before = S.cart.length;
    S.cart = S.cart.filter(function (l) { var m = byId[l.id]; return m && m.is_available !== false; })
      .map(function (l) { var m = byId[l.id]; l.price = Number(m.price) || 0; l.name = m.name; return l; });
    if (S.cart.length !== before) saveCart();
  }
  function cartAdd(item) {
    var l = S.cart.filter(function (c) { return c.id === item.id; })[0];
    if (l) l.qty += 1;
    else S.cart.push({ id: item.id, name: item.name, price: Number(item.price) || 0, qty: 1, spice: 'normal' });
    afterCartChange();
  }
  function cartSub(item) {
    var id = item.id;
    S.cart = S.cart.map(function (c) { if (c.id === id) c.qty -= 1; return c; }).filter(function (c) { return c.qty > 0; });
    afterCartChange();
  }
  function cartRemove(id) { S.cart = S.cart.filter(function (c) { return c.id !== id; }); afterCartChange(); }
  function cartTotals() {
    var count = 0; var total = 0;
    S.cart.forEach(function (l) { count += l.qty; total += l.qty * l.price; });
    return { count: count, total: total };
  }
  function afterCartChange() {
    orderErrorShown = false;
    saveCart();
    if (currentScreen === 'home') renderMenu();
    if (currentScreen === 'cart') renderCart();
    updateCartBar();
  }
  function updateCartBar() {
    var bar = $('cart-bar'); if (!bar) return;
    var c = cartTotals();
    $('cart-count').textContent = c.count === 1 ? t('item_1') : t('items_n', { n: c.count });
    $('cart-total').textContent = String(Math.round(c.total * 100) / 100);
    bar.hidden = !(currentScreen === 'home' && c.count > 0);
  }

  var pendingTicket = null;     // reused when retrying the SAME cart so a retry can never double-order
  var pendingSig = '';
  var placing = false;

  function cartSignature() {
    return JSON.stringify(S.cart.map(function (l) { return [l.id, l.qty, l.spice]; })) + '|' + ($('order-notes') ? $('order-notes').value : '');
  }

  function renderCart() {
    var items = $('cart-items'); var foot = $('cart-footer');
    if (!S.cart.length) {
      mount(items, [h('div', { class: 'empty' }, [
        h('p', { text: t('cart_empty') }),
        h('button', { type: 'button', class: 'btn', text: t('back_to_menu'), onclick: function () { go('home'); renderScreen('home'); } })
      ])]);
      foot.hidden = true;
      return;
    }
    mount(items, S.cart.map(function (l) {
      var spice = h('select', { 'aria-label': t('spice'), onchange: function (ev) { l.spice = ev.target.value; saveCart(); } },
        ['normal', 'mild', 'medium', 'hot'].map(function (s) { return h('option', { value: s, selected: l.spice === s, text: t('spice_' + s) }); }));
      return h('div', { class: 'line' }, [
        h('div', { class: 'line-body' }, [
          h('div', { text: l.name }),
          h('div', { class: 'line-sub', text: rs(l.price) + ' × ' + l.qty + ' = ' + rs(l.price * l.qty) }),
          spice
        ]),
        h('div', { class: 'qty' }, [
          h('button', { type: 'button', text: '−', 'aria-label': '-', onclick: function () { cartSub(l); } }),
          h('span', { text: String(l.qty) }),
          h('button', { type: 'button', class: 'plus', text: '+', 'aria-label': '+', onclick: function () { cartAdd(l); } })
        ])
      ]);
    }));
    $('cart-page-total').textContent = String(Math.round(cartTotals().total * 100) / 100);
    foot.hidden = false;
    var canOrder = !!(S.table && S.visitId);
    var btn = $('btn-place-order');
    btn.disabled = placing || !canOrder;
    btn.textContent = placing ? t('submitting_order') : t('place_order');
    var err = $('order-error');
    if (!canOrder && !orderErrorShown) {
      err.textContent = S.table ? t('table_not_open') : t('scan_qr');
      err.hidden = false;
    } else if (canOrder && !orderErrorShown) err.hidden = true;
  }

  var orderErrorShown = false;
  function showOrderError(text, retryLabel) {
    var err = $('order-error');
    err.textContent = text; err.hidden = false; orderErrorShown = true;
    $('btn-place-order').textContent = retryLabel || t('try_again');
  }

  async function placeOrder() {
    if (placing) return;
    if (!S.cart.length) return;
    placing = true; orderErrorShown = false;
    var btn = $('btn-place-order');
    btn.disabled = true; btn.textContent = t('submitting_order');
    $('order-error').hidden = true;
    try {
      /* Re-verify the table right now: the visit may have been closed since the page loaded. */
      var gate = await api.tableStatus(S.table);
      S.gate = gate;
      S.visitId = (gate && gate.can_order && gate.visit_id) || null;
      if (!S.visitId) { renderGate(); showOrderError(t('table_not_open'), t('try_again')); return; }

      var sig = cartSignature();
      if (!pendingTicket || sig !== pendingSig) { pendingTicket = api.newTicket(S.table); pendingSig = sig; }
      var sessionId = api.customerSessionId(S.visitId);
      var created = await api.placeOrder({
        table: S.table, visitId: S.visitId, sessionId: sessionId, ticket: pendingTicket,
        items: S.cart, notes: $('order-notes').value
      });
      rememberOrder(created);
      S.cart = []; saveCart(); pendingTicket = null; pendingSig = '';
      $('order-notes').value = '';
      lastPlaced = created;
      go('placed');
      renderPlaced();
    } catch (e) {
      logErr('place-order', e);
      if (e && (e.code === '23505' || /duplicate|unique/i.test(String(e.message || '')))) {
        showOrderError(t('order_maybe_sent'), t('try_again'));
      } else if (isNetworkError(e)) {
        showOrderError(t('order_failed') + ' ' + t('offline'), t('try_again'));
      } else {
        showOrderError(t('order_failed') + ' ' + t('please_try_again'), t('try_again'));
      }
    } finally {
      placing = false;
      var b = $('btn-place-order'); if (b) b.disabled = !(S.table && S.visitId);
    }
  }

  /* ---- my orders (this phone only) ---- */
  var lastPlaced = null;
  var viewingOrderId = null;
  var TERMINAL_HIDE = ['CANCELLED', 'COMPLETED'];

  function myOrders() {
    var all = MM.store.getJSON(MM.KEYS.orders, []);
    if (!Array.isArray(all)) return [];
    var cutoff = Date.now() - 12 * 3600 * 1000;
    return all.filter(function (o) { return o && o.id && o.token && o.at > cutoff; });
  }
  function saveMyOrders(list) { MM.store.setJSON(MM.KEYS.orders, list.slice(0, 15)); }
  function rememberOrder(c) {
    var list = myOrders().filter(function (o) { return o.id !== c.id; });
    list.unshift({
      id: c.id, token: c.publicToken, table: c.table, visitId: c.visitId,
      orderNumber: c.orderNumber, items: c.items || [], total: Number(c.total) || 0,
      status: up(c.status || 'NEW'), at: Date.now()
    });
    saveMyOrders(list);
  }
  function activeOrders() {
    return myOrders().filter(function (o) {
      if (TERMINAL_HIDE.indexOf(up(o.status)) >= 0) return false;
      /* If this table now has a different visit, the old visit is finished: hide its orders. */
      if (S.gate && S.gate.visit_id && o.visitId && o.visitId !== S.gate.visit_id) return false;
      if (S.gate && up(S.gate.status) === 'AVAILABLE' && S.table && o.table === S.table) return false;
      return true;
    });
  }

  var refreshingOrders = false;
  async function refreshMyOrders() {
    if (refreshingOrders) return;
    var list = myOrders();
    if (!list.length || !api.ready()) { renderStrip(); return; }
    refreshingOrders = true;
    try {
      var changed = false;
      var recent = list.slice(0, 5);
      for (var i = 0; i < recent.length; i++) {
        var o = recent[i];
        var remote = null;
        try { remote = await api.getPublicOrder(o.id, o.token); } catch (e) { logErr('refresh-order', e); continue; }
        if (!remote) continue;
        var next = up(remote.status || o.status);
        if (next !== o.status || Number(remote.total) !== o.total) changed = true;
        o.status = next; o.total = Number(remote.total) || o.total;
        if (Array.isArray(remote.items) && remote.items.length) o.items = remote.items;
        if (remote.table) o.table = String(remote.table);
      }
      if (changed) saveMyOrders(list);
    } finally { refreshingOrders = false; }
    renderStrip();
    if (currentScreen === 'order') renderOrderDetail();
  }

  function statusLabel(s) {
    var k = 'st_' + String(s || 'new').toLowerCase();
    var v = t(k);
    return v === k ? String(s) : v;
  }
  function statusChipClass(s) {
    s = up(s);
    if (s === 'READY') return 'chip ok';
    if (s === 'PAID' || s === 'SERVED' || s === 'COMPLETED') return 'chip plain';
    if (s === 'CANCELLED') return 'chip bad';
    if (s === 'PREPARING') return 'chip warn';
    return 'chip';
  }
  function itemCount(o) { return (o.items || []).reduce(function (n, i) { return n + (Number(i.qty) || 0); }, 0); }
  function orderLabel(o) { return t('order_no', { n: o.orderNumber || String(o.id).slice(-5) }); }

  function renderStrip() {
    var strip = $('current-order'); if (!strip) return;
    var act = activeOrders();
    if (!act.length) { strip.hidden = true; return; }
    var o = act[0];
    var n = itemCount(o);
    $('co-summary').textContent = orderLabel(o) + ' · ' + (n === 1 ? t('item_1') : t('items_n', { n: n }));
    var existing = strip.querySelector('.chip'); if (existing) existing.remove();
    strip.querySelector('.order-strip-left').appendChild(h('span', { class: statusChipClass(o.status), text: statusLabel(o.status) }));
    strip.hidden = false;
  }

  function renderPlaced() {
    var o = lastPlaced || myOrders()[0];
    $('placed-number').textContent = o ? orderLabel(o) : '';
  }

  function openOrder(id) {
    viewingOrderId = id || (activeOrders()[0] || myOrders()[0] || {}).id || null;
    go('order'); renderOrderDetail(); guard('order', refreshMyOrders)();
  }

  function renderOrderDetail() {
    var box = $('order-detail');
    var list = myOrders();
    if (!list.length) {
      mount(box, [h('div', { class: 'empty' }, [
        h('p', { text: t('no_orders') }),
        h('button', { type: 'button', class: 'btn', text: t('back_to_menu'), onclick: function () { go('home'); renderScreen('home'); } })
      ])]);
      return;
    }
    var o = list.filter(function (x) { return x.id === viewingOrderId; })[0] || list[0];
    viewingOrderId = o.id;
    var paid = up(o.status) === 'PAID';
    var kids = [];
    if (list.length > 1) {
      kids.push(h('div', { class: 'cats' }, list.slice(0, 6).map(function (x) {
        return h('button', { type: 'button', class: 'cat' + (x.id === o.id ? ' on' : ''), text: orderLabel(x), onclick: function () { viewingOrderId = x.id; renderOrderDetail(); } });
      })));
    }
    kids.push(h('div', { class: 'panel' }, [
      h('div', { class: 'row' }, [h('strong', { text: orderLabel(o) }), h('span', { class: statusChipClass(o.status), text: statusLabel(o.status) })]),
      h('div', { class: 'muted small', text: t('table_n', { n: o.table || S.table || '' }) })
    ]));
    kids.push(h('div', { class: 'panel' }, (o.items || []).map(function (i) {
      return h('div', { class: 'line' }, [
        h('div', { class: 'line-body', text: i.name }),
        h('div', { text: '× ' + i.qty + '  ' + rs((Number(i.price) || 0) * (Number(i.qty) || 0)) })
      ]);
    }).concat([h('div', { class: 'cart-total-row' }, [h('span', { text: t('total') }), h('strong', { text: rs(o.total) })])])));
    kids.push(h('div', { class: 'panel row' }, [
      h('span', { text: t('payment_status') }),
      h('span', { class: paid ? 'chip ok' : 'chip warn', text: paid ? t('paid') : t('unpaid') })
    ]));
    if (!paid) kids.push(h('button', { type: 'button', class: 'btn btn-primary btn-block', text: t('pay_now'), onclick: guard('pay', function () { openPay(o); }) }));
    kids.push(h('button', { type: 'button', class: 'btn btn-soft btn-block', text: t('new_order'), onclick: function () { go('home'); renderScreen('home'); } }));
    mount(box, kids);
  }

  /* ---- payment (customer) ---- */
  var payOrder = null;
  var payAmount = 0;
  var payBusy = false;

  async function openPay(o) {
    payOrder = o; payAmount = 0;
    go('pay');
    $('pay-msg').textContent = t('loading');
    $('pay-choices').hidden = true; $('pay-upi').hidden = true;
    $('pay-total').textContent = '…';
    var sessionId = api.customerSessionId(o.visitId);
    try {
      var bill = await api.guestBill(o.table, o.visitId, sessionId);
      payAmount = Number(bill && bill.amount) || 0;
    } catch (e) {
      logErr('guest-bill', e);
      /* Fall back to this order's own total so the guest can still tell the counter. */
      payAmount = Number(o.total) || 0;
    }
    renderPay();
  }

  function renderPay() {
    if (!payOrder) { $('pay-msg').textContent = ''; return; }
    $('pay-total').textContent = String(payAmount);
    var cfg = S.config || {};
    $('pay-choices').hidden = false;
    $('btn-pay-cash').hidden = cfg.accept_cash === false;
    $('pay-upi').hidden = true;
    $('pay-msg').textContent = payAmount > 0 ? '' : t('nothing_to_pay');
    $('pay-choices').hidden = !(payAmount > 0);
  }

  async function payUpiStart() {
    var cfg = S.config || {};
    $('pay-choices').hidden = true; $('pay-upi').hidden = false;
    var link = $('btn-upi-open');
    var vpa = cfg.upi_id || cfg.phonepe_upi || '';
    if (vpa) {
      var q = 'pa=' + encodeURIComponent(vpa) + '&pn=' + encodeURIComponent(cfg.upi_name || 'Mirch Masaala') +
        '&am=' + encodeURIComponent(String(payAmount)) + '&cu=INR&tn=' + encodeURIComponent('Table ' + (payOrder.table || ''));
      link.setAttribute('href', 'upi://pay?' + q); link.hidden = false;
      $('upi-id-line').textContent = vpa;
    } else { link.hidden = true; $('upi-id-line').textContent = ''; }
  }

  async function sendPaymentRequest(method) {
    if (payBusy || !payOrder) return;
    payBusy = true;
    $('pay-msg').textContent = t('sending');
    try {
      await api.requestPayment(method, payOrder.table, payOrder.visitId, api.customerSessionId(payOrder.visitId));
      $('pay-choices').hidden = true; $('pay-upi').hidden = true;
      $('pay-msg').textContent = method === 'cash' ? t('cash_requested') : t('upi_requested');
    } catch (e) {
      logErr('payment-request', e);
      $('pay-msg').textContent = t('pay_error');
    } finally { payBusy = false; }
  }

  /* ---- party booking ---- */
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function openParty() {
    var f = $('party-form');
    f.elements.date.setAttribute('min', todayISO());
    $('party-error').hidden = true; $('party-ok').hidden = true; f.hidden = false;
    go('party');
  }
  async function submitParty(ev) {
    ev.preventDefault();
    var f = $('party-form'); var err = $('party-error'); var btn = $('btn-party-send');
    err.hidden = true;
    var v = {
      name: f.elements.name.value.trim(), phone: f.elements.phone.value.replace(/[\s-]/g, ''),
      eventType: f.elements.eventType.value, date: f.elements.date.value, time: f.elements.time.value,
      guests: f.elements.guests.value, message: f.elements.message.value
    };
    var problem = '';
    if (!v.name || !/^[0-9+]{10,15}$/.test(v.phone) || !v.date || v.date < todayISO() || !v.time || !(Number(v.guests) >= 1 && Number(v.guests) <= 500)) {
      problem = t('booking_failed');
    }
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = t('sending');
    try {
      await api.submitParty(v);
      f.reset(); f.hidden = true;
      var ok = $('party-ok'); ok.textContent = t('booking_sent'); ok.hidden = false;
    } catch (e) {
      logErr('party', e);
      /* Database rule messages (P0001) are written for customers; anything else stays generic. */
      err.textContent = (e && e.code === 'P0001' && e.message) ? e.message : t('booking_failed');
      err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = t('send_request'); }
  }

  /* =================================================================== AUTH */
  var loginRole = 'waiter';
  var loginVersion = 0;

  function openLogin(role) {
    if (role && ['waiter', 'kitchen', 'admin'].indexOf(role) >= 0) setLoginRole(role);
    $('login-error').hidden = true;
    go('login');
  }
  function setLoginRole(role) {
    loginRole = role;
    document.querySelectorAll('#role-tabs .role-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-role') === role); });
  }

  async function doLogin(ev) {
    ev.preventDefault();
    var version = ++loginVersion;
    var f = $('login-form'); var err = $('login-error'); var btn = $('btn-login');
    var username = f.elements.username.value.trim(); var password = f.elements.password.value;
    err.hidden = true;
    if (!username || !password) { err.textContent = t('login_failed'); err.hidden = false; return; }
    btn.disabled = true; btn.textContent = t('signing_in');
    try {
      await api.signIn(username, password);
      if (version !== loginVersion) return;
      var actual = await api.myRole();          /* the SERVER decides the role */
      if (version !== loginVersion) return;
      if (!actual) { await api.signOut(); throw Object.assign(new Error('NO_ROLE'), { userCode: 'no_role' }); }
      if (actual !== loginRole) {
        await api.signOut();
        throw Object.assign(new Error('ROLE_MISMATCH'), { userCode: 'mismatch', actual: actual });
      }
      f.reset();
      await enterStaff(actual);
    } catch (e) {
      logErr('login', e);
      var msg = t('login_failed');
      if (e && e.userCode === 'bad_username') msg = t('login_bad_username');
      else if (e && e.userCode === 'no_role') msg = t('login_no_role');
      else if (e && e.userCode === 'mismatch') msg = t('login_wrong_role', { actual: t('role_' + e.actual), wanted: t('role_' + loginRole) });
      else if (e && (e.userCode === 'offline' || /fetch|network/i.test(String(e.message || '')))) msg = t('offline');
      err.textContent = msg; err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = t('login'); }
  }

  async function enterStaff(role) {
    S.role = role;
    go(roleScreen(role), true);
    renderScreen(roleScreen(role));
    if (role === 'kitchen') await loadKitchen();
    else if (role === 'waiter') await refreshWaiter(false);
    else await refreshOwnerPanel(false);
  }

  async function doLogout() {
    loginVersion++;
    await api.signOut();
    S.role = null; S.session = null;
    W.table = null; W.visit = null; W.cart = [];
    stopPolling();
    go('home', true);
    renderScreen('home');
    if (menuStatus !== 'ok') guard('menu', loadMenu)();
    if (S.table) guard('gate', loadGate)();
  }

  /* Restore a session on load: the role is re-asked from the server every time. */
  async function restoreSession() {
    if (!api.ready()) return false;
    var session = await api.getSession();
    if (!session) return false;
    var role = null;
    try { role = await api.myRole(); } catch (e) { logErr('restore-role', e); return false; }
    if (!role) { await api.signOut(); return false; }
    S.session = session;
    await enterStaff(role);
    return true;
  }

  /* =================================================================== KITCHEN */
  var kitchenOrders = [];
  var kitchenTables = {};
  var kitchenItems = {};
  var kitchenState = 'loading';
  var kitchenBusy = {};

  async function loadKitchen() {
    if (S.role !== 'kitchen' && S.role !== 'admin') return;
    try {
      var results = await Promise.all([api.staffOrders(true), api.staffTables()]);
      kitchenOrders = results[0];
      kitchenTables = {};
      results[1].forEach(function (x) { kitchenTables[x.id] = pad2(x.table_number); });
      var items = await api.orderItems(kitchenOrders.map(function (o) { return o.id; }));
      kitchenItems = {};
      items.forEach(function (i) { (kitchenItems[i.order_id] = kitchenItems[i.order_id] || []).push(i); });
      kitchenState = 'ok';
    } catch (e) {
      logErr('kitchen-load', e);
      kitchenState = 'error';
    }
    renderKitchen();
  }

  function minutesSince(iso) {
    var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return isFinite(m) ? m : 0;
  }

  function kitchenCard(o) {
    var st = up(o.status);
    var items = kitchenItems[o.id] || [];
    var pending = up(o.approval_status) === 'PENDING';
    var btn = null;
    if (st === 'NEW') btn = h('button', { type: 'button', class: 'btn btn-primary btn-block', text: t('start'), disabled: !!kitchenBusy[o.ticket_id], onclick: guard('kitchen-start', function () { return kitchenSet(o, 'PREPARING'); }) });
    else if (st === 'PREPARING') btn = h('button', { type: 'button', class: 'btn btn-primary btn-block', text: t('mark_ready'), disabled: !!kitchenBusy[o.ticket_id], onclick: guard('kitchen-ready', function () { return kitchenSet(o, 'READY'); }) });
    return h('div', { class: 'kcard' }, [
      h('div', { class: 'row' }, [
        h('strong', { text: t('order_no', { n: o.order_number || String(o.ticket_id).slice(-5) }) }),
        h('span', { class: 'chip plain', text: t('time_ago_min', { n: minutesSince(o.created_at) }) })
      ]),
      h('div', { class: 'muted small', text: t('table_n', { n: kitchenTables[o.table_id] || '?' }) }),
      pending ? h('div', { class: 'chip warn', text: t('k_pending_approval') }) : null,
      h('div', null, items.map(function (i) { return h('div', { class: 'kitem' }, [h('span', { text: i.item_name }), h('b', { text: '× ' + i.quantity })]); })),
      o.notes ? h('div', { class: 'muted small', text: o.notes }) : null,
      btn
    ]);
  }

  async function kitchenSet(o, status) {
    if (kitchenBusy[o.ticket_id]) return;
    kitchenBusy[o.ticket_id] = true; renderKitchen();
    try { await api.setOrderStatus(o.ticket_id, status); }
    catch (e) { logErr('kitchen-set', e); toast(t('status_update_failed'), true); }
    finally { delete kitchenBusy[o.ticket_id]; }
    await loadKitchen();         /* always re-read from the backend: no local-only status */
  }

  function renderKitchen() {
    var board = $('kitchen-board'); if (!board) return;
    if (kitchenState === 'loading') { mount(board, [h('div', { class: 'loading', text: t('loading') })]); return; }
    if (kitchenState === 'error') {
      mount(board, [h('div', { class: 'empty' }, [h('p', { text: t('something_wrong') }), h('button', { type: 'button', class: 'btn', text: t('try_again'), onclick: guard('kitchen-load', loadKitchen) })])]);
      return;
    }
    var cols = [['NEW', 'k_new'], ['PREPARING', 'k_preparing'], ['READY', 'k_ready']];
    mount(board, cols.map(function (c) {
      var rows = kitchenOrders.filter(function (o) { return up(o.status) === c[0]; }).reverse();
      return h('div', { class: 'kcol' }, [
        h('h3', { text: t(c[1]) + ' (' + rows.length + ')' }),
        h('div', null, rows.length ? rows.map(kitchenCard) : [h('div', { class: 'empty', text: t('k_empty') })])
      ]);
    }));
  }

  /* =================================================================== WAITER */
  var W = { table: null, visit: null, tables: [], visits: {}, orders: [], items: {}, cart: [], q: '', waiters: [], waiterCode: MM.store.get('mm_waiter_code', '') || '', state: 'loading', busy: false, notes: '' };

  async function refreshWaiter(quiet) {
    if (S.role !== 'waiter' && S.role !== 'admin') return;
    try {
      var r = await Promise.all([api.staffTables(), api.tableVisits(), api.staffOrders(true)]);
      W.tables = r[0].slice().sort(function (a, b) { return pad2(a.table_number).localeCompare(pad2(b.table_number)); });
      W.visits = {};
      r[1].forEach(function (v) { if (v && v.table_number) W.visits[pad2(v.table_number)] = v; });
      var ids = {};
      W.tables.forEach(function (x) { ids[x.id] = pad2(x.table_number); });
      W.orders = r[2].map(function (o) { o._table = ids[o.table_id]; return o; });
      if (W.table) {
        var oi = await api.orderItems(W.orders.filter(function (o) { return o._table === W.table; }).map(function (o) { return o.id; }));
        W.items = {};
        oi.forEach(function (i) { (W.items[i.order_id] = W.items[i.order_id] || []).push(i); });
        var v = W.visits[W.table];
        W.visit = v && up(v.status) === 'OPEN' ? v : null;
      }
      W.state = 'ok';
    } catch (e) {
      logErr('waiter-refresh', e);
      if (!quiet) W.state = 'error';
    }
    renderWaiter();
  }

  function waiterTableState(num) {
    var v = W.visits[num];
    var open = v && up(v.status) === 'OPEN';
    if (!open) return { cls: 'tbl', label: t('st_available') };
    var mine = W.orders.filter(function (o) { return o._table === num; });
    if (mine.some(function (o) { return up(o.status) === 'READY'; })) return { cls: 'tbl ready', label: t('st_ready') };
    if (mine.length) return { cls: 'tbl open', label: t('st_active') };
    return { cls: 'tbl open', label: t('st_open') };
  }

  function renderWaiter() {
    var grid = $('waiter-tables'); var view = $('waiter-visit'); var tv = $('waiter-tables-view');
    if (!grid) return;
    if (W.table) { tv.hidden = true; view.hidden = false; renderWaiterTable(); return; }
    tv.hidden = false; view.hidden = true;
    if (W.state === 'loading') { mount(grid, [h('div', { class: 'loading', text: t('loading') })]); return; }
    if (W.state === 'error') { mount(grid, [h('div', { class: 'empty' }, [h('p', { text: t('something_wrong') }), h('button', { type: 'button', class: 'btn', text: t('try_again'), onclick: guard('waiter', function () { return refreshWaiter(false); }) })])]); return; }
    if (!W.tables.length) { mount(grid, [h('div', { class: 'empty', text: t('tables_empty') })]); return; }
    mount(grid, W.tables.map(function (tb) {
      var num = pad2(tb.table_number); var st = waiterTableState(num);
      return h('button', { type: 'button', class: st.cls, onclick: guard('waiter-table', function () { return selectTable(num); }) }, [h('strong', { text: t('table_n', { n: num }) }), h('small', { text: st.label })]);
    }));
  }

  async function selectTable(num) {
    /* Re-read OPEN visits from the server first: never rely on a stale list to avoid duplicates. */
    var fresh = await api.tableVisits();
    W.visits = {};
    fresh.forEach(function (v) { if (v && v.table_number) W.visits[pad2(v.table_number)] = v; });
    W.table = num; W.cart = []; W.q = ''; W.notes = '';
    var v = W.visits[num];
    W.visit = v && up(v.status) === 'OPEN' ? v : null;
    if (!W.visit && !W.waiters.length) { try { W.waiters = await api.listWaiters(); } catch (e) { logErr('waiters', e); W.waiters = []; } }
    if (!S.menu.length) await loadMenu();
    await refreshWaiter(true);
  }

  function leaveWaiterTable() { W.table = null; W.visit = null; W.cart = []; renderWaiter(); refreshWaiter(true); }

  function wQty(id) { var l = W.cart.filter(function (c) { return c.id === id; })[0]; return l ? l.qty : 0; }
  function wAdd(item) {
    var l = W.cart.filter(function (c) { return c.id === item.id; })[0];
    if (l) l.qty += 1; else W.cart.push({ id: item.id, name: item.name, price: Number(item.price) || 0, qty: 1, spice: 'normal' });
    renderWaiterLists();
  }
  function wSub(item) {
    W.cart = W.cart.map(function (c) { if (c.id === item.id) c.qty -= 1; return c; }).filter(function (c) { return c.qty > 0; });
    renderWaiterLists();
  }
  function renderWaiterLists() { renderWaiterMenuOnly(); renderWaiterOrder(); }

  async function startVisit(code) {
    if (!code) { toast(t('waiter_missing'), true); return; }
    if (W.busy) return;
    W.busy = true;
    try {
      /* Re-check for an OPEN visit right before creating one (another waiter may have started it). */
      var fresh = await api.tableVisits();
      var existing = fresh.filter(function (v) { return pad2(v.table_number) === W.table && up(v.status) === 'OPEN'; })[0];
      if (!existing) await api.startVisit(W.table, code);
      MM.store.set('mm_waiter_code', code); W.waiterCode = code;
      toast(t('visit_started'));
      await refreshWaiter(true);
      var again = (await api.tableVisits()).filter(function (v) { return pad2(v.table_number) === W.table && up(v.status) === 'OPEN'; })[0];
      W.visit = again || null;
    } catch (e) { logErr('start-visit', e); toast(t('visit_failed'), true); }
    finally { W.busy = false; renderWaiterTable(); }
  }

  async function sendToKitchen() {
    if (W.busy || !W.cart.length || !W.visit) return;
    W.busy = true; renderWaiterTable();
    try {
      await api.placeOrder({ table: W.table, visitId: W.visit.visit_id, sessionId: null, items: W.cart, notes: W.notes });
      W.cart = []; W.notes = '';
      toast(t('sent_ok'));
      await refreshWaiter(true);
    } catch (e) { logErr('waiter-send', e); toast(t('order_failed') + ' ' + t('please_try_again'), true); }
    finally { W.busy = false; renderWaiterTable(); }
  }

  async function markServed(o) {
    try { await api.setOrderStatus(o.ticket_id, 'SERVED'); await refreshWaiter(true); }
    catch (e) { logErr('served', e); toast(t('status_update_failed'), true); }
  }

  function renderWaiterTable() {
    var box = $('waiter-visit'); if (!box) return;
    var kids = [];
    kids.push(h('div', { class: 'row' }, [
      h('h2', { class: 'section-title', text: t('table_n', { n: W.table }) }),
      h('button', { type: 'button', class: 'btn btn-sm', text: t('change_table'), onclick: leaveWaiterTable })
    ]));

    if (!W.visit) {
      /* No OPEN visit: choose waiter and start one. */
      var select = h('select', { id: 'w-code', 'aria-label': t('choose_waiter') },
        [h('option', { value: '', text: t('choose_waiter') })].concat(W.waiters.map(function (w) {
          return h('option', { value: w.waiter_code, selected: w.waiter_code === W.waiterCode, text: (w.display_name || w.waiter_code) + ' (' + w.waiter_code + ')' });
        })));
      kids.push(h('div', { class: 'panel' }, [
        W.waiters.length ? select : h('p', { class: 'muted', text: t('no_waiters') }),
        h('button', { type: 'button', class: 'btn btn-primary btn-block', text: t('start_visit'), disabled: W.busy || !W.waiters.length, onclick: guard('start-visit', function () { return startVisit(($('w-code') || {}).value); }) })
      ]));
      mount(box, kids); return;
    }

    kids.push(h('div', { class: 'muted small', text: t('waiter_label') + ': ' + (W.visit.assigned_waiter_code || t('waiter_unknown')) }));

    /* Orders already on this table; ready ones can be marked served. */
    var mine = W.orders.filter(function (o) { return o._table === W.table; });
    if (mine.length) {
      kids.push(h('h2', { class: 'section-title', text: t('orders_this_table') }));
      kids.push(h('div', { class: 'panel' }, mine.map(function (o) {
        var lines = (W.items[o.id] || []).map(function (i) { return i.quantity + '× ' + i.item_name; }).join(', ');
        return h('div', { class: 'line' }, [
          h('div', { class: 'line-body' }, [
            h('div', null, [h('strong', { text: t('order_no', { n: o.order_number || String(o.ticket_id).slice(-5) }) + ' ' }), h('span', { class: statusChipClass(o.status), text: statusLabel(o.status) })]),
            h('div', { class: 'line-sub', text: lines })
          ]),
          up(o.status) === 'READY' ? h('button', { type: 'button', class: 'btn btn-sm btn-primary', text: t('mark_served'), onclick: function () { markServed(o); } }) : null
        ]);
      })));
    }

    kids.push(h('h2', { class: 'section-title', text: t('food') }));
    kids.push(h('input', { type: 'search', id: 'w-search', value: W.q, placeholder: t('search_food'), autocomplete: 'off',
      oninput: function (ev) { W.q = ev.target.value; renderWaiterMenuOnly(); } }));
    kids.push(h('div', { class: 'menu-list', id: 'w-menu' }));
    kids.push(h('div', { id: 'w-order' }));
    mount(box, kids);
    renderWaiterMenuOnly(); renderWaiterOrder();
  }

  function renderWaiterMenuOnly() {
    var list = $('w-menu'); if (!list) return;
    var q = W.q.trim().toLowerCase();
    var rows = S.menu.filter(function (i) { return !q || String(i.name || '').toLowerCase().indexOf(q) >= 0; }).slice(0, 80);
    if (!rows.length) { mount(list, [h('div', { class: 'empty', text: S.menu.length ? t('no_items') : t('menu_empty') })]); return; }
    mount(list, rows.map(function (i) { return itemRow(i, function (x) { wAdd(x); }, function (x) { wSub(x); }, wQty); }));
  }

  function renderWaiterOrder() {
    var box = $('w-order'); if (!box) return;
    if (!W.cart.length) { clear(box); return; }
    var total = 0;
    W.cart.forEach(function (l) { total += l.price * l.qty; });
    mount(box, [h('div', { class: 'sticky-order' }, [
      h('h2', { class: 'section-title', text: t('order_lines') }),
      h('div', null, W.cart.map(function (l) {
        var spice = h('select', { 'aria-label': t('spice_label'), onchange: function (ev) { l.spice = ev.target.value; } },
          ['normal', 'mild', 'medium', 'hot'].map(function (s) { return h('option', { value: s, selected: l.spice === s, text: t('spice_' + s) }); }));
        return h('div', { class: 'line' }, [
          h('div', { class: 'line-body' }, [h('div', { text: l.name + ' × ' + l.qty }), h('div', { class: 'line-sub', text: rs(l.price * l.qty) }), spice]),
          h('div', { class: 'qty' }, [
            h('button', { type: 'button', text: '−', onclick: function () { wSub(l); } }),
            h('button', { type: 'button', class: 'plus', text: '+', onclick: function () { wAdd(l); } })
          ])
        ]);
      })),
      h('textarea', { rows: '2', maxlength: '1000', placeholder: t('special_request'), oninput: function (ev) { W.notes = ev.target.value; } }, [W.notes]),
      h('div', { class: 'cart-total-row' }, [h('span', { text: t('total') }), h('strong', { text: rs(total) })]),
      h('button', { type: 'button', class: 'btn btn-primary btn-block', text: W.busy ? t('submitting_order') : t('send_to_kitchen'), disabled: W.busy, onclick: guard('waiter-send', sendToKitchen) })
    ])]);
  }

  /* =================================================================== OWNER */
  var ownerPanel = 'orders';
  var O = { orders: [], tables: [], visits: [], items: {}, notifications: [], bills: {}, menu: [], bookings: [], config: null, state: 'loading', menuQ: '' };

  function setOwnerPanel(name) {
    ownerPanel = name;
    document.querySelectorAll('#owner-nav button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-panel') === name); });
    O.state = 'loading'; renderOwnerPanel();
    guard('owner:' + name, function () { return refreshOwnerPanel(false); })();
  }

  async function refreshOwnerPanel(quiet) {
    if (S.role !== 'admin') return;
    var panel = ownerPanel;
    try {
      if (panel === 'orders' || panel === 'tables' || panel === 'payments') {
        var r = await Promise.all([api.staffOrders(false), api.staffTables(), api.tableVisits()]);
        O.orders = r[0]; O.tables = r[1]; O.visits = r[2];
        var items = await api.orderItems(O.orders.map(function (o) { return o.id; }));
        O.items = {}; items.forEach(function (i) { (O.items[i.order_id] = O.items[i.order_id] || []).push(i); });
        if (panel !== 'orders') { try { O.notifications = await api.notifications(60); } catch (e) { logErr('notifications', e); O.notifications = []; } }
        if (panel === 'payments') {
          var open = O.visits.filter(function (v) { return up(v.status) === 'OPEN' && v.visit_id; });
          O.bills = {};
          await Promise.all(open.map(function (v) {
            return api.visitBill(v.visit_id).then(function (b) { O.bills[v.visit_id] = b; }).catch(function (e) { logErr('bill', e); });
          }));
        }
      } else if (panel === 'menu') { var m = await api.loadMenu(); O.menu = m.items; }
      else if (panel === 'bookings') { O.bookings = await api.listBookings(); }
      else if (panel === 'settings') { O.config = await api.loadConfig(); }
      O.state = 'ok';
    } catch (e) {
      logErr('owner-' + panel, e);
      if (!quiet) O.state = 'error';
    }
    if (panel === ownerPanel) {
      /* Do not rebuild a form while the owner is typing in it. */
      var typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && $('owner-panel').contains(document.activeElement);
      if (!(quiet && typing)) renderOwnerPanel();
    }
  }

  function tableNum(id) { var tb = O.tables.filter(function (x) { return x.id === id; })[0]; return tb ? pad2(tb.table_number) : '?'; }
  function visitFor(num) { return O.visits.filter(function (v) { return pad2(v.table_number) === num && up(v.status) === 'OPEN'; })[0] || null; }
  /* Guest payment requests are PAYMENT_CHECK (UPI) and CASH_AT_COUNTER; PAYMENT_RECEIVED is a confirmation, not a request. */
  var PAY_REQUEST_RE = /^(PAYMENT_CHECK|CASH_AT_COUNTER|BILL_REQUEST)$/i;
  function isPayRequest(n) { return PAY_REQUEST_RE.test(String(n.notification_type || '')); }
  /* Only requests made during the table's CURRENT visit count; older ones belong to a previous guest. */
  function paymentRequested(num) {
    var v = visitFor(num);
    var since = v && v.started_at ? new Date(v.started_at).getTime() : 0;
    return O.notifications.some(function (n) {
      return pad2(n.table_number) === num && isPayRequest(n) && (!since || new Date(n.created_at).getTime() >= since);
    });
  }
  function itemsText(o) { return (O.items[o.id] || []).map(function (i) { return i.quantity + '× ' + i.item_name; }).join(', '); }

  function renderOwnerPanel() {
    var box = $('owner-panel'); if (!box) return;
    if (O.state === 'loading') { mount(box, [h('div', { class: 'loading', text: t('loading') })]); return; }
    if (O.state === 'error') { mount(box, [h('div', { class: 'empty' }, [h('p', { text: t('something_wrong') }), h('button', { type: 'button', class: 'btn', text: t('try_again'), onclick: function () { setOwnerPanel(ownerPanel); } })])]); return; }
    if (ownerPanel === 'orders') renderOwnerOrders(box);
    else if (ownerPanel === 'tables') renderOwnerTables(box);
    else if (ownerPanel === 'payments') renderOwnerPayments(box);
    else if (ownerPanel === 'menu') renderOwnerMenu(box);
    else if (ownerPanel === 'bookings') renderOwnerBookings(box);
    else renderOwnerSettings(box);
  }

  function renderOwnerOrders(box) {
    if (!O.orders.length) { mount(box, [h('div', { class: 'empty', text: t('orders_empty') })]); return; }
    mount(box, O.orders.map(function (o) {
      var num = tableNum(o.table_id); var v = visitFor(num); var st = up(o.status);
      return h('div', { class: 'panel' }, [
        h('div', { class: 'row' }, [h('strong', { text: t('order_no', { n: o.order_number || String(o.ticket_id).slice(-5) }) }), h('span', { class: statusChipClass(st), text: statusLabel(st) })]),
        h('div', { class: 'muted small', text: t('table_n', { n: num }) + ' · ' + t('waiter_label') + ': ' + ((v && v.assigned_waiter_code) || t('waiter_unknown')) }),
        h('div', { class: 'line-sub', text: itemsText(o) }),
        h('div', { class: 'row' }, [h('strong', { text: rs(o.total) }), st === 'CANCELLED' ? null : h('span', { class: st === 'PAID' ? 'chip ok' : 'chip warn', text: st === 'PAID' ? t('paid') : t('unpaid') })])
      ]);
    }));
  }

  function tableStateLabel(num) {
    var v = visitFor(num);
    if (!v) return { cls: 'tbl', label: t('st_available') };
    if (paymentRequested(num)) return { cls: 'tbl pay', label: t('st_payment') };
    var mine = O.orders.filter(function (o) { return tableNum(o.table_id) === num && ['NEW', 'PREPARING', 'READY'].indexOf(up(o.status)) >= 0; });
    if (mine.some(function (o) { return up(o.status) === 'READY'; })) return { cls: 'tbl ready', label: t('st_ready') };
    if (mine.some(function (o) { return up(o.status) === 'PREPARING'; })) return { cls: 'tbl open', label: t('st_preparing') };
    if (mine.length) return { cls: 'tbl open', label: t('st_active') };
    var any = O.orders.some(function (o) { return tableNum(o.table_id) === num && up(o.status) !== 'CANCELLED'; });
    return { cls: 'tbl open', label: any ? t('st_completed') : t('st_open') };
  }

  function renderOwnerTables(box) {
    var tables = O.tables.slice().sort(function (a, b) { return pad2(a.table_number).localeCompare(pad2(b.table_number)); });
    if (!tables.length) { mount(box, [h('div', { class: 'empty', text: t('tables_empty') })]); return; }
    mount(box, [h('div', { class: 'table-grid' }, tables.map(function (tb) {
      var num = pad2(tb.table_number); var st = tableStateLabel(num); var v = visitFor(num);
      return h('div', { class: st.cls + ' panel', style: 'cursor:default' }, [
        h('strong', { text: t('table_n', { n: num }) }),
        h('small', { text: st.label }),
        v ? h('small', { text: t('waiter_label') + ': ' + (v.assigned_waiter_code || t('waiter_unknown')) }) : null,
        v ? h('button', { type: 'button', class: 'btn btn-sm', text: t('release_table'), onclick: guard('release', function () { return releaseTable(num); }) }) : null
      ]);
    }))]);
  }

  async function releaseTable(num) {
    if (!window.confirm(t('release_confirm'))) return;     /* history is kept: this only closes the visit */
    try { await api.releaseAbandoned(num, 'Released by owner'); toast(t('released')); }
    catch (e) { logErr('release', e); toast(t('visit_failed'), true); }
    await refreshOwnerPanel(false);
  }

  function renderOwnerPayments(box) {
    var open = O.visits.filter(function (v) { return up(v.status) === 'OPEN' && v.visit_id; });
    var reqs = O.notifications.filter(function (n) {
      if (!isPayRequest(n)) return false;
      var v = visitFor(pad2(n.table_number));
      return !!v && (!v.started_at || new Date(n.created_at).getTime() >= new Date(v.started_at).getTime());
    });
    var kids = [];
    if (reqs.length) {
      kids.push(h('h2', { class: 'section-title', text: t('payment_requests') }));
      kids.push(h('div', { class: 'panel' }, reqs.map(function (n) {
        return h('div', { class: 'line' }, [h('div', { class: 'line-body' }, [h('strong', { text: t('table_n', { n: pad2(n.table_number) }) }), h('div', { class: 'line-sub', text: n.message || '' })])]);
      })));
    }
    kids.push(h('h2', { class: 'section-title', text: t('open_bills') }));
    var rows = open.filter(function (v) { var b = O.bills[v.visit_id]; return b && Number(b.amount) > 0; });
    if (!rows.length) kids.push(h('div', { class: 'empty', text: t('payments_empty') }));
    rows.forEach(function (v) {
      var b = O.bills[v.visit_id]; var amount = Number(b.amount) || 0; var num = pad2(v.table_number);
      kids.push(h('div', { class: 'panel' }, [
        h('div', { class: 'row' }, [h('strong', { text: t('table_n', { n: num }) }), h('strong', { text: t('balance') + ' ' + rs(amount) })]),
        h('div', { class: 'muted small', text: t('waiter_label') + ': ' + (v.assigned_waiter_code || t('waiter_unknown')) }),
        h('button', { type: 'button', class: 'btn btn-primary btn-block', text: t('confirm_cash'), onclick: guard('pay-cash', function () { return confirmPayment(v, amount, 'cash'); }) }),
        h('button', { type: 'button', class: 'btn btn-soft btn-block', text: t('confirm_upi'), onclick: guard('pay-upi', function () { return confirmPayment(v, amount, 'upi'); }) })
      ]));
    });
    mount(box, kids);
  }

  /* Cash is NEVER auto-paid: only this explicit owner action records payment. */
  async function confirmPayment(v, amount, method) {
    if (!window.confirm(t('confirm_payment_prompt', { amount: amount, n: pad2(v.table_number) }))) return;
    try { await api.recordPayment(v.visit_id, amount, method, 'Confirmed by owner'); toast(t('payment_recorded')); }
    catch (e) { logErr('record-payment', e); toast(t('payment_failed'), true); }
    await refreshOwnerPanel(false);
  }

  function renderOwnerMenu(box) {
    var q = O.menuQ.trim().toLowerCase();
    var rows = O.menu.filter(function (i) { return !q || String(i.name || '').toLowerCase().indexOf(q) >= 0; }).slice(0, 120);
    var kids = [h('input', { type: 'search', value: O.menuQ, placeholder: t('search_food'), autocomplete: 'off',
      oninput: function (ev) { O.menuQ = ev.target.value; renderOwnerMenuRows(); } }), h('div', { id: 'om-rows', class: 'menu-list', style: 'margin-top:10px' })];
    mount(box, kids); renderOwnerMenuRows();
  }
  function renderOwnerMenuRows() {
    var list = $('om-rows'); if (!list) return;
    var q = O.menuQ.trim().toLowerCase();
    var rows = O.menu.filter(function (i) { return !q || String(i.name || '').toLowerCase().indexOf(q) >= 0; }).slice(0, 120);
    if (!rows.length) { mount(list, [h('div', { class: 'empty', text: t('no_items') })]); return; }
    mount(list, rows.map(function (i) {
      var input = h('input', { type: 'number', class: 'mini-input', inputmode: 'numeric', min: '0', value: String(Math.round(Number(i.price) || 0)), 'aria-label': t('price') });
      return h('div', { class: 'item' + (i.is_available === false ? ' off' : '') }, [
        h('div', { class: 'item-body' }, [h('div', { class: 'item-name', text: i.name }), h('div', { class: 'muted small', text: i.is_available === false ? t('unavailable') : t('available') })]),
        input,
        h('button', { type: 'button', class: 'btn btn-sm', text: t('save'), onclick: guard('menu-price', function () { return savePrice(i, input.value); }) }),
        h('button', { type: 'button', class: 'btn btn-sm', text: i.is_available === false ? t('available') : t('unavailable'), onclick: guard('menu-avail', function () { return toggleAvail(i); }) })
      ]);
    }));
  }
  async function savePrice(item, value) {
    var p = Number(value);
    if (!isFinite(p) || p < 0) { toast(t('save_failed'), true); return; }
    try { await api.updatePrice(item.id, p); item.price = Math.round(p); toast(t('saved')); }
    catch (e) { logErr('price', e); toast(t('save_failed'), true); }
  }
  async function toggleAvail(item) {
    var next = item.is_available === false;
    try { await api.setAvailable(item.id, next); item.is_available = next; renderOwnerMenuRows(); toast(t('saved')); }
    catch (e) { logErr('avail', e); toast(t('save_failed'), true); }
  }

  function renderOwnerBookings(box) {
    if (!O.bookings.length) { mount(box, [h('div', { class: 'empty', text: t('bookings_empty') })]); return; }
    mount(box, O.bookings.map(function (b) {
      var st = up(b.status || 'NEW');
      return h('div', { class: 'panel' }, [
        h('div', { class: 'row' }, [h('strong', { text: b.customer_name || '' }), h('span', { class: 'chip', text: t('bk_' + st.toLowerCase()) })]),
        h('div', { class: 'muted small', text: [b.event_type, b.event_date, b.event_time, (b.guest_count || '') + ' ' + t('guests')].join(' · ') }),
        h('a', { class: 'link', href: 'tel:' + String(b.customer_phone || '').replace(/[^0-9+]/g, ''), text: b.customer_phone || '' }),
        b.customer_notes ? h('div', { class: 'line-sub', text: b.customer_notes }) : null,
        b.owner_notes ? h('div', { class: 'muted small', text: b.owner_notes }) : null,
        h('div', { class: 'row' }, ['CONTACTED', 'CONFIRMED', 'UNAVAILABLE'].map(function (s) {
          return h('button', { type: 'button', class: 'btn btn-sm' + (st === s ? ' btn-primary' : ''), text: t('bk_' + s.toLowerCase()), onclick: guard('booking', function () { return setBooking(b, s); }) });
        }))
      ]);
    }));
  }
  async function setBooking(b, status) {
    try { await api.updateBooking(b.id, status, ''); b.status = status; toast(t('saved')); renderOwnerPanel(); }
    catch (e) { logErr('booking', e); toast(t('save_failed'), true); }
  }

  function renderOwnerSettings(box) {
    var c = O.config || {};
    function field(key, labelKey, value, type) {
      return h('label', null, [h('span', { text: t(labelKey) }), h('input', { name: key, type: type || 'text', value: value || '', autocomplete: 'off' })]);
    }
    var form = h('form', { class: 'form', novalidate: true, onsubmit: guard('settings', saveSettings) }, [
      field('whatsapp_number', 'whatsapp_number', c.whatsapp_number, 'tel'),
      field('google_reviews_url', 'google_review_url', c.google_reviews_url, 'url'),
      field('upi_id', 'upi_id', c.upi_id),
      field('upi_name', 'upi_name', c.upi_name),
      field('pay_note', 'pay_note', c.pay_note),
      h('p', { class: 'error-line', id: 'settings-error', hidden: true }),
      h('button', { type: 'submit', class: 'btn btn-primary btn-block', text: t('save') })
    ]);
    mount(box, [h('div', { class: 'panel' }, [form])]);
  }
  async function saveSettings(ev) {
    ev.preventDefault();
    var f = ev.target; var err = $('settings-error'); err.hidden = true;
    var wa = f.elements.whatsapp_number.value.replace(/[^0-9]/g, '');
    var url = f.elements.google_reviews_url.value.trim();
    if ((wa && (wa.length < 10 || wa.length > 15)) || (url && !/^https:\/\//i.test(url))) { err.textContent = t('save_failed'); err.hidden = false; return; }
    try {
      await api.saveConfig({
        whatsapp_number: wa, google_reviews_url: url, upi_id: f.elements.upi_id.value.trim(),
        upi_name: f.elements.upi_name.value.trim(), pay_note: f.elements.pay_note.value.trim()
      });
      O.config = await api.loadConfig(); S.config = O.config;
      toast(t('saved'));
    } catch (e) { logErr('settings', e); err.textContent = t('save_failed'); err.hidden = false; }
  }

  /* =================================================================== BOOT */
  function wire() {
    $('btn-lang').addEventListener('click', toggleLang);
    document.querySelectorAll('[data-action="lang"]').forEach(function (b) { b.addEventListener('click', toggleLang); });
    $('btn-gate-retry').addEventListener('click', guard('gate', loadGate));
    $('btn-view-order').addEventListener('click', function () { openOrder(null); });
    $('btn-open-cart').addEventListener('click', function () {
      orderErrorShown = false; go('cart'); renderCart();
      guard('gate', async function () { await loadGate(); if (currentScreen === 'cart') renderCart(); })();
    });
    $('btn-cart-back').addEventListener('click', function () { go('home'); renderScreen('home'); });
    $('btn-place-order').addEventListener('click', guard('place-order', placeOrder));
    $('order-notes').addEventListener('input', function () { orderErrorShown = false; });
    $('btn-placed-view').addEventListener('click', function () { openOrder(lastPlaced && lastPlaced.id); });
    $('btn-order-back').addEventListener('click', function () { go('home'); renderScreen('home'); });
    $('btn-pay-back').addEventListener('click', function () { go('order'); renderOrderDetail(); });
    $('btn-pay-upi').addEventListener('click', guard('pay-upi', payUpiStart));
    $('btn-upi-paid').addEventListener('click', guard('pay-upi', function () { return sendPaymentRequest('upi'); }));
    $('btn-pay-cash').addEventListener('click', guard('pay-cash', function () { return sendPaymentRequest('cash'); }));
    $('btn-party').addEventListener('click', openParty);
    $('btn-party-back').addEventListener('click', function () { go('home'); renderScreen('home'); });
    $('party-form').addEventListener('submit', guard('party', submitParty));
    $('btn-staff').addEventListener('click', function () { openLogin(null); });
    $('btn-login-back').addEventListener('click', function () { go('home'); renderScreen('home'); });
    document.querySelectorAll('#role-tabs .role-tab').forEach(function (b) { b.addEventListener('click', function () { setLoginRole(b.getAttribute('data-role')); }); });
    $('login-form').addEventListener('submit', guard('login', doLogin));
    ['btn-waiter-logout', 'btn-kitchen-logout', 'btn-owner-logout'].forEach(function (id) { $(id).addEventListener('click', guard('logout', doLogout)); });
    document.querySelectorAll('#owner-nav button').forEach(function (b) { b.addEventListener('click', function () { setOwnerPanel(b.getAttribute('data-panel')); }); });
    $('search-food').addEventListener('input', function (ev) { searchTerm = ev.target.value; renderMenu(); });
  }

  async function boot() {
    MM.ctx = 'boot';
    wire();
    MM.applyI18n();
    var p = parseTableParam();
    S.table = p.table; tableInvalid = p.invalid;
    loadCart();
    renderGate(); renderMenu(); renderStrip();
    try { history.replaceState({ screen: 'home' }, ''); } catch (e) { /* ignore */ }

    /* Deep links used by staff push notifications: ?staff=waiter|kitchen|admin */
    var staffParam = new URLSearchParams(location.search).get('staff');

    MM.booted = true;           /* cancels the boot watchdog: the page is alive and showing real UI */

    if (!api.ready()) { menuStatus = 'error'; renderMenu(); toast(t('offline'), true); return; }

    var restored = false;
    try { restored = await restoreSession(); } catch (e) { logErr('restore', e); }
    if (!restored && staffParam) openLogin(staffParam === 'owner' ? 'admin' : staffParam);

    /* Customer data loads in parallel; each part shows its own loading / error state. */
    api.loadConfig().then(function (c) { S.config = c; }).catch(function (e) { logErr('config', e); });
    if (!restored || S.menu.length === 0) {
      await Promise.all([guard('menu', loadMenu)(), guard('gate', loadGate)()]).catch(function () { /* handled inside */ });
    }
    guard('orders', refreshMyOrders)();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', guard('boot', boot));
  else guard('boot', boot)();

  MM.app = { go: go, show: show };   /* exposed for debugging */
})();
