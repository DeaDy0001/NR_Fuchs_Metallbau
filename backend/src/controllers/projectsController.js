const pool = require('../config/database');
const fs = require('fs-extra');
const path = require('path');

// Get project settings (configured path)
const getProjectSettings = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM project_settings WHERE id = 1');

    if (result.rows.length === 0) {
      // Create default settings
      const defaultSettings = await pool.query(
        'INSERT INTO project_settings (project_path) VALUES ($1) RETURNING *',
        [null]
      );
      return res.json(defaultSettings.rows[0]);
    }

    res.json(result.rows[0]);
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

    // Check if path exists
    const pathExists = await fs.pathExists(projectPath);
    if (!pathExists) {
      return res.status(400).json({ error: 'Path does not exist' });
    }

    const result = await pool.query(
      'UPDATE project_settings SET project_path = $1, updated_at = NOW() WHERE id = 1 RETURNING *',
      [projectPath]
    );

    if (result.rows.length === 0) {
      // Insert if doesn't exist
      const insertResult = await pool.query(
        'INSERT INTO project_settings (project_path) VALUES ($1) RETURNING *',
        [projectPath]
      );
      return res.json(insertResult.rows[0]);
    }

    res.json(result.rows[0]);
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
      params.push(`%${search}%`);
      query += ` AND (folder_name ILIKE $${params.length} OR notes ILIKE $${params.length})`;
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    const countQuery = search
      ? 'SELECT COUNT(*) FROM projects WHERE folder_name ILIKE $1 OR notes ILIKE $1'
      : 'SELECT COUNT(*) FROM projects';
    const countParams = search ? [`%${search}%`] : [];
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      projects: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error getting projects:', error);
    res.status(500).json({ error: 'Failed to get projects' });
  }
};

// Get single project by ID
const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting project:', error);
    res.status(500).json({ error: 'Failed to get project' });
  }
};

// Create a new project
const createProject = async (req, res) => {
  try {
    const { folder_name, color, notes } = req.body;

    if (!folder_name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const result = await pool.query(
      'INSERT INTO projects (folder_name, color, notes) VALUES ($1, $2, $3) RETURNING *',
      [folder_name, color || '#3b82f6', notes || '']
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
};

// Update a project
const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { color, notes } = req.body;

    const result = await pool.query(
      'UPDATE projects SET color = COALESCE($1, color), notes = COALESCE($2, notes), updated_at = NOW() WHERE id = $3 RETURNING *',
      [color, notes, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
};

// Delete a project
const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
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
    const settingsResult = await pool.query('SELECT project_path FROM project_settings WHERE id = 1');

    if (settingsResult.rows.length === 0 || !settingsResult.rows[0].project_path) {
      return res.status(400).json({ error: 'Project path not configured' });
    }

    const projectPath = settingsResult.rows[0].project_path;

    // Check if path exists
    const pathExists = await fs.pathExists(projectPath);
    if (!pathExists) {
      return res.status(400).json({ error: 'Configured path does not exist' });
    }

    // Read directories
    const items = await fs.readdir(projectPath, { withFileTypes: true });
    const folders = items.filter(item => item.isDirectory()).map(item => item.name);

    // Get existing projects
    const existingProjects = await pool.query('SELECT folder_name FROM projects');
    const existingFolderNames = new Set(existingProjects.rows.map(p => p.folder_name));

    let addedCount = 0;

    // Add new projects
    for (const folderName of folders) {
      if (!existingFolderNames.has(folderName)) {
        await pool.query(
          'INSERT INTO projects (folder_name, color, notes) VALUES ($1, $2, $3)',
          [folderName, '#3b82f6', '']
        );
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

module.exports = {
  getProjectSettings,
  setProjectPath,
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  syncProjects
};
