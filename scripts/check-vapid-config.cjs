#!/usr/bin/env node
'use strict';

// Static consistency checks for the Web Push (VAPID) configuration. Public data only:
// this cannot and does not prove that Supabase holds the matching private key. Use
// scripts/verify-vapid-pair.cjs on the machine that has the private key for that.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const { compare } = require('./verify-vapid-pair.cjs');

let failed = 0;
const check = (ok, name, detail) => { if (!ok) failed++; console.log((ok ? '✓ ' : '✗ ') + name + (!ok && detail ? ' — ' + detail : '')); };
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const live = read('supabase-live.js');
const doc = read('supabase/STAFF-PUSH.md');
const edge = read('supabase/functions/send-staff-push/index.ts');

const siteKeys = [...live.matchAll(/WEB_PUSH_VAPID_PUBLIC_KEY\s*=\s*'([^']+)'/g)].map((m) => m[1]);
check(siteKeys.length === 1, 'the website defines exactly one public VAPID key', 'found ' + siteKeys.length);
const siteKey = siteKeys[0] || '';

let validPoint = false;
try {
  const bytes = Buffer.from(siteKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (siteKey.length % 4)) % 4), 'base64');
  validPoint = bytes.length === 65 && bytes[0] === 4 &&
    crypto.ECDH.convertKey(bytes, 'prime256v1', undefined, undefined, 'uncompressed').length === 65;
} catch (e) { validPoint = false; }
check(validPoint, 'the website public key is a valid uncompressed P-256 point');

check(doc.includes(siteKey), 'STAFF-PUSH.md documents the same public key as the website (' + siteKey.slice(0, 8) + '…)');

check(/Deno\.env\.get\("VAPID_PUBLIC_KEY"\)/.test(edge) && /Deno\.env\.get\("VAPID_PRIVATE_KEY"\)/.test(edge) && /Deno\.env\.get\("VAPID_SUBJECT"\)/.test(edge),
  'the Edge Function reads VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT from secrets');
check(!/B[A-Za-z0-9_-]{86}/.test(edge) && !edge.includes(siteKey), 'the Edge Function contains no hard-coded VAPID key');
check(/vapidPublicKey \|\| !vapidPrivateKey|!vapidPublicKey \|\| !vapidPrivateKey/.test(edge.replace(/\s+/g, ' ')) && /503/.test(edge),
  'the Edge Function refuses to send (503) when a VAPID secret is missing');
check(/origin !== ALLOWED_ORIGIN/.test(edge) && /push_dispatch_token/.test(edge), 'the Edge Function still enforces its origin and one-time-token checks');
check(!/--no-verify-jwt/.test(doc) || /Verify JWT/i.test(doc), 'the documentation states the JWT setting the function needs');

// A committed private key would be a security incident. Scan every tracked file.
let files = [];
try { files = execSync('git ls-files', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).split('\n').filter(Boolean); } catch (e) { /* not a git checkout */ }
const secretPattern = /(VAPID_PRIVATE_KEY|vapidPrivateKey|privateKey)["'`]?\s*[:=]\s*["'`][A-Za-z0-9_-]{43}["'`]|SUPABASE_SERVICE_ROLE_KEY["'`]?\s*[:=]\s*["'`]eyJ/;
const offenders = files.filter((f) => !/\.(png|jpg|jpeg|webp|ico|svg)$/i.test(f)).filter((f) => {
  try { return secretPattern.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')); } catch (e) { return false; }
});
check(offenders.length === 0, 'no VAPID private key or service-role key is committed', offenders.join(', '));

// Unit-test the key-pair verifier with throwaway in-memory keys (never printed or stored).
const a = crypto.createECDH('prime256v1'); a.generateKeys();
const b = crypto.createECDH('prime256v1'); b.generateKeys();
const aPub = a.getPublicKey().toString('base64url');
check(compare(aPub, a.getPrivateKey().toString('base64url')) === true, 'verify-vapid-pair accepts a matching key pair');
check(compare(aPub, b.getPrivateKey().toString('base64url')) === false, 'verify-vapid-pair rejects a non-matching private key');

console.log(failed ? '\n' + failed + ' VAPID configuration check(s) failed.' : '\nVAPID configuration checks passed.');
process.exit(failed ? 1 : 0);
