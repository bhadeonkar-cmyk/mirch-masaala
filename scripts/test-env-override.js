/* Playwright init script for file:// harnesses.
 * env-config-core.js honors this override only on the file: protocol, so a
 * deployed HTTPS page cannot use it to bypass the hostname/project guard.
 */
window.MM_ENV_CONFIG_OVERRIDE = {
  schemaVersion: 1,
  environments: {
    test: {
      allowFileProtocol: true,
      hostnames: ['test.invalid'],
      expectedProjectRef: 'testproject',
      supabaseUrl: 'https://testproject.supabase.co',
      publishableKey: 'sb_publishable_test_only_not_a_real_key',
      restaurantId: '99999999-9999-4999-8999-999999999999',
      qrBaseUrl: 'https://test.invalid/?table='
    }
  }
};
