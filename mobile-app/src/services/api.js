/**
 * API Service - Google Drive basiert
 *
 * Postfach-Architektur (neue JSON-basierte Inbox):
 *   Bilder → immer in NR_Fuchs_Meta/inbox/images/ (eindeutiger Dateiname)
 *   Metadaten → in JSON-Dateien im NR_Fuchs_Meta/inbox/ Ordner:
 *     image_requests.json         – Bild-Uploads (gruppiert nach Projekt)
 *     projekt_requests.json       – Neue Projekterstellungen
 *     image_change_requests.json  – Änderungen an Bild-Metadaten
 *     projekt_change_requests.json – Notizen zu bestehenden Projekten
 *     delete_requests.json        – Löschanfragen (unverändert)
 *
 * Drive-Ordnerstruktur:
 *   Root Folder (per QR-Code verknüpft)
 *   ├── NR_Fuchs_Meta/
 *   │   ├── Projekte/
 *   │   │   ├── ProjektName1/   (Bilder nach Bestätigung)
 *   │   │   └── ProjektName2/
 *   │   └── inbox/
 *   │       ├── images/          (alle hochgeladenen Bilder, eindeutige Namen)
 *   │       ├── image_requests.json
 *   │       ├── projekt_requests.json
 *   │       ├── image_change_requests.json
 *   │       ├── projekt_change_requests.json
 *   │       └── delete_requests.json
 */

import { getActiveDriveConnection, getSetting } from './database';
import {
  listFiles,
  readJsonFile,
  readJsonFileByName,
  uploadFile,
  createJsonFile,
  updateJsonFile,
  downloadFile,
  deleteFile,
  getFileParents,
  getImageSource,
  checkFolderAccess,
  findOrCreateFolder,
  findFolder,
} from './driveService';
import * as FileSystem from 'expo-file-system/legacy';
import { getAccessToken } from './googleAuth';

// ============================================================
// Projects - folder-based
// ============================================================

/**
 * Get the Projekte folder ID (finds or creates it)
 */
const getProjekteFolderId = async () => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  const folder = await findOrCreateFolder(connection.meta_folder_id, 'Projekte');
  return folder.id;
};

/**
 * Fetch projects by scanning subfolders of NR_Fuchs_Meta/Projekte/
 * Each subfolder = one project
 * @param {function} onProject - optional callback, called with each project as it's found
 */
export const fetchProjects = async (onProject = null) => {
  const projekteFolderId = await getProjekteFolderId();

  // List all subfolders
  const folders = await listFiles(projekteFolderId, {
    mimeType: 'application/vnd.google-apps.folder',
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'name',
  });

  // For each folder, count images and read metadata
  const projects = [];
  for (const folder of folders) {
    let imageCount = 0;
    let meta = {};

    try {
      // Count images and find project.json in one listing
      const files = await listFiles(folder.id, {
        fields: 'files(id,name,mimeType)',
        pageSize: 1000,
      });
      imageCount = files.filter(f => f.mimeType && f.mimeType.startsWith('image/')).length;

      // Read project.json if it exists
      const metaFile = files.find(f => f.name === 'project.json');
      if (metaFile) {
        try {
          meta = await readJsonFile(metaFile.id) || {};
        } catch {}
      }
    } catch {}

    const project = {
      id: folder.id,
      folder_name: folder.name,
      folder_id: folder.id,
      db_id: meta.db_id || null,
      color: meta.color || null,
      notes: meta.notes || null,
      tags: JSON.stringify(meta.tags || []),
      image_count: imageCount,
      is_own: 1,
      is_starred: meta.is_starred ? 1 : 0,
      year: meta.year || null,
      updated_at: folder.modifiedTime,
    };

    projects.push(project);
    if (onProject) onProject(project);
  }

  return projects;
};

/**
 * Save project metadata (tags, color, notes, starred) to project.json in the project folder
 */
