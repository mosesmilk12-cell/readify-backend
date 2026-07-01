require("dotenv").config();
const admin = require("firebase-admin");

/**
 * Firebase Admin SDK singleton.
 *
 * Requires the environment variable:
 *   GOOGLE_SERVICE_ACCOUNT_JSON — the full service account JSON as a string
 *   (paste the content of your serviceAccountKey.json into Render's env vars)
 *
 * Already required by the subscription and tutor routes.
 */

if (!admin.apps.length) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    console.warn(
      "[Firebase] GOOGLE_SERVICE_ACCOUNT_JSON not set — Firestore writes will fail."
    );
  } else {
    try {
      const serviceAccount = JSON.parse(raw);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log("[Firebase] Admin SDK initialised");
    } catch (err) {
      console.error("[Firebase] Failed to parse service account JSON:", err.message);
    }
  }
}

module.exports = admin;
