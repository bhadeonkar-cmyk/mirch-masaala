'use strict';
// In-memory fake of the Mirch Masaala Supabase backend, following the contracts in supabase/*.sql.
// Used ONLY with Playwright request interception: nothing here ever reaches a real Supabase project.
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const RID = 'a3702d10-6673-4c06-9783-1d61c945ecd5';
const SB_HOST = 'adbhxldsqwsyaqzdmxnf.supabase.co';
const uuid = () => crypto.randomUUID();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function makeBackend() {
  const st = {
    calls: [],            // every request: {kind,name,args,role}
    tables: [], visits: [], orders: [], items: [], payments: [], notifs: [], bookings: [],
    cats: [], menu: [], cfg: { restaurant_id: RID, upi_id: 'mm@upi', upi_name: 'Mirch Masaala', whatsapp_number: '9199', google_reviews_url: '' },
    waiters: [{ waiter_code: 'W01', display_name: 'Asha', active: true, created_at: new Date().toISOString() }],
    orderSeq: 100, failNext: {}
  };
  for (let i = 1; i <= 8; i++) st.tables.push({ id: uuid(), restaurant_id: RID, table_number: String(i).padStart(2, '0'), is_active: true });
  const c1 = { id: uuid(), restaurant_id: RID, name: 'Starters', sort_order: 1, is_active: true };
  const c2 = { id: uuid(), restaurant_id: RID, name: 'Mains', sort_order: 2, is_active: true };
  st.cats.push(c1, c2);
  const mk = (cat, name, price, avail, o) => st.menu.push(Object.assign({ id: uuid(), restaurant_id: RID, category_id: cat.id, name, description: name + ' desc', price, image_url: null, is_available: avail, sort_order: st.menu.length, is_veg: true, is_bestseller: false, spicy_level: 1 }, o || {}));
  mk(c1, 'Paneer Tikka', 220, true); mk(c1, 'Veg Manchurian', 180, true);
  mk(c2, 'Butter Chicken', 320, true, { is_veg: false }); mk(c2, 'Hidden Dish', 99, false);
  st.users = {
    'waiter@staff.mirchmasaala.invalid': { id: uuid(), role: 'waiter', pw: 'pw' },
    'kitchen@staff.mirchmasaala.invalid': { id: uuid(), role: 'kitchen', pw: 'pw' },
    'owner@staff.mirchmasaala.invalid': { id: uuid(), role: 'admin', pw: 'pw' }
  };
  const tnum = (id) => (st.tables.find((t) => t.id === id) || {}).table_number;
  const openVisit = (num) => st.visits.find((v) => v.table_number === num && v.status === 'OPEN');
  const due = (v) => st.orders.filter((o) => o.table_visit_id === v.id && !['CANCELLED', 'PAID'].includes(o.status))
    .reduce((s, o) => s + o.total, 0) - st.payments.filter((p) => p.visit_id === v.id).reduce((s, p) => s + p.amount, 0);
  const err = (msg, code) => { const e = new Error(msg); e.pg = true; e.code = code || 'P0001'; throw e; };
  const pad = (n) => String(n).trim().padStart(2, '0');

  function roleOf(req) {
    const a = req.headers()['authorization'] || '';
    const tok = a.replace(/^Bearer\s+/i, '');
    const parts = tok.split('.');
    if (parts.length === 3) { try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()).mm || ''; } catch (e) { return ''; } }
    return '';
  }

  const rpcs = {
    get_my_staff_role: (a, role) => role || null,
    mm_public_table_visit_status: (a) => {
      if (!/^[0-9]{1,2}$/.test(String(a.p_table_number || '').trim())) err('Choose a valid table number');
      const n = pad(a.p_table_number);
      if (!st.tables.find((t) => t.table_number === n && t.is_active)) return { table_number: n, status: 'UNKNOWN', can_order: false, message: 'Table not found' };
      const v = openVisit(n);
      if (!v) return { table_number: n, status: 'AVAILABLE', can_order: false, visit_id: null, message: 'Please wait for the waiter to activate this table.' };
      return { table_number: n, status: 'OPEN', can_order: true, visit_id: v.id, started_at: v.started_at, message: 'You are ready to order.' };
    },
    // direct-kitchen-qr-orders.sql contract (no guest PIN)
    mm_place_order: (a, role) => {
      if (a.p_restaurant_id !== RID) err('Unknown restaurant');
      if (!/^[A-Z0-9-]{8,64}$/.test(a.p_ticket_id || '')) err('Invalid ticket ID');
      if (!/^[0-9]{1,2}$/.test(a.p_table_number || '')) err('Invalid table number');
      const n = pad(a.p_table_number);
      const t = st.tables.find((x) => x.table_number === n && x.is_active);
      if (!t) err('This table is not active');
      const v = openVisit(n);
      if (!v) err('This table is not open for online orders yet. Please ask your waiter to start the visit.');
      if (!a.p_table_visit_id || a.p_table_visit_id !== v.id) err('The table visit has changed. Refresh and ask your waiter for the current order code.');
      if (!role && !a.p_customer_session_id) err('Customer session is missing. Refresh this page and try again.');
      if (!Array.isArray(a.p_items) || a.p_items.length < 1 || a.p_items.length > 100) err('Add between 1 and 100 order lines');
      let total = 0; const lines = [];
      for (const l of a.p_items) {
        const m = st.menu.find((x) => x.id === l.menu_item_id && x.is_available);
        if (!m || !(l.quantity >= 1 && l.quantity <= 99)) err('A selected dish is unavailable. Refresh the menu and try again.');
        total += m.price * l.quantity; lines.push({ m, q: l.quantity });
      }
      const o = { id: uuid(), restaurant_id: RID, ticket_id: a.p_ticket_id, table_id: t.id, table_visit_id: v.id, status: 'NEW', approval_status: 'APPROVED', notes: a.p_notes || '', total, created_at: new Date().toISOString(), order_number: ++st.orderSeq, archived_at: null, public_token: uuid(), session: a.p_customer_session_id };
      st.orders.push(o);
      lines.forEach((l) => st.items.push({ order_id: o.id, item_name: l.m.name, quantity: l.q, price: l.m.price }));
      return { id: o.ticket_id, dbId: o.id, publicToken: o.public_token, table: n, visitId: v.id, customerSessionId: a.p_customer_session_id, total, status: 'NEW', notes: o.notes, createdAt: o.created_at, orderNumber: o.order_number, items: lines.map((l) => ({ name: l.m.name, price: l.m.price, qty: l.q })) };
    },
    mm_get_public_order: (a) => {
      const o = st.orders.find((x) => x.ticket_id === a.p_ticket_id && x.public_token === a.p_public_token);
      if (!o) return null;
      return { id: o.ticket_id, table: tnum(o.table_id), total: o.total, status: o.status, approvalStatus: o.approval_status, notes: o.notes, createdAt: o.created_at,
        items: st.items.filter((i) => i.order_id === o.id).map((i) => ({ name: i.item_name, price: i.price, qty: i.quantity })) };
    },
    mm_guest_get_visit_bill: (a) => {
      const v = st.visits.find((x) => x.id === a.p_visit_id && x.table_number === pad(a.p_table_number));
      if (!v) err('This phone is not linked to the current table visit');
      const mine = st.orders.some((o) => o.table_visit_id === v.id && o.session === a.p_customer_session_id);
      if (!mine) err('This phone is not linked to the current table visit');
      return { table: v.table_number, visit_id: v.id, visit_status: v.status, amount: Math.max(0, due(v)), order_count: 1, orders_in_progress: false };
    },
    mm_guest_cash_counter_release: (a) => {
      const v = st.visits.find((x) => x.id === a.p_visit_id && x.table_number === pad(a.p_table_number));
      if (!v || v.status !== 'OPEN') err('Visit not open');
      st.notifs.push({ id: st.notifs.length + 1, target_role: 'admin', notification_type: 'CASH_AT_COUNTER', table_number: v.table_number, message: 'Cash at counter', resolved_at: null, target_staff_code: '' });
      st.notifs.push({ id: st.notifs.length + 1, target_role: 'waiter', notification_type: 'CASH_AT_COUNTER', table_number: v.table_number, message: 'Cash at counter T' + v.table_number, resolved_at: null, target_staff_code: '' });
      return { ok: true };
    },
    mm_guest_request_visit_payment_check: (a) => {
      const v = st.visits.find((x) => x.id === a.p_visit_id && x.table_number === pad(a.p_table_number));
      if (!v) err('Visit not found');
      st.notifs.push({ id: st.notifs.length + 1, target_role: 'admin', notification_type: 'PAYMENT_CHECK', table_number: v.table_number, message: 'Verify UPI payment', resolved_at: null, target_staff_code: '' });
      return { ok: true };
    },
    mm_submit_party_booking: (a) => { st.bookings.push({ id: uuid(), booking_ref: 'PARTY-' + String(st.bookings.length + 1).padStart(5, '0'), customer_name: a.p_name, customer_phone: a.p_phone, event_type: a.p_event_type, event_date: a.p_event_date, event_time: a.p_event_time, guest_count: a.p_guest_count, customer_notes: a.p_notes, status: 'NEW', owner_notes: '' }); return { ok: true }; },
    mm_staff_get_table_visits: (a, role) => {
      if (!['admin', 'waiter'].includes(role)) err('Owner/Admin or signed-in waiter access required');
      return st.tables.filter((t) => t.is_active).map((t) => { const v = openVisit(t.table_number); return { table_number: t.table_number, status: v ? 'OPEN' : 'AVAILABLE', started_at: v ? v.started_at : null, visit_id: v ? v.id : null, assigned_waiter_code: v ? v.waiter : '', guest_order_code: v ? v.code : '' }; });
    },
    mm_list_waiters: (a, role) => { if (!['admin', 'waiter'].includes(role)) err('Owner or waiter sign-in required'); return st.waiters; },
    mm_staff_set_table_visit_status: (a, role) => {
      if (!['admin', 'waiter'].includes(role)) err('Owner/Admin or signed-in waiter access required');
      const n = pad(a.p_table_number); const act = String(a.p_action).toUpperCase();
      if (act === 'START') {
        if (!/^[A-Z0-9][A-Z0-9_-]{1,11}$/.test(String(a.p_waiter_code || '').toUpperCase())) err('Enter your waiter ID (for example W01) before starting the visit.');
        let v = openVisit(n);
        if (!v) { v = { id: uuid(), table_number: n, status: 'OPEN', started_at: new Date().toISOString(), waiter: a.p_waiter_code.toUpperCase(), code: '123456' }; st.visits.push(v); }
        return { table_number: n, status: 'OPEN', visit_id: v.id, assigned_waiter_code: v.waiter };
      }
      const v = openVisit(n); if (!v) err('Table ' + n + ' has no active visit.');
      if (st.orders.some((o) => o.table_visit_id === v.id && ['NEW', 'PREPARING', 'READY'].includes(o.status))) err('Table ' + n + ' still has food tickets in progress. Serve or cancel every ticket first.');
      if (due(v) > 0.01) err('Table ' + n + ' still has unpaid balance.');
      v.status = 'CLOSED'; return { table_number: n, status: 'CLOSED', visit_id: v.id };
    },
    mm_staff_release_abandoned_visit: (a, role) => {
      if (!['admin', 'waiter'].includes(role)) err('access required');
      const v = openVisit(pad(a.p_table_number)); if (!v) err('no visit'); v.status = 'CLOSED'; return { ok: true };
    },
    mm_staff_notifications: (a, role) => {
      if (!['admin', 'waiter', 'kitchen'].includes(role)) err('Staff sign-in required');
      return st.notifs.filter((n) => n.target_role === role && !n.resolved_at);
    },
    mm_staff_get_visit_bill: (a, role) => {
      if (!['admin', 'waiter'].includes(role)) err('Owner/Admin or signed-in counter staff access required');
      const v = st.visits.find((x) => x.id === a.p_visit_id); if (!v) err('Table visit not found');
      return { table: v.table_number, visit_id: v.id, visit_status: v.status, amount: Math.max(0, due(v)), order_count: 1, orders_in_progress: false };
    },
    mm_staff_record_visit_payment: (a, role) => {
      if (role !== 'admin') err('Only the Owner/Counter (Admin login) can confirm and record payments');
      const v = st.visits.find((x) => x.id === a.p_visit_id); if (!v) err('Table visit not found');
      if (!(a.p_amount > 0)) err('Enter a valid received amount');
      st.payments.push({ visit_id: v.id, amount: a.p_amount, method: a.p_method });
      if (due(v) <= 0.01) st.orders.filter((o) => o.table_visit_id === v.id && o.status === 'SERVED').forEach((o) => { o.status = 'PAID'; });
      return { ok: true };
    },
    mm_admin_list_party_bookings: (a, role) => { if (role !== 'admin') err('Owner/Admin access required'); return st.bookings; },
    mm_admin_update_party_booking: (a, role) => { if (role !== 'admin') err('Owner/Admin access required'); if (!['NEW','CONTACTED','CONFIRMED','UNAVAILABLE'].includes(String(a.p_status).toUpperCase())) err('Choose a valid booking status.'); const b = st.bookings.find((x) => x.id === a.p_booking_id); if (!b) err('Party booking not found.'); b.status = String(a.p_status).toUpperCase(); b.owner_notes = a.p_owner_notes; return { id: b.id, status: b.status, owner_notes: b.owner_notes }; }
  };

  function parseFilters(url) {
    const f = []; let order = null, limit = null;
    for (const [k, v] of url.searchParams) {
      if (['select', 'on_conflict'].includes(k)) continue;
      if (k === 'order') { order = v; continue; }
      if (k === 'limit') { limit = Number(v); continue; }
      let m;
      if ((m = /^eq\.(.*)$/.exec(v))) f.push((r) => String(r[k]) === m[1]);
      else if ((m = /^in\.\((.*)\)$/.exec(v))) { const set = m[1].split(',').map((s) => s.replace(/^"|"$/g, '')); f.push((r) => set.includes(String(r[k]))); }
      else if (v === 'is.null') f.push((r) => r[k] == null);
    }
    return { f, order, limit };
  }
  function table(name) { return ({ categories: st.cats, menu_items: st.menu, restaurant_tables: st.tables, orders: st.orders, order_items: st.items })[name]; }

  async function handle(route) {
    const req = route.request(); const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (status, body, extra) => route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, cors, extra || {}), body: body === undefined ? '' : JSON.stringify(body) });
    const role = roleOf(req);
    const p = url.pathname;
    try {
      if (p.startsWith('/auth/v1/token')) {
        const b = JSON.parse(req.postData() || '{}'); const u = st.users[b.email];
        st.calls.push({ kind: 'auth', name: 'signIn', args: { email: b.email } });
        if (!u || u.pw !== b.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 400, msg: 'Invalid login credentials' });
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const jwt = [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: u.id, role: 'authenticated', exp, mm: u.role, aud: 'authenticated' }), 'sig'].join('.');
        return json(200, { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r' + u.id, user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: b.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
      }
      if (p.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers: cors });
      if (p.startsWith('/auth/v1/')) return json(200, {});
      if (p.startsWith('/rest/v1/rpc/')) {
        const name = p.split('/').pop(); const args = JSON.parse(req.postData() || '{}');
        st.calls.push({ kind: 'rpc', name, args, role });
        if (st.failNext[name]) { const m = st.failNext[name]; delete st.failNext[name]; return json(400, { code: 'P0001', message: m, details: null, hint: null }); }
        if (!rpcs[name]) return json(404, { code: 'PGRST202', message: 'Could not find the function public.' + name, details: null, hint: null });
        try { const out = rpcs[name](args, role); return json(200, out === undefined ? null : out); }
        catch (e) { if (e.pg) return json(400, { code: e.code, message: e.message, details: null, hint: null }); throw e; }
      }
      if (p.startsWith('/rest/v1/')) {
        const name = p.slice('/rest/v1/'.length);
        st.calls.push({ kind: 'rest', name, method: req.method(), query: url.search, role });
        if (name === 'mm_restaurant_config') {
          if (req.method() === 'GET') return json(200, [st.cfg]);
          if (role !== 'admin') return json(403, { code: '42501', message: 'new row violates row-level security policy' });
          Object.assign(st.cfg, JSON.parse(req.postData() || '{}')); return json(201, null);
        }
        const rows = table(name); if (!rows) return json(404, { code: '42P01', message: 'relation ' + name + ' does not exist' });
        const { f, order, limit } = parseFilters(url);
        const staff = ['admin', 'waiter', 'kitchen'].includes(role);
        let res = rows.filter((r) => f.every((fn) => fn(r)));
        if (req.method() === 'GET') {
          if (['orders', 'order_items'].includes(name) && !staff) res = [];
          if (name === 'menu_items' && !staff) res = res.filter((r) => r.is_available);
          if (order) { const [col, dir] = order.split('.'); res = res.slice().sort((x, y) => (x[col] > y[col] ? 1 : x[col] < y[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
          if (limit) res = res.slice(0, limit);
          return json(200, res);
        }
        if (req.method() === 'PATCH') {
          const body = JSON.parse(req.postData() || '{}'); const out = [];
          for (const r of res) {
            if (name === 'orders' && 'status' in body) {
              const o = r.status, n = String(body.status).toUpperCase();
              const ok = role === 'admin' ? true : role === 'kitchen' ? (o === 'NEW' && n === 'PREPARING') || (o === 'PREPARING' && n === 'READY') : role === 'waiter' ? (o === 'READY' && n === 'SERVED') : false;
              if (!ok) return json(400, { code: 'P0001', message: role === 'kitchen' ? 'Kitchen may only start or complete preparation' : 'Waiter may only mark a ready order as served' });
            }
            if (name === 'menu_items' && !['admin', 'kitchen'].includes(role)) continue;
            Object.assign(r, body); out.push(r);
          }
          if (/vnd\.pgrst\.object\+json/.test(req.headers()['accept'] || '')) {
            if (out.length !== 1) return json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains ' + out.length + ' rows', hint: null });
            return json(200, out[0]);
          }
          return json(200, out);
        }
      }
      return json(404, { message: 'unhandled ' + req.method() + ' ' + p });
    } catch (e) { return json(500, { message: String(e && e.stack || e) }); }
  }
  return { st, handle, rpcs, openVisit };
}

// Static server for the repo (http origin so URL origin checks behave like production).
function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let f = path.join(root, decodeURIComponent(u.pathname));
    if (u.pathname.endsWith('/')) f = path.join(f, 'index.html');
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

module.exports = { makeBackend, serve, SB_HOST, RID };
