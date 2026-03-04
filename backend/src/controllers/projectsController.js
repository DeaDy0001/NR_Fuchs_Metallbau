const db = require('../config/database');
const fs = require('fs-extra');
const path = require('path');
const {
  extractFolderId,
  listFoldersInFolder,
  listAllFilesInFolder,
  findSubfolder,
  downloadFile: downloadDriveFile,
  generateThumbnail,
  createFolderOnDrive,
  moveFileOnDrive,
  getFileMetadata,
  findOrCreateSubfolder,
  listFilesInFolder,
  uploadFileToDrive,
  deleteFileFromDrive,
} = require('../services/googleDriveService');
const { isAuthenticated, getDriveClient } = require('../services/authService');

// Get project settings (configured path)
const getProjectSettings = (req, res) => {
  try {
    const result = db.prepare('SELECT * FROM project_settings WHERE id = 1').get();

    if (!result) {
      // Create default settings
      const stmt = db.prepare('INSERT INTO project_settings (project_path) VALUES (?)');
      const insertResult = stmt.run(null);
      const defaultSettings = db.prepare('SELECT * FROM project_settings WHERE id = ?').get(insertResult.lastInsertRowid);
      return res.json(defaultSettings);
    }

    res.json(result);
  } catch (error) {
    console.error('Error getting project settings:', error);
    res.status(500).json({ error: 'Failed to get project settings' });
  }
};

// Set project path and sync settings
const setProjectPath = async (req, res) => {
  try {
    const { path: projectPath, sync_interval, auto_sync_enabled } = req.body;

    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    // Check if path exists (keep async for fs operations)
    const pathExists = await fs.pathExists(projectPath);
    if (!pathExists) {
      return res.status(400).json({ error: 'Path does not exist' });
    }

    // Build update query dynamically
    const updates = ["project_path = ?", "updated_at = datetime('now')"];
    const params = [projectPath];

    if (sync_interval !== undefined) {
      updates.push('sync_interval = ?');
      params.push(parseInt(sync_interval));
    }

    if (auto_sync_enabled !== undefined) {
      updates.push('auto_sync_enabled = ?');
      params.push(auto_sync_enabled ? 1 : 0);
    }

    params.push(1); // WHERE id = 1

    const updateStmt = db.prepare(`UPDATE project_settings SET ${updates.join(', ')} WHERE id = ?`);
    const updateResult = updateStmt.run(...params);

    if (updateResult.changes === 0) {
      // Insert if doesn't exist
      const insertStmt = db.prepare(`
        INSERT INTO project_settings (project_path, sync_interval, auto_sync_enabled)
        VALUES (?, ?, ?)
      `);
      const insertResult = insertStmt.run(
        projectPath,
        sync_interval !== undefined ? parseInt(sync_interval) : 30,
        auto_sync_enabled !== undefined ? (auto_sync_enabled ? 1 : 0) : 1
      );
      const newSettings = db.prepare('SELECT * FROM project_settings WHERE id = ?').get(insertResult.lastInsertRowid);
      return res.json(newSettings);
    }

    const updatedSettings = db.prepare('SELECT * FROM project_settings WHERE id = 1').get();
    res.json(updatedSettings);
  } catch (error) {
    console.error('Error setting project path:', error);
    res.status(500).json({ error: 'Failed to set project path' });
  }
};

// Get all projects
const getProjects = async (req, res) => {
  try {
    const { limit = 100, offset = 0, search = '', tags = '' } = req.query;

    let query = 'SELECT * FROM projects WHERE 1=1';
    const params = [];

    if (search) {
      // Search in folder_name, notes AND tags
      query += ' AND (folder_name LIKE ? OR notes LIKE ? OR tags LIKE ?)';
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam);
    }

    // Filter by tags (if provided AND different from search)
    if (tags && tags !== search) {
      query += ' AND tags LIKE ?';
      const tagParam = `%${tags}%`;
      params.push(tagParam);
    }

    // Sort alphabetically by folder name
    query += ' ORDER BY folder_name COLLATE NOCASE ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const projects = db.prepare(query).all(...params);

    // Get project settings to build folder paths
    const settings = db.prepare('SELECT * FROM project_settings WHERE id = 1').get();

    // Enrich each project with image count and folder creation date
    const enrichedProjects = await Promise.all(projects.map(async (project) => {
      // Count images assigned to this project
      const imageCount = db.prepare(
        'SELECT COUNT(*) as count FROM image_project_assignments WHERE project_id = ?'
      ).get(project.id);

      // Get folder creation date from filesystem
      let folderCreatedAt = project.created_at; // Fallback to DB date
      if (settings?.project_path) {
        const projectFolderPath = path.join(settings.project_path, project.folder_name);
        try {
          if (await fs.pathExists(projectFolderPath)) {
            const stats = await fs.stat(projectFolderPath);
            folderCreatedAt = stats.birthtime.toISOString();
          }
        } catch (err) {
          console.error(`Error getting folder stats for ${project.folder_name}:`, err);
        }
      }

      return {
        ...project,
        tags: project.tags ? JSON.parse(project.tags) : [],
        image_count: imageCount.count,
        folder_created_at: folderCreatedAt
      };
    }));

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM projects WHERE 1=1';
    const countParams = [];

    if (search) {
      // Search in folder_name, notes AND tags
      countQuery += ' AND (folder_name LIKE ? OR notes LIKE ? OR tags LIKE ?)';
      const searchParam = `%${search}%`;
      countParams.push(searchParam, searchParam, searchParam);
    }

    if (tags && tags !== search) {
      countQuery += ' AND tags LIKE ?';
      const tagParam = `%${tags}%`;
      countParams.push(tagParam);
    }

    const countResult = db.prepare(countQuery).get(...countParams);

    res.json({
      projects: enrichedProjects,
      total: countResult.count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error getting projects:', error);
    res.status(500).json({ error: 'Failed to get projects' });
  }
};

// Get single project by ID
const getProjectById = (req, res) => {
  try {
    const { id } = req.params;

    const result = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);

    if (!result) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Parse tags JSON
    const project = {
      ...result,
      tags: result.tags ? JSON.parse(result.tags) : []
    };

    res.json(project);
  } catch (error) {
    console.error('Error getting project:', error);
    res.status(500).json({ error: 'Failed to get project' });
  }
};

