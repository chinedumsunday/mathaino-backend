const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { recalcProgress } = require('./progressController');

/**
 * POST /api/content/:id/submit
 * Student submits an assignment. Body: { text?, fileUrl? }
 */
const submitAssignment = asyncHandler(async (req, res) => {
  const { id: contentId } = req.params;
  const userId = req.user.id;
  const { text, fileUrl } = req.body;

  if (!text && !fileUrl) throw ApiError.badRequest('Submission must include text or a file URL');

  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { module: { include: { course: true } } },
  });
  if (!content) throw ApiError.notFound('Content not found');
  if (content.type !== 'ASSIGNMENT') throw ApiError.badRequest('This content is not an assignment');

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId: content.module.courseId } },
  });
  if (!enrollment || enrollment.status === 'DROPPED') {
    throw ApiError.forbidden('You are not enrolled in this course');
  }

  const submission = await prisma.submission.upsert({
    where: { userId_contentId: { userId, contentId } },
    create: { userId, contentId, text, fileUrl, status: 'SUBMITTED' },
    update: { text, fileUrl, status: 'SUBMITTED', grade: null, feedback: null, gradedAt: null },
  });

  res.status(201).json({ success: true, message: 'Assignment submitted', data: { submission } });
});

/**
 * GET /api/content/:id/submission
 * Student: get their own submission. Lecturer: get all submissions for this content.
 */
const getSubmission = asyncHandler(async (req, res) => {
  const { id: contentId } = req.params;
  const { role, id: userId } = req.user;

  if (['LECTURER', 'FACULTY', 'SUPER_ADMIN'].includes(role)) {
    const submissions = await prisma.submission.findMany({
      where: { contentId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });
    return res.json({ success: true, data: { submissions } });
  }

  const submission = await prisma.submission.findUnique({
    where: { userId_contentId: { userId, contentId } },
  });
  res.json({ success: true, data: { submission } });
});

/**
 * PATCH /api/content/:id/submission/:submissionId/grade
 * Lecturer grades a submission. Body: { grade (0-100), feedback? }
 */
const gradeSubmission = asyncHandler(async (req, res) => {
  const { submissionId } = req.params;
  const { grade, feedback } = req.body;

  if (grade === undefined || grade < 0 || grade > 100) {
    throw ApiError.badRequest('Grade must be a number between 0 and 100');
  }

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { content: { include: { module: { include: { course: true } } } } },
  });
  if (!submission) throw ApiError.notFound('Submission not found');

  const course = submission.content.module.course;
  if (course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized to grade this submission');
  }

  const updated = await prisma.submission.update({
    where: { id: submissionId },
    data: { grade, feedback, status: 'GRADED', gradedAt: new Date() },
  });

  // Auto-complete the content when graded with a passing score (50%+)
  if (grade >= 50) {
    await prisma.contentCompletion.upsert({
      where: { userId_contentId: { userId: submission.userId, contentId: submission.contentId } },
      create: { userId: submission.userId, contentId: submission.contentId },
      update: {},
    });
    await recalcProgress(submission.userId, course.id);
  }

  // Notify student
  await prisma.notification.create({
    data: {
      userId: submission.userId,
      title: 'Assignment Graded',
      message: `Your assignment "${submission.content.title}" has been graded: ${grade}/100.${feedback ? ' Feedback: ' + feedback : ''}`,
    },
  });

  res.json({ success: true, message: 'Submission graded', data: { submission: updated } });
});

/**
 * GET /api/courses/:courseId/submissions
 * Lecturer: get all submissions for a course (paginated)
 */
const getCourseSubmissions = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw ApiError.notFound('Course not found');
  if (course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized');
  }

  const submissions = await prisma.submission.findMany({
    where: {
      content: { module: { courseId } },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
      content: { select: { id: true, title: true, type: true } },
    },
    orderBy: { submittedAt: 'desc' },
  });

  res.json({ success: true, data: { submissions } });
});

module.exports = { submitAssignment, getSubmission, gradeSubmission, getCourseSubmissions };
