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

    // Convert SQLite booleans (0/1) to JavaScript booleans
    result.sidebar_collapsed = !!result.sidebar_collapsed;
    if (result.images_show_only_unassigned !== undefined) {
      result.images_show_only_unassigned = !!result.images_show_only_unassigned;
    }
    if (result.images_show_all !== undefined) {
      result.images_show_all = !!result.images_show_all;
    }
    if (result.images_show_only_with_projects !== undefined) {
      result.images_show_only_with_projects = !!result.images_show_only_with_projects;
    }

    res.json(result);
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
};

// Update settings
const updateSettings = (req, res) => {
  try {
    const {
      theme,
      sidebar_collapsed,
      company_name,
      primary_color,
      images_sort_by,
      images_sort_order,
      images_view_mode,
      images_show_only_unassigned,
      images_show_all,
      images_show_only_with_projects,
      mobile_server_url
    } = req.body;

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

    if (company_name !== undefined) {
      updates.push('company_name = ?');
      values.push(company_name);
    }

    if (primary_color !== undefined) {
      updates.push('primary_color = ?');
      values.push(primary_color);
    }

    // Images filter/sort preferences
    if (images_sort_by !== undefined) {
      updates.push('images_sort_by = ?');
      values.push(images_sort_by);
    }

    if (images_sort_order !== undefined) {
      updates.push('images_sort_order = ?');
      values.push(images_sort_order);
    }

    if (images_view_mode !== undefined) {
      updates.push('images_view_mode = ?');
      values.push(images_view_mode);
    }

    if (images_show_only_unassigned !== undefined) {
      updates.push('images_show_only_unassigned = ?');
      values.push(images_show_only_unassigned ? 1 : 0);
    }

    if (images_show_all !== undefined) {
      updates.push('images_show_all = ?');
      values.push(images_show_all ? 1 : 0);
    }

    if (images_show_only_with_projects !== undefined) {
      updates.push('images_show_only_with_projects = ?');
      values.push(images_show_only_with_projects ? 1 : 0);
    }

    if (mobile_server_url !== undefined) {
      updates.push('mobile_server_url = ?');
      values.push(mobile_server_url);
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(1); // WHERE id = 1

      const sql = `UPDATE settings SET ${updates.join(', ')} WHERE id = ?`;
      const stmt = db.prepare(sql);
      stmt.run(...values);
    }

    const result = db.prepare('SELECT * FROM settings WHERE id = 1').get();

    // Convert SQLite booleans to JavaScript booleans
    result.sidebar_collapsed = !!result.sidebar_collapsed;
    if (result.images_show_only_unassigned !== undefined && result.images_show_only_unassigned !== null) {
      result.images_show_only_unassigned = !!result.images_show_only_unassigned;
    }
    if (result.images_show_all !== undefined && result.images_show_all !== null) {
      result.images_show_all = !!result.images_show_all;
    }
    if (result.images_show_only_with_projects !== undefined && result.images_show_only_with_projects !== null) {
      result.images_show_only_with_projects = !!result.images_show_only_with_projects;
    }

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

    // Convert SQLite booleans to JavaScript booleans
    result.sidebar_collapsed = !!result.sidebar_collapsed;
    if (result.images_show_only_unassigned !== undefined && result.images_show_only_unassigned !== null) {
      result.images_show_only_unassigned = !!result.images_show_only_unassigned;
    }
    if (result.images_show_all !== undefined && result.images_show_all !== null) {
      result.images_show_all = !!result.images_show_all;
    }
    if (result.images_show_only_with_projects !== undefined && result.images_show_only_with_projects !== null) {
      result.images_show_only_with_projects = !!result.images_show_only_with_projects;
    }

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

    // Convert SQLite booleans to JavaScript booleans
    result.sidebar_collapsed = !!result.sidebar_collapsed;
    if (result.images_show_only_unassigned !== undefined && result.images_show_only_unassigned !== null) {
      result.images_show_only_unassigned = !!result.images_show_only_unassigned;
    }
    if (result.images_show_all !== undefined && result.images_show_all !== null) {
      result.images_show_all = !!result.images_show_all;
    }
    if (result.images_show_only_with_projects !== undefined && result.images_show_only_with_projects !== null) {
      result.images_show_only_with_projects = !!result.images_show_only_with_projects;
    }

    res.json(result);
  } catch (error) {
    console.error('Error deleting logo:', error);
    res.status(500).json({ error: 'Failed to delete logo' });
  }
};

// Upload favicon
const uploadFavicon = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const faviconPath = `/uploads/logos/${req.file.filename}`;

    // Delete old favicon if exists
    const oldSettings = db.prepare('SELECT favicon_path FROM settings WHERE id = 1').get();
    if (oldSettings && oldSettings.favicon_path) {
      const oldFaviconPath = path.join(__dirname, '../../../', oldSettings.favicon_path);
      await fs.remove(oldFaviconPath).catch(err => console.error('Error deleting old favicon:', err));
    }

    // Update database with new favicon
    const stmt = db.prepare("UPDATE settings SET favicon_path = ?, updated_at = datetime('now') WHERE id = 1");
    stmt.run(faviconPath);

    const result = db.prepare('SELECT * FROM settings WHERE id = 1').get();

    // Convert SQLite booleans to JavaScript booleans
    result.sidebar_collapsed = !!result.sidebar_collapsed;
    if (result.images_show_only_unassigned !== undefined && result.images_show_only_unassigned !== null) {
      result.images_show_only_unassigned = !!result.images_show_only_unassigned;
    }
    if (result.images_show_all !== undefined && result.images_show_all !== null) {
      result.images_show_all = !!result.images_show_all;
    }
    if (result.images_show_only_with_projects !== undefined && result.images_show_only_with_projects !== null) {
      result.images_show_only_with_projects = !!result.images_show_only_with_projects;
    }

    res.json(result);
  } catch (error) {
    console.error('Error uploading favicon:', error);
    res.status(500).json({ error: 'Failed to upload favicon' });
  }
};

// Delete favicon
const deleteFavicon = async (req, res) => {
  try {
    const settings = db.prepare('SELECT favicon_path FROM settings WHERE id = 1').get();

    if (settings && settings.favicon_path) {
      const faviconPath = path.join(__dirname, '../../../', settings.favicon_path);
      await fs.remove(faviconPath).catch(err => console.error('Error deleting favicon:', err));
    }

    const stmt = db.prepare("UPDATE settings SET favicon_path = NULL, updated_at = datetime('now') WHERE id = 1");
    stmt.run();

    const result = db.prepare('SELECT * FROM settings WHERE id = 1').get();

    // Convert SQLite booleans to JavaScript booleans
    result.sidebar_collapsed = !!result.sidebar_collapsed;
    if (result.images_show_only_unassigned !== undefined && result.images_show_only_unassigned !== null) {
      result.images_show_only_unassigned = !!result.images_show_only_unassigned;
    }
    if (result.images_show_all !== undefined && result.images_show_all !== null) {
      result.images_show_all = !!result.images_show_all;
    }
    if (result.images_show_only_with_projects !== undefined && result.images_show_only_with_projects !== null) {
      result.images_show_only_with_projects = !!result.images_show_only_with_projects;
    }

    res.json(result);
  } catch (error) {
    console.error('Error deleting favicon:', error);
    res.status(500).json({ error: 'Failed to delete favicon' });
  }
};

module.exports = {
  getSettings,
  updateSettings,
  uploadLogo,
  deleteLogo,
  uploadFavicon,
  deleteFavicon
};
