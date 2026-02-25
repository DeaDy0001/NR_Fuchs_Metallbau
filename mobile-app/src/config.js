// ============================================================
// Google OAuth Konfiguration
// ============================================================
// Diese Client-IDs müssen in der Google Cloud Console erstellt werden:
// 1. Gehe zu https://console.cloud.google.com/apis/credentials
// 2. Erstelle ein OAuth 2.0 Client-ID Projekt
// 3. Aktiviere die "Google Drive API"
// 4. Erstelle Client-IDs für Web, Android und Expo
//
// Für Android:
//   - Paketname: com.fuchsmetallbau.app
//   - SHA-1 Fingerprint: aus dem Keystore (keytool -list -v ...)
//
// Für Expo Go (Entwicklung):
//   - Redirect URI: https://auth.expo.io/@your-expo-username/fuchs-metallbau
// ============================================================

export default {
  google: {
    // Web Client ID (für Token-Exchange, MUSS gesetzt werden)
    webClientId: '',

    // Android Client ID (für standalone APK)
    androidClientId: '',

    // Expo Client ID (für Expo Go Entwicklung)
    expoClientId: '',

    // OAuth Scopes
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  },
};