export const saveProjectMetadata = async (projectFolderId, metadata, projectName = null) => {
  // Check if project.json already exists
  const files = await listFiles(projectFolderId, {
    fields: 'files(id,name)',
    pageSize: 100,
  });
  const metaFile = files.find(f => f.name === 'project.json');

  const data = {
    tags: metadata.tags || [],
    color: metadata.color || null,
    notes: metadata.notes || null,
    is_starred: metadata.is_starred || false,
    updated_at: new Date().toISOString(),
  };

  if (metaFile) {
    await updateJsonFile(metaFile.id, data);
  } else {
    await createJsonFile(projectFolderId, 'project.json', data);
  }

  // Also create a change request so desktop inbox shows the update
  try {
    await reportProjectMetadataChange(projectFolderId, projectName, data);
  } catch (e) {
    console.warn('[Fuchs] Could not create project change request:', e.message);
  }

  return data;
};

/**
 * Report full project metadata change (color, notes, tags) to desktop inbox.
 */
export const reportProjectMetadataChange = async (projectFolderId, projectName, metadata) => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) return;

  const inboxFolderId = await getInboxFolderId();
  const deviceId = await getSetting('heartbeat_device_id', '');
  const deviceName = await getSetting('deviceName', 'Handy');
  const userName = await getSetting('userName', '');

  const entry = {
    id: `proj_chg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    device_id: deviceId,
    device_name: deviceName,
    user_name: userName,
    project_name: projectName,
    project_folder_id: projectFolderId || null,
    color: metadata.color || null,
    notes: metadata.notes || null,
    tags: metadata.tags || [],
    is_starred: metadata.is_starred || false,
    created_at: new Date().toISOString(),
  };

  await _appendToInboxJson(inboxFolderId, 'projekt_change_requests.json', entry);
};

/**
 * Fetch images from a project's Drive folder
 */
export const fetchProjectImages = async (projectFolderId) => {
  if (!projectFolderId) return [];

  const files = await listFiles(projectFolderId, {
    fields: 'files(id,name,mimeType,size,modifiedTime,thumbnailLink,imageMediaMetadata)',
    orderBy: 'modifiedTime desc',
  });

  // Filter to only image files
  return files.filter(f =>
    f.mimeType && f.mimeType.startsWith('image/')
  ).map(f => ({
    id: f.id,
    name: f.name,
    mime_type: f.mimeType,
    size: f.size ? parseInt(f.size) : 0,
    modified_time: f.modifiedTime,
    thumbnail_link: f.thumbnailLink,
    width: f.imageMediaMetadata?.width,
    height: f.imageMediaMetadata?.height,
  }));
};

/**
 * Get the inbox folder ID (finds or creates it)
 */
const getInboxFolderId = async () => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  if (connection.inbox_folder_id) return connection.inbox_folder_id;

  const folder = await findOrCreateFolder(connection.meta_folder_id, 'inbox');
  return folder.id;
};

/**
 * Create a new project – writes entry to projekt_requests.json in inbox/.
 * The desktop software reads this and shows a pending project creation request.
 * Returns { id: null, folder_id: null, folder_name: name } since there is no
 * Drive folder yet – the desktop creates it on confirmation.
 */
export const createProject = async (name) => {
  const inboxFolderId = await getInboxFolderId();
  const deviceId = await getSetting('heartbeat_device_id', '');
  const deviceName = await getSetting('deviceName', 'Handy');
  const userName = await getSetting('userName', '');

  const entry = {
    id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    device_id: deviceId,
    device_name: deviceName,
    user_name: userName,
    project_name: name,
    notes: '',
    created_at: new Date().toISOString(),
  };

  await _appendToInboxJson(inboxFolderId, 'projekt_requests.json', entry);

  return {
    success: true,
    id: null,
    folder_name: name,
    folder_id: null,
  };
};

/**
 * Get or create the inbox/images/ subfolder (for image uploads)
 */
const _getInboxImagesFolderId = async (inboxFolderId) => {
  const folder = await findOrCreateFolder(inboxFolderId, 'images');
  return folder.id;
};

/**
 * Append an entry to a JSON array file in inbox/.
 * Creates the file if it doesn't exist.
 */
const _appendToInboxJson = async (inboxFolderId, fileName, entry) => {
  let existing = [];
  try {
    const data = await readJsonFileByName(inboxFolderId, fileName);
    if (Array.isArray(data)) existing = data;
  } catch {}

  const merged = [...existing, entry];

  const files = await listFiles(inboxFolderId, { name: fileName, fields: 'files(id,name)' });
  if (files.length > 0) {
    await updateJsonFile(files[0].id, merged);
  } else {
    await createJsonFile(inboxFolderId, fileName, merged);
  }
};

/**
 * Delete a pending project from the inbox on Drive.
 * Removes the entire folder (including all images inside it).
 * Safety check: only deletes if the folder is still inside the inbox.
 * If the desktop already confirmed the project (moved to Projekte/),
 * returns { alreadyConfirmed: true } instead of deleting.
 */
export const deletePendingProject = async (folderId) => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  // Check if folder still exists and where it lives
  const parents = await getFileParents(folderId);
  if (parents.length === 0) {
    // Folder doesn't exist anymore (already deleted or moved)
    return { alreadyConfirmed: true };
  }

  // Find the inbox folder ID to verify parent
  const inboxFolder = await findFolder(connection.meta_folder_id, 'inbox');
  if (!inboxFolder || !parents.includes(inboxFolder.id)) {
    // Folder exists but is NOT in inbox anymore → already confirmed by desktop
    return { alreadyConfirmed: true };
  }

  // Safe to delete - folder is still in inbox
  await deleteFile(folderId);
  return { alreadyConfirmed: false };
};

// ============================================================
// Upload
// ============================================================

/**
 * Upload an image to Google Drive → always into inbox/images/ with a unique file name.
 * The caller (uploadQueue) later calls flushImageRequests() to write the JSON metadata.
 *
 * Returns { success, fileId, uniqueFileName }
 */
export const uploadImage = async (fileUri, fileName, mimeType, projectFolderId = null, projectName = null, gpsData = null, customTitle = null, notes = null, photoTakenAt = null) => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  const inboxFolderId = await getInboxFolderId();
  const imagesFolderId = await _getInboxImagesFolderId(inboxFolderId);

  // Build unique file name to avoid collisions across devices
  const deviceId = await getSetting('heartbeat_device_id', '');
  const devicePrefix = deviceId ? deviceId.substring(0, 8) : 'unknown';
  const ext = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
  const baseName = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
  const uniqueFileName = `${Date.now()}_${devicePrefix}_${baseName}${ext}`;

  // Build FUCHS_META description (GPS, title, notes, capture date) on the Drive file itself
  let description = null;
  const parsedGps = gpsData ? (typeof gpsData === 'string' ? JSON.parse(gpsData) : gpsData) : null;
  const userName = await getSetting('userName', '');
  const meta = {};
  if (parsedGps) {
    meta.gps = {
      latitude: parsedGps.latitude,
      longitude: parsedGps.longitude,
      altitude: parsedGps.altitude || null,
    };
  }
  if (customTitle) meta.title = customTitle;
  if (notes) meta.notes = notes;
  if (userName) meta.uploaded_by = userName;
  if (photoTakenAt) meta.photo_taken_at = photoTakenAt;
  if (Object.keys(meta).length > 0) {
    description = `[FUCHS_META]${JSON.stringify(meta)}`;
  }

  const uploadedFile = await uploadFile(
    imagesFolderId,
    uniqueFileName,
    fileUri,
    mimeType || 'image/jpeg',
    description
  );

  return { success: true, fileId: uploadedFile.id, uniqueFileName };
};

/**
 * After a batch of uploads, write/update image_requests.json with grouped entries.
 * uploadedItems: array of { item (queue DB row), fileId, uniqueFileName }
 */
export const flushImageRequests = async (uploadedItems) => {
  if (!uploadedItems || uploadedItems.length === 0) return;

  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) return;

  const inboxFolderId = await getInboxFolderId();
  const deviceId = await getSetting('heartbeat_device_id', '');
  const deviceName = await getSetting('deviceName', 'Handy');
  const userName = await getSetting('userName', '');

  // Group by project (project_folder_id + project_name as key)
  const groups = new Map();
  for (const { item, fileId, uniqueFileName } of uploadedItems) {
    const key = `${item.project_folder_id || 'null'}|${item.project_name || 'null'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        project_folder_id: item.project_folder_id || null,
        project_name: item.project_name || null,
        images: [],
      });
    }
    groups.get(key).images.push({
      drive_file_id: fileId,
      file_name: uniqueFileName,
      mime_type: item.mime_type || 'image/jpeg',
      custom_title: item.custom_title || null,
      notes: item.notes || null,
    });
  }

  // Read existing image_requests.json
  let existing = [];
  try {
    const data = await readJsonFileByName(inboxFolderId, 'image_requests.json');
    if (Array.isArray(data)) existing = data;
  } catch {}

  // Add one entry per project group
  const now = new Date().toISOString();
  for (const group of groups.values()) {
    existing.push({
      id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      device_id: deviceId,
      device_name: deviceName,
      user_name: userName,
      project_name: group.project_name,
      project_folder_id: group.project_folder_id,
      images: group.images,
      created_at: now,
    });
  }

  // Write back
  const files = await listFiles(inboxFolderId, { name: 'image_requests.json', fields: 'files(id,name)' });
  if (files.length > 0) {
    await updateJsonFile(files[0].id, existing);
  } else {
    await createJsonFile(inboxFolderId, 'image_requests.json', existing);
  }
};

