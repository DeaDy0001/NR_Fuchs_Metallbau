import * as FileSystem from 'expo-file-system/legacy';
import { getAccessToken } from './googleAuth';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

const getHeaders = async () => {
  const token = await getAccessToken();
  if (!token) throw new Error('Nicht mit Google angemeldet');
  return { Authorization: `Bearer ${token}` };
};

// ============================================================
// File Listing & Search
// ============================================================

/**
 * List files in a Google Drive folder
 */
export const listFiles = async (folderId, options = {}) => {
  const headers = await getHeaders();

  let query = `'${folderId}' in parents and trashed = false`;
  if (options.mimeType) query += ` and mimeType = '${options.mimeType}'`;
  if (options.name) query += ` and name = '${options.name}'`;

  const fields = options.fields || 'files(id,name,mimeType,size,modifiedTime,thumbnailLink,imageMediaMetadata)';

  const params = new URLSearchParams({
    q: query,
    fields,
    pageSize: String(options.pageSize || 1000),
    orderBy: options.orderBy || 'name',
  });

  const response = await fetch(`${DRIVE_API}/files?${params}`, { headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Drive API Fehler: ${response.status}`);
  }

  const data = await response.json();
  return data.files || [];
};

/**
 * Find a folder by name inside a parent folder
 */
export const findFolder = async (parentId, folderName) => {
  const files = await listFiles(parentId, {
    mimeType: 'application/vnd.google-apps.folder',
    name: folderName,
    fields: 'files(id,name)',
  });
  return files.length > 0 ? files[0] : null;
};

/**
 * Find or create a folder
 */
export const findOrCreateFolder = async (parentId, folderName) => {
  const existing = await findFolder(parentId, folderName);
  if (existing) return existing;
  return createFolder(parentId, folderName);
};

// ============================================================
// File Reading
// ============================================================

/**
 * Read a file's content as JSON
 */
export const readJsonFile = async (fileId) => {
  const headers = await getHeaders();
  const response = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, { headers });

  if (!response.ok) {
    throw new Error(`Datei konnte nicht gelesen werden: ${response.status}`);
  }

  return response.json();
};

/**
 * Find a file by name in a folder and read it as JSON
 */
export const readJsonFileByName = async (folderId, fileName) => {
  const files = await listFiles(folderId, {
    name: fileName,
    fields: 'files(id,name)',
  });

  if (files.length === 0) return null;
  return readJsonFile(files[0].id);
};

/**
 * Get file metadata
 */
export const getFileMetadata = async (fileId) => {
  const headers = await getHeaders();
  const response = await fetch(
    `${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,thumbnailLink,imageMediaMetadata,webContentLink`,
    { headers }
  );

  if (!response.ok) throw new Error(`Metadaten nicht abrufbar: ${response.status}`);
  return response.json();
};

// ============================================================
// File Upload (resumable for images, simple for JSON)
// ============================================================

/**
 * Upload a file to Drive using resumable upload (good for large files)
 */
export const uploadFile = async (folderId, fileName, fileUri, mimeType = 'image/jpeg') => {
  const token = await getAccessToken();
  if (!token) throw new Error('Nicht mit Google angemeldet');

  // Step 1: Initiate resumable upload
  const initResponse = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,size`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
      }),
    }
  );

  if (!initResponse.ok) {
    const error = await initResponse.json().catch(() => ({}));
    throw new Error(error.error?.message || 'Upload-Initialisierung fehlgeschlagen');
  }

  const uploadUrl = initResponse.headers.get('Location');
  if (!uploadUrl) throw new Error('Keine Upload-URL erhalten');

  // Step 2: Upload the actual file data
  const uploadResult = await FileSystem.uploadAsync(uploadUrl, fileUri, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': mimeType },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  });

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`Upload fehlgeschlagen: HTTP ${uploadResult.status}`);
  }

  return JSON.parse(uploadResult.body);
};

/**
 * Create a small JSON file on Drive
 */
export const createJsonFile = async (folderId, fileName, data) => {
  const token = await getAccessToken();
  if (!token) throw new Error('Nicht mit Google angemeldet');

  const boundary = 'fuchs_boundary_' + Date.now();

  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
    mimeType: 'application/json',
  });

  const jsonContent = JSON.stringify(data, null, 2);

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${jsonContent}\r\n` +
    `--${boundary}--`;

  const response = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `JSON-Datei erstellen fehlgeschlagen: ${response.status}`);
  }

  return response.json();
};

/**
 * Update an existing JSON file on Drive (overwrite content)
 */
export const updateJsonFile = async (fileId, data) => {
  const token = await getAccessToken();
  if (!token) throw new Error('Nicht mit Google angemeldet');

  const response = await fetch(
    `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(data, null, 2),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `JSON-Datei update fehlgeschlagen: ${response.status}`);
  }

  return response.json();
};

// ============================================================
// Folder Operations
// ============================================================

/**
 * Create a folder on Drive
 */
export const createFolder = async (parentId, folderName) => {
  const headers = await getHeaders();

  const response = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Ordner erstellen fehlgeschlagen: ${response.status}`);
  }

  return response.json();
};

// ============================================================
// File Download
// ============================================================

/**
 * Download a file from Drive to local storage
 */
export const downloadFile = async (fileId, localPath) => {
  const token = await getAccessToken();
  if (!token) throw new Error('Nicht mit Google angemeldet');

  const result = await FileSystem.downloadAsync(
    `${DRIVE_API}/files/${fileId}?alt=media`,
    localPath,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return result;
};

/**
 * Get a download URL with auth headers for an image
 * (for use with React Native Image component)
 */
export const getImageSource = async (fileId) => {
  const token = await getAccessToken();
  if (!token) return null;

  return {
    uri: `${DRIVE_API}/files/${fileId}?alt=media`,
    headers: { Authorization: `Bearer ${token}` },
  };
};

/**
 * Get a thumbnail source with auth headers
 * Uses thumbnailLink from file metadata if available, else falls back to download
 */
export const getThumbnailSource = async (thumbnailLink) => {
  if (!thumbnailLink) return null;

  const token = await getAccessToken();
  if (!token) return null;

  return {
    uri: thumbnailLink,
    headers: { Authorization: `Bearer ${token}` },
  };
};

// ============================================================
// Connection Check
// ============================================================

/**
 * Check if we can access a Drive folder
 */
export const checkFolderAccess = async (folderId) => {
  try {
    const headers = await getHeaders();
    const response = await fetch(
      `${DRIVE_API}/files/${folderId}?fields=id,name`,
      { headers }
    );
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Verify a drive connection is valid and accessible
 * Returns the folder name if accessible, null otherwise
 */
export const verifyConnection = async (rootFolderId) => {
  try {
    const headers = await getHeaders();
    const response = await fetch(
      `${DRIVE_API}/files/${rootFolderId}?fields=id,name`,
      { headers }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.name;
  } catch {
    return null;
  }
};
