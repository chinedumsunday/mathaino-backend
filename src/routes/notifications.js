const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { listNotifications, markRead, markAllRead, deleteNotification, broadcast } = require('../controllers/notificationsController');

// All routes require authentication
router.use(authenticate);

router.get('/', listNotifications);
router.post('/broadcast', authorize('SUPER_ADMIN', 'FACULTY'), broadcast);
router.patch('/read-all', markAllRead);
router.patch('/:id/read', markRead);
router.delete('/:id', deleteNotification);

module.exports = router;
