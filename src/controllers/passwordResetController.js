const prisma = require('../config/database');
const { admin } = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const { sendPasswordResetOTP } = require('../services/emailService');

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/forgot-password
const requestOTP = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

  // Always respond with success to prevent email enumeration
  if (!user) {
    return res.json({ success: true, message: 'If that email exists, a code has been sent.' });
  }

  // Invalidate any existing OTPs for this email
  await prisma.passwordReset.updateMany({
    where: { email: user.email, used: false },
    data: { used: true },
  });

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await prisma.passwordReset.create({
    data: { email: user.email, otp, expiresAt },
  });

  await sendPasswordResetOTP(user.email, otp, user.firstName);

  res.json({ success: true, message: 'If that email exists, a code has been sent.' });
});

// POST /api/auth/verify-otp
const verifyOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and code are required.' });

  const record = await prisma.passwordReset.findFirst({
    where: {
      email: email.toLowerCase().trim(),
      otp,
      used: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    return res.status(400).json({ success: false, message: 'Invalid or expired code. Please try again.' });
  }

  res.json({ success: true, message: 'Code verified.' });
});

// POST /api/auth/reset-password
const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ success: false, message: 'Email, code, and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  }

  const record = await prisma.passwordReset.findFirst({
    where: {
      email: email.toLowerCase().trim(),
      otp,
      used: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    return res.status(400).json({ success: false, message: 'Invalid or expired code.' });
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

  // Update password in Firebase Auth
  await admin.auth().updateUser(user.firebaseUid, { password: newPassword });

  // Mark OTP as used
  await prisma.passwordReset.update({ where: { id: record.id }, data: { used: true } });

  res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
});

module.exports = { requestOTP, verifyOTP, resetPassword };
