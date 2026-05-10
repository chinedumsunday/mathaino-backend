const ApiError = require('../utils/ApiError');

/**
 * Restricts access to users with one of the specified roles.
 * Usage: authorize('SUPER_ADMIN', 'FACULTY')
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `Access denied — requires one of: ${allowedRoles.join(', ')}`
        )
      );
    }

    next();
  };
};

module.exports = authorize;
