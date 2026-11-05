/* Customer UI — Mirch Masaala identity on V2 architecture.
 * Uses MMVisual (from 51e8b2d). Does not change backend / C1–C8 / P0.
 */
(function () {
  'use strict';
  if (!window.MM) window.MM = {};
  var V = window.MMVisual || null;

  function itemById(id) {
    var list = (MM.state && MM.state.menu) || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function cartQty(id) {
    var cart = (MM.state && MM.state.cart) || [];
    for (var i = 0; i < cart.length; i++) {
      if (String(cart[i].id) === String(id)) return cart[i].qty || 1;
    }
    return 0;
  }

  function enhanceCard(card) {
    if (!card) return;
    var id = card.getAttribute('data-id');
    var item = itemById(id);

    if (!card.querySelector('.food-media')) {
      var media = document.createElement('div');
      media.className = 'food-media';
      if (V && item) {
        media.innerHTML = V.dishImageMarkup(item, 'menu');
      } else if (item && typeof window.mmMenuImageUrl === 'function') {
        var url = window.mmMenuImageUrl(item);
        if (url) media.innerHTML = '<img src="' + url + '" alt="" loading="lazy">';
        else media.classList.add('placeholder');
      } else {
        media.classList.add('placeholder');
      }
      card.insertBefore(media, card.firstChild);
      card.classList.add('has-img');
    } else if (V && item && !card.querySelector('.dish-art') && !card.querySelector('.dish-photo')) {
      var m = card.querySelector('.food-media');
      if (m) m.innerHTML = V.dishImageMarkup(item, 'menu');
    }

    if (!card.getAttribute('data-ui')) card.setAttribute('data-ui', '1');
    syncQty(card, id);
  }

  function syncQty(card, id) {
    var q = cartQty(id);
    var addBtn = card.querySelector('[data-add]');
    var existing = card.querySelector('.qty-ctrl');
    if (q < 1) {
      if (existing) existing.remove();
      if (addBtn) addBtn.hidden = false;
      card.classList.remove('just-added');
      return;
    }
    if (addBtn) addBtn.hidden = true;
    if (!existing) {
      existing = document.createElement('div');
      existing.className = 'qty-ctrl';
      existing.innerHTML =
        '<button type="button" data-qty-minus="' + id + '" aria-label="Less">−</button>' +
        '<span data-qty-val="' + id + '">' + q + '</span>' +
        '<button type="button" data-qty-plus="' + id + '" aria-label="More">+</button>';
      card.appendChild(existing);
      card.classList.add('just-added');
      setTimeout(function () { card.classList.remove('just-added'); }, 450);
    } else {
      var span = existing.querySelector('[data-qty-val]');
      if (span) span.textContent = q;
    }
  }

  /* ---- Batch 2: menu presentation helpers (display only) ----
   * The Veg / Non-Veg filter hides already-rendered cards with a CSS class; it never
   * touches renderMenu(), the menu data or the cart. */
  var vegMode = 'all';

  function syncCardById(id) {
    if (!id) return;
    var card = document.querySelector('.food-card[data-id="' + id + '"]');
    if (card) syncQty(card, id);
  }

  function cartCountLabel(n) {
    return n === 1 ? MM.t('item_1') : MM.t('items_n', { n: n });
  }

  function updateMenuCount(shown) {
    var el = document.getElementById('menu-count');
    if (!el) return;
    var txt = shown == null ? '' : (shown === 1 ? MM.t('dish_1') : MM.t('dishes_n', { n: shown }));
    if (el.textContent !== txt) el.textContent = txt;
  }

  function applyVegFilter() {
    var list = document.getElementById('menu-list');
    if (!list) return;
    var cards = list.querySelectorAll('.food-card');
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var isVeg = !!cards[i].querySelector('.veg');
      var hide = (vegMode === 'veg' && !isVeg) || (vegMode === 'nonveg' && isVeg);
      if (hide !== cards[i].classList.contains('mm-hide')) cards[i].classList.toggle('mm-hide', hide);
      if (!hide) shown++;
    }
    var empty = document.getElementById('mm-filter-empty');
    if (cards.length && !shown) {
      if (!empty && V) {
        list.insertAdjacentHTML('beforeend', '<div id="mm-filter-empty">' +
          V.emptyPlateMarkup(MM.t('no_items'), MM.t('no_items_hint')) + '</div>');
      }
    } else if (empty) {
      empty.remove();
    }
    updateMenuCount(cards.length ? shown : null);
  }

  /* JS-rendered menu text is not covered by MM.applyI18n(); refresh it in place after a language toggle. */
  function refreshMenuLang() {
    var st = MM.state || {};
    var adds = document.querySelectorAll('#menu-list .btn-add[data-add]');
    for (var i = 0; i < adds.length; i++) adds[i].textContent = MM.t('add');
    var allCat = document.querySelector('#categories .cat[data-cat=""]');
    if (allCat) {
      var last = allCat.lastChild;
      if (last && last.nodeType === 3) last.nodeValue = MM.t('all');
      else if (!allCat.querySelector('.cat-art')) allCat.textContent = MM.t('all');
    }
    var cc = document.getElementById('cart-count');
    var n = (st.cart || []).reduce(function (a, c) { return a + (c.qty || 1); }, 0);
    if (cc && n > 0) cc.textContent = cartCountLabel(n);
    if (st.table) {
      var lbl = document.getElementById('menu-table-label');
      if (lbl) lbl.textContent = MM.t('table_n', { n: st.table });
      var ms = document.getElementById('menu-status');
      if (ms && ms.textContent) ms.textContent = MM.t('table_ready');
    }
    var empty = document.getElementById('mm-filter-empty');
    if (empty && V) empty.innerHTML = V.emptyPlateMarkup(MM.t('no_items'), MM.t('no_items_hint'));
    applyVegFilter();
  }

  /* Reason: on the homepage "View Menu" path perf-prefetch.js pre-fills MM.state.menu, so
   * app.js showMenu() only calls renderMenu() and the category chips are never rendered.
   * If the chips are missing, clear the prefetched menu array just before app.js handles the
   * click; showMenu() then runs the existing loadMenuUI() (served from the supabase.js cache),
   * which renders categories + dishes. No menu/cart logic is duplicated here. */
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest('#btn-view-menu')) return;
    var st = MM.state;
    if (!st || !st.menu || !st.menu.length) return;
    if (document.querySelector('#categories .cat')) return;
    st.menu = [];
  }, true);

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('#veg-filter [data-vf]');
    if (!b) return;
    vegMode = b.getAttribute('data-vf') || 'all';
    var all = document.querySelectorAll('#veg-filter .vf');
    for (var i = 0; i < all.length; i++) {
      var on = all[i] === b;
      all[i].classList.toggle('on', on);
      all[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    applyVegFilter();
  }, true);

  var _menuEnhanceScheduled = false;
  var _menuIO = null;

  function ensureMenuIO() {
    if (_menuIO || typeof IntersectionObserver === 'undefined') return _menuIO;
    _menuIO = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e.isIntersecting) continue;
        var card = e.target;
        _menuIO.unobserve(card);
        if (card.getAttribute('data-ui')) continue;
        enhanceCard(card);
      }
    }, { root: null, rootMargin: '180px 0px', threshold: 0.01 });
    return _menuIO;
  }

  function enhanceMenuList() {
    var list = document.getElementById('menu-list');
    if (!list) return;
    var cards = list.querySelectorAll('.food-card');
    if (!cards.length) {
      if (V && !list.querySelector('.empty-state') && !list.querySelector('.loading')) {
        list.innerHTML = V.emptyPlateMarkup(MM.t('no_items'), MM.t('no_items_hint'));
      }
      updateMenuCount(null);
      return;
    }
    applyVegFilter();
    var io = ensureMenuIO();
    if (io) {
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].getAttribute('data-ui')) continue;
        io.observe(cards[i]);
      }
      var eager = Math.min(cards.length, 8);
      for (var j = 0; j < eager; j++) {
        if (!cards[j].getAttribute('data-ui')) enhanceCard(cards[j]);
      }
      return;
    }
    if (_menuEnhanceScheduled) return;
    _menuEnhanceScheduled = true;
    var idx = 0;
    function chunk() {
      var end = Math.min(idx + 6, cards.length);
      for (; idx < end; idx++) {
        if (!cards[idx].getAttribute('data-ui')) enhanceCard(cards[idx]);
      }
      if (idx < cards.length) requestAnimationFrame(chunk);
      else _menuEnhanceScheduled = false;
    }
    requestAnimationFrame(chunk);
  }

  function enhanceCategories() {
    var cats = document.getElementById('categories');
    if (!cats || !V || cats.getAttribute('data-mm-cats') === '1') return;
    var buttons = cats.querySelectorAll('.cat');
    if (!buttons.length) return;
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (btn.querySelector('.dish-art-cat')) continue;
      var label = (btn.textContent || '').trim();
      if (!label) continue;
      var icon = document.createElement('span');
      icon.className = 'cat-art';
      icon.innerHTML = V.categoryIcon(label);
      btn.insertBefore(icon, btn.firstChild);
      btn.classList.add('cat-with-art');
    }
    cats.setAttribute('data-mm-cats', '1');
  }

  function enhanceOrderDetail() {
    var box = document.getElementById('order-detail');
    if (!box) return;
    var card = box.querySelector('.order-card');
    if (!card || card.querySelector('.order-progress')) return;
    var badge = card.querySelector('.badge');
    var status = badge ? (badge.textContent || '').trim().toUpperCase() : 'NEW';
    var map = { NEW: 0, RECEIVED: 0, 'ORDER RECEIVED': 0, PREPARING: 1, READY: 2, SERVED: 3, PAID: 3 };
    var step = 0;
    Object.keys(map).forEach(function (k) {
      if (status.indexOf(k) >= 0) step = map[k];
    });
    var labels = ['Ordered', 'Preparing', 'Ready', 'Served'];
    var pct = [12, 38, 68, 100][step] || 12;
    var html =
      '<div class="order-progress" aria-label="Order progress">' +
      '<div class="progress-heading"><span class="progress-chef" aria-hidden="true">👨‍🍳</span>' +
      '<span class="progress-title">Order progress</span>' +
      '<span class="progress-percent">' + pct + '%</span></div>' +
      '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="progress-steps">';
    for (var s = 0; s < 4; s++) {
      var cls = s < step ? 'done' : (s === step ? 'active' : '');
      html += '<span class="' + cls + '"><i class="step-dot"></i><em>' + labels[s] + '</em></span>';
    }
    html += '</div></div>';
    var head = card.querySelector('.order-head');
    if (head) head.insertAdjacentHTML('afterend', html);
    else card.insertAdjacentHTML('afterbegin', html);
  }

  function enhancePlaced() {
    var screen = document.getElementById('screen-placed');
    if (!screen) return;
    screen.classList.add('placed-ready');
    if (!V) return;
    var mark = screen.querySelector('.ok-mark');
    if (mark && !screen.querySelector('.success-hero') && !screen.querySelector('.success-plate')) {
      mark.outerHTML = V.successPlateMarkup();
    }
  }

  function enhanceCart() {
    var box = document.getElementById('cart-items');
    if (!box) return;
    var rows = box.querySelectorAll('.cart-row');
    if (!rows.length) {
      /* app.js writes a plain .empty node; upgrade to identity empty plate when available */
      var empty = box.querySelector('.empty');
      if (empty && V && !box.querySelector('.empty-state')) {
        var hint = (window.MM && MM.t) ? MM.t('back_to_menu') : 'Back to menu';
        box.innerHTML = V.emptyPlateMarkup(
          (window.MM && MM.t) ? MM.t('cart_empty') : 'Your cart is empty.',
          hint
        );
      }
      return;
    }
    if (!V) return;
    rows.forEach(function (row) {
      if (row.querySelector('.cart-pic')) return;
      var idx = row.getAttribute('data-idx');
      var cart = (MM.state && MM.state.cart) || [];
      var c = cart[Number(idx)];
      if (!c) return;
      var item = itemById(c.id) || c;
      var pic = document.createElement('div');
      pic.className = 'pic cart-pic';
      pic.setAttribute('aria-hidden', 'true');
      pic.innerHTML = V.dishImageMarkup(item, 'cart');
      row.insertBefore(pic, row.firstChild);
      row.classList.add('cart-line');
    });
  }

  function refreshCartLang() {
    var adds = document.querySelectorAll('#cart-items .remove');
    for (var i = 0; i < adds.length; i++) {
      if (window.MM && MM.t) adds[i].textContent = MM.t('remove');
    }
    var empty = document.querySelector('#cart-items .empty-state b');
    if (empty && window.MM && MM.t) empty.textContent = MM.t('cart_empty');
    var emptySub = document.querySelector('#cart-items .empty-state span');
    if (emptySub && window.MM && MM.t) emptySub.textContent = MM.t('back_to_menu');
  }

  function bumpCartBar() {
    var bar = document.getElementById('cart-bar');
    if (!bar) return;
    bar.classList.remove('bump');
    void bar.offsetWidth;
    bar.classList.add('bump');
  }

  function enhanceHome() {
    var scan = document.getElementById('btn-scan-qr');
    if (scan) {
      /* Always take label/hint from active language dictionary — never keep prior English text. */
      var label = 'Scan table QR';
      var sub = 'Point your camera at the QR code on your table';
      if (window.MM && typeof MM.t === 'function') {
        try {
          var cta = MM.t('scan_qr_cta');
          if (cta && cta !== 'scan_qr_cta') label = cta;
        } catch (e) {}
        try {
          var hint = MM.t('scan_qr_hint');
          if (hint && hint !== 'scan_qr_hint') sub = hint;
        } catch (e) {}
      }
      scan.classList.add('scan-cta', 'btn-main');
      scan.removeAttribute('data-i18n');
      scan.innerHTML =
        '<span class="scan-qr-visual" aria-hidden="true">' +
        '<span class="scan-qr-corner scan-qr-tl"></span>' +
        '<span class="scan-qr-corner scan-qr-tr"></span>' +
        '<span class="scan-qr-corner scan-qr-bl"></span>' +
        '<span class="scan-qr-dot"></span>' +
        '<span class="scan-qr-beam"></span></span>' +
        '<span class="scan-qr-copy"><b>' + label + '</b>' +
        '<small>' + sub + '</small></span>' +
        '<span class="scan-cta-arrow" aria-hidden="true">→</span>';
    }
    var hero = document.querySelector('#screen-welcome .hero');
    if (hero && !hero.querySelector('.home-steam-layer') && !hero.querySelector('.home-steam')) {
      var steam = document.createElement('div');
      steam.className = 'home-steam-layer';
      steam.setAttribute('aria-hidden', 'true');
      steam.innerHTML =
        '<span class="home-steam home-steam-a" style="--steam-x:12%;--steam-delay:0s"></span>' +
        '<span class="home-steam home-steam-b" style="--steam-x:36%;--steam-delay:2.4s"></span>' +
        '<span class="home-steam home-steam-c" style="--steam-x:68%;--steam-delay:1.2s"></span>' +
        '<span class="home-steam home-steam-d" style="--steam-x:87%;--steam-delay:4s"></span>';
      hero.insertBefore(steam, hero.firstChild);
    }
  }

  function refreshNavLang() {
    /* data-i18n spans inside nav buttons are updated by MM.applyI18n; this is a safety net. */
    var pairs = [
      ['cnav-home', 'nav_home'],
      ['cnav-menu', 'nav_menu_tab'],
      ['cnav-order', 'nav_order'],
      ['cnav-cart', 'nav_cart']
    ];
    if (!window.MM || typeof MM.t !== 'function') return;
    for (var i = 0; i < pairs.length; i++) {
      var el = document.getElementById(pairs[i][0]);
      if (!el) continue;
      var span = el.querySelector('[data-i18n]');
      if (span) span.textContent = MM.t(pairs[i][1]);
    }
  }

  function afterLangChange() {
    enhanceHome();
    refreshMenuLang();
    refreshCartLang();
    refreshNavLang();
  }

  /* Bubble phase so app.js setLang() + applyI18n() run first, then we rebuild CTA. */
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest('#btn-lang, [data-action="lang"]')) return;
    setTimeout(afterLangChange, 0);
    setTimeout(afterLangChange, 80);
  }, false);

  /* Also refresh whenever applyI18n runs (covers any path that changes language). */
  if (window.MM && typeof MM.applyI18n === 'function') {
    var _applyI18n = MM.applyI18n;
    MM.applyI18n = function (root) {
      _applyI18n.call(MM, root);
      try { enhanceHome(); } catch (e) {}
      try { refreshNavLang(); } catch (e) {}
    };
  }

  function softToast(key) {
    var msg = (window.MM && MM.t) ? MM.t(key) : key;
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(softToast._t);
    softToast._t = setTimeout(function () { el.hidden = true; }, 3600);
  }

  document.addEventListener('click', function (ev) {
    var help = ev.target.closest('#btn-qr-help, [data-action="qr-help"]');
    if (help) { ev.preventDefault(); softToast('qr_help_msg'); return; }
    var howto = ev.target.closest('#btn-how-to, [data-action="how-to"]');
    if (howto) { ev.preventDefault(); softToast('how_to_msg'); return; }
    var places = ev.target.closest('#btn-places, [data-action="places"]');
    if (places) { ev.preventDefault(); softToast('places_unavailable'); return; }
    var reviews = ev.target.closest('#btn-reviews, [data-action="reviews"]');
    if (reviews) {
      ev.preventDefault();
      var url = null;
      try { url = MM.state && MM.state.config && (MM.state.config.google_reviews_url || MM.state.config.google_review_url); } catch (e) {}
      if (url && /^https?:\/\//i.test(String(url))) window.open(String(url), '_blank', 'noopener');
      else softToast('reviews_unavailable');
      return;
    }
  }, true);

  document.addEventListener('click', function (ev) {
    var plus = ev.target.closest('[data-qty-plus]');
    var minus = ev.target.closest('[data-qty-minus]');
    var add = ev.target.closest('[data-add]');
    if (add) {
      var card = add.closest('.food-card');
      if (card) {
        card.classList.add('just-added');
        setTimeout(function () { card.classList.remove('just-added'); }, 450);
      }
      setTimeout(bumpCartBar, 40);
      setTimeout(enhanceMenuList, 60);
      /* Reason: syncQty() previously only ran for not-yet-enhanced cards, so the quantity
       * control never appeared after ADD. Sync the tapped card once the cart has updated. */
      var addedId = card ? card.getAttribute('data-id') : null;
      setTimeout(function () { syncCardById(addedId); }, 60);
      return;
    }
    if (!plus && !minus) return;
    ev.preventDefault();
    ev.stopPropagation();
    var id = (plus || minus).getAttribute(plus ? 'data-qty-plus' : 'data-qty-minus');
    if (!id || !MM.state) return;
    if (plus) {
      var addBtn = document.querySelector('.food-card[data-id="' + id + '"] [data-add]');
      if (addBtn) addBtn.click();
    } else {
      var cart2 = MM.state.cart || [];
      for (var j = 0; j < cart2.length; j++) {
        if (String(cart2[j].id) === String(id)) {
          cart2[j].qty = (cart2[j].qty || 1) - 1;
          if (cart2[j].qty < 1) cart2.splice(j, 1);
          break;
        }
      }
      MM.state.cart = cart2;
      try { MM.store.setJSON(MM.KEYS.cart, cart2); } catch (e) {}
    }
    setTimeout(function () {
      enhanceMenuList();
      syncCardById(id);
      bumpCartBar();
      var bar = document.getElementById('cart-bar');
      if (bar && MM.state && MM.state.cart) {
        var n = MM.state.cart.reduce(function (a, c) { return a + (c.qty || 1); }, 0);
        var total = MM.state.cart.reduce(function (a, c) { return a + (Number(c.price) || 0) * (c.qty || 1); }, 0);
        if (n < 1) bar.hidden = true;
        else {
          bar.hidden = false;
          var cc = document.getElementById('cart-count');
          var ct = document.getElementById('cart-total');
          if (cc) cc.textContent = cartCountLabel(n); /* same wording as app.js updateCartBar */
          if (ct) ct.textContent = String(Math.round(total));
        }
      }
    }, 30);
  }, true);

  var CUSTOMER_SCREENS = {
    'screen-welcome': 'home',
    'screen-menu': 'menu',
    'screen-cart': 'cart',
    'screen-order': 'order',
    'screen-placed': 'order',
    'screen-pay': 'order',
    'screen-party': 'home'
  };
  var STAFF_PREFIX = ['screen-login', 'screen-waiter', 'screen-kitchen', 'screen-owner'];

  function activeScreenId() {
    var on = document.querySelector('.screen.on');
    return on ? on.id : '';
  }

  function isStaffScreen(id) {
    return STAFF_PREFIX.some(function (p) { return id === p; });
  }

  var _navBusy = false;
  var _started = false;
  var _observed = false;

  function updateCustomerNav() {
    if (_navBusy) return;
    var nav = document.getElementById('customer-nav');
    if (!nav) return;
    _navBusy = true;
    try {
      var id = activeScreenId();
      var staff = isStaffScreen(id);
      var hide = !!staff;
      if (nav.hidden !== hide) nav.hidden = hide;
      if (!staff) {
        if (!document.body.classList.contains('has-cnav')) document.body.classList.add('has-cnav');
      } else {
        if (document.body.classList.contains('has-cnav')) document.body.classList.remove('has-cnav');
      }
      var key = CUSTOMER_SCREENS[id] || '';
      nav.querySelectorAll('[data-cnav]').forEach(function (btn) {
        var on = btn.getAttribute('data-cnav') === key;
        if (on) { if (!btn.classList.contains('on')) btn.classList.add('on'); }
        else { if (btn.classList.contains('on')) btn.classList.remove('on'); }
      });
    } finally { _navBusy = false; }
  }

  function goCustomer(target) {
    if (target === 'home') {
      document.querySelectorAll('.screen').forEach(function (el) { el.classList.remove('on'); });
      var w = document.getElementById('screen-welcome');
      if (w) w.classList.add('on');
      try { history.pushState({ mm: 'home' }, '', location.pathname + location.search); } catch (e) {}
      updateCustomerNav();
      return;
    }
    if (target === 'menu') {
      var back = document.getElementById('btn-menu-home');
      var view = document.getElementById('btn-view-menu');
      var menu = document.getElementById('screen-menu');
      if (menu && menu.querySelector('.food-card')) {
        document.querySelectorAll('.screen').forEach(function (el) { el.classList.remove('on'); });
        menu.classList.add('on');
        try { history.pushState({ mm: 'menu' }, '', location.pathname + location.search); } catch (e) {}
        updateCustomerNav();
        return;
      }
      if (view) { view.click(); setTimeout(updateCustomerNav, 50); return; }
      if (back) { back.click(); setTimeout(updateCustomerNav, 50); return; }
      document.querySelectorAll('.screen').forEach(function (el) { el.classList.remove('on'); });
      if (menu) menu.classList.add('on');
      updateCustomerNav();
      return;
    }
    if (target === 'cart') {
      var open = document.getElementById('btn-open-cart');
      if (open) open.click();
      else {
        document.querySelectorAll('.screen').forEach(function (el) { el.classList.remove('on'); });
        var c = document.getElementById('screen-cart');
        if (c) c.classList.add('on');
      }
      try { history.pushState({ mm: 'cart' }, '', location.pathname + location.search); } catch (e) {}
      setTimeout(updateCustomerNav, 50);
      return;
    }
    if (target === 'order') {
      var o1 = document.getElementById('btn-view-order-home');
      var o2 = document.getElementById('btn-view-order');
      var o3 = document.getElementById('btn-placed-view');
      var coh = document.getElementById('current-order-home');
      if (o1 && coh && !coh.hidden) o1.click();
      else if (o3) o3.click();
      else if (o2) o2.click();
      else {
        document.querySelectorAll('.screen').forEach(function (el) { el.classList.remove('on'); });
        var od = document.getElementById('screen-order');
        if (od) od.classList.add('on');
      }
      try { history.pushState({ mm: 'order' }, '', location.pathname + location.search); } catch (e) {}
      setTimeout(updateCustomerNav, 50);
      return;
    }
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-cnav]');
    if (!btn) return;
    ev.preventDefault();
    goCustomer(btn.getAttribute('data-cnav'));
  }, true);

  window.addEventListener('popstate', function () {
    setTimeout(updateCustomerNav, 30);
  });

  function bootCritical() {
    enhanceHome();
    updateCustomerNav();
  }

  function bootDeferred() {
    enhanceCategories();
    enhanceMenuList();
    enhanceOrderDetail();
    enhancePlaced();
    enhanceCart();
  }

  function observe() {
    if (_observed) return;
    _observed = true;
    document.querySelectorAll('.screen').forEach(function (el) {
      new MutationObserver(function () { updateCustomerNav(); }).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    var targets = {
      'menu-list': enhanceMenuList,
      'order-detail': enhanceOrderDetail,
      'screen-placed': enhancePlaced,
      'cart-items': enhanceCart,
      'categories': enhanceCategories
    };
    Object.keys(targets).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var pending = false;
      new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; targets[id](); });
      }).observe(el, { childList: true, subtree: false });
    });
  }

  function start() {
    if (_started) return;
    _started = true;
    observe();
    bootCritical();
    var run = function () { bootDeferred(); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 600 });
    else setTimeout(run, 0);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 0); });
  } else {
    setTimeout(start, 0);
  }
})();
