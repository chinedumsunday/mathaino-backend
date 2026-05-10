const router = require('express').Router({ mergeParams: true });
const { createModule, listModules, updateModule, deleteModule, reorderModules } = require('../controllers/moduleController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

router.use(authenticate);

// Nested under /api/courses/:courseId/modules
router.post('/', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), createModule);
router.get('/', listModules);
router.patch('/reorder', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), reorderModules);

// Direct module routes: /api/modules/:id
router.patch('/:id', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), updateModule);
router.delete('/:id', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), deleteModule);

module.exports = router;