/**
 * Report project notes change to desktop via projekt_change_requests.json
 */
export const reportProjectNotes = async (projectId, projectFolderId, projectName, notes) => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) return;

  const inboxFolderId = await getInboxFolderId();
  const deviceId = await getSetting('heartbeat_device_id', '');
  const deviceName = await getSetting('deviceName', 'Handy');
  const userName = await getSetting('userName', '');

  const entry = {
    id: `proj_chg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    device_id: deviceId,
    device_name: deviceName,
    user_name: userName,
    project_id: projectId || null,
    project_name: projectName,
    project_folder_id: projectFolderId || null,
    notes,
    created_at: new Date().toISOString(),
  };

  await _appendToInboxJson(inboxFolderId, 'projekt_change_requests.json', entry);
};

/**
 * Report image metadata change to desktop via image_change_requests.json.
 * Used when user edits title/notes of an already-uploaded image.
 */
export const reportImageChanges = async (driveFileId, fileName, changes) => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) return;

  const inboxFolderId = await getInboxFolderId();
  const deviceId = await getSetting('heartbeat_device_id', '');
  const deviceName = await getSetting('deviceName', 'Handy');
  const userName = await getSetting('userName', '');

  const entry = {
    id: `img_chg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    device_id: deviceId,
    device_name: deviceName,
    user_name: userName,
    drive_file_id: driveFileId || null,
    file_name: fileName,
    changes,
    created_at: new Date().toISOString(),
  };

  await _appendToInboxJson(inboxFolderId, 'image_change_requests.json', entry);
};

