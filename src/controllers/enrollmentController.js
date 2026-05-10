const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * POST /api/courses/:courseId/enroll
 * Enroll current user in a course
 */
const enroll = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw ApiError.notFound('Course not found');
  if (!course.isPublished) throw ApiError.badRequest('Course is not published');

  // Check if already enrolled
  const existing = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: req.user.id, courseId } },
  });
  if (existing) throw ApiError.conflict('Already enrolled in this course');

  const enrollment = await prisma.enrollment.create({
    data: {
      userId: req.user.id,
      courseId,
      status: 'ENROLLED',
    },
    include: {
      course: { select: { id: true, title: true, code: true } },
    },
  });

  // Create notification
  await prisma.notification.create({
    data: {
      userId: req.user.id,
      title: 'Enrolled Successfully!',
      message: `You've been enrolled in ${course.title}. Start learning now!`,
    },
  });

  res.status(201).json({ success: true, message: `Enrolled in ${course.title}`, data: { enrollment } });
});

/**
 * DELETE /api/courses/:courseId/enroll
 * Drop (unenroll) from a course
 */
const unenroll = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: req.user.id, courseId } },
  });
  if (!enrollment) throw ApiError.notFound('Not enrolled in this course');

  await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: { status: 'DROPPED' },
  });

  res.json({ success: true, message: 'Unenrolled from course' });
});

/**
 * GET /api/enrollments/my
 * Get current user's enrolled courses with progress
 */
const myEnrollments = asyncHandler(async (req, res) => {
  const { status } = req.query;

  const where = {
    userId: req.user.id,
    ...(status && { status }),
  };

  const enrollments = await prisma.enrollment.findMany({
    where,
    orderBy: { enrolledAt: 'desc' },
    include: {
      course: {
        include: {
          creator: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { modules: true } },
        },
      },
    },
  });

  res.json({ success: true, data: { enrollments } });
});

/**
 * PATCH /api/enrollments/:id/progress
 * Update enrollment progress
 * Body: { progress: 72 }
 */
const updateProgress = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { progress } = req.body;

  const enrollment = await prisma.enrollment.findUnique({ where: { id } });
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  if (enrollment.userId !== req.user.id) throw ApiError.forbidden('Not your enrollment');

  const status = progress >= 100 ? 'COMPLETED' : 'ENROLLED';

  const updated = await prisma.enrollment.update({
    where: { id },
    data: { progress, status },
  });

  // If completed, send notification
  if (status === 'COMPLETED') {
    const course = await prisma.course.findUnique({ where: { id: enrollment.courseId } });
    await prisma.notification.create({
      data: {
        userId: req.user.id,
        title: 'Course Completed! 🎉',
        message: `Congratulations! You've completed ${course.title}.`,
      },
    });
  }

  res.json({ success: true, message: 'Progress updated', data: { enrollment: updated } });
});

/**
 * GET /api/courses/:courseId/students
 * Get enrolled students for a course (for lecturers/admin)
 */
const courseStudents = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [enrollments, total] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId, status: { not: 'DROPPED' } },
      skip,
      take: parseInt(limit),
      orderBy: { enrolledAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
      },
    }),
    prisma.enrollment.count({ where: { courseId, status: { not: 'DROPPED' } } }),
  ]);

  res.json({
    success: true,
    data: {
      enrollments,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    },
  });
});

/**
 * GET /api/enrollments/pending
 * Get all PENDING enrollments for the authenticated lecturer's courses.
 */
const pendingEnrollments = asyncHandler(async (req, res) => {
  const myCourses = await prisma.course.findMany({
    where: { creatorId: req.user.id },
    select: { id: true },
  });

  const courseIds = myCourses.map(c => c.id);

  const enrollments = await prisma.enrollment.findMany({
    where: {
      courseId: { in: courseIds },
      status: 'PENDING',
    },
    orderBy: { enrolledAt: 'asc' },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
      course: { select: { id: true, title: true, code: true } },
    },
  });

  res.json({ success: true, data: { enrollments } });
});

/**
 * PATCH /api/enrollments/:id/approve
 * Approve or reject a pending enrollment.
 * Body: { action: 'approve' | 'reject' }
 */
const approveEnrollment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    throw ApiError.badRequest('action must be "approve" or "reject"');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { id },
    include: { course: true },
  });

  if (!enrollment) throw ApiError.notFound('Enrollment not found');

  // Only the course creator (lecturer) or admin/faculty can approve
  if (
    enrollment.course.creatorId !== req.user.id &&
    !['FACULTY', 'SUPER_ADMIN'].includes(req.user.role)
  ) {
    throw ApiError.forbidden('Not authorized to manage this enrollment');
  }

  const newStatus = action === 'approve' ? 'ENROLLED' : 'DROPPED';

  const updated = await prisma.enrollment.update({
    where: { id },
    data: { status: newStatus },
  });

  // Notify the student
  await prisma.notification.create({
    data: {
      userId: enrollment.userId,
      title: action === 'approve' ? 'Enrollment Approved!' : 'Enrollment Rejected',
      message:
        action === 'approve'
          ? `Your enrollment in ${enrollment.course.title} has been approved. Start learning!`
          : `Your enrollment request for ${enrollment.course.title} was not approved.`,
    },
  });

  res.json({
    success: true,
    message: action === 'approve' ? 'Enrollment approved' : 'Enrollment rejected',
    data: { enrollment: updated },
  });
});

module.exports = {
  enroll,
  unenroll,
  myEnrollments,
  updateProgress,
  courseStudents,
  pendingEnrollments,
  approveEnrollment,
};
