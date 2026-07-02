const router = require('express').Router();
const { submitCoursework, myCoursework, listCoursework, reviewCoursework } = require('../controllers/courseworkController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

router.use(authenticate);

// Lecturer: submit a document + see own submissions
router.post('/', authorize('LECTURER'), submitCoursework);
router.get('/mine', authorize('LECTURER'), myCoursework);

// Admin/faculty: review queue
router.get('/', authorize('FACULTY', 'SUPER_ADMIN'), listCoursework);
router.patch('/:id/review', authorize('FACULTY', 'SUPER_ADMIN'), reviewCoursework);

module.exports = router;
