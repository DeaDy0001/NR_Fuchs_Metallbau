const db = require('../config/database');
const path = require('path');
const fs = require('fs-extra');
const { syncDrivePath, startAutoSync, stopAutoSync } = require('../services/driveSyncService');
const { deleteFile, compressImage, generateThumbnail, moveFileOnDrive, getFileMetadata, findOrCreateSubfolder, findSubfolder, extractFolderId, createFolderOnDrive, listFoldersInFolder } = require('../services/googleDriveService');
const { isAuthenticated } = require('../services/authService');

// Get drive settings (all configured paths)
const getDriveSettings = (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM drive_paths ORDER BY created_at DESC');
    const result = stmt.all();

    // Convert SQLite integers to booleans for boolean fields
    const formatted = result.map(path => ({
      ...path,
      compression_enabled: !!path.compression_enabled,
      delete_after_sync: !!path.delete_after_sync,
      auto_sync_enabled: !!path.auto_sync_enabled
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Error getting drive settings:', error);
    res.status(500).json({ error: 'Failed to get drive settings' });
  }
};

// Add a new drive path
const addDrivePath = (req, res) => {
  try {
    const {
      name,
      path: drivePath,
      type,
      compression_enabled,
      compression_quality,
      compression_format,
      max_width,
      max_height,
      delete_after_sync,
      auto_sync_enabled,
      sync_interval
    } = req.body;

    if (!name || !drivePath) {
      return res.status(400).json({ error: 'Name and path are required' });
    }

    const stmt = db.prepare(`
      INSERT INTO drive_paths
      (name, path, type, compression_enabled, compression_quality, compression_format,
       max_width, max_height, delete_after_sync, auto_sync_enabled, sync_interval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name,
      drivePath,
      type || 'google_drive',
      compression_enabled ? 1 : 0,
      compression_quality || 85,
      compression_format || 'webp',
      max_width || null,
      max_height || null,
      delete_after_sync ? 1 : 0,
      auto_sync_enabled !== false ? 1 : 0, // Default true
      sync_interval || 5
    );

    const newPath = db.prepare('SELECT * FROM drive_paths WHERE id = ?').get(result.lastInsertRowid);

    // Convert booleans
    newPath.compression_enabled = !!newPath.compression_enabled;
    newPath.delete_after_sync = !!newPath.delete_after_sync;
    newPath.auto_sync_enabled = !!newPath.auto_sync_enabled;

    // Start auto-sync if enabled
    if (newPath.auto_sync_enabled) {
      startAutoSync(newPath.id, newPath.sync_interval);
    }

    res.json(newPath);
  } catch (error) {
    console.error('Error adding drive path:', error);
    res.status(500).json({ error: 'Failed to add drive path' });
  }
};

// Remove a drive path
const removeDrivePath = async (req, res) => {
  try {
    const { id } = req.params;

    // Stop auto-sync
    stopAutoSync(parseInt(id));

    // Get images to delete local files
    const images = db.prepare('SELECT local_path, thumbnail_url FROM drive_images WHERE drive_path_id = ?').all(id);

    // Delete local files
    for (const image of images) {
      try {
        if (image.local_path) {
          const localPath = path.join(__dirname, '../../../', image.local_path);
          await fs.remove(localPath);
        }
        if (image.thumbnail_url) {
          const thumbPath = path.join(__dirname, '../../../', image.thumbnail_url);
          await fs.remove(thumbPath);
        }
      } catch (err) {
        console.error('Error deleting file:', err);
      }
    }

    // Delete from database (cascade will delete images)
    const stmt = db.prepare('DELETE FROM drive_paths WHERE id = ?');
    stmt.run(id);

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing drive path:', error);
    res.status(500).json({ error: 'Failed to remove drive path' });
  }
};

// Update a drive path
const updateDrivePath = (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      path: drivePath,
      compression_enabled,
      compression_quality,
      compression_format,
      max_width,
      max_height,
      delete_after_sync,
      auto_sync_enabled,
      sync_interval
    } = req.body;

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }

    if (drivePath !== undefined) {
      updates.push('path = ?');
      values.push(drivePath);
    }

    if (compression_enabled !== undefined) {
      updates.push('compression_enabled = ?');
      values.push(compression_enabled ? 1 : 0);
    }

    if (compression_quality !== undefined) {
      updates.push('compression_quality = ?');
      values.push(compression_quality);
    }

    if (compression_format !== undefined) {
      updates.push('compression_format = ?');
      values.push(compression_format);
    }

    if (max_width !== undefined) {
      updates.push('max_width = ?');
      values.push(max_width || null);
    }

    if (max_height !== undefined) {
      updates.push('max_height = ?');
      values.push(max_height || null);
    }

    if (delete_after_sync !== undefined) {
      updates.push('delete_after_sync = ?');
      values.push(delete_after_sync ? 1 : 0);
    }

    if (auto_sync_enabled !== undefined) {
      updates.push('auto_sync_enabled = ?');
      values.push(auto_sync_enabled ? 1 : 0);
    }

    if (sync_interval !== undefined) {
      updates.push('sync_interval = ?');
      values.push(sync_interval);
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);

      const sql = `UPDATE drive_paths SET ${updates.join(', ')} WHERE id = ?`;
      const stmt = db.prepare(sql);
      stmt.run(...values);
    }

    const result = db.prepare('SELECT * FROM drive_paths WHERE id = ?').get(id);

    if (!result) {
      return res.status(404).json({ error: 'Drive path not found' });
    }

    // Convert booleans
    result.compression_enabled = !!result.compression_enabled;
    result.delete_after_sync = !!result.delete_after_sync;
    result.auto_sync_enabled = !!result.auto_sync_enabled;

    // Update auto-sync if needed
    if (auto_sync_enabled !== undefined) {
      if (result.auto_sync_enabled) {
        startAutoSync(result.id, result.sync_interval);
      } else {
        stopAutoSync(result.id);
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Error updating drive path:', error);
    res.status(500).json({ error: 'Failed to update drive path' });
  }
};

// Get all images from configured drive paths
const getImages = (req, res) => {
  try {
    const {
      limit = 100,
      offset = 0,
      search = '',
      projectIds = '',
      tagIds = '',
      photoDateFrom = '',
      photoDateTo = '',
      uploadDateFrom = '',
      uploadDateTo = '',
      subfolders = '',
      drivePathIds = '',
      sortBy = 'created_at',
      sortOrder = 'desc',
      onlyUnassigned = '',
      showAllImages = '',
      onlyWithProjects = ''
    } = req.query;

    let query = 'SELECT DISTINCT di.* FROM drive_images di';
    const params = [];
    const whereClauses = [];

    // Filter by projects
    if (projectIds) {
      const projectIdArray = projectIds.split(',').map(id => parseInt(id.trim()));
      query += ' JOIN image_project_assignments ipa ON di.id = ipa.image_id';
      whereClauses.push(`ipa.project_id IN (${projectIdArray.map(() => '?').join(', ')})`);
      params.push(...projectIdArray);
    }

    // Filter by tags
    if (tagIds) {
      const tagIdArray = tagIds.split(',').map(id => parseInt(id.trim()));
      query += ' JOIN image_tags it ON di.id = it.image_id';
      whereClauses.push(`it.tag_id IN (${tagIdArray.map(() => '?').join(', ')})`);
      params.push(...tagIdArray);
    }

    // Filter by project assignment status (mutually exclusive)
    if (showAllImages === 'true') {
      // Show all images (no filter)
    } else if (onlyWithProjects === 'true') {
      // Only show images with at least one project assignment
      query += ' JOIN image_project_assignments ipa3 ON di.id = ipa3.image_id';
    } else if (onlyUnassigned === 'true') {
      // Only show images without any project assignment
      query += ' LEFT JOIN image_project_assignments ipa2 ON di.id = ipa2.image_id';
      whereClauses.push('ipa2.id IS NULL');
    }

    // Search filter
    if (search) {
      whereClauses.push('(di.name LIKE ? OR di.original_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    // Photo date filters
    if (photoDateFrom) {
      whereClauses.push('di.photo_taken_at >= ?');
      params.push(photoDateFrom);
    }
    if (photoDateTo) {
      // Add 1 day to include the entire end date
      const endDate = new Date(photoDateTo);
      endDate.setDate(endDate.getDate() + 1);
      whereClauses.push('di.photo_taken_at < ?');
      params.push(endDate.toISOString().split('T')[0]);
    }

    // Upload date filters (created_at)
    if (uploadDateFrom) {
      whereClauses.push('di.created_at >= ?');
      params.push(uploadDateFrom);
    }
    if (uploadDateTo) {
      const endDate = new Date(uploadDateTo);
      endDate.setDate(endDate.getDate() + 1);
      whereClauses.push('di.created_at < ?');
      params.push(endDate.toISOString().split('T')[0]);
    }

    // Subfolder filter
    if (subfolders) {
      const subfolderArray = subfolders.split(',').map(s => s.trim());
      whereClauses.push(`di.subfolder IN (${subfolderArray.map(() => '?').join(', ')})`);
      params.push(...subfolderArray);
    }

    // Drive path filter
    if (drivePathIds) {
      const drivePathIdArray = drivePathIds.split(',').map(id => parseInt(id.trim()));
      whereClauses.push(`di.drive_path_id IN (${drivePathIdArray.map(() => '?').join(', ')})`);
      params.push(...drivePathIdArray);
    }

    // Add WHERE clauses
    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }

    // Sorting
    const validSortFields = ['name', 'photo_taken_at', 'created_at'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY di.${sortField} ${order} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const stmt = db.prepare(query);
    const images = stmt.all(...params);

    // Get assigned projects for each image
    const projectsStmt = db.prepare(`
      SELECT p.id, p.folder_name, p.color
      FROM image_project_assignments ipa
      JOIN projects p ON ipa.project_id = p.id
      WHERE ipa.image_id = ?
    `);

    // Get assigned tags for each image
    const tagsStmt = db.prepare(`
      SELECT t.id, t.name, t.color
      FROM image_tags it
      JOIN tags t ON it.tag_id = t.id
      WHERE it.image_id = ?
    `);

    // Convert booleans and add projects + tags
    const formatted = images.map(img => ({
      ...img,
      is_compressed: !!img.is_compressed,
      projects: projectsStmt.all(img.id),
      tags: tagsStmt.all(img.id)
    }));

    // Get total count
    let countQuery = 'SELECT COUNT(DISTINCT di.id) as count FROM drive_images di';
    const countParams = [];
    const countWhereClauses = [];

    // Same filters for count
    if (projectIds) {
      const projectIdArray = projectIds.split(',').map(id => parseInt(id.trim()));
      countQuery += ' JOIN image_project_assignments ipa ON di.id = ipa.image_id';
      countWhereClauses.push(`ipa.project_id IN (${projectIdArray.map(() => '?').join(', ')})`);
      countParams.push(...projectIdArray);
    }

    if (tagIds) {
      const tagIdArray = tagIds.split(',').map(id => parseInt(id.trim()));
      countQuery += ' JOIN image_tags it ON di.id = it.image_id';
      countWhereClauses.push(`it.tag_id IN (${tagIdArray.map(() => '?').join(', ')})`);
      countParams.push(...tagIdArray);
    }

    if (showAllImages === 'true') {
      // Show all images
    } else if (onlyWithProjects === 'true') {
      countQuery += ' JOIN image_project_assignments ipa3 ON di.id = ipa3.image_id';
    } else if (onlyUnassigned === 'true') {
      countQuery += ' LEFT JOIN image_project_assignments ipa2 ON di.id = ipa2.image_id';
      countWhereClauses.push('ipa2.id IS NULL');
    }

    if (search) {
      countWhereClauses.push('(di.name LIKE ? OR di.original_name LIKE ?)');
      countParams.push(`%${search}%`, `%${search}%`);
    }

    if (photoDateFrom) {
      countWhereClauses.push('di.photo_taken_at >= ?');
      countParams.push(photoDateFrom);
    }
    if (photoDateTo) {
      const endDate = new Date(photoDateTo);
      endDate.setDate(endDate.getDate() + 1);
      countWhereClauses.push('di.photo_taken_at < ?');
      countParams.push(endDate.toISOString().split('T')[0]);
    }

    if (uploadDateFrom) {
      countWhereClauses.push('di.created_at >= ?');
      countParams.push(uploadDateFrom);
    }
    if (uploadDateTo) {
      const endDate = new Date(uploadDateTo);
      endDate.setDate(endDate.getDate() + 1);
      countWhereClauses.push('di.created_at < ?');
      countParams.push(endDate.toISOString().split('T')[0]);
    }

    if (subfolders) {
      const subfolderArray = subfolders.split(',').map(s => s.trim());
      countWhereClauses.push(`di.subfolder IN (${subfolderArray.map(() => '?').join(', ')})`);
      countParams.push(...subfolderArray);
    }

    if (drivePathIds) {
      const drivePathIdArray = drivePathIds.split(',').map(id => parseInt(id.trim()));
      countWhereClauses.push(`di.drive_path_id IN (${drivePathIdArray.map(() => '?').join(', ')})`);
      countParams.push(...drivePathIdArray);
    }

    if (countWhereClauses.length > 0) {
      countQuery += ' WHERE ' + countWhereClauses.join(' AND ');
    }

    const countStmt = db.prepare(countQuery);
    const countResult = countStmt.get(...countParams);

    // Get all unique subfolders (not limited by pagination)
    const subfoldersStmt = db.prepare('SELECT DISTINCT subfolder FROM drive_images WHERE subfolder IS NOT NULL ORDER BY subfolder ASC');
    const allSubfolders = subfoldersStmt.all().map(row => row.subfolder);

    res.json({
      images: formatted,
      total: countResult.count,
      limit: parseInt(limit),
      offset: parseInt(offset),
      subfolders: allSubfolders
    });
  } catch (error) {
    console.error('Error getting images:', error);
    res.status(500).json({ error: 'Failed to get images' });
  }
};

// Get single image by ID
const getImageById = (req, res) => {
  try {
    const { id } = req.params;

    const stmt = db.prepare('SELECT * FROM drive_images WHERE id = ?');
    const result = stmt.get(id);

    if (!result) {
      return res.status(404).json({ error: 'Image not found' });
    }

    result.is_compressed = !!result.is_compressed;

    res.json(result);
  } catch (error) {
    console.error('Error getting image:', error);
    res.status(500).json({ error: 'Failed to get image' });
  }
};

// Rename an image
const renameImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Get current image info
    const image = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(id);

    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Rename local file if it exists
    if (image.local_path) {
      const oldPath = path.join(__dirname, '../../../', image.local_path);
      const dir = path.dirname(oldPath);
      const ext = path.extname(oldPath);
      const sanitizedName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const newFilename = `${sanitizedName}${ext}`;
      const newPath = path.join(dir, newFilename);

      try {
        if (await fs.pathExists(oldPath)) {
          await fs.move(oldPath, newPath, { overwrite: false });

          // Update local_path in database
          const newLocalPath = image.local_path.replace(path.basename(oldPath), newFilename);

          db.prepare(`
            UPDATE drive_images
            SET name = ?, local_path = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(name, newLocalPath, id);
        } else {
          // File doesn't exist, just update name
          db.prepare("UPDATE drive_images SET name = ?, updated_at = datetime('now') WHERE id = ?")
            .run(name, id);
        }
      } catch (err) {
        console.error('Error renaming file:', err);
        // If file rename fails, still update database name
        db.prepare("UPDATE drive_images SET name = ?, updated_at = datetime('now') WHERE id = ?")
          .run(name, id);
      }
    } else {
      // No local file, just update name
      db.prepare("UPDATE drive_images SET name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(name, id);
    }

    const result = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(id);
    result.is_compressed = !!result.is_compressed;

    res.json(result);
  } catch (error) {
    console.error('Error renaming image:', error);
    res.status(500).json({ error: 'Failed to rename image' });
  }
};

// Manually trigger sync for a specific drive path
const syncDrive = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await syncDrivePath(parseInt(id));

    res.json(result);
  } catch (error) {
    console.error('Error syncing drive:', error);
    res.status(500).json({ error: error.message || 'Failed to sync drive' });
  }
};

