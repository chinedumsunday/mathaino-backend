const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { recalcProgress, awardXp } = require('./progressController');

/**
 * POST /api/content/:id/quiz
 * Submit quiz answers. Body: { answers: [0, 2, 1, ...] } (index of selected option per question)
 */
const submitQuiz = asyncHandler(async (req, res) => {
  const { id: contentId } = req.params;
  const userId = req.user.id;
  const { answers } = req.body;

  if (!Array.isArray(answers)) throw ApiError.badRequest('answers must be an array');

  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { module: { include: { course: true } } },
  });
  if (!content) throw ApiError.notFound('Content not found');
  if (content.type !== 'QUIZ') throw ApiError.badRequest('This content is not a quiz');

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId: content.module.courseId } },
  });
  if (!enrollment || enrollment.status === 'DROPPED') {
    throw ApiError.forbidden('You are not enrolled in this course');
  }

  // Parse questions from body — stored as JSON array
  let questions = [];
  try {
    questions = JSON.parse(content.body || '[]');
  } catch (_) {
    throw ApiError.badRequest('Quiz questions are malformed');
  }

  if (!questions.length) throw ApiError.badRequest('This quiz has no questions');

  // Grade
  let score = 0;
  const results = questions.map((q, i) => {
    const selected = answers[i] ?? -1;
    const correct = selected === q.correct;
    if (correct) score++;
    return { question: q.q, selected, correct: q.correct, isCorrect: correct };
  });

  const total = questions.length;
  const passed = score >= Math.ceil(total * 0.6); // 60% passing threshold

  const attempt = await prisma.quizAttempt.create({
    data: { userId, contentId, answers, score, total, passed },
  });

  // Auto-complete the content if passed
  let xpData = { xpEarned: 0, xp: 0, streak: 0 };
  if (passed) {
    const alreadyDone = await prisma.contentCompletion.findUnique({
      where: { userId_contentId: { userId, contentId } },
    });
    await prisma.contentCompletion.upsert({
      where: { userId_contentId: { userId, contentId } },
      create: { userId, contentId },
      update: {},
    });
    await recalcProgress(userId, content.module.courseId);
    // Award 50 XP for passing a quiz (only on first pass)
    if (!alreadyDone) {
      xpData = await awardXp(userId, 50);
    } else {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { xp: true, streak: true } });
      xpData = { xpEarned: 0, xp: u.xp, streak: u.streak };
    }
  }

  res.json({
    success: true,
    message: passed ? 'Quiz passed! 🎉' : 'Quiz submitted. Try again to pass.',
    data: { attempt, results, score, total, passed, ...xpData },
  });
});

/**
 * GET /api/content/:id/quiz/attempts
 * Get all quiz attempts for the current user on this content
 */
const getAttempts = asyncHandler(async (req, res) => {
  const { id: contentId } = req.params;
  const userId = req.user.id;

  const attempts = await prisma.quizAttempt.findMany({
    where: { userId, contentId },
    orderBy: { attemptedAt: 'desc' },
  });

  res.json({ success: true, data: { attempts } });
});

module.exports = { submitQuiz, getAttempts };
