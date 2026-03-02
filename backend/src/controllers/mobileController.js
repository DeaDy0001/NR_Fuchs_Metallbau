const db = require('../config/database');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { compressImage, generateThumbnail, findSubfolder, findOrCreateSubfolder, moveFileOnDrive, listFoldersInFolder, listFilesInFolder, extractFolderId, deleteFileFromDrive, downloadFile, getFileMetadata, listAllFilesInFolder, readDriveFileAsJson, updateDriveFileContent } = require('../services/googleDriveService');
const { google } = require('googleapis');
const os = require('os');

const UPLOADS_DIR = path.join(__dirname, '../../../uploads');
const MOBILE_UPLOADS_DIR = path.join(UPLOADS_DIR, 'mobile');
const THUMBNAILS_DIR = path.join(UPLOADS_DIR, 'thumbnails');

// ============================================================
// MOBILE PC-LOGIN SESSIONS (in-memory, auto-expire after 10min)
// ============================================================
const mobileLoginSessions = new Map();
const MOBILE_LOGIN_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// Cleanup expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of mobileLoginSessions) {
    if (now > session.expiresAt) mobileLoginSessions.delete(id);
  }
}, 5 * 60 * 1000);

// Ensure mobile uploads directory exists
fs.ensureDirSync(MOBILE_UPLOADS_DIR);

// Helper: get local network IPv4 addresses for QR code
const getNetworkAddresses = () => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [name, nets] of Object.entries(interfaces)) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ name, address: net.address });
      }
    }
  }
  return addresses;
};

// ============================================================
// AUTH & DEVICE MANAGEMENT
// ============================================================

/**
 * Generate QR code data for mobile app (shown as QR code in desktop app)
 * POST /api/mobile/connect-token
 * Body: { drivePathId?: number }
 *
 * Returns JSON QR payload containing Google Client ID and Drive folder ID
 * so the mobile app can authenticate via Google and access the shared Drive folder.
 */
const generateConnectToken = (req, res) => {
  try {
    // Use unified GOOGLE_CLIENT_ID for both desktop and mobile
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      return res.status(400).json({
        error: 'Google OAuth nicht konfiguriert. Bitte Google Credentials im Dev-Tab der Einstellungen konfigurieren.'
      });
    }

    // Get configured drive paths
    let drivePaths = [];
    try {
      drivePaths = db.prepare('SELECT * FROM drive_paths ORDER BY id ASC').all();
    } catch (e) {
      // Table might not exist yet
    }

    if (drivePaths.length === 0) {
      return res.status(400).json({
        error: 'Kein Google Drive Ordner konfiguriert. Bitte zuerst einen Drive-Ordner in den Einstellungen hinzufügen.'
      });
    }

    // Use selected drive path or first one
    const selectedId = req.body?.drivePathId;
    const drivePath = selectedId
      ? drivePaths.find(dp => dp.id === parseInt(selectedId)) || drivePaths[0]
      : drivePaths[0];

    // Extract folder ID from path (could be URL or plain ID)
    let rootFolderId = drivePath.path;
    const urlMatch = drivePath.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) {
      rootFolderId = urlMatch[1];
    }

    // Determine server URL for mobile OAuth proxy
    const networkAddresses = getNetworkAddresses();
    const serverPort = process.env.PORT || 3001;
    const selectedAddress = req.body?.networkAddress;
    const primaryAddress = selectedAddress || (networkAddresses.length > 0 ? networkAddresses[0].address : 'localhost');
    const serverUrl = `http://${primaryAddress}:${serverPort}`;

    // Build QR code data as JSON for the mobile app to parse
    const qrPayload = {
      type: 'fuchs_drive',
      googleClientId,
      rootFolderId,
      name: drivePath.name || 'Fuchs Metallbau',
      serverUrl,
    };

    res.json({
      qrData: JSON.stringify(qrPayload),
      name: drivePath.name,
      rootFolderId,
      googleClientId,
      serverUrl,
      networkAddresses: networkAddresses.map(a => ({ name: a.name, address: a.address, url: `http://${a.address}:${serverPort}` })),
      drivePaths: drivePaths.map(dp => ({ id: dp.id, name: dp.name }))
    });
  } catch (error) {
    console.error('Error generating QR data:', error);
    res.status(500).json({ error: 'QR-Daten konnten nicht generiert werden' });
  }
};

/**
 * Landing page when QR code is scanned with phone camera
 * GET /api/mobile/connect/:token
 */
const connectLandingPage = (req, res) => {
  try {
    const { token } = req.params;

    // Check if token is valid
    const pending = db.prepare(
      "SELECT * FROM mobile_pending_tokens WHERE token = ? AND expires_at > datetime('now')"
    ).get(token);

    const isValid = !!pending;
    const serverUrl = pending?.server_url || `${req.protocol}://${req.hostname}:${req.socket.localPort}`;

    // Check if APK exists
    const apkPath = path.join(__dirname, '../../../mobile-app/android/app.apk');
    const apkExists = fs.existsSync(apkPath);
    let apkSize = '';
    if (apkExists) {
      const stats = fs.statSync(apkPath);
      const mb = (stats.size / (1024 * 1024)).toFixed(1);
      apkSize = `${mb} MB`;
    }

    const connectionData = JSON.stringify({ token, serverUrl });

    res.send(buildLandingPageHtml({ isValid, serverUrl, apkExists, apkSize, connectionData }));
  } catch (error) {
    console.error('Error serving connect page:', error);
    res.status(500).send('Fehler beim Laden der Seite');
  }
};

function buildLandingPageHtml({ isValid, serverUrl, apkExists, apkSize, connectionData }) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Fuchs Metallbau - App</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:#0f0f23;color:#e2e8f0;min-height:100vh;
      display:flex;flex-direction:column;align-items:center;
      padding:24px 16px;
    }
    .card{
      background:#1a1a2e;border:1px solid #2a2a4a;border-radius:16px;
      padding:32px 24px;max-width:420px;width:100%;text-align:center;
    }
    .logo{
      width:72px;height:72px;
      background:linear-gradient(135deg,#3b82f6,#2563eb);
      border-radius:18px;display:flex;align-items:center;justify-content:center;
      margin:0 auto 20px;font-size:32px;
    }
    h1{font-size:22px;font-weight:700;margin-bottom:6px}
    .subtitle{font-size:14px;color:#94a3b8;margin-bottom:28px}
    .status{
      display:inline-flex;align-items:center;gap:8px;
      padding:8px 16px;border-radius:20px;font-size:13px;font-weight:600;
      margin-bottom:24px;
    }
    .status.valid{background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(34,197,94,.3)}
    .status.expired{background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.3)}
    .dot{width:8px;height:8px;border-radius:50%}
    .valid .dot{background:#4ade80}.expired .dot{background:#f87171}
    .divider{height:1px;background:#2a2a4a;margin:20px 0}
    .label{font-size:13px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
    .btn{
      display:flex;align-items:center;justify-content:center;gap:10px;
      width:100%;padding:14px 20px;border-radius:12px;font-size:16px;font-weight:600;
      text-decoration:none;border:none;cursor:pointer;transition:all .2s;
    }
    .btn-primary{background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff}
    .btn-primary:hover{opacity:.9}
    .btn-secondary{background:#2a2a4a;color:#e2e8f0;margin-top:10px;font-size:14px}
    .btn-secondary:hover{background:#333360}
    .btn-disabled{background:#2a2a4a;color:#64748b;cursor:not-allowed}
    .btn svg{width:20px;height:20px;flex-shrink:0}
    .info-box{background:#16163a;border:1px solid #2a2a4a;border-radius:10px;padding:14px;margin-top:16px}
    .info-row{display:flex;justify-content:space-between;align-items:center;font-size:13px}
    .info-row+.info-row{margin-top:8px}
    .info-label{color:#94a3b8}.info-value{color:#e2e8f0;font-family:monospace;font-size:12px}
    .steps{text-align:left;margin-top:20px}
    .step{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}
    .step-num{
      width:26px;height:26px;border-radius:50%;background:#2a2a4a;color:#3b82f6;
      display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;
    }
    .step-text{font-size:14px;color:#cbd5e1;line-height:1.4;padding-top:2px}
    .footer{margin-top:24px;font-size:12px;color:#475569}
    .toast{
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:#22c55e;color:#fff;padding:10px 20px;border-radius:10px;
      font-size:14px;font-weight:600;opacity:0;transition:opacity .3s;pointer-events:none;
    }
    .toast.show{opacity:1}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">&#9874;</div>
    <h1>Fuchs Metallbau</h1>
    <p class="subtitle">Mobile App f\u00fcr Fotos &amp; Projekte</p>

    <div class="status ${isValid ? 'valid' : 'expired'}">
      <span class="dot"></span>
      ${isValid ? 'Verbindung bereit' : 'Token abgelaufen oder ung\u00fcltig'}
    </div>

    <div class="divider"></div>

    <p class="label">Schritt 1 \u2013 App installieren</p>
    ${apkExists ? `
    <a href="${serverUrl}/api/mobile/app.apk" class="btn btn-primary" download="FuchsMetallbau.apk">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
      APK herunterladen (${apkSize})
    </a>
    ` : `
    <div class="btn btn-disabled">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      APK noch nicht verf\u00fcgbar
    </div>
    <p style="font-size:12px;color:#94a3b8;margin-top:8px">Die APK muss zuerst am Server gebaut werden.</p>
    `}

    <div class="divider"></div>

    <p class="label">Schritt 2 \u2013 Mit Server verbinden</p>
    ${isValid ? `
    <div class="steps">
      <div class="step">
        <span class="step-num">1</span>
        <span class="step-text">\u00d6ffne die installierte App</span>
      </div>
      <div class="step">
        <span class="step-num">2</span>
        <span class="step-text">Scanne den QR-Code erneut <strong>in der App</strong></span>
      </div>
      <div class="step">
        <span class="step-num">3</span>
        <span class="step-text">Gib deinen Namen ein und tippe auf <strong>Verbinden</strong></span>
      </div>
    </div>
    <button class="btn btn-secondary" onclick="copyData()">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
      Verbindungsdaten kopieren
    </button>
    ` : `
    <p style="font-size:14px;color:#94a3b8">Bitte erstelle in der Desktop-Software einen neuen QR-Code<br>(Einstellungen \u2192 Handy App).</p>
    `}

    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Server</span>
        <span class="info-value">${serverUrl}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="info-value">${isValid ? '\u2713 Bereit' : '\u2717 Abgelaufen'}</span>
      </div>
    </div>
  </div>

  <p class="footer">Fuchs Metallbau</p>
  <div class="toast" id="toast">Kopiert!</div>

  <script>
    var cd=${JSON.stringify(connectionData)};
    function copyData(){
      navigator.clipboard.writeText(cd).then(function(){
        var t=document.getElementById('toast');
        t.classList.add('show');
        setTimeout(function(){t.classList.remove('show')},1500);
      });
    }
  </script>
</body>
</html>`;
}

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
 * Heartbeat from mobile app - creates/updates device record and updates last_seen
 * POST /api/mobile/heartbeat
 */
const deviceHeartbeat = (req, res) => {
  try {
    const { deviceId, deviceName, userName } = req.body;

    if (!deviceId || !userName) {
      return res.status(400).json({ error: 'deviceId und userName sind erforderlich' });
    }

    // Check if device already exists
    const existing = db.prepare('SELECT id FROM mobile_devices WHERE device_id = ?').get(deviceId);

    if (existing) {
      // Update last_seen and optionally device_name/user_name
      db.prepare(`
        UPDATE mobile_devices
        SET last_seen = datetime('now'), device_name = ?, user_name = ?
        WHERE device_id = ?
      `).run(deviceName || 'Unbekannt', userName, deviceId);
    } else {
      // Create new device record
      const authToken = crypto.randomBytes(48).toString('hex');
      db.prepare(`
        INSERT INTO mobile_devices (device_id, device_name, user_name, auth_token, last_seen)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(deviceId, deviceName || 'Unbekannt', userName, authToken);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Error in device heartbeat:', error);
    res.status(500).json({ error: 'Heartbeat failed' });
  }
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

    // Compute is_online: device seen within last 2 minutes
    const now = new Date();
    const devicesWithStatus = devices.map(device => {
      let isOnline = false;
      if (device.last_seen) {
        const lastSeen = new Date(device.last_seen + 'Z'); // SQLite datetime is UTC
        const diffMs = now - lastSeen;
        isOnline = diffMs < 2 * 60 * 1000; // 2 minutes
      }
      return { ...device, is_online: isOnline };
    });

    res.json(devicesWithStatus);
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
 * Check if a folder name looks like a UUID (device ID)
 */
const isDeviceIdFolder = (name) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name);
};

/**
 * Resolve a device ID to a user name from mobile_devices table
 */
const resolveDeviceUser = (deviceId) => {
  try {
    const device = db.prepare('SELECT user_name FROM mobile_devices WHERE device_id = ?').get(deviceId);
    return device?.user_name || null;
  } catch {
    return null;
  }
};

// Helper: Sanitize filename for local storage
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
};

/**
 * Helper: Download a Drive file locally, generate thumbnail, register in drive_images
 * Returns the new drive_images row ID
 */
const downloadAndRegisterImage = async (driveFileId, fileName, mimeType, drivePathId, drivePathName) => {
  const uploadBaseDir = path.join(__dirname, '../../../uploads/drive');
  const drivePathDir = path.join(uploadBaseDir, sanitizeFilename(drivePathName));
  await fs.ensureDir(drivePathDir);

  const fileExt = path.extname(fileName);
  const fileBaseName = path.basename(fileName, fileExt);
  const uniqueName = `${Date.now()}_${sanitizeFilename(fileName)}`;
  const localFilePath = path.join(drivePathDir, uniqueName);

  // Download from Drive
  await downloadFile(driveFileId, localFilePath);
  const stats = await fs.stat(localFilePath);

  // Extract EXIF date
  let photoTakenAt = null;
  try {
    const exifr = require('exifr');
    const exifData = await exifr.parse(localFilePath, {
      pick: ['DateTimeOriginal', 'DateTime', 'CreateDate']
    });
    if (exifData) {
      const dateValue = exifData.DateTimeOriginal || exifData.DateTime || exifData.CreateDate;
      if (dateValue) photoTakenAt = new Date(dateValue).toISOString();
    }
  } catch {}

  // Generate thumbnail
  const thumbnailDir = path.join(__dirname, '../../../uploads/thumbnails');
  await fs.ensureDir(thumbnailDir);
  const thumbnailFilename = `${Date.now()}_${sanitizeFilename(fileBaseName)}.jpg`;
  const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);
  await generateThumbnail(localFilePath, thumbnailPath);

  // Register in drive_images
  const localPath = `/uploads/drive/${sanitizeFilename(drivePathName)}/${uniqueName}`;
  const thumbnailUrl = `/uploads/thumbnails/${thumbnailFilename}`;

  const result = db.prepare(`
    INSERT INTO drive_images
    (drive_path_id, name, original_name, local_path, thumbnail_url,
     file_size, mime_type, is_compressed, drive_file_id, photo_taken_at, subfolder)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
  `).run(
    drivePathId,
    fileBaseName,
    fileName,
    localPath,
    thumbnailUrl,
    stats.size,
    mimeType || 'image/jpeg',
    driveFileId,
    photoTakenAt
  );

  return result.lastInsertRowid;
};

/**
 * Get mobile inbox (uploads pending review in desktop)
 * GET /api/mobile/inbox
 */
const getInbox = async (req, res) => {
  try {
    // Scan Google Drive inbox/ folder for project subfolders
    let driveInboxProjects = [];
    try {
      const drivePath = db.prepare('SELECT path FROM drive_paths LIMIT 1').get();
      if (drivePath) {
        let rootFolderId = drivePath.path;
        const urlMatch = drivePath.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (urlMatch) rootFolderId = urlMatch[1];

        const metaFolder = await findSubfolder(rootFolderId, 'NR_Fuchs_Meta');
        if (metaFolder) {
          const inboxFolder = await findSubfolder(metaFolder.id, 'inbox');
          if (inboxFolder) {
            const folders = await listFoldersInFolder(inboxFolder.id);
            // Get image counts for each folder
            driveInboxProjects = await Promise.all(folders.map(async (f) => {
              let image_count = 0;
              try {
                const files = await listFilesInFolder(f.id);
                image_count = files.length;
              } catch {}

              // Detect if folder is a device inbox (UUID name) vs a project
              const isUserInbox = isDeviceIdFolder(f.name);
              const deviceUser = isUserInbox ? (resolveDeviceUser(f.name) || 'Unbekannt') : null;

              return {
                id: `drive_inbox_${f.id}`,
                drive_folder_id: f.id,
                inbox_folder_id: inboxFolder.id,
                file_name: `project_${f.name}`,
                original_name: f.name,
                project_name: isUserInbox ? `Bilder ohne Projekt von ${deviceUser}` : f.name,
                image_count,
                status: isUserInbox ? 'user_inbox' : 'new_project',
                source: 'drive_inbox',
                is_user_inbox: isUserInbox,
                device_user: isUserInbox ? deviceUser : 'Handy-App',
                device_name: 'Google Drive',
                uploaded_at: f.modifiedTime || new Date().toISOString(),
              };
            }));
          }
        }
      }
    } catch (e) {
      console.error('Error scanning Drive inbox:', e.message);
    }

    // Also read delete_requests.json from inbox (if exists)
    let deleteRequests = [];
    try {
      const drivePath = db.prepare('SELECT path FROM drive_paths LIMIT 1').get();
      if (drivePath) {
        let rootFolderId = drivePath.path;
        const urlMatch = drivePath.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (urlMatch) rootFolderId = urlMatch[1];

        const metaFolder = await findSubfolder(rootFolderId, 'NR_Fuchs_Meta');
        if (metaFolder) {
          const inboxFolder = await findSubfolder(metaFolder.id, 'inbox');
          if (inboxFolder) {
            // Find delete_requests.json in inbox
            const allFiles = await listAllFilesInFolder(inboxFolder.id);
            const deleteFile = allFiles.find(f => f.name === 'delete_requests.json');
            if (deleteFile) {
              try {
                const data = await readDriveFileAsJson(deleteFile.id);
                if (Array.isArray(data) && data.length > 0) {
                  deleteRequests = data.map(req => ({
                    ...req,
                    _deleteFileId: deleteFile.id,
                    _inboxFolderId: inboxFolder.id,
                  }));
                }
              } catch (e) {
                console.error('Error reading delete_requests.json:', e.message);
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Error reading delete requests:', e.message);
    }

    res.json({ projects: driveInboxProjects, deleteRequests });
  } catch (error) {
    console.error('Error getting inbox:', error);
    res.status(500).json({ error: 'Failed to get inbox' });
  }
};

/**
 * Confirm an inbox project - move folder from inbox/ to Projekte/ on Google Drive
 * + create local project folder with Bilder/ subfolder
 * + download images to local Bilder/ folder
 * + create project DB entry
 * POST /api/mobile/inbox/confirm
 * Body: { folderId, inboxFolderId, projectName }
 */
const confirmInboxProject = async (req, res) => {
  try {
    const { folderId, inboxFolderId, projectName } = req.body;

    if (!folderId) {
      return res.status(400).json({ error: 'folderId ist erforderlich' });
    }

    // Find or create Projekte/ folder
    const drivePath = db.prepare('SELECT * FROM drive_paths LIMIT 1').get();
    if (!drivePath) {
      return res.status(400).json({ error: 'Kein Google Drive Ordner konfiguriert' });
    }

    let rootFolderId = drivePath.path;
    const urlMatch = drivePath.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) rootFolderId = urlMatch[1];

    const metaFolder = await findSubfolder(rootFolderId, 'NR_Fuchs_Meta');
    if (!metaFolder) {
      return res.status(400).json({ error: 'NR_Fuchs_Meta Ordner nicht gefunden' });
    }

    // List files BEFORE moving (to avoid any Google Drive API caching issues)
    const files = await listFilesInFolder(folderId);
    const images = files.filter(f => f.mimeType && f.mimeType.startsWith('image/'));
    console.log(`📋 Found ${images.length} images in inbox folder "${projectName}" before move`);

    const projekteFolder = await findOrCreateSubfolder(metaFolder.id, 'Projekte');

    // Move folder from inbox/ to Projekte/
    const sourceParentId = inboxFolderId || (await findSubfolder(metaFolder.id, 'inbox'))?.id;
    if (!sourceParentId) {
      return res.status(400).json({ error: 'Inbox-Ordner nicht gefunden' });
    }

    await moveFileOnDrive(folderId, projekteFolder.id, sourceParentId);

    // Create local project folder + Bilder subfolder + download images
    const settings = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    let downloaded = 0;

    if (settings?.project_path) {
      const projectFolder = path.join(settings.project_path, projectName);
      const bilderFolder = path.join(projectFolder, 'Bilder');
      await fs.ensureDir(bilderFolder);
      console.log(`📁 Created local project folder: ${bilderFolder}`);

      // Download images from Drive to local Bilder folder
      for (const img of images) {
        try {
          // Download directly to Bilder folder
          const destPath = path.join(bilderFolder, img.name);
          if (!await fs.pathExists(destPath)) {
            await downloadFile(img.id, destPath);
            downloaded++;
            console.log(`✓ Downloaded "${img.name}" to "${bilderFolder}"`);
          } else {
            downloaded++;
            console.log(`⏭ "${img.name}" already exists, skipped`);
          }
        } catch (e) {
          console.error(`✗ Failed to download ${img.name}:`, e.message);
        }
      }
    } else {
      console.warn('⚠ project_path not configured, skipping local download');
    }

    // Create project in DB if not exists
    const existing = db.prepare('SELECT id FROM projects WHERE folder_name = ?').get(projectName);
    let projectId;
    if (existing) {
      projectId = existing.id;
    } else {
      const result = db.prepare('INSERT INTO projects (folder_name, color, notes) VALUES (?, ?, ?)')
        .run(projectName, '#3b82f6', '');
      projectId = result.lastInsertRowid;
    }

    // Update any related mobile_uploads entries
    try {
      db.prepare(`
        UPDATE mobile_uploads SET status = 'processed'
        WHERE project_name = ? AND status = 'new_project'
      `).run(projectName || '');
    } catch (e) {
      // Non-critical
    }

    console.log(`✅ Project "${projectName}" confirmed: ${downloaded}/${images.length} images downloaded`);
    res.json({
      success: true,
      message: `Projekt "${projectName}" wurde erstellt (${downloaded}/${images.length} Bilder heruntergeladen)`,
    });
  } catch (error) {
    console.error('Error confirming inbox project:', error);
    res.status(500).json({ error: 'Projekt konnte nicht bestätigt werden: ' + error.message });
  }
};

/**
 * Add user inbox images to library (no project assignment)
 * Moves images from inbox/{deviceId}/ to root Drive folder + downloads locally
 * POST /api/mobile/inbox/add-to-library
 * Body: { sourceFolderId, fileIds? }
 */
const addToLibrary = async (req, res) => {
  try {
    const { sourceFolderId, fileIds } = req.body;

    if (!sourceFolderId) {
      return res.status(400).json({ error: 'sourceFolderId ist erforderlich' });
    }

    // Get root Drive folder ID
    const drivePath = db.prepare('SELECT * FROM drive_paths LIMIT 1').get();
    if (!drivePath) {
      return res.status(400).json({ error: 'Kein Google Drive Ordner konfiguriert' });
    }

    let rootFolderId = drivePath.path;
    const urlMatch = drivePath.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) rootFolderId = urlMatch[1];

    // List files in the inbox folder
    const allFiles = await listFilesInFolder(sourceFolderId);
    const filesToProcess = fileIds && fileIds.length > 0
      ? allFiles.filter(f => fileIds.includes(f.id))
      : allFiles;

    let addedCount = 0;
    for (const file of filesToProcess) {
      try {
        // 1. Move file on Drive from inbox/{deviceId}/ to root folder
        await moveFileOnDrive(file.id, rootFolderId, sourceFolderId);

        // 2. Download locally and register in drive_images
        await downloadAndRegisterImage(
          file.id,
          file.name,
          file.mimeType,
          drivePath.id,
          drivePath.name
        );

        addedCount++;
        console.log(`✓ Added "${file.name}" to library`);
      } catch (e) {
        console.error(`Error adding file ${file.name} to library:`, e.message);
      }
    }

    // Check if source folder is now empty - if so, delete it
    try {
      const remaining = await listFilesInFolder(sourceFolderId);
      if (remaining.length === 0) {
        await deleteFileFromDrive(sourceFolderId);
      }
    } catch (e) {
      // Non-critical
    }

    res.json({
      success: true,
      addedCount,
      message: `${addedCount} Bilder zur Bibliothek hinzugefügt`,
    });
  } catch (error) {
    console.error('Error adding to library:', error);
    res.status(500).json({ error: 'Fehler beim Hinzufügen: ' + error.message });
  }
};

/**
 * Get images from an inbox project folder
 * GET /api/mobile/inbox/:folderId/images
 */
const getInboxImages = async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!folderId) {
      return res.status(400).json({ error: 'folderId ist erforderlich' });
    }
    const files = await listFilesInFolder(folderId);
    res.json(files);
  } catch (error) {
    console.error('Error getting inbox images:', error);
    res.status(500).json({ error: 'Bilder konnten nicht geladen werden' });
  }
};

/**
 * Helper: Merge files from inbox to a target project
 * Handles: Drive move + local download + copy to Bilder/ + assignment records
 */
const mergeFilesToProject = async (files, sourceFolderId, targetProjectId) => {
  // Look up project from DB
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(targetProjectId);
  if (!project) {
    throw new Error(`Projekt mit ID ${targetProjectId} nicht gefunden`);
  }

  // Get Drive path info
  const drivePath = db.prepare('SELECT * FROM drive_paths LIMIT 1').get();
  if (!drivePath) throw new Error('Kein Google Drive Ordner konfiguriert');

  let rootFolderId = drivePath.path;
  const urlMatch = drivePath.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) rootFolderId = urlMatch[1];

  // Find or create NR_Fuchs_Meta/Projekte/{projectName}/ on Drive
  const metaFolder = await findSubfolder(rootFolderId, 'NR_Fuchs_Meta');
  if (!metaFolder) throw new Error('NR_Fuchs_Meta Ordner nicht gefunden');
  const projekteFolder = await findOrCreateSubfolder(metaFolder.id, 'Projekte');
  const projectDriveFolder = await findOrCreateSubfolder(projekteFolder.id, project.folder_name);

  // Get project local Bilder path
  const setting = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
  let bilderPath = null;
  if (setting?.project_path) {
    bilderPath = path.join(setting.project_path, project.folder_name, 'Bilder');
    await fs.ensureDir(bilderPath);
  }

  let movedCount = 0;
  for (const file of files) {
    try {
      // 1. Move on Drive to project folder
      await moveFileOnDrive(file.id, projectDriveFolder.id, sourceFolderId);

      // 2. Download locally and register in drive_images
      const imageId = await downloadAndRegisterImage(
        file.id,
        file.name,
        file.mimeType,
        drivePath.id,
        drivePath.name
      );

      // 3. Copy to local project Bilder/ folder
      if (bilderPath && imageId) {
        const image = db.prepare('SELECT * FROM drive_images WHERE id = ?').get(imageId);
        if (image?.local_path) {
          const sourcePath = path.join(__dirname, '../../..', image.local_path.startsWith('/') ? image.local_path.substring(1) : image.local_path);
          const destPath = path.join(bilderPath, path.basename(sourcePath));
          await fs.copy(sourcePath, destPath, { overwrite: false });
        }

        // 4. Create assignment record
        const existing = db.prepare(
          'SELECT id FROM image_project_assignments WHERE image_id = ? AND project_id = ?'
        ).get(imageId, project.id);
        if (!existing) {
          db.prepare(
            'INSERT INTO image_project_assignments (image_id, project_id) VALUES (?, ?)'
          ).run(imageId, project.id);
        }
      }

      movedCount++;
      console.log(`✓ Merged "${file.name}" into project "${project.folder_name}"`);
    } catch (e) {
      console.error(`Error merging file ${file.name}:`, e.message);
    }
  }

  return movedCount;
};

/**
 * Merge inbox project with existing project
 * POST /api/mobile/inbox/merge
 * Body: { sourceFolderId, targetProjectId, inboxFolderId, projectName }
 */
const mergeInboxProject = async (req, res) => {
  try {
    const { sourceFolderId, targetProjectId, inboxFolderId, projectName } = req.body;

    if (!sourceFolderId || !targetProjectId) {
      return res.status(400).json({ error: 'sourceFolderId und targetProjectId sind erforderlich' });
    }

    // List all files in the inbox project folder
    const files = await listFilesInFolder(sourceFolderId);
    const movedCount = await mergeFilesToProject(files, sourceFolderId, targetProjectId);

    // Try to delete the now-empty inbox folder
    try {
      const remaining = await listFilesInFolder(sourceFolderId);
      if (remaining.length === 0) {
        await deleteFileFromDrive(sourceFolderId);
      }
    } catch (e) {
      console.error('Could not delete empty inbox folder:', e.message);
    }

    // Update any related mobile_uploads entries
    try {
      db.prepare(`
        UPDATE mobile_uploads SET status = 'processed'
        WHERE project_name = ? AND status = 'new_project'
      `).run(projectName || '');
    } catch (e) {
      // Non-critical
    }

    res.json({
      success: true,
      movedCount,
      message: `${movedCount} Bilder wurden zusammengeführt`,
    });
  } catch (error) {
    console.error('Error merging inbox project:', error);
    res.status(500).json({ error: 'Zusammenführung fehlgeschlagen: ' + error.message });
  }
};

/**
 * Selective merge - move only specific files from inbox folder to target project
 * POST /api/mobile/inbox/merge-selected
 * Body: { sourceFolderId, targetProjectId, fileIds: [fileId1, fileId2, ...] }
 */
const mergeSelectedInboxImages = async (req, res) => {
  try {
    const { sourceFolderId, targetProjectId, fileIds } = req.body;

    if (!sourceFolderId || !targetProjectId || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'sourceFolderId, targetProjectId und fileIds sind erforderlich' });
    }

    // Get file details for the selected IDs
    const allFiles = await listFilesInFolder(sourceFolderId);
    const selectedFiles = allFiles.filter(f => fileIds.includes(f.id));

    const movedCount = await mergeFilesToProject(selectedFiles, sourceFolderId, targetProjectId);

    // Check if source folder is now empty - if so, delete it
    try {
      const remaining = await listFilesInFolder(sourceFolderId);
      if (remaining.length === 0) {
        await deleteFileFromDrive(sourceFolderId);
      }
    } catch (e) {
      // Non-critical
    }

    res.json({
      success: true,
      movedCount,
      message: `${movedCount} Bilder wurden zusammengeführt`,
    });
  } catch (error) {
    console.error('Error merging selected inbox images:', error);
    res.status(500).json({ error: 'Zusammenführung fehlgeschlagen: ' + error.message });
  }
};

/**
 * Delete specific images from inbox
 * POST /api/mobile/inbox/delete-images
 * Body: { fileIds: string[] }
 */
const deleteInboxImages = async (req, res) => {
  try {
    const { fileIds } = req.body;
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds (Array) ist erforderlich' });
    }

    let deletedCount = 0;
    const errors = [];

    for (const fileId of fileIds) {
      try {
        // Delete from Google Drive
        await deleteFileFromDrive(fileId);

        // Delete from local database if exists
        try {
          db.prepare('DELETE FROM drive_images WHERE drive_id = ?').run(fileId);
        } catch {}

        deletedCount++;
      } catch (error) {
        errors.push({ fileId, error: error.message });
      }
    }

    res.json({
      success: true,
      deletedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error deleting inbox images:', error);
    res.status(500).json({ error: 'Löschen fehlgeschlagen: ' + error.message });
  }
};

/**
 * Delete/reject an inbox project - delete folder from inbox/ on Google Drive
 * DELETE /api/mobile/inbox/:folderId
 */
const deleteInboxProject = async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!folderId) {
      return res.status(400).json({ error: 'folderId ist erforderlich' });
    }

    await deleteFileFromDrive(folderId);

    // Also clean up any related mobile_uploads entries
    try {
      db.prepare(`
        UPDATE mobile_uploads SET status = 'processed'
        WHERE status = 'new_project'
      `).run();
    } catch (e) {
      // Non-critical
    }

    res.json({ success: true, message: 'Projekt aus Inbox gelöscht' });
  } catch (error) {
    console.error('Error deleting inbox project:', error);
    res.status(500).json({ error: 'Löschen fehlgeschlagen: ' + error.message });
  }
};

// ============================================================
// MOBILE OAUTH PROXY
// ============================================================

/**
 * Mobile OAuth proxy - initiates Google sign-in for mobile app
 * GET /api/mobile/auth/google?app_redirect=CALLBACK_URL
 *
 * The mobile app can't do OAuth directly because Web-type Google client IDs
 * reject custom scheme redirect URIs (exp://, com.fuchsmetallbau.app://).
 * This endpoint proxies the OAuth flow through the backend which has the client secret.
 */
const mobileGoogleAuth = (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).send('Google OAuth nicht konfiguriert. GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET in .env setzen.');
    }

    const appRedirect = req.query.app_redirect;
    if (!appRedirect) {
      return res.status(400).send('app_redirect Parameter fehlt');
    }

    // Build redirect URI from the incoming request (phone browser's perspective)
    const redirectUri = `${req.protocol}://${req.get('host')}/api/mobile/auth/callback`;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    // Encode app_redirect and redirectUri in state for the callback
    const state = Buffer.from(JSON.stringify({
      appRedirect,
      redirectUri,
    })).toString('base64url');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      prompt: 'consent',
      state,
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error('[Fuchs] Mobile auth error:', error);
    res.status(500).send('Authentifizierungsfehler: ' + error.message);
  }
};

/**
 * Mobile OAuth callback - exchanges code for tokens and redirects to app
 * GET /api/mobile/auth/callback?code=...&state=...
 *
 * Google redirects the phone's browser here after sign-in.
 * We exchange the code for tokens (server-side) and redirect to the mobile app.
 */
const mobileGoogleCallback = async (req, res) => {
  let appRedirect = 'com.fuchsmetallbau.app://auth';

  try {
    const { code, error: authError, state } = req.query;

    // Decode state to get app redirect
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
        appRedirect = stateData.appRedirect || appRedirect;
      } catch {}
    }

    if (authError) {
      return res.redirect(`${appRedirect}?error=${encodeURIComponent(authError)}`);
    }

    if (!code || !state) {
      return res.redirect(`${appRedirect}?error=${encodeURIComponent('Ungültige Callback-Parameter')}`);
    }

    const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    const { redirectUri } = stateData;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    // Fetch user info using the access token
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userInfoResponse.json();

    // Calculate expires_in
    const expiresIn = tokens.expiry_date
      ? Math.floor((tokens.expiry_date - Date.now()) / 1000)
      : 3600;

    // Build redirect URL with tokens and user info
    const params = new URLSearchParams();
    params.set('access_token', tokens.access_token);
    if (tokens.refresh_token) params.set('refresh_token', tokens.refresh_token);
    params.set('expires_in', String(expiresIn));
    if (userInfo.name) params.set('user_name', userInfo.name);
    if (userInfo.email) params.set('user_email', userInfo.email);
    if (userInfo.picture) params.set('user_photo', userInfo.picture);

    const separator = appRedirect.includes('?') ? '&' : '?';
    res.redirect(`${appRedirect}${separator}${params.toString()}`);
  } catch (error) {
    console.error('[Fuchs] Mobile OAuth callback error:', error);
    res.redirect(`${appRedirect}?error=${encodeURIComponent(error.message || 'Auth fehlgeschlagen')}`);
  }
};

