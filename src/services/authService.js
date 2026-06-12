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
   * Verify a Firebase ID token, but fail fast when Google's servers are
   * unreachable instead of hanging until the client gives up (HTTP 499s).
   */
  static async verifyIdTokenWithTimeout(idToken, ms = 8000) {
    let timer;
    try {
      return await Promise.race([
        admin.auth().verifyIdToken(idToken),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(ApiError.serviceUnavailable('Could not reach Google to verify your login. Please try again in a moment.')),
            ms
          );
        }),
      ]);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (/ETIMEDOUT|ENOTFOUND|ECONNRESET|network/i.test(err.message || '')) {
        logger.error(`Token verification network failure: ${err.message}`);
        throw ApiError.serviceUnavailable('Could not reach Google to verify your login. Please try again in a moment.');
      }
      throw ApiError.unauthorized('Invalid or expired login token. Please sign in again.');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Login: Verify Firebase ID token → find PG user → return JWT.
   * Social sign-ins (Google) auto-provision a Student account on first login.
   */
  static async login(idToken) {
    // Verify the Firebase token
    const decodedToken = await AuthService.verifyIdTokenWithTimeout(idToken);

    // Find user in PostgreSQL
    let user = await prisma.user.findUnique({
      where: { firebaseUid: decodedToken.uid },
      include: {
        facultyProfile: true,
        lecturerProfile: true,
        studentProfile: true,
      },
    });

    if (!user) {
      const provider = decodedToken.firebase?.sign_in_provider;
      if (provider === 'google.com') {
        user = await AuthService.provisionSocialUser(decodedToken);
      } else {
        throw ApiError.notFound('No account found — please register');
      }
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
   * First-time social login (the brief's "SM login within app"):
   * create a Student account from the Google profile.
   */
  static async provisionSocialUser(decodedToken) {
    const email = decodedToken.email;
    if (!email) throw ApiError.badRequest('Social account has no email');

    const fullName = (decodedToken.name || email.split('@')[0]).trim();
    const [firstName, ...rest] = fullName.split(/\s+/);
    const lastName = rest.join(' ') || '-';

    const user = await prisma.user.create({
      data: {
        firebaseUid: decodedToken.uid,
        email,
        firstName,
        lastName,
        avatarUrl: decodedToken.picture || null,
        role: 'STUDENT',
        status: 'ACTIVE',
        studentProfile: { create: {} },
      },
      include: {
        facultyProfile: true,
        lecturerProfile: true,
        studentProfile: true,
      },
    });

    await admin.auth().setCustomUserClaims(decodedToken.uid, {
      role: user.role,
      pgUserId: user.id,
    }).catch(() => {});

    logger.info(`Social sign-in provisioned new student: ${email}`);
    return user;
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
