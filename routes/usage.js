"use strict";

const express = require("express");
const router  = express.Router();

const { getDailyUsage, isTrackingEnabled, isEnforcementEnabled } =
        require("../services/usage/usageService");
const { FEATURE_RULES, resolveQuota } = require("../services/usage/quotaRules");

// ────────────────────────────────────────────────────────────────────────────
// GET /api/ai-usage
// Returns the signed-in user's AI usage for today plus what's left on each
// feature. Read-only — safe to poll from the app to render "3 of 5 left".
//
// While AI_SERVER_QUOTAS_ENABLED is false the `limit` values are advisory:
// usage is recorded but nothing is blocked, so this doubles as the shadow-mode
// monitor for the Sprint 1 rollout.
// ────────────────────────────────────────────────────────────────────────────
router.get("/ai-usage", async (req, res) => {
    try {
        const uid       = req.user.uid;
        const isPremium = req.isPremium === true;
        const usage     = await getDailyUsage({ uid });

        const features = {};
        for (const feature of Object.keys(FEATURE_RULES)) {
            features[feature] = resolveQuota({ feature, usage, isPremium });
        }

        return res.json({
            success:    true,
            uid,
            dateKey:    usage.dateKey || null,
            isPremium,
            features,
            enforcement: {
                tracking: isTrackingEnabled(),
                // false = shadow mode: counting only, nothing is blocked yet
                blocking: isEnforcementEnabled(),
            },
        });

    } catch (err) {
        console.error("[ai-usage]", err.message);
        return res.status(503).json({
            success: false,
            error:   "Usage information is temporarily unavailable.",
        });
    }
});

module.exports = router;
