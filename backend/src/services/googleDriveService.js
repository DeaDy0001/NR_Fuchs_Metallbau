const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const { getDriveClient, isAuthenticated } = require('./authService');

/**
 * Google Drive Service
 * Handles syncing images from Google Drive folders using OAuth 2.0
 */

// Escape single quotes for Google Drive API query strings
const escQ = (str) => String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// Extract folder ID from Google Drive URL
const extractFolderId = (url) => {
  try {
    // Support various Google Drive URL formats
    // https://drive.google.com/drive/folders/FOLDER_ID
    // https://drive.google.com/drive/u/0/folders/FOLDER_ID
    const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }

    // If it's already just an ID
    if (url.match(/^[a-zA-Z0-9_-]+$/)) {
      return url;
    }

    return null;
  } catch (error) {
    console.error('Error extracting folder ID:', error);
    return null;
  }
};

// List all files in a Google Drive folder using OAuth
const listFilesInFolder = async (folderId) => {
  try {
    // Check if authenticated
    if (!await isAuthenticated()) {
      throw new Error('Not authenticated. Please login with Google first: http://localhost:3001/api/auth/google');
    }

    // Get authenticated Drive client
    const drive = await getDriveClient();

    // List files in folder
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,size,webContentLink,thumbnailLink,imageMediaMetadata,description)',
      pageSize: 1000
    });

    // Filter for image files only
    const imageFiles = response.data.files.filter(file =>
      file.mimeType && file.mimeType.startsWith('image/')
    );

    return imageFiles.map(file => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: parseInt(file.size) || 0,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${file.id}`,
      thumbnailUrl: file.thumbnailLink,
      width: file.imageMediaMetadata?.width || null,
      height: file.imageMediaMetadata?.height || null,
      description: file.description || null
    }));
  } catch (error) {
    console.error('Error listing files in folder:', error.message);

    // Better error messages
    if (error.message.includes('Not authenticated')) {
      throw error;
    }

    if (error.code === 404) {
      throw new Error('Ordner nicht gefunden. Überprüfe die Ordner-ID und Berechtigungen.');
    }

    if (error.code === 403) {
      throw new Error('Keine Berechtigung zum Zugriff auf diesen Ordner. Stelle sicher, dass der Ordner für dein Google-Konto freigegeben ist.');
    }

    throw error;
  }
};

// List all files recursively in folder and subfolders
const listFilesInFolderRecursive = async (folderId, parentSubfolder = null) => {
  try {
    // Check if authenticated
    if (!await isAuthenticated()) {
      throw new Error('Not authenticated. Please login with Google first: http://localhost:3001/api/auth/google');
    }

    // Get authenticated Drive client
    const drive = await getDriveClient();

    let allFiles = [];

    // List all items in folder (both files and folders)
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,size,webContentLink,thumbnailLink,imageMediaMetadata,description)',
      pageSize: 1000
    });

    const items = response.data.files;

    // Process image files
    const imageFiles = items.filter(file =>
      file.mimeType && file.mimeType.startsWith('image/')
    );

    // Add images with subfolder info (only first-level subfolder)
    imageFiles.forEach(file => {
      allFiles.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: parseInt(file.size) || 0,
        downloadUrl: `https://drive.google.com/uc?export=download&id=${file.id}`,
        thumbnailUrl: file.thumbnailLink,
        width: file.imageMediaMetadata?.width || null,
        height: file.imageMediaMetadata?.height || null,
        subfolder: parentSubfolder,
        description: file.description || null
      });
    });

    // Find subfolders (skip NR_Fuchs_Meta - used internally for inbox/mobile system)
    const subfolders = items.filter(item =>
      item.mimeType === 'application/vnd.google-apps.folder' &&
      item.name !== 'NR_Fuchs_Meta'
    );

    // Recursively process subfolders
    for (const subfolder of subfolders) {
      // Keep only the first-level subfolder name
      const subfolderName = parentSubfolder || subfolder.name;

      const subfolderFiles = await listFilesInFolderRecursive(
        subfolder.id,
        subfolderName
      );

      allFiles = allFiles.concat(subfolderFiles);
    }

    return allFiles;
  } catch (error) {
    console.error('Error listing files recursively:', error.message);
    throw error;
  }
};


