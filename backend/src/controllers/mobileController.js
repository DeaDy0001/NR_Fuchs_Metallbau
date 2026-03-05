const db = require('../config/database');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { compressImage, generateThumbnail, findSubfolder, findOrCreateSubfolder, moveFileOnDrive, listFoldersInFolder, listFilesInFolder, extractFolderId, deleteFileFromDrive, downloadFile, getFileMetadata, listAllFilesInFolder, readDriveFileAsJson, updateDriveFileContent, shareFolderWithUser, removeFolderPermission } = require('../services/googleDriveService');
const { readExifData, writeExifData } = require('../services/exifService');
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
// INBOX ACTIVITY LOG
// ============================================================

/**
 * Log a new activity entry. source_id is used for deduplication:
 * same source_id will not be inserted twice.
 */
const logActivity = (type, title, description, deviceName, sourceId) => {
  try {
    if (sourceId) {
      const existing = db.prepare('SELECT id FROM inbox_activities WHERE source_id = ?').get(sourceId);
      if (existing) return;
    }
    db.prepare(`
      INSERT INTO inbox_activities (type, title, description, device_name, source_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(type, title, description || null, deviceName || null, sourceId || null);
  } catch (e) {
    console.error('Error logging activity:', e.message);
  }
};

/** Mark a source_id as already-logged without creating a visible activity entry. */
const markSourceIdSeen = (sourceId) => {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO inbox_activities (type, title, source_id, is_new)
      VALUES ('_marker', '', ?, 0)
    `).run(sourceId);
  } catch (e) {
    console.error('Error marking source_id seen:', e.message);
  }
};

/** GET /api/mobile/activities */
const getActivities = (req, res) => {
  try {
    if (req.query.unread_count === '1') {
      const row = db.prepare("SELECT COUNT(*) as count FROM inbox_activities WHERE is_new = 1 AND type != '_marker'").get();
      return res.json({ unread_count: row.count });
    }
    const activities = db.prepare(
      "SELECT * FROM inbox_activities WHERE type != '_marker' ORDER BY created_at DESC"
    ).all();
    const unreadRow = db.prepare("SELECT COUNT(*) as count FROM inbox_activities WHERE is_new = 1 AND type != '_marker'").get();
    res.json({ activities, unread_count: unreadRow.count });
  } catch (e) {
    console.error('Error getting activities:', e.message);
    res.status(500).json({ error: 'Fehler beim Laden der Aktivitäten' });
  }
};

