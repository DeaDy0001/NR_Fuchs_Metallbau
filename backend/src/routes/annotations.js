const express = require('express');
const router = express.Router();
const annotationsController = require('../controllers/annotationsController');

// Get annotations for an image
router.get('/:imageId', annotationsController.getAnnotations);

// Save annotations for an image
router.post('/:imageId', annotationsController.saveAnnotations);

// Export image with annotations (overwrite original)
router.post('/:imageId/export/overwrite', annotationsController.exportImageOverwrite);

// Export image with annotations (create new image)
router.post('/:imageId/export/new', annotationsController.exportImageNew);

module.exports = router;
