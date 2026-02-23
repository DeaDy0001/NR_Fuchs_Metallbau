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

// Get all tags (versions)
router.get('/tags', systemController.getTags);

// Get all remote branches (developer only, requires password)
router.get('/branches', systemController.getBranches);

// Trigger update to a specific version (tag)
router.post('/update-version', systemController.triggerVersionUpdate);

// Get all GitHub releases with release notes
router.get('/releases', systemController.getReleases);

module.exports = router;
