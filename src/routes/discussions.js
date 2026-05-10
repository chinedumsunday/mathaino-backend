const router = require('express').Router({ mergeParams: true });
const {
  listDiscussions, createDiscussion, deleteDiscussion, createReply, deleteReply,
} = require('../controllers/discussionController');
const authenticate = require('../middleware/authenticate');

router.use(authenticate);

// Nested under /api/courses/:courseId/discussions
router.get('/', listDiscussions);
router.post('/', createDiscussion);

// Flat discussion actions
router.delete('/:id', deleteDiscussion);
router.post('/:id/replies', createReply);
router.delete('/replies/:id', deleteReply);

module.exports = router;
