/* Mirch Masaala — shared config (public values only) */
window.MM = window.MM || {};
MM.SUPABASE_URL = 'https://adbhxldsqwsyaqzdmxnf.supabase.co';
MM.SUPABASE_ANON_KEY = 'sb_publishable_jAm4636kkOg-EysRgIa_Jw_bt967sZ9';
MM.RESTAURANT_ID = 'a3702d10-6673-4c06-9783-1d61c945ecd5';

/* Local state */
MM.state = {
  lang: localStorage.getItem('mm_lang') || 'en',
  table: null,
  visitId: null,
  cart: [],
  menu: [],
  categories: [],
  orders: [],
  role: null,
  session: null,
  loading: true
};
