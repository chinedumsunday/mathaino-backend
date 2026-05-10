const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * POST /api/courses/:courseId/modules
 * Add a module to a course
 */
const createModule = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { title } = req.body;

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw ApiError.notFound('Course not found');
  if (course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized');
  }

  // Get next sort order
  const lastModule = await prisma.module.findFirst({
    where: { courseId },
    orderBy: { sortOrder: 'desc' },
  });

  const mod = await prisma.module.create({
    data: {
      courseId,
      title,
      sortOrder: (lastModule?.sortOrder ?? -1) + 1,
    },
    include: { contents: true },
  });

  res.status(201).json({ success: true, message: 'Module created', data: { module: mod } });
});

/**
 * GET /api/courses/:courseId/modules
 * List modules for a course
 */
const listModules = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  const modules = await prisma.module.findMany({
    where: { courseId },
    orderBy: { sortOrder: 'asc' },
    include: {
      contents: { orderBy: { sortOrder: 'asc' } },
    },
  });

  res.json({ success: true, data: { modules } });
});

/**
 * PATCH /api/modules/:id
 * Update a module
 */
const updateModule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;

  const mod = await prisma.module.findUnique({ where: { id }, include: { course: true } });
  if (!mod) throw ApiError.notFound('Module not found');
  if (mod.course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized');
  }

  const updated = await prisma.module.update({
    where: { id },
    data: { title },
    include: { contents: true },
  });

  res.json({ success: true, message: 'Module updated', data: { module: updated } });
});

/**
 * DELETE /api/modules/:id
 * Delete a module and all its content
 */
const deleteModule = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const mod = await prisma.module.findUnique({ where: { id }, include: { course: true } });
  if (!mod) throw ApiError.notFound('Module not found');
  if (mod.course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized');
  }

  await prisma.module.delete({ where: { id } });

  res.json({ success: true, message: 'Module deleted' });
});

/**
 * PATCH /api/courses/:courseId/modules/reorder
 * Reorder modules
 * Body: { moduleIds: ["id1", "id2", "id3"] }
 */
const reorderModules = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { moduleIds } = req.body;

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw ApiError.notFound('Course not found');
  if (course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized');
  }

  // Update sort order for each module
  await Promise.all(
    moduleIds.map((id, index) =>
      prisma.module.update({ where: { id }, data: { sortOrder: index } })
    )
  );

  const modules = await prisma.module.findMany({
    where: { courseId },
    orderBy: { sortOrder: 'asc' },
    include: { contents: true },
  });

  res.json({ success: true, message: 'Modules reordered', data: { modules } });
});

module.exports = { createModule, listModules, updateModule, deleteModule, reorderModules };
