const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * GET /api/notifications
 * Get notifications for the authenticated user.
 * Query: ?unread=true  → only unread
 *        ?limit=20&page=1
 */
const listNotifications = asyncHandler(async (req, res) => {
  const { unread, page = 1, limit = 30 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {
    userId: req.user.id,
    OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }],
  };
  if (unread === 'true') where.isRead = false;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit),
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false, OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }] } }),
  ]);

  res.json({
    success: true,
    data: {
      notifications,
      unreadCount,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
});

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read.
 */
const markRead = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const notif = await prisma.notification.findUnique({ where: { id } });
  if (!notif) throw ApiError.notFound('Notification not found');
  if (notif.userId !== req.user.id) throw ApiError.forbidden('Not your notification');

  const updated = await prisma.notification.update({
    where: { id },
    data: { isRead: true },
  });

  res.json({ success: true, data: { notification: updated } });
});

/**
 * PATCH /api/notifications/read-all
 * Mark ALL unread notifications for the current user as read.
 */
const markAllRead = asyncHandler(async (req, res) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true },
  });

  res.json({ success: true, message: `Marked ${count} notifications as read` });
});

/**
 * DELETE /api/notifications/:id
 * Delete a single notification.
 */
const deleteNotification = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const notif = await prisma.notification.findUnique({ where: { id } });
  if (!notif) throw ApiError.notFound('Notification not found');
  if (notif.userId !== req.user.id) throw ApiError.forbidden('Not your notification');

  await prisma.notification.delete({ where: { id } });

  res.json({ success: true, message: 'Notification deleted' });
});

module.exports = { listNotifications, markRead, markAllRead, deleteNotification };
