const Joi = require('joi');

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  firstName: Joi.string().min(1).max(50).required(),
  lastName: Joi.string().min(1).max(50).required(),
  phone: Joi.string().optional(),
  role: Joi.string().valid('STUDENT', 'LECTURER', 'FACULTY').default('STUDENT'),
  // Role-specific fields
  department: Joi.string().when('role', {
    is: Joi.valid('FACULTY', 'LECTURER'),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  matricNumber: Joi.string().when('role', {
    is: 'STUDENT',
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
  level: Joi.string().when('role', {
    is: 'STUDENT',
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
  specialization: Joi.string().when('role', {
    is: 'LECTURER',
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
  title: Joi.string().when('role', {
    is: 'FACULTY',
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
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
