"use strict";

const repository = require("./usageRepository");

function envFlag(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function isTrackingEnabled() {
  return envFlag("AI_USAGE_TRACKING_ENABLED", true);
}

function isEnforcementEnabled() {
  return envFlag("AI_SERVER_QUOTAS_ENABLED", false);
}

function isFailClosed() {
  return envFlag("AI_QUOTA_FAIL_CLOSED", false);
}

async function reserveUsage({ uid, feature, units = 1, isPremium = false }) {
  if (!isTrackingEnabled()) {
    return { allowed: true, recorded: false, skipped: true, reason: "tracking_disabled" };
  }

  try {
    return await repository.consume({
      uid,
      feature,
      units,
      isPremium,
      enforce: isEnforcementEnabled(),
    });
  } catch (error) {
    console.error(`[AI Usage] reserve failed for ${feature}:`, error.message);
    if (isFailClosed()) throw error;
    return { allowed: true, recorded: false, degraded: true, reason: "usage_store_unavailable" };
  }
}

async function releaseUsage(reservation) {
  if (!reservation?.recorded || !reservation.uid || !reservation.feature) return;
  try {
    await repository.release({
      uid: reservation.uid,
      feature: reservation.feature,
      units: reservation.units,
    });
  } catch (error) {
    console.error(`[AI Usage] release failed for ${reservation.feature}:`, error.message);
  }
}

module.exports = {
  reserveUsage,
  releaseUsage,
  getDailyUsage: repository.getDailyUsage,
  isTrackingEnabled,
  isEnforcementEnabled,
};
