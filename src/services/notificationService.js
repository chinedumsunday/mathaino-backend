const prisma = require('../config/database');
const logger = require('../config/logger');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100; // Expo push API limit per request

/**
 * Send push messages through Expo's push service.
 * Fire-and-forget: failures are logged, never thrown.
 */
async function sendExpoPush(tokens, { title, message, data }) {
  const valid = tokens.filter(t => typeof t === 'string' && t.startsWith('ExponentPushToken'));
  if (!valid.length) return;

  const messages = valid.map(to => ({
    to,
    sound: 'default',
    title,
    body: message,
    data: data || {},
  }));

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        logger.warn(`Expo push request failed: ${res.status}`);
      }
    } catch (err) {
      logger.warn(`Expo push error: ${err.message}`);
    }
  }
}

/**
 * Create in-app notifications for a set of users and push them to devices.
 * Push is skipped for scheduled (future) notifications — those surface in-app
 * when their time comes.
 */
async function notifyUsers(userIds, { title, message, type, data, scheduledFor }) {
  if (!userIds.length) return;

  await prisma.notification.createMany({
    data: userIds.map(userId => ({
      userId,
      title,
      message,
      type,
      data: data || null,
      scheduledFor: scheduledFor || null,
    })),
    skipDuplicates: true,
  });

  if (scheduledFor && new Date(scheduledFor) > new Date()) return;

  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, pushToken: { not: null } },
    select: { pushToken: true },
  });

  // Don't block the request on push delivery
  sendExpoPush(users.map(u => u.pushToken), { title, message, data }).catch(() => {});
}

module.exports = { notifyUsers, sendExpoPush };
