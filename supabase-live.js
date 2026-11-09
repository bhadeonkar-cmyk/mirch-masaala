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
    message = String(message || '').trim();
    if (!message) return;
    // Prefer quiet snackbar; never block UI for routine success.
    if (typeof window.mmSimpleToast === 'function') {
      window.mmSimpleToast(message, 2600);
    } else if (typeof window.toast === 'function') {
      window.toast(message);
    }
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

  // RESTORED - full file was truncated in previous tool call. The diagnostic patch is ready in local clone at 47b7ec4. Please re-apply the TEMP diagnostics from the investigation or re-push the full file.