// Create a new project
const createProject = async (req, res) => {
  try {
    const { folder_name, color, notes } = req.body;

    if (!folder_name || !folder_name.trim()) {
      return res.status(400).json({ error: 'Projektname ist erforderlich' });
    }

    const trimmedName = folder_name.trim();

    // Validate folder name characters
    const invalidChars = /[\\/:*?"<>|]/;
    if (invalidChars.test(trimmedName)) {
      return res.status(400).json({ error: 'Projektname enthält ungültige Zeichen (\\/:*?"<>|)' });
    }

    // Check for duplicate
    const existing = db.prepare('SELECT id FROM projects WHERE folder_name = ?').get(trimmedName);
    if (existing) {
      return res.status(400).json({ error: 'Ein Projekt mit diesem Namen existiert bereits' });
    }

    // Create project in DB
    const stmt = db.prepare('INSERT INTO projects (folder_name, color, notes) VALUES (?, ?, ?)');
    const result = stmt.run(trimmedName, color || '#3b82f6', notes || '');

    // Create folder on filesystem if project path is configured
    const setting = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    if (setting?.project_path) {
      const projectFolderPath = path.join(setting.project_path, trimmedName);
      const bilderPath = path.join(projectFolderPath, 'Bilder');
      await fs.ensureDir(bilderPath);
      console.log(`📁 Created project folder: ${projectFolderPath}`);
    }

    const newProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
    const project = {
      ...newProject,
      tags: newProject.tags ? JSON.parse(newProject.tags) : []
    };
    res.json(project);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Projekts' });
  }
};

// Update a project
const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { color, notes, tags } = req.body;

    // Build dynamic update query based on provided fields
    const updates = [];
    const params = [];

    if (color !== undefined) {
      updates.push('color = ?');
      params.push(color);
    }

    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }

    if (tags !== undefined) {
      updates.push('tags = ?');
      params.push(JSON.stringify(tags));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(id);

    const query = `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`;
    const result = db.prepare(query).run(...params);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const updatedProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);

    // Parse tags JSON
    const project = {
      ...updatedProject,
      tags: updatedProject.tags ? JSON.parse(updatedProject.tags) : []
    };

    // Write JSON metadata to project folder
    const setting = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    if (setting?.project_path) {
      const projectFolderPath = path.join(setting.project_path, updatedProject.folder_name);
      await writeProjectMetadata(updatedProject, projectFolderPath);
    }

    res.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
};

// Delete a project
/**
 * Delete a project with three modes:
 * DELETE /api/projects/:id?mode=soft|with_images|complete
 *
 * - soft: Remove project from DB, images become unassigned. Local Bilder folder deleted,
 *         rest of project folder stays. Drive project folder deleted.
 * - with_images: Delete project + all assigned images (local files + Drive files + DB records)
 * - complete: Delete entire local project folder + Drive project folder + all DB records
 */
const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { mode = 'soft' } = req.query;

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) {
      return res.status(404).json({ error: 'Projekt nicht gefunden' });
    }

    const setting = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    const projectPath = setting?.project_path;
    const projectFolder = projectPath ? path.join(projectPath, project.folder_name) : null;
    const bilderFolder = projectFolder ? path.join(projectFolder, 'Bilder') : null;

    const results = { deletedImages: 0, deletedDriveFiles: 0, errors: [] };

    // Get all images assigned to this project
    const assignedImages = db.prepare(`
      SELECT di.* FROM drive_images di
      JOIN image_project_assignments ipa ON di.id = ipa.image_id
      WHERE ipa.project_id = ?
    `).all(id);

    // --- MODE: soft ---
    // Remove project from software, images become unassigned
    if (mode === 'soft') {
      // Delete local Bilder folder (but keep rest of project folder)
      if (bilderFolder && await fs.pathExists(bilderFolder)) {
        try {
          await fs.remove(bilderFolder);
        } catch (e) {
          results.errors.push(`Lokaler Bilder-Ordner: ${e.message}`);
        }
      }

      // Delete .project.json if it exists in project root
      if (projectFolder) {
        const metaFile = path.join(projectFolder, '.project.json');
        if (await fs.pathExists(metaFile)) {
          try { await fs.remove(metaFile); } catch {}
        }
      }

      // Delete Drive project folder
      await deleteDriveProjectFolder(project.folder_name, results);

      // Delete image DB records that are ONLY assigned to this project
      for (const img of assignedImages) {
        const otherAssignments = db.prepare(
          'SELECT COUNT(*) as cnt FROM image_project_assignments WHERE image_id = ? AND project_id != ?'
        ).get(img.id, id);

        if (otherAssignments.cnt === 0) {
          // Only assigned to this project - delete the image record
          db.prepare('DELETE FROM drive_images WHERE id = ?').run(img.id);
          results.deletedImages++;
        }
      }

      // Delete project from DB (cascading deletes assignments)
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    }

    // --- MODE: with_images ---
    // Delete project + all images (local files + Drive files)
    else if (mode === 'with_images') {
      // Delete each image's local file and Drive file
      for (const img of assignedImages) {
        // Delete local file
        if (img.local_path && projectPath) {
          const localFile = path.join(__dirname, '../../..', img.local_path);
          if (await fs.pathExists(localFile)) {
            try {
              await fs.remove(localFile);
              results.deletedImages++;
            } catch (e) {
              results.errors.push(`Lokale Datei ${img.name}: ${e.message}`);
            }
          }
        }

        // Delete Drive file
        if (img.drive_file_id) {
          try {
            await deleteFileFromDrive(img.drive_file_id);
            results.deletedDriveFiles++;
          } catch (e) {
            if (e.code !== 404) results.errors.push(`Drive-Datei ${img.name}: ${e.message}`);
          }
        }

        // Delete thumbnail
        if (img.thumbnail_url) {
          const thumbPath = path.join(__dirname, '../../..', img.thumbnail_url);
          try { await fs.remove(thumbPath); } catch {}
        }

        // Delete image from DB
        db.prepare('DELETE FROM drive_images WHERE id = ?').run(img.id);
      }

      // Delete local Bilder folder
      if (bilderFolder && await fs.pathExists(bilderFolder)) {
        try { await fs.remove(bilderFolder); } catch (e) {
          results.errors.push(`Lokaler Bilder-Ordner: ${e.message}`);
        }
      }

      // Delete Drive project folder
      await deleteDriveProjectFolder(project.folder_name, results);

      // Delete project from DB
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    }

    // --- MODE: complete ---
    // Delete EVERYTHING - entire local project folder + Drive folder
    else if (mode === 'complete') {
      // Delete all image DB records for this project
      for (const img of assignedImages) {
        if (img.drive_file_id) {
          try {
            await deleteFileFromDrive(img.drive_file_id);
            results.deletedDriveFiles++;
          } catch (e) {
            if (e.code !== 404) results.errors.push(`Drive-Datei ${img.name}: ${e.message}`);
          }
        }
        if (img.thumbnail_url) {
          const thumbPath = path.join(__dirname, '../../..', img.thumbnail_url);
          try { await fs.remove(thumbPath); } catch {}
        }
        db.prepare('DELETE FROM drive_images WHERE id = ?').run(img.id);
        results.deletedImages++;
      }

      // Delete ENTIRE local project folder
      if (projectFolder && await fs.pathExists(projectFolder)) {
        try {
          await fs.remove(projectFolder);
        } catch (e) {
          results.errors.push(`Lokaler Projektordner: ${e.message}`);
        }
      }

      // Delete Drive project folder
      await deleteDriveProjectFolder(project.folder_name, results);

      // Delete project from DB
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    } else {
      return res.status(400).json({ error: `Unbekannter Löschmodus: ${mode}` });
    }

    res.json({
      success: true,
      mode,
      projectName: project.folder_name,
      ...results,
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: `Projekt konnte nicht gelöscht werden: ${error.message}` });
  }
};

