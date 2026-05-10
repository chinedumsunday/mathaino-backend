const router = require('express').Router();
const { chat, youtubeSuggest } = require('../controllers/aiController');
const authenticate = require('../middleware/authenticate');

router.use(authenticate);

router.post('/chat', chat);
router.post('/youtube-suggest', youtubeSuggest);

module.exports = router;
