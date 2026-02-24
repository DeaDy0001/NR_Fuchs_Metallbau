const db = require('../config/database');
const fs = require('fs-extra');
const path = require('path');

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
const createProject = (req, res) => {
  try {
    const { folder_name, color, notes } = req.body;

    if (!folder_name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const stmt = db.prepare('INSERT INTO projects (folder_name, color, notes) VALUES (?, ?, ?)');
    const result = stmt.run(folder_name, color || '#3b82f6', notes || '');
    
    const newProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
    res.json(newProject);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
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
const deleteProject = (req, res) => {
  try {
    const { id } = req.params;

    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
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
            projectImageUrl,  // thumbnail_url
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
            return {
              ...dbImage,
              local_path: projectImageUrl,
              thumbnail_url: projectImageUrl,
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

              return {
                ...newDbImage,
                local_path: projectImageUrl,
                thumbnail_url: projectImageUrl,
                url: projectImageUrl,
                type: 'image',
                projects: projectsStmt.all(imageId)  // Add projects list
              };
            } else {
              // Fallback if registration failed
              return {
                name: file,
                original_name: file,
                path: filePath,
                url: projectImageUrl,
                local_path: projectImageUrl,
                thumbnail_url: projectImageUrl,
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
  renameProject
};
