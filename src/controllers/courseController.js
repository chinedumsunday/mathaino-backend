const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * POST /api/courses
 * Create a new course (Lecturer, Faculty, Super Admin)
 */
const createCourse = asyncHandler(async (req, res) => {
  const { title, code, description, coverImage } = req.body;

  const course = await prisma.course.create({
    data: {
      title,
      code,
      description,
      coverImage,
      creatorId: req.user.id,
    },
    include: { creator: { select: { id: true, firstName: true, lastName: true, email: true } } },
  });

  await prisma.auditLog.create({
    data: { actorId: req.user.id, action: 'CREATE_COURSE', entity: 'Course', entityId: course.id },
  });

  res.status(201).json({ success: true, message: 'Course created', data: { course } });
});

/**
 * GET /api/courses
 * List courses with filters
 * Query: ?search=database&published=true&creatorId=xxx&page=1&limit=20
 */
const listCourses = asyncHandler(async (req, res) => {
  const { search, published, creatorId, page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
    ...(published !== undefined && { isPublished: published === 'true' }),
    ...(creatorId && { creatorId }),
  };

  // Students only see published courses
  if (req.user.role === 'STUDENT') {
    where.isPublished = true;
  }

  const [courses, total] = await Promise.all([
    prisma.course.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { modules: true, enrollments: true } },
      },
    }),
    prisma.course.count({ where }),
  ]);

  res.json({
    success: true,
    data: {
      courses,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    },
  });
});

/**
 * GET /api/courses/:id
 * Get single course with modules, content, and enrollment status
 */
const getCourse = asyncHandler(async (req, res) => {
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: {
      creator: { select: { id: true, firstName: true, lastName: true, email: true } },
      modules: {
        orderBy: { sortOrder: 'asc' },
        include: {
          contents: { orderBy: { sortOrder: 'asc' } },
        },
      },
      _count: { select: { enrollments: true } },
    },
  });

  if (!course) throw ApiError.notFound('Course not found');

  // Check if current user is enrolled
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: req.user.id, courseId: course.id } },
  });

  res.json({
    success: true,
    data: { course, enrollment },
  });
});

/**
 * PATCH /api/courses/:id
 * Update a course (creator, Faculty, Super Admin)
 */
const updateCourse = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, code, description, coverImage, isPublished } = req.body;

  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) throw ApiError.notFound('Course not found');

  // Only creator, faculty, or admin can update
  if (course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized to update this course');
  }

  const updated = await prisma.course.update({
    where: { id },
    data: {
      ...(title && { title }),
      ...(code && { code }),
      ...(description !== undefined && { description }),
      ...(coverImage !== undefined && { coverImage }),
      ...(isPublished !== undefined && { isPublished }),
    },
    include: {
      creator: { select: { id: true, firstName: true, lastName: true } },
      modules: { orderBy: { sortOrder: 'asc' } },
    },
  });

  res.json({ success: true, message: 'Course updated', data: { course: updated } });
});

/**
 * DELETE /api/courses/:id
 * Delete a course (creator, Super Admin)
 */
const deleteCourse = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) throw ApiError.notFound('Course not found');

  if (course.creatorId !== req.user.id && req.user.role !== 'SUPER_ADMIN') {
    throw ApiError.forbidden('Not authorized to delete this course');
  }

  await prisma.course.delete({ where: { id } });

  await prisma.auditLog.create({
    data: { actorId: req.user.id, action: 'DELETE_COURSE', entity: 'Course', entityId: id },
  });

  res.json({ success: true, message: 'Course deleted' });
});

/**
 * PATCH /api/courses/:id/publish
 * Toggle publish status
 */
const togglePublish = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) throw ApiError.notFound('Course not found');

  if (course.creatorId !== req.user.id && !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Not authorized');
  }

  const updated = await prisma.course.update({
    where: { id },
    data: { isPublished: !course.isPublished },
  });

  res.json({
    success: true,
    message: updated.isPublished ? 'Course published' : 'Course unpublished',
    data: { course: updated },
  });
});

/**
 * GET /api/courses/my
 * Get courses created by the current user (for lecturers)
 */
const myCourses = asyncHandler(async (req, res) => {
  const courses = await prisma.course.findMany({
    where: { creatorId: req.user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { modules: true, enrollments: true } },
    },
  });

  res.json({ success: true, data: { courses } });
});

module.exports = { createCourse, listCourses, getCourse, updateCourse, deleteCourse, togglePublish, myCourses };