// Download a file from Google Drive
const downloadFile = async (fileId, destinationPath) => {
  try {
    const drive = await getDriveClient();

    const response = await drive.files.get(
      { fileId: fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    await fs.ensureDir(path.dirname(destinationPath));

    await new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(destinationPath);
      const cleanup = (err) => {
        dest.destroy();
        reject(err);
      };
      response.data
        .on('error', cleanup)
        .pipe(dest)
        .on('error', cleanup)
        .on('finish', resolve);
    });

    const stats = await fs.stat(destinationPath);

    return {
      success: true,
      path: destinationPath,
      size: stats.size
    };
  } catch (error) {
    console.error('Error downloading file:', error.message);
    throw error;
  }
};

// Compress image
const compressImage = async (inputPath, outputPath, options = {}) => {
  try {
    const {
      format = 'webp',
      quality = 85,
      maxWidth = null,
      maxHeight = null
    } = options;

    let image = sharp(inputPath);

    // WICHTIG: Automatisch EXIF-Rotation anwenden!
    image = image.rotate();

    // Get image metadata
    const metadata = await image.metadata();

    // Resize if needed (validate dimensions are positive integers)
    if (maxWidth || maxHeight) {
      const resizeOptions = {};
      if (maxWidth && Number.isFinite(maxWidth) && maxWidth > 0) resizeOptions.width = Math.round(maxWidth);
      if (maxHeight && Number.isFinite(maxHeight) && maxHeight > 0) resizeOptions.height = Math.round(maxHeight);
      resizeOptions.fit = 'inside';
      resizeOptions.withoutEnlargement = true;

      image = image.resize(resizeOptions);
    }

    // Convert and compress
    const validFormats = ['webp', 'jpeg', 'jpg', 'png'];
    const fmt = format.toLowerCase();
    if (!validFormats.includes(fmt)) {
      console.warn(`[Compress] Unknown format "${format}", defaulting to webp`);
    }
    switch (fmt) {
      case 'webp':
        image = image.webp({ quality });
        break;
      case 'jpeg':
      case 'jpg':
        image = image.jpeg({ quality });
        break;
      case 'png':
        image = image.png({ quality });
        break;
      default:
        image = image.webp({ quality });
    }

    await fs.ensureDir(path.dirname(outputPath));
    await image.toFile(outputPath);

    const stats = await fs.stat(outputPath);

    return {
      success: true,
      path: outputPath,
      size: stats.size,
      originalSize: metadata.size,
      width: metadata.width,
      height: metadata.height,
      format: format
    };
  } catch (error) {
    console.error('Error compressing image:', error.message);
    throw error;
  }
};

// Generate thumbnail
const generateThumbnail = async (imagePath, thumbnailPath, size = 300) => {
  try {
    await fs.ensureDir(path.dirname(thumbnailPath));

    await sharp(imagePath)
      .rotate() // Automatisch EXIF-Rotation anwenden!
      .resize(size, size, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 80 })
      .toFile(thumbnailPath);

    return {
      success: true,
      path: thumbnailPath
    };
  } catch (error) {
    console.error('Error generating thumbnail:', error.message);
    throw error;
  }
};

// Delete file from Google Drive using OAuth
const deleteFileFromDrive = async (fileId) => {
  try {
    // Check if authenticated
    if (!await isAuthenticated()) {
      throw new Error('Not authenticated. Please login with Google first.');
    }

    // Get authenticated Drive client
    const drive = await getDriveClient();

    // Delete file
    await drive.files.delete({
      fileId: fileId
    });

    console.log(`✅ Deleted file from Drive: ${fileId}`);

    return { success: true };
  } catch (error) {
    console.error('Error deleting file from Drive:', error.message);

    if (error.code === 404 || error.code === '404' || error.response?.status === 404 || (error.message && error.message.includes('File not found'))) {
      throw new Error('Datei nicht gefunden auf Google Drive.');
    }

    if (error.code === 403) {
      throw new Error('Keine Berechtigung zum Löschen. Stelle sicher, dass du Bearbeitungsrechte für diese Datei hast.');
    }

    throw error;
  }
};

/**
 * List subfolders in a Google Drive folder (not recursive, folders only)
 */
const listFoldersInFolder = async (folderId) => {
  try {
    if (!await isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const drive = await getDriveClient();
    const response = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name,modifiedTime)',
      pageSize: 1000,
      orderBy: 'name'
    });

    return response.data.files || [];
  } catch (error) {
    console.error('Error listing folders:', error.message);
    throw error;
  }
};

/**
 * List all files (not just images) in a folder
 */
