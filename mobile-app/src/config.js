// ============================================================
// App-Konfiguration
// ============================================================
// Die Google Client-ID wird automatisch über den QR-Code aus
// der Desktop-Software übertragen und in der lokalen Datenbank
// gespeichert. Es ist KEINE manuelle Konfiguration nötig.
// ============================================================

export default {
  google: {
    // OAuth Scopes für Google Drive Zugriff
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  },
};
