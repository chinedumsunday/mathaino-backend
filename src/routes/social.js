const router = require('express').Router();
const {
  getFeed, createPost, deletePost,
  toggleLike, getComments, addComment, deleteComment,
  youtubeSearch,
} = require('../controllers/socialController');
const authenticate = require('../middleware/authenticate');

router.use(authenticate);

// Feed
router.get('/feed', getFeed);

// Posts
router.post('/posts', createPost);
router.delete('/posts/:id', deletePost);
router.post('/posts/:id/like', toggleLike);
router.get('/posts/:id/comments', getComments);
router.post('/posts/:id/comments', addComment);
router.delete('/comments/:id', deleteComment);

// YouTube search
router.get('/youtube', youtubeSearch);

module.exports = router;
