const db = require('../config/database');
const fs = require('fs-extra');
const path = require('path');

// Get all settings
const getSettings = (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM settings WHERE id = 1');
    let result = stmt.get();

    if (!result) {
      // Create default settings if they don't exist
      const insertStmt = db.prepare(
        'INSERT INTO settings (logo_path, theme, sidebar_collapsed) VALUES (?, ?, ?)'
      );
      insertStmt.run(null, 'dark', 0);

      const selectStmt = db.prepare('SELECT * FROM settings WHERE id = 1');
      result = selectStmt.get();
    }

    // Convert SQLite boolean (0/1) to JavaScript boolean
    result.sidebar_collapsed = !!result.sidebar_collapsed;

    res.json(result);
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
};

// Update settings
const updateSettings = (req, res) => {
  try {
    const { theme, sidebar_collapsed } = req.body;

    const updates = [];
    const values = [];

    if (theme !== undefined) {
      updates.push('theme = ?');
      values.push(theme);
    }

    if (sidebar_collapsed !== undefined) {
      updates.push('sidebar_collapsed = ?');
      values.push(sidebar_collapsed ? 1 : 0);
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(1); // WHERE id = 1

      const sql = `UPDATE settings SET ${updates.join(', ')} WHERE id = ?`;
      const stmt = db.prepare(sql);
      stmt.run(...values);
    }

    const result = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    result.sidebar_collapsed = !!result.sidebar_collapsed;

    res.json(result);
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
    const oldSettings = db.prepare('SELECT logo_path FROM settings WHERE id = 1').get();

    if (oldSettings && oldSettings.logo_path) {
      const oldLogoPath = path.join(__dirname, '../../../', oldSettings.logo_path);
      await fs.remove(oldLogoPath).catch(err => console.error('Error deleting old logo:', err));
    }

    // Update database with new logo
    const stmt = db.prepare("UPDATE settings SET logo_path = ?, updated_at = datetime('now') WHERE id = 1");
    stmt.run(logoPath);

    const result = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    result.sidebar_collapsed = !!result.sidebar_collapsed;

    res.json(result);
  } catch (error) {
    console.error('Error uploading logo:', error);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
};

// Delete logo
const deleteLogo = async (req, res) => {
  try {
    const settings = db.prepare('SELECT logo_path FROM settings WHERE id = 1').get();

    if (settings && settings.logo_path) {
      const logoPath = path.join(__dirname, '../../../', settings.logo_path);
      await fs.remove(logoPath).catch(err => console.error('Error deleting logo:', err));
    }

    const stmt = db.prepare("UPDATE settings SET logo_path = NULL, updated_at = datetime('now') WHERE id = 1");
    stmt.run();

    const result = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    result.sidebar_collapsed = !!result.sidebar_collapsed;

    res.json(result);
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
