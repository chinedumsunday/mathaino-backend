const router = require('express').Router({ mergeParams: true });
const { createContent, listContent, getContent, updateContent, deleteContent, reorderContent } = require('../controllers/contentController');
const { markComplete, getCompletion } = require('../controllers/progressController');
const { submitQuiz, getAttempts } = require('../controllers/quizController');
const { submitAssignment, getSubmission, gradeSubmission } = require('../controllers/submissionController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

router.use(authenticate);

// Nested under /api/modules/:moduleId/content
router.post('/', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), createContent);
router.get('/', listContent);
router.patch('/reorder', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), reorderContent);

// Direct content routes: /api/content/:id
router.get('/:id', getContent);
router.patch('/:id', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), updateContent);
router.delete('/:id', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), deleteContent);

// Completion
router.post('/:id/complete', markComplete);
router.get('/:id/completion', getCompletion);

// Quiz
router.post('/:id/quiz', submitQuiz);
router.get('/:id/quiz/attempts', getAttempts);

// Assignment submission
router.post('/:id/submit', submitAssignment);
router.get('/:id/submission', getSubmission);
router.patch('/:id/submission/:submissionId/grade', authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'), gradeSubmission);

module.exports = router;
