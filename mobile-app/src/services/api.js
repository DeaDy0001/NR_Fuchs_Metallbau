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
      color: meta.color || null,
      notes: meta.notes || null,
      tags: JSON.stringify(meta.tags || []),
      image_count: imageCount,
      is_own: 1,
      is_starred: meta.is_starred ? 1 : 0,
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
 * Create a new project (= create folder on Drive under Projekte/)
 * Creates the project folder directly under Projekte/ with a Bilder subfolder.
 * Returns the new project object with folder info
 */
export const createProject = async (name) => {
  const projekteFolderId = await getProjekteFolderId();

  // Check if folder already exists in Projekte/
  const existing = await findFolder(projekteFolderId, name);
  if (existing) {
    // Ensure Bilder subfolder exists
    await findOrCreateFolder(existing.id, 'Bilder');
    return {
      success: true,
      id: existing.id,
      folder_name: name,
      folder_id: existing.id,
    };
  }

  // Create project folder under Projekte/
  const folder = await findOrCreateFolder(projekteFolderId, name);

  // Create Bilder subfolder
  const bilderFolder = await findOrCreateFolder(folder.id, 'Bilder');

  return {
    success: true,
    id: folder.id,
    folder_name: name,
    folder_id: folder.id,
    bilder_folder_id: bilderFolder.id,
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

  // Upload the actual image file
  const uploadedFile = await uploadFile(
    targetFolderId,
    fileName,
    fileUri,
    mimeType || 'image/jpeg'
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
