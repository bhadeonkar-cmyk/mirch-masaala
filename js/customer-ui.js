/* Customer UI enhancement — images, qty micro-UI, order progress.
 * Does not change backend / C1–C8 / P0 logic. Observes DOM only. */
(function () {
  'use strict';
  if (!window.MM) window.MM = {};

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
    if (!card || card.getAttribute('data-ui') === '1') return;
    card.setAttribute('data-ui', '1');

    var id = card.getAttribute('data-id');
    var item = itemById(id);
    var info = card.querySelector('.food-info');
    if (!info) return;

    if (!card.querySelector('.food-media')) {
      var media = document.createElement('div');
      media.className = 'food-media';
      var url = '';
      if (item && typeof window.mmMenuImageUrl === 'function') {
        url = window.mmMenuImageUrl(item);
      }
      if (url) {
        var img = document.createElement('img');
        img.src = url;
        img.alt = (item && item.name) || '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.onerror = function () {
          media.classList.add('placeholder');
          if (img.parentNode) img.parentNode.removeChild(img);
        };
        media.appendChild(img);
      } else {
        media.classList.add('placeholder');
      }
      card.insertBefore(media, card.firstChild);
      card.classList.add('has-img');
    }

    syncQty(card, id);
  }

  function syncQty(card, id) {
    var q = cartQty(id);
    var addBtn = card.querySelector('[data-add]');
    var existing = card.querySelector('.qty-ctrl');
    if (q < 1) {
      if (existing) existing.remove();
      if (addBtn) addBtn.hidden = false;
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
  }

  function enhanceOrderDetail() {
    var box = document.getElementById('order-detail');
    if (!box) return;
    var card = box.querySelector('.order-card');
    if (!card || card.querySelector('.order-progress')) return;
    var badge = card.querySelector('.badge');
    var status = badge ? (badge.textContent || '').trim().toUpperCase() : 'NEW';
    var map = {
      NEW: 0, RECEIVED: 0, 'ORDER RECEIVED': 0,
      PREPARING: 1, READY: 2, SERVED: 3, PAID: 3
    };
    var keys = Object.keys(map);
    var step = 0;
    for (var i = 0; i < keys.length; i++) {
      if (status.indexOf(keys[i]) >= 0) { step = map[keys[i]]; break; }
    }
    var labels = ['Order received', 'Preparing', 'Ready', 'Served'];
    var html = '<div class="order-progress" aria-label="Order progress">';
    for (var s = 0; s < 4; s++) {
      var cls = s < step ? 'done' : (s === step ? 'active' : '');
      html += '<div class="order-step ' + cls + '"><div class="dot"></div>' +
        '<div class="step-label">' + labels[s] + '</div></div>';
    }
    html += '</div>';
    var head = card.querySelector('.order-head');
    if (head) head.insertAdjacentHTML('afterend', html);
    else card.insertAdjacentHTML('afterbegin', html);
  }

  function enhancePlaced() {
    var h1 = document.querySelector('#screen-placed h1');
    if (h1 && !h1.getAttribute('data-ui')) h1.setAttribute('data-ui', '1');
  }

  document.addEventListener('click', function (ev) {
    var plus = ev.target.closest('[data-qty-plus]');
    var minus = ev.target.closest('[data-qty-minus]');
    if (!plus && !minus) return;
    ev.preventDefault();
    ev.stopPropagation();
    var id = (plus || minus).getAttribute(plus ? 'data-qty-plus' : 'data-qty-minus');
    if (!id || !MM.state) return;
    if (plus) {
      var add = document.querySelector('.food-card[data-id="' + id + '"] [data-add]');
      if (add) add.click();
      else {
        var it = itemById(id);
        if (!it) return;
        var cart = MM.state.cart || [];
        var found = null;
        for (var i = 0; i < cart.length; i++) {
          if (String(cart[i].id) === String(id)) { found = cart[i]; break; }
        }
        if (found) found.qty = (found.qty || 1) + 1;
        else cart.push({ id: it.id, name: it.name, price: Number(it.price) || 0, qty: 1 });
        MM.state.cart = cart;
        try { MM.store.setJSON(MM.KEYS.cart, cart); } catch (e) {}
      }
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

  function observe() {
    ['menu-list', 'order-detail', 'screen-placed'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      new MutationObserver(function () {
        if (id === 'menu-list') enhanceMenuList();
        if (id === 'order-detail') enhanceOrderDetail();
        if (id === 'screen-placed') enhancePlaced();
      }).observe(el, { childList: true, subtree: true });
    });
    var bar = document.getElementById('cart-bar');
    if (bar) {
      new MutationObserver(function () { enhanceMenuList(); }).observe(bar, { attributes: true, childList: true, subtree: true });
    }
  }

  function boot() {
    observe();
    enhanceMenuList();
    enhanceOrderDetail();
    enhancePlaced();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 400); });
  } else {
    setTimeout(boot, 400);
  }
  setTimeout(boot, 1200);
  setTimeout(boot, 2500);
})();
