const db = require('../config/database');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { compressImage, generateThumbnail } = require('../services/googleDriveService');

const UPLOADS_DIR = path.join(__dirname, '../../../uploads');
const MOBILE_UPLOADS_DIR = path.join(UPLOADS_DIR, 'mobile');
const THUMBNAILS_DIR = path.join(UPLOADS_DIR, 'thumbnails');

// Ensure mobile uploads directory exists
fs.ensureDirSync(MOBILE_UPLOADS_DIR);

// ============================================================
// AUTH & DEVICE MANAGEMENT
// ============================================================

/**
 * Generate a connection token (shown as QR code in desktop app)
 * GET /api/mobile/connect-token
 */
const generateConnectToken = (req, res) => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const serverUrl = `${req.protocol}://${req.hostname}:${req.socket.localPort}`;

    // Store token temporarily (valid for 5 minutes)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Use settings table to store pending token
    db.prepare(`
      INSERT OR REPLACE INTO mobile_pending_tokens (token, expires_at)
      VALUES (?, ?)
    `).run(token, expiresAt);

    res.json({
      token,
      serverUrl,
      expiresAt
    });
  } catch (error) {
    console.error('Error generating connect token:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
};

/**
 * Register a mobile device using the connect token
 * POST /api/mobile/register
 */
const registerDevice = (req, res) => {
  try {
    const { token, deviceId, deviceName, userName } = req.body;

    if (!token || !deviceId || !userName) {
      return res.status(400).json({ error: 'Token, deviceId und userName sind erforderlich' });
    }

    // Verify token
    const pending = db.prepare(
      'SELECT * FROM mobile_pending_tokens WHERE token = ? AND expires_at > datetime(\'now\')'
    ).get(token);

    if (!pending) {
      return res.status(401).json({ error: 'Ungültiger oder abgelaufener Token' });
    }

    // Generate permanent auth token for this device
    const authToken = crypto.randomBytes(48).toString('hex');

    // Register or update device
    db.prepare(`
      INSERT INTO mobile_devices (device_id, device_name, user_name, auth_token, last_seen)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(device_id) DO UPDATE SET
        device_name = excluded.device_name,
        user_name = excluded.user_name,
        auth_token = excluded.auth_token,
        last_seen = datetime('now')
    `).run(deviceId, deviceName || 'Unbekanntes Gerät', userName, authToken);

    // Remove used token
    db.prepare('DELETE FROM mobile_pending_tokens WHERE token = ?').run(token);

    res.json({
      success: true,
      authToken,
      message: 'Gerät erfolgreich registriert'
    });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
};

/**
 * Middleware: Authenticate mobile requests via auth token
 */
const authenticateDevice = (req, res, next) => {
  const authToken = req.headers['x-mobile-token'];

  if (!authToken) {
    return res.status(401).json({ error: 'Kein Auth-Token angegeben' });
  }

  const device = db.prepare(
    'SELECT * FROM mobile_devices WHERE auth_token = ?'
  ).get(authToken);

  if (!device) {
    return res.status(401).json({ error: 'Ungültiger Auth-Token' });
  }

  // Update last_seen
  db.prepare('UPDATE mobile_devices SET last_seen = datetime(\'now\') WHERE device_id = ?')
    .run(device.device_id);

  req.device = device;
  next();
};

/**
 * Get list of registered devices
 * GET /api/mobile/devices
 */
const getDevices = (req, res) => {
  try {
    const devices = db.prepare(
      'SELECT id, device_id, device_name, user_name, last_seen, created_at FROM mobile_devices ORDER BY last_seen DESC'
    ).all();
    res.json(devices);
  } catch (error) {
    console.error('Error getting devices:', error);
    res.status(500).json({ error: 'Failed to get devices' });
  }
};

/**
 * Remove a registered device
 * DELETE /api/mobile/devices/:deviceId
 */
const removeDevice = (req, res) => {
  try {
    db.prepare('DELETE FROM mobile_devices WHERE device_id = ?').run(req.params.deviceId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing device:', error);
    res.status(500).json({ error: 'Failed to remove device' });
  }
};

// ============================================================
// PROJECTS (read for app)
// ============================================================

/**
 * Get all projects with tags for the mobile app
 * GET /api/mobile/projects
 */
const getProjects = (req, res) => {
  try {
    const projects = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM image_project_assignments ipa WHERE ipa.project_id = p.id) as image_count
      FROM projects p
      ORDER BY p.updated_at DESC
    `).all();

    // Get tags for response
    const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();

    res.json({ projects, tags });
  } catch (error) {
    console.error('Error getting projects for mobile:', error);
    res.status(500).json({ error: 'Failed to get projects' });
  }
};

/**
 * Get project images
 * GET /api/mobile/projects/:id/images
 */
const getProjectImages = (req, res) => {
  try {
    const { id } = req.params;

    const images = db.prepare(`
      SELECT di.id, di.name, di.original_name, di.local_path, di.thumbnail_url,
             di.file_size, di.width, di.height, di.photo_taken_at, di.created_at,
             mu.user_name as uploaded_by
      FROM drive_images di
      JOIN image_project_assignments ipa ON ipa.image_id = di.id
      LEFT JOIN mobile_uploads mu ON mu.local_path = di.local_path
      WHERE ipa.project_id = ?
      ORDER BY di.photo_taken_at DESC, di.created_at DESC
    `).all(id);

    // Get image tags
    const imageTags = db.prepare(`
      SELECT it.image_id, t.id as tag_id, t.name, t.color
      FROM image_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.image_id IN (${images.map(() => '?').join(',')})
    `).all(...images.map(i => i.id));

    const tagsByImage = {};
    for (const tag of imageTags) {
      if (!tagsByImage[tag.image_id]) tagsByImage[tag.image_id] = [];
      tagsByImage[tag.image_id].push({ id: tag.tag_id, name: tag.name, color: tag.color });
    }

    const result = images.map(img => ({
      ...img,
      tags: tagsByImage[img.id] || []
    }));

    res.json(result);
  } catch (error) {
    console.error('Error getting project images:', error);
    res.status(500).json({ error: 'Failed to get project images' });
  }
};

/**
 * Create a new project from the app (goes into inbox)
 * POST /api/mobile/projects
 */
const createProject = (req, res) => {
  try {
    const { name, color, tags } = req.body;
    const userName = req.device.user_name;

    if (!name) {
      return res.status(400).json({ error: 'Projektname ist erforderlich' });
    }

    // Store as pending project (inbox)
    db.prepare(`
      INSERT INTO mobile_uploads (device_id, user_name, file_name, original_name, local_path, status, project_name)
      VALUES (?, ?, ?, ?, ?, 'new_project', ?)
    `).run(
      req.device.device_id,
      userName,
      `project_${name}`,
      name,
      '',
      name
    );

    res.json({ success: true, message: `Projekt "${name}" wurde erstellt und wartet auf Bestätigung in der Software` });
  } catch (error) {
    console.error('Error creating project from mobile:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
};

// ============================================================
// IMAGE UPLOAD
// ============================================================

/**
 * Upload image from mobile app
 * POST /api/mobile/upload
 * Multipart form: image file + optional project_id
 */
const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Kein Bild angegeben' });
    }

    const { project_id, project_name } = req.body;
    const userName = req.device.user_name;
    const deviceId = req.device.device_id;

    const originalName = req.file.originalname;
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    const timestamp = Date.now();
    const fileName = `${baseName}_${timestamp}${ext}`;

    // Move file to mobile uploads directory
    const finalPath = path.join(MOBILE_UPLOADS_DIR, fileName);
    await fs.move(req.file.path, finalPath);

    // Generate thumbnail
    const thumbnailName = `mobile_${baseName}_${timestamp}.webp`;
    const thumbnailPath = path.join(THUMBNAILS_DIR, thumbnailName);
    try {
      await generateThumbnail(finalPath, thumbnailPath);
    } catch (e) {
      console.error('Thumbnail generation failed:', e.message);
    }

    const stats = await fs.stat(finalPath);
    const relativePath = `/uploads/mobile/${fileName}`;
    const thumbnailRelative = `/uploads/thumbnails/${thumbnailName}`;

    // Store in mobile_uploads
    const result = db.prepare(`
      INSERT INTO mobile_uploads
        (device_id, user_name, file_name, original_name, local_path, thumbnail_path, file_size, mime_type, project_id, project_name, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      deviceId,
      userName,
      fileName,
      originalName,
      relativePath,
      thumbnailRelative,
      stats.size,
      req.file.mimetype,
      project_id || null,
      project_name || null
    );

    // Also insert into drive_images so it appears in the main software
    const imgResult = db.prepare(`
      INSERT INTO drive_images
        (drive_path_id, name, original_name, file_url, local_path, thumbnail_url, file_size, mime_type, is_compressed, drive_file_id)
      VALUES (NULL, ?, ?, '', ?, ?, ?, ?, 0, ?)
    `).run(
      baseName,
      originalName,
      relativePath,
      thumbnailRelative,
      stats.size,
      req.file.mimetype,
      `mobile_${deviceId}_${timestamp}`
    );

    // If project_id is given, assign image to project
    if (project_id) {
      try {
        db.prepare(`
          INSERT OR IGNORE INTO image_project_assignments (image_id, project_id)
          VALUES (?, ?)
        `).run(imgResult.lastInsertRowid, project_id);
      } catch (e) {
        // Project might not exist yet, that's ok
      }
    }

    // Update mobile_uploads with processed status
    db.prepare('UPDATE mobile_uploads SET status = ? WHERE id = ?')
      .run('processed', result.lastInsertRowid);

    res.json({
      success: true,
      imageId: imgResult.lastInsertRowid,
      uploadId: result.lastInsertRowid,
      path: relativePath,
      thumbnail: thumbnailRelative
    });
  } catch (error) {
    console.error('Error uploading from mobile:', error);
    res.status(500).json({ error: 'Upload fehlgeschlagen' });
  }
};

// ============================================================
// SYNC - data for the mobile app to stay up to date
// ============================================================

/**
 * Get sync data (projects, tags, images metadata)
 * GET /api/mobile/sync?since=ISO_DATE
 */
const getSyncData = (req, res) => {
  try {
    const { since } = req.query;

    let projects, tags, images;

    if (since) {
      // Only return changes since last sync
      projects = db.prepare(
        'SELECT * FROM projects WHERE updated_at > ? OR created_at > ? ORDER BY updated_at DESC'
      ).all(since, since);
      tags = db.prepare(
        'SELECT * FROM tags WHERE updated_at > ? OR created_at > ? ORDER BY name'
      ).all(since, since);
    } else {
      // Full sync
      projects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
      tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
    }

    // Get image counts per project
    const imageCounts = db.prepare(`
      SELECT project_id, COUNT(*) as count
      FROM image_project_assignments
      GROUP BY project_id
    `).all();

    const countMap = {};
    for (const ic of imageCounts) {
      countMap[ic.project_id] = ic.count;
    }

    projects = projects.map(p => ({
      ...p,
      image_count: countMap[p.id] || 0
    }));

    // Get pending inbox items for this device
    const pendingUploads = db.prepare(`
      SELECT * FROM mobile_uploads
      WHERE status = 'new_project'
      ORDER BY uploaded_at DESC
    `).all();

    res.json({
      projects,
      tags,
      pendingUploads,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting sync data:', error);
    res.status(500).json({ error: 'Sync fehlgeschlagen' });
  }
};

/**
 * Serve an image file (for mobile app to download)
 * GET /api/mobile/image/:imageId
 * Supports quality param: ?quality=80&maxWidth=1920
 */
const getImage = async (req, res) => {
  try {
    const { imageId } = req.params;
    const { quality, maxWidth, maxHeight } = req.query;

    const image = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(imageId);
    if (!image || !image.local_path) {
      return res.status(404).json({ error: 'Bild nicht gefunden' });
    }

    const absolutePath = path.join(__dirname, '../../..', image.local_path);
    if (!await fs.pathExists(absolutePath)) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }

    // If compression requested, compress on the fly
    if (quality || maxWidth || maxHeight) {
      const sharp = require('sharp');
      let img = sharp(absolutePath).rotate();

      if (maxWidth || maxHeight) {
        const resizeOpts = { fit: 'inside', withoutEnlargement: true };
        if (maxWidth) resizeOpts.width = parseInt(maxWidth);
        if (maxHeight) resizeOpts.height = parseInt(maxHeight);
        img = img.resize(resizeOpts);
      }

      const q = parseInt(quality) || 80;
      img = img.webp({ quality: q });

      res.set('Content-Type', 'image/webp');
      return img.pipe(res);
    }

    // Otherwise send original
    res.sendFile(absolutePath);
  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Bildes' });
  }
};

/**
 * Get mobile inbox (uploads pending review in desktop)
 * GET /api/mobile/inbox
 */
const getInbox = (req, res) => {
  try {
    const uploads = db.prepare(`
      SELECT mu.*, md.user_name as device_user, md.device_name
      FROM mobile_uploads mu
      JOIN mobile_devices md ON md.device_id = mu.device_id
      ORDER BY mu.uploaded_at DESC
    `).all();
    res.json(uploads);
  } catch (error) {
    console.error('Error getting inbox:', error);
    res.status(500).json({ error: 'Failed to get inbox' });
  }
};

module.exports = {
  generateConnectToken,
  registerDevice,
  authenticateDevice,
  getDevices,
  removeDevice,
  getProjects,
  getProjectImages,
  createProject,
  uploadImage,
  getSyncData,
  getImage,
  getInbox
};
