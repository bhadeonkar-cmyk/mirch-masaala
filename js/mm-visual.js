/* Mirch Masaala visual identity — ported from 51e8b2d
 * Customer presentation only. No backend changes.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function dishIllustrationType(item) {
    var name = [item && item.name, item && item.category, item && item.category_name, item && item.menu_category]
      .join(' ').toLowerCase();
    if (/\b(juice|lassi|milkshake|shake|mocktail|soda|soft drink|water|cold coffee)\b/.test(name)) return 'cool-drink';
    if (/\b(tea|chai|coffee|espresso|cappuccino|latte|hot chocolate|hot cocoa)\b/.test(name)) return 'drink';
    if (/\b(ice cream|kulfi|gulab jamun|rasmalai|rasgulla|kheer|shrikhand|dessert|sweet|jalebi|modak|payasam|brownie|cake|halwa)\b/.test(name)) return 'dessert';
    if (/\b(biryani|pulao|pulav|fried rice|rice bowl|khichdi)\b/.test(name)) return 'rice';
    if (/\b(thali|platter|combo meal|meal plate|mini meal)\b/.test(name)) return 'thali';
    if (/\b(dosa|dosai|idli|uttapam|appam|medu vada|sambar idli)\b/.test(name)) return 'south';
    if (/\b(roti|chapati|naan|paratha|parotta|kulcha|phulka|thepla|bhakri)\b/.test(name)) return 'bread';
    if (/\b(samosa|pakoda|pakora|vada pav|pav bhaji|chaat|bhel|pani puri|dahi puri|fries|tikka|kebab|cutlet|sandwich|burger|pizza|spring roll|manchurian|papad|vadi|salad|soup)\b/.test(name)) return 'snack';
    if (/\b(curry|masala|paneer|dal|daal|makhani|korma|handi|butter chicken|kadai|gravy|kofta|sambar|rasam|shahi|bhaji|mutton|chicken|raan|fry)\b/.test(name)) return 'curry';
    return 'signature';
  }

  function dishIllustrationMarkup(item, variant, hidden) {
    item = item || {};
    var type = dishIllustrationType(item);
    var warmDish = type !== 'dessert' && type !== 'cool-drink';
    var steam = warmDish
      ? '<g class="dish-art-steam" fill="none" stroke="#f6d9ac" stroke-width="2.35" stroke-linecap="round" opacity=".78"><path class="steam-a" d="M43 34 C37 28 48 25 43 18"/><path class="steam-b" d="M59 31 C53 25 64 21 59 14"/><path class="steam-c" d="M75 34 C69 28 80 25 75 18"/></g>'
      : '';
    var plate = '<ellipse cx="60" cy="88" rx="37" ry="7" fill="#090706" opacity=".38"/><ellipse cx="60" cy="79" rx="37" ry="14" fill="#e7d4b1" stroke="#f6e8cd" stroke-width="1.5"/><ellipse cx="60" cy="77" rx="30.5" ry="9.5" fill="#382019" stroke="#b99565" stroke-width="1"/>';
    var art = {
      'rice': plate + '<path d="M31 75 Q35 57 49 54 Q60 49 71 55 Q84 60 89 75 Q63 84 31 75Z" fill="#e8b955"/><path d="M35 70 Q43 57 54 58 Q66 55 80 70 Q62 77 35 70Z" fill="#f5d987"/><g fill="#fff0c9"><ellipse cx="46" cy="64" rx="3" ry="1.2" transform="rotate(22 46 64)"/><ellipse cx="57" cy="59" rx="3" ry="1.2" transform="rotate(-28 57 59)"/><ellipse cx="68" cy="64" rx="3" ry="1.2" transform="rotate(15 68 64)"/></g>',
      'curry': '<path d="M27 64 Q28 81 42 85 L78 85 Q92 81 93 64Z" fill="#d7b28a" stroke="#f1d6ad" stroke-width="1.2"/><ellipse cx="60" cy="64" rx="33" ry="13" fill="#b84e2c" stroke="#e2a15c" stroke-width="1.7"/><ellipse cx="60" cy="62" rx="28" ry="9" fill="#d56b35"/><g fill="#f0d09b"><rect x="43" y="56" width="8" height="8" rx="2"/><rect x="60" y="59" width="8" height="8" rx="2"/><rect x="73" y="55" width="7" height="7" rx="2"/></g>',
      'bread': plate + '<ellipse cx="47" cy="69" rx="17" ry="10.5" fill="#c87932" transform="rotate(-14 47 69)"/><ellipse cx="47" cy="67" rx="15" ry="9" fill="#eebc64" transform="rotate(-14 47 67)"/><ellipse cx="70" cy="68" rx="17" ry="10.5" fill="#c87932" transform="rotate(18 70 68)"/><ellipse cx="70" cy="66" rx="15" ry="9" fill="#eebc64" transform="rotate(18 70 66)"/>',
      'snack': plate + '<circle cx="45" cy="66" r="11" fill="#d4893a"/><circle cx="45" cy="66" r="8" fill="#f0c56e"/><circle cx="68" cy="64" r="12" fill="#c45a28"/><circle cx="68" cy="64" r="8.5" fill="#e08a4a"/><circle cx="58" cy="74" r="9" fill="#b84e2c"/>',
      'thali': plate + '<circle cx="45" cy="62" r="10" fill="#b84e2c"/><circle cx="70" cy="60" r="9" fill="#e8b955"/><circle cx="58" cy="72" r="8" fill="#6f8e43"/><circle cx="78" cy="72" r="7" fill="#d56b35"/>',
      'south': plate + '<ellipse cx="60" cy="70" rx="28" ry="8" fill="#f5d987"/><path d="M32 70 Q45 48 60 52 Q75 48 88 70" fill="none" stroke="#e8b955" stroke-width="6" stroke-linecap="round"/><circle cx="48" cy="68" r="6" fill="#b84e2c"/><circle cx="72" cy="68" r="6" fill="#6f8e43"/>',
      'drink': plate + '<rect x="48" y="42" width="24" height="36" rx="4" fill="#c9a66b" stroke="#f0d09b" stroke-width="1.5"/><rect x="52" y="46" width="16" height="28" rx="2" fill="#7a4a28"/><ellipse cx="60" cy="46" rx="12" ry="3" fill="#e7d4b1"/>',
      'cool-drink': plate + '<rect x="50" y="40" width="20" height="38" rx="3" fill="#7eb8d4" stroke="#c5e8f5" stroke-width="1.2"/><rect x="54" y="44" width="12" height="30" rx="2" fill="#4a9ec2"/><circle cx="58" cy="55" r="1.5" fill="#fff" opacity=".6"/><circle cx="64" cy="62" r="1.2" fill="#fff" opacity=".5"/>',
      'dessert': plate + '<ellipse cx="60" cy="70" rx="22" ry="10" fill="#e7d4b1"/><path d="M42 70 Q50 48 60 52 Q70 48 78 70Z" fill="#d4893a"/><path d="M48 66 Q55 54 60 56 Q65 54 72 66Z" fill="#f0c56e"/><circle cx="56" cy="58" r="2" fill="#c45a28"/><circle cx="64" cy="60" r="2" fill="#c45a28"/>',
      'signature': plate + '<ellipse cx="60" cy="68" rx="24" ry="11" fill="#b84e2c"/><ellipse cx="60" cy="66" rx="18" ry="7" fill="#d56b35"/><g fill="#f0d09b"><circle cx="52" cy="64" r="3"/><circle cx="62" cy="62" r="3.5"/><circle cx="70" cy="66" r="2.5"/></g>'
    };
    var body = art[type] || art.signature;
    var classVariant = variant ? 'dish-art-' + variant : 'dish-art-menu';
    var hide = hidden ? ' style="display:none"' : '';
    return '<span class="dish-art ' + classVariant + ' dish-art--' + type + '"' + hide + ' aria-hidden="true">' +
      '<svg viewBox="0 0 120 100" width="100%" height="100%" focusable="false">' + steam + body + '</svg></span>';
  }

  function dishPhotoUrl(item) {
    if (!item) return '';
    if (typeof window.mmMenuImageUrl === 'function') {
      var u = window.mmMenuImageUrl(item);
      if (u) return u;
    }
    if (item.image_url) return item.image_url;
    return '';
  }

  function dishImageMarkup(item, variant) {
    var url = dishPhotoUrl(item);
    var art = dishIllustrationMarkup(item, variant, !!url);
    if (!url) return art;
    var cls = variant === 'cart' ? 'dish-photo dish-photo-cart' : 'dish-photo';
    return '<img class="' + cls + '" src="' + esc(url) + '" alt="' + esc(item && item.name || '') +
      '" loading="lazy" decoding="async" onerror="this.style.display=\'none\';var n=this.nextElementSibling;if(n)n.style.display=\'flex\'">' + art;
  }

  function emptyPlateMarkup(title, subtitle) {
    return '<div class="empty-state">' +
      '<svg class="empty-plate" viewBox="0 0 120 80" aria-hidden="true" focusable="false">' +
      '<ellipse cx="60" cy="62" rx="44" ry="9" fill="rgba(0,0,0,.35)"/>' +
      '<ellipse cx="60" cy="52" rx="44" ry="16" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<ellipse cx="60" cy="50" rx="30" ry="9" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".6"/>' +
      '</svg><b>' + esc(title || 'Nothing here yet') + '</b>' +
      (subtitle ? '<span>' + esc(subtitle) + '</span>' : '') + '</div>';
  }

  function successPlateMarkup() {
    return '<div class="success-hero" aria-hidden="true">' +
      '<svg class="success-plate" viewBox="0 0 160 110" width="160" height="110" focusable="false">' +
      '<ellipse cx="80" cy="96" rx="52" ry="8" fill="rgba(0,0,0,.35)"/>' +
      '<ellipse cx="80" cy="82" rx="54" ry="18" fill="#e7d4b1" stroke="#f6e8cd" stroke-width="1.5"/>' +
      '<ellipse cx="80" cy="79" rx="42" ry="12" fill="#b84e2c"/>' +
      '<ellipse cx="80" cy="75" rx="35" ry="8.5" fill="#d9a447"/>' +
      '<circle cx="66" cy="73" r="5" fill="#ead19a"/><circle cx="82" cy="71" r="5.5" fill="#8eac68"/><circle cx="96" cy="75" r="5" fill="#e6b956"/>' +
      '<g class="success-steam" fill="none" stroke="#f6d9ac" stroke-width="2.4" stroke-linecap="round">' +
      '<path d="M62 52c-6-6 5-9 0-16"/><path d="M80 48c-6-6 5-9 0-16"/><path d="M98 52c-6-6 5-9 0-16"/></g>' +
      '</svg></div>';
  }

  function categoryIcon(name) {
    var n = String(name || '').toLowerCase();
    return dishIllustrationMarkup({ name: n }, 'cat', false).replace('dish-art-menu', 'dish-art-cat');
  }

  window.MMVisual = {
    dishIllustrationType: dishIllustrationType,
    dishIllustrationMarkup: dishIllustrationMarkup,
    dishImageMarkup: dishImageMarkup,
    dishPhotoUrl: dishPhotoUrl,
    emptyPlateMarkup: emptyPlateMarkup,
    successPlateMarkup: successPlateMarkup,
    categoryIcon: categoryIcon,
    esc: esc
  };
})();
