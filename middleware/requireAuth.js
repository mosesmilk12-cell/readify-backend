const admin = require('../config/firebase');

async function requireAuth(req, res, next) {
  try {
    const header = req.get('Authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'Sign in is required.' });
    if (!admin.apps.length) return res.status(503).json({ error: 'Firebase Admin is not configured.' });

    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.user = decoded;

    const snapshot = await admin.firestore().collection('users').doc(decoded.uid).get();
    const profile = snapshot.exists ? snapshot.data() : {};
    req.userProfile = profile;
    req.userTier = profile.subscriptionTier || 'FREE';
    req.isPremium = req.userTier === 'PREMIUM' || req.userTier === 'LITE_YEARLY';
    next();
  } catch (error) {
    console.warn('[Auth]', error.message);
    return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
  }
}

module.exports = requireAuth;
