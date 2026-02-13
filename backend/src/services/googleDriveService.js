const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');

/**
 * Google Drive Service
 * Handles syncing images from public Google Drive folders
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

// List all files in a public Google Drive folder
const listFilesInFolder = async (folderId) => {
  try {
    // Use Google Drive API v3 (public access)
    const apiKey = process.env.GOOGLE_DRIVE_API_KEY;

    if (!apiKey) {
      // Fallback: Try to scrape public folder (less reliable)
      console.warn('No Google Drive API key found, using fallback method');
      return await listFilesInFolderFallback(folderId);
    }

    const url = `https://www.googleapis.com/drive/v3/files`;
    const params = {
      key: apiKey,
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,size,webContentLink,thumbnailLink,imageMediaMetadata)',
      pageSize: 1000
    };

    const response = await axios.get(url, { params });

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
    throw error;
  }
};

// Fallback method without API key (public folder scraping)
const listFilesInFolderFallback = async (folderId) => {
  try {
    console.log('Using fallback method to list files (less reliable)');

    // This is a simplified fallback - in production, you should use the API
    // For now, return empty array and guide user to set up API key
    throw new Error('Google Drive API key required. Please add GOOGLE_DRIVE_API_KEY to .env file');
  } catch (error) {
    throw error;
  }
};

// Download a file from Google Drive
const downloadFile = async (fileId, destinationPath) => {
  try {
    const url = `https://drive.google.com/uc?export=download&id=${fileId}`;

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      maxContentLength: 100 * 1024 * 1024, // 100MB max
      timeout: 60000 // 60 seconds
    });

    await fs.ensureDir(path.dirname(destinationPath));
    await fs.writeFile(destinationPath, response.data);

    return {
      success: true,
      path: destinationPath,
      size: response.data.length
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

// Delete file from Google Drive (requires API key and permissions)
const deleteFileFromDrive = async (fileId) => {
  try {
    const apiKey = process.env.GOOGLE_DRIVE_API_KEY;

    if (!apiKey) {
      throw new Error('Google Drive API key required for deleting files');
    }

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;

    await axios.delete(url, {
      params: { key: apiKey }
    });

    return { success: true };
  } catch (error) {
    if (error.response?.status === 403) {
      throw new Error('Keine Berechtigung zum Löschen. Drive-Ordner muss zum Bearbeiten freigegeben sein.');
    }
    throw error;
  }
};

module.exports = {
  extractFolderId,
  listFilesInFolder,
  downloadFile,
  compressImage,
  generateThumbnail,
  deleteFileFromDrive
};
