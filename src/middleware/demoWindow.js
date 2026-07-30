const logger = require('../config/logger');

// ═══ CLIENT DEMO WINDOW (server-side enforcement) ═══
// Time-limits the public review portal at the API level, so the limit holds
// even if someone edits the frontend bundle or disables the in-app lock: once
// the deadline passes, every data request from the portal's origin is refused.
//
// Scoped by Origin header, which browsers set themselves and page JavaScript
// cannot override. The native Android app sends no Origin, so installed APKs
// and local development are never affected.
//
// Config (both must be set for the gate to do anything):
//   DEMO_ORIGIN   — e.g. https://chinedumsunday.github.io
//   DEMO_ENDS_AT  — ISO timestamp, e.g. 2026-08-01T06:12:31Z
//   DEMO_CONTACT  — optional, shown in the refusal message
//
// /api/health stays open so the portal can still sync server time and show a
// proper "demo ended" screen instead of generic connection failures.
module.exports = function demoWindow(req, res, next) {
  const demoOrigin = process.env.DEMO_ORIGIN;
  const endsAt = process.env.DEMO_ENDS_AT;
  if (!demoOrigin || !endsAt) return next();

  const origin = req.headers.origin;
  if (!origin || origin !== demoOrigin) return next();

  if (req.path === '/health' || req.path === '/api/health') return next();

  const deadline = new Date(endsAt).getTime();
  if (!Number.isFinite(deadline) || Date.now() <= deadline) return next();

  const contact = process.env.DEMO_CONTACT;
  logger.info(`Demo window expired — refused ${req.method} ${req.path} from ${origin}`);
  return res.status(403).json({
    success: false,
    error: {
      message: contact
        ? `This demo period has ended. Please contact ${contact} to activate full access.`
        : 'This demo period has ended. Please contact the developer to activate full access.',
      code: 'DEMO_EXPIRED',
    },
  });
};