const listAllFilesInFolder = async (folderId) => {
  try {
    if (!await isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const drive = await getDriveClient();
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,size,thumbnailLink,imageMediaMetadata)',
      pageSize: 1000
    });

    return response.data.files || [];
  } catch (error) {
    console.error('Error listing all files:', error.message);
    throw error;
  }
};

/**
 * Find a subfolder by name inside a parent folder
 */
const findSubfolder = async (parentFolderId, folderName) => {
  try {
    if (!await isAuthenticated()) return null;

    const drive = await getDriveClient();
    const response = await drive.files.list({
      q: `'${escQ(parentFolderId)}' in parents and name = '${escQ(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      pageSize: 1
    });

    return response.data.files?.length > 0 ? response.data.files[0] : null;
  } catch (error) {
    console.error('Error finding subfolder:', error.message);
    return null;
  }
};

/**
 * Create a folder on Google Drive
 * @param {string} name - Folder name
 * @param {string} parentFolderId - Parent folder ID
 * @returns {Object} Created folder { id, name }
 */
const createFolderOnDrive = async (name, parentFolderId) => {
  try {
    if (!await isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const drive = await getDriveClient();
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id, name',
    });

    console.log(`📁 Created folder on Drive: ${name} (${response.data.id})`);
    return response.data;
  } catch (error) {
    console.error('Error creating folder on Drive:', error.message);
    throw error;
  }
};

/**
 * Move a file on Google Drive (change parent folder)
 * @param {string} fileId - File to move
 * @param {string} newParentId - New parent folder ID
 * @param {string} oldParentId - Current parent folder ID (to remove from)
 * @returns {Object} Updated file metadata
 */
const moveFileOnDrive = async (fileId, newParentId, oldParentId) => {
  try {
    if (!await isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const drive = await getDriveClient();
    const response = await drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: oldParentId,
      fields: 'id, name, parents',
    });

    console.log(`📦 Moved file on Drive: ${response.data.name} → ${newParentId}`);
    return response.data;
  } catch (error) {
    console.error('Error moving file on Drive:', error.message);
    throw error;
  }
};

/**
 * Get file metadata including parents
 * @param {string} fileId - File ID
 * @returns {Object} File metadata with parents
 */
const getFileMetadata = async (fileId) => {
  try {
    if (!await isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const drive = await getDriveClient();
    const response = await drive.files.get({
      fileId,
      fields: 'id, name, parents, mimeType, description',
    });

    return response.data;
  } catch (error) {
    console.error('Error getting file metadata:', error.message);
    throw error;
  }
};

/**
 * Find or create a subfolder inside a parent folder
 * @param {string} parentFolderId - Parent folder ID
 * @param {string} folderName - Subfolder name
 * @returns {Object} Folder { id, name }
 */
const findOrCreateSubfolder = async (parentFolderId, folderName) => {
  const existing = await findSubfolder(parentFolderId, folderName);
  if (existing) return existing;
  return await createFolderOnDrive(folderName, parentFolderId);
};

/**
 * Find a file by name in a folder (any MIME type, including JSON).
 * Returns { id, name, mimeType } or null if not found.
 */
const findFileByName = async (parentFolderId, fileName) => {
  try {
    const drive = await getDriveClient();
    const res = await drive.files.list({
      q: `'${escQ(parentFolderId)}' in parents and name = '${escQ(fileName)}' and trashed = false`,
      fields: 'files(id,name,mimeType)',
      pageSize: 1,
    });
    return res.data.files.length > 0 ? res.data.files[0] : null;
  } catch (error) {
    console.error('Error finding file by name:', error.message);
    return null;
  }
};

/**
 * Upload a local file to Google Drive
 * @param {string} localFilePath - Full path to the local file
 * @param {string} parentFolderId - Drive folder to upload into
 * @param {string} [fileName] - Optional name override (defaults to basename)
 * @returns {Object} Uploaded file { id, name }
 */
const uploadFileToDrive = async (localFilePath, parentFolderId, fileName) => {
  try {
    if (!await isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const drive = await getDriveClient();
    const name = fileName || path.basename(localFilePath);

    // Detect mime type from extension
    const ext = path.extname(localFilePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.webp': 'image/webp',
      '.gif': 'image/gif', '.bmp': 'image/bmp',
      '.tiff': 'image/tiff', '.tif': 'image/tiff',
      '.heic': 'image/heic', '.heif': 'image/heif',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    const response = await drive.files.create({
      requestBody: {
        name,
        parents: [parentFolderId],
      },
      media: {
        mimeType,
        body: fs.createReadStream(localFilePath),
      },
      fields: 'id, name',
    });

    console.log(`⬆️ Uploaded to Drive: ${name} (${response.data.id})`);
    return response.data;
  } catch (error) {
    console.error('Error uploading file to Drive:', error.message);
    throw error;
  }
};

/**
 * Read a Drive file's content as JSON
 */
const readDriveFileAsJson = async (fileId) => {
  try {
    const drive = await getDriveClient();
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'text' }
    );
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  } catch (error) {
    console.error('Error reading Drive file as JSON:', error.message);
    throw error;
  }
};

/**
 * Update a Drive file's content (overwrite with new JSON data)
 */
const updateDriveFileContent = async (fileId, data) => {
  try {
    const drive = await getDriveClient();
    const { Readable } = require('stream');
    const content = JSON.stringify(data, null, 2);
    const stream = Readable.from([content]);

    await drive.files.update({
      fileId,
      media: {
        mimeType: 'application/json',
        body: stream,
      },
    });
  } catch (error) {
    console.error('Error updating Drive file content:', error.message);
    throw error;
  }
};

/**
 * Create or update a JSON file in a Drive folder.
 * If a file with the given name already exists, it's overwritten; otherwise created.
 */
const upsertJsonFileToDrive = async (parentFolderId, fileName, data) => {
  try {
    const drive = await getDriveClient();
    const { Readable } = require('stream');
    const content = JSON.stringify(data, null, 2);

    // Check if file already exists
    const listResponse = await drive.files.list({
      q: `'${escQ(parentFolderId)}' in parents and name = '${escQ(fileName)}' and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
    });

    const makeStream = () => Readable.from([content]);

    if (listResponse.data.files.length > 0) {
      await drive.files.update({
        fileId: listResponse.data.files[0].id,
        media: { mimeType: 'application/json', body: makeStream() },
      });
      return listResponse.data.files[0].id;
    } else {
      const createResponse = await drive.files.create({
        requestBody: { name: fileName, parents: [parentFolderId] },
        media: { mimeType: 'application/json', body: makeStream() },
        fields: 'id',
      });
      return createResponse.data.id;
    }
  } catch (error) {
    console.error('Error upserting JSON file to Drive:', error.message);
    throw error;
  }
};

