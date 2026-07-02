const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * GET /api/users
 * List all users (Super Admin & Faculty only)
 * Query params: ?role=STUDENT&status=ACTIVE&page=1&limit=20&search=john
 */
const listUsers = asyncHandler(async (req, res) => {
  const { role, status, page = 1, limit = 20, search } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where = {
    ...(role && { role }),
    ...(status && { status }),
    ...(search && {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        avatarUrl: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    success: true,
    data: {
      users,
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
 * GET /api/users/:id
 * Get a single user by ID (with role-specific profile)
 */
const getUser = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      facultyProfile: true,
      lecturerProfile: true,
      studentProfile: true,
    },
  });

  if (!user) throw ApiError.notFound('User not found');

  res.json({ success: true, data: { user } });
});

/**
 * PATCH /api/users/:id/role
 * Change a user's role (Super Admin only)
 */
const changeRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  const { id } = req.params;

  // SUPER_ADMIN cannot be granted through the API — only the seed/DB can
  if (!['STUDENT', 'LECTURER', 'FACULTY'].includes(role)) {
    throw ApiError.badRequest('role must be STUDENT, LECTURER, or FACULTY');
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound('User not found');

  // Prevent demoting yourself
  if (id === req.user.id) {
    throw ApiError.badRequest('Cannot change your own role');
  }

  if (user.role === 'SUPER_ADMIN') {
    throw ApiError.forbidden('Super admin accounts cannot be modified');
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { role },
  });

  // Log the action
  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'CHANGE_ROLE',
      entity: 'User',
      entityId: id,
      metadata: { oldRole: user.role, newRole: role },
    },
  });

  res.json({
    success: true,
    message: `Role updated to ${role}`,
    data: { user: updated },
  });
});

/**
 * PATCH /api/users/:id/status
 * Activate, suspend, or deactivate a user (Super Admin & Faculty)
 */
const changeStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  if (!['ACTIVE', 'SUSPENDED', 'PENDING', 'DEACTIVATED'].includes(status)) {
    throw ApiError.badRequest('Invalid status');
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound('User not found');

  if (id === req.user.id) {
    throw ApiError.badRequest('Cannot change your own status');
  }

  if (user.role === 'SUPER_ADMIN') {
    throw ApiError.forbidden('Super admin accounts cannot be modified');
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { status },
  });

  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'CHANGE_STATUS',
      entity: 'User',
      entityId: id,
      metadata: { oldStatus: user.status, newStatus: status },
    },
  });

  res.json({
    success: true,
    message: `Status updated to ${status}`,
    data: { user: updated },
  });
});

/**
 * PATCH /api/users/profile
 * Update own profile (any authenticated user)
 */
const updateProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, bio, avatarUrl } = req.body;

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(phone !== undefined && { phone }),
      ...(bio !== undefined && { bio }),
      ...(avatarUrl !== undefined && { avatarUrl }),
    },
    include: {
      facultyProfile: true,
      lecturerProfile: true,
      studentProfile: true,
    },
  });

  res.json({
    success: true,
    message: 'Profile updated',
    data: { user: updated },
  });
});

/**
 * PATCH /api/users/push-token
 * Save (or clear with null) the caller's Expo push token.
 */
const updatePushToken = asyncHandler(async (req, res) => {
  const { pushToken } = req.body;

  await prisma.user.update({
    where: { id: req.user.id },
    data: { pushToken: pushToken || null },
  });

  res.json({ success: true, message: pushToken ? 'Push token saved' : 'Push token cleared' });
});

/**
 * GET /api/users/stats
 * Dashboard stats (Super Admin)
 */
const getStats = asyncHandler(async (req, res) => {
  const [totalUsers, byRole, byStatus, recentUsers] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ['role'], _count: true }),
    prisma.user.groupBy({ by: ['status'], _count: true }),
    prisma.user.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, createdAt: true },
    }),
  ]);

  res.json({
    success: true,
    data: {
      totalUsers,
      byRole: Object.fromEntries(byRole.map((r) => [r.role, r._count])),
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      recentUsers,
    },
  });
});

