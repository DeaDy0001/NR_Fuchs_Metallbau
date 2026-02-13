const pool = require('../config/database');
const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');

// Get drive settings (all configured paths)
const getDriveSettings = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM drive_paths ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting drive settings:', error);
    res.status(500).json({ error: 'Failed to get drive settings' });
  }
};

// Add a new drive path
const addDrivePath = async (req, res) => {
  try {
    const { name, path: drivePath, type } = req.body;

    if (!name || !drivePath) {
      return res.status(400).json({ error: 'Name and path are required' });
    }

    const result = await pool.query(
      'INSERT INTO drive_paths (name, path, type) VALUES ($1, $2, $3) RETURNING *',
      [name, drivePath, type || 'google_drive']
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding drive path:', error);
    res.status(500).json({ error: 'Failed to add drive path' });
  }
};

// Remove a drive path
const removeDrivePath = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM drive_paths WHERE id = $1', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing drive path:', error);
    res.status(500).json({ error: 'Failed to remove drive path' });
  }
};

// Update a drive path
const updateDrivePath = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, path: drivePath } = req.body;

    const result = await pool.query(
      'UPDATE drive_paths SET name = COALESCE($1, name), path = COALESCE($2, path), updated_at = NOW() WHERE id = $3 RETURNING *',
      [name, drivePath, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Drive path not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating drive path:', error);
    res.status(500).json({ error: 'Failed to update drive path' });
  }
};

// Get all images from configured drive paths
const getImages = async (req, res) => {
  try {
    const { limit = 100, offset = 0, search = '' } = req.query;

    let query = 'SELECT * FROM drive_images WHERE 1=1';
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR original_name ILIKE $${params.length})`;
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    const countQuery = search
      ? 'SELECT COUNT(*) FROM drive_images WHERE name ILIKE $1 OR original_name ILIKE $1'
      : 'SELECT COUNT(*) FROM drive_images';
    const countParams = search ? [`%${search}%`] : [];
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      images: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error getting images:', error);
    res.status(500).json({ error: 'Failed to get images' });
  }
};

// Get single image by ID
const getImageById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT * FROM drive_images WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting image:', error);
    res.status(500).json({ error: 'Failed to get image' });
  }
};

// Rename an image
const renameImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await pool.query(
      'UPDATE drive_images SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [name, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error renaming image:', error);
    res.status(500).json({ error: 'Failed to rename image' });
  }
};

// Refresh images from Google Drive (placeholder - will be implemented with actual Google Drive API)
const refreshImages = async (req, res) => {
  try {
    // Get all configured drive paths
    const pathsResult = await pool.query('SELECT * FROM drive_paths WHERE type = $1', ['google_drive']);

    if (pathsResult.rows.length === 0) {
      return res.json({ message: 'No drive paths configured', added: 0 });
    }

    let addedCount = 0;

    for (const drivePath of pathsResult.rows) {
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
