const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { notifyUsers } = require('../services/notificationService');

function formatDate(date) {
  return date.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// POST /api/live-sessions
const createLiveSession = asyncHandler(async (req, res) => {
  const { courseId, title, description, platform, meetingLink, scheduledAt, durationMin, focusMode } = req.body;

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
      focusMode: !!focusMode,
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

  // "Upcoming" includes anything currently LIVE so students can join in one tap
  const upcomingFilter = { OR: [{ scheduledAt: { gte: now }, status: 'SCHEDULED' }, { status: 'LIVE' }] };

  if (isLecturer) {
    sessions = await prisma.liveSession.findMany({
      where: {
        creatorId: req.user.id,
        ...(upcoming === 'true' && upcomingFilter),
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
        ...(upcoming === 'true' && upcomingFilter),
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

// How long after the last heartbeat a student is considered gone (app killed / offline)
const STALE_AFTER_MS = 45 * 1000;
// Backgrounded apps can't send heartbeats — give them a longer grace before marking red
const BACKGROUND_STALE_AFTER_MS = 3 * 60 * 1000;
// Heartbeat gaps longer than this aren't credited as presence time
const MAX_CREDIT_MS = 60 * 1000;

// PATCH /api/live-sessions/:id/start — lecturer goes live
const startLiveSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { focusMode } = req.body;

  const session = await prisma.liveSession.findUnique({
    where: { id },
    include: {
      course: {
        include: {
          enrollments: { where: { status: 'ENROLLED' }, select: { userId: true } },
        },
      },
    },
  });

  if (!session) throw ApiError.notFound('Session not found');
  if (session.creatorId !== req.user.id) throw ApiError.forbidden('Not your session');
  if (session.status === 'LIVE') throw ApiError.badRequest('Session is already live');
  if (session.status !== 'SCHEDULED') throw ApiError.badRequest(`Cannot start a ${session.status.toLowerCase()} session`);

  const updated = await prisma.liveSession.update({
    where: { id },
    data: {
      status: 'LIVE',
      startedAt: new Date(),
      ...(focusMode !== undefined && { focusMode: !!focusMode }),
    },
    include: { course: { select: { id: true, title: true, code: true } } },
  });

  const enrolledUserIds = session.course.enrollments.map(e => e.userId);
  await notifyUsers(enrolledUserIds, {
    title: '🔴 Live Class Started',
    message: `"${session.title}" for ${session.course.title} is live now. Tap to join${updated.focusMode ? ' — focus mode is on, attendance is being tracked' : ''}.`,
    type: 'live_started',
    data: { sessionId: id, meetingLink: session.meetingLink, platform: session.platform, focusMode: updated.focusMode },
  });

  res.json({ success: true, data: { session: updated } });
});

// PATCH /api/live-sessions/:id/end — lecturer ends the class
const endLiveSession = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const session = await prisma.liveSession.findUnique({ where: { id } });
  if (!session) throw ApiError.notFound('Session not found');
  if (session.creatorId !== req.user.id) throw ApiError.forbidden('Not your session');
  if (session.status !== 'LIVE') throw ApiError.badRequest('Session is not live');

  const now = new Date();
  await prisma.$transaction([
    prisma.liveSession.update({
      where: { id },
      data: { status: 'ENDED', endedAt: now },
    }),
    prisma.sessionAttendance.updateMany({
      where: { sessionId: id, state: { not: 'EXITED' } },
      data: { state: 'EXITED', leftAt: now },
    }),
  ]);

  res.json({ success: true, message: 'Session ended' });
});

// POST /api/live-sessions/:id/join — student enters the in-app classroom
const joinLiveSession = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const session = await prisma.liveSession.findUnique({
    where: { id },
    include: { course: { select: { id: true, title: true, code: true } } },
  });
  if (!session) throw ApiError.notFound('Session not found');
  if (session.status !== 'LIVE') throw ApiError.badRequest('This class is not live right now');

  const isCreator = session.creatorId === req.user.id;
  if (!isCreator) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: req.user.id, courseId: session.courseId } },
    });
    if (!enrollment || enrollment.status !== 'ENROLLED') {
      throw ApiError.forbidden('You are not enrolled in this course');
    }
  }

  const now = new Date();
  const attendance = await prisma.sessionAttendance.upsert({
    where: { sessionId_userId: { sessionId: id, userId: req.user.id } },
    create: { sessionId: id, userId: req.user.id, state: 'ACTIVE', lastSeenAt: now },
    update: { state: 'ACTIVE', lastSeenAt: now, leftAt: null },
  });

  res.json({ success: true, data: { session, attendance } });
});

