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

  function enhanceMenuList() {
    var list = document.getElementById('menu-list');
    if (!list) return;
    var cards = list.querySelectorAll('.food-card');
    for (var i = 0; i < cards.length; i++) enhanceCard(cards[i]);
    if (!cards.length && V && !list.querySelector('.empty-state')) {
      if (!list.querySelector('.loading')) {
        list.innerHTML = V.emptyPlateMarkup('No items', 'Try another search or category.');
      }
    }
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
    if (!screen || !V) return;
    var mark = screen.querySelector('.ok-mark');
    if (mark && !screen.querySelector('.success-plate')) {
      mark.outerHTML = V.successPlateMarkup();
    }
  }

  function enhanceCart() {
    var box = document.getElementById('cart-items');
    if (!box || !V) return;
    var rows = box.querySelectorAll('.cart-row');
    rows.forEach(function (row) {
      if (row.querySelector('.cart-pic')) return;
      var idx = row.getAttribute('data-idx');
      var cart = (MM.state && MM.state.cart) || [];
      var c = cart[Number(idx)];
      if (!c) return;
      var item = itemById(c.id) || c;
      var pic = document.createElement('div');
      pic.className = 'pic cart-pic';
      pic.innerHTML = V.dishImageMarkup(item, 'cart');
      row.insertBefore(pic, row.firstChild);
      row.classList.add('cart-line');
    });
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
    if (scan && !scan.querySelector('.scan-qr-visual')) {
      scan.classList.add('scan-cta', 'btn-main');
      var label = scan.textContent.trim() || 'Scan table QR';
      scan.innerHTML =
        '<span class="scan-qr-visual" aria-hidden="true">' +
        '<span class="scan-qr-corner scan-qr-tl"></span>' +
        '<span class="scan-qr-corner scan-qr-tr"></span>' +
        '<span class="scan-qr-corner scan-qr-bl"></span>' +
        '<span class="scan-qr-dot"></span>' +
        '<span class="scan-qr-beam"></span></span>' +
        '<span class="scan-qr-copy"><b>' + label + '</b>' +
        '<small>Open your table menu and start ordering</small></span>' +
        '<span class="scan-cta-arrow" aria-hidden="true">→</span>';
    }
    var hero = document.querySelector('#screen-welcome .hero');
    if (hero && !hero.querySelector('.home-steam')) {
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
          if (cc) cc.textContent = String(n);
          if (ct) ct.textContent = String(Math.round(total));
        }
      }
    }, 30);
  }, true);

  function boot() {
    enhanceHome();
    enhanceMenuList();
    enhanceCategories();
    enhanceOrderDetail();
    enhancePlaced();
    enhanceCart();
  }

  function observe() {
    ['menu-list', 'order-detail', 'screen-placed', 'cart-items', 'categories'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      new MutationObserver(function () {
        if (id === 'menu-list') enhanceMenuList();
        if (id === 'categories') { el.removeAttribute('data-mm-cats'); enhanceCategories(); }
        if (id === 'order-detail') enhanceOrderDetail();
        if (id === 'screen-placed') enhancePlaced();
        if (id === 'cart-items') enhanceCart();
      }).observe(el, { childList: true, subtree: true });
    });
  }

  function start() {
    observe();
    boot();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 300); });
  } else {
    setTimeout(start, 300);
  }
  setTimeout(start, 1000);
  setTimeout(start, 2200);
})();
