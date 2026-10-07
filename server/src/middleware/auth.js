import { auth } from '../firebase.js';

export async function requireAuth(req, res, next) {
  if (!auth) return res.status(503).json({error:'Firebase Admin is not configured'});
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({error:'Missing Firebase ID token'});
  try {
    req.user = await auth.verifyIdToken(token);
    next();
  } catch { return res.status(401).json({error:'Invalid or expired authentication token'}); }
}
