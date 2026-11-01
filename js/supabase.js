/* Mirch Masaala — thin client over the EXISTING Supabase backend.
 * No new RPCs, no schema changes. Contracts mirror the production SQL in /supabase
 * and the last known-good production client (commit c423955).
 */
(function () {
  var RID = MM.RESTAURANT_ID;
  var client = null;
  var initError = null;

  try {
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error('supabase-js did not load (network or CDN blocked)');
    }
    client = window.supabase.createClient(MM.SUPABASE_URL, MM.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
  } catch (e) {
    initError = e;
    console.error('[MM supabase init]', e);
  }

  function need() {
    if (!client) {
      var err = new Error('OFFLINE');
      err.userCode = 'offline';
      throw err;
    }
    return client;
  }

  function pad2(n) { return String(n == null ? '' : n).trim().padStart(2, '0'); }
  function first(data) { return Array.isArray(data) ? (data[0] || null) : data; }
  function upper(v) { return String(v || '').toUpperCase(); }

  async function rpc(name, args) {
    var r = await need().rpc(name, args || {});
    if (r.error) {
      console.error('[MM rpc ' + name + ']', r.error);
      throw r.error;
    }
    return r.data;
  }

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  /* One anonymous session id per phone per visit (same scheme as production). */
  function customerSessionId(visitId) {
    var key = MM.KEYS.sessionPrefix + visitId;
    var v = MM.store.get(key, '');
    if (!UUID_RE.test(v)) { v = uuid(); MM.store.set(key, v); }
    return v;
  }

  function ticketId(table) {
    var d = new Date();
    var day = d.toISOString().slice(0, 10).replace(/-/g, '');
    var clock = d.toTimeString().slice(0, 8).replace(/:/g, '');
    var rnd = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    return 'T' + pad2(table) + '-' + day + '-' + clock + '-' + rnd;
  }

  /* Staff sign in with a username; Supabase Auth uses an internal email (production scheme). */
  function authEmail(value) {
    var c = String(value || '').trim().toLowerCase();
    if (c.indexOf('@') >= 0) return c;
    if (!/^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/.test(c)) {
      var e = new Error('BAD_USERNAME'); e.userCode = 'bad_username'; throw e;
    }
    return c + '@staff.mirchmasaala.invalid';
  }

  var api = {
    ready: function () { return !!client; },
    initError: function () { return initError; },
    pad2: pad2,
    uuid: uuid,
    newTicket: ticketId,
    customerSessionId: customerSessionId,

    /* ---------- public / customer ---------- */
    tableStatus: async function (table) {
      return first(await rpc('mm_public_table_visit_status', { p_table_number: pad2(table) }));
    },

    loadMenu: async function () {
      var c = need();
      var cats = await c.from('categories')
        .select('id,name,sort_order,is_active')
        .eq('restaurant_id', RID)
        .order('sort_order', { ascending: true });
      if (cats.error) throw cats.error;
      var items = await c.from('menu_items')
        .select('id,category_id,name,description,price,image_url,is_available,sort_order,is_veg,is_bestseller,spicy_level')
        .eq('restaurant_id', RID)
        .order('sort_order', { ascending: true });
      if (items.error) throw items.error;
      return { categories: cats.data || [], items: items.data || [] };
    },

    loadConfig: async function () {
      var r = await need().from('mm_restaurant_config')
        .select('restaurant_name,tagline,admin_phone,upi_id,upi_name,phonepe_upi,whatsapp_number,whatsapp_name,google_reviews_url,pay_note,accept_card,accept_cash')
        .eq('restaurant_id', RID).maybeSingle();
      if (r.error) throw r.error;
      return r.data || null;
    },

    /* items: [{id, qty, spice, notes}] — table & visit come from the QR gate, never from a picker */
    placeOrder: async function (opts) {
      var items = (opts.items || []).map(function (i) {
        var spice = String(i.spice || 'normal').toLowerCase();
        if (['normal', 'mild', 'medium', 'hot'].indexOf(spice) < 0) spice = 'normal';
        return {
          menu_item_id: i.id,
          quantity: Math.max(1, Number(i.qty) || 1),
          spice_level: spice,
          notes: String(i.notes || '').slice(0, 300)
        };
      });
      if (!items.length) throw new Error('EMPTY_CART');
      var args = {
        p_restaurant_id: RID,
        p_table_number: pad2(opts.table),
        p_ticket_id: opts.ticket || ticketId(opts.table),
        p_notes: String(opts.notes || '').slice(0, 1000),
        p_items: items,
        p_table_visit_id: opts.visitId,
        p_customer_session_id: opts.sessionId || null,
        p_guest_order_code: null
      };
      var created = first(await rpc('mm_place_order', args));
      if (!created || !created.id || !created.publicToken) throw new Error('ORDER_NOT_CONFIRMED');
      return created;
    },

    getPublicOrder: async function (ticket, token) {
      return first(await rpc('mm_get_public_order', { p_ticket_id: ticket, p_public_token: token }));
    },

    guestBill: async function (table, visitId, sessionId) {
      return first(await rpc('mm_guest_get_visit_bill', {
        p_table_number: pad2(table), p_visit_id: visitId, p_customer_session_id: sessionId
      }));
    },

    /* UPI: asks counter to verify the digital payment. Cash: tells counter you will pay there.
       Neither marks anything PAID — only the owner can record payment. */
    requestPayment: async function (method, table, visitId, sessionId) {
      if (method === 'cash') {
        return first(await rpc('mm_guest_cash_counter_release', {
          p_table_number: pad2(table), p_visit_id: visitId, p_customer_session_id: sessionId
        }));
      }
      return first(await rpc('mm_guest_request_visit_payment_check', {
        p_restaurant_id: RID, p_table_number: pad2(table), p_visit_id: visitId,
        p_customer_session_id: sessionId, p_method: 'upi'
      }));
    },

    submitParty: async function (p) {
      return first(await rpc('mm_submit_party_booking', {
        p_name: String(p.name || '').trim(),
        p_phone: String(p.phone || '').trim(),
        p_event_type: String(p.eventType || ''),
        p_event_date: String(p.date || ''),
        p_event_time: String(p.time || ''),
        p_guest_count: Number(p.guests),
        p_notes: String(p.message || '').trim()
      }));
    },

    /* ---------- auth ---------- */
    signIn: async function (username, password) {
      var r = await need().auth.signInWithPassword({ email: authEmail(username), password: password });
      if (r.error) throw r.error;
      return r.data;
    },
    signOut: async function () {
      try { await need().auth.signOut({ scope: 'local' }); } catch (e) { console.warn('[MM signOut]', e); }
    },
    getSession: async function () {
      var r = await need().auth.getSession();
      return r && r.data ? r.data.session : null;
    },
    /* The ONLY source of truth for role — always asked from the server, never trusted from storage. */
    myRole: async function () {
      var role = first(await rpc('get_my_staff_role'));
      role = String(role || '').toLowerCase();
      return ['admin', 'waiter', 'kitchen'].indexOf(role) >= 0 ? role : null;
    },

    /* ---------- staff: tables & visits ---------- */
    tableVisits: async function () {
      var d = await rpc('mm_staff_get_table_visits');
      return Array.isArray(d) ? d : [];
    },
    listWaiters: async function () {
      var d = await rpc('mm_list_waiters', { p_include_inactive: false });
      return Array.isArray(d) ? d : [];
    },
    startVisit: async function (table, waiterCode) {
      return first(await rpc('mm_staff_set_table_visit_status', {
        p_table_number: pad2(table), p_action: 'START',
        p_waiter_code: waiterCode ? String(waiterCode).trim().toUpperCase() : null
      }));
    },
    finishVisit: async function (table) {
      return first(await rpc('mm_staff_set_table_visit_status', {
        p_table_number: pad2(table), p_action: 'FINISH', p_waiter_code: null
      }));
    },
    releaseAbandoned: async function (table, reason) {
      return first(await rpc('mm_staff_release_abandoned_visit', {
        p_table_number: pad2(table), p_reason: String(reason || 'Guest left before checkout').slice(0, 200)
      }));
    },

    /* ---------- staff: orders ---------- */
    staffTables: async function () {
      var r = await need().from('restaurant_tables')
        .select('id,table_number').eq('restaurant_id', RID).eq('is_active', true);
      if (r.error) throw r.error;
      return r.data || [];
    },
    staffOrders: async function (activeOnly) {
      var cols = 'id,ticket_id,table_id,status,approval_status,notes,total,created_at,order_number,archived_at';
      var q = need().from('orders').select(cols).eq('restaurant_id', RID);
      if (activeOnly) q = q.in('status', ['NEW', 'PREPARING', 'READY']).is('archived_at', null);
      q = q.order('created_at', { ascending: false }).limit(activeOnly ? 200 : 60);
      var r = await q;
      if (r.error) throw r.error;
      return r.data || [];
    },
    orderItems: async function (orderIds) {
      if (!orderIds.length) return [];
      var r = await need().from('order_items')
        .select('order_id,item_name,quantity,price').in('order_id', orderIds);
      if (r.error) throw r.error;
      return r.data || [];
    },
    /* Production behaviour: direct update scoped by restaurant + ticket, enforced by RLS. */
    setOrderStatus: async function (ticket, status) {
      var next = upper(status);
      var r = await need().from('orders').update({ status: next })
        .eq('restaurant_id', RID).eq('ticket_id', ticket)
        .select('ticket_id,status').maybeSingle();
      if (r.error) throw r.error;
      if (!r.data || upper(r.data.status) !== next) throw new Error('NOT_UPDATED');
      return r.data;
    },

    /* ---------- staff: payments (owner) ---------- */
    notifications: async function (limit) {
      var d = await rpc('mm_staff_notifications', { p_limit: limit || 40, p_staff_code: null });
      return Array.isArray(d) ? d : [];
    },
    visitBill: async function (visitId) {
      return first(await rpc('mm_staff_get_visit_bill', { p_visit_id: visitId }));
    },
    recordPayment: async function (visitId, amount, method, note) {
      return first(await rpc('mm_staff_record_visit_payment', {
        p_visit_id: visitId, p_amount: Number(amount), p_method: String(method || 'cash'),
        p_note: String(note || '').slice(0, 500)
      }));
    },

    /* ---------- owner: menu / bookings / settings ---------- */
    updatePrice: async function (id, price) {
      var p = Math.round(Number(price));
      var r = await need().from('menu_items').update({ price: p })
        .eq('restaurant_id', RID).eq('id', id).select('id,price').maybeSingle();
      if (r.error) throw r.error;
      if (!r.data || Number(r.data.price) !== p) throw new Error('NOT_UPDATED');
      return r.data;
    },
    setAvailable: async function (id, on) {
      var r = await need().from('menu_items').update({ is_available: !!on })
        .eq('restaurant_id', RID).eq('id', id).select('id,is_available').maybeSingle();
      if (r.error) throw r.error;
      if (!r.data || r.data.is_available !== !!on) throw new Error('NOT_UPDATED');
      return r.data;
    },
    listBookings: async function () {
      var d = await rpc('mm_admin_list_party_bookings', { p_limit: 100 });
      return Array.isArray(d) ? d : [];
    },
    updateBooking: async function (id, status, notes) {
      return first(await rpc('mm_admin_update_party_booking', {
        p_booking_id: id, p_status: upper(status), p_owner_notes: notes || ''
      }));
    },
    saveConfig: async function (patch) {
      var payload = Object.assign({ restaurant_id: RID }, patch);
      var r = await need().from('mm_restaurant_config').upsert(payload, { onConflict: 'restaurant_id' });
      if (r.error) throw r.error;
      return true;
    }
  };

  MM.api = api;
})();
