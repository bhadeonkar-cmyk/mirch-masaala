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
    /* Exactly 1-2 digits: "?table=123" must not silently become table 12. */
    var m = /[?&]table=(\d{1,2})(?=&|#|$)/i.exec(location.search || '');
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
      /* Live contract (mm_public_table_visit_status): { status: OPEN|AVAILABLE|UNKNOWN,
       * can_order: boolean, message, and visit_id + started_at only when OPEN }.
       * Ordering is allowed only when can_order is true AND a visit id is present. */
      var st = await api.tableStatus(table);
      S.gate = st;
      S.visitId = null;
      if (!st || String(st.status || '').toUpperCase() === 'UNKNOWN') {
        if (msg) msg.textContent = MM.t('table_not_found');
        if (retry) retry.hidden = false;
        return false;
      }
      var open = st.can_order === true && !!st.visit_id;
      if (open) S.visitId = st.visit_id;
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
      html += '<button type="button" class="cat" data-cat="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + '</button>';
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
      html += '<div class="food-card" data-id="' + escapeHtml(it.id) + '">' +
        '<div class="food-info">' +
          '<div class="food-name">' + veg + ' ' + escapeHtml(it.name) + '</div>' +
          (it.description ? '<div class="food-desc muted small">' + escapeHtml(it.description) + '</div>' : '') +
          '<div class="food-price">₹' + price + '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-sm btn-add" data-add="' + escapeHtml(it.id) + '">' + MM.t('add') + '</button>' +
      '</div>';
    });
    list.innerHTML = html;
  }

  /* Escape for both text nodes and double/single-quoted attributes. */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  MM.escapeHtml = escapeHtml;

  function addToCart(id) {
    var it = S.menu.find(function (m) { return String(m.id) === String(id); });
    if (!it) return;
    var existing = S.cart.find(function (c) { return String(c.id) === String(id); });
    if (existing) existing.qty = (existing.qty || 1) + 1;
    else S.cart.push({ id: it.id, name: it.name, price: Number(it.price) || 0, qty: 1 });
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
    if (!S.visitId) {
      toast(MM.t('table_not_open'));
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
          return { id: c.id, qty: c.qty || 1 };
        })
      });
      /* Contract (mm_place_order): id = ticket id (T01-…), dbId = orders.id uuid,
       * publicToken, orderNumber (integer), table, visitId, total, status. */
      var ticket = created.id || '';
      var token = created.publicToken || '';
      var orderNumber = created.orderNumber != null ? created.orderNumber : ticket;
      saveMyOrder({
        id: created.dbId || created.id,
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
      var ticketId = o.ticket || (/^[A-Z0-9-]{8,64}$/.test(String(o.id || '')) ? o.id : '');
      var detail = await api.getPublicOrder(ticketId, o.token);
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
      /* Contract (mm_guest_get_visit_bill): { table, visit_id, visit_status, amount, order_count,
       * orders_in_progress }. `amount` is the unpaid balance for this visit. */
      var bill = await api.guestBill(o.table, o.visitId, api.customerSessionId(o.visitId));
      var due = Number(bill && bill.amount) || 0;
      $('pay-total').textContent = Math.round(due);
      if (due <= 0.01) {
        $('pay-choices').hidden = true;
        $('pay-msg').textContent = MM.t('nothing_to_pay');
      }
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
    stopKitchenPoll();
    try { await api.signOut(); } catch (e) {}
    S.role = null;
    S.session = null;
    showWelcome();
  }

  /* ---------- waiter ---------- */
  /* Waiters share one login, so the person picks their name (from mm_list_waiters) and the
   * app remembers it on this device. The code (e.g. W01) is required to start a visit and is
   * passed to mm_staff_notifications so the waiter sees alerts addressed to them. */
  var WAITER_KEY = 'mm_waiter_code';

  function selectedWaiter() {
    return String(MM.store.get(WAITER_KEY, '') || '').trim().toUpperCase();
  }

  function settle(promise) {
    return Promise.resolve(promise).then(
      function (value) { return { ok: true, value: value }; },
      function (error) { console.error('[MM waiter]', error); return { ok: false, error: error }; }
    );
  }

  function renderWaiterPicker(waiters) {
    var sel = $('waiter-pick');
    if (!sel) return;
    var current = selectedWaiter();
    var known = (waiters || []).some(function (w) { return String(w.waiter_code).toUpperCase() === current; });
    if (!known) { current = ''; MM.store.remove(WAITER_KEY); }
    var html = '<option value="">' + escapeHtml(MM.t('choose_waiter')) + '</option>';
    (waiters || []).forEach(function (w) {
      var code = String(w.waiter_code || '').toUpperCase();
      html += '<option value="' + escapeHtml(code) + '"' + (code === current ? ' selected' : '') + '>' +
        escapeHtml(w.display_name || code) + ' (' + escapeHtml(code) + ')</option>';
    });
    sel.innerHTML = html;
    sel.onchange = function () {
      var v = String(sel.value || '').toUpperCase();
      if (v) MM.store.set(WAITER_KEY, v); else MM.store.remove(WAITER_KEY);
      loadWaiterAlerts();
    };
    var hint = $('waiter-pick-hint');
    if (hint) {
      hint.hidden = (waiters || []).length > 0;
      hint.textContent = MM.t('no_waiters');
    }
  }

  async function loadWaiterAlerts() {
    var box = $('waiter-alerts');
    if (!box) return;
    var r = await settle(api.notifications(10, selectedWaiter()));
    if (!r.ok) { box.innerHTML = ''; return; }
    var list = r.value || [];
    if (!list.length) { box.innerHTML = ''; return; }
    var html = '<h2 class="section-title">' + escapeHtml(MM.t('alerts')) + '</h2>';
    list.forEach(function (n) {
      html += '<div class="order-card compact">' +
        (n.table_number ? '<strong>T' + escapeHtml(n.table_number) + '</strong> ' : '') +
        '<span>' + escapeHtml(n.message || n.notification_type) + '</span>' +
        (n.item_name ? '<div class="muted small">' + escapeHtml(n.item_name) + '</div>' : '') +
        '</div>';
    });
    box.innerHTML = html;
  }

  async function showWaiter() {
    showScreen('screen-waiter');
    var box = $('waiter-tables');
    if (!box) return;
    box.innerHTML = '<div class="loading">' + MM.t('loading') + '</div>';

    var res = await Promise.all([
      settle(api.listWaiters()),
      settle(api.tableVisits()),
      settle(api.staffTables()),
      settle(api.staffOrders(true))
    ]);
    var waitersR = res[0], visitsR = res[1], tablesR = res[2], ordersR = res[3];

    if (!tablesR.ok && !visitsR.ok) {
      box.innerHTML = '<div class="empty">' + MM.t('offline') + '</div>';
      return;
    }

    var waiters = waitersR.ok ? waitersR.value : [];
    renderWaiterPicker(waiters);

    var visits = visitsR.ok ? visitsR.value : [];
    var tables = tablesR.ok ? tablesR.value : [];
    var byNum = {};
    (visits || []).forEach(function (v) {
      byNum[api.pad2(v.table_number || v.tableNumber)] = v;
    });
    var tableNumById = {};
    (tables || []).forEach(function (t) { tableNumById[t.id] = api.pad2(t.table_number); });

    var html = '';
    (tables || []).slice().sort(function (a, b) {
      return String(a.table_number).localeCompare(String(b.table_number), undefined, { numeric: true });
    }).forEach(function (t) {
      var num = api.pad2(t.table_number || t.tableNumber);
      var v = byNum[num];
      var open = !!v && String(v.status || v.visit_status || '').toUpperCase() === 'OPEN';
      var who = open && v.assigned_waiter_code ? ' · ' + escapeHtml(v.assigned_waiter_code) : '';
      html += '<button type="button" class="table-card ' + (open ? 'busy' : 'free') + '" data-table="' + escapeHtml(num) +
        '" data-open="' + (open ? '1' : '0') + '">' +
        '<strong>' + escapeHtml(num) + '</strong>' +
        '<span class="muted small">' + (open ? MM.t('st_open') : MM.t('st_available')) + who + '</span>' +
      '</button>';
    });
    if (!html) html = '<div class="empty">' + MM.t('tables_empty') + '</div>';
    box.innerHTML = html;
    box.onclick = async function (ev) {
      var btn = ev.target.closest('.table-card');
      if (!btn) return;
      var num = btn.getAttribute('data-table');
      if (btn.getAttribute('data-open') === '1') { showWaiter(); return; }
      var code = selectedWaiter();
      if (!code) {
        toast(MM.t((waiters || []).length ? 'choose_waiter' : 'no_waiters'));
        var sel = $('waiter-pick');
        if (sel) sel.focus();
        return;
      }
      try {
        await api.startVisit(num, code);
        toast(MM.t('visit_started'));
        showWaiter();
      } catch (e) {
        console.error('[MM startVisit]', e);
        toast(MM.t('visit_failed'));
      }
    };

    /* Ready tickets: the kitchen marks READY, the waiter marks SERVED (database guard allows
     * waiters only READY -> SERVED). */
    var readyBox = $('waiter-ready');
    if (readyBox) {
      var ready = ordersR.ok ? (ordersR.value || []).filter(function (o) {
        return String(o.status || '').toUpperCase() === 'READY';
      }) : [];
      if (!ready.length) {
        readyBox.innerHTML = '';
      } else {
        var itemsR = await settle(api.orderItems(ready.map(function (o) { return o.id; })));
        var byOrder = {};
        (itemsR.ok ? itemsR.value : []).forEach(function (it) {
          (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it);
        });
        var rh = '<h2 class="section-title">' + escapeHtml(MM.t('ready_to_serve')) + '</h2>';
        ready.forEach(function (o) {
          var tn = tableNumById[o.table_id];
          rh += '<div class="k-card" data-ticket="' + escapeHtml(o.ticket_id) + '">' +
            '<div class="k-head"><strong>' + (tn ? 'T' + escapeHtml(tn) + ' · ' : '') +
              escapeHtml(o.ticket_id || o.order_number) + '</strong></div><ul>';
          (byOrder[o.id] || []).forEach(function (it) {
            rh += '<li>' + escapeHtml(it.item_name) + ' × ' + (Number(it.quantity) || 1) + '</li>';
          });
          rh += '</ul><button type="button" class="btn btn-sm" data-serve="1">' + escapeHtml(MM.t('mark_served')) + '</button></div>';
        });
        readyBox.innerHTML = rh;
      }
      readyBox.onclick = async function (ev) {
        var b = ev.target.closest('[data-serve]');
        if (!b) return;
        var card = b.closest('.k-card');
        var ticket = card && card.getAttribute('data-ticket');
        if (!ticket) return;
        b.disabled = true;
        try {
          await api.setOrderStatus(ticket, 'SERVED');
          showWaiter();
        } catch (e) {
          console.error('[MM serve]', e);
          b.disabled = false;
          toast(MM.t('status_update_failed'));
        }
      };
    }

    loadWaiterAlerts();
  }

  /* js/p0-lifecycle.js calls this after Back / Finish visit / Free table so the waiter returns to the
   * table list. Without it that file falls back to location.reload(), which drops the staff screen. */
  window.__mmShowWaiter = function () { return showWaiter(); };

  /* ---------- kitchen ---------- */
  /* Kitchen can only move NEW -> PREPARING -> READY (database guard). Serving is the waiter's job. */
  var kitchenTimer = null, kitchenBusy = false;
  function stopKitchenPoll() {
    if (kitchenTimer) clearInterval(kitchenTimer);
    kitchenTimer = null;
  }
  /* New orders must reach the kitchen without anyone pressing reload: refresh every 10 s while the
   * kitchen screen is showing and the tab is visible. A failed refresh keeps the last good board. */
  function startKitchenPoll() {
    stopKitchenPoll();
    kitchenTimer = setInterval(function () {
      var scr = $('screen-kitchen');
      if (!scr || !scr.classList.contains('on')) { stopKitchenPoll(); return; }
      if (document.hidden || kitchenBusy) return;
      showKitchen(true);
    }, 10000);
  }

  async function showKitchen(silent) {
    var board = $('kitchen-board');
    if (!board) return;
    if (!silent) {
      showScreen('screen-kitchen');
      board.innerHTML = '<div class="loading">' + MM.t('loading') + '</div>';
      startKitchenPoll();
    }
    kitchenBusy = true;
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
            html += '<li>' + escapeHtml(it.item_name) + ' × ' + (Number(it.quantity) || 1) + '</li>';
          });
          html += '</ul>';
          if (o.notes) html += '<div class="muted small">' + escapeHtml(o.notes) + '</div>';
          if (lane === 'NEW') html += '<button type="button" class="btn btn-sm" data-next="PREPARING">' + MM.t('start') + '</button>';
          if (lane === 'PREPARING') html += '<button type="button" class="btn btn-sm" data-next="READY">' + MM.t('mark_ready') + '</button>';
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
      if (!silent) board.innerHTML = '<div class="empty">' + MM.t('offline') + '</div>';
    } finally {
      kitchenBusy = false;
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
    box.onclick = null; /* the Payments tab installs its own handler */
    box.innerHTML = '<div class="loading">' + MM.t('loading') + '</div>';
    try {
      if (panel === 'payments') {
        /* Only the Owner/Counter (admin) login may record payments (mm_staff_record_visit_payment). */
        var pvisits = await api.tableVisits();
        var openVisits = (pvisits || []).filter(function (v) {
          return String(v.status || v.visit_status || '').toUpperCase() === 'OPEN';
        });
        var ph = '<h2 class="section-title">' + MM.t('nav_payments') + '</h2>';
        if (!openVisits.length) ph += '<div class="empty">' + MM.t('no_open_visits') + '</div>';
        else {
          ph += '<div class="table-grid">';
          openVisits.forEach(function (v) {
            var pn = api.pad2(v.table_number || v.tableNumber);
            ph += '<button type="button" class="table-card busy" data-pay-table="' + escapeHtml(pn) + '">' +
              '<strong>' + escapeHtml(pn) + '</strong>' +
              '<span class="muted small">' + MM.t('st_open') +
              (v.assigned_waiter_code ? ' · ' + escapeHtml(v.assigned_waiter_code) : '') + '</span></button>';
          });
          ph += '</div>';
        }
        box.innerHTML = ph;
        box.onclick = function (ev) {
          var b = ev.target.closest('[data-pay-table]');
          if (!b || typeof window.__mmShowOpenVisit !== 'function') return;
          var num = b.getAttribute('data-pay-table');
          var found = null;
          openVisits.forEach(function (v) {
            if (api.pad2(v.table_number || v.tableNumber) === num) found = v;
          });
          window.__mmShowOpenVisit(num, found, { panel: box, onBack: function () { renderOwnerPanel('payments'); } });
        };
      } else if (panel === 'orders') {
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
            '<strong>' + escapeHtml(num) + '</strong><span class="muted small">' + escapeHtml(st) + '</span></div>';
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
      } else if (panel === 'menu') {
        /* Owner: change a dish price or switch it on/off. menu_items UPDATE is allowed for the admin
         * and kitchen roles (RLS); the customer menu cache is dropped so guests see the change. */
        api._menuCache = null;
        var md = await api.loadMenu();
        var mItems = md.items || [];
        var mh = '<h2 class="section-title">' + MM.t('nav_menu') + '</h2>';
        if (!mItems.length) mh += '<div class="empty">' + MM.t('no_menu_items') + '</div>';
        (md.categories || []).concat([{ id: null, name: '' }]).forEach(function (cat) {
          var rows = mItems.filter(function (it) { return (it.category_id || null) === cat.id; });
          if (!rows.length) return;
          if (cat.name) mh += '<h3 class="section-title">' + escapeHtml(cat.name) + '</h3>';
          rows.forEach(function (it) {
            var isOn = it.is_available !== false;
            mh += '<div class="order-card compact" data-item="' + escapeHtml(it.id) + '">' +
              '<strong>' + escapeHtml(it.name) + '</strong>' +
              '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">' +
              '<span class="muted small">₹</span>' +
              '<input type="number" inputmode="numeric" min="0" max="100000" step="1" data-price ' +
                'aria-label="' + escapeHtml(MM.t('price')) + '" value="' + escapeHtml(it.price) + '" style="width:96px;margin:0">' +
              '<button type="button" class="btn btn-sm" data-save-price>' + escapeHtml(MM.t('save')) + '</button>' +
              '<button type="button" class="btn btn-sm btn-soft" data-toggle data-on="' + (isOn ? '1' : '0') + '">' +
                escapeHtml(MM.t(isOn ? 'available' : 'unavailable')) + '</button>' +
              '</div></div>';
          });
        });
        box.innerHTML = mh;
        box.onclick = async function (ev) {
          var row = ev.target.closest('[data-item]');
          if (!row) return;
          var id = row.getAttribute('data-item');
          var saveBtn = ev.target.closest('[data-save-price]');
          var toggleBtn = ev.target.closest('[data-toggle]');
          if (saveBtn) {
            var raw = row.querySelector('[data-price]').value;
            var price = Number(raw);
            if (raw === '' || !isFinite(price) || price < 0 || price > 100000) { toast(MM.t('something_wrong')); return; }
            saveBtn.disabled = true;
            try {
              await api.updatePrice(id, price);
              api._menuCache = null;
              toast(MM.t('saved'));
            } catch (e) {
              console.error('[MM price]', e);
              toast(MM.t('something_wrong'));
            } finally { saveBtn.disabled = false; }
          } else if (toggleBtn) {
            var next = toggleBtn.getAttribute('data-on') !== '1';
            toggleBtn.disabled = true;
            try {
              await api.setAvailable(id, next);
              api._menuCache = null;
              toggleBtn.setAttribute('data-on', next ? '1' : '0');
              toggleBtn.textContent = MM.t(next ? 'available' : 'unavailable');
            } catch (e) {
              console.error('[MM availability]', e);
              toast(MM.t('something_wrong'));
            } finally { toggleBtn.disabled = false; }
          }
        };
      } else if (panel === 'bookings') {
        /* Owner: party requests sent from the customer form (mm_admin_list_party_bookings). */
        var bks = await api.listBookings();
        var BK_STATUSES = ['NEW', 'CONTACTED', 'CONFIRMED', 'UNAVAILABLE'];
        var bh = '<h2 class="section-title">' + MM.t('nav_bookings') + '</h2>';
        if (!bks.length) bh += '<div class="empty">' + MM.t('no_bookings') + '</div>';
        bks.forEach(function (b) {
          var cur = String(b.status || 'NEW').toUpperCase();
          var tel = String(b.customer_phone || '').replace(/[^\d+]/g, '');
          bh += '<div class="order-card" data-booking="' + escapeHtml(b.id) + '">' +
            '<div class="order-head"><strong>' + escapeHtml(b.booking_ref || '') + '</strong>' +
            '<span class="badge">' + escapeHtml(MM.t('bk_' + cur.toLowerCase())) + '</span></div>' +
            '<div>' + escapeHtml(b.customer_name) + ' · <a href="tel:' + escapeHtml(tel) + '">' + escapeHtml(b.customer_phone) + '</a></div>' +
            '<div class="muted small">' + escapeHtml(b.event_type) + ' · ' + escapeHtml(b.event_date) + ' ' + escapeHtml(b.event_time || '') +
              ' · ' + escapeHtml(MM.t('guests_n', { n: b.guest_count })) + '</div>' +
            (b.customer_notes ? '<div class="muted small">' + escapeHtml(b.customer_notes) + '</div>' : '') +
            '<div class="form" style="margin-top:10px">' +
              '<select data-bk-status aria-label="Status">' +
              BK_STATUSES.map(function (s) {
                return '<option value="' + s + '"' + (s === cur ? ' selected' : '') + '>' + escapeHtml(MM.t('bk_' + s.toLowerCase())) + '</option>';
              }).join('') + '</select>' +
              '<textarea data-bk-notes rows="2" maxlength="1000" style="margin-top:8px">' + escapeHtml(b.owner_notes || '') + '</textarea>' +
            '</div>' +
            '<button type="button" class="btn btn-sm btn-primary" data-bk-save>' + escapeHtml(MM.t('save')) + '</button></div>';
        });
        box.innerHTML = bh;
        box.onclick = async function (ev) {
          var sb = ev.target.closest('[data-bk-save]');
          if (!sb) return;
          var card = sb.closest('[data-booking]');
          var id = card.getAttribute('data-booking');
          var status = card.querySelector('[data-bk-status]').value;
          sb.disabled = true;
          try {
            await api.updateBooking(id, status, card.querySelector('[data-bk-notes]').value.trim());
            var badge = card.querySelector('.badge');
            if (badge) badge.textContent = MM.t('bk_' + status.toLowerCase());
            toast(MM.t('saved'));
          } catch (e) {
            console.error('[MM booking]', e);
            toast(MM.t('something_wrong'));
          } finally { sb.disabled = false; }
        };
      } else {
        box.innerHTML = '<div class="empty">' + MM.t(panel) + '</div>';
      }
    } catch (e) {
      console.error('[MM owner]', e);
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
        S.visitId = null;
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
      if (t.closest('#btn-waiter-refresh')) { showWaiter(); return; }
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
