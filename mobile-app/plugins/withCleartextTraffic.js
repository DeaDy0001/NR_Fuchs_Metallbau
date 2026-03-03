const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Expo config plugin to enable cleartext (HTTP) traffic on Android.
 * Required because the desktop server runs on http://192.168.x.x:3001 (local network).
 * Without this, Android 9+ blocks all HTTP requests with "Network request failed".
 */
module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0];
    application.$['android:usesCleartextTraffic'] = 'true';
    return config;
  });
};
