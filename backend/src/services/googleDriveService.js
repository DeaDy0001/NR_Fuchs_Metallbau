const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const { getDriveClient, isAuthenticated } = require('./authService');

/**
 * Google Drive Service
 * Handles syncing images from Google Drive folders using OAuth 2.0
 */

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
      fields: 'files(id,name,mimeType,size,webContentLink,thumbnailLink,imageMediaMetadata)',
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
      height: file.imageMediaMetadata?.height || null
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
      fields: 'files(id,name,mimeType,size,webContentLink,thumbnailLink,imageMediaMetadata)',
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
        subfolder: parentSubfolder // Only first-level subfolder name
      });
    });

    // Find subfolders
    const subfolders = items.filter(item =>
      item.mimeType === 'application/vnd.google-apps.folder'
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
      response.data
        .on('error', reject)
        .pipe(dest)
        .on('error', reject)
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

    // Resize if needed
    if (maxWidth || maxHeight) {
      const resizeOptions = {};
      if (maxWidth) resizeOptions.width = maxWidth;
      if (maxHeight) resizeOptions.height = maxHeight;
      resizeOptions.fit = 'inside';
      resizeOptions.withoutEnlargement = true;

      image = image.resize(resizeOptions);
    }

    // Convert and compress
    switch (format.toLowerCase()) {
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

    if (error.code === 404) {
      throw new Error('Datei nicht gefunden auf Google Drive.');
    }

    if (error.code === 403) {
      throw new Error('Keine Berechtigung zum Löschen. Stelle sicher, dass du Bearbeitungsrechte für diese Datei hast.');
    }

    throw error;
  }
};

module.exports = {
  extractFolderId,
  listFilesInFolder,
  listFilesInFolderRecursive,
  downloadFile,
  compressImage,
  generateThumbnail,
  deleteFileFromDrive,
  deleteFile: deleteFileFromDrive // Alias for consistency
};