/**
 * Refresh access token for mobile app
 * POST /api/mobile/auth/refresh
 * Body: { refresh_token: string }
 *
 * Mobile app can't refresh tokens directly (needs client_secret for Web type).
 * This endpoint handles the refresh server-side.
 */
const mobileRefreshToken = async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token ist erforderlich' });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'Google OAuth nicht konfiguriert' });
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token });

    const { credentials } = await oauth2Client.refreshAccessToken();

    res.json({
      access_token: credentials.access_token,
      expires_in: credentials.expiry_date
        ? Math.floor((credentials.expiry_date - Date.now()) / 1000)
        : 3600,
    });
  } catch (error) {
    console.error('[Fuchs] Token refresh error:', error);
    res.status(401).json({ error: 'Token-Aktualisierung fehlgeschlagen' });
  }
};

/**
 * Exchange authorization code for tokens (for Desktop app type client IDs)
 * POST /api/mobile/auth/exchange
 * Body: { code, code_verifier, redirect_uri, client_id }
 *
 * The mobile app gets an auth code via expo-auth-session (using PKCE with custom scheme redirect).
 * It sends the code here for exchange because the backend has the client_secret.
 */
const mobileExchangeCode = async (req, res) => {
  try {
    const { code, code_verifier, redirect_uri, client_id } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code ist erforderlich' });
    }

    // Use unified GOOGLE_CLIENT_ID credentials
    const useClientId = client_id || process.env.GOOGLE_CLIENT_ID;
    const useClientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!useClientId || !useClientSecret) {
      return res.status(500).json({ error: 'Google OAuth nicht konfiguriert. Bitte Credentials im Dev-Tab konfigurieren.' });
    }

    // Build token exchange request
    const params = new URLSearchParams({
      code,
      client_id: useClientId,
      client_secret: useClientSecret,
      redirect_uri: redirect_uri || '',
      grant_type: 'authorization_code',
    });
    if (code_verifier) params.set('code_verifier', code_verifier);

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('[Fuchs] Token exchange error:', tokenData);
      return res.status(400).json({
        error: tokenData.error_description || tokenData.error || 'Token-Austausch fehlgeschlagen'
      });
    }

    // Fetch user info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userInfoResponse.json();

    res.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_in: tokenData.expires_in || 3600,
      user_name: userInfo.name || '',
      user_email: userInfo.email || '',
      user_photo: userInfo.picture || '',
    });
  } catch (error) {
    console.error('[Fuchs] Code exchange error:', error);
    res.status(500).json({ error: 'Fehler beim Token-Austausch: ' + error.message });
  }
};

