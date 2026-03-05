/**
 * API Service - Google Drive basiert
 *
 * Projekte = Ordner auf Google Drive unter NR_Fuchs_Meta/Projekte/
 * Bilder mit Projekt → direkt in den Projektordner
 * Bilder ohne Projekt → in NR_Fuchs_Meta/inbox/
 *
 * Drive-Ordnerstruktur:
 *   Root Folder (per QR-Code verknüpft)
 *   ├── NR_Fuchs_Meta/
 *   │   ├── Projekte/
 *   │   │   ├── ProjektName1/   (Bilder)
 *   │   │   └── ProjektName2/   (Bilder)
 *   │   └── inbox/              (Bilder ohne Projekt)
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
import * as FileSystem from 'expo-file-system';
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
export const saveProjectMetadata = async (projectFolderId, metadata) => {
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

  return data;
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
 * Create a new project (= create folder on Drive under inbox/)
 * The project stays in the inbox until confirmed by the desktop software,
 * which moves it to Projekte/ and creates the proper folder structure.
 */
export const createProject = async (name) => {
  const inboxFolderId = await getInboxFolderId();

  // Check if folder already exists in inbox
  const existing = await findFolder(inboxFolderId, name);
  const folder = existing || await findOrCreateFolder(inboxFolderId, name);

  // Write/update creator info so desktop inbox shows who created this project
  try {
    const userName = await getSetting('userName', '');
    if (userName) {
      const existingFiles = await listFiles(folder.id, { name: '_meta.json', fields: 'files(id,name)' });
      if (existingFiles.length > 0) {
        await updateJsonFile(existingFiles[0].id, { created_by: userName, created_at: new Date().toISOString() });
      } else {
        await createJsonFile(folder.id, '_meta.json', { created_by: userName, created_at: new Date().toISOString() });
      }
    }
  } catch {}

  return {
    success: true,
    id: folder.id,
    folder_name: name,
    folder_id: folder.id,
  };
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
 * Upload an image to Google Drive
 * - With project: directly into the project folder
 * - Without project: into inbox folder
 */
export const uploadImage = async (fileUri, fileName, mimeType, projectId = null, projectName = null, gpsData = null, customTitle = null, notes = null) => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  let targetFolderId;

  if (projectId) {
    // projectId is the Drive folder ID - use it directly (inbox or Projekte)
    targetFolderId = projectId;
  } else if (projectName) {
    // Fallback: find/create folder in inbox by name
    const inboxFolderId = await getInboxFolderId();
    const projectFolder = await findOrCreateFolder(inboxFolderId, projectName);
    targetFolderId = projectFolder.id;
  } else {
    // No project - upload to inbox/{deviceId}/ subfolder
    let inboxFolderId;
    if (!connection.inbox_folder_id) {
      const inboxFolder = await findOrCreateFolder(connection.meta_folder_id, 'inbox');
      inboxFolderId = inboxFolder.id;
    } else {
      inboxFolderId = connection.inbox_folder_id;
    }

    // Use fixed device ID for subfolder (stays constant, unlike userName which can change)
    const deviceId = await getSetting('heartbeat_device_id', '');
    if (deviceId) {
      const deviceFolder = await findOrCreateFolder(inboxFolderId, deviceId);
      targetFolderId = deviceFolder.id;
    } else {
      targetFolderId = inboxFolderId;
    }
  }

  // Build metadata description (GPS, title, notes, uploader) to store on Drive
  let description = null;
  const parsedGps = gpsData ? (typeof gpsData === 'string' ? JSON.parse(gpsData) : gpsData) : null;
  const userName = await getSetting('userName', '');
  if (parsedGps || customTitle || notes || userName) {
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
    description = `[FUCHS_META]${JSON.stringify(meta)}`;
  }

  // Upload the actual image file
  const uploadedFile = await uploadFile(
    targetFolderId,
    fileName,
    fileUri,
    mimeType || 'image/jpeg',
    description
  );

  return { success: true, fileId: uploadedFile.id };
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
export const downloadAppUpdateApk = async (apkFileId, onProgress) => {
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
