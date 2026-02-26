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
  readJsonFileByName,
  uploadFile,
  createJsonFile,
  downloadFile,
  getImageSource,
  checkFolderAccess,
  findOrCreateFolder,
  findFolder,
} from './driveService';

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
 */
export const fetchProjects = async () => {
  const projekteFolderId = await getProjekteFolderId();

  // List all subfolders
  const folders = await listFiles(projekteFolderId, {
    mimeType: 'application/vnd.google-apps.folder',
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'name',
  });

  // For each folder, count images
  const projects = [];
  for (const folder of folders) {
    let imageCount = 0;
    try {
      const images = await listFiles(folder.id, {
        fields: 'files(id)',
        pageSize: 1000,
      });
      imageCount = images.filter(f => f.mimeType && f.mimeType.startsWith('image/')).length;
    } catch {}

    projects.push({
      id: folder.id,
      folder_name: folder.name,
      folder_id: folder.id,
      color: null,
      notes: null,
      tags: '[]',
      image_count: imageCount,
      is_own: 1,
      is_starred: 0,
      updated_at: folder.modifiedTime,
    });
  }

  return projects;
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
 * Create a new project (= create folder on Drive under Projekte/)
 * Returns the new project object with folder info
 */
export const createProject = async (name) => {
  const projekteFolderId = await getProjekteFolderId();

  // Check if folder already exists
  const existing = await findFolder(projekteFolderId, name);
  if (existing) {
    return {
      success: true,
      id: existing.id,
      folder_name: name,
      folder_id: existing.id,
    };
  }

  const folder = await findOrCreateFolder(projekteFolderId, name);

  return {
    success: true,
    id: folder.id,
    folder_name: name,
    folder_id: folder.id,
  };
};

// ============================================================
// Upload
// ============================================================

/**
 * Upload an image to Google Drive
 * - With project: directly into the project folder
 * - Without project: into inbox folder
 */
export const uploadImage = async (fileUri, fileName, mimeType, projectId = null, projectName = null, gpsData = null) => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  let targetFolderId;

  if (projectName) {
    // Upload directly to project folder
    try {
      const projekteFolderId = await getProjekteFolderId();
      const projectFolder = await findOrCreateFolder(projekteFolderId, projectName);
      targetFolderId = projectFolder.id;
    } catch {
      // Fallback to inbox if project folder creation fails
      if (!connection.inbox_folder_id) throw new Error('Kein Zielordner verfügbar');
      targetFolderId = connection.inbox_folder_id;
    }
  } else {
    // No project - upload to inbox
    if (!connection.inbox_folder_id) {
      const inboxFolder = await findOrCreateFolder(connection.meta_folder_id, 'inbox');
      targetFolderId = inboxFolder.id;
    } else {
      targetFolderId = connection.inbox_folder_id;
    }
  }

  // Upload the actual image file
  const uploadedFile = await uploadFile(
    targetFolderId,
    fileName,
    fileUri,
    mimeType || 'image/jpeg'
  );

  // Also save as recent photo
  try {
    const { addRecentPhoto } = require('./database');
    await addRecentPhoto(
      fileUri, fileName, mimeType,
      projectId, projectName,
      gpsData ? JSON.stringify(gpsData) : null
    );
  } catch {}

  return { success: true, fileId: uploadedFile.id };
};

// ============================================================
// Sync
// ============================================================

/**
 * Fetch sync data (projects from Drive folders, tags if available)
 */
export const fetchSyncData = async () => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  // Scan project folders
  const projects = await fetchProjects();

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
// Image Access
// ============================================================

/**
 * Get image source for React Native Image component
 * Returns { uri, headers } for direct Drive access
 */
export const getImageUrl = async (driveFileId) => {
  return getImageSource(driveFileId);
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
