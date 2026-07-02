const router = require('express').Router();
const {
  listUsers, getUser, changeRole, changeStatus, updateProfile, updatePushToken, getStats, createLecturer, createStudent, getLeaderboard, deleteMe,
} = require('../controllers/userController');
const { userEnrollments } = require('../controllers/enrollmentController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { updateProfileSchema } = require('../utils/validators');

// All user routes require authentication
router.use(authenticate);

// Self-service
router.patch('/profile', validate(updateProfileSchema), updateProfile);
router.patch('/push-token', updatePushToken);
router.delete('/me', deleteMe);

// Leaderboard (all authenticated users)
router.get('/leaderboard', getLeaderboard);

// Admin routes
router.get('/stats', authorize('SUPER_ADMIN', 'FACULTY'), getStats);
router.get('/', authorize('SUPER_ADMIN', 'FACULTY'), listUsers);
router.post('/lecturers', authorize('SUPER_ADMIN', 'FACULTY'), createLecturer);
router.post('/students', authorize('SUPER_ADMIN', 'FACULTY'), createStudent);
router.get('/:id', authorize('SUPER_ADMIN', 'FACULTY'), getUser);
router.get('/:id/enrollments', authorize('SUPER_ADMIN', 'FACULTY'), userEnrollments);
router.patch('/:id/role', authorize('SUPER_ADMIN'), changeRole);
router.patch('/:id/status', authorize('SUPER_ADMIN', 'FACULTY'), changeStatus);

module.exports = router;
