#!/usr/bin/env node
'use strict';

/*
 * Generates the staging artifact for Netlify.
 *
 * Netlify build command: node scripts/build-env-config.cjs
 * Required environment variables (set in Netlify, never commit values):
 *   MM_ENV=staging
 *   MM_STAGING_HOSTNAME=mirch-masaala-staging.netlify.app
 *   MM_SUPABASE_URL=https://<staging-ref>.supabase.co
 *   MM_SUPABASE_PUBLISHABLE_KEY=<staging publishable key>
 *   MM_RESTAURANT_ID=<staging restaurant UUID>
 * Optional:
 *   MM_QR_BASE_URL=https://<staging-host>/?table=
 *   MM_VAPID_PUBLIC_KEY=<staging push public key>
 *   MM_EXTRA_STAGING_HOSTNAMES=deploy-preview-1--site.netlify.app,...
 *
 * The script refuses to run unless MM_ENV=staging and the Supabase project
 * ref matches the staging project. It never writes production credentials.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = process.env.MM_BUILD_OUT
  ? path.resolve(process.env.MM_BUILD_OUT)
  : path.join(root, 'dist');
const STAGING_PROJECT_REF = 'vhsbjwxvugyaalughunj';
const PRODUCTION_PROJECT_REF = 'adbhxldsqwsyaqzdmxnf';
const PRODUCTION_HOST = 'bhadeonkar-cmyk.github.io';
const PRODUCTION_VAPID_PUBLIC_KEY = 'BCGV3-RIkNT5dJfV96yuWS61iZe5Zf85s8CJWBgq-Q_pGJWCLEkMD-91IB7yvsZ6Z0mGebJCohhVJmUHcuNW1E0';
// Denylist only: the staging project must have its own restaurants row and UUID.
const PRODUCTION_RESTAURANT_ID = 'a3702d10-6673-4c06-9783-1d61c945ecd5';

function fail(message) {
  console.error('✗ ' + message);
  process.exit(1);
}

function requireValue(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) fail(name + ' is required.');
  return value;
}

function projectRef(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/);
    return match ? match[1] : '';
  } catch (error) {
    return '';
  }
}

const force = process.argv.includes('--force');
if (!force && process.env.NETLIFY !== 'true') {
  fail('Refusing to generate staging output outside Netlify. Pass --force for a local dry run.');
}
if (String(process.env.MM_ENV || '').toLowerCase() !== 'staging') {
  fail('MM_ENV must be set to staging. Production is deployed from GitHub Pages.');
}

const hostnames = [requireValue('MM_STAGING_HOSTNAME')]
  .concat(String(process.env.MM_EXTRA_STAGING_HOSTNAMES || '').split(','))
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const uniqueHostnames = [...new Set(hostnames)];
uniqueHostnames.forEach((host) => {
  if (host === PRODUCTION_HOST) fail('Staging hostname must not be the production host.');
  if (!/^[a-z0-9.-]+$/.test(host)) fail('Invalid staging hostname: ' + host);
});

const supabaseUrl = requireValue('MM_SUPABASE_URL').replace(/\/$/, '');
const supabaseRef = projectRef(supabaseUrl);
if (!supabaseRef) fail('MM_SUPABASE_URL must be https://<ref>.supabase.co.');
if (supabaseRef === PRODUCTION_PROJECT_REF) fail('Staging must not use the production Supabase project.');
if (supabaseRef !== STAGING_PROJECT_REF) fail('MM_SUPABASE_URL does not match the staging project ref.');

const publishableKey = requireValue('MM_SUPABASE_PUBLISHABLE_KEY');
const restaurantId = requireValue('MM_RESTAURANT_ID');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(restaurantId)) {
  fail('MM_RESTAURANT_ID must be the staging restaurant UUID.');
}
if (restaurantId.toLowerCase() === PRODUCTION_RESTAURANT_ID) {
  fail('MM_RESTAURANT_ID must be the staging project\'s own restaurant UUID, not the production UUID.');
}
const qrBaseUrl = String(process.env.MM_QR_BASE_URL || ('https://' + uniqueHostnames[0] + '/?table=')).trim();
if (!/^https:\/\/[^\s]+[?&]table=$/.test(qrBaseUrl)) {
  fail('MM_QR_BASE_URL must be HTTPS and end in ?table=.');
}
const vapidPublicKey = String(process.env.MM_VAPID_PUBLIC_KEY || '').trim();
if (vapidPublicKey) {
  if (vapidPublicKey === PRODUCTION_VAPID_PUBLIC_KEY) fail('Staging must not reuse the production VAPID public key.');
  if (!/^[A-Za-z0-9_-]{87}$/.test(vapidPublicKey)) fail('MM_VAPID_PUBLIC_KEY is not a valid P-256 public key.');
}

if (outDir === root || outDir === path.dirname(root)) {
  fail('Refusing to clean an unsafe output directory: ' + outDir);
}
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const stagingConfig = {
  schemaVersion: 1,
  environments: {
    staging: {
      hostnames: uniqueHostnames,
      pathPrefix: '/',
      expectedProjectRef: STAGING_PROJECT_REF,
      supabaseUrl,
      publishableKey,
      restaurantId,
      qrBaseUrl,
      vapidPublicKey
    }
  }
};

fs.writeFileSync(
  path.join(outDir, 'env-config.js'),
  '/* Generated staging environment. Do not edit or commit. */\n' +
    'window.MM_ENV_CONFIG = ' + JSON.stringify(stagingConfig, null, 2) + ';\n',
  'utf8'
);

const files = [
  'index.html',
  'env-config-core.js',
  'qr-matrices.js',
  'menu-images.js',
  'app-language.js',
  'supabase-live.js',
  'ui-premium.css',
  'service-worker.js',
  'manifest.staging.webmanifest',
  'icon.svg',
  'apple-touch-icon.png'
];
for (const file of files) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) fail('Missing required staging asset: ' + file);
  fs.copyFileSync(source, path.join(outDir, file));
}

for (const directory of ['icons', 'menu-images']) {
  const source = path.join(root, directory);
  if (!fs.existsSync(source)) fail('Missing required staging directory: ' + directory);
  fs.cpSync(source, path.join(outDir, directory), { recursive: true });
}

// The staging manifest is the default, and env-config-core switches to the
// explicit staging filename for local staging previews.
const stagingManifest = fs.readFileSync(path.join(root, 'manifest.staging.webmanifest'), 'utf8');
fs.writeFileSync(path.join(outDir, 'manifest.webmanifest'), stagingManifest, 'utf8');
fs.writeFileSync(path.join(outDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');

console.log('✓ Staging artifact generated in ' + outDir);
console.log('  Environment: staging');
console.log('  Hostnames: ' + uniqueHostnames.join(', '));
console.log('  Supabase project ref: ' + supabaseRef);
console.log('  QR base host: ' + new URL(qrBaseUrl).host);
