const express = require('express');
const router = express.Router();
const tagsController = require('../controllers/tagsController');

// Tag CRUD
router.get('/', tagsController.getTags);
router.post('/', tagsController.createTag);
router.put('/:id', tagsController.updateTag);
router.delete('/:id', tagsController.deleteTag);

// Tag assignments
router.post('/assign', tagsController.assignTagToImage);
router.post('/unassign', tagsController.unassignTagFromImage);

module.exports = router;