/**
 * Exchange device code for tokens (Device Authorization Grant / RFC 8628)
 * POST /api/mobile/auth/device-token
 * Body: { device_code, client_id }
 *
 * The mobile app uses Google's device flow which doesn't need redirect URIs.
 * The app polls this endpoint after the user opens the browser to authenticate.
 * The backend adds the client_secret for the token exchange.
 */
const mobileDeviceToken = async (req, res) => {
  try {
    const { device_code, client_id } = req.body;

    if (!device_code) {
      return res.status(400).json({ error: 'device_code ist erforderlich' });
    }

    // Use unified GOOGLE_CLIENT_ID credentials
    const useClientId = client_id || process.env.GOOGLE_CLIENT_ID;
    const useClientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!useClientId || !useClientSecret) {
      return res.status(500).json({ error: 'Google OAuth nicht konfiguriert. Bitte Credentials im Dev-Tab konfigurieren.' });
    }

    // Exchange device code for tokens at Google
    const params = new URLSearchParams({
      client_id: useClientId,
      client_secret: useClientSecret,
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    const tokenData = await tokenResponse.json();

    // Pass through pending/slow_down status to the mobile app (not errors)
    if (tokenData.error === 'authorization_pending' || tokenData.error === 'slow_down') {
      return res.json({ error: tokenData.error });
    }

    if (!tokenResponse.ok || tokenData.error) {
      console.error('[Fuchs] Device token exchange error:', tokenData);
      return res.status(tokenResponse.ok ? 400 : tokenResponse.status).json({
        error: tokenData.error || 'token_error',
        error_description: tokenData.error_description || 'Token-Austausch fehlgeschlagen',
      });
    }

    // Fetch user info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userInfoResponse.json();

    res.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_in: tokenData.expires_in || 3600,
      user_name: userInfo.name || '',
      user_email: userInfo.email || '',
      user_photo: userInfo.picture || '',
    });
  } catch (error) {
    console.error('[Fuchs] Device token exchange error:', error);
    res.status(500).json({ error: 'Fehler beim Token-Austausch: ' + error.message });
  }
};

/**
 * Get mobile OAuth credentials (admin only)
 * GET /api/mobile/admin/credentials?password=netrock!
 */
const getAdminCredentials = (req, res) => {
  const { password } = req.query;
  if (!password || password !== 'netrock!"§$%&') {
    return res.status(403).json({ error: 'Falsches Admin-Passwort' });
  }

  res.json({
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ? '***configured***' : '',
  });
};

/**
 * Save mobile OAuth credentials to .env (admin only)
 * POST /api/mobile/admin/credentials
 * Body: { password, mobileClientId, mobileClientSecret }
 */
const saveAdminCredentials = (req, res) => {
  try {
    const { password, mobileClientId, mobileClientSecret } = req.body;

    if (!password || password !== 'netrock!"§$%&') {
      return res.status(403).json({ error: 'Falsches Admin-Passwort' });
    }

    if (!mobileClientId || !mobileClientSecret) {
      return res.status(400).json({ error: 'Client-ID und Client-Secret sind erforderlich' });
    }

    const envPath = path.join(__dirname, '../../.env');

    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    const envLines = envContent.split('\n');

    // Update or add GOOGLE_MOBILE_CLIENT_ID
    const clientIdIndex = envLines.findIndex(line => line.startsWith('GOOGLE_MOBILE_CLIENT_ID='));
    if (clientIdIndex !== -1) {
      envLines[clientIdIndex] = `GOOGLE_MOBILE_CLIENT_ID=${mobileClientId}`;
    } else {
      const hasComment = envLines.some(line => line.includes('Mobile App OAuth'));
      if (!hasComment) {
        envLines.push('');
        envLines.push('# Mobile App OAuth (Desktop app type for mobile Google Sign-In)');
      }
      envLines.push(`GOOGLE_MOBILE_CLIENT_ID=${mobileClientId}`);
    }

    // Update or add GOOGLE_MOBILE_CLIENT_SECRET
    const secretIndex = envLines.findIndex(line => line.startsWith('GOOGLE_MOBILE_CLIENT_SECRET='));
    if (secretIndex !== -1) {
      envLines[secretIndex] = `GOOGLE_MOBILE_CLIENT_SECRET=${mobileClientSecret}`;
    } else {
      envLines.push(`GOOGLE_MOBILE_CLIENT_SECRET=${mobileClientSecret}`);
    }

    fs.writeFileSync(envPath, envLines.join('\n'));

    // Update process.env so changes take effect immediately
    process.env.GOOGLE_MOBILE_CLIENT_ID = mobileClientId;
    process.env.GOOGLE_MOBILE_CLIENT_SECRET = mobileClientSecret;

    res.json({
      success: true,
      message: 'Mobile OAuth Zugangsdaten gespeichert',
    });
  } catch (error) {
    console.error('[Fuchs] Error saving admin credentials:', error);
    res.status(500).json({ error: 'Fehler beim Speichern: ' + error.message });
  }
};

// ============================================================
// PC-LOGIN BRIDGE
// Mobile app initiates, user completes OAuth on PC browser
// ============================================================

/**
 * Initialize a PC-login session for the mobile app
 * POST /api/mobile/auth/init-login
 *
 * The mobile app calls this when the Device Flow fails (e.g. wrong client type).
 * Returns a session ID and a localhost URL the user opens on their PC.
 */