/** POST /api/mobile/activities/read – mark all as read */
const markActivitiesRead = (req, res) => {
  try {
    db.prepare("UPDATE inbox_activities SET is_new = 0 WHERE is_new = 1").run();
    res.json({ success: true });
  } catch (e) {
    console.error('Error marking activities read:', e.message);
    res.status(500).json({ error: 'Fehler beim Markieren' });
  }
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
    // Use GOOGLE_MOBILE_CLIENT_ID (TV/Limited Input type) for mobile Device Flow,
    // fall back to GOOGLE_CLIENT_ID if not set
    const googleClientId = process.env.GOOGLE_MOBILE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_MOBILE_CLIENT_SECRET || '';
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

    // Include Web Application credentials so mobile app can do WebView OAuth
    // directly with Google (without needing to reach this server)
    const webClientId = process.env.GOOGLE_CLIENT_ID || '';
    const webClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const webRedirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';

    // Build QR code data as JSON for the mobile app to parse
    const qrPayload = {
      type: 'fuchs_drive',
      googleClientId,
      googleClientSecret: googleClientSecret || undefined,
      rootFolderId,
      name: drivePath.name || 'Fuchs Metallbau',
      serverUrl,
      webClientId: webClientId !== googleClientId ? webClientId : undefined,
      webClientSecret: webClientSecret !== googleClientSecret ? webClientSecret : undefined,
      webRedirectUri,
    };

    // Encode payload as base64url in a URL so:
    // - Phone camera scan → opens landing page with APK download
    // - In-app scan → app extracts connection data from URL
    const encodedData = Buffer.from(JSON.stringify(qrPayload)).toString('base64url');
    const qrUrl = `${serverUrl}/api/mobile/connect/setup?d=${encodedData}`;

    res.json({
      qrData: qrUrl,
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
    let apkTimestamp = '';
    if (apkExists) {
      const stats = fs.statSync(apkPath);
      const mb = (stats.size / (1024 * 1024)).toFixed(1);
      apkSize = `${mb} MB`;
      apkTimestamp = String(stats.mtimeMs | 0);
    }

    const connectionData = JSON.stringify({ token, serverUrl });

    res.send(buildLandingPageHtml({ isValid, serverUrl, apkExists, apkSize, apkTimestamp, connectionData }));
  } catch (error) {
    console.error('Error serving connect page:', error);
    res.status(500).send('Fehler beim Laden der Seite');
  }
};

/**
 * Setup landing page - dual purpose QR code endpoint
 * GET /api/mobile/connect/setup?d=<base64url-encoded-json>
 *
 * When scanned with phone camera → shows landing page with APK download
 * When scanned in the app → app extracts connection data from URL
 */
const connectSetupPage = (req, res) => {
  try {
    const { d } = req.query;
    if (!d) {
      return res.status(400).send('Ungültiger Link - kein Daten-Parameter');
    }

    // Decode the payload
    let payload;
    try {
      payload = JSON.parse(Buffer.from(d, 'base64url').toString('utf-8'));
    } catch {
      return res.status(400).send('Ungültiger Link - Daten konnten nicht gelesen werden');
    }

    const serverUrl = payload.serverUrl || `${req.protocol}://${req.hostname}:${req.socket.localPort}`;
    const driveName = payload.name || 'Fuchs Metallbau';

    // Check if APK exists
    const apkPath = path.join(__dirname, '../../../mobile-app/android/app.apk');
    const apkExists = fs.existsSync(apkPath);
    let apkSize = '';
    let apkTimestamp = '';
    if (apkExists) {
      const stats = fs.statSync(apkPath);
      const mb = (stats.size / (1024 * 1024)).toFixed(1);
      apkSize = `${mb} MB`;
      apkTimestamp = String(stats.mtimeMs | 0);
    }

    // The same QR URL that brought the user here - they'll scan it again in the app
    const qrUrl = `${serverUrl}/api/mobile/connect/setup?d=${d}`;

    res.send(buildSetupPageHtml({ serverUrl, driveName, apkExists, apkSize, apkTimestamp, qrUrl }));
  } catch (error) {
    console.error('Error serving setup page:', error);
    res.status(500).send('Fehler beim Laden der Seite');
  }
};

function buildLandingPageHtml({ isValid, serverUrl, apkExists, apkSize, apkTimestamp, connectionData }) {
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
      width:40px;height:40px;
      margin:0 auto 20px;
    }
    .logo img{width:40px;height:40px;border-radius:8px;object-fit:contain;display:block}
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
    <div class="logo"><img src="data:image/png;base64,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d9xxx/79++N97h5W9QQwxKT6o5//orq25vqZM/8+Z2aL1BRMA1RAZeHEMXte60ezKmyVWExasWWI1JqGGZT/0dTXzp/z9tLEbTx45IGHHirqotV435gIqW40aoMTv/e9Ieuvb4EGNv2iKPbpMrQtjjs8lwteIgF93M3YrYdRdRYV6xMpwbXv2Vj/kw02GlCd+/PFF/2/75wWF+L1N95gnkuL2Vg2qZIS6L01HrIpaMKsXoeSHZbPA3jhpRdaW1u7T53adVUIgHVfZwAAGDZsGBE9++yzX/jCF5YsWXLTTTf95S9/qa+vz676s3YfKxVl+6jPki0LABDHcS6Xe+mll4488sihQ4eed9553/rWt5566qk77rhjhx12IKLVvbJTGOJEZJORI0449vgEuG3pwu9PfvXOcolyhTpxxiWqsfjC2l4cQlAV+1ycVgrkcrnq/7YVj5v0WnHTDfc/4IsCHHX0sQ21deLc6vxciIBIG3s1/L8zTn/hmee+87NfXNbW/I3XX/nX4tbE9G1AH9G4zKrsP/bYeSypVSeElG1KseeqtJzsBvPzISMHVeX/9I//u/wvl+y87Q7LgLKqJQMVISUFvycAFACUlRxprfqNcgUAs2bNnvDmBADdodbpOiwEwLova5FbW1sBbLDBBgsXLjz00EPL5fK999575JFHViqVrKTMJ+xpJSIRySaoGGOee+65Qw89dNttt73llluOO+64119//eqrr95mm22ccx919xIhMJGKnv7DM2travoMHeQ23eDcGZPPnTPjTVOoMY3spGLd2j4PKOuRL9jGZq392fRJf5g95WvHn/DCE8/GoCiOjjjhSAWI49XLOSJlJ5p417dv79/87jevvvraUaf/4Mq25u++/vItbR2t1X1iW8WfYNVeNjjMSrHnQmpqKlTtKU3bt/P006Ej+sbRqT88/bYbbs6xSRJnRVnfvQqskxBAGjlODAmlW8QFy+y9e/655z/euQWrLwRAT9HW1gagd+/eJ5100ty5c2+99dZ99tknSZKPVE7g/ahq1vRba8ePH3/UUUftuOOOt99++ymnnDJ58uQrrrhi0003zfqXsp6l1T+yEBzBKjnxQ4cM/t53vlteVrzv+n8ff+IJY1raTp/01i0dbcVqU2UqqgIo6XunmXRzy7tArC3bvL23Ujl20oS3+va/9b+3XfmPyydPmXrn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lXd9gFf+OjMPGDBgwIABO+200wknnLBs2bJzzjnn/PPPZ+Z+/fr17ds36wL6gG79bPBZVffdd9/Bgwf/7W9/u+SSSz4gAARkyChwwBcO+MlPf/TKsiWDG+rEqemiHm2CeuMRRU8vXlLX0Gvvz+2mUPD79v8AyJbUXXnllQC+/e1v4/2bvGzQ+9vfOnrUsPUu+b+LXnn8sUenTGnqP7hXFDtfLKlab9lwyp4scs5lm/4YhZAKCemKrbiIoMvn0qaGSZUBUlFf9l4YuoWJN+k74PBeAx9cuvi/r792xFFHXXXjdeedd9GXv/Sls/r1e721Ze9qm3oBbJePzWazUUmRYvnQvNrs3aD325oy+CRCAATv0Nnn/thjjwHYa6+9mPnxxx8/5ZRT3njjjUKhcNxxxx199NG77rpr51Vq50SgTqvzRJ3lRbPpj5deeumll17a3Nx87LHHnnjiiTvttBNWpMUHHzArURdF0QknnHDBBRece+65NTU175cZBLKwTnXDjTbYZMstnx8//gu9GznpsqZFCKw+sbnnFy753JcOa+rfJ5WU3z8AsgGVUqn0z3/+88ADD/zQ2p9EVF9TfeCXvnDgF79w2913nvfHP/7wqXE75guHDR+2gYml3Ab4nLL3JATPgDIpSD2RCBnp7LShrJcdZsWFtoJXTMJHSTwqbRtpbmRT312bmv415+0xd937zFPP3HT5Vdvtuc+Ld/5334ahnBbXYHtMqEBZFUBcyK8446DrhXUAwTtkPRKq+uyzzw4fPnzTTTf9+9//Pnr06DfeeOO000574YUXrrjiij322IOZs+n82eOzaqAf6W49m7LJzP/85z+32mqrc845Z4cddnjhhReuvPLKnXbaSUSyveZX51BZi3nccce1tbXddttt2XjDKh9JIDDBe2Lab//9Xk7TFkd52K66jhVIHnZeIjNFDjroCwqofNAk0ywC77777kWLFp166qmdVVff7/EKTXzqygnKetiBB4178qm//efmmRuP+t6EiTcumJ8UcogYgqo0FoJjdSwVC09kxJrV2g5TrY8in1djy6iY0tJtXemXg4f+YNCQ9qVLD/nqoU89M246fNGZWLirxk1WRprVhqPEe6cKoFBVwPLmP+wL1vVCAATvRkStra0TJkz4yle+cs0115x88slbbbXVM888c9FFF22yySbZGq5sN+Csi+aj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ojHGNP1qvkm+v2hiibH3FonY0ChqRMUAig3FgiDS61K23733Ps/MnN8fz+51BYwksrDLnffrpcL17t1bdufMM3PmnOCHP7n8/AsuuHndyg8a0hW2wDDabCJNFCgFsxEkIest1zMDKCktLSsr29XPbnfmAoCzDbkV/285+kcjHRH99Kc/XbZs2fe///0LLrhgO1d+okX8nNxQmGs1s82nHRX9/6//+q9HHnkkk80opb4uHShaIBozanTHLl3e3ry+MaakBQC73cVBmawVLGx0gJazXvyt6pqx+48vKynWxliKtpubjte2fF1SyiAIHnrooWOOOaZbt25a65ZNIq1ter1CiOa+Lkoq5XleLkE29+ZsEQaaXilBgXVo/nLbbSPHj7t++aLlIiZkos02VidQcwBgYqoLwpQ1ALp16+Z53r+oBeJ8S64UhNOKorWOadOmTZkyZeDAgTfccMM3VOuMxn1rcz2t/tU9rTXWCilaJttEI8V555134403vv7a60cddVSUYLr1CEJExpqioqIDxu7/7rNP1gkuYkoDRkDa7RopmawhGWMIFiS9qpAXWXvOYYcAsDZk6UveRgsYa60Q8vXXX1+zZs2DDz7Y8hvlamNELzzVmFq7dt2atWurqqrS6bTve2Vl5Z07dezWtVt5eXluhyOKH/TVDQ8rKbScEN7j9z60935737Z22S/79vNS2bY6lEbFQNmAPSHrgmyjtQB69OiBr8/odb49FwCc1hKddK2trb3yyisBXH/99aWlpdtsdB5N5621Bjqm4kpKAJUbNn3yyScfz5+/+IsvNlZuqGtsEHG/vLzDnj17jhg2dNTo0X1691FCAAhDTQSpVHS5YYwdMmTI2L33vffe+4866qivrQtExIYhcPCBk5599snVxgwTiqEtILfvypiYpEWgoIwmT32SqofnH3TARABSKMI28laihRsi3Hfn7T0H9J006SDKslCykY0CxaQEsHjxkukvv/jyqy8t/HhB9eq1MpuNCqIGQAhkpSrr0GHPgQP223/8UYcddsB+4/1EAkBgQgmSEICwgiCUR6S1HjB44C033HjO+ReMra05tiCBdD2RrykhECikQ/LawMYAMxmyviV4rEEFG7MpKwiG+/bti+YyqLv6Se6eXABwWkuU2XL33XcvXrz4xBNPPP7446MeL9u8p7XW930FVbNx43PPTZ/2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" alt="Fuchs Metallbau Logo"></div>
    <h1>Fuchs Metallbau</h1>
    <p class="subtitle">Mobile App f\u00fcr Fotos &amp; Projekte</p>

    <div class="status ${isValid ? 'valid' : 'expired'}">
      <span class="dot"></span>
      ${isValid ? 'Verbindung bereit' : 'Token abgelaufen oder ung\u00fcltig'}
    </div>

    <div class="divider"></div>

    <p class="label">Schritt 1 \u2013 App installieren</p>
    ${apkExists ? `
    <a href="${serverUrl}/api/mobile/app.apk?v=${apkTimestamp}" class="btn btn-primary" download="FuchsMetallbau.apk">
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

function buildSetupPageHtml({ serverUrl, driveName, apkExists, apkSize, apkTimestamp, qrUrl }) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Fuchs Metallbau - App einrichten</title>
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
      margin:0 auto 20px;font-size:32px;overflow:hidden;
    }
    .logo img{width:44px;height:44px;object-fit:contain;display:block;border-radius:8px;}
    h1{font-size:22px;font-weight:700;margin-bottom:6px}
    .subtitle{font-size:14px;color:#94a3b8;margin-bottom:28px}
    .status{
      display:inline-flex;align-items:center;gap:8px;
      padding:8px 16px;border-radius:20px;font-size:13px;font-weight:600;
      margin-bottom:24px;background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(34,197,94,.3)
    }
    .dot{width:8px;height:8px;border-radius:50%;background:#4ade80}
    .divider{height:1px;background:#2a2a4a;margin:20px 0}
    .label{font-size:13px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
    .btn{
      display:flex;align-items:center;justify-content:center;gap:10px;
      width:100%;padding:14px 20px;border-radius:12px;font-size:16px;font-weight:600;
      text-decoration:none;border:none;cursor:pointer;transition:all .2s;
    }
    .btn-primary{background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff}
    .btn-primary:hover{opacity:.9}
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
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><img src="data:image/png;base64,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d9xxx/79++N97h5W9QQwxKT6o5//orq25vqZM/8+Z2aL1BRMA1RAZeHEMXte60ezKmyVWExasWWI1JqGGZT/0dTXzp/z9tLEbTx45IGHHirqotV435gIqW40aoMTv/e9Ieuvb4EGNv2iKPbpMrQtjjs8lwteIgF93M3YrYdRdRYV6xMpwbXv2Vj/kw02GlCd+/PFF/2/75wWF+L1N95gnkuL2Vg2qZIS6L01HrIpaMKsXoeSHZbPA3jhpRdaW1u7T53adVUIgHVfZwAAGDZsGBE9++yzX/jCF5YsWXLTTTf95S9/qa+vz676s3YfKxVl+6jPki0LABDHcS6Xe+mll4488sihQ4eed9553/rWt5566qk77rhjhx12IKLVvbJTGOJEZJORI0449vgEuG3pwu9PfvXOcolyhTpxxiWqsfjC2l4cQlAV+1ycVgrkcrnq/7YVj5v0WnHTDfc/4IsCHHX0sQ21deLc6vxciIBIG3s1/L8zTn/hmee+87NfXNbW/I3XX/nX4tbE9G1AH9G4zKrsP/bYeSypVSeElG1KseeqtJzsBvPzISMHVeX/9I//u/wvl+y87Q7LgLKqJQMVISUFvycAFACUlRxprfqNcgUAs2bNnvDmBADdodbpOiwEwLova5FbW1sBbLDBBgsXLjz00EPL5fK999575JFHViqVrKTMJ+xpJSIRySaoGGOee+65Qw89dNttt73llluOO+64119//eqrr95mm22ccx919xIhMJGKnv7DM2travoMHeQ23eDcGZPPnTPjTVOoMY3spGLd2j4PKOuRL9jGZq392fRJf5g95WvHn/DCE8/GoCiOjjjhSAWI49XLOSJlJ5p417dv79/87jevvvraUaf/4Mq25u++/vItbR2t1X1iW8WfYNVeNjjMSrHnQmpqKlTtKU3bt/P006Ej+sbRqT88/bYbbs6xSRJnRVnfvQqskxBAGjlODAmlW8QFy+y9e/655z/euQWrLwRAT9HW1gagd+/eJ5100ty5c2+99dZ99tknSZKPVE7g/ahq1vRba8ePH3/UUUftuOOOt99++ymnnDJ58uQrrrhi0003zfqXsp6l1T+yEBzBKjnxQ4cM/t53vlteVrzv+n8ff+IJY1raTp/01i0dbcVqU2UqqgIo6XunmXRzy7tArC3bvL23Ujl20oS3+va/9b+3XfmPyydPmXrn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lXd9gFf+OjMPGDBgwIABO+200wknnLBs2bJzzjnn/PPPZ+Z+/fr17ds36wL6gG79bPBZVffdd9/Bgwf/7W9/u+SSSz4gAARkyChwwBcO+MlPf/TKsiWDG+rEqemiHm2CeuMRRU8vXlLX0Gvvz+2mUPD79v8AyJbUXXnllQC+/e1v4/2bvGzQ+9vfOnrUsPUu+b+LXnn8sUenTGnqP7hXFDtfLKlab9lwyp4scs5lm/4YhZAKCemKrbiIoMvn0qaGSZUBUlFf9l4YuoWJN+k74PBeAx9cuvi/r792xFFHXXXjdeedd9GXv/Sls/r1e721Ze9qm3oBbJePzWazUUmRYvnQvNrs3aD325oy+CRCAATv0Nnn/thjjwHYa6+9mPnxxx8/5ZRT3njjjUKhcNxxxx199NG77rpr51Vq50SgTqvzRJ3lRbPpj5deeumll17a3Nx87LHHnnjiiTvttBNWpMUHHzArURdF0QknnHDBBRece+65NTU175cZBLKwTnXDjTbYZMstnx8//gu9GznpsqZFCKw+sbnnFy753JcOa+rfJ5WU3z8AsgGVUqn0z3/+88ADD/zQ2p9EVF9TfeCXvnDgF79w2913nvfHP/7wqXE75guHDR+2gYml3Ab4nLL3JATPgDIpSD2RCBnp7LShrJcdZsWFtoJXTMJHSTwqbRtpbmRT312bmv415+0xd937zFPP3HT5Vdvtuc+Ld/5334ahnBbXYHtMqEBZFUBcyK8446DrhXUAwTtkPRKq+uyzzw4fPnzTTTf9+9//Pnr06DfeeOO000574YUXrrjiij322IOZs+n82eOzaqAf6W49m7LJzP/85z+32mqrc845Z4cddnjhhReuvPLKnXbaSUSyveZX51BZi3nccce1tbXddttt2XjDKh9JIDDBe2Lab//9Xk7TFkd52K66jhVIHnZeIjNFDjroCwqofNAk0ywC77777kWLFp166qmdVVff7/EKTXzqygnKetiBB4178qm//efmmRuP+t6EiTcumJ8UcogYgqo0FoJjdSwVC09kxJrV2g5TrY8in1djy6iY0tJtXemXg4f+YNCQ9qVLD/nqoU89M246fNGZWLirxk1WRprVhqPEe6cKoFBVwPLmP+wL1vVCAATvRkStra0TJkz4yle+cs0115x88slbbbXVM888c9FFF22yySbZGq5sN+Csi+aj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ojHGNP1qvkm+v2hiibH3FonY0ChqRMUAig3FgiDS61K23733Ps/MnN8fz+51BYwksrDLnffrpcL17t1bdufMM3PmnOCHP7n8/AsuuHndyg8a0hW2wDDabCJNFCgFsxEkIest1zMDKCktLSsr29XPbnfmAoCzDbkV/285+kcjHRH99Kc/XbZs2fe///0LLrhgO1d+okX8nNxQmGs1s82nHRX9/6//+q9HHnkkk80opb4uHShaIBozanTHLl3e3ry+MaakBQC73cVBmawVLGx0gJazXvyt6pqx+48vKynWxliKtpubjte2fF1SyiAIHnrooWOOOaZbt25a65ZNIq1ter1CiOa+Lkoq5XleLkE29+ZsEQaaXilBgXVo/nLbbSPHj7t++aLlIiZkos02VidQcwBgYqoLwpQ1ALp16+Z53r+oBeJ8S64UhNOKorWOadOmTZkyZeDAgTfccMM3VOuMxn1rcz2t/tU9rTXWCilaJttEI8V555134403vv7a60cddVSUYLr1CEJExpqioqIDxu7/7rNP1gkuYkoDRkDa7RopmawhGWMIFiS9qpAXWXvOYYcAsDZk6UveRgsYa60Q8vXXX1+zZs2DDz7Y8hvlamNELzzVmFq7dt2atWurqqrS6bTve2Vl5Z07dezWtVt5eXluhyOKH/TVDQ8rKbScEN7j9z60935737Z22S/79vNS2bY6lEbFQNmAPSHrgmyjtQB69OiBr8/odb49FwCc1hKddK2trb3yyisBXH/99aWlpdtsdB5N5621Bjqm4kpKAJUbNn3yyScfz5+/+IsvNlZuqGtsEHG/vLzDnj17jhg2dNTo0X1691FCAAhDTQSpVHS5YYwdMmTI2L33vffe+4866qivrQtExIYhcPCBk5599snVxgwTiqEtILfvypiYpEWgoIwmT32SqofnH3TARABSKMI28laihRsi3Hfn7T0H9J006SDKslCykY0CxaQEsHjxkukvv/jyqy8t/HhB9eq1MpuNCqIGQAhkpSrr0GHPgQP223/8UYcddsB+4/1EAkBgQgmSEICwgiCUR6S1HjB44C033HjO+ReMra05tiCBdD2RrykhECikQ/LawMYAMxmyviV4rEEFG7MpKwiG+/bti+YyqLv6Se6eXABwWkuU2XL33XcvXrz4xBNPPP7446MeL9u8p7XW930FVbNx43PPTZ/2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" alt="Fuchs Metallbau Logo"></div>
    <h1>Fuchs Metallbau</h1>
    <p class="subtitle">Mobile App f\u00fcr Fotos &amp; Projekte</p>

    <div class="status">
      <span class="dot"></span>
      Verbindung bereit \u2013 ${driveName}
    </div>

    <div class="divider"></div>

    <p class="label">Schritt 1 \u2013 App installieren</p>
    ${apkExists ? `
    <a href="${serverUrl}/api/mobile/app.apk?v=${apkTimestamp}" class="btn btn-primary" download="FuchsMetallbau.apk">
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
    <div class="steps">
      <div class="step">
        <span class="step-num">1</span>
        <span class="step-text">Installiere und \u00f6ffne die App</span>
      </div>
      <div class="step">
        <span class="step-num">2</span>
        <span class="step-text">Scanne <strong>denselben QR-Code</strong> nochmal \u2013 diesmal in der App</span>
      </div>
      <div class="step">
        <span class="step-num">3</span>
        <span class="step-text">Melde dich mit deinem Google-Konto an</span>
      </div>
    </div>

    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Server</span>
        <span class="info-value">${serverUrl}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Drive-Ordner</span>
        <span class="info-value">${driveName}</span>
      </div>
    </div>
  </div>

  <p class="footer">Fuchs Metallbau</p>
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

    logActivity('project_create', `Neues Projekt erstellt`, `„${name}"`, userName);

    res.json({ success: true, message: `Projekt "${name}" wurde erstellt und wartet auf Bestätigung in der Software` });
  } catch (error) {
    console.error('Error creating project from mobile:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
};

/**
 * Update project metadata (color, notes, tags) from mobile app
 * PATCH /api/mobile/projects/:id
 */
const updateProjectMeta = async (req, res) => {
  try {
    const { id } = req.params;
    const { color, notes, tags } = req.body;

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(parseInt(id));
    if (!project) {
      return res.status(404).json({ error: 'Projekt nicht gefunden' });
    }

    const updates = [];
    const params = [];

    if (color !== undefined) { updates.push('color = ?'); params.push(color); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(Array.isArray(tags) ? tags : [])); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Keine Felder zum Aktualisieren angegeben' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(project.id);

    db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updatedProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);

    // Push updated project.json to Drive async
    const projectsCtrl = require('./projectsController');
    projectsCtrl.pushProjectJsonToDrive(updatedProject).catch(() => {});

    res.json({
      ...updatedProject,
      tags: updatedProject.tags ? JSON.parse(updatedProject.tags) : [],
    });
  } catch (error) {
    console.error('Error updating project meta from mobile:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren' });
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

    const { project_id, project_name, custom_title, notes, gps_latitude, gps_longitude, gps_altitude } = req.body;
    const userName = req.device.user_name;
    const deviceId = req.device.device_id;

    const originalName = req.file.originalname;
    const ext = path.extname(originalName);
    const baseName = custom_title || path.basename(originalName, ext);
    const timestamp = Date.now();
    const fileName = `${baseName}_${timestamp}${ext}`;

    // Move file to mobile uploads directory
    const finalPath = path.join(MOBILE_UPLOADS_DIR, fileName);
    await fs.move(req.file.path, finalPath);

    // Write EXIF metadata into image (GPS, title, notes)
    const lat = gps_latitude ? parseFloat(gps_latitude) : null;
    const lon = gps_longitude ? parseFloat(gps_longitude) : null;
    const alt = gps_altitude ? parseFloat(gps_altitude) : null;

    try {
      await writeExifData(finalPath, {
        latitude: lat,
        longitude: lon,
        altitude: alt,
        description: custom_title || null,
        userComment: notes || null
      });
    } catch (e) {
      console.error('EXIF write failed (non-critical):', e.message);
    }

    // Read back EXIF to also get photo_taken_at
    let photoTakenAt = null;
    try {
      const exifData = await readExifData(finalPath);
      if (exifData.photoTakenAt) photoTakenAt = exifData.photoTakenAt;
    } catch (e) {
      // ignore
    }

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
        (drive_path_id, name, original_name, file_url, local_path, thumbnail_url, file_size, mime_type, is_compressed, drive_file_id, photo_taken_at, gps_latitude, gps_longitude, gps_altitude, image_notes)
      VALUES (NULL, ?, ?, '', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      baseName,
      originalName,
      relativePath,
      thumbnailRelative,
      stats.size,
      req.file.mimetype,
      `mobile_${deviceId}_${timestamp}`,
      photoTakenAt,
      lat,
      lon,
      alt,
      notes || null
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

    // Log activity
    const displayName = custom_title || path.basename(originalName, ext);
    const projectInfo = project_name ? ` in Projekt „${project_name}"` : '';
    logActivity('image_upload', 'Foto hochgeladen', `${displayName}${projectInfo}`, userName);

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
 * @param {string} driveFileId - Google Drive file ID
 * @param {string} fileName - Original file name
 * @param {string} mimeType - MIME type
 * @param {number} drivePathId - DB drive_path ID
 * @param {string} drivePathName - Drive path name (for local directory)
 * @param {string|null} driveDescription - Google Drive file description (may contain [FUCHS_META])
 * Returns the new drive_images row ID
 */
const downloadAndRegisterImage = async (driveFileId, fileName, mimeType, drivePathId, drivePathName, driveDescription = null) => {
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

  // Extract EXIF data (GPS, date, notes)
  let photoTakenAt = null;
  let gpsLatitude = null;
  let gpsLongitude = null;
  let gpsAltitude = null;
  let imageNotes = null;
  let customTitle = null;
  try {
    const exifData = await readExifData(localFilePath);
    if (exifData.photoTakenAt) {
      photoTakenAt = exifData.photoTakenAt;
    }
    if (exifData.latitude != null && exifData.longitude != null) {
      gpsLatitude = exifData.latitude;
      gpsLongitude = exifData.longitude;
      gpsAltitude = exifData.altitude;
    }
    if (exifData.userComment) {
      imageNotes = exifData.userComment;
    }
  } catch {}

  // Parse FUCHS_META from Drive file description
  if (driveDescription && driveDescription.startsWith('[FUCHS_META]')) {
    try {
      const metaJson = driveDescription.substring('[FUCHS_META]'.length);
      const meta = JSON.parse(metaJson);
      if (meta.gps && gpsLatitude == null) {
        gpsLatitude = meta.gps.latitude;
        gpsLongitude = meta.gps.longitude;
        gpsAltitude = meta.gps.altitude || null;
      }
      if (meta.notes && !imageNotes) {
        imageNotes = meta.notes;
      }
      if (meta.title) {
        customTitle = meta.title;
      }
    } catch (e) {
      // Invalid JSON - ignore
    }
  }

  // Check pending_image_metadata table
  try {
    const pending = db.prepare(
      'SELECT * FROM pending_image_metadata WHERE drive_file_id = ? OR file_name = ? LIMIT 1'
    ).get(driveFileId, fileName);
    if (pending) {
      if (pending.gps_latitude != null && gpsLatitude == null) {
        gpsLatitude = pending.gps_latitude;
        gpsLongitude = pending.gps_longitude;
        gpsAltitude = pending.gps_altitude;
      }
      if (pending.notes && !imageNotes) imageNotes = pending.notes;
      if (pending.custom_title && !customTitle) customTitle = pending.custom_title;
      db.prepare('DELETE FROM pending_image_metadata WHERE id = ?').run(pending.id);
    }
  } catch {}

  // Write metadata into EXIF (so it persists in the file)
  try {
    await writeExifData(localFilePath, {
      latitude: gpsLatitude,
      longitude: gpsLongitude,
      altitude: gpsAltitude,
      description: customTitle || null,
      userComment: imageNotes || null
    });
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
     file_size, mime_type, is_compressed, drive_file_id, photo_taken_at, subfolder,
     gps_latitude, gps_longitude, gps_altitude, image_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?, ?)
  `).run(
    drivePathId,
    customTitle || fileBaseName,
    fileName,
    localPath,
    thumbnailUrl,
    stats.size,
    mimeType || 'image/jpeg',
    driveFileId,
    photoTakenAt,
    gpsLatitude,
    gpsLongitude,
    gpsAltitude,
    imageNotes
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
              let metaCreatedBy = null;
              try {
                const files = await listFilesInFolder(f.id);
                // Count only actual images (exclude JSON meta files)
                image_count = files.filter(fi => fi.mimeType && fi.mimeType.startsWith('image/')).length;
                // Try to read _meta.json for creator info written by mobile app
                const metaFile = files.find(fi => fi.name === '_meta.json');
                if (metaFile) {
                  try {
                    const meta = await readDriveFileAsJson(metaFile.id);
                    metaCreatedBy = meta?.created_by || null;
                  } catch {}
                }
              } catch {}

              // Detect if folder is a device inbox (UUID name) vs a project
              const isUserInbox = isDeviceIdFolder(f.name);
              const deviceUser = isUserInbox
                ? (resolveDeviceUser(f.name) || metaCreatedBy || 'Unbekannt')
                : (metaCreatedBy || 'Handy-App');

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
                device_user: deviceUser,
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

    // Log new inbox folders as activities (deduplicated by folder id)
    for (const item of driveInboxProjects) {
      const sourceId = `inbox_folder_${item.drive_folder_id}`;
      const title = item.is_user_inbox
        ? `${item.image_count} Foto${item.image_count !== 1 ? 's' : ''} hochgeladen`
        : `Neues Projekt: „${item.original_name}"`;
      const desc = item.is_user_inbox
        ? `ohne Projektzuordnung von ${item.device_user}`
        : `${item.image_count} Bild${item.image_count !== 1 ? 'er' : ''} warten auf Bestätigung`;
      logActivity('inbox_item', title, desc, item.device_user, sourceId);
    }

    // Log new delete requests (deduplicated by file name + requester)
    for (const req of deleteRequests) {
      const reqName = req.file_name || req.fileName || '';
      const reqBy = req.requested_by || 'Unbekannt';
      const sourceId = `delete_req_${reqName}_${reqBy}`;
      logActivity('delete_request', 'Löschanfrage', `„${reqName}" von ${reqBy}`, reqBy, sourceId);
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

    // Create project in DB if not exists (do this BEFORE downloading so we have projectId)
    const existing = db.prepare('SELECT id FROM projects WHERE folder_name = ?').get(projectName);
    let projectId;
    if (existing) {
      projectId = existing.id;
    } else {
      const result = db.prepare('INSERT INTO projects (folder_name, color, notes) VALUES (?, ?, ?)')
        .run(projectName, '#3b82f6', '');
      projectId = result.lastInsertRowid;
    }

    // Create local project folder + Bilder subfolder + download images + register in DB
    const settings = db.prepare('SELECT project_path FROM project_settings WHERE id = 1').get();
    let downloaded = 0;

    if (settings?.project_path) {
      const projectFolder = path.join(settings.project_path, projectName);
      const bilderFolder = path.join(projectFolder, 'Bilder');
      await fs.ensureDir(bilderFolder);
      console.log(`📁 Created local project folder: ${bilderFolder}`);

      // Download images from Drive to local Bilder folder and register in drive_images
      for (const img of images) {
        try {
          // Download directly to Bilder folder
          const destPath = path.join(bilderFolder, img.name);
          if (!await fs.pathExists(destPath)) {
            await downloadFile(img.id, destPath);
            console.log(`✓ Downloaded "${img.name}" to "${bilderFolder}"`);
          } else {
            console.log(`⏭ "${img.name}" already exists, skipped`);
          }
          downloaded++;

          // Register image in drive_images DB so it appears in Bilder tab
          const existingImg = db.prepare('SELECT id FROM drive_images WHERE drive_file_id = ?').get(img.id);
          let imageId;
          if (!existingImg) {
            const projectImageUrl = `/api/projects/${projectId}/file/image/${encodeURIComponent(img.name)}`;
            const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
            let fileSize = null;
            try {
              const stats = await fs.stat(destPath);
              fileSize = stats.size;
            } catch (e) { /* ignore */ }

            // Extract metadata from EXIF + Drive description
            let imgPhotoTakenAt = null;
            let imgGpsLat = null, imgGpsLon = null, imgGpsAlt = null;
            let imgNotes = null;
            let imgTitle = null;
            try {
              const exif = await readExifData(destPath);
              if (exif.photoTakenAt) imgPhotoTakenAt = exif.photoTakenAt;
              if (exif.latitude != null) { imgGpsLat = exif.latitude; imgGpsLon = exif.longitude; imgGpsAlt = exif.altitude; }
              if (exif.userComment) imgNotes = exif.userComment;
            } catch {}
            if (img.description && img.description.startsWith('[FUCHS_META]')) {
              try {
                const meta = JSON.parse(img.description.substring('[FUCHS_META]'.length));
                if (meta.gps && imgGpsLat == null) { imgGpsLat = meta.gps.latitude; imgGpsLon = meta.gps.longitude; imgGpsAlt = meta.gps.altitude || null; }
                if (meta.notes && !imgNotes) imgNotes = meta.notes;
                if (meta.title) imgTitle = meta.title;
              } catch {}
            }

            const displayName = imgTitle || path.basename(img.name, path.extname(img.name));

            // Generate thumbnail
            await fs.ensureDir(THUMBNAILS_DIR);
            const ciBaseNoExt = path.basename(img.name, path.extname(img.name));
            const ciThumbName = `proj_${projectId}_${ciBaseNoExt.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
            let ciThumbUrl = projectImageUrl;
            try {
              await generateThumbnail(destPath, path.join(THUMBNAILS_DIR, ciThumbName));
              ciThumbUrl = `/uploads/thumbnails/${ciThumbName}`;
            } catch {}

            const imgResult = db.prepare(`
              INSERT INTO drive_images (
                name, original_name, local_path, thumbnail_url, file_url,
                mime_type, drive_file_id, drive_path_id, file_size, created_at,
                photo_taken_at, gps_latitude, gps_longitude, gps_altitude, image_notes
              ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              displayName, img.name, projectImageUrl, ciThumbUrl, projectImageUrl,
              img.mimeType || 'image/jpeg', img.id, fileSize, now,
              imgPhotoTakenAt, imgGpsLat, imgGpsLon, imgGpsAlt, imgNotes
            );
            imageId = imgResult.lastInsertRowid;
          } else {
            imageId = existingImg.id;
          }

          // Create project assignment
          if (imageId) {
            db.prepare('INSERT OR IGNORE INTO image_project_assignments (image_id, project_id) VALUES (?, ?)')
              .run(imageId, projectId);
          }
        } catch (e) {
          console.error(`✗ Failed to download ${img.name}:`, e.message);
        }
      }
    } else {
      console.warn('⚠ project_path not configured, skipping local download');
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

    console.log(`✅ Project "${projectName}" confirmed: ${downloaded}/${images.length} images downloaded and registered`);
    res.json({
      success: true,
      projectId,
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
          drivePath.name,
          file.description || null
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
        drivePath.name,
        file.description || null
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

    // Match client_id to the correct client_secret
    const useClientId = client_id || process.env.GOOGLE_MOBILE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const useClientSecret = (useClientId === process.env.GOOGLE_MOBILE_CLIENT_ID)
      ? (process.env.GOOGLE_MOBILE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)
      : process.env.GOOGLE_CLIENT_SECRET;

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
      scope: tokenData.scope || '',
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

    // Match client_id to the correct client_secret (device flow uses mobile/TV credentials)
    const useClientId = client_id || process.env.GOOGLE_MOBILE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const useClientSecret = (useClientId === process.env.GOOGLE_MOBILE_CLIENT_ID)
      ? (process.env.GOOGLE_MOBILE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)
      : process.env.GOOGLE_CLIENT_SECRET;

    console.log('[Fuchs] Device token exchange - clientId match:',
      useClientId === process.env.GOOGLE_MOBILE_CLIENT_ID ? 'MOBILE' : 'WEB',
      '| secret type:', useClientSecret === process.env.GOOGLE_MOBILE_CLIENT_SECRET ? 'MOBILE' : 'WEB');

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

          // Parse uploaders from image descriptions ([FUCHS_META]{...} format)
          const uploaders = new Set();
          for (const img of newImages) {
            if (img.description && img.description.startsWith('[FUCHS_META]')) {
              try {
                const meta = JSON.parse(img.description.slice('[FUCHS_META]'.length));
                if (meta.uploaded_by) uploaders.add(meta.uploaded_by);
              } catch {}
            }
          }

          changes.push({
            project_name: folder.name,
            project_id: project?.id || null,
            project_color: project?.color || '#3b82f6',
            drive_folder_id: folder.id,
            uploaders: [...uploaders],
            new_images: newImages.map(img => ({
              id: img.id,
              name: img.name,
              size: img.size,
              description: img.description || null,
            })),
            total_drive_images: driveImages.length,
            total_local_images: localImageNames.size,
          });
        }
      } catch (e) {
        console.error(`Error scanning project folder "${folder.name}":`, e.message);
      }
    }

    // Log new project-change images as activities (deduplicated per Drive file id)
    for (const change of changes) {
      const unlogged = change.new_images.filter(img => {
        const existing = db.prepare('SELECT id FROM inbox_activities WHERE source_id = ?').get(`drive_img_${img.id}`);
        return !existing;
      });
      if (unlogged.length > 0) {
        // Only log if at least one image was explicitly uploaded via the mobile app
        // (detected by [FUCHS_META] tag). Desktop Drive operations must not appear in Inbox.
        if (change.uploaders.length > 0) {
          const uploader = change.uploaders.join(', ');
          logActivity(
            'project_change',
            `${unlogged.length} neue${unlogged.length === 1 ? 's Bild' : ' Bilder'} in Projekt „${change.project_name}"`,
            `hochgeladen von ${uploader}`,
            uploader
          );
        }
        // Mark all images as seen regardless, so they don't retrigger on the next scan
        for (const img of unlogged) markSourceIdSeen(`drive_img_${img.id}`);
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

          // Extract metadata from EXIF + Drive description
          let pcPhotoTakenAt = null;
          let pcGpsLat = null, pcGpsLon = null, pcGpsAlt = null;
          let pcNotes = null;
          let pcTitle = null;
          try {
            const exif = await readExifData(destPath);
            if (exif.photoTakenAt) pcPhotoTakenAt = exif.photoTakenAt;
            if (exif.latitude != null) { pcGpsLat = exif.latitude; pcGpsLon = exif.longitude; pcGpsAlt = exif.altitude; }
            if (exif.userComment) pcNotes = exif.userComment;
          } catch {}
          if (meta.description && meta.description.startsWith('[FUCHS_META]')) {
            try {
              const fmeta = JSON.parse(meta.description.substring('[FUCHS_META]'.length));
              if (fmeta.gps && pcGpsLat == null) { pcGpsLat = fmeta.gps.latitude; pcGpsLon = fmeta.gps.longitude; pcGpsAlt = fmeta.gps.altitude || null; }
              if (fmeta.notes && !pcNotes) pcNotes = fmeta.notes;
              if (fmeta.title) pcTitle = fmeta.title;
            } catch {}
          }

          const displayName = pcTitle || path.basename(meta.name, path.extname(meta.name));
          const imgResult = db.prepare(`
            INSERT INTO drive_images (
              name, original_name, local_path, thumbnail_url, file_url,
              mime_type, drive_file_id, drive_path_id, file_size, created_at,
              photo_taken_at, gps_latitude, gps_longitude, gps_altitude, image_notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            displayName, meta.name, projectImageUrl, projectImageUrl, projectImageUrl,
            meta.mimeType || 'image/jpeg', fileId, fileSize, now,
            pcPhotoTakenAt, pcGpsLat, pcGpsLon, pcGpsAlt, pcNotes
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

/**
 * Report image metadata from mobile app (GPS, title, notes)
 * POST /api/mobile/image-metadata
 * Called after upload to Drive - stores metadata for when sync picks up the file
 */
const reportImageMetadata = async (req, res) => {
  try {
    const { drive_file_id, file_name, gps_latitude, gps_longitude, gps_altitude, custom_title, notes } = req.body;

    if (!file_name && !drive_file_id) {
      return res.status(400).json({ error: 'file_name oder drive_file_id erforderlich' });
    }

    const lat = gps_latitude != null ? parseFloat(gps_latitude) : null;
    const lon = gps_longitude != null ? parseFloat(gps_longitude) : null;
    const alt = gps_altitude != null ? parseFloat(gps_altitude) : null;

    // Try to find the image by drive_file_id first, then by name
    let image = null;
    if (drive_file_id) {
      image = db.prepare('SELECT * FROM drive_images WHERE drive_file_id = ?').get(drive_file_id);
    }
    if (!image && file_name) {
      // Match by original_name (most recent)
      image = db.prepare('SELECT * FROM drive_images WHERE original_name = ? ORDER BY created_at DESC LIMIT 1').get(file_name);
    }

    if (image) {
      // Image already synced - update it directly
      const updates = [];
      const params = [];
      if (lat != null && lon != null) {
        updates.push('gps_latitude = ?', 'gps_longitude = ?');
        params.push(lat, lon);
        if (alt != null) {
          updates.push('gps_altitude = ?');
          params.push(alt);
        }
      }
      if (notes) {
        updates.push('image_notes = ?');
        params.push(notes);
      }
      if (custom_title) {
        updates.push('name = ?');
        params.push(custom_title);
      }
      if (updates.length > 0) {
        params.push(image.id);
        db.prepare(`UPDATE drive_images SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        // Also write EXIF data into the image file if it has a local path
        if (image.local_path) {
          const absolutePath = path.join(__dirname, '../../../', image.local_path);
          if (await fs.pathExists(absolutePath)) {
            try {
              await writeExifData(absolutePath, {
                latitude: lat,
                longitude: lon,
                altitude: alt,
                description: custom_title || null,
                userComment: notes || null
              });
            } catch (e) {
              console.warn('EXIF write after metadata report failed:', e.message);
            }
          }
        }
      }
      return res.json({ success: true, matched: true, imageId: image.id });
    }

    // Image not synced yet - store as pending metadata
    // We create a record in a simple key-value approach using the file_name
    const key = drive_file_id || file_name;
    db.prepare(`
      INSERT OR REPLACE INTO pending_image_metadata
        (lookup_key, file_name, drive_file_id, gps_latitude, gps_longitude, gps_altitude, custom_title, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(key, file_name, drive_file_id || null, lat, lon, alt, custom_title || null, notes || null);

    res.json({ success: true, matched: false, pending: true });
  } catch (error) {
    console.error('Error reporting image metadata:', error);
    res.status(500).json({ error: 'Metadaten konnten nicht gespeichert werden' });
  }
};

// ============================================================
// GOOGLE USER MANAGEMENT (Drive folder access)
// ============================================================

/**
 * Register a Google user and grant them access to the Drive root folder.
 * Called from the mobile app right after Google login.
 * POST /api/mobile/register-google-user
 * Body: { googleEmail, googleName, googleId?, rootFolderId? }
 *
 * IMPORTANT: This runs BEFORE the mobile app tries to access the folder,
 * so the sharing permission is in place when Drive access is verified.
 */
const registerGoogleUser = async (req, res) => {
  try {
    const { googleEmail, googleName, googleId, rootFolderId } = req.body;

    if (!googleEmail) {
      return res.status(400).json({ error: 'googleEmail ist erforderlich' });
    }

    // Determine which Drive folder to share
    let folderId = rootFolderId;
    let drivePathId = null;

    if (!folderId) {
      // Fall back to the first configured drive path
      const drivePath = db.prepare('SELECT id, path FROM drive_paths ORDER BY id ASC LIMIT 1').get();
      if (!drivePath) {
        return res.status(400).json({ error: 'Kein Google Drive Ordner konfiguriert' });
      }
      drivePathId = drivePath.id;
      const urlMatch = drivePath.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
      folderId = urlMatch ? urlMatch[1] : drivePath.path;
    } else {
      // Find the drive_path by folder ID
      const allPaths = db.prepare('SELECT id, path FROM drive_paths').all();
      for (const dp of allPaths) {
        const urlMatch = dp.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        const dpFolderId = urlMatch ? urlMatch[1] : dp.path;
        if (dpFolderId === folderId) {
          drivePathId = dp.id;
          break;
        }
      }
    }

    // Check if user already registered
    const existing = db.prepare('SELECT * FROM mobile_users WHERE google_email = ?').get(googleEmail);
    if (existing) {
      // Already registered - update name if changed and return success
      if (googleName && googleName !== existing.google_name) {
        db.prepare('UPDATE mobile_users SET google_name = ? WHERE google_email = ?').run(googleName, googleEmail);
      }
      return res.json({ success: true, alreadyRegistered: true });
    }

    // Share the Drive folder with this Google account
    let permissionId = null;
    try {
      permissionId = await shareFolderWithUser(folderId, googleEmail);
    } catch (shareError) {
      console.error('[Fuchs] Failed to share folder with user:', shareError.message);
      // Continue registration even if sharing fails (folder might already be shared)
    }

    // Save user to database
    db.prepare(`
      INSERT INTO mobile_users (google_email, google_name, google_id, drive_path_id, drive_permission_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(googleEmail, googleName || null, googleId || null, drivePathId, permissionId);

    console.log(`✅ Registered mobile user: ${googleEmail} (permission: ${permissionId})`);

    res.json({ success: true, permissionGranted: !!permissionId });
  } catch (error) {
    console.error('[Fuchs] registerGoogleUser error:', error);
    res.status(500).json({ error: 'Registrierung fehlgeschlagen: ' + error.message });
  }
};

/**
 * Get all registered Google/mobile users.
 * Called from desktop settings page.
 * GET /api/mobile/google-users
 */
const getGoogleUsers = (req, res) => {
  try {
    const users = db.prepare(`
      SELECT mu.*, dp.name as drive_path_name
      FROM mobile_users mu
      LEFT JOIN drive_paths dp ON mu.drive_path_id = dp.id
      ORDER BY mu.added_at DESC
    `).all();

    res.json(users);
  } catch (error) {
    console.error('[Fuchs] getGoogleUsers error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Remove a Google user and revoke their Drive folder access.
 * Called from desktop settings page.
 * DELETE /api/mobile/google-users/:userId
 */
const removeGoogleUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = db.prepare('SELECT * FROM mobile_users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Revoke Drive permission if we have the permission ID
    if (user.drive_permission_id) {
      // Get the folder ID from drive_paths
      let folderId = null;
      if (user.drive_path_id) {
        const drivePath = db.prepare('SELECT path FROM drive_paths WHERE id = ?').get(user.drive_path_id);
        if (drivePath) {
          const urlMatch = drivePath.path.match(/\/folders\/([a-zA-Z0-9_-]+)/);
          folderId = urlMatch ? urlMatch[1] : drivePath.path;
        }
      }

      if (folderId) {
        try {
          await removeFolderPermission(folderId, user.drive_permission_id);
        } catch (revokeError) {
          console.error('[Fuchs] Failed to revoke Drive permission:', revokeError.message);
          // Continue with DB deletion even if Drive API fails
        }
      }
    }

    // Remove from database
    db.prepare('DELETE FROM mobile_users WHERE id = ?').run(userId);

    console.log(`✅ Removed mobile user: ${user.google_email}`);

    res.json({ success: true, removedUser: user.google_email });
  } catch (error) {
    console.error('[Fuchs] removeGoogleUser error:', error);
    res.status(500).json({ error: 'Entfernen fehlgeschlagen: ' + error.message });
  }
};

module.exports = {
  getActivities,
  markActivitiesRead,
  generateConnectToken,
  getConnectInfo,
  connectLandingPage,
  connectSetupPage,
  registerDevice,
  authenticateDevice,
  getDevices,
  reportImageMetadata,
  removeDevice,
  getProjects,
  getProjectImages,
  createProject,
  updateProjectMeta,
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
  registerGoogleUser,
  getGoogleUsers,
  removeGoogleUser,
};
