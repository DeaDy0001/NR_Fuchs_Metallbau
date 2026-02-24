const express = require('express');
const router = express.Router();
const projectsController = require('../controllers/projectsController');

// Project settings routes
router.get('/settings', projectsController.getProjectSettings);
router.post('/settings/path', projectsController.setProjectPath);

// Projects routes
router.get('/', projectsController.getProjects);
router.get('/:id', projectsController.getProjectById);
router.get('/:id/files', projectsController.getProjectFiles);
router.get('/:id/file/:type/:filename', projectsController.serveProjectFile);
router.post('/', projectsController.createProject);
router.put('/:id', projectsController.updateProject);
router.put('/:id/rename', projectsController.renameProject);
router.delete('/:id', projectsController.deleteProject);
router.post('/sync', projectsController.syncProjects);

module.exports = router;
