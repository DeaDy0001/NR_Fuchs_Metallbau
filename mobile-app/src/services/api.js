/**
 * API Service - Google Drive basiert
 *
 * Ersetzt die alte server-basierte API.
 * Alle Daten kommen von/gehen zu Google Drive.
 *
 * Drive-Ordnerstruktur:
 *   Root Folder (per QR-Code verknüpft)
 *   ├── NR_Fuchs_Meta/
 *   │   ├── projects.json    (Software schreibt, App liest)
 *   │   ├── tags.json        (Software schreibt, App liest)
 *   │   └── inbox/           (App schreibt hier rein)
 *   │       ├── upload_*.json
 *   │       └── new_project_*.json
 *   ├── ProjektOrdner1/      (Bilder)
 *   └── ProjektOrdner2/      (Bilder)
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
} from './driveService';

// ============================================================
// Projects
// ============================================================

/**
 * Fetch projects from projects.json on Drive
 */
export const fetchProjects = async () => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  const data = await readJsonFileByName(connection.meta_folder_id, 'projects.json');
  if (!data) return [];

  return data.projects || [];
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
 * Create a new project request (writes to inbox)
 */
export const createProject = async (name) => {
  const connection = await getActiveDriveConnection();
  if (!connection?.inbox_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  const userName = await getSetting('userName', 'Unbekannt');
  const userEmail = await getSetting('googleUserEmail', '');

  const timestamp = new Date().toISOString();
  const id = Math.random().toString(36).substr(2, 8);
  const fileName = `new_project_${timestamp.split('T')[0]}_${userName.replace(/\s+/g, '_')}_${id}.json`;

  const data = {
    type: 'new_project',
    projectName: name,
    userName,
    userEmail,
    timestamp,
  };

  await createJsonFile(connection.inbox_folder_id, fileName, data);
  return { success: true, name };
};

// ============================================================
// Upload
// ============================================================

/**
 * Upload an image to Google Drive inbox
 */
export const uploadImage = async (fileUri, fileName, mimeType, projectId = null, projectName = null, gpsData = null) => {
  const connection = await getActiveDriveConnection();
  if (!connection?.inbox_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  const userName = await getSetting('userName', 'Unbekannt');
  const userEmail = await getSetting('googleUserEmail', '');

  // Upload the actual image file to inbox
  const uploadedFile = await uploadFile(
    connection.inbox_folder_id,
    fileName,
    fileUri,
    mimeType || 'image/jpeg'
  );

  // Create metadata JSON alongside the image
  const timestamp = new Date().toISOString();
  const id = Math.random().toString(36).substr(2, 8);
  const metaFileName = `upload_${timestamp.split('T')[0]}_${userName.replace(/\s+/g, '_')}_${id}.json`;

  const metadata = {
    type: 'image_upload',
    fileName,
    driveFileId: uploadedFile.id,
    userName,
    userEmail,
    projectId: projectId || null,
    projectName: projectName || null,
    gps: gpsData || null,
    timestamp,
  };

  await createJsonFile(connection.inbox_folder_id, metaFileName, metadata);

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
 * Fetch sync data (projects + tags) from Drive
 */
export const fetchSyncData = async () => {
  const connection = await getActiveDriveConnection();
  if (!connection?.meta_folder_id) throw new Error('Keine Drive-Verbindung aktiv');

  const projects = await readJsonFileByName(connection.meta_folder_id, 'projects.json');
  const tags = await readJsonFileByName(connection.meta_folder_id, 'tags.json');

  return {
    projects: projects?.projects || [],
    tags: tags?.tags || [],
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
