let firebaseModuleCache = null;

async function getFirebaseAuthClient() {
  if (!firebaseModuleCache) {
    firebaseModuleCache = await import('../firebase.js');
  }
  return firebaseModuleCache.auth;
}

export function getBearerToken(header = '') {
  if (!header || typeof header !== 'string') return null;
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export function isAdminClaim(user = null) {
  return !!user && user.admin === true;
}

export async function requireAuth(req, res, next, authClient = null) {
  const activeAuthClient = authClient || await getFirebaseAuthClient();
  if (!activeAuthClient) return res.status(503).json({error:'Firebase Admin is not configured'});

  const token = getBearerToken(req.headers.authorization || '');
  if (!token) return res.status(401).json({error:'Missing Firebase ID token'});

  try {
    req.user = await activeAuthClient.verifyIdToken(token);
    return next();
  } catch {
    return res.status(401).json({error:'Invalid or expired authentication token'});
  }
}

export async function requireAdmin(req, res, next, user = req.user) {
  if (!user) return res.status(401).json({error:'Missing Firebase user context'});
  if (user.admin !== true) return res.status(403).json({error:'Admin access required'});
  return next();
}
