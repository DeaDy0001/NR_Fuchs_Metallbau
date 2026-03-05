const db = require('../config/database');
const path = require('path');
const fs = require('fs-extra');
const { readExifData } = require('./exifService');
const {
  extractFolderId,
  listFilesInFolder,
  listFilesInFolderRecursive,
  downloadFile,
  compressImage,
  generateThumbnail,
  deleteFileFromDrive
} = require('./googleDriveService');

/**
 * Drive Sync Service
 * Manages automatic syncing of images from Google Drive folders
 */

// Track active sync operations
const activeSyncs = new Map();
const syncIntervals = new Map();

// Sync a single drive path
const syncDrivePath = async (drivePathId) => {
  // Prevent duplicate syncs
  if (activeSyncs.has(drivePathId)) {
    console.log(`Sync already in progress for drive path ${drivePathId}`);
    return { message: 'Sync already in progress', added: 0 };
  }

  activeSyncs.set(drivePathId, true);

  try {
    // Get drive path settings
    const drivePath = db.prepare('SELECT * FROM drive_paths WHERE id = ?').get(drivePathId);

    if (!drivePath) {
      throw new Error('Drive path not found');
    }

    console.log(`Starting sync for: ${drivePath.name}`);

    // Extract folder ID from path
    const folderId = extractFolderId(drivePath.path);
    if (!folderId) {
      throw new Error('Invalid Google Drive folder URL');
    }

    // List all files in Drive folder (including subfolders, NR_Fuchs_Meta is auto-excluded)
    const driveFiles = await listFilesInFolderRecursive(folderId);
    console.log(`Found ${driveFiles.length} images in Drive folder (including subfolders)`);

    // Clean up any previously synced NR_Fuchs_Meta images (internal inbox system)
    const metaImages = db.prepare(
      "SELECT id, local_path, thumbnail_url FROM drive_images WHERE drive_path_id = ? AND subfolder = 'NR_Fuchs_Meta'"
    ).all(drivePathId);
    if (metaImages.length > 0) {
      console.log(`Cleaning up ${metaImages.length} NR_Fuchs_Meta images from previous syncs...`);
      for (const img of metaImages) {
        // Delete local files
        try {
          if (img.local_path) await fs.remove(path.join(__dirname, '../../..', img.local_path));
          if (img.thumbnail_url) await fs.remove(path.join(__dirname, '../../..', img.thumbnail_url));
        } catch (e) { /* ignore file deletion errors */ }
      }
      db.prepare("DELETE FROM drive_images WHERE drive_path_id = ? AND subfolder = 'NR_Fuchs_Meta'").run(drivePathId);
      console.log(`✓ Removed ${metaImages.length} NR_Fuchs_Meta images`);
    }

    // Get existing images in database
    const existingImages = db.prepare(
      'SELECT drive_file_id, name FROM drive_images WHERE drive_path_id = ?'
    ).all(drivePathId);

    const existingFileIds = new Set(existingImages.map(img => img.drive_file_id));

    // Get ignored files (soft-deleted)
    const ignoredFiles = db.prepare('SELECT drive_file_id FROM ignored_files').all();
    const ignoredFileIds = new Set(ignoredFiles.map(f => f.drive_file_id));

    let addedCount = 0;
    let errors = [];

    // Process each file
    for (const file of driveFiles) {
      try {
        // Skip if already synced
        if (existingFileIds.has(file.id)) {
          continue;
        }

        // Skip if in ignore list (soft-deleted by user)
        if (ignoredFileIds.has(file.id)) {
          console.log(`Skipping ignored file: ${file.name}`);
          continue;
        }

        // Create upload directory for this drive path
        const uploadBaseDir = path.join(__dirname, '../../../uploads/drive');
        const drivePathDir = path.join(uploadBaseDir, sanitizeFilename(drivePath.name));
        await fs.ensureDir(drivePathDir);

        // Download file
        const fileExt = path.extname(file.name);
        const fileBaseName = path.basename(file.name, fileExt);
        const tempFilePath = path.join(drivePathDir, `temp_${Date.now()}_${sanitizeFilename(file.name)}`);

        console.log(`Downloading: ${file.name}`);
        await downloadFile(file.id, tempFilePath);

        // Extract EXIF data BEFORE compression (original file still exists!)
        let photoTakenAt = null;
        let gpsLatitude = null;
        let gpsLongitude = null;
        let gpsAltitude = null;
        let imageNotes = null;
        let customTitle = null;
        try {
          const exifData = await readExifData(tempFilePath);
          if (exifData.photoTakenAt) {
            photoTakenAt = exifData.photoTakenAt;
            console.log(`📸 Photo taken at: ${photoTakenAt}`);
          }
          if (exifData.latitude != null && exifData.longitude != null) {
            gpsLatitude = exifData.latitude;
            gpsLongitude = exifData.longitude;
            gpsAltitude = exifData.altitude;
            console.log(`📍 GPS: ${gpsLatitude}, ${gpsLongitude}`);
          }
          if (exifData.userComment) {
            imageNotes = exifData.userComment;
          }
        } catch (err) {
          console.warn(`Could not extract EXIF data from ${file.name}:`, err.message);
        }

        // Parse metadata from Drive file description (set by mobile app)
        if (file.description && file.description.startsWith('[FUCHS_META]')) {
          try {
            const metaJson = file.description.substring('[FUCHS_META]'.length);
            const meta = JSON.parse(metaJson);
            if (meta.gps && !gpsLatitude) {
              gpsLatitude = meta.gps.latitude;
              gpsLongitude = meta.gps.longitude;
              gpsAltitude = meta.gps.altitude || null;
              console.log(`📍 GPS from Drive description: ${gpsLatitude}, ${gpsLongitude}`);
            }
            if (meta.notes && !imageNotes) {
              imageNotes = meta.notes;
            }
            if (meta.title) {
              customTitle = meta.title;
            }
          } catch (e) {
            // Invalid JSON in description - ignore
          }
        }

        let finalPath = tempFilePath;
        let finalSize = file.size;
        let isCompressed = false;

        // Compress if enabled
        if (drivePath.compression_enabled) {
          const compressedExt = `.${drivePath.compression_format || 'webp'}`;
          const compressedPath = path.join(
            drivePathDir,
            `${sanitizeFilename(fileBaseName)}${compressedExt}`
          );

          console.log(`Compressing: ${file.name}`);
          const compressionResult = await compressImage(tempFilePath, compressedPath, {
            format: drivePath.compression_format,
            quality: drivePath.compression_quality,
            maxWidth: drivePath.max_width,
            maxHeight: drivePath.max_height
          });

          // Delete original temp file
          await fs.remove(tempFilePath);

          finalPath = compressedPath;
          finalSize = compressionResult.size;
          isCompressed = true;

          console.log(`Compressed ${file.size} -> ${finalSize} bytes (${Math.round((1 - finalSize / file.size) * 100)}% saved)`);
        } else {
          // Rename temp file to final name
          const finalFileName = sanitizeFilename(file.name);
          finalPath = path.join(drivePathDir, finalFileName);
          await fs.move(tempFilePath, finalPath, { overwrite: true });
        }

        // Generate thumbnail
        const thumbnailDir = path.join(__dirname, '../../../uploads/thumbnails');
        await fs.ensureDir(thumbnailDir);
        const thumbnailFilename = `${Date.now()}_${sanitizeFilename(fileBaseName)}.jpg`;
        const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);

        await generateThumbnail(finalPath, thumbnailPath);

        // Save to database
        // (photoTakenAt was already extracted from original file before compression)
        const localPath = `/uploads/drive/${sanitizeFilename(drivePath.name)}/${path.basename(finalPath)}`;
        const thumbnailUrl = `/uploads/thumbnails/${thumbnailFilename}`;

        db.prepare(`
          INSERT INTO drive_images
          (drive_path_id, name, original_name, file_url, local_path, thumbnail_url,
           file_size, mime_type, width, height, is_compressed, drive_file_id, photo_taken_at, subfolder,
           gps_latitude, gps_longitude, gps_altitude, image_notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          drivePathId,
          customTitle || fileBaseName,
          file.name,
          file.downloadUrl,
          localPath,
          thumbnailUrl,
          finalSize,
          file.mimeType,
          file.width,
          file.height,
          isCompressed ? 1 : 0,
          file.id,
          photoTakenAt,
          file.subfolder || null,
          gpsLatitude,
          gpsLongitude,
          gpsAltitude,
          imageNotes
        );

        // Check for pending metadata from mobile app
        try {
          const pending = db.prepare(
            'SELECT * FROM pending_image_metadata WHERE drive_file_id = ? OR file_name = ? LIMIT 1'
          ).get(file.id, file.name);
          if (pending) {
            const updates = [];
            const params = [];
            if (pending.gps_latitude != null && pending.gps_longitude != null && !gpsLatitude) {
              updates.push('gps_latitude = ?', 'gps_longitude = ?');
              params.push(pending.gps_latitude, pending.gps_longitude);
              if (pending.gps_altitude != null) {
                updates.push('gps_altitude = ?');
                params.push(pending.gps_altitude);
              }
            }
            if (pending.notes && !imageNotes) {
              updates.push('image_notes = ?');
              params.push(pending.notes);
            }
            if (pending.custom_title) {
              updates.push('name = ?');
              params.push(pending.custom_title);
            }
            if (updates.length > 0) {
              const imgId = db.prepare('SELECT id FROM drive_images WHERE drive_file_id = ?').get(file.id);
              if (imgId) {
                params.push(imgId.id);
                db.prepare(`UPDATE drive_images SET ${updates.join(', ')} WHERE id = ?`).run(...params);
              }
            }
            // Clean up pending metadata
            db.prepare('DELETE FROM pending_image_metadata WHERE id = ?').run(pending.id);
          }
        } catch (e) {
          // Non-critical - pending metadata table might not exist yet
        }

        addedCount++;

        // Delete from Drive if enabled
        if (drivePath.delete_after_sync) {
          console.log(`Deleting from Drive: ${file.name}`);
          try {
            await deleteFileFromDrive(file.id);
          } catch (error) {
            console.error(`Failed to delete ${file.name} from Drive:`, error.message);
            errors.push(`Could not delete ${file.name}: ${error.message}`);
          }
        }

      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error.message);
        errors.push(`${file.name}: ${error.message}`);
      }
    }

    // Update last sync time
    db.prepare(
      "UPDATE drive_paths SET last_sync = datetime('now') WHERE id = ?"
    ).run(drivePathId);

    console.log(`Sync completed for ${drivePath.name}: ${addedCount} images added`);

    return {
      success: true,
      added: addedCount,
      total: driveFiles.length,
      errors: errors.length > 0 ? errors : null
    };

  } catch (error) {
    console.error(`Sync failed for drive path ${drivePathId}:`, error.message);
    throw error;
  } finally {
    activeSyncs.delete(drivePathId);
  }
};

// Sync all drive paths
const syncAllDrivePaths = async () => {
  try {
    const drivePaths = db.prepare('SELECT id FROM drive_paths WHERE auto_sync_enabled = 1').all();

    console.log(`Syncing ${drivePaths.length} drive paths...`);

    const results = [];

    for (const drivePath of drivePaths) {
      try {
        const result = await syncDrivePath(drivePath.id);
        results.push({ id: drivePath.id, ...result });
      } catch (error) {
        results.push({ id: drivePath.id, error: error.message });
      }
    }

    return results;
  } catch (error) {
    console.error('Error syncing all drive paths:', error);
    throw error;
  }
};

// Start auto-sync for a drive path
const startAutoSync = (drivePathId, intervalMinutes = 5) => {
  // Clear existing interval if any
  stopAutoSync(drivePathId);

  console.log(`Starting auto-sync for drive path ${drivePathId} (every ${intervalMinutes} minutes)`);

  // Initial sync
  syncDrivePath(drivePathId).catch(err =>
    console.error(`Initial sync failed for drive path ${drivePathId}:`, err)
  );

  // Schedule recurring syncs
  const intervalMs = intervalMinutes * 60 * 1000;
  const interval = setInterval(() => {
    syncDrivePath(drivePathId).catch(err =>
      console.error(`Auto-sync failed for drive path ${drivePathId}:`, err)
    );
  }, intervalMs);

  syncIntervals.set(drivePathId, interval);
};

// Stop auto-sync for a drive path
const stopAutoSync = (drivePathId) => {
  if (syncIntervals.has(drivePathId)) {
    clearInterval(syncIntervals.get(drivePathId));
    syncIntervals.delete(drivePathId);
    console.log(`Stopped auto-sync for drive path ${drivePathId}`);
  }
};

// Initialize auto-sync for all enabled drive paths
const initializeAutoSync = () => {
  try {
    const drivePaths = db.prepare(
      'SELECT id, sync_interval FROM drive_paths WHERE auto_sync_enabled = 1'
    ).all();

    console.log(`Initializing auto-sync for ${drivePaths.length} drive paths`);

    for (const drivePath of drivePaths) {
      startAutoSync(drivePath.id, drivePath.sync_interval || 5);
    }
  } catch (error) {
    console.error('Error initializing auto-sync:', error);
  }
};

// Helper: Sanitize filename
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
};

module.exports = {
  syncDrivePath,
  syncAllDrivePaths,
  startAutoSync,
  stopAutoSync,
  initializeAutoSync
};