/**
 * POST /api/users/lecturers
 * Faculty or Super Admin creates a new Lecturer account.
 * Body: { firstName, lastName, email, password, department, specialization }
 */
const createLecturer = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, department, specialization } = req.body;

  if (!firstName || !lastName || !email || !password) {
    throw ApiError.badRequest('firstName, lastName, email, and password are required');
  }

  const AuthService = require('../services/authService');

  const result = await AuthService.register({
    firstName,
    lastName,
    email,
    password,
    role: 'LECTURER',
    department: department || '',
    specialization: specialization || '',
  });

  // Auto-activate lecturer accounts created by faculty/admin
  const activated = await prisma.user.update({
    where: { id: result.user.id },
    data: { status: 'ACTIVE' },
  });

  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'CREATE_LECTURER',
      entity: 'User',
      entityId: result.user.id,
      metadata: { createdBy: req.user.role },
    },
  });

  res.status(201).json({
    success: true,
    message: `Lecturer account created for ${firstName} ${lastName}`,
    data: { user: { ...result.user, status: 'ACTIVE' } },
  });
});

/**
 * POST /api/users/students
 * Faculty or Super Admin registers a new Student account.
 * Body: { firstName, lastName, email, password, matricNumber?, department?, level? }
 */
const createStudent = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, matricNumber, department, level } = req.body;

  if (!firstName || !lastName || !email || !password) {
    throw ApiError.badRequest('firstName, lastName, email, and password are required');
  }

  const AuthService = require('../services/authService');

  const result = await AuthService.register({
    firstName,
    lastName,
    email,
    password,
    role: 'STUDENT',
    matricNumber: matricNumber || '',
    department: department || '',
    level: level || '',
  });

  const activated = await prisma.user.update({
    where: { id: result.user.id },
    data: { status: 'ACTIVE' },
  });

  await prisma.auditLog.create({
    data: {
      actorId: req.user.id,
      action: 'CREATE_STUDENT',
      entity: 'User',
      entityId: result.user.id,
      metadata: { createdBy: req.user.role },
    },
  });

  res.status(201).json({
    success: true,
    message: `Student account created for ${firstName} ${lastName}`,
    data: { user: { ...result.user, status: 'ACTIVE' } },
  });
});

/**
 * GET /api/users/leaderboard
 * Public-ish (authenticated) — returns top students sorted by XP.
 * Query: ?period=weekly|monthly|all-time&limit=50
 */
const getLeaderboard = asyncHandler(async (req, res) => {
  const { period = 'all-time', limit = 50 } = req.query;

  const now = new Date();
  let activeAfter = null;
  if (period === 'weekly') activeAfter = new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (period === 'monthly') activeAfter = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const users = await prisma.user.findMany({
    where: {
      role: 'STUDENT',
      status: 'ACTIVE',
      ...(activeAfter && { lastActiveAt: { gte: activeAfter } }),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      xp: true,
      streak: true,
      lastActiveAt: true,
      studentProfile: { select: { department: true, level: true } },
    },
    orderBy: { xp: 'desc' },
    take: parseInt(limit),
  });

  res.json({ success: true, data: { users, period } });
});

/**
 * DELETE /api/users/me
 * Permanently delete the caller's own account (app-store requirement).
 * Removes the Firebase auth user and the database record (cascades to
 * enrollments, submissions, notifications, etc.).
 */
const deleteMe = asyncHandler(async (req, res) => {
  if (req.user.role === 'SUPER_ADMIN') {
    throw ApiError.badRequest('The super admin account cannot be deleted from the app');
  }

  const { admin } = require('../config/firebase');

  await prisma.user.delete({ where: { id: req.user.id } });
  if (req.user.firebaseUid) {
    await admin.auth().deleteUser(req.user.firebaseUid).catch(() => {});
  }

  res.json({ success: true, message: 'Account deleted' });
});

module.exports = { listUsers, getUser, changeRole, changeStatus, updateProfile, updatePushToken, getStats, createLecturer, createStudent, getLeaderboard, deleteMe };
