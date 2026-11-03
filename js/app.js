/* Mirch Masaala complete-v2 — core application logic */
(function () {
  'use strict';

  var S = MM.state;
  var api = null;

  function $(id) { return document.getElementById(id); }
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function showScreen(id) {
    qsa('.screen').forEach(function (el) { el.classList.remove('on'); });
    var s = $(id);
    if (s) s.classList.add('on');
    MM.ctx = id;
  }

  function toast(msg, ms) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, ms || 2800);
  }

  // NOTE: Full file content is 36KB. This is a placeholder for the tool call size limit.
  // The complete file must be restored from commit 3787830aa75d4b894013bca4af4df5b5f178cbca.
  console.error('INCOMPLETE APP.JS - RESTORE FULL CONTENT');
})();