// ============================================================
// Sync
// ============================================================

/**
 * Fetch sync data (projects from Drive folders, tags if available)
 * @param {boolean} tagsOnly - if true, only fetch tags (projects already handled progressively)
 */
export const fetchSyncData = async (tagsOnly = false) => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  // Scan project folders (unless tagsOnly)
  const projects = tagsOnly ? [] : await fetchProjects();

  // Try to read tags.json (optional - may not exist)
  let tags = [];
  try {
    const tagsData = await readJsonFileByName(connection.meta_folder_id, 'tags.json');
    tags = tagsData?.tags || [];
  } catch {}

  return {
    projects,
    tags,
    serverTime: new Date().toISOString(),
  };
};

// ============================================================
// Delete Requests (ask desktop software to delete images)
// ============================================================

/**
 * Write delete requests to delete_requests.json in the inbox folder on Drive.
 * The desktop software reads this file and shows the requests in the inbox modal.
 */
export const requestDeleteFromSoftware = async (photos) => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  const inboxFolderId = await getInboxFolderId();
  const { getSetting } = require('./database');
  const userName = await getSetting('userName', 'Handy');

  // Build new delete request entries
  const newRequests = photos.map(photo => ({
    id: `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    file_name: photo.file_name,
    project_name: photo.project_name || null,
    project_id: photo.project_id || null,
    requested_at: new Date().toISOString(),
    requested_by: userName,
  }));

  // Read existing delete_requests.json (if any)
  let existing = [];
  try {
    const data = await readJsonFileByName(inboxFolderId, 'delete_requests.json');
    if (Array.isArray(data)) existing = data;
  } catch {}

  const merged = [...existing, ...newRequests];

  // Write back (create or update)
  const files = await listFiles(inboxFolderId, {
    name: 'delete_requests.json',
    fields: 'files(id,name)',
  });

  if (files.length > 0) {
    await updateJsonFile(files[0].id, merged);
  } else {
    await createJsonFile(inboxFolderId, 'delete_requests.json', merged);
  }

  return newRequests.length;
};

// ============================================================
// Image Access
// ============================================================

/**
 * Get image source for React Native Image component
 * Returns { uri, headers } for direct Drive access
 */
export const getImageUrl = async (driveFileId) => {
  return getImageSource(driveFileId);
};

// ============================================================
// App Update (via Google Drive)
// ============================================================

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/**
 * Check if a newer version of the app is available on Google Drive.
 * Looks for:  meta_folder_id / src / app update / version.json
 *             meta_folder_id / src / app update / app.apk
 *
 * Returns { version, apkFileId } or null if no update found.
 */
export const checkAppUpdate = async () => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) return null;

  try {
    const srcFolder = await findFolder(connection.meta_folder_id, 'src');
    if (!srcFolder) return null;

    const updateFolder = await findFolder(srcFolder.id, 'app update');
    if (!updateFolder) return null;

    const files = await listFiles(updateFolder.id, { fields: 'files(id,name)' });
    const versionFile = files.find(f => f.name === 'version.json');
    const apkFile    = files.find(f => f.name === 'app.apk');

    if (!versionFile || !apkFile) return null;

    const versionData = await readJsonFile(versionFile.id);
    return {
      version:   versionData?.version || '0.0.0',
      apkFileId: apkFile.id,
    };
  } catch {
    return null;
  }
};

/**
 * Download the update APK from Google Drive to the local cache.
 * @param {string} apkFileId   - Drive file ID of app.apk
 * @param {function} onProgress - called with (percent 0-100)
 * @returns {string} local file URI of the downloaded APK
 */
export const downloadAppUpdateApk = async (apkFileId, onProgress, onResumableCreated) => {
  const destPath = FileSystem.cacheDirectory + 'fuchs-update.apk';

  // Remove old cached APK
  try {
    const info = await FileSystem.getInfoAsync(destPath);
    if (info.exists) await FileSystem.deleteAsync(destPath, { idempotent: true });
  } catch {}

  const token = await getAccessToken();
  if (!token) throw new Error('Nicht mit Google angemeldet');

  const dl = FileSystem.createDownloadResumable(
    `${DRIVE_API}/files/${apkFileId}?alt=media`,
    destPath,
    { headers: { Authorization: `Bearer ${token}` } },
    (progress) => {
      if (progress.totalBytesExpectedToWrite > 0 && onProgress) {
        onProgress(Math.round(progress.totalBytesWritten / progress.totalBytesExpectedToWrite * 100));
      }
    }
  );

  if (onResumableCreated) onResumableCreated(dl);

  const result = await dl.downloadAsync();
  if (!result?.uri) throw new Error('Download fehlgeschlagen');
  return result.uri;
};

/**
 * Download an image from Drive to local storage
 */
export const downloadImageFile = async (driveFileId, localPath) => {
  return downloadFile(driveFileId, localPath);
};

// ============================================================
// Connection Check
// ============================================================

/**
 * Check if Drive connection is active and accessible
 */
export const checkConnection = async () => {
  try {
    const connection = await getActiveDriveConnection();
    if (!connection) return false;
    return checkFolderAccess(connection.root_folder_id);
  } catch {
    return false;
  }
};
