const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { notifyUsers } = require('../services/notificationService');

const LECTURER_SELECT = {
  id: true, firstName: true, lastName: true, email: true, avatarUrl: true,
  lecturerProfile: { select: { department: true } },
};

/**
 * POST /api/coursework
 * Lecturer submits an exam/coursework document for the admin to add to the app.
 * Body: { title, fileUrl, courseCode?, description? }
 */
const submitCoursework = asyncHandler(async (req, res) => {
  const { title, fileUrl, courseCode, description } = req.body;

  if (!title?.trim()) throw ApiError.badRequest('title is required');
  if (!fileUrl?.trim()) throw ApiError.badRequest('fileUrl is required — share a document link (Google Drive, Dropbox, etc.)');
  try {
    // Basic sanity check that it's a real URL
    new URL(fileUrl.trim());
  } catch (_) {
    throw ApiError.badRequest('fileUrl must be a valid link (https://...)');
  }

  const doc = await prisma.courseworkDoc.create({
    data: {
      lecturerId: req.user.id,
      title: title.trim(),
      courseCode: courseCode?.trim() || null,
      description: description?.trim() || null,
      fileUrl: fileUrl.trim(),
    },
    include: { lecturer: { select: LECTURER_SELECT } },
  });

  // Notify every faculty/admin that there's a document waiting
  const admins = await prisma.user.findMany({
    where: { role: { in: ['FACULTY', 'SUPER_ADMIN'] }, status: 'ACTIVE' },
    select: { id: true },
  });
  const lecturerName = `${req.user.firstName} ${req.user.lastName}`.trim();
  await notifyUsers(admins.map(a => a.id), {
    title: '📄 Coursework Document Submitted',
    message: `${lecturerName} submitted "${doc.title}"${doc.courseCode ? ` (${doc.courseCode})` : ''} to be added as course material.`,
    type: 'coursework_submitted',
    data: { courseworkId: doc.id },
  });

  res.status(201).json({
    success: true,
    message: 'Document submitted — the admin has been notified',
    data: { coursework: doc },
  });
});

/**
 * GET /api/coursework/mine
 * Lecturer's own submissions with review status.
 */
const myCoursework = asyncHandler(async (req, res) => {
  const docs = await prisma.courseworkDoc.findMany({
    where: { lecturerId: req.user.id },
    orderBy: { createdAt: 'desc' },
    include: { reviewedBy: { select: { firstName: true, lastName: true } } },
  });

  res.json({ success: true, data: { coursework: docs } });
});

/**
 * GET /api/coursework
 * Admin/faculty: full review queue. Query: ?status=PENDING|ADDED|DECLINED
 */
const listCoursework = asyncHandler(async (req, res) => {
  const { status } = req.query;

  const docs = await prisma.courseworkDoc.findMany({
    where: { ...(status && { status }) },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      lecturer: { select: LECTURER_SELECT },
      reviewedBy: { select: { firstName: true, lastName: true } },
    },
  });

  const pendingCount = await prisma.courseworkDoc.count({ where: { status: 'PENDING' } });

  res.json({ success: true, data: { coursework: docs, pendingCount } });
});

/**
 * PATCH /api/coursework/:id/review
 * Admin/faculty marks a submission as ADDED (material now in the app) or
 * DECLINED. Body: { status: 'ADDED' | 'DECLINED', adminNote? }
 */
const reviewCoursework = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, adminNote } = req.body;

  if (!['ADDED', 'DECLINED'].includes(status)) {
    throw ApiError.badRequest('status must be ADDED or DECLINED');
  }

  const doc = await prisma.courseworkDoc.findUnique({ where: { id } });
  if (!doc) throw ApiError.notFound('Coursework submission not found');

  const updated = await prisma.courseworkDoc.update({
    where: { id },
    data: {
      status,
      adminNote: adminNote?.trim() || null,
      reviewedById: req.user.id,
      reviewedAt: new Date(),
    },
    include: {
      lecturer: { select: LECTURER_SELECT },
      reviewedBy: { select: { firstName: true, lastName: true } },
    },
  });

  await notifyUsers([doc.lecturerId], {
    title: status === 'ADDED' ? '✅ Coursework Added' : 'Coursework Declined',
    message:
      status === 'ADDED'
        ? `"${doc.title}" has been added to the app by the admin.${adminNote ? ` Note: ${adminNote}` : ''}`
        : `"${doc.title}" was not added.${adminNote ? ` Note: ${adminNote}` : ' Contact the admin for details.'}`,
    type: 'coursework_reviewed',
    data: { courseworkId: id, status },
  });

  res.json({ success: true, message: `Submission marked as ${status.toLowerCase()}`, data: { coursework: updated } });
});

module.exports = { submitCoursework, myCoursework, listCoursework, reviewCoursework };