/**
 * Share a Drive folder with a specific Google user (by email)
 * @param {string} folderId - Drive folder ID
 * @param {string} email - Google email address to share with
 * @returns {string} permissionId - used later to revoke access
 */
const shareFolderWithUser = async (folderId, email) => {
  try {
    if (!await isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const drive = await getDriveClient();
    const response = await drive.permissions.create({
      fileId: folderId,
      requestBody: {
        type: 'user',
        role: 'writer',
        emailAddress: email,
      },
      sendNotificationEmail: false,
      fields: 'id',
    });

    console.log(`✅ Shared folder ${folderId} with ${email} (permissionId: ${response.data.id})`);
    return response.data.id;
  } catch (error) {
    console.error('Error sharing folder with user:', error.message);
    throw error;
  }
};

/**
 * Remove a specific permission from a Drive folder (revoke user access)
 * @param {string} folderId - Drive folder ID
 * @param {string} permissionId - Permission ID returned by shareFolderWithUser
 */
const removeFolderPermission = async (folderId, permissionId) => {
  try {
    if (!await isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    const drive = await getDriveClient();
    await drive.permissions.delete({
      fileId: folderId,
      permissionId,
    });

    console.log(`✅ Removed permission ${permissionId} from folder ${folderId}`);
  } catch (error) {
    if (error.code === 404 || error.status === 404) {
      console.log(`Permission ${permissionId} already removed from ${folderId}`);
      return;
    }
    console.error('Error removing folder permission:', error.message);
    throw error;
  }
};

module.exports = {
  extractFolderId,
  listFilesInFolder,
  listFilesInFolderRecursive,
  listFoldersInFolder,
  listAllFilesInFolder,
  findSubfolder,
  downloadFile,
  compressImage,
  generateThumbnail,
  deleteFileFromDrive,
  deleteFile: deleteFileFromDrive,
  createFolderOnDrive,
  moveFileOnDrive,
  getFileMetadata,
  findOrCreateSubfolder,
  uploadFileToDrive,
  readDriveFileAsJson,
  updateDriveFileContent,
  upsertJsonFileToDrive,
  findFileByName,
  shareFolderWithUser,
  removeFolderPermission,
};
