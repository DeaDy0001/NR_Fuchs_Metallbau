import * as FileSystem from 'expo-file-system/legacy';
import { getSetting, setSetting, cacheProjects, cacheTags, cacheProject, clearCachedProjects, getCachedProjects, cacheProjectImages, updateCachedImagePaths, getCachedImageByDriveId, getCachedProjectImages, deleteCachedImage, getOrphanedCachedImages } from './database';
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
 * - Downloads missing thumbnails
 * - Caches image metadata (dates) in local DB
 * - Deletes local files (thumbnail + full) for images removed from Drive
 * - Cleans up images from projects that no longer exist on Drive
 * @param {function} onProgress - optional: called with (projectIndex, totalProjects, projectName)
 * @returns {{ downloaded: number, deleted: number }}
 */
export const syncAllThumbnails = async (onProgress) => {
  await ensureCacheDirs();

  const projects = await getCachedProjects();
  const validProjectFolderIds = projects.map(p => p.folder_id).filter(Boolean);
  let totalDownloaded = 0;
  let totalDeleted = 0;

  // Step 1: per-project sync
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    if (!project.folder_id) continue;

    if (onProgress) onProgress(i, projects.length, project.folder_name);

    try {
      const driveImages = await fetchProjectImages(project.folder_id);
      const driveIds = new Set(driveImages.map(img => img.id));

      // Cache image metadata (dates) to DB for offline cleanup
      if (driveImages.length > 0) {
        await cacheProjectImages(project.folder_id, driveImages);
      }

      // Remove local files for images deleted from Drive
      const cachedImages = await getCachedProjectImages(project.folder_id);
      for (const cached of cachedImages) {
        if (!driveIds.has(cached.id)) {
          // Delete thumbnail file
          if (cached.local_thumbnail_path) {
            await FileSystem.deleteAsync(cached.local_thumbnail_path, { idempotent: true });
          }
          // Delete full image file
          if (cached.local_full_path) {
            await FileSystem.deleteAsync(cached.local_full_path, { idempotent: true });
          } else {
            // Also try the default full image path by convention
            const defaultFull = IMAGE_CACHE_DIR + `full_${cached.id}.jpg`;
            await FileSystem.deleteAsync(defaultFull, { idempotent: true });
          }
          await deleteCachedImage(cached.id);
          totalDeleted++;
        }
      }

      // Download missing thumbnails
      for (const img of driveImages) {
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
      // Skip failed project (network error etc.)
    }
  }

  // Step 2: clean up images from projects deleted on Drive
  // (their project_id is no longer in the current project list)
  try {
    const orphaned = await getOrphanedCachedImages(validProjectFolderIds);
    for (const cached of orphaned) {
      if (cached.local_thumbnail_path) {
        await FileSystem.deleteAsync(cached.local_thumbnail_path, { idempotent: true });
      }
      const defaultThumb = THUMBNAIL_CACHE_DIR + `thumb_${cached.id}.jpg`;
      await FileSystem.deleteAsync(defaultThumb, { idempotent: true });
      if (cached.local_full_path) {
        await FileSystem.deleteAsync(cached.local_full_path, { idempotent: true });
      }
      const defaultFull = IMAGE_CACHE_DIR + `full_${cached.id}.jpg`;
      await FileSystem.deleteAsync(defaultFull, { idempotent: true });
      await deleteCachedImage(cached.id);
      totalDeleted++;
    }
  } catch {
    // ignore cleanup errors
  }

  return { downloaded: totalDownloaded, deleted: totalDeleted };
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
