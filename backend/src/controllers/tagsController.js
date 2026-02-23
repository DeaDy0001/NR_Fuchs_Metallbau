const db = require('../config/database');

// Get all tags with image count
const getTags = (req, res) => {
  try {
    const tags = db.prepare(`
      SELECT t.*, COUNT(it.id) as image_count
      FROM tags t
      LEFT JOIN image_tags it ON t.id = it.tag_id
      GROUP BY t.id
      ORDER BY t.name ASC
    `).all();

    res.json({ tags });
  } catch (error) {
    console.error('Error getting tags:', error);
    res.status(500).json({ error: 'Failed to get tags' });
  }
};

// Create a new tag
const createTag = (req, res) => {
  try {
    const { name, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Tag-Name ist erforderlich' });
    }

    if (!color) {
      return res.status(400).json({ error: 'Farbe ist erforderlich' });
    }

    // Check for duplicate name
    const existing = db.prepare('SELECT id FROM tags WHERE LOWER(name) = LOWER(?)').get(name.trim());
    if (existing) {
      return res.status(409).json({ error: 'Ein Tag mit diesem Namen existiert bereits' });
    }

    const result = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name.trim(), color);
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);

    res.json(tag);
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(500).json({ error: 'Failed to create tag' });
  }
};

// Update a tag
const updateTag = (req, res) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;

    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    if (!tag) {
      return res.status(404).json({ error: 'Tag nicht gefunden' });
    }

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: 'Tag-Name darf nicht leer sein' });
      }
      // Check for duplicate name (excluding current tag)
      const existing = db.prepare('SELECT id FROM tags WHERE LOWER(name) = LOWER(?) AND id != ?').get(name.trim(), id);
      if (existing) {
        return res.status(409).json({ error: 'Ein Tag mit diesem Namen existiert bereits' });
      }
    }

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name.trim());
    }
    if (color !== undefined) {
      updates.push('color = ?');
      values.push(color);
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare(`
      SELECT t.*, COUNT(it.id) as image_count
      FROM tags t
      LEFT JOIN image_tags it ON t.id = it.tag_id
      WHERE t.id = ?
      GROUP BY t.id
    `).get(id);

    res.json(updated);
  } catch (error) {
    console.error('Error updating tag:', error);
    res.status(500).json({ error: 'Failed to update tag' });
  }
};

// Delete a tag
const deleteTag = (req, res) => {
  try {
    const { id } = req.params;

    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    if (!tag) {
      return res.status(404).json({ error: 'Tag nicht gefunden' });
    }

    // Delete tag (cascade will remove image_tags entries)
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);

    res.json({ success: true, message: `Tag "${tag.name}" gelöscht` });
  } catch (error) {
    console.error('Error deleting tag:', error);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
};

// Assign tag to image
const assignTagToImage = (req, res) => {
  try {
    const { imageId, tagId } = req.body;

    if (!imageId || !tagId) {
      return res.status(400).json({ error: 'Image ID und Tag ID sind erforderlich' });
    }

    // Check image exists
    const image = db.prepare('SELECT id FROM drive_images WHERE id = ?').get(imageId);
    if (!image) {
      return res.status(404).json({ error: 'Bild nicht gefunden' });
    }

    // Check tag exists
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(tagId);
    if (!tag) {
      return res.status(404).json({ error: 'Tag nicht gefunden' });
    }

    // Check if already assigned
    const existing = db.prepare('SELECT id FROM image_tags WHERE image_id = ? AND tag_id = ?').get(imageId, tagId);
    if (existing) {
      return res.json({ message: 'Tag bereits zugewiesen', alreadyAssigned: true });
    }

    db.prepare('INSERT INTO image_tags (image_id, tag_id) VALUES (?, ?)').run(imageId, tagId);

    res.json({ success: true, tagName: tag.name });
  } catch (error) {
    console.error('Error assigning tag to image:', error);
    res.status(500).json({ error: 'Failed to assign tag' });
  }
};

// Remove tag from image
const unassignTagFromImage = (req, res) => {
  try {
    const { imageId, tagId } = req.body;

    if (!imageId || !tagId) {
      return res.status(400).json({ error: 'Image ID und Tag ID sind erforderlich' });
    }

    db.prepare('DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?').run(imageId, tagId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error unassigning tag from image:', error);
    res.status(500).json({ error: 'Failed to unassign tag' });
  }
};

module.exports = {
  getTags,
  createTag,
  updateTag,
  deleteTag,
  assignTagToImage,
  unassignTagFromImage
};
