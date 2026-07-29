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

// ────────────────────────────────────────────────────────────────────────────
// POST /api/ai-usage/bonus   { feature }
// Credits one bonus use after a rewarded ad completes.
//
// Recorded against the account rather than the device, so the reward cannot be
// re-earned by clearing app data. Capped per day server-side.
// ────────────────────────────────────────────────────────────────────────────
router.post("/ai-usage/bonus", async (req, res) => {
    try {
        const feature = String(req.body.feature || "").trim();
        const { FEATURE_RULES } = require("../services/usage/quotaRules");

        if (!FEATURE_RULES[feature]) {
            return res.status(400).json({
                success: false,
                error: `Unknown feature. Expected one of: ${Object.keys(FEATURE_RULES).join(", ")}.`,
            });
        }

        // Premium plans have nothing to top up.
        if (req.isPremium === true) {
            return res.json({ success: true, granted: 0, unlimited: true });
        }

        const maxPerDay = Number(process.env.AI_BONUS_MAX_PER_DAY || 5);
        const { grantBonus } = require("../services/usage/usageRepository");
        const result = await grantBonus({ uid: req.user.uid, feature, units: 1, maxPerDay });

        return res.json({
            success:    true,
            feature,
            granted:    result.granted,
            totalBonus: result.totalBonus,
            atLimit:    result.atLimit,
            message:    result.granted > 0
                    ? "Bonus use added."
                    : "You have already claimed today's bonus uses.",
        });

    } catch (err) {
        console.error("[ai-usage/bonus]", err.message);
        return res.status(500).json({ success: false, error: "Could not add the bonus use." });
    }
});

module.exports = router;