/**
 * Helper: Find and delete a project's folder on Google Drive
 */
const deleteDriveProjectFolder = async (folderName, results) => {
  try {
    if (!await isAuthenticated()) return;

    const { projekteFolder } = await ensureProjekteFolderOnDrive();
    const driveFolders = await listFoldersInFolder(projekteFolder.id);
    const targetFolder = driveFolders.find(f => f.name.toLowerCase() === folderName.toLowerCase());

    if (targetFolder) {
      await deleteFileFromDrive(targetFolder.id);
      results.deletedDriveFiles++;
    }
  } catch (e) {
    results.errors.push(`Drive-Projektordner: ${e.message}`);
  }
};

// Sync projects from filesystem
const syncProjects = async (req, res) => {
  try {
    // Get configured project path
    const settingsResult = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();

    if (!settingsResult || !settingsResult.project_path) {
      return res.status(400).json({ error: 'Project path not configured' });
    }

    const projectPath = settingsResult.project_path;

    // Check if path exists (keep async for fs operations)
    const pathExists = await fs.pathExists(projectPath);
    if (!pathExists) {
      return res.status(400).json({ error: 'Configured path does not exist' });
    }

    // Read directories (keep async for fs operations)
    const items = await fs.readdir(projectPath, { withFileTypes: true });
    const folders = items.filter(item => item.isDirectory()).map(item => item.name);
    const folderSet = new Set(folders);

    // Get existing projects
    const existingProjects = db.prepare('SELECT id, folder_name FROM projects').all();
    const existingFolderNames = new Set(existingProjects.map(p => p.folder_name));

    let addedCount = 0;
    let renamedCount = 0;

    // Add new projects and count images
    const insertStmt = db.prepare('INSERT INTO projects (folder_name, color, notes) VALUES (?, ?, ?)');
    const updateFolderNameStmt = db.prepare('UPDATE projects SET folder_name = ?, updated_at = datetime(\'now\') WHERE id = ?');
    const projectImageCounts = [];
    const renamedProjects = [];

    for (const folderName of folders) {
      // Check if .project.json exists in Bilder/ subfolder
      const metadataPath = path.join(projectPath, folderName, 'Bilder', '.project.json');
      let metadata = null;
      try {
        if (await fs.pathExists(metadataPath)) {
          metadata = await fs.readJson(metadataPath);
          console.log(`📖 Found metadata for "${folderName}":`, metadata);

          // Check if project with this ID exists in DB
          const existingProject = db.prepare('SELECT id, folder_name FROM projects WHERE id = ?').get(metadata.id);

          if (existingProject && existingProject.folder_name !== folderName) {
            // Folder was renamed → update DB
            console.log(`🔄 Detected rename: "${existingProject.folder_name}" → "${folderName}" (ID: ${metadata.id})`);
            updateFolderNameStmt.run(folderName, metadata.id);
            renamedProjects.push({ old: existingProject.folder_name, new: folderName });
            renamedCount++;

            // Update existingFolderNames to reflect the rename
            existingFolderNames.delete(existingProject.folder_name);
            existingFolderNames.add(folderName);
          }
        }
      } catch (err) {
        console.error(`Error reading metadata for ${folderName}:`, err);
      }

      // Add project if it doesn't exist (either no metadata or not in DB)
      if (!existingFolderNames.has(folderName)) {
        insertStmt.run(folderName, '#3b82f6', '');
        addedCount++;
        existingFolderNames.add(folderName);
      }

      // Count images in Bilder subfolder for reporting
      const imagesFolderPath = path.join(projectPath, folderName, 'Bilder');
      let imageCount = 0;
      try {
        if (await fs.pathExists(imagesFolderPath)) {
          const imageFiles = await fs.readdir(imagesFolderPath);
          imageCount = imageFiles.filter(file => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file)).length;
        }
      } catch (err) {
        // Ignore errors (e.g., no read permission)
      }

      if (imageCount > 0) {
        projectImageCounts.push({ folder: folderName, count: imageCount });
      }
    }

    // Detect removed projects (exist in DB but not on filesystem)
    const removedProjects = existingProjects.filter(p => !folderSet.has(p.folder_name));
    const removedNames = removedProjects.map(p => p.folder_name);

    // Delete removed projects (image_project_assignments cleaned up via CASCADE)
    if (removedProjects.length > 0) {
      const deleteStmt = db.prepare('DELETE FROM projects WHERE id = ?');
      for (const project of removedProjects) {
        deleteStmt.run(project.id);
      }
    }

    // Update last_sync timestamp
    db.prepare("UPDATE project_settings SET last_sync = datetime('now') WHERE id = 1").run();

    res.json({
      message: 'Projects synced successfully',
      added: addedCount,
      removed: removedNames,
      renamed: renamedProjects,
      total: folders.length,
      imageCounts: projectImageCounts
    });
  } catch (error) {
    console.error('Error syncing projects:', error);
    res.status(500).json({ error: 'Failed to sync projects' });
  }
};

// Get project files (images and PDFs)
const getProjectFiles = async (req, res) => {
  try {
    const { id } = req.params;

    // Get project details
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
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

    // Check if project folder exists
    if (!(await fs.pathExists(projectFolderPath))) {
      return res.json({
        images: [],
        pdfs: [],
        hasImages: false,
        hasPdfs: false
      });
    }

    // Scan for images in Bilder folder
    const imagesFolderPath = path.join(projectFolderPath, 'Bilder');
    const THUMBS_DIR = path.join(__dirname, '../../../uploads/thumbnails');
    await fs.ensureDir(THUMBS_DIR);

    // Returns /uploads/thumbnails/... URL for a project image, generating if needed
    const getOrMakeThumbnail = async (filePath, projectId, fileName) => {
      const baseNoExt = path.basename(fileName, path.extname(fileName));
      const thumbName = `proj_${projectId}_${baseNoExt.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
      const thumbPath = path.join(THUMBS_DIR, thumbName);
      if (!await fs.pathExists(thumbPath)) {
        try { await generateThumbnail(filePath, thumbPath); } catch { return null; }
      }
      return `/uploads/thumbnails/${thumbName}`;
    };

    let images = [];
    if (await fs.pathExists(imagesFolderPath)) {
      const imageFiles = await fs.readdir(imagesFolderPath);

      // Get all drive_images that are assigned to this project
      const dbImages = db.prepare(`
        SELECT di.*
        FROM drive_images di
        JOIN image_project_assignments ipa ON di.id = ipa.image_id
        WHERE ipa.project_id = ?
      `).all(id);

      // Create a map of filename -> db image for quick lookup
      // Use filename from local_path to handle extension correctly
      const dbImageMap = new Map();
      dbImages.forEach(img => {
        // Extract filename from local_path (handles both /api/projects/... and /uploads/drive/...)
        const filename = path.basename(img.local_path);
        dbImageMap.set(filename, img);

        // Also add by img.name for backwards compatibility (some entries might not have extension)
        if (img.name && img.name !== filename) {
          dbImageMap.set(img.name, img);
        }
      });

      // Prepare statement for getting projects per image
      const projectsStmt = db.prepare(`
        SELECT p.id, p.folder_name, p.color
        FROM image_project_assignments ipa
        JOIN projects p ON ipa.project_id = p.id
        WHERE ipa.image_id = ?
      `);

      // Helper function to get image metadata
      const sharp = require('sharp');
      const getImageMetadata = async (filePath) => {
        try {
          const stats = await fs.stat(filePath);
          const metadata = await sharp(filePath).metadata();

          return {
            file_size: stats.size,
            width: metadata.width,
            height: metadata.height,
            // Try to get photo date from EXIF
            photo_taken_at: metadata.exif?.DateTimeOriginal || null
          };
        } catch (error) {
          console.error('Error reading image metadata:', error);
          return {};
        }
      };

      // Helper function to auto-register image to database
      const registerImageToDatabase = async (fileName, filePath, projectId, subfolder) => {
        try {
          console.log(`📝 Auto-registering image: ${fileName} ${subfolder ? `(subfolder: ${subfolder})` : ''}`);

          // Check if image already exists in DB (maybe with different name)
          const existingImage = db.prepare(`
            SELECT id FROM drive_images WHERE name = ? OR original_name = ?
          `).get(fileName, fileName);

          if (existingImage) {
            console.log(`✅ Image already exists in DB with ID: ${existingImage.id}`);

            // Check if already assigned to this project
            const assignment = db.prepare(`
              SELECT id FROM image_project_assignments
              WHERE image_id = ? AND project_id = ?
            `).get(existingImage.id, projectId);

            if (!assignment) {
              // Create assignment
              db.prepare(`
                INSERT INTO image_project_assignments (image_id, project_id)
                VALUES (?, ?)
              `).run(existingImage.id, projectId);
              console.log(`🔗 Assigned existing image to project`);
            }

            return existingImage.id;
          }

          // Get metadata
          const metadata = await getImageMetadata(filePath);
          const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
          const projectImageUrl = `/api/projects/${projectId}/file/image/${encodeURIComponent(fileName)}`;

          // Generate thumbnail
          const regThumbUrl = await getOrMakeThumbnail(filePath, projectId, fileName);

          // Insert into database (using correct column names from schema)
          const result = db.prepare(`
            INSERT INTO drive_images (
              name,
              original_name,
              file_size,
              width,
              height,
              photo_taken_at,
              created_at,
              file_url,
              local_path,
              thumbnail_url,
              mime_type,
              subfolder,
              drive_path_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            fileName,
            fileName,
            metadata.file_size || null,
            metadata.width || null,
            metadata.height || null,
            metadata.photo_taken_at || null,
            now,
            projectImageUrl,  // file_url (required!)
            projectImageUrl,  // local_path
            regThumbUrl || projectImageUrl,  // thumbnail_url
            `image/${fileName.split('.').pop().toLowerCase()}`,
            subfolder || null,
            null  // drive_path_id = NULL for project images
          );

          const imageId = result.lastInsertRowid;

          // Create project assignment
          db.prepare(`
            INSERT INTO image_project_assignments (image_id, project_id)
            VALUES (?, ?)
          `).run(imageId, projectId);

          console.log(`✅ Auto-registered image with ID: ${imageId}`);
          return imageId;

        } catch (error) {
          console.error('Error auto-registering image:', error);
          return null;
        }
      };

      images = await Promise.all(imageFiles
        .filter(file => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file))
        .map(async file => {
          const dbImage = dbImageMap.get(file);
          const projectImageUrl = `/api/projects/${id}/file/image/${encodeURIComponent(file)}`;
          const filePath = path.join(imagesFolderPath, file);

          if (dbImage) {
            // Use full DB info but override paths to use project copy
            const thumbUrl = await getOrMakeThumbnail(filePath, id, file);
            if (thumbUrl && dbImage.thumbnail_url !== thumbUrl) {
              db.prepare('UPDATE drive_images SET thumbnail_url = ? WHERE id = ?').run(thumbUrl, dbImage.id);
            }
            return {
              ...dbImage,
              local_path: projectImageUrl,
              thumbnail_url: thumbUrl || projectImageUrl,
              url: projectImageUrl,
              type: 'image',
              projects: projectsStmt.all(dbImage.id)  // Add projects list
            };
          } else {
            // AUTO-REGISTER: Image not in DB yet, register it automatically
            console.log(`⚠️  Image "${file}" not in DB - auto-registering...`);

            // For now, subfolder is null since we only scan Bilder/ root
            // TODO: Extend to scan subfolders recursively
            const imageId = await registerImageToDatabase(file, filePath, id, null);
            const metadata = await getImageMetadata(filePath);

            if (imageId) {
              // Successfully registered - fetch the full DB entry
              const newDbImage = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(imageId);
              const newThumbUrl = await getOrMakeThumbnail(filePath, id, file);

              return {
                ...newDbImage,
                local_path: projectImageUrl,
                thumbnail_url: newThumbUrl || projectImageUrl,
                url: projectImageUrl,
                type: 'image',
                projects: projectsStmt.all(imageId)  // Add projects list
              };
            } else {
              // Fallback if registration failed
              const fbThumbUrl = await getOrMakeThumbnail(filePath, id, file);
              return {
                name: file,
                original_name: file,
                path: filePath,
                url: projectImageUrl,
                local_path: projectImageUrl,
                thumbnail_url: fbThumbUrl || projectImageUrl,
                type: 'image',
                ...metadata
              };
            }
          }
        })
      );
    }

    // Scan for PDFs in main folder
    const files = await fs.readdir(projectFolderPath);
    const pdfs = files
      .filter(file => /\.pdf$/i.test(file))
      .map(file => ({
        name: file,
        path: path.join(projectFolderPath, file),
        url: `/api/projects/${id}/file/pdf/${encodeURIComponent(file)}`,
        type: 'pdf'
      }));

    res.json({
      images,
      pdfs,
      hasImages: images.length > 0,
      hasPdfs: pdfs.length > 0
    });
  } catch (error) {
    console.error('Error getting project files:', error);
    res.status(500).json({ error: 'Failed to get project files' });
  }
};

// Serve a project file (image or PDF)
const serveProjectFile = async (req, res) => {
  try {
    const { id, type, filename } = req.params;

    // Get project details
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
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

    let filePath;
    if (type === 'image') {
      // Images are in Bilder subfolder
      filePath = path.join(projectFolderPath, 'Bilder', filename);
    } else if (type === 'pdf') {
      // PDFs are in main folder
      filePath = path.join(projectFolderPath, filename);
    } else {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    // Check if file exists
    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Send file
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving project file:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
};

// Rename a project (folder and database)
const renameProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_name } = req.body;

    if (!new_name || !new_name.trim()) {
      return res.status(400).json({ error: 'New name is required' });
    }

    const trimmedName = new_name.trim();

    // Get project details
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if name already exists
    const existing = db.prepare('SELECT id FROM projects WHERE folder_name = ? AND id != ?').get(trimmedName, id);
    if (existing) {
      return res.status(400).json({ error: 'Ein Projekt mit diesem Namen existiert bereits' });
    }

    // Get project base path from settings
    const setting = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    if (!setting || !setting.project_path) {
      return res.status(400).json({ error: 'Project base path not configured' });
    }

    const projectBasePath = setting.project_path;
    const oldFolderPath = path.join(projectBasePath, project.folder_name);
    const newFolderPath = path.join(projectBasePath, trimmedName);

    // Check if old folder exists
    if (!(await fs.pathExists(oldFolderPath))) {
      return res.status(404).json({ error: 'Project folder not found' });
    }

    // Check if new folder already exists
    if (await fs.pathExists(newFolderPath)) {
      return res.status(400).json({ error: 'Ein Ordner mit diesem Namen existiert bereits' });
    }

    // Rename folder
    await fs.rename(oldFolderPath, newFolderPath);
    console.log(`✅ Renamed folder: ${project.folder_name} → ${trimmedName}`);

    // Update database
    db.prepare('UPDATE projects SET folder_name = ?, updated_at = datetime(\'now\') WHERE id = ?').run(trimmedName, id);

    // Get updated project
    const updatedProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);

    // Write JSON metadata to project folder
    await writeProjectMetadata(updatedProject, newFolderPath);

    res.json({
      ...updatedProject,
      tags: updatedProject.tags ? JSON.parse(updatedProject.tags) : []
    });
  } catch (error) {
    console.error('Error renaming project:', error);
    res.status(500).json({ error: 'Failed to rename project' });
  }
};

// Helper: Write project metadata to .project.json in Bilder folder
const writeProjectMetadata = async (project, projectFolderPath) => {
  try {
    const bilderPath = path.join(projectFolderPath, 'Bilder');

    // Create Bilder folder if it doesn't exist
    await fs.ensureDir(bilderPath);

    const metadataPath = path.join(bilderPath, '.project.json');
    const metadata = {
      id: project.id,
      folder_name: project.folder_name,
      color: project.color,
      notes: project.notes,
      tags: project.tags ? JSON.parse(project.tags) : [],
      updated_at: project.updated_at
    };

    await fs.writeJson(metadataPath, metadata, { spaces: 2 });
    console.log(`📝 Wrote metadata: ${metadataPath}`);
  } catch (error) {
    console.error('Error writing project metadata:', error);
    // Don't throw - this is optional
  }
};

// ============================================================
// Pending Mobile Projects (from Google Drive NR_Fuchs_Meta/Projekte/)
// ============================================================

/**
 * Find the NR_Fuchs_Meta/Projekte folder on Drive
 * Uses drive_paths to find the root folder
 */
const findProjekteFolderOnDrive = async () => {
  // Get first drive_path to find root folder
  const drivePath = db.prepare('SELECT path FROM drive_paths LIMIT 1').get();
  if (!drivePath) return null;

  const rootFolderId = extractFolderId(drivePath.path);
  if (!rootFolderId) return null;

  // Look for NR_Fuchs_Meta folder in root's parent
  // The drive_path points to a specific subfolder. We need the root.
  // Check if there's a mobile_pending_tokens entry with root info
  // Or try to find NR_Fuchs_Meta as sibling
  // Actually, let's look in the root folder's parent for NR_Fuchs_Meta

  // Try direct: the root folder itself might contain NR_Fuchs_Meta
  let metaFolder = await findSubfolder(rootFolderId, 'NR_Fuchs_Meta');

  if (!metaFolder) {
    // If root IS the images folder, look for NR_Fuchs_Meta as sibling
    // by using the parent. For now, also try rootFolderId directly.
    // Check all drive_paths for different folder IDs
    const allPaths = db.prepare('SELECT path FROM drive_paths').all();
    for (const dp of allPaths) {
      const fid = extractFolderId(dp.path);
      if (fid) {
        metaFolder = await findSubfolder(fid, 'NR_Fuchs_Meta');
        if (metaFolder) break;
      }
    }
  }

  if (!metaFolder) return null;

  // Find Projekte subfolder
  const projekteFolder = await findSubfolder(metaFolder.id, 'Projekte');
  return projekteFolder;
};

