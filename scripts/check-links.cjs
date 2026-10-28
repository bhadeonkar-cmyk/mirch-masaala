#!/usr/bin/env node
'use strict';

// Static link smoke test for the GitHub Pages app. This checks local resources
// and in-page fragment targets. URLs populated from owner settings (Maps, review,
// payment, WhatsApp) require runtime verification with their configured values.
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

for (const match of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
  ids.add(match[1]);
}

// Keep external script tags but remove inline script bodies before scanning HTML
// tags, so HTML-looking strings inside JavaScript are not treated as live links.
const tagSource = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, '<script$1></script>');
const tags = tagSource.match(/<(?:a|link|script|img|source|iframe)\b[^>]*>/gi) || [];
const refs = [];

function attributes(tag) {
  const result = Object.create(null);
  for (const match of tag.matchAll(/([^\s=]+)\s*=\s*("(?:[^"]*)"|'(?:[^']*)'|[^\s>]+)/g)) {
    const raw = match[2];
    result[match[1].toLowerCase()] = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'")
      ? raw.slice(1, -1)
      : raw;
  }
  return result;
}

for (const tag of tags) {
  const tagName = (tag.match(/^<([a-z0-9-]+)/i) || [, ''])[1].toLowerCase();
  const attrs = attributes(tag);
  const name = ['script', 'img', 'source', 'iframe'].includes(tagName) ? 'src' : 'href';
  const value = attrs[name];
  if (value == null || !value.trim()) continue;

  const raw = value.trim();
  if (raw === '#') continue;

  if (/^(?:https?:|mailto:|tel:|data:|javascript:|blob:|\/\/)/i.test(raw)) {
    if (/^https?:\/\/www\.onkarfx\.in(?:[/?#]|$)/i.test(raw)) {
      errors.push('Non-canonical Onkar FX URL: ' + raw + ' (use https://onkarfx.in/)');
    }
    continue;
  }

  if (name === 'href' && raw.startsWith('#')) {
    let id = raw.slice(1);
    try { id = decodeURIComponent(id); } catch (e) {}
    if (id && !ids.has(id)) errors.push('Broken in-page link ' + raw);
    continue;
  }

  let pathname = raw.split(/[?#]/, 1)[0];
  try { pathname = decodeURIComponent(pathname); } catch (e) {}
  if (!pathname || pathname === '.' || pathname === './') {
    refs.push({ raw, target: 'index.html' });
    continue;
  }
  if (pathname.startsWith('/')) {
    errors.push('Root-absolute local link is unsafe for a GitHub Pages project site: ' + raw);
    continue;
  }

  const target = path.normalize(pathname.replace(/^\.\//, ''));
  refs.push({ raw, target: target.endsWith(path.sep) ? path.join(target, 'index.html') : target });
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
