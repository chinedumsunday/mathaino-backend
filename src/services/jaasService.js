const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

// JaaS (Jitsi as a Service by 8x8) credentials — set in Railway env.
// Without these, live classes fall back to the public meet.jit.si server
// (which prompts the lecturer to log in as moderator).
const APP_ID = process.env.JAAS_APP_ID;          // vpaas-magic-cookie-xxxxxxxx
const KID = process.env.JAAS_KID;                // <appId>/<keyId> from the API key page
// Private key may arrive with literal "\n" when stored as a single-line env var
const PRIVATE_KEY = (process.env.JAAS_PRIVATE_KEY || '').replace(/\\n/g, '\n');

function isConfigured() {
  return !!(APP_ID && KID && PRIVATE_KEY);
}

// Pull the room name out of a stored meeting link (last path segment)
function roomFromLink(link) {
  if (!link) return null;
  const clean = link.split('?')[0].split('#')[0];
  const seg = clean.split('/').filter(Boolean).pop();
  return seg || null;
}

// Signed JWT that makes the holder a moderator (lecturer) or guest (student)
// with no Jitsi login prompt.
function generateToken({ room, user, moderator }) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      aud: 'jitsi',
      iss: 'chat',
      sub: APP_ID,
      room: room || '*',
      iat: now,
      nbf: now - 10,
      exp: now + 4 * 60 * 60, // 4 hours
      context: {
        user: {
          id: String(user.id || ''),
          name: user.name || 'Participant',
          email: user.email || '',
          avatar: user.avatar || '',
          moderator: !!moderator,
        },
        features: {
          livestreaming: false,
          recording: false,
          transcription: false,
          'outbound-call': false,
        },
      },
    },
    PRIVATE_KEY,
    { algorithm: 'RS256', header: { kid: KID, typ: 'JWT' } }
  );
}

// Full in-app meeting URL with the JWT embedded
function buildMeetingUrl({ room, user, moderator }) {
  try {
    const token = generateToken({ room, user, moderator });
    return `https://8x8.vc/${APP_ID}/${encodeURIComponent(room)}?jwt=${token}`;
  } catch (err) {
    logger.error(`JaaS token generation failed: ${err.message}`);
    return null;
  }
}

module.exports = { isConfigured, roomFromLink, generateToken, buildMeetingUrl };