/**
 * Scan Google Drive for new mobile projects
 * GET /api/projects/pending/scan
 */
const scanMobileProjects = async (req, res) => {
  try {
    if (!await isAuthenticated()) {
      return res.status(401).json({ error: 'Nicht mit Google angemeldet' });
    }

    const projekteFolder = await findProjekteFolderOnDrive();
    if (!projekteFolder) {
      return res.json({ scanned: 0, newProjects: 0, message: 'Kein Projekte-Ordner auf Drive gefunden' });
    }

    // List subfolders = mobile projects
    const driveFolders = await listFoldersInFolder(projekteFolder.id);

    // Get existing projects from DB
    const existingProjects = db.prepare('SELECT folder_name FROM projects').all();
    const existingNames = new Set(existingProjects.map(p => p.folder_name.toLowerCase()));

    // Get already-pending projects
    const pendingProjects = db.prepare("SELECT drive_folder_id FROM pending_mobile_projects WHERE status = 'pending'").all();
    const pendingIds = new Set(pendingProjects.map(p => p.drive_folder_id));

    let newCount = 0;

    for (const folder of driveFolders) {
      // Skip if already exists as project or already pending
      if (existingNames.has(folder.name.toLowerCase())) continue;
      if (pendingIds.has(folder.id)) {
        // Update image count
        try {
          const files = await listAllFilesInFolder(folder.id);
          const imageCount = files.filter(f => f.mimeType && f.mimeType.startsWith('image/')).length;
          db.prepare("UPDATE pending_mobile_projects SET image_count = ?, scanned_at = datetime('now') WHERE drive_folder_id = ?")
            .run(imageCount, folder.id);
        } catch {}
        continue;
      }

      // Count images in this folder
      let imageCount = 0;
      try {
        const files = await listAllFilesInFolder(folder.id);
        imageCount = files.filter(f => f.mimeType && f.mimeType.startsWith('image/')).length;
      } catch {}

      // Insert as pending
      db.prepare(
        "INSERT OR IGNORE INTO pending_mobile_projects (drive_folder_id, folder_name, image_count) VALUES (?, ?, ?)"
      ).run(folder.id, folder.name, imageCount);

      newCount++;
    }

    res.json({ scanned: driveFolders.length, newProjects: newCount });
  } catch (error) {
    console.error('Error scanning mobile projects:', error);
    res.status(500).json({ error: 'Scan fehlgeschlagen: ' + error.message });
  }
};

/**
 * Get all pending mobile projects
 * GET /api/projects/pending
 */
const getPendingProjects = (req, res) => {
  try {
    const pending = db.prepare(
      "SELECT * FROM pending_mobile_projects WHERE status = 'pending' ORDER BY created_at DESC"
    ).all();
    res.json(pending);
  } catch (error) {
    console.error('Error getting pending projects:', error);
    res.status(500).json({ error: 'Failed to get pending projects' });
  }
};

/**
 * Get images from a pending project on Drive
 * GET /api/projects/pending/:id/images
 */
const getPendingProjectImages = async (req, res) => {
  try {
    const { id } = req.params;
    const pending = db.prepare('SELECT * FROM pending_mobile_projects WHERE id = ?').get(id);
    if (!pending) return res.status(404).json({ error: 'Pending project not found' });

    const files = await listAllFilesInFolder(pending.drive_folder_id);
    const images = files
      .filter(f => f.mimeType && f.mimeType.startsWith('image/'))
      .map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: parseInt(f.size) || 0,
        thumbnailLink: f.thumbnailLink,
        width: f.imageMediaMetadata?.width || null,
        height: f.imageMediaMetadata?.height || null,
      }));

    res.json(images);
  } catch (error) {
    console.error('Error getting pending project images:', error);
    res.status(500).json({ error: 'Failed to get images' });
  }
};

/**
 * Accept a pending project → create local project + download images
 * POST /api/projects/pending/:id/accept
 */
