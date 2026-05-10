const ApiError = require('../utils/ApiError');

/**
 * Validates request body against a Joi schema.
 * Usage: validate(registerSchema)
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return next(ApiError.badRequest('Validation failed', details));
    }

    req.body = value; // Use the validated & sanitized body
    next();
  };
};

module.exports = validate;
