const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { notifyUsers } = require('../services/notificationService');
const { isCourseManager } = require('../utils/contentSanitizer');

const ADMIN_ROLES = ['FACULTY', 'SUPER_ADMIN'];

/**
 * POST /api/courses/:courseId/enroll
 * Student requests enrollment in a course. The request stays PENDING until
 * the lecturer (or an admin) approves it.
 */
const enroll = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  if (req.user.role !== 'STUDENT') {
    throw ApiError.forbidden('Only students can enroll in courses');
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw ApiError.notFound('Course not found');
  if (!course.isPublished) throw ApiError.badRequest('Course is not published');

  const existing = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: req.user.id, courseId } },
  });

  let enrollment;
  if (existing) {
    if (existing.status === 'PENDING') {
      throw ApiError.conflict('Your enrollment request is already awaiting approval');
    }
    if (existing.status !== 'DROPPED') {
      throw ApiError.conflict('Already enrolled in this course');
    }
    // Previously dropped/rejected — allow a fresh request
    enrollment = await prisma.enrollment.update({
      where: { id: existing.id },
      data: { status: 'PENDING', progress: existing.progress },
      include: { course: { select: { id: true, title: true, code: true } } },
    });
  } else {
    enrollment = await prisma.enrollment.create({
      data: { userId: req.user.id, courseId, status: 'PENDING' },
      include: { course: { select: { id: true, title: true, code: true } } },
    });
  }

  const studentName = `${req.user.firstName} ${req.user.lastName}`.trim();

  await notifyUsers([req.user.id], {
    title: 'Enrollment Request Sent',
    message: `Your request to join ${course.title} is awaiting approval. You'll be notified once it's reviewed.`,
    type: 'enrollment_pending',
    data: { courseId },
  });

  // Tell the lecturer someone is waiting
  await notifyUsers([course.creatorId], {
    title: '🎓 New Enrollment Request',
    message: `${studentName} requested to join ${course.title}. Review it in Pending Approvals.`,
    type: 'enrollment_request',
    data: { courseId, enrollmentId: enrollment.id },
  });

  res.status(201).json({
    success: true,
    message: 'Enrollment request sent — awaiting approval',
    data: { enrollment },
  });
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
    ...(status ? { status } : { status: { not: 'DROPPED' } }),
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
 * GET /api/courses/:courseId/students
 * Enrolled students for a course — course creator, faculty, or admin only.
 */
const courseStudents = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw ApiError.notFound('Course not found');
  if (!isCourseManager(req.user, course)) {
    throw ApiError.forbidden('Only the course lecturer or an admin can view enrolled students');
  }

  const [enrollments, total] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId, status: { not: 'DROPPED' } },
      skip,
      take: parseInt(limit),
      orderBy: { enrolledAt: 'desc' },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true, email: true, avatarUrl: true,
            studentProfile: { select: { matricNumber: true, level: true } },
          },
        },
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
 * Lecturers see pending requests for their own courses.
 * Faculty/admin see all pending requests platform-wide.
 */
const pendingEnrollments = asyncHandler(async (req, res) => {
  const where = { status: 'PENDING' };

  if (!ADMIN_ROLES.includes(req.user.role)) {
    const myCourses = await prisma.course.findMany({
      where: { creatorId: req.user.id },
      select: { id: true },
    });
    where.courseId = { in: myCourses.map(c => c.id) };
  }

  const enrollments = await prisma.enrollment.findMany({
    where,
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
    !ADMIN_ROLES.includes(req.user.role)
  ) {
    throw ApiError.forbidden('Not authorized to manage this enrollment');
  }

  const newStatus = action === 'approve' ? 'ENROLLED' : 'DROPPED';

  const updated = await prisma.enrollment.update({
    where: { id },
    data: { status: newStatus },
  });

  await notifyUsers([enrollment.userId], {
    title: action === 'approve' ? 'Enrollment Approved! 🎉' : 'Enrollment Not Approved',
    message:
      action === 'approve'
        ? `Your enrollment in ${enrollment.course.title} has been approved. Start learning!`
        : `Your enrollment request for ${enrollment.course.title} was not approved. You can browse other courses or contact your lecturer.`,
    type: 'enrollment_review',
    data: { courseId: enrollment.courseId },
  });

  res.json({
    success: true,
    message: action === 'approve' ? 'Enrollment approved' : 'Enrollment rejected',
    data: { enrollment: updated },
  });
});

/**
 * POST /api/courses/:courseId/students
 * Faculty/admin directly registers a student into a course (no approval step).
 * Body: { userId }
 */
const registerStudent = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { userId } = req.body;

  if (!userId) throw ApiError.badRequest('userId is required');

  const [course, student] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);
  if (!course) throw ApiError.notFound('Course not found');
  if (!student) throw ApiError.notFound('User not found');
  if (student.role !== 'STUDENT') throw ApiError.badRequest('Only students can be registered into courses');

  const enrollment = await prisma.enrollment.upsert({
    where: { userId_courseId: { userId, courseId } },
    create: { userId, courseId, status: 'ENROLLED' },
    update: { status: 'ENROLLED' },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      course: { select: { id: true, title: true, code: true } },
    },
  });

  await notifyUsers([userId], {
    title: 'Registered for a Course',
    message: `You have been registered for ${course.title} by the admin. Start learning!`,
    type: 'enrollment_registered',
    data: { courseId },
  });

  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'REGISTER_STUDENT',
      entity: 'Enrollment',
      entityId: enrollment.id,
      metadata: { courseId, userId },
    },
  });

  res.status(201).json({ success: true, message: `${student.firstName} registered for ${course.title}`, data: { enrollment } });
});

/**
 * DELETE /api/courses/:courseId/students/:userId
 * Course creator or faculty/admin unregisters a student from a course.
 * Body: { reason? } — included in the notification to the student.
 */
const unregisterStudent = asyncHandler(async (req, res) => {
  const { courseId, userId } = req.params;
  const { reason } = req.body || {};

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw ApiError.notFound('Course not found');
  if (!isCourseManager(req.user, course)) {
    throw ApiError.forbidden('Only the course lecturer or an admin can unregister students');
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
  });
  if (!enrollment || enrollment.status === 'DROPPED') {
    throw ApiError.notFound('This student is not registered in the course');
  }

  await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: { status: 'DROPPED' },
  });

  await notifyUsers([userId], {
    title: 'Unregistered from Course',
    message: `You have been unregistered from ${course.title}.${reason ? ` Reason: ${reason}` : ''} You can browse other courses or speak with your lecturer about the best fit for you.`,
    type: 'enrollment_removed',
    data: { courseId },
  });

  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'UNREGISTER_STUDENT',
      entity: 'Enrollment',
      entityId: enrollment.id,
      metadata: { courseId, userId, reason: reason || null },
    },
  });

  res.json({ success: true, message: 'Student unregistered from course' });
});

/**
 * GET /api/users/:id/enrollments
 * Faculty/admin: view every course a user is (or was) registered in.
 */
const userEnrollments = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound('User not found');

  const enrollments = await prisma.enrollment.findMany({
    where: { userId: id },
    orderBy: { enrolledAt: 'desc' },
    include: {
      course: { select: { id: true, title: true, code: true, isPublished: true } },
    },
  });

  res.json({ success: true, data: { enrollments } });
});

module.exports = {
  enroll,
  unenroll,
  myEnrollments,
  courseStudents,
  pendingEnrollments,
  approveEnrollment,
  registerStudent,
  unregisterStudent,
  userEnrollments,
};
