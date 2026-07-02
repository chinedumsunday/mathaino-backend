const Joi = require('joi');

// Public self-registration only creates STUDENT accounts. Lecturer and
// faculty accounts are provisioned by admins via /users/lecturers.
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  firstName: Joi.string().min(1).max(50).required(),
  lastName: Joi.string().min(1).max(50).required(),
  phone: Joi.string().optional(),
  role: Joi.string().valid('STUDENT').default('STUDENT'),
  department: Joi.string().allow('').optional(),
  matricNumber: Joi.string().allow('').optional(),
  level: Joi.string().allow('').optional(),
});

const loginSchema = Joi.object({
  idToken: Joi.string().required(), // Firebase ID token from client
});

const updateProfileSchema = Joi.object({
  firstName: Joi.string().min(1).max(50).optional(),
  lastName: Joi.string().min(1).max(50).optional(),
  phone: Joi.string().optional(),
  bio: Joi.string().max(500).optional(),
  avatarUrl: Joi.string().uri().optional(),
});

const changeRoleSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  role: Joi.string().valid('STUDENT', 'LECTURER', 'FACULTY', 'SUPER_ADMIN').required(),
});

const updateStatusSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  status: Joi.string().valid('ACTIVE', 'SUSPENDED', 'PENDING', 'DEACTIVATED').required(),
});

module.exports = {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changeRoleSchema,
  updateStatusSchema,
};
