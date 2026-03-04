/**
 * app.config.js – dynamische Expo-Konfiguration
 *
 * Liest die statische Konfiguration aus app.json und ergänzt optional
 * die EAS projectId aus einer lokalen (nicht versionierten) Datei.
 *
 * So muss eas init nie mehr app.json anfassen → keine Git-Konflikte mehr
 * beim Pull wenn jemand eas init lokal ausgeführt hat.
 *
 * EAS project ID einmalig einrichten:
 *   eas init  →  trägt die ID jetzt in eas-project.json ein (gitignored)
 *   ODER: Datei manuell anlegen:
 *     echo { "projectId": "deine-id-hier" } > eas-project.json
 */

const fs = require('fs');
const path = require('path');

const appJson = require('./app.json');
const base = appJson.expo;

// Versuche die EAS projectId aus der lokalen (gitignorierten) Datei zu lesen
let projectId = null;
const localFile = path.join(__dirname, 'eas-project.json');
if (fs.existsSync(localFile)) {
  try {
    const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    projectId = local.projectId || null;
  } catch {
    // Datei existiert aber ist kein valides JSON → ignorieren
  }
}

module.exports = {
  expo: {
    ...base,
    // EAS projectId nur eintragen wenn vorhanden (für Cloud Builds)
    ...(projectId ? { extra: { ...base.extra, eas: { projectId } } } : {}),
  },
};
