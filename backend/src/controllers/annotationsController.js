const db = require('../config/database');
const fs = require('fs-extra');
const path = require('path');

// Get annotations for an image
const getAnnotations = (req, res) => {
  try {
    const { imageId } = req.params;

    const stmt = db.prepare('SELECT annotations FROM image_annotations WHERE image_id = ? ORDER BY updated_at DESC LIMIT 1');
    const result = stmt.get(imageId);

    if (!result) {
      return res.json({ annotations: null });
    }

    res.json({
      annotations: JSON.parse(result.annotations)
    });
  } catch (error) {
    console.error('Error getting annotations:', error);
    res.status(500).json({ error: 'Failed to get annotations' });
  }
};

// Save annotations for an image
const saveAnnotations = (req, res) => {
  try {
    const { imageId } = req.params;
    const { annotations } = req.body;

    if (!annotations) {
      return res.status(400).json({ error: 'No annotations provided' });
    }

    // Check if annotations already exist
    const existing = db.prepare('SELECT id FROM image_annotations WHERE image_id = ?').get(imageId);

    if (existing) {
      // Update existing
      const stmt = db.prepare("UPDATE image_annotations SET annotations = ?, updated_at = datetime('now') WHERE image_id = ?");
      stmt.run(JSON.stringify(annotations), imageId);
    } else {
      // Insert new
      const stmt = db.prepare('INSERT INTO image_annotations (image_id, annotations) VALUES (?, ?)');
      stmt.run(imageId, JSON.stringify(annotations));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving annotations:', error);
    res.status(500).json({ error: 'Failed to save annotations' });
  }
};

// Export image with annotations (overwrite original)
const exportImageOverwrite = async (req, res) => {
  try {
    const { imageId } = req.params;
    const { dataURL, annotations } = req.body;

    if (!dataURL) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    // Get original image info
    const image = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(imageId);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Convert base64 to buffer
    const base64Data = dataURL.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Get original file path
    const originalPath = path.join(__dirname, '../../../', image.local_path);

    // Backup original (optional)
    const backupPath = originalPath.replace(/(\.\w+)$/, '_backup$1');
    await fs.copy(originalPath, backupPath);

    // Write new image
    await fs.writeFile(originalPath, buffer);

    // Save annotations
    const existing = db.prepare('SELECT id FROM image_annotations WHERE image_id = ?').get(imageId);
    if (existing) {
      const stmt = db.prepare("UPDATE image_annotations SET annotations = ?, updated_at = datetime('now') WHERE image_id = ?");
      stmt.run(annotations, imageId);
    } else {
      const stmt = db.prepare('INSERT INTO image_annotations (image_id, annotations) VALUES (?, ?)');
      stmt.run(imageId, annotations);
    }

    res.json({
      success: true,
      message: 'Image updated successfully'
    });
  } catch (error) {
    console.error('Error exporting image (overwrite):', error);
    res.status(500).json({ error: 'Failed to export image' });
  }
};

// Export image with annotations as new image
const exportImageNew = async (req, res) => {
  try {
    const { imageId } = req.params;
    const { dataURL, annotations } = req.body;

    if (!dataURL) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    // Get original image info
    const image = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(imageId);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Convert base64 to buffer
    const base64Data = dataURL.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate new filename
    const originalPath = path.join(__dirname, '../../../', image.local_path);
    const ext = path.extname(originalPath);
    const baseName = path.basename(originalPath, ext);
    const dirName = path.dirname(originalPath);
    const newFileName = `${baseName}_annotated_${Date.now()}${ext}`;
    const newPath = path.join(dirName, newFileName);

    // Write new image
    await fs.writeFile(newPath, buffer);

    // Generate new local_path (relative)
    const newLocalPath = image.local_path.replace(
      path.basename(image.local_path),
      newFileName
    );

    // Insert new image into database
    const insertStmt = db.prepare(`
      INSERT INTO drive_images (
        name, drive_file_id, thumbnail_url, local_path, mime_type,
        photo_taken_at, is_compressed, subfolder, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const newImageName = image.name.replace(/(\.\w+)$/, '_annotated$1');
    const result = insertStmt.run(
      newImageName,
      null, // No drive_file_id for local images
      image.thumbnail_url,
      newLocalPath,
      image.mime_type,
      image.photo_taken_at,
      0, // Not compressed
      image.subfolder
    );

    const newImageId = result.lastInsertRowid;

    // Save annotations for new image
    const annotationStmt = db.prepare('INSERT INTO image_annotations (image_id, annotations) VALUES (?, ?)');
    annotationStmt.run(newImageId, annotations);

    // Get the newly created image
    const newImage = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(newImageId);

    res.json({
      success: true,
      message: 'New image created successfully',
      image: newImage
    });
  } catch (error) {
    console.error('Error exporting image (new):', error);
    res.status(500).json({ error: 'Failed to export image' });
  }
};

module.exports = {
  getAnnotations,
  saveAnnotations,
  exportImageOverwrite,
  exportImageNew
};
