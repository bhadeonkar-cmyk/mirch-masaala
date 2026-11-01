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
    if (!m) return null;
    return api.pad2(m[1]);
  }

  async function checkTableGate(table) {
    S.table = table;
    var gateEl = $('gate');
    var msg = $('gate-msg');
    var retry = $('btn-gate-retry');
    if (gateEl) gateEl.hidden = false;
    if (msg) msg.textContent = MM.t('checking_table');
    if (retry) retry.hidden = true;
    try {
      var st = await api.tableStatus(table);
      S.gate = st;
      S.visitId = st && (st.visit_id || st.visitId || st.id) || null;
      var status = String((st && (st.status || st.visit_status || st.state)) || '').toUpperCase();
      var open = status === 'OPEN' || status === 'ACTIVE' || status === 'BUSY' || !!S.visitId;
      if (!st) {
        if (msg) msg.textContent = MM.t('table_not_found');
        if (retry) retry.hidden = false;
        return false;
      }
      if (!open) {
        if (msg) msg.textContent = MM.t('table_not_open');
        if (retry) retry.hidden = false;
        return false;
      }
      if (gateEl) gateEl.hidden = true;
      var label = $('menu-table-label');
      if (label) label.textContent = MM.t('table_n', { n: table });
      var statusEl = $('menu-status');
      if (statusEl) statusEl.textContent = MM.t('table_ready');
      return true;
    } catch (e) {
      console.error('[MM gate]', e);
      if (msg) msg.textContent = MM.t('offline');
      if (retry) retry.hidden = false;
      return false;
    }
  }

  /* ---------- menu ---------- */
  async function loadMenuUI() {
    var list = $('menu-list');
    if (list) list.innerHTML = '<div class="loading">' + MM.t('loading_menu') + '</div>';
    try {
      var data = await api.loadMenu();
      S.categories = (data.categories || []).filter(function (c) { return c.is_active !== false; });
      S.menu = data.items || [];
      try { S.config = await api.loadConfig(); } catch (e) {}
      renderCategories();
      renderMenu();
    } catch (e) {
      console.error('[MM menu]', e);
      if (list) list.innerHTML = '<div class="empty">' + MM.t('menu_error') + '</div>';
    }
  }

  function renderCategories() {
    var el = $('categories');
    if (!el) return;
    var html = '<button type="button" class="cat on" data-cat="">' + MM.t('all') + '</button>';
    S.categories.forEach(function (c) {
      html += '<button type="button" class="cat" data-cat="' + c.id + '">' + escapeHtml(c.name) + '</button>';
    });
    el.innerHTML = html;
    el.onclick = function (ev) {
      var btn = ev.target.closest('.cat');
      if (!btn) return;
      qsa('.cat', el).forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      renderMenu(btn.getAttribute('data-cat') || '');
    };
  }

  function renderMenu(catId) {
    var list = $('menu-list');
    if (!list) return;
    var q = (($('search-food') || {}).value || '').trim().toLowerCase();
    var items = S.menu.filter(function (it) {
      if (it.is_available === false) return false;
      if (catId && String(it.category_id) !== String(catId)) return false;
      if (q && String(it.name || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if (!items.length) {
      list.innerHTML = '<div class="empty">' + MM.t('no_items') + '</div>';
      return;
    }
    var html = '';
    items.forEach(function (it) {
      var veg = it.is_veg ? '<span class="veg" title="Veg">●</span>' : '<span class="nonveg" title="Non-veg">●</span>';
      var price = Math.round(Number(it.price) || 0);
      html += '<div class="food-card" data-id="' + it.id + '">' +
        '<div class="food-info">' +
          '<div class="food-name">' + veg + ' ' + escapeHtml(it.name) + '</div>' +
          (it.description ? '<div class="food-desc muted small">' + escapeHtml(it.description) + '</div>' : '') +
          '<div class="food-price">₹' + price + '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-sm btn-add" data-add="' + it.id + '">' + MM.t('add') + '</button>' +
      '</div>';
    });
    list.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
  }

  function addToCart(id) {
    var it = S.menu.find(function (m) { return String(m.id) === String(id); });
    if (!it) return;
    var existing = S.cart.find(function (c) { return String(c.id) === String(id); });
    if (existing) existing.qty = (existing.qty || 1) + 1;
    else S.cart.push({ id: it.id, name: it.name, price: Number(it.price) || 0, qty: 1, spice: 'normal', notes: '' });
    saveCart();
    updateCartBar();
    toast(it.name + ' +1');
  }

  /* ---------- cart screen ---------- */
  function showCart() {
    showScreen('screen-cart');
    renderCart();
  }

  function renderCart() {
    var box = $('cart-items');
    var foot = $('cart-footer');
    if (!box) return;
    if (!S.cart.length) {
      box.innerHTML = '<div class="empty">' + MM.t('cart_empty') + '</div>';
      if (foot) foot.hidden = true;
      return;
    }
    if (foot) foot.hidden = false;
    var html = '';
    S.cart.forEach(function (c, idx) {
      html += '<div class="cart-row" data-idx="' + idx + '">' +
        '<div class="cart-name">' + escapeHtml(c.name) + '</div>' +
        '<div class="cart-qty">' +
          '<button type="button" class="qty-btn" data-act="-">−</button>' +
          '<span>' + (c.qty || 1) + '</span>' +
          '<button type="button" class="qty-btn" data-act="+">+</button>' +
        '</div>' +
        '<div class="cart-price">₹' + Math.round((c.price || 0) * (c.qty || 1)) + '</div>' +
        '<button type="button" class="link remove" data-act="rm">' + MM.t('remove') + '</button>' +
      '</div>';
    });
    box.innerHTML = html;
    $('cart-page-total').textContent = Math.round(cartTotal());
  }

  /* ---------- place order ---------- */
  async function placeOrder() {
    if (!S.table) {
      toast(MM.t('scan_qr'));
      return;
    }
    if (!S.cart.length) return;
    var btn = $('btn-place-order');
    var err = $('order-error');
    if (err) err.hidden = true;
    if (btn) { btn.disabled = true; btn.textContent = MM.t('submitting_order'); }
    try {
      var sessionId = S.visitId ? api.customerSessionId(S.visitId) : null;
      var created = await api.placeOrder({
        table: S.table,
        visitId: S.visitId,
        sessionId: sessionId,
        notes: (($('order-notes') || {}).value || '').trim(),
        items: S.cart.map(function (c) {
          return { id: c.id, qty: c.qty || 1, spice: c.spice || 'normal', notes: c.notes || '' };
        })
      });
      var ticket = created.ticket_id || created.ticketId || created.ticket || '';
      var token = created.publicToken || created.public_token || '';
      var orderNumber = created.order_number || created.orderNumber || ticket;
      saveMyOrder({
        id: created.id,
        ticket: ticket,
        token: token,
        table: S.table,
        visitId: S.visitId,
        orderNumber: orderNumber,
        at: Date.now()
      });
      S.cart = [];
      saveCart();
      updateCartBar();
      $('placed-number').textContent = MM.t('order_no', { n: orderNumber });
      showScreen('screen-placed');
    } catch (e) {
      console.error('[MM placeOrder]', e);
      if (err) {
        err.textContent = MM.t('order_failed') + ' ' + MM.t('please_try_again');
        err.hidden = false;
      }
      toast(MM.t('order_failed'));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = MM.t('place_order'); }
    }
  }

  /* ---------- order detail ---------- */
  async function showOrderDetail(o) {
    o = o || latestOrder();
    if (!o) { toast(MM.t('no_orders')); return; }
    showScreen('screen-order');
    var box = $('order-detail');
    if (!box) return;
    box.innerHTML = '<div class="loading">' + MM.t('loading_order') + '</div>';
    try {
      var detail = await api.getPublicOrder(o.ticket, o.token);
      if (!detail) {
        box.innerHTML = '<div class="empty">' + MM.t('order_not_found') + '</div>';
        return;
      }
      var status = String(detail.status || 'NEW').toUpperCase();
      var stKey = 'st_' + status.toLowerCase();
      var html = '<div class="order-card">' +
        '<div class="order-head">' +
          '<strong>' + MM.t('order_no', { n: detail.order_number || o.orderNumber || o.ticket }) + '</strong>' +
          '<span class="badge">' + MM.t(stKey) + '</span>' +
        '</div>' +
        '<div class="muted small">' + MM.t('table_n', { n: o.table || '—' }) + '</div>';
      var items = detail.items || detail.order_items || [];
      if (items.length) {
        html += '<ul class="order-items">';
        items.forEach(function (it) {
          html += '<li>' + escapeHtml(it.item_name || it.name) + ' × ' + (it.quantity || it.qty || 1) +
            ' <span class="muted">₹' + Math.round(it.price || 0) + '</span></li>';
        });
        html += '</ul>';
      }
      html += '<div class="cart-total-row"><span>' + MM.t('total') + '</span><strong>₹' +
        Math.round(detail.total || 0) + '</strong></div>';
      html += '<button type="button" class="btn btn-primary btn-block" id="btn-pay-from-order">' +
        MM.t('pay_now') + '</button>';
      html += '<button type="button" class="btn btn-soft btn-block" id="btn-order-more">' +
        MM.t('new_order') + '</button>';
      html += '</div>';
      box.innerHTML = html;
      var payBtn = $('btn-pay-from-order');
      if (payBtn) payBtn.onclick = function () { showPay(o); };
      var moreBtn = $('btn-order-more');
      if (moreBtn) moreBtn.onclick = function () { showMenu(); };
    } catch (e) {
      console.error('[MM order]', e);
      box.innerHTML = '<div class="empty">' + MM.t('order_not_found') + '</div>';
    }
  }

  /* ---------- payment ---------- */
  async function showPay(o) {
    o = o || latestOrder();
    if (!o) return;
    showScreen('screen-pay');
    $('pay-choices').hidden = false;
    $('pay-upi').hidden = true;
    $('pay-msg').textContent = '';
    try {
      var bill = await api.guestBill(o.table, o.visitId, api.customerSessionId(o.visitId));
      var due = bill && (bill.balance || bill.due || bill.total) || 0;
      $('pay-total').textContent = Math.round(due);
    } catch (e) {
      $('pay-total').textContent = '—';
    }
  }

  async function requestPay(method) {
    var o = latestOrder();
    if (!o) return;
    try {
      await api.requestPayment(method, o.table, o.visitId, api.customerSessionId(o.visitId));
      $('pay-choices').hidden = true;
      if (method === 'cash') {
        $('pay-msg').textContent = MM.t('cash_requested');
      } else {
        $('pay-upi').hidden = false;
        $('pay-msg').textContent = MM.t('upi_requested');
        var cfg = S.config || {};
        if (cfg.upi_id) {
          $('upi-id-line').textContent = cfg.upi_id + (cfg.upi_name ? ' · ' + cfg.upi_name : '');
          var link = $('btn-upi-open');
          if (link) {
            link.href = 'upi://pay?pa=' + encodeURIComponent(cfg.upi_id) +
              '&pn=' + encodeURIComponent(cfg.upi_name || 'Mirch Masaala') +
              '&cu=INR';
            link.hidden = false;
          }
        }
      }
    } catch (e) {
      console.error('[MM pay]', e);
      toast(MM.t('pay_error'));
    }
  }

  /* ---------- party ---------- */
  async function submitParty(ev) {
    ev.preventDefault();
    var form = $('party-form');
    var err = $('party-error');
    var ok = $('party-ok');
    if (err) err.hidden = true;
    if (ok) ok.hidden = true;
    var fd = new FormData(form);
    var phone = String(fd.get('phone') || '').replace(/\D/g, '');
    if (phone.length < 10) {
      if (err) { err.textContent = MM.t('phone_hint'); err.hidden = false; }
      return;
    }
    var btn = $('btn-party-send');
    if (btn) { btn.disabled = true; btn.textContent = MM.t('sending'); }
    try {
      await api.submitParty({
        name: fd.get('name'),
        phone: phone,
        eventType: fd.get('eventType'),
        date: fd.get('date'),
        time: fd.get('time'),
        guests: fd.get('guests'),
        message: fd.get('message')
      });
      form.reset();
      if (ok) { ok.textContent = MM.t('booking_sent'); ok.hidden = false; }
      toast(MM.t('booking_sent'));
    } catch (e) {
      console.error('[MM party]', e);
      if (err) { err.textContent = MM.t('booking_failed'); err.hidden = false; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = MM.t('send_request'); }
    }
  }

  /* ---------- staff login ---------- */
  var wantedRole = 'waiter';

  async function doLogin(ev) {
    ev.preventDefault();
    var form = $('login-form');
    var err = $('login-error');
    if (err) err.hidden = true;
    var fd = new FormData(form);
    var user = String(fd.get('username') || '').trim();
    var pass = String(fd.get('password') || '');
    var btn = $('btn-login');
    if (btn) { btn.disabled = true; btn.textContent = MM.t('signing_in'); }
    try {
      await api.signIn(user, pass);
      var role = await api.myRole();
      if (!role) {
        await api.signOut();
        throw { userCode: 'no_role' };
      }
      if (role !== wantedRole && !(wantedRole === 'admin' && role === 'admin')) {
        await api.signOut();
        var e = new Error('wrong role');
        e.userCode = 'wrong_role';
        e.actual = role;
        e.wanted = wantedRole;
        throw e;
      }
      S.role = role;
      S.session = await api.getSession();
      if (role === 'waiter') showWaiter();
      else if (role === 'kitchen') showKitchen();
      else showOwner();
    } catch (e) {
      console.error('[MM login]', e);
      var msg = MM.t('login_failed');
      if (e && e.userCode === 'bad_username') msg = MM.t('login_bad_username');
      if (e && e.userCode === 'no_role') msg = MM.t('login_no_role');
      if (e && e.userCode === 'wrong_role') msg = MM.t('login_wrong_role', { actual: e.actual, wanted: e.wanted });
      if (e && e.userCode === 'offline') msg = MM.t('offline');
      if (err) { err.textContent = msg; err.hidden = false; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = MM.t('login'); }
    }
  }

  async function logout() {
    try { await api.signOut(); } catch (e) {}
    S.role = null;
    S.session = null;
    showWelcome();
  }

  /* ---------- waiter ---------- */
  async function showWaiter() {
    showScreen('screen-waiter');
    var box = $('waiter-tables');
    if (!box) return;
    box.innerHTML = '<div class="loading">' + MM.t('loading') + '</div>';
    try {
      var visits = await api.tableVisits();
      var tables = await api.staffTables();
      var byNum = {};
      (visits || []).forEach(function (v) {
        byNum[api.pad2(v.table_number || v.tableNumber)] = v;
      });
      var html = '';
      (tables || []).forEach(function (t) {
        var num = api.pad2(t.table_number || t.tableNumber);
        var v = byNum[num];
        var open = v && String(v.status || v.visit_status || '').toUpperCase() === 'OPEN';
        html += '<button type="button" class="table-card ' + (open ? 'busy' : 'free') + '" data-table="' + num + '">' +
          '<strong>' + num + '</strong>' +
          '<span class="muted small">' + (open ? MM.t('st_open') : MM.t('st_available')) + '</span>' +
        '</button>';
      });
      if (!html) html = '<div class="empty">' + MM.t('tables_empty') + '</div>';
      box.innerHTML = html;
      box.onclick = async function (ev) {
        var btn = ev.target.closest('.table-card');
        if (!btn) return;
        var num = btn.getAttribute('data-table');
        var v = byNum[num];
        var open = v && String(v.status || '').toUpperCase() === 'OPEN';
        try {
          if (!open) {
            await api.startVisit(num, null);
            toast(MM.t('visit_started'));
          }
          showWaiter();
        } catch (e) {
          console.error(e);
          toast(MM.t('visit_failed'));
        }
      };
    } catch (e) {
      console.error('[MM waiter]', e);
      box.innerHTML = '<div class="empty">' + MM.t('offline') + '</div>';
    }
  }

  /* ---------- kitchen ---------- */
  async function showKitchen() {
    showScreen('screen-kitchen');
    var board = $('kitchen-board');
    if (!board) return;
    board.innerHTML = '<div class="loading">' + MM.t('loading') + '</div>';
    try {
      var orders = await api.staffOrders(true);
      var ids = orders.map(function (o) { return o.id; });
      var items = await api.orderItems(ids);
      var byOrder = {};
      items.forEach(function (it) {
        (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it);
      });
      var lanes = { NEW: [], PREPARING: [], READY: [] };
      orders.forEach(function (o) {
        var st = String(o.status || 'NEW').toUpperCase();
        if (lanes[st]) lanes[st].push(o);
      });
      var html = '';
      ['NEW', 'PREPARING', 'READY'].forEach(function (lane) {
        html += '<div class="k-lane"><h3>' + MM.t('k_' + lane.toLowerCase()) + '</h3>';
        if (!lanes[lane].length) html += '<div class="empty small">' + MM.t('k_empty') + '</div>';
        lanes[lane].forEach(function (o) {
          var lines = byOrder[o.id] || [];
          html += '<div class="k-card" data-ticket="' + escapeHtml(o.ticket_id) + '">' +
            '<div class="k-head"><strong>' + escapeHtml(o.ticket_id || o.order_number) + '</strong></div>' +
            '<ul>';
          lines.forEach(function (it) {
            html += '<li>' + escapeHtml(it.item_name) + ' × ' + (it.quantity || 1) + '</li>';
          });
          html += '</ul>';
          if (lane === 'NEW') html += '<button type="button" class="btn btn-sm" data-next="PREPARING">' + MM.t('start') + '</button>';
          if (lane === 'PREPARING') html += '<button type="button" class="btn btn-sm" data-next="READY">' + MM.t('mark_ready') + '</button>';
          if (lane === 'READY') html += '<button type="button" class="btn btn-sm" data-next="SERVED">' + MM.t('mark_served') + '</button>';
          html += '</div>';
        });
        html += '</div>';
      });
      board.innerHTML = html;
      board.onclick = async function (ev) {
        var btn = ev.target.closest('[data-next]');
        if (!btn) return;
        var card = btn.closest('.k-card');
        var ticket = card && card.getAttribute('data-ticket');
        if (!ticket) return;
        try {
          await api.setOrderStatus(ticket, btn.getAttribute('data-next'));
          showKitchen();
        } catch (e) {
          toast(MM.t('status_update_failed'));
        }
      };
    } catch (e) {
      console.error('[MM kitchen]', e);
      board.innerHTML = '<div class="empty">' + MM.t('offline') + '</div>';
    }
  }

  /* ---------- owner (minimal panels) ---------- */
  async function showOwner() {
    showScreen('screen-owner');
    renderOwnerPanel('orders');
  }

  async function renderOwnerPanel(panel) {
    var box = $('owner-panel');
    if (!box) return;
    qsa('#owner-nav button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-panel') === panel);
    });
    box.innerHTML = '<div class="loading">' + MM.t('loading') + '</div>';
    try {
      if (panel === 'orders') {
        var orders = await api.staffOrders(false);
        var html = '<h2 class="section-title">' + MM.t('nav_orders') + '</h2>';
        if (!orders.length) html += '<div class="empty">' + MM.t('orders_empty') + '</div>';
        else {
          orders.slice(0, 40).forEach(function (o) {
            html += '<div class="order-card compact">' +
              '<strong>' + escapeHtml(o.ticket_id || o.order_number) + '</strong> ' +
              '<span class="badge">' + escapeHtml(o.status) + '</span>' +
              '<div class="muted small">₹' + Math.round(o.total || 0) + '</div></div>';
          });
        }
        box.innerHTML = html;
      } else if (panel === 'tables') {
        var visits = await api.tableVisits();
        var html = '<h2 class="section-title">' + MM.t('nav_tables') + '</h2><div class="table-grid">';
        (visits || []).forEach(function (v) {
          var num = api.pad2(v.table_number || v.tableNumber);
          var st = String(v.status || '').toUpperCase();
          html += '<div class="table-card ' + (st === 'OPEN' ? 'busy' : 'free') + '">' +
            '<strong>' + num + '</strong><span class="muted small">' + st + '</span></div>';
        });
        html += '</div>';
        box.innerHTML = html;
      } else if (panel === 'settings') {
        var cfg = await api.loadConfig() || {};
        box.innerHTML = '<h2 class="section-title">' + MM.t('nav_settings') + '</h2>' +
          '<form id="settings-form" class="form">' +
          '<label><span>' + MM.t('whatsapp_number') + '</span><input name="whatsapp_number" value="' + escapeHtml(cfg.whatsapp_number || '') + '"></label>' +
          '<label><span>' + MM.t('upi_id') + '</span><input name="upi_id" value="' + escapeHtml(cfg.upi_id || '') + '"></label>' +
          '<label><span>' + MM.t('upi_name') + '</span><input name="upi_name" value="' + escapeHtml(cfg.upi_name || '') + '"></label>' +
          '<label><span>' + MM.t('google_review_url') + '</span><input name="google_reviews_url" value="' + escapeHtml(cfg.google_reviews_url || '') + '"></label>' +
          '<button type="submit" class="btn btn-primary btn-block">' + MM.t('save') + '</button></form>';
        $('settings-form').onsubmit = async function (ev) {
          ev.preventDefault();
          var fd = new FormData(ev.target);
          try {
            await api.saveConfig({
              whatsapp_number: fd.get('whatsapp_number'),
              upi_id: fd.get('upi_id'),
              upi_name: fd.get('upi_name'),
              google_reviews_url: fd.get('google_reviews_url')
            });
            toast(MM.t('saved'));
          } catch (e) { toast(MM.t('something_wrong')); }
        };
      } else {
        box.innerHTML = '<div class="empty">' + MM.t(panel) + '</div>';
      }
    } catch (e) {
      box.innerHTML = '<div class="empty">' + MM.t('offline') + '</div>';
    }
  }

  /* ---------- wire events ---------- */
  function wire() {
    document.body.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.closest('#btn-lang') || t.closest('[data-action="lang"]')) {
        toggleLang();
        return;
      }
      if (t.closest('#btn-scan-qr')) {
        toast(MM.t('scan_qr_hint'));
        return;
      }
      if (t.closest('#btn-view-menu')) {
        S.table = null;
        showMenu();
        return;
      }
      if (t.closest('#btn-party') || t.closest('#btn-party')) {
        showScreen('screen-party');
        return;
      }
      if (t.closest('#btn-staff')) {
        showScreen('screen-login');
        return;
      }
      if (t.closest('#btn-menu-home') || t.closest('#btn-cart-back') || t.closest('#btn-order-back') ||
          t.closest('#btn-pay-back') || t.closest('#btn-party-back') || t.closest('#btn-login-back')) {
        if (S.table) showMenu();
        else showWelcome();
        return;
      }
      if (t.closest('#btn-open-cart')) { showCart(); return; }
      if (t.closest('#btn-place-order')) { placeOrder(); return; }
      if (t.closest('#btn-placed-view') || t.closest('#btn-view-order') || t.closest('#btn-view-order-home')) {
        showOrderDetail();
        return;
      }
      if (t.closest('#btn-pay-upi')) { requestPay('upi'); return; }
      if (t.closest('#btn-pay-cash')) { requestPay('cash'); return; }
      if (t.closest('#btn-upi-paid')) {
        $('pay-msg').textContent = MM.t('upi_requested');
        return;
      }
      if (t.closest('#btn-gate-retry')) {
        if (S.table) checkTableGate(S.table).then(function (ok) { if (ok) loadMenuUI(); });
        return;
      }
      if (t.closest('#btn-waiter-logout') || t.closest('#btn-kitchen-logout') || t.closest('#btn-owner-logout')) {
        logout();
        return;
      }
      var add = t.closest('[data-add]');
      if (add) { addToCart(add.getAttribute('data-add')); return; }
      var qty = t.closest('.qty-btn');
      if (qty) {
        var row = qty.closest('.cart-row');
        var idx = Number(row && row.getAttribute('data-idx'));
        var act = qty.getAttribute('data-act');
        if (S.cart[idx]) {
          if (act === '+') S.cart[idx].qty = (S.cart[idx].qty || 1) + 1;
          if (act === '-') S.cart[idx].qty = Math.max(1, (S.cart[idx].qty || 1) - 1);
          if (act === 'rm' || t.closest('[data-act="rm"]')) S.cart.splice(idx, 1);
          saveCart();
          renderCart();
          updateCartBar();
        }
        return;
      }
      var rm = t.closest('[data-act="rm"]');
      if (rm) {
        var row2 = rm.closest('.cart-row');
        var idx2 = Number(row2 && row2.getAttribute('data-idx'));
        if (!isNaN(idx2)) { S.cart.splice(idx2, 1); saveCart(); renderCart(); updateCartBar(); }
        return;
      }
      var roleTab = t.closest('.role-tab');
      if (roleTab) {
        qsa('.role-tab').forEach(function (b) { b.classList.remove('on'); });
        roleTab.classList.add('on');
        wantedRole = roleTab.getAttribute('data-role') || 'waiter';
        return;
      }
      var nav = t.closest('#owner-nav button');
      if (nav) {
        renderOwnerPanel(nav.getAttribute('data-panel'));
        return;
      }
    });

    var search = $('search-food');
    if (search) {
      search.addEventListener('input', function () {
        var on = qs('.cat.on');
        renderMenu(on ? on.getAttribute('data-cat') : '');
      });
    }

    var partyForm = $('party-form');
    if (partyForm) partyForm.addEventListener('submit', submitParty);

    var loginForm = $('login-form');
    if (loginForm) loginForm.addEventListener('submit', doLogin);
  }

  /* ---------- boot ---------- */
  async function boot() {
    api = MM.api;
    if (!api || !api.ready()) {
      MM.showFatal({ message: 'Supabase client not ready', detail: api && api.initError() });
      return;
    }
    loadCart();
    setLang(S.lang);
    wire();

    var table = readTableFromUrl();
    if (table) {
      showMenu();
      var ok = await checkTableGate(table);
      if (ok) await loadMenuUI();
    } else {
      showWelcome();
    }

    try {
      var session = await api.getSession();
      if (session) {
        var role = await api.myRole();
        if (role) {
          S.role = role;
          S.session = session;
        }
      }
    } catch (e) {}

    MM.booted = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
