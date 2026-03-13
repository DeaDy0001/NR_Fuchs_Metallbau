import * as FileSystem from 'expo-file-system/legacy';
import { getSetting, setSetting, cacheProjects, cacheTags, cacheProject, clearCachedProjects, getCachedProjects, cacheProjectImages, updateCachedImagePaths, getCachedImageByDriveId } from './database';
import { fetchSyncData, fetchProjects, fetchProjectImages, downloadImageFile } from './api';

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
 * Sync project and tag data from Google Drive
 * @param {function} onProjectFound - optional callback for progressive loading, called per project
 */
export const syncMetadata = async (onProjectFound = null) => {
  try {
    if (onProjectFound) {
      // Progressive sync: clear old data, then stream projects one by one
      await clearCachedProjects();
      const projects = await fetchProjects(async (project) => {
        await cacheProject(project);
        onProjectFound(project);
      });

      // Also sync tags
      const data = await fetchSyncData(true); // tagsOnly
      if (data.tags) await cacheTags(data.tags);

      await setSetting('lastMetadataSync', new Date().toISOString());

      return {
        projectCount: projects.length,
        tagCount: data.tags?.length || 0,
      };
    } else {
      // Batch sync (old behavior)
      const data = await fetchSyncData();

      if (data.projects) await cacheProjects(data.projects);
      if (data.tags) await cacheTags(data.tags);

      await setSetting('lastMetadataSync', data.serverTime);

      return {
        projectCount: data.projects?.length || 0,
        tagCount: data.tags?.length || 0,
      };
    }
  } catch (error) {
    console.error('Metadata sync failed:', error);
    throw error;
  }
};

/**
 * Download a project's thumbnail images from Drive
 */
export const downloadProjectImages = async (projectId, images, onProgress) => {
  await ensureCacheDirs();

  let downloaded = 0;

  for (const img of images) {
    try {
      const localPath = THUMBNAIL_CACHE_DIR + `thumb_${img.id}.jpg`;
      const existing = await FileSystem.getInfoAsync(localPath);

      if (!existing.exists) {
        await downloadImageFile(img.id, localPath);
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
 * Download full-resolution image from Drive (on demand)
 */
export const downloadFullImage = async (driveFileId) => {
  await ensureCacheDirs();

  const localPath = IMAGE_CACHE_DIR + `full_${driveFileId}.jpg`;
  const existing = await FileSystem.getInfoAsync(localPath);

  if (existing.exists) {
    return localPath;
  }

  await downloadImageFile(driveFileId, localPath);
  return localPath;
};

/**
 * Get local thumbnail path if cached
 */
export const getLocalThumbnailPath = async (driveFileId) => {
  const localPath = THUMBNAIL_CACHE_DIR + `thumb_${driveFileId}.jpg`;
  const info = await FileSystem.getInfoAsync(localPath);
  return info.exists ? localPath : null;
};

/**
 * Sync ALL thumbnails for all cached projects.
 * Also caches the image list (with dates) to the local DB for offline cleanup.
 * @param {function} onProgress - optional: called with (projectIndex, totalProjects, projectName)
 */
export const syncAllThumbnails = async (onProgress) => {
  await ensureCacheDirs();

  const projects = await getCachedProjects();
  let totalDownloaded = 0;

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    if (!project.folder_id) continue;

    if (onProgress) onProgress(i, projects.length, project.folder_name);

    try {
      const images = await fetchProjectImages(project.folder_id);

      // Cache image metadata (dates) to DB for offline cleanup
      if (images.length > 0) {
        await cacheProjectImages(project.folder_id, images);
      }

      // Download missing thumbnails
      for (const img of images) {
        try {
          const localPath = THUMBNAIL_CACHE_DIR + `thumb_${img.id}.jpg`;
          const existing = await FileSystem.getInfoAsync(localPath);
          if (!existing.exists) {
            await downloadImageFile(img.id, localPath);
            totalDownloaded++;
          }
          await updateCachedImagePaths(img.id, localPath, null);
        } catch {
          // Skip failed individual thumbnail
        }
      }
    } catch {
      // Skip failed project
    }
  }

  return totalDownloaded;
};

/**
 * Clean up full-resolution cached images based on age settings.
 * Only deletes files in image_cache/ (never thumbnails).
 * Uses image date from DB (upload date or EXIF creation date).
 * If no date is available for an image, it is kept.
 */
export const cleanupFullImages = async () => {
  const autoDeleteOld = (await getSetting('autoDeleteOld', 'false')) === 'true';
  if (!autoDeleteOld) return;

  const unit = await getSetting('autoDeleteUnit', 'monate');
  const value = parseInt(await getSetting('autoDeleteValue', '10'));
  const dateType = await getSetting('autoDeleteDateType', 'upload');

  if (!value || value <= 0) return;

  // Convert to milliseconds
  let thresholdMs;
  if (unit === 'tage') thresholdMs = value * 24 * 60 * 60 * 1000;
  else if (unit === 'monate') thresholdMs = value * 30 * 24 * 60 * 60 * 1000;
  else thresholdMs = value * 365 * 24 * 60 * 60 * 1000;

  const cutoff = Date.now() - thresholdMs;

  try {
    const imgDir = await FileSystem.getInfoAsync(IMAGE_CACHE_DIR);
    if (!imgDir.exists) return;

    const files = await FileSystem.readDirectoryAsync(IMAGE_CACHE_DIR);

    for (const file of files) {
      // Only process full image files: full_{driveFileId}.jpg
      if (!file.startsWith('full_')) continue;

      const driveFileId = file.replace(/^full_/, '').replace(/\.jpg$/, '');
      const filePath = IMAGE_CACHE_DIR + file;

      // Look up image date from DB
      const cached = await getCachedImageByDriveId(driveFileId);

      let dateStr = null;
      if (cached) {
        dateStr = dateType === 'erstellung'
          ? (cached.created_time || null)
          : (cached.modified_time || null);
      }

      // No date available → keep the file
      if (!dateStr) continue;

      const imageDate = new Date(dateStr).getTime();
      if (isNaN(imageDate)) continue;

      if (imageDate < cutoff) {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
      }
    }
  } catch {
    // Directory might not exist yet
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
