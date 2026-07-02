const AuthService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');

/**
 * POST /api/auth/register
 * Public registration — always creates a STUDENT account. Lecturer and
 * faculty accounts can only be created by admins (see /users/lecturers).
 */
const register = asyncHandler(async (req, res) => {
  const result = await AuthService.register({ ...req.body, role: 'STUDENT' });

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: result,
  });
});

/**
 * POST /api/auth/login
 * Exchange Firebase ID token for app JWT
 */
const login = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  const result = await AuthService.login(idToken);

  res.json({
    success: true,
    message: 'Login successful',
    data: result,
  });
});

/**
 * GET /api/auth/me
 * Get current authenticated user's profile
 */
const getMe = asyncHandler(async (req, res) => {
  const prisma = require('../config/database');

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: {
      facultyProfile: true,
      lecturerProfile: true,
      studentProfile: true,
    },
  });

  res.json({
    success: true,
    data: { user },
  });
});

module.exports = { register, login, getMe };
