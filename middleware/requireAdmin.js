"use strict";

/**
 * Gate for ESJ Console endpoints. Must be mounted AFTER requireAuth, which
 * has already verified the Firebase token and loaded the user profile.
 *
 * A user counts as an admin when either is true:
 *   1. Their Firebase token carries the custom claim  admin: true
 *      (set with admin.auth().setCustomUserClaims(uid, { admin: true }))
 *   2. Their users/{uid} document has  role: "admin"
 *
 * The claim is preferred — it is signed and cannot be edited from a client.
 * The Firestore role exists so you can grant access from the console without
 * running a script, and is safe because clients cannot write their own
 * profile role under proper security rules.
 */
function requireAdmin(req, res, next) {
  const hasClaim = req.user && req.user.admin === true;
  const hasRole  = req.userProfile && req.userProfile.role === "admin";

  if (hasClaim || hasRole) {
    req.isAdmin = true;
    return next();
  }

  // Deliberately vague: don't advertise that an admin surface exists.
  return res.status(404).json({ error: "Not found." });
}

module.exports = requireAdmin;
