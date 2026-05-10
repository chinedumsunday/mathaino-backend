const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { admin } = require('../config/firebase');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

class AuthService {
  /**
   * Register a new user:
   * 1. Create Firebase Auth user
   * 2. Create PostgreSQL user + role-specific profile
   * 3. Return JWT tokens
   */
  static async register(data) {
    const {
      email, password, firstName, lastName, phone, role,
      department, matricNumber, level, specialization, title,
    } = data;

    // 1. Create Firebase user
    let firebaseUser;
    try {
      firebaseUser = await admin.auth().createUser({
        email,
        password,
        displayName: `${firstName} ${lastName}`,
      });
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        throw ApiError.conflict('Email already registered');
      }
      logger.error('Firebase user creation failed:', err);
      throw ApiError.internal('Failed to create account');
    }

    // 2. Create PostgreSQL user with role-specific profile
    try {
      const user = await prisma.user.create({
        data: {
          firebaseUid: firebaseUser.uid,
          email,
          firstName,
          lastName,
          phone,
          role: role || 'STUDENT',
          status: 'ACTIVE',

          // Create role-specific profile
          ...(role === 'FACULTY' && {
            facultyProfile: {
              create: { department, title },
            },
          }),
          ...(role === 'LECTURER' && {
            lecturerProfile: {
              create: { department, specialization },
            },
          }),
          ...((role === 'STUDENT' || !role) && {
            studentProfile: {
              create: { department, matricNumber, level },
            },
          }),
        },
        include: {
          facultyProfile: true,
          lecturerProfile: true,
          studentProfile: true,
        },
      });

      // 3. Set custom claims in Firebase (for client-side role checks)
      await admin.auth().setCustomUserClaims(firebaseUser.uid, {
        role: user.role,
        pgUserId: user.id,
      });

      // 4. Generate JWT
      const tokens = AuthService.generateTokens(user);

      return { user: AuthService.sanitizeUser(user), ...tokens };
    } catch (err) {
      // Rollback: delete the Firebase user if PG creation fails
      await admin.auth().deleteUser(firebaseUser.uid).catch(() => {});
      throw err;
    }
  }

  /**
   * Login: Verify Firebase ID token → find PG user → return JWT
   */
  static async login(idToken) {
    // Verify the Firebase token
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // Find user in PostgreSQL
    const user = await prisma.user.findUnique({
      where: { firebaseUid: decodedToken.uid },
      include: {
        facultyProfile: true,
        lecturerProfile: true,
        studentProfile: true,
      },
    });

    if (!user) {
      throw ApiError.notFound('No account found — please register');
    }

    if (user.status === 'SUSPENDED') {
      throw ApiError.forbidden('Account suspended');
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = AuthService.generateTokens(user);
    return { user: AuthService.sanitizeUser(user), ...tokens };
  }

  /**
   * Generate access + refresh tokens
   */
  static generateTokens(user) {
    const accessToken = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
    );

    return { accessToken, refreshToken };
  }

  /**
   * Strip sensitive fields before sending to client
   */
  static sanitizeUser(user) {
    const { firebaseUid, ...safe } = user;
    return safe;
  }
}

module.exports = AuthService;
