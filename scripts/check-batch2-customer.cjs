'use strict';
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const language = fs.readFileSync('app-language.js', 'utf8');
const css = fs.readFileSync('ui-premium.css', 'utf8');
const checks = [
  ['Places view renders translated content', /function drawPlaces\(\)[\s\S]*?mmI18n\(p\.name, p\.nameMr\)[\s\S]*?mmI18n\(p\.summary, p\.summaryMr\)/.test(html)],
  ['All six local attractions have Marathi content', (html.match(/"nameMr":"/g) || []).length >= 6],
  ['Party occasion values remain canonical English values', /<option value="Birthday">Birthday<\/option>[\s\S]*?<option value="Other celebration">Other celebration<\/option>/.test(html)],
  ['Party form has Marathi translations', /"Plan your celebration":"तुमचा कार्यक्रम आखा"/.test(language) && /"Send party request":"कार्यक्रमाची विनंती पाठवा"/.test(language)],
  ['Customer QR scanner messages are localized', /window\.mmI18n\('Camera unavailable\./.test(html) && /"Camera unavailable\./.test(language)],
  ['Customer order history has Marathi empty state', /window\.mmI18n\('No saved orders on this phone yet'/.test(html)],
  ['Cart has an explicit remove action', /function removeCartItem\(id\)/.test(html) && /onclick="\\?"?removeCartItem/.test(html)],
  ['Customer cart controls have accessible labels', /aria-label="' \+ window\.mmI18n\('Decrease quantity'/.test(html) && /aria-label="' \+ window\.mmI18n\('Increase quantity'/.test(html)],
  ['Customer cart touch targets are at least 44px', /#menu \.qty button, #cart-list \.qty button\s*\{[^}]*width:\s*44px/s.test(css) && /height:\s*44px/.test(css)],
  ['Updated language asset cache key is referenced', /app-language\.js\?v=20261108b2/.test(html)],
  ['Existing backend integration file is not part of this patch', fs.existsSync('supabase-live.js')]
];
let failed = 0;
for (const [name, ok] of checks) { console.log((ok ? '✓ ' : '✗ ') + name); if (!ok) failed++; }
if (failed) process.exit(1);
console.log(`Batch 2 customer checks passed: ${checks.length}`);
