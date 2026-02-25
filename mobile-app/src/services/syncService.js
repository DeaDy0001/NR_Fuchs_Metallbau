import * as FileSystem from 'expo-file-system';
import { getSetting, setSetting, cacheProjects, cacheTags } from './database';
import { fetchSyncData, downloadImage } from './api';

const IMAGE_CACHE_DIR = FileSystem.documentDirectory + 'image_cache/';
const THUMBNAIL_CACHE_DIR = FileSystem.documentDirectory + 'thumbnail_cache/';

// Ensure cache directories exist
const ensureCacheDirs = async () => {
  const imgDir = await FileSystem.getInfoAsync(IMAGE_CACHE_DIR);
  if (!imgDir.exists) await FileSystem.makeDirectoryAsync(IMAGE_CACHE_DIR, { intermediates: true });
  const thumbDir = await FileSystem.getInfoAsync(THUMBNAIL_CACHE_DIR);
  if (!thumbDir.exists) await FileSystem.makeDirectoryAsync(THUMBNAIL_CACHE_DIR, { intermediates: true });
};

/**
 * Sync project and tag data from server
 */
export const syncMetadata = async () => {
  try {
    const lastSync = await getSetting('lastMetadataSync');
    const data = await fetchSyncData(lastSync);

    if (data.projects) await cacheProjects(data.projects);
    if (data.tags) await cacheTags(data.tags);

    await setSetting('lastMetadataSync', data.serverTime);

    return {
      projectCount: data.projects?.length || 0,
      tagCount: data.tags?.length || 0,
    };
  } catch (error) {
    console.error('Metadata sync failed:', error);
    throw error;
  }
};

/**
 * Download a project's images with compression
 */
export const downloadProjectImages = async (projectId, images, onProgress) => {
  await ensureCacheDirs();

  // Get compression settings
  const maxSize = parseInt(await getSetting('maxImageSizeKB', '1024'));
  const maxRes = parseInt(await getSetting('maxImageResolution', '1920'));
  const quality = parseInt(await getSetting('imageQuality', '80'));

  let downloaded = 0;

  for (const img of images) {
    try {
      const localPath = THUMBNAIL_CACHE_DIR + `thumb_${img.id}.webp`;
      const existing = await FileSystem.getInfoAsync(localPath);

      if (!existing.exists) {
        await downloadImage(img.id, localPath, {
          quality: 60,
          maxWidth: 300,
          maxHeight: 300,
        });
      }

      downloaded++;
      if (onProgress) onProgress(downloaded, images.length);
    } catch (error) {
      console.error(`Failed to download thumbnail for image ${img.id}:`, error);
    }
  }

  return downloaded;
};

/**
 * Download full-resolution image (on demand when viewing)
 */
export const downloadFullImage = async (imageId) => {
  await ensureCacheDirs();

  const maxRes = parseInt(await getSetting('maxImageResolution', '1920'));
  const quality = parseInt(await getSetting('imageQuality', '80'));
  const maxSizeKB = parseInt(await getSetting('maxImageSizeKB', '1024'));

  const localPath = IMAGE_CACHE_DIR + `full_${imageId}.webp`;
  const existing = await FileSystem.getInfoAsync(localPath);

  if (existing.exists) {
    // Check if within size limit
    if (maxSizeKB > 0 && existing.size > maxSizeKB * 1024) {
      // Re-download with lower quality
      await FileSystem.deleteAsync(localPath, { idempotent: true });
    } else {
      return localPath;
    }
  }

  await downloadImage(imageId, localPath, {
    quality,
    maxWidth: maxRes,
    maxHeight: maxRes,
  });

  return localPath;
};

/**
 * Clean up old cached images
 */
export const cleanupCache = async () => {
  const maxAgeDays = parseInt(await getSetting('cacheMaxAgeDays', '30'));
  if (maxAgeDays <= 0) return;

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  for (const dir of [IMAGE_CACHE_DIR, THUMBNAIL_CACHE_DIR]) {
    try {
      const files = await FileSystem.readDirectoryAsync(dir);
      for (const file of files) {
        const filePath = dir + file;
        const info = await FileSystem.getInfoAsync(filePath);
        if (info.exists && info.modificationTime && info.modificationTime * 1000 < cutoff) {
          await FileSystem.deleteAsync(filePath, { idempotent: true });
        }
      }
    } catch (e) {
      // Directory might not exist yet
    }
  }
};

/**
 * Get total cache size in bytes
 */
export const getCacheSize = async () => {
  let total = 0;
  for (const dir of [IMAGE_CACHE_DIR, THUMBNAIL_CACHE_DIR]) {
    try {
      const files = await FileSystem.readDirectoryAsync(dir);
      for (const file of files) {
        const info = await FileSystem.getInfoAsync(dir + file);
        if (info.exists) total += info.size || 0;
      }
    } catch (e) {
      // ignore
    }
  }
  return total;
};

/**
 * Clear entire cache
 */
export const clearCache = async () => {
  for (const dir of [IMAGE_CACHE_DIR, THUMBNAIL_CACHE_DIR]) {
    await FileSystem.deleteAsync(dir, { idempotent: true });
  }
  await ensureCacheDirs();
};
