const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const ApiError = require('../utils/ApiError');

/**
 * Verifies the custom JWT issued at login (stored by the client).
 * Also updates lastActiveAt on every authenticated request for online-status tracking.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('No token provided');
    }

    const token = authHeader.split('Bearer ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('Token expired — please log in again');
      }
      throw ApiError.unauthorized('Invalid token');
    }

    // Look up user in PostgreSQL by the userId embedded in the JWT
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      throw ApiError.unauthorized('User not found — please register first');
    }

    if (user.status === 'SUSPENDED') {
      throw ApiError.forbidden('Account suspended — contact admin');
    }

    if (user.status === 'DEACTIVATED') {
      throw ApiError.forbidden('Account deactivated');
    }

    req.user = user;

    // Update lastActiveAt in the background (non-blocking — don't await)
    prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    }).catch(() => {}); // ignore errors (field may not exist yet before migration)

    next();
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    next(ApiError.unauthorized('Authentication failed'));
  }
};

module.exports = authenticate;
