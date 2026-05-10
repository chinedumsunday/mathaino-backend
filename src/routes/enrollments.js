const router = require('express').Router({ mergeParams: true });
const {
  enroll,
  unenroll,
  myEnrollments,
  updateProgress,
  courseStudents,
  pendingEnrollments,
  approveEnrollment,
} = require('../controllers/enrollmentController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

router.use(authenticate);

// Student enrollment
router.post('/courses/:courseId/enroll', enroll);
router.delete('/courses/:courseId/enroll', unenroll);

// My enrollments
router.get('/enrollments/my', myEnrollments);

// Update progress
router.patch('/enrollments/:id/progress', updateProgress);

// Course students (for lecturers/admin)
router.get('/courses/:courseId/students', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), courseStudents);

// Pending enrollments for lecturer's courses
router.get('/enrollments/pending', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), pendingEnrollments);

// Approve or reject a pending enrollment
router.patch('/enrollments/:id/approve', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), approveEnrollment);

module.exports = router;
