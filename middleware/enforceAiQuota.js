"use strict";

const { reserveUsage, releaseUsage } = require("../services/usage/usageService");

function enforceAiQuota(feature, unitsResolver = () => 1) {
  return async function aiQuotaMiddleware(req, res, next) {
    try {
      const units = Math.max(1, Math.floor(Number(unitsResolver(req)) || 1));
      const reservation = await reserveUsage({
        uid: req.user.uid,
        feature,
        units,
        isPremium: req.isPremium === true,
      });

      if (!reservation.allowed) {
        return res.status(429).json({
          error: "AI_QUOTA_EXCEEDED",
          message: `You have reached today's ${feature} limit.`,
          usage: reservation.quota,
        });
      }

      req.aiUsageReservation = {
        ...reservation,
        uid: req.user.uid,
        feature,
        units,
      };
      req.releaseAiUsage = () => releaseUsage(req.aiUsageReservation);
      return next();
    } catch (error) {
      console.error(`[AI Quota] middleware failed for ${feature}:`, error.message);
      return res.status(503).json({
        error: "AI_USAGE_SERVICE_UNAVAILABLE",
        message: "AI usage verification is temporarily unavailable.",
      });
    }
  };
}

module.exports = enforceAiQuota;