const acceptPendingProject = async (req, res) => {
  try {
    const { id } = req.params;
    const pending = db.prepare('SELECT * FROM pending_mobile_projects WHERE id = ?').get(id);
    if (!pending) return res.status(404).json({ error: 'Pending project not found' });

    // Get project settings for local path
    const settings = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    if (!settings?.project_path) {
      return res.status(400).json({ error: 'Projekt-Pfad nicht konfiguriert' });
    }

    // Create local project folder + Bilder subfolder
    const projectFolder = path.join(settings.project_path, pending.folder_name);
    const bilderFolder = path.join(projectFolder, 'Bilder');
    await fs.ensureDir(bilderFolder);

    // Create project in DB
    const existing = db.prepare('SELECT id FROM projects WHERE folder_name = ?').get(pending.folder_name);
    let projectId;
    if (existing) {
      projectId = existing.id;
    } else {
      const result = db.prepare('INSERT INTO projects (folder_name, color, notes) VALUES (?, ?, ?)')
        .run(pending.folder_name, '#3b82f6', '');
      projectId = result.lastInsertRowid;
    }

    // Download images from Drive to local Bilder folder and register in DB
    const files = await listAllFilesInFolder(pending.drive_folder_id);
    const images = files.filter(f => f.mimeType && f.mimeType.startsWith('image/'));
    let downloaded = 0;

    for (const img of images) {
      try {
        const localPath = path.join(bilderFolder, img.name);
        if (!await fs.pathExists(localPath)) {
          await downloadDriveFile(img.id, localPath);
        }
        downloaded++;

        // Register image in drive_images DB so it appears in Bilder tab
        const existingImg = db.prepare('SELECT id FROM drive_images WHERE drive_file_id = ?').get(img.id);
        let imageId;
        if (!existingImg) {
          const projectImageUrl = `/api/projects/${projectId}/file/image/${encodeURIComponent(img.name)}`;
          const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
          let fileSize = null;
          try {
            const stats = await fs.stat(localPath);
            fileSize = stats.size;
          } catch (e) { /* ignore */ }

          // Generate thumbnail
          const apThumbsDir = path.join(__dirname, '../../../uploads/thumbnails');
          await fs.ensureDir(apThumbsDir);
          const apBaseNoExt = path.basename(img.name, path.extname(img.name));
          const apThumbName = `proj_${projectId}_${apBaseNoExt.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
          let apThumbUrl = projectImageUrl;
          try {
            await generateThumbnail(localPath, path.join(apThumbsDir, apThumbName));
            apThumbUrl = `/uploads/thumbnails/${apThumbName}`;
          } catch {}

          const imgResult = db.prepare(`
            INSERT INTO drive_images (
              name, original_name, local_path, thumbnail_url, file_url,
              mime_type, drive_file_id, drive_path_id, file_size, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          `).run(
            img.name, img.name, projectImageUrl, apThumbUrl, projectImageUrl,
            img.mimeType || 'image/jpeg', img.id, fileSize, now
          );
          imageId = imgResult.lastInsertRowid;
        } else {
          imageId = existingImg.id;
        }

        // Create project assignment
        if (imageId) {
          db.prepare('INSERT OR IGNORE INTO image_project_assignments (image_id, project_id) VALUES (?, ?)')
            .run(imageId, projectId);
        }
      } catch (e) {
        console.error(`Failed to download ${img.name}:`, e.message);
      }
    }

    // Write metadata
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    await writeProjectMetadata(project, projectFolder);

    // Mark as accepted
    db.prepare("UPDATE pending_mobile_projects SET status = 'accepted' WHERE id = ?").run(id);

    res.json({ success: true, projectId, downloaded, total: images.length });
  } catch (error) {
    console.error('Error accepting pending project:', error);
    res.status(500).json({ error: 'Akzeptieren fehlgeschlagen: ' + error.message });
  }
};

/**
 * Merge a pending project into an existing project
 * POST /api/projects/pending/:id/merge
 * Body: { targetProjectId: number }
 */
const mergePendingProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetProjectId } = req.body;

    if (!targetProjectId) {
      return res.status(400).json({ error: 'Ziel-Projekt fehlt' });
    }

    const pending = db.prepare('SELECT * FROM pending_mobile_projects WHERE id = ?').get(id);
    if (!pending) return res.status(404).json({ error: 'Pending project not found' });

    const targetProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(targetProjectId);
    if (!targetProject) return res.status(404).json({ error: 'Ziel-Projekt nicht gefunden' });

    // Get project settings for local path
    const settings = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    if (!settings?.project_path) {
      return res.status(400).json({ error: 'Projekt-Pfad nicht konfiguriert' });
    }

    // Ensure target Bilder folder exists
    const targetBilder = path.join(settings.project_path, targetProject.folder_name, 'Bilder');
    await fs.ensureDir(targetBilder);

    // Download images from Drive to target project's Bilder folder and register in DB
    const files = await listAllFilesInFolder(pending.drive_folder_id);
    const images = files.filter(f => f.mimeType && f.mimeType.startsWith('image/'));
    let downloaded = 0;

    for (const img of images) {
      try {
        const localPath = path.join(targetBilder, img.name);
        if (!await fs.pathExists(localPath)) {
          await downloadDriveFile(img.id, localPath);
        }
        downloaded++;

        // Register image in drive_images DB so it appears in Bilder tab
        const existingImg = db.prepare('SELECT id FROM drive_images WHERE drive_file_id = ?').get(img.id);
        let imageId;
        if (!existingImg) {
          const projectImageUrl = `/api/projects/${targetProjectId}/file/image/${encodeURIComponent(img.name)}`;
          const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
          let fileSize = null;
          try {
            const stats = await fs.stat(localPath);
            fileSize = stats.size;
          } catch (e) { /* ignore */ }

          // Generate thumbnail
          const mpThumbsDir = path.join(__dirname, '../../../uploads/thumbnails');
          await fs.ensureDir(mpThumbsDir);
          const mpBaseNoExt = path.basename(img.name, path.extname(img.name));
          const mpThumbName = `proj_${targetProjectId}_${mpBaseNoExt.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
          let mpThumbUrl = projectImageUrl;
          try {
            await generateThumbnail(localPath, path.join(mpThumbsDir, mpThumbName));
            mpThumbUrl = `/uploads/thumbnails/${mpThumbName}`;
          } catch {}

          const imgResult = db.prepare(`
            INSERT INTO drive_images (
              name, original_name, local_path, thumbnail_url, file_url,
              mime_type, drive_file_id, drive_path_id, file_size, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          `).run(
            img.name, img.name, projectImageUrl, mpThumbUrl, projectImageUrl,
            img.mimeType || 'image/jpeg', img.id, fileSize, now
          );
          imageId = imgResult.lastInsertRowid;
        } else {
          imageId = existingImg.id;
        }

        // Create project assignment
        if (imageId) {
          db.prepare('INSERT OR IGNORE INTO image_project_assignments (image_id, project_id) VALUES (?, ?)')
            .run(imageId, targetProjectId);
        }
      } catch (e) {
        console.error(`Failed to download ${img.name}:`, e.message);
      }
    }

    // Mark as merged
    db.prepare("UPDATE pending_mobile_projects SET status = 'merged' WHERE id = ?").run(id);

    res.json({
      success: true,
      targetProject: targetProject.folder_name,
      downloaded,
      total: images.length,
    });
  } catch (error) {
    console.error('Error merging pending project:', error);
    res.status(500).json({ error: 'Merge fehlgeschlagen: ' + error.message });
  }
};

/**
 * Delete/reject a pending project
 * DELETE /api/projects/pending/:id
 */
const deletePendingProject = (req, res) => {
  try {
    const { id } = req.params;
    const { deleteFromDrive } = req.query;

    const pending = db.prepare('SELECT * FROM pending_mobile_projects WHERE id = ?').get(id);
    if (!pending) return res.status(404).json({ error: 'Pending project not found' });

    // Mark as deleted (we don't actually delete from Drive by default)
    db.prepare("UPDATE pending_mobile_projects SET status = 'deleted' WHERE id = ?").run(id);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting pending project:', error);
    res.status(500).json({ error: 'Löschen fehlgeschlagen' });
  }
};

// ============================================================
// Google Drive Project Sync (Desktop → Drive)
// ============================================================

/**
 * Find or create the NR_Fuchs_Meta/Projekte folder structure on Drive
 * @returns {{ metaFolder: Object, projekteFolder: Object }} Folder IDs
 */
const ensureProjekteFolderOnDrive = async () => {
  // Get the root Drive folder from drive_paths
  const allPaths = db.prepare('SELECT path FROM drive_paths').all();
  if (allPaths.length === 0) throw new Error('Kein Google Drive Ordner konfiguriert');

  // Find NR_Fuchs_Meta folder - check in each configured drive path
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
    // Create NR_Fuchs_Meta folder
    metaFolder = await createFolderOnDrive('NR_Fuchs_Meta', rootFolderId);
  }

  if (!metaFolder) throw new Error('Konnte NR_Fuchs_Meta Ordner nicht erstellen');

  // Find or create Projekte subfolder
  const projekteFolder = await findOrCreateSubfolder(metaFolder.id, 'Projekte');

  return { metaFolder, projekteFolder };
};

/**
 * Sync all projects to Google Drive
 * POST /api/projects/sync-drive
 *
 * Creates Projekte/ folder structure on Drive.
 * For each local project, creates a subfolder on Drive.
 * When includePhotos is true:
 *   - Images with drive_file_id are MOVED on Drive to the project folder
 *   - Images without drive_file_id (local only) are UPLOADED to Drive
 */
const syncProjectsToDrive = async (req, res) => {
  try {
    if (!await isAuthenticated()) {
      return res.status(401).json({ error: 'Nicht mit Google angemeldet' });
    }

    const { includePhotos = false } = req.body;

    // Ensure folder structure exists
    const { projekteFolder } = await ensureProjekteFolderOnDrive();
    console.log(`📁 Projekte folder on Drive: ${projekteFolder.id}`);

    // Get project base path
    const setting = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();

    // Get all local projects
    const projects = db.prepare('SELECT * FROM projects').all();

    // Get existing folders on Drive for deduplication
    const existingDriveFolders = await listFoldersInFolder(projekteFolder.id);
    const driveFolderMap = new Map(existingDriveFolders.map(f => [f.name.toLowerCase(), f]));

    let createdFolders = 0;
    let movedImages = 0;
    let uploadedImages = 0;
    let skippedImages = 0;
    const errors = [];

    for (const project of projects) {
      try {
        // Find or create project folder on Drive
        let projectDriveFolder = driveFolderMap.get(project.folder_name.toLowerCase());
        if (!projectDriveFolder) {
          projectDriveFolder = await createFolderOnDrive(project.folder_name, projekteFolder.id);
          createdFolders++;
          console.log(`📁 Created Drive folder: ${project.folder_name}`);
        }

        // Sync images if requested
        if (includePhotos && setting?.project_path) {
          // Get files already in the project folder on Drive (to avoid duplicates)
          const existingDriveFiles = await listAllFilesInFolder(projectDriveFolder.id);
          const existingDriveFileNames = new Set(existingDriveFiles.map(f => f.name.toLowerCase()));

          // Scan the local Bilder/ folder for this project
          const bilderPath = path.join(setting.project_path, project.folder_name, 'Bilder');
          if (await fs.pathExists(bilderPath)) {
            const localFiles = await fs.readdir(bilderPath);
            const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.heic', '.heif'];

            for (const fileName of localFiles) {
              const ext = path.extname(fileName).toLowerCase();
              if (!imageExtensions.includes(ext)) continue;

              try {
                // Skip if already on Drive in this project folder
                if (existingDriveFileNames.has(fileName.toLowerCase())) {
                  skippedImages++;
                  continue;
                }

                // Check if this image has a drive_file_id in the DB
                // (meaning it exists somewhere else on Drive and should be MOVED)
                const dbImage = db.prepare(`
                  SELECT di.drive_file_id FROM drive_images di
                  JOIN image_project_assignments ipa ON di.id = ipa.image_id
                  WHERE ipa.project_id = ?
                    AND (di.name = ? OR di.original_name = ?)
                    AND di.drive_file_id IS NOT NULL
                  LIMIT 1
                `).get(project.id, fileName, fileName);

                if (dbImage && dbImage.drive_file_id) {
                  // Image exists on Drive → MOVE it to the project folder
                  try {
                    const fileMeta = await getFileMetadata(dbImage.drive_file_id);
                    if (fileMeta && fileMeta.parents && fileMeta.parents.length > 0) {
                      if (fileMeta.parents.includes(projectDriveFolder.id)) {
                        skippedImages++;
                        continue;
                      }
                      await moveFileOnDrive(dbImage.drive_file_id, projectDriveFolder.id, fileMeta.parents[0]);
                      movedImages++;
                      console.log(`📦 Moved "${fileName}" → ${project.folder_name}/`);
                    }
                  } catch (moveErr) {
                    // If move fails (e.g. file deleted from Drive), upload instead
                    console.log(`⚠️ Move failed for "${fileName}", uploading instead...`);
                    const localFilePath = path.join(bilderPath, fileName);
                    await uploadFileToDrive(localFilePath, projectDriveFolder.id, fileName);
                    uploadedImages++;
                    console.log(`⬆️ Uploaded "${fileName}" → ${project.folder_name}/`);
                  }
                } else {
                  // Image is local only → UPLOAD to Drive
                  const localFilePath = path.join(bilderPath, fileName);
                  await uploadFileToDrive(localFilePath, projectDriveFolder.id, fileName);
                  uploadedImages++;
                  console.log(`⬆️ Uploaded "${fileName}" → ${project.folder_name}/`);
                }
              } catch (imgError) {
                console.error(`Error syncing image ${fileName}:`, imgError.message);
                errors.push(`${project.folder_name}/${fileName}: ${imgError.message}`);
              }
            }
          }
        }
      } catch (projError) {
        console.error(`Error syncing project ${project.folder_name}:`, projError.message);
        errors.push(`${project.folder_name}: ${projError.message}`);
      }
    }

    res.json({
      success: true,
      totalProjects: projects.length,
      createdFolders,
      movedImages,
      uploadedImages,
      skippedImages,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error syncing projects to Drive:', error);
    res.status(500).json({ error: 'Sync fehlgeschlagen: ' + error.message });
  }
};

module.exports = {
  getProjectSettings,
  setProjectPath,
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  syncProjects,
  getProjectFiles,
  serveProjectFile,
  renameProject,
  // Pending mobile projects
  scanMobileProjects,
  getPendingProjects,
  getPendingProjectImages,
  acceptPendingProject,
  mergePendingProject,
  deletePendingProject,
  // Google Drive sync
  syncProjectsToDrive,
};
