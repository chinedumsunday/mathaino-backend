const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { createLiveSession, listLiveSessions, cancelLiveSession } = require('../controllers/liveSessionController');

router.use(authenticate);

router.get('/', listLiveSessions);
router.post('/', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), createLiveSession);
router.patch('/:id/cancel', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), cancelLiveSession);

module.exports = router;
