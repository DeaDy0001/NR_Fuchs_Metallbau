const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const multer = require('multer');
const path = require('path');

// Multer config for logo upload
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../../uploads/logos'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `logo-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|svg|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed!'));
  }
});

// Multer config for favicon upload
const faviconStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../../uploads/logos'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `favicon-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const faviconUpload = multer({
  storage: faviconStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|svg|webp|ico/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || file.mimetype === 'image/x-icon';

    if (mimetype || extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed!'));
  }
});

// Routes
router.get('/', settingsController.getSettings);
router.put('/', settingsController.updateSettings);
router.post('/logo', logoUpload.single('logo'), settingsController.uploadLogo);
router.delete('/logo', settingsController.deleteLogo);
router.post('/favicon', faviconUpload.single('favicon'), settingsController.uploadFavicon);
router.delete('/favicon', settingsController.deleteFavicon);

module.exports = router;
