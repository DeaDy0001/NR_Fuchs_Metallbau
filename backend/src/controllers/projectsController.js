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
const getProjects = (req, res) => {
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

    const result = db.prepare(query).all(...params);

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
      projects: result,
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
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'project_base_path'").get();
    if (!setting || !setting.value) {
      return res.status(400).json({ error: 'Project base path not configured' });
    }

    const projectBasePath = setting.value;
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
      images = imageFiles
        .filter(file => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file))
        .map(file => ({
          name: file,
          path: path.join(imagesFolderPath, file),
          url: `/uploads/projects/${project.folder_name}/Bilder/${file}`,
          type: 'image'
        }));
    }

    // Scan for PDFs in main folder
    const files = await fs.readdir(projectFolderPath);
    const pdfs = files
      .filter(file => /\.pdf$/i.test(file))
      .map(file => ({
        name: file,
        path: path.join(projectFolderPath, file),
        url: `/uploads/projects/${project.folder_name}/${file}`,
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

module.exports = {
  getProjectSettings,
  setProjectPath,
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  syncProjects,
  getProjectFiles
};
