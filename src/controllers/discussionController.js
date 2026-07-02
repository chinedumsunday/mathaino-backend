const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { isCourseManager } = require('../utils/contentSanitizer');

// Posting requires being the course manager or an actively enrolled student
async function assertPostAccess(user, courseId) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw ApiError.notFound('Course not found');
  if (isCourseManager(user, course)) return course;

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!enrollment || !['ENROLLED', 'COMPLETED'].includes(enrollment.status)) {
    throw ApiError.forbidden('Enroll in this course to join the discussion');
  }
  return course;
}

/**
 * GET /api/courses/:courseId/discussions
 */
const listDiscussions = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [discussions, total] = await Promise.all([
    prisma.courseDiscussion.findMany({
      where: { courseId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true } },
        replies: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { replies: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit),
    }),
    prisma.courseDiscussion.count({ where: { courseId } }),
  ]);

  res.json({
    success: true,
    data: {
      discussions,
      pagination: { total, page: parseInt(page), limit: parseInt(limit) },
    },
  });
});

/**
 * POST /api/courses/:courseId/discussions
 */
const createDiscussion = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { body } = req.body;

  if (!body?.trim()) throw ApiError.badRequest('Post body cannot be empty');

  await assertPostAccess(req.user, courseId);

  const discussion = await prisma.courseDiscussion.create({
    data: { courseId, userId: req.user.id, body: body.trim() },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true } },
      replies: true,
      _count: { select: { replies: true } },
    },
  });

  res.status(201).json({ success: true, data: { discussion } });
});

/**
 * DELETE /api/discussions/:id
 */
const deleteDiscussion = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const discussion = await prisma.courseDiscussion.findUnique({
    where: { id },
    include: { course: { select: { creatorId: true } } },
  });
  if (!discussion) throw ApiError.notFound('Discussion post not found');

  const isCourseOwner = discussion.course.creatorId === req.user.id;
  if (discussion.userId !== req.user.id && !isCourseOwner && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized to delete this post');
  }

  await prisma.courseDiscussion.delete({ where: { id } });
  res.json({ success: true, message: 'Post deleted' });
});

/**
 * POST /api/discussions/:id/replies
 */
const createReply = asyncHandler(async (req, res) => {
  const { id: discussionId } = req.params;
  const { body } = req.body;

  if (!body?.trim()) throw ApiError.badRequest('Reply body cannot be empty');

  const discussion = await prisma.courseDiscussion.findUnique({ where: { id: discussionId } });
  if (!discussion) throw ApiError.notFound('Discussion post not found');

  await assertPostAccess(req.user, discussion.courseId);

  const reply = await prisma.discussionReply.create({
    data: { discussionId, userId: req.user.id, body: body.trim() },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true } },
    },
  });

  res.status(201).json({ success: true, data: { reply } });
});

/**
 * DELETE /api/discussions/replies/:id
 */
const deleteReply = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const reply = await prisma.discussionReply.findUnique({
    where: { id },
    include: { discussion: { include: { course: { select: { creatorId: true } } } } },
  });
  if (!reply) throw ApiError.notFound('Reply not found');

  const isCourseOwner = reply.discussion.course.creatorId === req.user.id;
  if (reply.userId !== req.user.id && !isCourseOwner && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized to delete this reply');
  }

  await prisma.discussionReply.delete({ where: { id } });
  res.json({ success: true, message: 'Reply deleted' });
});

module.exports = { listDiscussions, createDiscussion, deleteDiscussion, createReply, deleteReply };