// Delete an image
const deleteImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteFromDrive = false, deleteFromProjects = false } = req.query; // Query parameters

    // Get current image info
    const image = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(id);

    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Delete from all projects if requested
    if (deleteFromProjects === 'true') {
      try {
        // Get project settings
        const projectSettings = db.prepare('SELECT * FROM project_settings LIMIT 1').get();

        if (projectSettings?.project_path) {
          // Get all projects where this image is assigned
          const assignments = db.prepare(`
            SELECT p.* FROM projects p
            JOIN image_project_assignments ipa ON p.id = ipa.project_id
            WHERE ipa.image_id = ?
          `).all(id);

          // Delete from each project folder
          for (const project of assignments) {
            const projectFolderPath = path.join(projectSettings.project_path, project.folder_name, 'Bilder');
            const fileName = path.basename(image.local_path);
            const imagePathInProject = path.join(projectFolderPath, fileName);

            if (await fs.pathExists(imagePathInProject)) {
              await fs.remove(imagePathInProject);
              console.log(`🗑️ Deleted image from project folder: ${imagePathInProject}`);
            }
          }
        }

        // Delete all assignment records
        db.prepare('DELETE FROM image_project_assignments WHERE image_id = ?').run(id);
        console.log(`✓ Removed image from all project assignments`);
      } catch (err) {
        console.error('Error deleting from projects:', err);
        // Continue with deletion even if project cleanup fails
      }
    }

    // Delete from Google Drive if requested (only if image is from Drive)
    if (deleteFromDrive === 'true' && image.drive_file_id) {
      try {
        await deleteFile(image.drive_file_id);
        console.log(`✓ Deleted file from Google Drive: ${image.name}`);
      } catch (err) {
        console.error('Error deleting from Google Drive:', err);
        return res.status(500).json({ error: 'Failed to delete from Google Drive' });
      }
    } else if (deleteFromDrive !== 'true' && image.drive_file_id) {
      // Soft delete: Add to ignored_files so it won't be re-downloaded
      try {
        db.prepare(`
          INSERT OR IGNORE INTO ignored_files (drive_file_id, original_name, reason)
          VALUES (?, ?, ?)
        `).run(image.drive_file_id, image.original_name, 'user_deleted');
        console.log(`✓ Added file to ignore list: ${image.name}`);
      } catch (err) {
        console.error('Error adding to ignore list:', err);
      }
    }

    // Delete local files
    if (image.local_path) {
      try {
        const localPath = path.join(__dirname, '../../../', image.local_path);
        if (await fs.pathExists(localPath)) {
          await fs.remove(localPath);
          console.log(`✓ Deleted local file: ${image.local_path}`);
        }
      } catch (err) {
        console.error('Error deleting local file:', err);
      }
    }

    // Delete thumbnail
    if (image.thumbnail_url) {
      try {
        const thumbPath = path.join(__dirname, '../../../', image.thumbnail_url);
        if (await fs.pathExists(thumbPath)) {
          await fs.remove(thumbPath);
          console.log(`✓ Deleted thumbnail: ${image.thumbnail_url}`);
        }
      } catch (err) {
        console.error('Error deleting thumbnail:', err);
      }
    }

    // Delete from database
    db.prepare('DELETE FROM drive_images WHERE id = ?').run(id);

    // Build response message
    let message = 'Image deleted from software';
    if (deleteFromProjects === 'true') {
      message += ' and all projects';
    }
    if (deleteFromDrive === 'true' && image.drive_file_id) {
      message += ' and Google Drive';
    } else if (image.drive_file_id) {
      message += ' (will not be re-downloaded from Drive)';
    }

    res.json({
      success: true,
      deletedFromDrive: deleteFromDrive === 'true' && !!image.drive_file_id,
      deletedFromProjects: deleteFromProjects === 'true',
      message: message
    });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
};

