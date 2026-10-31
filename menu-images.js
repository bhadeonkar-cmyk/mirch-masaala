/* Mirch Masaala — menu artwork map.
 *
 * ONE place that connects a menu item to its picture:
 *
 *     canonical item id  ->  file in ./menu-images/  (320px WebP, built by scripts/build-menu-images.py)
 *
 * The key is the canonical item id (1-106) from the bundled menu. supabase-live.js keeps that id
 * on the live database rows, so this works for English and Marathi, and never depends on
 * a translated or edited display name. Items the owner adds later get an id of 10000+ and,
 * like any id missing below, fall back to the built-in dish illustration. A picture set on an
 * item in the database (image_url) always wins over this map.
 *
 * Shared pictures (a deliberate, visually reasonable reuse) are marked "shared".
 * Items with no picture at all are listed at the bottom as comments.
 */
(function () {
  'use strict';

  var MENU_IMAGES = {
    // Soup & Starters
    1: 'manchow-soup-chicken', 2: 'manchow-soup-veg',
    3: 'hot-sour-soup-chicken', 4: 'hot-sour-soup-veg',
    5: 'alani-soup-mutton', 6: 'alani-soup-chicken', 7: 'mutton-paya-soup',
    8: 'green-salad', 9: 'masala-papad', 10: 'fry-papad', 11: 'roasted-papad',
    // Beverages
    12: 'mineral-water', 13: 'soft-drink-big', 14: 'soft-drink-small',
    // Mutton Starters
    15: 'mutton-raan', 16: 'mutton-boti-kebab', 17: 'mutton-kharda-starter',
    18: 'mutton-fry', 19: 'mutton-ukad', 20: 'wajadi-fry',
    // Chicken Starters
    21: 'chicken-raan', 22: 'chicken-tikka', 23: 'chicken-banjara-tikka',
    24: 'chicken-hariyali-tikka', 25: 'chicken-kharda-starter', 26: 'chicken-fry',
    27: 'chicken-ukad', 28: 'chicken-koliwada-fry', 29: 'chicken-chilli-dry',
    30: 'chicken-manchurian-dry', 31: 'chicken-65-dry',
    // Veg Starters
    32: 'paneer-tikka', 33: 'paneer-banjara-tikka', 34: 'paneer-hariyali-tikka',
    35: 'tandoori-mushroom', 36: 'palak-paneer-shami-kebab', 37: 'kothimbir-vadi',
    38: 'thalipeeth', 39: 'veg-manchurian-dry', 40: 'paneer-chilli-dry',
    41: 'paneer-manchurian-dry', 42: 'mushroom-chilli-dry', 43: 'mushroom-manchurian-dry',
    // Thali
    44: 'mutton-gawakadchi-thali', 45: 'special-mutton-thali',
    46: 'chicken-gawakadchi-thali', 47: 'special-chicken-thali', 48: 'veg-thali',
    // Non-Veg Main Course
    49: 'mutton-handi-full', 50: 'mutton-handi-half', 51: 'hyderabadi-paya-korma',
    52: 'mutton-kheema-masala', 53: 'mutton-kolhapuri-lonche',
    54: 'mutton-kolhapuri-lonche',                       // shared: no separate Mutton Kolhapuri Curry picture
    55: 'mutton-kharda-main', 56: 'mutton-aalni',
    57: 'chicken-handi-full', 58: 'chicken-handi-half', 59: 'chicken-kolhapuri-curry',
    60: 'chicken-kheema-masala', 61: 'chicken-kolhapuri-lonche', 62: 'chicken-kharda-main',
    63: 'chicken-aalni', 64: 'chicken-tikka-masala',
    // Veg Main Course
    65: 'paneer-butter-masala', 66: 'paneer-bhurji-masala', 67: 'paneer-mirch-masala',
    68: 'paneer-taka-tak', 69: 'veg-kolhapuri', 70: 'veg-amritsari', 71: 'veg-mirch-masala',
    72: 'paneer-mutter', 73: 'mushroom-mutter', 74: 'shevga-masala', 75: 'methi-besan',
    76: 'bharli-vangi', 77: 'pithla', 78: 'dal-fry', 79: 'dal-tadka',
    // Rice & Breads
    80: 'hyderabadi-degh-biryani-mutton', 81: 'hyderabadi-degh-biryani-chicken',
    82: 'alani-rice-mutton', 83: 'alani-rice-chicken',
    84: 'plain-rice-full', 85: 'plain-rice-half', 86: 'jeera-indrayani-rice',
    87: 'schezwan-fried-rice-chicken', 88: 'schezwan-fried-rice-veg', 89: 'schezwan-fried-rice-egg',
    90: 'fried-rice-chicken', 91: 'fried-rice-veg', 92: 'fried-rice-egg',
    93: 'dal-khichdi', 94: 'dal-khichdi-tadka',
    95: 'roti-plain', 96: 'roti-butter', 97: 'roti-garlic',
    98: 'naan-plain', 99: 'naan-butter',
    100: 'naan-plain', 101: 'naan-plain', 102: 'naan-plain',   // shared: garlic / cheese / cheese-garlic naan
    103: 'roti-plain', 104: 'roti-butter'                       // shared: chapati is shown with the roti pictures
    // 105, 106 (Bhakri plain / butter): no picture - a roti is not a bhakri, so the built-in illustration is used.
  };

  var BASE = './menu-images/';

  window.MM_MENU_IMAGES = MENU_IMAGES;
  // Returns the local picture URL for a menu item, or '' when the item has none.
  window.mmMenuImageUrl = function (item) {
    var slug = item && MENU_IMAGES[Number(item.id)];
    return slug ? BASE + slug + '.webp' : '';
  };
})();
