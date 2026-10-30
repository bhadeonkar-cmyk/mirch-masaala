#!/usr/bin/env node
'use strict';

// Checks, on YOUR computer, whether a VAPID private key belongs to a given public key.
// It never prints, logs or writes the private key, and it needs no network access.
//
//   Public key  : taken from supabase-live.js (what the website uses), or pass --public <key>
//   Private key : read from the VAPID_PRIVATE_KEY environment variable, or from a hidden prompt
//
// Examples (bash/zsh; the leading space keeps the command out of shell history on most setups):
//    read -rs VAPID_PRIVATE_KEY && export VAPID_PRIVATE_KEY && node scripts/verify-vapid-pair.cjs
//    node scripts/verify-vapid-pair.cjs --public BH8rULqi...   (to test the key currently on main)
//
// Output is only MATCH or MISMATCH plus public-key prefixes. Exit code 0 = match, 1 = mismatch, 2 = bad input.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function b64urlToBuffer(value) {
  const s = String(value || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
}

function publicFromPrivate(privateKey) {
  const raw = b64urlToBuffer(privateKey);
  if (raw.length !== 32) throw new Error('A VAPID private key must decode to exactly 32 bytes (about 43 URL-safe base64 characters).');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(raw);
  return ecdh.getPublicKey(); // 65-byte uncompressed point
}

function compare(publicKey, privateKey) {
  const expected = b64urlToBuffer(publicKey);
  if (expected.length !== 65 || expected[0] !== 0x04) throw new Error('The public key is not a 65-byte uncompressed P-256 key.');
  const derived = publicFromPrivate(privateKey);
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (text) { if (text.includes(question)) process.stdout.write(text); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

module.exports = { compare, publicFromPrivate };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const pubIndex = args.indexOf('--public');
    let publicKey = pubIndex >= 0 ? args[pubIndex + 1] : '';
    if (!publicKey) {
      const source = fs.readFileSync(path.join(__dirname, '..', 'supabase-live.js'), 'utf8');
      const m = source.match(/WEB_PUSH_VAPID_PUBLIC_KEY = '([^']+)'/);
      publicKey = m ? m[1] : '';
    }
    if (!publicKey) { console.error('No public key found. Pass --public <key>.'); process.exit(2); }
    let privateKey = process.env.VAPID_PRIVATE_KEY || '';
    if (!privateKey && process.stdin.isTTY) privateKey = await promptHidden('VAPID private key (hidden): ');
    if (!privateKey) { console.error('Set VAPID_PRIVATE_KEY or run in a terminal to be prompted.'); process.exit(2); }
    try {
      const ok = compare(publicKey, privateKey);
      console.log((ok ? 'MATCH' : 'MISMATCH') + ' — public key ' + publicKey.slice(0, 8) + '… ' +
        (ok ? 'belongs to the private key you supplied.' : 'does NOT belong to the private key you supplied. Do not deploy this combination.'));
      process.exit(ok ? 0 : 1);
    } catch (e) {
      console.error('Could not check the key pair: ' + e.message);
      process.exit(2);
    }
  })();
}
