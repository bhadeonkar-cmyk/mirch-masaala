/* Mirch Masaala shared Supabase connection.
 * Browser-safe publishable key only. RLS and server-side RPCs protect data.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://adbhxldsqwsyaqzdmxnf.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_jAm4636kkOg-EysRgIa_Jw_bt967sZ9';
  var RESTAURANT_ID = 'a3702d10-6673-4c06-9783-1d61c945ecd5';
  var client = null;

  // Keep stable UI IDs for bundled dishes by matching their canonical names.
  // Database UUIDs remain the only identifiers submitted when an order is placed.
  function menuNameKey(value) {
    var name = String(value || '');
    try { if (name.normalize) name = name.normalize('NFKC'); } catch (e) {}
    return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }
  var bundledMenuIdsByName = Object.create(null);
  var bundledMenuItems = (window.MENU && Array.isArray(window.MENU.menu_items))
    ? window.MENU.menu_items.map(function (item) { return Object.assign({}, item); }) : [];
  bundledMenuItems.forEach(function (item) {
    var key = menuNameKey(item.name);
    if (!key) return;
    if (!bundledMenuIdsByName[key]) bundledMenuIdsByName[key] = [];
    bundledMenuIdsByName[key].push(Number(item.id));
  });

  // Changes whenever a user explicitly opens a role/login or starts a login/logout.
  // Async restore work must not repaint a screen after a newer user action.
  var staffAuthFlowVersion = 0;
  var staffRefreshBusy = false;
  var customerRefreshBusy = false;
  var menuRefreshBusy = false;
  var tableCapacitySetupMessageShown = false;
  window.MM_TABLE_CAPACITIES = window.MM_TABLE_CAPACITIES || {};
  var lastShownError = '';
  var publicOrderBoardBusy = false;
  var publicOrderBoardWarningShown = false;

  window.MM_SUPABASE_ENABLED = false;
  window.MM_TABLE_VISITS = window.MM_TABLE_VISITS || {};
  window.MM_TABLE_VISITS_READY = false;
  window.MM_SUPABASE_STATUS = 'connecting';
  window.MM_MENU_READY = false;
  window.MM_MENU_LOAD_ERROR = false;

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

  // The in-app notification has already been saved when this helper runs.
  // Report background push failures without exposing subscription payloads or secrets.
  function reportStaffPushDispatchFailure(error) {
    var status = Number(error && (error.status || (error.context && error.context.status)) || 0);
    var message = String(error && error.message || '').toLowerCase();
    var category = 'Background push was not confirmed; check the send-staff-push Edge Function logs and configuration.';
    if (status === 404 || /function.*not found|not deployed|requested function was not found/.test(message)) {
      category = 'send-staff-push Edge Function is missing or not deployed.';
    } else if (status === 503 || /secrets are not configured|push sender secrets/.test(message)) {
      category = 'Push sender configuration is incomplete in Supabase Edge Function Secrets.';
    } else if (status === 403 || /origin not allowed|dispatch token/.test(message)) {
      category = 'Push sender rejected the request origin or one-time dispatch token; check the Edge Function logs.';
    } else if (status === 500) {
      category = 'Push sender failed while reading or dispatching an alert; check the Edge Function logs and database schema.';
    }
    console.info('[Mirch Masaala push] In-app alert is saved; ' + category, {
      status: status || null,
      errorName: String(error && error.name || 'Error')
    });
  }

  function dispatchStaffPush(notificationIds, dispatchTokens) {
    if (!client || !client.functions || typeof client.functions.invoke !== 'function' ||
        !Array.isArray(notificationIds) || !notificationIds.length ||
        !Array.isArray(dispatchTokens) || !dispatchTokens.length) return;
    client.functions.invoke('send-staff-push', {
      body: { notification_ids: notificationIds, dispatch_tokens: dispatchTokens }
    }).then(function (result) {
      if (result && result.error) reportStaffPushDispatchFailure(result.error);
      else if (result && result.data && Number(result.data.failed || 0) > 0) {
        console.info('[Mirch Masaala push] The sender ran but one or more devices did not accept the push.', {
          sent: Number(result.data.sent || 0),
          failed: Number(result.data.failed || 0),
          notifications: Number(result.data.notifications || 0)
        });
      } else if (result && result.data && Number(result.data.sent || 0) === 0) {
        console.info('[Mirch Masaala push] No device received a push. Check that the intended staff role/device is subscribed and enabled.');
      }
    }).catch(reportStaffPushDispatchFailure);
  }

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
    dispatchStaffPush(ids, Array.isArray(data.dispatch_tokens) ? data.dispatch_tokens : []);
    return data;
  }

  async function requestVisitPaymentVerification(tableNumber, visitId, customerSessionId, method) {
    if (!client || !window.MM_SUPABASE_ENABLED) {
      throw new Error('The shared payment verification service is not connected yet.');
    }
    var result = await client.rpc('mm_guest_request_visit_payment_check', {
      p_restaurant_id: RESTAURANT_ID,
      p_table_number: String(tableNumber || '').padStart(2, '0'),
      p_visit_id: String(visitId || ''),
      p_customer_session_id: String(customerSessionId || ''),
      p_method: String(method || 'upi').toLowerCase()
    });
    if (result.error) {
      var code = String(result.error.code || '');
      var detail = String(result.error.message || '');
      console.error('[Mirch Masaala visit payment verification]', { code: code, message: detail });
      if (code === 'PGRST202' || code === '42883' || /mm_guest_request_visit_payment_check/i.test(detail)) {
        throw new Error('Visit-aware payment verification is not activated yet. Please show your payment receipt to the waiter.');
      }
      throw new Error(detail || 'We could not notify staff just now. Please show your payment receipt to the waiter.');
    }
    var data = rpcPayload(result.data) || {};
    if (data && data.ok === false) throw new Error('We could not send the verification request. Please ask your waiter.');
    dispatchStaffPushForGuestRequest(data);
    return data;
  }

  async function requestPaymentVerification(tableNumber, method) {
    if (!client || !window.MM_SUPABASE_ENABLED) {
      throw new Error('The shared payment verification service is not connected yet.');
    }
    var result = await client.rpc('mm_guest_request_payment_check', {
      p_restaurant_id: RESTAURANT_ID,
      p_table_number: String(tableNumber || '').padStart(2, '0'),
      p_method: String(method || 'upi').toLowerCase()
    });
    if (result.error) {
      var code = String(result.error.code || '');
      var detail = String(result.error.message || '');
      console.error('[Mirch Masaala payment verification]', { code: code, message: detail });
      if (code === 'PGRST202' || code === '42883' || /mm_guest_request_payment_check/i.test(detail)) {
        throw new Error('Payment verification is not connected yet. Please show your payment receipt to the waiter.');
      }
      throw new Error('We could not notify staff just now. Please show your payment receipt to the waiter.');
    }
    var data = rpcPayload(result.data) || {};
    if (data && data.ok === false) throw new Error('We could not send the verification request. Please ask your waiter.');
    dispatchStaffPushForGuestRequest(data);
    return data;
  }

  function dispatchStaffPushForGuestRequest(data) {
    var ids = data && Array.isArray(data.notification_ids) ? data.notification_ids : [];
    var tokens = data && Array.isArray(data.dispatch_tokens) ? data.dispatch_tokens : [];
    dispatchStaffPush(ids, tokens);
  }

  async function submitPartyBooking(payload) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Party booking is not connected yet. Please try again shortly.');
    var input = payload || {};
    var result = await client.rpc('mm_submit_party_booking', {
      p_name: String(input.name || '').trim(),
      p_phone: String(input.phone || '').trim(),
      p_event_type: String(input.eventType || ''),
      p_event_date: String(input.eventDate || ''),
      p_event_time: String(input.eventTime || ''),
      p_guest_count: Number(input.guestCount),
      p_notes: String(input.notes || '').trim()
    });
    if (result.error) {
      var backendError = result.error;
      var errorCode = String(backendError.code || '');
      var errorText = String(backendError.message || '') + ' ' + String(backendError.details || '');
      console.error('[Mirch Masaala party booking RPC]', {
        code: errorCode, message: backendError.message, details: backendError.details, hint: backendError.hint
      });
      if (errorCode === 'PGRST202' || errorCode === '42883' ||
          /mm_submit_party_booking/i.test(errorText) && /could not find|does not exist|schema cache|not found/i.test(errorText)) {
        var setupError = new Error('Online party booking is not connected to the shared database yet. Please contact the restaurant directly on WhatsApp.');
        setupError.code = 'MM_PARTY_BOOKING_SETUP_REQUIRED';
        throw setupError;
      }
      if (errorCode === '42P01' || errorCode === '42501') {
        var accessError = new Error('Online party booking is temporarily unavailable. Please contact the restaurant directly on WhatsApp.');
        accessError.code = 'MM_PARTY_BOOKING_BACKEND_UNAVAILABLE';
        throw accessError;
      }
      var saveError = new Error('We could not save your request just now. Please try again in a moment or contact the restaurant.');
      saveError.code = errorCode || 'MM_PARTY_BOOKING_SAVE_FAILED';
      throw saveError;
    }
    var saved = rpcPayload(result.data);
    if (!saved || !saved.id || !saved.booking_ref) {
      throw new Error('The restaurant did not confirm the booking request. Please try again.');
    }
    dispatchStaffPushForGuestRequest(saved);
    return saved;
  }

  async function loadPartyBookings() {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('The shared database is not connected.');
    if (String(window.role || '') !== 'admin') throw new Error('Owner/Admin access required.');
    var result = await client.rpc('mm_admin_list_party_bookings', { p_limit: 150 });
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data : [];
  }

  async function updatePartyBooking(id, status, ownerNotes) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('The shared database is not connected.');
    if (String(window.role || '') !== 'admin') throw new Error('Owner/Admin access required.');
    var result = await client.rpc('mm_admin_update_party_booking', {
      p_booking_id: String(id || ''),
      p_status: String(status || '').toUpperCase(),
      p_owner_notes: String(ownerNotes || '').trim()
    });
    if (result.error) throw result.error;
    var saved = rpcPayload(result.data);
    if (!saved || !saved.id) throw new Error('The booking status was not confirmed. Please refresh and try again.');
    return saved;
  }

  async function loadStaffNotifications() {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected.');
    if (['admin', 'waiter', 'kitchen'].indexOf(window.role) < 0) return [];
    var staffCode = '';
    try { staffCode = String(localStorage.getItem('mm_waiter_staff_code') || '').trim().toUpperCase(); } catch (e) {}
    var result = await client.rpc('mm_staff_notifications', {
      p_limit: 50,
      p_staff_code: String(window.role) === 'waiter' ? staffCode : null
    });
    if (result.error) throw result.error;
    return result.data || [];
  }

  async function resolveStaffNotification(id) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected.');
    var staffCode = '';
    try { staffCode = String(localStorage.getItem('mm_waiter_staff_code') || '').trim().toUpperCase(); } catch (e) {}
    var result = await client.rpc('mm_resolve_staff_notification', {
      p_notification_id: Number(id),
      p_staff_code: String(window.role) === 'waiter' ? staffCode : null
    });
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
    if (type === 'CASH_AT_COUNTER') { title = 'CASH AT COUNTER · TABLE ' + table; body = row.message || 'A guest is leaving and will pay at the counter.'; }
    else if (type === 'GUEST_LEFT_UNPAID') { title = 'GUEST LEFT · BALANCE DUE · TABLE ' + table; body = row.message || 'Guests have left before settlement. Please collect the outstanding balance.'; }
    else if (type === 'PAYMENT_CHECK') { title = 'PAYMENT VERIFICATION · TABLE ' + table; body = row.message || 'A guest says they paid. Please verify the transaction before recording payment.'; }
    else if (type === 'PARTY_BOOKING') { title = 'NEW PARTY BOOKING REQUEST'; body = row.message || 'A new party booking request needs your attention.'; }
    else if (type === 'WAITER_CALL') { title = 'WAITER NEEDED · TABLE ' + table; body = 'A guest is waiting for a waiter.'; }
    else if (type === 'BILL_REQUEST') { title = 'BILL REQUEST · TABLE ' + table; body = 'Please attend the table bill request.'; }
    else if (type === 'NEW_ORDER') { title = 'NEW ORDER · TABLE ' + table; body = 'A new kitchen ticket has arrived.'; }
    else if (type === 'ORDER_READY') { title = 'ORDER READY · TABLE ' + table; body = 'Please check the ready ticket.'; }
    else if (type === 'ITEM_SOLD_OUT') { title = 'ITEM SOLD OUT'; body = row.item_name || row.message || 'Kitchen changed menu availability.'; }
    // Browser notifications use the same selected language as the screen.
    if (window.MM_HOME_LANGUAGE === 'mr' && typeof window.MM_TRANSLATE_NOTIFICATION_MESSAGE === 'function') {
      var localizedBody = window.MM_TRANSLATE_NOTIFICATION_MESSAGE(row);
      if (localizedBody && /[\u0900-\u097F]/.test(localizedBody)) body = localizedBody;
    }
    if (typeof window.MM_TRANSLATE_TEXT === 'function') {
      title = window.MM_TRANSLATE_TEXT(title);
      body = window.MM_TRANSLATE_TEXT(body);
    }
    try {
      var notification = new Notification(title, { body: body, tag: 'mm-alert-' + row.id, icon: './icon.svg', requireInteraction: type === 'WAITER_CALL' || type === 'BILL_REQUEST' || type === 'PARTY_BOOKING' || type === 'PAYMENT_CHECK' || type === 'CASH_AT_COUNTER' || type === 'GUEST_LEFT_UNPAID' });
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
  var WEB_PUSH_VAPID_PUBLIC_KEY = 'BCGV3-RIkNT5dJfV96yuWS61iZe5Zf85s8CJWBgq-Q_pGJWCLEkMD-91IB7yvsZ6Z0mGebJCohhVJmUHcuNW1E0';

  function vapidKeyBytes(base64Url) {
    var padding = '='.repeat((4 - base64Url.length % 4) % 4);
    var base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  // A key rotation invalidates old browser push subscriptions. Detect that here so
  // the next explicit staff opt-in replaces an old-key subscription automatically.
  function subscriptionUsesCurrentVapidKey(subscription) {
    var existingKey = subscription && subscription.options && subscription.options.applicationServerKey;
    if (!existingKey) return false;
    var existingBytes = new Uint8Array(existingKey);
    var currentBytes = vapidKeyBytes(WEB_PUSH_VAPID_PUBLIC_KEY);
    if (existingBytes.length !== currentBytes.length) return false;
    for (var i = 0; i < existingBytes.length; i++) {
      if (existingBytes[i] !== currentBytes[i]) return false;
    }
    return true;
  }

  // Turn a Supabase/PostgREST error into an accurate message. The same table name appears
  // in "missing table", "stale schema cache", "column missing" and row-level-security
  // errors, so the table name alone must not be read as "the SQL has not been applied".
  function describePushSetupError(e, stage) {
    e = e || {};
    var code = String(e.code || '');
    var name = String(e.name || '');
    var detail = [e.message, e.details, e.hint].filter(Boolean).join(' ');
    var lower = detail.toLowerCase();
    var tag = code ? ' (' + code + ')' : '';
    var generic = 'Could not enable push alerts' + tag + '. Check the browser console for the error category and ask the owner to check the Supabase push setup.';
    // Expired/invalid staff session: report this before the generic database categories.
    if (code === 'PGRST301' || code === 'PGRST303' || code === '28000' ||
        /jwt (expired|invalid)|invalid jwt|staff session required|not authenticated/.test(lower)) {
      return 'Your staff session is missing or expired' + tag + '. Sign out, sign in again, and enable alerts.';
    }
    if (code === 'PGRST205' || code === '42P01' || /could not find the table|relation .* does not exist/.test(lower)) {
      return 'Staff push table not found' + tag + '. Run supabase/staff-push-notifications.sql after confirming its prerequisites.';
    }
    if (code === 'PGRST204' || code === '42703' || /could not find the ['"][^'"]+['"] column|column .* does not exist|schema cache/.test(lower)) {
      return 'Staff push table/columns are out of date' + tag + '. Re-run supabase/staff-push-notifications.sql (safe to repeat), then rerun app-readiness-check.sql.';
    }
    if (code === '42501' || /row-level security|permission denied|not allowed by row-level security|staff role required/.test(lower)) {
      return 'Push subscription permission was refused' + tag + '. Sign out and sign in again with the correct staff role. If this phone was used by another staff login, re-run supabase/staff-push-notifications.sql (it adds the safe re-enrol function); otherwise ask the owner to check the staff role and subscription-table policy.';
    }
    if (code === 'PGRST202' || code === '42883') {
      return 'A push database function is missing' + tag + '. Re-run supabase/staff-push-notifications.sql, then rerun app-readiness-check.sql.';
    }
    if (name === 'NotAllowedError' || (stage === 'notification permission' && /denied|permission/.test(lower))) {
      return 'Browser notification permission was denied. Enable notifications for Mirch Masaala in browser/phone settings, then retry.';
    }
    if (stage === 'service worker registration' || stage === 'service worker ready') {
      return 'The service worker could not start. Check that service-worker.js is available at the site URL and that the browser allows service workers.';
    }
    if (stage === 'creating browser push subscription' && (name === 'InvalidAccessError' || name === 'NotSupportedError')) {
      return 'The browser rejected the Web Push key or subscription. Confirm the website public VAPID key matches the VAPID_PUBLIC_KEY configured for the push sender, then retry.';
    }
    if (stage === 'saving staff subscription' && /jwt|session.*(expired|missing)|not authenticated/.test(lower)) {
      return 'Your staff session is missing or expired. Sign out, sign in again, and enable alerts.';
    }
    if (stage === 'saving staff subscription' && /column|schema cache/.test(lower)) {
      return 'The staff push database schema is out of date' + tag + '. Re-run supabase/staff-push-notifications.sql and verify app-readiness-check.sql.';
    }
    if (name === 'AbortError') {
      return 'The browser cancelled the push subscription. Check notification permission and network access, then try again.';
    }
    return generic;
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
    var pushStage = 'notification permission';
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
      pushStage = 'service worker registration';
      var registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      pushStage = 'service worker ready';
      await navigator.serviceWorker.ready;
      var subscription = await registration.pushManager.getSubscription();
      if (subscription && !subscriptionUsesCurrentVapidKey(subscription)) {
        pushStage = 'resetting old push subscription';
        var oldSubscription = subscription;
        var unsubscribed = await oldSubscription.unsubscribe();
        if (!unsubscribed) {
          throw new Error('The old push subscription could not be reset. Remove this site subscription in browser settings and retry.');
        }
        subscription = null;
      }
      if (!subscription) {
        pushStage = 'creating browser push subscription';
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyBytes(WEB_PUSH_VAPID_PUBLIC_KEY)
        });
      }
      pushStage = 'checking staff session';
      var userResult = await client.auth.getUser();
      if (userResult.error || !userResult.data || !userResult.data.user) {
        notifyError('Your staff session expired. Sign in again, then enable alerts.');
        return false;
      }
      pushStage = 'saving staff subscription';
      var pushStaffCode = String(window.role) === 'waiter' ? (function(){ try { return String(localStorage.getItem('mm_waiter_staff_code') || '').trim().toUpperCase(); } catch(e) { return ''; } })() : '';
      var pushLanguage = window.MM_HOME_LANGUAGE === 'mr' ? 'mr' : 'en';
      var pushUserAgent = String(navigator.userAgent || '').slice(0, 400);
      // Preferred path: a database function that takes the user and role from the verified
      // session, so a phone previously used by another staff login can be re-enrolled.
      var saved = await client.rpc('mm_register_staff_push_subscription', {
        p_endpoint: subscription.endpoint,
        p_subscription: subscription.toJSON(),
        p_staff_code: pushStaffCode,
        p_preferred_language: pushLanguage,
        p_user_agent: pushUserAgent
      });
      var rpcMissing = saved.error && (String(saved.error.code || '') === 'PGRST202' ||
        String(saved.error.code || '') === '42883' ||
        /mm_register_staff_push_subscription/i.test(String(saved.error.message || '')) &&
          /could not find|does not exist/i.test(String(saved.error.message || '')));
      if (rpcMissing) {
        // Older database: the push SQL has not been re-run yet. Fall back to a direct write,
        // which still works for a phone that has only ever been used by this staff login.
        console.info('[Mirch Masaala push] mm_register_staff_push_subscription is not installed; using direct subscription write. Re-run supabase/staff-push-notifications.sql.');
        saved = await client.from('mm_staff_push_subscriptions').upsert({
          staff_user_id: userResult.data.user.id,
          target_role: String(window.role),
          staff_code: pushStaffCode,
          endpoint: subscription.endpoint,
          subscription: subscription.toJSON(),
          preferred_language: pushLanguage,
          user_agent: pushUserAgent,
          updated_at: new Date().toISOString()
        }, { onConflict: 'endpoint' });
      }
      if (saved.error) throw saved.error;
      try { localStorage.setItem('mm_push_enabled_' + String(window.role), '1'); } catch (e) {}
      notifySuccess('Push alerts enabled. This phone can alert the waiter when a guest calls, even if the app is in the background.');
      if (typeof window.MM_REFRESH_ROLE_NOTIFICATIONS === 'function') window.MM_REFRESH_ROLE_NOTIFICATIONS(true);
      return true;
    } catch (e) {
      // Log only the error category/details, never the subscription payload or auth material.
      console.error('[Mirch Masaala push setup]', {
        stage: pushStage,
        code: String(e && e.code || ''),
        name: String(e && e.name || 'Error'),
        message: String(e && e.message || '')
      });
      notifyError(describePushSetupError(e, pushStage));
      return false;
    }
  }

  // Keep each enrolled device's push language in sync with its own UI setting.
  async function updateStaffPushLanguage(language) {
    if (!client || !window.MM_SUPABASE_ENABLED || !window.role || !navigator.serviceWorker) return;
    var registration = await navigator.serviceWorker.getRegistration('./');
    if (!registration || !registration.pushManager) return;
    var subscription = await registration.pushManager.getSubscription();
    if (!subscription || !subscription.endpoint) return;
    var userResult = await client.auth.getUser();
    if (userResult.error || !userResult.data || !userResult.data.user) return;
    var update = await client.from('mm_staff_push_subscriptions')
      .update({
        preferred_language: language === 'mr' ? 'mr' : 'en',
        updated_at: new Date().toISOString()
      })
      .eq('staff_user_id', userResult.data.user.id)
      .eq('endpoint', subscription.endpoint);
    if (update.error) {
      // Report the real category; a missing column is not the only reason this can fail.
      console.info('[Mirch Masaala language] Could not sync push language: ' +
        describePushSetupError(update.error, 'saving staff subscription'));
    }
  }
  window.MM_UPDATE_STAFF_PUSH_LANGUAGE = updateStaffPushLanguage;

  function notifyCustomerOrderStatus(updated, previous) {
    if (!updated || !previous) return;
    var status = String(updated.status || '').toUpperCase();
    var approval = String(updated.approvalStatus || 'APPROVED').toUpperCase();
    var previousApproval = String(previous.approvalStatus || 'APPROVED').toUpperCase();
    var approvalChanged = approval !== previousApproval;
    if (!approvalChanged && String(updated.status) === String(previous.status)) return;

    var title = '';
    var message = '';
    if (approvalChanged && approval === 'APPROVED') {
      title = 'Order sent to kitchen';
      message = 'Your order is now in the kitchen queue.';
    } else if (approvalChanged && approval === 'REJECTED') {
      title = 'Order cancelled';
      message = 'This order was cancelled. Please ask your waiter for help.';
    } else if (status === 'READY') {
      title = 'Your order is ready';
      message = 'Your food is ready. Please check with the restaurant team.';
    } else if (status === 'PREPARING') {
      title = 'Your order is being prepared';
      message = 'The kitchen has started preparing your order.';
    } else {
      return;
    }

    if (typeof window.MM_TRANSLATE_TEXT === 'function') {
      title = window.MM_TRANSLATE_TEXT(title);
      message = window.MM_TRANSLATE_TEXT(message);
    }
    var key = 'mm_customer_status_notified_' + String(updated.id || '') + '_' + approval + '_' + status;
    try { if (localStorage.getItem(key) === '1') return; localStorage.setItem(key, '1'); } catch (e) {}
    var customerToast = 'Table ' + updated.table + ' · ' + message;
    var customerNotificationBody = 'Table ' + updated.table + ' · Ticket ' + updated.id + ' · ' + message;
    if (typeof window.MM_TRANSLATE_TEXT === 'function') {
      customerToast = window.MM_TRANSLATE_TEXT(customerToast);
      customerNotificationBody = window.MM_TRANSLATE_TEXT(customerNotificationBody);
    }
    if (typeof window.toast === 'function') window.toast(customerToast);
    if (!isMobileBrowser() && 'Notification' in window && Notification.permission === 'granted') {
      try {
        var n = new Notification(title, {
          body: customerNotificationBody,
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

      // Seating capacity is an optional UI enhancement. If its migration is pending,
      // keep the menu fully usable with the four-seat display default.
      try {
        var capacityResult = await client.from('restaurant_tables')
          .select('table_number,seating_capacity')
          .eq('restaurant_id', RESTAURANT_ID);
        if (capacityResult.error) throw capacityResult.error;
        var capacityMap = Object.create(null);
        (capacityResult.data || []).forEach(function(row) {
          if (!row || !row.table_number) return;
          var capacity = Number(row.seating_capacity);
          if (Number.isInteger(capacity) && capacity >= 1 && capacity <= 30) {
            capacityMap[String(row.table_number).padStart(2, '0')] = capacity;
          }
        });
        window.MM_TABLE_CAPACITIES = capacityMap;
        if (typeof window.renderHomeTables === 'function' &&
            document.getElementById('home') && document.getElementById('home').classList.contains('on')) {
          window.renderHomeTables();
        }
      } catch (capacityError) {
        if (!tableCapacitySetupMessageShown) {
          tableCapacitySetupMessageShown = true;
          console.info('[Mirch Masaala] Showing default four seats until the table capacity migration is applied.');
        }
      }

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

      var oldItems = (window.MENU && Array.isArray(window.MENU.menu_items)) ? window.MENU.menu_items.slice() : [];
      var oldItemsByDbId = Object.create(null);
      oldItems.forEach(function (item) {
        if (item && item.db_id) oldItemsByDbId[String(item.db_id)] = item;
      });
      var usedUiIds = Object.create(null);
      var nextCustomUiId = 10000;
      var items = (menuResult.data || []).map(function (row, index) {
        var category = categoryById[row.category_id] || { name: 'Other', slug: 'other' };
        var previous = oldItemsByDbId[String(row.id)];
        var canonicalIds = bundledMenuIdsByName[menuNameKey(row.name)] || [];
        var preferredId = previous && Number(previous.id) > 0 ? Number(previous.id) :
          (canonicalIds.length === 1 ? canonicalIds[0] : 0);
        var uiId = preferredId && !usedUiIds[String(preferredId)] ? preferredId : 0;
        while (!uiId || usedUiIds[String(uiId)]) {
          if (!usedUiIds[String(nextCustomUiId)]) uiId = nextCustomUiId;
          nextCustomUiId++;
        }
        usedUiIds[String(uiId)] = true;
        return {
          id: uiId,
          db_id: String(row.id),
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
          image: row.image_url || null,
          image_url: row.image_url || null
        };
      });

      if (!items.length) throw new Error('No menu items were returned for this restaurant. The previous menu was kept.');
      if (cats.length) window.MENU.categories = cats;
      window.MENU.menu_items = items;
      window.MM_MENU_READY = true;
      window.MM_MENU_LOAD_ERROR = false;
      reconcileStoredCarts(items);
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
      if (!window.MM_MENU_READY) window.MM_MENU_LOAD_ERROR = true;
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
      var orderColumns = 'id,ticket_id,table_id,status,approval_status,notes,total,created_at,public_token,order_number,is_test_order,is_complimentary,complimentary_reason,cancel_reason,archived_at,updated_at';
      async function fetchOrderRows(columns) {
        // Always fetch every active kitchen ticket even if more than 100 newer history rows exist.
        return await Promise.all([
          client.from('orders').select(columns)
            .eq('restaurant_id', RESTAURANT_ID)
            .order('created_at', { ascending: false }).limit(100),
          client.from('orders').select(columns)
            .eq('restaurant_id', RESTAURANT_ID)
            .in('status', ['NEW','PREPARING','READY'])
            .is('archived_at', null)
            .order('created_at', { ascending: false })
        ]);
      }
      var fetches = await fetchOrderRows(orderColumns);
      var approvalColumnMissing = fetches.some(function (q) {
        return q.error && /approval_status/i.test(String(q.error.message || '') + ' ' + String(q.error.details || ''));
      });
      if (approvalColumnMissing) {
        // Do not silently treat guest orders as approved: that made the owner queue falsely show zero.
        var setupError = new Error('OWNER_APPROVAL_SETUP_REQUIRED: Run the latest supabase/visit-service-controls.sql in Supabase SQL Editor, then refresh the app.');
        setupError.code = 'OWNER_APPROVAL_SETUP_REQUIRED';
        throw setupError;
      }
      if (fetches[0].error) throw fetches[0].error;
      if (fetches[1].error) throw fetches[1].error;
      window.MM_ORDER_APPROVAL_SCHEMA_READY = true;
      window.MM_ORDER_APPROVAL_SETUP_ERROR = '';
      var rowsById = Object.create(null);
      (fetches[0].data || []).concat(fetches[1].data || []).forEach(function (row) {
        if (row && row.id) rowsById[String(row.id)] = row;
      });
      var rows = Object.keys(rowsById).map(function (id) { return rowsById[id]; })
        .sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
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
        client.from('order_items').select('order_id,item_name,quantity,price,notes,spice_level').in('order_id', ids)
      ]);
      if (tableResult.error) throw tableResult.error;
      if (itemResult.error && /spice_level|column/i.test(String(itemResult.error.message || ''))) {
        itemResult = await client.from('order_items').select('order_id,item_name,quantity,price,notes').in('order_id', ids);
      }
      if (itemResult.error) throw itemResult.error;
      var tableRows = tableResult.data || [];
      var itemsByOrder = {};
      (itemResult.data || []).forEach(function (item) {
        if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
        itemsByOrder[item.order_id].push({
          name: item.item_name,
          price: Number(item.price) || 0,
          qty: Number(item.quantity) || 1,
          notes: item.notes || '',
          spiceLevel: item.spice_level || 'normal'
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
          approvalStatus: String(row.approval_status || 'APPROVED').toUpperCase(),
          notes: row.notes || '',
          createdAt: row.created_at,
          orderNumber: row.order_number,
          is_test_order: !!row.is_test_order,
          is_complimentary: !!row.is_complimentary,
          complimentary_reason: row.complimentary_reason || '',
          cancel_reason: row.cancel_reason || '',
          archived_at: row.archived_at || null
        };
      });
      try { localStorage.setItem('mm_o', JSON.stringify(window.orders)); } catch (e) {}
      if (document.getElementById('admin') && document.getElementById('admin').classList.contains('on') && window.role === 'admin' && typeof window.drawAdminOrders === 'function') window.drawAdminOrders();
      if (document.getElementById('kitchen') && document.getElementById('kitchen').classList.contains('on') && (window.role === 'kitchen' || window.role === 'admin') && typeof window.drawK === 'function') window.drawK();
      if (document.getElementById('waiter') && document.getElementById('waiter').classList.contains('on') && typeof window.drawWaiterOrders === 'function') window.drawWaiterOrders();
      if (document.getElementById('success') && document.getElementById('success').classList.contains('on') && typeof window.refreshProgressViews === 'function') window.refreshProgressViews();
      var accountsHost = document.getElementById('a-stats');
      if (window.role === 'admin' && document.getElementById('admin') &&
          document.getElementById('admin').classList.contains('on') && accountsHost &&
          accountsHost.style.display !== 'none' && typeof window.refreshAdminAccountsSummary === 'function') {
        window.refreshAdminAccountsSummary();
      }
    } catch (e) {
      var errText = String(e && e.message || e || 'Order sync failed.');
      if (errText.indexOf('OWNER_APPROVAL_SETUP_REQUIRED') >= 0 || /approval_status/i.test(errText)) {
        window.MM_ORDER_APPROVAL_SCHEMA_READY = false;
        window.MM_ORDER_APPROVAL_SETUP_ERROR = 'Order database setup is incomplete. Apply the required visit migrations and supabase/direct-kitchen-qr-orders.sql as documented in README.md, then refresh.';
        if (!window.MM_ORDER_APPROVAL_SETUP_NOTIFIED) {
          window.MM_ORDER_APPROVAL_SETUP_NOTIFIED = true;
          notifyError(window.MM_ORDER_APPROVAL_SETUP_ERROR);
        }
        console.error('[Mirch Masaala owner approval setup]', e);
        if (document.getElementById('admin') && document.getElementById('admin').classList.contains('on') &&
            window.role === 'admin' && typeof window.drawAdminOrders === 'function') window.drawAdminOrders();
      } else {
        notifyError('Order sync failed. Check staff account permissions in Supabase.');
        console.error('[Mirch Masaala order sync]', e);
      }
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
      // The token list is capped at 15, so refresh every ticket we still show in Track my orders.
      for (var i = 0; i < tokens.length; i++) {
        var saved = tokens[i];
        if (!saved || !saved.id || !saved.token) continue;
        var result = await client.rpc('mm_get_public_order', {
          p_ticket_id: saved.id,
          p_public_token: saved.token
        });
        if (result.error) throw result.error;
        var remote = rpcPayload(result.data);
        if (!remote) continue;
        // Reload after the network request so an older response cannot overwrite a completed cancellation.
        try {
          var latestOrders = JSON.parse(localStorage.getItem('mm_o') || '[]');
          if (Array.isArray(latestOrders)) savedOrders = latestOrders;
        } catch (e) {}
        var current = (savedOrders || []).find(function (o) { return o && String(o.id) === String(saved.id); });
        var remoteStatus = String(remote.status || 'NEW').toUpperCase();
        var remoteApprovalStatus = String(remote.approvalStatus || remote.approval_status || (current && current.approvalStatus) || 'APPROVED').toUpperCase();
        var customerCancelConfirmed = !!(current && current.customerCancelConfirmed);
        if (customerCancelConfirmed && remoteStatus !== 'CANCELLED') remoteStatus = 'CANCELLED';
        var updated = {
          id: remote.id,
          table: String(remote.table || (current && current.table) || '01').padStart(2, '0'),
          items: remote.items || (current && current.items) || [],
          total: Number(remote.total) || 0,
          status: remoteStatus,
          approvalStatus: remoteApprovalStatus,
          notes: remote.notes || '',
          createdAt: remote.createdAt || (current && current.createdAt) || new Date().toISOString(),
          cancelUntil: current && current.cancelUntil,
          publicToken: saved.token,
          customerCancelConfirmed: customerCancelConfirmed
        };
        if (current &&
            (String(current.status || '').toUpperCase() !== updated.status ||
             String(current.approvalStatus || 'APPROVED').toUpperCase() !== updated.approvalStatus) &&
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


  async function cancelCustomerOrder(ticketId) {
    var id = String(ticketId || '');
    if (!client || !window.MM_SUPABASE_ENABLED) {
      throw new Error('The live database is not connected. Please refresh and try again.');
    }
    var tokens = [];
    try { tokens = JSON.parse(localStorage.getItem('mm_live_order_tokens') || '[]') || []; } catch (e) {}
    if (!Array.isArray(tokens)) tokens = [];
    var ticket = tokens.find(function (entry) {
      return entry && String(entry.id) === id && entry.token;
    });
    if (!ticket) {
      throw new Error('This device cannot verify the order. Please use the device where you placed it or ask your waiter.');
    }
    var result = await client.rpc('mm_cancel_public_order', {
      p_ticket_id: id,
      p_public_token: ticket.token
    });
    if (result.error) throw new Error(result.error.message || 'Could not cancel the order. Please ask your waiter.');
    var confirmation = rpcPayload(result.data);
    if (!confirmation || String(confirmation.status || '').toUpperCase() !== 'CANCELLED') {
      throw new Error('The server did not confirm cancellation. Please refresh and check the order status.');
    }
    var storedOrders = [];
    try { storedOrders = JSON.parse(localStorage.getItem('mm_o') || '[]') || []; } catch (e) {}
    if (!Array.isArray(storedOrders)) storedOrders = [];
    var working = Array.isArray(window.orders) ? window.orders.slice() : storedOrders.slice();
    var index = working.findIndex(function (o) { return o && String(o.id) === id; });
    var previous = index >= 0 ? working[index] : (storedOrders.find(function (o) { return o && String(o.id) === id; }) || {});
    var cancelled = Object.assign({}, previous, {
      id: id,
      status: 'CANCELLED',
      customerCancelConfirmed: true,
      cancelledAt: confirmation.cancelledAt || new Date().toISOString()
    });
    if (confirmation.table) cancelled.table = String(confirmation.table).padStart(2, '0');
    if (index >= 0) working[index] = cancelled;
    else working.unshift(cancelled);
    window.orders = working;
    try { localStorage.setItem('mm_o', JSON.stringify(working)); } catch (e) {}
    if (typeof window.refreshProgressViews === 'function') window.refreshProgressViews();
    if (typeof window.renderCustomerHomeOrders === 'function') window.renderCustomerHomeOrders();
    refreshPublicOrderBoard();
    refreshCustomerOrders();
    return cancelled;
  }

  function findMenuItemForCartItem(cartItem, items) {
    cartItem = cartItem || {};
    items = items || (window.MENU && window.MENU.menu_items) || [];
    if (cartItem.db_id) {
      var byDbId = items.find(function (item) {
        return item && item.db_id && String(item.db_id) === String(cartItem.db_id);
      });
      if (byDbId) return byDbId;
    }

    var key = menuNameKey(cartItem.name);
    if (!key) return null;
    var sameName = items.filter(function (item) {
      return item && menuNameKey(item.name) === key && item.db_id;
    });
    if (sameName.length === 1) return sameName[0];
    if (sameName.length > 1) {
      var sameNameAndUiId = sameName.filter(function (item) {
        return String(item.id) === String(cartItem.id);
      });
      if (sameNameAndUiId.length === 1) return sameNameAndUiId[0];
    }
    // Never match by numeric UI ID alone: it can refer to a different dish
    // after a live-menu refresh or when older cart data is restored.
    return null;
  }

  function rebindCartItems(cartItems, items) {
    if (!Array.isArray(cartItems)) return [];
    return cartItems.map(function (cartItem) {
      var match = findMenuItemForCartItem(cartItem, items);
      if (!match) return Object.assign({}, cartItem);
      return Object.assign({}, cartItem, {
        id: match.id,
        db_id: String(match.db_id),
        name: match.name,
        price: Number(match.price) || 0
      });
    });
  }

  function reconcileStoredCarts(items) {
    var maxTable = 20;
    ((window.MENU && window.MENU.tables) || []).forEach(function (row) {
      var n = parseInt(row.number || row.table_number || row.id, 10);
      if (Number.isFinite(n) && n > maxTable && n <= 200) maxTable = n;
    });
    var changed = false;
    try {
      for (var n = 1; n <= maxTable; n++) {
        var tableKey = String(n).padStart(2, '0');
        var storageKey = 'mm_c_' + tableKey;
        var raw = localStorage.getItem(storageKey);
        if (!raw) continue;
        var saved;
        try { saved = JSON.parse(raw); } catch (parseError) { continue; }
        if (!Array.isArray(saved) || !saved.length) continue;
        var remapped = rebindCartItems(saved, items);
        if (JSON.stringify(saved) !== JSON.stringify(remapped)) {
          localStorage.setItem(storageKey, JSON.stringify(remapped));
          changed = true;
        }
      }
    } catch (e) {
      console.info('[Mirch Masaala] Saved cart reconciliation skipped:', e && e.message ? e.message : e);
    }

    if (Array.isArray(window.cart)) {
      var activeCart = rebindCartItems(window.cart, items);
      if (JSON.stringify(window.cart) !== JSON.stringify(activeCart)) {
        window.cart = activeCart;
        try { localStorage.setItem('mm_c_' + String(window.table || '01').padStart(2, '0'), JSON.stringify(activeCart)); } catch (e) {}
        changed = true;
      }
    }
    if (Array.isArray(window.wCart)) {
      var waiterCart = rebindCartItems(window.wCart, items);
      if (JSON.stringify(window.wCart) !== JSON.stringify(waiterCart)) {
        window.wCart = waiterCart;
        if (window.wTable && window.wDrafts) {
          window.wDrafts[String(window.wTable)] = waiterCart.map(function (item) { return Object.assign({}, item); });
        }
        changed = true;
      }
    }
    if (!changed) return;
    try {
      if (typeof window.drawMenu === 'function') window.drawMenu();
      if (typeof window.updCart === 'function') window.updCart();
      var cartDrawer = document.getElementById('cart');
      if (cartDrawer && cartDrawer.classList.contains('on') && typeof window.drawCart === 'function') window.drawCart();
      if (typeof window.wMenu === 'function') window.wMenu();
      if (typeof window.wDrawCart === 'function') window.wDrawCart();
    } catch (e) {
      console.info('[Mirch Masaala] Cart refresh after menu update skipped:', e && e.message ? e.message : e);
    }
  }

  function buildOrderItems(cartItems) {
    return (cartItems || []).map(function (cartItem) {
      var item = findMenuItemForCartItem(cartItem);
      if (!item || !item.db_id) {
        throw new Error(window.mmI18n
          ? window.mmI18n(
              'A dish in your cart no longer matches the current menu. Please go back to the menu and add it again.',
              'तुमच्या कार्टमधील एक पदार्थ सध्याच्या मेनूमध्ये जुळत नाही. कृपया मेनूमध्ये परत जाऊन तो पदार्थ पुन्हा जोडा.'
            )
          : 'A dish in your cart no longer matches the current menu. Please re-add it from the menu.');
      }
      var spice = String(cartItem.spiceLevel || 'normal').toLowerCase();
      if (['normal','mild','medium','hot'].indexOf(spice) < 0) spice = 'normal';
      var itemNotes = String(cartItem.notes || '').trim();
      if (itemNotes.length > 300) throw new Error('Per-dish notes must be 300 characters or fewer.');
      return { menu_item_id: item.db_id, quantity: Number(cartItem.qty) || 1, spice_level: spice, notes: itemNotes };
    });
  }

  var tableVisitRefreshBusy = false;
  var tableVisitSetupMessageShown = false;

  async function refreshTableVisits() {
    if (tableVisitRefreshBusy || !client || !window.MM_SUPABASE_ENABLED ||
        ['admin', 'waiter'].indexOf(String(window.role || '')) < 0) return;
    tableVisitRefreshBusy = true;
    try {
      var result = await client.rpc('mm_staff_get_table_visits');
      if (result.error) throw result.error;
      var rows = Array.isArray(result.data) ? result.data : [];
      var map = Object.create(null);
      rows.forEach(function (row) {
        if (!row || !row.table_number) return;
        var number = String(row.table_number).padStart(2, '0');
        map[number] = {
          table_number: number,
          status: String(row.status || 'AVAILABLE').toUpperCase(),
          started_at: row.started_at || null,
          visit_id: row.visit_id || null,
          assigned_waiter_code: String(row.assigned_waiter_code || ''),
          guest_order_code: String(row.guest_order_code || '')
        };
      });
      window.MM_TABLE_VISITS = map;
      window.MM_TABLE_VISITS_READY = true;
      if (typeof window.updateWaiterTableIndicators === 'function') window.updateWaiterTableIndicators();
      if (typeof window.renderWaiterVisitControl === 'function') window.renderWaiterVisitControl();
    } catch (e) {
      window.MM_TABLE_VISITS_READY = false;
      if (!tableVisitSetupMessageShown) {
        tableVisitSetupMessageShown = true;
        console.info('[Mirch Masaala table visits] Apply supabase/table-visits.sql in Supabase SQL Editor to enable persistent table visit status.', e && e.message ? e.message : e);
      }
    } finally {
      tableVisitRefreshBusy = false;
    }
  }

  async function ensurePublicTableVisit(tableNumber) {
    if (!client || !window.MM_SUPABASE_ENABLED) {
      throw new Error('Online table ordering is not connected. Please ask staff for help.');
    }
    var result = await client.rpc('mm_ensure_public_table_visit', {
      p_table_number: String(tableNumber || '').padStart(2, '0')
    });
    if (result.error) {
      var detail = String(result.error.message || '');
      if (result.error.code === 'PGRST202' || result.error.code === '42883' ||
          /mm_ensure_public_table_visit/i.test(detail)) {
        throw new Error('Table-order protection is not activated yet. Please ask the owner to finish the table visit setup.');
      }
      if (/not open for online orders/i.test(detail)) {
        throw new Error('This table is not open for ordering yet. Please ask your waiter to start the visit.');
      }
      throw new Error(detail || 'Could not verify that this table is open. Please ask your waiter.');
    }
    var visit = rpcPayload(result.data);
    if (!visit || !visit.visit_id) {
      throw new Error('This table is not open for online ordering yet. Please ask your waiter to start the visit.');
    }
    if (['admin', 'waiter'].indexOf(String(window.role || '')) >= 0) await refreshTableVisits();
    return visit;
  }

  function customerSessionIdForVisit(visitId) {
    var visitKey = String(visitId || '').trim();
    if (!visitKey) throw new Error('The active table visit is missing. Refresh and try again.');
    var key = 'mm_customer_session_' + visitKey;
    var value = '';
    try { value = String(localStorage.getItem(key) || ''); } catch (e) {}
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        value = window.crypto.randomUUID();
      } else {
        value = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
      }
      try { localStorage.setItem(key, value); } catch (e) {}
    }
    return value;
  }

  async function setTableCapacity(tableNumber, capacity) {
    var result = await ownerRpc('mm_admin_set_table_capacity', {
      p_table_number: String(tableNumber || ''),
      p_capacity: Number(capacity)
    });
    window.MM_TABLE_CAPACITIES = window.MM_TABLE_CAPACITIES || {};
    window.MM_TABLE_CAPACITIES[String(result.table_number || tableNumber).padStart(2, '0')] = Number(result.seating_capacity || capacity);
    if (typeof window.renderHomeTables === 'function') window.renderHomeTables();
    return result;
  }

  async function setTableVisitStatus(tableNumber, action, waiterCode) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('The shared database is not connected.');
    if (['admin', 'waiter'].indexOf(String(window.role || '')) < 0) {
      throw new Error('Sign in as the owner or waiter to manage table visits.');
    }
    var result = await client.rpc('mm_staff_set_table_visit_status', {
      p_table_number: String(tableNumber || '').padStart(2, '0'),
      p_action: String(action || '').toUpperCase(),
      p_waiter_code: waiterCode ? String(waiterCode).trim().toUpperCase() : null
    });
    if (result.error) throw new Error(result.error.message || 'Could not update the table visit.');
    await refreshTableVisits();
    if (typeof window.drawWaiterOrders === 'function') window.drawWaiterOrders();
    return result.data;
  }

  async function releaseAbandonedVisit(tableNumber, reason) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('The shared database is not connected.');
    if (['admin', 'waiter'].indexOf(String(window.role || '')) < 0) {
      throw new Error('Only signed-in owner or waiter staff can release a table.');
    }
    var result = await client.rpc('mm_staff_release_abandoned_visit', {
      p_table_number: String(tableNumber || '').padStart(2, '0'),
      p_reason: String(reason || 'Guest left before checkout').slice(0, 200)
    });
    if (result.error) throw new Error(result.error.message || 'Could not release this table.');
    var data = rpcPayload(result.data) || {};
    dispatchStaffPushForGuestRequest(data);
    await refreshTableVisits();
    await refreshStaffOrders();
    if (typeof window.MM_REFRESH_ROLE_NOTIFICATIONS === 'function') {
      window.MM_REFRESH_ROLE_NOTIFICATIONS(true);
    }
    return data;
  }

  async function createSharedOrder(tableNumber, cartItems, notes) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected yet. Please refresh and try again.');
    var actorRole = String(window.role || '');
    var visit = await ensurePublicTableVisit(tableNumber);
    if (!visit || !visit.visit_id) {
      throw new Error('This table is not open for ordering yet. Please ask your waiter to start the visit.');
    }
    // Each guest phone has a separate session ID tied to the current visit.
    var customerSessionId = !actorRole ? customerSessionIdForVisit(visit.visit_id) : null;

    var ticket = window.makeTicketId(tableNumber, new Date());
    var payload = buildOrderItems(cartItems);
    var orderArgs = {
      p_restaurant_id: RESTAURANT_ID,
      p_table_number: String(tableNumber).padStart(2, '0'),
      p_ticket_id: ticket,
      p_notes: String(notes || '').slice(0, 1000),
      p_items: payload,
      p_table_visit_id: visit.visit_id,
      p_customer_session_id: customerSessionId,
      p_guest_order_code: null
    };
    var result = await client.rpc('mm_place_order', orderArgs);
    if (result.error) {
      var placeError = result.error;
      var placeMessage = String(placeError.message || '');
      if (!actorRole && /p_guest_order_code|mm_place_order/i.test(placeMessage) &&
          (placeError.code === 'PGRST202' || placeError.code === '42883')) {
        throw new Error('Secure table ordering is not activated yet. Please ask the owner to finish the table setup.');
      }
      throw placeError;
    }
    var created = rpcPayload(result.data);
    if (!created || !created.id || !created.publicToken || !created.visitId) {
      throw new Error('Supabase did not confirm the new order and table visit. Please refresh and check My Orders before trying again.');
    }
    /* Kitchen receives an in-app NEW_ORDER alert from the database insert trigger. No owner order push is dispatched. */
    if (!actorRole) {
      try {
        localStorage.setItem('mm_customer_active_visit_id', String(created.visitId));
        localStorage.setItem('mm_customer_active_session_id', String(customerSessionId));
        localStorage.setItem('mm_customer_active_table', String(created.table || tableNumber).padStart(2, '0'));
      } catch (storageError) {
        console.info('[Mirch Masaala] The active table session could not be saved on this phone.');
      }
    }
    storePublicToken(created.id, created.publicToken);
    return {
      id: created.id,
      dbId: created.dbId,
      publicToken: created.publicToken,
      table: String(created.table || tableNumber).padStart(2, '0'),
      visitId: created.visitId || null,
      customerSessionId: created.customerSessionId || customerSessionId || null,
      items: created.items || [],
      total: Number(created.total) || 0,
      status: String(created.status || 'NEW').toUpperCase(),
      approvalStatus: String(created.approvalStatus || created.approval_status || 'APPROVED').toUpperCase(),
      notes: created.notes || '',
      createdAt: created.createdAt || new Date().toISOString(),
      orderNumber: created.orderNumber,
      cancelUntil: Date.now() + (7 * 60 * 1000)
    };
  }

  async function placeCustomerOrder() {
    if (window.MM_ORDER_SENDING) return;
    if (!window.cart || !window.cart.length) return;
    if (!window.MM_MENU_READY) {
      notifyError(window.MM_MENU_LOAD_ERROR
        ? (window.mmI18n ? window.mmI18n('The restaurant menu could not load. Check your connection and refresh.', 'रेस्टॉरंटचा मेनू लोड झाला नाही. इंटरनेट तपासून पेज पुन्हा उघडा.') : 'The restaurant menu could not load. Refresh and try again.')
        : (window.mmI18n ? window.mmI18n('Loading the latest restaurant menu. Please wait a moment and try again.', 'अद्ययावत मेनू लोड होत आहे. कृपया थोडा वेळ थांबून पुन्हा प्रयत्न करा.') : 'Loading the latest restaurant menu. Please wait and try again.'));
      return;
    }
    window.MM_ORDER_SENDING = true;
    var originalCart = window.cart.slice();
    var notesEl = document.getElementById('notes');
    var noteText = notesEl ? notesEl.value.trim() : '';
    var orderButton = document.getElementById('place-order-button');
    if (orderButton) {
      orderButton.disabled = true;
      orderButton.textContent = window.mmI18n ? window.mmI18n('Sending order…','ऑर्डर पाठवत आहे…') : 'Sending order…';
    }
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
      if (host) host.innerHTML = window.progressMarkup(order) + '<p class="waiting-joke" id="waiting-joke">Your order is confirmed and sent directly to the kitchen. No approval is needed.</p>';
      if (typeof window.startWaitFun === 'function') window.startWaitFun(order.id);
      if (typeof window.confetti === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) window.confetti({ particleCount: 60, spread: 80, origin: { y: 0.6 } });
      notifySuccess('Your order is confirmed and sent directly to the kitchen. No approval is needed.');
      refreshCustomerOrders();
    } catch (e) {
      notifyError(window.mmFriendlyError ? window.mmFriendlyError(e, 'customer-order') : (e && e.message ? e.message : 'Could not send the order. Please ask your waiter.'));
    } finally {
      window.MM_ORDER_SENDING = false;
      if (orderButton) {
        orderButton.disabled = false;
        orderButton.textContent = window.mmI18n ? window.mmI18n('Place order','ऑर्डर द्या') : 'Place order';
      }
    }
  }

  async function sendWaiterOrder() {
    if (window.MM_ORDER_SENDING) return;
    if (!window.MM_MENU_READY) {
      notifyError(window.mmI18n
        ? window.mmI18n('The latest menu is still loading. Please wait and try again.', 'अद्ययावत मेनू अजून लोड होत आहे. कृपया थांबून पुन्हा प्रयत्न करा.')
        : 'The latest menu is still loading. Please wait and try again.');
      return;
    }
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
      notifyError(window.mmFriendlyError ? window.mmFriendlyError(e, 'waiter-order') : (e && e.message ? e.message : 'Could not send the waiter order.'));
    } finally {
      window.MM_ORDER_SENDING = false;
    }
  }


  function assertOwner() {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('The shared database is not connected.');
    if (window.role !== 'admin') throw new Error('Owner/Admin access required.');
  }

  async function ownerRpc(name, args) {
    assertOwner();
    var result = await client.rpc(name, args || {});
    if (result.error) throw new Error(result.error.message || 'The requested owner action failed.');
    return rpcPayload(result.data);
  }

  async function previewTableCleanup(tableNumber) {
    return ownerRpc('mm_admin_preview_table_cleanup', { p_table_number: String(tableNumber || '') });
  }

  async function clearTableOrders(tableNumber, reason, expectedCount, expectedFingerprint) {
    var data = await ownerRpc('mm_admin_clear_table_orders', {
      p_table_number: String(tableNumber || ''),
      p_reason: String(reason || '').slice(0, 240),
      p_expected_count: Number(expectedCount),
      p_expected_fingerprint: String(expectedFingerprint || '')
    });
    await refreshStaffOrders();
    await refreshPublicOrderBoard();
    if (typeof window.refreshProgressViews === 'function') window.refreshProgressViews();
    return data;
  }

  async function cancelAdminOrder(ticketId, reason) {
    var data = await ownerRpc('mm_admin_cancel_order', {
      p_ticket_id: String(ticketId || ''),
      p_reason: String(reason || '').slice(0, 240)
    });
    await refreshStaffOrders();
    await refreshPublicOrderBoard();
    if (typeof window.refreshProgressViews === 'function') window.refreshProgressViews();
    return data;
  }

  async function setOrderComplimentary(ticketId, isComplimentary, reason) {
    var data = await ownerRpc('mm_admin_set_complimentary', {
      p_ticket_id: String(ticketId || ''),
      p_is_complimentary: !!isComplimentary,
      p_reason: String(reason || '').slice(0, 240)
    });
    await refreshStaffOrders();
    if (typeof window.refreshProgressViews === 'function') window.refreshProgressViews();
    return data;
  }

  async function getPublicTableBill(tableNumber) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('The shared database is not connected.');
    var result = await client.rpc('mm_get_public_table_bill', {
      p_table_number: String(tableNumber || '')
    });
    if (result.error) throw new Error(result.error.message || 'Could not calculate the current table balance.');
    return rpcPayload(result.data);
  }

  async function getPublicVisitBill(tableNumber, visitId, customerSessionId) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('The shared database is not connected.');
    if (!visitId || !customerSessionId) throw new Error('This phone is not linked to an active table visit. Please ask staff for the bill.');
    var result = await client.rpc('mm_guest_get_visit_bill', {
      p_table_number: String(tableNumber || '').padStart(2, '0'),
      p_visit_id: String(visitId),
      p_customer_session_id: String(customerSessionId)
    });
    if (result.error) throw new Error(result.error.message || 'Could not calculate this visit’s balance.');
    return rpcPayload(result.data);
  }

  async function getStaffVisitBill(visitId) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('The shared database is not connected.');
    if (['admin', 'waiter'].indexOf(String(window.role || '')) < 0) throw new Error('Sign in as owner or counter staff first.');
    var result = await client.rpc('mm_staff_get_visit_bill', { p_visit_id: String(visitId || '') });
    if (result.error) throw new Error(result.error.message || 'Could not load the bill for that visit.');
    return rpcPayload(result.data);
  }

  async function requestCashCounterRelease(tableNumber, visitId, customerSessionId) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('The shared database is not connected.');
    var result = await client.rpc('mm_guest_cash_counter_release', {
      p_table_number: String(tableNumber || '').padStart(2, '0'),
      p_visit_id: String(visitId || ''),
      p_customer_session_id: String(customerSessionId || '')
    });
    if (result.error) {
      var detail = String(result.error.message || '');
      if (result.error.code === 'PGRST202' || result.error.code === '42883' || /mm_guest_cash_counter_release/i.test(detail)) {
        throw new Error('Cash checkout is not activated on the restaurant system yet. Please tell the waiter you will pay at the counter.');
      }
      throw new Error(detail || 'Could not release the table just now. Please ask the waiter.');
    }
    var data = rpcPayload(result.data) || {};
    dispatchStaffPushForGuestRequest(data);
    return data;
  }



  async function recordVisitPayment(visitId, amount, method, note) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('The shared database is not connected.');
    if (String(window.role || '') !== 'admin') {
      throw new Error('Only the Owner/Counter using the Admin login can confirm and record payment. Please direct the guest to the counter.');
    }
    var result = await client.rpc('mm_staff_record_visit_payment', {
      p_visit_id: String(visitId || ''),
      p_amount: Number(amount),
      p_method: String(method || 'other'),
      p_note: String(note || '').slice(0, 500)
    });
    if (result.error) throw new Error(result.error.message || 'Could not record the payment for this visit.');
    var data = rpcPayload(result.data);
    await refreshStaffOrders();
    await refreshRoleNotifications();
    await refreshTableVisits();
    if (typeof window.refreshProgressViews === 'function') window.refreshProgressViews();
    return data;
  }

  async function recordTablePayment(tableNumber, amount, method, note) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('The shared database is not connected.');
    if (String(window.role || '') !== 'admin') {
      throw new Error('Only the Owner/Counter using the Admin login can confirm and record payment.');
    }
    var result = await client.rpc('mm_staff_record_table_payment', {
      p_table_number: String(tableNumber || ''),
      p_amount: Number(amount),
      p_method: String(method || 'other'),
      p_note: String(note || '').slice(0, 500)
    });
    if (result.error) throw new Error(result.error.message || 'Could not record the payment.');
    var data = rpcPayload(result.data);
    await refreshStaffOrders();
    if (typeof window.refreshProgressViews === 'function') window.refreshProgressViews();
    return data;
  }

  async function getAdminOrderDetails(ticketId) {
    assertOwner();
    var result = await client.rpc('mm_admin_get_order_details', {
      p_ticket_id: String(ticketId || '').trim().slice(0, 64)
    });
    if (result.error) throw new Error(result.error.message || 'Could not load that order.');
    var details = rpcPayload(result.data);
    if (!details || !details.ticket_id) throw new Error('No ticket details were returned.');
    return details;
  }

  async function loadAdminAccountsSummary(day) {
    assertOwner();
    var result = await client.rpc('mm_admin_accounts_summary', { p_day: day || null });
    if (result.error) throw new Error(result.error.message || 'Could not load the shared accounts summary.');
    return rpcPayload(result.data);
  }

  async function loadAdminPayments() {
    assertOwner();
    var result = await client.from('order_payments')
      .select('id,ticket_id,table_number,amount,method,note,created_at')
      .eq('restaurant_id', RESTAURANT_ID)
      .order('created_at', { ascending: false })
      .limit(100);
    if (result.error) throw new Error(result.error.message || 'Could not load the shared payment log.');
    return result.data || [];
  }


  async function reviewCustomerOrder(ticketId, decision) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared order approval is not connected. Apply supabase/visit-service-controls.sql in Supabase, then refresh.');
    if (String(window.role || '') !== 'admin') throw new Error('Only the Owner/Admin can approve or reject customer orders.');
    var choice = String(decision || '').toUpperCase();
    if (choice !== 'APPROVE' && choice !== 'REJECT') throw new Error('Choose Approve or Reject.');
    var result = await client.rpc('mm_admin_review_customer_order', {
      p_ticket_id: String(ticketId || ''),
      p_decision: choice,
      p_reason: ''
    });
    if (result.error) throw new Error(result.error.message || 'Could not update the order approval.');
    var saved = rpcPayload(result.data);
    if (!saved || !saved.id || !saved.approvalStatus) throw new Error('The server did not confirm the approval. Refresh and check the order.');
    await refreshStaffOrders();
    await refreshRoleNotifications(true);
    await refreshPublicOrderBoard();
    if (typeof window.refreshProgressViews === 'function') window.refreshProgressViews();
    notifySuccess(choice === 'APPROVE' ? 'Order approved · kitchen notified.' : 'Order rejected · customer status updated.');
    return saved;
  }

  async function setSharedOrderStatus(ticketId, status) {
    var actor = String(window.role || '');
    var nextStatus = String(status || '').toUpperCase();
    if (!client || ['admin', 'waiter', 'kitchen'].indexOf(actor) < 0) {
      notifyError('Please sign in with your staff account first.');
      return;
    }
    var permitted = actor === 'admin'
      ? ['NEW', 'PREPARING', 'READY', 'SERVED'].indexOf(nextStatus) >= 0
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
        .eq('ticket_id', ticketId)
        .select('ticket_id,status').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data || String(result.data.status || '').toUpperCase() !== nextStatus) {
        throw new Error('The order was not updated. It may have changed or been archived; refresh the queue.');
      }
      await refreshStaffOrders();
      await refreshPublicOrderBoard();
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
        .eq('restaurant_id', RESTAURANT_ID).eq('id', item.db_id)
        .select('id,price').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data || Number(result.data.price) !== Math.round(price)) {
        throw new Error('No menu row was updated. Refresh the menu and try again.');
      }
      item.price = Math.round(result.data.price);
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
        .eq('restaurant_id', RESTAURANT_ID).eq('id', item.db_id)
        .select('id,is_available').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data || result.data.is_available !== next) {
        throw new Error('No menu row was updated. Refresh the menu and try again.');
      }
      item.is_available = result.data.is_available;
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

  // Owner-managed waiter directory and maintenance operations. These RPCs are separate from
  // optional alert/WhatsApp migrations, so missing notification tables do not block setup.
  async function listWaiters(includeInactive) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected.');
    if (['admin','waiter'].indexOf(String(window.role || '')) < 0) throw new Error('Staff sign-in required.');
    var result = await client.rpc('mm_list_waiters', { p_include_inactive: !!includeInactive });
    if (result.error) throw new Error(result.error.message || 'Waiter names are not set up yet.');
    var rows = Array.isArray(result.data) ? result.data : [];
    window.MM_WAITER_DIRECTORY = rows;
    return rows;
  }

  async function saveWaiterDirectoryEntry(displayName, waiterCode) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected.');
    if (window.role !== 'admin') throw new Error('Only the Owner/Admin can manage waiter names.');
    var result = await client.rpc('mm_admin_save_waiter', {
      p_display_name: String(displayName || '').trim(),
      p_waiter_code: waiterCode ? String(waiterCode).trim().toUpperCase() : null
    });
    if (result.error) throw new Error(result.error.message || 'Could not save the waiter name.');
    var saved = rpcPayload(result.data);
    await listWaiters(true);
    return saved;
  }

  async function setWaiterDirectoryActive(waiterCode, isActive) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected.');
    if (window.role !== 'admin') throw new Error('Only the Owner/Admin can manage waiter names.');
    var result = await client.rpc('mm_admin_set_waiter_active', {
      p_waiter_code: String(waiterCode || '').trim().toUpperCase(),
      p_active: !!isActive
    });
    if (result.error) throw new Error(result.error.message || 'Could not update this waiter.');
    var saved = rpcPayload(result.data);
    await listWaiters(true);
    return saved;
  }

  async function exportOwnerBackup() {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected.');
    if (window.role !== 'admin') throw new Error('Only the Owner/Admin can create a backup.');
    var result = await client.rpc('mm_admin_export_backup');
    if (result.error) throw new Error(result.error.message || 'Backup export failed.');
    var payload = rpcPayload(result.data);
    if (!payload || !payload.data || !payload.restaurant_id) throw new Error('The backup response was incomplete. No reset was started.');
    return payload;
  }

  async function recordOwnerBackupExport() {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected.');
    if (window.role !== 'admin') throw new Error('Owner/Admin access required.');
    var result = await client.rpc('mm_admin_record_backup_export');
    if (result.error) throw new Error(result.error.message || 'The downloaded backup could not be recorded.');
    return rpcPayload(result.data);
  }

  async function loadOwnerMaintenanceStatus() {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected.');
    if (window.role !== 'admin') throw new Error('Owner/Admin access required.');
    var result = await client.rpc('mm_admin_maintenance_status');
    if (result.error) throw new Error(result.error.message || 'Owner backup status is unavailable.');
    return rpcPayload(result.data) || {};
  }

  async function resetOwnerBusinessData(backupMade) {
    if (!client || !window.MM_SUPABASE_ENABLED) throw new Error('Shared database is not connected.');
    if (window.role !== 'admin') throw new Error('Only the Owner/Admin can reset restaurant data.');
    var result = await client.rpc('mm_admin_reset_business_data', {
      p_confirmation: 'RESET MIRCH MASAALA',
      p_backup_made: !!backupMade
    });
    if (result.error) throw new Error(result.error.message || 'Reset failed. Existing data was not changed.');
    return rpcPayload(result.data) || {};
  }

  function start() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      window.MM_SUPABASE_STATUS = 'library-missing';
      window.MM_SUPABASE_ENABLED = false;
      window.MM_MENU_LOAD_ERROR = true;
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
    window.MM_SUBMIT_PARTY_BOOKING = submitPartyBooking;
    window.MM_LOAD_PARTY_BOOKINGS = loadPartyBookings;
    window.MM_UPDATE_PARTY_BOOKING = updatePartyBooking;
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
    window.MM_REQUEST_PAYMENT_VERIFICATION = requestPaymentVerification;
    window.MM_REFRESH_TABLE_VISITS = refreshTableVisits;
    window.MM_SET_TABLE_VISIT_STATUS = setTableVisitStatus;
    window.MM_SET_TABLE_CAPACITY = setTableCapacity;
    window.MM_RELEASE_ABANDONED_VISIT = releaseAbandonedVisit;
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
    window.MM_CANCEL_CUSTOMER_ORDER = cancelCustomerOrder;
    window.MM_REFRESH_CUSTOMER_ORDERS = refreshCustomerOrders;
    window.MM_PREVIEW_TABLE_CLEANUP = previewTableCleanup;
    window.MM_CLEAR_TABLE_ORDERS = clearTableOrders;
    window.MM_CANCEL_ADMIN_ORDER = cancelAdminOrder;
    window.MM_SET_ORDER_COMPLIMENTARY = setOrderComplimentary;
    window.MM_RECORD_TABLE_PAYMENT = recordTablePayment;
    window.MM_GET_PUBLIC_TABLE_BILL = getPublicTableBill;
    window.MM_GET_PUBLIC_VISIT_BILL = getPublicVisitBill;
    window.MM_GET_STAFF_VISIT_BILL = getStaffVisitBill;
    window.MM_REQUEST_CASH_COUNTER_RELEASE = requestCashCounterRelease;
    window.MM_REQUEST_VISIT_PAYMENT_VERIFICATION = requestVisitPaymentVerification;
    window.MM_RECORD_VISIT_PAYMENT = recordVisitPayment;
    window.MM_LOAD_ADMIN_ACCOUNTS_SUMMARY = loadAdminAccountsSummary;
    window.MM_LIST_WAITERS = listWaiters;
    window.MM_SAVE_WAITER = saveWaiterDirectoryEntry;
    window.MM_SET_WAITER_ACTIVE = setWaiterDirectoryActive;
    window.MM_ADMIN_EXPORT_BACKUP = exportOwnerBackup;
    window.MM_ADMIN_RECORD_BACKUP = recordOwnerBackupExport;
    window.MM_ADMIN_MAINTENANCE_STATUS = loadOwnerMaintenanceStatus;
    window.MM_ADMIN_RESET_APP = resetOwnerBusinessData;
    window.MM_ADMIN_GET_ORDER_DETAILS = getAdminOrderDetails;
    window.MM_LOAD_ADMIN_PAYMENTS = loadAdminPayments;
    window.MM_REFRESH_STAFF_ORDERS = refreshStaffOrders;
    window.MM_ADMIN_REVIEW_CUSTOMER_ORDER = reviewCustomerOrder;
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
    setTimeout(refreshTableVisits, 1200);
    setInterval(refreshTableVisits, 8000);
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