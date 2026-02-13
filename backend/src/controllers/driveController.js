const db = require('../config/database');
const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');

// Get drive settings (all configured paths)
const getDriveSettings = (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM drive_paths ORDER BY created_at DESC');
    const result = stmt.all();
    res.json(result);
  } catch (error) {
    console.error('Error getting drive settings:', error);
    res.status(500).json({ error: 'Failed to get drive settings' });
  }
};

// Add a new drive path
const addDrivePath = (req, res) => {
  try {
    const { name, path: drivePath, type } = req.body;

    if (!name || !drivePath) {
      return res.status(400).json({ error: 'Name and path are required' });
    }

    const stmt = db.prepare(
      'INSERT INTO drive_paths (name, path, type) VALUES (?, ?, ?)'
    );
    const result = stmt.run(name, drivePath, type || 'google_drive');

    const newPath = db.prepare('SELECT * FROM drive_paths WHERE id = ?').get(result.lastInsertRowid);
    res.json(newPath);
  } catch (error) {
    console.error('Error adding drive path:', error);
    res.status(500).json({ error: 'Failed to add drive path' });
  }
};

// Remove a drive path
const removeDrivePath = (req, res) => {
  try {
    const { id } = req.params;

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
    const { name, path: drivePath } = req.body;

    const updates = [];
    const values = [];

    if (name) {
      updates.push('name = ?');
      values.push(name);
    }

    if (drivePath) {
      updates.push('path = ?');
      values.push(drivePath);
    }

    if (updates.length > 0) {
      updates.push('updated_at = datetime("now")');
      values.push(id);

      const sql = `UPDATE drive_paths SET ${updates.join(', ')} WHERE id = ?`;
      const stmt = db.prepare(sql);
      stmt.run(...values);
    }

    const result = db.prepare('SELECT * FROM drive_paths WHERE id = ?').get(id);

    if (!result) {
      return res.status(404).json({ error: 'Drive path not found' });
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
    const { limit = 100, offset = 0, search = '' } = req.query;

    let query = 'SELECT * FROM drive_images WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR original_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const stmt = db.prepare(query);
    const images = stmt.all(...params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM drive_images';
    const countParams = [];

    if (search) {
      countQuery += ' WHERE name LIKE ? OR original_name LIKE ?';
      countParams.push(`%${search}%`, `%${search}%`);
    }

    const countStmt = db.prepare(countQuery);
    const countResult = countStmt.get(...countParams);

    res.json({
      images,
      total: countResult.count,
      limit: parseInt(limit),
      offset: parseInt(offset)
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

    res.json(result);
  } catch (error) {
    console.error('Error getting image:', error);
    res.status(500).json({ error: 'Failed to get image' });
  }
};

// Rename an image
const renameImage = (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const stmt = db.prepare('UPDATE drive_images SET name = ?, updated_at = datetime("now") WHERE id = ?');
    stmt.run(name, id);

    const result = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(id);

    if (!result) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.json(result);
  } catch (error) {
    console.error('Error renaming image:', error);
    res.status(500).json({ error: 'Failed to rename image' });
  }
};

// Refresh images from Google Drive (placeholder - will be implemented with actual Google Drive API)
const refreshImages = (req, res) => {
  try {
    // Get all configured drive paths
    const stmt = db.prepare('SELECT * FROM drive_paths WHERE type = ?');
    const paths = stmt.all('google_drive');

    if (paths.length === 0) {
      return res.json({ message: 'No drive paths configured', added: 0 });
    }

    let addedCount = 0;

    for (const drivePath of paths) {
      // TODO: Implement actual Google Drive API integration
      // For now, this is a placeholder
      console.log(`Would refresh images from: ${drivePath.path}`);
    }

    res.json({
      message: 'Images refreshed successfully',
      added: addedCount
    });
  } catch (error) {
    console.error('Error refreshing images:', error);
    res.status(500).json({ error: 'Failed to refresh images' });
  }
};

// Helper function to create thumbnail
const createThumbnail = async (imageBuffer, filename) => {
  try {
    const thumbnailPath = path.join(__dirname, '../../../uploads/thumbnails', filename);

    await sharp(imageBuffer)
      .resize(300, 300, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 80 })
      .toFile(thumbnailPath);

    return `/uploads/thumbnails/${filename}`;
  } catch (error) {
    console.error('Error creating thumbnail:', error);
    throw error;
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
  refreshImages
};
