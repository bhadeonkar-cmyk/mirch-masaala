/* Mirch Masaala — Owner dashboard panels.
 *
 * Every panel here sits on an EXISTING backend contract (see docs/OWNER-BACKEND-REQUIREMENTS.md):
 *   - the admin role is enforced by the database (get_my_staff_role() = 'admin' inside each RPC, RLS on
 *     mm_restaurant_config / mm_restaurant_reviews). Hiding a tab is only a convenience: a waiter or kitchen
 *     account that calls these RPCs directly is refused by the server.
 *   - nothing is invented: when the database has no table/RPC for a feature the panel says so (BLOCKED)
 *     instead of keeping data in the browser.
 *   - no passwords are read, stored or shown here; staff logins live in Supabase Auth.
 * Panels are registered on MM.ownerPanels and called by js/app.js as  panel(box, { esc, toast, go }).
 */
(function () {
  'use strict';
  var MM = window.MM = window.MM || {};
  var P = MM.ownerPanels = {};

  function t(k, v) { return MM.t(k, v); }
  function A() { return MM.api; }
  function U(s) { return String(s == null ? '' : s).toUpperCase(); }
  function settle(p) {
    return p.then(function (v) { return { ok: true, value: v }; },
      function (e) { console.error('[MM owner]', e); return { ok: false, error: e }; });
  }
  function money(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
  /* Calendar day in India (the SQL summaries use Asia/Kolkata), offset by whole days. */
  function istDay(offset) {
    return new Date(Date.now() + 5.5 * 3600e3 + (offset || 0) * 86400e3).toISOString().slice(0, 10);
  }
  function timeOf(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  /* Server-raised messages (P0001) are written for the user; anything else becomes a generic message. */
  function errText(e) {
    if (e && e.code === 'P0001' && e.message) return String(e.message).slice(0, 180);
    if (e && (e.code === '42501' || /row-level security|permission denied/i.test(String(e.message || '')))) return t('oa_not_allowed');
    return t('something_wrong');
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/json' });
    var href = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(href); }, 4000);
  }
  function blocked(esc, title, body) {
    return '<div class="oa-blocked"><strong>' + esc(title) + '</strong><span class="muted small">' + esc(body) + '</span></div>';
  }
  function head(esc, key, extra) {
    return '<div class="oa-head"><h2 class="section-title">' + esc(t(key)) + '</h2>' + (extra || '') + '</div>';
  }

  /* ================= Dashboard ================= */
  P.dashboard = async function (box, ctx) {
    var esc = ctx.esc, A_ = A();
    var r = await Promise.all([settle(A_.accountsSummary()), settle(A_.staffOrders(true)), settle(A_.tableVisits()),
      settle(A_.notifications(50, '')), settle(A_.maintenanceStatus())]);
    var sum = r[0].ok ? (r[0].value || {}) : null, live = r[1].ok ? r[1].value : null;
    var visits = r[2].ok ? r[2].value : null, alerts = r[3].ok ? r[3].value : null, maint = r[4].ok ? r[4].value : null;
    function n(x) { return x == null ? '—' : x; }
    var lanes = { NEW: 0, PREPARING: 0, READY: 0 }, approval = 0;
    (live || []).forEach(function (o) {
      var s = U(o.status); if (lanes[s] != null) lanes[s]++;
      if (U(o.approval_status) === 'PENDING' && s === 'NEW') approval++;
    });
    var openTables = visits ? visits.filter(function (v) { return U(v.status || v.visit_status) === 'OPEN'; }).length : null;
    var days = null;
    if (maint && maint.last_backup_at) days = Math.floor((Date.now() - new Date(maint.last_backup_at).getTime()) / 86400e3);
    function stat(go, label, value, cls) {
      return '<button type="button" class="oa-stat ' + (cls || '') + '" data-go="' + go + '"><span>' + esc(label) +
        '</span><strong>' + esc(value) + '</strong></button>';
    }
    var h = head(esc, 'oa_dashboard',
      '<button type="button" class="btn btn-sm btn-soft" data-refresh>' + esc(t('refresh')) + '</button>');
    h += '<h3 class="oa-sub">' + esc(t('oa_today')) + '</h3><div class="oa-stats">' +
      stat('reports', t('oa_sales_today'), sum ? money(sum.paid_sales) : '—') +
      stat('orders', t('oa_orders_today'), n(sum && sum.order_count)) +
      stat('payments', t('oa_unpaid'), sum ? money(sum.pending_value) : '—', sum && sum.pending_value > 0 ? 'warn' : '') +
      stat('orders', t('oa_cancelled'), n(sum && sum.cancelled_count)) + '</div>';
    h += '<h3 class="oa-sub">' + esc(t('oa_live')) + '</h3><div class="oa-stats">' +
      stat('orders', t('oa_new'), live ? lanes.NEW : '—') +
      stat('orders', t('oa_preparing'), live ? lanes.PREPARING : '—') +
      stat('orders', t('oa_ready'), live ? lanes.READY : '—') +
      stat('orders', t('oa_needs_approval'), live ? approval : '—', approval > 0 ? 'warn' : '') +
      stat('tables', t('oa_open_tables'), n(openTables)) +
      stat('alerts', t('oa_alerts'), alerts ? alerts.length : '—', alerts && alerts.length ? 'warn' : '') + '</div>';
    if (maint) {
      var stale = days == null || days >= 10;
      h += '<button type="button" class="oa-note ' + (stale ? 'warn' : '') + '" data-go="backup">' +
        esc(days == null ? t('oa_backup_never') : days === 0 ? t('oa_backup_today') : t('oa_backup_days', { n: days })) + '</button>';
    }
    if (!r.every(function (x) { return x.ok; })) h += '<p class="muted small">' + esc(t('oa_partial')) + '</p>';
    box.innerHTML = h;
    box.onclick = function (ev) {
      var g = ev.target.closest('[data-go]'); if (g) { ctx.go(g.getAttribute('data-go')); return; }
      if (ev.target.closest('[data-refresh]')) ctx.go('dashboard');
    };
  };

  /* ================= Orders ================= */
  P.orders = async function (box, ctx) {
    var esc = ctx.esc, filter = 'active', opened = {}, itemsBy = {}, pending = null, orders = [], num = {};
    async function load() {
      var r = await Promise.all([A().staffOrders(false), A().ownerTables()]);
      orders = r[0]; num = {};
      r[1].forEach(function (x) { num[x.id] = A().pad2(x.table_number); });
    }
    function isActive(o) { return ['NEW', 'PREPARING', 'READY'].indexOf(U(o.status)) >= 0 && !o.archived_at; }
    function needsApproval(o) { return U(o.approval_status) === 'PENDING' && U(o.status) === 'NEW'; }
    function draw() {
      var shown = orders.filter(function (o) {
        return filter === 'all' ? true : filter === 'approval' ? needsApproval(o) : isActive(o);
      });
      var cnt = { active: orders.filter(isActive).length, approval: orders.filter(needsApproval).length, all: orders.length };
      var h = head(esc, 'nav_orders', '<button type="button" class="btn btn-sm btn-soft" data-refresh>' + esc(t('refresh')) + '</button>');
      h += '<div class="oa-chips" role="group">' + ['active', 'approval', 'all'].map(function (k) {
        return '<button type="button" class="oa-chipbtn' + (k === filter ? ' on' : '') + '" data-oflt="' + k + '">' +
          esc(t('oa_f_' + k)) + ' (' + cnt[k] + ')</button>';
      }).join('') + '</div>';
      if (!shown.length) h += '<div class="empty">' + esc(t('orders_empty')) + '</div>';
      shown.slice(0, 60).forEach(function (o) {
        var st = U(o.status), tk = o.ticket_id || String(o.order_number);
        h += '<div class="order-card" data-ord="' + esc(tk) + '" data-oid="' + esc(o.id) + '">' +
          '<div class="order-head"><strong>' + esc(tk) + '</strong><span class="badge">' + esc(st) + '</span></div>' +
          '<div class="muted small">' + (num[o.table_id] ? esc(t('oa_table')) + ' ' + esc(num[o.table_id]) + ' · ' : '') +
          money(o.total) + ' · ' + esc(timeOf(o.created_at)) + '</div>';
        if (needsApproval(o)) h += '<div class="oa-note warn static">' + esc(t('oa_needs_approval')) + '</div>';
        if (o.notes) h += '<div class="muted small">' + esc(o.notes) + '</div>';
        if (opened[tk]) {
          var its = itemsBy[o.id] || [];
          h += '<ul class="oa-lines">' + (its.length ? its.map(function (i) {
            return '<li>' + esc(i.quantity) + ' × ' + esc(i.item_name) + '<span>' + money(i.price * i.quantity) + '</span></li>';
          }).join('') : '<li>' + esc(t('loading')) + '</li>') + '</ul>';
        }
        h += '<div class="oa-actions"><button type="button" class="btn btn-sm btn-soft" data-detail>' + esc(t('oa_details')) + '</button>';
        if (needsApproval(o)) {
          h += '<button type="button" class="btn btn-sm btn-primary" data-approve>' + esc(t('oa_approve')) + '</button>' +
            '<button type="button" class="btn btn-sm btn-soft" data-ask="reject">' + esc(t('oa_reject')) + '</button>';
        } else if (isActive(o)) {
          h += '<button type="button" class="btn btn-sm btn-soft" data-ask="cancel">' + esc(t('oa_cancel_order')) + '</button>';
        }
        h += '</div>';
        if (pending && pending.ticket === tk) {
          h += '<div class="oa-confirm"><label><span>' + esc(t(pending.kind === 'cancel' ? 'oa_cancel_reason' : 'oa_reject_reason')) +
            '</span><input data-reason maxlength="240" autocomplete="off"></label><div class="oa-actions">' +
            '<button type="button" class="btn btn-sm btn-primary" data-confirm>' + esc(t('oa_confirm')) + '</button>' +
            '<button type="button" class="btn btn-sm btn-soft" data-back>' + esc(t('back')) + '</button></div></div>';
        }
        h += '</div>';
      });
      box.innerHTML = h;
    }
    await load(); draw();
    box.onclick = async function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var card = b.closest('[data-ord]'), tk = card && card.getAttribute('data-ord');
      try {
        if (b.hasAttribute('data-refresh')) { await load(); draw(); }
        else if (b.hasAttribute('data-oflt')) { filter = b.getAttribute('data-oflt'); pending = null; draw(); }
        else if (b.hasAttribute('data-detail')) {
          opened[tk] = !opened[tk];
          var id = card.getAttribute('data-oid');
          if (opened[tk] && !itemsBy[id]) { draw(); itemsBy[id] = await A().orderItems([id]); }
          draw();
        } else if (b.hasAttribute('data-approve')) {
          b.disabled = true; await A().reviewOrder(tk, 'APPROVE'); ctx.toast(t('saved')); await load(); draw();
        } else if (b.hasAttribute('data-ask')) { pending = { ticket: tk, kind: b.getAttribute('data-ask') }; draw(); }
        else if (b.hasAttribute('data-back')) { pending = null; draw(); }
        else if (b.hasAttribute('data-confirm')) {
          var reason = card.querySelector('[data-reason]').value.trim();
          if (pending.kind === 'cancel') {
            if (reason.length < 3) { ctx.toast(t('oa_reason_short')); return; }
            b.disabled = true; await A().cancelOrder(tk, reason);
          } else { b.disabled = true; await A().reviewOrder(tk, 'REJECT', reason); }
          pending = null; ctx.toast(t('saved')); await load(); draw();
        }
      } catch (e) { console.error('[MM owner order]', e); ctx.toast(errText(e)); if (b) b.disabled = false; }
    };
  };

  /* ================= Team: waiters, kitchen, logins ================= */
  P.team = async function (box, ctx) {
    var esc = ctx.esc, waiters = [], kitchen = null;
    async function loadW() { waiters = await A().listWaiters(true); }
    function drawW() {
      var h = '<form class="oa-addrow" data-wadd><input name="name" maxlength="80" required autocomplete="off" placeholder="' +
        esc(t('oa_waiter_name')) + '" aria-label="' + esc(t('oa_waiter_name')) + '"><button type="submit" class="btn btn-sm btn-primary">' +
        esc(t('oa_add')) + '</button></form>';
      if (!waiters.length) h += '<div class="empty">' + esc(t('oa_no_waiters')) + '</div>';
      waiters.forEach(function (w) {
        h += '<div class="tbl-row" data-w="' + esc(w.waiter_code) + '"><strong>' + esc(w.waiter_code) + '</strong>' +
          '<input data-wname maxlength="80" value="' + esc(w.display_name) + '" aria-label="' + esc(t('oa_waiter_name')) + '">' +
          '<button type="button" class="btn btn-sm" data-wsave>' + esc(t('save')) + '</button>' +
          '<button type="button" class="btn btn-sm btn-soft" data-wtoggle data-active="' + (w.active ? '1' : '0') + '">' +
          esc(t(w.active ? 'oa_deactivate' : 'oa_activate')) + '</button>' +
          '<span class="chip ' + (w.active ? 'free' : 'off') + '">' + esc(t(w.active ? 'oa_active' : 'oa_inactive')) + '</span></div>';
      });
      box.querySelector('#oa-waiters').innerHTML = h;
    }
    function drawK() {
      var el = box.querySelector('#oa-kitchen'), h = '';
      if (!kitchen) { el.innerHTML = '<div class="empty">' + esc(t('offline')) + '</div>'; return; }
      h += '<div class="oa-stats"><div class="oa-stat static"><span>' + esc(t('oa_new')) + '</span><strong>' + kitchen.lanes.NEW + '</strong></div>' +
        '<div class="oa-stat static"><span>' + esc(t('oa_preparing')) + '</span><strong>' + kitchen.lanes.PREPARING + '</strong></div>' +
        '<div class="oa-stat static"><span>' + esc(t('oa_ready')) + '</span><strong>' + kitchen.lanes.READY + '</strong></div></div>';
      h += '<p class="muted small">' + esc(kitchen.soldOut.length ? t('oa_sold_out') + ': ' + kitchen.soldOut.join(', ') : t('oa_none_sold_out')) +
        ' · <a href="#" data-go="menu">' + esc(t('nav_menu')) + '</a></p>';
      el.innerHTML = h;
    }
    box.innerHTML = head(esc, 'oa_team') +
      '<h3 class="oa-sub">' + esc(t('oa_waiters')) + '</h3><div id="oa-waiters"></div>' +
      '<h3 class="oa-sub">' + esc(t('oa_kitchen')) + '</h3><div id="oa-kitchen"></div>' +
      '<h3 class="oa-sub">' + esc(t('oa_logins')) + '</h3>' +
      '<table class="oa-matrix"><thead><tr><th></th><th>' + esc(t('owner')) + '</th><th>' + esc(t('waiter')) + '</th><th>' + esc(t('kitchen')) +
      '</th></tr></thead><tbody>' +
      [['oa_cap_owner', 1, 0, 0], ['oa_cap_payments', 1, 0, 0], ['oa_cap_visits', 1, 1, 0], ['oa_cap_orders', 1, 1, 1], ['oa_cap_prices', 1, 0, 0], ['oa_cap_soldout', 1, 0, 1]]
        .map(function (r) {
          return '<tr><td>' + esc(t(r[0])) + '</td>' + [1, 2, 3].map(function (i) { return '<td>' + (r[i] ? '✓' : '—') + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>' +
      blocked(esc, t('oa_logins_blocked_t'), t('oa_logins_blocked'));
    var r = await Promise.all([settle(loadW()), settle(A().staffOrders(true)), settle(A().loadMenu())]);
    if (r[0].ok) drawW(); else box.querySelector('#oa-waiters').innerHTML = '<div class="empty">' + esc(t('offline')) + '</div>';
    if (r[1].ok && r[2].ok) {
      var lanes = { NEW: 0, PREPARING: 0, READY: 0 };
      r[1].value.forEach(function (o) { if (lanes[U(o.status)] != null) lanes[U(o.status)]++; });
      kitchen = { lanes: lanes, soldOut: (r[2].value.items || []).filter(function (i) { return i.is_available === false; }).map(function (i) { return i.name; }) };
    }
    drawK();
    box.onclick = async function (ev) {
      var g = ev.target.closest('[data-go]'); if (g) { ev.preventDefault(); ctx.go(g.getAttribute('data-go')); return; }
      var b = ev.target.closest('button'); if (!b) return;
      var row = b.closest('[data-w]'), code = row && row.getAttribute('data-w');
      try {
        if (b.hasAttribute('data-wsave')) {
          b.disabled = true; await A().saveWaiter(row.querySelector('[data-wname]').value, code);
          ctx.toast(t('saved')); await loadW(); drawW();
        } else if (b.hasAttribute('data-wtoggle')) {
          b.disabled = true; await A().setWaiterActive(code, b.getAttribute('data-active') !== '1');
          ctx.toast(t('saved')); await loadW(); drawW();
        }
      } catch (e) { console.error('[MM owner waiter]', e); ctx.toast(errText(e)); b.disabled = false; }
    };
    box.onsubmit = async function (ev) {
      var f = ev.target.closest('[data-wadd]'); if (!f) return;
      ev.preventDefault();
      var name = f.elements.name.value.trim(); if (!name) return;
      try { await A().saveWaiter(name, null); f.reset(); ctx.toast(t('saved')); await loadW(); drawW(); }
      catch (e) { console.error('[MM owner waiter]', e); ctx.toast(errText(e)); }
    };
  };

  /* ================= Reviews ================= */
  P.reviews = async function (box, ctx) {
    var esc = ctx.esc, list = [], askDelete = null;
    async function load() { list = await A().ownerReviews(); }
    function stars(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
    function draw() {
      var pub = list.filter(function (x) { return x.status === 'published'; });
      var avg = pub.length ? (pub.reduce(function (s, x) { return s + x.rating; }, 0) / pub.length).toFixed(1) : '—';
      var h = head(esc, 'nav_reviews') + '<p class="muted small">' + esc(t('oa_reviews_summary', { avg: avg, n: pub.length })) + '</p>';
      if (!list.length) h += '<div class="empty">' + esc(t('oa_no_reviews')) + '</div>';
      list.forEach(function (x) {
        h += '<div class="order-card" data-rv="' + esc(x.id) + '"><div class="order-head"><strong>' + esc(x.display_name) +
          '</strong><span class="badge">' + esc(t('oa_rv_' + x.status)) + '</span></div>' +
          '<div class="oa-stars" aria-label="' + esc(x.rating) + '/5">' + stars(x.rating) + '</div>' +
          (x.comment ? '<div>' + esc(x.comment) + '</div>' : '') +
          '<div class="muted small">' + (x.table_number ? esc(t('oa_table')) + ' ' + esc(x.table_number) + ' · ' : '') + esc(timeOf(x.created_at)) + '</div>' +
          '<div class="oa-actions">' +
          (x.status !== 'published' ? '<button type="button" class="btn btn-sm btn-primary" data-rvset="published">' + esc(t('oa_publish')) + '</button>' : '') +
          (x.status !== 'hidden' ? '<button type="button" class="btn btn-sm btn-soft" data-rvset="hidden">' + esc(t('oa_hide')) + '</button>' : '') +
          '<button type="button" class="btn btn-sm btn-soft" data-rvdel>' + esc(t('oa_delete')) + '</button></div>' +
          (askDelete === x.id ? '<div class="oa-confirm"><span class="small">' + esc(t('oa_delete_review_q')) + '</span><div class="oa-actions">' +
            '<button type="button" class="btn btn-sm btn-primary" data-rvdel-yes>' + esc(t('oa_delete_forever')) + '</button>' +
            '<button type="button" class="btn btn-sm btn-soft" data-back>' + esc(t('back')) + '</button></div></div>' : '') + '</div>';
      });
      box.innerHTML = h;
    }
    await load(); draw();
    box.onclick = async function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var card = b.closest('[data-rv]'), id = card && card.getAttribute('data-rv');
      try {
        if (b.hasAttribute('data-rvset')) { b.disabled = true; await A().setReviewStatus(id, b.getAttribute('data-rvset')); ctx.toast(t('saved')); await load(); draw(); }
        else if (b.hasAttribute('data-rvdel')) { askDelete = id; draw(); }
        else if (b.hasAttribute('data-back')) { askDelete = null; draw(); }
        else if (b.hasAttribute('data-rvdel-yes')) { b.disabled = true; await A().deleteReview(id); askDelete = null; ctx.toast(t('saved')); await load(); draw(); }
      } catch (e) { console.error('[MM owner review]', e); ctx.toast(errText(e)); b.disabled = false; }
    };
  };

  /* ================= Places to Visit (no backend) ================= */
  P.places = async function (box, ctx) {
    var esc = ctx.esc;
    box.innerHTML = head(esc, 'nav_places') + blocked(esc, t('oa_blocked'), t('oa_places_blocked'));
  };

  /* ================= Sales reports ================= */
  P.reports = async function (box, ctx) {
    var esc = ctx.esc, day = istDay(0);
    async function draw() {
      var days = []; for (var i = 0; i < 7; i++) days.push(istDay(-i));
      var res = await Promise.all(days.map(function (d) { return settle(A().accountsSummary(d)); }));
      var rows = res.map(function (r, i) { return r.ok ? Object.assign({ day: days[i] }, r.value) : { day: days[i], failed: true }; });
      var sel = null;
      var one = await settle(A().accountsSummary(day));
      sel = one.ok ? one.value : null;
      var h = head(esc, 'oa_reports', '<input type="date" data-day max="' + istDay(0) + '" value="' + esc(day) + '" aria-label="' + esc(t('oa_day')) + '">');
      if (sel) {
        h += '<div class="oa-stats">' +
          [['oa_sales_today', money(sel.paid_sales)], ['oa_orders_today', sel.order_count], ['oa_paid_orders', sel.paid_count],
            ['oa_unpaid', money(sel.pending_value)], ['oa_cancelled', sel.cancelled_count + ' · ' + money(sel.cancelled_value)],
            ['oa_complimentary', sel.complimentary_count + ' · ' + money(sel.complimentary_value)]].map(function (c) {
            return '<div class="oa-stat static"><span>' + esc(t(c[0])) + '</span><strong>' + esc(c[1]) + '</strong></div>';
          }).join('') + '</div>';
      } else h += '<div class="empty">' + esc(t('offline')) + '</div>';
      h += '<h3 class="oa-sub">' + esc(t('oa_last7')) + '</h3><div class="oa-scroll"><table class="oa-matrix"><thead><tr><th>' + esc(t('oa_day')) + '</th><th>' +
        esc(t('oa_orders_today')) + '</th><th>' + esc(t('oa_sales_today')) + '</th><th>' + esc(t('oa_cancelled')) + '</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return r.failed ? '<tr><td>' + esc(r.day) + '</td><td colspan="3">—</td></tr>' :
            '<tr><td>' + esc(r.day) + '</td><td>' + esc(r.order_count) + '</td><td>' + money(r.paid_sales) + '</td><td>' + esc(r.cancelled_count) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="oa-actions"><button type="button" class="btn btn-sm btn-soft" data-csv>' + esc(t('oa_export_csv')) + '</button></div>';
      if (sel && sel.recent_audit && sel.recent_audit.length) {
        h += '<h3 class="oa-sub">' + esc(t('oa_audit')) + '</h3>' + sel.recent_audit.slice(0, 10).map(function (a) {
          return '<div class="muted small oa-audit">' + esc(timeOf(a.created_at)) + ' · ' + esc(a.action) + ' · ' + esc(a.ticket_id || '') +
            (a.reason ? ' · ' + esc(a.reason) : '') + '</div>';
        }).join('');
      }
      box.innerHTML = h;
      box._rows = rows;
    }
    await draw();
    box.onchange = function (ev) {
      var d = ev.target.closest('[data-day]');
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d.value)) { day = d.value; draw().catch(function (e) { console.error('[MM owner]', e); }); }
    };
    box.onclick = function (ev) {
      if (!ev.target.closest('[data-csv]')) return;
      var csv = 'day,orders,paid_sales,cancelled\n' + (box._rows || []).filter(function (r) { return !r.failed; }).map(function (r) {
        return [r.day, r.order_count, r.paid_sales, r.cancelled_count].join(',');
      }).join('\n') + '\n';
      download('mirch-masaala-sales-' + istDay(0) + '.csv', csv, 'text/csv');
    };
  };

  /* ================= Notifications ================= */
  P.alerts = async function (box, ctx) {
    var esc = ctx.esc, list = [];
    async function load() { list = await A().notifications(50, ''); }
    function draw() {
      var h = head(esc, 'oa_alerts', '<button type="button" class="btn btn-sm btn-soft" data-refresh>' + esc(t('refresh')) + '</button>');
      if (!list.length) h += '<div class="empty">' + esc(t('oa_no_alerts')) + '</div>';
      list.forEach(function (n) {
        h += '<div class="order-card compact" data-n="' + esc(n.id) + '"><div class="order-head"><strong>' + esc(n.notification_type || '') +
          '</strong><span class="muted small">' + esc(timeOf(n.created_at)) + '</span></div><div>' + esc(n.message || '') + '</div>' +
          (n.table_number ? '<div class="muted small">' + esc(t('oa_table')) + ' ' + esc(n.table_number) + '</div>' : '') +
          '<div class="oa-actions"><button type="button" class="btn btn-sm btn-soft" data-resolve>' + esc(t('oa_resolve')) + '</button></div></div>';
      });
      box.innerHTML = h;
    }
    await load(); draw();
    box.onclick = async function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      try {
        if (b.hasAttribute('data-refresh')) { await load(); draw(); }
        else if (b.hasAttribute('data-resolve')) { b.disabled = true; await A().resolveNotification(b.closest('[data-n]').getAttribute('data-n')); await load(); draw(); }
      } catch (e) { console.error('[MM owner alert]', e); ctx.toast(errText(e)); b.disabled = false; }
    };
  };

  /* ================= Backup, restore, reset ================= */
  P.backup = async function (box, ctx) {
    var esc = ctx.esc, backedUp = false, status = null, result = '';
    async function load() { status = await A().maintenanceStatus(); }
    function ago(iso) { return iso ? timeOf(iso) : t('oa_never'); }
    function draw() {
      var days = status && status.last_backup_at ? Math.floor((Date.now() - new Date(status.last_backup_at).getTime()) / 86400e3) : null;
      var stale = days == null || days >= 10;
      var h = head(esc, 'oa_backup');
      h += '<div class="oa-stats"><div class="oa-stat static ' + (stale ? 'warn' : '') + '"><span>' + esc(t('oa_last_backup')) + '</span><strong>' +
        esc(ago(status && status.last_backup_at)) + '</strong></div>' +
        '<div class="oa-stat static"><span>' + esc(t('oa_last_reset')) + '</span><strong>' + esc(ago(status && status.last_reset_at)) + '</strong></div></div>';
      if (stale) h += '<div class="oa-note warn static">' + esc(days == null ? t('oa_backup_never') : t('oa_backup_days', { n: days })) + '</div>';
      h += '<p class="muted small">' + esc(t('oa_backup_info')) + '</p>' +
        '<div class="oa-actions"><button type="button" class="btn btn-primary" data-export>' + esc(t('oa_download_backup')) + '</button></div>';
      h += '<h3 class="oa-sub">' + esc(t('oa_restore')) + '</h3>' + blocked(esc, t('oa_blocked'), t('oa_restore_blocked'));
      h += '<h3 class="oa-sub">' + esc(t('oa_reset')) + '</h3><details class="oa-danger"><summary>' + esc(t('oa_reset_open')) + '</summary>' +
        '<p class="small">' + esc(t('oa_reset_what')) + '</p>' +
        '<p class="small">' + esc(t('oa_reset_keeps')) + '</p>' +
        '<p class="small ' + (backedUp ? 'ok' : 'warn') + '" data-reset-backup>' + esc(t(backedUp ? 'oa_reset_backup_done' : 'oa_reset_backup_needed')) + '</p>' +
        '<label class="small"><span>' + esc(t('oa_reset_type')) + ' <code>RESET MIRCH MASAALA</code></span>' +
        '<input data-reset-phrase autocomplete="off" spellcheck="false"></label>' +
        '<label class="oa-check"><input type="checkbox" data-reset-ack><span>' + esc(t('oa_reset_ack')) + '</span></label>' +
        '<div class="oa-actions"><button type="button" class="btn btn-sm oa-danger-btn" data-reset disabled>' + esc(t('oa_reset_go')) + '</button></div>' +
        (result ? '<p class="small ok" data-reset-result>' + esc(result) + '</p>' : '') + '</details>';
      box.innerHTML = h;
      var d = box.querySelector('details'); if (d && (result || backedUp)) d.open = true;
    }
    function syncReset() {
      var ok = backedUp && box.querySelector('[data-reset-phrase]').value === 'RESET MIRCH MASAALA' && box.querySelector('[data-reset-ack]').checked;
      box.querySelector('[data-reset]').disabled = !ok;
    }
    await load(); draw();
    box.oninput = box.onchange = function (ev) { if (ev.target.closest('[data-reset-phrase],[data-reset-ack]')) syncReset(); };
    box.onclick = async function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      try {
        if (b.hasAttribute('data-export')) {
          b.disabled = true;
          var data = await A().exportBackup();
          download('mirch-masaala-backup-' + istDay(0) + '.json', JSON.stringify(data, null, 2));
          await A().recordBackup(); backedUp = true; await load(); draw(); ctx.toast(t('oa_backup_saved'));
        } else if (b.hasAttribute('data-reset')) {
          var phrase = box.querySelector('[data-reset-phrase]').value;
          b.disabled = true;
          var out = await A().resetBusinessData(phrase, backedUp);
          result = (out && out.message) || t('saved'); backedUp = false; await load(); draw();
        }
      } catch (e) { console.error('[MM owner backup]', e); ctx.toast(errText(e)); b.disabled = false; }
    };
  };

  /* ================= Restaurant settings ================= */
  /* Exactly the columns of mm_restaurant_config (supabase/restaurant-config.sql). */
  var UPI_RE = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,31}$/;
  function validate(v) {
    if (!v.restaurant_name || v.restaurant_name.length > 80) return 'oa_e_name';
    if (v.tagline.length > 80) return 'oa_e_tagline';
    if (v.admin_phone && !/^\+?[0-9 ]{7,18}$/.test(v.admin_phone)) return 'oa_e_phone';
    if (v.whatsapp_number && !/^[0-9]{10,15}$/.test(v.whatsapp_number)) return 'oa_e_whatsapp';
    if (v.upi_id && (v.upi_id.length > 150 || !UPI_RE.test(v.upi_id))) return 'oa_e_upi';
    if (v.phonepe_upi && (v.phonepe_upi.length > 150 || !UPI_RE.test(v.phonepe_upi))) return 'oa_e_upi';
    if (v.google_reviews_url && (v.google_reviews_url.length > 300 || !/^https:\/\/[^\s]+$/i.test(v.google_reviews_url))) return 'oa_e_url';
    if (v.pay_note.length > 200) return 'oa_e_note';
    if (!v.accept_cash && !v.upi_id) return 'oa_e_payment';
    return null;
  }
  P.settings = async function (box, ctx) {
    var esc = ctx.esc;
    A()._configCache = null;
    var cfg = (await A().loadConfig()) || {};
    function f(name, labelKey, extra) {
      return '<label><span>' + esc(t(labelKey)) + '</span><input name="' + name + '" value="' + esc(cfg[name] == null ? '' : cfg[name]) + '" ' + (extra || '') + '></label>';
    }
    function tg(name, key, def) {
      var on = cfg[name] == null ? def : !!cfg[name];
      return '<label class="oa-check"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '><span>' + esc(t(key)) + '</span></label>';
    }
    box.innerHTML = head(esc, 'nav_settings') +
      '<form id="settings-form" class="form oa-form" novalidate>' +
      '<h3 class="oa-sub">' + esc(t('oa_s_identity')) + '</h3>' +
      f('restaurant_name', 'oa_s_name', 'maxlength="80" required') + f('tagline', 'oa_s_tagline', 'maxlength="80"') +
      '<h3 class="oa-sub">' + esc(t('oa_s_contact')) + '</h3>' +
      f('admin_phone', 'oa_s_phone', 'inputmode="tel" maxlength="20"') + f('whatsapp_number', 'whatsapp_number', 'inputmode="numeric" maxlength="15"') +
      f('whatsapp_name', 'oa_s_wa_name', 'maxlength="80"') +
      '<h3 class="oa-sub">' + esc(t('oa_s_payments')) + '</h3>' +
      f('upi_id', 'upi_id', 'maxlength="150" autocapitalize="off" spellcheck="false"') + f('upi_name', 'upi_name', 'maxlength="80"') +
      f('phonepe_upi', 'oa_s_phonepe', 'maxlength="150" autocapitalize="off" spellcheck="false"') + f('pay_note', 'oa_s_paynote', 'maxlength="200"') +
      tg('accept_cash', 'oa_s_cash', true) + tg('accept_card', 'oa_s_card', true) +
      '<h3 class="oa-sub">' + esc(t('oa_s_reviews')) + '</h3>' + f('google_reviews_url', 'google_review_url', 'inputmode="url" maxlength="300" autocapitalize="off"') +
      '<p class="oa-err" id="settings-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn-primary btn-block">' + esc(t('save')) + '</button></form>' +
      blocked(esc, t('oa_s_missing_t'), t('oa_s_missing'));
    var form = box.querySelector('#settings-form');
    form.onsubmit = async function (ev) {
      ev.preventDefault();
      var fd = new FormData(form), v = {}, errEl = box.querySelector('#settings-error');
      ['restaurant_name', 'tagline', 'admin_phone', 'whatsapp_number', 'whatsapp_name', 'upi_id', 'upi_name', 'phonepe_upi', 'pay_note', 'google_reviews_url']
        .forEach(function (k) { v[k] = String(fd.get(k) || '').trim(); });
      v.accept_cash = form.elements.accept_cash.checked; v.accept_card = form.elements.accept_card.checked;
      var bad = validate(v);
      if (bad) { errEl.textContent = t(bad); errEl.hidden = false; return; }
      errEl.hidden = true;
      var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        await A().saveConfig(v);
        var again = await A().loadConfig();      /* read back from the database so the form shows what is stored */
        cfg = again || v; if (ctx.applyBranding) ctx.applyBranding(cfg);
        ctx.toast(t('saved'));
      } catch (e) { console.error('[MM owner settings]', e); ctx.toast(errText(e)); }
      finally { btn.disabled = false; }
    };
  };
})();
