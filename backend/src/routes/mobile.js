const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const mobile = require('../controllers/mobileController');

// Configure multer for mobile uploads
const uploadDir = path.join(__dirname, '../../../uploads/mobile-temp');
fs.ensureDirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Nur Bilddateien sind erlaubt'), false);
    }
  }
});

// ---- Public routes (no auth needed) ----

// Generate QR code connection token (called from desktop)
router.post('/connect-token', mobile.generateConnectToken);

// Landing page when QR code is scanned with phone camera
router.get('/connect/:token', mobile.connectLandingPage);

// Register device with token (called from app after QR scan)
router.post('/register', mobile.registerDevice);

// Device management (called from desktop)
router.get('/devices', mobile.getDevices);
router.delete('/devices/:deviceId', mobile.removeDevice);

// Inbox (called from desktop)
router.get('/inbox', mobile.getInbox);

// APK download
router.get('/app.apk', (req, res) => {
  const apkPath = path.join(__dirname, '../../../mobile-app/android/app.apk');
  if (fs.existsSync(apkPath)) {
    res.download(apkPath, 'FuchsMetallbau.apk');
  } else {
    res.status(404).json({ error: 'APK nicht verfügbar' });
  }
});

// ---- Authenticated routes (mobile app) ----

// All routes below require mobile auth token
router.use(mobile.authenticateDevice);

// Projects
router.get('/projects', mobile.getProjects);
router.get('/projects/:id/images', mobile.getProjectImages);
router.post('/projects', mobile.createProject);

// Upload
router.post('/upload', upload.single('image'), mobile.uploadImage);

// Sync
router.get('/sync', mobile.getSyncData);

// Image download (with optional compression)
router.get('/image/:imageId', mobile.getImage);

module.exports = router;
