const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const {
  createLiveSession, listLiveSessions, cancelLiveSession,
  startLiveSession, endLiveSession, joinLiveSession,
  heartbeat, leaveLiveSession, getAttendance,
} = require('../controllers/liveSessionController');

router.use(authenticate);

router.get('/', listLiveSessions);
router.post('/', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), createLiveSession);
router.patch('/:id/cancel', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), cancelLiveSession);

// Live classroom + focus-mode attendance
router.patch('/:id/start', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), startLiveSession);
router.patch('/:id/end', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), endLiveSession);
router.get('/:id/attendance', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), getAttendance);
router.post('/:id/join', joinLiveSession);
router.post('/:id/heartbeat', heartbeat);
router.post('/:id/leave', leaveLiveSession);

module.exports = router;
