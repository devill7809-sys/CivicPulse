import { createHash } from 'node:crypto';

const MIN_TOKEN_LENGTH = 100;
const MAX_TOKEN_LENGTH = 4096;
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered'
]);

export function validateFcmToken(token) {
  return typeof token === 'string'
    && token.length >= MIN_TOKEN_LENGTH
    && token.length <= MAX_TOKEN_LENGTH
    && /^[A-Za-z0-9:_-]+$/.test(token);
}

export function fcmTokenDocumentId(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createTokenRegistrationHandler({db, logger = console}) {
  return async (req, res) => {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({error:'Authentication required'});
    if (!db) return res.status(503).json({error:'Token registration is unavailable'});

    const {token} = req.body || {};
    if (!validateFcmToken(token)) return res.status(400).json({error:'Invalid FCM token'});

    try {
      const tokenHash = fcmTokenDocumentId(token);
      await db.collection('fcmTokens').doc(tokenHash).set({
        token,
        uid,
        platform:'android',
        updatedAt:new Date().toISOString()
      });
      return res.status(200).json({ok:true});
    } catch (error) {
      logger.error('FCM token registration failed', {code:error?.code});
      return res.status(500).json({error:'Token registration failed'});
    }
  };
}

export async function sendComplaintStatusNotification({db, messaging, complaintId, status, logger = console}) {
  if (!db || !messaging) return {sent:0, reason:'unavailable'};

  try {
    const complaintSnapshot = await db.collection('complaints').doc(complaintId).get();
    if (!complaintSnapshot.exists) return {sent:0, reason:'complaint-not-found'};

    const complaint = complaintSnapshot.data();
    const ownerUid = complaint?.citizenId;
    if (!ownerUid) return {sent:0, reason:'owner-not-found'};

    const tokenSnapshot = await db.collection('fcmTokens').where('uid', '==', ownerUid).get();
    const registrations = tokenSnapshot.docs
      .map((document) => ({document, token:document.data()?.token}))
      .filter((registration) => validateFcmToken(registration.token));
    if (!registrations.length) return {sent:0, reason:'no-tokens'};

    let sent = 0;
    for (let offset = 0; offset < registrations.length; offset += 500) {
      const batch = registrations.slice(offset, offset + 500);
      try {
        const response = await messaging.sendEachForMulticast({
          tokens:batch.map(({token}) => token),
          notification:{
            title:'CivicPulse complaint update',
            body:`Complaint ${complaintId} status is now ${status}.`
          },
          android:{notification:{channelId:'civicpulse_updates',clickAction:'com.civicpulse.OPEN_COMPLAINT'}},
          data:{complaintId, status}
        });
        sent += response.successCount || 0;

        const invalidDeletes = [];
        response.responses?.forEach((result, index) => {
          if (INVALID_TOKEN_CODES.has(result.error?.code)) {
            invalidDeletes.push(batch[index].document.ref.delete());
          }
        });
        const cleanupResults = await Promise.allSettled(invalidDeletes);
        for (const cleanup of cleanupResults) {
          if (cleanup.status === 'rejected') logger.warn('Invalid FCM token cleanup failed', {code:cleanup.reason?.code});
        }
      } catch (error) {
        logger.warn('FCM status notification batch failed', {code:error?.code});
      }
    }

    return {sent, reason:sent ? 'sent' : 'not-delivered'};
  } catch (error) {
    logger.warn('FCM status notification lookup failed', {code:error?.code});
    return {sent:0, reason:'failed'};
  }
}