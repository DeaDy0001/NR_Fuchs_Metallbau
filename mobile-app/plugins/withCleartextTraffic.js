const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');
const { mkdirSync, writeFileSync } = require('fs');
const { join } = require('path');

/**
 * Expo config plugin to enable cleartext (HTTP) traffic on Android.
 * Required because the desktop server runs on http://192.168.x.x:3001 (local network).
 * Without this, Android 9+ blocks all HTTP requests with "Network request failed".
 *
 * Uses two approaches for maximum compatibility:
 * 1. Sets android:usesCleartextTraffic="true" on the <application> tag
 * 2. Creates a network_security_config.xml that allows cleartext for local IPs
 */
module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (!manifest.application || !manifest.application[0]) return config;

    const application = manifest.application[0];
    if (!application.$) application.$ = {};

    // Approach 1: Global cleartext traffic flag
    application.$['android:usesCleartextTraffic'] = 'true';

    // Approach 2: Network security config for local network
    const resXmlDir = join(
      config.modRequest.platformProjectRoot,
      'app', 'src', 'main', 'res', 'xml'
    );
    try {
      mkdirSync(resXmlDir, { recursive: true });
      writeFileSync(
        join(resXmlDir, 'network_security_config.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`
      );
      application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    } catch (e) {
      // Fallback: just use usesCleartextTraffic flag (already set above)
      console.warn('[withCleartextTraffic] Could not write network_security_config.xml:', e.message);
    }

    return config;
  });
};