const initPcLogin = (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'Google OAuth nicht konfiguriert (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET fehlen).' });
    }

    const sessionId = crypto.randomBytes(24).toString('hex');

    // Build the login URL using the request's host header so it works from any device
    const port = process.env.PORT || 3001;
    const host = req.headers.host || `localhost:${port}`;
    const protocol = req.protocol || 'http';
    const loginUrl = `${protocol}://${host}/api/mobile/auth/pc-login/${sessionId}`;

    // Also generate the direct Google OAuth URL for in-app WebView auth
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      prompt: 'consent',
      state: `mobile_login:${sessionId}`,
    });

    mobileLoginSessions.set(sessionId, {
      status: 'pending',
      tokens: null,
      userInfo: null,
      serverBaseUrl: `${protocol}://${host}`, // Store server URL for callback redirect
      expiresAt: Date.now() + MOBILE_LOGIN_EXPIRY_MS,
    });

    res.json({ sessionId, loginUrl, authUrl, redirectUri });
  } catch (error) {
    console.error('[Fuchs] initPcLogin error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * PC-login page - opened in the desktop browser
 * GET /api/mobile/auth/pc-login/:sessionId
 *
 * Redirects to Google OAuth with state=mobile_login:{sessionId}
 * Uses the SAME redirect URI as the desktop OAuth (already registered in Google Cloud Console)
 */
const pcLoginPage = (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = mobileLoginSessions.get(sessionId);

    if (!session || Date.now() > session.expiresAt) {
      return res.status(410).send(`
        <!DOCTYPE html><html><head><meta charset="utf-8"><title>Link abgelaufen</title>
        <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#fff}
        .box{background:#16213e;padding:40px;border-radius:12px;text-align:center;max-width:400px}
        h1{color:#e74c3c}</style></head>
        <body><div class="box"><h1>Link abgelaufen</h1><p>Bitte starte den Login-Vorgang erneut in der Handy-App.</p></div></body></html>
      `);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      prompt: 'consent',
      state: `mobile_login:${sessionId}`,
    });

    // Build the current server URL from request headers (for polling endpoint)
    const port = process.env.PORT || 3001;
    const host = req.headers.host || `localhost:${port}`;
    const protocol = req.protocol || 'http';
    const pollUrl = `${protocol}://${host}/api/mobile/auth/poll-login`;

    // Serve an HTML page that handles the login flow
    // The page auto-polls the server for login completion
    res.send(`<!DOCTYPE html><html lang="de"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Google Anmeldung</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
          display:flex;justify-content:center;align-items:center;min-height:100vh;
          margin:0;background:#1a1a2e;color:#fff;padding:20px}
        .box{background:#16213e;padding:32px;border-radius:16px;text-align:center;
          max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.3)}
        h1{font-size:22px;margin-bottom:8px}
        .subtitle{color:#94a3b8;font-size:14px;line-height:1.5;margin-bottom:24px}
        .btn{display:block;width:100%;padding:14px 24px;border-radius:10px;
          font-size:16px;font-weight:600;text-decoration:none;text-align:center;
          cursor:pointer;border:none;margin-bottom:12px}
        .btn-google{background:#4285F4;color:#fff}
        .btn-google:hover{background:#3367d6}
        .status{display:none;margin-top:20px;padding:16px;border-radius:10px;
          background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3)}
        .status.show{display:block}
        .status.success h2{color:#22c55e}
        .spinner{display:inline-block;width:20px;height:20px;border:2px solid #94a3b8;
          border-top-color:#3b82f6;border-radius:50%;animation:spin 1s linear infinite;
          margin-right:8px;vertical-align:middle}
        @keyframes spin{to{transform:rotate(360deg)}}
        .waiting{color:#94a3b8;font-size:14px;margin-top:16px}
        .icon{font-size:48px;margin-bottom:12px}
      </style>
    </head><body>
      <div class="box">
        <div class="icon">&#128274;</div>
        <h1>Google Anmeldung</h1>
        <p class="subtitle">Melde dich mit deinem Google-Konto an, um die App mit dem Server zu verbinden.</p>
        <a id="loginBtn" class="btn btn-google" href="${authUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">Mit Google anmelden</a>
        <div class="waiting" id="waitingMsg">
          <span class="spinner"></span> Warte auf Anmeldung...
        </div>
        <div class="status" id="successMsg">
          <h2 style="color:#22c55e;font-size:18px">&#10004; Anmeldung erfolgreich!</h2>
          <p style="color:#94a3b8;margin-top:8px">Du kannst den Browser jetzt schliessen und zur App zurückkehren.</p>
        </div>
        <p class="hint" id="hintMsg" style="color:#64748b;font-size:12px;margin-top:16px;line-height:1.5">
          Nach der Google-Anmeldung kannst du den anderen Tab schliessen und hierher zurückkehren.
          Diese Seite erkennt automatisch, wenn die Anmeldung abgeschlossen ist.
        </p>
      </div>
      <script>
        // Poll for login completion
        var sessionId = '${sessionId}';
        var pollUrl = '${pollUrl}';
        function pollStatus() {
          fetch(pollUrl, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({sessionId: sessionId})
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.status === 'complete') {
              document.getElementById('loginBtn').style.display = 'none';
              document.getElementById('waitingMsg').style.display = 'none';
              document.getElementById('hintMsg').style.display = 'none';
              document.getElementById('successMsg').classList.add('show');
            } else if (data.error) {
              // Session expired or failed
            } else {
              setTimeout(pollStatus, 3000);
            }
          })
          .catch(function() { setTimeout(pollStatus, 5000); });
        }
        // Start polling immediately
        setTimeout(pollStatus, 2000);
      </script>
    </body></html>`);
  } catch (error) {
    console.error('[Fuchs] pcLoginPage error:', error);
    res.status(500).send('Fehler: ' + error.message);
  }
};

/**
 * Handle the OAuth callback for mobile PC-login
 * Called from the auth callback route when state starts with "mobile_login:"
 *
 * @param {Request} req
 * @param {Response} res
 * @param {string} code - Authorization code from Google
 * @param {string} sessionId - Mobile login session ID
 */
