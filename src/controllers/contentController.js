const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { stripQuizAnswers, isCourseManager } = require('../utils/contentSanitizer');

// Students may only read content of courses they're actively enrolled in
async function assertReadAccess(user, course) {
  if (isCourseManager(user, course)) return true;
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: course.id } },
  });
  if (!enrollment || !['ENROLLED', 'COMPLETED'].includes(enrollment.status)) {
    throw ApiError.forbidden('Enroll in this course to access its content');
  }
  return false;
}

/**
 * POST /api/modules/:moduleId/content
 * Add content (lesson) to a module
 */
const createContent = asyncHandler(async (req, res) => {
  const { moduleId } = req.params;
  const { title, type, body, mediaUrl, durationMin } = req.body;

  const mod = await prisma.module.findUnique({ where: { id: moduleId }, include: { course: true } });
  if (!mod) throw ApiError.notFound('Module not found');
  if (mod.course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized');
  }

  const lastContent = await prisma.content.findFirst({
    where: { moduleId },
    orderBy: { sortOrder: 'desc' },
  });

  const content = await prisma.content.create({
    data: {
      moduleId,
      title,
      type,
      body,
      mediaUrl,
      durationMin,
      sortOrder: (lastContent?.sortOrder ?? -1) + 1,
    },
  });

  res.status(201).json({ success: true, message: 'Content created', data: { content } });
});

/**
 * GET /api/modules/:moduleId/content
 * List content for a module
 */
const listContent = asyncHandler(async (req, res) => {
  const { moduleId } = req.params;

  const mod = await prisma.module.findUnique({ where: { id: moduleId }, include: { course: true } });
  if (!mod) throw ApiError.notFound('Module not found');
  const isManager = await assertReadAccess(req.user, mod.course);

  let contents = await prisma.content.findMany({
    where: { moduleId },
    orderBy: { sortOrder: 'asc' },
  });
  if (!isManager) contents = contents.map(stripQuizAnswers);

  res.json({ success: true, data: { contents } });
});

/**
 * GET /api/content/:id
 * Get single content item
 */
const getContent = asyncHandler(async (req, res) => {
  let content = await prisma.content.findUnique({
    where: { id: req.params.id },
    include: { module: { include: { course: true } } },
  });

  if (!content) throw ApiError.notFound('Content not found');

  const isManager = await assertReadAccess(req.user, content.module.course);
  if (!isManager) content = stripQuizAnswers(content);

  res.json({ success: true, data: { content } });
});

/**
 * PATCH /api/content/:id
 * Update content
 */
const updateContent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, type, body, mediaUrl, durationMin } = req.body;

  const content = await prisma.content.findUnique({
    where: { id },
    include: { module: { include: { course: true } } },
  });
  if (!content) throw ApiError.notFound('Content not found');
  if (content.module.course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized');
  }

  const updated = await prisma.content.update({
    where: { id },
    data: {
      ...(title && { title }),
      ...(type && { type }),
      ...(body !== undefined && { body }),
      ...(mediaUrl !== undefined && { mediaUrl }),
      ...(durationMin !== undefined && { durationMin }),
    },
  });

  res.json({ success: true, message: 'Content updated', data: { content: updated } });
});

/**
 * DELETE /api/content/:id
 * Delete content
 */
const deleteContent = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const content = await prisma.content.findUnique({
    where: { id },
    include: { module: { include: { course: true } } },
  });
  if (!content) throw ApiError.notFound('Content not found');
  if (content.module.course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized');
  }

  await prisma.content.delete({ where: { id } });

  res.json({ success: true, message: 'Content deleted' });
});

/**
 * PATCH /api/modules/:moduleId/content/reorder
 * Reorder content within a module
 * Body: { contentIds: ["id1", "id2"] }
 */
const reorderContent = asyncHandler(async (req, res) => {
  const { moduleId } = req.params;
  const { contentIds } = req.body;

  const mod = await prisma.module.findUnique({ where: { id: moduleId }, include: { course: true } });
  if (!mod) throw ApiError.notFound('Module not found');
  if (mod.course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized');
  }

  await Promise.all(
    contentIds.map((id, index) =>
      prisma.content.update({ where: { id }, data: { sortOrder: index } })
    )
  );

  const contents = await prisma.content.findMany({
    where: { moduleId },
    orderBy: { sortOrder: 'asc' },
  });

  res.json({ success: true, message: 'Content reordered', data: { contents } });
});

module.exports = { createContent, listContent, getContent, updateContent, deleteContent, reorderContent };
