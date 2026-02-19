const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');

/**
 * System Routes
 * Handles version checking, updates, and system info
 */

// Get current version and check for updates
router.get('/version', systemController.getLatestVersion);

// Trigger update from GitHub
router.post('/update', systemController.triggerUpdate);

// Trigger update from specific branch (developer only)
router.post('/update-branch', systemController.triggerBranchUpdate);

// Get git info (branch, commit, etc.)
router.get('/git-info', systemController.getGitInfo);

module.exports = router;
