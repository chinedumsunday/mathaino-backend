const router = require('express').Router();
const { register, login, getMe } = require('../controllers/authController');
const { requestOTP, verifyOTP, resetPassword } = require('../controllers/passwordResetController');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { registerSchema, loginSchema } = require('../utils/validators');

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.get('/me', authenticate, getMe);

router.post('/forgot-password', requestOTP);
router.post('/verify-otp', verifyOTP);
router.post('/reset-password', resetPassword);

module.exports = router;
