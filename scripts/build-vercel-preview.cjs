#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

function fail(message) {
  console.error('[Vercel Preview Build] ERROR: ' + message);
  process.exit(1);
}

if (process.env.VERCEL !== '1') {
  fail('This script must run inside Vercel.');
}

if (process.env.VERCEL_ENV !== 'preview') {
  fail('Only Vercel Preview deployments are permitted. Production is blocked.');
}

const hostname = String(process.env.VERCEL_URL || '').trim().toLowerCase();

if (!hostname || !/^[a-z0-9-]+\.vercel\.app$/.test(hostname)) {
  fail('VERCEL_URL is missing or is not a valid Vercel deployment hostname.');
}

const required = [
  'MM_SUPABASE_URL',
  'MM_SUPABASE_PUBLISHABLE_KEY',
  'MM_RESTAURANT_ID'
];

for (const name of required) {
  if (!String(process.env[name] || '').trim()) {
    fail(name + ' is missing from the Vercel Preview environment.');
  }
}

if (process.env.MM_ENV !== 'staging') {
  fail('MM_ENV must equal staging.');
}

const env = {
  ...process.env,

  // Compatibility with the existing staging builder.
  // This does not weaken its Supabase project validation.
  NETLIFY: 'true',

  MM_ENV: 'staging',
  MM_STAGING_HOSTNAME: hostname,
  MM_QR_BASE_URL: 'https://' + hostname + '/?table='
};

const builder = path.join(__dirname, 'build-env-config.cjs');

console.log('[Vercel Preview Build] Building staging artifact.');
console.log('[Vercel Preview Build] Hostname: ' + hostname);
console.log('[Vercel Preview Build] Production deployment: blocked.');

const result = spawnSync(process.execPath, [builder], {
  cwd: path.resolve(__dirname, '..'),
  env,
  stdio: 'inherit'
});

if (result.error) fail(result.error.message);
if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log('[Vercel Preview Build] Staging artifact created successfully.');
