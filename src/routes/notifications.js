const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const { listNotifications, markRead, markAllRead, deleteNotification } = require('../controllers/notificationsController');

// All routes require authentication
router.use(authenticate);

router.get('/', listNotifications);
router.patch('/read-all', markAllRead);
router.patch('/:id/read', markRead);
router.delete('/:id', deleteNotification);

module.exports = router;