const handleMobilePcCallback = async (req, res, code, sessionId) => {
  try {
    const session = mobileLoginSessions.get(sessionId);
    if (!session || Date.now() > session.expiresAt) {
      return res.send(`
        <!DOCTYPE html><html><head><meta charset="utf-8"><title>Session abgelaufen</title>
        <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#fff}
        .box{background:#16213e;padding:40px;border-radius:12px;text-align:center;max-width:400px}
        h1{color:#e74c3c}</style></head>
        <body><div class="box"><h1>Session abgelaufen</h1><p>Bitte starte den Login erneut in der Handy-App.</p></div></body></html>
      `);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);

    // Fetch user info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userInfoResponse.json();

    const expiresIn = tokens.expiry_date
      ? Math.floor((tokens.expiry_date - Date.now()) / 1000)
      : 3600;

    // Store tokens in session for the mobile app to poll
    session.status = 'complete';
    session.tokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_in: expiresIn,
    };
    session.userInfo = {
      name: userInfo.name || '',
      email: userInfo.email || '',
      photo: userInfo.picture || '',
    };

    console.log(`[Fuchs] Mobile PC-login successful for ${userInfo.email || 'unknown'}`);

    // Try to redirect to the server's network IP (stored in session from initPcLogin)
    // so the success page loads correctly even on the phone
    const serverBaseUrl = session.serverBaseUrl;
    if (serverBaseUrl && !serverBaseUrl.includes('localhost')) {
      return res.redirect(`${serverBaseUrl}/api/mobile/auth/login-done`);
    }

    res.send(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>Anmeldung erfolgreich</title>
      <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#fff}
      .box{background:#16213e;padding:40px;border-radius:12px;text-align:center;max-width:420px}
      h1{color:#22c55e}.icon{font-size:64px;margin-bottom:16px}
      p{color:#94a3b8;line-height:1.6}
      button{background:#3b82f6;color:#fff;border:none;padding:12px 30px;border-radius:8px;cursor:pointer;font-size:16px;margin-top:16px}
      button:hover{background:#2563eb}</style></head>
      <body><div class="box">
        <div class="icon">&#10004;</div>
        <h1>Anmeldung erfolgreich!</h1>
        <p>Du bist als <strong>${userInfo.email || userInfo.name || 'User'}</strong> angemeldet.</p>
        <p>Du kannst dieses Fenster schliessen. Die App verbindet sich automatisch.</p>
        <button onclick="window.close()">Fenster schliessen</button>
      </div></body></html>
    `);
  } catch (error) {
    console.error('[Fuchs] Mobile PC-login callback error:', error);
    const session = mobileLoginSessions.get(sessionId);
    if (session) {
      session.status = 'error';
      session.error = error.message;
    }
    res.send(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>Fehler</title>
      <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#fff}
      .box{background:#16213e;padding:40px;border-radius:12px;text-align:center;max-width:420px}
      h1{color:#e74c3c}p{color:#94a3b8;line-height:1.6}
      .err{background:rgba(239,68,68,0.15);padding:12px;border-radius:8px;margin:16px 0;color:#fca5a5;word-break:break-word}</style></head>
      <body><div class="box"><h1>Anmeldung fehlgeschlagen</h1><div class="err">${error.message}</div>
      <p>Bitte versuche es erneut in der Handy-App.</p></div></body></html>
    `);
  }
};

/**
 * Poll for PC-login result
 * POST /api/mobile/auth/poll-login
 * Body: { sessionId }
 */
const pollPcLogin = (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId fehlt' });
    }

    const session = mobileLoginSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'session_expired', message: 'Login-Session nicht gefunden oder abgelaufen.' });
    }

    if (Date.now() > session.expiresAt) {
      mobileLoginSessions.delete(sessionId);
      return res.status(410).json({ error: 'session_expired', message: 'Login-Session abgelaufen.' });
    }

    if (session.status === 'complete' && session.tokens) {
      // Return tokens and clean up
      const result = {
        status: 'complete',
        access_token: session.tokens.access_token,
        refresh_token: session.tokens.refresh_token,
        expires_in: session.tokens.expires_in,
        user_name: session.userInfo?.name || '',
        user_email: session.userInfo?.email || '',
        user_photo: session.userInfo?.photo || '',
      };
      mobileLoginSessions.delete(sessionId);
      return res.json(result);
    }

    if (session.status === 'error') {
      const error = session.error;
      mobileLoginSessions.delete(sessionId);
      return res.status(400).json({ error: 'login_failed', message: error });
    }

    // Still pending
    res.json({ status: 'pending' });
  } catch (error) {
    console.error('[Fuchs] pollPcLogin error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get network addresses and drive paths for QR code setup page
 * GET /api/mobile/connect-info
 */
const getConnectInfo = (req, res) => {
  try {
    const networkAddresses = getNetworkAddresses();
    const serverPort = process.env.PORT || 3001;

    let drivePaths = [];
    try {
      drivePaths = db.prepare('SELECT id, name FROM drive_paths ORDER BY id ASC').all();
    } catch (e) {
      // Table might not exist yet
    }

    res.json({
      networkAddresses: networkAddresses.map(a => ({
        name: a.name,
        address: a.address,
        url: `http://${a.address}:${serverPort}`,
      })),
      drivePaths,
    });
  } catch (error) {
    console.error('Error getting connect info:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Success page after mobile login - served at the server's network IP
 * so it loads correctly on the phone
 * GET /api/mobile/auth/login-done
 */
const loginDonePage = (req, res) => {
  res.send(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>Anmeldung erfolgreich</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      display:flex;justify-content:center;align-items:center;min-height:100vh;
      margin:0;background:#1a1a2e;color:#fff;padding:20px}
    .box{background:#16213e;padding:40px;border-radius:16px;text-align:center;max-width:420px;width:100%}
    h1{color:#22c55e;font-size:22px}.icon{font-size:64px;margin-bottom:16px}
    p{color:#94a3b8;line-height:1.6;margin-top:12px}
    button{background:#3b82f6;color:#fff;border:none;padding:14px 30px;border-radius:10px;
      cursor:pointer;font-size:16px;font-weight:600;margin-top:20px;width:100%}
    button:hover{background:#2563eb}</style></head>
    <body><div class="box">
      <div class="icon">&#10004;</div>
      <h1>Anmeldung erfolgreich!</h1>
      <p>Du kannst dieses Fenster jetzt schliessen und zur App zurückkehren.</p>
      <button onclick="window.close()">Fenster schliessen</button>
    </div></body></html>
  `);
};

/**
 * Proxy a Google Drive image through the server (browser can't access Drive URLs directly)
 * GET /api/mobile/inbox/image-proxy/:fileId
 */
const proxyInboxImage = async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId) {
      return res.status(400).json({ error: 'fileId ist erforderlich' });
    }

    const { getDriveClient } = require('../services/authService');
    const drive = await getDriveClient();

    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    // Forward content type from Google
    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');

    response.data.pipe(res);
  } catch (error) {
    console.error('Error proxying inbox image:', error.message);
    res.status(500).json({ error: 'Bild konnte nicht geladen werden' });
  }
};

/**
 * Process delete requests from mobile app
 * POST /api/mobile/inbox/process-delete
 * Body: { requestIds: string[] } - IDs of delete requests to process
 */
const processDeleteRequests = async (req, res) => {
  try {
    const { requestIds } = req.body;
    if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
      return res.status(400).json({ error: 'requestIds (Array) ist erforderlich' });
    }

    // Get inbox folder and read delete_requests.json
    const drivePath = db.prepare('SELECT path FROM drive_paths LIMIT 1').get();
    if (!drivePath) {
      return res.status(400).json({ error: 'Kein Google Drive Ordner konfiguriert' });
    }

    let rootFolderId = drivePath.path;
    const urlMatch = drivePath.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) rootFolderId = urlMatch[1];

    const metaFolder = await findSubfolder(rootFolderId, 'NR_Fuchs_Meta');
    if (!metaFolder) return res.status(400).json({ error: 'NR_Fuchs_Meta nicht gefunden' });

    const inboxFolder = await findSubfolder(metaFolder.id, 'inbox');
    if (!inboxFolder) return res.status(400).json({ error: 'Inbox nicht gefunden' });

    // Find and read delete_requests.json
    const allFiles = await listAllFilesInFolder(inboxFolder.id);
    const deleteFile = allFiles.find(f => f.name === 'delete_requests.json');
    if (!deleteFile) return res.status(404).json({ error: 'Keine Löschanfragen gefunden' });

    const allRequests = await readDriveFileAsJson(deleteFile.id);
    if (!Array.isArray(allRequests)) {
      return res.status(400).json({ error: 'Ungültiges Format der Löschanfragen' });
    }

    // Process each requested deletion
    const requestsToProcess = allRequests.filter(r => requestIds.includes(r.id));
    let deletedCount = 0;
    const errors = [];

    // Get project settings for local deletion
    const settings = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();

    // Find Projekte folder on Drive for searching
    const projekteFolder = await findSubfolder(metaFolder.id, 'Projekte');

    for (const req of requestsToProcess) {
      try {
        let fileDeleted = false;

        // Search for the file on Drive
        // 1. If project_id is set, search in that folder
        // 2. Otherwise search in Projekte/ subfolders by project_name
        // 3. Also search in inbox subfolders
        const searchFolders = [];

        if (req.project_id) {
          searchFolders.push(req.project_id);
        }

        if (req.project_name && projekteFolder) {
          const projFolder = await findSubfolder(projekteFolder.id, req.project_name);
          if (projFolder) searchFolders.push(projFolder.id);
        }

        // Search for the file in each potential folder
        for (const folderId of searchFolders) {
          try {
            const files = await listAllFilesInFolder(folderId);
            const match = files.find(f => f.name === req.file_name);
            if (match) {
              await deleteFileFromDrive(match.id);
              fileDeleted = true;
              console.log(`🗑️ Deleted "${req.file_name}" from Drive (folder ${folderId})`);
              break;
            }
          } catch (e) {
            console.error(`Error searching folder ${folderId}:`, e.message);
          }
        }

        // Delete from local Bilder/ folder
        if (settings?.project_path && req.project_name) {
          const localPath = path.join(settings.project_path, req.project_name, 'Bilder', req.file_name);
          if (await fs.pathExists(localPath)) {
            await fs.remove(localPath);
            console.log(`🗑️ Deleted local file: ${localPath}`);
          }
        }

        // Delete from drive_images DB if exists
        try {
          db.prepare('DELETE FROM drive_images WHERE original_name = ?').run(req.file_name);
        } catch {}

        if (fileDeleted) deletedCount++;
        else errors.push(`"${req.file_name}" nicht auf Drive gefunden`);
      } catch (e) {
        console.error(`Error processing delete request for ${req.file_name}:`, e.message);
        errors.push(`"${req.file_name}": ${e.message}`);
      }
    }

    // Remove processed requests from delete_requests.json
    const remaining = allRequests.filter(r => !requestIds.includes(r.id));
    if (remaining.length > 0) {
      await updateDriveFileContent(deleteFile.id, remaining);
    } else {
      // No more requests → delete the file entirely
      await deleteFileFromDrive(deleteFile.id);
    }

    res.json({
      success: true,
      deletedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `${deletedCount} ${deletedCount === 1 ? 'Bild' : 'Bilder'} gelöscht`,
    });
  } catch (error) {
    console.error('Error processing delete requests:', error);
    res.status(500).json({ error: 'Löschen fehlgeschlagen: ' + error.message });
  }
};

/**
 * Dismiss delete requests without deleting the actual files
 * POST /api/mobile/inbox/dismiss-delete
 * Body: { requestIds: string[] }
 */
const dismissDeleteRequests = async (req, res) => {
  try {
    const { requestIds } = req.body;
    if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
      return res.status(400).json({ error: 'requestIds (Array) ist erforderlich' });
    }

    const drivePath = db.prepare('SELECT path FROM drive_paths LIMIT 1').get();
    if (!drivePath) return res.status(400).json({ error: 'Kein Google Drive Ordner konfiguriert' });

    let rootFolderId = drivePath.path;
    const urlMatch = drivePath.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) rootFolderId = urlMatch[1];

    const metaFolder = await findSubfolder(rootFolderId, 'NR_Fuchs_Meta');
    if (!metaFolder) return res.status(400).json({ error: 'NR_Fuchs_Meta nicht gefunden' });

    const inboxFolder = await findSubfolder(metaFolder.id, 'inbox');
    if (!inboxFolder) return res.status(400).json({ error: 'Inbox nicht gefunden' });

    const allFiles = await listAllFilesInFolder(inboxFolder.id);
    const deleteFile = allFiles.find(f => f.name === 'delete_requests.json');
    if (!deleteFile) return res.status(404).json({ error: 'Keine Löschanfragen gefunden' });

    const allRequests = await readDriveFileAsJson(deleteFile.id);
    const remaining = Array.isArray(allRequests)
      ? allRequests.filter(r => !requestIds.includes(r.id))
      : [];

    if (remaining.length > 0) {
      await updateDriveFileContent(deleteFile.id, remaining);
    } else {
      await deleteFileFromDrive(deleteFile.id);
    }

    res.json({ success: true, dismissed: requestIds.length });
  } catch (error) {
    console.error('Error dismissing delete requests:', error);
    res.status(500).json({ error: 'Fehler: ' + error.message });
  }
};

/**
 * Preview a delete request image from local project folder
 * GET /api/mobile/inbox/delete-preview/:projectName/:fileName
 */
const previewDeleteRequestImage = async (req, res) => {
  try {
    const { projectName, fileName } = req.params;
    const settings = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    if (!settings?.project_path) {
      return res.status(404).json({ error: 'Kein Projektpfad konfiguriert' });
    }

    const filePath = path.join(settings.project_path, projectName, 'Bilder', fileName);
    if (await fs.pathExists(filePath)) {
      return res.sendFile(path.resolve(filePath));
    }

    res.status(404).json({ error: 'Bild nicht lokal gefunden' });
  } catch (error) {
    console.error('Error serving delete request preview:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Scan NR_Fuchs_Meta/Projekte/ for new images not yet downloaded locally.
 * Compares Drive images with local project Bilder/ folders.
 * GET /api/mobile/project-changes
 */
const getProjectChanges = async (req, res) => {
  try {
    const drivePath = db.prepare('SELECT path FROM drive_paths LIMIT 1').get();
    if (!drivePath) {
      return res.json({ changes: [] });
    }

    let rootFolderId = drivePath.path;
    const urlMatch = drivePath.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) rootFolderId = urlMatch[1];

    const metaFolder = await findSubfolder(rootFolderId, 'NR_Fuchs_Meta');
    if (!metaFolder) {
      return res.json({ changes: [] });
    }

    const projekteFolder = await findSubfolder(metaFolder.id, 'Projekte');
    if (!projekteFolder) {
      return res.json({ changes: [] });
    }

    // List all project subfolders in Projekte/
    const projectFolders = await listFoldersInFolder(projekteFolder.id);
    if (projectFolders.length === 0) {
      return res.json({ changes: [] });
    }

    // Get local project base path
    const settings = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    const projectBasePath = settings?.project_path;

    // Get ignored file IDs (files previously deleted by user - should not reappear)
    const ignoredFileIds = new Set(
      db.prepare('SELECT drive_file_id FROM ignored_files').all().map(r => r.drive_file_id)
    );

    const changes = [];

    for (const folder of projectFolders) {
      try {
        // List images on Drive in this project folder
        const driveImages = await listFilesInFolder(folder.id);
        if (driveImages.length === 0) continue;

        // Get local images for this project
        let localImageNames = new Set();
        if (projectBasePath) {
          const localBilderPath = path.join(projectBasePath, folder.name, 'Bilder');
          if (await fs.pathExists(localBilderPath)) {
            const localFiles = await fs.readdir(localBilderPath);
            localImageNames = new Set(localFiles.map(f => f.toLowerCase()));
          }
        }

        // Find new images (on Drive but not local, and not previously ignored/deleted)
        const newImages = driveImages.filter(img =>
          !localImageNames.has(img.name.toLowerCase()) && !ignoredFileIds.has(img.id)
        );

        if (newImages.length > 0) {
          // Check if project exists in DB
          const project = db.prepare('SELECT id, folder_name, color FROM projects WHERE folder_name = ?').get(folder.name);

          changes.push({
            project_name: folder.name,
            project_id: project?.id || null,
            project_color: project?.color || '#3b82f6',
            drive_folder_id: folder.id,
            new_images: newImages.map(img => ({
              id: img.id,
              name: img.name,
              size: img.size,
            })),
            total_drive_images: driveImages.length,
            total_local_images: localImageNames.size,
          });
        }
      } catch (e) {
        console.error(`Error scanning project folder "${folder.name}":`, e.message);
      }
    }

    res.json({ changes });
  } catch (error) {
    console.error('Error getting project changes:', error);
    res.status(500).json({ error: 'Fehler beim Scannen der Projektänderungen' });
  }
};

/**
 * Proxy image from NR_Fuchs_Meta/Projekte/ for preview in the UI.
 * GET /api/mobile/project-changes/image-proxy/:fileId
 */
const proxyProjectChangeImage = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { getDriveClient } = require('../services/authService');
    const drive = await getDriveClient();

    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    response.data.pipe(res);
  } catch (error) {
    console.error('Error proxying project change image:', error.message);
    res.status(404).json({ error: 'Bild nicht gefunden' });
  }
};

/**
 * Confirm project changes: download new images to local project folder.
 * POST /api/mobile/project-changes/confirm
 * Body: { projectName, fileIds }
 */
const confirmProjectChanges = async (req, res) => {
  try {
    const { projectName, fileIds } = req.body;

    if (!projectName || !fileIds || fileIds.length === 0) {
      return res.status(400).json({ error: 'projectName und fileIds sind erforderlich' });
    }

    const settings = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    if (!settings?.project_path) {
      return res.status(400).json({ error: 'Kein Projektpfad konfiguriert' });
    }

    const bilderFolder = path.join(settings.project_path, projectName, 'Bilder');
    await fs.ensureDir(bilderFolder);

    // Ensure project exists in DB
    let project = db.prepare('SELECT id FROM projects WHERE folder_name = ?').get(projectName);
    if (!project) {
      const insertResult = db.prepare('INSERT INTO projects (folder_name, color, notes) VALUES (?, ?, ?)')
        .run(projectName, '#3b82f6', '');
      project = { id: insertResult.lastInsertRowid };
    }

    let downloaded = 0;
    for (const fileId of fileIds) {
      try {
        const meta = await getFileMetadata(fileId);
        const destPath = path.join(bilderFolder, meta.name);
        if (!await fs.pathExists(destPath)) {
          await downloadFile(fileId, destPath);
        }
        downloaded++;

        // Register in drive_images with drive_file_id so it can be tracked for Drive deletion
        const existingImg = db.prepare('SELECT id FROM drive_images WHERE drive_file_id = ?').get(fileId);
        if (!existingImg) {
          const projectImageUrl = `/api/projects/${project.id}/file/image/${encodeURIComponent(meta.name)}`;
          const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
          let fileSize = null;
          try {
            const stats = await fs.stat(destPath);
            fileSize = stats.size;
          } catch (e) { /* ignore */ }

          const imgResult = db.prepare(`
            INSERT INTO drive_images (
              name, original_name, local_path, thumbnail_url, file_url,
              mime_type, drive_file_id, drive_path_id, file_size, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          `).run(
            meta.name, meta.name, projectImageUrl, projectImageUrl, projectImageUrl,
            meta.mimeType || 'image/jpeg', fileId, fileSize, now
          );

          // Create project assignment
          db.prepare('INSERT OR IGNORE INTO image_project_assignments (image_id, project_id) VALUES (?, ?)')
            .run(imgResult.lastInsertRowid, project.id);
        } else {
          // Image already registered - ensure project assignment exists
          db.prepare('INSERT OR IGNORE INTO image_project_assignments (image_id, project_id) VALUES (?, ?)')
            .run(existingImg.id, project.id);
        }
      } catch (e) {
        console.error(`Error downloading file ${fileId}:`, e.message);
      }
    }

    res.json({
      success: true,
      message: `${downloaded}/${fileIds.length} Bilder für "${projectName}" heruntergeladen`,
    });
  } catch (error) {
    console.error('Error confirming project changes:', error);
    res.status(500).json({ error: 'Fehler beim Bestätigen: ' + error.message });
  }
};

/**
 * Reject project changes: delete images from Drive project folder.
 * POST /api/mobile/project-changes/reject
 * Body: { projectName, fileIds }
 */
const rejectProjectChanges = async (req, res) => {
  try {
    const { projectName, fileIds } = req.body;

    if (!fileIds || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds sind erforderlich' });
    }

    let deleted = 0;
    for (const fileId of fileIds) {
      try {
        await deleteFileFromDrive(fileId);
        deleted++;
      } catch (e) {
        console.error(`Error deleting file ${fileId} from Drive:`, e.message);
      }
    }

    res.json({
      success: true,
      message: `${deleted}/${fileIds.length} Bilder aus "${projectName}" gelöscht`,
    });
  } catch (error) {
    console.error('Error rejecting project changes:', error);
    res.status(500).json({ error: 'Fehler beim Ablehnen: ' + error.message });
  }
};

module.exports = {
  generateConnectToken,
  getConnectInfo,
  connectLandingPage,
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
  getInbox,
  getInboxImages,
  proxyInboxImage,
  confirmInboxProject,
  addToLibrary,
  mergeInboxProject,
  mergeSelectedInboxImages,
  deleteInboxImages,
  deleteInboxProject,
  processDeleteRequests,
  dismissDeleteRequests,
  previewDeleteRequestImage,
  getProjectChanges,
  proxyProjectChangeImage,
  confirmProjectChanges,
  rejectProjectChanges,
  mobileGoogleAuth,
  mobileGoogleCallback,
  mobileRefreshToken,
  mobileExchangeCode,
  mobileDeviceToken,
  getAdminCredentials,
  saveAdminCredentials,
  initPcLogin,
  pcLoginPage,
  loginDonePage,
  handleMobilePcCallback,
  pollPcLogin,
  deviceHeartbeat,
};
