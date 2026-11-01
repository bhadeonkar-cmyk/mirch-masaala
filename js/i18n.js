/* Simple English / Marathi dictionary */
window.MM = window.MM || {};
MM.I18N = {
  en: {
    your_order: 'Your current order',
    view: 'View',
    search_food: 'Search food…',
    view_cart: 'View cart',
    your_cart: 'Your cart',
    total: 'Total',
    special_request: 'Any special request?',
    place_order: 'Place order',
    payment: 'Payment',
    choose_payment: 'Choose payment',
    cash_counter: 'Cash / Counter',
    party_booking: 'Party booking',
    name: 'Name',
    phone: 'Phone',
    date: 'Date',
    time: 'Time',
    guests: 'Number of people',
    message: 'Message / requirements',
    send_request: 'Send request',
    order_placed: 'Order placed',
    sent_to_kitchen: 'Your order has been sent to the kitchen.',
    loading_menu: 'Loading menu…',
    no_items: 'No items found',
    add: 'Add',
    preparing: 'Preparing',
    ready: 'Ready',
    received: 'Received',
    please_confirm_counter: 'Please confirm your payment at the counter.',
    booking_sent: 'Booking request sent',
    try_again: 'Try Again'
  },
  mr: {
    your_order: 'तुमची सध्याची ऑर्डर',
    view: 'पहा',
    search_food: 'जेवण शोधा…',
    view_cart: 'कार्ट पहा',
    your_cart: 'तुमचे कार्ट',
    total: 'एकूण',
    special_request: 'काही विशेष विनंती?',
    place_order: 'ऑर्डर द्या',
    payment: 'पेमेंट',
    choose_payment: 'पेमेंट निवडा',
    cash_counter: 'रोख / काउंटर',
    party_booking: 'पार्टी बुकिंग',
    name: 'नाव',
    phone: 'फोन',
    date: 'तारीख',
    time: 'वेळ',
    guests: 'लोकांची संख्या',
    message: 'संदेश / आवश्यकता',
    send_request: 'विनंती पाठवा',
    order_placed: 'ऑर्डर झाली',
    sent_to_kitchen: 'तुमची ऑर्डर किचनला पाठवली आहे.',
    loading_menu: 'मेनू लोड होत आहे…',
    no_items: 'काहीही सापडले नाही',
    add: 'जोडा',
    preparing: 'तयार होत आहे',
    ready: 'तयार',
    received: 'मिळाली',
    please_confirm_counter: 'कृपया काउंटरवर पेमेंट कन्फर्म करा.',
    booking_sent: 'बुकिंग विनंती पाठवली',
    try_again: 'पुन्हा प्रयत्न करा'
  }
};

MM.t = function (key) {
  var lang = (MM.state && MM.state.lang) || 'en';
  var dict = MM.I18N[lang] || MM.I18N.en;
  return dict[key] || MM.I18N.en[key] || key;
};

MM.applyI18n = function () {
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var key = el.getAttribute('data-i18n');
    if (key) el.textContent = MM.t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
    var key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', MM.t(key));
  });
  var btn = document.getElementById('btn-lang');
  if (btn) btn.textContent = MM.state.lang === 'en' ? 'मराठी' : 'English';
};