// POST /api/live-sessions/:id/heartbeat { state: 'ACTIVE' | 'BACKGROUND' }
const heartbeat = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const state = req.body.state === 'BACKGROUND' ? 'BACKGROUND' : 'ACTIVE';

  const attendance = await prisma.sessionAttendance.findUnique({
    where: { sessionId_userId: { sessionId: id, userId: req.user.id } },
    include: { session: { select: { status: true } } },
  });
  if (!attendance) throw ApiError.notFound('Join the session first');
  if (attendance.session.status !== 'LIVE') throw ApiError.badRequest('Session is no longer live');

  const now = new Date();
  // Credit elapsed time since last heartbeat to the state the student WAS in
  const elapsedMs = Math.min(now - attendance.lastSeenAt, MAX_CREDIT_MS);
  const elapsedSec = Math.max(0, Math.round(elapsedMs / 1000));
  const creditField = attendance.state === 'ACTIVE' ? 'activeSeconds' : 'backgroundSeconds';

  const updated = await prisma.sessionAttendance.update({
    where: { id: attendance.id },
    data: {
      state,
      lastSeenAt: now,
      leftAt: null,
      [creditField]: { increment: elapsedSec },
    },
  });

  res.json({ success: true, data: { attendance: updated } });
});

// POST /api/live-sessions/:id/leave — student exits the classroom screen
const leaveLiveSession = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const attendance = await prisma.sessionAttendance.findUnique({
    where: { sessionId_userId: { sessionId: id, userId: req.user.id } },
  });
  if (!attendance) throw ApiError.notFound('No attendance record');

  const now = new Date();
  const elapsedMs = Math.min(now - attendance.lastSeenAt, MAX_CREDIT_MS);
  const elapsedSec = Math.max(0, Math.round(elapsedMs / 1000));
  const creditField = attendance.state === 'ACTIVE' ? 'activeSeconds' : 'backgroundSeconds';

  await prisma.sessionAttendance.update({
    where: { id: attendance.id },
    data: { state: 'EXITED', leftAt: now, lastSeenAt: now, [creditField]: { increment: elapsedSec } },
  });

  res.json({ success: true, message: 'Left session' });
});

// GET /api/live-sessions/:id/attendance — lecturer's live roster + grading data
const getAttendance = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const session = await prisma.liveSession.findUnique({
    where: { id },
    include: {
      course: {
        include: {
          enrollments: {
            where: { status: 'ENROLLED' },
            include: {
              user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } },
            },
          },
        },
      },
      attendances: true,
    },
  });
  if (!session) throw ApiError.notFound('Session not found');
  if (session.creatorId !== req.user.id) throw ApiError.forbidden('Not your session');

  const now = new Date();
  const byUser = Object.fromEntries(session.attendances.map(a => [a.userId, a]));
  const sessionStart = session.startedAt || session.scheduledAt;
  const sessionEnd = session.endedAt || now;
  const totalSessionSec = Math.max(1, Math.round((sessionEnd - sessionStart) / 1000));

  const roster = session.course.enrollments
    .filter(e => e.user.id !== session.creatorId)
    .map(e => {
      const a = byUser[e.user.id];
      // green = in app & in class, amber = switched apps, red = exited / killed app, grey = never joined
      let presence = 'NOT_JOINED';
      if (a) {
        const sinceLastSeen = now - a.lastSeenAt;
        const staleLimit = a.state === 'BACKGROUND' ? BACKGROUND_STALE_AFTER_MS : STALE_AFTER_MS;
        const stale = session.status === 'LIVE' && sinceLastSeen > staleLimit;
        if (a.state === 'EXITED' || stale) presence = 'EXITED';
        else if (a.state === 'BACKGROUND') presence = 'BACKGROUND';
        else presence = 'ACTIVE';
      }
      const activeSeconds = a ? a.activeSeconds : 0;
      return {
        user: e.user,
        presence,
        joinedAt: a?.joinedAt || null,
        leftAt: a?.leftAt || null,
        activeSeconds,
        backgroundSeconds: a ? a.backgroundSeconds : 0,
        attendancePct: Math.min(100, Math.round((activeSeconds / totalSessionSec) * 100)),
      };
    });

  const counts = roster.reduce((acc, r) => {
    acc[r.presence] = (acc[r.presence] || 0) + 1;
    return acc;
  }, {});

  res.json({
    success: true,
    data: {
      session: {
        id: session.id,
        title: session.title,
        status: session.status,
        focusMode: session.focusMode,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        meetingLink: session.meetingLink,
        platform: session.platform,
        course: { id: session.course.id, title: session.course.title, code: session.course.code },
      },
      roster,
      counts: {
        active: counts.ACTIVE || 0,
        background: counts.BACKGROUND || 0,
        exited: counts.EXITED || 0,
        notJoined: counts.NOT_JOINED || 0,
        total: roster.length,
      },
    },
  });
});

module.exports = {
  createLiveSession,
  listLiveSessions,
  cancelLiveSession,
  startLiveSession,
  endLiveSession,
  joinLiveSession,
  heartbeat,
  leaveLiveSession,
  getAttendance,
};
