#!/usr/bin/env node
'use strict';

// Static link smoke test for the GitHub Pages app. It deliberately checks only
// links that can be validated from the source: local resources and in-page IDs.
// Links populated from owner settings (Google reviews, Maps, payment, WhatsApp)
// must be tested with the real configured values.
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const htmlPath = path.join(root, 'index.html');
if (!fs.existsSync(htmlPath)) {
  console.error('Link check failed: run this script from the repository root.');
  process.exit(1);
}
const html = fs.readFileSync(htmlPath, 'utf8');
const errors = [];
const ids = new Set();

for (const match of html.matchAll(/\\bid\\s*=\\s*["']([^"']+)["']/gi)) {
  ids.add(match[1]);
}

// Drop script bodies before scanning tags so JavaScript template strings are
// not mistaken for literal HTML. Keep external script tags so their src is checked.
const tagSource = html.replace(/<script\\b([^>]*)>[\\s\\S]*?<\\/script\\s*>/gi, '<script$1></script>');
const tags = tagSource.match(/<(?:a|link|script|img|source|iframe)\\b[^>]*>/gi) || [];
const refs = [];

function attribute(tag, name) {
  const re = new RegExp('(?:^|\\\\s)' + name + '\\\\s*=\\\\s*(?:"([^"]*)"|\\\'([^\\\']*)\\\'|([^\\\\s>]+))', 'i');
  const m = tag.match(re);
  return m ? (m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])) : null;
}

for (const tag of tags) {
  const tagName = (tag.match(/^<([a-z0-9-]+)/i) || [,''])[1].toLowerCase();
  for (const name of (tagName === 'script' || tagName === 'img' || tagName === 'source' || tagName === 'iframe' ? ['src'] : ['href'])) {
    const value = attribute(tag, name);
    if (value === null || !value.trim()) continue;
    const raw = value.trim();
    if (raw === '#') continue;
    if (/^(?:https?:|mailto:|tel:|data:|javascript:|blob:|\\/\\/)/i.test(raw)) {
      if (/^https?:\\/\\/www\\.onkarfx\\.in(?:[/?#]|$)/i.test(raw)) {
        errors.push('Non-canonical Onkar FX URL: ' + raw + ' (use https://onkarfx.in/)');
      }
      continue;
    }
    if (name === 'href' && raw.startsWith('#')) {
      const id = decodeURIComponent(raw.slice(1));
      if (id && !ids.has(id)) errors.push('Broken in-page link ' + raw);
      continue;
    }
    const pathname = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
    if (!pathname || pathname === '.' || pathname === './') {
      refs.push({ raw, target: 'index.html' });
      continue;
    }
    if (pathname.startsWith('/')) {
      errors.push('Root-absolute local link is unsafe for a GitHub Pages project site: ' + raw);
      continue;
    }
    let target = pathname.replace(/^\\.\\//, '');
    target = path.normalize(target);
    if (target.endsWith(path.sep)) target = path.join(target, 'index.html');
    refs.push({ raw, target });
  }
}

for (const ref of refs) {
  const resolved = path.resolve(root, ref.target);
  if (!resolved.startsWith(root + path.sep) && resolved !== path.join(root, 'index.html')) {
    errors.push('Local link escapes repository: ' + ref.raw);
  } else if (!fs.existsSync(resolved)) {
    errors.push('Missing local link/resource: ' + ref.raw + ' -> ' + ref.target);
  } else if (fs.statSync(resolved).isDirectory() && !fs.existsSync(path.join(resolved, 'index.html'))) {
    errors.push('Local directory has no index.html: ' + ref.raw);
  }
}

if (errors.length) {
  console.error('Link check failed:');
  for (const error of [...new Set(errors)]) console.error(' - ' + error);
  process.exit(1);
}

console.log('Link check passed: ' + refs.length + ' local resources checked, no broken in-page anchors, and no known non-canonical Onkar FX links.');
