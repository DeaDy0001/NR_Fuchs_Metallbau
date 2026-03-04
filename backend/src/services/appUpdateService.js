/**
 * App Update Service
 *
 * Watches for a new APK at mobile-app/android/app.apk and
 * automatically uploads it (+ version.json) to Google Drive
 * under: NR_Fuchs_Meta/src/app update/
 *
 * Mobile apps then check Drive on startup and show a banner
 * if a newer version is available.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../config/database');
const {
  isAuthenticated,
  findOrCreateSubfolder,
  listAllFilesInFolder,
  deleteFileFromDrive,
  uploadFileToDrive,
} = require('./googleDriveService');

const APK_PATH = path.join(__dirname, '../../../mobile-app/android/app.apk');
const VERSION_PATH = path.join(__dirname, '../../../mobile-app/android/version.json');
const META_FOLDER_NAME = 'NR_Fuchs_Meta';

let lastApkMtime = null;
let watchInterval = null;

// ── helpers ─────────────────────────────────────────────────────────────────

const getRootFolderId = () => {
  try {
    const rows = db.prepare('SELECT path FROM drive_paths ORDER BY id ASC LIMIT 1').all();
    if (!rows.length) return null;
    let p = rows[0].path;
    const match = p.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (match) p = match[1];
    return p;
  } catch {
    return null;
  }
};

const getUpdateFolder = async (rootFolderId) => {
  const metaFolder = await findOrCreateSubfolder(rootFolderId, META_FOLDER_NAME);
  const srcFolder  = await findOrCreateSubfolder(metaFolder.id, 'src');
  return await findOrCreateSubfolder(srcFolder.id, 'app update');
};

const deleteIfExists = async (folderId, fileName) => {
  try {
    const files = await listAllFilesInFolder(folderId);
    for (const f of files.filter(f => f.name === fileName)) {
      await deleteFileFromDrive(f.id);
    }
  } catch {}
};

// ── core upload ──────────────────────────────────────────────────────────────

const checkAndUpload = async () => {
  try {
    if (!fs.existsSync(APK_PATH)) return;

    const apkStat   = fs.statSync(APK_PATH);
    const apkMtime  = apkStat.mtimeMs;

    // Skip if APK hasn't changed since last successful upload
    if (lastApkMtime !== null && apkMtime === lastApkMtime) return;

    if (!await isAuthenticated()) {
      console.log('[AppUpdate] Nicht mit Google authentifiziert – überspringe Upload');
      return;
    }

    const rootFolderId = getRootFolderId();
    if (!rootFolderId) {
      console.log('[AppUpdate] Kein Drive-Ordner konfiguriert');
      return;
    }

    console.log('[AppUpdate] Neue APK erkannt – lade zu Google Drive hoch …');

    const updateFolder = await getUpdateFolder(rootFolderId);

    // --- version.json ---
    let versionData = { version: '0.0.0', buildNumber: 0 };
    if (fs.existsSync(VERSION_PATH)) {
      try { versionData = JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8')); } catch {}
    }
    versionData.uploadedAt = new Date().toISOString();

    const tempVersionPath = path.join(os.tmpdir(), 'fuchs-version-upload.json');
    fs.writeFileSync(tempVersionPath, JSON.stringify(versionData, null, 2));
    await deleteIfExists(updateFolder.id, 'version.json');
    await uploadFileToDrive(tempVersionPath, updateFolder.id, 'version.json');
    try { fs.unlinkSync(tempVersionPath); } catch {}

    // --- app.apk ---
    await deleteIfExists(updateFolder.id, 'app.apk');
    await uploadFileToDrive(APK_PATH, updateFolder.id, 'app.apk');

    lastApkMtime = apkMtime;
    console.log(`[AppUpdate] ✅ APK v${versionData.version} erfolgreich zu Google Drive hochgeladen`);
  } catch (e) {
    console.error('[AppUpdate] Fehler beim Upload:', e.message);
  }
};

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Start the APK watcher:
 * - Initial check 60 seconds after server start (wait for Google auth)
 * - Then every 30 minutes
 */
const initializeAppUpdateWatcher = () => {
  setTimeout(() => checkAndUpload(), 60 * 1000);
  watchInterval = setInterval(() => checkAndUpload(), 30 * 60 * 1000);
  console.log('[AppUpdate] APK-Watcher gestartet (prüft alle 30 Minuten)');
};

/**
 * Force an immediate re-upload (ignores mtime cache).
 * Called from the manual release endpoint.
 */
const triggerManualUpload = async () => {
  lastApkMtime = null;
  return checkAndUpload();
};

module.exports = { initializeAppUpdateWatcher, triggerManualUpload };
