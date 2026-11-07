/* P0 lifecycle overlay — visit panel, staff payment, finish/release
 * Loads after js/app.js. Reuses MM.api / MM.t / escapeHtml.
 */
(function () {
  'use strict';
  if (!window.MM || !MM.api) return;
  var api = MM.api;
  var $ = function (id) { return document.getElementById(id); };
  var escapeHtml = MM.escapeHtml || function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2800);
  }
  function settle(promise) {
    return Promise.resolve(promise).then(
      function (v) { return { ok: true, value: v }; },
      function (e) { console.error('[MM p0]', e); return { ok: false, error: e }; }
    );
  }
  /* A database refusal (e.g. "still has food tickets in progress") is more useful to staff than a
   * generic retry message. Network failures carry no database code, so they keep the generic text. */
  function reason(e, fallback) {
    var m = e && e.code && e.message ? String(e.message) : '';
    return m && m.length <= 160 ? m : fallback;
  }
  function billAmount(bill) {
    if (!bill) return 0;
    var n = Number(bill.amount != null ? bill.amount : (bill.balance != null ? bill.balance : (bill.due != null ? bill.due : bill.total)));
    return isFinite(n) ? n : 0;
  }

  /* opts (optional): { panel: element to render into, onBack: function }. Without opts this is the
   * waiter's table-visit panel exactly as before; the Owner → Payments tab passes its own panel. */
  async function showOpenVisit(tableNum, visit, opts) {
    opts = opts || {};
    var panel = opts.panel || $('waiter-visit');
    var tablesView = opts.panel ? null : $('waiter-tables-view');
    if (!panel) return;
    function leave() {
      if (typeof opts.onBack === 'function') { opts.onBack(); return; }
      panel.hidden = true;
      panel.innerHTML = '';
      if (tablesView) tablesView.hidden = false;
      if (typeof window.__mmShowWaiter === 'function') window.__mmShowWaiter();
      else location.reload();
    }
    if (tablesView) tablesView.hidden = true;
    panel.hidden = false;
    panel.innerHTML = '<div class="loading">' + (MM.t ? MM.t('loading') : 'Loading…') + '</div>';

    var visitId = visit && (visit.visit_id || visit.id || visit.table_visit_id) || null;
    var amount = 0;
    if (visitId) {
      var br = await settle(api.visitBill(visitId));
      if (br.ok) amount = billAmount(br.value);
    }

    var t = MM.t || function (k) { return k; };
    var html = '<div class="order-card">' +
      '<div class="order-head"><strong>T' + escapeHtml(tableNum) + '</strong>' +
      '<span class="badge">' + escapeHtml(t('st_open')) + '</span></div>';
    if (visit && visit.assigned_waiter_code) {
      html += '<div class="muted small">' + escapeHtml(visit.assigned_waiter_code) + '</div>';
    }
    html += '<div class="cart-total-row"><span>' + escapeHtml(t('amount_due')) + '</span>' +
      '<strong>₹' + Math.round(amount) + '</strong></div>';
    /* mm_staff_record_visit_payment accepts the Owner/Counter (admin) login only, so a waiter is
     * not offered buttons that the database would always reject. The owner records payments from
     * Owner → Payments. */
    if ((MM.state && MM.state.role) === 'admin') {
      html += '<div class="home-secondary" style="margin-top:12px">';
      html += '<button type="button" class="btn btn-primary" data-pay-method="cash" ' +
        (amount <= 0 ? 'disabled' : '') + '>' + escapeHtml(t('confirm_cash')) + '</button>';
      html += '<button type="button" class="btn btn-soft" data-pay-method="upi" ' +
        (amount <= 0 ? 'disabled' : '') + '>' + escapeHtml(t('confirm_upi')) + '</button>';
      html += '</div>';
    } else if (amount > 0) {
      html += '<p class="muted small" style="margin-top:12px">' + escapeHtml(t('waiter_counter_note')) + '</p>';
    }
    html += '<div class="home-secondary" style="margin-top:12px">';
    html += '<button type="button" class="btn btn-primary" data-finish="1">' + escapeHtml(t('finish_visit')) + '</button>';
    html += '<button type="button" class="btn btn-soft" data-release="1">' + escapeHtml(t('release_table')) + '</button>';
    html += '</div>';
    html += '<button type="button" class="btn btn-soft btn-block" style="margin-top:12px" data-visit-back="1">' +
      escapeHtml(t('back') || 'Back') + '</button>';
    html += '<p class="muted small" id="visit-action-msg" style="margin-top:8px"></p></div>';
    panel.innerHTML = html;

    panel.onclick = async function (ev) {
      var target = ev.target;
      if (target.closest('[data-visit-back]')) {
        leave();
        return;
      }
      var payBtn = target.closest('[data-pay-method]');
      if (payBtn && !payBtn.disabled) {
        if (!visitId) { toast(t('visit_failed')); return; }
        var method = payBtn.getAttribute('data-pay-method');
        if (!confirm((method === 'cash' ? t('confirm_cash') : t('confirm_upi')) + ' — ₹' + Math.round(amount) + '?')) return;
        payBtn.disabled = true;
        try {
          await api.recordPayment(visitId, amount, method, method === 'cash' ? 'Cash at table' : 'UPI confirmed by staff');
          toast(t('payment_recorded'));
          var msg = $('visit-action-msg');
          if (msg) msg.textContent = t('payment_recorded') + ' ₹' + Math.round(amount);
          showOpenVisit(tableNum, visit, opts);
        } catch (e) {
          console.error('[MM p0 recordPayment]', e);
          payBtn.disabled = false;
          toast(reason(e, t('something_wrong')));
        }
        return;
      }
      var fin = target.closest('[data-finish]');
      if (fin) {
        if (!confirm(t('finish_visit') + ' T' + tableNum + '?')) return;
        fin.disabled = true;
        try {
          await api.finishVisit(tableNum);
          toast(t('released') || t('visit_started'));
          leave();
        } catch (e) {
          console.error('[MM p0 finish]', e);
          fin.disabled = false;
          toast(reason(e, t('visit_failed')));
        }
        return;
      }
      var rel = target.closest('[data-release]');
      if (rel) {
        /* Releasing frees the table even with money still owed (the database records "guest left unpaid"
         * and alerts the owner), so say so before the click is final. */
        var relMsg = t('release_table') + ' T' + tableNum + '?' +
          (amount > 0 ? '\n\n' + t('release_unpaid_warn', { amt: Math.round(amount) }) : '');
        if (!confirm(relMsg)) return;
        rel.disabled = true;
        try {
          await api.releaseAbandoned(tableNum, 'Guest left before checkout');
          toast(t('released'));
          leave();
        } catch (e) {
          console.error('[MM p0 release]', e);
          rel.disabled = false;
          toast(reason(e, t('visit_failed')));
        }
      }
    };
  }

  function install() {
    document.body.addEventListener('click', function (ev) {
      var btn = ev.target.closest('#waiter-tables .table-card[data-open="1"]');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      var num = btn.getAttribute('data-table');
      (async function () {
        var visitsR = await settle(api.tableVisits());
        var visits = visitsR.ok ? visitsR.value : [];
        var visit = null;
        (visits || []).forEach(function (v) {
          var tn = api.pad2(v.table_number || v.tableNumber);
          if (tn === api.pad2(num)) visit = v;
        });
        showOpenVisit(num, visit);
      })();
    }, true);
    window.__mmShowOpenVisit = showOpenVisit;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(install, 0); });
  } else {
    setTimeout(install, 0);
  }
})();
