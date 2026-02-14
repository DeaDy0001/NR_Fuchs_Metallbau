const express = require('express');
const router = express.Router();
const colorPresetsController = require('../controllers/colorPresetsController');

// Routes
router.get('/', colorPresetsController.getColorPresets);
router.post('/', colorPresetsController.saveColorPreset);
router.delete('/:position', colorPresetsController.deleteColorPreset);

module.exports = router;
