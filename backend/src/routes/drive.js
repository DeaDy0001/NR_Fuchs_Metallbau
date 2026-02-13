const express = require('express');
const router = express.Router();
const driveController = require('../controllers/driveController');

// Drive settings routes
router.get('/settings', driveController.getDriveSettings);
router.post('/settings/path', driveController.addDrivePath);
router.delete('/settings/path/:id', driveController.removeDrivePath);
router.put('/settings/path/:id', driveController.updateDrivePath);
router.post('/settings/path/:id/sync', driveController.syncDrive);

// Drive images routes
router.get('/images', driveController.getImages);
router.get('/images/:id', driveController.getImageById);
router.put('/images/:id/rename', driveController.renameImage);
router.delete('/images/:id', driveController.deleteImage);
router.post('/images/refresh', driveController.refreshImages);
router.post('/images/assign-to-project', driveController.assignImageToProject);

module.exports = router;
