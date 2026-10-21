/* Mirch Masaala shared Supabase connection.
 * Browser-safe publishable key only. RLS and server-side RPCs protect data.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://adbhxldsqwsyaqzdmxnf.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_jAm4636kkOg-EysRgIa_Jw_bt967sZ9';
  var RESTAURANT_ID = 'a3702d10-6673-4c06-9783-1d61c945ecd5';
  var client = null;
  // Changes whenever a user explicitly opens a role/login or starts a login/logout.
  // Async restore work must not repaint a screen after a newer user action.
  var staffAuthFlowVersion = 0;
  var staffRefreshBusy = false;
  var customerRefreshBusy = false;
  var menuRefreshBusy = false;
  var lastShownError = '';
  var publicOrderBoardBusy = false;
  var publicOrderBoardWarningShown = false;

  window.MM_SUPABASE_ENABLED = false;
  window.MM_SUPABASE_STATUS = 'connecting';

  function notifyError(message) {
    message = String(message || 'Unknown connection error');
    console.error('[Mirch Masaala Supabase]', message);
    if (message !== lastShownError && typeof window.toast === 'function') {
      window.toast(message);
      lastShownError = message;
      setTimeout(function () { if (lastShownError === message) lastShownError = ''; }, 8000);
    }
  }

  function notifySuccess(message) {
    if (typeof window.toast === 'function') window.toast(message);
  }
  
  var staffNotificationBusy = false;
  var staffNotificationSetupWarningShown = false;

  async function createGuestNotification(type, tableNumber) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Live alerts are not connected yet.');
    var result = await client.rpc('mm_create_guest_notification', {
      p_restaurant_id: RESTAURANT_ID,
      p_type: String(type || '').toUpperCase(),
      p_table_number: String(tableNumber || '').padStart(2, '0')
    });
    if (result.error) throw result.error;
    var data = result.data || {};
    var ids = data && Array.isArray(data.notification_ids) ? data.notification_ids : [];
    if (ids.length && Array.isArray(data.dispatch_tokens) && data.dispatch_tokens.length && client.functions && typeof client.functions.invoke === 'function') {
      client.functions.invoke('send-staff-push', { body: { notification_ids: ids, dispatch_tokens: (Array.isArray(data.dispatch_tokens) ? data.dispatch_tokens : []) } })
        .then(function (sent) {
          if (sent && sent.error) console.info('[Mirch Masaala push] In-app alert saved; background push sender is not deployed or ready yet.');
        })
        .catch(function (err) {
          console.info('[Mirch Masaala push] In-app alert saved; background push setup may still be needed.', err && err.message ? err.message : err);
        });
    }
    return data;
  }

  async function loadStaffNotifications() {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected.');
    if (['admin', 'waiter', 'kitchen'].indexOf(window.role) < 0) return [];
    var result = await client.rpc('mm_staff_notifications', { p_limit: 50 });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async function resolveStaffNotification(id) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected.');
    var result = await client.rpc('mm_resolve_staff_notification', { p_notification_id: Number(id) });
    if (result.error) throw result.error;
    await refreshRoleNotifications(true);
    return result.data;
  }

  function nativeStaffNotification(row) {
    if (!row || isMobileBrowser() || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { if (localStorage.getItem('mm_push_enabled_' + String(window.role || '')) === '1') return; } catch (e) {}
    var type = String(row.notification_type || '').toUpperCase();
    // Owner has the shared Alerts panel for ORDER_READY; avoid an additional
    // desktop browser notification that can duplicate or cover the dashboard.
    if (type === 'ORDER_READY' && String(window.role || '') === 'admin') return;
    var table = String(row.table_number || '').padStart(2, '0');
    var title = 'Mirch Masaala';
    var body = row.message || '';
    if (type === 'WAITER_CALL') { title = 'WAITER NEEDED · TABLE ' + table; body = 'A guest is waiting for a waiter.'; }
    else if (type === 'BILL_REQUEST') { title = 'BILL REQUEST · TABLE ' + table; body = 'Please attend the table bill request.'; }
    else if (type === 'NEW_ORDER') { title = 'NEW ORDER · TABLE ' + table; body = 'A new kitchen ticket has arrived.'; }
    else if (type === 'ORDER_READY') { title = 'ORDER READY · TABLE ' + table; body = 'Please check the ready ticket.'; }
    else if (type === 'ITEM_SOLD_OUT') { title = 'ITEM SOLD OUT'; body = row.item_name || row.message || 'Kitchen changed menu availability.'; }
    try {
      var notification = new Notification(title, { body: body, tag: 'mm-alert-' + row.id, icon: './icon.svg', requireInteraction: type === 'WAITER_CALL' || type === 'BILL_REQUEST' });
      notification.onclick = function () { try { window.focus(); } catch (e) {} notification.close(); };
    } catch (e) {}
  }

  async function refreshRoleNotifications(force) {
    if (staffNotificationBusy || !client || !window.MM_SUPABASE_ENABLED ||
        ['admin', 'waiter', 'kitchen'].indexOf(window.role) < 0) return;
    staffNotificationBusy = true;
    try {
      var rows = await loadStaffNotifications();
      rows.sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
      var role = String(window.role);
      var seenKey = 'mm_alert_seen_' + role;
      var initializedKey = seenKey + '_initialized';
      var seen = [];
      try { seen = JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch (e) {}
      if (!Array.isArray(seen)) seen = [];
      var known = {};
      seen.forEach(function (id) { known[String(id)] = true; });
      var isInitial = localStorage.getItem(initializedKey) !== '1';
      if (!isInitial) {
        var newRows = rows.filter(function (row) {
          var id = String(row.id);
          return !known[id] && (Date.now() - new Date(row.created_at || 0).getTime() < 120000);
        });
        newRows.forEach(nativeStaffNotification);
      }
      rows.forEach(function (row) { known[String(row.id)] = true; });
      var ids = Object.keys(known).slice(-120);
      try {
        localStorage.setItem(seenKey, JSON.stringify(ids));
        localStorage.setItem(initializedKey, '1');
      } catch (e) {}
      window.MM_ROLE_NOTIFICATIONS = rows;
      if (typeof window.renderRoleNotifications === 'function') window.renderRoleNotifications(rows, !!force);
    } catch (e) {
      if (!staffNotificationSetupWarningShown) {
        staffNotificationSetupWarningShown = true;
        console.info('[Mirch Masaala alerts] Run supabase/role-notifications.sql to enable shared role alerts.', e && e.message ? e.message : e);
      }
    } finally {
      staffNotificationBusy = false;
    }
  }

  function isMobileBrowser() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') ||
      (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
  }

  function isIOSDevice() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
      (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
  }

  function isStandaloneWebApp() {
    return !!(navigator.standalone ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
  }

  // Public Web Push key; the matching private key exists only in Supabase Edge Function secrets.
  var WEB_PUSH_VAPID_PUBLIC_KEY = 'BH8rULqiO6c1_QtspafwRyxbpHz3V48VXf7If1UTv1u4s3WUyNw5IeUBDMcISfOCoLEM6spSfJ5Jf1TH0xNgjto';

  function vapidKeyBytes(base64Url) {
    var padding = '='.repeat((4 - base64Url.length % 4) % 4);
    var base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  async function enableBrowserNotifications() {
    if (['admin', 'waiter', 'kitchen'].indexOf(String(window.role || '')) < 0) {
      notifyError('Sign in to your staff account before enabling staff alerts.');
      return false;
    }
    if (isIOSDevice() && !isStandaloneWebApp()) {
      notifyError('On iPhone, first add Mirch Masaala to your Home Screen, then open its icon and tap Alert options.');
      return false;
    }
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      notifyError('This browser cannot receive web push. Keep the staff screen open for in-app alerts.');
      return false;
    }
    if (Notification.permission === 'denied') {
      notifyError('Notifications are blocked for this app. Enable them in phone Settings, then try again.');
      return false;
    }
    try {
      // This function is invoked directly from the staff member's tap.
      var permission = Notification.permission;
      if (permission !== 'granted') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        notifyError('Allow notifications for Mirch Masaala to alert this phone when guests call.');
        return false;
      }
      if (!client || !window.MM_SUPABASE_ENABLED) {
        notifyError('Staff connection is not ready. Reopen the staff app and try again.');
        return false;
      }
      var registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      await navigator.serviceWorker.ready;
      var subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyBytes(WEB_PUSH_VAPID_PUBLIC_KEY)
        });
      }
      var userResult = await client.auth.getUser();
      if (userResult.error || !userResult.data || !userResult.data.user) {
        notifyError('Your staff session expired. Sign in again, then enable alerts.');
        return false;
      }
      var saved = await client.from('mm_staff_push_subscriptions').upsert({
        staff_user_id: userResult.data.user.id,
        target_role: String(window.role),
        endpoint: subscription.endpoint,
        subscription: subscription.toJSON(),
        user_agent: String(navigator.userAgent || '').slice(0, 400),
        updated_at: new Date().toISOString()
      }, { onConflict: 'endpoint' });
      if (saved.error) throw saved.error;
      try { localStorage.setItem('mm_push_enabled_' + String(window.role), '1'); } catch (e) {}
      notifySuccess('Push alerts enabled. This phone can alert the waiter when a guest calls, even if the app is in the background.');
      if (typeof window.MM_REFRESH_ROLE_NOTIFICATIONS === 'function') window.MM_REFRESH_ROLE_NOTIFICATIONS(true);
      return true;
    } catch (e) {
      console.error('[Mirch Masaala push setup]', e);
      var detail = e && e.message ? String(e.message) : '';
      notifyError(detail.indexOf('mm_staff_push_subscriptions') >= 0
        ? 'The one-time staff push SQL setup has not been applied yet.'
        : 'Could not enable push alerts. Ask the owner to finish the one-time Supabase push setup.');
      return false;
    }
  }

  function notifyCustomerOrderStatus(updated, previous) {
    if (!updated || !previous || String(updated.status) === String(previous.status)) return;
    var status = String(updated.status || '').toUpperCase();
    if (status !== 'PREPARING' && status !== 'READY') return;
    var key = 'mm_customer_status_notified_' + String(updated.id || '') + '_' + status;
    try { if (localStorage.getItem(key) === '1') return; localStorage.setItem(key, '1'); } catch (e) {}
    var message = status === 'READY'
      ? 'Your food is ready. Please check with the restaurant team.'
      : 'The kitchen has started preparing your order.';
    if (typeof window.toast === 'function') window.toast('Table ' + updated.table + ' · ' + message);
    if (!isMobileBrowser() && 'Notification' in window && Notification.permission === 'granted') {
      try {
        var n = new Notification(status === 'READY' ? 'Your order is ready' : 'Your order is being prepared', {
          body: 'Table ' + updated.table + ' · Ticket ' + updated.id,
          tag: 'mm-customer-' + key,
          icon: './icon.svg'
        });
        n.onclick = function () { try { window.focus(); } catch (e) {} n.close(); };
      } catch (e) {}
    }
  }

  function existingCategory(name) {
    var list = (window.MENU && window.MENU.categories) || [];
    var lower = String(name || '').toLowerCase();
    return list.find(function (item) {
      return String(item.name || '').toLowerCase() === lower;
    }) || null;
  }

  function tableNumberFor(tableId, tableRows) {
    var found = tableRows.find(function (t) { return t.id === tableId; });
    return found ? String(found.table_number).padStart(2, '0') : '??';
  }

  function rpcPayload(data) {
    return Array.isArray(data) ? (data[0] || null) : data;
  }

  function isValidGoogleReviewsUrl(value) {
    if (!value) return true;
    try {
      var u = new URL(String(value).trim());
      var h = u.hostname.toLowerCase();
      var googleHost = h === "google.com" || h.endsWith(".google.com") ||
        /^google\.(co\.[a-z]{2}|[a-z]{2,3})$/.test(h) ||
        /^[a-z0-9-]+\.google\.(co\.[a-z]{2}|[a-z]{2,3})$/.test(h);
      return u.protocol === "https:" && (googleHost || h === "g.page" || h.endsWith(".g.page") || h === "maps.app.goo.gl" || h === "goo.gl");
    } catch (e) { return false; }
  }

  async function loadMenu(forStaff, quiet) {
    if (!client) return false;
    if (menuRefreshBusy) {
      await new Promise(function (resolve) { setTimeout(resolve, 150); });
      return loadMenu(forStaff, quiet);
    }
    menuRefreshBusy = true;
    try {
      var categoryResult = await client.from('categories')
        .select('id,name,sort_order,is_active')
        .eq('restaurant_id', RESTAURANT_ID)
        .order('sort_order', { ascending: true });
      if (categoryResult.error) throw categoryResult.error;

      var menuResult = await client.from('menu_items')
        .select('id,category_id,name,description,price,image_url,is_available,sort_order,is_veg,is_bestseller,spicy_level')
        .eq('restaurant_id', RESTAURANT_ID)
        .order('sort_order', { ascending: true });
      if (menuResult.error) throw menuResult.error;

      var categoryById = {};
      var oldCategories = (window.MENU && window.MENU.categories) || [];
      var cats = (categoryResult.data || []).map(function (row, index) {
        var old = existingCategory(row.name);
        var category = {
          id: old ? old.id : (Number(row.sort_order) || index + 1),
          db_id: row.id,
          name: row.name,
          slug: old ? old.slug : String(row.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          order: Number(row.sort_order) || index + 1,
          is_visible: !!row.is_active
        };
        categoryById[row.id] = category;
        return category;
      });

      var items = (menuResult.data || []).map(function (row, index) {
        var category = categoryById[row.category_id] || { name: 'Other', slug: 'other' };
        return {
          id: Number(row.sort_order) || index + 1,
          db_id: row.id,
          name: row.name,
          category: category.name,
          category_slug: category.slug,
          description: row.description || '',
          price: Number(row.price) || 0,
          is_veg: !!row.is_veg,
          is_non_veg: !row.is_veg,
          is_bestseller: !!row.is_bestseller,
          is_available: !!row.is_available,
          spicy_level: Number(row.spicy_level) || 0,
          image: row.image_url || null
        };
      });

      if (cats.length) window.MENU.categories = cats;
      window.MENU.menu_items = items;
      try { localStorage.setItem('mm_live_menu_loaded', '1'); } catch (e) {}

      if (typeof window.drawCats === 'function') window.drawCats();
      if (typeof window.drawDietFilters === 'function') window.drawDietFilters();
      if (typeof window.drawMenu === 'function' && document.getElementById('customer') && document.getElementById('customer').classList.contains('on')) {
        window.drawMenu();
        if (typeof window.drawSpecials === 'function') window.drawSpecials();
      }
      if (typeof window.wCats === 'function' && document.getElementById('w-cats')) window.wCats();
      if (typeof window.wMenu === 'function' && document.getElementById('w-menu')) window.wMenu();
      if (typeof window.drawAdminMenu === 'function' && document.getElementById('a-menu') && document.getElementById('a-menu').style.display !== 'none' && (window.role === 'admin')) window.drawAdminMenu();
      if (typeof window.drawKMenu === 'function' && document.getElementById('kitchen') && document.getElementById('kitchen').classList.contains('on')) window.drawKMenu();

      if (!quiet) console.info('[Mirch Masaala] Loaded ' + items.length + ' menu items from Supabase');
      return true;
    } catch (e) {
      if (!quiet) notifyError('Could not load shared menu. Check Supabase setup and try refreshing.');
      console.error('[Mirch Masaala menu sync]', e);
      return false;
    } finally {
      menuRefreshBusy = false;
    }
  }

  async function refreshStaffOrders() {
    if (!client || !window.MM_SUPABASE_ENABLED || !window.role || staffRefreshBusy) return;
    if (['admin', 'waiter', 'kitchen'].indexOf(window.role) < 0) return;
    staffRefreshBusy = true;
    try {
      var result = await client.from('orders')
        .select('id,ticket_id,table_id,status,notes,total,created_at,public_token,order_number')
        .eq('restaurant_id', RESTAURANT_ID)
        .order('created_at', { ascending: false })
        .limit(100);
      if (result.error) throw result.error;
      var rows = result.data || [];
      if (!rows.length) {
        window.orders = [];
        try { localStorage.setItem('mm_o', '[]'); } catch (e) {}
        if (document.getElementById('waiter') && document.getElementById('waiter').classList.contains('on') && typeof window.drawWaiterOrders === 'function') window.drawWaiterOrders();
        if (document.getElementById('admin') && document.getElementById('admin').classList.contains('on') && window.role === 'admin' && typeof window.drawAdminOrders === 'function') window.drawAdminOrders();
        if (document.getElementById('kitchen') && document.getElementById('kitchen').classList.contains('on') && typeof window.drawK === 'function') window.drawK();
        return;
      }

      var ids = rows.map(function (r) { return r.id; });
      var [tableResult, itemResult] = await Promise.all([
        client.from('restaurant_tables').select('id,table_number').eq('restaurant_id', RESTAURANT_ID),
        client.from('order_items').select('order_id,item_name,quantity,price,notes').in('order_id', ids)
      ]);
      if (tableResult.error) throw tableResult.error;
      if (itemResult.error) throw itemResult.error;
      var tableRows = tableResult.data || [];
      var itemsByOrder = {};
      (itemResult.data || []).forEach(function (item) {
        if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
        itemsByOrder[item.order_id].push({
          name: item.item_name,
          price: Number(item.price) || 0,
          qty: Number(item.quantity) || 1,
          notes: item.notes || ''
        });
      });

      window.orders = rows.map(function (row) {
        return {
          id: row.ticket_id || ('ORDER-' + row.order_number),
          dbId: row.id,
          publicToken: row.public_token,
          table: tableNumberFor(row.table_id, tableRows),
          items: itemsByOrder[row.id] || [],
          total: Number(row.total) || 0,
          status: String(row.status || 'NEW').toUpperCase(),
          notes: row.notes || '',
          createdAt: row.created_at,
          orderNumber: row.order_number
        };
      });
      try { localStorage.setItem('mm_o', JSON.stringify(window.orders)); } catch (e) {}
      if (document.getElementById('admin') && document.getElementById('admin').classList.contains('on') && window.role === 'admin' && typeof window.drawAdminOrders === 'function') window.drawAdminOrders();
      if (document.getElementById('kitchen') && document.getElementById('kitchen').classList.contains('on') && (window.role === 'kitchen' || window.role === 'admin') && typeof window.drawK === 'function') window.drawK();
      if (document.getElementById('waiter') && document.getElementById('waiter').classList.contains('on') && typeof window.drawWaiterOrders === 'function') window.drawWaiterOrders();
      if (document.getElementById('success') && document.getElementById('success').classList.contains('on') && typeof window.refreshProgressViews === 'function') window.refreshProgressViews();
    } catch (e) {
      notifyError('Order sync failed. Check staff account permissions in Supabase.');
      console.error('[Mirch Masaala order sync]', e);
    } finally {
      staffRefreshBusy = false;
    }
  }

  function storePublicToken(ticketId, token) {
    if (!ticketId || !token) return;
    try {
      var list = JSON.parse(localStorage.getItem('mm_live_order_tokens') || '[]');
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (x) { return x && x.id !== ticketId; });
      list.push({ id: ticketId, token: token });
      localStorage.setItem('mm_live_order_tokens', JSON.stringify(list.slice(-15)));
    } catch (e) {}
  }

  async function refreshCustomerOrders() {
    if (!client || !window.MM_SUPABASE_ENABLED || customerRefreshBusy) return;
    customerRefreshBusy = true;
    try {
      var tokens = JSON.parse(localStorage.getItem('mm_live_order_tokens') || '[]');
      if (!Array.isArray(tokens) || !tokens.length) return;
      var savedOrders = [];
      try { savedOrders = JSON.parse(localStorage.getItem('mm_o') || '[]') || []; } catch (e) {}
      for (var i = Math.max(0, tokens.length - 10); i < tokens.length; i++) {
        var saved = tokens[i];
        if (!saved || !saved.id || !saved.token) continue;
        var current = (savedOrders || []).find(function (o) { return o && o.id === saved.id; });
        var result = await client.rpc('mm_get_public_order', {
          p_ticket_id: saved.id,
          p_public_token: saved.token
        });
        if (result.error) throw result.error;
        var remote = rpcPayload(result.data);
        if (!remote) continue;
        var updated = {
          id: remote.id,
          table: String(remote.table || (current && current.table) || '01').padStart(2, '0'),
          items: remote.items || (current && current.items) || [],
          total: Number(remote.total) || 0,
          status: String(remote.status || 'NEW').toUpperCase(),
          notes: remote.notes || '',
          createdAt: remote.createdAt || (current && current.createdAt) || new Date().toISOString(),
          cancelUntil: current && current.cancelUntil,
          publicToken: saved.token
        };
        if (current && String(current.status || '').toUpperCase() !== updated.status &&
            typeof window.notifyCustomerOrderStatus === 'function') {
          window.notifyCustomerOrderStatus(updated, current);
        }
        var idx = savedOrders.findIndex(function (o) { return o && o.id === updated.id; });
        if (idx >= 0) savedOrders[idx] = Object.assign({}, savedOrders[idx], updated);
        else savedOrders.unshift(updated);
      }
      window.orders = savedOrders;
      try { localStorage.setItem('mm_o', JSON.stringify(savedOrders)); } catch (e) {}
      if (typeof window.refreshProgressViews === 'function') window.refreshProgressViews();
      if (typeof window.renderCustomerHomeOrders === 'function') window.renderCustomerHomeOrders();
      if (typeof window.renderPublicOrderBoard === 'function') window.renderPublicOrderBoard(window.MM_PUBLIC_ORDER_ROWS || []);
      if (document.getElementById('myorders') && document.getElementById('myorders').classList.contains('on') && typeof window.myOrders === 'function') window.myOrders();
    } catch (e) {
      console.warn('[Mirch Masaala customer order status]', e);
    } finally {
      customerRefreshBusy = false;
    }
  }

  function buildOrderItems(cartItems) {
    return (cartItems || []).map(function (cartItem) {
      var item = (window.MENU.menu_items || []).find(function (candidate) {
        return String(candidate.id) === String(cartItem.id);
      });
      if (!item || !item.db_id) throw new Error('Menu is still connecting. Please wait a moment and try again.');
      return { menu_item_id: item.db_id, quantity: Number(cartItem.qty) || 1 };
    });
  }

  async function createSharedOrder(tableNumber, cartItems, notes) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected yet. Please refresh and try again.');
    var ticket = window.makeTicketId(tableNumber, new Date());
    var payload = buildOrderItems(cartItems);
    var result = await client.rpc('mm_place_order', {
      p_restaurant_id: RESTAURANT_ID,
      p_table_number: String(tableNumber).padStart(2, '0'),
      p_ticket_id: ticket,
      p_notes: String(notes || '').slice(0, 1000),
      p_items: payload
    });
    if (result.error) throw result.error;
    var created = rpcPayload(result.data);
    if (!created || !created.id || !created.publicToken) throw new Error('Supabase did not return the new order ticket. Please refresh and try again.');
    storePublicToken(created.id, created.publicToken);
    return {
      id: created.id,
      dbId: created.dbId,
      publicToken: created.publicToken,
      table: String(created.table || tableNumber).padStart(2, '0'),
      items: created.items || [],
      total: Number(created.total) || 0,
      status: String(created.status || 'NEW').toUpperCase(),
      notes: created.notes || '',
      createdAt: created.createdAt || new Date().toISOString(),
      orderNumber: created.orderNumber,
      cancelUntil: Date.now() + (7 * 60 * 1000)
    };
  }

  async function placeCustomerOrder() {
    if (window.MM_ORDER_SENDING) return;
    if (!window.cart || !window.cart.length) return;
    window.MM_ORDER_SENDING = true;
    var originalCart = window.cart.slice();
    var notesEl = document.getElementById('notes');
    var noteText = notesEl ? notesEl.value.trim() : '';
    try {
      var order = await createSharedOrder(window.table || '01', originalCart, noteText);
      window.orders = window.orders || [];
      window.orders.unshift(order);
      try { localStorage.setItem('mm_o', JSON.stringify(window.orders)); } catch (e) {}
      window.cart = [];
      try { localStorage.setItem('mm_c_' + String(order.table).padStart(2, '0'), '[]'); } catch (e) {}
      if (typeof window.closeCart === 'function') window.closeCart();
      if (notesEl) notesEl.value = '';
      var sid = document.getElementById('sid');
      var stbl = document.getElementById('stbl');
      if (sid) sid.textContent = order.id;
      if (stbl) stbl.textContent = order.table;
      if (typeof window.updCart === 'function') window.updCart();
      window.lastPlacedOrderId = order.id;
      window.go('success');
      var host = document.getElementById('success-progress-host');
      if (host) host.innerHTML = window.progressMarkup(order) + '<p class="waiting-joke" id="waiting-joke">Chef has received your mission. 🍳</p>';
      if (typeof window.startWaitFun === 'function') window.startWaitFun(order.id);
      if (typeof window.confetti === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) window.confetti({ particleCount: 60, spread: 80, origin: { y: 0.6 } });
      notifySuccess('Order sent to kitchen!');
      refreshCustomerOrders();
    } catch (e) {
      notifyError(e && e.message ? e.message : 'Could not send the order. Please ask your waiter.');
    } finally {
      window.MM_ORDER_SENDING = false;
    }
  }

  async function sendWaiterOrder() {
    if (window.MM_ORDER_SENDING) return;
    if (window.role !== 'waiter') {
      notifyError('Waiter account required to send this order.');
      return;
    }
    if (!window.MM_WAITER_CONFIRMATION_APPROVED) {
      if (typeof window.openWaiterConfirm === 'function') window.openWaiterConfirm();
      else notifyError('Please review the order before sending.');
      return;
    }
    window.MM_WAITER_CONFIRMATION_APPROVED = false;
    if (!window.wTable || !window.wCart || !window.wCart.length) {
      notifyError('Pick a table and add food first.');
      return;
    }
    window.MM_ORDER_SENDING = true;
    try {
      var noteEl = document.getElementById('w-notes');
      var note = noteEl ? noteEl.value.trim() : '';
      var order = await createSharedOrder(window.wTable, window.wCart, note ? '[Waiter] ' + note : '');
      window.orders = window.orders || [];
      window.orders.unshift(order);
      try { localStorage.setItem('mm_o', JSON.stringify(window.orders)); } catch (e) {}
      window.wCart = [];
      if (window.wTable && window.wDrafts) window.wDrafts[window.wTable] = [];
      if (window.wTable && window.wNotesDrafts) window.wNotesDrafts[window.wTable] = '';
      if (noteEl) noteEl.value = '';
      if (typeof window.wDrawCart === 'function') window.wDrawCart();
      if (typeof window.wMenu === 'function') window.wMenu();
      if (typeof window.drawWaiterOrders === 'function') window.drawWaiterOrders();
      notifySuccess('Ticket ' + order.id + ' sent · Table ' + order.table);
      await refreshStaffOrders();
    } catch (e) {
      notifyError(e && e.message ? e.message : 'Could not send the waiter order.');
    } finally {
      window.MM_ORDER_SENDING = false;
    }
  }

  async function setSharedOrderStatus(ticketId, status) {
    var actor = String(window.role || '');
    var nextStatus = String(status || '').toUpperCase();
    if (!client || ['admin', 'waiter', 'kitchen'].indexOf(actor) < 0) {
      notifyError('Please sign in with your staff account first.');
      return;
    }
    var permitted = actor === 'admin'
      ? ['NEW', 'PREPARING', 'READY', 'SERVED', 'PAID', 'CANCELLED'].indexOf(nextStatus) >= 0
      : actor === 'kitchen'
        ? ['PREPARING', 'READY'].indexOf(nextStatus) >= 0
        : nextStatus === 'SERVED';
    if (!permitted) {
      notifyError(actor === 'waiter'
        ? 'Waiter action: mark food served only.'
        : actor === 'kitchen'
          ? 'Kitchen action: mark orders cooking or ready only.'
          : 'This order action is not allowed for this role.');
      return;
    }
    try {
      var result = await client.from('orders')
        .update({ status: nextStatus })
        .eq('restaurant_id', RESTAURANT_ID)
        .eq('ticket_id', ticketId);
      if (result.error) throw result.error;
      await refreshStaffOrders();
      if (typeof window.refreshProgressViews === 'function') window.refreshProgressViews();
      notifySuccess('Order marked ' + nextStatus.toLowerCase() + '.');
    } catch (e) {
      notifyError('Could not update order status. Check your staff permissions.');
      console.error('[Mirch Masaala status update]', e);
    }
  }

  function ensureUsernameField() {
    var pass = document.getElementById('pass');
    if (!pass || document.getElementById('staff-username')) return;
    var username = document.createElement('input');
    username.type = 'text';
    username.id = 'staff-username';
    username.placeholder = 'Username';
    username.autocomplete = 'username';
    username.inputMode = 'text';
    username.maxLength = 64;
    username.setAttribute('aria-label', 'Staff username');
    username.style.marginBottom = '8px';
    pass.parentNode.insertBefore(username, pass);
  }

  function rememberedUsernameKey(role) {
    return 'mm_staff_username_' + String(role || '').toLowerCase();
  }

  function defaultUsernameForRole(role) {
    return role === 'admin' ? 'owner' : (role === 'waiter' ? 'waiter' : (role === 'kitchen' ? 'kitchen' : ''));
  }

  function loadRememberedUsername(role) {
    var value = '';
    try { value = localStorage.getItem(rememberedUsernameKey(role)) || ''; } catch (e) {}
    return value || defaultUsernameForRole(role);
  }

  function saveRememberedUsername(role, username, enabled) {
    try {
      if (enabled && username) localStorage.setItem(rememberedUsernameKey(role), username);
      else localStorage.removeItem(rememberedUsernameKey(role));
    } catch (e) {
      console.warn('[Mirch Masaala] Could not save remembered username on this device:', e);
    }
  }

  function authEmailForCredential(value) {
    var credential = String(value || '').trim().toLowerCase();
    // Existing accounts using a real email remain compatible during migration.
    if (credential.indexOf('@') >= 0) return credential;
    if (!/^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/.test(credential)) {
      throw new Error('Use a username of 3–32 characters: letters, numbers, dot, dash or underscore.');
    }
    // Supabase Auth still authenticates internally with email; staff only enter their username.
    return credential + '@staff.mirchmasaala.invalid';
  }

  async function secureStaffLogin() {
    var loginFlowVersion = ++staffAuthFlowVersion;
    ensureUsernameField();
    var usernameInput = document.getElementById('staff-username');
    var passInput = document.getElementById('pass');
    var err = document.getElementById('login-err');
    var requestedRole = window.pendingRole;
    var routeRole = requestedStaffShortcutRole();
    var username = usernameInput ? usernameInput.value.trim().toLowerCase() : '';
    var password = passInput ? passInput.value : '';
    if (!requestedRole) {
      notifyError('Choose a staff role first.');
      return;
    }
    if (routeRole && routeRole !== requestedRole) {
      if (err) { err.style.display = 'block'; err.textContent = 'This page is locked to the ' + routeRole + ' login. Open the correct role page to continue.'; }
      notifyError('Role mismatch. Open the correct staff login page.');
      return;
    }
    if (!username || !password) {
      if (err) { err.style.display = 'block'; err.textContent = 'Enter your username and password.'; }
      return;
    }
    if (!client || !window.MM_SUPABASE_ENABLED) {
      if (err) { err.style.display = 'block'; err.textContent = 'Database connection is not ready. Refresh this page.'; }
      return;
    }
    var authEmail;
    try {
      authEmail = authEmailForCredential(username);
    } catch (validationError) {
      if (err) { err.style.display = 'block'; err.textContent = validationError.message; }
      return;
    }
    if (err) { err.style.display = 'block'; err.textContent = 'Signing in securely…'; }
    try {
      var signIn = await client.auth.signInWithPassword({ email: authEmail, password: password });
      if (loginFlowVersion !== staffAuthFlowVersion) return;
      if (signIn.error) throw signIn.error;
      var roleResult = await client.rpc('get_my_staff_role');
      if (loginFlowVersion !== staffAuthFlowVersion) return;
      if (roleResult.error) throw roleResult.error;
      var actualRole = rpcPayload(roleResult.data);
      if (['admin', 'waiter', 'kitchen'].indexOf(actualRole) < 0) {
        await client.auth.signOut({ scope: 'local' });
        window.role = null;
        try { sessionStorage.removeItem('mm_role'); } catch (e) {}
        throw new Error('This account has no staff role yet. Ask the owner to finish staff setup.');
      }
      if (actualRole !== requestedRole) {
        await client.auth.signOut({ scope: 'local' });
        window.role = null;
        try { sessionStorage.removeItem('mm_role'); } catch (e) {}
        throw new Error('This account is assigned as ' + actualRole + ', not ' + requestedRole + '. Choose the matching role.');
      }
      window.role = actualRole;
      try { sessionStorage.setItem('mm_role', actualRole); } catch (e) {}
      try { localStorage.setItem('mm_last_staff_role', actualRole); } catch (e) {}
      var rememberBox = document.getElementById('remember-staff-login');
      saveRememberedUsername(actualRole, username, !rememberBox || rememberBox.checked);
      if (err) err.style.display = 'none';

      // Do not hold the login screen open while menu and order data load.
      // Both password and staff-role validation are complete; open the correct
      // role workspace immediately and refresh shared data in the background.
      notifySuccess('Signed in as ' + actualRole + '.');
      if (actualRole === 'waiter') {
        window.go('waiter');
        if (typeof window.enterWaiter === 'function') window.enterWaiter();
      } else if (actualRole === 'kitchen') {
        window.go('kitchen');
        if (typeof window.enterKitchen === 'function') window.enterKitchen();
      } else {
        window.go('admin');
        if (typeof window.enterAdmin === 'function') window.enterAdmin();
        loadWhatsAppSettings().then(function () {
          if (typeof window.drawSettings === 'function' && document.getElementById('a-settings') && document.getElementById('a-settings').style.display !== 'none') window.drawSettings();
        }).catch(function (e) {
          console.info('[Mirch Masaala] WhatsApp settings use local defaults until CRM SQL is applied:', e.message || e);
        });
      }

      Promise.resolve().then(function () {
        if (loginFlowVersion !== staffAuthFlowVersion) return;
        return loadMenu(true, true);
      }).then(function () {
        if (loginFlowVersion !== staffAuthFlowVersion) return;
        return refreshStaffOrders();
      }).catch(function (e) {
        console.warn('[Mirch Masaala] Background staff data refresh:', e && e.message ? e.message : e);
      });
    } catch (e) {
      if (loginFlowVersion !== staffAuthFlowVersion) return;
      if (err) { err.style.display = 'block'; err.textContent = e && e.message ? e.message : 'Sign-in failed. Check the username and password.'; }
      console.error('[Mirch Masaala staff login]', e);
    }
  }

  async function secureLogout() {
    var logoutFlowVersion = ++staffAuthFlowVersion;
    try { if (client) await client.auth.signOut({ scope: 'local' }); } catch (e) {}
    if (logoutFlowVersion !== staffAuthFlowVersion) return;
    window.role = null;
    try { sessionStorage.removeItem('mm_role'); } catch (e) {}
    try { localStorage.removeItem('mm_last_staff_role'); } catch (e) {}
    window.go('home');
    if (typeof window.setOpenPill === 'function') window.setOpenPill();
    notifySuccess('Signed out.');
  }

  async function saveSharedPrice(id) {
    if (window.role !== 'admin') { notifyError('Owner/Admin access required.'); return; }
    var item = (window.MENU.menu_items || []).find(function (it) { return String(it.id) === String(id); });
    var input = document.getElementById('price-edit-' + id);
    if (!item || !input) return;
    var price = Number(input.value);
    if (!Number.isFinite(price) || price < 0 || price > 999999) { notifyError('Enter a valid price.'); input.focus(); return; }
    try {
      var result = await client.from('menu_items').update({ price: Math.round(price) })
        .eq('restaurant_id', RESTAURANT_ID).eq('id', item.db_id);
      if (result.error) throw result.error;
      item.price = Math.round(price);
      (window.cart || []).forEach(function (c) { var m = window.MENU.menu_items.find(function (x) { return String(x.id) === String(c.id); }); if (m) c.price = m.price; });
      (window.wCart || []).forEach(function (c) { var m = window.MENU.menu_items.find(function (x) { return String(x.id) === String(c.id); }); if (m) c.price = m.price; });
      if (typeof window.updCart === 'function') window.updCart();
      if (typeof window.wDrawCart === 'function') window.wDrawCart();
      if (typeof window.drawAdminMenu === 'function') window.drawAdminMenu();
      notifySuccess('Price updated for every device.');
    } catch (e) {
      notifyError('Price update failed. Confirm you are signed in as the owner.');
      console.error('[Mirch Masaala price update]', e);
    }
  }

  async function toggleSharedItem(id) {
    if (['admin', 'kitchen'].indexOf(window.role) < 0) { notifyError('Owner or kitchen access required.'); return; }
    var item = (window.MENU.menu_items || []).find(function (it) { return String(it.id) === String(id); });
    if (!item) return;
    var next = !item.is_available;
    try {
      var result = await client.from('menu_items').update({ is_available: next })
        .eq('restaurant_id', RESTAURANT_ID).eq('id', item.db_id);
      if (result.error) throw result.error;
      item.is_available = next;
      if (typeof window.drawAdminMenu === 'function' && document.getElementById('a-menu') && document.getElementById('a-menu').style.display !== 'none') window.drawAdminMenu();
      if (typeof window.drawKMenu === 'function' && document.getElementById('kitchen') && document.getElementById('kitchen').classList.contains('on')) window.drawKMenu();
      if (typeof window.drawMenu === 'function' && document.getElementById('customer') && document.getElementById('customer').classList.contains('on')) window.drawMenu();
      notifySuccess(next ? 'Dish available on every device.' : 'Dish marked sold out on every device.');
    } catch (e) {
      notifyError('Could not update availability. Check staff permissions.');
      console.error('[Mirch Masaala item update]', e);
    }
  }

  function requestedStaffShortcutRole() {
    try {
      var params = new URLSearchParams(window.location.search);
      var staffValue = String(params.get('staff') || '').toLowerCase();
      var roleValue = String(params.get('role') || '').toLowerCase();
      var allowed = ['waiter', 'kitchen', 'admin'];
      if (allowed.indexOf(staffValue) >= 0) return staffValue;
      if (allowed.indexOf(roleValue) >= 0) return roleValue;
      return null;
    } catch (e) {
      return null;
    }
  }

  function staffLoginHasUserInput() {
    var loginScreen = document.getElementById('login');
    var passwordInput = document.getElementById('pass');
    return !!(loginScreen && loginScreen.classList.contains('on') &&
      passwordInput && String(passwordInput.value || '').length > 0);
  }

  async function restoreStaffSession() {
    var restoreFlowVersion = staffAuthFlowVersion;
    var requestedRole = requestedStaffShortcutRole();
    try {
      var sessionResult = await client.auth.getSession();
      if (restoreFlowVersion !== staffAuthFlowVersion) return;
      if (sessionResult.error || !sessionResult.data || !sessionResult.data.session) {
        // The role-specific login was opened from the URL during app boot.
        // Do not reopen it here: doing so can clear a password while the user types.
        return;
      }
      var roleResult = await client.rpc('get_my_staff_role');
      if (restoreFlowVersion !== staffAuthFlowVersion || staffLoginHasUserInput()) return;
      if (roleResult.error) return;
      var actualRole = rpcPayload(roleResult.data);
      if (['admin', 'waiter', 'kitchen'].indexOf(actualRole) < 0) return;
      if (restoreFlowVersion !== staffAuthFlowVersion || staffLoginHasUserInput()) return;
      if (requestedRole && requestedRole !== actualRole) {
        console.info('[Mirch Masaala role restore] URL role differs from the verified account; opening the verified account role.', {
          requestedRole: requestedRole,
          actualRole: actualRole
        });
      }
      window.role = actualRole;
      try { sessionStorage.setItem('mm_role', actualRole); } catch (e) {}
      try { localStorage.setItem('mm_last_staff_role', actualRole); } catch (e) {}
      // Restore the correct dashboard before waiting for menu/order network calls.
      if (actualRole === 'waiter') {
        window.go('waiter');
        if (typeof window.enterWaiter === 'function') window.enterWaiter();
      } else if (actualRole === 'kitchen') {
        window.go('kitchen');
        if (typeof window.enterKitchen === 'function') window.enterKitchen();
      } else if (actualRole === 'admin') {
        window.go('admin');
        if (typeof window.enterAdmin === 'function') window.enterAdmin();
        loadWhatsAppSettings().catch(function (e) {
          console.info('[Mirch Masaala] WhatsApp settings use local defaults until CRM SQL is applied:', e.message || e);
        });
      }
      Promise.resolve().then(function () {
        if (restoreFlowVersion !== staffAuthFlowVersion || staffLoginHasUserInput()) return;
        return loadMenu(true, true);
      }).then(function () {
        if (restoreFlowVersion !== staffAuthFlowVersion || staffLoginHasUserInput()) return;
        return refreshStaffOrders();
      }).catch(function (e) {
        console.warn('[Mirch Masaala] Background session refresh:', e && e.message ? e.message : e);
      });
    } catch (e) {
      console.warn('[Mirch Masaala session restore]', e);
    }
  }


  async function saveRemoteCustomerProfile(profile) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error("Shared database is not connected.");
    var result = await client.rpc("mm_save_customer_profile", {
      p_restaurant_id: RESTAURANT_ID,
      p_phone: String(profile.phone || ""),
      p_name: String(profile.name || "Guest"),
      p_order_updates: !!profile.orderUpdatesOptIn,
      p_marketing_opt_in: !!profile.marketingOptIn
    });
    if (result.error) throw result.error;
    return rpcPayload(result.data);
  }

  async function submitRestaurantReview(review) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error("Shared database is not connected.");
    var rating = Number(review && review.stars);
    var comment = String(review && review.text || "").trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Choose a rating from 1 to 5 stars.");
    if (comment.length > 1500) throw new Error("Comment must be 1,500 characters or fewer.");
    var result = await client.rpc("mm_submit_restaurant_review", {
      p_restaurant_id: RESTAURANT_ID,
      p_name: String(review && review.name || "Guest").slice(0, 80),
      p_rating: rating,
      p_comment: comment,
      p_table_number: String(review && review.table || "").slice(0, 20)
    });
    if (result.error) throw result.error;
    return rpcPayload(result.data);
  }

  async function loadRestaurantReviews(forAdmin) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error("Shared database is not connected.");
    if (forAdmin && window.role !== "admin") throw new Error("Owner/Admin access required.");
    var query = client.from("mm_restaurant_reviews")
      .select("id,display_name,rating,comment,table_number,status,created_at")
      .eq("restaurant_id", RESTAURANT_ID)
      .order("created_at", { ascending: false })
      .limit(forAdmin ? 100 : 50);
    if (!forAdmin) query = query.eq("status", "published");
    var result = await query;
    if (result.error) throw result.error;
    return (result.data || []).map(function (row) {
      return {
        id: row.id,
        dbId: row.id,
        name: row.display_name || "Guest",
        display_name: row.display_name || "Guest",
        stars: Number(row.rating) || 0,
        rating: Number(row.rating) || 0,
        text: row.comment || "",
        comment: row.comment || "",
        table: row.table_number || "",
        status: row.status || "pending",
        created_at: row.created_at
      };
    });
  }

  async function setRestaurantReviewStatus(reviewId, status) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error("Shared database is not connected.");
    if (window.role !== "admin") throw new Error("Owner/Admin access required.");
    if (["published", "hidden"].indexOf(status) < 0) throw new Error("Invalid review status.");
    var result = await client.rpc("mm_admin_set_restaurant_review_status", {
      p_review_id: String(reviewId || ""),
      p_status: status
    });
    if (result.error) throw result.error;
    return rpcPayload(result.data);
  }

  async function deleteRestaurantReview(reviewId) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error("Shared database is not connected.");
    if (window.role !== "admin") throw new Error("Owner/Admin access required.");
    var result = await client.rpc("mm_admin_delete_restaurant_review", {
      p_review_id: String(reviewId || "")
    });
    if (result.error) throw result.error;
    return rpcPayload(result.data);
  }

  async function refreshPublicOrderBoard() {
    if (!client || !window.MM_SUPABASE_ENABLED || publicOrderBoardBusy) return;
    publicOrderBoardBusy = true;
    try {
      var result = await client.rpc("mm_public_order_board");
      if (result.error) throw result.error;
      var rows = Array.isArray(result.data) ? result.data : [];
      window.MM_PUBLIC_ORDER_ROWS = rows;
      if (typeof window.renderPublicOrderBoard === "function") window.renderPublicOrderBoard(rows);
    } catch (e) {
      if (!publicOrderBoardWarningShown) {
        console.info("[Mirch Masaala] Public live order board is not enabled yet. Run supabase/public-table-status-circles.sql once.", e && e.message ? e.message : e);
        publicOrderBoardWarningShown = true;
      }
      // The renderer uses this device's own saved tickets even if the shared public RPC is not installed yet.
      if (typeof window.renderPublicOrderBoard === "function") {
        window.renderPublicOrderBoard(window.MM_PUBLIC_ORDER_ROWS || []);
      }
    } finally {
      publicOrderBoardBusy = false;
    }
  }

  async function loadWhatsAppSettings() {
    if (!client || window.role !== "admin") throw new Error("Owner/Admin access required.");
    var result = await client.from("mm_whatsapp_settings")
      .select("owner_contact,display_name,receipt_message,order_update_message,announcement_message,offer_message")
      .eq("restaurant_id", RESTAURANT_ID)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return null;
    var s = window.SETTINGS || {};
    // WhatsApp contact number and display name come from the public shared config,
    // so customer devices and owner devices use one source of truth.
    s.receiptMessage = result.data.receipt_message || s.receiptMessage || "";
    s.whatsappOrderMessage = result.data.order_update_message || s.whatsappOrderMessage || "";
    s.whatsappAnnouncementMessage = result.data.announcement_message || s.whatsappAnnouncementMessage || "";
    s.whatsappOfferMessage = result.data.offer_message || s.whatsappOfferMessage || "";
    try { localStorage.setItem("mm_settings", JSON.stringify(s)); } catch (e) {}
    return result.data;
  }

  async function loadSharedRestaurantConfig() {
    if (!client || !window.MM_SUPABASE_ENABLED) return false;
    var result = await client.from("mm_restaurant_config")
      .select("restaurant_name,tagline,admin_phone,upi_id,upi_name,phonepe_upi,whatsapp_number,whatsapp_name,google_reviews_url,pay_note,accept_card,accept_cash,updated_at")
      .eq("restaurant_id", RESTAURANT_ID)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return false;

    // Never overwrite in-progress edits while the owner is using Settings.
    var settingsPanel = document.getElementById("a-settings");
    if (window.role === "admin" && settingsPanel && settingsPanel.style.display !== "none") return true;

    var remote = result.data;
    var s = window.SETTINGS || {};
    var paymentConfigBefore = JSON.stringify([
      String(s.upiId || "").trim(),
      String(s.upiName || "").trim(),
      String(s.phonepeUpi || "").trim(),
      String(s.payNote || "")
    ]);
    s.restaurantName = remote.restaurant_name || s.restaurantName || "MIRCH MASAALA";
    s.tagline = remote.tagline || s.tagline || "INDIAN RESTAURANT";
    s.adminPhone = remote.admin_phone || s.adminPhone || "+91 9657076450";
    s.upiId = remote.upi_id || "";
    s.upiName = remote.upi_name || "Mirch Masaala";
    s.phonepeUpi = remote.phonepe_upi || "";
    s.whatsappNumber = String(remote.whatsapp_number || "").replace(/\D/g, "");
    s.whatsappName = remote.whatsapp_name || s.whatsappName || "Mirch Masaala";
    var previousGoogleReviewsUrl = String(s.googleReviewsUrl || "");
    s.googleReviewsUrl = remote.google_reviews_url || "";
    s.payNote = remote.pay_note || "Review the amount in your payment app before paying.";
    s.acceptCard = remote.accept_card !== false;
    s.acceptCash = remote.accept_cash !== false;
    var paymentConfigAfter = JSON.stringify([
      String(s.upiId || "").trim(),
      String(s.upiName || "").trim(),
      String(s.phonepeUpi || "").trim(),
      String(s.payNote || "")
    ]);
    try { localStorage.setItem("mm_settings", JSON.stringify(s)); } catch (e) {}

    if (typeof window.applySettings === "function") window.applySettings();
    else {
      if (typeof window.renderVisitSection === "function") window.renderVisitSection();
      if (typeof window.renderHomeTables === "function") window.renderHomeTables();
    }

    // If the customer already has the payment dialog open, refresh its QR/link immediately.
    var payModal = document.getElementById("pay-modal");
    if (payModal && payModal.classList.contains("on") && paymentConfigBefore !== paymentConfigAfter && typeof window.selectPayMethod === "function") {
      window.selectPayMethod((window.payContext && window.payContext.method) || "gpay");
    }
    if (previousGoogleReviewsUrl !== String(s.googleReviewsUrl || "") && typeof window.renderReviewSection === "function") {
      window.renderReviewSection();
    }
    return true;
  }

  async function saveSharedRestaurantConfig() {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error("Shared database is not connected.");
    if (window.role !== "admin") throw new Error("Only the Owner/Admin can change restaurant payment settings.");
    var s = window.SETTINGS || {};
    var upiId = String(s.upiId || "").trim();
    var phonepeUpi = String(s.phonepeUpi || "").trim();
    var googleReviewsUrl = String(s.googleReviewsUrl || "").trim();
    var restaurantWhatsApp = String(s.whatsappNumber || "").replace(/\D/g, "");
    if (upiId && !/^[^@\s]+@[^@\s]+$/.test(upiId)) throw new Error("Enter a valid restaurant UPI ID before syncing.");
    if (!isValidGoogleReviewsUrl(googleReviewsUrl)) throw new Error("Enter a valid HTTPS Google Reviews link.");
    if (phonepeUpi && !/^[^@\s]+@[^@\s]+$/.test(phonepeUpi)) throw new Error("Enter a valid PhonePe UPI ID before syncing.");
    if (restaurantWhatsApp && (restaurantWhatsApp.length < 10 || restaurantWhatsApp.length > 15)) throw new Error("Enter a valid restaurant WhatsApp number with country code, or leave it blank.");
    var authResult = await client.auth.getUser();
    if (authResult.error || !authResult.data || !authResult.data.user) throw new Error("Owner session expired. Sign in again.");
    var payload = {
      restaurant_id: RESTAURANT_ID,
      restaurant_name: String(s.restaurantName || "MIRCH MASAALA").slice(0, 150),
      tagline: String(s.tagline || "INDIAN RESTAURANT").slice(0, 200),
      admin_phone: String(s.adminPhone || "+91 9657076450").slice(0, 40),
      upi_id: upiId,
      upi_name: String(s.upiName || s.restaurantName || "Mirch Masaala").slice(0, 150),
      phonepe_upi: phonepeUpi,
      whatsapp_number: String(s.whatsappNumber || "").replace(/\D/g, ""),
      whatsapp_name: String(s.whatsappName || s.restaurantName || "Mirch Masaala").slice(0, 150),
      google_reviews_url: googleReviewsUrl.slice(0, 500),
      pay_note: String(s.payNote || "Review the amount in your payment app before paying.").slice(0, 300),
      accept_card: s.acceptCard !== false,
      accept_cash: s.acceptCash !== false,
      updated_at: new Date().toISOString(),
      updated_by: authResult.data.user.id
    };
    var result = await client.from("mm_restaurant_config").upsert(payload, { onConflict: "restaurant_id" });
    if (result.error) throw result.error;
    return true;
  }

  async function saveWhatsAppSettings() {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error("Shared database is not connected.");
    if (window.role !== "admin") throw new Error("Owner/Admin access required.");
    var s = window.SETTINGS || {};
    var contact = String(s.whatsappNumber || "").replace(/\D/g, "");
    if (contact.length < 10 || contact.length > 15) throw new Error("Enter a valid owner WhatsApp contact number with country code.");
    var payload = {
      restaurant_id: RESTAURANT_ID,
      owner_contact: contact,
      display_name: String(s.whatsappName || "Mirch Masaala").slice(0, 100),
      receipt_message: String(s.receiptMessage || "Thank you for dining at Mirch Masaala!").slice(0, 500),
      order_update_message: String(s.whatsappOrderMessage || "").slice(0, 900),
      announcement_message: String(s.whatsappAnnouncementMessage || "").slice(0, 900),
      offer_message: String(s.whatsappOfferMessage || "").slice(0, 900),
      updated_at: new Date().toISOString()
    };
    var result = await client.from("mm_whatsapp_settings").upsert(payload, { onConflict: "restaurant_id" });
    if (result.error) throw result.error;
    return true;
  }

  async function getWhatsAppCustomers() {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error("Shared database is not connected.");
    if (window.role !== "admin") throw new Error("Owner/Admin access required.");
    var result = await client.from("mm_customer_profiles")
      .select("id,phone,name,wa_order_updates,wa_marketing_opt_in,created_at,last_seen_at,visit_count")
      .eq("restaurant_id", RESTAURANT_ID)
      .order("last_seen_at", { ascending: false })
      .limit(500);
    if (result.error) throw result.error;
    return result.data || [];
  }

  async function getWhatsAppBroadcastLogs() {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error("Shared database is not connected.");
    if (window.role !== "admin") throw new Error("Owner/Admin access required.");
    var result = await client.from("mm_whatsapp_broadcast_logs")
      .select("id,category,message,eligible_count,attempted_count,sent_count,failed_count,provider_status,created_at")
      .eq("restaurant_id", RESTAURANT_ID)
      .order("created_at", { ascending: false })
      .limit(10);
    if (result.error) throw result.error;
    return result.data || [];
  }

  async function stopCustomerWhatsApp(profileId) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error("Shared database is not connected.");
    if (window.role !== "admin") throw new Error("Owner/Admin access required.");
    var result = await client.rpc("mm_admin_stop_customer_whatsapp", { p_profile_id: profileId });
    if (result.error) throw result.error;
    return rpcPayload(result.data);
  }

  async function sendWhatsAppBroadcast(category, message) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error("Shared database is not connected.");
    if (window.role !== "admin") throw new Error("Owner/Admin access required.");
    var result = await client.functions.invoke("send-whatsapp-broadcast", {
      body: { category: category, message: String(message || "").trim() }
    });
    if (result.error) {
      var detail = result.error.message || "The WhatsApp sender is unavailable.";
      if (result.error.context && typeof result.error.context.json === "function") {
        try {
          var body = await result.error.context.json();
          if (body && body.error) detail = body.error;
        } catch (e) {}
      }
      throw new Error(detail);
    }
    return result.data || {};
  }

  function start() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      window.MM_SUPABASE_STATUS = 'library-missing';
      window.MM_SUPABASE_ENABLED = false;
      window.placeOrder = function () { notifyError('Online ordering is unavailable. Refresh the page and try again.'); };
      window.wSend = function () { notifyError('Online ordering is unavailable. Refresh the page and try again.'); };
      window.doLogin = function () { notifyError('Secure staff login is unavailable. Refresh the page and try again.'); };
      notifyError('Secure online library failed to load. Refresh or try another network.');
      return;
    }
    // Use one stable Supabase local-storage key on every staff URL. This is the
    // standard Supabase key and keeps sessions available when a staff URL changes
    // or the app is refreshed. Migrate existing role-specific keys before creating
    // the client so already-signed-in staff do not have to sign in again.
    var projectRef = 'adbhxldsqwsyaqzdmxnf';
    try { projectRef = new URL(SUPABASE_URL).hostname.split('.')[0] || projectRef; } catch (e) {}
    var authStorageKey = 'sb-' + projectRef + '-auth-token';
    try {
      var authParams = new URLSearchParams(window.location.search);
      var staffParam = String(authParams.get('staff') || '').toLowerCase();
      var roleParam = String(authParams.get('role') || '').toLowerCase();
      var authAllowedRoles = ['admin', 'kitchen', 'waiter'];
      var requestedStorageRole = authAllowedRoles.indexOf(staffParam) >= 0 ? staffParam :
        (authAllowedRoles.indexOf(roleParam) >= 0 ? roleParam : '');
      var legacyPrefix = 'mm-mirch-masaala-auth-v1-';
      var defaultSession = localStorage.getItem(authStorageKey);
      var legacySession = requestedStorageRole ? localStorage.getItem(legacyPrefix + requestedStorageRole) : null;
      if (!legacySession && !defaultSession) {
        var lastRole = String(localStorage.getItem('mm_last_staff_role') || '').toLowerCase();
        var candidates = [];
        if (authAllowedRoles.indexOf(lastRole) >= 0) candidates.push(lastRole);
        authAllowedRoles.forEach(function (candidate) { if (candidates.indexOf(candidate) < 0) candidates.push(candidate); });
        for (var legacyIndex = 0; legacyIndex < candidates.length; legacyIndex++) {
          legacySession = localStorage.getItem(legacyPrefix + candidates[legacyIndex]);
          if (legacySession) break;
        }
      }
      if (legacySession) {
        localStorage.setItem(authStorageKey, legacySession);
      }
      if (localStorage.getItem(authStorageKey)) {
        authAllowedRoles.forEach(function (candidate) {
          localStorage.removeItem(legacyPrefix + candidate);
        });
      }
    } catch (storageMigrationError) {
      console.warn('[Mirch Masaala auth] Session storage migration was skipped:', storageMigrationError);
    }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storageKey: authStorageKey,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    window.MM_SUPABASE_CLIENT = client;
    window.MM_SUPABASE_ENABLED = true;
    window.MM_SUPABASE_STATUS = 'connected';
    window.MM_SAVE_CUSTOMER_PROFILE = saveRemoteCustomerProfile;
    window.MM_SUBMIT_RESTAURANT_REVIEW = submitRestaurantReview;
    window.MM_LOAD_RESTAURANT_REVIEWS = loadRestaurantReviews;
    window.MM_ADMIN_SET_REVIEW_STATUS = setRestaurantReviewStatus;
    window.MM_ADMIN_DELETE_RESTAURANT_REVIEW = deleteRestaurantReview;
    window.MM_LOAD_WHATSAPP_SETTINGS = loadWhatsAppSettings;
    window.MM_SAVE_WHATSAPP_SETTINGS = saveWhatsAppSettings;
    window.MM_LOAD_SHARED_RESTAURANT_CONFIG = loadSharedRestaurantConfig;
    window.MM_SAVE_SHARED_RESTAURANT_CONFIG = saveSharedRestaurantConfig;
    window.MM_GET_WHATSAPP_CUSTOMERS = getWhatsAppCustomers;
    window.MM_GET_WHATSAPP_LOGS = getWhatsAppBroadcastLogs;
    window.MM_STOP_CUSTOMER_WHATSAPP = stopCustomerWhatsApp;
    window.MM_SEND_WHATSAPP_BROADCAST = sendWhatsAppBroadcast;
    window.MM_CREATE_GUEST_NOTIFICATION = createGuestNotification;
    window.MM_LOAD_STAFF_NOTIFICATIONS = loadStaffNotifications;
    window.MM_RESOLVE_STAFF_NOTIFICATION = resolveStaffNotification;
    window.MM_REFRESH_ROLE_NOTIFICATIONS = refreshRoleNotifications;
    window.MM_ENABLE_BROWSER_NOTIFICATIONS = enableBrowserNotifications;
    window.notifyCustomerOrderStatus = notifyCustomerOrderStatus;

    ensureUsernameField();
    window.openLogin = function (requestedRole) {
      var allowedLoginRoles = ['admin', 'kitchen', 'waiter'];
      if (allowedLoginRoles.indexOf(requestedRole) < 0) {
        notifyError('Choose a valid staff role.');
        return;
      }
      ++staffAuthFlowVersion;
      try {
        var loginParams = new URLSearchParams(window.location.search);
        if (String(loginParams.get('staff') || '').toLowerCase() !== requestedRole) {
          loginParams.delete('table');
          loginParams.delete('role');
          loginParams.set('staff', requestedRole);
          window.location.replace(window.location.pathname + '?' + loginParams.toString() + window.location.hash);
          return;
        }
      } catch (e) {}
      window.pendingRole = requestedRole;
      ensureUsernameField();
      var oldUsername = document.getElementById('staff-username');
      if (oldUsername) oldUsername.value = loadRememberedUsername(requestedRole);
      var passInput = document.getElementById('pass');
      if (passInput) passInput.value = '';
      var rememberBox = document.getElementById('remember-staff-login');
      if (rememberBox) rememberBox.checked = true;
      var titles = { waiter: 'Waiter login', kitchen: 'Kitchen login', admin: 'Owner/Admin login' };
      var title = document.getElementById('login-title');
      var hint = document.getElementById('login-hint');
      var error = document.getElementById('login-err');
      if (title) title.textContent = titles[requestedRole] || 'Staff login';
      if (hint) hint.textContent = 'Enter the username and password provided by the owner.';
      if (error) { error.style.display = 'none'; error.textContent = ''; }
      window.go('login');
      setTimeout(function () { if (passInput) passInput.focus(); }, 150);
    };
    window.doLogin = secureStaffLogin;
    window.logout = secureLogout;
    window.placeOrder = placeCustomerOrder;
    window.wSend = sendWaiterOrder;
    window.setStatus = setSharedOrderStatus;
    window.saveItemPrice = saveSharedPrice;
    window.persistMenuEdits = function () {};
    window.toggleItem = toggleSharedItem;

    // Resolve staff URL shortcuts once after secure login handlers are ready.
    // The old shortcut logic lived inside bindStaffSecrets(), which is called
    // again during settings/menu refresh and accidentally reopened the login
    // screen seconds after a successful sign-in.
    try {
      var startupParams = new URLSearchParams(window.location.search);
      var startupRole = requestedStaffShortcutRole();
      if (startupRole && !window.MM_STAFF_SHORTCUT_HANDLED) {
        window.MM_STAFF_SHORTCUT_HANDLED = true;
        window.openLogin(startupRole);
      } else if (String(startupParams.get('staff') || '') === '1' &&
                 !window.MM_STAFF_SHORTCUT_HANDLED) {
        window.MM_STAFF_SHORTCUT_HANDLED = true;
        if (typeof window.showStaffPanel === 'function') window.showStaffPanel();
      }
    } catch (startupRouteError) {
      console.warn('[Mirch Masaala] Staff shortcut setup:', startupRouteError);
    }

    var loginForm = document.getElementById('pass');
    if (loginForm) loginForm.setAttribute('autocomplete', 'current-password');

    loadMenu(false, false).then(function (ok) {
      if (ok) notifySuccess('Shared menu connected.');
    });
    // Payment/UPI settings are shared centrally and refresh on every device.
    loadSharedRestaurantConfig().catch(function (e) {
      console.info('[Mirch Masaala] Shared payment settings are not set up yet:', e.message || e);
    }).finally(function () {
      if (typeof window.renderReviewSection === "function") window.renderReviewSection();
    });
    if (typeof window.renderReviewSection === "function") window.renderReviewSection();
    setInterval(function () {
      loadSharedRestaurantConfig().catch(function (e) {
        console.info('[Mirch Masaala] Shared payment settings refresh:', e.message || e);
      });
    }, 20000);
    restoreStaffSession();
    refreshCustomerOrders();
    refreshPublicOrderBoard();
    setInterval(function () { loadMenu(!!window.role, true); }, 20000);
    setInterval(refreshStaffOrders, 3000);
    setTimeout(refreshRoleNotifications, 1200);
    setInterval(refreshRoleNotifications, 4000);
    setInterval(refreshCustomerOrders, 6000);
    setInterval(refreshPublicOrderBoard, 8000);
    console.info('[Mirch Masaala] Supabase connected. Frontend is using shared menu and orders.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();