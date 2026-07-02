const router = require('express').Router();
const { getCertificate } = require('../controllers/certificateController');
const { getCourseSubmissions } = require('../controllers/submissionController');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

// ─── Auth (must be before the catch-all enrollments router) ─
router.use('/auth', require('./auth'));

// ─── Health (must also be before enrollments catch-all) ─────
router.get('/health', (req, res) => {
  const jaas = require('../services/jaasService');
  res.json({
    success: true,
    message: 'iLearn API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    // 'jaas' = in-app live classes use 8x8 rooms with signed JWTs (no
    // moderator login prompt); 'public-fallback' = JAAS_* env vars missing
    liveClassrooms: jaas.isConfigured() ? 'jaas' : 'public-fallback',
  });
});

// ─── Users ──────────────────────────────────────────────
router.use('/users', require('./users'));

// ─── Enrollments (flat + nested under courses) ──────────
router.use('/', require('./enrollments'));

// ─── Courses → Modules → Content (nested chain) ─────────
const coursesRouter = require('./courses');
const modulesRouter = require('./modules');
const contentRouter = require('./content');
const discussionsRouter = require('./discussions');

// Nest content inside modules: /api/modules/:moduleId/content/*
modulesRouter.use('/:moduleId/content', contentRouter);

// Nest modules inside courses: /api/courses/:courseId/modules/*
coursesRouter.use('/:courseId/modules', modulesRouter);

// Nest discussions inside courses: /api/courses/:courseId/discussions/*
coursesRouter.use('/:courseId/discussions', discussionsRouter);

// Course submissions (lecturer): /api/courses/:courseId/submissions
coursesRouter.get(
  '/:courseId/submissions',
  authenticate,
  authorize('LECTURER', 'FACULTY', 'SUPER_ADMIN'),
  getCourseSubmissions
);

// Course certificate: /api/courses/:courseId/certificate
coursesRouter.get('/:courseId/certificate', authenticate, getCertificate);

router.use('/courses', coursesRouter);

// Also expose module/content CRUD by ID directly
router.use('/modules', modulesRouter);
router.use('/content', contentRouter);

// Flat discussion actions: /api/discussions/:id (delete, reply)
router.use('/discussions', discussionsRouter);

// ─── Certificates ────────────────────────────────────────
router.use('/certificates', require('./certificates'));

// ─── AI Chatbot ──────────────────────────────────────────
router.use('/ai', require('./ai'));

// ─── Social Feeds ────────────────────────────────────────
router.use('/social', require('./social'));

// ─── Notifications ───────────────────────────────────────
router.use('/notifications', require('./notifications'));

// ─── Live Sessions ───────────────────────────────────────
router.use('/live-sessions', require('./liveSessions'));

// ─── Coursework document submissions (lecturer → admin) ──
router.use('/coursework', require('./coursework'));

module.exports = router;
