const router = require('express').Router();
const { createCourse, listCourses, getCourse, updateCourse, deleteCourse, togglePublish, myCourses } = require('../controllers/courseController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

router.use(authenticate);

// Lecturer gets their own courses
router.get('/my', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), myCourses);

// CRUD
router.post('/', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), createCourse);
router.get('/', listCourses); // All authenticated users can browse
router.get('/:id', getCourse);
router.patch('/:id', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), updateCourse);
router.delete('/:id', authorize('LECTURER', 'SUPER_ADMIN'), deleteCourse);

// Publish toggle
router.patch('/:id/publish', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), togglePublish);

module.exports = router;
