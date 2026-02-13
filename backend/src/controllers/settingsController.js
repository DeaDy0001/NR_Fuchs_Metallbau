const pool = require('../config/database');
const fs = require('fs-extra');
const path = require('path');

// Get all settings
const getSettings = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings WHERE id = 1');

    if (result.rows.length === 0) {
      // Create default settings if they don't exist
      const defaultSettings = {
        logo_path: null,
        theme: 'dark',
        sidebar_collapsed: false
      };

      const insertResult = await pool.query(
        'INSERT INTO settings (logo_path, theme, sidebar_collapsed) VALUES ($1, $2, $3) RETURNING *',
        [defaultSettings.logo_path, defaultSettings.theme, defaultSettings.sidebar_collapsed]
      );

      return res.json(insertResult.rows[0]);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
};

// Update settings
const updateSettings = async (req, res) => {
  try {
    const { theme, sidebar_collapsed } = req.body;

    const result = await pool.query(
      'UPDATE settings SET theme = COALESCE($1, theme), sidebar_collapsed = COALESCE($2, sidebar_collapsed), updated_at = NOW() WHERE id = 1 RETURNING *',
      [theme, sidebar_collapsed]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};

// Upload logo
const uploadLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const logoPath = `/uploads/logos/${req.file.filename}`;

    // Get old logo to delete it
    const oldSettings = await pool.query('SELECT logo_path FROM settings WHERE id = 1');

    if (oldSettings.rows.length > 0 && oldSettings.rows[0].logo_path) {
      const oldLogoPath = path.join(__dirname, '../../../', oldSettings.rows[0].logo_path);
      await fs.remove(oldLogoPath).catch(err => console.error('Error deleting old logo:', err));
    }

    // Update database with new logo
    const result = await pool.query(
      'UPDATE settings SET logo_path = $1, updated_at = NOW() WHERE id = 1 RETURNING *',
      [logoPath]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error uploading logo:', error);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
};

// Delete logo
const deleteLogo = async (req, res) => {
  try {
    const settings = await pool.query('SELECT logo_path FROM settings WHERE id = 1');

    if (settings.rows.length > 0 && settings.rows[0].logo_path) {
      const logoPath = path.join(__dirname, '../../../', settings.rows[0].logo_path);
      await fs.remove(logoPath).catch(err => console.error('Error deleting logo:', err));
    }

    const result = await pool.query(
      'UPDATE settings SET logo_path = NULL, updated_at = NOW() WHERE id = 1 RETURNING *'
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error deleting logo:', error);
    res.status(500).json({ error: 'Failed to delete logo' });
  }
};

module.exports = {
  getSettings,
  updateSettings,
  uploadLogo,
  deleteLogo
};
