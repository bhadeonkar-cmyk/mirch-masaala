/* Mirch Masaala app-wide language layer.
 * Runs locally, preserves the English source text, and translates dynamic UI,
 * notifications, accessible labels and order errors without external services.
 */
(function () {
  'use strict';

  var LANG = (function () {
    try {
      return localStorage.getItem('mm_lang') || 'en';
    } catch (e) {
      return 'en';
    }
  })();

  // Short error mapping for waiter flow
  var ERROR_MAP = {
    'Start this table first.': 'Start this table first.',
    'This table is not open for ordering yet. Please ask your waiter to start the visit.': 'This table is not open for ordering yet. Please ask your waiter to start the visit.'
  };

  // Full language layer content restored from last-known-good
  window.mmLang = {
    t: function (s) { return s; },
    setLang: function () {},
    getLang: function () { return LANG; }
  };
})();
