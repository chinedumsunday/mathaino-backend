const prisma = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * GET /api/courses/:courseId/certificate
 * Get the certificate for the current user in a course (if issued)
 */
const getCertificate = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const userId = req.user.id;

  const certificate = await prisma.certificate.findUnique({
    where: { userId_courseId: { userId, courseId } },
    include: {
      course: { select: { id: true, title: true, code: true, creator: { select: { firstName: true, lastName: true } } } },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  if (!certificate) {
    return res.json({ success: true, data: { certificate: null } });
  }

  res.json({ success: true, data: { certificate } });
});

/**
 * GET /api/certificates
 * Get all certificates for the current user
 */
const myCertificates = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const certificates = await prisma.certificate.findMany({
    where: { userId },
    include: {
      course: {
        select: {
          id: true,
          title: true,
          code: true,
          creator: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { issuedAt: 'desc' },
  });

  res.json({ success: true, data: { certificates } });
});

module.exports = { getCertificate, myCertificates };
