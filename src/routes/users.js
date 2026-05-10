const router = require('express').Router();
const {
  listUsers, getUser, changeRole, changeStatus, updateProfile, getStats, createLecturer, createStudent, getLeaderboard,
} = require('../controllers/userController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { updateProfileSchema, changeRoleSchema, updateStatusSchema } = require('../utils/validators');

// All user routes require authentication
router.use(authenticate);

// Self-service
router.patch('/profile', validate(updateProfileSchema), updateProfile);

// Leaderboard (all authenticated users)
router.get('/leaderboard', getLeaderboard);

// Admin routes
router.get('/stats', authorize('SUPER_ADMIN', 'FACULTY'), getStats);
router.get('/', authorize('SUPER_ADMIN', 'FACULTY'), listUsers);
router.post('/lecturers', authorize('SUPER_ADMIN', 'FACULTY'), createLecturer);
router.post('/students', authorize('SUPER_ADMIN', 'FACULTY'), createStudent);
router.get('/:id', authorize('SUPER_ADMIN', 'FACULTY'), getUser);
router.patch('/:id/role', authorize('SUPER_ADMIN'), changeRole);
router.patch('/:id/status', authorize('SUPER_ADMIN', 'FACULTY'), changeStatus);

module.exports = router;
