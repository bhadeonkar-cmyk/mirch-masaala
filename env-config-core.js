/* Mirch Masaala environment resolver and fail-closed guard.
 *
 * Loaded after env-config.js and before qr-matrices.js / supabase-live.js.
 *
 * Fail-closed rules:
 *  - Unknown hostname => no environment, ordering disabled.
 *  - Missing field or malformed Supabase URL => no environment.
 *  - Supabase project ref must match the environment.
 *  - Staging may never use the production project ref and vice versa.
 */
(function () {
  'use strict';

  var PRODUCTION_PROJECT_REF = 'adbhxldsqwsyaqzdmxnf';
  var STAGING_PROJECT_REF = 'vhsbjwxvugyaalughunj';

  function normalizeHost(value) {
    return String(value || '').toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
  }

  function deriveProjectRef(value) {
    try {
      var host = new URL(String(value)).hostname.toLowerCase();
      var match = host.match(/^([a-z0-9-]+)\.supabase\.co$/);
      return match ? match[1] : '';
    } catch (error) {
      return '';
    }
  }

  function validateProfile(name, profile) {
    if (!profile || typeof profile !== 'object') {
      return { ok: false, error: 'Environment "' + name + '" is not configured.' };
    }
    var required = ['expectedProjectRef', 'supabaseUrl', 'publishableKey', 'restaurantId', 'qrBaseUrl'];
    for (var index = 0; index < required.length; index += 1) {
      var field = required[index];
      if (!String(profile[field] || '').trim()) {
        return { ok: false, error: 'Environment "' + name + '" is missing ' + field + '.' };
      }
    }
    var projectRef = deriveProjectRef(profile.supabaseUrl);
    if (!projectRef) {
      return { ok: false, error: 'Environment "' + name + '" has an invalid Supabase URL.' };
    }
    if (projectRef !== String(profile.expectedProjectRef).trim().toLowerCase()) {
      return { ok: false, error: 'Environment "' + name + '" project ref does not match its Supabase URL.' };
    }
    if (name === 'staging' && projectRef === PRODUCTION_PROJECT_REF) {
      return { ok: false, error: 'Staging configuration points at the production Supabase project.' };
    }
    if (name === 'production' && projectRef === STAGING_PROJECT_REF) {
      return { ok: false, error: 'Production configuration points at the staging Supabase project.' };
    }
    if (!/^https:\/\/[^\s]+[?&]table=$/.test(String(profile.qrBaseUrl))) {
      return { ok: false, error: 'Environment "' + name + '" needs an HTTPS QR base URL ending in ?table=.' };
    }
    if (profile.vapidPublicKey && !/^[A-Za-z0-9_-]{87}$/.test(String(profile.vapidPublicKey))) {
      return { ok: false, error: 'Environment "' + name + '" has an invalid VAPID public key.' };
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(profile.restaurantId))) {
      return { ok: false, error: 'Environment "' + name + '" has an invalid restaurant ID.' };
    }
    return { ok: true, projectRef: projectRef };
  }

  function matchesLocation(profile, locationLike) {
    var protocol = String((locationLike && locationLike.protocol) || '');
    var hostname = normalizeHost(locationLike && locationLike.hostname);
    var pathname = String((locationLike && locationLike.pathname) || '/');
    if (protocol === 'file:') return profile.allowFileProtocol === true;
    var hostnames = Array.isArray(profile.hostnames) ? profile.hostnames.map(normalizeHost) : [];
    if (!hostname || hostnames.indexOf(hostname) === -1) return false;
    if (profile.pathPrefix && pathname.indexOf(String(profile.pathPrefix)) !== 0) return false;
    return true;
  }

  function resolve(config, locationLike) {
    if (!config || typeof config !== 'object' || !config.environments || typeof config.environments !== 'object') {
      return { ok: false, error: 'Environment configuration is missing.' };
    }
    var matches = [];
    Object.keys(config.environments).forEach(function (name) {
      if (matchesLocation(config.environments[name] || {}, locationLike)) matches.push(name);
    });
    if (!matches.length) {
      return { ok: false, error: 'Unknown hostname: ' + String((locationLike && locationLike.hostname) || '(none)') + '.' };
    }
    if (matches.length > 1) {
      return { ok: false, error: 'Hostname matches more than one environment: ' + matches.join(', ') + '.' };
    }
    var name = matches[0];
    var profile = config.environments[name];
    var validation = validateProfile(name, profile);
    if (!validation.ok) return validation;
    var productionProfile = config.environments.production || {};
    if (name === 'staging' && productionProfile.restaurantId &&
        String(profile.restaurantId).toLowerCase() === String(productionProfile.restaurantId).toLowerCase()) {
      return { ok: false, error: 'Staging must use the staging project\'s own restaurant ID, not the production ID.' };
    }
    return {
      ok: true,
      name: name,
      projectRef: validation.projectRef,
      isStaging: name === 'staging',
      supabaseUrl: profile.supabaseUrl,
      publishableKey: profile.publishableKey,
      restaurantId: profile.restaurantId,
      qrBaseUrl: profile.qrBaseUrl,
      vapidPublicKey: profile.vapidPublicKey || ''
    };
  }

  function tableUrl(tableNumber) {
    var value = String(tableNumber == null ? '' : tableNumber);
    if (!value) return '';
    var base = (window.MM_ENV && window.MM_ENV.qrBaseUrl) || '';
    return base ? base + encodeURIComponent(value.padStart(2, '0')) : '';
  }

  function renderBanner(result) {
    if (!result || result.name === 'production' || !document || !document.body) return;
    if (document.getElementById('mm-env-banner')) return;
    var staging = result.ok && result.name === 'staging';
    var bar = document.createElement('div');
    bar.id = 'mm-env-banner';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    bar.textContent = staging
      ? 'STAGING ENVIRONMENT — TEST DATA ONLY · Production is separate'
      : 'CONFIGURATION ERROR — ORDERING DISABLED';
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
      'padding:7px 12px', 'text-align:center', 'font:700 11px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif',
      'letter-spacing:.06em', 'color:#fff', 'pointer-events:none',
      'background:' + (staging ? '#b45309' : '#991b1b'),
      'border-bottom:1px solid rgba(255,255,255,.28)', 'box-shadow:0 2px 12px rgba(0,0,0,.35)'
    ].join(';');
    document.body.appendChild(bar);
  }

  function applyEnvironment() {
    var locationLike = window.location || {};
    var override = window.MM_ENV_CONFIG_OVERRIDE;
    var config = (override && String(locationLike.protocol) === 'file:') ? override : window.MM_ENV_CONFIG;
    var result = resolve(config, locationLike);

    window.MM_ENV_CONFIG = config;
    window.MM_CONFIG_RESULT = result;
    window.MM_CONFIG_OK = result.ok === true;
    window.MM_ENV = result.ok ? result : null;
    window.MM_ENV_NAME = result.ok ? result.name : 'invalid';
    window.MM_IS_STAGING = result.ok && result.name === 'staging';
    window.MM_ENV_ERROR = result.ok ? '' : result.error;

    if (result.ok) {
      window.MM_SUPABASE_URL = result.supabaseUrl;
      window.MM_SUPABASE_PUBLISHABLE_KEY = result.publishableKey;
      window.MM_RESTAURANT_ID = result.restaurantId;
      window.MM_QR_BASE_URL = result.qrBaseUrl;
      window.MM_VAPID_PUBLIC_KEY = result.vapidPublicKey;
      window.MM_TABLE_URL = tableUrl;
    } else {
      window.MM_QR_BASE_URL = '';
      window.MM_TABLE_URL = function () { return ''; };
      if (window.console && console.warn) console.warn('[Mirch Masaala config] ' + result.error);
    }

    try {
      if (document && document.documentElement) {
        document.documentElement.setAttribute('data-mm-env', window.MM_ENV_NAME);
      }
      if (document && document.getElementById) {
        var manifest = document.getElementById('app-manifest');
        if (manifest && result.ok && result.name === 'staging') {
          manifest.setAttribute('href', './manifest.staging.webmanifest');
        }
        if (result.ok && result.name !== 'production' && !document.querySelector('meta[name="robots"]')) {
          var robots = document.createElement('meta');
          robots.setAttribute('name', 'robots');
          robots.setAttribute('content', 'noindex,nofollow');
          (document.head || document.documentElement).appendChild(robots);
        }
      }
    } catch (metaError) {
      if (window.console && console.warn) console.warn('[Mirch Masaala config] Could not apply page metadata:', metaError);
    }

    if (document && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { renderBanner(result); }, { once: true });
    } else {
      renderBanner(result);
    }
  }

  window.MirchEnvironment = {
    resolve: resolve,
    validateProfile: validateProfile,
    tableUrl: tableUrl,
    PRODUCTION_PROJECT_REF: PRODUCTION_PROJECT_REF,
    STAGING_PROJECT_REF: STAGING_PROJECT_REF
  };

  applyEnvironment();
})();