// Refresh all images (legacy - triggers sync for all paths)
const refreshImages = async (req, res) => {
  try {
    const paths = db.prepare('SELECT id, name FROM drive_paths').all();

    if (paths.length === 0) {
      return res.json({ message: 'No drive paths configured', added: 0 });
    }

    let totalAdded = 0;
    const results = [];

    for (const drivePath of paths) {
      try {
        const result = await syncDrivePath(drivePath.id);
        totalAdded += result.added;
        results.push({ name: drivePath.name, ...result });
      } catch (error) {
        results.push({ name: drivePath.name, error: error.message });
      }
    }

    res.json({
      message: 'Sync completed',
      totalAdded,
      results
    });
  } catch (error) {
    console.error('Error refreshing images:', error);
    res.status(500).json({ error: 'Failed to refresh images' });
  }
};

// Assign image to project
const assignImageToProject = async (req, res) => {
  try {
    const { imageId, projectId } = req.body;

    if (!imageId || !projectId) {
      return res.status(400).json({ error: 'Image ID and Project ID are required' });
    }

    // Get image details
    const image = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(imageId);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Get project details
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get project base path from settings
    const setting = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    if (!setting || !setting.project_path) {
      return res.status(400).json({ error: 'Project base path not configured' });
    }

    const projectBasePath = setting.project_path;
    const projectFolderPath = path.join(projectBasePath, project.folder_name);
    const imagesFolderPath = path.join(projectFolderPath, 'Bilder');

    // Create Bilder folder if it doesn't exist
    await fs.ensureDir(imagesFolderPath);

    // Get source file path - convert relative to absolute
    let sourcePath = image.local_path;

    if (!sourcePath) {
      return res.status(404).json({
        error: 'Source image file not found',
        details: 'local_path is not set in database'
      });
    }

    // Convert relative path to absolute path (relative to project root)
    // Remove leading slash if present
    const relativePath = sourcePath.startsWith('/') ? sourcePath.substring(1) : sourcePath;
    const absolutePath = path.join(__dirname, '../../..', relativePath);

    console.log('Path resolution:', {
      original: sourcePath,
      relative: relativePath,
      absolute: absolutePath
    });

    // Check if path exists
    const pathExists = await fs.pathExists(absolutePath);
    console.log('Path exists check:', absolutePath, '→', pathExists);

    if (!pathExists) {
      return res.status(404).json({
        error: 'Source image file not found',
        details: `Path does not exist: ${absolutePath}`
      });
    }

    // Use absolute path for further operations
    sourcePath = absolutePath;

    // Destination path
    const fileName = path.basename(sourcePath);
    const destPath = path.join(imagesFolderPath, fileName);

    // Copy file to project folder
    await fs.copy(sourcePath, destPath, { overwrite: false });

    // Check if assignment already exists
    const existing = db.prepare(
      'SELECT id FROM image_project_assignments WHERE image_id = ? AND project_id = ?'
    ).get(imageId, projectId);

    if (!existing) {
      // Create assignment record
      db.prepare(
        'INSERT INTO image_project_assignments (image_id, project_id) VALUES (?, ?)'
      ).run(imageId, projectId);
    }

    // Move file on Google Drive if it has a drive_file_id
    let driveMovedSuccess = false;
    if (image.drive_file_id && await isAuthenticated()) {
      try {
        // Find or create NR_Fuchs_Meta/Projekte/<ProjectName> on Drive
        const allPaths = db.prepare('SELECT path FROM drive_paths').all();
        let metaFolder = null;
        let rootFolderId = null;

        for (const dp of allPaths) {
          const fid = extractFolderId(dp.path);
          if (!fid) continue;
          rootFolderId = fid;
          metaFolder = await findSubfolder(fid, 'NR_Fuchs_Meta');
          if (metaFolder) break;
        }

        if (!metaFolder && rootFolderId) {
          metaFolder = await createFolderOnDrive('NR_Fuchs_Meta', rootFolderId);
        }

        if (metaFolder) {
          const projekteFolder = await findOrCreateSubfolder(metaFolder.id, 'Projekte');
          const projectDriveFolder = await findOrCreateSubfolder(projekteFolder.id, project.folder_name);

          // Get current file parents
          const fileMeta = await getFileMetadata(image.drive_file_id);
          if (fileMeta && fileMeta.parents && fileMeta.parents.length > 0) {
            // Only move if not already in the project folder
            if (!fileMeta.parents.includes(projectDriveFolder.id)) {
              await moveFileOnDrive(image.drive_file_id, projectDriveFolder.id, fileMeta.parents[0]);
              driveMovedSuccess = true;
              console.log(`📦 Moved "${image.name}" to Drive folder: ${project.folder_name}`);
            }
          }
        }
      } catch (driveError) {
        console.error('Drive move failed (local copy still succeeded):', driveError.message);
      }
    }

    res.json({
      message: 'Image assigned to project successfully',
      projectName: project.folder_name,
      destinationPath: destPath,
      driveMovedSuccess,
    });
  } catch (error) {
    console.error('Error assigning image to project:', error);
    res.status(500).json({ error: 'Failed to assign image to project' });
  }
};

