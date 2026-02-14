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

// Set project path
const setProjectPath = async (req, res) => {
  try {
    const { path: projectPath } = req.body;

    if (!projectPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    // Check if path exists (keep async for fs operations)
    const pathExists = await fs.pathExists(projectPath);
    if (!pathExists) {
      return res.status(400).json({ error: 'Path does not exist' });
    }

    const updateStmt = db.prepare("UPDATE project_settings SET project_path = ?, updated_at = datetime('now') WHERE id = 1");
    const updateResult = updateStmt.run(projectPath);

    if (updateResult.changes === 0) {
      // Insert if doesn't exist
      const insertStmt = db.prepare('INSERT INTO project_settings (project_path) VALUES (?)');
      const insertResult = insertStmt.run(projectPath);
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
    const { limit = 100, offset = 0, search = '' } = req.query;

    let query = 'SELECT * FROM projects WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (folder_name LIKE ? OR notes LIKE ?)';
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
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
        image_count: imageCount.count,
        folder_created_at: folderCreatedAt
      };
    }));

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM projects';
    const countParams = [];

    if (search) {
      countQuery += ' WHERE folder_name LIKE ? OR notes LIKE ?';
      const searchParam = `%${search}%`;
      countParams.push(searchParam, searchParam);
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

    res.json(result);
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
const updateProject = (req, res) => {
  try {
    const { id } = req.params;
    const { color, notes } = req.body;

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
    res.json(updatedProject);
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

    // Get existing projects
    const existingProjects = db.prepare('SELECT folder_name FROM projects').all();
    const existingFolderNames = new Set(existingProjects.map(p => p.folder_name));

    let addedCount = 0;

    // Add new projects
    const insertStmt = db.prepare('INSERT INTO projects (folder_name, color, notes) VALUES (?, ?, ?)');
    
    for (const folderName of folders) {
      if (!existingFolderNames.has(folderName)) {
        insertStmt.run(folderName, '#3b82f6', '');
        addedCount++;
      }
    }

    res.json({
      message: 'Projects synced successfully',
      added: addedCount,
      total: folders.length
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
      const dbImageMap = new Map();
      dbImages.forEach(img => {
        dbImageMap.set(img.name, img);
      });

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
      const registerImageToDatabase = async (fileName, filePath, projectId) => {
        try {
          console.log(`📝 Auto-registering image: ${fileName}`);

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

          // Insert into database
          const result = db.prepare(`
            INSERT INTO drive_images (
              name,
              original_name,
              file_size,
              width,
              height,
              photo_taken_at,
              created_at,
              drive_id,
              mime_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            fileName,
            fileName,
            metadata.file_size || null,
            metadata.width || null,
            metadata.height || null,
            metadata.photo_taken_at || null,
            now,
            'local_project_import', // Special drive_id for auto-registered images
            `image/${fileName.split('.').pop().toLowerCase()}`
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
              type: 'image'
            };
          } else {
            // AUTO-REGISTER: Image not in DB yet, register it automatically
            console.log(`⚠️  Image "${file}" not in DB - auto-registering...`);

            const imageId = await registerImageToDatabase(file, filePath, id);
            const metadata = await getImageMetadata(filePath);

            if (imageId) {
              // Successfully registered - fetch the full DB entry
              const newDbImage = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(imageId);

              return {
                ...newDbImage,
                local_path: projectImageUrl,
                thumbnail_url: projectImageUrl,
                url: projectImageUrl,
                type: 'image'
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
  serveProjectFile
};
