/* Mirch Masaala — shared config (public values only) */
window.MM = window.MM || {};
MM.SUPABASE_URL = 'https://adbhxldsqwsyaqzdmxnf.supabase.co';
MM.SUPABASE_ANON_KEY = 'sb_publishable_jAm4636kkOg-EysRgIa_Jw_bt967sZ9';
MM.RESTAURANT_ID = 'a3702d10-6673-4c06-9783-1d61c945ecd5';

/* Safe storage: localStorage can throw (private mode, blocked cookies).
   Every read/write goes through here so it can never white-screen the app. */
MM.store = {
  get: function (key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? (fallback === undefined ? null : fallback) : v;
    } catch (e) { return fallback === undefined ? null : fallback; }
  },
  set: function (key, value) {
    try { window.localStorage.setItem(key, String(value)); return true; } catch (e) { return false; }
  },
  remove: function (key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  },
  getJSON: function (key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },
  setJSON: function (key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
};

/* Local state */
MM.state = {
  lang: MM.store.get('mm_lang', 'en') === 'mr' ? 'mr' : 'en',
  table: null,          // two-digit table number from the QR (?table=01)
  gate: null,           // result of mm_public_table_visit_status
  visitId: null,
  cart: [],             // [{ id, name, price, qty, spice, notes }]
  menu: [],
  categories: [],
  config: null,         // mm_restaurant_config row (public read)
  role: null,           // 'admin' | 'waiter' | 'kitchen' | null (from get_my_staff_role only)
  session: null,
  loading: true
};

/* Customer-side persistence (this phone only) */
MM.KEYS = {
  cart: 'mm_cart_v2',
  orders: 'mm_my_orders_v2',   // [{ id, token, table, visitId, orderNumber, at }]
  sessionPrefix: 'mm_customer_session_'
};