// Unassign image from project
const unassignImageFromProject = async (req, res) => {
  try {
    const { imageId, projectId } = req.body;

    // Validate input
    if (!imageId || !projectId) {
      return res.status(400).json({ error: 'imageId and projectId are required' });
    }

    // Get project info
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get image info
    const image = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(imageId);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Check if assignment exists
    const existing = db.prepare(
      'SELECT id FROM image_project_assignments WHERE image_id = ? AND project_id = ?'
    ).get(imageId, projectId);

    if (!existing) {
      return res.status(404).json({ error: 'Image is not assigned to this project' });
    }

    // Get project_settings to find base path
    const projectSettings = db.prepare('SELECT * FROM project_settings LIMIT 1').get();
    if (!projectSettings?.project_path) {
      return res.status(500).json({ error: 'Projects base path not configured' });
    }

    // Build project folder path
    const projectFolderPath = path.join(projectSettings.project_path, project.folder_name, 'Bilder');

    // Delete image from project folder
    const fileName = path.basename(image.local_path);
    const imagePathInProject = path.join(projectFolderPath, fileName);

    if (await fs.pathExists(imagePathInProject)) {
      await fs.remove(imagePathInProject);
      console.log(`🗑️ Deleted image from project folder: ${imagePathInProject}`);
    }

    // Check if project folder is empty (only contains Bilder folder or is completely empty)
    const bilderFolderExists = await fs.pathExists(projectFolderPath);
    if (bilderFolderExists) {
      const filesInBilder = await fs.readdir(projectFolderPath);
      if (filesInBilder.length === 0) {
        // Delete Bilder folder if empty
        await fs.remove(projectFolderPath);
        console.log(`🗑️ Deleted empty Bilder folder: ${projectFolderPath}`);

        // Check if parent project folder is empty
        const projectFolder = path.dirname(projectFolderPath);
        const filesInProject = await fs.readdir(projectFolder);
        if (filesInProject.length === 0) {
          // Delete project folder if empty
          await fs.remove(projectFolder);
          console.log(`🗑️ Deleted empty project folder: ${projectFolder}`);
        }
      }
    }

    // Delete assignment record
    db.prepare(
      'DELETE FROM image_project_assignments WHERE image_id = ? AND project_id = ?'
    ).run(imageId, projectId);

    res.json({
      message: 'Image unassigned from project successfully',
      projectName: project.folder_name
    });
  } catch (error) {
    console.error('Error unassigning image from project:', error);
    res.status(500).json({ error: 'Failed to unassign image from project' });
  }
};

