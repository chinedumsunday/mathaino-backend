const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = `"Mathaino" <${process.env.SMTP_USER}>`;

async function sendPasswordResetOTP(email, otp, firstName) {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Your Mathaino password reset code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0d0d0d;border-radius:16px;border:1px solid #222;">
        <h2 style="color:#e8ff47;margin-bottom:8px;">Reset your password</h2>
        <p style="color:#aaa;font-size:14px;">Hi ${firstName || 'there'},</p>
        <p style="color:#aaa;font-size:14px;">Use the code below to reset your Mathaino password. It expires in <strong style="color:#fff;">15 minutes</strong>.</p>
        <div style="text-align:center;margin:32px 0;">
          <span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#e8ff47;background:#1a1a1a;padding:16px 28px;border-radius:12px;border:1px solid #333;">${otp}</span>
        </div>
        <p style="color:#666;font-size:12px;text-align:center;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendPasswordResetOTP };
