const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

async function notifyUsers(userIds, { title, message, type, data, scheduledFor }) {
  if (!userIds.length) return;
  await prisma.notification.createMany({
    data: userIds.map(userId => ({
      userId,
      title,
      message,
      type,
      data: data || null,
      scheduledFor: scheduledFor || null,
    })),
    skipDuplicates: true,
  });
}

function formatDate(date) {
  return date.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// POST /api/live-sessions
const createLiveSession = asyncHandler(async (req, res) => {
  const { courseId, title, description, platform, meetingLink, scheduledAt, durationMin } = req.body;

  if (!courseId || !title || !platform || !meetingLink || !scheduledAt) {
    throw ApiError.badRequest('courseId, title, platform, meetingLink, and scheduledAt are required');
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      enrollments: {
        where: { status: 'ENROLLED' },
        select: { userId: true },
      },
    },
  });

  if (!course) throw ApiError.notFound('Course not found');
  if (course.creatorId !== req.user.id) throw ApiError.forbidden('Not your course');

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) throw ApiError.badRequest('Invalid scheduledAt date');
  if (scheduledDate <= new Date()) throw ApiError.badRequest('Live session must be scheduled in the future');

  const session = await prisma.liveSession.create({
    data: {
      courseId,
      creatorId: req.user.id,
      title,
      description: description || null,
      platform,
      meetingLink,
      scheduledAt: scheduledDate,
      durationMin: durationMin ? parseInt(durationMin) : null,
    },
    include: {
      course: { select: { id: true, title: true, code: true } },
      creator: { select: { firstName: true, lastName: true } },
    },
  });

  const enrolledUserIds = course.enrollments.map(e => e.userId);
  const dateStr = formatDate(scheduledDate);
  const notifData = { sessionId: session.id, meetingLink, platform, scheduledAt };

  await notifyUsers(enrolledUserIds, {
    title: '📅 Live Class Scheduled',
    message: `"${title}" for ${course.title} has been scheduled for ${dateStr}.`,
    type: 'live_class',
    data: notifData,
  });

  // 5-minute reminder stored with scheduledFor so it surfaces at the right time
  const reminderAt = new Date(scheduledDate.getTime() - 5 * 60 * 1000);
  if (reminderAt > new Date()) {
    await notifyUsers(enrolledUserIds, {
      title: '⏰ Live Class Starting Soon',
      message: `"${title}" starts in 5 minutes! Tap to join.`,
      type: 'live_reminder',
      data: notifData,
      scheduledFor: reminderAt,
    });
  }

  res.status(201).json({ success: true, data: { session } });
});

// GET /api/live-sessions
const listLiveSessions = asyncHandler(async (req, res) => {
  const { upcoming } = req.query;
  const now = new Date();
  const isLecturer = ['LECTURER', 'FACULTY', 'SUPER_ADMIN'].includes(req.user.role);

  let sessions;

  if (isLecturer) {
    sessions = await prisma.liveSession.findMany({
      where: {
        creatorId: req.user.id,
        ...(upcoming === 'true' && { scheduledAt: { gte: now }, status: 'SCHEDULED' }),
      },
      include: {
        course: { select: { id: true, title: true, code: true } },
        creator: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  } else {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.user.id, status: 'ENROLLED' },
      select: { courseId: true },
    });
    const courseIds = enrollments.map(e => e.courseId);

    sessions = await prisma.liveSession.findMany({
      where: {
        courseId: { in: courseIds },
        ...(upcoming === 'true' && { scheduledAt: { gte: now }, status: 'SCHEDULED' }),
      },
      include: {
        course: { select: { id: true, title: true, code: true } },
        creator: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  res.json({ success: true, data: { sessions } });
});

// PATCH /api/live-sessions/:id/cancel
const cancelLiveSession = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const session = await prisma.liveSession.findUnique({
    where: { id },
    include: {
      course: {
        include: {
          enrollments: {
            where: { status: 'ENROLLED' },
            select: { userId: true },
          },
        },
      },
    },
  });

  if (!session) throw ApiError.notFound('Session not found');
  if (session.creatorId !== req.user.id) throw ApiError.forbidden('Not your session');
  if (session.status === 'CANCELLED') throw ApiError.badRequest('Session already cancelled');

  await prisma.liveSession.update({ where: { id }, data: { status: 'CANCELLED' } });

  const enrolledUserIds = session.course.enrollments.map(e => e.userId);
  await notifyUsers(enrolledUserIds, {
    title: '❌ Live Class Cancelled',
    message: `"${session.title}" for ${session.course.title} has been cancelled.`,
    type: 'live_cancelled',
    data: { sessionId: id },
  });

  // Remove the pending 5-min reminder
  await prisma.notification.deleteMany({
    where: {
      type: 'live_reminder',
      data: { path: ['sessionId'], equals: id },
    },
  });

  res.json({ success: true, message: 'Session cancelled' });
});

module.exports = { createLiveSession, listLiveSessions, cancelLiveSession };