/**
 * Bulk convert images to a specific format
 * Supports: drive images only, project images only, or all
 */
const bulkConvertImages = async (req, res) => {
  const { scope, format, quality, maxWidth, maxHeight } = req.body;

  if (!scope || !format) {
    return res.status(400).json({ error: 'Scope und Format sind erforderlich' });
  }

  if (!['drive', 'projects', 'all'].includes(scope)) {
    return res.status(400).json({ error: 'Ungültiger Scope (drive, projects, all)' });
  }

  if (!['webp', 'jpeg', 'png'].includes(format)) {
    return res.status(400).json({ error: 'Ungültiges Format (webp, jpeg, png)' });
  }

  // Respond immediately, process in background
  res.json({ success: true, message: 'Konvertierung wurde gestartet' });

  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
  const uploadsRoot = path.join(__dirname, '../../../uploads');
  let converted = 0;
  let skipped = 0;
  let errors = 0;

  const convertFile = async (filePath) => {
    try {
      const ext = path.extname(filePath).toLowerCase();
      if (!imageExtensions.includes(ext)) {
        skipped++;
        return;
      }

      // Skip if already in target format
      const targetExt = `.${format === 'jpeg' ? 'jpg' : format}`;
      if (ext === targetExt || (ext === '.jpg' && format === 'jpeg') || (ext === '.jpeg' && format === 'jpeg')) {
        skipped++;
        return;
      }

      const dir = path.dirname(filePath);
      const baseName = path.basename(filePath, ext);
      const outputPath = path.join(dir, `${baseName}.${format === 'jpeg' ? 'jpg' : format}`);

      await compressImage(filePath, outputPath, {
        format,
        quality: quality || 85,
        maxWidth: maxWidth || null,
        maxHeight: maxHeight || null
      });

      // Remove original file if the output is a different file
      if (filePath !== outputPath) {
        await fs.remove(filePath);
      }

      // Regenerate thumbnail
      const thumbnailDir = path.join(uploadsRoot, 'thumbnails');
      const thumbName = `${baseName}.${format === 'jpeg' ? 'jpg' : format}`;
      const thumbnailPath = path.join(thumbnailDir, thumbName);
      try {
        await generateThumbnail(outputPath, thumbnailPath);
      } catch (e) {
        // Non-critical, don't fail the whole operation
      }

      // Update database entry if it's a tracked drive image
      try {
        const relativePath = '/' + path.relative(path.join(__dirname, '../../..'), filePath).replace(/\\/g, '/');
        const newRelativePath = '/' + path.relative(path.join(__dirname, '../../..'), outputPath).replace(/\\/g, '/');
        const newThumbnailPath = '/uploads/thumbnails/' + thumbName;
        const stats = await fs.stat(outputPath);

        db.prepare(
          'UPDATE drive_images SET local_path = ?, thumbnail_url = ?, file_size = ?, is_compressed = 1 WHERE local_path = ?'
        ).run(newRelativePath, newThumbnailPath, stats.size, relativePath);
      } catch (e) {
        // Image may not be in DB (e.g. project images), that's fine
      }

      converted++;
    } catch (err) {
      console.error(`Fehler bei Konvertierung von ${filePath}:`, err.message);
      errors++;
    }
  };

  const processDirectory = async (dirPath) => {
    if (!await fs.pathExists(dirPath)) return;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await processDirectory(fullPath);
      } else {
        await convertFile(fullPath);
      }
    }
  };

  try {
    // Process drive images
    if (scope === 'drive' || scope === 'all') {
      const driveDir = path.join(uploadsRoot, 'drive');
      console.log(`🔄 Bulk-Konvertierung: Drive-Bilder → ${format.toUpperCase()}`);
      await processDirectory(driveDir);
    }

    // Process project images
    if (scope === 'projects' || scope === 'all') {
      const projectSettings = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
      if (projectSettings && projectSettings.project_path) {
        console.log(`🔄 Bulk-Konvertierung: Projekt-Bilder → ${format.toUpperCase()}`);
        await processDirectory(projectSettings.project_path);
      }
    }

    console.log(`✅ Bulk-Konvertierung abgeschlossen: ${converted} konvertiert, ${skipped} übersprungen, ${errors} Fehler`);
  } catch (err) {
    console.error('❌ Bulk-Konvertierung fehlgeschlagen:', err.message);
  }
};

module.exports = {
  getDriveSettings,
  addDrivePath,
  removeDrivePath,
  updateDrivePath,
  getImages,
  getImageById,
  renameImage,
  deleteImage,
  syncDrive,
  refreshImages,
  assignImageToProject,
  unassignImageFromProject,
  bulkConvertImages
};
