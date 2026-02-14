const db = require('../config/database');

/**
 * Color Presets Controller
 * Manages saved color presets for the image editor
 */

// Get all color presets
const getColorPresets = (req, res) => {
  try {
    const presets = db.prepare('SELECT * FROM color_presets ORDER BY position').all();
    res.json(presets);
  } catch (error) {
    console.error('Error fetching color presets:', error);
    res.status(500).json({ error: 'Failed to fetch color presets' });
  }
};

// Save/update color preset
const saveColorPreset = (req, res) => {
  try {
    const { color, position } = req.body;

    if (!color || position === undefined) {
      return res.status(400).json({ error: 'Color and position are required' });
    }

    // Check if preset exists at this position
    const existing = db.prepare('SELECT id FROM color_presets WHERE position = ?').get(position);

    if (existing) {
      // Update existing preset
      db.prepare('UPDATE color_presets SET color = ? WHERE position = ?').run(color, position);
      res.json({ success: true, message: 'Color preset updated' });
    } else {
      // Insert new preset
      const result = db.prepare('INSERT INTO color_presets (color, position) VALUES (?, ?)').run(color, position);
      res.json({ success: true, id: result.lastInsertRowid });
    }
  } catch (error) {
    console.error('Error saving color preset:', error);
    res.status(500).json({ error: 'Failed to save color preset' });
  }
};

// Delete color preset
const deleteColorPreset = (req, res) => {
  try {
    const { position } = req.params;
    db.prepare('DELETE FROM color_presets WHERE position = ?').run(position);
    res.json({ success: true, message: 'Color preset deleted' });
  } catch (error) {
    console.error('Error deleting color preset:', error);
    res.status(500).json({ error: 'Failed to delete color preset' });
  }
};

module.exports = {
  getColorPresets,
  saveColorPreset,
  deleteColorPreset
};
