const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

// Recalculate enrollment progress for a user in a course
async function recalcProgress(userId, courseId) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { modules: { include: { contents: { select: { id: true } } } } },
  });
  if (!course) return;

  const allContentIds = course.modules.flatMap(m => m.contents.map(c => c.id));
  if (allContentIds.length === 0) return;

  const completedCount = await prisma.contentCompletion.count({
    where: { userId, contentId: { in: allContentIds } },
  });

  const progress = Math.round((completedCount / allContentIds.length) * 100);

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
  });
  if (!enrollment) return;

  await prisma.enrollment.update({
    where: { userId_courseId: { userId, courseId } },
    data: {
      progress,
      ...(progress >= 100 && { status: 'COMPLETED' }),
    },
  });

  // Auto-issue certificate on 100%
  if (progress >= 100) {
    await prisma.certificate.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId },
      update: {},
    });
  }

  return progress;
}

/**
 * POST /api/content/:id/complete
 * Mark a content item as complete for the authenticated student
 */
const markComplete = asyncHandler(async (req, res) => {
  const { id: contentId } = req.params;
  const userId = req.user.id;

  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { module: { include: { course: true } } },
  });
  if (!content) throw ApiError.notFound('Content not found');

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId: content.module.courseId } },
  });
  if (!enrollment || enrollment.status === 'DROPPED') {
    throw ApiError.forbidden('You are not enrolled in this course');
  }

  const already = await prisma.contentCompletion.findUnique({
    where: { userId_contentId: { userId, contentId } },
  });

  await prisma.contentCompletion.upsert({
    where: { userId_contentId: { userId, contentId } },
    create: { userId, contentId },
    update: {},
  });

  const progress = await recalcProgress(userId, content.module.courseId);

  // Award XP + update streak only on first completion
  let xpData = { xpEarned: 0, xp: 0, streak: 0 };
  if (!already) {
    xpData = await awardXp(userId, 25);
  } else {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { xp: true, streak: true } });
    xpData = { xpEarned: 0, xp: u.xp, streak: u.streak };
  }

  res.json({ success: true, message: 'Marked as complete', data: { progress, ...xpData } });
});

/**
 * GET /api/content/:id/completion
 * Check if current user has completed a content item
 */
const getCompletion = asyncHandler(async (req, res) => {
  const { id: contentId } = req.params;
  const userId = req.user.id;

  const completion = await prisma.contentCompletion.findUnique({
    where: { userId_contentId: { userId, contentId } },
  });

  res.json({ success: true, data: { completed: !!completion, completion } });
});

// Shared helper: award XP + update streak for a user
// Returns { xpEarned, xp, streak }
async function awardXp(userId, amount) {
  const now = new Date();
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { xp: true, streak: true, lastActiveAt: true },
  });
  const last = currentUser.lastActiveAt ? new Date(currentUser.lastActiveAt) : null;

  let streak = currentUser.streak || 0;
  if (!last) {
    streak = 1;
  } else {
    const daysSinceLast = Math.floor((now - last) / (1000 * 60 * 60 * 24));
    if (daysSinceLast === 1) streak += 1;
    else if (daysSinceLast > 1) streak = 1;
    // daysSinceLast === 0 → same day, no change
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { xp: { increment: amount }, streak, lastActiveAt: now },
    select: { xp: true, streak: true },
  });
  return { xpEarned: amount, xp: updated.xp, streak: updated.streak };
}

module.exports = { markComplete, getCompletion, recalcProgress, awardXp };
