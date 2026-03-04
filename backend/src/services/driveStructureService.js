/**
 * Drive Structure Service
 *
 * Runs on server startup and every 60 minutes to ensure Google Drive
 * has the correct folder structure and all local content is uploaded:
 *
 *   NR_Fuchs_Meta/
 *   ├── src/
 *   │   └── app update/
 *   │       ├── app.apk          ← mobile app update
 *   │       └── version.json
 *   ├── Projekte/
 *   │   ├── {ProjectName}/       ← one folder per project
 *   │   │   ├── image1.jpg
 *   │   │   └── image2.jpg
 *   │   └── …
 *   └── inbox/                   ← created if missing
 */

const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const {
  isAuthenticated,
  extractFolderId,
  findOrCreateSubfolder,
  findSubfolder,
  listAllFilesInFolder,
  uploadFileToDrive,
} = require('./googleDriveService');
const { triggerManualUpload } = require('./appUpdateService');

const APK_PATH    = path.join(__dirname, '../../../mobile-app/android/app.apk');
const META_FOLDER = 'NR_Fuchs_Meta';

let structureInterval = null;

// ── helpers ──────────────────────────────────────────────────────────────────

const getRootFolderId = () => {
  try {
    const rows = db.prepare('SELECT path FROM drive_paths ORDER BY id ASC LIMIT 1').all();
    if (!rows.length) return null;
    return extractFolderId(rows[0].path) || rows[0].path;
  } catch {
    return null;
  }
};

// List all file names in a Drive folder (returns a Set of names)
const getDriveFileNames = async (folderId) => {
  try {
    const files = await listAllFilesInFolder(folderId);
    return new Set(files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder').map(f => f.name));
  } catch {
    return new Set();
  }
};

// ── checks ────────────────────────────────────────────────────────────────────

/**
 * 1. APK: ensure NR_Fuchs_Meta/src/app update/app.apk is on Drive.
 *    Delegates to appUpdateService.triggerManualUpload() which handles
 *    uploading the local APK + version.json.
 */
const checkApkUpdate = async (metaFolderId) => {
  try {
    // Verify the app update folder + files via appUpdateService
    if (fs.existsSync(APK_PATH)) {
      // Check if app.apk already exists in Drive
      const srcFolder = await findSubfolder(metaFolderId, 'src');
      if (srcFolder) {
        const updateFolder = await findSubfolder(srcFolder.id, 'app update');
        if (updateFolder) {
          const files = await getDriveFileNames(updateFolder.id);
          if (files.has('app.apk')) {
            return; // already there, appUpdateService handles changes
          }
        }
      }
      // Missing – force upload
      console.log('[DriveStructure] APK fehlt auf Drive – lade hoch …');
      await triggerManualUpload();
    }
  } catch (e) {
    console.error('[DriveStructure] APK-Check fehlgeschlagen:', e.message);
  }
};

/**
 * 2. Projekte: ensure NR_Fuchs_Meta/Projekte/{name}/ exists and all local
 *    images for each project are uploaded.
 */
const checkProjects = async (metaFolderId) => {
  try {
    const projetteFolder = await findOrCreateSubfolder(metaFolderId, 'Projekte');

    // Get all distinct project subfolders from local DB
    let subfolders = [];
    try {
      subfolders = db.prepare(
        "SELECT DISTINCT subfolder FROM drive_images WHERE subfolder IS NOT NULL AND subfolder != '' AND local_path IS NOT NULL"
      ).all().map(r => r.subfolder);
    } catch {
      return; // table / column might not exist yet
    }

    if (subfolders.length === 0) {
      console.log('[DriveStructure] Keine lokalen Projekte gefunden, überspringe Projekte-Check');
      return;
    }

    console.log(`[DriveStructure] Prüfe ${subfolders.length} Projekte …`);

    for (const subfolder of subfolders) {
      try {
        // Ensure project folder exists on Drive
        const projectFolder = await findOrCreateSubfolder(projetteFolder.id, subfolder);

        // List files already on Drive in this project folder
        const existingNames = await getDriveFileNames(projectFolder.id);

        // Get local images for this project
        const localImages = db.prepare(
          "SELECT original_name, local_path FROM drive_images WHERE subfolder = ? AND local_path IS NOT NULL"
        ).all(subfolder);

        let uploaded = 0;
        for (const img of localImages) {
          const localFullPath = path.join(__dirname, '../../..', img.local_path);
          if (!fs.existsSync(localFullPath)) continue;

          const fileName = img.original_name || path.basename(img.local_path);
          if (existingNames.has(fileName)) continue; // already on Drive

          await uploadFileToDrive(localFullPath, projectFolder.id, fileName);
          existingNames.add(fileName); // avoid re-uploading duplicates in same run
          uploaded++;
        }

        if (uploaded > 0) {
          console.log(`[DriveStructure] Projekt "${subfolder}": ${uploaded} Bild(er) hochgeladen`);
        }
      } catch (e) {
        console.error(`[DriveStructure] Fehler bei Projekt "${subfolder}":`, e.message);
      }
    }
  } catch (e) {
    console.error('[DriveStructure] Projekte-Check fehlgeschlagen:', e.message);
  }
};

/**
 * 3. Inbox: ensure NR_Fuchs_Meta/inbox/ exists.
 */
const checkInbox = async (metaFolderId) => {
  try {
    await findOrCreateSubfolder(metaFolderId, 'inbox');
  } catch (e) {
    console.error('[DriveStructure] Inbox-Check fehlgeschlagen:', e.message);
  }
};

// ── main check ────────────────────────────────────────────────────────────────

const runStructureCheck = async () => {
  try {
    if (!await isAuthenticated()) {
      console.log('[DriveStructure] Nicht mit Google authentifiziert – überspringe Check');
      return;
    }

    const rootFolderId = getRootFolderId();
    if (!rootFolderId) {
      console.log('[DriveStructure] Kein Drive-Ordner konfiguriert');
      return;
    }

    console.log('[DriveStructure] Prüfe Drive-Struktur …');

    // Ensure NR_Fuchs_Meta exists
    const metaFolder = await findOrCreateSubfolder(rootFolderId, META_FOLDER);

    // Run all checks in order
    await checkApkUpdate(metaFolder.id);
    await checkInbox(metaFolder.id);
    await checkProjects(metaFolder.id);

    console.log('[DriveStructure] ✅ Drive-Struktur OK');
  } catch (e) {
    console.error('[DriveStructure] Fehler:', e.message);
  }
};

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Initialize the structure watcher:
 * - First check 90 seconds after server start (wait for auth)
 * - Then every 60 minutes
 */
const initializeDriveStructureWatcher = () => {
  setTimeout(() => runStructureCheck(), 90 * 1000);
  structureInterval = setInterval(() => runStructureCheck(), 60 * 60 * 1000);
  console.log('[DriveStructure] Struktur-Watcher gestartet (prüft alle 60 Minuten)');
};

module.exports = { initializeDriveStructureWatcher, runStructureCheck };
