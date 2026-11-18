/* Mirch Masaala environment values.
 *
 * This committed file is the production GitHub Pages profile. A Netlify
 * staging build replaces this file in its own dist/ output, so production
 * credentials are never part of the staging artifact.
 *
 * Staging values are intentionally empty here: opening the staging hostname
 * with this production file must fail closed instead of connecting anywhere.
 */
window.MM_ENV_CONFIG = {
  schemaVersion: 1,
  environments: {
    production: {
      hostnames: ['bhadeonkar-cmyk.github.io'],
      pathPrefix: '/mirch-masaala/',
      expectedProjectRef: 'adbhxldsqwsyaqzdmxnf',
      supabaseUrl: 'https://adbhxldsqwsyaqzdmxnf.supabase.co',
      publishableKey: 'sb_publishable_jAm4636kkOg-EysRgIa_Jw_bt967sZ9',
      restaurantId: 'a3702d10-6673-4c06-9783-1d61c945ecd5',
      qrBaseUrl: 'https://bhadeonkar-cmyk.github.io/mirch-masaala/?table=',
      vapidPublicKey: 'BCGV3-RIkNT5dJfV96yuWS61iZe5Zf85s8CJWBgq-Q_pGJWCLEkMD-91IB7yvsZ6Z0mGebJCohhVJmUHcuNW1E0'
    },
    staging: {
      hostnames: ['mirch-masaala-staging.netlify.app'],
      pathPrefix: '/',
      expectedProjectRef: 'vhsbjwxvugyaalughunj',
      supabaseUrl: '',
      publishableKey: '',
      restaurantId: '',
      qrBaseUrl: 'https://mirch-masaala-staging.netlify.app/?table=',
      vapidPublicKey: ''
    }
  }
};
