const router = require('express').Router({ mergeParams: true });
const {
  enroll,
  unenroll,
  myEnrollments,
  courseStudents,
  pendingEnrollments,
  approveEnrollment,
  registerStudent,
  unregisterStudent,
} = require('../controllers/enrollmentController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

router.use(authenticate);

// Student enrollment (creates a PENDING request — lecturer approves)
router.post('/courses/:courseId/enroll', enroll);
router.delete('/courses/:courseId/enroll', unenroll);

// My enrollments
router.get('/enrollments/my', myEnrollments);

// NOTE: the old PATCH /enrollments/:id/progress endpoint was removed —
// progress is computed server-side from content completions only.

// Course students (creator/faculty/admin — ownership checked in controller)
router.get('/courses/:courseId/students', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), courseStudents);

// Admin/faculty: directly register a student into a course
router.post('/courses/:courseId/students', authorize('FACULTY', 'SUPER_ADMIN'), registerStudent);

// Creator/faculty/admin: unregister a student from a course
router.delete('/courses/:courseId/students/:userId', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), unregisterStudent);

// Pending enrollments (lecturer: own courses, faculty/admin: all)
router.get('/enrollments/pending', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), pendingEnrollments);

// Approve or reject a pending enrollment
router.patch('/enrollments/:id/approve', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), approveEnrollment);

module.exports = router;
